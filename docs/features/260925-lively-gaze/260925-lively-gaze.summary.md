# 灵动视线/自然行为（Lively Gaze Phase 1）— 实施总结

**日期**：2026-09-25
**仓库**：`/root/projects/dsh-live-mode`（dsh-live2d-voice）
**状态**：typecheck/build 通过；单测 10/10、e2e 10/10 全绿；reviewer 首轮「不准入」（3 阻塞 + 3 建议 + 4 非阻塞）→ 全部修复 → 二轮复审「**条件准入**」→ 二轮 3 项建议/备忘（SUG-01 回正守卫、ADV-01 aria-expanded、ADV-02 bodySway dt）立即修复闭环 → **终态准入**（`260925-lively-gaze.review.md`）
**配套文档**：调研 `260925-gaze-behavior-research.md`、计划 `260925-lively-gaze.plan.md`、验证 `260925-lively-gaze.validation.md`

## 需求回顾

原视线链路（MediaPipe 追踪鼻尖 → setLook → 平滑驱动头/身/眼）死板：永远死盯用户、没有互视节律、没有微动、行为与对话状态无关。目标是把"追踪用户位置"升级为"**感知用户注意力 + 模拟人类社交视线行为**"，且头、身一并做活；两条硬要求：**整个新行为可一键关闭**、**实验参数足够多可调**。（计划：`260925-lively-gaze.plan.md`）

## 架构与关键决策

三层结构，与现有代码分层一一对应：

```
感知层（改）  gaze.ts：头姿欧拉角分解 + 虹膜中心度 → userLooking 判定（迟滞 + EMA）
行为层（新）  behavior.ts：BehaviorController 状态机 + 随机时序 + 行为脚本序列 → 视线/头/身意图
驱动层（改）  model.ts：眼-头-身三级滞后分派、扫视动力学、粉噪声微动、点头/歪头/重心摆 → Live2D 参数
整合/UI（改） view.tsx 双路径接线 + config 模式开关 + HUD「体感实验」区 + 设置面板
```

### 感知层（`gaze.ts`）
- `FaceLandmarker` 改输出 `outputFacialTransformationMatrixes`；`eulerFromMatrix()` 列主序 ZYX 分解（yaw=asin(data[8]) / pitch=atan2(-data[9],data[10])）。
- `irisCenteredness()`：468/473 虹膜点相对 33/133、263/362 眼角的内插比例（点位常量已按 MediaPipe 规范修正命名）。
- `onUserLook`：EMA(0.3) 平滑、Vonage 10°/30° 分级、`score = min(yaw,pitch) * (0.3 + 0.7*iris)`、迟滞 ON 0.55 / OFF 0.35。

### 行为层（`behavior.ts`，新建，纯逻辑可注入时钟/RNG）
- `BehaviorState` 6 态（rest/wander/contact/aversion/scan/think）+ `BehaviorTuning` 14 参数（默认值带行为学锚点注释）。
- `BehaviorController.update(input, now)`；脚本序列 `playScript`：`userLookRising→attention`、`speechStart→开场回避`、`sentenceBoundary→句尾看回+点头`。
- **互视/回避强制交替**：盯人超 3s 强制转入回避（单测揪出"连续重选互视超 3s"缺陷后修复）。
- 所有实验参数真接入：`liveliness` 总乘子缩放驻留/扫视时长；`listenLookRatio`/`speakLookRatio`/`thinkAversionRatio` 按对话状态动态分配 contact/aversion 比例；`aversionTurnDeg` 经 `TURN_REF_DEG=5` 换算成 turn 意图（-1..1）；airi 扫视分布。

### 驱动层（`model.ts`）
- **眼先头后真接入**：`headSm` 追 `camSm`(0.09)、`bodySm` 追 `headSm`(0.05)；`beforeModelUpdate` 头部角度用 `headSm`、身体用 `bodySm`（乘 headGain），眼睛用 `camSm` 直达——时间轴拉开。
- 幅度分派：`SPLIT_SMALL 0.15 / LARGE 0.55`，headGain 中间插值；`HEAD_RATIO 0.6 / BODY_RATIO 0.22`。
- saccade 感知平滑按残差选速（`dist>0.1 → 0.5`，否则 `0.12`），快动保持到接近目标。
- pose 通道：nod/tilt/turn/bodySway → angleX/Y/Z/bodyX；呼吸轻摆 `BREATH_DEG 0.7`（与 SDK ParamBreath 同相位）；`EYE_JITTER 0.05` 粉噪声（Voss 算法，eyeX/Y 写入前 `clamp01(...)*2-1` 显式钳位）。
- motion 让位：`queueManager.isFinished()===false` 时跳过 look/pose 写入（与 motion-and-ui 动作系统分层：我们管持续微姿态，他们管时间轴大动作）。
- `setLook(cam, gyro, pose?)` 三参扩展。

