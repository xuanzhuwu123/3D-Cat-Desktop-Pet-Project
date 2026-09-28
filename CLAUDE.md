# CLAUDE.md — 橘猫桌宠（Desktop Cat Pet）

本文件给 Claude Code 和团队成员看，说明项目目标、现状、技术方案和开发约定。修改代码前先读完。

## 项目目标

把现有的"橘猫推杯子"3D 模型做成一个**桌面宠物**：小猫待在用户的桌面上（透明窗口、始终置顶、不挡操作），它会：

1. **自由活动**：在屏幕底部（任务栏上方）自己走来走去、停下、坐下、睡觉。
2. **点击互动**：单击、双击、拖拽、抚摸（鼠标在猫身上来回移动）都有不同反应。
3. **随机动作**：空闲时随机做一些小动作，比如舔爪、伸懒腰、甩尾巴、打哈欠、推杯子。
4. **喂食**：用户给猫喂食物，猫走过去吃；有饥饿值。
5. **玩耍**：用户用毛线球、逗猫棒（跟着鼠标走）陪猫玩；有心情值。

## 现状（day1）

| 文件 | 说明 |
|---|---|
| `legacy/preview.html` | 原来的 `index.html`（已拆分成模块，见"当前模块划分"）。约 17 MB 的单文件离线**预览网页**（不是桌宠）。内嵌 model-viewer 代码、base64 的 GLB 模型（第 1271 行 `#glbData`）和 base64 的预览视频（第 1272 行 `#mp4Data`） |
| `cat_cup.mp4` | 单独的推杯子渲染视频，`index.html` 没有用到 |

**现有问题（功能不对的原因）：**
- `index.html` 只是模型查看器：能旋转、缩放、播放/暂停动画，**没有任何桌宠逻辑**，也不是桌面窗口。
- model-viewer 只能整段播放动画，**没法用代码控制单根骨骼**，也没法做状态切换或动画混合，不适合做桌宠。
- GLB 里**只有一段动画** `CatRigAction`（6.5 秒，推杯子，99 个通道）。自由活动、吃饭、玩耍需要的动作都还没有。
- 模型和视频用 base64 塞在 HTML 里，体积多了约 1/3，也不好替换和做版本管理。

**模型信息（`cat_rigged_v2_animated.glb`，用 Blender glTF I/O v5.0 导出）：**
- 网格：`model`，1 个 skin。根节点：`CatRig` → `root`。
- 骨骼：`torso` `spine` `chest` `pelvis` `neck1` `neck2` `head` `ear.L/R`
  `upperarm.L/R` `forearm.L/R` `hand.L/R` `thigh.L/R` `shin.L/R` `foot.L/R` `toe.L/R`
  `tail1`–`tail5`，以及 IK 控制器 `IK_hand.L/R` `IK_foot.L/R`
- 写代码驱动骨骼时，直接用上面这些名字（`getObjectByName`）。

## 技术方案

- **桌面外壳：Electron**
  - 主窗口铺满主显示器工作区（`screen.getPrimaryDisplay().workArea`）：`transparent: true`、`frame: false`、`alwaysOnTop: true`、`skipTaskbar: true`、`resizable: false`、`hasShadow: false`。
  - **点击穿透**：默认 `win.setIgnoreMouseEvents(true, { forward: true })`。渲染进程每帧对鼠标位置做 raycast，只有鼠标在猫、食物、玩具或 UI 上时才通过 IPC 关闭穿透。这样猫以外的地方，用户可以正常点桌面。
  - 系统托盘菜单：喂食、拿玩具、让猫睡觉、显示状态、开机自启、退出。
- **渲染：three.js**（不用 model-viewer）
  - `GLTFLoader` 加载 GLB，`AnimationMixer` 播放动画片段，用 `crossFadeTo` 切换（默认 0.25 s）。
  - 正交或小 FOV 透视相机，从侧面稍微俯视。猫的屏幕高度大约 120–160 px。
  - 渲染器用 `alpha: true`，`setClearColor(0x000000, 0)`。
- **资源**：GLB 和音效作为普通文件放在 `assets/`，**不要再用 base64 内嵌**。
- 语言：JavaScript（ES Modules）。如果要加构建工具，用 Vite。

## 动作来源

GLB 现在只有 `CatRigAction`。缺的动作按下面的优先级补：

