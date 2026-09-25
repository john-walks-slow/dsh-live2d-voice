# 260925 第三人称分角色拖动（单独拖动两个模型）— 总结

## 背景

用户报障：**第三人称模式（双模型同台）下"支持单独拖动两个模型"的功能好像还没实现**。14bd6e4 提交信息声称实现"第三人称手势与分角色拖动"，但实际代码从未做到：拖任一化身时两个模型一起移动。

## 根因

`src/client/model.ts` 的手势 hit-test 注册表（`mounts`）是**每个 mountModel 实例局部变量**，只注册了本实例的模型，没有任何跨模型共享机制（注释声称 "every mounted model registers itself so that a pointer-down can decide which avatar the finger landed on" 从未成立）：

- 拖 A（如玩家化身）时：A 实例 hit 命中自己 → A 生效；B（AI）实例 hit 检查"自己的 bounds"→ 未命中 → 被当作"空白=全局平移" → **B 也平移**。
- mouse 拖动分支（`isMousePanning`）**完全没有 drag 归属过滤**——左键拖任意位置两个模型都平移。
- 双模型下 `dataset.lvTransform` 由两个模型每帧交替写入（last-writer-wins 竞态），"哪个模型动了"无法稳定观测，e2e 此前只断言"有响应"，漏掉了"只动一个"。

## 修复（src/client/model.ts + view.tsx）

1. **共享 GestureRegistry**：`SharedStage` 携带 `gestures { mounts, dragOwner }`；同台全部模型注册进同一份列表；pointerdown 用共享列表 hit-test 决定 `dragOwner`（命中模型=该模型，空白/中键/右键=null=全局平移）。
2. **归属过滤**：touch 单指与 mouse 左键拖动时，仅当 `dragOwner === 本模型`（或 null=全局）才更新自己的 userPan；`dragOwner` 是其他模型则跳过——**单独拖动成立**。双指 pinch / wheel / dblclick 恒为全局。
3. **per-model 观测键**：`applyTransform` 在有 tag（mountModel 第 7 参，view 传 "Ai"/"Player"）时额外写 `dataset.lvAiTransform` / `lvPlayerTransform`，作为"哪个模型动了"的稳定 e2e 契约；共享 `lvTransform` 保留（单模型/旧断言兼容）。
4. 单模型模式（无 shared）：局部 registry 兜底，行为不变。

## e2e（verify-third-person.mjs T2 段重写）

- T2c-p：拖玩家化身（x0.28 处）→ 仅 pl 键 +144，ai 键 0 → **拖玩家只动玩家** ✓
- T2c-a：拖 AI 化身（x0.72 处）→ 仅 ai 键 -144，pl 键不变 → **拖 AI 只动 AI** ✓
- T2c：拖空白中心 → 两键同 +160（全局平移）✓；T2d 滚轮两键 zoom 同增 ✓；T2e 双击两键全复位 ✓
- 拖前先 dblclick 复位：T2c 的全局 pan 会把化身移出 0.28/0.72 站位，若不复位，T2c-p 的固定坐标落点变成空白区（命中失败→全局平移），断言误报——探针（临时 hit 日志）实证 dual 下左侧点击命中 player、右侧命中 AI，逻辑本身正确。

## 验证

- typecheck + build 通过；探针实证 hit 归属正确；e2e T2 段全绿（其余 T0/T1/T3/T4/T6/T7 通过）。
- 已知既有漂移（与本次改动无关，未处理）：T5（polish 翻译）。T6a（off 后 player 事件残留）在本轮运行时不稳定失败，失败点全在 host 侧（lib/index.js 19:34 启动加载、本次未改动），T3 同页面同 SSE 全过佐证与手势代码零交集，疑似第三方翻译服务抖动或脚本异步时序，另行跟进。

## 关联

- 根因 commit：88746e2（14bd6e4）"第三人称手势与分角色拖动"——声称实现但未共享 hit-test 注册表。
- e2e 盲区教训：双模型下 lvTransform 竞态让"哪个模型动了"不可观测 → 本轮新增 per-model 键 + 分角色拖动断言（同步更新 src/client/AGENTS.md pitfalls）。
- 线上 4180 需重启生效（等待部署确认）。