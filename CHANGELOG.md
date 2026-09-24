# Changelog

## 1.4.1 (2026-09-25)

- **修复语音消息重复提交**：流式 ASR 事件此前按会话广播，同一会话若有多个 Live2D 视图实例（如 GUI tab 未卸载、或 GUI + 独立入口双开）会各自提交同一句语音 → 对话里出现重复消息。现在每次上行携带随机 `up` 上传标识（WS 查询参数 → SSE `asr-interim`/`asr-final` payload 回传），只有发起该次上传的视图才提交/显示 interim，其余视图静默——单视图、多视图、双设备场景都只提交一次
- **语音模式提示词注入与 preset**：`systemPrompt` 的 `complete: true` 语义会丢弃除 persona 外的所有 section（dsh 设计如此）——`chat` 等极简预设下 Live2D 语音模式（情绪标签/日语指令/自定义附加要求）不会注入，表现为角色不遵守语音格式。已在 chat preset 配置中改为 `complete: false`；其他自建预设遇到同样问题时检查 persona 是否 `complete: true`
- e2e：新增 `verify-nodup.mjs`（GUI tab + 独立入口双视图监听同一会话，语音只提交一次且 15s 内无延迟重复）

## 1.4.0 (2026-09-24)

- **语音识别流式化**：ASR 从「整句缓冲 → 一次性识别」改为「VAD 分句 + 实时推流」——浏览器边录边传（每句一条 WebSocket 上行），host 转发火山 `bigmodel_async` 双向流式优化版 + `enable_nonstream` 二遍识别；识别文本经 SSE `asr-interim` 实时上屏（听懂即显示），句末 `{"t":"finish"}` 定稿后经 `asr-final` 自动提交。实测尾延迟从 ≈1.9s（0.55s 判停 + 1.3s 识别）降到 ≈1.2s（判停 + 0.6s 定稿），且字幕全程实时跟进
- 协议细节（实测跑通）：双向流式端点帧**不带 seq**（客户端 seq 触发 45000000），full request flags=0b0000、音频帧 0b0000、末帧 0b0010，握手加 `X-Api-Sequence: -1`；末帧 payload 必须是合法空 gzip 流（空 body 报 ungzip EOF）；音频按 200ms 攒批
- 上行走 WebSocket 而非 fetch 流式 body：Chromium 的 `ReadableStream` 上传仅支持 HTTP/2（HTTP/1.1 下 `ERR_ALPN_NEGOTIATION_FAILED`），harness webserver 是 HTTP/1.1
- 新增 `asrMode` 配置（`stream` 默认 / `nostream` 保留）：流式不支持日语输入（官方 language 参数仅 nostream 端点支持），需日语识别时切回 `nostream`（原 `bigmodel_nostream` 25 语种链路原样保留）
- HUD 监听条实时显示识别文本（interim）；`sttLanguage` 帮助文案标注仅在 nostream 模式生效
- e2e：新增 `verify-stream.mjs`（流式全链路：WS 上行 → interim/final → 自动提交）；`verify-voice.mjs` 钉死 `asrMode: nostream` 继续断言一次性路径

## 1.3.0 (2026-09-24)

- 独立入口 /live2d-voice/app?session=<id>：无 GUI chrome 的单会话角色页（独立 bundle 全内联 813KB，复用全部视图组件）；冷会话经 ctx.sessionController.resolveAgent 恢复（带完整 preset setup——裸 registry.resume 会缺 preset 致 turn 无法组装）；message 路由支持 mode=steer（agent.steer）；e2e 12/12（含冷恢复与语音回路）
- 模型库新增 deepseek娘：v0 贴图重皮管线产物（gemini-3.1-flash-image 整图重绘双 atlas + 原 alpha 逐像素回贴 + 半透明去混合 + 84 drawable UV 覆盖校验 0 失败 + headless 参数扫描与基座 25/3/54 逐位一致）；AI 二创仅本机使用（CATALOG.md 注明）
- 修复：/app 路由 .html MIME（曾触发浏览器下载）

