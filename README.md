# XSmart_Car_MiscTools - AutoDataLabeling

这是一个基于 Web 的智能车赛道 3D 数据可视化与自动标注工具。项目利用 Three.js 构建 3D 渲染管线，实现了赛道场景 ZIP 导入、多圈数元素过滤、车辆轨迹随动模拟、像素级精准包围盒提取，以及一键导出符合标准深度学习训练格式（COCO 标注、语义/实例分割掩码、相机参数）的数据集。

![示例截图](pic/demo1.png)

---

## 核心功能

1. **场景与程序分离**
   支持一键导入包含 3D 资源（如 `models/` 中的 GLB 模型）、场景配置文件（`objects.json`）和地面底图的 ZIP 压缩包，实现场景资产的动态热加载。

2. **多圈数资源过滤与自动显隐 (Lap Filtering)**
   轨迹播放时能根据小车当前的极坐标圈数（Lap），自动控制当前圈数下金币、障碍物等 3D 元素的可见性，保证标注数据与车辆实际所处圈数环境精确对应。

3. **常驻底图与缺失缓存机制**
   底图（`map.png`）在任何渲染模式和圈数下常驻显示。如果导入的场景 ZIP 包中没有包含底图，系统会自动 Ajax 回退并复用本地缓存的默认地图，确保渲染绝不黑屏。

4. **车辆轨迹随动与水平视角锁定**
   支持导入 `track.txt` 车辆物理轨迹（含 X、Z 坐标与偏航角 Yaw）。播放时，相机的俯仰角 (Pitch) 和翻滚角 (Roll) 强制锁定为水平 $0^\circ$，使相机视线与车辆行进方向完美对齐，清空轨迹后自动复位。

5. **单通像素级包围盒解算 (Single-pass Pixel-perfect Sweeper)**
   * **超高性能**：采用全场景单通（Single-pass） `instance` 变体渲染，将所有模型以不重复的 24 位 ID 颜色涂色后，在 CPU 端进行 JIT 级别的高速扁平扫描，支持 **60+ FPS** 的实时无卡顿滑块拖拽。
   * **像素级相切**：检测框完全依赖实际可见的渲染像素生成，能自动过滤并忽略模型底部的隐形阴影平面（如 `car.glb` 的 Shadow Plane）或车顶多余的线框，使边界框严密和小车外缘相切。
   * **遮挡与裁剪感知**：天然集成 WebGL 深度检测与视锥体截断，被墙壁挡住的部分或超出屏幕的部分会自动收缩或剔除。

6. **一键导出数据集**
   支持一键生成并下载包含以下内容的 ZIP 样本包：
   * `rgb.png`：标准相机视野图。
   * `semantic_mask.png`：类别的语义分割图。
   * `semantic_road_covered_mask.png`：路面覆盖语义分割图。
   * `instance_mask.png`：实例分割掩码图。
   * `labels.json`：符合 COCO 格式的检测框标注信息。
   * `camera.json`：相机的 AR 物理坐标与欧拉角姿态。

---

## 项目结构

```text
XSmart_Car_MiscTools/
├── README.md                          # 项目说明文件
└── AutoDataLabeling/                  # 自动数据标注工具根目录
    ├── index.html                     # Web 主页面入口
    ├── map.png                        # 默认缓存地面底图
    ├── track.txt                      # 默认车辆轨迹数据
    ├── fliter.py                      # 辅助过滤 Python 脚本
    ├── styles/
    │   └── main.css                   # 页面样式表
    ├── js/
    │   ├── app.js                     # 核心启动、解包与生命周期调度
    │   ├── state.js                   # 全局状态管理与默认配置
    │   ├── scene.js                   # Three.js 场景构建、材质变体与图层UI
    │   ├── pose-track.js              # 轨迹解析、随动逻辑与视角同步
    │   ├── export.js                  # 离屏渲染、单通扫描、标签序列化与压缩打包
    │   └── ui.js                      # DOM 交互绑定与 2D Canvas 检测框渲染
    └── tests/                         # 测试用例目录
```

---

## 快速开始

本项目为纯前端应用，需在 **Web 服务器环境**下运行以规避跨域限制（CORS）。

### 方法一：使用 VS Code Live Server 插件（推荐）
1. 用 VS Code 打开 `XSmart_Car_MiscTools` 文件夹。
2. 安装 **Live Server** 插件。
3. 右键点击 `AutoDataLabeling/index.html` 选择 **Open with Live Server**。

### 方法二：使用 Python 本地服务器
在 `AutoDataLabeling` 目录下运行终端命令：
```bash
# Python 3
python3 -m http.server 8000
```
然后在浏览器中访问 `http://localhost:8000` 即可。

---

## 数据集使用工作流

1. **导入场景**：在首页选择包含 3D 资产和配置文件的场景 ZIP 文件。
2. **导入轨迹**：点击“导入轨迹文件”加载 `track.txt`。
3. **进度预览**：拖动“轨迹进度”滑块，切换 `RGB`、`Detections`（检测框）、`Semantic`（语义分割）、`Instance`（实例分割）等视图检查标注质量。
4. **一键导出**：点击“导出当前帧”或“批量导出全部帧”，系统会自动将所选的标注数据打包成压缩包提供下载。
