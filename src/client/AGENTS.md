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
- `voice-library.tsx` — 音色库浮层：检索/试听/选用 Fish 公共音色（portal 到 `document.body`）
- `selectors.tsx` — 模型/音色/LLM 三类选择器（音色选择器 = 当前音色行 + 音色库入口）
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
  - 参数 ID 拼写**不由文件格式决定**：大量 moc3 模型（旧版移植、游戏拆包）沿用 Cubism 2.1 的 `PARAM_*` 大写命名，写错拼写是静默无效。统一走 `param-ids.ts` 的 `resolveParamIds(kind, has)` 按模型真实参数表解析；解析结果同时发布到 `container.dataset.lvParamIds`（双模型另发 per-tag `lv{Ai,Player}ParamIds`，回归 `e2e/verify-param-ids.mjs`）。
  - **moc2 不做参数探测**：Cubism 2.1 core 没有可枚举的参数表，且它的 `getParamIndex()` 对未声明的 id 同样发放**幻影索引**（实测首个未知 id 返回的索引正好等于真实参数总数）——探测必然假阳性，会把大写模型写进 camelCase 幻影参数（261010 回归，`e2e/verify-param-ids.mjs` 的 zongzi 用例看住）。moc2 一律用格式默认的大写拼写。
  - 写参数时序：`beforeModelUpdate` → `model.update()`（raw 消费参数重算 drawables）→ `loadParameters()`（恢复 motion 态）；draw 只读 drawables。绝对写入放 `beforeModelUpdate` 是正确位置（唇形同步/视线同款路径）。
  - `raw.drawables.vertexPositions` 是 per-drawable 的数组套数组，不是扁平 Float32Array。
  - VLM（modlens）对 13~30° 头部转向的判断不可靠（多次把明显转头判成"正面"）；视觉回归一律用受控 A/B 像素 diff（同一页面两状态截图 + PIL 阈值统计）。
