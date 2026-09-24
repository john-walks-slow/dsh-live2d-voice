# 第三人称模式（Third-Person Mode）实施计划

> 需求原文：新增第三人称模式。第三人称模式时玩家有自己的模型和音色。第三人称模式时玩家的输入会先通过一层润色/翻译（可选），然后先由玩家的"皮套"说出来，接着 ai 的皮套再回复。

## 1. 用户体验设计

### 1.1 是什么

Live2D 视图新增**第三人称模式**开关（⚙ 快捷面板 + 系统设置）。开启后舞台从"单角色"变为"双角色同台"：

- **左侧**：玩家的角色（`playerModelSelection`，从现有模型目录挑选），有自己的音色（`playerVoiceId`，Fish Audio 25 预设任选）
- **右侧**：AI 的角色（现有模型与音色不变）

用户输入（键盘或语音）的流转从「直接交给 AI」变为：

```
用户输入（原文）
   │ ① 润色/翻译层（可选，默认开）：LLM 把原文改写成"玩家角色会说出的台词"
   │    - 按玩家人设 (playerPrompt) 润色语气
   │    - 翻译成玩家角色的说话语言 (playerSpeechLanguage，默认 zh)
   │    - 输出句首带情绪标签 [joy] 等（驱动玩家模型表情）
   ▼
② 玩家皮套先说：玩家模型口型同步 + 玩家音色 TTS + 字幕（role:user）
   ▼
③ AI 皮套再回复：现有链路原样（情绪标签 → 表情/逐句 TTS/字幕/翻译）
```

润色后的台词才是进入会话日志的 user 消息——玩家皮套说了什么，AI 就听到什么，Chat tab 里也记录什么，三者一致。

### 1.2 常见用户路径

| 路径 | 行为 |
| --- | --- |
| 开启第三人称（未选玩家模型） | 舞台仍只有 AI 模型，但语音/润色/字幕照常工作（无口型的"画外音"）；⚙ 面板提示选择玩家模型 |
| 键盘输入「今天好累啊」 | 提交后字幕区先出一行置灰的「酝酿中…」瞬态提示（纯客户端，不进日志）；润色成玩家角色台词（如「[sadness] 唉…今天真的累坏了呢」）→ 玩家音色念出（SSE subtitle 到达即替换提示行）→ AI 角色回应 |
| 语音输入（中文） | ASR 定稿 → 同上（润色会顺手把口语转成自然台词） |
| 玩家台词播放中再次开口（barge-in） | 麦克风 muzzle 打断当前所有音频；新一句成为新玩家台词（旧台词已提交的不受影响） |
| AI 回复中插话 | 同现有 barge-in 语义：steer 插队；玩家新台词的 speech-start 会切断 AI 正在播的音频 |
| 关闭第三人称 | 舞台回到单角色、布局复位，输入直连 AI（回到第一人称模式） |
| 双视图（GUI tab + 独立入口） | 玩家台词事件经 SSE 广播，两个视图都渲染；提交只发生一次（host 侧 pipeline 提交，客户端不重复提交） |

### 1.3 关键交互决策

1. **顺序保证**：玩家台词的 TTS **合成完成**后才向 agent 提交消息。这样 SSE 上音频事件严格有序（玩家全部 chunk → AI 全部 chunk），客户端单音频队列天然保证"先玩家后 AI"的播放顺序；同时 AI 的生成（TTFT ≈1-2s）与玩家台词的**播放**并行，台词播完 AI 几乎接得上话。
2. **润色失败降级**：润色 LLM 调用失败/超时/空结果 → 直接用原文（照常 TTS + 提交）；TTS 失败（无 key/网络错）→ 字幕照发、消息照常提交，仅无声音。
3. **快速连发两条**：host 侧每会话**串行队列**逐条处理（润色→TTS→提交），两条都送达 AI，不丢字；第二条玩家 speech-start 会切断第一条未播完的音频（同说话人 supersede）。
4. **回声防护**：玩家皮套的外放声音也可能被麦克风拾取——玩家台词与 AI 台词一样进入回声参照文本，ASR 结果与之高度重合时丢弃。
5. **润色文本即日志**：不在日志里保留原文（保持角色扮演一致性；字幕上即所见）。

