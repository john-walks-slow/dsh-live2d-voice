# 验证报告：261010 触摸模式（手指视线 · 手势动作 · HUD 拆层）

被测提交：worktree `feat/live2d-interaction` 的 `2224c69`（触摸模式 + HUD 拆层）与 `a928177`（flick/Shake 手势动作）。
环境：`dsh-e2e` 隔离实例（worktree home、动态端口、零真实 API：`POST /live2d-voice/session` 空会话 + standalone/`/app` 入口）。

## 一、功能项

| 项 | 方法 | 结果 |
|---|---|---|
| 触屏单指按下即跟视线（符号与落点同侧） | `verify-touch-mode` T1a/T1c（合成 `pointerType:'touch'` 事件） | ✓ `lvTouchLook=-0.600,0.086` / `0.600,-0.143` |
| 抬手后视线回落（清空活动向量） | T1b | ✓ |
| 触摸模式下单指**不**平移、双指仍平移 | T2a/T2b（`lvTransform` 0,0,1.000 不变 → 双指后 120,0,1.000） | ✓ |
| 第二指落下即取消手势判定 | T3（双指参与后 `lvTap` 不变） | ✓ |
| 触摸模式下 tap 仍触发 Tap 动作 | T6（`Body:Tap`） | ✓ |
| 鼠标 hover 跟视线且不平移 | T4/T4b | ✓ |
| 关闭触摸模式回到旧语义 | T7（单指恢复平移、不写 `lvTouchLook`、不触发手势） | ✓ |
| 全屏按钮在右上角簇且在安全区内 | T5a（`{top:10,right:10}`） | ✓ |
| root layer 不吃指针（层外起手拖动 = 转视线而非平移） | T5b/T5c | ✓ |
| 视线方向受控度量 | T8（见下） | ✓ |
| 手势组选择纯函数表驱动 | T10a–T10g | ✓ |
| izumi 右划/左划 → FlickRight/FlickLeft | T4a/T4b | ✓ |
| 缺方向组回退（izumi 无 `FlickDown` 也无裸 `Flick` → `Shake`） | T4c | ✓ |
| 只有 `Flick` 的模型回退（chitose） | T6a | ✓ `Right:Flick` |
| 只有 `Shake` 的模型回退（oc/luna） | T6b | ✓ `Right:Shake` |
| 连续快划不刷屏（400ms 冷却 + 动作让位） | T5（A 改写成功、140ms 后的 B 不改写） | ✓ |
| 无页面错误 | T9 | ✓ |
| **点击互动回归** | `verify-tap` 11/11（同一分支、同一实例） | ✓ |
| **standalone 全屏回归** | `verify-standalone-fullscreen` 6/6（N3 原生全屏、N4 几何、退出） | ✓ |

## 二、HUD 拆层的等价性取证（auto-human 的 4 项核对）

1. **胶囊盒子逐像素等价**：把新增的触摸模式按钮隐藏、把全屏按钮临时挪回胶囊原位后，`.lv-capsule` 的 rect 与改动前 `.lv-hud` **完全相同**（`316.5, 620, 267×48`）；胶囊区域像素差异 **23/16740 = 0.14%**，最大通道差 19（抗锯齿级）。脚本 `capsule-baseline.mjs`（改前基线）、`capsule-equiv.mjs`（改后等价性）。
2. **绝对定位后代盘点**：`.lv-hud` 子树里唯一的绝对定位元素是 `.lv-pop`，其 containing block 从 `.lv-hud` 变成 `.lv-capsule`（同一个盒子），实测计算值 `bottom = padding-box(46px) + 12px`、右对齐一致 ✓；`.lv-btn` 自身 `position:relative`，所以 `.lv-btn.lv-mic-live::after` 的脉冲光环仍锚在按钮上。其余（`.lv-micbar` / `.lv-input` / `.lv-toast` / `.lv-center` / `.lv-calib-*` / `.lv-root:fullscreen`）都不是 `.lv-hud` 后代，锚点不受影响。
3. **几何读取面**：e2e 里没有任何一处读 `.lv-hud` 的 rect/offset；只有 `display:none` 隐藏（`verify-fullscreen-usable`、`verify-keyboard-squish` 做像素测量时用——层化后隐藏整层会连带隐藏角落簇，模型 bbox 更干净）、存在性布尔（`verify-live`/`verify-standalone*`）与后代点击选择器（`.lv-hud button[title*=…]`、`.lv-hud .lv-mic`、`.lv-hud [title*="快捷调整"]`）——**0 处 e2e 改动**。
4. **淡出与可达性**：`layer-checks.mjs` 4/4 —— root layer `pointer-events:none`、`.lv-pop` 锚点、角落簇淡出 0.45、`focus-within` 提亮 ✓（`.lv-hud.lv-mic-live.lv-faded` 例外只抬胶囊）。

## 三、视线方向度量与阈值标定（T8）

- 方法：手指固定在画面左 12% / 右 88% 处按住，各等视线 settle 900ms 后截帧；用 PIL（复用 `verify-fullscreen-usable` 的角落采样背景法）在**上半屏**取非背景像素的**水平质心**（按屏宽归一）。
- 实测（haru / 900×700 / 第一人称）：`left=0.3575`、`right=0.6466` → **位移 0.2891**；同一位置连拍两帧漂移 **0.0002**。
- 阈值取 **0.05**（噪声的 250 倍、信号的 1/6），方向断言（右 > 左）同时成立。数值写进套件注释。

