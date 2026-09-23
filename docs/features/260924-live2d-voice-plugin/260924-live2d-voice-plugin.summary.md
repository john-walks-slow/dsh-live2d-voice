# dsh-live2d-voice Phase 1 — 实施总结

**日期**：2026-09-23 ~ 09-24
**仓库**：`/root/plugins/dsh-live2d-voice`（初始提交 `0e2b5d8`，34 文件）
**状态**：e2e 21/21 全绿 ×3 轮；两轮审查闭环（首轮不准入→修复→条件准入→REC2 项闭环）；已提交；线上部署待用户确认

## 审查与修复（260924 第二轮）

reviewer 首轮结论"不准入"（4 阻塞 + 5 建议 + 3 备忘，全文见同目录 .review.md），全部修复并回归 e2e 21/21：

| 问题 | 修复 |
| --- | --- |
| BLK-01 全局提示词污染所有会话 | **会话级按需注入**（对齐 dsh-plan-mode 先例）：section text 回调读 `context.agent` 解析 sessionId，`hub.has(sessionId)`（Live2D 视图在连）才注入语音格式节；`modelPath` 未配置则永不注入 |
| BLK-02 `await queue` 阻塞 Turn 结算 | 生成器在 LLM 流结束即返回，TTS 队列后台排空，`audio-end`/`speech-end` 由 drain 任务发射（settled 一次性守卫） |
| BLK-03 新旧语音混杂 | host：per-session activeSpeech map，新流中止旧轮 TTS；client：utteranceId 门控（speech-start 换轮即 engine.stop() 清队，旧 chunk 丢弃） |
| BLK-04 AudioContext 泄漏 | `SpeechEngine.destroy()`（stop + context.close），view unmount 调用 |
| REC-01 section disposer 丢弃 | applySystemPrompt 返回 disposer，apply 清理闭包统一执行 |
| REC-02 模型加载失败残留 canvas | mountModel try/catch → app.destroy 后 rethrow |
| REC-03 字幕先于音频剧透 | subtitle 改在句子首个 PCM chunk 到达时发射（无 key/失败时兜底立即发射） |
| REC-04 URL pathname 解析 | `fileURLToPath(import.meta.url)` |
| REC-05 断开后 TTS 空转 | SseHub.onLastClose → abort 该会话进行中的合成 |
| MIN-02 移动端宽度 | @media ≤640px 字幕/输入/提示 92% |
| MIN-03 口型不归零 | 静音时显式写 0 |

### 规格更新（用户 260924）：语音模式动态切换 + 自定义提示词

- **只在 Live2D tab 激活时注入**：hub 连接即模式信号（conversation.view ring 是过滤渲染，inactive 即卸载 → SSE 生命周期 = tab 激活态）
- **切回普通对话自动提醒**：SpeechModes 状态机 live→exited，exited 时注入"已退出语音模式"节；该会话首个非监听对话流完成后清理 exited（不长期残留）
- **`speechPrompt` 配置项**：自定义指令拼进语音模式节（例"总是用日语交流"），HUD ⚙ 抽屉提供 textarea 编辑，切回普通对话自动失效
- 普通会话从零污染：从未 live 过的会话永远不注入任何节

修复后 e2e 21/21（expression joy 事件验证了门控注入真实生效——回复为口语化、无 Markdown、带 [joy] 标签）。

## 目标回顾

DSH Web GUI 会话视图新增 Live2D tab：Live2D 角色实时语音互动——AI 回复流式 TTS（Fish Audio）+ 口型同步 + 情绪表情 + 双语字幕 + 键盘输入 + 音色快切。语音输入与字幕翻译留待后续阶段。

## 架构与关键决策

### 双产物构建
- `lib/index.js`（ESM，host 侧 cordis 插件，20KB）
- `lib/client.js`（浏览器 bundle，~640KB：react runtime external、pixi v7 + pixi-live2d-display-lipsyncpatch 打包、`@deepseek-ai/*` external 由宿主 ModuleLoader 提供）

### 消息提交：走 GUI 会话通道（本期最大弯路后的正确解）
初版 view 直接 POST 插件自有路由 `/live2d-voice/message` → `ctx.agents.get(sessionId)` → **冷会话 404**（查看历史会话不驻留活 agent）。host 侧复刻 session-controller 的 resume/createOrAdopt（preset composition + subagent ownership）过重，放弃。

