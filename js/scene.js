import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAP_KEY, MASK_DOWNSAMPLE_RATIO, MASK_MIN_DOWNSAMPLED_SIZE, MASK_PALETTE, arToSceneVector3 } from './state.js';
import { extractLapCourseFromObjects } from './pose-track-helpers.js';
import { resolveZipBlobUrl, findSkyboxUrls } from './zip-import.js';
import {
    extractAlphaMaskFromImageData,
    extractConnectedComponentsFromMask
} from './export-helpers.js';

export function createSceneModule(appState, mounts, hooks = {}) {
    const { scene: sceneState, exportState, defaults } = appState;
    const viewportShell = mounts.viewportShell;
    const viewportCanvasMount = mounts.viewportCanvasMount;
    const previewMount = mounts.previewMount;
    const previewFrame = mounts.previewFrame;
    const previewOverlay = mounts.previewOverlay;

    const clock = new THREE.Clock();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    camera.position.copy(defaults.defaultExportCameraState.position);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.max(window.devicePixelRatio, 2.0));
    viewportCanvasMount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.copy(defaults.defaultMainTarget);

    const previewRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    previewRenderer.setPixelRatio(1);
    previewMount.appendChild(previewRenderer.domElement);

    const exportRenderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: false });
    exportRenderer.setPixelRatio(1);

    const exportCamera = new THREE.PerspectiveCamera(exportState.camera.fov, 1, 0.01, 1000);

    const keys = {};
    const MOVE_SPEED = 2.0;

    renderer.domElement.addEventListener('keydown', (event) => { keys[event.code] = true; });
    renderer.domElement.addEventListener('keyup', (event) => { keys[event.code] = false; });
    renderer.domElement.tabIndex = 0;

    const gridHelper = new THREE.GridHelper(30, 30, 0x444444, 0x222222);
    scene.add(gridHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const trackMaskVertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const trackMaskFragmentShader = `
        uniform sampler2D uTexture;
        uniform float uThreshold;
        uniform float uEdgeWidthMultiplier;
        uniform vec3 uMaskColor;
        varying vec2 vUv;
        void main() {
            float shrunkenVal = texture2D(uTexture, vUv).r;
            float mask = step(uThreshold, shrunkenVal);
            vec3 finalColor = mix(vec3(0.0), uMaskColor, mask);
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `;

    const mapArrowIdVertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const mapArrowIdFragmentShader = `
        uniform sampler2D uTexture;
        varying vec2 vUv;
        void main() {
            vec4 texel = texture2D(uTexture, vUv);
            if (texel.a < 0.5) discard;
            gl_FragColor = vec4(texel.rgb, 1.0);
        }
    `;

    function buildTrackMaskMaterial(colorHex) {
        const maskColor = new THREE.Color();
        maskColor.r = ((colorHex >> 16) & 0xff) / 255;
        maskColor.g = ((colorHex >> 8) & 0xff) / 255;
        maskColor.b = (colorHex & 0xff) / 255;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: null },
                uThreshold: { value: 0.5 },
                uEdgeWidthMultiplier: { value: 3.5 },
                uMaskColor: { value: maskColor }
            },
            vertexShader: trackMaskVertexShader,
            fragmentShader: trackMaskFragmentShader
        });
        // Must disable tone mapping so the raw semantic ID byte values
        // (e.g. road = 0x000001, B=1) are preserved exactly in the PNG output.
        material.toneMapped = false;
        return material;
    }

    const objectIdVertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const objectIdFragmentShader = `
        uniform vec3 uColor;
        void main() {
            gl_FragColor = vec4(uColor, 1.0);
        }
    `;

    function buildObjectIdMaterial(colorHex) {
        const uColor = new THREE.Color();
        uColor.r = ((colorHex >> 16) & 0xff) / 255;
        uColor.g = ((colorHex >> 8) & 0xff) / 255;
        uColor.b = (colorHex & 0xff) / 255;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: uColor }
            },
            vertexShader: objectIdVertexShader,
            fragmentShader: objectIdFragmentShader,
            side: THREE.DoubleSide
        });
        material.toneMapped = false;
        return material;
    }

    function buildMapArrowIdMaterial() {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: sceneState.mapArrowTexture }
            },
            vertexShader: mapArrowIdVertexShader,
            fragmentShader: mapArrowIdFragmentShader,
            side: THREE.DoubleSide
        });
        material.toneMapped = false;
        return material;
    }

    const antialiasedTrackShader = buildTrackMaskMaterial(0xff0000);

    function encodeIdHex(id) {
        return Math.max(0, id) & 0xffffff;
    }

    function encodeDetectionHex(id) {
        const levels = [48, 88, 128, 168, 208, 248];
        let value = Math.max(1, id);
        const r = levels[value % levels.length];
        value = Math.floor(value / levels.length);
        const g = levels[value % levels.length];
        value = Math.floor(value / levels.length);
        const b = levels[value % levels.length];
        return (r << 16) | (g << 8) | b;
    }

    function getPaletteHex(index) {
        return MASK_PALETTE[index % MASK_PALETTE.length];
    }

    function getUniqueModelColor(key) {
        if (key.includes('map.png')) return 0xff0000;
        if (!sceneState.modelColorMap[key]) {
            sceneState.modelColorMap[key] = MASK_PALETTE[sceneState.colorCounter % MASK_PALETTE.length];
            sceneState.colorCounter++;
        }
        return sceneState.modelColorMap[key];
    }

    function getBasicMaterial(colorHex) {
        if (!sceneState.basicMaterialCache.has(colorHex)) {
            const material = new THREE.MeshBasicMaterial({ color: colorHex });
            material.toneMapped = false;
            sceneState.basicMaterialCache.set(colorHex, material);
        }
        return sceneState.basicMaterialCache.get(colorHex);
    }

    function getMainMaskMaterial(key) {
        const colorHex = getUniqueModelColor(key);
        if (!sceneState.mainMaskMaterialCache.has(colorHex)) {
            sceneState.mainMaskMaterialCache.set(colorHex, getBasicMaterial(colorHex));
        }
        return sceneState.mainMaskMaterialCache.get(colorHex);
    }

    function getTrackMaskMaterial(colorHex) {
        if (!sceneState.trackMaskMaterialCache.has(colorHex)) {
            sceneState.trackMaskMaterialCache.set(colorHex, buildTrackMaskMaterial(colorHex));
        }
        return sceneState.trackMaskMaterialCache.get(colorHex);
    }

    function getObjectIdMaterial(colorHex) {
        const materialKey = `object-id-${colorHex.toString(16)}`;
        if (!sceneState.trackMaskMaterialCache.has(materialKey)) {
            sceneState.trackMaskMaterialCache.set(materialKey, buildObjectIdMaterial(colorHex));
        }
        return sceneState.trackMaskMaterialCache.get(materialKey);
    }

    function syncTrackMaskMaterial(material) {
        material.uniforms.uTexture.value = sceneState.maskTexture;
        material.uniforms.uThreshold.value = antialiasedTrackShader.uniforms.uThreshold.value;
        material.uniforms.uEdgeWidthMultiplier.value = antialiasedTrackShader.uniforms.uEdgeWidthMultiplier.value;
    }

    function layerIdForKey(key) {
        return `layer-${btoa(encodeURIComponent(key)).replace(/=/g, '')}`;
    }

    function isGroupEnabled(key) {
        if (key === MAP_KEY) return true;
        const checkbox = document.getElementById(layerIdForKey(key));
        return checkbox ? checkbox.checked : true;
    }

    function slugifyName(raw) {
        const value = raw
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase();
        return value || 'object';
    }

    function ensureSemanticEntry(semanticKey, defaultName) {
        if (!sceneState.semanticRegistry.has(semanticKey)) {
            const semanticId = sceneState.nextSemanticId++;
            const entry = {
                key: semanticKey,
                id: semanticId,
                name: defaultName,
                enabled: true,
                previewHex: getPaletteHex(semanticId - 1),
                exportHex: encodeIdHex(semanticId)
            };
            sceneState.semanticRegistry.set(semanticKey, entry);
            exportState.semanticLabels[semanticKey] = defaultName;
            hooks.onSemanticRegistryChanged?.();
        }
        return sceneState.semanticRegistry.get(semanticKey);
    }

    function createInstanceEntry(baseName, semanticEntry, rootObject) {
        const instanceId = sceneState.nextInstanceId++;
        const entry = {
            id: instanceId,
            name: `${baseName}_${String(instanceId).padStart(3, '0')}`,
            semanticKey: semanticEntry.key,
            semanticId: semanticEntry.id,
            previewHex: getPaletteHex(instanceId + 5),
            detectionHex: encodeDetectionHex(instanceId),
            exportHex: encodeIdHex(instanceId),
            rootObject
        };
        sceneState.instanceRegistry.set(instanceId, entry);
        hooks.onInstanceRegistryChanged?.();
        return entry;
    }

    function registerExportObject(rootObject, options) {
        const semanticEntry = ensureSemanticEntry(options.semanticKey, options.semanticName);
        const instanceEntry = createInstanceEntry(options.instanceBaseName, semanticEntry, rootObject);

        rootObject.userData.exportSemanticKey = semanticEntry.key;
        rootObject.userData.exportSemanticId = semanticEntry.id;
        rootObject.userData.exportInstanceId = instanceEntry.id;

        const appearLaps = rootObject.userData.appearLaps || [];

        rootObject.traverse((child) => {
            if (!child.isMesh) return;
            child.userData.originalMaterial = child.userData.originalMaterial || child.material;
            child.userData.exportGroupKey = options.groupKey;
            child.userData.exportSemanticKey = semanticEntry.key;
            child.userData.exportSemanticId = semanticEntry.id;
            child.userData.exportSemanticPreviewHex = semanticEntry.previewHex;
            child.userData.exportSemanticHex = semanticEntry.exportHex;
            child.userData.exportInstanceId = instanceEntry.id;
            child.userData.exportInstanceName = instanceEntry.name;
            child.userData.exportInstancePreviewHex = instanceEntry.previewHex;
            child.userData.exportInstanceDetectionHex = instanceEntry.detectionHex;
            child.userData.exportInstanceHex = instanceEntry.exportHex;
            child.userData.appearLaps = appearLaps;
        });

        hooks.onSemanticRegistryChanged?.();
        hooks.onInstanceRegistryChanged?.();

        return {
            semanticEntry,
            instanceEntry
        };
    }

    function isSemanticEnabledForExport(semanticKey) {
        const semanticEntry = sceneState.semanticRegistry.get(semanticKey);
        return semanticEntry ? semanticEntry.enabled !== false : true;
    }

    function resizeMainRenderer() {
        const width = Math.max(1, viewportShell.clientWidth);
        const height = Math.max(1, viewportShell.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    }

    function resizePreviewRenderer() {
        const aspect = exportState.resolution.width / exportState.resolution.height;
        previewFrame.style.aspectRatio = `${exportState.resolution.width} / ${exportState.resolution.height}`;
        const width = Math.max(1, previewFrame.clientWidth);
        const rawHeight = Math.max(1, Math.round(width / aspect));
        const height = Math.min(300, rawHeight);
        previewRenderer.setSize(width, height, false);
        if (previewOverlay) {
            previewOverlay.width = width;
            previewOverlay.height = height;
            previewOverlay.style.width = `${width}px`;
            previewOverlay.style.height = `${height}px`;
        }
    }

    function syncExportCameraFromState() {
        exportCamera.position.copy(exportState.camera.position);
        exportCamera.fov = exportState.camera.fov;
        exportCamera.aspect = exportState.resolution.width / exportState.resolution.height;
        exportCamera.rotation.set(
            THREE.MathUtils.degToRad(exportState.camera.rotation.x),
            THREE.MathUtils.degToRad(exportState.camera.rotation.y),
            THREE.MathUtils.degToRad(exportState.camera.rotation.z),
            'XYZ'
        );
        exportCamera.updateProjectionMatrix();
        exportCamera.updateMatrixWorld();
    }

    function beginAssetLoad() {
        sceneState.pendingAssetLoads++;
        hooks.onResourceStateChanged?.();
    }

    function completeAssetLoad() {
        sceneState.pendingAssetLoads = Math.max(0, sceneState.pendingAssetLoads - 1);
        if (sceneState.pendingAssetLoads === 0) {
            sceneState.resourcesReady = true;
            hooks.onResourcesReady?.();
            requestExportPreview();
        }
        hooks.onResourceStateChanged?.();
    }

    function erodeAlphaMask(canvas, radiusPx) {
        const radius = Math.max(0, Math.round(radiusPx));
        if (radius <= 0) return canvas;

        const srcCtx = canvas.getContext('2d');
        const srcImageData = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
        const src = srcImageData.data;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = canvas.width;
        outCanvas.height = canvas.height;
        const outCtx = outCanvas.getContext('2d');
        const outImageData = outCtx.createImageData(canvas.width, canvas.height);
        const out = outImageData.data;

        const kernel = [];
        for (let y = -radius; y <= radius; y++) {
            for (let x = -radius; x <= radius; x++) {
                if ((x * x) + (y * y) <= radius * radius) {
                    kernel.push([x, y]);
                }
            }
        }

        const width = canvas.width;
        const height = canvas.height;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let keep = 255;
                for (const [dx, dy] of kernel) {
                    const sx = x + dx;
                    const sy = y + dy;
                    if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
                        keep = 0;
                        break;
                    }
                    const index = (sy * width + sx) * 4;
                    if (src[index] < 127) {
                        keep = 0;
                        break;
                    }
                }

                const outIndex = (y * width + x) * 4;
                out[outIndex] = keep;
                out[outIndex + 1] = keep;
                out[outIndex + 2] = keep;
                out[outIndex + 3] = 255;
            }
        }

        outCtx.putImageData(outImageData, 0, 0);
        return outCanvas;
    }

    function drawImageMirroredXZ(ctx, image, width, height) {
        ctx.save();
        ctx.translate(width, height);
        ctx.scale(-1, -1);
        ctx.drawImage(image, 0, 0, width, height);
        ctx.restore();
    }

    function buildMapArrowComponentData() {
        if (!sceneState.loadedImageElement) return;

        if (!sceneState.mapArrowCanvasElement) {
            sceneState.mapArrowCanvasElement = document.createElement('canvas');
        }

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = sceneState.loadedImageElement.width;
        sourceCanvas.height = sceneState.loadedImageElement.height;
        const sourceCtx = sourceCanvas.getContext('2d');
        drawImageMirroredXZ(sourceCtx, sceneState.loadedImageElement, sourceCanvas.width, sourceCanvas.height);

        const sourceImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const mask = extractAlphaMaskFromImageData(sourceImageData);
        const components = extractConnectedComponentsFromMask(mask, sourceCanvas.width, sourceCanvas.height, 20, true);
        const outputCanvas = sceneState.mapArrowCanvasElement;
        outputCanvas.width = sourceCanvas.width;
        outputCanvas.height = sourceCanvas.height;

        const outputCtx = outputCanvas.getContext('2d');
        const outputImageData = outputCtx.createImageData(outputCanvas.width, outputCanvas.height);

        components.forEach((component, index) => {
            component.colorId = encodeDetectionHex(index + 1000);
        });

        components.forEach((component) => {
                const colorId = component.colorId || 0;
                (component.pixelIndices || []).forEach((pixelIndex) => {
                    const offset = pixelIndex * 4;
                outputImageData.data[offset] = (colorId >> 16) & 0xff;
                outputImageData.data[offset + 1] = (colorId >> 8) & 0xff;
                outputImageData.data[offset + 2] = colorId & 0xff;
                outputImageData.data[offset + 3] = 255;
            });
        });
        outputCtx.putImageData(outputImageData, 0, 0);

        sceneState.mapArrowComponents = components;
        if (sceneState.mapArrowTexture) {
            sceneState.mapArrowTexture.dispose();
        }
        sceneState.mapArrowTexture = new THREE.CanvasTexture(outputCanvas);
        sceneState.mapArrowTexture.minFilter = THREE.NearestFilter;
        sceneState.mapArrowTexture.magFilter = THREE.NearestFilter;
        sceneState.mapArrowTexture.generateMipmaps = false;
        if ('colorSpace' in sceneState.mapArrowTexture && THREE.NoColorSpace) {
            sceneState.mapArrowTexture.colorSpace = THREE.NoColorSpace;
        }
    }

    function updateMaskTexture(blurValue) {
        if (!sceneState.loadedImageElement) return;

        if (!sceneState.mapCanvasElement) {
            sceneState.mapCanvasElement = document.createElement('canvas');
        }

        const canvas = sceneState.mapCanvasElement;
        const ctx = canvas.getContext('2d');
        canvas.width = sceneState.loadedImageElement.width;
        canvas.height = sceneState.loadedImageElement.height;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        drawImageMirroredXZ(tempCtx, sceneState.loadedImageElement, tempCanvas.width, tempCanvas.height);

        const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const b = data[i + 2];
            if (b - r > 30 && b > 90) {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                data[i + 3] = 255;
            } else {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
                data[i + 3] = 255;
            }
        }
        tempCtx.putImageData(imgData, 0, 0);

        // Road width is now controlled purely via the shader threshold (uThreshold),
        // NOT by pixel-level erosion. Shrink is added to the threshold in applyRoadParams().
        // This avoids the jagged-edge / fragment artefacts that binary erosion caused on
        // this particular track which is only ~7px half-width in map.png.

        // Downscale to low-res space for a controlled Gaussian-blur gradient.
        const lowResWidth = Math.max(MASK_MIN_DOWNSAMPLED_SIZE, Math.round(canvas.width * MASK_DOWNSAMPLE_RATIO));
        const lowResHeight = Math.max(MASK_MIN_DOWNSAMPLED_SIZE, Math.round(canvas.height * MASK_DOWNSAMPLE_RATIO));
        const lowResCanvas = document.createElement('canvas');
        lowResCanvas.width = lowResWidth;
        lowResCanvas.height = lowResHeight;
        const lowResCtx = lowResCanvas.getContext('2d');
        lowResCtx.clearRect(0, 0, lowResWidth, lowResHeight);
        lowResCtx.imageSmoothingEnabled = true;
        lowResCtx.imageSmoothingQuality = 'high';
        lowResCtx.drawImage(tempCanvas, 0, 0, lowResWidth, lowResHeight);

        // Blur in low-res space to produce a smooth distance-field-like gradient.
        const blurredLowResCanvas = document.createElement('canvas');
        blurredLowResCanvas.width = lowResWidth;
        blurredLowResCanvas.height = lowResHeight;
        const blurredLowResCtx = blurredLowResCanvas.getContext('2d');
        blurredLowResCtx.clearRect(0, 0, lowResWidth, lowResHeight);
        blurredLowResCtx.imageSmoothingEnabled = true;
        blurredLowResCtx.imageSmoothingQuality = 'high';
        blurredLowResCtx.filter = `blur(${Math.max(1.2, blurValue * 0.65)}px)`;
        blurredLowResCtx.drawImage(lowResCanvas, 0, 0);
        blurredLowResCtx.filter = 'none';

        // Upscale back to full canvas with additional soft blur for smooth edges.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.filter = `blur(${blurValue}px)`;
        ctx.drawImage(blurredLowResCanvas, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';

        if (sceneState.maskTexture) {
            sceneState.maskTexture.needsUpdate = true;
        }

        requestExportPreview();
    }

    function isChildVisibleForLap(child, lapValue) {
        if (!lapValue || lapValue === 'all') return true;
        const appearLaps = child.userData.appearLaps || [];
        if (appearLaps.length === 0) return true;
        return appearLaps.includes(Number(lapValue));
    }

    function updateObjectVisibilityByLap(lapValue) {
        appState.scene.currentLapFilter = lapValue;
        applyMainSceneMode();
        requestExportPreview();
    }

    function applyMainSceneMode() {
        scene.background = new THREE.Color(sceneState.isMaskMode ? 0x000000 : 0x0a0a0a);
        if (sceneState.skyboxMesh) {
            sceneState.skyboxMesh.visible = !sceneState.isMaskMode;
        }
        gridHelper.visible = sceneState.gridVisible && !sceneState.isMaskMode;

        const currentLap = appState.scene.currentLapFilter || 'all';

        Object.entries(sceneState.dynamicGroups).forEach(([key, group]) => {
            group.visible = isGroupEnabled(key);
            group.traverse((child) => {
                if (!child.isMesh) return;
                child.visible = (key === MAP_KEY) || isChildVisibleForLap(child, currentLap);
                if (sceneState.isMaskMode) {
                    if (key === MAP_KEY) {
                        syncTrackMaskMaterial(antialiasedTrackShader);
                        child.material = antialiasedTrackShader;
                    } else {
                        child.material = getMainMaskMaterial(key);
                    }
                } else {
                    child.material = child.userData.originalMaterial || child.material;
                }
            });
        });
    }

    function applySceneVariant(variant, forExport = false) {
        scene.background = variant === 'rgb' ? new THREE.Color(0x0a0a0a) : new THREE.Color(0x000000);
        if (sceneState.skyboxMesh) {
            sceneState.skyboxMesh.visible = (variant === 'rgb');
        }
        if (variant === 'rgb') {
            gridHelper.visible = sceneState.gridVisible;
        } else {
            gridHelper.visible = false;
        }

        const currentLap = appState.scene.currentLapFilter || 'all';

        Object.entries(sceneState.dynamicGroups).forEach(([key, group]) => {
            group.visible = true;
            group.traverse((child) => {
                if (!child.isMesh) return;
                child.visible = isSemanticEnabledForExport(child.userData.exportSemanticKey)
                                && ((key === MAP_KEY) || isChildVisibleForLap(child, currentLap));
                // Reset defaults to prevent state bleed
                child.renderOrder = 0;
                if (child.material) {
                    child.material.depthTest = true;
                }

                if (variant === 'rgb') {
                    child.material = child.userData.originalMaterial || child.material;
                    return;
                }

                const colorHex = (variant === 'semantic' || variant === 'semantic_road_covered')
                    ? (forExport ? child.userData.exportSemanticHex : child.userData.exportSemanticPreviewHex)
                    : (forExport ? child.userData.exportInstanceHex : child.userData.exportInstancePreviewHex);

                if (key === MAP_KEY) {
                    const material = getTrackMaskMaterial(colorHex);
                    syncTrackMaskMaterial(material);
                    child.material = material;
                    
                    if (variant === 'semantic_road_covered') {
                        child.material.depthTest = false;
                        child.renderOrder = 999;
                    }
                } else {
                    child.material = getBasicMaterial(colorHex);
                }
            });
        });
    }

    function renderSceneVariant(targetRenderer, variant, width, height, forExport = false) {
        if (!sceneState.resourcesReady) return;
        if (sceneState.maskTexture) {
            sceneState.maskTexture.needsUpdate = true;
        }
        syncExportCameraFromState();
        targetRenderer.setSize(width, height, false);
        applySceneVariant(variant, forExport);
        targetRenderer.render(scene, exportCamera);
        applyMainSceneMode();
    }

    function renderObjectDetectionIdVariant(targetRenderer, width, height) {
        if (!sceneState.resourcesReady) return false;
        syncExportCameraFromState();
        targetRenderer.setSize(width, height, false);
        applySceneVariant('instance', false);

        Object.values(sceneState.dynamicGroups).forEach((group) => {
            group.traverse((child) => {
                if (!child.isMesh) return;
                const colorHex = child.userData.exportGroupKey === MAP_KEY
                    ? 0x000000
                    : (child.userData.exportInstanceDetectionHex || 0x000000);
                child.material = getObjectIdMaterial(colorHex);
            });
        });

        targetRenderer.render(scene, exportCamera);
        applyMainSceneMode();
        return true;
    }

    function renderSingleInstanceMaskVariant(targetRenderer, rootObject, width, height) {
        if (!sceneState.resourcesReady || !rootObject) return false;
        syncExportCameraFromState();
        targetRenderer.setSize(width, height, false);
        applySceneVariant('instance', false);

        Object.values(sceneState.dynamicGroups).forEach((group) => {
            group.traverse((child) => {
                if (!child.isMesh) return;
                child.material = getObjectIdMaterial(0x000000);
            });
        });
        rootObject.traverse((child) => {
            if (!child.isMesh) return;
            child.material = getObjectIdMaterial(0xffffff);
        });

        targetRenderer.render(scene, exportCamera);
        applyMainSceneMode();
        return true;
    }

    function renderMapArrowIdVariant(targetRenderer, width, height) {
        if (!sceneState.resourcesReady || !sceneState.groundMesh || !sceneState.mapArrowTexture) return false;
        syncExportCameraFromState();
        targetRenderer.setSize(width, height, false);
        applySceneVariant('instance', false);

        Object.values(sceneState.dynamicGroups).forEach((group) => {
            if (group !== sceneState.dynamicGroups[MAP_KEY]) {
                group.traverse((child) => {
                    if (child.isMesh) child.material = getBasicMaterial(0x000000);
                });
            }
        });

        if (!sceneState.mapArrowMaterial) {
            sceneState.mapArrowMaterial = buildMapArrowIdMaterial();
        }
        sceneState.mapArrowMaterial.uniforms.uTexture.value = sceneState.mapArrowTexture;
        sceneState.mapArrowMaterial.needsUpdate = true;
        sceneState.groundMesh.material = sceneState.mapArrowMaterial;
        targetRenderer.render(scene, exportCamera);
        applyMainSceneMode();
        return true;
    }

    function renderExportPreview() {
        if (!sceneState.resourcesReady) return;
        resizePreviewRenderer();
        const width = Math.max(1, previewFrame.clientWidth);
        const height = Math.min(300, Math.max(1, Math.round(width * exportState.resolution.height / exportState.resolution.width)));
        const previewVariant = exportState.previewMode === 'detections' ? 'rgb' : exportState.previewMode;
        renderSceneVariant(previewRenderer, previewVariant, width, height, false);
        hooks.onPreviewRendered?.(width, height);
    }

    function requestExportPreview() {
        if (!sceneState.resourcesReady || sceneState.previewRenderQueued) return;
        sceneState.previewRenderQueued = true;
        requestAnimationFrame(() => {
            sceneState.previewRenderQueued = false;
            renderExportPreview();
        });
    }

    function updateGroundTransform() {
        if (!sceneState.groundMesh) return;
        const w = parseFloat(document.getElementById('param-width').value);
        const h = parseFloat(document.getElementById('param-height').value);
        const cx = parseFloat(document.getElementById('param-cx').value);
        const cz = parseFloat(document.getElementById('param-cz').value);
        const center = arToSceneVector3(cx, -0.005, cz);

        sceneState.groundMesh.scale.set(w, h, 1);
        sceneState.groundMesh.position.copy(center);

        document.getElementById('val-width').innerText = w.toFixed(2);
        document.getElementById('val-height').innerText = h.toFixed(2);
        document.getElementById('val-cx').innerText = cx.toFixed(2);
        document.getElementById('val-cz').innerText = cz.toFixed(2);
        requestExportPreview();
    }

    function updateGroundMapTexture(imageSrc) {
        if (!sceneState.groundMesh || !sceneState.originalMapMaterial) return;

        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(imageSrc, (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.x = -1;
            texture.repeat.y = -1;
            texture.offset.x = 1;
            texture.offset.y = 1;
            texture.needsUpdate = true;

            if (sceneState.originalMapMaterial.map) {
                sceneState.originalMapMaterial.map.dispose();
            }
            sceneState.originalMapMaterial.map = texture;
            sceneState.originalMapMaterial.needsUpdate = true;

            sceneState.loadedImageElement = texture.image;

            buildMapArrowComponentData();
            updateMaskTexture(parseFloat(document.getElementById('param-blur').value));

            if (sceneState.maskTexture) {
                antialiasedTrackShader.uniforms.uTexture.value = sceneState.maskTexture;
            }

            if (sceneState.mapArrowMaterial) {
                sceneState.mapArrowMaterial.uniforms.uTexture.value = sceneState.mapArrowTexture;
                sceneState.mapArrowMaterial.needsUpdate = true;
            }

            requestExportPreview();
            hooks.onSemanticRegistryChanged?.();
        }, undefined, () => {
            hooks.onStatusMessage?.('新底图加载失败。', 'error');
        });
    }

    function syncMaskControls() {
        const blur = parseFloat(document.getElementById('param-blur').value);
        const edgeOffset = parseInt(document.getElementById('param-threshold').value, 10);
        const shrink = 0;
        const edgeAA = 0.5;

        document.getElementById('val-blur').innerText = blur.toFixed(1);
        document.getElementById('val-threshold').innerText = edgeOffset;

        // Shrink raises the threshold, making the visible road narrower.
        // Scale: each Shrink unit ≈ 0.022 threshold increase.
        // At Shrink=0 the full road (Blur-softened) is shown; at Shrink~20 it nearly vanishes.
        const shrinkThreshold = shrink * 0.022;
        antialiasedTrackShader.uniforms.uThreshold.value = 0.5 + (edgeOffset / 255.0) + shrinkThreshold;
        antialiasedTrackShader.uniforms.uEdgeWidthMultiplier.value = edgeAA;
        syncTrackMaskMaterial(antialiasedTrackShader);
        updateMaskTexture(blur);
    }

    function createSkyboxMesh(image) {
        const geometry = new THREE.SphereGeometry(500, 64, 32);
        const texture = new THREE.Texture(image);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, toneMapped: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = -1;
        return mesh;
    }

    function createSplitSkyboxMesh(image) {
        const imgWidth = image.width;
        const imgHeight = image.height;
        const topPercent = sceneState.skyTopPercent / 100;
        const groundPercent = sceneState.skyGroundPercent / 100;
        const skyBandHeight = Math.max(1, Math.floor(imgHeight * topPercent));
        const groundBandHeight = Math.max(1, Math.floor(imgHeight * groundPercent));
        const wallBandHeight = Math.max(1, imgHeight - skyBandHeight - groundBandHeight);

        function createBandCanvas(yOffset, bandH) {
            const c = document.createElement('canvas');
            c.width = imgWidth;
            c.height = bandH;
            const ctx = c.getContext('2d');
            ctx.drawImage(image, 0, yOffset, imgWidth, bandH, 0, 0, imgWidth, bandH);
            return c;
        }

        const skyCanvas = createBandCanvas(0, skyBandHeight);
        const wallCanvas = createBandCanvas(skyBandHeight, wallBandHeight);
        const groundCanvas = createBandCanvas(skyBandHeight + wallBandHeight, groundBandHeight);

        function toTexture(canvas) {
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        }

        const skyTex = toTexture(skyCanvas);
        const wallTex = toTexture(wallCanvas);
        const groundTex = toTexture(groundCanvas);

        const splitCanvases = { sky: skyCanvas, wall: wallCanvas, ground: groundCanvas };
        const splitTextures = { sky: skyTex, wall: wallTex, ground: groundTex };

        const geometry = new THREE.BoxGeometry(500, 500, 500);
        // Three.js BoxGeometry material order: 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z
        const materials = [
            new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, toneMapped: false }),  // +X right
            new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, toneMapped: false }),  // -X left
            new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, toneMapped: false }),   // +Y top
            new THREE.MeshBasicMaterial({ map: groundTex, side: THREE.BackSide, toneMapped: false }), // -Y bottom
            new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, toneMapped: false }),  // +Z front
            new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, toneMapped: false }),   // -Z back
        ];

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.renderOrder = -1;
        mesh.userData.splitCanvases = splitCanvases;
        mesh.userData.splitTextures = splitTextures;
        return mesh;
    }

    function createSkyboxByMode(image, mode) {
        if (mode === 'split') {
            return createSplitSkyboxMesh(image);
        }
        return createSkyboxMesh(image);
    }

    function clearSkybox() {
        if (sceneState.skyboxMesh) {
            scene.remove(sceneState.skyboxMesh);
            sceneState.skyboxMesh.geometry.dispose();
            // Handle materials (sphere mode has 1, split mode has 6)
            const materials = Array.isArray(sceneState.skyboxMesh.material)
                ? sceneState.skyboxMesh.material
                : [sceneState.skyboxMesh.material];
            materials.forEach((mat) => {
                if (mat.map) mat.map.dispose();
                mat.dispose();
            });
            // Dispose split-mode textures stored in userData
            if (sceneState.skyboxMesh.userData.splitTextures) {
                const st = sceneState.skyboxMesh.userData.splitTextures;
                if (st.sky) st.sky.dispose();
                if (st.wall) st.wall.dispose();
                if (st.ground) st.ground.dispose();
            }
            sceneState.skyboxMesh = null;
        }
        if (sceneState.skyboxUrl) {
            URL.revokeObjectURL(sceneState.skyboxUrl);
            sceneState.skyboxUrl = null;
        }
        sceneState.skyboxTexture = null;
    }

    function loadSkyboxFromZip(zipBlobUrls) {
        clearSkybox();
        const urls = findSkyboxUrls(zipBlobUrls);
        if (!urls) return;

        beginAssetLoad();
        const imageLoader = new THREE.ImageLoader();
        imageLoader.load(urls, (image) => {
            const mesh = createSkyboxByMode(image, sceneState.skyboxMode);
            sceneState.skyboxMesh = mesh;
            sceneState.skyboxTexture = image;
            sceneState.skyboxOriginalImage = image;
            scene.add(mesh);
            applyMainSceneMode();
            requestExportPreview();
            completeAssetLoad();
        }, undefined, () => {
            hooks.onStatusMessage?.('天空盒加载失败。', 'error');
            completeAssetLoad();
        });
    }

    function loadSkyboxFromFiles(files) {
        clearSkybox();
        if (!files || files.length !== 1) return;

        const blobUrl = URL.createObjectURL(files[0]);
        beginAssetLoad();
        const imageLoader = new THREE.ImageLoader();
        imageLoader.load(blobUrl, (image) => {
            const mesh = createSkyboxByMode(image, sceneState.skyboxMode);
            sceneState.skyboxMesh = mesh;
            sceneState.skyboxTexture = image;
            sceneState.skyboxUrl = blobUrl;
            sceneState.skyboxOriginalImage = image;
            scene.add(mesh);
            applyMainSceneMode();
            requestExportPreview();
            completeAssetLoad();
        }, undefined, () => {
            URL.revokeObjectURL(blobUrl);
            hooks.onStatusMessage?.('天空盒加载失败。', 'error');
            completeAssetLoad();
        });
    }

    function rebuildSplitSkybox() {
        if (!sceneState.skyboxOriginalImage || sceneState.skyboxMode !== 'split') return;
        if (!sceneState.skyboxMesh) return;

        scene.remove(sceneState.skyboxMesh);
        sceneState.skyboxMesh.geometry.dispose();
        const materials = Array.isArray(sceneState.skyboxMesh.material)
            ? sceneState.skyboxMesh.material
            : [sceneState.skyboxMesh.material];
        materials.forEach((mat) => {
            if (mat.map) mat.map.dispose();
            mat.dispose();
        });
        if (sceneState.skyboxMesh.userData.splitTextures) {
            const st = sceneState.skyboxMesh.userData.splitTextures;
            if (st.sky) st.sky.dispose();
            if (st.wall) st.wall.dispose();
            if (st.ground) st.ground.dispose();
        }

        const mesh = createSplitSkyboxMesh(sceneState.skyboxOriginalImage);
        sceneState.skyboxMesh = mesh;
        scene.add(mesh);
        applyMainSceneMode();
        requestExportPreview();
    }

    function resetSkybox() {
        sceneState.skyboxOriginalImage = null;
        clearSkybox();
        applyMainSceneMode();
        requestExportPreview();
    }

    function applyTransform(threeObject, data) {
        threeObject.position.copy(arToSceneVector3(data.position.x, data.position.y, data.position.z));
        threeObject.rotation.set(
            THREE.MathUtils.degToRad(data.rotation.x),
            THREE.MathUtils.degToRad(data.rotation.y + 180),
            THREE.MathUtils.degToRad(data.rotation.z)
        );
        threeObject.scale.set(data.scale.x, data.scale.y, data.scale.z);
    }

    function createCheckboxUI(key) {
        const layersDiv = document.getElementById('dynamic-layers');
        const label = document.createElement('label');
        label.className = 'control-item';
        label.style.color = `#${getUniqueModelColor(key).toString(16).padStart(6, '0')}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        
        // Hide checkpoints by default to keep the viewport clean
        const defaultChecked = (key !== '区域检查点 (checkpoint)');
        checkbox.checked = defaultChecked;
        checkbox.id = layerIdForKey(key);
        
        checkbox.addEventListener('change', () => {
            if (sceneState.dynamicGroups[key]) {
                sceneState.dynamicGroups[key].visible = checkbox.checked;
            }
            applyMainSceneMode();
            requestExportPreview();
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(key));
        layersDiv.appendChild(label);

        // Synchronize the dynamic group's visibility with the default checked state
        if (sceneState.dynamicGroups[key]) {
            sceneState.dynamicGroups[key].visible = defaultChecked;
        }
    }

    function createPlaceholder(obj, colorValue, isWireframe, targetGroup, semanticKey, semanticName, instanceBaseName) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
            color: colorValue,
            wireframe: isWireframe,
            transparent: true,
            opacity: isWireframe ? 0.4 : 0.8
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.originalMaterial = material;
        mesh.userData.appearLaps = obj.appearLaps || [];
        applyTransform(mesh, obj);
        targetGroup.add(mesh);
        registerExportObject(mesh, {
            semanticKey,
            semanticName,
            instanceBaseName,
            groupKey: targetGroup.userData.groupKey
        });
        return mesh;
    }

    function setupAnimation(threeObject, data) {
        if (data.moveType === 'PingPong' && data.movePoints && data.movePoints.length > 0) {
            const waypoints = data.movePoints.map((pt) => arToSceneVector3(pt.x, pt.y, pt.z));
            sceneState.movingObjects.push({
                mesh: threeObject,
                points: waypoints,
                speed: data.speed || 0.2,
                currentTargetIndex: 0,
                isForward: true
            });
        }
    }

    function getSemanticAliasFromGroupKey(key, obj) {
        if (key === MAP_KEY) {
            return {
                semanticKey: 'road',
                semanticName: 'road',
                instanceBaseName: 'road'
            };
        }

        if (key === '区域检查点 (checkpoint)') {
            return {
                semanticKey: 'checkpoint',
                semanticName: 'checkpoint',
                instanceBaseName: 'checkpoint'
            };
        }

        const modelName = (obj?.name || key || '').toLowerCase();
        if (modelName === 'model.glb') {
            return {
                semanticKey: 'man',
                semanticName: 'man',
                instanceBaseName: 'man'
            };
        }

        if (modelName === 'car.glb') {
            return {
                semanticKey: 'car',
                semanticName: 'car',
                instanceBaseName: 'car'
            };
        }

        if (modelName === 'coin.glb') {
            return {
                semanticKey: 'coin',
                semanticName: 'coin',
                instanceBaseName: 'coin'
            };
        }

        const normalized = slugifyName(key || obj?.name || obj?.type || 'object');
        return {
            semanticKey: normalized,
            semanticName: normalized,
            instanceBaseName: normalized
        };
    }

    function getObjectSemanticInfo(obj, key) {
        return getSemanticAliasFromGroupKey(key, obj);
    }

    function renderSceneObjects(objects) {
        objects.forEach((obj) => {
            let key = obj.name;
            if (obj.type === 'checkpoint') key = '区域检查点 (checkpoint)';
            else if (!key) key = obj.type || '未知组件';

            if (!sceneState.dynamicGroups[key]) {
                sceneState.dynamicGroups[key] = new THREE.Group();
                sceneState.dynamicGroups[key].userData.groupKey = key;
                scene.add(sceneState.dynamicGroups[key]);
                createCheckboxUI(key);
            }

            const targetGroup = sceneState.dynamicGroups[key];
            const semanticInfo = getObjectSemanticInfo(obj, key);

            if (obj.name && obj.name.endsWith('.glb')) {
                beginAssetLoad();
                const modelPath = `./models/${obj.name}`;
                gltfLoader.load(modelPath, (gltf) => {
                    const model = gltf.scene;
                    model.userData.appearLaps = obj.appearLaps || [];
                    applyTransform(model, obj);
                    model.traverse((child) => {
                        if (child.isMesh) {
                            child.userData.originalMaterial = child.material;
                        }
                    });
                    targetGroup.add(model);
                    registerExportObject(model, {
                        semanticKey: semanticInfo.semanticKey,
                        semanticName: semanticInfo.semanticName,
                        instanceBaseName: semanticInfo.instanceBaseName,
                        groupKey: key
                    });
                    setupAnimation(model, obj);
                    requestExportPreview();
                    completeAssetLoad();
                }, undefined, () => {
                    const placeholder = createPlaceholder(
                        obj,
                        0xff5555,
                        false,
                        targetGroup,
                        semanticInfo.semanticKey,
                        semanticInfo.semanticName,
                        semanticInfo.instanceBaseName
                    );
                    setupAnimation(placeholder, obj);
                    requestExportPreview();
                    completeAssetLoad();
                });
            } else {
                const isWireframe = obj.type === 'checkpoint';
                createPlaceholder(
                    obj,
                    isWireframe ? 0x00ff00 : 0x3388ff,
                    isWireframe,
                    targetGroup,
                    semanticInfo.semanticKey,
                    semanticInfo.semanticName,
                    semanticInfo.instanceBaseName
                );
            }
        });

        requestExportPreview();
    }

    function loadResources(zipBlobUrls = null, customObjectsData = null) {
        appState.zipBlobUrls = zipBlobUrls;

        // Clear existing dynamic groups from Three.js scene and dispose resources
        if (sceneState.dynamicGroups) {
            Object.values(sceneState.dynamicGroups).forEach((group) => {
                scene.remove(group);
                group.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach((mat) => mat.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                    }
                });
            });
        }

        // Reset registries & state counters
        sceneState.dynamicGroups = {};
        sceneState.modelColorMap = {};
        sceneState.colorCounter = 0;
        sceneState.nextSemanticId = 1;
        sceneState.nextInstanceId = 1;
        sceneState.semanticRegistry.clear();
        sceneState.instanceRegistry.clear();
        sceneState.movingObjects = [];
        sceneState.resourcesReady = false;
        sceneState.pendingAssetLoads = 0;
        sceneState.currentLapFilter = 'all';
        sceneState.lapCourse = null;
        clearSkybox();

        // Reset UI filter dropdown value to default 'all'
        const lapFilterEl = document.getElementById('param-lap-filter');
        if (lapFilterEl) {
            lapFilterEl.value = 'all';
        }

        // Clear UI sidebar layer checkboxes
        const layersDiv = document.getElementById('dynamic-layers');
        if (layersDiv) layersDiv.innerHTML = '';

        sceneState.dynamicGroups[MAP_KEY] = new THREE.Group();
        sceneState.dynamicGroups[MAP_KEY].userData.groupKey = MAP_KEY;
        scene.add(sceneState.dynamicGroups[MAP_KEY]);
        createCheckboxUI(MAP_KEY);

        const textureLoader = new THREE.TextureLoader();
        const gltfLoader = new GLTFLoader();

        if (zipBlobUrls) {
            loadSkyboxFromZip(zipBlobUrls);
        }

        beginAssetLoad();
        const mapPath = resolveZipBlobUrl(zipBlobUrls, 'map.png', 'models/map.png')
            || appState.defaultMapBlobUrl
            || './map.png';
        sceneState.originalMapPath = mapPath;
        textureLoader.load(mapPath, (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.x = -1;
            texture.repeat.y = -1;
            texture.offset.x = 1;
            texture.offset.y = 1;
            texture.needsUpdate = true;

            const planeGeometry = new THREE.PlaneGeometry(1, 1);
            sceneState.originalMapMaterial = new THREE.MeshStandardMaterial({
                map: texture,
                side: THREE.DoubleSide,
                roughness: 0.8,
                transparent: true,
                depthWrite: true
            });

            sceneState.loadedImageElement = texture.image;
            buildMapArrowComponentData();
            updateMaskTexture(parseFloat(document.getElementById('param-blur').value));

            sceneState.maskTexture = new THREE.CanvasTexture(sceneState.mapCanvasElement);
            sceneState.maskTexture.minFilter = THREE.LinearFilter;
            sceneState.maskTexture.magFilter = THREE.LinearFilter;
            sceneState.maskTexture.generateMipmaps = false;
            // Treat the canvas texture as raw linear data - no colour-space conversion.
            // The mask values are plain floats (0.0-1.0 brightness), not sRGB colours.
            if (THREE.NoColorSpace !== undefined) {
                sceneState.maskTexture.colorSpace = THREE.NoColorSpace;
            } else if (THREE.LinearEncoding !== undefined) {
                sceneState.maskTexture.encoding = THREE.LinearEncoding;
            }
            antialiasedTrackShader.uniforms.uTexture.value = sceneState.maskTexture;
            syncTrackMaskMaterial(antialiasedTrackShader);

            sceneState.groundMesh = new THREE.Mesh(planeGeometry, sceneState.originalMapMaterial);
            sceneState.groundMesh.rotation.x = -Math.PI / 2;
            sceneState.dynamicGroups[MAP_KEY].add(sceneState.groundMesh);
            sceneState.trackRecord = registerExportObject(sceneState.groundMesh, {
                semanticKey: 'road',
                semanticName: 'road',
                instanceBaseName: 'road',
                groupKey: MAP_KEY
            });
            updateGroundTransform();
            applyMainSceneMode();
            completeAssetLoad();
        }, undefined, () => {
            hooks.onStatusMessage?.('map.png 加载失败。', 'error');
            completeAssetLoad();
        });

        beginAssetLoad();
        if (customObjectsData) {
            const objects = customObjectsData.objects || [];
            sceneState.lapCourse = extractLapCourseFromObjects(objects);
            renderSceneObjects(objects, gltfLoader);
            completeAssetLoad();
        } else {
            fetch('./objects.json')
                .then((response) => {
                    if (!response.ok) throw new Error('objects.json 读取失败');
                    return response.json();
                })
                .then((data) => {
                    const objects = data.objects || [];
                    sceneState.lapCourse = extractLapCourseFromObjects(objects);
                    renderSceneObjects(objects, gltfLoader);
                    completeAssetLoad();
                })
                .catch((error) => {
                    hooks.onStatusMessage?.(`场景配置加载失败：${error.message}`, 'error');
                    completeAssetLoad();
                });
        }
    }

    function renderSceneObjects(objects, externalLoader) {
        const gltfLoader = externalLoader || new GLTFLoader();
        objects.forEach((obj) => {
            let key = obj.name;
            if (obj.type === 'checkpoint') key = '区域检查点 (checkpoint)';
            else if (!key) key = obj.type || '未知组件';

            if (!sceneState.dynamicGroups[key]) {
                sceneState.dynamicGroups[key] = new THREE.Group();
                sceneState.dynamicGroups[key].userData.groupKey = key;
                scene.add(sceneState.dynamicGroups[key]);
                createCheckboxUI(key);
            }

            const targetGroup = sceneState.dynamicGroups[key];
            const semanticInfo = getObjectSemanticInfo(obj, key);

            if (obj.name && obj.name.toLowerCase().endsWith('.glb')) {
                beginAssetLoad();
                const modelPath = resolveZipBlobUrl(appState.zipBlobUrls, obj.name, `models/${obj.name}`)
                    || `./models/${obj.name}`;
                gltfLoader.load(modelPath, (gltf) => {
                    const model = gltf.scene;
                    model.userData.appearLaps = obj.appearLaps || [];
                    applyTransform(model, obj);
                    model.traverse((child) => {
                        if (child.isMesh) {
                            child.userData.originalMaterial = child.material;
                        }
                    });
                    targetGroup.add(model);
                    registerExportObject(model, {
                        semanticKey: semanticInfo.semanticKey,
                        semanticName: semanticInfo.semanticName,
                        instanceBaseName: semanticInfo.instanceBaseName,
                        groupKey: key
                    });
                    setupAnimation(model, obj);
                    requestExportPreview();
                    completeAssetLoad();
                }, undefined, () => {
                    const placeholder = createPlaceholder(
                        obj,
                        0xff5555,
                        false,
                        targetGroup,
                        semanticInfo.semanticKey,
                        semanticInfo.semanticName,
                        semanticInfo.instanceBaseName
                    );
                    setupAnimation(placeholder, obj);
                    requestExportPreview();
                    completeAssetLoad();
                });
            } else {
                const isWireframe = obj.type === 'checkpoint';
                createPlaceholder(
                    obj,
                    isWireframe ? 0x00ff00 : 0x3388ff,
                    isWireframe,
                    targetGroup,
                    semanticInfo.semanticKey,
                    semanticInfo.semanticName,
                    semanticInfo.instanceBaseName
                );
            }
        });

        requestExportPreview();
    }

    function animate() {
        requestAnimationFrame(animate);
        const deltaTime = clock.getDelta();

        sceneState.movingObjects.forEach((obj) => {
            const currentPos = obj.mesh.position;
            const targetPos = obj.points[obj.currentTargetIndex];
            const direction = new THREE.Vector3().subVectors(targetPos, currentPos);
            const distanceToTarget = direction.length();
            const moveStep = obj.speed * deltaTime;

            if (moveStep >= distanceToTarget) {
                currentPos.copy(targetPos);
                if (obj.isForward) {
                    if (obj.currentTargetIndex < obj.points.length - 1) obj.currentTargetIndex++;
                    else {
                        obj.isForward = false;
                        obj.currentTargetIndex--;
                    }
                } else {
                    if (obj.currentTargetIndex > 0) obj.currentTargetIndex--;
                    else {
                        obj.isForward = true;
                        obj.currentTargetIndex++;
                    }
                }
            } else {
                direction.normalize();
                currentPos.addScaledVector(direction, moveStep);
            }
        });

        // WASD keyboard movement in camera's horizontal plane
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const moveDistance = MOVE_SPEED * deltaTime;
        const delta = new THREE.Vector3();
        if (keys['KeyW']) delta.addScaledVector(forward, moveDistance);
        if (keys['KeyS']) delta.addScaledVector(forward, -moveDistance);
        if (keys['KeyD']) delta.addScaledVector(right, moveDistance);
        if (keys['KeyA']) delta.addScaledVector(right, -moveDistance);
        if (keys['Space']) delta.y += moveDistance;
        if (keys['ShiftLeft'] || keys['ShiftRight']) delta.y -= moveDistance;
        if (delta.lengthSq() > 0) {
            camera.position.add(delta);
            controls.target.add(delta);
        }

        controls.update();
        renderer.render(scene, camera);
    }

    function onResize() {
        resizeMainRenderer();
        resizePreviewRenderer();
        requestExportPreview();
    }

    function getSceneApi() {
        return {
            scene,
            camera,
            controls,
            renderer,
            previewRenderer,
            exportRenderer,
            exportCamera,
            antialiasedTrackShader,
            applyMainSceneMode,
            applySceneVariant,
            renderSceneVariant,
            renderObjectDetectionIdVariant,
            renderSingleInstanceMaskVariant,
            renderMapArrowIdVariant,
            renderExportPreview,
            requestExportPreview,
            resizeMainRenderer,
            resizePreviewRenderer,
            syncExportCameraFromState,
            updateMaskTexture,
            updateGroundTransform,
            updateGroundMapTexture,
            syncMaskControls,
            loadResources,
            animate,
            onResize,
            getBasicMaterial,
            getTrackMaskMaterial,
            syncTrackMaskMaterial,
            isGroupEnabled,
            isSemanticEnabledForExport,
            encodeIdHex,
            encodeDetectionHex,
            updateObjectVisibilityByLap,
            loadSkyboxFromFiles,
            resetSkybox,
            rebuildSplitSkybox,
            toggleGridVisibility: (visible) => {
                sceneState.gridVisible = visible;
                if (sceneState.isMaskMode) {
                    gridHelper.visible = false;
                } else {
                    gridHelper.visible = visible;
                }
            }
        };
    }

    return getSceneApi();
}
