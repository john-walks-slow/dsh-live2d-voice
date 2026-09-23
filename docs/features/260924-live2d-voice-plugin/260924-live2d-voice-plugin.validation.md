# dsh-live2d-voice Phase 1 — 用户验证要求

## 验证环境

- 线上 DSH Web GUI（插件安装 + 重启后）
- 桌面或手机浏览器（需 WebGL；无头/软件渲染场景仅测试用）
- Fish Audio API key（已配置于 `~/.dsh/live2d-voice.json` 的 `apiKeyFile`）
- Live2D 模型：`~/.dsh/live2d-voice-models/haru`（已就位）

## 自动化已覆盖（21/21，e2e/verify-live.mjs）

以下项已由 camoufox 端到端脚本在隔离实例（:4188）验证通过，用户无需重复：

- [x] 插件加载：boot 无 pageerror / console.error；client bundle 样式注入；Cubism Core 内容 realm 加载
- [x] Live2D tab 出现并可切换；pixi canvas 渲染 Haru（1000×689）
- [x] HUD 五按钮（🎙禁用占位 / 🔇静音 / 💬字幕 / ⌨键盘 / ⚙音色）
- [x] 键盘输入提交 → 冷会话经 GUI 会话通道创建/resume agent → 回复到达
- [x] SSE 全链事件：speech-start / audio-start / expression(joy) / subtitle×2 / audio（百级 PCM chunks，TTS 真实调用 Fish）/ audio-end / speech-end
- [x] DOM 字幕两条（用户 + AI）
- [x] 静音/字幕/音色切换写回配置文件

## 需要真实设备 / 用户感官验证

- [ ] **听觉**：TTS 播放音质与音量（rem 音色，中文）；句间衔接是否自然、有无爆音/截断
- [ ] **口型**：说话时嘴型开合与语速的观感匹配度（RMS 包络 attack 50ms / release 130ms 参数是否需调）
- [ ] **表情**：模型回复带情绪时表情切换是否自然（当前测试句稳定触发 joy）
- [ ] **性能**：长时间对话（10+ 轮）后帧率与内存（pixi + AudioContext 队列）
- [ ] **移动端**：手机浏览器打开 Live2D tab 的布局与触控（HUD 按钮、输入框）
- [ ] **静音切换**：🔇 开→关→开，播放恢复是否正常（AudioContext resume 路径）
- [ ] **音色切换**：⚙ 里换音色后下一句立即生效
- [ ] **会话标签页切换**：Live2D 页发消息后切到 Chat tab 看历史记录完整（情绪标签留在日志中为预期行为）

## 已知边界（Phase 1 范围外）

- 🎙 语音输入未实现（Phase 2：STT + VAD）
- 字幕翻译（LLM 二次翻译）未实现
- Live2D 页无历史消息回放；无 per-workspace 配置覆盖（Phase 3 预留字段）
