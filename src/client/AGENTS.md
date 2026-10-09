# src/client AGENTS.md

## 职责

浏览器侧 Live2D 视图：模型渲染（pixi v7 + Cubism）、音频播放队列与口型驱动、字幕/HUD/设置 UI、SSE 事件消费、与 host 插件路由的 API 交互。构建产物 `lib/client.js`（react runtime external，pixi/live2d 打包，`@deepseek-ai/*` external 由宿主提供）。

## 地图

- `view.tsx` — 视图主组件：SSE 事件分发（按 speaker 分流 assistant/player）、双模型挂载与布局、字幕/输入/回声参照
- `engine.ts` — SpeechEngine：AudioContext 播放队列、RMS 包络、说话人感知（speakerSpans / currentSpeaker / mouthValue(speaker)）
- `model.ts` — Live2D 模型挂载：createLive2DStage（共享 Pixi Application）、mountModel(shared?)、setLayout
- `look-math.ts` — 视线/陀螺仪混合的纯函数（`mixLookChannel`，带符号增益），可被 node 直接跑测试
- `hud.tsx` — HUD 按钮与 ⚙ 快捷面板（音色/模型/语言/第三人称等）
- `settings-section.tsx` — 系统设置里的插件设置卡
- `subtitle.tsx` / `styles.ts` — 字幕渲染与全部样式
- `api.ts` / `types.ts` — host 路由调用与共享类型（`Speaker` 等）

## 核心设计

- **共享 Pixi Application**：第三人称模式下双模型（AI + 玩家）挂同一个 `SharedStage`（同一 WebGL context）。view 顶层 effect 创建/销毁 stage；模型 mount 传 shared，destroy 只销毁 model 不动 app/canvas；布局变化走 `setLayout`，不重载模型。
- **SSE 事件 speaker 字段**：事件名全部复用（speech-start/audio/subtitle/expression…），payload 带 `speaker?: "assistant" | "player"`，缺省 = assistant（向后兼容）。音频单队列天然保证先玩家后 AI（host 侧玩家台词 TTS settle 后才向 agent 提交）。**事件顺序约定：expression 必须在 speech-start 之后发射**——客户端 onExpression/onAudio 按 active-utterance 门控，active 由 speech-start 更新，先到的表情会被静默丢弃。
- 面板值（⚙/系统设置）→ saveConfig → fetchModelInfo 回读驱动视图 effect——配置文件是单一事实源，客户端不自行推导。

## Pitfalls

- **Cubism SDK 的 WebGLManager 是全局单例**，持最后一次 init 的 gl 指针。**绝不能开第二个 WebGL context 装模型**（双 Pixi Application / 双 canvas 叠放都会触发）：后挂载的 context 抢占单例，先挂载的模型每帧 bindTexture 全部 INVALID_OPERATION、渲染空白且无报错日志。多模型必须共享同一 Application（见 model.ts SharedStage）。
- **手势监听（pan/pinch/wheel/dblclick）必须挂在每个 mountModel 实例上，shared 模式也不例外**（14bd6e4 曾用 `if (!shared)` 跳过挂载，而 view.tsx 所有模型都传 shared → 手势全灭的回归）。跨模型共享 state 走 `SharedStage.gestures`（GestureRegistry: mounts + dragOwner）：全部模型注册进同一份 mounts，pointer-down 打点判定「手指落在哪个化身」；单指/左键拖动只移动命中的那个模型，空白（或中/右键）拖动 = 全局相机平移（两模型同动），pinch/wheel/dblclick 恒为全局（260925 修复：非共享注册表时每实例 hit-test 只认自己 bounds，拖任一化身两个都动，"单独拖动"形同虚设）。任意模型 destroy 必须把自己从 registry 移除；新增模型挂载路径时检查 destroy 的对称移除。
- **`dataset.lvTransform`（.lv-stage 上，"panX,panY,scale"）是 e2e 手势断言契约**：单模型模式由唯一写者写入、稳定可靠；双模型（第三人称）下两个模型每帧都写（last-writer-wins 竞态），区分「哪个模型动了」必须读 per-model 键 `dataset.lvAiTransform` / `dataset.lvPlayerTransform`（mountModel 第 7 参 tag 指定，view.tsx 传 "Ai"/"Player"），不可读共享 lvTransform。与字幕 DOM 类名同级：改 applyTransform/手势结构时同步更新 `e2e/verify-*.mjs` 断言；e2e 里拖动前先点 `.lv-pop-close` 关设置弹窗（弹窗是 stage 兄弟节点，会拦截指针）。
- **视觉/参数断言的方法论**（260925 排查"angle 不渲染"半天的教训，实际是 VLM 误判）：
  - framework `getParameterValueById` 对不存在的 id 走侧字典（`_notExistParameterId`）照样返回值——readback ≠ 参数存在；判存在用 `coreModel._model.parameters.ids` 或 `strings xxx.moc3`。**`getParameterIndex(id)` 同理不能当存在性判断**（未命中同样落侧字典拿合成索引），`model.ts` 的 `hasParam` 一律走真实 id 表。
  - 参数 ID 拼写**不由文件格式决定**：大量 moc3 模型（旧版移植、游戏拆包）沿用 Cubism 2.1 的 `PARAM_*` 大写命名，写错拼写是静默无效。统一走 `param-ids.ts` 的 `resolveParamIds(kind, has)` 按模型真实参数表解析；解析结果同时发布到 `container.dataset.lvParamIds`（诊断 + e2e 契约，回归 `e2e/verify-param-ids.mjs`）。
  - 写参数时序：`beforeModelUpdate` → `model.update()`（raw 消费参数重算 drawables）→ `loadParameters()`（恢复 motion 态）；draw 只读 drawables。绝对写入放 `beforeModelUpdate` 是正确位置（唇形同步/视线同款路径）。
  - `raw.drawables.vertexPositions` 是 per-drawable 的数组套数组，不是扁平 Float32Array。
  - VLM（modlens）对 13~30° 头部转向的判断不可靠（多次把明显转头判成"正面"）；视觉回归一律用受控 A/B 像素 diff（同一页面两状态截图 + PIL 阈值统计）。
