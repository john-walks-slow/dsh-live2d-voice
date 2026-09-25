# 检视报告

## 概要

检视 dsh-live2d-voice 三个用户报告 bug（翻译缺尾/堆首、流式双发、独立页双字幕）的修复实现（commit 6fef948 源码部分 + 未提交的 e2e/verify-nodup.mjs 重写）。三个根因诊断准确，修复方案均正确命中且相互独立、无过度设计；`splitByWeight` 算法经逐用例推演与单测覆盖验证正确。无阻塞问题；两条提交卫生类建议修改项（commit 混杂两个修复、构建产物误入库）。

## 需求对齐

| 用户报告 | 根因 | 修复 | 结论 |
| --- | --- | --- | --- |
| 翻译缺尾行/堆首行 | `lines.push` 在 TTS 队列内（微任务），流末快照永远缺积压句；句序 index 对齐错位 | `handleSentence`/`flushBlock` 在流时间同步 push（speech.ts:240-264），快照必然完整；`splitByWeight` 按字符权重比例切分替代 index 对齐 | ✅ 已修复。同步 push 发生在 for-await 循环体内、快照在循环结束后，完整性由构造保证 |
| 翻译很慢 | 单次翻译挂起拖死串行队列 | `TRANSLATE_TIMEOUT_MS = 20s` capped AbortController（speech.ts:107-137） | ✅ 队列不再被挂起调用无限阻塞（生效前提见 N3） |
| 流式一句话发送两回 | `onSegment` 无 asrMode 守卫，buffered 路径与 asr-final 并存 | `onSegment` 首行 `if (asrModeRef.current === "stream") return`（view.tsx:1557-1558） | ✅ 已修复，e2e D1b 直接断言 recognize 计数为 0 |
| 独立页字幕显示两遍 | routes.ts `/message` SSE 回声 + view 本地 pushSubtitle 双写 | `SubmitPrompt` 契约扩展 `remoteEcho?: boolean`；standalone 返回 `true`，view 仅在无回声时本地 push（view.tsx:1349-1356, standalone.tsx:31-36） | ✅ 已修复。GUI 路径（index.ts `session.prompt`）不回声 → 本地 push 保留，行为不变，契约向后兼容 |

补充核对：