## 2. 架构设计

### 2.1 协议扩展：SSE 事件加 `speaker` 字段

现有事件名全部复用，payload 增加 `speaker?: "assistant" | "player"`（缺省 = assistant，向后兼容）：

| 事件 | 新 payload |
| --- | --- |
| `speech-start` | `{utteranceId, speaker?}` |
| `audio-start` | `{utteranceId, sampleRate, speaker?}` |
| `audio` | `{utteranceId, seq, b64, speaker?}` |
| `audio-end` / `speech-end` | `{utteranceId, (reason,) speaker?}` |
| `expression` | `{utteranceId, emotion, expression, speaker?}` |
| `subtitle` | `{role, text, utteranceId?, lineId?, speaker?}` |

`speech.ts`（AI 侧）**完全不改动**——不带 speaker 即 assistant，也避免与另一 agent 在该文件的在途改动冲突。玩家侧事件全部由新模块 `src/player.ts` 发出，显式带 `speaker:"player"`。

### 2.2 新模块 `src/player.ts`（host 侧玩家台词管线）

```
PlayerPipeline（每会话串行队列，任务 = 润色 → TTS → 提交）
  ├─ polish(sessionId, raw): 用会话同款 provider/model 的一次性 ctx.llm.stream
  │    （不携带 sessionId → 不会被自家 llm/stream tap 回环朗读）
  │    system 提示词：改写为玩家角色的口播台词；语言 → playerSpeechLanguage；
  │    人设 → playerPrompt；句首输出 [情绪] 标签（playerEmotionMap 词表）；
  │    保留原文全部信息点（长度随内容），仅简短寒暄收敛为两句以内；
  │    口语化、无 Markdown；失败/空 → 回退原文
  ├─ speak(sessionId, utteranceId, cleanText):
  │    expression(speaker:player) → speech-start/audio-start(speaker:player)
  │    → Fish TTS(playerVoiceId) 流式 audio(speaker:player)
  │    → 首个 PCM chunk 时发 subtitle(role:user, speaker:player)
  │    → 合成结束后 audio-end/speech-end(speaker:player)
  └─ submit(sessionId, finalText, mode): resolveAgent（冷会话经 sessionController
       恢复，与 /message 同语义）→ createUserMessage → agent.steer/followup
```

关键时序与中止语义：

- **任务开始时先 supersede AI 语音**：调用 `applySpeechTap` 新返回的 `supersede(sessionId)`，abort 该会话在途的 assistant TTS 队列（用户插话 → AI 旧台词立即停，避免与玩家 TTS 在 SSE 上交错）。
- **hub.onLastClose**：abort 在途玩家任务 controller、清空队列（省 TTS 配额）；被 abort 的任务仍会把已有文本提交给 agent（会话切回 Chat 模式继续，不丢用户输入）。
- 每任务独立 `AbortController`；TTS 的 fetch signal 传递复用 `synthesize` 现有机制。

### 2.3 路由（src/routes.ts，追加不改现有）

| 路由 | 说明 |
| --- | --- |
| `POST /live2d-voice/player-line` `{sessionId, text, mode}` | 校验后入队即返回 `{accepted:true}`（客户端 draft 立即清空，台词经 SSE 呈现）；`thirdPerson` 未开时兜底按旧 /message 语义直接提交 |
| `GET /live2d-voice/model`（扩展） | 响应新增 `thirdPerson: boolean` 与 `player?: {name,label,kind,url}`（`playerModelSelection` 在目录中命中时） |
| `POST /live2d-voice/config`（扩展） | 接受 `thirdPerson/playerModelSelection/playerVoiceId/playerPolish/playerSpeechLanguage/playerPrompt/playerEmotionMap` |