### 整合/UI
- `view.tsx` look loop 双路径：`behaviorOn = !dual && (natural || idleGaze)`；**总开关关闭时无条件派发复位**（`setLook(active?cam:null, active?gyro:null, null)`），模型平滑回正，不残留卡死姿态。
- `sentenceBoundary` 脉冲移至 **voice–subtitle sync 间隔**（音频实际开播/出栈时触发），不再绑定 SSE 到达帧。
- HUD「体感实验」区：自然行为总开关（一键同时写 gazeMode/idleGaze 两键）+ 视线模式 + 待机微动 + 活泼度滑杆（折叠区外单一入口）+ 实验参数折叠（4 组 13 滑杆，localStorage 持久化 `lv2d.behavior_tuning`）。
- settings-section：视线模式 select（自然/跟随）+ 待机眼神微动 select；`dataset.lvGaze` 暴露行为状态供 e2e/调试。
- 第三人称世界观保护：`!dualRef.current` 守卫，双角色模式自动停用本行为。

## 审查闭环

首轮检视 3 阻塞 + 3 建议 + 4 非阻塞，**全部修复**后二轮复审：

| 问题 | 修复 |
| --- | --- |
| BLK-01 空挂参数（liveliness/listenLookRatio/aversionTurnDeg 未接入） | liveliness 作总乘子缩放驻留/扫视；listenLookRatio 动态分配倾听 contact/aversion；aversionTurnDeg→TURN_REF_DEG 换算 turn 意图 |
| BLK-02 headSm 死变量（头眼身同频） | 头部用 headSm、身体用 bodySm 滞后通道驱动，眼睛保持直达 |
| BLK-03 总关闭姿态卡死 | `!behaviorOn` 分支无条件派发复位（移除 active 守卫） |
| SUG-01 话轮移交时序超前（SSE 帧触发） | sentenceBoundary 移到音频实际开播/出栈的 sync 间隔 |
| SUG-02 扫视单帧暴跌粘滞 | 按残差选速，快动保持到接近目标 |
| SUG-03 虹膜评分基底过高（斜视无法否决 Looking） | 基底 0.6→0.3（`0.3 + 0.7*iris`） |
| ADV-01 活泼度滑杆重复 | 从折叠区滑杆组剔除，保留单一主入口 |
| ADV-02 眼球参数无边界 | eyeX/Y 写入前 clamp01 显式钳位 |
| ADV-03 右眼点位命名倒置 | 按 MediaPipe 规范修正（outer=263 / inner=362） |
| ADV-04 单测缺倾听比率 | 新增 userSpeaking 注视比率断言 + liveliness 生效断言 |
| 二轮 SUG-01 回正守卫缺 poseSm 残差 | lookSettling() 追加 poseSm 四通道残差检测（关闭时残余姿态平滑归零） |
| 二轮 ADV-01 aria-expanded 反向 | 折叠按钮改为 aria-expanded={behaviorAdvanced} |
| 二轮 ADV-02 bodySway 相位硬编码 16ms | 改用 update() 内 dt 步进相位 |

## 验证

- `npx tsc --noEmit` 0 错；`node build.mjs` 双产物 ✅
- 单测 `node --test tests/behavior.test.mjs` **10/10**：互视/回避交替（含超 3s 防御）、倾听比率 ±0.2、liveliness 缩放生效、脚本步序、时长界内、无 NaN（种子化 RNG + 注入时钟）
- e2e `e2e/verify-gaze-behavior.mjs`（4188 实例）**10/10**：T1 配置面（gazeMode/idleGaze 默认与 patch 回环）/ T2 行为活性（dataset.lvGaze 出现合法状态）/ T3 总开关关闭后行为消失 / T4 HUD 总开关 UI / T9 零页面错误
- 回归：第三人称回归由 `e2e/verify-third-person.mjs` 覆盖（本次对共享文件改动集中在 look/pose 写入与配置透传，player 路径无逻辑变更）
- **实机手感验收待用户**：`260925-lively-gaze.validation.md`（7 项，互视不盯人 / 低头不追视 / 三态差异可感知 / 眼球微动与头身微动 / 总开关 / 实验参数 / 双角色回归）

## 文件清单

```
src/client/behavior.ts                 新建：行为控制器（状态机 + 脚本序列 + 14 参数调优）
src/client/gaze.ts                     感知层扩展：欧拉角分解 + 虹膜中心度 + 迟滞判定
src/client/model.ts                    驱动层：眼先头后滞后通道、幅度分派、pose 通道、粉噪声
src/client/view.tsx                    look loop 双路径、总开关复位派发、sentenceBoundary 时机、dataset.lvGaze
src/client/hud.tsx                     「体感实验」区（总开关 + 模式 + 活泼度 + 实验参数折叠）
src/client/settings-section.tsx        视线模式 + 待机微动 select
src/client/types.ts / src/config.ts / src/routes.ts   gazeMode("natural") / idleGaze(true) 透传
tests/behavior.test.mjs                新建：确定性单测 10 例
e2e/verify-gaze-behavior.mjs           新建：端到端 10 例
docs/features/260925-lively-gaze/      调研 / 计划 / 检视 / 验证 / 本总结
```

## 后续

- **Phase 2（第三人称双角色互视）**：待 Phase 1 实机验收通过后排期（双控制器互以对方站位为目标互视 + 各自回避）。
- 提交待 reviewer 二轮结论后执行；提交按纠缠先例全量 src 提交并逐项列明带入的对方（motion-and-ui）在途改动。
