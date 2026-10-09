# 音色检索与试听 — 调研（261010）

## 1. 用户诉求

当前语音只能从 `src/config.ts` 里硬编码的 25 条 `VOICE_PRESETS` 里选（HUD ⚙ 与系统设置两处），
用户要求：**支持检索 Fish Audio 公共音色库并试听**，参考 `stage-ai` 项目的实现。

## 2. 参考实现：stage-ai

### 2.1 后端

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/voice/catalog.ts` | 与宿主无关的公共库客户端：窗口抓取（`fetchVoiceWindow`）、条件拼参（`voiceQuerySuffix`）、条目解析（`toVoiceEntry`）、窗口缓存（`VoiceClient`，12h / 16 窗 / 在途去重）、样本读取（`readVoiceSample`） |
| `apps/server/src/voiceCatalog.ts` | 服务端独有三层：磁盘快照（12h，失败静默 5min + stale 回落）、试听样本、出网口（多 key 轮询 + ProxyAgent + 30s 超时） |
| `apps/server/src/playhouse.ts` → `ttsPreview()` | 试听优先级：**作者预渲染样本**（签名 URL，零配额、点了就响）→ 无样本才用 `default_text` 合成 → 再兜底按语言写死的试听文案 |
| `apps/server/src/http.ts` | `GET /api/voices?language=&tag=&q=&refresh=1`（窗口查询，校验语言码 / ≤4 标签 / ≤40 字符标签 / ≤60 字符关键词）、`GET /api/voices/:id`（单条解析）、`POST /api/plays/:id/tts-preview`（返回可播放 URL） |

**免费档窗口语义（关键）**：Fish 对每个查询各开放一个 1000 条窗口（`total` 恒为 1000），
全局热门、`language=ja`、`tag=anime`、`title=雷姆` 各自是不同窗口。因此条件筛选**必须发到上游**，
不能在本地目录里做。`page_size=100 × 最多 10 页`；标题搜索通常只有一两页，先探第一页再补齐更快。

### 2.2 前端

| 位置 | 职责 |
| --- | --- |
| `apps/web/src/voice/VoiceLibrary.tsx` | 全屏面板：搜索框（本地匹配 title/description/tags）+ 语言下拉（带条数）+ 卡片网格（封面/名称/描述/语言/收藏数）+ 每卡「试听」「选用」，一次渲染 60 张，`显示更多` 翻页 |
| `apps/web/src/voice/useVoiceCatalog.ts` | 目录懒加载 + 目录外 voiceId 的按 id 解析（`nameOf` 回落短 id，不假装「未设置」） |

**参考实现的局限**：`VoiceLibrary` 只在**全局热门 1000 条**里做本地过滤（`q` 参数只有 agent 工具在用），
所以"雷姆"这类热门榜外的音色在 UI 里搜不到。本插件要做得更好：**搜索框直接走宿主窗口查询**（Fish 全库标题搜索）。

## 3. 现状（dsh-live2d-voice）

- `src/config.ts`：`VOICE_PRESETS`（25 条硬编码）+ `VOICE_LANGUAGES`（all/zh/ja/en）。
- `GET /live2d-voice/config` 回包带上 `presets` 与 `voiceLanguages`。
- `src/client/selectors.tsx` → `VoicePresetSelector`：语言 `<select>` + 音色 `<select>`（当前值不在预设里时显示"自定义音色 (xxxxxxxx…)"）。
- 使用点 3 处：`settings-section.tsx` 全局默认音色、`settings-section.tsx` 玩家音色、`hud.tsx` ⚙ 面板（角色音色 + 玩家音色）。
- `src/tts.ts`：`synthesize()` 用 `/v1/tts` 流式拉 PCM，多 key 轮询；代理走 `NODE_USE_ENV_PROXY` 的全局 fetch。
- 密钥：`apiKeyFile`（`/root/.config/fish-audio/keys.json`，3 把）+ `resolveApiKeys(config)`。

## 4. 实测证据（261010，本机容器内）

代理与密钥可用，直接探测 `https://api.fish.audio`：

| 请求 | 结果 |
| --- | --- |
| `GET /model?page_size=5&page_number=1&self=false&sort_by=score` | 200，`total=1000`，3.3s |
| `GET /model?...&language=ja` | 200，`total=1000`，100 条/页，1.6s |
| `GET /model?...&tag=anime` | 200，`total=1000`，1.4s |
| `GET /model?...&title=雷姆`（URL 编码） | 200，`total=13`，0.7s |
| `GET /model/0c7771ca…`（雷姆） | 200，`samples[0].audio` = R2 签名地址 |
| 直接拉该样本地址 | 200，`content-type: audio/mpeg`，289KB |

条目关键字段：`_id`(32 hex) / `title` / `description` / `languages[]` / `tags[]` / `like_count` /
`cover_image`(相对路径，CDN 前缀 `https://public-platform.r2.fish.audio/`) / `state`(必须 `trained`) /
`default_text` / `samples[{audio,text}]`。

## 5. 结论

1. Fish 的窗口查询足够支撑"搜索 + 语言/标签筛选"，且比参考实现的全库本地过滤更准（能搜到热门榜外的音色）。
2. 试听优先用作者预渲染样本（零配额、mp3 直接可用）；无样本再合成，需 PCM→WAV 包装（插件现有 TTS 只产出裸 PCM）。
3. 插件没有独立媒体目录与磁盘快照需求：窗口缓存放内存（12h）即可，**不做磁盘快照**，省一层复杂度。
4. 客户端可用 `react-dom` 的 `createPortal`（已有第三方插件这样做，宿主 module loader 支持 `require("react-dom")`）；
   但 `build.mjs` 的 client `external` 目前只写了 `"react-dom/*"`，**不含裸 `react-dom`**，需补上。
5. 舞台 `.lv-stage` 带 CSS transform（拖拽/缩放），`position: fixed` 的浮层若渲染在其子树内会被 transform 劫持，
   因此音色库浮层必须 portal 到 `document.body`。
