# 音色检索与试听 — 计划（261010）

## 1. 目标

把"从 25 条硬编码预设的下拉里挑"升级为"**在 Fish Audio 公共音色库里检索、试听、选用**"，
覆盖三处使用点（⚙ 面板角色音色、⚙ 面板玩家音色、系统设置里的全局默认音色与玩家音色）。

**音色库是唯一入口**：原语言下拉 + 预设下拉整条移除，也不再有"精选"分区——首屏就是公共库的热门窗口。
`VOICE_PRESETS` 退化为 `DEFAULT_CONFIG.voiceId` 的数据源与 README 预设表（不再发给客户端）。

## 2. 用户路径

### 路径 A：切一个音色
打开 Live2D 视图 → ⚙ → 「角色音色」行点「选择音色…」→ 音色库打开，从热门窗口（或搜索/筛选结果）里点「选用」→ 即选即生效。

### 路径 B：检索 + 试听新音色
1. ⚙ → 「角色音色」→ 点当前音色行 → 全屏音色库打开（默认拉热门窗口第 1 页，1.2~3.9s，期间显示加载态）。
2. 输入关键词（如「雷姆」）→ 350ms 防抖 → 宿主发 Fish **全库标题搜索** → 列表刷新（实测 0.6s / 13 条）。
3. 点语言 chip（全部/中文/日语/英语/韩语）或标签 chip（动漫/角色/女声/男声/旁白/讲故事）→ 拉对应窗口第 1 页。
4. 每行「▶ 试听」：**优先放作者预渲染样本**（签名 mp3，零配额、点了就响）；无样本才现合成 WAV。
   播放中按钮变「播放中…」，点别的行会停掉上一段。
5. 点「选用」→ 写 `voiceId`（与原来同一条保存链路）→ 面板关闭 → ⚙ 行与设置页显示该音色标题。
6. 列表底部「显示更多（还有 N 条）」→ 拉下一页 100 条追加（不重排已有内容）。
7. ✕ / Esc / 点遮罩关闭，不改变配置。

### 路径 C：手填 voiceId（保留）
现有「自定义 32 位 id」能力不变；输入后面板按 id 解析出真实标题显示（不再是 `6c777b9c…`）。

## 3. 架构

```
浏览器                        宿主（容器内）                              Fish
──────────────────────────────────────────────────────────────────────────────────
VoiceLibrary ──GET /live2d-voice/voices?q=&language=&tag=&page=N&refresh=1──▶ VoiceCatalogService
             ◀── {entries,total,page,hasMore} ─────────────────────────────  │ 每页缓存 12h/48 条
             ──GET /live2d-voice/voices/<32hex> ──────────────────────────▶  │ 在途去重
             ◀── {entry} ─────────────────────────────────────────────────     │
             ──POST /live2d-voice/voice-preview {voiceId} ────────────────▶  ├ 有样本→拉 R2 mp3 原样回
             ◀── audio/mpeg | audio/wav ──────────────────────────────────    └ 无样本→合成 PCM→WAV
```

### 3.1 宿主新增 `src/voice-catalog.ts`（~200 行）

自包含（插件没有多包结构，不新增依赖），移植参考实现的查询语义，**改为按页取 + 砍掉磁盘快照**：

- 常量：`VOICE_PAGE_SIZE = 100`、`VOICE_CACHE_TTL_MS = 12h`、`VOICE_PAGE_CACHE_LIMIT = 48`、`TIMEOUT_MS = 30s`。
- `voiceQuerySuffix(query)`：`language`（转小写）/ `tag`（原样透传、去重排序）/ `title`（转小写），值全部 `encodeURIComponent`。
- `fetchVoicePage(fetcher, suffix, page)`：`/model?page_size=100&page_number=<page>&self=false&sort_by=score<suffix>`
  → `{entries, total}`；**保持上游 score 顺序**（本地按 likes 重排会打乱分页边界）。
