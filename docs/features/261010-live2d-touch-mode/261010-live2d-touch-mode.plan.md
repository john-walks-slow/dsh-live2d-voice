# 261010 触摸模式：工具条开关 · 手指视线 · 手势动作

> 用户原话：「工具条加一个触摸模式（可以把全屏和打开独立窗口挪个位置到左或右上角），打开之后角色视线会跟随手指位置；并且模型的手势事件也都可以触发」
> 承接：`docs/features/261010-live2d-interaction/`（P1 点击互动已落地：tap 判定 + `Tap<区域>`/`Tap`/`TapBody` 组选择 + `dataset.lvTap` 契约）。本需求把当时推到 P2 的 `Flick*`/`Shake` 一并接上。
> 工作方式：同一 worktree 分支 `feat/live2d-interaction` 继续（tap 基建直接复用），分两个 commit 交付。

## 一、目标

1. **工具条加"触摸模式"开关**（HUD 按钮 + ⚙ 面板同开关，持久化到配置）。
2. **布局腾位**：把「全屏」「独立入口」两个视图级按钮从底部胶囊挪到**右上角按钮簇**；角落按钮常驻但跟随 HUD 一起淡出。
3. **打开后视线跟随手指**（鼠标 hover 同理）。
4. **模型的手势事件全部可触发**：tap（已有）+ 快速滑动 → `Flick<方向>` → `Flick` → `Shake`。

## 二、非目标

- 不为「左右来回划」做专用 Shake 识别（Shake 只做无方向组时的兜底）。
- 不给鼠标做 flick（快速拖拽与平移不可区分）。
- 不做长按/双击手势动作、不做触摸模式下的表情反馈。
- 不动 Cubism Core / moc3 v6（见 `docs/features/261010-live2d-core-v6/`）。

## 三、设计（已按 auto-human 裁决定案）

### 3.1 布局重构

`.lv-hud` 目前**就是胶囊本体**（`position:absolute; bottom:…; left:50%; inline-flex`），角落按钮若挪出 `.lv-hud` 会打断 3 个套件的选择器（`verify-fullscreen-keyboard.mjs:81`、`verify-fullscreen-usable.mjs:56/57/93/158`、`verify-standalone-fullscreen.mjs:61`）。因此改为**同一根节点内的两层**：

```
.lv-hud                     ← 舞台 UI 层：inset:0; pointer-events:none; z-index:9
├── .lv-capsule             ← 原胶囊样式（**保留绝对定位** bottom/left:50%/translateX(-50%)）+ pointer-events:auto
│   └── .lv-pop             ← 快捷面板仍锚定它（绝对定位元素自身即 containing block，**不要**再加 position:relative，会把胶囊踢出绝对定位）
└── .lv-corner              ← 右上角簇 + pointer-events:auto（全屏 / 独立入口）
```

- 好处：`.lv-hud button[title*="全屏"]` 这类后代选择器**继续命中**；像素测量里 `display:none` 隐藏 `.lv-hud` 会**连带隐藏角落按钮**，模型 bbox 不被污染；`.lv-hud.lv-faded` 天然覆盖两块。
- 淡出规则改为子元素作用域（现在 `.lv-hud:hover` 在整层上会永远为真）：

  ```css
  .lv-hud.lv-faded .lv-capsule:not(:hover):not(:focus-within),
  .lv-hud.lv-faded .lv-corner:not(:hover):not(:focus-within) { opacity: .45 }
  /* 麦克风常显例外只抬胶囊，角落维持 .45 */
  .lv-hud.lv-mic-live.lv-faded .lv-capsule { opacity: .85 }
  ```
- 角落按钮留安全区：`top: calc(env(safe-area-inset-top, 0px) + 10px)`、`right: calc(env(safe-area-inset-right, 0px) + 10px)`（手机右上角是系统下拉手势区，不贴边）。
- `.lv-stage` 已有 `touch-action:none`（确认过），无需新增；HUD 按钮 `pointerdown` 一律 `stopPropagation`，避免落点被舞台手势层当成触摸视线。

