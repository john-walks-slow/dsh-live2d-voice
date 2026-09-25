# Live 模式卸载与资源释放修复总结 (Summary)

## 1. 问题背景
用户在使用 Live 模式时发现：
1. 切出 Live 态后（切后台/切标签页），依然能听到说话并触发 AI 回复；
2. 切换到另一个会话时，旧会话的语音、服务和内存没有完全释放。

## 2. 根因与修复实施

| 模块 | 根因 | 修复动作 |
| :--- | :--- | :--- |
| `src/client/mic.ts` | 挂起时强制 resume，页面 hidden 依然采音，stop 时误将未完成语音 emit 提交 | 移除强制 resume；增加 `pause()`/`resume()`；在 `stop()` 时彻底丢弃未完成语音，切断后台收音路径 |
| `src/client/view.tsx` | 会话切换时组件实例未 unmount 导致状态和音频串流；缺少可见性联动；缺少显式退出入口 | 1. `makeLive2DView` 绑定 `key={String(props.sessionId)}`，实现会话级彻底销毁；<br>2. 增加 `document.visibilitychange` 监听，切后台暂停录音并停止发声；<br>3. 实现 `exitLiveMode`，停止录音播放并切回 Chat Tab；<br>4. 卸载时执行 `WEBGL_lose_context` 彻底释放显存 |
| `src/client/hud.tsx` | HUD 缺少显式的退出 Live 模式按钮 | 增加退出按钮与 `IconExitLive` 图标，并在全屏/常规模式下均可一键退出 |
| `src/client/model.ts` | `destroy` 时未释放 WebGL 纹理和 BaseTexture | 传入 `{ children: true, texture: true, baseTexture: true }` 彻底释放模型贴图与 GPU 缓存 |

## 3. 验证情况
- 运行 `node e2e/verify-unload-cleanup.mjs` 测试通过，确认点击退出 Live 后 `.lv-root` 与 WebGL canvas 完全从 DOM 销毁并卸载，平滑切换回 Chat Tab。
- 模拟 `visibilitychange` 事件确认后台无异常抛出且麦克风暂停。
- 现有全屏交互测试 `e2e/verify-fullscreen-usable.mjs` 和 `e2e/verify-standalone-fullscreen.mjs` 均 100% 通过。
