# Motion 抢占源码排查

## 结论 1：同优先级是拒绝，不是排队

`MotionManager.startMotion()` 在 9044–9056 行先调用 `state.reserve()`；`MotionState.reserve()` 在 8259–8267 行对 NORMAL（数值 2）执行 `priority <= currentPriority` 判定，当前也是 NORMAL 时直接 `return false`。因此该请求不会进入等待队列；Promise 解析为 `false` 与“排队稍后播放”是互斥结果。即使通过 reserve，异步加载后 `state.start()` 仍要求请求匹配 reserved group/index（8300–8315），不匹配也返回 false。

证据：

```js
// dist/cubism4.js:8259-8267
if (priority < 3) {
  if (priority <= this.currentPriority) {
    ...
    return false;
  }
}
```

```js
// dist/cubism4.js:9044-9056
if (!this.state.reserve(group, index, priority)) {
  return false;
}
```

Motion queue 本身不是这个拒绝请求的排队机制；Cubism queue 的 `startMotion` 只把已经获准的 motion entry push 到 `_motions`（4268–4284），且 MotionManager 的 `_startMotion` 在 10705–10708 行先清空旧 queue。

## 结论 2：stopAllMotions 不会清掉表情、眨眼、呼吸、物理或 pose

`MotionManager.stopAllMotions()`（9203–9207）只调用派生类 `_stopAllMotions()`、`state.reset()`、`stopSpeaking()`。Cubism4 的 `_stopAllMotions()`（10710–10712）只清空 motion queue。ExpressionManager 有独立的 `queueManager`，其清空入口是 `stopAllExpressions()`（10667–10671），没有被 stopAllMotions 调用；因此表情不会被一并清掉。

`state.reset()`（8366–8380）只把 `currentGroup/currentIndex/currentPriority`、`reservedGroup/reservedIndex/reservePriority`、`reservedIdleGroup/reservedIdleIndex` 重置为空/NONE；不触碰 expressionManager、eyeBlink、breath、physics、pose，也没有参数平滑值字段。

更新顺序证明自然模块仍继续运行：`InternalModel.update()` 在 10876 调 motion，随后独立更新 expression（10879）、无 motion 更新 eyeBlink（10880–10882），再更新 breath（`updateNaturalMovements`，10918–10920）、physics 与 pose（10898–10899）。`stopSpeaking()` 仅释放 currentAudio（9194–9199）。

## 结论 3：idle 调度会自恢复，stop 不会破坏 idle group 配置

该版本没有 `idleInterval` 或 `_lastIdleTime` 调度字段。idle 调度在 `MotionManager.update()`（9214–9229）：当 queue `isFinished()` 后执行 `state.complete()`，若 `state.shouldRequestIdleMotion()` 为真，则调用 `startRandomMotion(this.groups.idle, MotionPriority.IDLE)`（9224–9227）。`groups.idle` 默认是 `"Idle"`（Cubism4MotionManager 构造，10674–10680），也可在 `init()` 通过 `options.idleMotionGroup` 覆盖（8861–8864）。

`state.reset()` 清掉的是本次 motion 的 current/reserved 状态，包括 `reservedIdleGroup`；它不清 `groups.idle`，也不清 motion definitions/motionGroups。stop 后 queue 已空，下一次 update 的 `isFinished()` 为真；随后 reset 状态满足 `shouldRequestIdleMotion()`（8384–8386），因此会重新请求 idle。这里的 idle “自恢复”依赖下一次模型 update、idle group 中存在可用 motion 且加载成功；若无定义/加载失败，`startRandomMotion` 可返回 false。

## 结论 4：库有 fade 配置，但不能用公开 stop+start 实现平滑抢占

类型公开了全局默认值 `config.motionFadingDuration` 与 `config.idleMotionFadingDuration`（types/index.d.ts:1912–1918），动作定义也有 `FadeInTime/FadeOutTime`（types/index.d.ts:2462–2466 等）；Cubism motion 对象还公开 `setFadeInTime`/`setFadeOutTime`/`setWeight`（types/index.d.ts:4067–4082）。创建动作时，Cubism4MotionManager 在 10713–10727 为每个动作设置定义中的 FadeIn/FadeOut，缺省才使用全局默认值。

但这不能保证“停掉当前动作并立刻起播新动作”平滑：MotionManager 的 `_startMotion()` 在 10705–10708 先 `queueManager.stopAllMotions()`，而 queue 的 stop 在 4333–4341 直接 release 并清空 entry，旧动作没有机会按 fade-out 继续参与参数混合。之后新动作才入 queue。`ACubismMotion.updateParameters()` 的 fade weight 计算（2916–2949）只有 entry 仍存在并被更新时才生效。公开 `startMotion` 也没有 per-call fade 参数（types/index.d.ts:827–835）。因此仅靠公开 API/config，无法实现该抢占路径的极短淡出平滑；可以配置动作自身的正常 fade，但不能改变“旧 entry 先被清空”的抢占顺序。

## 结论 5：Meta.Loop=true 不会自然触发 onFinish/finished handler

`CubismMotion.updateParameters()` 的实际结束路径在 3680–3692：时间达到 motion duration 时，若 `_isLoop` 为 true，只把 queue entry 的 start time 重置为当前时间（并按设置重置 fade-in 起点），不设置 finished；只有非 loop 才调用 `_onFinishedMotion(this)`（3687–3689）并 `motionQueueEntry.setIsFinished(true)`（3690）。循环时间取模也在 3575–3579。

`ACubismMotion.setFinishedMotionHandler()` 的注释明确说明：设置 `isFinished` 时调用，循环 motion 不调用（3045–3047，注释 3035–3042）。queue manager 只有看到 entry finished 才在 4397–4407 移除。因此一个持续循环动作不会自然完成，finished handler/onFinish 不会到达，除非外部先停止/清除它（此时 stopAll 直接 release queue，也不是正常完成回调路径）。

另一个实现细节：`Cubism4MotionManager._startMotion(motion, onFinish)` 会把 handler 设到 motion（10705–10706），但 `MotionManager.startMotion()` 在 9142 调用 `_startMotion(motion)` 时没有把其 options 中解构出的 `onFinish` 传入；所以从当前这条公开 MotionManager.startMotion 路径看，调用者传入的 `onFinish` 也无法据此源码证明会被注册，属于实现上的未传递问题。

## 不确定项

1. 以上结论针对仓库实际解析到的 `node_modules/pixi-live2d-display-lipsyncpatch/dist/cubism4.js` 与对应 `types/index.d.ts`；未对浏览器运行时可能替换的其他 bundle 做结论。
2. `MotionState` 是打包产物中的公开导出，但没有额外源码映射；字段行为以产物实现为准。
3. 停止后 idle 是否最终播放还取决于 idle 定义、加载状态和下一帧 update；源码能确定会发起请求，不能保证每次请求成功。
