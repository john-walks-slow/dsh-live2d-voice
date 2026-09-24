# dsh-live2d-voice

DSH 插件：在会话视图里新增 **Live2D** tab——Live2D 角色随对话实时开口说话（口型同步 + 表情切换 + 字幕），AI 回复经 Fish Audio TTS 流式合成语音推送到浏览器播放；🎙 连续语音输入（本地 VAD 分句 + 火山引擎 ASR）让你全程免键盘对话。

能力总览：

- 🎭 **Live2D 角色舞台**：Cubism 4 模型（pixi.js v7 渲染），说话时 `ParamMouthOpenY` 随音频 RMS 包络驱动口型，句级情绪标签切换表情
- 🔊 **流式语音**：LLM 回复边生成边按句合成（Fish Audio，44100Hz PCM），SSE 推送、浏览器端队列播放；断句 / abort 与模型流同步
- 🎙 **连续语音输入**（v0.2.0）：浏览器本地 VAD 分句 → 整句识别（火山 `bigmodel_nostream`，中/日/英自动检测）→ 识别完自动提交对话；支持说话打断（barge-in）与扬声器回声防护
- 💬 **双语字幕**：用户与 AI 台词均显示（14s 淡出），可一键隐藏；角色台词自动翻译成目标语言（v0.3.0，走会话同款 LLM，一行原文一行译文）
- 🎭 **多模型目录**（v0.3.0）：`modelPath` 指向多个角色子目录时 ⚙ 出现模型切换器，即选即换
- 🗂 **per-workspace 覆盖**（v0.3.0）：按工作区路径覆盖音色/模型/语言等表现层配置，同一插件多工作区多角色
- ⛶ **沉浸全屏**（v1.1.0）：一键全屏成为角色终端；全屏+语音监听时自动保持屏幕常亮（Wake Lock）——把旧手机放在桌上当角色挂机
- 👁 **视线追踪**（v1.1.0 实验性）：前置摄像头注视追踪，角色会看着你的脸（MediaPipe FaceLandmarker，经插件路由懒加载，手机无需科学上网；⚙ 可开关）
- 📸 **看向你**（v1.1.0 实验性）：模型可调用 `look_at_user` 工具从前置摄像头拍一张照片并真正"看到"你（仅在该会话的 Live2D 视图打开时存在此工具）
- 📱 **陀螺仪视差**（v1.2.0 实验性）：倾斜手机，角色的头部/身体/视线与位置随之偏移——"角色在屏幕玻璃后面"的立体错觉（开启时以当前握持姿势为正中；⚙ 可开关）
- 🚪 **独立入口**（v1.3.0）：`/live2d-voice/app?session=<id>`——无 GUI 界面的单会话角色页，自带全部能力（语音/字幕/翻译/设置/全屏/实验特性）；冷会话自动经会话控制器恢复（带完整 preset），支持 steer 插话
- 🎨 **deepseek娘**（v1.3.0 内容）：AI 生成贴图重皮的角色模型（基座 haru，gemini 整图重绘 + alpha 回贴 + UV 覆盖校验），参数驱动与基座逐位一致；见模型库 CATALOG.md
- ⌨ **键盘输入**：在 Live2D 页直接对话（走 GUI 会话通道，冷会话自动创建/resume agent）
- ⚙ **音色快切**：HUD 内置 5 个预设音色，即选即生效
- 🔇 **静音开关**：只看口型不听声

## 安装

```bash
# 在 DSH profile（如 ~/.dsh/profiles/web）里
pnpm add dsh-live2d-voice        # 或 link: 本地开发
# package.json 的 dsh.profile.bundles 追加 "dsh-live2d-voice"
pnpm install && sv restart dsh   # 重启 dsh 生效
```

要求：DSH ≥ 对应 0.1.5-rc.3 host 包系列；浏览器需 WebGL。

## 配置

配置文件：`<DSH_HOME>/live2d-voice.json`（如 `~/.dsh/live2d-voice.json`）。保存后刷新页面即生效（音色也可在 HUD 里直接切换，会写回该文件）。

