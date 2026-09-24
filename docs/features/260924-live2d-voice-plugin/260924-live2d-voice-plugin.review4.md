# v1.1.0 变更集检视（review4）

- **检视对象**：`git diff v1.0.0` + untracked（camera-tool.ts / gaze.ts / verify-v11 / verify-soak），重点为全屏+Wake Lock、长时闲置、设置面板重修、视线追踪、look_at_user 工具
- **验证手段**：源码走查；对照 dsh-agent / dsh-tools / dsh-attachment / cordis 实装源码核实事件 payload、tools.register 语义、saveImage 校验链；`npm run build` 重建 **byte-identical**；`node --check` 双产物通过；typecheck 通过；link 场景依赖全量解析实测；噪声 JPEG 实测体积（640×480 q85 = 232KB）验证 camera-result 上限问题
- **结论**：**修复后可发布**。2 个阻断项（都在 look_at_user 实验特性里，均为小修复），3 个 P1，8 个 P2。基础打磨部分（全屏/Wake Lock/面板/闲置稳定/视线追踪路由）除 P1-2/P1-3 外均无阻断问题。

---

## 阻断项

### B1（阻断）`agent/created` 监听器拿错 payload —— view-first 冷会话永远注册不上 look_at_user

- `src/camera-tool.ts:126-131`：`ctx.on("agent/created", (agent: unknown) => { const a = agent as AgentLike; if (!a?.ctx || a.id === undefined) return; ... })`。
- dsh-agent 实际 emit 的 payload 是 **`{ agent }`**（`@deepseek-ai/dsh-agent/lib/index.js` `announce()`：`args = [carrier, "agent/created", { agent: entry.agent }]`）。一方插件全部用 `({ agent }) =>` 解构（dsh-schedule / dsh-goal-round-driver / dsh-tool-subagent / dsh-agent-presets ×2 / dsh-file-reference-local，六处佐证），且全 dsh 仅此一个 emit 点。
- 该监听器收到的 `a` 是 `{agent: …}` 包装对象 → `a?.ctx` 为 undefined → **永远早退**。于是「视图先于 agent」时序（冷会话先切 Live2D tab 再开口说话——语音入口的主流程）：onFirstOpen 时 `agents.get()` 为 undefined 注册不上；agent 创建时 agent/created 路径因本 bug 注册不上；SSE 连接存续期间 onFirstOpen 不会再触发 ⇒ 该会话**永远没有这个工具**，直到连接断开重连。
- **e2e 为何 10/10**：verify-v11 先在 composer 发「你好」（agent-first），注册走的是 onFirstOpen 路径；agent/created 路径零覆盖。
- **修复**（一行 + 重建）：
  ```ts
  ctx.on("agent/created", (payload: { agent?: unknown }) => {
      const a = payload.agent as AgentLike | undefined;
      if (!a?.ctx || a.id === undefined) return;
      ...
  });
  ```
- 附注：typecheck 抓不住它（参数类型标成 unknown）。事件监听应尽量用官方事件类型而非手写 unknown。

### B2（阻断）camera-result 复用 64KB 通用 JSON 上限 —— 真机照片必被拒

- `src/routes.ts:38` `BODY_MAX_BYTES = 64 * 1024`；camera-result handler 走 `readJsonBody`（:274），超限抛 "body too large" → 400。handler 里的 8MB dataUrl 检查（:284）对 64KB–8MB 区间是**死代码**。
- 客户端 `capturePhoto` 输出 640px JPEG q0.85：实测噪声图 232KB、普通人像/室内场景约 40–120KB → base64 后 55–310KB，相当大比例超过 64KB → POST 被拒 → `postCameraResult` 把错误整个吞掉（api.ts:87 `.catch(() => undefined)`）→ 工具干等 25s 超时，报「摄像头不可用或超时未响应」。表现为**时好时坏**（取决于画面复杂度），比稳定失败更难排查。
- **e2e 为何过**：假摄像头纯绿帧 JPEG 仅数 KB。
- **修复**：`readJsonBody` 加 maxBytes 参数，此路由传 9MB；保留 8MB dataUrl 检查。补测：向 camera-result 直接 POST 一个 >64KB 的合法 dataUrl（修复前 400 / 修复后走 deliver）。

## P1（发布前应修）

### P1-1 gaze tracker 在 start() 进行中被 stop() 会泄漏 landmarker（极端时序泄漏 stream）

