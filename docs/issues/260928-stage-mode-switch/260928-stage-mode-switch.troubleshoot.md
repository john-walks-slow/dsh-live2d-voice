# 260928 stage-mode-switch — 切换第三人称/视频通话模式弹出 Toast 但实际未切换根因排查

## 1. 现象描述

用户在 Live2D 视图下通过 HUD ⚙ 快捷面板切换舞台模式为「第三人称」或「视频通话」：
1. 界面弹出了 Toast 提示：`第三人称模式已开启` 或 `视频通话模式已开启（你的化身在小窗中实时跟随你）`；
2. 但实际上角色形象与舞台布局毫无变化（AI 角色依然居中，没有出现玩家角色，视频通话小窗亦未出现）；
3. 重新打开 HUD 菜单，发现高亮选中的仍然是「第一人称」；
4. 发送文字或语音，消息依然以第一人称直接递交大模型，未进入第三人称的玩家管线。

## 2. 根因分析

经过对线上生产实例（4180 端口）、Git 历史以及前后端源码的逐行比对分析，本问题的根本原因是**服务端进程未重启（运行时代际不一致）**与**前端盲目乐观 Toast 缺乏状态回校验**两个层面的叠加。

### 2.1 主因：线上 DSH 服务端常驻进程未重启，仍运行旧版 host 插件

- **时间线实证**：
  - 4180 端口的 DSH 线上常驻进程（PID 4405）启动于 **`2026-09-27 16:46:03`**。
  - 将第三人称由旧布尔值 `thirdPerson: boolean` 全面重构为三态 `liveMode: "first" | "third" | "call"` 并引入视频通话双化身管线的分支 `feat/video-call-mode`（提交 `6775fb9`），合并入 `main` 的时间是 **`2026-09-27 21:03:06`**。
- **机制机理**：
  - DSH 的 Web 客户端静态资源 bundle（`lib/client.js`）支持浏览器刷新直接加载最新磁盘文件，因此用户的浏览器运行的是**最新前端代码**（包含舞台模式三段选择器、`saveConfig({ liveMode })` 逻辑和新版 Toast 文本）。
  - 但 DSH 的 Host 插件（`lib/index.js` 及路由注册）是在 Node 进程启动时载入内存的，**必须重启 DSH 实例才能加载最新代码**。
  - 线上常驻的旧版服务端完全不识别请求体中的 `liveMode` 字段（旧代码仅提取 `body.thirdPerson`），因此静默忽略了该字段，直接返回了旧配置（仅含 `"thirdPerson": false`）。
  - `GET /live2d-voice/model` 路由同样是旧版，返回的 JSON 仅有 `thirdPerson: false`，**完全不包含 `liveMode` 和 `player` 字段**。

#### 实测抓包复现（针对 4180 线上实例）：

```bash
# 测试向线上 4180 发送 liveMode 配置保存：
curl -s -X POST http://127.0.0.1:4180/live2d-voice/config \
  -H "content-type: application/json" \
  -d '{"liveMode":"third"}'

# 响应返回：
{"config":{...,"thirdPerson":false,"playerModelSelection":"ni-j",...}}
# 说明：服务端根本未保存 liveMode，返回的对象中也无 liveMode 属性！
```

### 2.2 次因：前端 `setStageMode` 盲目弹出成功 Toast 且直接跌落回 first

观察 `src/client/view.tsx` 中的切换处理函数：

```ts
const setStageMode = async (next: LiveMode) => {
    try {
        const { config } = await saveConfig({ liveMode: next });
        setLiveMode(config.liveMode === "third" || config.liveMode === "call" ? config.liveMode : "first");
        const info = await fetchModelInfo(sessionId);
        setModelInfo(info);
        showToast(MODE_TOASTS[next]);
    } catch (error) {
        showToast(`切换失败：${String((error as Error)?.message ?? error)}`);
    }
};
```

