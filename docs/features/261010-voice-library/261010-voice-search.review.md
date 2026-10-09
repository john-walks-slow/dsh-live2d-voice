# 检视报告 — 音色检索与试听（261010-voice-library）

## 概要

本次改动把「25 条硬编码预设下拉」替换为「直连 Fish Audio 公共音色库的检索 / 试听 / 选用」入口，新增宿主侧 `voice-catalog.ts`（分页窗口抓取 + 12h 页缓存 + 多 key 轮询）、`wav.ts`（PCM→RIFF）、两条路由（列表/单条 + 试听），客户端新增 `voice-library.tsx` 全屏浮层（portal 到 body），并把 `VoicePresetSelector` 简化为「当前音色行 + 音色库入口」。

整体设计自洽：免费档「每查询一个 1000 条窗口、条件必须发到上游」这一关键语义被正确移植且注释充分；缓存/在途去重/签名 URL 不落盘、试听优先作者样本、portal 绕开 stage transform、设计令牌拆 `.lv-vlib-scope` 等坑均有对应实现与文档记录。**未发现阻塞问题**，产品功能经实测可用。

我在检视中独立复核了构建、e2e 与路由契约，并发现两处需要跟进的小问题（e2e 导航竞态、5xx 换 key 的注释与行为不符），详见下节。

## 需求对齐

| 需求 | 落实 |
| --- | --- |
| 支持检索 Fish 公共音色库 | ✅ `GET /live2d-voice/voices?q=&language=&tag=&page=`，搜索发到上游全库标题检索（非本地过滤），比参考实现更准 |
| 支持试听 | ✅ `POST /live2d-voice/voice-preview`：有作者样本透传 mp3，无样本合成 PCM→WAV |
| 去掉 25 条预设语言/音色下拉，音色库唯一入口 | ✅ `VOICE_LANGUAGES` 删除、config 回包去掉 `presets`/`voiceLanguages`、`hud`/`settings-section`/`view` 接线全部清理；`VOICE_PRESETS` 退化为默认值与 README 表 |
| 试听优先作者预渲染样本 | ✅ `sample()` → `voicePreview()` 先取 `samples[0].audio`，无样本才 `synthesize()` |

三处使用点（⚙ 角色音色 / ⚙ 玩家音色 / 系统设置全局默认与玩家音色）共用同一个 `VoicePresetSelector` → 同一个音色库，路径一致。

## 独立验证记录

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | ✅ 通过（无 unused / 类型错误） |
| `npm run build` | ✅ 通过。**注意**：检视开始时 `lib/client.js`、`lib/standalone.js` 落后于 `src/client/styles.ts` 最后一次编辑（窄屏 `.lv-vlib-actions` 横排规则未进包）；已重新构建，现产物与源码一致 |
| `node e2e/verify-voice-library.mjs`（dsh-e2e，夹具零真实 API） | ✅ 17/17 通过（见 S-01：冷实例首次运行会因导航竞态假红） |
| `node e2e/verify-settings-model.mjs` | ✅ 通过（同模块回归） |
| 路由契约（对活 e2e 实例 curl） | `voices/<非hex>`→400 `bad_voice_id`；`language=z/123/zh-cn-extra`→400 `bad_language`；`q`≥61→400 `bad_query`；5 个 tag→400 `bad_tags`；非 POST `voice-preview`→405；`GET /config` 仅回 `config`+`languages`（已无 presets/voiceLanguages） |
| WAV 头自检 | ✅ 44 字节头字段正确：mono / 44100 / byteRate 88200 / blockAlign 2 / 16bit / dataLen 正确 |
| bundle external 自检 | ✅ `lib/client.js` 中裸 `require("react-dom")` 恰好 1 处、无打包进去的 ReactDOM；`standalone.js` 按设计全内联 |
| 视觉证据 | ✅ `docs/features/261010-voice-library/shots/` 三张实拍图为真实 Fish 数据（搜「雷姆」13 条、封面图直连 R2 正常加载、语言标签与 ♥ 计数渲染正确） |

## 阻塞问题

