import * as THREE from 'three';
import { MAP_KEY, sceneToArVector3 } from './state.js';
import {
    sanitizeSampleName,
    buildTrajectoryFrameSampleName,
    buildTrajectoryManifest,
    createCocoAnnotation,
    createCocoImage,
    createCocoCategory,
    extractBoundingBoxFromMask,
    clampBoundingBoxToImage,
    toCocoBboxArray,
    isValidBoundingBox,
    filterEnabledDetections,
    formatDetectionPreviewBox
} from './export-helpers.js';

export function createExportModule(appState, sceneApi, statusApi) {
    const { scene: sceneState, exportState, poseTrack } = appState;

    function isObjectVisible(object3d) {
        let current = object3d;
        while (current && current !== sceneApi.scene) {
            if (!current.visible) return false;
            current = current.parent;
        }
        return true;
    }



    async function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('PNG 编码失败'));
            }, 'image/png');
        });
    }

    function serializeLabels(sampleName = exportState.sampleName) {
        const semantics = [
            { id: 0, name: 'background', colorHex: '#000000' },
            ...[...sceneState.semanticRegistry.values()]
                .sort((a, b) => a.id - b.id)
                .filter((entry) => entry.enabled !== false)
                .map((entry) => ({
                    id: entry.id,
                    key: entry.key,
                    name: entry.name,
                    colorHex: `#${entry.exportHex.toString(16).padStart(6, '0')}`
                }))
        ];

        const instances = [...sceneState.instanceRegistry.values()]
            .sort((a, b) => a.id - b.id)
            .filter((entry) => sceneState.semanticRegistry.get(entry.semanticKey)?.enabled !== false)
            .filter((entry) => isObjectVisible(entry.rootObject))
            .map((entry) => ({
                id: entry.id,
                name: entry.name,
                semanticId: entry.semanticId,
                semanticName: sceneState.semanticRegistry.get(entry.semanticKey)?.name || entry.semanticKey,
                colorHex: `#${entry.exportHex.toString(16).padStart(6, '0')}`
            }));

        return {
            sampleName: sanitizeSampleName(sampleName),
            semantics,
            instances
        };
    }

    function serializeCamera(cameraState = exportState.camera) {
        const arCameraPosition = sceneToArVector3(cameraState.position);
        return {
            position: {
                x: Number(arCameraPosition.x.toFixed(6)),
                y: Number(arCameraPosition.y.toFixed(6)),
                z: Number(arCameraPosition.z.toFixed(6))
            },
            rotationEulerDegrees: {
                x: Number(cameraState.rotation.x.toFixed(6)),
                y: Number(cameraState.rotation.y.toFixed(6)),
                z: Number(cameraState.rotation.z.toFixed(6))
            },
            fov: Number(cameraState.fov.toFixed(4)),
            width: exportState.resolution.width,
            height: exportState.resolution.height,
            aspectPreset: exportState.resolution.aspectPreset
        };
    }

    function serializeLabelmeJson(sampleName, width, height, forExport = true) {
        const { objectDetections } = buildVisibleDetectionData(forExport);
        const enabledCategories = buildEnabledCategorySet();

        const shapes = objectDetections
            .filter((entry) => enabledCategories.has(entry.semanticKey))
            .map((entry) => {
                const x1 = entry.bbox.x;
                const y1 = entry.bbox.y;
                const x2 = entry.bbox.x + entry.bbox.width;
                const y2 = entry.bbox.y + entry.bbox.height;
                const label = entry.categoryName;

                return {
                    label: label,
                    points: [
                        [x1, y1],
                        [x2, y2]
                    ],
                    group_id: null,
                    description: "",
                    shape_type: "rectangle",
                    flags: {},
                    score: null
                };
            });

        return {
            version: "5.0.1",
            flags: {},
            shapes,
            imagePath: `${sampleName}_rgb.png`,
            imageData: null,
            imageHeight: height,
            imageWidth: width
        };
    }

    async function renderBlobForVariant(variant) {
        sceneApi.renderSceneVariant(
            sceneApi.exportRenderer,
            variant,
            exportState.resolution.width,
            exportState.resolution.height,
            variant !== 'rgb'
        );
        return canvasToBlob(sceneApi.exportRenderer.domElement);
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function cloneCameraState(cameraState = exportState.camera) {
        return {
            position: cameraState.position.clone(),
            rotation: cameraState.rotation.clone(),
            fov: cameraState.fov
        };
    }

    function restoreCameraState(cameraState) {
        exportState.camera.position.copy(cameraState.position);
        exportState.camera.rotation.copy(cameraState.rotation);
        exportState.camera.fov = cameraState.fov;
    }

    function buildAnnotationCategories() {
        const categories = [];
        const categoryIds = new Map();
        let nextCategoryId = 1;

        [...sceneState.semanticRegistry.values()]
            .sort((a, b) => a.id - b.id)
            .filter((entry) => entry.enabled !== false)
            .forEach((entry) => {
                if (entry.key === 'road') return;
                if (categoryIds.has(entry.key)) return;
                categoryIds.set(entry.key, nextCategoryId);
                categories.push(createCocoCategory({
                    id: nextCategoryId,
                    name: entry.name || entry.key
                }));
                nextCategoryId++;
            });

        return { categories, categoryIds };
    }

    function buildEnabledCategorySet() {
        const enabledCategories = new Set(
            [...sceneState.semanticRegistry.values()]
                .filter((entry) => entry.enabled !== false)
                .map((entry) => entry.key)
        );
        return enabledCategories;
    }

    function renderVariantImageData(variant, forExport = true) {
        sceneApi.renderSceneVariant(
            sceneApi.exportRenderer,
            variant,
            exportState.resolution.width,
            exportState.resolution.height,
            forExport
        );
        const canvas = document.createElement('canvas');
        canvas.width = exportState.resolution.width;
        canvas.height = exportState.resolution.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(sceneApi.exportRenderer.domElement, 0, 0, canvas.width, canvas.height);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    function maskFromImageDataByHex(imageData, hex) {
        const width = imageData.width;
        const height = imageData.height;
        const mask = new Uint8Array(width * height);
        const targetR = (hex >> 16) & 0xff;
        const targetG = (hex >> 8) & 0xff;
        const targetB = hex & 0xff;

        for (let i = 0; i < mask.length; i++) {
            const offset = i * 4;
            mask[i] = (
                imageData.data[offset] === targetR
                && imageData.data[offset + 1] === targetG
                && imageData.data[offset + 2] === targetB
            ) ? 1 : 0;
        }

        return { mask, width, height };
    }

    function bboxFromMask(maskInfo) {
        const bbox = extractBoundingBoxFromMask(maskInfo.mask, maskInfo.width, maskInfo.height);
        if (!bbox) return null;
        const clamped = clampBoundingBoxToImage(bbox, maskInfo.width, maskInfo.height);
        return isValidBoundingBox(clamped) ? clamped : null;
    }

    function buildVisibleDetectionData(forExport = false) {
        const width = exportState.resolution.width;
        const height = exportState.resolution.height;

        // 1. Render the 'instance' variant of the scene and get image data
        const imageData = renderVariantImageData('instance', forExport);

        // 2. Map colors to instance entries and initialize bounding boxes
        const colorMap = new Map();
        const bboxes = new Map();

        const visibleEntries = [...sceneState.instanceRegistry.values()]
            .sort((a, b) => a.id - b.id)
            .filter((entry) => sceneState.semanticRegistry.get(entry.semanticKey)?.enabled !== false)
            .filter((entry) => entry.semanticKey !== 'road')
            .filter((entry) => entry.semanticKey !== 'road_arrow')
            .filter((entry) => isObjectVisible(entry.rootObject));

        visibleEntries.forEach((entry) => {
            const hex = forExport ? entry.exportHex : entry.previewHex;
            const r = (hex >> 16) & 0xff;
            const g = (hex >> 8) & 0xff;
            const b = hex & 0xff;
            const key = (r << 16) | (g << 8) | b;
            colorMap.set(key, entry);
            bboxes.set(entry.id, {
                minX: Infinity,
                maxX: -Infinity,
                minY: Infinity,
                maxY: -Infinity
            });
        });

        // 3. Sweep the pixels to find boundaries of actual rendered colors
        const pixels = imageData.data;
        const totalPixels = width * height;
        let x = 0;
        let y = 0;
        for (let i = 0; i < totalPixels; i++) {
            const offset = i * 4;
            const r = pixels[offset];
            const g = pixels[offset + 1];
            const b = pixels[offset + 2];

            // Skip black background
            if (r !== 0 || g !== 0 || b !== 0) {
                const key = (r << 16) | (g << 8) | b;
                const entry = colorMap.get(key);
                if (entry) {
                    const box = bboxes.get(entry.id);
                    if (x < box.minX) box.minX = x;
                    if (x > box.maxX) box.maxX = x;
                    if (y < box.minY) box.minY = y;
                    if (y > box.maxY) box.maxY = y;
                }
            }

            x++;
            if (x === width) {
                x = 0;
                y++;
            }
        }

        // 4. Collect visible bounding boxes
        const objectDetections = [];
        visibleEntries.forEach((entry) => {
            const box = bboxes.get(entry.id);
            if (box.minX <= box.maxX && box.minY <= box.maxY) {
                const w = box.maxX - box.minX + 1;
                const h = box.maxY - box.minY + 1;
                if (w > 2 && h > 2) {
                    objectDetections.push({
                        kind: 'object',
                        categoryName: entry.semanticKey,
                        instanceName: entry.name,
                        semanticKey: entry.semanticKey,
                        bbox: {
                            x: box.minX,
                            y: box.minY,
                            width: w,
                            height: h
                        },
                        color: `#${entry.previewHex.toString(16).padStart(6, '0')}`
                    });
                }
            }
        });

        return {
            objectDetections,
            mapDetections: []
        };
    }

    function buildTrajectoryFrameDetections() {
        const { objectDetections, mapDetections } = buildVisibleDetectionData(true);
        const detections = [
            ...objectDetections.map((entry) => ({
                categoryName: entry.categoryName,
                bbox: toCocoBboxArray(entry.bbox),
                color: entry.color
            })),
            ...mapDetections.map((entry) => formatDetectionPreviewBox({
                categoryName: 'road_arrow',
                bbox: toCocoBboxArray(entry.bbox),
                color: '#ff9f1a'
            }))
        ];
        return filterEnabledDetections(detections, buildEnabledCategorySet());
    }

    function collectObjectDetections(imageId, categoryIds, annotationIdRef, objectDetections) {
        return objectDetections.map((entry) => createCocoAnnotation({
            id: annotationIdRef.value++,
            imageId,
            categoryId: categoryIds.get(entry.semanticKey),
            bbox: toCocoBboxArray(entry.bbox),
            area: Number((entry.bbox.width * entry.bbox.height).toFixed(4)),
            extra: {
                instance_name: entry.instanceName,
                semantic_key: entry.semanticKey
            }
        }));
    }

    function createBinaryMaskFromCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const mask = new Uint8Array(canvas.width * canvas.height);

        for (let i = 0; i < mask.length; i++) {
            mask[i] = imageData[i * 4] > 127 ? 1 : 0;
        }

        return mask;
    }

    function buildFrameCocoAnnotations(imageId, categoryIds, annotationIdRef) {
        const { objectDetections, mapDetections } = buildVisibleDetectionData(true);
        const objectAnnotations = collectObjectDetections(imageId, categoryIds, annotationIdRef, objectDetections);
        return objectAnnotations;
    }

    function getDetectionPreviewData() {
        return buildTrajectoryFrameDetections();
    }

    async function renderCurrentFrameArtifacts(sampleName) {
        const mode = exportState.previewMode || 'rgb';
        const rgbBlob = await renderBlobForVariant('rgb');
        let semanticBlob = null;
        let semanticRoadCoveredBlob = null;
        let instanceBlob = null;
        let labelmeJsonObj = null;
        let labelsJson = null;

        if (mode === 'semantic') {
            semanticBlob = await renderBlobForVariant('semantic');
        } else if (mode === 'semantic_road_covered') {
            semanticRoadCoveredBlob = await renderBlobForVariant('semantic_road_covered');
        } else if (mode === 'instance') {
            instanceBlob = await renderBlobForVariant('instance');
        } else if (mode === 'detections') {
            labelmeJsonObj = serializeLabelmeJson(sampleName, exportState.resolution.width, exportState.resolution.height, true);
            labelsJson = JSON.stringify(serializeLabels(sampleName), null, 2);
        }

        return {
            sampleName,
            rgbBlob,
            semanticBlob,
            semanticRoadCoveredBlob,
            instanceBlob,
            labelsJson,
            cameraJson: JSON.stringify(serializeCamera(), null, 2),
            labelmeJson: labelmeJsonObj ? JSON.stringify(labelmeJsonObj, null, 2) : null
        };
    }

    function writeFrameArtifactsToZip(zip, artifacts) {
        const mode = exportState.previewMode || 'rgb';
        
        // Export RGB image and camera info in all modes
        zip.file(`images/${artifacts.sampleName}_rgb.png`, artifacts.rgbBlob);
        zip.file(`metadata/${artifacts.sampleName}_camera.json`, artifacts.cameraJson);

        if (mode === 'semantic' && artifacts.semanticBlob) {
            zip.file(`masks/${artifacts.sampleName}_semantic_mask.png`, artifacts.semanticBlob);
        } else if (mode === 'semantic_road_covered' && artifacts.semanticRoadCoveredBlob) {
            zip.file(`masks/${artifacts.sampleName}_semantic_road_covered_mask.png`, artifacts.semanticRoadCoveredBlob);
        } else if (mode === 'instance' && artifacts.instanceBlob) {
            zip.file(`masks/${artifacts.sampleName}_instance_mask.png`, artifacts.instanceBlob);
        } else if (mode === 'detections') {
            if (artifacts.labelsJson) {
                zip.file(`metadata/${artifacts.sampleName}_labels.json`, artifacts.labelsJson);
            }
            if (artifacts.labelmeJson) {
                zip.file(`images/${artifacts.sampleName}_rgb.json`, artifacts.labelmeJson);
            }
        }
    }

    function withExportLock(statusMessage, callback) {
        if (!sceneState.resourcesReady || sceneState.exportInProgress) return null;
        if (!window.JSZip) {
            statusApi.updateStatus('JSZip 未加载，无法导出 ZIP。', 'error');
            return null;
        }

        sceneState.exportInProgress = true;
        statusApi.refreshAvailability();
        statusApi.updateStatus(statusMessage, 'idle');

        return callback().finally(() => {
            sceneState.exportInProgress = false;
            statusApi.refreshAvailability();
            sceneApi.requestExportPreview();
        });
    }

    async function exportSampleZip() {
        return withExportLock('正在导出样本包...', async () => {
            try {
                const sampleName = sanitizeSampleName(exportState.sampleName);
                const artifacts = await renderCurrentFrameArtifacts(sampleName);
                const zip = new window.JSZip();
                writeFrameArtifactsToZip(zip, artifacts);

                const archiveBlob = await zip.generateAsync({ type: 'blob' });
                downloadBlob(archiveBlob, `${sampleName}.zip`);
                statusApi.updateStatus(`导出完成：${sampleName}.zip`, 'success');

                if (exportState.autoIncrementSequence) {
                    const seq = exportState.sampleSequence;
                    const num = parseInt(seq, 10);
                    if (!isNaN(num)) {
                        exportState.sampleSequence = String(num + 1).padStart(seq.length, '0');
                        exportState.sampleName = exportState.samplePrefix + exportState.sampleSequence;
                        statusApi.syncExportForm?.();
                    }
                }
            } catch (error) {
                statusApi.updateStatus(`导出失败：${error.message}`, 'error');
            }
        });
    }

    async function exportTrajectoryZip() {
        if (!poseTrack.loaded || !poseTrack.frames.length) {
            statusApi.updateStatus('请先导入轨迹文件，再执行批量导出。', 'error');
            return;
        }

        return withExportLock('正在导出整段轨迹样本包...', async () => {
            const originalCameraState = cloneCameraState();
            const originalTrackIndex = poseTrack.currentIndex;

            try {
                const baseSampleName = sanitizeSampleName(exportState.sampleName);
                const zip = new window.JSZip();
                const frameEntries = [];
                const mode = exportState.previewMode || 'rgb';

                let cocoCategories = null;
                let cocoCategoryIds = null;
                let cocoImages = [];
                let cocoAnnotations = [];
                const cocoAnnotationIdRef = { value: 1 };

                if (mode === 'detections') {
                    const cocoCatData = buildAnnotationCategories();
                    cocoCategories = cocoCatData.categories;
                    cocoCategoryIds = cocoCatData.categoryIds;
                }

                for (let index = 0; index < poseTrack.frames.length; index++) {
                    poseTrack.api.applyFrame(index);

                    const frame = poseTrack.frames[index];
                    const frameSampleName = buildTrajectoryFrameSampleName(baseSampleName, index, poseTrack.frames.length);
                    const artifacts = await renderCurrentFrameArtifacts(frameSampleName);
                    writeFrameArtifactsToZip(zip, artifacts);

                    if (mode === 'detections') {
                        const imageId = index + 1;
                        const fileName = `images/${frameSampleName}_rgb.png`;
                        cocoImages.push(createCocoImage({
                            id: imageId,
                            fileName,
                            width: exportState.resolution.width,
                            height: exportState.resolution.height,
                            frameIndex: index,
                            timestamp: frame.timestamp
                        }));
                        cocoAnnotations.push(...buildFrameCocoAnnotations(imageId, cocoCategoryIds, cocoAnnotationIdRef));
                    }

                    frameEntries.push({
                        index,
                        timestamp: frame.timestamp,
                        sampleName: frameSampleName,
                        pose: {
                            xMeters: frame.xMeters,
                            zMeters: frame.zMeters,
                            yawDeg: frame.yawDeg
                        }
                    });

                    statusApi.updateStatus(`正在导出轨迹样本 ${index + 1} / ${poseTrack.frames.length}...`, 'idle');
                }

                zip.file(
                    `${baseSampleName}_trajectory.json`,
                    JSON.stringify(buildTrajectoryManifest(baseSampleName, poseTrack, frameEntries), null, 2)
                );

                if (mode === 'detections') {
                    zip.file('annotations.json', JSON.stringify({
                        info: {
                            description: 'Trajectory-rendered COCO detection dataset',
                            sample_name: baseSampleName,
                            source_track_file: poseTrack.fileName || ''
                        },
                        images: cocoImages,
                        annotations: cocoAnnotations,
                        categories: cocoCategories
                    }, null, 2));
                    zip.file('dataset_info.json', JSON.stringify({
                        sampleName: baseSampleName,
                        sourceTrackFile: poseTrack.fileName || '',
                        imageCount: cocoImages.length,
                        annotationCount: cocoAnnotations.length,
                        categoryNames: cocoCategories.map((entry) => entry.name)
                    }, null, 2));
                }

                const archiveBlob = await zip.generateAsync({ type: 'blob' });
                downloadBlob(archiveBlob, `${baseSampleName}_trajectory.zip`);
                statusApi.updateStatus(`导出完成：${baseSampleName}_trajectory.zip`, 'success');
            } catch (error) {
                statusApi.updateStatus(`轨迹导出失败：${error.message}`, 'error');
            } finally {
                restoreCameraState(originalCameraState);
                if (poseTrack.loaded && poseTrack.frames[originalTrackIndex]) {
                    poseTrack.api.applyFrame(originalTrackIndex);
                } else {
                    sceneApi.requestExportPreview();
                }
            }
        });
    }

    return {
        exportSampleZip,
        exportTrajectoryZip,
        getDetectionPreviewData,
        serializeLabels,
        serializeCamera
    };
}