1. **首选：在 Blender 里做新动作**，每个动作一个 Action，导出到同一个 GLB（NLA 轨道或 Actions 全部导出）。命名约定：
   `idle` `walk` `run` `sit` `lie` `sleep` `eat` `lick_paw` `stretch` `yawn` `tail_wag` `jump` `play_bat` `happy` `angry` `push_cup`（就是把现在的 `CatRigAction` 改名）
   - `walk` / `run` 做**原地循环**（in-place），位移由代码控制，不要用 root motion。
2. **过渡方案：程序化骨骼动画**。Blender 动作还没做好时，在代码里直接驱动骨骼临时顶上。比如呼吸（`chest` 缩放）、甩尾（`tail1`–`tail5` 相位差正弦）、转头看鼠标（`head` / `neck2` 限角 lookAt）、耳朵抖动（`ear.L/R`）。
   - 程序化动画要叠加在 mixer 的结果**之后**，每帧在 `mixer.update()` 之后执行。
- 代码里通过 `animations.get(name)` 取动作。**动作缺失时回退到 `idle` 或程序化版本**，不能报错。

## 行为设计

### 状态机（`src/pet/stateMachine.js`）

状态：`Idle` `Walk` `Sit` `Sleep` `RandomAction` `Eat` `Play` `Dragged` `Fall` `React`

- **Idle**：待 3–8 秒后，按权重随机去 Walk（40%）、Sit（20%）、RandomAction（30%）、Sleep（10%，困倦值高时权重变大）。
- **Walk**：在工作区底边随机选一个目标 x 坐标，以约 60 px/s 走过去，朝向随方向翻转；到屏幕边缘就转身。
- **Sleep**：持续 30–120 秒。点击会叫醒（先播 `yawn` 再回到 Idle）。
- **RandomAction**：从 `lick_paw` / `stretch` / `yawn` / `tail_wag` / `push_cup` 中随机播一个，播完回到 Idle。
- **Dragged**：鼠标按住猫拖动时，猫跟着鼠标，身体下垂、尾巴晃。松手进入 Fall。
- **Fall**：带重力落回底边（有简单的落地挤压效果），然后回到 Idle。
- 高优先级事件（喂食、玩具、点击）可以打断低优先级状态。只有 Eat 不会被随机行为打断。

### 点击互动（`src/pet/interaction.js`）

| 操作 | 反应 |
|---|---|
| 单击 | 抖耳朵、回头看鼠标，冒一个随机气泡（"喵？"） |
| 双击 | `jump` 或 `happy`，心情 +5 |
| 抚摸（鼠标在猫身上来回划 ≥3 次） | 眯眼、`tail_wag`，冒爱心粒子，心情 +10（有冷却时间） |
| 短时间内连点超过 6 次 | `angry`，炸毛，跑开一段距离 |
| 按住拖拽 | 进入 Dragged |
| 右键 | 弹出菜单：喂食 / 玩耍 / 睡觉 / 状态 |

### 喂食（`src/pet/feeding.js`）

- 从右键菜单或托盘选"喂食"后，在鼠标位置生成一个食物（小鱼干 / 猫粮碗），用户可以拖着放到地面。
- 猫走到食物旁边，播 `eat`（3–5 秒），食物逐渐变小直到消失。饥饿值 −40，心情 +5。
- 饥饿值很低时猫不吃（摇头）。饥饿值高于 70 时，猫偶尔冒"饿了"气泡，走路也变慢。

### 玩耍（`src/pet/play.js`）

- **毛线球**：可以拖拽、抛出，有简单物理（重力、地面摩擦、碰到屏幕边缘反弹）。猫会追着球跑，追上后播 `play_bat` 把球拍走。
- **逗猫棒**：开启后羽毛跟随鼠标，猫盯着看、跟过去、蹲下、扑。
- 玩耍会让心情上升、精力下降。精力太低时猫不玩了，改去睡觉。

### 数值（`src/pet/stats.js`）

- `hunger` 饥饿、`mood` 心情、`energy` 精力，范围 0–100。
- 衰减：饥饿值每分钟 +1，精力每分钟 −0.5（睡觉时每分钟 +3），饥饿值高于 70 时心情每分钟 −1。
- 数值和退出时间存到 `app.getPath('userData')/pet-state.json`。下次启动时按离线时长补算，但有上限，不会一回来猫就饿到极限。
- 数值会影响行为权重：精力低就多睡，心情低就少主动互动。

## 目录结构（目标）

