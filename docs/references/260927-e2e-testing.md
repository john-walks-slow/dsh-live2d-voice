# e2e 测试规范（dsh-live2d-voice）

日期：2026-09-27 ｜ 状态：生效 ｜ 本文档不隶属单个需求，是全仓库 e2e 实践的依据（创建规则见 /update-references）

## 铁律（用户 260927 裁决与模块化重塑）

1. **业务模块化，严禁全量陪跑**。一次改动仅运行受影响业务模块的测试（如改动视线只跑 `gaze`，改动全屏只跑 `fullscreen`）；禁止无差别遍历无关历史用例。
2. **真实 API 严格孤立**。涉及真实 LLM / TTS / ASR 调用的套件（`real-api`）从日常回归中剥离，严禁作为门禁自动运行；仅在用户显式要求或针对该链路重点调试时**单点单测**（如 `node e2e/run.mjs verify-live`）。
3. **Session 伪造与复用，严禁发消息拿 id**。需要 sessionId 时统一使用 `e2e/lib/boot.mjs`（复用已有空会话行或捕获前端 attach 请求），绝对禁止发真实消息向大模型换取 session。
4. **e2e-tester 职责双轨制**：
   - **主职责（验收）**：像真实用户一样在浏览器体验，查布局、遮挡、手感，输出图文 `.e2e.md` 报告与截图。
   - **按需职责（固化）**：仅对用户提出的关键契约点，提炼轻量级回归用例放入对应业务模块中；探索性探针脚本保存在临时/需求目录留底，不作为日常自动化债务。

## 运行方式（`e2e/run.mjs`）

```bash
# 查看所有业务模块与测试套件
node e2e/run.mjs --list

# 1. 模块化运行（只测当前改动的模块）
node e2e/run.mjs boot             # 启动、入口与清理
node e2e/run.mjs fullscreen       # 全屏与虚拟键盘
node e2e/run.mjs gaze             # 视线计算与滑块
node e2e/run.mjs settings         # 设置与模型切换
node e2e/run.mjs styles           # 样式隔离
node e2e/run.mjs third-person     # 第三人称与防重

# 2. 精准单点运行
node e2e/run.mjs verify-boot
node e2e/run.mjs verify-look-math

# 3. 真实外部 API（极度慎用，需明确成本与网络可用性）
node e2e/run.mjs real-api         # 运行全部重套件
node e2e/run.mjs verify-live      # 单点跑真实语音链路
```

实例管理（隔离 home、动态端口）见 **dsh-e2e** 与 **acquire-port**。

## 模块划分清单

### 常规业务模块（零外部 API，可安全按需运行）

| 模块名 | 覆盖业务 | 包含套件 | 说明 |
| --- | --- | --- | --- |
| `boot` | 启动生命周期 | `verify-boot`, `verify-standalone`, `verify-unload-cleanup` | 守护零 API boot、独立入口与卸载清理 |
| `fullscreen` | 视口与移动端适配 | `verify-fullscreen-usable`, `verify-fullscreen-keyboard`, `verify-keyboard-squish`, `verify-standalone-fullscreen` | 检查全屏样式、键盘避让与几何计算 |
| `gaze` | 视线追踪与联动 | `verify-look-math`, `verify-look-sliders` | 纯数学计算与参数面板交互 |
| `settings` | 设置与配置 | `verify-settings-model` | 设置页 Live2D 分组导航与模型切换 |
| `styles` | 样式隔离与 HMR | `verify-style-claim` | 守护 CSS bundle 防止被其他插件卸载 |
| `third-person` | 双角色同台 | `verify-third-person`, `verify-nodup` | 双角色舞台布局与防重复提交 |

### 真实 API 孤立集合（`real-api`，默认不自动运行）

| 套件名 | 覆盖业务 | 依赖服务 | 运行建议 |
| --- | --- | --- | --- |
| `verify-live` | 语音模式全链路 | LLM + TTS | 仅在重构语音交互主流程时单跑 |
| `verify-voice` | 麦克风音频闭环 | LLM + TTS | 需测试音频流 |
| `verify-stream` | 流式 ASR 链路 | 火山 ASR + LLM | 仅验证识别流 |
| `verify-asr` | 语音识别连通性 | 火山 ASR | 接口契约单测 |
| `verify-phase3` | 翻译/多模型协作 | 翻译网关 LLM | 多语言测试 |
| `verify-translation-race` | 字幕竞态 | 翻译网关 LLM | 并发字幕测试 |
| `verify-v11` | 相机/工具回环 | LLM Tool Call | ⚠ 强依赖模型意图，天然偶发 Flaky，严禁作为阻断性门禁 |
| `verify-soak` | 内存耐力测试 | 长时闲置 | 耗时 6 分钟，仅上线前评估 |

## boot 规范（`e2e/lib/boot.mjs`）

为所有 E2E 脚本提供零 API 的环境准备基础设施：

```js
import { launch, streamCollector, openSessionRow, openLiveTab, E2E_URL } from './lib/boot.mjs';

const browser = await launch();
const page = (await browser.newContext()).newPage();
const streams = streamCollector(page);
await page.goto(E2E_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
await openSessionRow(page);            // 点已有会话行，不发真实消息
await openLiveTab(page);               // 切 Live2D Tab
const sessionId = [...streams].at(-1); // 从长连接请求捕获真实的 session id
```

**关键原则**：
- 点击已有会话与挂载视图**绝对不产生任何大模型日志增长**。
- 日志断言使用捕获到的真实 sessionId。
- 前端测试如需模拟语音回复，直接向客户端派发 Mock SSE 事件包，无需打通后端大模型。
