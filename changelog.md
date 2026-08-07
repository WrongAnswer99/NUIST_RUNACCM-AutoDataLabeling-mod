# 魔改记录 (Changelog vs 上游)

本文档记录了基于上游版本（`ede3e53`）二次开发新增和修复的所有功能。

> 上游原项目：XSmart_Car_MiscTools - AutoDataLabeling，一个基于 Three.js 的智能车赛道 3D 数据可视化与自动标注工具。

---

## 1. 天空盒系统（全新功能）

原始项目使用纯色背景（`0x0a0a0a`）。现已完整实现天空盒系统，为 3D 场景提供可配置的背景环境，提高 AI 模型在多样化场景下的抗干扰能力。

### 1.1 球面全景模式（Equirectangular）

- 上传 **1 张** equirectangular（等距柱状投影）全景图，贴到 `SphereGeometry` 球体上作为天空盒
- ZIP 场景包中放入 `skybox/skybox.png`（支持 `.png` / `.jpg` / `.jpeg`），导入时自动加载
- UI 上传按钮支持从本地选择单张图片

### 1.2 三分分割模式（Split: Sky / Walls / Ground）

新增 `split` 模式，将图片竖切为三段：
- 上段 → 天空（BoxGeometry 顶面）
- 中段 → 四周墙壁（四个侧面共用同一张图）
- 下段 → 地面（BoxGeometry 底面）

### 1.3 裁切比例可调节

三分分割模式下，新增两个实时拖动条：
- **天空裁切 (%)**：图片顶部用于天空的比例（1%–50%，默认 33%）
- **地面裁切 (%)**：图片底部用于地面的比例（1%–50%，默认 33%）

中间剩余部分自动分配给四周墙壁。拖动滑块实时重建天空盒，无需重新上传图片。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `js/scene.js` | `createSkyboxByMode`、`createEquirectangularSkyboxMesh`、`createSplitSkyboxMesh`、`clearSkybox`、`loadSkyboxFromZip`、`loadSkyboxFromFiles`、`rebuildSplitSkybox`、`resetSkybox` — 约 200 行新代码 |
| `js/state.js` | 新增 8 个天空盒状态字段 |
| `js/ui.js` | `bindSkyboxEvents` — 模式切换、滑块交互、上传/重置 |
| `js/zip-import.js` | `findSkyboxUrls` / `resolveSkyboxUrl` — ZIP 中自动查找天空盒图片 |
| `index.html` | 天空盒面板（模式下拉框 + 裁切滑块 + 上传/重置按钮 + 状态提示） |

---

## 2. 视角自由移动（WASD）

原始项目只能通过鼠标 OrbitControls 旋转/缩放。新增键盘 WASD 自由移动：

- **W/S**：前进/后退（沿相机水平朝向）
- **A/D**：左移/右移（垂直于相机朝向）
- **Space/Shift**：上升/下降
- 移动速度 2.0 m/s，与鼠标旋转/缩放可同时使用
- 移动相机时同步更新 `controls.target`，旋转中心随之移动

UI 在"资源"面板的轨迹文件与地面底图之间添加了"视角移动"栏目，标注 WASD 快捷键。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `js/scene.js` | 动画循环中新增 WASD 移动逻辑（约 15 行） |
| `index.html` | 新增"视角移动" `panel-card` |

---

## 3. 修复地面底图透明通道 Bug

**问题**：`map.png` 的透明区域在渲染时显示为**黑色**，无法透过它看到天空盒或场景背景。

**原因**：`MeshStandardMaterial` 默认不启用透明通道。

**修复**：给底图材质添加 `transparent: true` + `depthWrite: true`，使透明像素正确穿透显示。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `js/scene.js` | `originalMapMaterial` 新增 `transparent` 和 `depthWrite` |

---

## 4. 修复相机坐标输入框无法正常键入

**问题**：Position X/Y/Z 和 Euler X/Y/Z 共 6 个坐标输入框，输入时每次按键都被 `.toFixed()` 格式化覆盖，导致光标跳动、小数点无法正常键入。

**原因**：`updateExportCameraFromInputs` 中每次 `input` 事件触发时都调用 `syncExportFormFromState()`，向后写入了格式化后的值。

**修复**：移除该函数中的 `syncExportFormFromState()` 调用。内部状态和导出预览仍然实时更新，但不再覆写用户正在编辑的输入框。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `js/ui.js` | 删除 `updateExportCameraFromInputs` 中一行 `syncExportFormFromState()` |