```
day1/
├── CLAUDE.md
├── package.json
├── main.js                 # Electron 主进程：窗口、托盘、点击穿透 IPC、存档读写
├── preload.js              # contextBridge 暴露安全 API
├── index.html              # 桌宠渲染页（透明背景）
├── src/
│   ├── main.js             # three.js 初始化、渲染循环
│   ├── pet/
│   │   ├── Cat.js          # 模型加载、动作表、程序化骨骼
│   │   ├── stateMachine.js
│   │   ├── interaction.js
│   │   ├── feeding.js
│   │   ├── play.js
│   │   └── stats.js
│   └── ui/                 # 气泡、右键菜单、状态面板
├── assets/
│   ├── models/cat.glb
│   ├── items/              # 食物、毛线球、逗猫棒（小 GLB 或 PNG 精灵）
│   └── sounds/             # 喵叫、呼噜、吃东西
├── tools/                  # 资源提取、GLB 动作检查等辅助脚本
└── legacy/
    └── preview.html        # 原来的单文件预览页（把现在的 index.html 挪过来保留）
```

## 当前模块划分（网页预览版，四人分工）

`index.html` 只放页面结构和样式，通过 `<script type="module" src="src/main.js">` 加载下面 4 个模块。模块之间只通过导出的函数通信，不要直接改别人模块里的变量。

| 模块 | 负责内容 | 对外接口 |
|---|---|---|
| `src/main.js` | Three.js 渲染器、场景、相机、OrbitControls、窗口缩放、渲染循环；加载 GLB 并挂到场景；把其他模块串起来 | 入口，无导出 |
| `src/petFSM.js` | 解析 `CatRigAction`，管理 `AnimationMixer`，状态机 Idle / Walk / Interact；动画版和绑定版切换、暂停和播放 | `createPetFSM(gltf)` → `{ update, setState, setAnimated, setPlaying, state }`，`PetState` |
| `src/uiController.js` | 按钮和下拉框事件、加载进度和提示文字、视频和下载链接；破框（탈프레임）视效 | `initUI(callbacks)` → `{ setProgress, setLoaded, showError, setMedia }`，`enableFrameBreak()`（待实现） |
| `src/sceneLighting.js` | 色调映射、曝光、环境光、地面软阴影、材质打磨；相机构图、重置视角、点击特写运镜 | `setupLighting`、`fitShadowToModel`、`polishMaterials`、`createCameraRig` → `{ frame, reset, focusOn }`（`focusOn` 待实现） |

- 相机和阴影参数（曝光、环绕角、缩放范围等）集中在 `sceneLighting.js` 的 `VIEW` 里。
- Walk 和 Interact 目前也播放 `CatRigAction`，等新动作做好后再替换。
- 原来的单文件页面保存在 `legacy/preview.html`，可以双击打开，用来对照效果。

## 常用命令

```bash
npm install
npm run dev        # 网页预览版：Vite 本地服务器（ES Module 不能双击用 file:// 打开）
npm start          # electron .（桌宠版，步骤 1 之后才有）
npm run build      # electron-builder 打包 Windows 安装包
```

## 开发约定

- 团队主要用 Windows 11 开发和演示，先保证 Windows 上的透明窗口和点击穿透正常，再考虑 macOS。
- 界面文字和气泡用中文。代码标识符用英文。
- 帧循环里不要分配新对象（复用 `Vector3` 等），CPU 空闲占用尽量低于 5%：猫睡觉时把渲染降到 15 fps。
- 所有可调参数（速度、概率、衰减率、冷却时间）集中放在 `src/config.js`，方便策划调参。
- Electron 安全设置：`contextIsolation: true`、`nodeIntegration: false`，渲染进程只通过 `preload.js` 和主进程通信。
- 从 Blender 换新 GLB 后，先检查动作名是否符合上面的命名约定，再提交。

## 开发计划（分步执行）

**执行规则：**
- 按步骤编号**一次只做一步**。每步做完后，按"验收"逐条自测，再请团队确认，确认后才进入下一步。
- 每步完成后，在下面的进度表里把 `[ ]` 改成 `[x]`，并在"备注"栏写上日期和遇到的问题。
- 做某一步时，只改这一步"改动文件"里列出的文件。如果发现需要改计划，先更新本节，再动代码。
- 带 🎨 的步骤要团队成员在 Blender 里完成，可以和代码步骤并行。

### 进度表

