# enhanced-gaze-tracking 实施总结

## 任务背景

用户在使用基于摄像头与陀螺仪的视线跟踪时，提出了 5 点核心进阶实验与调优需求：
1. 转头的值整体应该小很多（原本 22° 导致转头剧烈摇晃，需调小默认幅度）；
2. 支持手动输入值，允许超过最大最小，用于实验；
3. 根据视线/陀螺仪调整 yaw+pitch+roll 的 3dtransform（增强空间 3D 纵深透视感）；
4. 支持调整中心/offset（解决手机顶部摄像头俯角或打孔屏偏位，支持手输微调与一键将当前状况设为中心）；
5. 扩展 Live2D 模型通用可动性（身体 Z 轴侧倾、眉毛上下联动、眼球形态微变等随视线联动）。

## 架构与核心实现

1. **转头幅度降阶与第三人称解耦**：
   - 将 `DEFAULT_LOOK_PARAMS.angleRange` 由原 22° 调减为 8°，预设范围相应收敛（subtle: 5°, standard: 8°, vivid: 14°），让眼球与微表情主导视线。
   - 在 `model.ts` 中将第三人称舞台剧基准对视夹角（固定 ±13.2°）与动态视线微动解耦，确保双人舞台对视感不缩水。

2. **支持手输极限数值（无界限实验）**：
   - 在 `hud.tsx` 详细参数面板中，为每一个参数行新增数字输入框，封装受控与本地输入缓冲结合的 `LookParamInput` 组件，支持负号、清空与小数输入，不设 min/max 限制。
   - 滑块显示采用 `Math.max(min, Math.min(max, val))` 安全截断，与手输值保持平滑联动且不破坏原有选择器契约。

3. **舞台级单点 3D Transform 空间透视**：
   - 在 `look-math.ts` 中实现纯函数 `compute3dTransform`，输出标准 CSS 3D 透视样式（`perspective(1000px) rotateX(...) rotateY(...) rotateZ(...)`）。
   - 在 `view.tsx` 的 look loop 帧循环中单点统一驱动舞台 Canvas 样式，从根本上杜绝了第三人称多模型共享 Canvas 时的抢写竞态与高频跳闪。

4. **视线中心 Offset 手输与一键自动校准**：
   - 在 `gaze.ts` 中引入 `yawOffset` 与 `pitchOffset`，并记录每帧原始鼻尖坐标 `lastRawX` 与 `lastRawY`。
   - 提供 `calibrateCenter()`，通过推导偏移量一键将当前用户姿势映射为正中 `(0.5, 0.5)`，并提供 `resetCenter()`。
   - 在 HUD 的体感实验一栏提供便捷的“设当前为中心”、“重置中心”按钮与水平/垂直偏移滑条与手输框。

5. **Live2D 标准可动性联动**：
   - 在 `model.ts` 的 `LOOK_IDS` 中补充标准参数：`bodyZ` (ParamBodyAngleZ)、`browLY`/`browRY` (ParamBrowLY/RY)、`eyeBallForm` (ParamEyeBallForm)。
   - 在 `LookParams` 中提供 `bodyZGain`（默认 0.4）、`browGain`（默认 0.25）、`eyeBallFormGain`（默认 0）调节项，在帧更新中动态驱动对应微动作。

## 验证与测试

- `e2e/verify-look-math.mjs`：扩展单测至 15 项，覆盖纯数学混合、3D 透视纯函数输出、角度降阶断言、中心校准映射等，全部通过。
- TypeScript 类型检查（`npm run typecheck`）与构建打包（`node build.mjs`）全部无警告通过。
- 两轮 Reviewer 检视闭环全部阻塞与建议问题，获“准入”结论。