### 2.4 配置（src/config.ts，全局 + workspace 可覆盖的表现层字段）

```jsonc
{
  "thirdPerson": false,            // 第三人称总开关
  "playerModelSelection": "",      // 玩家角色（同一模型目录中挑选；空 = 仅语音无形象）
  "playerVoiceId": "<元气少年音>",  // 玩家音色（默认取与 AI 默认音色不同的预设；
                                    //   ⚙ 面板在与 AI 音色相同时给出提示）
  "playerPolish": true,            // 润色/翻译层开关
  "playerSpeechLanguage": "zh",    // 玩家角色说话语言（润色目标语言；auto = 不限）
  "playerPrompt": "",              // 玩家人设（润色提示词的一部分）
  "playerEmotionMap": { 9 情绪默认表 }  // 情绪标签 → 玩家模型表情索引
}
```

`loadConfig` 对 `playerEmotionMap` 做 与 `emotionMap` 相同的默认合并。凭证类（apiKeys/apiKeyFile）继续仅全局层。

### 2.5 客户端

**engine.ts — 说话人感知音频队列**：

- `enqueueBase64(b64, speaker = "assistant")`；pump 时记录 `activeSpeaker`（最近调度的 chunk 所属说话人；调度提前量仅 0.12s，切换误差可忽略）
- 新增 `currentSpeaker()`；`mouthValue(speaker?)`：speaker 不匹配 activeSpeaker 时返回 0
- `speaking()/stop()/muzzle()` 语义不变（全局）

**model.ts — 布局参数**：

- `mountModel(container, url, getMouth, onContextLost, layout?: {xFraction?, scaleGain?})`：`fit()` 中 `baseX = width * xFraction`（默认 0.5）、`baseScale *= scaleGain`（默认 1）
- handle 新增 `setLayout(layout)`：更新布局并重算 transform——第三人称开/关时**不重载模型**即完成舞台重排
- 双模型 = 同一 stage 容器内两张全幅透明 canvas 叠放；手势（拖拽/缩放/双击复位）作用于两个模型 → 整个"场景"一起动，符合直觉

**view.tsx — 双模型与说话人路由**：

- 新 state：`thirdPerson`、`playerModel`（来自 /model 响应 player 字段）；`playerModelRef`
- 主模型 `setLayout(thirdPerson ? {xFraction:0.72, scaleGain:0.8} : {xFraction:0.5, scaleGain:1})`；玩家模型 effect 独立挂载（layout `{xFraction:0.28, scaleGain:0.8}`，getMouth = `mouthValue("player")`）
- SSE 处理按 speaker 分流：expression → 对应模型；audio → `enqueueBase64(b64, speaker)`；per-speaker activeUtterance ref
- **speech-start 打断规则**（新 utterance 且 utteranceId 变化时才 stop）：
  - 新 utterance 是 **player**（用户新输入）→ 无条件 stop（打断一切正在播的）
  - 否则仅当 `engine.currentSpeaker() === speaker`（同说话人轮次 supersede，等价现状）→ stop
  - 玩家台词播完前 AI speech-start 到达 → 不 stop，AI 音频在队列中自然排后
- `submitText`：`thirdPerson` 时改走 `postPlayerLine`，本地不再推正式 user 字幕（host 经 SSE 下发）；accepted 后字幕区先插一行置灰瞬态提示「酝酿中…」（标记 pending，不进回声参照、不进日志），收到本会话带 `speaker:player` 的 subtitle 事件即移除；unmuzzle 时机不变
- 回声防护：玩家台词行进入独立的 playerEchoRef，`looksLikeEcho` 同时比对 assistant/player 两份参照

**hud.tsx ⚙ 面板**：新增「第三人称」区——总开关 + 玩家模型选择器（复用目录分组渲染）+ 玩家音色选择器（复用预设胶囊）+ 润色开关。**settings-section.tsx 系统设置**：新增模块卡（总开关、玩家模型、玩家音色、润色开关、玩家语言、玩家人设 textarea）。

