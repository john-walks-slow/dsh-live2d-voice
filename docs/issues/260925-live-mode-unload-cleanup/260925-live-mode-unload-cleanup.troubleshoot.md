# Live 模式卸载与资源释放问题根因分析 (Troubleshoot)

## 1. 现象描述
用户反馈：
1. "现在live态有正确的卸载吗？我都切出live了，竟然还能听到我说话并和我说话？？"
2. "或者切到另一个会话，也应该把之前停了的，服务，语音，还有其他可能占内存的…"

## 2. 根因分析 (Root Causes)

### 根因 1: 缺少页面可见性管理 (`visibilitychange`) 与麦克风后台强行 resume
- **代码位置**: `src/client/mic.ts` line 180-184
- **问题**: `mic.ts` 中监听了 `context.onstatechange`，在 `context.state === 'suspended'` 时直接调用 `context.resume()`。当手机切出浏览器应用（按 Home 键、切到微信、锁屏）或切换浏览器标签页时，系统/浏览器会挂起 AudioContext，但代码死命将其唤醒。同时前端完全没有监听 `document.visibilitychange`，切到后台后麦克风数据流持续采集、VAD 持续判定有效语音、持续向 ASR 上报并将识别结果提交为 AI 对话，AI 回复后继续播放。

### 根因 2: 缺乏显式退出 Live 模式机制，全屏退出易误解
- **代码位置**: `src/client/hud.tsx`, `src/client/view.tsx`, `src/client/live-button.tsx`
- **问题**:
  1. 在全屏（网页半全屏）模式下，HUD 栏只有麦克风、键盘、设置、语言、全屏 5 个按钮，没有“退出 Live 模式 / 返回聊天”按钮。用户点击全屏图标仅退出视口铺满，当前视图仍然是 Live2D 视图（顶部 tab 依然是 Live2D），麦克风并未关闭。
  2. 在非全屏普通视图下，`LiveButton` 只要检测到 Live2D Tab 存在就直接返回 `null` 隐藏，界面没有任何显式的退出指引。

### 根因 3: 会话切换（Session Switch）时组件未卸载，状态与引擎串流
- **代码位置**: `src/client/view.tsx` line 1720 `makeLive2DView`
- **问题**: DSH 切换会话时，`makeLive2DView` 渲染的 `Live2DView` 没有绑定 `key={props.sessionId}`。React 复用同一组件实例，只更新 `props.sessionId`。而 `SpeechEngine`、`SharedStage`、`subtitles` 等多个核心资源对应的 `useEffect` 依赖数组为 `[]`，会话切换时不会销毁重建！前一个会话的语音队列继续播放，状态与新会话完全串流。

### 根因 4: WebGL 纹理与 Pixi 显存未彻底释放
- **代码位置**: `src/client/model.ts` line 778, `src/client/view.tsx` line 412
- **问题**: `app.destroy(true, { children: true })` 与 `model.destroy()` 未传递 `texture: true, baseTexture: true`，且未触发 `WEBGL_lose_context`。Live2D 模型的高分辨率贴图和 WebGL 缓冲区残留在 GPU / 显存中未释放。

### 根因 5: 服务端会话切换或离开时未能立即终止活跃的 TTS 与流
- **代码位置**: `src/speech.ts`, `src/events.ts`
- **问题**: 服务端中断 TTS 仅依赖 SSE 的 socket close 事件。如果前端在会话切换或显式退出时未立即关闭旧会话的 SSE 连接并主动发起 abort，服务端可能继续合成语音、消耗配额并占用资源。

## 3. 修复方案 (Action Items)

1. **会话级完全隔离与生命周期闭环**:
   - 在 `makeLive2DView` 中为 `Live2DView` 增加 `key={props.sessionId}`，确保切换会话时 100% 触发旧组件的销毁（unmount）与全量清理，新会话全新挂载。
2. **麦克风后台行为与页面可见性联动**:
   - 在 `src/client/mic.ts` 中移除后台强制 resume 的危险逻辑；
   - 增加页面可见性监听（`visibilitychange`）：页面 hidden 时立即暂停麦克风采集与 VAD、暂停当前语音播放；页面恢复 visible 且用户之前开启了麦克风时再合理恢复或保持待机；
   - 卸载时彻底关闭 AudioContext、WorkletNode 与 MediaStreamTracks。
3. **交互层：在 HUD 中增加醒目的「退出 Live 模式」按钮**:
   - 在全屏与常规 HUD 中增加「退出 Live」按钮，点击立即调用 `stopListening()`，并切换回 Chat Tab。
4. **显存与内存彻底清理**:
   - 在 `destroy()` 时传入 `{ children: true, texture: true, baseTexture: true }`；
   - 对 WebGL 上下文调用 `WEBGL_lose_context.loseContext()` 强制丢弃；
   - 清理所有定时器、RAF、摄像头流、陀螺仪监听。
5. **后端主动收拢**:
   - 提供显式的离开或中断会话接口（或由 SSE 关闭立即终止），确保旧会话的 TTS、翻译任务与 WebSocket ASR 立即被 abort。
