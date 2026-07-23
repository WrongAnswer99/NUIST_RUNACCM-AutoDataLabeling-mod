import * as THREE from 'three';

export const MASK_DOWNSAMPLE_RATIO = 0.18;
export const MASK_MIN_DOWNSAMPLED_SIZE = 96;
export const MASK_PALETTE = [
    0x00ffcc, 0xff0055, 0x00ff33, 0xffff00, 0xff00ff, 0x00ffff,
    0xff9900, 0xff5500, 0x99ff00, 0x0099ff, 0xcc00ff, 0x66ff66,
    0xffaa00, 0xaaff00, 0x00ffaa, 0x00aaff, 0xaa00ff, 0xff00aa
];

export const MAP_KEY = '地面底图 (map.png)';

export function arToSceneVector3(x, y, z) {
    return new THREE.Vector3(-x, y, z);
}

export function sceneToArVector3(vector) {
    return new THREE.Vector3(-vector.x, vector.y, vector.z);
}

export function computeEulerDegreesFromLookAt(position, target) {
    const tempCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    tempCamera.position.copy(position);
    tempCamera.lookAt(target);
    return new THREE.Vector3(
        THREE.MathUtils.radToDeg(tempCamera.rotation.x),
        THREE.MathUtils.radToDeg(tempCamera.rotation.y),
        THREE.MathUtils.radToDeg(tempCamera.rotation.z)
    );
}

export function computeTargetFromPositionEuler(position, rotationDegrees, distance = 1) {
    const rotationEuler = new THREE.Euler(
        THREE.MathUtils.degToRad(rotationDegrees.x),
        THREE.MathUtils.degToRad(rotationDegrees.y),
        THREE.MathUtils.degToRad(rotationDegrees.z),
        'XYZ'
    );
    return position.clone().add(new THREE.Vector3(0, 0, -distance).applyEuler(rotationEuler));
}

export function createAppState() {
    const defaultExportScenePosition = arToSceneVector3(0.8, 0.3, -0.2);
    const defaultExportEulerDegrees = new THREE.Vector3(-180, 0, -180);

    const defaultMainTarget = computeTargetFromPositionEuler(
        defaultExportScenePosition,
        defaultExportEulerDegrees
    );

    const defaultExportCameraState = {
        position: defaultExportScenePosition,
        rotation: defaultExportEulerDegrees,
        fov: 60
    };

    return {
        defaults: {
            defaultExportCameraState,
            defaultMainTarget,
            previewPresetSizes: {
                '1:1': [1024, 1024],
                '4:3': [640, 480],
                '16:9': [1280, 720],
                '9:16': [720, 1280]
            }
        },
        scene: {
            movingObjects: [],
            dynamicGroups: {},
            modelColorMap: {},
            basicMaterialCache: new Map(),
            mainMaskMaterialCache: new Map(),
            trackMaskMaterialCache: new Map(),
            semanticRegistry: new Map(),
            instanceRegistry: new Map(),
            colorCounter: 0,
            nextSemanticId: 1,
            nextInstanceId: 1,
            isMaskMode: false,
            exportInProgress: false,
            resourcesReady: false,
            pendingAssetLoads: 0,
            previewRenderQueued: false,
            mapCanvasElement: null,
            loadedImageElement: null,
            mapArrowComponents: [],
            mapArrowCanvasElement: null,
            mapArrowTexture: null,
            mapArrowMaterial: null,
            maskTexture: null,
            groundMesh: null,
            originalMapMaterial: null,
            trackRecord: null,
            lapCourse: null
        },
        ui: {
            activeWorkflowPage: 'resources'
        },
        exportState: {
            previewMode: 'rgb',
            sampleName: 'sample_0001',
            annotationPixelThreshold: 20,
            resolution: {
                width: 640,
                height: 480,
                aspectPreset: '4:3'
            },
            camera: {
                position: defaultExportCameraState.position.clone(),
                rotation: defaultExportCameraState.rotation.clone(),
                fov: defaultExportCameraState.fov
            },
            semanticLabels: {}
        },
        poseTrack: {
            fileName: '',
            frames: [],
            currentIndex: 0,
            loaded: false,
            marker: null
        }
    };
}
