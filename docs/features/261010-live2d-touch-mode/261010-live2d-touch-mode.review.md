# 检视报告

## 概要

检视范围为 worktree `/root/projects/dsh-live-mode/.worktrees/live2d-interaction`（分支 `feat/live2d-interaction`）新增提交 `2224c69`（触摸模式 + HUD 拆层）与 `a928177`（flick/Shake 手势动作）。整体评价：实现架构清晰，纯函数计算与渲染管线解耦良好，HUD 层化严格保留了既有 DOM 选择器兼容性与像素级几何等价性，核心输入状态机防护严密，全链路自动化测试覆盖全面。存在少量建议优化项与非阻塞文案/设计细节需注意。

## 需求对齐

需求原话：「工具条加一个触摸模式（可以把全屏和打开独立窗口挪个位置到左或右上角），打开之后角色视线会跟随手指位置；并且模型的手势事件也都可以触发」。
- **满足情况**：
  1. HUD 拆层已将全屏与独立入口挪至右上角（`.lv-corner`），主胶囊（`.lv-capsule`）放置会话按钮及新增的触摸模式切换按钮；
  2. 触摸模式打开后，单指触屏与鼠标 hover 均通过 `TouchLookChannel` 接入既有 `look` 管线，松手后 450ms 缓动回落；
  3. 手势动作通过纯函数 `gesture-math.ts` 识别滑动速度、时长、主轴方向，起手命中模型后根据模型动作定义回退链（`Flick<方向>` → `Flick` → `Shake`）触发动作，NORMAL 优先级且设置 400ms 防抖冷却；
  4. 契约属性 `dataset.lvTouchLook` 与 `dataset.lvGesture` 均已落地，配套 30 项 e2e 测试与三份像素/图层验证脚本全部通过。
- **与计划差异/细节**：
  计划与 README/验证清单提及「⚙ 面板同开关」，但目前仅在 HUD 底部胶囊工具条提供了手指切换按钮，设置面板（`.lv-pop`）内部尚未加入对应的开关。鉴于工具条常驻按钮已能便捷切换且配置能够正常持久化，不阻塞本次合并，但建议后续迭代补齐或修正文案。

## 阻塞问题

无

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | [hud.tsx:540](src/client/hud.tsx#L540) 与 [README.md:193](README.md#L193) | **设置面板缺少触摸模式开关（文档与实现微小偏差）**：README 和 validation 文档均提到「工具条上的手指按钮打开（⚙ 面板同开关）」，但实际仅在底部胶囊工具条实现了按钮，⚙ 快捷面板（`.lv-pop`）及系统设置卡未包含该开关。 | 建议在后续迭代中在 ⚙ 面板的「体感实验」一栏补充触摸模式 Switch 开关，或先修正 README/CHANGELOG 中的「⚙ 面板同开关」描述，避免用户在面板中找不到开关产生困惑。 |
| ADV-02 | [model.ts:169-178](src/client/model.ts#L169-L178) | **`mountModel` 参数列表膨胀（已达 8 参）**：`mountModel(container, modelUrl, getMouth, onContextLost, layout, shared, tag, touchLook)` 随着能力扩展，可选参数位置已变长，易在后续调用扩展时产生参数对齐错误。 | 建议在后续架构重构时，将 `layout`、`shared`、`tag`、`touchLook` 等可选环境配置统一重构成 `options?: MountOptions` 对象参数，提升长期可读性与可维护性。 |
| ADV-03 | [view.tsx:903-911](src/client/view.tsx#L903-L911) | **触摸回落期对真实相机的覆盖**：松手后在 450ms 缓动回落阶段，`cam` 采用的是 `{ dx: release.vector.dx * (1 - progress), dy: release.vector.dy * (1 - progress) }`（直接衰减到 0）。若用户同时开启了前置摄像头视线追踪（`camera` 活跃且不为 0），松手后视线会先向 (0,0) 回落，到达 450ms 后瞬间切回摄像头的真实位置。 | 建议在缓动计算时，若 `camera` 存在，插值目标取 `camera` 而非 (0,0)，即 `lerp(release.vector, camera, progress)`，使从手指视线交接到摄像头视线更加平滑自然。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| INF-01 | [model.ts:797](src/client/model.ts#L797) 与 [model.ts:767](src/client/model.ts#L767) | **多输入设备混用时的指针状态重置边界**：`onPointerUp` 中 `releaseTouchLook()` 仅在 `pointerType === 'touch' \|\| 'pen'` 且 `activeTouches.size === 0` 时触发。鼠标在触摸模式下走 hover，离开舞台触发 `pointerleave` 时调 `releaseTouchLook()`。若在触摸屏电脑上同时用触屏和鼠标，极端时序下可能存在微秒级状态交叠。 | 逻辑已有防御（hover 互斥于 `touch`），仅作边界备忘记录。 |
| INF-02 | [view.tsx:1437](src/client/view.tsx#L1437) | **首次开启提示的防阻断容错**：`window.localStorage.getItem(TOUCH_HINT_KEY)` 未使用 try-catch 包裹（在某些处于隐私模式或禁用 localStorage 的浏览器环境下可能会抛出 SecurityError 导致切换中断）。 | 建议参考其他地方加 `try { ... } catch {}` 进行防御。 |

## 准入结论

**结论**：`准入`

**说明**：本次 HUD 拆层保持了完美的 DOM 契约与视觉等价性，指针状态机逻辑闭环、防抖与回退链路完善，自动化回归测试健全且全部通过，无阻塞性缺陷，符合合并标准。建议修改项可在后续迭代中顺带处理。
