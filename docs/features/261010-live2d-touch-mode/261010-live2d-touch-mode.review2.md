# 检视报告：261010 触摸模式二次迭代与真机验收前加固

## 概要

本轮检视针对触摸模式首轮准入后的全部后续改动。覆盖提交范围为 `90e8436`、`6336875` 以及 `91d44b5..HEAD`（具体包含 `479bb81`、`23f1333`、`503aaaf`、`4c6b0de`、`8cc8827`、`19e76a5`、`c7452dd`、`706c6a0`、`7ce3938`、`ffdacb6`、`31578af`、`71020e2`、`eaf5b06`、`cc95c06`、`a2ab725`、`f2ce8a8`、`bc41517`、`cd31ad2`、`8748aab` 等）。
显式排除范围：`docs/freeform/**`（35 个属于其他 agent 的误暂存文件，已在 `b55fe7c` 取消跟踪）、以及工作树中未提交的脏文件 `lib/index.js`（含他人 2 行标签修改）。
整体评价：改动架构清晰，`mountModel` 参数对象化重构精准且零失误；`lvMotionBusy` 历经粗信号到 MotionState 优先级的深入排查并最终收敛到精确信号，因果链设计严谨；e2e 断言机制完备，构建了多层正反向对照与防假通过护栏；文档中对风险与证据边界做了如实披露。整体达到高水准准入要求。

## 需求对齐

1. **功能修复与需求落地**：
   - 补齐了首轮检视建议项：`settings-section.tsx` 新增 `touchMode` 配置卡开关（ADV-01）；松手后视线回落改为朝摄像头视线/正视插值避免跳变（ADV-03）；`localStorage` 捕获异常加固（INF-02）。
   - 修复了 host 侧保存白名单遗漏 `touchMode` 的持久化 bug（`6336875`），使得配置能真正落盘。
2. **因果归因与测试可信度**：
   - 引入 `dataset.lvGestureSeq`，解决了单纯依赖 `dataset.lvGesture` 时由于陈旧值导致的假通过漏洞。
   - 引入 `dataset.lvMotionBusy` 精确信号，使 e2e 滑动由盲目重试演进为单次确定性断言（1 次 ×7），排除了 flake。