---

## 5. 导出相机 Y 轴锁定

在相机设置 Position Y 输入框右侧添加 🔒/🔓 锁定按钮。

- **锁定**：捕获当前 Position Y 值，输入框变为只读（半透明）
- **同步主视角时**：主摄像机的 6 个坐标值正常复制，但 Position Y 被锁定值覆写
- 其他坐标（X, Z, Euler X/Y/Z）和 FOV 不受影响

**使用场景**：从不同角度批量导出图片时保持同一高度（如模拟固定车载摄像头高度），避免每次同步后手动修改 Y 值。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `js/ui.js` | 锁定按钮事件绑定 + `syncMainViewToExport` 中锁定时覆写 Y |
| `js/state.js` | 新增 `lockExportY`、`lockedExportYValue` |
| `index.html` | 按钮 UI + 说明文字 |
| `styles/main.css` | `.lock-btn` / `.lock-btn.locked` 样式 |

---

## 6. 导出文件名自动递增

原始为单个 `Sample Name` 输入框，每次导出需手动修改文件名序号。

改造为：
- **文件名前缀**：文本输入（如 `sample_`）
- **序号**：右侧小输入框（如 `0000`，最大 8 位）
- **自动递增勾选框**：勾选后每次导出当前样本 ZIP，序号自动 +1
- 保持位数对齐：`0000` → `0001` → … → `9999` → `10000`

### 涉及文件

| 文件 | 变更 |
|------|------|
| `js/state.js` | `sampleName` 拆分为 `samplePrefix` + `sampleSequence`，新增 `autoIncrementSequence` |
| `js/ui.js` | `updateSampleName()`，前缀/序号/勾选框事件绑定 |
| `js/export.js` | `exportSampleZip` 成功后自动递增逻辑 |
| `js/app.js` | 传入 `syncExportForm` 回调，递增后刷新 UI |
| `index.html` | 替换 Sample Name 单输入框为前缀+序号+勾选框 |
| `js/tutorial.js` | 教程元素引用更新 |

---

## 7. UI 标注与排版调整

- **相机参数排版重排**：X/Z 第一行，Y+锁定第二行（原为 X/Y 一行、Z 单独一行，标注文字游离在 grid 外）
- **天空盒模式标注**：下拉框下方说明球面全景和三分分割的用法与区别
- **Y 轴锁定标注**：锁定按钮下方说明其作用

---

## 8. 新手教程扩展

为新功能补充了 3 个教程步骤（教程从 23 步扩展到 26 步）：

- **⌨️ WASD 键盘自由移动**（第 11 步）— 紧随"鼠标操控指南"之后，说明 WASD + Space/Shift 自由移动
- **🌌 天空盒 (Skybox)**（第 15 步）— 紧随"地面底图上传"之后，介绍球面全景和三分分割两种模式及裁切滑块
- **🔒 Y 轴高度锁定**（第 21 步）— 紧随"同步主视角"之后，说明锁定高度批量导出的用途；弹窗位于按钮左侧避免溢出

### 涉及文件

| 文件 | 变更 |
|------|------|
| `js/tutorial.js` | 新增 3 个 `workspaceSteps` 教程步骤 |

---

## 汇总：修改文件清单

| 文件 | 改动行数 | 变更类型 |
|------|---------|---------|
| `js/scene.js` | +231/-8 | 天空盒 + WASD 移动 + 透明底图修复 |
| `js/ui.js` | +120/-4 | 天空盒事件 + Y 轴锁定 + 坐标输入修复 + 导出命名重构 |
| `index.html` | +46/-4 | 天空盒面板 + 视角移动栏目 + 导出命名 UI + 相机重排 + 标注文字 |
| `styles/main.css` | +29/-1 | 锁定按钮样式 |
| `js/zip-import.js` | +18/-0 | 天空盒图片 ZIP 导入 |
| `js/state.js` | +16/-1 | 新增 11 个状态字段 |
| `js/tutorial.js` | +12/-3 | 新增 3 个教程步骤 + 导出命名引用更新 |
| `js/export.js` | +10/-0 | 导出后自动递增序号 |
| `js/app.js` | +3/-1 | syncExportForm 回调 |
| **合计** | **+485 / -23** | **9 个文件** |