```jsonc
{
  // 角色模型目录：包含 .model3.json 的文件夹（Cubism 4）
  "modelPath": "/root/.dsh/live2d-voice-models/haru",

  // Fish Audio 音色 id（见下方预设表）
  "voiceId": "0c7771ca5910484e8a4933068017fcee",

  // TTS 模型名
  "ttsModel": "s2.1-pro-free",

  // Fish Audio API key：内联数组，或指向 key 文件（每行一个，或 JSON 数组）
  // 多 key 自动轮询：401/402/429 时切换下一个
  "apiKeys": [],
  "apiKeyFile": "/root/.config/fish-audio/keys.json",

  // 情绪标签 → 模型表情（Haru 的表情索引；值也可以是表情名字符串）
  "emotionMap": {
    "neutral": 0, "joy": 1, "sappiness": 1, "sadness": 2,
    "anger": 3, "surprise": 4, "fear": 5, "disgust": 6, "shy": 7
  },

  // 语音输入：火山引擎 ASR 凭证文件（JSON：apikey，或 appid+accessToken）
  "asrCredentialsFile": "~/.config/volc-asr/credentials.json",

  // 语音输入识别语言：auto（自动检测中/日/英等）| zh | ja | en
  "sttLanguage": "auto",

  // 角色说话语言：ja（默认，角色始终用日语交流）| zh | en —— 注入 live 模式提示词
  "speechLanguage": "ja",

  // 角色台词的翻译目标语言：zh / ja / en / ko…（languageLabel 支持即有效）；off 关闭
  "subtitleLanguage": "zh",

  // 多模型目录下的当前选中角色（⚙ 里切换会写回）
  "modelSelection": "",

  // 自定义提示词：仅在 Live2D 语音模式下随情绪标签协议一起注入
  // 例："无论用户说什么语言，总是用日语自然交流。用户会看到字幕翻译。"
  "speechPrompt": "",

  // per-workspace 覆盖（可选）：按会话工作区的绝对路径覆盖表现层配置
  // "workspaces": {
  //   "/root/projects/xxx": { "voiceId": "abf4fa2e25634b41aadc4e0ef9ddaea5", "speechLanguage": "zh" }
  // }
  "workspaces": {}
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `modelPath` | `""` | 必填。两种形态：目录直接放一个或多个 `.model3.json`（多文件时同样出现 ⚙ 切换器）；或放多个角色子目录（每个一级子目录一个 `.model3.json`）。为空时页面显示配置引导，也不会注入任何提示词；可覆盖于 workspaces（资产路由多根解析） |
| `modelSelection` | `""` | 多模型目录下当前选中的角色名（空 = 第一个） |
| `voiceId` | rem | Fish Audio 参考音色 id |
| `ttsModel` | `s2.1-pro-free` | Fish Audio TTS 模型 |
| `apiKeys` | `[]` | 内联 key 列表（优先于 `apiKeyFile`） |
| `apiKeyFile` | `""` | key 文件路径（每行一个 key 或 JSON 数组） |
| `asrCredentialsFile` | `~/.config/volc-asr/credentials.json` | 火山 ASR 凭证（JSON 含 `apikey` 或 `appid`+`accessToken`）；未配置时 🎙 点击给出引导提示 |
| `sttLanguage` | `"auto"` | 语音识别语言；auto 用火山 `enable_auto_lang` 自动检测 |
| `speechLanguage` | `"ja"` | 角色说话语言，注入"始终用 X 语言交流"指令 |
| `subtitleLanguage` | `"zh"` | 角色台词的翻译目标语言（`off` 关闭；与会话生效的 `speechLanguage` 相同或 `speechLanguage=auto` 时可能整句透传，按需配置；可覆盖于 workspaces） |
| `eyeTracking` | `false` | 实验性：前置摄像头视线追踪（⚙ 面板可切换；首次开启经插件路由下载视线模型） |
| `gyroParallax` | `false` | 实验性：陀螺仪视差（DeviceOrientation → 头部/身体/眼球角度 + 位置偏移；开启时校准正中姿势） |
| `emotionMap` | 9 情绪默认表 | 标签 → 表情索引/名称（neutral/joy/sappiness/sadness/anger/surprise/fear/disgust/shy） |
| `speechPrompt` | `""` | 自定义提示词，仅语音模式生效（HUD ⚙ 里也能编辑） |
| `workspaces` | `{}` | per-workspace 覆盖：`{ "<工作区绝对路径>": { voiceId, modelPath, modelSelection, speechLanguage, sttLanguage, subtitleLanguage, speechPrompt, emotionMap 任选 } }`；凭证类字段只在全局层 |

**提示词注入是会话级、按需生效的**：只有当前会话打开了 Live2D 视图（SSE 在连）时，才会注入"语音输出格式 + 情绪标签"提示词（含 `speechPrompt`）；普通 Chat 会话完全不受影响。从 Live2D 切回普通对话后的首轮回复会自动附上一段"已退出语音模式"的提醒，模型随即恢复正常 Markdown/代码块输出，对话可以无缝续接。

内置音色预设（HUD ⚙ 里可直接切换）：

| 预设 | voiceId |
| --- | --- |
| Rem · 温柔女仆 | `0c7771ca5910484e8a4933068017fcee` |
| 元气女仆 | `abf4fa2e25634b41aadc4e0ef9ddaea5` |
| 芙莉莲 · 知性 | `c174516c799a42e7be88b96c86cfbd3e` |
| 芙宁娜 · 娇俏 | `3fd70bbcdb6342df8c0c4143b958944b` |
| Cute Girl · 甜美 | `0c54c26032024142bf6339dc4d4aca1b` |

### 角色模型

任意 Cubism 4 模型（`.model3.json`）均可，放入一个目录并把 `modelPath` 指向它。例如官方示例 Haru：

```bash
mkdir -p ~/.dsh/live2d-voice-models
cd ~/.dsh/live2d-voice-models
# 从 live2d 官方示例仓库下载 haru 的全部文件（jsdelivr 镜像 guansss/pixi-live2d-display 仓库）
# haru.model3.json + textures + motions + expressions，共 19 个文件
```

`emotionMap` 的值对应模型的 expressions 列表索引（或名称），不同模型的表情数量与顺序不同，按需调整。

## 使用

1. 打开任一会话，顶部视图 tab 切到 **Live2D**
2. 点 HUD 的 ⌨ 打开输入框直接对话；或点 🎙 开启连续语音输入——说话自然停顿后一句自动识别、自动发送（说完即可继续说下一句）
3. AI 说话时直接开口即可**打断**（barge-in 立即静音角色并转向你的新输入）；正在生成回复时的新语音会以 steer 模式插队
4. 表情/口型/字幕随回复自动驱动；🔇 静音、💬 字幕开关、⛶ 全屏、⚙ 音色/模型/语言/视线追踪
5. 全屏 + 语音监听时屏幕保持常亮——适合把一台旧手机常驻 Live2D 页当角色终端；长时间静默挂机无内存增长，说话即响应

角色与字幕（v0.3.0）：

- `modelPath` 放多个角色子目录时，⚙ 面板出现「角色模型」切换器，点击即换（模型立即重新加载）
- 角色台词若与 `subtitleLanguage` 不同语言，会自动翻译并以小字附在原句下方（用当前会话同款模型，逐句异步，不影响语音节奏）
- `workspaces` 按工作区路径覆盖配置：不同工作区的会话可以各有各的音色/角色/语言

语音输入细节：

- 识别延迟 ≈ 说完话 0.5s（VAD 判停）+ 识别约 1s，随后自动提交
- 角色的语音可能被麦克风拾到（外放场景）：识别结果与角色最近台词高度重合时会被当作回声丢弃
- 浏览器要求 HTTPS 或 localhost（getUserMedia 限制）；手机浏览器同样可用
- `sttLanguage: auto` 实测覆盖中文/日语/英语自动检测；指定 `ja`/`zh`/`en` 可锁定语种提高稳定性

注意：

- 情绪标签（如 `[joy]`）会随消息写入会话日志——切回 Chat tab 可见完整对话记录
- Live2D 页不显示历史消息；要看历史请切回 Chat tab
- TTS 只对**当前打开了 Live2D 视图的会话**生效，其他会话不受影响

## 工作原理（简）

```
                        ┌── 🎙 语音输入 ────────────────────────────────┐
                        │ 浏览器 AudioWorklet：48k→16k 降采样 + 能量 VAD │
                        │ 分句（250ms 预滚 / 20s 上限）                  │
                        │   │ 整句 PCM                                  │
                        │   ▼                                           │
                        │ POST /live2d-voice/asr/recognize              │
                        │   │ 火山 bigmodel_nostream（快灌 + 负包收尾）  │
                        │   ▼                                           │
                        │ 识别文本 ── 自动提交（barge/运行中 → steer）───┼──► 用户输入
                        └───────────────────────────────────────────────┘
