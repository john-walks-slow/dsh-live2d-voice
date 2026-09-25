# 检视报告

## 概要

本轮检视针对 dsh-live2d-voice 插件「灵动视线 / 自然行为」（Lively Gaze）Phase 1 的第二轮变更进行复核。
首轮检视提出的 3 项阻塞问题（空挂参数、时间轴滞后死变量、总关闭姿态卡死）与 7 项建议/非阻塞问题均已逐一得到切实修复，核心行为控制回路（Perception → Behavior Controller → Lagged Smoothing & Pose Driver → Live2D Parameters）已完整打通闭环。本次复核未发现阻塞准入的重大缺陷，整体设计合理、架构分层清晰、单测与 E2E 验证完备，评定为**条件准入**。

## 需求对齐

变更完全满足 Lively Gaze Phase 1 需求与设计规范：
1. **控制层逻辑解耦**：`behavior.ts` 保持纯算法控制器（无 DOM/Live2D 依赖），`liveliness`、`listenLookRatio`、`aversionTurnDeg` 等核心参数均已真接入运算与状态流转。
2. **多通道协同渲染**：`model.ts` 接入「眼先头后身跟随」的级联滞后链与幅度分派（`SPLIT_SMALL/LARGE`、`HEAD_RATIO/BODY_RATIO`），粉噪声微动与呼吸轻摆增强了生命感。
3. **退化与隔离**：总开关关闭时能够解绑行为状态，第三人称模式（`dual`）严格遵循舞台剧互视世界观并跳过自然行为介入。
4. **测试覆盖**：新增确定性单测（10/10）与端到端自动化测试（10/10）为交付质量提供了充分保障。

与第一轮问题的对账确认：
- [x] **BLK-01 空挂参数**：`liveliness` 成为全局驻留与扫视节奏缩放乘子；`listenLookRatio` 在 `userSpeaking` 分支动态推导回避时长；`aversionTurnDeg` 经参考系换算转换为 `turn` 意图并由驱动层消费。
- [x] **BLK-02 headSm 死变量**：`model.ts` 构建 `camSm → headSm (0.09) → bodySm (0.05)` 滞后通道，眼直达、头身滞后分派，运动时序符合生理预期。
- [x] **BLK-03 总关闭姿态卡死**：`view.tsx` 在 `!behaviorOn` 分支每帧无条件向驱动层派发复位（`pose: null`），脱离了对相机/陀螺仪 active 的前置守卫。
- [x] **SUG-01 句尾脉冲时机**：`sentenceBoundary` 移至语音实际出栈播放时刻触发，解决 SSE 提前到达问题。
- [x] **SUG-02 扫视速度判定**：`model.ts` 改为根据眼球当前平滑位置与目标的残差距离切换 `SACCADE_LERP / SETTLE_LERP`。
- [x] **SUG-03 虹膜评分阈值**：虹膜评分基底调整为 `0.3 + 0.7 * irisScore`，斜视时稳定跌破退出阈值。
- [x] **ADV-01~04**：剔除 HUD 重复滑杆、眼睛坐标钳位、右眼拓扑索引修正、单测补齐等均已完成。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `src/client/model.ts:277-282` | `lookSettling()` 回正守卫缺少对 `poseSm` 残差的检测。<br>当关闭自然行为总开关时，若 `camSm` 与 `gyroSm` 恰好处于原点附近（差值 < 0.004），而姿态通道（如 `bodySway` 正处于正弦波峰值）仍有较大残差时，`lookSettling()` 会立即判断为 `false`，导致 `beforeModelUpdate` 提前跳过更新，残余姿态（转头/歪头/微摆）可能停留在最后一帧无法完全平滑归零。 | 在 `lookSettling()` 条件中增加 `poseSm` 残差检测，如：<br>`Math.abs(poseSm.nod) + Math.abs(poseSm.tilt) + Math.abs(poseSm.turn) + Math.abs(poseSm.bodySway) > 0.004`，确保无输入时各姿态通道也能平滑衰减至零。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | `src/client/hud.tsx:668` | HUD「实验参数」折叠按钮上的无障碍属性反向：`aria-expanded={!behaviorAdvanced}`。<br>当展开时值为 `false`，折叠时值为 `true`，与 WAI-ARIA 规范相反。 | 改为 `aria-expanded={behaviorAdvanced}`。 |
| ADV-02 | `src/client/behavior.ts:480` | `bodySway` 正弦波相位步进 `(2 * Math.PI * 16) / t.bodySwayPeriodMs` 硬编码了固定 16ms 步长，若渲染帧率出现大幅波动（如 30fps 或 120fps 设备），摆动实际物理周期会略有偏移。 | 可在 `update()` 中结合已有的 `dt` 计算步进：`(2 * Math.PI * dt) / t.bodySwayPeriodMs`。当前影响微弱，作为后续细节调优备忘。 |

## 准入结论

**结论**：`条件准入`

**说明**：首轮发现的全部阻塞问题均已彻底解决，核心算法与各层数据流接入正确且通过了严格的单测与 E2E 验证。仅存在 1 项关于姿态平滑回正边界条件的建议修改（SUG-01）及少量体验备忘项，可在合并前顺手调整或在后续 Phase 2 迭代中处理。

---

## 二轮建议/备忘闭环（复审后立即处理）

| ID | 处理 | 状态 |
| --- | --- | --- |
| SUG-01 lookSettling() 缺 poseSm 残差 | `model.ts` `lookSettling()` 条件追加 `\|poseSm.nod\| + \|poseSm.tilt\| + \|poseSm.turn\| + \|poseSm.bodySway\| > 0.004`（总开关关闭时残余转头/歪头/微摆也能平滑归零） | ✅ 已修 |
| ADV-01 aria-expanded 反向 | `hud.tsx` 折叠按钮 `aria-expanded={!behaviorAdvanced}` → `aria-expanded={behaviorAdvanced}` | ✅ 已修 |
| ADV-02 bodySway 相位硬编码 16ms | `behavior.ts` 改用 `update()` 内已计算的 `dt`（0..250 钳位，首帧兜底 16）步进相位 | ✅ 已修 |

修复后验证：`tsc --noEmit` ✓、`build.mjs` ✓、单测 10/10 ✓、e2e 10/10 ✓（`e2e/verify-gaze-behavior.mjs`）。

**结论（终态）：准入。**