### 3.2 触摸模式与输入分叉（按 `pointerType`）

配置项 `touchMode: boolean`（默认 `false`，持久化；HUD 按钮 + ⚙ 面板同开关；README 单开一节）。

| 设备 | 单指 / 指针 | 双指 | 滚轮 |
|---|---|---|---|
| touch / pen | **视线跟随 + 手势**（tap / flick），不平移 | 平移 + 缩放（沿用现有 pinch/pan 分支） | — |
| mouse | **hover 即视线**（不按键）；拖拽保持平移（现状）；不做 flick | — | 缩放（现状） |

- **手指数切换要干净**：第二根手指落下 → 立刻取消进行中的 tap/flick 判定与视线跟随（现有 `press = null` 语义保留并扩到 flick/视线）；从双指抬起一根 → **不得**反过来触发 tap/flick。
- `pointercancel` → 清视线与手势状态（防止系统下拉刷新打断后卡住）。

### 3.3 视线跟随

- 新增第三源 `touchLookRef`（归一化 `dx/dy`，相对 stage 中心；触点越靠边幅度越大，饱和 ±1）。
- 优先级：**手指/鼠标 > 摄像头视线 > 陀螺仪**；不硬切，松手后 **300–500ms 缓动回落**到上一可用源（都没有则回中位）——不采用"保持 2 秒"，静止的视线会被当成卡死。
- 复用现有 look 管线：活跃期把 `touchLookRef` 当 `cam` 源喂给 `setLook`（摄像头源让位），回落期做 `lerp` 到摄像头/陀螺仪值。
- 第三人称（dual）**跟随现有增益，不特例**：dual 下角度增益已归零（"对视"世界观），触摸视线同样不转头，只保留位移视差通道。

### 3.4 手势动作（commit 2）

- **tap**：沿用 P1（`Tap<区域>` → `Tap` → `TapBody`，NORMAL 优先级，不打断正在播的动作）。
- **flick**：起点必须 `hitTest` 命中模型（与 tap 一致：背景划动只跟视线，不驱动角色）；判定 `距离 > 40px`、`总时长 < 400ms`、`平均速度 > 0.5px/ms`；
  **方向一律取主轴较大者**（`|dx| >= |dy|` 即水平、否则垂直），**不存在"斜划走兜底"**——兜底只发生在"模型确实没有该方向的组"时：
  `Flick<Up|Down|Left|Right>` → `Flick` → `Shake` → 无则不动。
- **冷却 400ms**：冷却期内不触发新手势（防止连划打满动作队列把模型锁死）。
- **优先级**：与点击一致用 **NORMAL**（框架 `MotionState.reserve`：NORMAL 只打断 IDLE，不打断 NORMAL/FORCE）。实据：剧本动作（LLM 打的 motion tag）走 `view.tsx:913 playMotion(def)` → `model.ts playMotion` 默认 `force`，所以手势**不该**用 FORCE 去压掉剧本动作。
  **副作用（写进 README，不要承诺"随时可触发"）**：手势撞上正在播的 FORCE 动作时是**静默不响应**（不写 `lvGesture`）；剧本动作只持续几秒，可接受。
- **可发现性**：首次开启触摸模式弹出一次性一行提示（localStorage 记住已提示）："轻触角色有反应 · 滑动切换动作 · 双指缩放"。

### 3.5 新增诊断契约（e2e 用）

- `dataset.lvTouchLook` = `"dx,dy"`（活动期）| 清空/`"none"`（空闲）——落到 `.lv-stage`。
- `dataset.lvGesture` = `"<方向>:<实际组名>"`（每次 flick 成功起播时写；冷却/被忽略时不写）。

## 四、实现落点

