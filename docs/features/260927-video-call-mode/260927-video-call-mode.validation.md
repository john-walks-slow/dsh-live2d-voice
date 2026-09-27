# 视频通话模式验证

日期：2026-09-27 ｜ worktree `.worktrees/video-call-mode`（分支 `feat/video-call-mode`）

## 自动化验证（已完成）

环境：隔离 e2e home（插件符号链接指向本 worktree 的 lib/），实例端口 25001，多模型夹具目录。

| 套件 | 结果 | 覆盖 |
| --- | --- | --- |
| `verify-video-call.mjs`（新） | **29/29** | 配置迁移（thirdPerson→liveMode）· `/model` 返回 liveMode+player · PiP 挂载/几何（大小、默认位置右上）· 单共享 canvas · 名牌渲染 · 舞台拖拽 pan 不影响小窗（look 归零）· 输入直达（无 pending 占位、无玩家 SSE 事件、日志记原文、AI 正常回复）· 拖拽跟随与松手吸附角落（边界带断言）· 三段选择器往返切换（call→third→first，玩家化身与 PiP chrome 正确挂卸）· zero pageerror |
| `verify-third-person.mjs`（回归） | **35/35** | liveMode 改造后第三人称全链路（配置面/双模型同台/polish 全链路 SSE/日志/中→日润色/关闭兜底） |
| `verify-v11.mjs`（依赖完整性） | 13/15 | A/B/D/T 段全绿（全屏、资产、MediaPipe 加载、依赖完整）；C1/C2（`look_at_user` 相机工具回环）依赖真实 LLM 恰好调用该工具，在本环境两次未复现——与 liveMode 改动无代码交集（不触碰相机路径），留待实机确认 |
| typecheck + build | 通过 | `npm run typecheck` / `npm run build` 零错误 |

## 用户实机验证（建议）

前置：`modelPath` 指向多模型目录并选定 `playerModelSelection`；`live2d-voice.json` 无需手工迁移（旧 `thirdPerson: true` 自动变 `"third"`）。

1. **三态切换**：⚙ 面板三段选择器切「视频通话」→ AI 回居中大画面 + 玩家化身小窗出现在右上角；往返切三态不重载模型、无残影
2. **口型跟随（需麦克风）**：🎙 开启监听后对小窗说话——你的化身口型应实时随你的声音开合
3. **视线跟随（需前置摄像头）**：开启视线追踪后，左右移动人脸——小窗化身头/眼朝你的方向转动
4. **拖拽吸附（触屏/鼠标）**：拖小窗到屏幕中部松手 → 吸附到最近的角落；拖拽中舞台角色不应跟着动
5. **输入直达**：打一句话发送——字幕区**不出现**「酝酿中…」、没有玩家台词代播，AI 直接回应并朗读（与第三人称模式对比明显）
6. **无玩家模型兜底**：`playerModelSelection` 留空开视频通话 → 只有 AI 大画面、无小窗、无报错

## 已知边界

- 小窗口型仅监听中驱动（🎙 开着才有）；视线跟随依赖 `eyeTracking` 开关（实验性）
- C1/C2（`look_at_user` 工具回环）为 v1.1.0 旧有用例，非本需求范围