## 1.2.0 (2026-09-24)

- 实验性·陀螺仪视差：DeviceOrientation（iOS 需手势授权）→ EMA 平滑 + 开启时校准正中姿势 → ParamAngle/BodyAngle/EyeBall + 模型位置偏移，营造"角色在屏幕玻璃后"的立体错觉；⚙ 实验区开关（与视线追踪并排）；合成方向事件 e2e 15/15

## 1.1.0 (2026-09-24)

- 沉浸全屏：⛶ 一键全屏（lv-root），适合旧手机常驻角色终端
- 屏幕常亮：全屏+语音监听时自动 Wake Lock（页面切走再回来自动重取），长时挂机不熄屏
- 长时闲置稳定：AudioContext 息屏挂起自动恢复（VAD 不再静默死亡）；toast 同文案 8s 限流；soak e2e（6 分钟静默 + 断网抖动 + 内存采样 + 事后说话即响应）
- 设置面板商用化重修：标题栏+✕ 关闭、高度受限内部滚动（不再被 GUI 标签栏裁切）、音色统一胶囊样式、移动端近全宽
- 触屏目标 ≥44px（coarse pointer 媒体查询）；键盘输入与设置面板互斥开合；首次使用引导 toast
- 实验性·视线追踪：前置摄像头 + MediaPipe FaceLandmarker（GPU/CPU 自适应）驱动角色注视；⚙ 开关；模型经插件缓存代理路由懒加载（手机无需外网）
- 实验性·look_at_user 工具：模型可请求从前置摄像头拍照并看到你（SSE camera-capture + 回传路由 + attachments.saveImage 图片块）；工具仅在该会话 Live2D 视图打开时注册

## 1.0.0 (2026-09-24)

- UX 打磨：底部控制栈与 GUI composer 座席（实测 128px）完全分层——HUD 抬升净空、监听态字幕自动上移避开监听条（过渡动画）、监听中 HUD 保持 75% 可见（停止按钮不再隐没于淡出）
- 商用化基线：三套 e2e 全绿（Phase 1 回归 21 项 / Phase 2 语音闭环 17 项 / Phase 3 翻译·多模型·workspace 19 项）

## 0.3.0 (2026-09-24)

- 字幕翻译：角色台词逐句翻译为目标语言（复用会话 provider/model 的一次性 LLM 调用），SSE 按 lineId 回贴，双语字幕行渲染；每会话串行队列、积压超限丢最旧
- 多模型目录：`modelPath` 支持多角色子目录（含符号链接），⚙ 面板「角色模型」切换器，选择持久化
- per-workspace 覆盖：`workspaces` 按工作区路径覆盖音色/模型/语言等表现层配置（凭证仅全局层）；`/models/*` 资产路由多根解析
- 检视修复：workspace 覆盖 modelPath 的资产 404（多根路由）、翻译队列任务级异常隔离、目录扫描逐条容错、覆盖感知 toast

## 0.2.0 (2026-09-24)

- 连续语音输入：浏览器本地 VAD 分句（预滚/强制切段/防抖）→ 整句 PCM POST → 火山 `bigmodel_nostream` 识别（中/日/英自动检测）→ 识别完自动提交
- 说话打断（barge-in）：高电平即时静默角色整轮（muzzle 机制，旧轮不再恢复播放），新语音以 steer 模式插队
- 扬声器回声防护、HUD 识别语言选择器、底部控制栈 z-index 修复
- 架构注记：火山双向流式端点不支持日语（实测空文本），故弃用 WS 连续中继改按句识别

## 0.1.0 (2026-09-23)

- Live2D 会话视图：Cubism 4 角色舞台（口型同步 + 情绪表情）、Fish Audio 流式语音合成、字幕、键盘输入、音色快切、静音
- 会话级按需提示词注入（语音格式 + 情绪标签协议），退出语音模式自动恢复普通对话
