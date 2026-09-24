# dsh-live2d-voice v1.5.0「第三人称模式」端到端测试报告

> 独立测试（非复跑参考脚本）：全部用例在全新会话上以自有脚本执行，断言与证据独立采集。参考脚本 verify-third-person.mjs 的 28/28 结果仅作背景，未直接引用为本报告结论。

## 测试环境

- 环境/前置：
  - e2e 实例 `http://127.0.0.1:4188/?token=e2etest`（DSH_HOME=/root/.dsh-e2e，已加载最新构建，全程未重启）
  - headless Chromium 1243（arm64）1280×800，SwiftShader 软件 WebGL，`--autoplay-policy=no-user-gesture-required` + 静音；面部连拍用 deviceScaleFactor=2 裁剪放大
  - 角色：AI=haru（春 · 前台接待版，棕发西装），玩家=deepseek-chan（DeepSeek娘 · 品牌拟人，蓝发女仆）；音色：AI=温柔女仆·雷姆（0c7771ca），玩家=元气少年音（ed3a1c52）
  - 会话：5 个全新 session（playwright-core 自动化创建；AI 人设沿用实例既有配置：virtual-connect 项目助手、speechLanguage=ja / subtitleLanguage=zh、sentenceSubtitles=on）
  - TTS：Fish Audio s2.1-pro-free（实例已配 key）；润色走 e2e 网关 LLM
  - 已知环境特性（实测印证）：网关 TTFT 长尾——AI 回复 9–45s，一轮 >171s 未出；Fish TTS 首包 1.5–11s 波动
  - 证据目录：`docs/features/260925-third-person/e2e-shots/`（原始副本 `/tmp/e2e-tp/`，含全部 40+ 截图与 SSE 事件流 JSON）
  - 测试后配置已恢复：thirdPerson=false / playerPolish=true / playerSpeechLanguage=ja / playerModelSelection=deepseek-chan，与测试前快照逐字节一致（已核对）

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | 配置 thirdPerson=true + playerModelSelection=deepseek-chan；新会话 → Live2D tab；查舞台 DOM 与 GET /model；打开 ⚙「快捷调整」检查「第三人称」区 | 双角色同台（左玩家右 AI）、单张共享 canvas；⚙ 出现「第三人称」区且总开关/玩家模型/玩家音色/润色状态正确 | 全部符合：stage `data-lv-player="deepseek-chan"`、canvas 数=1（共享舞台，无两张 canvas）；/model 返回 thirdPerson=true + player={name:deepseek-chan, label:"DeepSeek娘 · 品牌拟人", url}；⚙ 有「第三人称」h4 区，总开关 aria-checked=true，当前胶囊=DeepSeek娘/元气少年音，润色开关=true；视觉确认左蓝发女仆（玩家）右棕发西装（AI），无重叠 | 通过 | `01-dual-stage.png`、`02-gear-panel.png`、`results.json` |
| 2 | playerPolish=true（zh）下 Live2D 视图点「打字输入」，输入「今天好累啊，随便回应我一句」回车；观察字幕/SSE；等 AI 回应；切 Chat tab；核对会话日志（zstd） | 玩家皮套先以玩家音色念出润色后台词（字幕带「你」徽章），AI 皮套随后回应；Chat tab 与日志的 user 消息=润色后台词，原文不进日志 | 润色为「今天好累啊，随便回我一句呗。」（≠原文）；「酝酿中…」占位 +614ms 出现→被玩家字幕替换，「你」徽章渲染 ✓；SSE 顺序：speech-start→audio-start→expression(neutral)→subtitle(audioSeq=0)→audio#0…，101 个玩家 chunk 严格先于 AI 首 chunk（#110<#116），玩家 speech-end 后 AI +12.5s 回应；Chat tab user 气泡=润色后台词、原文未出现；日志含润色文本、不含原文。注：玩家音色经配置链验证（playerVoiceId=元气少年音贯穿 TTS 请求与 ⚙ 状态），静音 headless 无法听觉比对音色差异 | 通过 | `04-chat-log.png`、`m-player-3.png`、`f2-events.json`、`results.json` |
| 3 | ⚙ 面板关闭「台词润色 / 翻译」→ /config 确认 playerPolish=false → 重开「打字输入」输入「今天天气不错，我出去买了杯咖啡」回车；核对字幕与日志 | 玩家皮套直接念原文（逐字），日志记录原文 | 字幕逐字=原文 ✓（111 个玩家 audio chunk）；日志含原文 ✓；⚙ 切换即时生效（config 回读 false）。注：⚙ 弹层会自动收起键盘输入框（互斥设计，`onTogglePopover` 显式 `setInputOpen(false)`），重开输入框后链路正常——首轮尝试因脚本未重开输入框台词未提交，属脚本疏漏非产品缺陷 | 通过 | `11-gear-polish-off.png`、`12-polish-off-raw.png`、`results-redo.json` |
| 4 | ⚙ 面板关闭「第三人称模式」→ 等玩家模型卸载、查 ⚙ 区折叠 → 重开输入框输入「现在切回第一人称，这句话直接发给你就好」回车；查 SSE/舞台/日志 | 玩家模型卸载、舞台回单角色、⚙ 状态收缩；输入直接交给 AI（第一人称链路正常） | `data-lv-player` 清空（玩家化身卸载）、thirdPerson=false；⚙ 保留「第三人称」h4、总开关=false、玩家模型/音色/润色子控件折叠；提交后 0 个 speaker:player 的 SSE 事件，AI +9.2s 直接回应（63 chunk）；日志记录原文；舞台视觉回单角色居中 | 通过 | `13-single-stage.png`、`14-first-person.png`、`results-redo.json` |

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | 双角色同台视觉观感 | 布局协调、角色辨识、口型各自跟随、「你」徽章 | 布局协调：玩家居左约 28%、AI 居右约 72%，均为全身立绘、互不遮挡，浅色渐变背景，构图平衡；两角色风格差异大（蓝发女仆 vs 棕发西装接待），一眼可辨。单张共享 canvas 肉眼无重影/撕裂/闪烁（实施偏差的双模型同 canvas 方案视觉无异常）。口型路由正确：玩家说话时高清连拍显示玩家嘴部微张→小开→中开随语音起伏、AI 嘴始终闭合微笑；AI 说话时 AI 嘴中开→大开变化、玩家嘴闭合（face-p-1/3/5、face-a2-1/3/6 双向验证）。「你」徽章蓝底小标签置于字幕卡顶边，与无徽章的 AI 行区分清晰，确实帮助分辨说话人 | **问题（关键）：键盘输入框打开时，当前字幕卡被输入框遮挡约 57%**。实测 DOM 矩形：字幕卡 top 641/bottom 708（高 67px），输入框 top 670/bottom 716——下半 38px 盖在字幕后（输入框 z-index 9 > 字幕 4），文本区基本不可见，只剩顶边与「你」徽章露出（05-ja-polish、m-player-3 中日语台词/中文台词文字均不可读）。根因：`raised` 抬升仅在麦克风监听时生效（view.tsx:1217 `micState === "listening" \|\| "requesting"`），打字输入时不抬升。而第三人称打字主流程恰恰最需要读字幕——润色后台词是用户从未见过的新文本。建议：`inputOpen` 时同样应用 `lv-subs-raised`（bottom 92→128px 恰好避开输入框顶边），一行改动。次要建议：AI 回复在 Chat tab 显示原始情绪标签（如 [sappiness]），与 Live2D 视图（剥标签）不一致——既有 AI 管线行为，非本功能引入，顺带记录 |
| 2 | 玩家先说 → AI 回应的节奏 | 「酝酿中…」占位自然度、字幕-语音同步、AI 衔接流畅 | 占位：提交后 ~0.6s 即出现灰色「酝酿中…」，响应快、样式低调自然；被玩家字幕替换的时机正确（真实台词到达即退场，S9 修复后老化行也保留灰样式）。同步：线上证据充分——subtitle 事件携带 audioSeq=0 且紧贴首片 audio(seq=0) 下发，客户端 hold 至该 chunk 实际调度播放才显示（B1 修复端到端生效），字幕与声音起点在协议层锁定，不超前；speech-start(+2.0s)→字幕(+3.5s) 的间隔即 TTS 首包时间，非滞后。衔接：顺序保证严格（玩家全部 101 chunk 先于 AI 首 chunk）；玩家说完→AI 开口实测 6.8–7.8s，与本轮第一人称基线（+9.2s）同量级——瓶颈在 e2e 网关 TTFT，非功能引入的额外延迟；正常网关下按设计（AI 生成与玩家播放并行）应更紧凑 | 问题（体验）：提交→玩家开口实测 3.5s（润色 zh）至 9s+（TTS 长尾轮），润色+TTS 双延迟叠加时「酝酿中…」灰字要挂 7s+，等待感明显。建议占位文案随阶段变化（如「润色中…」→「排练中…」）给用户进度感。另一观察：AI TTFT 长尾轮（>171s 无响应）玩家台词播完后界面无任何「AI 思考中」提示，有空窗感——建议后续加 AI 侧思考指示（可选）。以上均为网关/服务延迟放大，非链路缺陷 |
| 3 | 润色质量主观感受 | 口语改写成台词的自然度；语言切换（zh→ja）效果 | zh→zh（playerPrompt 空）：「今天好累啊，随便回应我一句」→「今天好累啊，随便回我一句呗。」——改写自然、更像口播台词（「回我一句呗」），信息零丢失，情绪标签 neutral 合理；但幅度很小，接近原文，用户可能感知不到润色在工作（对已口语化的输入保守处理，行为正确但存在感弱）。zh→ja（playerSpeechLanguage=ja）：「我真的累坏了，今天加班到现在，安慰我一下吧」→「もうほんと限界…今日ずっと残業しててさ、ちょっと慰めてほしい」——质量很高：口语自然（「ほんと限界…」「～てさ」）、信息点完整（累/加班到现在/求安慰）、带 sadness 情绪并触发玩家表情事件，作为「玩家角色的日语台词」代入感强 | 建议：默认 playerPrompt 为空时润色无角色风格差异，zh→zh 场景近似 no-op——在设置/README 引导填写玩家人设可显著放大润色价值；润色延迟（+2~5s）与 TTS 首包叠加构成主要等待，若后续优化可考虑润色流式或提示（同上条）。无功能性问题 |

