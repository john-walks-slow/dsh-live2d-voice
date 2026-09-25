# 260925 手势回归修复 + 第三人称对视 — 总结

## 背景

用户报障：**单指 pan 和双指缩放失效**。定位为 14bd6e4（第三人称模式）引入的回归：model.ts 的手势监听（pointer/wheel/dblclick）挂在 `if (!shared)` 分支，而重构后 view.tsx 所有模型挂载都传 shared（共享 Pixi Application）——没有任何模型挂监听，手势全灭。

同轮按用户设计定稿实现**第三人称对视**：双模型是"舞台剧"，两角色基准朝向对方、仿佛不知道玩家（镜头）存在；视线跟踪/陀螺仪降级为纯位置视差（角度增益归零，不转头看用户）；单模型模式行为不变。

## 修复/实现

### 1. 手势回归修复（src/client/model.ts）

- 删除 attach 与 destroy 两处 `if (!shared)` 条件：每个挂载模型都在 stage 上挂手势监听；双模型下两套监听各自维护手势状态、lockstep 同步响应——语义为"手势操作整个舞台"。
- `applyTransform` 写 `dataset.lvTransform`（pan/scale），作为 e2e 手势断言契约。

### 2. 第三人称对视 faceBiasX（src/client/model.ts + src/client/view.tsx）

- `StageLayout` 增加 `faceBiasX`（默认 0）；look 计算 `lx = faceBiasX + parallaxX`（angleZ 保持无偏置，避免持续歪头）；`lookSettling()` 增加 `faceBiasX !== 0`，对视基准常驻生效。
- view.tsx：组件常量 `AI_FACE_BIAS=-0.6` / `PLAYER_FACE_BIAS=0.6`（映射 ±13.2° 头/身体/眼球转角（angleRange 默认 22））；`stageLookParams()` 在 dual 时把 camAngleGain/gyroAngleGain 归零（视差只走 panRange 位移）；AI/玩家 mount 传 bias；thirdPerson 切换 effect 同步两模型 bias + look 参数；rAF look 循环与 changeLookParams 同时推双模型；玩家模型 mount-ready 即接入 look 管线（此前完全没有视线输入）。

## 验证

- typecheck + build 通过。
- e2e `verify-third-person.mjs` **32/32**：新增 T2c/T2d/T2e（双模型拖动/滚轮/双击复位，断言 dataset.lvTransform 变化）、T6f（单模型拖动，先关 ⚙ 弹窗再拖——弹窗是 stage 兄弟节点会挡指针）、T6b 改 30s 轮询防 flake。
- 角度写入→渲染管线用强制 0°/30° A/B 像素 diff 证实（双模型人脸区 9.7%/6.1% 像素变化 >30 阈值）；readback 证实 update() 入口真实参数缓冲区值正确。
- 用户真机验证项见同目录 validation 文档。

## 调试教训（详见 src/client/AGENTS.md pitfalls 更新）

排查"angle 写入疑似不渲染"期间排除了大量假设，最终证明写入链路完全正常、早期"不渲染"结论是 VLM 误判：

- framework `getParameterValueById` 对不存在的参数 id 走**侧字典**（`_notExistParameterId`），readback 返回值不能证明参数真实存在于模型；判存在要看 `raw.parameters.ids` 或 strings moc3。
- 写参数的时序基准：`beforeModelUpdate` → `model.update()`（raw 消费参数重算 drawables）→ `loadParameters()`（恢复 motion 态）。draw 只读 drawables，因此在 beforeModelUpdate 做绝对写入是正确位置（draw 时参数缓冲区已被恢复属正常）。
- `raw.drawables.vertexPositions` 是 **per-drawable 的数组套数组**，不是扁平 Float32Array。
- VLM（modlens）对 13~30° 转头方向判断不可靠（三次误判"正面"）；视觉断言必须用受控 A/B 像素 diff。

## 关联

- 手势回归根因 commit：14bd6e4（第三人称模式）
- e2e 手势盲区教训：28/28 全绿却漏掉手势回归——本轮已补 T2c/T2d/T2e/T6f 堵住
- 线上 4180 于 10:43 加载过含回归代码，修复需重启生效（等用户确认）
