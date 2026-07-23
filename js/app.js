import { createAppState } from './state.js';
import { createSceneModule } from './scene.js';
import { createExportModule } from './export.js';
import { createUIModule } from './ui.js';
import { createPoseTrackModule } from './pose-track.js';
import { buildZipBlobUrls, findObjectsJsonEntry } from './zip-import.js';
import { tryLoadDefaultPoseTrack } from './default-track.js';

const mounts = {
    viewportShell: document.getElementById('viewport-shell'),
    viewportCanvasMount: document.getElementById('viewport-canvas'),
    previewMount: document.getElementById('export-preview-mount'),
    previewFrame: document.getElementById('export-preview-frame'),
    previewOverlay: document.getElementById('export-preview-overlay'),
    exportStatusEl: document.getElementById('export-status'),
    exportZipButton: document.getElementById('export-zip-button'),
    exportTrajectoryZipButton: document.getElementById('export-trajectory-zip-button'),
    semanticLabelEditor: document.getElementById('semantic-label-editor'),
    instanceLabelsEl: document.getElementById('instance-labels')
};

const appState = createAppState();

// Preload and cache default map.png from server
fetch('./map.png')
    .then(r => {
        if (!r.ok) throw new Error('Failed to fetch map.png');
        return r.blob();
    })
    .then(blob => {
        appState.defaultMapBlobUrl = URL.createObjectURL(blob);
    })
    .catch(err => {
        console.warn('Preloading default map.png failed, using fallback path:', err);
    });

let uiApi = null;
let defaultPoseTrackAttempted = false;

const sceneApi = createSceneModule(appState, mounts, {
    onSemanticRegistryChanged: () => {
        uiApi?.updateSemanticLabelEditor();
        uiApi?.updateInstanceLabelList();
    },
    onInstanceRegistryChanged: () => {
        uiApi?.updateInstanceLabelList();
    },
    onStatusMessage: (message, state) => {
        uiApi?.updateStatus(message, state);
    },
    onPreviewRendered: (width, height) => {
        uiApi?.renderDetectionOverlay(width, height);
    },
    onResourcesReady: () => {
        uiApi?.updateStatus('场景资源加载完成，可以导出样本包。', 'success');
        uiApi?.refreshAvailability();
        uiApi?.initializeExportUI();
        
        // Hide landing page loader and switch to app interface
        const homeLoading = document.getElementById('home-loading');
        if (homeLoading) homeLoading.style.display = 'none';
        document.body.classList.add('app-active');
        
        // Start Three.js loop and resize once UI is active
        sceneApi.animate();
        sceneApi.onResize();
        loadDefaultPoseTrackOnce();
    },
    onResourceStateChanged: () => {
        uiApi?.refreshAvailability();
    }
});

const exportApi = createExportModule(appState, sceneApi, {
    updateStatus: (message, state) => uiApi?.updateStatus(message, state),
    refreshAvailability: () => uiApi?.refreshAvailability()
});

uiApi = createUIModule(appState, sceneApi, exportApi, mounts);
appState.poseTrack.api = createPoseTrackModule(appState, sceneApi, uiApi);
uiApi.initialize();

async function loadDefaultPoseTrackOnce() {
    if (defaultPoseTrackAttempted || appState.poseTrack.loaded) return;
    defaultPoseTrackAttempted = true;

    const loaded = await tryLoadDefaultPoseTrack({
        fetchTrack: (path) => fetch(path),
        loadFramesFromText: appState.poseTrack.api.loadFramesFromText
    });

    if (loaded) {
        uiApi?.refreshAvailability();
    }
}

// Setup landing page interactivity & ZIP loading logic
const dropzone = document.getElementById('dropzone');
const zipFileInput = document.getElementById('zip-file-input');
const importDetails = document.getElementById('import-details');
const selectedFileName = document.getElementById('selected-file-name');
const selectedFileSize = document.getElementById('selected-file-size');
const startImportBtn = document.getElementById('start-import-btn');
const homeStatus = document.getElementById('home-status');
const homeLoading = document.getElementById('home-loading');

let selectedFile = null;

dropzone.addEventListener('click', () => {
    zipFileInput.click();
});

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelection(e.dataTransfer.files[0]);
    }
});

zipFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        handleFileSelection(e.target.files[0]);
    }
});

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function handleFileSelection(file) {
    if (!file.name.endsWith('.zip')) {
        showHomeStatus('错误：仅支持导入 ZIP 格式的文件！', true);
        importDetails.style.display = 'none';
        selectedFile = null;
        return;
    }
    
    selectedFile = file;
    selectedFileName.textContent = file.name;
    selectedFileSize.textContent = formatBytes(file.size);
    
    importDetails.style.display = 'block';
    homeStatus.style.display = 'none';
}

function showHomeStatus(message, isError = false) {
    homeStatus.textContent = message;
    homeStatus.style.display = 'block';
    homeStatus.style.border = isError ? '1px solid rgba(255, 119, 119, 0.2)' : '1px solid rgba(0, 255, 170, 0.2)';
    homeStatus.style.background = isError ? 'rgba(255, 119, 119, 0.05)' : 'rgba(0, 255, 170, 0.05)';
    homeStatus.style.color = isError ? '#ff7777' : '#00ffaa';
}

startImportBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    
    importDetails.style.display = 'none';
    homeLoading.style.display = 'flex';
    homeStatus.style.display = 'none';
    
    try {
        const zip = await window.JSZip.loadAsync(selectedFile);
        
        const objectsJsonEntry = findObjectsJsonEntry(zip.files);
        if (!objectsJsonEntry) {
            throw new Error('未在压缩包中找到 objects.json 文件！');
        }
        
        const objectsText = await objectsJsonEntry.file.async('string');
        let objectsData;
        try {
            objectsData = JSON.parse(objectsText);
        } catch (err) {
            throw new Error('objects.json 格式错误，解析失败：' + err.message);
        }
        
        const zipBlobUrls = await buildZipBlobUrls(zip.files, {
            sceneRoot: objectsJsonEntry.sceneRoot,
            createObjectURL: (blob) => URL.createObjectURL(blob)
        });
        
        sceneApi.loadResources(zipBlobUrls, objectsData);
        
    } catch (error) {
        console.error(error);
        homeLoading.style.display = 'none';
        importDetails.style.display = 'block';
        showHomeStatus(`解析失败：${error.message}`, true);
    }
});

window.addEventListener('resize', sceneApi.onResize);