## 四、未覆盖 / 说明

- **三个 GUI 全屏套件未通过（环境所限，非本改动回归）**：`verify-fullscreen-usable` / `verify-fullscreen-keyboard` / `verify-keyboard-squish` 都需要实例里存在**真实 chat 会话**（点 `[role="treeitem"].sessionRow` → 会话页签 "Live2D"），最小 e2e 实例只有空会话，故在 `waitForSelector('.lv-root .lv-stage canvas')` 超时失败——失败发生在与 HUD 交互之前，与本改动无关。等价覆盖由 `verify-standalone-fullscreen`（走 standalone 入口的角落全屏按钮 + 原生全屏 + 几何）与 `verify-touch-mode` T5a/T5b 承担。
- **玩家化身**没有独立的手势/空闲调度；**鼠标**不做 flick；**参数面板/表情选择器**不在本轮（计划 §二非目标）。
- 主观手感（跟手程度、滑动阈值是否顺手、角落按钮位置）请用户真机确认，见 §五。

## 五、真机验收清单（触摸模式）

1. 打开触摸模式（工具条手指按钮或 ⚙ 面板），先看一次性提示是否出现（每个浏览器只出现一次）。
2. 手指按住屏幕不同位置：角色头/眼跟着手指转；松手后约 0.5 秒缓动回落到摄像头视线（没开视线追踪则回中位）。
3. 单指**不再**平移模型；两根手指才能平移/缩放；双击复位照常。
4. 轻触角色 → 触发它自己的 `Tap` 动作；快速左右/上下划 → `Flick` 系列动作；连续快划不会"打满动作队列"。
5. 鼠标（桌面）：不用按键，鼠标移到哪看哪；按住拖动仍是平移、滚轮缩放。
6. 角落的全屏按钮在右上角、不被手机状态栏/下拉手势遮挡；全屏按钮仍可进出全屏。
7. 关掉触摸模式后：单指拖动恢复平移，角色不再跟手指。
8. 语音通话时手势撞上正在播的剧本动作会被静默忽略（等它播完再划）——这是刻意行为，不是失灵。

## 六、检视跟进（2026-10-10）

检视结论 **准入**（无阻塞项），三条建议与两条备忘的处理：

- **ADV-01（已补）**：⚙ 系统设置卡新增 `touchMode` 开关（与 HUD 手指按钮同源、同配置），README 的"⚙ 面板同开关"不再是空话；开关旁写明"单指不再平移，手感不对就先关掉"。
- **ADV-03（已修）**：松手后的 450ms 回落改为**朝摄像头视线插值**（无摄像头则朝中位），不再先衰减到 0 再瞬切回摄像头。
- **INF-02（已加固）**：`localStorage` 读取/写入包了 try/catch（隐私模式下不再可能中断切换）。
- **ADV-02（记为后续重构）**：`mountModel` 位置参数已到 8 个，建议后续统一收敛为 `options` 对象；本轮不改以免扩大改动面。
- **INF-01（备忘）**：触屏与鼠标混用时的指针状态交叠已被 hover/touch 互斥逻辑挡住，仅留作边界记录。

补充验证（改动后复跑）：`verify-touch-mode` **33/33**、`verify-tap` **11/11**、`verify-look-math` **17/17**。

### 追加：两个由"自我加码"的用例抓出来的真问题

1. **`touchMode` 没有进 host 的保存白名单**（`src/routes.ts` 的 `patch` 允许列表）：HUD/设置卡的开关在 UI 上会亮灭、`saveConfig({touchMode})` 也照发，但 host 端**静默丢弃**，配置里永远是旧值。这是 T11「HUD 开关落盘且可还原」抓到的（`true → true → true`，而不是 `true → false → true`）。修好后 `true → false → true`。
   → 影响：这只是**触摸模式的持久化**，任何用户点开开关、刷新后都会发现又关了。修法 = 白名单加一行。
   → **副作用：这是 host 侧改动（`lib/index.js` 变了），线上实例必须重启 dsh 才能生效**（不是"刷新页面即可"）。
2. **松手回落的连续性**（ADV-03 改的行为）现在有断言：按住右侧松手后每 180ms 一帧，单帧质心位移最大 **0.087**、四帧累计回落 **0.136**，无跳变——这正是原来"先衰减到 0 再瞬切摄像头"会破坏的性质。

### 顺带记录的测试基建问题（今日落记录，另行排期）

`verify-fullscreen-usable` / `verify-fullscreen-keyboard` / `verify-keyboard-squish`（以及 `verify-settings-model`）都需要实例里有**真实 chat 会话或完整 GUI 状态**，在最小 e2e 实例里会在 `waitForSelector` 阶段超时失败。应改成"前置不满足时 skip 并明确报告（exit 0 + SKIP 行）"，否则全量跑永远三片红，容易掩盖真问题。已写入 `docs/references/260927-e2e-testing.md` 的待办段。

### 待办（不阻塞本次合并）

- ADV-02：`mountModel` 的 8 个位置参数收敛为 `options` 对象（记录在计划 §九）。
- 无会话 GUI 套件的 skip 语义（上面那条）。
