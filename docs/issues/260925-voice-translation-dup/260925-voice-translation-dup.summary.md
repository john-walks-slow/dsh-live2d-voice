# voice-translation-dup 工作总结

## 背景

dsh-live2d-voice 插件用户报告三个 bug：

1. **翻译缺尾/堆首行**：整段翻译经常"一句话有翻译后面没有翻译"或很慢；"翻译会被填充到第一句字幕而不是后面，稳定复现"。
2. **流式语音双发**：流式 ASR 模式下"说一句话会被发送出去两回"，消息历史出现两轮。
3. **独立页字幕双显**：非流式无双发但"用户字幕也会被重复显示两遍（消息历史只有一个）"。

## 根因

| Bug | 根因 |
| --- | --- |
| 翻译缺尾/堆首 | `speech.ts speak()` 流结束时同步 `lines.slice()` 快照，但 `lines.push` 在 `speakSentence` 内（串行 TTS 队列，微任务才执行）→ 尾句/积压句永远不进翻译输入；`translateWhole` 按句序 index 对齐，翻译句数 < 行数时后面行全空、短翻译全堆第一行。 |
| 流式双发 | `view.tsx onSegment` 无 asrMode 守卫——流式模式下 `mic.ts emitSegment` 仍触发 buffered 路径（/asr/recognize HTTP + submit），与 asr-final 提交并存 → 每句话提交两次。 |
| 独立页双字幕 | standalone `submitPrompt` 走 POST /message（routes.ts emit SSE user subtitle 回声），`view.tsx` viaClient 分支又本地 pushSubtitle → 同一行显示两遍。 |

## 修复

- **src/speech.ts**：`handleSentence` 统一在流时间做完整 tag 清洗（emotion+motion，两模式统一）+ 同步 push lines；`speakSentence` 瘦身为纯 TTS+字幕（签名去掉 vocabulary/raw/lines）；`translateOnce` 加 20s 超时（`TRANSLATE_TIMEOUT_MS`，capped AbortController）；`translateWhole` 改用 `splitByWeight`。
- **src/sentence.ts**：新增 `splitByWeight(translated, weights)` 按原行字符权重比例切分翻译，±12 字符内吸附标点（`CUT_BOUNDARIES`）。
- **src/client/view.tsx**：`onSegment` 加 `if (asrModeRef.current === "stream") return;`；`SubmitPrompt` 返回类型加 `remoteEcho?: boolean`，viaClient 分支 `if (!result.remoteEcho) pushSubtitle("user", text)`。
- **src/client/standalone.tsx**：`submitPrompt` 返回 `{ ok: true, remoteEcho: true }`。
- **tests/translation-split.test.mjs**（新增）：8 用例覆盖 splitByWeight。全过。
- **e2e/verify-nodup.mjs**（重写强化）：三组回归断言（R1 流式零双发 / R2 单次提交 / R3 独立页单卡）；计数器改用 React fiber 读 SubtitleOverlay lines[] props。10/10 全过。

## 验证

- 单元测试：8/8（`node --test tests/translation-split.test.mjs`）。
- typecheck：clean（`npx tsc --noEmit`）。
- e2e（:4188 隔离实例）：10/10（D0a–D2c）。
- 代码检视：条件准入，无阻塞（报告见同目录 `.review.md`）。
- 用户验证：待用户在真机重启 4180 后按 `.validation.md` 验证。

## 已知取舍 / 待跟进

- **N1**：sentence 模式 emotion 发射从 TTS 时间提前到流时间（与块模式一致）。TTS 积压时表情领先语音——已声明取舍，utteranceId 门控防跨轮泄漏。
- **N2**：20s 翻译超时 ≈ 字幕 TTL 21s。极慢翻译（会话模型为 reasoner 时）可能赶不上目标字幕行。后续可收紧超时或为翻译配专用快速模型。
- **N3**：超时生效依赖 provider adapter 把 signal 接进 fetch——dsh-llm 框架层已确认接线（`adapterStream` 传 `options.signal` 到 `prepareCall` + `forAdapter`），具体 provider 需真机掐流确认一次。
- **N4**：测试缺口——流时间快照完整性无直接单测（靠代码结构保证）；standalone 流式说话路径未覆盖。回归风险低。
- **N5**：SSE 断连重连窗口内提交会丢该行字幕显示（与系统整体 SSE 依赖一致，备忘）。