- `gaze.ts` 的 `start()` 在各 await 点之间无取消检查。真实时序：开启 → getUserMedia OK → 下载模型/构造 landmarker（**首次要数秒**）→ 用户关掉开关 → effect cleanup 调 `stop()`（此时清掉 stream/video ✓）→ `start()` 继续 → `this.landmarker = await create(...)` 照常赋值 → rAF loop 因 `running=false` 立即退出 ⇒ 该 landmarker（wasm/GPU 实例）**永不 close**。若 stop 发生在 getUserMedia resolve 之前，`this.stream` 会在 stop 之后才被赋值 ⇒ 摄像头流泄漏（指示灯常亮）。
- **修复**：start() 每个 await 后检查 `if (!this.running) { 清理本次已获取的资源; return; }`；或引入 generation token（mic.ts 的 micGenerationRef 同款模式）。

### P1-2 requestFullscreen 兼容回退是死代码（iPhone Safari 同步抛 TypeError）

- `view.tsx:310`：`void root.requestFullscreen().catch(() => showToast("此浏览器不支持全屏"))`。iPhone Safari（所有 iOS 浏览器）没有 `Element.requestFullscreen` —— 调 undefined 抛**同步** TypeError，`.catch` 根本不执行，按钮无效 + 控制台报错。目标场景「旧手机当角色终端」可能包含 iPhone。
- **修复**：`if (typeof root.requestFullscreen !== "function") { showToast("此浏览器不支持全屏"); return; }`。Android Chrome/WebView 不受影响（e2e D3 已过）。

### P1-3 Wake Lock acquire 竞态：cleanup 后 sentinel 迟到 → 锁悬空到页面隐藏

- `view.tsx:319-349`：`acquire()` 在 await `wakeLock.request` 期间 effect 重跑（micState 变化，如停麦）→ cleanup 的 `release()` 执行时 sentinel 还是 null（no-op）→ request 随后 resolve，sentinel 才被赋值并 addEventListener——但这个 effect 已死，**锁一直持有到页面隐藏**为止。「退出/停麦释放」在这条路径失效。
- **修复**：cleanup 里设 `cancelled = true`；acquire resolve 后 `if (cancelled) { void s.release(); return; }`。顺带建议加「已持有则不重复 acquire」守卫（快速 hide→show 时旧 sentinel 被覆盖未显式 release，目前靠浏览器 hidden 自动释放兜底）。

## P2（建议随发布修复，不阻断）

1. **模型 remount 不重放 gazeMode**：切换角色模型后新 mount 的 `gazeMode=false`，鼠标指针跟踪与摄像头 gaze 抢 focus。建议模型 mount ready 后按 `gazeRef.current?.active` 补一次 `setGazeMode(true)`。
2. **gaze 模型 tmp 文件残留**：`face_landmarker.task.tmp` 发布成功后不删除、下载失败也残留（≤16MB 磁盘残留；下次下载会覆写，无正确性问题）。发布后 `unlink` 一下即可。
3. **`exitFullscreen()` 的 rejected promise 被裸 void**（状态脱靶时 unhandled rejection 警告），与 P1-2 一并处理。
4. **inject 含多余的 `"tools"`**：插件自身 ctx 从不访问 `ctx.tools`（camera-tool 用的是 `agent.ctx.tools`，属 agent 侧 scope）。无害（tools 是核心服务恒在），但按「inject 写全且仅写直接访问」口径属多余声明，可留作能力声明亦可删。
5. **events.ts:78-82 缩进错乱** + `hub.has()` 写法绕（`get(id)?.size !== undefined && (…?? 0) > 0`，等价于 `(this.connections.get(id)?.size ?? 0) > 0`）。纯可读性。
6. **verify-v11.mjs 死代码**：:101-107 的 sessionId 探针（恒返回 null）、未用的 `followIds`、空 `page.evaluate`；「attach SSE probe」注释与实现不符。
7. **capturePhoto 回退缺口**：gaze tracker active 但 video 未就绪时直接返回 null，不尝试临时摄像头。可接受（摄像头可能被占），但超时报错文案把这种情况与「无权限/无摄像头」混为一谈。
8. **mediaType 硬编码 image/jpeg** 而 dataUrl 前缀校验接受任意 `data:image/*`——非 JPEG 会在 saveImage 处以 IMAGE_TYPE_MISMATCH 抛错（安全已兜住），报错路径略绕。

## 专项问题答复（对照检视要求）

