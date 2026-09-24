# 第三人称模式 — 实施总结

**日期**：2026-09-25
**仓库**：`/root/plugins/dsh-live2d-voice`（版本 1.5.0）
**状态**：typecheck/build 通过；`verify-third-person.mjs` 28/28 全绿；reviewer 首轮「条件准入」→ 修复 → 复审「**准入**」；e2e-tester 实机验证功能 4/4、总体通过；hunk 级提交（未混入他人在途改动）

## 需求回顾

第三人称模式：开启后玩家拥有自己的 Live2D 模型与音色，与 AI 角色双角色同台；用户输入先经可选润色/翻译层变成玩家角色的台词，由玩家皮套先念出（TTS + 口型 + 字幕「你」徽章），AI 皮套再回应；润色后的台词才是进入会话日志的 user 消息。（计划：`260925-third-person.plan.md`）

## 架构与关键决策

### 玩家台词管线（host，新模块 `src/player.ts`）
- `PlayerPipeline` 每会话串行队列：润色 → 表情 → TTS → **TTS settle 后才** submitToAgent——SSE 上 player 音频 chunk 严格先于 assistant（e2e T3g 断言 #120 < #126），客户端单 FIFO 音频队列免费获得"玩家先说、AI 接话"，且 AI 生成（TTFT）与玩家台词**播放**并行
- 润色 = 无 sessionId 的一次性 `ctx.llm.stream`（不触发自家 llm/stream tap 回环；模型取会话同款，sessionController.modelCatalog 兜底）；10s 超时兜底（capped AbortController），超时/失败/空 → 回退原文
- 任务开始先 `supersedeAssistant(sessionId)` 打断 AI 在途 TTS（`applySpeechTap` 新增返回 supersede 函数）；`onLastClose` abort controller 但已有文本仍提交（输入永不丢）

### 协议：SSE 事件加 `speaker` 字段（向后兼容）
事件名全部复用，payload 带 `speaker?: "assistant" | "player"`，缺省 = assistant。AI 侧 speech.ts 除 supersede 一行外零改动，避开与在途改动的冲突。

### 共享 Pixi Application（实施期对计划 §2.5 的重大修正）
计划原定两张全幅透明 canvas 叠放（双 Pixi Application）。实施发现 **Cubism SDK 的 WebGLManager 是全局单例并持 gl 指针**——第二个 WebGL context 会抢占单例，先挂载的模型每帧 bindTexture 全部 INVALID_OPERATION、渲染空白且无报错。改为 `createLive2DStage` 返回共享 `{app, canvas}`，两模型挂同一 app（AI 右 0.72/玩家左 0.28，scaleGain 0.8），`setLayout` 切换布局不重载。教训已记入 `src/client/AGENTS.md`。

### audioSeq 字幕同步扩展到玩家行（review B1 及其衍生修复）
- 玩家字幕随首片 PCM 的 seq 下发（与 assistant 同模式），客户端 hold 到该 chunk 实际开始播放才显示——字幕不再跑在声音前面 200-800ms
- **衍生 bug（修复过程中发现）**：assistant 与 player 的 seq 计数器各自每轮从 0 起，混入客户端同一个全局 `chunkStarts` 会互相污染——player 播完后 `currentSeq` 停在 player 旧值，后续 assistant 行会被立即/提前释放（hold 被击穿）。修复：`chunkStarts` 逐项记录 speaker，`currentSeq(speaker)` 按 speaker 过滤；scheduler 用 `cursors: Record<Speaker, number>` 逐行匹配自己 speaker 的游标；另加 30s held 行 TTL 兜底
- `pushSubtitle` hold 条件从 `role==="assistant" && audioSeq` 放宽为任何带 audioSeq 的行；flush 透传 speaker（「你」徽章 + 回声参照不丢）

### 玩家表情两路防御（review S1+，比首轮发现更深）
player.ts 的 expression 事件原本在 speech-start **之前**发射，而客户端 onExpression 有 active-utterance 门控（active 由 speech-start 更新）→ **玩家表情实际永远被静默丢弃**（e2e 只断言 SSE 到达，故未暴露）。修复：host 侧 expression 改在 speech-start/audio-start 之后发射；client 侧 `pendingPlayerExpressionRef` 缓存模型未挂载时到达的表情、挂载完成后回放。