用户输入 ──► GUI 会话通道 (session/prompt) ──► agent 回复流
                                                  │ llm/stream tap（仅 Live 监听的会话）
                                                  ▼
                              句子切分 + 情绪标签提取（[joy] 等）
                                                  │
                        ┌─────────────────────────┼─────────────────┐
                        ▼                         ▼                 ▼
                  expression 事件          subtitle 事件      Fish TTS (流式 PCM)
                        │                         │                 │
                        └────────────► SSE /live2d-voice/stream ◄───┘
                                                  │
                                    浏览器：表情切换 / 字幕 / 播放队列
                                                  │ RMS 包络
                                                  ▼
                                             ParamMouthOpenY
```

- 情绪协议（会话级按需注入）：仅当该会话的 Live2D 视图打开时，system prompt 才附加"语音输出格式"一节（order 9800，含 `speechLanguage` 指令与自定义 `speechPrompt`），要求模型句首输出 `[neutral|joy|sadness|anger|surprise|fear|disgust|shy]` 标签；句子层提取后映射为表情，标签本身不进字幕。切回 Chat 视图后下一轮自动撤下该节并附"已退出"提醒
- TTS 与 Turn 解耦：LLM 流结束即放行 Agent Turn 结算，剩余句子在后台继续合成；新一轮流开始或视图关闭时自动中止旧合成
- 多 key 轮询：单 key 401/402/429 自动切下一个，全部失败才报错（SSE `error` 事件）
- 语音识别用火山 `bigmodel_nostream`（v3 sauc 二进制帧协议）：双向流式端点不支持日语（实测空文本），nostream 覆盖 25 语种且 `enable_auto_lang` 自动检测可用；每句独立短连接、快灌整句、负包收尾后返回整段文本
- 字幕翻译是 host 侧一次性 `ctx.llm.stream` 调用（复用会话的 provider/model，无 sessionId/purpose 故不会被本插件 tap 回环）；每会话串行队列、最多积压 2 句，超出丢最旧——字幕时效优先；译文经 SSE `subtitle-translation` 按 `lineId` 回贴

## 开发

```bash
npm install        # .npmrc 已设 legacy-peer-deps（client 包 0.1.1-rc.2 peer 与 host 0.1.5-rc.3 冲突）
npm run typecheck
npm run build      # lib/index.js (host ESM) + lib/client.js (浏览器 bundle)
node e2e/verify-live.mjs     # Phase 1 端到端回归 21 项（需 e2e 实例跑在 4188，见 dsh-e2e skill）
node e2e/verify-voice.mjs    # Phase 2 语音闭环 17 项（同上；需 /tmp/t-zh-16k.pcm 与 /tmp/t-ja-16k.pcm 测试音频）
node e2e/verify-phase3.mjs   # Phase 3 翻译/多模型/workspace 19 项（需 /root/.dsh-e2e-test-models 多模型夹具）
node e2e/verify-v11.mjs      # v1.1.0 全屏/视线追踪资产/MediaPipe 加载/摄像头工具 10 项（需 --use-fake-device-for-media-stream）
node e2e/verify-soak.mjs     # 长时闲置 soak（默认 6 分钟，SOAK_MINUTES 可调）
node e2e/verify-standalone.mjs # 独立入口 12 项（无参引导/挂载/键盘提交/冷会话恢复/语音回路）

> 语音/Phase 3 脚本默认硬编码本机 playwright-core（/root/projects/camoufox-mcp/node_modules）与 chromium 路径；`E2E_URL`/`E2E_CFG` 环境变量可覆盖实例地址与配置文件。
```

源码结构：`src/`（host：config/events/tts/sentence/speech/asr/system-prompt/routes）+ `src/client/`（view/engine/model/hud/subtitle/mic/api）。构建产物 `lib/client.js` 是浏览器 bundle（react/pixi/live2d 打包进去，`@deepseek-ai/*` external 由宿主提供）。

## License

MIT
