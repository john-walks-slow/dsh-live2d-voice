# 需求计划：自然视线行为（Lively Gaze）—— 让角色"看人"像真人

> 调研报告：`docs/features/260925-lively-gaze/260925-gaze-behavior-research.md`（23 轮搜索 + 5 轮抓取，全部参数锚点带来源）
> 状态：待用户对齐

## 1. 需求背景与目标

### 现状（为什么死板）

当前视线链路：MediaPipe FaceLandmarker 检测用户鼻尖 → `camLookRef` → 每帧 `setLook()` → 指数平滑后驱动头/身/眼参数（`ParamAngleX/Y/Z`、`ParamBodyAngleX/Y`、`ParamEyeBallX/Y`）。

死板点（用户原话归纳）：

1. **只要脸在画面里就永远盯着鼻尖** —— 没有"用户是否在看我"的概念，用户低头/转头时角色仍死死盯住。
2. **没有自然的注视节律** —— 真实人类对话中互视单次只有 0.5–3 秒、超过 ~3.3 秒就不适；角色现在是无限期凝视。
3. **没有微动** —— 没有扫视（saccade）、微扫视、思考时移开目光、话轮边界的看/移开信号；眼球像石膏像。
4. **行为与对话状态无关** —— 说话/倾听/思考时人类的注视模式差异很大（说话 ~50–65% 看向对方、倾听 ~80–90%、思考回避 ~70–80%），角色全都不区分。

### 目标

把"追踪用户位置"升级为"**感知用户注意力 + 模拟人类社交视线行为**"：

- 用户看着角色 → 角色回应眼神交流（互视，0.5–3s，峰值 <4s），然后自然移开。
- 用户不看 → 角色自己游移/扫视四周/发呆，偶尔"好奇地瞥一眼"用户。
- 对话状态驱动：说话时约 1/3 时间移开（开口移开、句尾看回移交话轮）、倾听时高注视率、思考时高回避率。
- **头部行为（本计划一并做活）**：头不再只是眼睛的"跟班"——眼-头-身按偏移幅度分派（小偏移只有眼动、中偏移带头、大偏移头主导身体跟随）；叠加独立头姿行为：说话节奏微点头、倾听认同点头、思考/好奇歪头、视线回避时头也转开、呼吸同相位的头部轻摆。
- **身体行为**：大角度注视时身体转向（滞后于头）+ 低频重心微摆（3–8s 周期），与 motion-and-ui 的动作系统分层（我们管持续微姿态，他们管时间轴大动作，播放时我们让位）。
- 眼球的"活"：扫视动力学 + 微扫视/粉噪声抖动（眨眼/呼吸已由 SDK 内置，不动）。
- **算法化 + 序列化**：状态机（随机时序分布）为基底，叠加命名"行为脚本序列"（如 thinking / turn-yield / wander / nod / head-tilt），可测试、可调参、后续可扩展成可配置脚本。

### 非目标（本期不做）

- 不重做眨眼（`pixi-live2d-display` 内置 `Live2DEyeBlink`，间隔 4s±随机，已达标）。
- 不做 WebGazer 式屏幕注视点标定（头姿 + 虹膜比例足够判断"是否看向屏幕"）。
- 不引入新 ML 模型（全部为纯算术 + 已有 FaceLandmarker 输出）。

---

## 2. 用户视角的使用路径

1. 用户在设置/⚙ 面板打开「视线追踪」，模式选「自然」（新增）。打开后：
   - 手机正对角色说话 → 角色看向用户眼睛、偶尔移开；用户低头回消息 → 角色不盯了，自己东看西看、发呆、扫视，偶尔抬眼瞥一下用户。
   - 角色开口说话 → 开口时先移开目光再回看；句子结尾 → 看向用户（话轮移交）；思考卡顿时 → 看别处。
   - 用户说话时 → 角色认真听（高注视率），但每几秒会短暂移开一下（真实倾听者也会）。
2. 用户不开摄像头（或不开视线追踪）→ 「自然视线」仍可单独启用：角色平时有眼球微动、周期性扫视/游移，不再是一尊"不动眼"的雕像。
3. 第三人称双角色模式（当前 phase 2 范围）→ 两个角色互相看着对方说话、偶尔各自移开目光（舞台剧式），而不是互相呆望。

