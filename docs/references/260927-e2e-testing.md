# e2e 测试规范（dsh-live2d-voice）

日期：2026-09-27 ｜ 状态：生效 ｜ 本文档不隶属单个需求，是全仓库 e2e 实践的依据（创建规则见 /update-references）

## 铁律（用户 260927 裁决）

1. **真实 API 三问**。跑任何会烧真实 LLM/TTS/ASR 的套件前自问：用户显式要求了吗？该契约确实无法 mock 吗？烧几轮心里有数吗？三问不满足就不跑。
2. **session 复用/伪造，禁止烧轮拿 id**。需要 sessionId 时用 `e2e/lib/boot.mjs` 的复用路径（点已有会话行 / standalone `?session=`），不许发一条真实消息只为捕获 id。
3. **只跑相关业务**。一次改动只跑与其业务相关的套件；无关套件即使"顺手"也不跑。交付标准是 **L0 + L1 绿 + 改动业务的重套件绿**，不是"全仓库全绿"。
4. **攒批验证**。重套件的改动若当下无法验证（如本轮没跑该套件的预算），在提交信息与套件清单里标注验证时机，攒到下次必须跑时一起。

## 分层模型

| 层 | 内容 | 命令 | 时机 |
| --- | --- | --- | --- |
| L0 静态 | typecheck + build | `npm run typecheck && npm run build` | 每次改动后 |
| L1 light（零 API） | 断言不触发任何真实 LLM/TTS/ASR 调用 | `npm run e2e:light` | 默认验证层；随便跑 |
| L2 heavy（真实 API） | 至少一轮真实 LLM/TTS/ASR | `npm run e2e:heavy` 或单跑 | 仅铁律三问通过时 |

## 运行方式

```bash
# runner（分层清单的唯一权威定义在 e2e/run.mjs）
npm run e2e:light                 # 8 个零 API 套件
npm run e2e:heavy                  # 14 个真实 API 套件（默认别跑）
node e2e/run.mjs verify-boot       # 单跑指定套件

# 环境变量（由 `dsh-e2e run` 自动注入；裸跑时必带）
DSH_E2E_PORT=<端口>               # boot.mjs 组装 E2E_URL
DSH_E2E_HOME=<worktree>/.dsh-e2e-home   # boot.mjs 组装 E2E_SESSIONS；E2E_CFG 同理
# 旧三件套 E2E_URL/E2E_SESSIONS/E2E_CFG 仍可显式覆盖
```

实例管理（隔离 home、动态端口、槽位上限）见 **dsh-e2e** skill；端口一律走 **acquire-port**。

> 2026-09-27 起 worktree 模式下此警告已结构性消除：home 在 `<worktree>/.dsh-e2e-home`，profile `link:` 直接指向 worktree 本身，测的必然是 worktree 代码。

## boot 规范（e2e/lib/boot.mjs）

| 导出 | 用途 |
| --- | --- |
| `launch()` | 共享 headless chromium（swiftshader 参数统一） |
| `streamCollector(page)` | 从 `/live2d-voice/stream?session=<id>` attach 请求**确定性**捕获视图绑定的 session id |
| `latestSessionId(root?)` | 磁盘侧最近活跃会话 id（无浏览器、无 API） |
| `sessionLogPath(id, root?)` | id → 日志文件绝对路径（日志断言用） |
| `openSessionRow(page)` / `openLiveTab(page)` | GUI 侧零 API 打开已有会话 + 切 Live2D tab |
| `standaloneUrl(id)` | 独立入口 URL |
| `E2E_URL` / `E2E_SESSIONS` | 环境变量解析后的默认值 |

```js
// GUI 流程（零 API boot 的标准写法）
const browser = await launch();
const page = (await browser.newContext()).newPage();
const streams = streamCollector(page);
await page.goto(E2E_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
await openSessionRow(page);            // 点已有会话行，不发消息
await openLiveTab(page);
const sessionId = [...streams].at(-1); // attach 请求捕获的 id
```

关键事实（verify-boot.mjs 9 项守护）：

- 点会话行 + 挂 Live2D 视图**不触发任何 API**（守护套件断言复用会话的日志字节数全程不变）。
- **日志断言必须用捕获到的 id**，不是磁盘最新 id——实测侧边栏首行与磁盘最新可能不是同一会话。
- 捕获到的 id 应能用 `sessionLogPath` 落到磁盘文件（绑定校验）。

## 套件清单

### L1 light（零 API，`e2e:light`）

| 套件 | 检查数 | 说明 |
| --- | --- | --- |
| verify-boot | 9 | boot helper 守护（复用会话零 API、日志不增长、standalone 挂载） |
| verify-look-math | — | 纯 node 计算，无需实例 |
| verify-style-claim | — | 样式认领回归；⚠ 会改写共享 token-game bundle 触发 HMR（对同源所有实例生效，跑前知悉） |
| verify-settings-model | — | 设置页烟测 |
| verify-fullscreen-keyboard | 7 | 全屏/键盘 position 语义 |
| verify-fullscreen-usable | 5 | ⚠ **已知未决：F3 在隔离实例（worktree lib）确定性失败**（视觉纵横比 0.2552→0.2152），未对 main lib A/B、未归因；见下"未决项" |
| verify-keyboard-squish | 6 | IME 压扁诊断 |
| verify-standalone-fullscreen | 6 | 独立入口原生全屏 |