| 文件 | 改动 |
|---|---|
| `src/client/styles.ts` | `.lv-hud` 拆层（`.lv-capsule` / `.lv-corner`）+ 淡出规则改子元素作用域 + 安全区 |
| `src/client/hud.tsx` | 结构拆层；新增触摸模式按钮（`icons.tsx` 加手指图标）；全屏/独立入口移入 `.lv-corner` |
| `src/client/icons.tsx` | 新增 `IconTouch`（手绘 SVG，与现有风格一致） |
| `src/client/model.ts` | 触摸视线源（pointer 分支）、flick 判定 + 组选择 + 冷却、契约写入、`pointercancel` 清理 |
| `src/client/view.tsx` | `touchMode` 状态与配置读写、视线回落缓动、一次性提示、把 `touchMode` 传给 stage 层 |
| `src/client/settings-section.tsx` | 触摸模式开关（与 HUD 同源） |
| `src/client/types.ts` / `src/config.ts` | `touchMode` 配置字段与默认值 |
| `README.md` | 触摸模式一节（语义、鼠标/触屏差异、flick 不适用鼠标） |
| `e2e/verify-touch-mode.mjs` | 新增套件（见下） |
| `e2e/run.mjs` | 挂进 `gaze` 模块 |

## 五、验证方案

新增 `e2e/verify-touch-mode.mjs`（空会话 + standalone，配置显式设置 `touchMode` 并在结束时恢复，避免本机残留污染断言）：

1. 触摸模式开启后单指按下/移动 → `lvTouchLook` 出现且符号与落点一致；松手后 ≤600ms 回落（`lvTouchLook` 清空）。
2. 触摸模式下**单指不平移**（`lvTransform` 不变）、**双指可平移缩放**（`lvTransform` 变化）。
3. 双指落下时 tap 不触发（`lvTap` 不变）；从双指抬起一根也不触发。
4. flick：快速右划 → `lvGesture` = `Right:FlickRight`（样本 `official/izumi`：FlickRight/FlickLeft + Shake + Tap）；快速左划 → `Left:FlickLeft`。
5. 冷却：两次快速划动间隔 < 400ms → 第二次不写 `lvGesture`。
6. 方向组缺失时的回退（依赖已核实）：有方向组的用 `official/izumi`；只有 `Flick`（无方向）的用 `official/chitose`；只有 `Shake`（无 Flick/Tap）的用 `oc/luna`。**另外把组选择抽成纯函数做表驱动断言**（方向组存在/缺失/只有 Flick/只有 Shake/全无），不依赖模型即可覆盖全部分支。
7. 布局回归：`.lv-hud button[title*="全屏"]` 仍可点；角落按钮在 safe-area 内；全屏态下退出按钮可点（复用现有 fullscreen 套件跑一遍）。
8. **视线方向的受控度量**（不靠裸帧 diff——模型一直在呼吸/眨眼，裸 diff 无法归因）：
   - 手指固定在画面左侧 vs 右侧，各等视线 settle（≥600ms）后截帧；
   - 用 PIL 复用 `verify-fullscreen-usable.mjs` 的"角落采样背景 → 非背景像素"方法，在**头部区域（模型 bbox 上半部）**求非背景像素的**水平质心**；
   - 断言 `|质心(右) - 质心(左)| >= 阈值`、且方向与手指同侧；**阈值由首次实测标定并记入 validation 文档**；
   - **null case**：同一触摸位置连取两帧，质心漂移 < 阈值（证明阈值不是噪声）。
   - 单人模式（第一人称）跑，避免第三人称角度增益归零干扰。

## 六、交付拆分

1. **commit A**：布局拆层 + 触摸模式开关 + 视线跟随 + 一次性提示 + `lvTouchLook` 契约 + `verify-touch-mode.mjs` 的 1/2/3/7/8 项。
2. **commit B**：flick 判定 + 组选择 + 冷却 + `lvGesture` 契约 + 套件 4/5/6 项。

## 七、风险

