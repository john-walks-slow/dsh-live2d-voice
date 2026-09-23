# 检视报告

## 概要

本次对全新的 DSH Live2D Realtime Voice 插件（Phase 1）进行完整实现与架构审查，覆盖了从 Host 侧 Cordis 插件体系、LLM Stream 拦截处理、Fish Audio 流式合成与多 Key 轮询，到 Web 端 Pixi.js / Live2D Cubism 4 渲染、Web Audio PCM 解码排队播放以及 HUD 交互的全链路代码。整体代码结构严整紧凑，构建管线与 E2E 验证扎实，但在全局提示词污染、流生成器阻塞下游 Turn 结算、打断与 Abort 传播机制以及 Web Audio 资源释放等方面存在数项阻塞性隐患，须在修复后重新准入。

## 需求对齐

Phase 1 设定的各项核心功能均已初步落实：
1. **Live2D 视图集成**：成功通过 `ctx.slots.register("conversation.view")` 在 DSH Web GUI 会话视图中挂载 "Live2D" 标签页，并注入 Cubism Core 脚本。
2. **口型与表情驱动**：基于 Pixi.js v7 与 `pixi-live2d-display-lipsyncpatch`，通过 `beforeModelUpdate` 勾住口型参数覆盖，并支持基于模型 `LipSync` 组与默认参数；情绪标签成功提取并触发对应表情设置。
3. **语音流式合成与播放**：支持通过 Fish Audio 多 Key 轮询流式拉取 44100Hz 原始 PCM，并通过 SSE 下发至浏览器以自定义 `PlaybackQueue` 调度无缝播放。
4. **HUD 与输入交互**：实现了静音切换、字幕显示控制、键盘输入以及音色快切抽屉，用户消息优先走 `SessionFace.prompt` 规范通道提交。
5. **与计划差异**：目前 `systemPrompt` 的格式约束被全局注册给所有会话，而不仅限于打开 Live2D 视角的交互；且目前缺少 `README.md` 文档。

## 阻塞问题

Must fix before admission. 存在 4 项阻塞问题：

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLK-01 | `src/system-prompt.ts:21-36` | **全局 System Prompt 无条件注入导致非 Live2D 会话遭到破坏**<br>当前 `applySystemPrompt` 以静态 order 9800 全局注册了一个约束提示词，明令禁止输出列表、代码块、链接或 Markdown 符号，并强行要求每句必须加情绪标签。即使用户尚未配置 Live2D 模型（`modelPath` 为空），或者在其它普通 Chat 标签页中进行编程开发、执行命令或架构讨论，该提示词依然对所有会话无差别生效，导致日常编码会话的 Agent 输出质量严重劣化（拒绝输出代码块和列表结构）。 | 1. 当 `!getConfig().modelPath`（未配置角色模型）时，`text()` 应直接返回空字符串 `""`，不产生任何提示词污染。<br>2. 建议在配置项中增加显式的 `enableSpeechPrompt` 选项（或支持基于 session 判定），避免全局污染正常开发会话。 |
| BLK-02 | `src/speech.ts:70` | **`speak` 异步生成器在流末尾 `await queue` 导致下游 Agent Turn 结算被长时间挂起**<br>`speak` 作为 `llm/stream` 的下游装饰生成器，在 LLM 吐完全部 token 后并没有立即退出，而是执行 `await queue;` 等待整段回答中所有句子的 Fish Audio 串行合成全部结束。在句子较多或网络有延迟时，整轮 Agent Turn 会被强行同步卡顿数十秒（Turn 无法完成落盘、无法结算、无法响应后续流程）。若此时 Fish Audio 超时或挂起，将直接死锁该轮会话。 | 解耦 LLM 流输出与后端 TTS 任务：LLM 完成所有 chunk 输出并 flush 后，`speak` 生成器应立刻结束（让上游 Agent Turn 正常完成）；TTS 队列继续在后台独立执行，等待队列完成后由后台任务发送 `audio-end` 与 `speech-end`，并统一纳入 session 的任务生命周期管理。 |
| BLK-03 | `src/speech.ts:44-55`<br>`src/client/view.tsx:143` | **多轮连续提问/并发打断时缺乏 Abort 联动，导致新旧语音混杂交叉播放**<br>`speak` 内部的 `abort` 控制器仅为函数级局部变量。若用户在角色尚未朗读完毕时再次发送新消息（或触发新轮次），旧的串行 `queue` 仍在后台向该 `sessionId` 发送旧的 `audio` 事件；而客户端 `onAudio` 未校验 `utteranceId`，会将新旧语音 chunk 一并压入同一个播放队列，导致两个回答的音频重叠或乱序播放，角色口型与表情错乱。 | 1. 在 `SpeechTap` 或 `deps.hub` 级别维护 `activeSpeech = new Map<string, { utteranceId: string; abort: AbortController }>()`，新对话流触发时主动中止上一轮尚未完成的 TTS 队列。<br>2. 客户端在 `onSpeechStart` / `onAudioStart` 时记录活跃 `utteranceId`，当收到不匹配的历史包时直接丢弃，并在新一轮开始时清空尚未播放的旧音频缓冲。 |
| BLK-04 | `src/client/engine.ts:18`<br>`src/client/view.tsx:65-71` | **Web Audio `AudioContext` 缺乏生命周期销毁机制，Tab 切换导致上下文泄漏与静音**<br>`view.tsx` 在组件 unmount 时仅将 `engineRef.current` 置为 `null`，而 `SpeechEngine` 既没有提供 `destroy()` 方法，也没有对内部的 `AudioContext` 执行 `close()`。用户在 Chat 和 Live2D 标签页之间来回切换数次后，将迅速触发现代浏览器单页面 `AudioContext` 数量上限（通常为 6 个），导致后续音频初始化报错并彻底失声。 | 在 `SpeechEngine` 中补充 `destroy()` 方法，内部调用 `this.stop()` 及 `this.context?.close()`；在 `view.tsx` 的清理回调中调用 `engineRef.current?.destroy()`。 |