- **注册时序与生命周期**：B1 是唯一时序洞，两个时序分支里 agent-created 分支失效。WeakSet 防重入**有效**（dsh-agent `get()` 返回 store 中同一 agent 对象，已核实）；`agent.ctx.effect` 托管 dispose 正确（agent 释放即注销）；插件 unload 时已注册工具存续至 agent 释放，重载后 onFirstOpen 重注册 → tools.register 的 layers 语义是 **shadow 而非 crash**（已核实 register 实装），安全。
- **子代理 gate（是否需要 roots() 检查）**：**不需要**。子代理拥有独立 session id，`hub.has(id)` 天然过滤；即便子代理以某种方式继承了该工具，execute 里 `exec.agent.id ≠ 被观看会话` → 返回「视图未打开」的干净错误。session-id 等价性是正确且充分的 gate；加 roots() 反而可能误伤 fork 出的合法会话。
- **CameraBridge 超时/重复/竞态**：全部正确——deliver 先 delete+clearTimeout 再 resolve；晚到 deliver 返回 false；超时后 deliver 不复活条目；不会双 resolve。requestId 12 hex（48-bit）服务端生成。
- **伪 dataUrl 攻击面**：结论**前缀校验够**。三层兜底：(1) 路由在 dsh webserver 鉴权面内（同其余 /live2d-voice 路由，仅已认证 GUI 可达）；(2) requestId 须命中服务端 pending 表；(3) `saveImage` 有 canonical base64 + 真实图片字节 + 尺寸/类型一致性校验（INVALID_IMAGE / IMAGE_TYPE_MISMATCH / IMAGE_TOO_LARGE 等错误码族，已核实实装）。伪 dataUrl 最多造成一次工具报错，无存储或注入面。
- **gaze.ts 资源清理**：正常路径 stop 顺序完备（rAF→landmarker.close→video.srcObject→tracks）；rAF 退出条件正确（`!running` 早退 + stop 内 cancelAnimationFrame 双保险）；GPU→CPU 回退路径可接受。缺口是 P1-1 的中断路径。
- **routes.ts gaze 缓存**：单飞 + 失败重置**正确**（`gazeModelPromise ??= …catch { gazeModelPromise = null; throw }`，并发共享同一 promise，失败后下次重试）；tmp→正式文件发布原子性够用（唯一读者在 ensureGazeModel resolve 之后）；content-length 预检 + 落盘后 stat 双保险。createRequire 解析已对照实际包布局核实：entry=`vision_bundle.mjs` 位于包根、`wasm/` 同级，向上走 1 层即命中；exports 挡 package.json 的判断正确，resolve-entry-再上溯是正解。
- **view.tsx wake lock**：依赖数组 `[fullscreen, micState]` 正确；问题是 P1-3 竞态。muzzle 相关零改动（engine.ts 不在 diff 中），无回归。全屏 CSS（`:fullscreen` + absolute stage）与 lv-root `position:absolute` 定位链核实无误。
- **mic.ts onstatechange 在 stop() 后**：**安全**。`this.running` 已 false（第一道闸）+ `this.context?.` 可选链（第二道）；context 置 null 后不再触发 resume；close() 过程中的状态回调同样被 running=false 拦住。
- **package.json 依赖完备性（dev-dsh-plugin 铁律）**：**通过**。link 场景全量解析实测 OK（dsh-tools / dsh-attachment / dsh-llm / ws / @mediapipe / dsh-agent / dsh-session 全部命中插件自身 node_modules）；dsh-tools 运行时实际 import 的 @deepseek-ai/* 为 cordis / dsh-brand / dsh-llm / dsh-scope（+dsh-util-values/schemastery 为其正规 deps 随装）——llm、scope 已显式声明，补装的 code-runtime / invariants / system-prompt / user-approval 冗余但无害；dsh-agent / dsh-session 仅 type-only import（构建期擦除）且 devDeps 已装（本地 link 场景可解析），npm 发布消费端由宿主 profile 提供。ws 是 asr.ts 运行时 import 且 build 中 external ✓。`files` 数组完整（lib/types 由 build 生成 ✓）。
- **版本/文档一致性**：**通过**。package.json 1.1.0 = CHANGELOG 1.1.0 = README（新功能条目、eyeTracking 配置行、两条 e2e 命令均已补）= validation v1.1.0 节（4 项待实机验证，符合流程）；review3 的 P1（lock 版本失同步、LICENSE 缺失）已闭环（lock root 1.1.0 ✓ LICENSE 存在 ✓）；lib 重建 byte-identical、`node --check` 通过、tsc 通过。
- **e2e 缺口**（修复后补测参考）：① view-first 冷会话注册路径（B1，修复前构造：新会话先点 Live2D tab 再发首条消息，让模型调 look_at_user 应报「无此工具」→ 修复后成功）；② >64KB dataUrl 回传（B2）；③ gaze 开启中途关闭的资源回收（P1-1，可 heap 采样对比）。

## 发布建议

修 B1（一行）+ B2（readJsonBody 参数化）后重建、复跑 verify-v11（10/10）并补 view-first 分支即可发布。P1 三项建议一并修（都是局部小改：start 取消检查、requestFullscreen 存在性守卫、wake lock cancelled 标志），P2 可留到下个 patch。