- `toVoiceEntry(raw)`：`_id` 必须 `^[0-9a-f]{32}$` 且 `state === "trained"`，否则丢弃；`likes`←`like_count`、`cover`←`cover_image`。
- `readVoiceSample(raw)`：`samples[0].audio`（签名 URL）+ 官方 `default_text` 优先、其次 `samples[0].text` + `languages`。
- `class VoiceCatalogService`：
  - `list(query, page, refresh=false)` → `{entries, total, page, hasMore}`；按 `suffix|page` 缓存（12h、48 条、在途 Promise 复用）。
  - `resolve(id)` → `GET /model/<id>` → `VoiceEntry`；非法或未训练抛错。
  - `sample(id)` → `GET /model/<id>` → `VoiceSample`（先校验训练状态，不存在如实报错）。
  - 出网：`resolveKeys(getConfig())` 多 key 轮询（401/402/429 换下一把，5xx 直接抛）+ 全局 `fetch`
    （`NODE_USE_ENV_PROXY=1`，与 `tts.ts` 同一条代理路）。
  - 不落盘、不做失败静默期：宿主重启后首次查询重抓一次；失败如实回 502。

### 3.2 宿主新增 `src/wav.ts`（~20 行）

`pcmToWav(pcm: Buffer, sampleRate: number): Buffer` —— 44 字节 RIFF 头 + PCM。
插件 TTS 只产出裸 PCM，浏览器播放需要容器格式。

### 3.3 `src/routes.ts`

`RouteDeps` 增加 `voiceCatalog: VoiceCatalogService`，注册一条前缀路由 + 一条精确路由：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/live2d-voice/voices` | 分页窗口查询：`language` / `tag`（可重复） / `q` / `page` / `refresh=1`。校验：语言 `/^[a-z]{2}(-[a-z]{2})?$/i`、标签 ≤4 个且每个 ≤40 字符、关键词 ≤60 字符、`page` 1..10。回 `{entries,total,page,hasMore}`；上游失败 502 `{code:"voice_catalog_failed",message}` |
| GET | `/live2d-voice/voices/<32hex>` | 单条解析，回 `{entry}`；非法 id 400，不存在/未训练 404 |
| POST | `/live2d-voice/voice-preview` | body `{voiceId}`。有作者样本 → 拉签名 URL 字节，透传上游 `content-type`（`audio/mpeg`）；无样本 → `synthesize()` 收 PCM → `pcmToWav` → `audio/wav`。失败 502 |

前缀路由按后缀分流（与 `models` 前缀同款）。预览文案 = `sample.text || PREVIEW_TEXT[语言] || 英语兜底`；
预览用当前 `ttsModel` 与 key 池，**不走** `speech.ts` 那条会按剧目语言翻译的链路。

### 3.4 `src/config.ts`

- `VOICE_PRESETS` 保留，但**只作为 `DEFAULT_CONFIG.voiceId` 的数据源与 README 预设表**，不再进 HTTP 回包；
  `VOICE_LANGUAGES` 删除（改用下面的库语言表）。
- `GET /live2d-voice/config` 回包去掉 `presets` 与 `voiceLanguages`（客户端已无消费方）。
- 新增 `VOICE_LIBRARY_LANGUAGES`（全部/中文/日语/英语/韩语）与 `VOICE_LIBRARY_TAGS`
  （动漫 `anime`、角色 `character-voice`、女声 `female`、男声 `male`、旁白 `narration`、讲故事 `storytelling`；标签原样透传、大小写敏感）。
- 新增 `PREVIEW_TEXT: Record<string,string>`（ja/zh/en 三句试听文案 + 兜底）。

### 3.5 客户端 `src/client/voice-library.tsx`（新增，~260 行）

`createPortal` 到 `document.body` 的全屏浮层（`z-index: 2147483100`，压过 `.lv-fullscreen` 的 2147483000）：

- 顶栏：搜索框（autoFocus）+ 语言 chips + 标签 chips + 「重新抓取」+ 计数（`共 N 条 / 已显示 M`）+ 关闭 ✕。
- 列表：紧凑行（封面缩略图 → 加载失败/无封面时回落首字头像 + 标题 + 描述 2 行截断 + 语言/♥收藏数 + 「▶ 试听」「选用」）；
  当前音色行标「当前」。
- 本地分页：每页 100 条直接渲染（移动端可滚动，不额外裁剪）；「显示更多」拉下一页追加。
- 交互：Esc / 遮罩关闭；试听互斥（切换时停上一段并 `revokeObjectURL`）；请求竞态用递增序号丢弃过期回包。
- 响应式：窄屏（<600px）整屏、行更紧凑；宽屏居中卡片式。

### 3.6 客户端 `src/client/selectors.tsx`

`VoicePresetSelector` 简化为「当前音色行」：

- 展示：`音色` 标签 + 当前音色标题（模块级 `Map<voiceId,title>` 缓存，未知 id 懒调 `resolveVoice()`，
  失败回落 `自定义 (xxxxxxxx…)`）+ 「选择音色…」按钮 → 打开 `VoiceLibrary`。
- 对外 props：`value` / `onChange(preset)` / `allowEmpty` / `emptyLabel` / `disabled` / `layout`；
  删掉 `presets` / `voiceLanguages` / `currentLang` / `onLangChange`（父组件同步清理）。
- 保留 `allowEmpty`（玩家音色「无独立音色」）与 `disabled`。

### 3.7 客户端其他

- `api.ts`：`fetchVoices(query, page, refresh?)`、`resolveVoice(id)`、`previewVoice(voiceId): Promise<string>`（返回 objectURL）。
- `types.ts`：`VoiceEntry`、`VoiceWindow`、`VoiceQuery`；`VoicePreset` 保留。
- `styles.ts`：音色库样式（沿用现有 CSS 变量与 `lv-` 前缀；**模板字符串里不能出现反引号**）。
- `build.mjs`：client `external` 补裸 `"react-dom"`（现有 `"react-dom/*"` 不覆盖裸导入，否则整个 react-dom 会被打进 bundle）。
- 封面图直连 `https://public-platform.r2.fish.audio/<cover_image>`；若浏览器 CSP 拦掉外链图，再补一条宿主封面代理
  （实施时先在真机确认，不预先加）。

