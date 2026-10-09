# Motion Priority Signal Troubleshoot

## Must Reconsider

结论“本构建的 MotionManager 起播时不带优先级，所以拿不到精确信号”需要撤回。实际代码显示：产品调用点把 priority 正确传入 `Live2DModel.motion`；优先级也没有在 MotionManager 层丢失。错误在于把 `CubismMotionQueueManager` 当成维护 priority 的 manager 查询。

### 1. 实际版本与入口

安装包为 `pixi-live2d-display-lipsyncpatch@v0.5.0-ls-8`（`node_modules/pixi-live2d-display-lipsyncpatch/package.json:1-5`）。Cubism 4 入口是 `dist/cubism4.es.js`，Cubism 2 入口是 `dist/cubism2.es.js`。安装包没有源码目录；`types/index.d.ts` 是生成声明。

`Live2DModel.motion` 的 Cubism 4 实现（`dist/cubism4.es.js:10406-10431`）签名为：

```js
motion(group, index, priority, options = {}) {
  return index === void 0
    ? this.internalModel.motionManager.startRandomMotion(group, priority, options)
    : this.internalModel.motionManager.startMotion(group, index, priority, options);
}
```

`types/index.d.ts:815-835` 同样声明 `startMotion(group, index, priority?, options?)`，并把默认 priority 写成 `NORMAL`。声明中的 `Live2DModel.motion` 具体 overload 没有保留下来，但打包实现明确显示第三实参就是 priority。

MotionManager 的实现（`dist/cubism4.es.js:9042-9142`；Cubism 2 对应 `dist/cubism2.es.js:1359-1459`）先执行：

```js
if (!this.state.reserve(group, index, priority)) return false;
...
if (!this.state.start(motion, group, index, priority)) return false;
...
this._startMotion(motion);
return true;
```

`MotionState` 是真正记录/判定优先级的对象。Cubism 4（`dist/cubism4.es.js:8174-8411`）：

- `currentPriority` 初始化为 `NONE=0`，实际起播在 `start()` 的 `setCurrent(group, index, priority)` 写入（`8314-8318`、`8334-8338`）。
- `reservePriority` 在 `reserve()` 的 `setReserved(group,index,priority)` 写入（`8275`、`8342-8346`），异步加载阶段代表已预留但尚未成为 current。
- NORMAL（2）被拒绝的条件是 `priority <= currentPriority` 或 `priority <= reservePriority`（`8257-8274`）；IDLE（1）在 `currentPriority !== 0` 时拒绝（`8238-8253`）；FORCE（3）绕过这两个比较，但同组同 index 仍受 duplicate 检查。
- 播放结束/停止时 `complete()` 或 `reset()` 通过 `setCurrent(..., 0)` 清零（`8321-8329`、`8364-8377`）。

Cubism 4 的实际 `internal.motionManager.queueManager` 是 `new CubismMotionQueueManager()`（`dist/cubism4.es.js:10672-10689`），不是维护优先级的 `CubismMotionManager`。其基础队列 `startMotion` 签名是：

```js
startMotion(motion, autoDelete, userTimeSeconds)
```

（`dist/cubism4.es.js:4266-4283`；`types/index.d.ts:3828-3847`）。第三参明确是累计用户时间秒数，不是 priority。基础队列没有 `_currentPriority`、`_reservePriority`、`getCurrentPriority()`；它只维护 `_motions`。因此 MotionManager 的 Cubism 4 `_startMotion`：

```js
this.queueManager.stopAllMotions();
return this.queueManager.startMotion(motion, false, performance.now());
```

（`dist/cubism4.es.js:10703-10707`）并不是把 priority 丢给 queue 后才丢失，而是 priority 已经由 `MotionState` 完成判定和记录，queue 只负责播放队列。

Cubism 2 更直接：`Cubism2MotionManager` 使用普通 `new MotionQueueManager()`（`dist/cubism2.es.js:3028-3039`），`_startMotion` 调 `queueManager.startMotion(motion)`（`3066-3070`）；普通队列签名只有 `startMotion(motion, neverUsedArg?)`（`types/index.d.ts:47-58`），没有 priority 字段。Cubism 2 的 priority 同样只在共享的上层 `MotionManager.state` 中维护。

### 2. 本插件所有动作起播实参

`src/client/model.ts` 中的调用点均把 priority 放在 `Live2DModel.motion` 所要求的第三位：

- `handleTap`（`model.ts:628-631`）：`.motion(group, index, priorityValue("normal"))`，即 `(group, index, 2)`。
- `handleSwipe`（`model.ts:657-661`）：`.motion(group, index, priorityValue("normal"))`，即 `(group, index, 2)`。
- `playMotion`（`model.ts:908-913`）：`.motion(motion.group, motion.index, priorityValue(priority ?? "force"))`；没有传 priority 时默认 `(group,index,3)`。
- 空闲调度不在 `model.ts`，在 `src/client/view.tsx:783-785` 调 `playMotion(pick, "idle")`，最终为 `(group,index,1)`。
- `playRandomMotion`（`model.ts:918-925`）调 `startRandomMotion(group, priorityValue(priority))`，即 `(group, priority)`；该方法内部再以 `(group,index,priority)` 调 `startMotion`（`dist/cubism4.es.js:9155-9183`）。
- view 的动作事件 `view.tsx:957-965` 找到定义后调用 `target.playMotion(def)`，因 playMotion 默认 priority 为 FORCE，即 `(group,index,3)`。
- HUD/动作选择器 `view.tsx:1909` 也调用 `playMotion(motion)`，同样默认 FORCE。

### 3. (a)/(b)/(c) 判定

