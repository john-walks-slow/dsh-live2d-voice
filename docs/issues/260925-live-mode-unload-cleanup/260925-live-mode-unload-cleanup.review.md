# Live 模式卸载与资源释放检视报告 (Review)

## 1. 检视目标与范围
- **目标**: 确保离开 Live 模式、切换会话或切至后台时，音频采集、语音播放、WebGL 资源、硬件传感器（摄像头/陀螺仪）和服务端任务 100% 干净卸载，无残留、无串音、无偷录。
- **改动文件**:
  - `src/client/mic.ts`: 移除强行 resume，增加暂停与恢复机制，修改 `stop()` 逻辑丢弃进行中半截片段。
  - `src/client/view.tsx`: 增加 `visibilitychange` 事件监听；增加显式退出 Live 模式函数 `exitLiveMode`；给 `Live2DView` 增加 `key={String(props.sessionId)}` 会话隔离；在卸载时调用 `WEBGL_lose_context` 与纹理释放。
  - `src/client/hud.tsx`: 新增 `onExitLive` 按钮并与 `IconExitLive` 配合。
  - `src/client/model.ts`: 在 Pixi 及 Live2D 模型 `destroy` 时传入 `{ children: true, texture: true, baseTexture: true }`，释放显存纹理。
  - `src/client/icons.tsx` / `styles.ts`: 新增退出图标及悬停微红警告样式。

## 2. 详细检视维度

### A. 生命周期与卸载完整性 (Life Cycle & Teardown)
- **会话级隔离**: 在 `makeLive2DView` 中增加 `key={String(props.sessionId)}`，当用户切换不同 Session 时，React 强制卸载旧会话的完整 View 树，执行其所有 `useEffect` cleanup，杜绝旧会话在后台复用造成语音和状态串流。
- **显存与 WebGL 释放**:
  - `stage.app.destroy(true, { children: true, texture: true, baseTexture: true })`：强制销毁所有 GPU 纹理；
  - 调用 `WEBGL_lose_context.loseContext()`：显式让浏览器与 GPU 驱动回收 WebGL 渲染管线。
- **麦克风与硬件**:
  - 组件 unmount 时调用 `stopListening()`，停止所有 MediaStreamTracks、关闭 AudioWorkletNode、关闭 AudioContext；
  - `GazeTracker` 与 `TiltParallax` 在 unmount 时触发 `stop()`，释放前置摄像头流并注销陀螺仪事件监听。

### B. 后台与可见性安全 (Visibility & Background Safety)
- **切出后台防偷听**:
  - 移除了 `mic.ts` 在挂起时的死循环强制 `resume()`；
  - 增加 `document.visibilitychange` 监听：页面切出（`document.hidden === true`）时，立即 `mic.pause()` 暂停采音与 VAD 判定，并立即 `engine.stop()` 暂停语音播放；
  - 在 `stop()` 中彻底丢弃未完成的 segment，绝不在卸载/停止麦克风时把用户刚说的话提交给 ASR 和 AI。

### C. 用户交互与可退性 (UX & Exits)
- 在全屏与常规 HUD 中均新增了显式的「退出 Live 模式」按钮（`<IconExitLive />`），一键停止麦克风、停止声音、退出全屏、切回常规 Chat Tab。

## 3. 测试与验证结论
- **类型检查与构建**: `npm run build && npm run typecheck` 0 错误通过。
- **E2E 自动化测试**:
  - 新增 `e2e/verify-unload-cleanup.mjs` 测试：覆盖 Live 进入、HUD 退出按钮呈现、visibilitychange 模拟、点击退出 Live 彻底销毁 `.lv-root` 与 WebGL canvas，平滑回到 Chat Tab，8 项检查全部通过！
  - `e2e/verify-fullscreen-usable.mjs`: 5 项全屏功能测试全部通过。
  - `e2e/verify-standalone-fullscreen.mjs`: 6 项独立页全屏测试全部通过。

## 4. 结论
准入通过。完全满足用户关于彻底解决 Live 模式卸载、会话切换释放、后台收音等问题的要求。