| 步骤 | 内容 | 状态 | 备注 |
|---|---|---|---|
| 0 | 整理项目、提取资源 | [x] | 2026-09-28：已迁移到 legacy/，资源已提取，并拆成 4 个模块（见"当前模块划分"）；还没有 git init |
| 1 | Electron 透明置顶窗口 | [ ] | |
| 2 | three.js 显示猫并播放动画 | [ ] | |
| 3 | 点击穿透 | [ ] | |
| 4 | 动作管理器 + 程序化骨骼 | [ ] | |
| 5 | 状态机 + 自由走动 | [ ] | |
| 6 | 拖拽与下落 | [ ] | |
| 7 | 随机动作 + 睡觉 | [ ] | |
| 8 | 点击互动 + 气泡 | [ ] | |
| 9 | 右键菜单 + 托盘 | [ ] | |
| 10 | 数值系统 + 存档 | [ ] | |
| 11 | 喂食 | [ ] | |
| 12 | 玩耍：毛线球 | [ ] | |
| 13 | 玩耍：逗猫棒 | [ ] | |
| 14 🎨 | Blender 补齐动作并替换 GLB | [ ] | |
| 15 | 音效 + 性能优化 | [ ] | |
| 16 | 打包发布 | [ ] | |

---

### 阶段 A：基础骨架

**步骤 0：整理项目、提取资源**
- 任务：
  - 把现在的 `index.html` 移到 `legacy/preview.html`。
  - 写一个一次性脚本 `tools/extract-assets.js`，把 base64 数据还原成文件：`#glbData` → `assets/models/cat.glb`，`#mp4Data` → `assets/preview.mp4`。
  - 创建 `package.json` 和 `.gitignore`（写入 `node_modules`、`dist`），然后 `git init`。
- 改动文件：`legacy/`、`tools/`、`assets/`、`package.json`、`.gitignore`
- 验收：`assets/models/cat.glb` 能在 legacy 预览页或 https://gltf-viewer.donmccurdy.com 打开，并能看到 `CatRigAction`；`legacy/preview.html` 仍能正常双击打开。

**步骤 1：Electron 透明置顶窗口**
- 任务：
  - 安装 `electron`。
  - `main.js` 创建窗口：铺满主显示器 `workArea`，设置 `transparent`、`frame: false`、`alwaysOnTop`、`skipTaskbar`、`hasShadow: false`。
  - 写好 `preload.js`，开启 `contextIsolation`。
  - `index.html` 先只放一个半透明色块用来测试。
- 改动文件：`package.json`、`main.js`、`preload.js`、`index.html`
- 验收：`npm start` 后桌面上只看到色块，看不到窗口边框、标题栏和任务栏图标；色块盖在其他窗口上面；`Ctrl+Q` 或托盘临时退出按钮可以关闭。

**步骤 2：three.js 显示猫并播放动画**
- 任务：
  - 安装 `three` 和 `vite`，配好开发模式（Electron 加载 Vite dev server）。
  - `src/main.js`：透明渲染器、相机、灯光（半球光 + 方向光）、渲染循环。
  - `src/pet/Cat.js`：用 `GLTFLoader` 加载模型，用 `AnimationMixer` 循环播放 `CatRigAction`。
  - 新建 `src/config.js`，把猫的屏幕高度、位置等参数放进去。
  - 让猫站在工作区底边（任务栏上方）。
- 改动文件：`src/main.js`、`src/pet/Cat.js`、`src/config.js`、`index.html`、`vite.config.js`
- 验收：桌面底部出现一只约 140 px 高的猫，背景完全透明（没有黑框或白框），边缘没有锯齿，动画循环播放。

**步骤 3：点击穿透**
- 任务：
  - 主进程默认调用 `setIgnoreMouseEvents(true, { forward: true })`。
  - 渲染进程在 `mousemove` 时对猫的包围盒或网格做 raycast。命中时通过 IPC 发 `set-ignore-mouse(false)`，离开时再发 `true`，只在状态变化时发，不要每帧都发。
  - 开发模式下加一个快捷键，显示命中区域，方便调试。
- 改动文件：`main.js`、`preload.js`、`src/main.js`
- 验收：鼠标不在猫身上时，可以正常点击桌面图标和其他窗口；鼠标在猫身上时，渲染进程能收到 click 事件（先用 console 打印验证）。

### 阶段 B：自由活动

**步骤 4：动作管理器 + 程序化骨骼**
- 任务：
  - `Cat.js` 提供 `play(name, { loop, fade })` 和 `onFinished(cb)`。
  - 动作找不到时，回退到程序化版本或 `idle`。
  - 当前 GLB 里没有 `idle`，先用 `CatRigAction` 的静止帧加上程序化呼吸来做一个 `idle`。
  - 新建 `src/pet/procedural.js`，放这些程序化效果：呼吸、甩尾（`tail1`–`tail5`）、抖耳朵、转头看目标（限制角度），以及程序化走路（腿部骨骼正弦摆动加身体上下起伏），作为 `walk` 的临时方案。
  - 程序化效果在 `mixer.update()` 之后叠加。
