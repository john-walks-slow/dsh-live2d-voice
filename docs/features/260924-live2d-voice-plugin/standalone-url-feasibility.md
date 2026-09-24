# 独立 URL 单会话 Live2D 入口 — 可行性初步研究

> 需求：用户想与某个角色扮演 agent 语音对话，但不想先经过 dsh web 的完整界面（侧栏/工作区/标签页）。希望一个直达 URL，打开即是全屏 Live2D 角色。

## 架构事实（现状）

- 插件全部能力挂在 dsh webserver（同进程、同源、同鉴权）：
  `SSE /live2d-voice/stream`、`POST /live2d-voice/message`、`POST /live2d-voice/asr/recognize`、`GET /live2d-voice/config[?session=]`、`GET /live2d-voice/model[?session=]`、`/live2d-voice/models/*`、`/live2d-voice/core/*`、`/live2d-voice/gaze/*`、`POST /live2d-voice/camera-result`
- 客户端 bundle（lib/client.js）目前作为 GUI 的 `conversation.view` 插槽组件加载，依赖 dsh-client-runtime（slots/sessions 服务）
- view.tsx 提交通道：优先 GUI session channel（`props.submitPrompt` → session/prompt RPC，支持冷会话——host 自动创建/resume agent）；fallback `POST /live2d-voice/message`（`agent.followup`，**要求 agent 已活**，冷会话 404）
- SSE hub 支持同一会话多连接（GUI 与独立页可并行观看同一角色）

## 方案

### A. 插件自注册独立 HTML 路由（推荐）

`GET /live2d-voice/app?session=<id>` 返回一个自包含入口页：

- **新构建入口** `src/client/standalone.tsx`：复用现有全部组件（engine/model/hud/subtitle/mic/gaze/api），仅把 `submitPrompt` 换成 `postMessage(sessionId, text)`（走已有 POST 路由）。build.mjs 增加第二个 client 入口，GUI bundle 不受影响
- 鉴权沿用 dsh web 现有 token/cookie（URL `?token=` 或已登录 cookie）
- 页面无 GUI chrome，天然全屏形态；可加"添加到主屏幕"（方案 C）
- **核心待解点：冷会话提交**。POST /message 走 `agent.followup` 需要活 agent。两条路：
  1. host 路由内做 "ensure agent"：调研 host 侧与 GUI `session/prompt` RPC 等价的内部 API（api-gateway 的 gateway/internal 调用形态）
  2. 约束 v0：独立入口 URL 仅对该会话已在 GUI 开过（agent 活过）的场景可用——角色扮演会话通常先在 GUI 创建，约束可接受
- 工作量：v0 约 1-2 天（入口页 + 构建 + e2e）；冷会话 ensure 另计

### B. 完全不经 dsh web 的独立页（否决）

dsh 的 RPC 走 api-gateway（websocket 协议），鉴权与 web 进程绑定。完全绕开 = 重新实现 gateway 客户端与 token 流，且失去与 GUI 并行观看、host 内路由复用等一切既有能力。dsh web 就是 host 本体，"绕开 profile"没有收益只有成本。

### C. PWA 增强（A 之上，增量 ~半天）

manifest + service worker：手机"添加到主屏幕"→ 独立全屏 app 图标，无浏览器地址栏。与 A 的入口页天然契合。

## 风险与注意

- 带 token 的 URL 泄露面与现有 `?token=` 一致（dsh 既有模型）；建议优先 cookie 态
- 手机浏览器：HTTPS 必须（getUserMedia/全屏/Wake Lock 都要求安全上下文）
- 多端同时观看：SSE hub 天然支持；audio 只在各自页面播放，无冲突
- `camera-capture`/`look_at_user` 工具在独立页同样可用（SSE 事件 + POST 回传与页面形态无关）

## 结论

**可行性：高。** 推荐方案 A（v0 可先带"会话需已激活"约束）+ C（PWA 增强）。预计 1-2 天出 v0。