3. **架构重构**：
   - 兑现重构计划 ADV-02：将 `mountModel` 8 个位置参数成功重构为 `MountModelOptions` 具名接口，消除了多参数类型混淆隐患。

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| 无  | 无   | 无   | 无   |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | [src/client/model.ts:497-499](src/client/model.ts#L497-L499) | **双模型（第三人称/视频通话）场景下 `lvMotionBusy` 共享键覆盖**：在 `beforeModelUpdate` 钩子中，写入的是共享属性 `container.dataset.lvMotionBusy`。在双模型场景下，Ai 与 Player 两个模型各自独立触发 `beforeModelUpdate`，共享属性会发生 last-writer-wins 覆盖。虽然当前 e2e 主要在单模型下断言手势，但与 `lvTransform`/`lvParamIds`/`lvGesture` 均提供 per-tag（`lv{Ai,Player}*`）的规范相比，缺少了 per-tag 镜像。 | 建议在后续迭代中补充：若存在 `tag`，同步维护 `container.dataset[\`lv\${tag}MotionBusy\`] = busy;`，保持多模型契约的一致性。 |
| ADV-02 | [e2e/verify-touch-mode.mjs:107](e2e/verify-touch-mode.mjs#L107) | **`waitMotionIdle` 超时时间在单次滑动时固定为 4000ms**：`waitMotionIdle(capMs = 4000)` 在 `swipeOnce` 中未暴露配置参数；而在极端卡顿的 headless 环境或遇到极长动作时，若 4s 未空闲会直接报 `idle-timeout` 失败。虽然当前 4s 经实测完全满足现有模型，但对于不同动作时长的模型扩展性稍显僵硬。 | 建议允许 `swipeOnce` options 透传 `idleTimeoutMs`，并在测试报告中记录等待实际耗时。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| INF-01 | [src/client/model.ts:499](src/client/model.ts#L499) | **`beforeModelUpdate` 每帧 DOM 操作微优化**：代码已包含 `if (container.dataset.lvMotionBusy !== busy)` 脏检查，只有值改变时才会触发 DOM dataset 修改；且在 headless 低帧率及真机 60fps 下，dataset 字符串比对开销极其微小（微秒级），不会造成帧率抖动。但在双模型高频更新下，脏检查已能有效遏制 DOM 属性变更。 | 保持现有写法即可，无需过度优化。已正确在 `destroy()` 时执行 `delete container.dataset.lvMotionBusy`，生命周期清理对称完备。 |
| INF-02 | [docs/features/261010-live2d-touch-mode/261010-live2d-touch-mode.validation.md:197](docs/features/261010-live2d-touch-mode/261010-live2d-touch-mode.validation.md#L197) | **文档口径细节一致性检查**：§十一中提到门槛 3 的红路注入测试已完成（32/39 失败，恢复后 39/39 绿灯），但在稍前的一处小标题中仍残留"未实跑验证（证据级别：静态）"的早期字样。 | 建议在后续归档文档整理时，将该处早期静态说明与后文"升级为已验证"的结论措辞统一收敛。 |

---

## 重点专题专项检视结论

### 1. `mountModel` 参数对象化核对
- **签名与解构**：`MountModelOptions` 声明包含 `container`, `modelUrl`, `getMouth`, `onContextLost`, `layout`, `shared`, `tag`, `touchLook` 共 8 个字段，`mountModel` 形参使用解构赋值，变量名与旧函数体内引用完全一致。
- **调用点字段核对（`src/client/view.tsx`）**：
  - **Ai 模型调用点（540–556 行）**：
    - `container`: `stageRef.current`（旧第 1 参）
    - `modelUrl`: `url`（旧第 2 参，string）
    - `getMouth`: 口型闭包（旧第 3 参）
    - `onContextLost`: 上下文丢失回调（旧第 4 参）
    - `layout`: `dual ? ... : undefined`（旧第 5 参，object）
    - `shared`: `sharedStageRef.current ?? undefined`（旧第 6 参，object）
    - `tag`: `"Ai"`（旧第 7 参，string）
    - `touchLook`: `touchLookChannelRef.current`（旧第 8 参）
  - **Player 模型调用点（645–661 行）**：
    - `container`: `stageRef.current`（旧第 1 参）
    - `modelUrl`: `url`（旧第 2 参，string）
    - `getMouth`: `inWindow ? mouthFromMic : ...`（旧第 3 参）
    - `onContextLost`: 上下文丢失回调（旧第 4 参）
    - `layout`: `inWindow ? ... : ...`（旧第 5 参，object）
    - `shared`: `stage`（旧第 6 参，object）
    - `tag`: `"Player"`（旧第 7 参，string）
    - `touchLook`: `touchLookChannelRef.current`（旧第 8 参）
  - **同类型参数对特别核实**：
    - `modelUrl` 与 `tag` 均为 `string`：完全对应，无颠倒。
    - `layout` 与 `shared` 均为 `object`：完全对应，无颠倒。
  - **结论**：确系纯重构，无功能破坏或类型漂移。

### 2. `lvMotionBusy` 语义与实现
- **优先级计算与判定**：
  - 优先级读取路径：`internal.motionManager.state?.currentPriority` 与 `reservePriority`。
  - 优先级常量：pixi 规范中 `MotionPriority.NONE = 0`, `IDLE = 1`, `NORMAL = 2`, `FORCE = 3`。
  - 手势动作与点击以 `NORMAL`（2）触发，框架判定规则为当前优先级 `< priority` 才放行。因此当 `max(current, reserve) >= 2` 时，新的 `NORMAL` 动作必定被框架静默拒绝。
  - `priority >= 2 ? "1" : "0"` 判定与 Pixi `MotionState` 拒绝机制完全精确对齐。
- **生命周期与性能**：
  - 在 `beforeModelUpdate` 钩子中执行，带有 `!== busy` 变更前置守卫，避免每帧重写 DOM。
  - 在 `mountModel` 的 `destroy()` 中有显式的 `delete container.dataset.lvMotionBusy`，生命周期管理完整。

### 3. `lvGestureSeq` 因果归因链
- **唯一性与产品侧读方**：
  - 写入点全仓唯一：`src/client/model.ts` 第 698 行（`handleSwipe` 成功起播分支中 `++gestureSeq`）。
  - 清理点：第 1023 行（`destroy()`）。
  - 产品代码完全无读方，属于纯 DOM 观测与诊断契约。
- **因果归因有效性**：
  - 被拒绝的滑动不会进入成功分支，`lvGestureSeq` 不会递增。
  - e2e 测试要求 `seq1 !== seq0 && seq1 !== null` 且 `value === expected`，彻底杜绝了读取上一轮残留 dataset 的假通过漏洞。

### 4. e2e 断言可信度与时序
- **避免自证式陷阱**：
  - T18 引入正向对照：验证在动作播放期间 `lvMotionBusy` 确实被观测为 `"1"` 且播完回到 `"0"`，防止内部字段名读错导致恒为 0 的假绿。
  - T14 故意传入不存在的期望手势，断言测试框架必判红且 seq 不变。
  - T15 使用鼠标滑动（设计上不触发手势），断言 seq 不动且契约保持 null，验证手势的输入隔离。
  - T17 断言单次滑动尝试分布全为 1 次，证明重试逻辑未在底层掩盖故障。
- **低帧率适配**：
  - headless 环境下约 2 fps，`waitMotionIdle` 提供了 4000ms 充足上限，轮询间隔 60ms；滑动间隙与回落捕获等待时间均适配了低帧率环境。

### 5. 文档与产物一致性
- `baseline.md` 披露的 sha256 历史记录完整且可独立复核。当前 `lib/client.js`（`c9fd1924...`）与 `lib/standalone.js`（`39a3ef2c...`）与最新构建产物完全吻合。
- 风险说明深入诚实，明确区分了源码级静态推断与红路实跑验证。

---

## 准入结论

**结论**：`准入`

**说明**：全部核心改动（具名参数重构、`lvGestureSeq` 归因计数、`lvMotionBusy` 精确信号与 e2e 校验体系）逻辑缜密、证据链完整，无任何阻塞性缺陷；配置落盘与回落插值等历史建议均已稳固闭环。代码与构建产物可安全进入真机验收阶段。