---

## 3. 方案设计

三层结构，与现有代码分层一一对应：

```
┌─ 感知层（新）   GazeTracker 扩展：头姿 + 虹膜 → userLooking 判定
├─ 行为层（新）   BehaviorController：状态机 + 随机时序 + 行为脚本序列 → 视线/头姿/身姿意图
├─ 驱动层（改）   model.ts：眼-头-身三级分派、扫视动力学、微扫视/粉噪声、点头/歪头/重心微摆 → Live2D 参数
└─ 整合/配置（改） view.tsx 接线 + config 模式开关 + HUD/设置 UI
```

### 3.1 感知层：判断"用户是否正在看角色"

在现有 `GazeTracker`（gaze.ts）上扩展，零新增模型：

1. **头部姿态**：FaceLandmarker 创建时开 `outputFacialTransformationMatrixes: true`（已确认本机装的 tasks-vision 版本支持，返回 4x4 变换矩阵），对矩阵做标准欧拉角分解得到 yaw/pitch/roll（参照现成浏览器 demo thshao2/head-tracking-pose-estimation）。
2. **眼球朝向**：478 点网格自带虹膜点（左 468/右 473），用 GeoGaze 的"虹膜相对眼角位置比"ρh（左眼角 33/133、右眼角 362/263），阈值 0.40/0.60 分档（<0.40 看左 / >0.60 看右 / 中间为中心），纯算术。
3. **合成判定**：`looking = |yaw|<10° && |pitch|<10° && |ρh−0.5|<0.15`（Vonage 注意力评分阈值）；输出端做 **低通 + 迟滞**（进入阈值 0.6、退出 0.4，~300–500ms 去抖）—— webcam 眼部信号噪声大、必须强平滑是本领域共识（VTube Studio 文档）。
4. 脸丢失（现有 2.5s 逻辑）→ `userLooking=false`。
5. 新增事件：`onUserLook(looking: boolean, meta: { yaw, pitch, rho })`，与原 `onGaze`（脸位置）并行输出。脸位置语义不变，向后兼容。

### 3.2 行为层：GazeBehaviorController（新模块 `src/client/gaze-behavior.ts`）

**纯逻辑、无 DOM、注入 RNG 与时钟（可单测）**。输入输出：

```ts
interface GazeBehaviorInput {
  face: { x: number; y: number } | null;   // 用户脸位置（0..1，现有）
  userLooking: boolean;                     // 感知层输出
  speaking: "assistant" | "player" | null;  // 谁在说话（engine.currentSpeaker）
  userSpeaking: boolean;                    // 用户在说话（mic/VAD/ASR interim）
  thinking: boolean;                        // 用户提交后、assistant 开口前（生成中）
  sentenceBoundary: boolean;                // 句子/音频块边界脉冲（SSE audio/subtitle）
  emotion?: string;                         // 当前表情标签（v1 仅微调，可后置）
  rng?: () => number; clock?: () => number; // 测试注入
}
// 输出：屏幕空间注视目标（0..1，null=回中性位）+ 头姿/身体姿态意图 + 当前行为状态（供调试/UI/dataset）
interface BehaviorOutput {
  x: number | null; y: number | null;      // 视线目标
  head: { nod: number; tilt: number; yawTurn: number }; // 点头/歪头/转头意图（-1..1）
  body: { sway: number };                  // 重心微摆相位/幅度
  state: BehaviorState;
}
```

**状态机**（参数全部来自调研 §5 锚点表）：

