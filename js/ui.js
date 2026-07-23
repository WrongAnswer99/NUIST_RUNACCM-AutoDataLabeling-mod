import { arToSceneVector3, sceneToArVector3 } from './state.js';

export function createUIModule(appState, sceneApi, exportApi, mounts) {
    const { scene: sceneState, exportState, defaults, poseTrack, ui } = appState;
    const {
        previewFrame,
        previewOverlay,
        exportStatusEl,
        exportZipButton,
        exportTrajectoryZipButton,
        semanticLabelEditor,
        instanceLabelsEl
    } = mounts;

    function updateStatus(message, state = 'idle') {
        exportStatusEl.textContent = message;
        exportStatusEl.dataset.state = state;
    }

    function isObjectVisible(object3d) {
        let current = object3d;
        while (current && current !== sceneApi.scene) {
            if (!current.visible) return false;
            current = current.parent;
        }
        return true;
    }

    function syncSemanticRegistryWith3DVisibility() {
        [...sceneState.semanticRegistry.values()].forEach((entry) => {
            const instances = [...sceneState.instanceRegistry.values()]
                .filter((inst) => inst.semanticKey === entry.key);
            
            if (instances.length > 0) {
                entry.enabled = instances.some((inst) => isObjectVisible(inst.rootObject));
            }
        });
    }

    function setWorkflowPage(page) {
        const availablePages = [...document.querySelectorAll('[data-workflow-target]')]
            .map((button) => button.dataset.workflowTarget);
        const nextPage = availablePages.includes(page) ? page : 'resources';
        ui.activeWorkflowPage = nextPage;
        const appShell = document.getElementById('app-shell');
        if (appShell) {
            appShell.dataset.activeWorkflow = nextPage;
        }

        const currentLabel = document.getElementById('workflow-current-label');
        const activeButton = document.querySelector(`[data-workflow-target="${nextPage}"]`);
        if (currentLabel && activeButton) {
            currentLabel.textContent = activeButton.querySelector('span')?.textContent || nextPage;
        }

        document.querySelectorAll('[data-workflow-target]').forEach((button) => {
            button.classList.toggle('active', button.dataset.workflowTarget === nextPage);
            button.setAttribute('aria-current', button.dataset.workflowTarget === nextPage ? 'page' : 'false');
        });

        document.querySelectorAll('[data-workflow-page]').forEach((panel) => {
            panel.classList.toggle('active', panel.dataset.workflowPage === nextPage);
        });

        if (nextPage === 'camera') {
            syncSemanticRegistryWith3DVisibility();
            updateSemanticLabelEditor();
        }

        sceneApi.onResize();
        sceneApi.requestExportPreview();
    }

    function bindWorkflowPageEvents() {
        document.querySelectorAll('[data-workflow-target]').forEach((button) => {
            button.addEventListener('click', () => {
                setWorkflowPage(button.dataset.workflowTarget);
            });
        });
        setWorkflowPage(ui.activeWorkflowPage || 'resources');
    }

    function refreshAvailability() {
        exportZipButton.disabled = !sceneState.resourcesReady || sceneState.exportInProgress;
        if (exportTrajectoryZipButton) {
            exportTrajectoryZipButton.disabled = (
                !sceneState.resourcesReady
                || sceneState.exportInProgress
                || !poseTrack.loaded
                || !poseTrack.frames.length
            );
        }

        const mapImportButton = document.getElementById('map-image-import');
        const mapResetButton = document.getElementById('map-image-reset');
        if (mapImportButton && mapResetButton) {
            mapImportButton.disabled = !sceneState.resourcesReady;
            mapResetButton.disabled = !sceneState.resourcesReady;
        }
    }

    function updateInstanceLabelList() {
        if (!instanceLabelsEl) return;
        const content = [...sceneState.instanceRegistry.values()]
            .sort((a, b) => a.id - b.id)
            .filter((entry) => sceneState.semanticRegistry.get(entry.semanticKey)?.enabled !== false)
            .map((entry) => {
                const semanticEntry = sceneState.semanticRegistry.get(entry.semanticKey);
                const semanticName = semanticEntry ? semanticEntry.name : entry.semanticKey;
                return `${entry.id}: ${entry.name} -> ${semanticName}`;
            })
            .join('\n');
        instanceLabelsEl.value = content;
    }

    function updateSemanticLabelEditor() {
        if (!semanticLabelEditor) return;
        semanticLabelEditor.innerHTML = '';

        const backgroundRow = document.createElement('div');
        backgroundRow.className = 'semantic-label-row';
        backgroundRow.innerHTML = `
            <div class="semantic-label-toggle"><input type="checkbox" checked disabled></div>
            <div class="semantic-label-id">0</div>
            <input type="text" value="background" disabled>
        `;
        semanticLabelEditor.appendChild(backgroundRow);

        [...sceneState.semanticRegistry.values()]
            .sort((a, b) => a.id - b.id)
            .forEach((entry) => {
                const row = document.createElement('div');
                row.className = 'semantic-label-row';

                const toggleWrap = document.createElement('div');
                toggleWrap.className = 'semantic-label-toggle';
                const toggle = document.createElement('input');
                toggle.type = 'checkbox';
                toggle.checked = entry.enabled !== false;
                toggle.addEventListener('change', (event) => {
                    entry.enabled = event.target.checked;
                    updateInstanceLabelList();
                    sceneApi.requestExportPreview();
                });
                toggleWrap.appendChild(toggle);

                const idBadge = document.createElement('div');
                idBadge.className = 'semantic-label-id';
                idBadge.textContent = entry.id;

                const input = document.createElement('input');
                input.type = 'text';
                input.value = entry.name;
                input.addEventListener('input', (event) => {
                    entry.name = event.target.value.trim() || entry.key;
                    exportState.semanticLabels[entry.key] = entry.name;
                    updateInstanceLabelList();
                    sceneApi.requestExportPreview();
                });

                row.appendChild(toggleWrap);
                row.appendChild(idBadge);
                row.appendChild(input);
                semanticLabelEditor.appendChild(row);
            });
    }

    function syncExportFormFromState() {
        const arCameraPosition = sceneToArVector3(exportState.camera.position);
        document.getElementById('export-sample-name').value = exportState.sampleName;
        document.getElementById('export-aspect-preset').value = exportState.resolution.aspectPreset;
        document.getElementById('export-width').value = exportState.resolution.width;
        document.getElementById('export-height').value = exportState.resolution.height;

        document.getElementById('export-cam-px').value = arCameraPosition.x.toFixed(2);
        document.getElementById('export-cam-py').value = arCameraPosition.y.toFixed(2);
        document.getElementById('export-cam-pz').value = arCameraPosition.z.toFixed(2);
        document.getElementById('export-rot-x').value = exportState.camera.rotation.x.toFixed(1);
        document.getElementById('export-rot-y').value = exportState.camera.rotation.y.toFixed(1);
        document.getElementById('export-rot-z').value = exportState.camera.rotation.z.toFixed(1);
        document.getElementById('export-cam-fov').value = exportState.camera.fov.toFixed(1);
    }

    function renderDetectionOverlay(width, height) {
        if (!previewOverlay) return;
        const ctx = previewOverlay.getContext('2d');
        ctx.clearRect(0, 0, previewOverlay.width, previewOverlay.height);

        if (exportState.previewMode !== 'detections' || width <= 0 || height <= 0) return;

        const detections = exportApi.getDetectionPreviewData?.() || [];
        const scaleX = width / exportState.resolution.width;
        const scaleY = height / exportState.resolution.height;

        detections.forEach((detection) => {
            const [x, y, boxWidth, boxHeight] = detection.bbox;
            ctx.strokeStyle = detection.color || '#00ffaa';
            ctx.lineWidth = 2;
            ctx.strokeRect(
                x * scaleX,
                y * scaleY,
                boxWidth * scaleX,
                boxHeight * scaleY
            );
        });
    }

    function initializeExportUI() {
        syncExportFormFromState();
        updateSemanticLabelEditor();
        updateInstanceLabelList();
        updatePoseTrackUI();
        sceneApi.resizePreviewRenderer();
        renderDetectionOverlay(previewOverlay?.width || 0, previewOverlay?.height || 0);
    }

    function updatePoseTrackUI() {
        const statusEl = document.getElementById('pose-track-status');
        const frameLabelEl = document.getElementById('pose-track-frame-label');
        const frameInfoEl = document.getElementById('pose-track-frame-info');
        const progressEl = document.getElementById('pose-track-progress');
        const clearButton = document.getElementById('pose-track-clear');

        if (!poseTrack.loaded || !poseTrack.frames.length) {
            statusEl.textContent = '未导入轨迹';
            frameLabelEl.textContent = '0 / 0';
            frameInfoEl.textContent = 'X: -- m | Z: -- m | Yaw: -- deg';
            progressEl.disabled = true;
            progressEl.min = '0';
            progressEl.max = '0';
            progressEl.value = '0';
            clearButton.disabled = true;
            return;
        }

        const frame = poseTrack.frames[poseTrack.currentIndex];
        statusEl.textContent = `${poseTrack.fileName} | ${poseTrack.frames.length} 帧`;
        frameLabelEl.textContent = `${poseTrack.currentIndex + 1} / ${poseTrack.frames.length}`;
        const lapStr = frame.lap !== undefined ? ` | Lap: ${frame.lap}` : '';
        frameInfoEl.textContent = `X: ${frame.xMeters.toFixed(3)} m | Z: ${frame.zMeters.toFixed(3)} m | Yaw: ${frame.yawDeg.toFixed(1)} deg${lapStr}`;
        progressEl.disabled = false;
        progressEl.min = '0';
        progressEl.max = String(Math.max(0, poseTrack.frames.length - 1));
        progressEl.value = String(poseTrack.currentIndex);
        clearButton.disabled = false;
    }

    function applyAspectPreset(preset) {
        exportState.resolution.aspectPreset = preset;
        if (preset !== 'custom' && defaults.previewPresetSizes[preset]) {
            const [width, height] = defaults.previewPresetSizes[preset];
            exportState.resolution.width = width;
            exportState.resolution.height = height;
        }
        syncExportFormFromState();
        sceneApi.resizePreviewRenderer();
        sceneApi.requestExportPreview();
    }

    function updateResolutionFromInputs(markCustom = false) {
        const widthInput = document.getElementById('export-width');
        const heightInput = document.getElementById('export-height');
        const parsedWidth = parseInt(widthInput.value, 10);
        const parsedHeight = parseInt(heightInput.value, 10);
        const width = Number.isFinite(parsedWidth) && parsedWidth >= 64 ? parsedWidth : exportState.resolution.width;
        const height = Number.isFinite(parsedHeight) && parsedHeight >= 64 ? parsedHeight : exportState.resolution.height;
        exportState.resolution.width = width;
        exportState.resolution.height = height;
        if (markCustom) {
            exportState.resolution.aspectPreset = 'custom';
            document.getElementById('export-aspect-preset').value = 'custom';
        }
        syncExportFormFromState();
        sceneApi.resizePreviewRenderer();
        sceneApi.requestExportPreview();
    }

    function commitResolutionField(inputId, fallbackValue) {
        const input = document.getElementById(inputId);
        const parsedValue = parseInt(input.value, 10);
        if (!Number.isFinite(parsedValue) || parsedValue < 64) {
            input.value = String(fallbackValue);
            return false;
        }
        return true;
    }

    function updateExportCameraFromInputs() {
        const px = parseFloat(document.getElementById('export-cam-px').value);
        const py = parseFloat(document.getElementById('export-cam-py').value);
        const pz = parseFloat(document.getElementById('export-cam-pz').value);
        const rx = parseFloat(document.getElementById('export-rot-x').value);
        const ry = parseFloat(document.getElementById('export-rot-y').value);
        const rz = parseFloat(document.getElementById('export-rot-z').value);
        const fov = parseFloat(document.getElementById('export-cam-fov').value);
        const fallbackArPosition = sceneToArVector3(exportState.camera.position);
        const nextArPosition = {
            x: Number.isFinite(px) ? px : fallbackArPosition.x,
            y: Number.isFinite(py) ? py : fallbackArPosition.y,
            z: Number.isFinite(pz) ? pz : fallbackArPosition.z
        };

        exportState.camera.position.copy(arToSceneVector3(nextArPosition.x, nextArPosition.y, nextArPosition.z));
        exportState.camera.rotation.set(
            Number.isFinite(rx) ? rx : exportState.camera.rotation.x,
            Number.isFinite(ry) ? ry : exportState.camera.rotation.y,
            Number.isFinite(rz) ? rz : exportState.camera.rotation.z
        );
        exportState.camera.fov = Number.isFinite(fov) ? Math.min(120, Math.max(10, fov)) : exportState.camera.fov;
        syncExportFormFromState();
        sceneApi.requestExportPreview();
    }

    function syncMainViewToExport() {
        exportState.camera.position.copy(sceneApi.camera.position);
        exportState.camera.rotation.set(
            sceneApi.camera.rotation.x * 180 / Math.PI,
            sceneApi.camera.rotation.y * 180 / Math.PI,
            sceneApi.camera.rotation.z * 180 / Math.PI
        );
        exportState.camera.fov = sceneApi.camera.fov;
        syncExportFormFromState();
        sceneApi.requestExportPreview();
    }

    function resetExportCamera() {
        exportState.camera.position.copy(defaults.defaultExportCameraState.position);
        exportState.camera.rotation.copy(defaults.defaultExportCameraState.rotation);
        exportState.camera.fov = defaults.defaultExportCameraState.fov;
        syncExportFormFromState();
        sceneApi.requestExportPreview();
    }

    function bindPreviewModeButtons() {
        document.querySelectorAll('[data-preview-mode]').forEach((button) => {
            button.addEventListener('click', () => {
                exportState.previewMode = button.dataset.previewMode;
                document.querySelectorAll('[data-preview-mode]').forEach((node) => {
                    node.classList.toggle('active', node === button);
                });
                sceneApi.requestExportPreview();
            });
        });
    }

    function bindExportFormEvents() {
        document.getElementById('export-sample-name').addEventListener('input', (event) => {
            exportState.sampleName = event.target.value;
        });

        document.getElementById('export-aspect-preset').addEventListener('change', (event) => {
            applyAspectPreset(event.target.value);
        });

        document.getElementById('export-width').addEventListener('input', () => {
            exportState.resolution.aspectPreset = 'custom';
            document.getElementById('export-aspect-preset').value = 'custom';
        });
        document.getElementById('export-height').addEventListener('input', () => {
            exportState.resolution.aspectPreset = 'custom';
            document.getElementById('export-aspect-preset').value = 'custom';
        });
        document.getElementById('export-width').addEventListener('blur', () => {
            commitResolutionField('export-width', exportState.resolution.width);
            updateResolutionFromInputs(true);
        });
        document.getElementById('export-height').addEventListener('blur', () => {
            commitResolutionField('export-height', exportState.resolution.height);
            updateResolutionFromInputs(true);
        });

        ['export-cam-px', 'export-cam-py', 'export-cam-pz', 'export-rot-x', 'export-rot-y', 'export-rot-z', 'export-cam-fov']
            .forEach((id) => {
                document.getElementById(id).addEventListener('input', updateExportCameraFromInputs);
            });

        document.getElementById('sync-main-view').addEventListener('click', syncMainViewToExport);
        document.getElementById('reset-export-camera').addEventListener('click', resetExportCamera);
        exportZipButton.addEventListener('click', exportApi.exportSampleZip);
        exportTrajectoryZipButton?.addEventListener('click', exportApi.exportTrajectoryZip);
    }

    function bindPoseTrackEvents() {
        const fileInput = document.getElementById('pose-track-file');
        const importButton = document.getElementById('pose-track-import');
        const clearButton = document.getElementById('pose-track-clear');
        const progressEl = document.getElementById('pose-track-progress');

        importButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                poseTrack.api.loadFramesFromText(file.name, text);
                updatePoseTrackUI();
                refreshAvailability();
            } catch (error) {
                updateStatus(`轨迹导入失败：${error.message}`, 'error');
            } finally {
                fileInput.value = '';
            }
        });

        clearButton.addEventListener('click', () => {
            poseTrack.api.clearTrack();
            refreshAvailability();
        });

        progressEl.addEventListener('input', (event) => {
            const index = parseInt(event.target.value, 10);
            if (!Number.isFinite(index)) return;
            poseTrack.api.applyFrame(index);
        });
    }

    function bindMaskControls() {
        document.getElementById('param-width').addEventListener('input', sceneApi.updateGroundTransform);
        document.getElementById('param-height').addEventListener('input', sceneApi.updateGroundTransform);
        document.getElementById('param-cx').addEventListener('input', sceneApi.updateGroundTransform);
        document.getElementById('param-cz').addEventListener('input', sceneApi.updateGroundTransform);

        document.getElementById('param-blur').addEventListener('input', (event) => {
            document.getElementById('val-blur').innerText = parseFloat(event.target.value).toFixed(1);
            sceneApi.updateMaskTexture(parseFloat(event.target.value));
        });

        document.getElementById('param-threshold').addEventListener('input', (event) => {
            const value = parseInt(event.target.value, 10);
            document.getElementById('val-threshold').innerText = value;
            sceneApi.antialiasedTrackShader.uniforms.uThreshold.value = 0.5 + (value / 255.0);
            sceneApi.requestExportPreview();
        });

        document.getElementById('master-mask-mode').addEventListener('change', (event) => {
            sceneState.isMaskMode = event.target.checked;
            
            // Snap sliders to defaults (4.5 and -65) when turning ON mask mode
            if (sceneState.isMaskMode) {
                const blurInput = document.getElementById('param-blur');
                const thresholdInput = document.getElementById('param-threshold');
                if (blurInput) blurInput.value = "4.5";
                if (thresholdInput) thresholdInput.value = "-65";
            }
            
            sceneApi.syncMaskControls();
            sceneApi.applyMainSceneMode();
            sceneApi.requestExportPreview();
        });

        const lapFilterEl = document.getElementById('param-lap-filter');
        if (lapFilterEl) {
            lapFilterEl.addEventListener('change', (event) => {
                sceneApi.updateObjectVisibilityByLap(event.target.value);
            });
        }
    }

    function bindMapImageEvents() {
        const fileInput = document.getElementById('map-image-file');
        const importButton = document.getElementById('map-image-import');
        const resetButton = document.getElementById('map-image-reset');
        const statusEl = document.getElementById('map-image-status');

        let uploadedObjectUrl = null;

        importButton.addEventListener('click', () => {
            if (!sceneState.resourcesReady) {
                updateStatus('请先导入场景 ZIP 压缩包，然后再上传底图。', 'error');
                return;
            }
            fileInput.click();
        });

        fileInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                if (uploadedObjectUrl) {
                    URL.revokeObjectURL(uploadedObjectUrl);
                }
                uploadedObjectUrl = URL.createObjectURL(file);
                sceneApi.updateGroundMapTexture(uploadedObjectUrl);
                statusEl.textContent = `已使用自定义底图: ${file.name}`;
                updateStatus('自定义底图已成功加载并覆盖场景底图。', 'success');
            } catch (error) {
                updateStatus(`自定义底图加载失败：${error.message}`, 'error');
            } finally {
                fileInput.value = '';
            }
        });

        resetButton.addEventListener('click', () => {
            if (!sceneState.resourcesReady) {
                updateStatus('请先导入场景 ZIP 压缩包，然后再操作底图。', 'error');
                return;
            }
            try {
                if (uploadedObjectUrl) {
                    URL.revokeObjectURL(uploadedObjectUrl);
                    uploadedObjectUrl = null;
                }
                const originalPath = sceneState.originalMapPath || appState.defaultMapBlobUrl || './map.png';
                sceneApi.updateGroundMapTexture(originalPath);
                statusEl.textContent = '使用场景内置或默认底图';
                updateStatus('底图已重置为场景内置/默认底图。', 'success');
            } catch (error) {
                updateStatus(`底图重置失败：${error.message}`, 'error');
            }
        });
    }

    function initialize() {
        bindWorkflowPageEvents();
        bindPreviewModeButtons();
        bindExportFormEvents();
        bindMaskControls();
        bindPoseTrackEvents();
        bindMapImageEvents();
        syncExportFormFromState();
        updateSemanticLabelEditor();
        updateInstanceLabelList();
        updatePoseTrackUI();
        sceneApi.resizeMainRenderer();
        sceneApi.resizePreviewRenderer();
        refreshAvailability();
    }

    return {
        initialize,
        updateStatus,
        refreshAvailability,
        updateSemanticLabelEditor,
        updateInstanceLabelList,
        updatePoseTrackUI,
        syncExportFormFromState,
        initializeExportUI,
        renderDetectionOverlay
    };
}
