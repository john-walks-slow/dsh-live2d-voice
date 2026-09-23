# dsh-live2d-voice

DSH 插件：在会话视图里新增 **Live2D** tab——Live2D 角色随对话实时开口说话（口型同步 + 表情切换 + 字幕），AI 回复经 Fish Audio TTS 流式合成语音推送到浏览器播放；🎙 连续语音输入（本地 VAD 分句 + 火山引擎 ASR）让你全程免键盘对话。

能力总览：

- 🎭 **Live2D 角色舞台**：Cubism 4 模型（pixi.js v7 渲染），说话时 `ParamMouthOpenY` 随音频 RMS 包络驱动口型，句级情绪标签切换表情
- 🔊 **流式语音**：LLM 回复边生成边按句合成（Fish Audio，44100Hz PCM），SSE 推送、浏览器端队列播放；断句 / abort 与模型流同步
- 🎙 **连续语音输入**（v0.2.0）：浏览器本地 VAD 分句 → 整句识别（火山 `bigmodel_nostream`，中/日/英自动检测）→ 识别完自动提交对话；支持说话打断（barge-in）与扬声器回声防护
- 💬 **双语字幕**：用户与 AI 台词均显示（14s 淡出），可一键隐藏
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

  // 字幕翻译目标语言（Phase 3 生效）：zh | off
  "subtitleLanguage": "zh",

  // 自定义提示词：仅在 Live2D 语音模式下随情绪标签协议一起注入
  // 例："无论用户说什么语言，总是用日语自然交流。用户会看到字幕翻译。"
  "speechPrompt": ""
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `modelPath` | `""` | 必填。指向含 `.model3.json` 的目录；为空时页面显示配置引导，也不会注入任何提示词 |
| `voiceId` | rem | Fish Audio 参考音色 id |
| `ttsModel` | `s2.1-pro-free` | Fish Audio TTS 模型 |
| `apiKeys` | `[]` | 内联 key 列表（优先于 `apiKeyFile`） |
| `apiKeyFile` | `""` | key 文件路径（每行一个 key 或 JSON 数组） |
| `asrCredentialsFile` | `~/.config/volc-asr/credentials.json` | 火山 ASR 凭证（JSON 含 `apikey` 或 `appid`+`accessToken`）；未配置时 🎙 点击给出引导提示 |
| `sttLanguage` | `"auto"` | 语音识别语言；auto 用火山 `enable_auto_lang` 自动检测 |
| `speechLanguage` | `"ja"` | 角色说话语言，注入"始终用 X 语言交流"指令 |
| `subtitleLanguage` | `"zh"` | 字幕翻译目标（Phase 3 生效，当前预留） |
| `emotionMap` | 8 情绪默认表 | 标签 → 表情索引/名称 |
| `speechPrompt` | `""` | 自定义提示词，仅语音模式生效（HUD ⚙ 里也能编辑） |
| `workspaces` | `{}` | per-workspace 覆盖（Phase 3 预留） |

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
4. 表情/口型/字幕随回复自动驱动；🔇 静音、💬 字幕开关、⚙ 换音色

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

## 开发

```bash
npm install        # .npmrc 已设 legacy-peer-deps（client 包 0.1.1-rc.2 peer 与 host 0.1.5-rc.3 冲突）
npm run typecheck
npm run build      # lib/index.js (host ESM) + lib/client.js (浏览器 bundle)
node e2e/verify-live.mjs    # Phase 1 端到端回归（需 e2e 实例跑在 4188，见 dsh-e2e skill）
node e2e/verify-voice.mjs   # Phase 2 语音闭环 e2e（同上；需 /tmp/t-zh-16k.pcm 与 /tmp/t-ja-16k.pcm 测试音频）
```

源码结构：`src/`（host：config/events/tts/sentence/speech/asr/system-prompt/routes）+ `src/client/`（view/engine/model/hud/subtitle/mic/api）。构建产物 `lib/client.js` 是浏览器 bundle（react/pixi/live2d 打包进去，`@deepseek-ai/*` external 由宿主提供）。

## License

MIT