## 4. 验证

| 层 | 内容 |
| --- | --- |
| 静态 | `npm run typecheck` + `npm run build` |
| e2e（无真实 API） | 新增 `e2e/verify-voice-library.mjs`，注册进 `settings` 模块：`page.route()` 拦 `/live2d-voice/voices*` 与 `voice-preview` 回放夹具 → 打开设置页 → 点音色行 → 断言浮层渲染、首屏热门行渲染、搜索触发带 `q=` 的请求、点「选用」后配置 `voiceId` 变化、点「试听」发出 POST 且调用播放 |
| 真实 API（单点，用户要求才跑） | `GET /live2d-voice/voices?q=雷姆`、`?language=ja`、`?page=2`，`POST /live2d-voice/voice-preview`（样本路径 + 合成路径各一次） |
| 实机 | 用户 4180 验收（需重启 dsh 生效） |

## 5. 交付与风险

- **开发形态**：按仓库惯例在 worktree 里开发（`worktree-dev`），合并回 main 后按 `commit-own-changes` 精确提交。
- **生效方式**：宿主 `lib/index.js` 改动需重启 dsh（走 `restart-dsh`，**重启线上前先征求用户书面同意**）；
  先在 :4188 e2e 实例验证新 lib 被加载。
- **风险 1**：免费档上游首页 1.2~3.9s → 宿主 12h 页缓存 + 客户端本地翻页；首屏期间显示加载态（用户已否决「精选分区」占位方案）。
- **风险 2**：样本签名 URL 1 小时过期 → 只在试听当下现取现用，不落盘、不缓存 URL。
- **风险 3**：`.lv-stage` 的 transform 会劫持 `position: fixed` → 浮层必须 `createPortal` 到 `document.body`。
- **风险 4**：`styles.ts` 是模板字符串 → 注释与样式里一律不用反引号（历史踩坑）。
- **风险 5**：丢预设下拉是行为变更 → README 与设置页帮助文字同步改写。
## 6. 不做（本期范围外）

- 音色收藏 / 自建常用列表（精选分区暂代）。
- 上传自定义音色、音色克隆。
- 音色库结果落盘缓存（宿主重启重抓一次是可接受代价）。
- 试听音频落盘缓存（样本字节可缓存，本期不做）。