| 状态 | 触发条件 | 视线目标 | 头/身表现 | 时长分布 |
|---|---|---|---|---|
| `eye-contact` 互视 | userLooking 且非思考回避段 | 用户脸位置 | 微点头随说话节奏；小幅歪头 | 0.5–3s（峰值 <4s），指数/均匀采样 |
| `aversion` 回避 | 思考中（70–80% 概率）、说话开场、互视超时、停顿>800ms | 回避点（左下/右下/上，"思考点"） | 头随回避微转开，回归时眼先头后 | 0.3–1.5s（认知/社交/情感三类不同分布） |
| `wander` 游移 | 用户不在看、脸丢失、idle | 随机目标（airi 分布：每 0.8–4.4s 一次，峰值 1.2–2.4s） | 中/大偏移时头参与 | 单点驻留 0.4–2.4s |
| `scan` 扫视 | idle 周期（~10–20s 一次） | 缓慢横扫（左右/上下） | 头随扫视中幅转动 | 1–2.5s/次 |
| `thinking` 思考 | thinking 窗口 | 回避为主 + 偶尔回看 | 歪头（20–40% 概率）+ 眼放空 | 随生成时长 |
| `rest` 中性 | 无输入稳定期 | 中性位（现有 faceBiasX/中心） | 呼吸轻摆 + 低频重心微摆（3–8s 周期） | — |

**对话状态调制**（Mishra & Skantze 规划式 GCS + PLOS 2015 话轮规律）：

- `speech-start`（assistant）→ 回避段 0.5–1s（"开口移开"），之后回到互视/说话混合（说话期注视率 50–65%）。
- 句子边界（audioSeq 字幕事件）→ 句尾前 ~300–500ms 看回用户（话轮移交信号）。
- 停顿 >800ms（说话中无音频）→ 回避（"我还要继续说"信号）。
- `userSpeaking` → 倾听模式：注视率 80–90%，每 3–5s 一次 0.3–0.8s 的"检查性移开"。
- `thinking` → 回避率 70–80%（认知回避）。
- `emotion` 强情绪（v1 最小实现）：映射回避时长/下视倾向，默认跳过。

**序列化层（用户要的"sequence 化"）**：命名行为脚本模板，由加权模板选择器 + 随机时序生成：

```
thinking   = [aversion↓1.2s + tiltL 1.2s, aversion←0.8s, eye-contact 0.6s] × N   // 思考循环（视线回避+歪头）
turn-yield = [eye-contact 0.8s + nod 0.4s]                                     // 句尾移交（看回+点头）
attention  = [eye-contact 1.5s, aversion 0.4s, eye-contact 2s]                 // 用户开始看时"注意到了"
nod-agree  = [nod +2° × 2 次, 间隔 0.8s]                                       // 倾听认同
wander-idle= [target₁ 0.8s, target₂ 1.6s, …]                                   // 随机游移串
```

每个脚本 = `(视线目标/头姿/身姿, 驻留, 缓动)` 步骤序列；用**可种子 RNG** 生成 → e2e 可断言、日后可扩展为可配置脚本（VRM lookAt RangeMap 的分段映射格式可作序列化参考）。

**无摄像头模式**：`face=null` 时行为控制器照常跑（wander/scan/rest + 微动）——即"自然视线"可以脱离摄像头单独开启，这是对现有"不开摄像头就完全没眼神"的一大提升。

### 3.3 驱动层：model.ts 升级（眼-头-身三级分派 + 微动合成）

在现有 `beforeModelUpdate` 钩子（已是"motion 应用后、core 更新前"的正确覆盖时机，符合社区"update 后覆盖"经验）内：

1. **眼-头-身按幅度分派**（Andrist 眼头协调 + EGM 幅度阈值，替换现在的固定比例）：
   - 注视目标偏移 **小**（<~6° 视场角）→ 只有 `ParamEyeBallX/Y` 动；
   - **中**（6–30°）→ 眼 100% + `ParamAngleX/Y` 参与 30–60%，头滞后 ~150–300ms；
   - **大**（>~30°）→ 眼+头主导，`ParamBodyAngleX/Y` 再跟随 15–25%，滞后更多。
2. **头姿行为通道**（独立于视线，输出到 ParamAngleX/Y/Z）：
   - 呼吸轻摆：与 SDK 内置 ParamBreath 同相位的低频正弦/噪声（幅度 ~0.5–1.5°）；
   - 微点头：说话节奏/句尾强调（ParamAngleY +2–4°、~300–500ms）；倾听认同点头（每 5–15s 一次）；
   - 歪头（好奇/思考）：thinking 或用户说话时 20–40% 概率 ParamAngleZ +3–8° 保持 1–3s；
   - 回避转头：视线回避时头微转开（幅度随回避类型，回归时眼先头后）。