### L2 heavy（真实 API，仅显式/相关时）

| 套件 | 检查数 | boot 消耗 | 覆盖业务 |
| --- | --- | --- | --- |
| verify-live | 24 | 1 轮 | 语音模式全链路（SSE/字幕/打断） |
| verify-third-person | 35 | 1 轮 | 第三人称双角色管线 |
| verify-voice | 17 | 1 轮 + 探针 | 语音输入闭环（需测试 PCM） |
| verify-phase3 | 19 | 1 轮 + 探针 | 翻译/多模型/workspace |
| verify-stream | 13 | 1 轮 + 探针 | 流式 ASR 全链路 |
| verify-standalone | 12 | 1 轮 + 探针 | 独立入口（含冷会话恢复） |
| verify-nodup | 10 | 1 轮 + 探针 | 双视图防重复提交 |
| verify-translation-race | 10 | 1 轮 + 探针 | 字幕翻译竞态 |
| verify-inject | 8 | 1 轮 + 探针 | 提示词注入日志 |
| verify-unload-cleanup | 8 | 探针即业务 | 退出卸载清理 |
| verify-v11 | 15 | 1 轮 + 探针 | 全屏/视线/摄像头工具（C 段依赖 LLM 恰好调工具，天然不稳） |
| verify-look-sliders | 30 | 1 轮 | 视线参数滑杆 |
| verify-soak | — | 1 轮 | 长时闲置内存（默认 6 分钟） |
| verify-asr | — | 真 ASR API | 火山引擎识别连通性 |

分支 `feat/video-call-mode` 待并入：verify-video-call（29，boot 1 轮）——**合入时迁移其 boot 到 boot.mjs**。

## 新套件编写规范

- 默认零 API：断言走 DOM/配置/日志/纯计算。确实需要 LLM 行为的探针消息放**断言段**，boot 一律 `lib/boot.mjs`。
- 命名 `verify-<topic>.mjs`；结束输出 `N/M checks passed` 汇总 + 正确退出码（runner 依赖）。
- 必须支持 `DSH_E2E_PORT` / `DSH_E2E_HOME`（或 E2E_URL/E2E_SESSIONS/E2E_CFG 显式覆盖），不许硬编码端口。

## 迁移状态（童子军：改到哪迁到哪）

重套件 boot 仍是"发一条真实消息拿 id"的旧模式（每个 1 轮 LLM+TTS 纯浪费）：live / voice / phase3 / stream / standalone / nodup / translation-race / inject / look-sliders / soak / v11 / third-person / video-call。任何因业务改动而重跑其中某个套件时，顺手把 boot 换成 `boot.mjs`（删掉 `keyboard.type('你好')` + WS 帧捕获，改 `openSessionRow` + `streamCollector`）。

## 技术要点（实证沉淀）

- **React 18 批处理**：同一 `evaluate` 里连续 dispatch pointermove + pointerup，处理器读到 stale ref——move 与 up 分两次 `evaluate`、中间 sleep。
- **setPointerCapture 对合成事件抛 NotFoundError**——交互代码 try/catch 包裹。
- **吸附/几何断言用边界带**（如 `|top-(sh-h-12)|<30`），不钉死像素。
- **页面残留视图态**会让 Live2D tab 首击落空（瞬态失败，重跑即绿）；boot 断言前等视图就绪。
- **npm install 陷阱**：会把原依赖挪进 `node_modules/.ignored/` 造成 MODULE_NOT_FOUND（gaze/vision 404、tsc 报缺 types）；用 `npm install --prefer-offline` 恢复，期间启动的 e2e 实例必须重启。
- **杀 e2e 实例**：dsh web 会 fork 真正监听的子进程，孤儿可能**延迟绑定**——kill 后等 8s+，`ps aux` 与 `ss` 双查为 0 才可信，必要时 kill -9 复查两次。
- **抓 WS 帧**用 playwright 原生 `page.on('websocket')`；别 patch `window.WebSocket`（破坏 mux 的 instanceof 语义）。
- **esbuild 压缩中文**为 `\uXXXX`，grep 构建产物里的中文要查转义形式。

## 未决项

- **verify-fullscreen-usable F3**：隔离实例（worktree lib、haru、first 模式）确定性失败，A/B 主仓 lib 的对照未做、根因未查（用户裁决暂停）。fit() diff 已人工复核：分支改动全部在 `stageLayout.window` 守卫内，非窗口路径逐字节未变。下次跑 L1 时留意；若在 main lib 上同样红，则与分支无关。
