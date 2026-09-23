# 检视报告

## 概要

本次对 `dsh-live2d-voice` 插件开展第二轮回归检视（Review 2），重点核验首轮报告中指出的 4 项阻塞问题（BLK-01 ~ BLK-04）、5 项建议修改（REC-01 ~ REC-05）和 3 项非阻塞问题（MIN-01 ~ MIN-03）的落实情况，并对用户最新追加的“语音模式动态切换（SpeechModes 状态机）”与“自定义提示词（`speechPrompt`）”功能进行架构与实现质量检视。

整体评价：首轮发现的全局提示词污染、Turn 结算死锁、打断缺少 Abort 联动、Web Audio 上下文泄漏等核心阻塞缺陷已全部得到根本性修复；新增的状态机与会话级门控设计精炼，E2E 21/21 验证通过。本轮未发现阻塞性缺陷，但发现一处在极速打断场景下旧轮 `speech-end` 可能误伤新轮播放的竞态边缘遗漏，评定为条件准入。

## 需求对齐

1. **首轮遗留问题彻底对齐**：
   - **BLK-01 全局提示词污染**：引入 `deps.hub.has(sessionId)` 严格会话级门控，只有 Live2D 视图处于激活（SSE 连接中）的会话才注入提示词，未配置 `modelPath` 永不注入。
   - **BLK-02 Turn 结算被挂起**：移除了生成器中的 `await queue`，LLM 流结束后生成器立即放行下游 Agent Turn 结算，由后台任务独立排空 TTS 队列并触发结束事件。
   - **BLK-03 新旧语音混杂**：Host 端建立了 `activeSpeech` 追踪并在新轮次触发时主动 `abort()` 旧轮 TTS；Client 端建立 `utteranceId` 门控与立即清理。
   - **BLK-04 AudioContext 泄漏**：`SpeechEngine` 增加了 `destroy()`，并在 `Live2DView` 卸载钩子中执行 `context.close()`。
   - **建议与非阻塞项**：Disposer 泄漏（REC-01）、Canvas 残留（REC-02）、字幕提前跳字（REC-03）、URL 路径解析（REC-04）、连接断开后空转（REC-05）、README 缺失（MIN-01）、移动端适配（MIN-02）、口型归零（MIN-03）等均已针对性修复。
2. **新增规格对齐**：
   - **语音模式动态切换**：通过 `SpeechModes` 状态机管理 `live` 与 `exited` 状态。会话切回普通对话后的首轮自动注入“已退出语音模式”提醒节，并在该轮 LLM 流结束时自动清理，平滑恢复普通 Markdown/代码块对话。
   - **自定义提示词 `speechPrompt`**：配置项支持持久化，HUD ⚙ 抽屉支持动态编辑与热保存，仅在语音模式下随情绪协议一并注入。

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| - | - | 无 | - |

## 建议修改

Should fix；不影响基本准入，但强烈建议在合并前或后续小版本中处理。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| REC2-01 | `src/client/view.tsx:154-156` | **客户端 `onSpeechEnd` 未校验 `utteranceId`，并发打断时上一轮迟到的 aborted 事件会掐断新一轮播放**<br>在 `view.tsx` 中，`onExpression`、`onAudioStart`、`onAudio` 均严格校验了 `if (utteranceId !== activeUtterance.current) return;`。然而在 `onSpeechEnd` 中直接执行了：<br>`if (reason === "aborted") engineRef.current?.stop();`<br>当用户打断上一轮语音提问新消息时，新一轮已经分配了新的 `activeUtterance` 并启动了音频播放；上一轮后台 TTS 在被 abort 后异步完成排空，向客户端推送了上一轮的 `speech-end(reason: "aborted")`。客户端未校验该事件所属的 `utteranceId`，会直接执行 `engine.stop()`，导致新一轮刚刚开始播放的声音被瞬间误杀掐断。 | 补齐 `utteranceId` 门控：<br>```ts<br>onSpeechEnd: ({ utteranceId, reason }) => {<br>    if (utteranceId !== activeUtterance.current) return;<br>    if (reason === "aborted") engineRef.current?.stop();<br>}<br>``` |
| REC2-02 | `src/client/hud.tsx:101` | **HUD 自定义提示词抽屉未编辑时“保存提示词”按钮处于可用状态**<br>“保存提示词”按钮的禁用判断为：<br>`disabled={draftPrompt !== null && draftPrompt.trim() === props.speechPrompt.trim()}`<br>当用户刚刚点开 ⚙ 抽屉时，`draftPrompt` 初始为 `null`，导致禁用条件判定为 `false`，按钮高亮可点击。用户若误点会触发无意义的保存和 toast 提示。 | 修改禁用逻辑为：当未作任何修改（初始 null 或修剪后与已保存值相同）时禁用：<br>```ts<br>disabled={draftPrompt === null \|\| draftPrompt.trim() === props.speechPrompt.trim()}<br>``` |

## 非阻塞问题

Nice to have；记录备忘。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| MIN2-01 | `src/client/hud.tsx:31` | **关闭 ⚙ 抽屉后再次打开，未保存的草稿仍停留在组件状态中**<br>`draftPrompt` 状态保存在 `Hud` 组件中。如果用户输入了部分内容但未点保存就关闭了抽屉，再次点开抽屉依然会显示旧草稿，缺少“还原/取消”或随抽屉关闭自动丢弃草稿的生命周期同步。 | 可在 `popoverOpen` 状态切换为 false 时，调用 `setDraftPrompt(null)` 复位草稿。 |
| MIN2-02 | `src/system-prompt.ts:27` | **`SpeechModes` 内部 Map 会话键未随长时间不活跃会话进行淘汰**<br>`modes = new Map<string, SessionSpeechMode>()` 记录各会话的 live/exited 状态。正常情况下切回普通会话对话一次后会被 `clearExited` 清除；但若某个会话打开过 Live2D 后直接被用户删除或再未在此会话发言，该 key 会常驻于内存。虽然每个条目仅十几字节，但长期运行会有轻微游离。 | 可在适当时机（例如感知会话销毁事件或 LRU 限制）做容量守卫，或在会话退出超过阈值时淘汰。 |

## 准入结论

**结论**：`条件准入`

**说明**：首轮 4 项严重阻塞缺陷（全局提示词污染、Turn 挂起、打断混叠、Web Audio 泄漏）已全部通过重构与生命周期解耦真正解决，新增的会话级动态状态机与提示词配置实现优雅规范，并通过 21/21 E2E 验证。准入无阻断项；建议在合并交付前顺手修补 `REC2-01`（`onSpeechEnd` 的 `utteranceId` 门控）以彻底闭环打断场景的音频稳定性。
