document.addEventListener('DOMContentLoaded', () => {
    // Ensure driver.js library is loaded
    if (!window.driver || !window.driver.js || !window.driver.js.driver) {
        console.warn('Driver.js is not loaded or loaded incorrectly.');
        return;
    }

    const driver = window.driver.js.driver;

    // Helper to programmatically switch workflow tabs
    function switchTab(tabName) {
        const btn = document.querySelector(`[data-workflow-target="${tabName}"]`);
        if (btn && !btn.classList.contains('active')) {
            btn.click();
        }
    }

    // Phase 1 Steps: Landing Page Onboarding
    const landingSteps = [
        {
            element: '.home-card',
            popover: {
                title: '🚗 欢迎使用赛道数据标注工具',
                description: '本工具基于 Three.js 实现智能车赛道的 3D 可视化与自动标注，可一键提取像素级精准的边界框与多图层分割掩码数据。',
                side: 'bottom',
                align: 'center'
            }
        },
        {
            element: '#dropzone',
            popover: {
                title: '1. 导入场景压缩包',
                description: '拖拽或点击上传赛道 3D 资产的 ZIP 压缩文件。压缩包内部必须包含 <code>objects.json</code> 和存放 3D 模型 (.glb) 的 <code>models/</code> 文件夹。',
                side: 'bottom',
                align: 'center'
            }
        },
        {
            element: '.landing-buttons',
            popover: {
                title: '⚡ 快速体验演示数据',
                description: '如果您手头没有准备好的场景数据，点击“<b>加载演示数据</b>”，系统将直接读取项目根目录下的 <code>正式赛道-区域赛.zip</code> 真实 3D 赛道包和轨迹，带您直接进入主面板体验完整标注功能！',
                side: 'top',
                align: 'center'
            }
        }
    ];

    // Phase 2 Steps: Workspace Toolstack & Workflow
    const workspaceSteps = [
        {
            element: '#app-shell',
            popover: {
                title: '🏠 进入工作台',
                description: '场景和轨迹已成功加载！欢迎来到主工作区。这里整合了完整的 3D 随动标注工作流。接下来我们将一步步带您浏览各个模块。',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: '#viewport-shell',
            popover: {
                title: '🖱️ 主 3D 视窗交互操作指南',
                description: '在中间的 3D 画布区域，您可以使用鼠标自由控制相机视角：<br>- <b>按住鼠标左键拖拽</b>：围绕场景 360° 旋转视角 (Orbit)<br>- <b>按住鼠标右键拖拽</b>：平移画布画面 (Pan)<br>- <b>滚动鼠标滚轮</b>：放大 / 缩小视角 (Zoom In/Out)',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: '#viewport-shell',
            popover: {
                title: '⌨️ WASD 键盘自由移动',
                description: '除了鼠标操控，点击画布获得焦点后，可使用键盘 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 自由移动相机，<kbd>Space</kbd> / <kbd>Shift</kbd> 上下升降，获得更个性化的拍摄角度。',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: 'section[data-workflow-page="resources"]',
            popover: {
                title: '📂 资源控制面板',
                description: '在“资源”选项卡下，可以管理当前场景的状态、导入新的车辆行驶轨迹（Pose Trajectory）或覆盖当前地面的底图。',
                side: 'right',
                align: 'start'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: '#pose-track-import',
            popover: {
                title: '📈 车辆行驶轨迹 (Pose Track)',
                description: '点击上传 <code>track.txt</code> 轨迹文件。数据格式须为带毫秒时间戳的极坐标位姿，系统会自动将其换算为米并跟随车辆姿态。我们已自动为您预载了测试轨迹。',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: '#map-image-import',
            popover: {
                title: '🗺️ 地面底图上传',
                description: '除了 ZIP 内置的底图，您还可以上传自定义底图（PNG/JPG）进行道路遮罩覆盖。点击"恢复默认底图"可随时恢复。',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: '#skybox-import',
            popover: {
                title: '🌌 天空盒 (Skybox)',
                description: '可为场景添加天空盒背景，提高 AI 模型在多样化场景下的抗干扰能力。支持<b>球面全景（上传 1 张等距柱状投影图）</b>和<b>三分分割（图片竖切为天空/四周/地面）</b>两种模式，还可拖动滑块调节三段裁切比例。',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: 'details.advanced-group',
            popover: {
                title: '⚙️ 底图物理校准',
                description: '展开此面板，可微调底图对应的物理世界实际长宽尺寸（米）和偏移中心点坐标，使底图贴图与 3D 场景护栏和元素边缘完美对齐。',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: 'nav.workflow-pagebar button[data-workflow-target="annotate"]',
            popover: {
                title: '🏷️ 标注配置页面',
                description: '现在，让我们前往“标注”页面，在这里我们将微调图层独立可见性和圈数显示。',
                side: 'top',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        },
        {
            element: '#master-mask-mode',
            popover: {
                title: '🎭 开启标注掩码模式',
                description: '启用此开关后，视窗中所有非标注的视觉辅助元素（如背景网格线、定位红球）将被隐藏，整个 3D 渲染画面会变为纯平分割色彩，用于提取纯净的掩码图像。',
                side: 'bottom',
                align: 'left'
            },
            onHighlightStarted: () => switchTab('annotate')
        },
        {
            element: '#param-lap-filter',
            popover: {
                title: '🔄 极坐标圈数过滤',
                description: '在多圈数播放下，系统能根据小车当前的圈数自动显隐属于该圈数的道具（例如吃掉的金币不应该在下一圈显示）。您也可以在此手动筛选展示特定圈数（Lap 0 ~ Lap 4）的元素环境。',
                side: 'bottom',
                align: 'left'
            },
            onHighlightStarted: () => switchTab('annotate')
        },
        {
            element: '#dynamic-layers',
            popover: {
                title: '👁️ 模型独立可见性',
                description: '当前场景中所有的 3D 道具分类会列在此处。点击特定道具前面的复选框，可单独隐藏或显示该类模型（例如隐藏锥桶或赛道）。颜色与分割掩码色保持一致。',
                side: 'bottom',
                align: 'left'
            },
            onHighlightStarted: () => switchTab('annotate')
        },
        {
            element: 'nav.workflow-pagebar button[data-workflow-target="camera"]',
            popover: {
                title: '📷 相机控制页面',
                description: '点击切换到“相机”控制页面，调整画面视角并实时预览解算的目标检测框和分割掩码。',
                side: 'top',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('annotate')
        },
        {
            element: '#preview-mode-switch',
            popover: {
                title: '🎨 视图模式切换器',
                description: '可在五种渲染模式中切换预览：<br>- <b>RGB</b>：查看原图。<br>- <b>检测</b>：查看基于像素级 ID 扁平扫描得出的目标检测框。<br>- <b>语义/覆盖/实例</b>：分别预览分割和遮罩效果。',
                side: 'bottom',
                align: 'left'
            },
            onHighlightStarted: () => switchTab('camera')
        },
        {
            element: '#export-preview-frame',
            popover: {
                title: '📺 导出画面实时预览',
                description: '此处的画幅和比例实时对应最终导出的图像文件。检测模式下，会自动把像素级精准切合小车外缘的绿色检测边框和标签叠加绘制在预览图上。',
                side: 'left',
                align: 'center'
            },
            onHighlightStarted: () => {
                switchTab('camera');
                // Ensure preview mode is set to detections to make it interactive and clear
                const detBtn = document.querySelector('[data-preview-mode="detections"]');
                if (detBtn) detBtn.click();
            }
        },
        {
            element: '#sync-main-view',
            popover: {
                title: '🔗 同步主视角',
                description: '在主 3D 视窗中按住<b>左键旋转</b>、<b>右键平移</b>、<b>滚轮缩放</b>调整好您满意的视场后，点击"同步主视角"即可将此自由视角精确复制赋给导出相机！',
                side: 'bottom',
                align: 'left'
            },
            onHighlightStarted: () => switchTab('camera')
        },
        {
            element: '#lock-export-y',
            popover: {
                title: '🔒 Y 轴高度锁定',
                description: '点击 Position Y 旁的锁按钮可锁定导出相机的高度。锁定后每次同步主视角，X/Z/旋转会正常更新，但 Y 高度保持不变，方便从不同角度批量导出固定高度的图像（如模拟车载摄像头）。',
                side: 'left',
                align: 'start'
            },
            onHighlightStarted: () => switchTab('camera')
        },
        {
            element: '.label-settings-group',
            popover: {
                title: '✏️ 语义标签别名编辑器',
                description: '在此面板可勾选哪些分类参与渲染与导出，并能为原始 3D 命名（如 cone）改写为人性化的标签别名（如 traffic_cone），导出的数据集将自动采用新名字！',
                side: 'bottom',
                align: 'left'
            },
            onHighlightStarted: () => switchTab('camera')
        },
        {
            element: 'nav.workflow-pagebar button[data-workflow-target="export"]',
            popover: {
                title: '💾 导出数据集页面',
                description: '最后，让我们前往“导出”控制台，一键获取您的标注数据集。',
                side: 'top',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('camera')
        },
        {
            element: '#export-sample-prefix',
            popover: {
                title: '🏷️ 导出文件名',
                description: '设置文件名前缀和序号，例如 <code>sample_0000</code>。勾选自动递增后，每次导出序号自动 +1。',
                side: 'bottom',
                align: 'left'
            },
            onHighlightStarted: () => switchTab('export')
        },
        {
            element: '.panel-card:has(#export-zip-button), #export-status',
            popover: {
                title: '📦 导出操作',
                description: '根据之前切换的“相机视图”模式决定导出的数据格式：<br>- <b>导出当前样本 ZIP</b>：下载当前渲染帧图像、标注 JSON 和相机参数。<br>- <b>导出整段轨迹 ZIP</b>：全自动跑完行驶轨迹的所有帧，批量离屏解算并打包下载符合 <b>YOLO / COCO / X-AnyLabeling</b> 规范的数据集！',
                side: 'right',
                align: 'start'
            },
            onHighlightStarted: () => switchTab('export')
        },
        {
            element: '#workflow-timeline',
            popover: {
                title: '🕒 轨迹时间轴',
                description: '拖动底部轨迹时间轴进度条，可以随动回放整段路程中车辆行驶过程。相机将强制锁定水平 $0^\\circ$ 仰角（Pitch），与行车路线对齐，方便对任意一帧做检测框像素审查。',
                side: 'top',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('export')
        },
        {
            element: '#btn-restart-tutorial',
            popover: {
                title: '🎉 教程完成',
                description: '恭喜您完成了智能车自动标注工具的所有核心教程！如有需要，您可以随时点击右上角的“<b>新手教程</b>”悬浮按钮重新重温此向导。祝您标注顺利！',
                side: 'bottom',
                align: 'center'
            },
            onHighlightStarted: () => switchTab('resources')
        }
    ];

    // Initialize Driver.js popovers with a clean dark theme
    function runTutorial(steps) {
        const driverObj = driver({
            showProgress: true,
            animate: true,
            overlayColor: 'rgba(0, 0, 0, 0.75)',
            popoverClass: 'custom-driver-popover',
            progressText: '第 {{current}} 步，共 {{total}} 步',
            nextBtnText: '下一步',
            prevBtnText: '上一步',
            doneBtnText: '完成',
            steps: steps,
            onDestroyed: () => {
                sessionStorage.removeItem('tutorial_active');
            }
        });
        driverObj.drive();
    }

    // Trigger Phase 1 on clicking "新手教程" from landing page
    const btnStartTutorial = document.getElementById('btn-start-tutorial');
    if (btnStartTutorial) {
        btnStartTutorial.addEventListener('click', () => {
            runTutorial(landingSteps);
        });
    }

    // Trigger Phase 2 from the floating viewport button
    const btnRestartTutorial = document.getElementById('btn-restart-tutorial');
    if (btnRestartTutorial) {
        btnRestartTutorial.addEventListener('click', () => {
            runTutorial(workspaceSteps);
        });
    }

    // Auto-resume tutorial Phase 2 if transition flag was set in sessionStorage
    window.addEventListener('app-activated', () => {
        if (sessionStorage.getItem('tutorial_active') === 'true') {
            // Short delay to let Three.js assets and DOM settle
            setTimeout(() => {
                runTutorial(workspaceSteps);
            }, 300);
        }
    });
});