判定是 **(a) + “查询目标错误”这一层面的 (c)，不是 (b)**：

1. **不是 (b)**。产品的 tap、swipe、playMotion 调用都把 numeric priority 作为 `Live2DModel.motion` 第三参；库的 `motion(group,index,priority)` 也把第三参原样转给 `MotionManager.startMotion(group,index,priority)`。库内部随后把 priority 写入 `MotionState`，并用它做拒绝判定。`performance.now()` 位于更底层 Cubism queue 的第三参，含义是 `userTimeSeconds`，但它不是产品 priority 的传递通道，也不会改变上层已完成的 priority 判定。
2. **属于 (a)**：这个构建的 `internal.motionManager.queueManager` 是基础 `CubismMotionQueueManager`，源码没有 priority 字段或 `getCurrentPriority()`；`getCurrentPriority/_currentPriority/_reservePriority` 只存在于另一种官方 `CubismMotionManager` 实现片段，当前插件没有把该类型用作 queueManager。对当前实例读这些字段不能作为有效信号；不存在时应是 `undefined`，若外部把缺省值归一化为 0，便会观察到恒为 0。
3. **也可称为 (c) 的查询对象错误，但不是“队列为空”**：真正驱动 motion 的同一实例是 `model.internalModel.motionManager`，其有效 priority 状态是 `model.internalModel.motionManager.state.currentPriority` 和 `state.reservePriority`。当前 `queueManager` 确实是该 MotionManager 的子对象，但它不是 priority state。正确的查询时机是动作已完成 `startMotion` 的 reservation/current transition 后；异步加载期间要同时看 `reservePriority`。读取空闲阶段的 `currentPriority=0` 当然只表示没有当前 NORMAL/FORCE，而不能证明库起播没有传 priority。

### 4. 能否取得精确信号

**能。现有依赖已经维护了足够精确、与实际拒绝规则一致的信号，但应读 `internal.motionManager.state`，不能读 `queueManager.getCurrentPriority()`。** 对“现在发 NORMAL 手势是否会被拒”这一问题，最小同步近似应为：

```js
const state = internal.motionManager.state;
const normalWouldBeRejected =
  state.currentPriority >= 2 || state.reservePriority >= 2;
```

它对应库 `MotionState.reserve(..., NORMAL)` 对 current/reserve 的两条拒绝条件。实际发起动作后的 `Promise<boolean>` 仍是最终权威结果，因为定义缺失、加载失败、音频/竞态也可能导致 false。

产品最小改动建议：在 `src/client/model.ts` 的 `beforeModelUpdate` 诊断/发布处（当前 `462-477`）把类型视图从只暴露 `isFinished()` 扩展为 `state.currentPriority` 与 `state.reservePriority`，发布例如 `dataset.lvMotionBusy` 为上述表达式，而不是 `isFinished() === false`；或者新增一个内部 `canStartMotion(priority)`/`wouldRejectMotion(priority)`，由 `handleSwipe` 在调用前读取同一 `internal.motionManager.state`。不要修改库底层 `queueManager.startMotion(motion,false,performance.now())`，那里的第三参按官方签名必须保持 userTimeSeconds。

## Suggestions

- 将诊断注释 `model.ts:470-473` 中“本 build starts motions without priority / getCurrentPriority stays 0 / precise version needs playing priority”的描述改为：优先级由 `motionManager.state` 维护，`queueManager` 是无 priority 的底层 Cubism 队列。
- 若产品只需要“本次 gesture 是否被拒”，最稳妥的产品逻辑是继续使用 `playMotion` 返回的 `Promise<boolean>`；若需要“发送前是否会拒”，读取 `state.currentPriority` 和 `state.reservePriority`，并把 reservation race 视为阻挡。
- 若必须覆盖从方法进入到异步完成的极窄竞态，可在同一事件循环中优先读取 state，再以返回值校正 DOM 诊断；不要根据 `_motions` 条目推导 priority，因为 `CubismMotionQueueEntry` 本身没有 priority 字段。

## Open questions

- 本次未启动 e2e 或浏览器实测，遵守只读/不重启要求；静态打包产物、生成声明和产品调用链已足以排除“priority 从产品调用点传错位”。
- 若运行时确实看到 `queueManager.getCurrentPriority()` 返回数字 0，而非 `undefined`，需要确认页面实际加载的 bundle 是否就是本工作区安装包的 `cubism4` 产物，或是否存在额外的 monkey patch/其他库实例；安装包静态代码中当前 Cubism 4 `queueManager` 没有该方法。

## 为什么 e2e 不直接用 `motion()` 的返回值判定

`Live2DModel.motion(group, index, priority)` 的声明就是 `Promise<boolean>`（`types/index.d.ts:1771`；
`startMotion` 同，`:827`），**true = 真的起播、false = 被拒**，这是权威信号。

产品代码已经在用它：`handleSwipe` 的 `.then((started) => { if (!started) return; … })` —— 只有真正起播才写
`dataset.lvGesture` / `lvGestureSeq`。所以 e2e 的判定（`值 == 期望 且 lvGestureSeq 前进`）**本质就是返回值判定**，
只是绕了一层 DOM 契约（测试无法替产品调用 `model.motion`）。

`dataset.lvMotionBusy` 因此降级为**发滑动之前的提示**（等它归零再发，避免明知会被拒还发），
并且必须带**正向对照**（`e2e/verify-touch-mode.mjs` T18：动作播放期间必须观测到 `"1"`、播完回 `"0"`），
否则"读错对象/字段名对不上 → 恒 0 → 全绿"这类假绿无法被发现。
