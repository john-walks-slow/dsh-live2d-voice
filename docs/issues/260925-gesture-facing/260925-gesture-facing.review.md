# 检视报告 — dsh-live2d-voice 手势回归修复 + 第三人称 faceBiasX

## 概要

本轮检视范围严格限定于两个变更：(1) 手势监听回归修复（删除 `if (!shared)` 守卫）；(2) 第三人称对视（`faceBiasX` + 双模型角度增益归零）。其余混在仓库里的 motion/idle/hud/settings 改动按指令一律忽略。整体评价：**实现正确、回归修得彻底、与需求（含 AGENTS.md 第三节「第三人称对视世界观」）对齐良好**；存在两个 UX 一致性建议项和一个性能微优化点，均非阻塞。

## 需求对齐

- **手势回归**：14bd6e4 用 `if (!shared)` 把所有 shared 模式的手势挂载都跳过了，view.tsx 全员 shared → 全员无手势。修复把 `if (!shared)` 从 attach（model.ts:458-463）和 destroy（model.ts:562-567）两处移除，每个 mount 都监听、双模型 lockstep。AGENTS.md "Pitfalls" 节第二条把"手势必须挂每个 mountModel"列为永久教训，本次修复与该规则一致。T2c/T2d/T2e/T6f 新增 e2e 用 `dataset.lvTransform` 断言契约锁住回归。
- **第三人称对视**：需求是舞台剧式（两角色基准朝向对方），不允许视线/陀螺仪驱动转头看用户。`model.ts:296-308` 用 `lx = stageLayout.faceBiasX + parallaxX` + `angleZ = parallaxX * rr`（无偏置）实现分界；`view.tsx:361-364` 的 `stageLookParams()` 在 dual 时把 `camAngleGain/gyroAngleGain` 归零；`view.tsx:413/491` 给两 mount 传相反 `faceBiasX`；`view.tsx:461-468` 的切换 effect 同步 `setLayout + setLookParams`；`view.tsx:694` 的 rAF 把 `setLook` 同时推 `playerModelRef`；玩家 mount-ready 在 `view.tsx:515-516` 接入 look 管线——完整满足需求。
- **文档/实现一致性**：`src/client/AGENTS.md` Pitfalls 末条写 "faceBiasX ±0.6 → ±18°"，但实际计算是 `lx * ar`、`ar = DEFAULT_LOOK_PARMS.angleRange = 22`，得到 ±13.2°。文档期望与实现存在 ~5° 偏差——属于文档不准，不是实现 bug（语义仍是"明显侧头"），但读文档的人会困惑。**建议同步把 AGENTS.md 的 ±18° 改为 ±13.2° 或改写为"显著侧头"，或把 `angleRange` 默认值调到 30**。
- **单模型保持不变**：`stageLookParams()` 仅在 `thirdPerson && player.url` 时归零角度增益，单模型走 `lookParamsRef.current` 原值；`lx = faceBiasX + parallaxX` 中 `faceBiasX=0` 在单模型下与改动前等价；OK。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1  | view.tsx:461-468 | **dual → single 切换时未显式重置 `playerModelRef.current` 的 `faceBiasX`**：切换 effect 只在 `dual` 分支调 `playerModelRef.current?.setLayout({ faceBiasX: PLAYER_FACE_BIAS })`，非 dual 分支不调。React 调度上 effect setup 在 player effect cleanup 之前跑，会出现一帧"已切单模型但玩家 model 的 `stageLayout.faceBiasX` 仍是 0.6 + lookParams 已被新 single 模式写入"的中间态（玩家模型即将销毁所以不可见，但破坏了"配置是单一事实源"的不变量）。 | 在非 dual 分支显式 `playerModelRef.current?.setLayout({ faceBiasX: 0 })`；或在 dual 分支前先无条件把双模型 `faceBiasX` 设成当前应得值（dual 时 PLAYER_FACE_BIAS / 单模型 0）。 |
| S2  | view.tsx:361-364 + changeLookParams (1041-1052) | **dual 模式下用户拖动 `camAngleGain/gyroAngleGain` 滑块无任何视觉反馈**：`stageLookParams()` 把这两个增益强行归零，HUD 滑块写 `lookParamsRef.current`、渲染滑块位置也按用户值，但 `setLookParams` 拿到的是被覆盖过的对象；结果滑块在 dual 模式下"看着有值但没用"。持久化照旧写到 localStorage —— 切回单模型后这些值才生效，对用户而言很反直觉。 | 三选一：(a) dual 模式下在 HUD 上禁用/隐藏这两个滑块并显示"第三人称不应用头部增益"小字；(b) `stageLookParams` 改用原始 `lookParamsRef.current` 但在 `beforeModelUpdate` 里 `camA = dual ? 0 : lookParams.camAngleGain`；(c) dual 模式下不持久化这两个字段。推荐 (a)，最少惊讶。 |
| S3  | model.ts:218-222 + 240 | **dual 模式 `lookSettling()` 恒真导致 `dataset.lvTransform` 每帧（~60 Hz）写入 DOM**：`faceBiasX !== 0` 让 look 流水线永不退出 `if (lookSettling())` 块，`applyTransform` 每帧执行 → `container.dataset.lvTransform = "..."` 每帧覆盖。即便用户没在拖，dataset 上每秒有 60 次相同的字符串写入，是实测可见的 DOM 写入压力（小屏移动端偶发 layout invalidation）。 | 加一行缓存：上一次写入过的 `lastWritten` 缓存三元组，只有 `(panX, panY, scale)` 任一变化才重写 dataset。`setParam(angleX...)` 部分同理可缓存，但收益小。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1  | model.ts:458-463 | **双模型下同一 `.lv-stage` 元素被挂两套 pointer 监听器（AI 一套、玩家一套）**：每个事件触发两次闭包执行、两次 `setPointerCapture`、两次 `userPanX/Y/scale` 累加。值靠"两闭包读相同 `event.clientX`、写各自 ref"保持 lockstep，正确但 2× 工作量。`stopPropagation` 不会阻断同 target 上的另一个监听器，所以两边都跑（这是期望行为）。 | 接受现状（语义清晰、Pinia 场景下也只多 ~10μs/帧）。如果未来要做极致性能，可抽出共享 gesture reducer，由 stage 集中分发 delta 给各 model。 |
| N2  | model.ts:240 + view.tsx:413/491 | **`dataset.lvTransform` 同时被两个模型的 `applyTransform` 写同一 DOM 元素**：AI 先写一次、玩家后写一次，理论上值相同（lockstep），但 PIXI ticker 内 `beforeModelUpdate` 对两模型的触发顺序非文档保证，e2e 在两次写之间采样可能读到 `undefined`（实际被 `?? ''` 兜底成 `0,0,0`，无功能影响）。 | 维持现状（默认值兜底）。若以后想让 e2e 拿到瞬时中间值，可在 `container` 上挂一层轻量 `WeakRef` 单写者，把两份写入合并为一次。 |
| N3  | view.tsx:461-468 + model.ts:142 | **`AI_FACE_BIAS/PLAYER_FACE_BIAS` 是组件内常量，与第三方 stage layout 字段耦合硬编码**：未来若加 "全角色对视"（第三视角偏置枚举）或 HUD 调节 faceBias 强度，需在 view.tsx 改常量。 | 把常量挪到 `model.ts` 默认 `StageLayout` 旁（如 `DEFAULT_FACE_BIAS_PAIR = { ai: -0.6, player: 0.6 }`），view.tsx 仅消费。未来扩展更顺。 |
| N4  | model.ts:218-222 | **`lookSettling()` 用 `Math.abs(camSm.dx) + ... > 0.004` 作为收敛阈值**：在双模型 dual 模式下该分支其实走不到（`faceBiasX !== 0` 先 true 了），但单模型里仍是 4 维 L1 阈值，对一维大角度动作的"是否还在缓动"判定偏粗，理论上可能比视觉实际收敛更早判定为 false 导致后续帧角度被冻结。 | 单模型下用欧氏距离 `Math.hypot(...) > 0.005` 或各自维度独立阈值更稳健。当前实现问题很小（LOOK_LERP=0.18，残差衰减足够快）。 |
| N5  | e2e/verify-third-person.mjs:340-364 (T6f) | **T6f 假设 `.lv-pop-close` 存在且点击能关闭弹窗**：该 DOM 类来自 `hud.tsx`/`styles.ts`（本轮另 agent 改动），若那侧重构了关闭按钮或改了类名，T6f 静默无效（拖动手势落到 popover 上而不是 stage 上，dataset.lvTransform 不动，T6f 失败但原因难定位）。 | 把"关 popover"做成 contract test 或断言 `.lv-pop` 已不在 DOM 中再开始拖动。当前依赖隐式正确。 |
| N6  | model.ts:218-222 + 296-308 | **moc2 模型兼容性已核对**：LOOK_IDS 走 `PARAM_ANGLE_X`/`ParamAngleX` 双路径，setParam 经 `coreModel.setParamFloat`/`setParameterValueById` 路由；`AI_FACE_BIAS=-0.6` × `ar=22` = -13.2° 在典型 moc2 模型 `angleX` 范围（±30°）内。无兼容问题。 | 仅作记录，无需修改。 |

## 准入结论

**结论**：`条件准入`

**说明**：手势修复和 faceBiasX 实现均与需求（含 AGENTS.md 第三人称对视世界观）严格对齐；T2c-e/T6f e2e 用 dataset 契约把回归锁住，无遗留阻塞。建议在合并前至少处理 S1（dual→single 切换的中间态）和 S2（dual 模式下角度增益滑块的 UX 反直觉），S3 可作为后续性能优化项。AGENTS.md 中 "±18°" 与实现 "±13.2°" 的文档偏差建议同步修正。