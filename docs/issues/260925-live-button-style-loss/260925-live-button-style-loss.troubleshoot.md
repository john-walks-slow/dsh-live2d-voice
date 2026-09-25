# 260925 live-button-style-loss — Live 按钮偶发失去样式

## 现象

有些时候 Live 入口按钮（`.lv-live-entry`，输入栏里的 pill 按钮）失去样式，变成浏览器默认按钮外观（`border-radius: 0`、默认 padding、无字体设置）。一旦发生，持续到刷新页面为止。整个插件的其他 `lv-*` 样式（字幕、HUD、设置卡）在同一时刻全部失效——Live 按钮只是非 Live 视图下唯一在 DOM 里的 `lv-` 元素，所以最先被看到。

## 根因

**dsh 客户端模块系统的 style 认领（claim）机制与插件的 CSS 注入时机错位。**

宿主机制（`@deepseek-ai/dsh-client-modules` + `@deepseek-ai/dsh-client-hmr`）：

1. 插件 client bundle 以 factory 形式注册；**materialize 时**（factory 执行完、cordis `apply()` 尚未运行）宿主同步执行 `claimStyles(id)`：把文档里所有**未打标**的 `<style>` 打上 `data-plugin=<id>`——此刻插件自己的 `<style>` 还不存在，认领为空。
2. 插件的 `apply()` 随后运行，`injectLiveStyles()` 向 `document.head` 追加 `<style id="dsh-live2d-voice-styles">`——**未打标**，永远不属于自己。
3. 之后**任何一个**插件 (re)materialize（HMR 热重载、懒加载导入），其 `claimStyles(X)` 会把所有未打标 style 认领为 X 的财产 → 我们的 style tag 被打上 `data-plugin="X"`。
4. 该插件 X **下一次**热重载时，`removeOwnedStyles(X)` 删除所有 `data-plugin="X"` 的 style → 我们的样式表被连带删除。

触发条件（"有些时候"的来源）：宿主 `client-hmr` 无条件（生产实例同样）每 500ms stat-poll 所有插件 client bundle，内容变化（content hash 变化）即向所有打开的 GUI 标签页推 `rebuilt` SSE 帧。**任何插件连续两次 rebuild**（第一次认领、第二次删除）即丢失样式。本机多 agent 高频 rebuild 插件 + GUI 标签页常开的工作流下频繁满足。

### 实证（e2e :4188，2026-09-25）

探针脚本：`e2e/verify-style-claim.mjs`（playwright + 改写 dsh-token-game bundle 两次触发 rebuilt 帧）：

| 阶段 | 操作 | `#dsh-live2d-voice-styles` 状态 | 按钮计算样式 |
|---|---|---|---|
| Stage 0 | 页面加载后 | 存在，`data-plugin = null`（未被认领） | radius 999px / padding 4px 10px |
| Stage 1 | token-game 第 1 次 rebuild | 存在，`data-plugin = "dsh-token-game"`（**被偷**） | 正常 |
| Stage 2 | token-game 第 2 次 rebuild | **被删除（GONE）** | **radius 0px / padding 1px 6px** |
| Stage 3 | 还原 token-game | 仍然 GONE（不自愈） | 无样式 |

页面内 SSE 监听捕获了逐帧事件：`graph` → `rebuilt dsh-token-game` ×3，与机制推演逐帧吻合。

### 附带发现

- 同一 bug 类影响生态里**所有在 apply() 时机注入 `<style>` 的插件**（实证时观察到 `@xmanrui/dsh-im` 等还有 4 个未认领的 style tag 悬在文档里）。
- 我们自己插件的热重载不会丢样式，但会**泄漏**：`removeOwnedStyles` 只删已打标的，未打标的旧 tag 每次重载都会幸存一个副本。
- dsh web 的进程拓扑：launcher 进程会 fork 真正监听的子进程（fd 继承、launcher 退出后子进程 PPID=1），排查连接中断时注意区分"被 `dsh-e2e stop/start` 重启"与"fork 交接"。

## 修复路径（单点修复）

`src/client/styles.ts` 的 `injectLiveStyles()`：创建 style 元素时直接打上 `data-plugin="dsh-live2d-voice"`（与 graph row id = 包名一致）。

- 其他插件 materialize 时的 `claimStyles` 选择器是 `style:not([data-plugin])`，已打标的 tag 不会再被偷。
- 自己插件热重载时 `removeOwnedStyles("dsh-live2d-voice")` 会正确删旧 tag，新模块（`injected` 标志随模块重求值复位）在 apply 里重新注入——生命周期闭环，泄漏一并消除。
- 这也是宿主设计的 canonical 用法（dsh-client-modules 注释："preset-emitted tags arrive pre-tagged with data-plugin"）。

备选（不推荐单独使用）：把注入时机挪到模块顶层（factory 期），让 materialize 的 claimStyles 自然认领——但打标方案与注入时机解耦，对 standalone 路径同样安全，且不依赖时机假设。

## 置信度

97%。机制全程有宿主源码逐行对应 + 真实实例三阶段实证复现；剩余 3% 留给"用户偶见的个别场景可能另有叠加因素"（如 FOUC 瞬态），但"持续失去样式"的主因可确认为本机制。

## 验收标准

1. `e2e/verify-style-claim.mjs` 回归：Stage 0 `data-plugin = "dsh-live2d-voice"`；两次外部插件 rebuild 后 style tag 仍存在且归属不变；按钮样式保持 999px pill。
2. 自身插件 rebuild（HMR）后：旧 tag 删除、新 tag 注入，任意时刻 DOM 中该 id 的 tag 恰好 1 个。
3. typecheck + build 通过；`node --check lib/client.js` 通过。