## 建议修改

Should fix；不影响准入但强烈建议处理。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| REC-01 | `src/system-prompt.ts:21`<br>`src/index.ts:35-37` | **`systemPrompt.section` 返回的注销函数被丢弃，插件热重载时发生泄漏**<br>`systemPrompt.section(...)` 调用会返回一个 disposer，但未被收集并在插件卸载（`apply` 返回的清理闭包）中调用。若插件发生重载，会导致该 section 被重复注册多份。 | 保存 `systemPrompt.section` 返回的注销函数，并在 `src/index.ts` 的 `apply` 返回闭包中统一执行。 |
| REC-02 | `src/client/model.ts:25-33` | **`mountModel` 加载模型失败时 Pixi Application 与 canvas 节点残留**<br>`mountModel` 在函数开始时即创建了 `app = new Application(...)` 并挂载到了 DOM 容器中，若后续 `Live2DModel.from(modelUrl)` 抛出网络或模型格式异常，没有针对性的 catch 块销毁 `app`，导致孤儿 canvas 和 WebGL 上下文残留在页面上。 | 将加载逻辑置于 `try...catch` 中，一旦加载失败立即调用 `app.destroy(true, { children: true })` 清理 DOM 与显存后再向外抛出异常。 |
| REC-03 | `src/speech.ts:101-104` | **字幕推送早于音频实际播放时序，短句合成速度快于播放时导致字幕提前跳字**<br>服务端在调用 `synthesize` 网络请求前就立即发射了 `subtitle` 事件。当 TTS 合成非常迅速（例如短句合成仅需几百毫秒，但朗读需要几秒）时，后一句的字幕会提早显示为高亮大字，导致字幕“剧透”且与声音脱节。 | 建议在音频元数据中携带句子关联标记，或由客户端播放队列在某句音频实际进入声卡播放时再更新当前激活的大号字幕。 |
| REC-04 | `src/routes.ts:244` | **ESM 路径解析使用 `new URL(import.meta.url).pathname` 存在特殊字符与平台兼容隐患**<br>`dirname(new URL(import.meta.url).pathname)` 当路径中包含空格、中文（URL 转义字符 `%20` 等）或非 POSIX 路径时，解析出的文件系统路径不正确。 | 使用 Node.js 官方推荐的 `import { fileURLToPath } from "node:url"`，写作 `fileURLToPath(import.meta.url)`。 |
| REC-05 | `src/events.ts:52-66` | **SSE 客户端断开后未中止进行中的后台 TTS 合成**<br>当用户关闭页面或离开 Live2D 视角导致 SSE 连接全部关闭时，后端未触发当前 TTS 任务的取消，剩余句子的合成仍会继续向 Fish Audio 发起 HTTP 请求，浪费配额与算力。 | 当检测到某会话的所有 SSE 连接均已断开（连接集合为空）时，触发该会话当前 TTS 任务的 `abort()`。 |

## 非阻塞问题

Nice to have；记录备忘。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| MIN-01 | `package.json:18` | **`package.json` 中的 `files` 字段声明了 `README.md` 但根目录下尚无该文件**<br>根目录缺少 `README.md`，且产物清单中遗漏了 `lib/types` 类型定义目录。 | 按照 `dev-dsh-plugin` 规范补充中英文 README 文档，并在 `files` 列表中添加 `lib/types`。 |
| MIN-02 | `src/client/styles.ts:98, 123` | **小屏幕设备（如手机移动端）下 HUD 宽度正常但输入框与字幕宽度偏窄**<br>`width: min(72%, 640px)` 在 360px~390px 宽度的移动设备上可用宽度偏小。 | 增加响应式样式，在小屏幕宽度下将输入框与字幕宽度调整为 `min(92%, 640px)`。 |
| MIN-03 | `src/client/model.ts:60-65` | **口型参数在声音归零时未显式复位**<br>`if (value > 0.002)` 守卫在音量彻底归零时直接跳过设置。若模型此时无动作动画更新嘴型，ParamMouthOpenY 可能停留在最后一次微弱采样的数值。 | 可在由说话状态切换至静止状态的过渡帧显式设置一次 0。 |

## 准入结论

**结论**：`不准入`

**说明**：插件功能完成度较高且 E2E 验证充分，但存在严重的全局 System Prompt 污染（破坏普通编码会话）、`llm/stream` 串行等待死锁风险、并发提问打断缺失导致的音频混杂，以及 Web Audio AudioContext 泄漏等 4 项阻塞性设计缺陷，必须完成修复并通过回归检视后方可准入。