无

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| — | — | — | — |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S-01 | [e2e/verify-voice-library.mjs:89-108](e2e/verify-voice-library.mjs#L89-L108)、[:116](e2e/verify-voice-library.mjs#L116) | **e2e 导航存在竞态，冷实例首跑会假红。** 点击 Settings 后固定 `waitForTimeout(1200)`，再用 `page.evaluate` 一次性查找并点击「Live2D 角色与语音」；设置面板的导航格是异步渲染的，1200ms 内没出现时点击静默落空，后续 `waitForSelector('.lv-voice-current', 15s)` 必然超时 → `V0 设置页未渲染音色行`。我在重启后的实例上复现 3 次失败；改成「轮询导航格出现（`waitForFunction`，≤20s）后再点」的等价探针立即稳定通过，同一实例上原套件也在环境变热后跑到 17/17（即失败是时序/环境相关，不是产品缺陷）。另外在全新 e2e home 上，首启的 Preview Notice / API key 引导弹窗会拦截 Playwright 真实点击（L116 的 `.lv-voice-current` click）。 | 导航改为 `waitForFunction`/`waitForSelector` 轮询后再点，不使用固定 sleep；并在套件开头显式关掉引导弹窗（点 Continue 直到无 `[role=dialog]`），或在 e2e 播种里把 onboarding 标为已读。这属于测试健壮性，建议合并前修掉，避免后续 agent/CI 把它当真实回归。 |
| S-02 | [src/voice-catalog.ts:287-310](src/voice-catalog.ts#L287-L310) | `fetchJson` 注释写「5xx fails outright（换 key 无解）」，但 `if (response.status >= 500) throw` 位于 `try` 内，会被同一个 `catch` 捕获并 `continue` 到下一把 key——实际行为与注释相反（参考实现 stage-ai 同样如此，是原样移植的缺陷）。功能上无大碍（最终仍失败，只是多打 N-1 次上游），但注释误导后续维护者。 | 二选一：把 `!response.ok` 分支移到 `try` 之外（或在 `catch` 里对 5xx 直接 `throw`），让行为与注释一致；或直接改注释说明「所有非 2xx 都换 key」。 |
| S-03 | [src/client/voice-library.tsx:139-162](src/client/voice-library.tsx#L139-L162) | 试听期间若组件卸载（关闭浮层），`stopAudio` 的清理先执行、`previewVoice` 的 await 后返回，随后仍会 `urlRef.current = url` 并 `new Audio(url).play()` —— 已经卸载的组件留下一个无法回收的 objectURL 与可能继续播放的音频。 | 加一个 `alive` ref（或 spawn 序号），在 await 之后、赋值/播放之前检查；若已卸载则 `URL.revokeObjectURL(url)` 并直接返回。概率低但属真实泄漏。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N-01 | [src/client/selectors.tsx:155-160](src/client/selectors.tsx#L155-L160) | 计划 §3.6 要求保留 `allowEmpty`/`emptyLabel`，实现把它们删了。核实 HEAD：`allowEmpty` 只被 `Live2DModelSelector`（玩家**模型**）使用，`VoicePresetSelector` 的两个调用点从未传过，故**无功能回归**；仅计划文本与实现不一致。 | 无需改代码；计划文档措辞可略过。 |
| N-02 | [src/routes.ts:451](src/routes.ts#L451) | 单条解析路由把**所有** `resolve()` 失败（含上游网络/5xx）都映射为 404 `voice_not_found`，而列表路由同类失败是 502。语义上略失真。 | 客户端已有短 id 回落，影响很小；如要严谨可在 service 层区分「未找到」与「上游失败」。 |
| N-03 | [src/routes.ts:95-99](src/routes.ts#L95-L99) | 样本路径直接把上游 `content-type` 透传，未校验是否 `audio/*`。 | 实际 Fish 返回 `audio/mpeg`，无碍；可选加一层白名单。 |
| N-04 | 计划 §3.4 / 实现分布 | 计划把 `VOICE_LIBRARY_LANGUAGES`/`VOICE_LIBRARY_TAGS`/`PREVIEW_TEXT` 放在 `config.ts`；实现分别落在客户端常量与 `voice-catalog.ts`。 | 就近放置反而更合理（只保留被消费的一份），属正向偏差，无需统一。 |
| N-05 | [docs/.../261010-voice-search.plan.md:131](docs/features/261010-voice-library/261010-voice-search.plan.md#L131) | 计划「风险 1」仍写「精选分区顶住空窗」，但 §1 已明确取消精选分区。 | 计划是历史文档，可在后续 summary 里以一句更正；不影响代码。 |
| N-06 | [src/client/voice-library.tsx:18](src/client/voice-library.tsx#L18)、[src/client/selectors.tsx:153](src/client/selectors.tsx#L153) | 封面图由浏览器直连 `public-platform.r2.fish.audio`；`voiceTitles` 模块级缓存永不失效（上游改名需刷新页面）。 | 封面上游 CSP 风险已在实拍图中证伪（图正常加载）；缓存问题可忽略。 |
| N-07 | `lib/standalone.js` | standalone 入口按设计全内联，本次因 `voice-library` 被 `view/hud` 引用而把音色库与 react-dom 一并打进 standalone，体积增加。 | 独立页自包含是既定设计，可接受；无动作。 |
| N-08 | [src/client/settings-section.tsx:485-497](src/client/settings-section.tsx#L485-L497) | 设置页帮助文字从「id + 中文预设名」变为只显示原始 id。 | 上方音色行已显示解析出的标题，信息未丢失；无动作。 |

## 准入结论

**结论**：`准入`

**说明**：需求全部落实，三处使用点统一为「音色库」唯一入口；宿主缓存/在途去重、非法输入校验（id/语言/关键词/标签）、试听样本优先、PCM→WAV 封装均经实测或逐字段核对无误；`typecheck`/`build`/`e2e`（17/17）通过，真实 Fish 数据的检索与试听路径有实拍证据。无阻塞问题。

合并前建议顺手处理 S-01（e2e 导航竞态）与 S-02（5xx 注释/行为不符）——两者都是几行改动，前者能消除后续 agent/CI 的假红噪音。S-03 可选。

> 备注（检视副作用）：原始 e2e 实例（pid 5417 / :26144）期间被重启并交由 `dsh-e2e` 托管，当前端口 **28479**（`dsh-e2e status` 可查）；`lib/*.js` 已被重新构建以对齐 `styles.ts` 最新编辑。
