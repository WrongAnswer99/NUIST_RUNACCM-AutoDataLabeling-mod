import * as THREE from 'three';
import { arToSceneVector3 } from './state.js';

function parsePoseLine(line) {
    const match = line.match(/^\[(.+?)\]\s+x_mm=([-+]?\d*\.?\d+)\s+y_mm=([-+]?\d*\.?\d+)\s+yaw_deg=([-+]?\d*\.?\d+)/);
    if (!match) return null;
    const [, timestamp, xMm, yMm, yawDeg] = match;
    return {
        timestamp,
        xMm: Number(xMm),
        yMm: Number(yMm),
        yawDeg: Number(yawDeg),
        xMeters: Number(yMm) / 1000,
        zMeters: Number(xMm) / 1000
    };
}

function normalizeDegrees(degrees) {
    let value = degrees;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
}

function mapPoseYawToSceneYawDeg(yawDeg) {
    return normalizeDegrees(-yawDeg);
}

function computeLapsForFrames(frames) {
    if (!frames || frames.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    frames.forEach((f) => {
        if (f.xMeters < minX) minX = f.xMeters;
        if (f.xMeters > maxX) maxX = f.xMeters;
        if (f.zMeters < minZ) minZ = f.zMeters;
        if (f.zMeters > maxZ) maxZ = f.zMeters;
    });

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    let totalAngle = 0;
    let lastAngle = Math.atan2(frames[0].zMeters - cz, frames[0].xMeters - cx);

    frames[0].lap = 0;

    for (let i = 1; i < frames.length; i++) {
        const frame = frames[i];
        const angle = Math.atan2(frame.zMeters - cz, frame.xMeters - cx);
        let diff = angle - lastAngle;

        if (diff > Math.PI) {
            diff -= 2 * Math.PI;
        } else if (diff < -Math.PI) {
            diff += 2 * Math.PI;
        }

        totalAngle += diff;
        lastAngle = angle;

        const lapFloat = Math.abs(totalAngle) / (2 * Math.PI);
        frame.lap = Math.floor(lapFloat);
    }
}

export function createPoseTrackModule(appState, sceneApi, uiApi) {
    const { scene: sceneState, exportState, poseTrack } = appState;

    function setMarkerVisible(visible) {
        if (poseTrack.marker) {
            poseTrack.marker.visible = visible;
        }
    }

    function ensureMarker() {
        if (poseTrack.marker) return poseTrack.marker;
        const geometry = new THREE.SphereGeometry(0.05, 24, 24);
        const material = new THREE.MeshBasicMaterial({ color: 0xff3333 });
        const marker = new THREE.Mesh(geometry, material);
        marker.visible = false;
        sceneApi.scene.add(marker);
        poseTrack.marker = marker;
        return marker;
    }

    function applyFrame(index) {
        const frame = poseTrack.frames[index];
        if (!frame) return;

        poseTrack.currentIndex = index;

        const marker = ensureMarker();
        marker.position.copy(arToSceneVector3(frame.xMeters, 0.03, frame.zMeters));
        marker.visible = true;

        exportState.camera.position.copy(
            arToSceneVector3(frame.xMeters, exportState.camera.position.y, frame.zMeters)
        );
        
        // Force the camera pitch (Euler X) and roll (Euler Z) to standard track-following values
        // (0 and 0 degrees) so that the follow perspective points level and in the direction
        // of travel, aligning perfectly with the vehicle's motion vector.
        exportState.camera.rotation.x = 0;
        exportState.camera.rotation.y = mapPoseYawToSceneYawDeg(frame.yawDeg);
        exportState.camera.rotation.z = 0;

        // Update lap filter dropdown and visibility automatically based on current frame lap
        if (frame.lap !== undefined) {
            const lapSelect = document.getElementById('param-lap-filter');
            if (lapSelect) {
                lapSelect.value = String(frame.lap);
            }
            sceneApi.updateObjectVisibilityByLap(String(frame.lap));
        }

        uiApi.syncExportFormFromState();
        uiApi.updatePoseTrackUI();
        sceneApi.requestExportPreview();
    }

    function loadFramesFromText(fileName, text) {
        const frames = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map(parsePoseLine)
            .filter(Boolean);

        if (!frames.length) {
            throw new Error('轨迹文件中没有可解析的位姿数据');
        }

        computeLapsForFrames(frames); // Detect laps on import

        poseTrack.fileName = fileName;
        poseTrack.frames = frames;
        poseTrack.currentIndex = 0;
        poseTrack.loaded = true;

        applyFrame(0);
    }

    function clearTrack() {
        poseTrack.fileName = '';
        poseTrack.frames = [];
        poseTrack.currentIndex = 0;
        poseTrack.loaded = false;
        setMarkerVisible(false);

        const lapSelect = document.getElementById('param-lap-filter');
        if (lapSelect) {
            lapSelect.value = 'all';
        }
        sceneApi.updateObjectVisibilityByLap('all');

        // Reset camera back to homepage default view
        const defaults = appState.defaults;
        exportState.camera.position.copy(defaults.defaultExportCameraState.position);
        exportState.camera.rotation.copy(defaults.defaultExportCameraState.rotation);
        exportState.camera.fov = defaults.defaultExportCameraState.fov;

        uiApi.syncExportFormFromState();
        uiApi.updatePoseTrackUI();
        sceneApi.requestExportPreview();
    }

    return {
        applyFrame,
        loadFramesFromText,
        clearTrack
    };
}