- **`speakSentence` 瘦身**：签名去掉 vocabulary/raw/lines 后成为纯 TTS+字幕函数，清洗职责全部上移 `handleSentence`，两模式（sentence/block）统一为流时间清洗——消除了旧 sentence 模式 `extractMotionTags(raw)` 调用两次的冗余，且保证 `lines[]` 与字幕显示文本同源（这正是翻译按 lineId 挂接所需的一致性）。
- **`splitByWeight`（sentence.ts:100-148）**：逐用例手工推演（含"好的。"3 行退化、12 字符 3 行用户复现、切割点碰撞 clamp、窗口空时 best 保持原值），与 8 个单测断言全部吻合；`bestDist = Infinity` 修复正确（否则 `dist < 0` 永假、吸附成死代码）。边界安全：`pos-1 ≥ 0`（lo ≥ snapped[0]+1 = 1）、snapped 单调性由 `lo = snapped[i-1]+1` 保证、退化解只产生尾部空 piece（doc 注释如实声明）。
- **翻译挂接管线**：`attachTranslation` 同时更新 pendingSubsRef（audioSeq hold 中的行）与已显示行（view.tsx:249-253），翻译早到/晚到均不丢失。
- **超时实现**：外层 abort 转发 + finally 清 timer/移除 listener，无泄漏；循环顶部 `capped.signal.aborted` 检查捕获 abort 后的 finish chunk 路径。
- **lib 产物同步**：lib/client.js、lib/standalone.js、lib/index.js 均含新逻辑（onSegment 守卫、`remoteEcho||push`、splitByWeight），与 src 一致。
- **emotion 时机提前的跨轮泄漏**：已核实客户端 onExpression/onMotion 按 active-utterance utteranceId 门控（view.tsx:838-853），被 supersede 的旧 utterance 流时间表情不会泄漏到新轮次。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | commit 6fef948 | 一个 commit 混杂两个独立修复：提交信息只描述 unload/麦克风泄漏/teardown，却同时携带了本次 translation-dup 全部源码改动（speech.ts、sentence.ts、view.tsx 守卫+remoteEcho、standalone.tsx、translation-split.test.mjs、lib 产物、verify-nodup 首版）。后续 `git log --grep` 翻译/双发关键词将完全找不到本次修复，两个修复的回退边界也纠缠在一起。仓库无 remote、未推送，拆分成本最低的窗口就是现在。 | 用 interactive rebase 拆成两个 commit（unload-cleanup / translation-dup），各自补齐提交信息；至少也要 amend 信息补上 translation-dup 的 bullets。未提交的 e2e/verify-nodup.mjs 重写随后作为独立 test commit 提交并引用本 issue 目录。 |
| S2 | tests/.sentence.mjs、.gitignore | 测试构建产物被误提交：translation-split.test.mjs 每次运行用 esbuild 重新生成 `tests/.sentence.mjs`（`--outfile`），而 `.gitignore` 已有先例 `tests/.behavior.mjs` 却漏了它。此后每次改 src/sentence.ts 都会产生脏 diff，提交副本还会随源码漂移变成误导性的僵尸文件。 | `git rm --cached tests/.sentence.mjs`，并在 .gitignore 追加 `tests/.sentence.mjs`。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | src/speech.ts:240-253 | sentence 模式 emotion 发射从 TTS 时间提前到流时间（对齐块模式）。TTS 积压时表情领先语音：流结束时全部句子表情已发完，而队列还在逐句合成/播放，角色会提前做出后面句子的表情。代码注释已声明这是与块模式一致的取舍，且翻译输入一致性确实依赖流时间清洗。 | 记录为已知取舍即可；若日后想优化，可模仿字幕的 audioSeq hold，把 expression 事件挂到该句首个 PCM chunk 的 seq 再发（host 侧缓存，client 侧按 seq 释放）。 |
| N2 | src/speech.ts:51 vs src/client/subtitle.ts:25 | 20s 翻译超时 ≈ 字幕寿命 21s（TTL 14s×1.5）：排队等待（队列内最多 2 个前驱）+ 单次 20s cap，慢翻译经常赶不上目标字幕行——行被 TTL 清扫后 `subtitle-translation` 按 lineId 找不到挂接对象，静默丢弃。代码路径无害（best-effort），但"翻译时有时无"的用户感知可能残留。 | 后续迭代可考虑收紧 cap 到 8–10s（字幕场景及时性 > 完整性），或为翻译走轻量快速模型而非复用会话模型。 |
| N3 | src/speech.ts:112-134 | 超时的实际生效依赖 provider adapter 把 signal 接进底层 fetch：dsh-llm `adapterStream` 会把 `options.signal` 传给 adapter 并把 abort 转为 finish chunk（已核对 node_modules），但若具体 adapter 未接线且模型挂起不吐 chunk，for-await 仍悬住，timer abort 无法解除迭代。此假设与旧代码的 supersede-abort 相同，非本次引入。 | 在真实 cpa provider 上确认一次 signal→fetch 接线（一次手动掐流测试即可），确认后此条可闭。 |
| N4 | tests/ | 回归覆盖缺口：(a) 真正的根因修复——流时间收集 lines 使流末快照完整——无任何测试（单测只覆盖 splitByWeight 纯函数）；(b) e2e 只覆盖 GUI tab 流式说话，未覆盖 standalone 页流式说话（asr-final → viaClient → POST /message + SSE 回声的组合路径）。快照完整性目前靠代码结构保证（同步 push 在循环内、快照在循环后），回归风险低。 | 后续迭代在现有 e2e 流程上补一条轻量断言：开启 subtitleLanguage 后核对每行 assistant 字幕是否都收到 translation（覆盖 a），standalone 页喂一次 PCM（覆盖 b）。 |
| N5 | src/client/standalone.tsx:31-36 | remoteEcho 契约边界：SSE 断连重连窗口内提交时，`/message` 的回声发往无监听的 hub 被丢弃，本地 push 又被 remoteEcho 跳过 → 该行字幕不显示（消息本身仍正确送达 agent）。概率低且与系统整体 SSE 依赖一致（助手字幕同样依赖 SSE）。 | 记录备忘，无需处理。 |

## 准入结论

**结论**：`条件准入`

**说明**：三个根因的修复实现均正确且经代码推演与测试映射验证，无阻塞问题；S1/S2 为提交卫生项（commit 拆分/信息补全、构建产物出库），建议在本次 e2e 改动提交时一并处理。