3. **身体微姿态**：低频重心微摆（ParamBodyAngleX ±1–2°、周期 3–8s 随机）+ 大偏移注视时的身体转向（现有 bodyAngle 保留，滞后加大）。
4. **扫视动力学**：替换现在的恒定 lerp 0.18 —— 目标切换瞬间快速逼近（按 main sequence 时长 ≈37+2.7×幅度ms 折算），随后慢速稳定。
5. **微扫视 + 粉噪声**：注视间隙叠加微扫视（每 0.3–0.7s 一次、幅度 ~1–3% 屏）与 1/f 粉噪声漂移（Voss-McCartney 16 段，纯加减）——"眼睛不死"的关键。
6. 保留现有 `LookParams` 增益/滑杆语义（`camAngleGain` 等仍生效），行为层输出的是"意图"，增益映射不变，向后兼容。

**与 motion/expression 的让位规则**：motion 播放中（NORMAL/FORCE 优先级）或 expression 切换瞬间，微姿态层退化为只保留呼吸+眨眼（SDK 内置），motion 结束后恢复——避免与大动作、表情打架。

### 3.4 整合与配置

- **view.tsx**：look 循环改为"行为控制器每帧产出目标 → 转 `camLookRef` → `setLook`"；行为输入由现有 SSE/engine/mic 状态组装（speech-start、audio、subtitle、mic 状态、thinking 窗口）；gyro 视差通道不动。
- **配置**：`PublicConfig` 新增 `gazeMode: "follow" | "natural"`（**默认 `natural`**；仅当 eyeTracking 开启时有意义）+ `idleGaze: boolean`（无摄像头纯微动，**默认开**）。设置 UI 中文标签：「视线模式：跟随 / 自然」、「待机眼神微动」。
- **活泼度滑杆（用户裁决：连续滑杆）**：⚙ 快捷面板「眼神」分组（与现有 look 滑杆同折叠区）新增连续滑杆 `gazeLiveliness`（0.5–1.5×，默认 1.0），作用为行为层所有时长分布/注视率的全局倍率（>1 更频繁互视与扫视、回避更短；<1 更内敛）。与 lookParams 同模式本地持久化（localStorage），不走服务端配置。
- **数据契约**：`dataset.lvLook` 增加 `state=<行为状态>` 字段（现有 e2e 约定风格），供 e2e 断言。

---

## 4. 实现方案（模块清单）

| 文件 | 改动 | 规模 |
|---|---|---|
| `src/client/gaze.ts`（新扩展） | FaceLandmarker 开 transformation matrix；头姿欧拉角分解；虹膜 ρh；userLooking 迟滞判定；`onUserLook` 事件 | ~120 行 |
| `src/client/behavior.ts`（新建） | 状态机 + 时序分布 + 行为脚本模板（视线/点头/歪头/重心）+ 可注入 RNG/clock | ~500–600 行 |
| `src/client/model.ts` | 眼-头-身三级分派、头姿行为通道、身体微摆、扫视动力学、微扫视/粉噪声；motion/expression 让位；保留 LookParams | ~220 行 |
| `src/client/view.tsx` | 行为控制器接线、输入组装、gazeMode 开关、无摄像头 idleGaze 路径 | ~100 行 |
| `src/client/hud.tsx` / `settings-section.tsx` | 模式选择 + 开关 UI + 活泼度滑杆（中文标签，滑杆 localStorage 持久化） | ~90 行 |
| `src/config.ts` / `src/routes.ts` / `src/client/types.ts` | `gazeMode`/`idleGaze` 配置透传 | ~20 行 |
| `e2e/verify-gaze-behavior.mjs`（新建） | 模式切换、dataset.lvLook.state 断言、无摄像头 wander 断言、点头/歪头参数变化断言 | ~150 行 |
| 单测（`src/client/behavior.test.ts` 或 node 直测） | 种子 RNG：状态时长在界内、转移合法、脚本步骤有序、点头/歪头时序合法、无 NaN | ~130 行 |