- **运行时注入的 `<style>` 必须打 `data-plugin="dsh-live2d-voice"` 标**（styles.ts `injectLiveStyles` 已做）：宿主在 materialize 时机用 `claimStyles` 把未打标 style 认领给下一个 materialize 的插件，该插件 HMR 重载时会 `removeOwnedStyles` 连带删除——任何插件连续两次 rebuild 就能让本插件全部样式消失（260925 Live 按钮失样式 bug，回归 `e2e/verify-style-claim.mjs`）。新增任何 DOM 注入样式的路径时同样处理。
- 字幕 DOM 类名（`.lv-sub-card` / `.lv-sub-old` / `.lv-sub-pending`）是 e2e 脚本的断言契约，改名或重构字幕结构时同步更新 `e2e/verify-*.mjs` 选择器。
- audioSeq 字幕 hold 的 seq 空间**按 speaker 隔离**：assistant 与 player 的 seq 计数器各自每轮从 0 起，engine 的 `currentSeq(speaker)` 按 speaker 过滤——跨 speaker 比较 seq 会击穿 hold（字幕提前或立即释放）。
- **第三人称对视世界观**：双模型是"舞台剧"，两角色基准朝向对方（faceBiasX ±0.6 → ±13.2°（faceBiasAngle 固定 22°，与 angleRange 解耦））、仿佛不知道玩家存在；视线/陀螺仪输入在 dual 下只做 panRange 位置视差（camAngleGain/gyroAngleGain/camEyeGain/gyroEyeGain/camRollGain/gyroRollGain 归零，HUD 对应滑条禁用并标注"对视停用"），不驱动转头看用户；单模型模式保持"角色看你"不变。改 look 管线时保住这个分界。
- **look 增益是带符号振幅，不是混合权重**：`LookParams` 的八个增益（cam/gyro × 转头/眼球/旋转/位移）都是该源的**振幅倍率**：负值 = 该通道与输入反向，0 = 该源不参与，线性可缩放到极小（0.005 就是 0.5% 幅度）。`mixLookChannel` 直接把两路 `输入 × 增益` 相加并饱和到 ±1，`angleRange`/`rollRange`/`panRange` 仍是硬上限——**不要再退回「归一化权重」写法**：分母取增益绝对值会让单源时幅度被约掉（0.005 与 1 等效），这正是 261010 修掉的 bug。头身与眼球各有独立增益对（`camEyeGain`/`gyroEyeGain`），眼球不再被迫跟随转头幅度。物理位移走另一条路径（`applyTransform` 里 `camPanGain`/`gyroPanGain` 直接相乘、不饱和），滑条范围 -3..3 容纳默认 -2。新增 look 通道时同步 `LOOK_SLIDER_GROUPS`（正负范围 + `lv-signed` 类 + tip）、`SIGNED_LOOK_KEYS`、第三人称停用集合，并跑 `e2e/verify-look-math.mjs`（纯数学）与 `e2e/verify-look-sliders.mjs`（面板契约）。