- 改动文件：`src/pet/Cat.js`、`src/pet/procedural.js`、`src/config.js`
- 验收：在开发者控制台调用 `cat.play('walk')`、`cat.play('idle')`、`cat.play('push_cup')`，都能切换，过渡平滑（0.25 s 淡入淡出）；调用不存在的动作不报错；头会跟着鼠标转，而且不会拧过头。

**步骤 5：状态机 + 自由走动**
- 任务：
  - `src/pet/stateMachine.js` 实现通用状态机（`enter` / `update` / `exit`），先接入 Idle、Walk、Sit 三个状态。
  - Walk 随机选目标 x 坐标，按速度移动，根据方向翻转模型朝向，到屏幕边缘转身。
  - 各状态的停留时长和切换权重都从 `config.js` 读取。
- 改动文件：`src/pet/stateMachine.js`、`src/pet/Cat.js`、`src/main.js`、`src/config.js`
- 验收：放着不管 5 分钟，猫会在 Idle、Walk、Sit 之间自己切换，走路时朝向正确、不出屏幕、脚不滑步（移动速度和腿部摆动节奏大致匹配）。

**步骤 6：拖拽与下落**
- 任务：
  - 按住猫拖动时进入 Dragged：猫跟着鼠标，程序化做出身体下垂、尾巴摆动的样子。
  - 松手进入 Fall：带重力落回底边，落地时做一个压扁再回弹的效果，然后回到 Idle。
  - 拖到屏幕外时，把猫限制在屏幕范围内。
- 改动文件：`src/pet/stateMachine.js`、`src/pet/interaction.js`（新建）、`src/pet/procedural.js`
- 验收：猫可以被拖到屏幕任意位置，松手后自然落下；拖拽时猫不会穿过屏幕边缘；拖拽途中点击穿透不会意外打开。

**步骤 7：随机动作 + 睡觉**
- 任务：
  - 加入 RandomAction 状态：从动作池（`push_cup`、`lick_paw`、`stretch`、`yawn`、`tail_wag`）中按权重随机选；没做好的动作用程序化临时版本，或者直接跳过。
  - 加入 Sleep 状态：趴下、呼吸变慢、冒"Zzz"。
  - 渲染降到 15 fps。
- 改动文件：`src/pet/stateMachine.js`、`src/pet/procedural.js`、`src/main.js`、`src/config.js`
- 验收：10 分钟内能看到至少 3 种不同的随机动作和一次睡觉；睡觉时任务管理器里的 CPU 占用明显下降。

### 阶段 C：互动

**步骤 8：点击互动 + 气泡**
- 任务：
  - `interaction.js` 区分这几种手势：单击、双击、抚摸（来回划 ≥3 次）、连点（短时间内 >6 次）、拖拽。
  - 分别触发对应的 React 反应（见上面"点击互动"表）。
  - 新建 `src/ui/bubble.js`：用 HTML 覆盖层在猫头顶显示气泡，跟随猫的位置，几秒后自动消失。
  - 新建 `src/ui/particles.js`：爱心和怒气粒子。
  - 点击睡觉中的猫会把它叫醒。
- 改动文件：`src/pet/interaction.js`、`src/pet/stateMachine.js`、`src/ui/bubble.js`、`src/ui/particles.js`
- 验收：每种手势都有不同反应，不会互相误判（双击不会先触发一次单击反应，拖拽不会被判成抚摸）；抚摸有冷却时间，冷却期间不会刷数值。

**步骤 9：右键菜单 + 托盘**
- 任务：
  - 新建 `src/ui/menu.js`：右键点猫弹出自绘菜单（喂食、玩毛线球、逗猫棒、睡觉、状态）。
  - 主进程加系统托盘（图标 + 同样的菜单项 + 退出），托盘通过 IPC 把命令发给渲染进程。
  - 菜单项先只打印日志，具体功能在后面的步骤接上。
- 改动文件：`src/ui/menu.js`、`main.js`、`preload.js`、`assets/icon.png`
- 验收：右键菜单打开时点击穿透保持关闭，点菜单外面菜单会关掉；托盘"退出"能正常关闭程序，没有残留进程。