Phase 1 合计 ≈ 1200 行（< 3500，单阶段计划即可）。**Phase 2（第三人称双角色互视）**：两个行为控制器互以对方站位（xFraction 0.28/0.72）为目标做互视 + 各自回避 + 偶尔瞥向"观众"；放在 Phase 1 落地并验证后再排期。

---

## 5. 验证计划

1. `npx tsc --noEmit` + `node build.mjs`（产出 lib/*.js）。
2. 单测：行为控制器种子化确定性断言（时长分布界内、转移图合法、脚本步序、点头/歪头时序合法、无 NaN）；头姿欧拉角分解与虹膜 ρh 的数值单测（用已知矩阵/点构造）。
3. e2e（4188 实例，`e2e/verify-gaze-behavior.mjs`）：开关「自然视线」→ `dataset.lvLook` 出现 `state=` 且随注入事件转移；不开摄像头时仍出现 wander/scan/rest 状态；注入说话/思考事件后点头（ParamAngleY）与歪头（ParamAngleZ）参数出现合理变化。
4. **真机手感验收（关键）**：用户手机实跑，验收点——(a) 互视不"盯人"（单次 ≤3s 后自然移开）；(b) 用户低头时角色不追视；(c) 说话/倾听/思考三种模式的视线+头身差异可感知；(d) 眼球有微动、头部有呼吸轻摆与自然点头/歪头，整体不死板。手感不达标就调参数锚点（全部集中在行为层一处，便于迭代）。

## 6. 风险与注意事项

1. **与 motion-and-ui agent 在途改动协调（高优先级）**：当前工作区有未提交改动（17 文件 +980 行，含 model.ts/view.tsx/types.ts/config.ts/settings-section.tsx/hud.tsx 共享文件，model.ts 里还有 TEMP DEBUG 强制张嘴代码）。**实施必须等该改动落地或在其之上合并**，且实施期间遵循仓库提交惯例（commit-own-changes；纠缠场景按 14bd6e4 先例全量 src 提交并逐项列明）。
2. **motionManager 每帧重置参数**：保持在 `beforeModelUpdate` 钩子写参数（现状已验证正确时机），不另辟蹊径。
3. **12fps 感知带宽**：头姿/虹膜是 <5Hz 低频信号，12fps 够；关键是低通+迟滞，避免边界抖动（共识：webcam 眼神信号噪声大需强平滑）。
4. **参数集中在行为层**：所有行为学锚点收敛在 `gaze-behavior.ts` 的常量表（附来源注释），调手感只改一处，不动渲染代码。
5. **性能**：全部纯算术（矩阵分解、虹膜比例、Voss 噪声、状态机），骁龙 865 开销可忽略；FaceLandmarker 新增 matrix 输出的成本可忽略。

---

## 7. 实施状态（2026-09-25）

**Phase 1 已实施完成**，实现与计划差异：

- 总开关实现为 HUD「自然行为」一键（同时写 `gazeMode`/`idleGaze` 两个配置键），与用户硬要求一致；系统设置里两个键可独立调。
- 实验参数面板按计划落地为「实验参数」折叠区：4 组 14 个滑杆（视线节奏/注视概率/扫视/头与身），localStorage 持久化（`lv2d.behavior_tuning`），另有独立「活泼度」滑杆。
- 感知层 `eulerFromMatrix`/`irisCenteredness` 导出为独立函数；`onUserLook` 事件带迟滞（0.55/0.35）与 EMA(0.3)。
- 驱动层：互视/回避强制交替（单测揪出"连续重选互视超 3s"缺陷后修复，见 tests/behavior.test.mjs 注释）；motion 播放中 look/pose 写入让位（`queueManager.isFinished()`）。
- 验证：`tsc --noEmit` ✓、`build.mjs` ✓、单测 8/8 ✓、e2e 10/10 ✓（`e2e/verify-gaze-behavior.mjs`）。
- 用户验证文档：`260925-lively-gaze.validation.md`（7 项，核心是实机手感验收）。
- 风险 1 的协调：直接在脏树（对方 motion-and-ui 改动未提交）之上合并实施；提交按 14bd6e4 纠缠先例全量 src 提交并逐项列明带入的对方改动。

**Phase 2（第三人称双角色互视）** 仍留待 Phase 1 验收通过后排期。