## 结论

- 功能：通过 4 · 不通过 0 · 受阻 0
- 体验：3 项观察，关键问题 1（键盘输入框遮挡当前字幕卡约 57%，第三人称打字主流程可读性受损）
- 总体：**通过**（核心链路——双角色同台/单 canvas、润色→玩家先念（你徽章+口型+玩家音色链）→AI 回应、日志=润色后台词、开关回退——全部按需求工作且有视觉/线上双重证据；关键体验问题为一行级修复，不阻塞准入判断但建议尽快处理）

## 待跟进

1. 【关键·建议合并前修】键盘输入框遮挡当前字幕卡（~57%）：`view.tsx:1217` 的 `raised` 条件扩展到 `inputOpen`，或等效调整 `.lv-subs` 与 `.lv-input` 层叠——用户在第三人称打字流程中读不到玩家润色台词
2. 【可选】AI TTFT 长尾时无「思考中」提示的空窗感（e2e 实测一轮 >171s 无响应）；「酝酿中…」占位可分阶段变化文案
3. 【可选】zh→zh 润色近似 no-op：引导用户配置 playerPrompt 以体现角色化差异
4. 【记录】Chat tab 显示 AI 原始情绪标签（[sappiness] 等），与 Live2D 视图不一致——既有 AI 管线行为，非本功能引入
5. 【自动化注意】⚙ 弹层与键盘输入框互斥（`onTogglePopover` 显式收起输入框）——后续 e2e 脚本在面板操作后必须重开「打字输入」（本报告首轮 F3/F4 误报即源于此，产品行为正确）