**subtitle.tsx**：字幕卡增加说话人标识（玩家行显示角色名标签），复用 user 样式。

### 2.6 system-prompt.ts（小改）

`liveSection` 在 `thirdPerson` 时追加一条：用户消息来自对方角色扮演化身（可能已润色/翻译），按角色扮演台词对待。（该文件当前无在途改动，冲突风险低。）

### 2.7 不改动的部分

- `speech.ts` 的 AI 侧管线（除 applySpeechTap 返回 supersede 函数的一行级改动外不动，避开在途冲突）
- ASR/mic 链路（asr-final → submitText 统一入口，自动走玩家管线）
- 独立入口 standalone（复用同一 view，自动获得能力）
- 双语字幕翻译（仅作用于 AI 台词；玩家台词已是用户可懂语言）

## 3. 与在途改动（另一 agent）的隔离

工作区有未提交改动（sentenceSubtitles + moc2 目录扫描 + 模型标签，涉及 config/speech/routes/view/hud/types 等）。策略：

- 全部采用**追加式**编辑，不重构对方正在改的代码块（如 /message 的 agent 解析逻辑：player.ts 内自带一份解析而非抽取共享，接受可控重复，换取 hunk 级干净提交）
- 提交时使用 git-hunk 级别只提交本需求改动（commit-own-changes 技能）
- package.json 版本号：当前在途改动可能已 bump，提交前以工作区当前值为基准 +minor

## 4. 实施步骤

1. `src/config.ts`：新字段 + 默认值 + playerEmotionMap 合并
2. `src/player.ts`：PlayerPipeline（润色/TTS/提交/串行队列/中止）
3. `src/speech.ts`：applySpeechTap 返回 `{supersede(sessionId)}`
4. `src/system-prompt.ts`：第三人称提示行
5. `src/routes.ts`：/player-line、/model 扩展、/config 扩展
6. `src/index.ts`：接线 PlayerPipeline
7. client：types → api → engine → model → view → hud → settings-section → subtitle → styles
8. `npm run typecheck && npm run build`
9. e2e：`e2e/verify-third-person.mjs`（见 §5）
10. README / CHANGELOG / package.json 1.5.0

## 5. e2e 验证（e2e 实例 :4188，复用现有 playwright 模式）

1. **配置面**：POST /config 写入 thirdPerson 全字段 → GET /config 回读一致；GET /model 返回 `thirdPerson` + `player`（命中 haru-alt fixture）
2. **玩家台词链路（polish off）**：开 SSE 探针 → POST /player-line → 依次收到 `subtitle(role:user, speaker:player)`、`speech-start(speaker:player)`、≥1 个 `audio(speaker:player)`、`speech-end(speaker:player)`；会话日志出现该 user 消息
3. **顺序保证**：事件流中最后一个 player audio 的序号 < 第一个 assistant audio（speaker 缺省）的序号
4. **润色（polish on）**：POST /player-line 中文口语 → subtitle 的文本为润色后台词（≠原文），日志 user 消息 = 润色文本；如输出情绪标签则收到 `expression(speaker:player)`
5. **开关关闭兜底**：thirdPerson=false → /player-line 直接提交（无 player SSE 事件，日志出现原文）
6. **视图渲染**：Live2D 页双 canvas 挂载、⚙ 出现第三人称区、开关切换后舞台重排（截图留档）
7. **回归**：verify-live.mjs / verify-voice.mjs（第一人称链路无回归）

## 6. 交付物

- 代码：上述文件改动 + 新模块 src/player.ts + e2e/verify-third-person.mjs
- 文档：README（能力总览 + 配置表 + 使用说明 + 工作原理图更新）、CHANGELOG 1.5.0、本目录 plan/validation/review/summary
- 构建产物 lib/ 同步（host 重启后线上生效）
