# 视频通话模式（liveMode 三态）实施计划

日期：2026-09-27 ｜ worktree：`.worktrees/video-call-mode`（分支 `feat/video-call-mode`）

## 需求

Live 视图由「第一人称 / 第三人称」两态升级为三态：

| 模式 | id | 管线 | 画面 |
|---|---|---|---|
| 第一人称 | `first` | 输入直达 agent | AI 单模型居中 |
| 第三人称 | `third` | 润色(可选) → 玩家化身 TTS 播报 → agent | 双模型舞台剧（玩家左 / AI 右，互相对视） |
| 视频通话 | `call`（新） | **输入直达 agent**（无润色、无玩家 TTS 重播） | AI 居中全屏 + **玩家皮套小窗（PiP）**，小窗跟随玩家运动 |

小窗「跟随玩家运动」的实现语义：
- **口型跟随麦克风**：监听中时按 mic RMS 包络驱动小窗模型口型（像视频通话里的自己画面在说话）。
- **头部跟随前置摄像头**：视线追踪开启时，小窗模型头部/眼睛/身体朝用户人脸在画面中的方向转动（模仿用户动作）。
- 小窗本身可整窗拖动、松手吸附最近角落（视频通话自窗的常规 UX）。

## 设计决策

1. **配置字段**：`thirdPerson: boolean` → `liveMode: "first" | "third" | "call"`；`loadConfig` 内一行迁移（旧配置 `thirdPerson:true` → `"third"`）。不做向后兼容的双字段。
2. **管线复用**：call 模式输入路径 == first（`submitText` 仅在 `third` 走 `postPlayerLine`；`PlayerPipeline.process` 自守卫 `liveMode==="third"`）。
3. **单 WebGL context 铁律**：小窗模型仍挂共享 Pixi Application（Cubism WebGLManager 单例），用 **Graphics 圆角矩形 mask** 裁剪到小窗区域；窗框（描边/阴影/名牌）用 DOM 覆盖层绘制，拖拽事件挂 DOM 层（天然不与舞台手势冲突）。
4. **小窗布局**：`StageLayout.window?: {x,y,w,h}`（px，相对 stage 容器）；`fit()` 填充式（按窗宽缩放、模型顶部锚定窗内 10% 处 → 半身像取景，通吃全身/半身模型）。look 位移通道（pan）对小窗归零防滑出 mask，转头/侧倾保留。
5. **口型**：call 模式玩家模型 `getMouth` 读 mic level ref + 攻快收慢包络（与 SpeechEngine 同思路）；third 模式维持 TTS 驱动不变。
6. **AI 主视角**：call 模式与 first 完全一致（居中、faceBias 0、行为控制器可用）；仅 third 双模型时保持舞台剧对视 + look 增益归零分界。
7. UI：⚙ 面板与系统设置的「第三人称」开关 → **三段选择器**；third 显示润色/音色，call 只显示玩家模型选择 + 模式说明。

## 改动面

- `src/config.ts`：liveMode 字段 + 默认值 + 迁移；`src/client/types.ts`：PublicConfig/ModelInfo 跟随
- `src/routes.ts`：/config POST 校验 liveMode；/model 返回 liveMode（player 在 third|call 时附带）
- `src/player.ts`：守卫改 liveMode；`src/system-prompt.ts`：call 模式提示行
- `src/client/model.ts`：StageLayout.window + mask + 填充式 fit
- `src/client/view.tsx`：模式状态/挂载分流/look 环路/mic 口型/PiP 拖拽吸附/提交路由
- `src/client/hud.tsx` + `settings-section.tsx` + `styles.ts`：三段选择器、PiP 样式
- e2e：新增 `verify-video-call.mjs`；`verify-third-person.mjs` 改用 liveMode
- 文档：README（liveMode 配置）、CHANGELOG、本目录验证/总结

## 验证

typecheck + build + e2e（4188 实例）三脚本：verify-video-call（新）、verify-third-person（回归）、verify-v11 A/B（依赖完整性）。