终版：client 侧 `ctx.sessions.binding(sessionId).session.prompt([{type:'text',text}], 'queue')`——与 Chat composer 同通道，冷会话由 host 在 session/prompt 内创建/resume agent。POST 路由保留为活 agent 后备。

**类型坑**：host 侧 dsh-session 与 client 侧 dsh-client-runtime 都向 cordis `Context` merge `sessions`（SessionStore vs ISessions）；skipLibCheck 下 merge 冲突被吞、host 侧声明胜出 → client 代码需 `ctx.sessions as unknown as ISessions` 显式收窄。

### 语音管线（host）
`llm/stream` 纯 tap（`next()` waterfall，purpose skip，仅 hub 有监听的会话）→ SentenceBuffer 句子切分 + `[joy]` 类情绪标签提取（标签不进字幕）→ 串行句级 Fish TTS（`POST /v1/tts` format=pcm，44100Hz 流式 PCM，多 key 401/402/429 轮询）→ SseHub 按会话 fan-out（expression / subtitle / speech-start / audio-start / audio(seq) / audio-end / speech-end / error）。

### 浏览器侧
- pixi v7 + Cubism 4（Core 经 `webserver/index-inject` script-src 注入，remote-web-ui 同款先例）；`beforeModelUpdate` 写 `ParamMouthOpenY`
- PlaybackQueue：AudioContext 播放队列 + RMS 包络（attack 50ms / release 130ms）
- 字幕浮层 14s TTL；HUD 按钮状态 localStorage 持久化
- 用户行字幕为本地 push（client 通道不发 SSE 用户事件）；host 后备路由则由 SSE 事件补

### system prompt
`systemPrompt` 服务直接 `.section({ order: 9800 })` 注入角色协议（要求句首情绪标签）。**坑**：`ctx.get("systemPrompt")` 返回服务实例而非 ctx 包装（曾写成 `prompt.systemPrompt.section` 导致 e2e boot 崩溃）。

## 验证

- 单测：SentenceBuffer 16 用例（npm test 不存在，tsc 内联跑）✅
- typecheck 0 错、build 双产物 ✅
- e2e（camoufox + 软件 WebGL，隔离实例 :4188）：**21/21** ✅
  - 关键通过点：SSE 全链事件计数、TTS 真实调用（129~506 PCM chunks/轮）、DOM 字幕两条、冷会话提交链路
  - 脚本固化于 `e2e/verify-live.mjs`

### e2e 踩坑记录（已固化进脚本注释）
1. camoufox `page.evaluate` 是 Xray window：内容 realm 全局需 `window.wrappedJSObject ?? window`（曾误判 CubismCore 未加载）
2. 无头需软件 WebGL：`MOZ_WEBGL_FORCE_ENABLE=1 LIBGL_ALWAYS_SOFTWARE=1` + firefoxUserPrefs
3. 会话行选择器 `[role=treeitem]` 过滤 `sessionRow`；Live2D tab 需从最深文本节点向上 walk 到 BUTTON
4. **旧 v0 会话日志拒绝 resume**（session-format-v0-to-v1：`user/message source summary requires notice form`）→ e2e 必须先经 Chat composer 创建 v1 新会话再测
5. Chat composer 是 contenteditable DIV（非 textarea），需真实 keyboard.type 而非 setter
6. 字幕 DOM 断言须在 14s TTL 内轮询（助手字幕事件随 TTS 延迟到达）

## 部署态

- e2e 实例（:4188，/root/.dsh-e2e）：已安装（link: 协议 + pnpm）、已验证全绿；anti-addiction 插件应用户要求从 e2e bundles 移除
- 线上（:4180）：**未动**，待用户书面同意后按 restart-dsh 流程部署

## 后续阶段

- Phase 2：🎙 语音输入（STT + VAD + 打断）、sttLanguage 生效
- Phase 3：字幕 LLM 二次翻译、per-workspace 配置覆盖
- 待观察：Live2D 页发消息后 GUI 会将激活视图切回 chat（tabActive 变 false）——若影响体验需查 conversation view ring 的 active 切换策略

## 文件清单

```
src/            host: config events tts sentence(+test) speech system-prompt routes index
src/client/     view engine model hud subtitle api types styles index
e2e/verify-live.mjs
assets/cubism4/live2dcubismcore.min.js
build.mjs  cordis.patch.yml  package.json  tsconfig.json
README.md  docs/features/260924-live2d-voice-plugin/
```
