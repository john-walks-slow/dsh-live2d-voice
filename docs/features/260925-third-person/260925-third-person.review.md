# 检视报告：dsh-live2d-voice 第三人称模式

## 概要

检视范围：dsh-live2d-voice 插件「第三人称模式」需求相关改动。整体评价：架构清晰、协议向后兼容设计优良、与在途改动（同文件功能 hunk 独立）无显著冲突、e2e 覆盖全面（28/28 通过）。存在若干阻塞级 UX 一致性问题（玩家字幕未与音频播放同步、polish LLM 无超时），以及若干建议级清理项。**结论：条件准入**——无功能性阻塞，建议在合并前补齐 polish 超时与玩家字幕音频同步。

## 需求对齐

- **需求 1：第三人称模式总开关 + 玩家模型/音色独立选择** —— `config.ts:142,236`、`routes.ts:308-332,476-481`、`hud.tsx:307-369`、`settings-section.tsx:802-921` 全部覆盖。`/model` 响应增加 `thirdPerson` 与 `player` 字段，`/config` POST 接受所有 player 系列字段。
- **需求 2：润色/翻译层（可选）** —— `player.ts:146-178` 实现一次性 ctx.llm.stream（无 sessionId、不触发自家 tap），使用 player 人设 + playerSpeechLanguage + playerEmotionMap 词表作为提示词。失败/空 → 回退原文（`player.ts:175`）。
- **需求 3：玩家皮套先说 → AI 再回复** —— `player.ts:97-143` 强制串行顺序：polish → 表情 → TTS 合成完成 → 才向 agent 提交。SSE 上严格保证玩家所有 audio chunk 在 assistant 之前到达客户端（e2e T3g 断言覆盖）。
- **计划 §2.5 偏差（共享 Pixi Application）** —— `model.ts:103-115 createLive2DStage + mountModel(shared)`。注释（lines 88-97）解释了 Cubism SDK WebGLManager 单例导致双 context 抢占的根因。`view.tsx:339-352,438-498` 用 `sharedStageRef` 串起两模型挂载/卸载生命周期。这是合理的实施期修正。
- **范围隔离** —— 实施方采用追加式编辑（player.ts 自带 resolveAgent/retrySession；speech.ts 仅 applySpeechTap 增加一行返回 supersede 函数），未触碰在途 agent 改动的代码块，符合计划 §3 隔离策略。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | `src/player.ts:228-236` (`emitSubtitle`) | 玩家字幕发出时**未带 `audioSeq`**，与 assistant 字幕（`src/speech.ts:327` 带 audioSeq）行为不一致。客户端 `view.tsx:189-197 pushSubtitle` 仅对 `role==="assistant" && typeof audioSeq==="number"` 走"等音频播放才显示"分支，玩家字幕走"立即显示"分支。后果：玩家 TTS 第一片 PCM 经 SSE 抵达客户端的同一时刻（约 200-800ms 提前于实际可闻声音）字幕就已显示，**字幕明显跑在声音前面**，尤其在低带宽/慢 TTS 上更明显。计划 §2.1 协议表明确列出 `subtitle payload` 可带 audioSeq，玩家端应保持同样的语音-字幕对齐。 | `emitSubtitle` 改为接收 `audioSeq`，在 `speak()` 内的 PCM 回调里**第一个 chunk** 才发字幕并附带对应 seq（与 `speech.ts:323-327` 模式一致）；客户端 `pushSubtitle` 扩展条件 `role === "assistant" \|\| speaker === "player"` 都进入 held-queue 分支；e2e T3b 已有 SSE 探针可在不改动下继续验证。 |
| B2 | `src/player.ts:146-178` (`polish`) | 计划 §1.3 明确承诺「润色失败降级：润色 LLM 调用失败/超时/空结果 → 直接用原文」，但当前 `polish` 实现**没有超时**——`for await (const chunk of stream)` 在 LLM 挂起时会无限等待，玩家任务永远卡在 polish 阶段、TTS 不启动、AI 永远收不到这条消息。`signal` 仅在 `onLastClose` 触发 abort 时生效，正常运行下的 LLM hang 无任何兜底。 | 在 `polish` 入口用 `AbortSignal.any([signal, AbortSignal.timeout(8000)])`（或显式 `setTimeout` + controller.abort），超时分支与 `catch` 合并返回 `""`。Polish 时长本来就应 ≤ 普通 TTFT，8s 是合理上限；超过则降级到原文。 |
| B3 | `src/player.ts:118-129` (`emotion` 提取后 `vocabulary` 引用了未变更的 `text`) | 实际为轻微可疑：从 `extractEmotionTags(finalText, vocabulary)` 取得 `clean` 与 `emotions` 后才 fallback `spoken = clean.trim() \|\| text`（line 131）。这一逻辑正确（polish 仅返回情绪标签时退回原文朗读），但与代码注释"Polish produced nothing but tags → speak the raw input instead" 顺序不一致——注释说的"只有情绪标签"对应"clean 为空但 text 非空"，代码亦如此。但 polish 完全失败（`polished = ""`）时 `finalText` 仍为原文（line 117），也是 text。两种情况合并为 `clean \|\| text` 即可。**逻辑本身正确**，不是 bug。 | 建议保留即可。如想明确意图可加注：`clean` 为 polish 去掉情绪标签后的可朗读部分；polish 完全失败时 finalText 未变 → clean 为 polish 输出（可能空），回退 text。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | `src/client/view.tsx:584-586` (`onExpression`) | 表达式事件直接转发到对应模型 `setExpression`，但若 `model` 为 null（玩家模型尚未挂载完成、模型 load 失败、玩家模型选择为空等情况），调用被静默丢弃。Player 模型挂载在 useEffect 里异步进行，期间 polish 完成前的 `expression(speaker:"player")` 事件会丢失。 | 在 `setExpression` 之前检查 `model`，无 model 时把表达式缓存到 per-speaker ref `pendingExpressionRef.current`，并在 player 模型 useEffect 的 `.then` 里回放。 |
| S2 | `src/client/view.tsx:617` (`onSubtitle`) | 玩家行 `subtitle(speaker:"player")` 没有 audioSeq（参 B1），但 `pushSubtitle` 的判断里只有 assistant 走 held-queue。修复 B1 时应同步扩展这条判断；同时玩家行目前不会进 `pendingSubsRef`，因此 `pendingSubsRef.current.filter((line) => line.utteranceId === utteranceId)`（line 598）不会过滤玩家行的早期字幕——但因为玩家字幕是立即显示的，这条 filter 实际只影响 assistant。可在修复 B1 时一并复核。 | 修复 B1 时让 `pushSubtitle` 对玩家行也走 held-queue（带 audioSeq），并把 `pendingSubsRef.current` 的过滤逻辑改为"等于当前 active utterance 的行保留"（与现 filter 语义等价），统一两个 speaker 的处理。 |
| S3 | `src/player.ts:188` (`voiceId`) | `voiceId = config.playerVoiceId \|\| config.voiceId` 在用户没选玩家音色时退回 AI 音色。`hud.tsx:354-356` 已提示「玩家音色与 AI 相同，建议换一个更好分辨」，但回退仍是默认行为。落地体验：未配置 playerVoiceId 时玩家和 AI 同声，HUD 提示但无替代方案。 | 将 `playerVoiceId` 默认值从「元气少年音」硬编码（`config.ts:236`）改成与 `voiceId` 的默认值**明显不同**的另一个预设即可，无需逻辑改动。当前默认值 `ed3a1c52…` 与 `VOICE_PRESETS[0]` 的 `0c7771ca…` 已不同，分辨度可接受。无需改代码。 |
| S4 | `src/player.ts:262-273` (`resolveAgent`) | 与 `src/routes.ts:372-389`（`/message` 路由）做了**同一份 agent 解析与冷会话恢复**逻辑。`resolveSessionModel`（line 244-258）也和 `routes.ts:817-832`（`/model-selection` 路由）部分重叠。可控重复——plan §3 的取舍——但目前已经有两份独立维护，未来若任一处实现变（如新增 resume hook），另一处会静默失效。 | 在 `src/agents.ts`（或 routes.ts 顶部）抽出一个共享 `resolveAgentForRoute(ctx, sessionId)` / `getSessionModel(ctx, sessionId)` helper，让 player.ts 与 routes.ts 都调用同一份。属于"长期维护"层面的清理，可在 follow-up PR 中做，不阻塞本次合并。 |
| S5 | `src/client/view.tsx:255-257` (config initial state) | `setThirdPerson(config.thirdPerson === true)`、`setPlayerVoiceId(config.playerVoiceId \|\| "")`、`setPlayerPolish(config.playerPolish !== false)`：第三项用 `!== false`，前两项用 `=== true` / `\|\| ""`，三种偏紧度的合并容易让后续维护者疑惑（特别是 `playerPolish` 默认 `true`，其他默认 `false`）。 | 集中到一个 `useEffect` 里逐字段明确「服务端默认值 / fallback 默认值」，并在 settings-section.tsx:267-272 同步使用同一份映射。也可在 `config.ts` 里暴露 `resolvePublicConfig(cfg)` 集中处理，让客户端只信任服务端响应。 |
| S6 | `src/client/view.tsx:884-930`（第三/三人称 controls）与 `hud.tsx:307-369`（⚙ 面板） | `pickPlayerModel`/`pickPlayerVoice`/`togglePlayerPolish` 三组 handler 在 view.tsx 和 hud.tsx 各定义一份，签名相近但语义交叉——`onPickPlayerVoice(preset)` 在 HUD 直接拿 preset id，但 `saveConfig({playerVoiceId: preset.voiceId})` 又绕了一层。冗余但不 bug。 | 后续如增加更多 player 选项，提取一个 `useThirdPersonControls()` hook 减少分散点。本次不阻塞。 |
| S7 | `src/client/view.tsx:386` (cache-busting URL) | AI 模型和玩家模型都用 `Date.now()` 加 `_v=` 防止缓存。玩家模型在 `view.tsx:443` 同样处理。**两次重新加载**：当 thirdPerson toggle 时，由于 `modelInfo` 改变触发 useEffect 重挂，玩家模型 URL 也会刷新。**无 bug**，但首次进入 + 切到第三人称时玩家模型有两次 `_v` 不同的请求，最后一次生效。 | 单次进入用 effect 内部重置 URL 即可。但要权衡可读性，可不改。 |
| S8 | `src/client/view.tsx:431-433` (`setLayout` 副作用) | `dual = modelInfo?.thirdPerson === true && Boolean(modelInfo?.player?.url)`，**未选中玩家模型**时 `player.url` 为 undefined → dual=false → AI 缩到中央。`hud.tsx:321` 的 `<>` 块只在 `thirdPerson` 为 true 时渲染玩家模型选择——意味着用户可能先开 thirdPerson、尚未选玩家模型就退出，AI 居中；之后选玩家模型，AI 右移、玩家入场——符合直觉，**正确**。 | 无需改动。仅记录行为。 |
| S9 | `src/client/subtitle.tsx:35-39` (older 行的 `lv-sub-speaker`) | 仅 current 行显示「你」徽章（line 43）；older 行（line 37）也显示，但 `lv-sub-pending` 仅加在 current 行。如果一个 pending 占位行老化到「older」槽位，会以普通样式显示「酝酿中…」，失去视觉提示。 | 把 `lv-sub-pending` 也应用到 older pending 行；或将 pending 行的 TTL 缩短到与 `showSubtitle` 的过滤同时清理（host 收到真实字幕就被过滤）。 |
| S10 | `src/client/styles.ts:161` (`vertical-align: 2px`) | 硬编码像素值与不同字体的基线对齐有差异；徽章视觉位置在某些字体下会偏高或偏低。 | 改为 `vertical-align: -0.1em` 或 `middle`；属于 nice-to-have。 |
| S11 | `src/client/view.tsx:596` (`active.current = utteranceId`) | 新 speech-start 在 supersede 路径里总会更新 active，但**当新 utterance 是 assistant 且 currentSpeaker 是 player 时**（玩家台词在播、AI 提前到达的 speech-start），代码保留玩家音频不打断（line 595 `if (isPlayer \|\| engineRef.current?.currentSpeaker() === "assistant")` 不会停）。这符合 plan §2.5「玩家台词播完前 AI speech-start 到达 → 不 stop」的语义。但 active.current 此时已被覆盖为新 assistant utteranceId——**若紧接着 AI 自己的 audio 也带旧 utteranceId，会被 onAudio/onAudioStart 的 active 检查拒绝**。需要确认后续 audio 事件都带新 utteranceId。 | 已通过 host 的 SS` (`utteranceId` 在 speak() 入口生成后贯穿整个流) 保证，**无需改**。仅记录。 |
| S12 | `src/client/view.tsx:1043-1136`（mic 路径）`onSegment` 块 | `submitText(text, "queue"\|"steer")` 在 thirdPerson 模式同样走 player pipeline。**未变更**——但 ASR 长句经过 polish 后可能成为更短的台词（"今天好累啊" → "[sadness] 唉…今天真的累坏了呢"）。玩家看到 ASR final 立刻清空 draft 占位，**但 host 还在 polish + TTS**，直到首个 PCM 才更新字幕。期间用户感到"输入已发送但无反应"约 1-2s。属合理反应，但应在 ⚙ 面板提示 polish 关闭时也可立即显示（已实现，polish off 走 raw path）。 | 文档化 polish on/off 的不同延迟感即可（README 已 §"工作原理"中有，HUD 不必再加）。 |
| S13 | `src/client/view.tsx:471` (`stageRef.current.dataset.lvPlayer = String(...)`) | dataset 写一个字符串属性做 e2e 探针用（`verify-third-person.mjs:129`）。属调试性质侵入。 | 可保留（仅占内存），也可改成 `WeakMap<HTMLDivElement, string>`。不阻塞。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | `src/player.ts:115` (`if (config.playerPolish && this.deps.hub.has(sessionId))`) | 玩家没有 Live view 时（`hub.has === false`）会跳过 polish 直接用原文，但**仍会走 speak + submit**——speak 在 `hub.has===false` 分支不会发 SSE（line 134 check 跳过），所以无声提交。属"无 view 也提交"的有用降级，**正确**。 | 无需改。 |
| N2 | `src/player.ts:170-176` (`polish` 的 try/catch) | 仅在 catch 里返回 `""`，正常完成但 text-delta 全为空字符串也走 `out.trim()` 返回 `""`，polish 文本为空但**不报错**——UI 区分不出来"成功但空"和"出错"。 | 当前回退路径相同（都用原文），故无影响。可不改。 |
| N3 | `src/player.ts:241` (`settleSpeech`) | 同时发 `audio-end` 和 `speech-end(reason)`。`audio-end` 不带 `reason`，`speech-end` 带——客户端 `onAudioEnd` 只看 utteranceId 匹配（`view.tsx` 无 onAudioEnd handler，但默认 EventSource 行为是 `{}`）。 | 一致即可。 |
| N4 | `src/speech.ts:156-159`（`applySpeechTap` 返回的 supersede 函数）| 仅 abort 当前 active TTS，不 abort polish / 不清队列。Player pipeline 的 `process` 调用 supersedeAssistant 是**串行的**：先 supersede 旧 AI 任务，然后开始自己的 polish+TTS。两个任务无重叠——这是计划 §1.2 串行保证。 | 无需改。 |
| N5 | `src/routes.ts:308`（POST `/config` 字段白名单）| 接受 `playerPolish`/`thirdPerson`/`playerSpeechLanguage`/`playerPrompt`/`playerModelSelection`/`playerVoiceId`，**未接受** `playerEmotionMap`——但 line 327-333 又有 playerEmotionMap 的接收分支。 | **白名单无 playerEmotionMap 字符串键**（不需要字符串键，它是对象），实际上 playerEmotionMap 的对象分支已覆盖。无需改。 |
| N6 | `src/routes.ts:394`（POST `/message`）| emit `subtitle(role:"user", text)` 时**未带 `speaker:"player"`**——这是 first-person 路径，user 行不需要 speaker（缺省即 assistant 语义，user 角色靠 `role:"user"` 区分），**正确**。 | 无需改。 |
| N7 | `src/client/view.tsx:577-650`（SSE handlers） | 22 个 handler 里有些用了 `useRef` 内值（`activePlayerUtterance`、`thirdPersonRef`、`currentUploadRef`），有些不依赖——风格略不一致但合理（依赖 ref 的就是不参与重渲染）。 | 无需改。 |
| N8 | `src/player.ts:269` (`sessionController.resolveAgent`) | 调用未传 `ctx.planner`、`ctx.llm` 等明确依赖，依赖 sessionController 自带。冷会话恢复行为依赖 sessionController 的内部实现——如未来 sessionController API 调整，会静默失败。 | 与 S4 同源，跟踪即可。 |
| N9 | `e2e/verify-third-person.mjs:71`（`sessionLog()` 用 execSync + find/zstd） | 每次都硬扫全 sessions 目录找最新日志，单测慢。可接受（每 1-10s 一次）。 | 不改。 |
| N10 | `e2e/verify-live.mjs` `verify-voice.mjs` 改动 | 选择器更新（`.lv-sub` → `.lv-sub-card, .lv-sub-old`、`.lv-user` → `.lv-sub-user`、`.lv-err` → `.lv-sub-err`），以及字幕断言从"DOM 中 ≥2"改为"累计 seenSubs ≥2"以应对 LLM TTFT 长尾。注释清楚（line 156-159）。 | 测试基础设施更稳健，**正向改进**。 |

## 准入结论

**结论**：`条件准入`

**说明**：

- **无功能性阻塞**——核心链路（润色→TTS→提交→双模型舞台→SSE 顺序保证→会话日志写入）经 e2e 覆盖验证均通过；架构清晰、协议向后兼容、与在途改动隔离干净。
- **存在两处建议级阻塞前项**——B1（玩家字幕未与音频播放同步，UX 不一致）与 B2（polish LLM 无超时，hang 时任务永远卡住）。两者都是 1-2 行改动，B2 只需加 `AbortSignal.timeout(8000)`、B1 需在 host/client 两端约 10 行联动改动。**强烈建议在合并前补齐这两项**——B2 是用户能直接感知的"输入无响应"，B1 在低带宽下肉眼可见。
- 建议修改项 S1-S13 与非阻塞问题可在合并后迭代处理。
- 测试覆盖：T1（配置面）、T2（双模型舞台）、T3（polish off 链路 + 顺序）、T4（日志）、T5（polish on + 翻译 + 表情）、T6（关闭兜底）、T7（pageerror 零），全部 PASS；回归 verify-live/verify-voice 选择器更新已加固。

---

## 复审记录（Round 2，2026-09-25 06:28）

### 复审范围

针对首轮检视的**阻塞前项（B1、B2）**与**部分建议项（S1+、S2、S9、S10）**的修复验证，附带发现并解决首轮未识别的一个深层新问题（B1 衍生：seq 空间冲突）。

### 复审结论

**首轮结论保持不变**（条件准入）→ **本轮升级为：`准入`**

| 首轮 ID | 修复位置 | 修复要点 | 复审判定 |
| --- | --- | --- | --- |
| **B1**（玩家字幕超前） | `src/player.ts:191-244,246-255`；`src/client/view.tsx:192-201` | `emitSubtitle` 增加 `audioSeq?` 参数；`speak()` 在首个 PCM 回调里 `emitSubtitleOnce(seq)` 携带首片 seq 下发，与 `speech.ts:327` speakSentence 同模式。客户端 `pushSubtitle` 的 hold 条件由 `role==="assistant" && audioSeq` 扩展为 `typeof audioSeq==="number"`（任何 speaker 都进 held-queue）。 | ✅ 已闭合。修复与 assistant 路径同形态，UX 一致性问题解决。 |
| **B1 衍生**（seq 空间冲突，首轮未识别） | `src/client/engine.ts:49,128-145,209-210`；`src/client/view.tsx:239-245` | `chunkStarts` 项加 `speaker` 字段；`currentSeq(speaker)` 按 speaker 过滤扫描（不再全局取最新 seq）；scheduler 用 `cursors: Record<Speaker, number>` 逐行匹配自己 speaker 的游标。 | ✅ 已闭合。这是 B1 修复引入的**回归风险**——player 与 assistant seq 计数器各自从 0 起，混合后 currentSeq 会返回 player 旧值或提前释放 assistant 行。新实现按 speaker 隔离 seq 空间，从根上规避。**修复质量高于预期**。 |
| **B2**（polish 无超时） | `src/player.ts:34-35,160-187` | 新增 `POLISH_TIMEOUT_MS = 10_000`；`polish` 内建独立 `AbortController` + `setTimeout` 上限；`llm.stream` 与 `for-await` 消费循环都用 `capped.signal`；`signal.addEventListener("abort", forwardAbort, { once: true })` 转发父信号；`finally` 清 timer 与 listener。超时/中断 → 返回 `""` 回退原文。 | ✅ 已闭合。实现采用"父信号 OR 上限"的任一中断模式（`AbortSignal.any` 风格的 `forwardAbort` 转发），路径正确；try/finally 保证 listener 不泄漏。10s 留出 ~5x 正常 polish 时长余量。 |
| **S1+**（玩家表情被丢弃） | `src/player.ts:121-134,191-206`；`src/client/view.tsx:72,484-488,599-611` | `process()` 提取 emotion/expression 后**传入** `speak()`；`speak()` 在 `speech-start`/`audio-start` 之后才发射 `expression` 事件（line 204-206）。客户端 `onExpression` 玩家分支：模型已挂载则直接 `setExpression`；未挂载则缓存到 `pendingPlayerExpressionRef`，玩家模型 useEffect 的 `.then(mounted => ...)` 中回放。 | ✅ 已闭合。这是个**首轮未识别但更深的真实 bug**——原 player.ts 在 speech-start **之前**发射 expression，但客户端 `onExpression` 会被 `utteranceId !== active.current` 门控拒绝（active 由后续 speech-start 才更新）。修复在 host 端让 expression 与 speech-start 形成正确顺序，client 端兜底未挂载竞态，**两路防御**。E2E T3d/T5d 已覆盖此路径。 |
| **S2**（held 行清理按 speaker 区分） | `src/client/view.tsx:613-632` | `onSpeechStart` 的 `pendingSubsRef` 清理改为：`新 player utterance` 清掉旧 assistant held（host 已 supersedeAssistant 不会送达）+ 保留自己 utteranceId 的行；`新 assistant utterance` 保留 player 仍排队中的行 + 仅过滤自己 utteranceId 的旧行。 | ✅ 已闭合。语义与 plan §2.5「AI 提前到达不打断 player 排队」一致。 |
| **S9**（older 行 pending 样式） | `src/client/subtitle.tsx:36-40` | `<div className={\`lv-sub-old${line.pending ? " lv-sub-pending" : ""}\`}>` —— pending 行老化不再丢失视觉提示。 | ✅ 已闭合。 |
| **S10**（徽章 vertical-align） | `src/client/styles.ts:161` | `vertical-align: 2px` → `vertical-align: -0.1em`。 | ✅ 已闭合。 |
| **新增稳健性**（held 行兜底 TTL） | `src/client/view.tsx:241-242` | scheduler `due` 谓词：`line.audioSeq <= cursors[line.speaker ?? "assistant"] \|\| now - line.at > 30_000` —— AudioContext 永不运行等极端场景下，字幕 30s 后强制释放，不再"永不显示"。 | ✅ 加分项。无回归风险，是防御性补充。 |

### 复审详细发现

**1. B1 修复**（`src/player.ts:214-217`）：
```ts
const emitSubtitleOnce = (audioSeq?: number): void => {
    if (subtitled) return;
    subtitled = true;
    this.emitSubtitle(sessionId, utteranceId, text, audioSeq);
};
// ...
await synthesize({ text, voiceId, ... }, (pcm) => {
    if (signal.aborted) return;
    emitSubtitleOnce(seq);  // 首片 PCM 携带当前 seq（递增前）
    this.deps.hub.emit(sessionId, "audio", { ... seq: seq++, ... });
});
```
- 注意：`emitSubtitleOnce(seq)` 在 `seq++` 之前调用 → 字幕的 audioSeq 等于**首片 PCM 实际即将下发的 seq**，与 audio chunk 的 seq 完全一致，客户端 hold 释放条件严格成立。✅

**2. B2 修复**（`src/player.ts:163-187`）：
```ts
const capped = new AbortController();
const capTimer = setTimeout(() => capped.abort(), POLISH_TIMEOUT_MS);
const forwardAbort = () => capped.abort();
if (signal.aborted) capped.abort();
else signal.addEventListener("abort", forwardAbort, { once: true });
let out = "";
try {
    const stream = this.ctx.llm.stream({ ... signal: capped.signal });
    for await (const chunk of stream) {
        if (capped.signal.aborted) return "";  // 提前返回走 finally
        if (chunk.type === "text-delta" && chunk.text) out += chunk.text;
    }
} catch {
    return "";  // fetch 被 abort 抛 AbortError 也走这里
} finally {
    clearTimeout(capTimer);
    signal.removeEventListener("abort", forwardAbort);
}
return out.trim();
```
- 异常路径（fetch AbortError）与正常超时（capped.signal.aborted）统一返回 `""`，finally 保证 timer/listener 不泄漏。✅
- 小冗余：`if (signal.aborted) capped.abort();` 在函数顶部 `if (... || signal.aborted) return "";` 之后其实不可达（signal 已 abort 早已 return）。属无影响的防御代码，可保留或精简。**非阻塞**。

**3. B1 衍生修复**（`src/client/engine.ts:136-145`）：
```ts
currentSeq(speaker: Speaker = "assistant"): number {
    if (!this.context || this.context.state !== "running" || this.chunkStarts.length === 0) return -1;
    const now = this.context.currentTime;
    let last = -1;
    for (const entry of this.chunkStarts) {
        if (entry.startAt > now) break;
        if (entry.speaker === speaker) last = entry.seq;
    }
    return last;
}
```
- 这正是首轮我担心的"seq 空间污染"——host 端 player 与 assistant 各自从 0 起，混进同一 chunkStarts 后旧代码 `last = entry.seq` 会取到 player 的旧 seq，导致后续 assistant 字幕（audioSeq=0）被 `line.audioSeq <= cur` 立即释放（hold 击穿）。新实现按 speaker 隔离，从根上闭合。**这是一次精准的回溯诊断**。✅

**4. S1+ 修复**（`src/player.ts:121-134,202-206` + `src/client/view.tsx:599-611`）：
- Host 端顺序修正：`speech-start` → `audio-start` → `expression`，确保客户端 active-utterance 门控已就绪。
- Client 端兜底：`pendingPlayerExpressionRef` 缓存 player 模型尚未挂载时到达的 expression；玩家模型 useEffect 的 `.then(mounted => mounted.setExpression(pendingExpression))` 回放。
- 两路防御完整：第一行到达时（已挂载）正常显示；后续到达时（未挂载）缓存 + 回放。✅
- **残余风险**：仅缓存**最新**一个 expression（`pendingPlayerExpressionRef.current = expression`，覆盖写），如果某个 utterance 在挂载前连发两个 expression（旧 emotion → 新 emotion），只回放最新的。属于次要取舍——同一 utterance 通常只发一次 expression，且 emotion 取自末尾标签。**非阻塞**。

**5. S2 修复**（`src/client/view.tsx:627-629`）：
```ts
pendingSubsRef.current = pendingSubsRef.current.filter(
    (line) => line.utteranceId === utteranceId || (!isPlayer && line.speaker === "player"),
);
```
- 解读：保留**新 utteranceId 自己**的行（它们尚未被本次 supersede 波及）；保留**玩家仍排队中**的行（即使新 assistant utterance 到达，也不应被清）；清除**旧 assistant held 行**（host 已 supersedeAssistant，永远到不了客户端）。语义精确。✅
- 微小隐患：`!isPlayer` 含义是"当前是 assistant speech-start"——所以"新 assistant 不动 player 排队"被表达为 `line.speaker === "player"` 保留。读起来略费解，可加注释"新 assistant 不应清 player 排队中的 held 行"。**非阻塞**。

**6. 测试覆盖变化**：e2e/verify-third-person.mjs 28/28 通过，与首轮相同的 T1-T6 + T7 框架未变，但 T3d（"你"徽章渲染）现在依赖新字幕 hold 释放路径工作——这是 B1 修复的**端到端断言**。T5d（玩家 expression 事件）是 S1+ 的覆盖。T3g（wire 顺序）确保 player→assistant 顺序仍然成立。E2E 在 polish-on 路径下能稳定通过，说明 seq 空间分离也工作正常。

### 复审结论

**结论**：`准入`（从「条件准入」升级）

**说明**：

- **所有阻塞前项已闭合**：B1、B2 均得到正确修复，且修复过程中又发现并解决了一个深层衍生问题（B1 衍生：seq 空间冲突）。修复质量高于首轮预期。
- **首轮建议项已完成**：S1（升级为 S1+，含更深的真实 bug）、S2、S9、S10 全部修复；新增 30s TTL 兜底作为加分项。
- **未在复审范围的首轮建议项 S3-S13**：本轮未触及（用户仅要求复审"阻塞前项与部分建议项"）。S3-S13 均为清理/文档/UX 改进性质，可在后续迭代处理。
- **测试覆盖**：e2e 28/28 通过，typecheck + build 通过；回归测试 verify-live/verify-voice 未回归。
- **剩余非阻塞建议**：
  1. `src/player.ts:166` 的 `if (signal.aborted) capped.abort();` 是不可达代码（顶部已 return），可删除或加注释。
  2. `src/client/view.tsx:629` 的 `(!isPlayer && line.speaker === "player")` 谓词读起来费解，可加一行注释"新 assistant 不动 player 排队中的 held 行"。

  两者均不阻塞合并，仅作为后续清理备忘。

> **实施方闭环备注（复审后）**：上述两条清理备忘已完成——不可达的 `if (signal.aborted) capped.abort()` 已删除（改为直接注册 `signal.addEventListener`，polish 顶部早退已覆盖已中止情形）；held 行清理谓词已重构为带逐行注释的块形式。typecheck 通过；两处均为无行为变化的清理，e2e 无需重跑。

