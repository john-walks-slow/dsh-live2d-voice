# src/client AGENTS.md

## 职责

浏览器侧 Live2D 视图：模型渲染（pixi v7 + Cubism）、音频播放队列与口型驱动、字幕/HUD/设置 UI、SSE 事件消费、与 host 插件路由的 API 交互。构建产物 `lib/client.js`（react runtime external，pixi/live2d 打包，`@deepseek-ai/*` external 由宿主提供）。

## 地图

- `view.tsx` — 视图主组件：SSE 事件分发（按 speaker 分流 assistant/player）、双模型挂载与布局、字幕/输入/回声参照
- `engine.ts` — SpeechEngine：AudioContext 播放队列、RMS 包络、说话人感知（speakerSpans / currentSpeaker / mouthValue(speaker)）
- `model.ts` — Live2D 模型挂载：createLive2DStage（共享 Pixi Application）、mountModel(shared?)、setLayout
- `hud.tsx` — HUD 按钮与 ⚙ 快捷面板（音色/模型/语言/第三人称等）
- `settings-section.tsx` — 系统设置里的插件设置卡
- `subtitle.tsx` / `styles.ts` — 字幕渲染与全部样式
- `api.ts` / `types.ts` — host 路由调用与共享类型（`Speaker` 等）

## 核心设计

- **共享 Pixi Application**：第三人称模式下双模型（AI + 玩家）挂同一个 `SharedStage`（同一 WebGL context）。view 顶层 effect 创建/销毁 stage；模型 mount 传 shared，destroy 只销毁 model 不动 app/canvas；布局变化走 `setLayout`，不重载模型。
- **SSE 事件 speaker 字段**：事件名全部复用（speech-start/audio/subtitle/expression…），payload 带 `speaker?: "assistant" | "player"`，缺省 = assistant（向后兼容）。音频单队列天然保证先玩家后 AI（host 侧玩家台词 TTS settle 后才向 agent 提交）。**事件顺序约定：expression 必须在 speech-start 之后发射**——客户端 onExpression/onAudio 按 active-utterance 门控，active 由 speech-start 更新，先到的表情会被静默丢弃。
- 面板值（⚙/系统设置）→ saveConfig → fetchModelInfo 回读驱动视图 effect——配置文件是单一事实源，客户端不自行推导。

## Pitfalls

- **Cubism SDK 的 WebGLManager 是全局单例**，持最后一次 init 的 gl 指针。**绝不能开第二个 WebGL context 装模型**（双 Pixi Application / 双 canvas 叠放都会触发）：后挂载的 context 抢占单例，先挂载的模型每帧 bindTexture 全部 INVALID_OPERATION、渲染空白且无报错日志。多模型必须共享同一 Application（见 model.ts SharedStage）。
- 字幕 DOM 类名（`.lv-sub-card` / `.lv-sub-old` / `.lv-sub-pending`）是 e2e 脚本的断言契约，改名或重构字幕结构时同步更新 `e2e/verify-*.mjs` 选择器。
- audioSeq 字幕 hold 的 seq 空间**按 speaker 隔离**：assistant 与 player 的 seq 计数器各自每轮从 0 起，engine 的 `currentSeq(speaker)` 按 speaker 过滤——跨 speaker 比较 seq 会击穿 hold（字幕提前或立即释放）。