### 其他
- 回声防护：玩家台词进独立 `playerEchoRef`，`looksLikeEcho` 双参照比对；「酝酿中…」pending 占位行不进日志、不进回声参照
- 降级链：thirdPerson 关 → `/player-line` 兜底直连旧提交链路；无玩家模型 = 无形象"画外音"；无 TTS key = 字幕照发、消息照提交
- e2e-tester 发现的 UX 问题已修：键盘输入框打开时遮挡当前字幕卡 ~57%（`raised` 抬升原本只在麦克风监听时生效）→ `inputOpen` 时字幕与 toast 同步抬升（raised 底部 chrome+128px，高于输入框顶部 ~110px，几何上无重叠）

## 审查闭环

| 问题 | 修复 |
| --- | --- |
| B1 玩家字幕超前 200-800ms | emitSubtitle 带 audioSeq + 客户端 hold 扩展（见上） |
| B1 衍生：seq 空间跨 speaker 污染 | engine chunkStarts/currentSeq 按 speaker 隔离 |
| B2 polish 无超时（LLM hang 会吞掉输入） | POLISH_TIMEOUT_MS=10s capped controller，超时回退原文 |
| S1+ 玩家表情被 active 门控静默丢弃 | 发射顺序修正 + pendingExpression 缓存回放 |
| S2 held 行清理误伤 player 行 | onSpeechStart 清理按 speaker 区分 |
| S9 pending 行老化丢样式 | older 行也应用 lv-sub-pending |
| S10 徽章基线 | vertical-align 2px → -0.1em |
| e2e-tester：输入框遮挡字幕 | inputOpen 时 raised 抬升（字幕 + toast） |

复审结论「准入」；两条非阻塞清理备忘（不可达行、费解谓词）已于复审后完成并闭环备注进 review.md。S3-S13 其余建议项留待后续迭代。

## 验证

- typecheck 0 错、build 双产物 + standalone ✅
- `e2e/verify-third-person.mjs` **28/28**（配置面 T1 / 双模型共享画布 T2 / polish-off 全链路 + pending 占位 + 「你」徽章 + wire 顺序 T3 / 日志 T4 / 中→日润色 + 表情 + 原文不进日志 T5 / 关闭兜底 + ⚙ 切换 T6 / 零 pageerror T7）——B1 修复后 T3d 即 hold 释放路径的端到端断言 ✅
- 回归：`verify-live.mjs` 22/22、`verify-voice.mjs` 17/17（本轮 delta 对第一人称路径逐条等价：pushSubtitle/scheduler/onSpeechStart 在无 player 事件时行为与旧代码一致，未重跑）✅
- e2e-tester 实机验证（独立脚本 + 全新会话）：功能 4/4、总体通过；口型路由双向确证、字幕-音频同步线上锁定；报告 `260925-third-person.e2e.md`（证据 `e2e-shots/` 21 文件）
- 线上 :4180 **未动**（lib 构建产物已就绪，待用户确认后按 restart-dsh 流程部署）

## 文件清单

```
src/player.ts                      新增：玩家台词管线
src/config.ts                      7 个 player 配置字段 + playerEmotionMap 合并
src/speech.ts                      applySpeechTap 返回 supersede
src/routes.ts                      /player-line 路由 + /model、/config 扩展
src/index.ts                       PlayerPipeline 接线与 dispose
src/system-prompt.ts               第三人称提示行
src/client/types.ts                Speaker 类型 + 协议字段
src/client/api.ts                  postPlayerLine
src/client/engine.ts               speaker 感知音频队列（speakerSpans/currentSeq(speaker)/mouthValue(speaker)）
src/client/model.ts                createLive2DStage / mountModel(shared) / setLayout
src/client/view.tsx                双模型挂载、SSE 分流、字幕 hold、pending 占位、提交路径
src/client/hud.tsx                 ⚙「第三人称」区
src/client/settings-section.tsx    系统设置「第三人称模式（玩家化身）」卡
src/client/subtitle.tsx            pending 态 + 「你」徽章
src/client/styles.ts               lv-sub-pending / lv-sub-speaker
src/client/AGENTS.md               新增：模块地图 + Cubism 单 context 等 pitfalls
e2e/verify-third-person.mjs        新增 28 项
e2e/verify-live.mjs / verify-voice.mjs  过期选择器修复 + 断言加固
README.md / CHANGELOG.md / package.json (1.5.0)
docs/features/260925-third-person/ plan / review（含复审）/ e2e / validation / summary
```

> lib/ 构建产物未随本提交（工作区 lib 同时含另一在途 agent 的编译产物，待其提交时统一同步——沿用本仓库 build 提交惯例）。