- **鼠标语义**：触摸模式持久化 + 鼠标 hover 即视线，可能让桌面用户"莫名跟随鼠标"→ README 说明 + 一次性提示。
- **淡出 CSS 重构**：`.lv-hud:hover` 的作用域搬移容易漏掉 `.lv-mic-live` 例外，改动后必须跑 `verify-fullscreen-usable` / `verify-keyboard-squish`（它们会隐藏 `.lv-hud` 做像素测量）。
- **手势与视线互斥**：单指既要跟视线又要判手势，实现上**同一份 pointer 状态**驱动两者，避免两套判定打架。
- **动作队列锁死**：靠 NORMAL 优先级 + 400ms 冷却双保险；e2e 有冷却断言。
- **实例紧张**：P1 的 e2e-tester 验收未结束前不重建 lib、不抢实例；本需求验证与 P1 验收串行。

## 八、revision r2（auto-human 审阅后定稿）

1. **验证项 8 换方法**：裸帧 A/B 在呼吸/眨眼下无法归因 → 改为"头部区域非背景像素水平质心"的受控度量 + 实测标定阈值 + null case（见 §五.8）；背景采样方法复用 `verify-fullscreen-usable.mjs` 的 PIL 代码。
2. **斜划不再走兜底**：方向一律取主轴较大者；`Flick<Dir>` → `Flick` → `Shake` 只在**模型缺该方向组**时依次回退。
3. **回退用例的依赖已核实**：`official/izumi`（有方向）、`official/chitose`（只有 `Flick`）、`oc/luna`（只有 `Shake`，无 Flick/Tap）；另加组选择纯函数的表驱动断言。
4. **布局实现细节**：`.lv-capsule` 保留绝对定位（它就是 `.lv-pop` 的 containing block，不要加 `position:relative`）；`lv-mic-live` 例外只抬胶囊（.85），角落维持 .45；`verify-live.mjs` 断言 `button count >= 5`，新增按钮后不破。
5. **优先级确认 NORMAL**（auto-human 更正其 FORCE 记忆）：剧本动作是 FORCE（`view.tsx:913 playMotion(def)` → `playMotion` 默认 force），手势不该抢占；裁员副作用"撞上 FORCE 动作时静默不响应"要写进 README。
6. 开工顺序：P1 验收结案 → 本计划定稿（本次）→ commit A。

## 九、实施状态（2026-10-10）

- **commit A（`2224c69`）**：HUD 拆层 + 触摸模式开关 + 视线跟随 + 一次性提示 + `dataset.lvTouchLook` + `verify-touch-mode.mjs` 的布局/视线/手势共存用例。
  - 层化等价性已取证：同按钮集合下 `.lv-capsule` rect 与旧 `.lv-hud` **完全相同**（316.5,620,267×48），胶囊区域像素差异 23/16740 = 0.14%（最大通道差 19，抗锯齿级）；工具脚本 `capsule-baseline.mjs` / `capsule-equiv.mjs` / `layer-checks.mjs` 留档。
  - `layer-checks`：root layer `pointer-events:none`、`.lv-pop` 仍锚定胶囊（计算值 bottom = padding box + 12px）、角落簇淡出 .45、键盘聚焦提亮 ✓。
  - 视线方向受控度量（haru / 900×700 / 第一人称）：手指左右两端时头部区域非背景像素水平质心位移 **0.289**，同位置两帧漂移 **0.0002** → 阈值取 **0.05**（噪声的 250×、信号的 1/6）。
- **commit B**：flick/Shake 手势动作 + 纯函数模块 `gesture-math.ts` + 回退样本用例 + 冷却防刷屏。
  - 实测校准：izumi 只有 `FlickRight`/`FlickLeft` + `Shake`（**没有裸 `Flick`**），下划时正确回退到 `Shake`；chitose（只有 `Flick`）右划 → `Right:Flick`；`oc/luna`（只有 `Shake`）→ `Right:Shake`。
  - 冷却用例按可观测行为断言：一次起效后 140ms 内的第二次滑动不改写 `lvGesture`（冷却与"动作播放中 NORMAL 让位"共同作用）。
- 未做（按计划留给后续）：玩家化身的独立空闲/手势调度、鼠标 flick、参数面板。
