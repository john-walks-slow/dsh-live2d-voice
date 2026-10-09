# 音色库（检索 + 试听）— 总结（261010）

## 需求

用户原话：「语音应该支持检索、试听 fishapi 的语音而不是只支持这么少的列表（可参考 stage-ai 项目的实现）」。

对齐后的取舍：**音色库成为唯一入口**（删掉 25 条硬编码预设的语言/音色下拉，也不设"精选"分区）；
**试听优先放作者预渲染样本**，没有样本才现场合成。

## 最终形态

| 层 | 内容 |
| --- | --- |
| `src/voice-catalog.ts` | Fish 公共库客户端：按查询窗口分页（`page_size=100` + `language`/`tag`/`title`，保持上游 score 序）、条目校验（32 位 hex + `state==="trained"`）、按「查询+页码」内存缓存 12h（上限 48、在途去重）、`resolve(id)`（先查本地精选表再打上游）、`sample(id)`（作者样本 + 官方示例文本）、多 key 轮询 + 30s 超时 + 全局 fetch 代理 |
| `src/wav.ts` | 裸 PCM → 44 字节 RIFF/WAVE（TTS 只产 PCM，`<audio>` 播放需要容器） |
| `src/routes.ts` | `GET /live2d-voice/voices`（分页查询 + `<32hex>` 单条解析）、`POST /live2d-voice/voice-preview`（有样本透传 mp3，否则合成 PCM→WAV）；`GET /config` 回包去掉 `presets`/`voiceLanguages` |
| `src/client/voice-library.tsx` | 全屏音色库浮层（portal 到 `document.body`）：350ms 防抖搜索、语言/标签 chips、每页 100 条 + 「显示更多」、试听互斥 + objectURL 回收、Esc/遮罩关闭、请求序号丢弃过期回包、封面失败回落首字头像 |
| `src/client/selectors.tsx` | `VoicePresetSelector` → 「当前音色行 + 音色库入口」；id→标题模块级缓存，目录外 id 懒解析、失败回落短 id |

与参考实现（stage-ai）的三处差异，都是有意的：

1. **搜索发到上游**而不是在本地热门 1000 条里过滤——Fish 免费档对每个查询各开一个 1000 条窗口，全局热门榜里日语只有一小片，「雷姆」这类榜外音色本地过滤根本看不到。实测搜索结果 13 条 / 0.6s。
2. **不落盘快照**：插件没有独立媒体目录，宿主重启后重抓一页（1~4s）比多维护一个文件划算。
3. **按页取**而不是整窗取：整窗 10 页并发要 3~6.5s，单页 1.2~3.9s，首屏体验差别明显；客户端用「本地翻页 + 显示更多」消化。

## 实施中值得记录的点

- **`https://api.fish.audio` 与 `/model` 拼接写重了一次**（`base + "/model"` → `/model/model`），因为浏览器 e2e 全程拦截了这两条路由，夹具测试完全测不出来——是真实 API 单点验证（curl 打活实例）抓到的。**夹具越完整，越需要一个真打上游的单点**。
- **portal 出去的浮层拿不到 `.lv-root` 上的设计令牌**：`--lv-*` 定义在 `.lv-root`，浮层 portal 到 body 后不在该子树内。做法是把令牌层拆成 `.lv-root, .lv-vlib-scope` 共享，布局属性留在 `.lv-root`（顺带必须 portal：`.lv-stage` 带 CSS transform，`position: fixed` 留在子树里会被劫持）。
- **client bundle 的 `react-dom` 必须是裸 external**：原 `external: ["react-dom/*"]` 不覆盖裸导入，`createPortal` 会把整个 react-dom 打进 bundle（bundle 只涨 11KB 即为正确信号）。
- **精选音色走本地解析**：默认 `voiceId` 是内置精选（如 rem），若每次都打上游解析，e2e/无 key 环境会 404 并刷控制台错误；本地表直接给出中文名（「温柔女仆 · 雷姆」比上游的 "Rem" 更好读），也顺手让 `verify-settings-model` 回到全绿。
- **e2e 冷实例的两个坑**：设置面板导航格异步渲染（固定 sleep 会假红，改 `waitForFunction` 轮询）；全新 e2e home 首启有 "Add an API key to get started" 引导弹窗，其遮罩会拦截 Playwright 真实点击（套件开头按文本点掉）。

## 验证

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm run build` | ✅ |
| `e2e/verify-voice-library.mjs`（17 项，宿主音色路由全夹具拦截，**在 `dsh-e2e wipe` 后的冷实例上**） | ✅ 17/17 |
| `e2e/verify-settings-model.mjs`（同模块回归，冷实例） | ✅ |
| 真实 Fish API 单点（e2e 实例临时配 key，事后清理） | ✅ `?q=雷姆` 13 条 / 0.6s；`?language=ja&page=2` 100 条 / total 1000；缓存命中 24ms；`voices/<id>` 返回本地精选标题；坏语言/坏 id → 400；`voice-preview` 样本路径 `audio/mpeg` 289KB、合成路径 `audio/wav` 44.1kHz 16bit |
| 预存在失败（非本需求引入，已确认成因） | `boot` 模块三套件全挂于 `e2e/lib/boot.mjs` 硬编码 `session.v3.jsonl.zstd`（harness 写 v4）；`verify-style-claim` 的 "both rebuilt frames observed" 依赖最小 profile 里不存在的 dsh-token-game；`verify-settings-model` 偶发假红（等 3000ms 后一次性取卡片标题，⑤⑥⑦ 依赖模型目录异步返回，慢一拍就漏卡；重跑即绿，与 S-01 同类竞态、属既有套件，本次未动） |

## 检视与处理

检视结论 **准入**（无阻塞），三条建议全部采纳：

- **S-01** e2e 导航竞态 → 改 `waitForFunction` 轮询 + 套件开头关掉 onboarding 弹窗；`dsh-e2e wipe` 后冷启动 17/17。
- **S-02** `fetchJson` 注释与行为不符（5xx 其实也会换 key）→ 统一为「任何非 2xx 都换下一把 key，全失败抛最后一个错误」，注释与行为一致。
- **S-03** 试听请求回来时组件已卸载 → 加 `aliveRef`，卸载后回收 objectURL 并放弃播放。

未采纳的非阻塞项（记录备查）：单条解析把上游失败也映射成 404（客户端有短 id 回落，影响可忽略）、样本响应 content-type 未做 `audio/*` 白名单、封面直连 R2 CDN（实拍已证明不被 CSP 拦）。

## 遗留

- `boot` 模块的 v3/v4 会话文件名问题属既有 e2e 债务（另有人在推进 e2e 现代化），本次未动。
- `scripts/init-worktree.sh` 主分支上遗留的冲突标记（`<<<<<<<`）顺手清掉了——该脚本否则无法执行。