### 阶段 D：喂食与玩耍

**步骤 10：数值系统 + 存档**
- 任务：
  - 新建 `src/pet/stats.js`：维护饥饿、心情、精力三个值，按"数值"一节的规则衰减，并影响状态机的行为权重。
  - 主进程读写 `userData/pet-state.json`：退出时保存，启动时按离线时长补算，补算有上限。
  - 新建 `src/ui/statusPanel.js`：从菜单"状态"打开，显示三个进度条。
- 改动文件：`src/pet/stats.js`、`src/pet/stateMachine.js`、`src/ui/statusPanel.js`、`main.js`、`preload.js`
- 验收：数值随时间变化；重启后数值能接上；把 `config.js` 里的衰减率调大后，能看到猫明显更常睡觉或冒"饿了"气泡。

**步骤 11：喂食**
- 任务：
  - 新建 `src/pet/feeding.js`：点"喂食"后，在鼠标位置生成食物（先用 PNG 精灵），可以拖动，放下后落到地面。
  - 猫进入 Eat 状态：走过去、播 `eat`（没有这个动作时，先用程序化低头动作代替），食物逐渐缩小消失，然后更新数值。
  - 饥饿值很低时猫摇头拒绝，不吃。
- 改动文件：`src/pet/feeding.js`、`src/pet/stateMachine.js`、`src/pet/stats.js`、`assets/items/`
- 验收：完整走一遍喂食流程，饥饿值正确下降；吃东西时不会被随机行为打断；连续放多个食物时猫会一个一个吃。

**步骤 12：玩耍：毛线球**
- 任务：
  - 新建 `src/pet/play.js`：毛线球可以拖拽和抛出，有简单物理（重力、地面摩擦、碰到屏幕边缘反弹）。
  - 猫进入 Play 状态追球，追上后播 `play_bat`（没有时用程序化抬前爪），把球拍出一个随机速度。
  - 玩耍让心情上升、精力下降；精力太低时猫不玩了，改去睡觉。
  - 一段时间没人碰球，球会自动消失。
- 改动文件：`src/pet/play.js`、`src/pet/stateMachine.js`、`src/pet/stats.js`、`assets/items/`
- 验收：抛出的球运动自然，不会卡进屏幕边缘；猫能追上并拍球，至少能连续来回 3 次；精力低时猫停止玩耍。

**步骤 13：玩耍：逗猫棒**
- 任务：
  - 开启逗猫棒模式后，羽毛跟随鼠标（这时只在羽毛附近关闭点击穿透）。
  - 猫的反应依次是：盯着看（头部追踪）→ 跟过去 → 压低身体、屁股扭动 → 扑。
  - 鼠标快速移动会刺激猫扑过去。按 `Esc` 或在菜单里点击可以退出这个模式。
- 改动文件：`src/pet/play.js`、`src/pet/procedural.js`、`src/pet/stateMachine.js`
- 验收：逗猫棒模式下，桌面其他地方仍可以正常点击；猫的反应能看出上面几个阶段；退出模式后猫回到 Idle。

### 阶段 E：打磨与发布

**步骤 14 🎨：Blender 补齐动作并替换 GLB**（可以从步骤 4 开始并行做）
- 任务：
  - 按"动作来源"一节的命名约定制作动作；`walk` / `run` 做成原地循环。
  - 导出时勾选"导出所有 Actions"，替换 `assets/models/cat.glb`。
  - 代码侧删掉被 Blender 动作替代的程序化临时版本（呼吸、甩尾这类叠加效果保留）。
- 验收：写一个脚本 `tools/check-glb.js`，列出 GLB 里的动作名，和命名约定对照，没有缺失；所有状态都用上了正式动作。

**步骤 15：音效 + 性能优化**
- 任务：
  - 加入喵叫、呼噜（被抚摸时）、吃东西的音效，托盘里可以一键静音。
  - 检查帧循环里有没有新分配的对象；不可见或睡觉时降低帧率；检查内存会不会越用越多。
- 验收：持续运行 1 小时，内存稳定，不会一直上涨；空闲时 CPU 占用低于 5%。

**步骤 16：打包发布**
- 任务：
  - 用 `electron-builder` 打 Windows 安装包，配置应用图标，在托盘加"开机自启"开关（`app.setLoginItemSettings`）。
  - 更新本文件的"常用命令"一节。
- 验收：在一台没有装开发环境的 Windows 电脑上安装并运行，所有功能正常；卸载后没有残留的开机启动项。