1. **盲目 Toast**：只要 `saveConfig` HTTP 状态码为 200，前端便无条件执行 `showToast(MODE_TOASTS[next])`。这里的 `next` 是入参字符串，直接弹出了“已开启”的提示。
2. **状态跌落**：由于旧版服务端返回的 `config` 中无 `liveMode` 属性（`config.liveMode === undefined`），三元判断直接将其赋值为 `"first"`，本地 React 状态立即被重置回第一人称。
3. **视图无动作**：随后拉取的 `info` 同样无 `liveMode` 和 `player` 属性，`modelInfo.player` 为空，双模型挂载 effect 直接退出，AI 角色亦保持居中不位移。
4. **用户感受**：用户眼中看到的正是“弹出了 Toast 已切换，但实际上没有任何切换”。

### 2.3 潜在关联体验问题：默认玩家角色为空时的静默状态

即使服务端已升级支持 `liveMode`，代码中舞台双模型/视频通话小窗的挂载依赖：
```ts
const dual = modelInfo?.liveMode === "third" && Boolean(modelInfo?.player?.url);
const rawUrl = mode === "third" || mode === "call" ? modelInfo?.player?.url : undefined;
```
如果用户的 `playerModelSelection` 配置为空（或初次使用未选择），`modelInfo.player` 仍为 `undefined`。此时若无默认推荐角色，舞台同样不会发生位置分裂或渲染小窗，极易让用户困惑。

---

## 3. 修复路径

### 3A. 代码层加固与防呆（在当前 worktree `fix/stage-mode-switch` 中实施）

1. **前端真实状态校验**：
   - 在 `setStageMode` 中校验 `config.liveMode`（及兼容字段 `thirdPerson`）。若服务端未成功更新为目标模式，抛出显式错误或提示 `切换失败：服务端未应用新配置，请确认服务已更新并重启`，禁止虚假 Toast。
2. **双向协议向前/向后兼容**：
   - 保存时：在 payload 中同时带上 `liveMode: next` 及向后兼容的 `thirdPerson: next === "third"`，使旧版服务端至少能够开启第三人称模式。
   - 回读时：若响应中缺少 `liveMode` 但有 `thirdPerson: true`，自动映射为 `"third"`，避免直接降级为 `"first"`。
3. **默认玩家角色机制（UX 体验加固）**：
   - 当用户开启「第三人称」或「视频通话」模式时，若配置中 `playerModelSelection` 尚未设置，服务端 `resolveModelSelection` 或客户端自动补齐一个默认角色（如 `ni-j` 或可用列表中非当前角色的首个模型），确保用户一键开启即可看到双人同台/小窗化身，而不是空无一物。

### 3B. 运行层更新与生效（生产实例 4180）

1. 在当前 worktree 完成修改、静态检查（`typecheck`）、构建（`build`）与测试。
2. 按照 `restart-dsh` 规范，在独立测试端口验证稳定无误后，获得用户授权，通过安全方式重启线上 4180 实例，使最新的服务端代码真正常驻生效。

---

## 4. 置信度

**99%**。
- 4180 线上实例当前响应直接复现抓包，证据确凿。
- 进程启动时间（16:46）与分支合并时间（21:03）严格对应。
- 前端源码 `setStageMode` 的降级与盲目 Toast 逻辑完全吻合用户遭遇。

---

## 5. 验收标准

1. **单测/断言**：在本地测试中，向配置接口保存 `liveMode: "third"` 和 `liveMode: "call"`，返回值与 `GET /live2d-voice/model` 均正确包含目标 `liveMode` 与 `player` 结构。
2. **前端拦截**：当后端未返回匹配的 `liveMode` 时，前端精准报错提示，不再弹出“已开启”假 Toast。
3. **真实体验验收**：DSH 服务端重启后，在 Live2D 界面点击「第三人称」，AI 角色平滑右移，左侧显示玩家角色，Toast 正常；点击「视频通话」，右上角/右下角弹出实时化身小窗。