- **点击互动与拖动共存在同一套指针监听里**（model.ts）：`press` 记录起点/时刻/是否命中该化身，位移 >8px 或时长 >500ms 即判为拖动（`pointercancel` 不算点击）。命中判定用 `model.hitTest(x, y)`（**参数是 stage 坐标**，内部自行转模型坐标；库里的 Cubism4 wrapper 对未声明的 hit area 不会幻影命中），模型没声明 HitAreas 时回退可见包围盒；点空白**不响应**。Tap 动作按 `Tap<区域名>` → `Tap` → `TapBody` 找组，用 `NORMAL` 优先级播，走与 flick 同一条 `startGesture()`（空闲时照常起播；上一个动作是**动作缘起**时抢占它，是剧本动作时让位给剧本）。`dataset.lvTap`（`区域:组名`，仅在真的起播时写入）是 e2e 契约。
- **动作音效必须在绑定时摘掉**：框架的 `MotionManager.startMotion` 会播放动作自带的 `Sound`（`getSoundFile(definition)`），本机模型库里 33/37 个音效文件真实存在 → 角色会随机说出模型附带的录音。`mountModel` 里删 `internalModel.motionManager.definitions[*][*].Sound`。
- **判断"是否正在放音"不要用 `currentSpeaker()`**：它永远返回具体 speaker（默认 `assistant`），拿它当布尔会永久置真——空闲调度器曾因此完全失效（261010）。用 `engine.speaking()`（活跃 BufferSource）。
- **空闲调度**：有 `Idle` 组按 `idleInterval`，没有则回退空名组并把间隔收紧到 `min(idleInterval, 6)`（拆包模型的空名动作是短片段，20s 一次像立牌）；空闲动作以 `IDLE` 优先级播，避免抢占用户/真实动作。契约 `dataset.lvIdleInterval`。
- **`.lv-hud` 现在是透明 root layer**（`inset:0; pointer-events:none`），外观/定位在 `.lv-capsule`（底部胶囊）与 `.lv-corner`（右上角视图按钮簇）上：保留 `.lv-hud` 类名是为了 e2e 选择器（`.lv-hud button[title*=…]`、`.lv-hud .lv-mic`、`display:none` 隐藏整层做像素测量）零改动；**读 `.lv-hud` 的几何会拿到满屏矩形**，要量胶囊请用 `.lv-capsule`。淡出规则必须写成子元素作用域（`.lv-hud.lv-faded .lv-capsule|.lv-corner:not(:hover):not(:focus-within)`），写回 `.lv-hud:hover` 会因整层恒被 hover 而永久失效。`.lv-pop` 的 containing block 因此变成 `.lv-capsule`（胶囊保留绝对定位，别再加 `position:relative`）。
- **触摸模式（`touchMode`）**：单指在触屏上 = 视线指针（`touchLook` 通道喂给 view 的 look 管线，松手 450ms 缓动回落），双指才平移缩放；鼠标 hover 跟视线、拖拽仍平移。`touchMode` 是**挂载后才可能从配置恢复的状态**，所以除了 effect 同步，`mountModel` 的 `.then` 里必须补一次 `mounted.setTouchMode(touchModeRef.current)`——否则配置先到、模型后到，模式会一直停在 false（261010 实测踩过）。诊断契约 `dataset.lvTouchLook`（双模型读 per-tag `lv{Ai,Player}TouchLook`）。
- **手势动作（flick）**：判定/方向/组选择都在纯模块 `gesture-math.ts`（表驱动断言），model.ts 只做事件胶水；方向一律取主轴（对角线不是 Shake 桶），组回退链 `Flick<方向>` → `Flick` → `Shake` → 不动；优先级 NORMAL + 400ms 冷却。
- **动作抢占（261010-gesture-preempt）**：NORMAL 撞 NORMAL 会被框架拒，而"上一个动作的整个播放期"就是死区（片长 1.9~4.1s），所以按**来源**分流而不是按"有没有动作在播"分流：`startMotion()` 是**唯一**的动作起播入口，**成功起播时**才把 `playingSource` 写成 `idle|script|gesture`（被拒的请求不能写——待机调度会在被占用的通道上请求 IDLE，写进去就把标记改成 idle，下一次滑动会掉回静默丢弃）。`startGesture()` 承载三态：`gesture` → 抢（`stopAllMotions()` 后重试，`lvPreemptGesture`+1）；`script` → 不碰剧本（`lvRejectScript`+1 + HUD 手指按钮闪 200ms）；否则放弃。**tap 与 flick 共用这条路径**（都是动作缘起输入）。契约：`lvPreemptGesture` / `lvRejectScript` / `lvRejectCooldown` / `lvRejectInvalidGesture`（挂载即发布 0）+ `dataset.lvGesture`。禁止用 `onFinish` 清标记：循环动作永不触发，且公开路径没把 onFinish 传给 `_startMotion`。
- **测量坑**：跨抢占的姿态序列必须采在 `afterMotionUpdate`（动作混合刚写完），**不能**采在 `beforeModelUpdate`——那里读到的参数已被库自带 `autoInteract` 的 focus（pointermove → `focus*30` → ANGLE_XYZ）改过，滑动本身就会留下 ~30° 合法尖峰，把"跳变"阈值抬到 45°，负对照再也红不了。同理，用 evaluate 往返计时卡 400ms 冷却窗口必失败（实测落在 ~500ms，测出来的是死区不是冷却），连发滑动要在页内用页面时钟做。
- **触摸/手势 e2e 要用合成 PointerEvent**（`pointerType:'touch'`）：playwright 的 `page.mouse` 是 `pointerType:'mouse'`，走不到触摸分支；滑动要保证 `durationMs > 0`（同一个 tick 里发 down+up 会被速度/时长判定拒绝）。
- **运行时注入的 `<style>` 必须打 `data-plugin="dsh-live2d-voice"` 标**（styles.ts `injectLiveStyles` 已做）：宿主在 materialize 时机用 `claimStyles` 把未打标 style 认领给下一个 materialize 的插件，该插件 HMR 重载时会 `removeOwnedStyles` 连带删除——任何插件连续两次 rebuild 就能让本插件全部样式消失（260925 Live 按钮失样式 bug，回归 `e2e/verify-style-claim.mjs`）。新增任何 DOM 注入样式的路径时同样处理。
- 字幕 DOM 类名（`.lv-sub-card` / `.lv-sub-old` / `.lv-sub-pending`）是 e2e 脚本的断言契约，改名或重构字幕结构时同步更新 `e2e/verify-*.mjs` 选择器。
- audioSeq 字幕 hold 的 seq 空间**按 speaker 隔离**：assistant 与 player 的 seq 计数器各自每轮从 0 起，engine 的 `currentSeq(speaker)` 按 speaker 过滤——跨 speaker 比较 seq 会击穿 hold（字幕提前或立即释放）。
- **第三人称对视世界观**：双模型是"舞台剧"，两角色基准朝向对方（faceBiasX ±0.6 → ±13.2°（faceBiasAngle 固定 22°，与 angleRange 解耦））、仿佛不知道玩家存在；视线/陀螺仪输入在 dual 下只做 panRange 位置视差（angleGain/eyeGain/rollGain 归零，HUD 对应滑条禁用并标注"对视停用"），不驱动转头看用户；单模型模式保持"角色看你"不变。改 look 管线时保住这个分界。
- **look 参数结构**：统一动作增益（`angleGain`/`eyeGain`/`rollGain`/`panGain`）+ 源灵敏度倍率（`camSensitivity`/`gyroSensitivity`）；陀螺仪输入底层自带负基数（-0.3），逆向视差与量级校准由底层收口，配置层无需填负数。`mixLookChannel` 把两路 `输入 × 增益` 相加并饱和到 ±1，`angleRange`/`rollRange`/`panRange` 仍是硬上限。新增 look 通道时同步 `LOOK_SLIDER_GROUPS`、`SIGNED_LOOK_KEYS`、第三人称停用集合，并跑 `e2e/verify-look-math.mjs`（纯数学）与 `e2e/verify-look-sliders.mjs`（面板契约）。
- **portal 出去的浮层要自带 `.lv-vlib-scope`**：设计令牌（`--lv-*`）定义在 `.lv-root` 上，portal 到 `document.body` 的 DOM 不在该子树里，不加这个类就拿不到任何主题变量（浅色/深色都失效）。同时 `.lv-stage` 带 CSS transform，`position: fixed` 的浮层若留在它子树内会被 transform 劫持成相对定位——浮层一律 portal 到 body。
