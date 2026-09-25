# 虚拟角色"自然视线行为"调研报告（260925-lively-gaze）

> 背景：浏览器端 Live2D 虚拟陪伴角色插件（手机浏览器，MediaPipe FaceLandmarker 12fps 检测用户鼻尖）。当前实现"角色永远盯着用户鼻尖"，死板。目标：升级为符合真实人类行为的"活"视线——周期性移开注视、感知用户是否在看自己、自然的扫视/眨眼/思考时移开目光等，倾向状态机/随机时序/显式视线脚本序列的算法化方案。
> 本报告覆盖四块：(1) 人类对话注视行为学规律；(2) VTuber/Live2D/游戏/动画现有视线动画方案；(3) 浏览器端头部姿态与视线方向轻量估计；(4) 现成的自然视线行为库/算法。

---

## 0. 结论摘要（先看这里）

1. **真实人类在对话中并不"死盯"对方**：说话时看对方约 30–70%（跨研究差异大），倾听时看对方比例显著更高（约 60–90%）；典型单次互视（mutual gaze）只持续 1–3 秒，超过 ~3.3 秒就会不舒服；单次"看向对方"的社会性注视时长约 2.3–2.7 秒。**"盯着看"的反而是不自然的**。
2. **视线回避（gaze aversion）是有明确功能的**：思考/回忆困难问题时回避率达 ~76%，说话中 ~27–32%，倾听中 ~26–30%；说话开头倾向移开、句尾倾向看向对方移交话轮；回避比例随认知负荷上升。→ 角色的"思考时看别处、说话时看对方、倾听时多看对方"都有真实依据。
3. **眨眼有独立于视线的节律**：静息 ~17 次/分、对话 ~26 次/分、阅读 ~4.5 次/分；倾听者比说话者眨得更多（约 53 vs 35 次/分），且常在话轮结束边界眨眼。Live2D 官方自带随机眨眼（CubismEyeBlink/AutoEyeBlinkInput），改参数即可。
4. **眼球微观运动可以算法化**：固视 2–3 次/秒（时长 200–300ms），扫视服从"主序列"（main sequence，时长 ≈ 37+2.7×幅度 ms，峰值速度随幅度增加），微扫视幅度 ~0.5°、频率 ~1.5–4 次/秒；业界用 **main sequence + 1/f（粉）噪声**即可合成被认为"自然"的眼球抖动（有论文验证）。
5. **"判断用户是否在看摄像头/屏幕"在浏览器端可行且轻量**：MediaPipe FaceLandmarker 直接给 478 点（含虹膜）与面部变换矩阵；用头姿（yaw/pitch）阈值（如 <10° 视为正对）＋虹膜相对眼角位置比（GeoGaze 方案：<0.40 左 / >0.60 右 / 中间为中心）即可得到"用户是否看向屏幕/摄像头"的鲁棒判断，无需额外模型；WebGazer.js 可做标定式屏幕注视点估计（精度约 4°）。
6. **没有"开箱即用、一步到位"的浏览器自然视线库**，但可复用的组件/参照实现很多：Live2D 官方 LookAt 组件（阻尼/混合模式）、pixi-live2d-display 自带 `focus()`、开源项目 moeru-ai/airi 有现成的 `useLive2DIdleEyeFocus` 扫视实现（含 saccade 间隔概率分布代码）、学术上有 Eyes Alive / EGM / NVBG / Andrist 视线回避模型 / Mishra & Skantze 规划式视线控制器等可直接借鉴的参数化方案。**推荐自研一个轻量状态机（gaze state machine）+ 随机时序 + 参数化的视线脚本序列**，这正好符合需求 4。

---

## 1. 人类对话中的真实视线行为学规律

### 1.1 总览：看 vs 不看的基本比例

- 综述性共识（Argyle/Kendon 传统，被 Ho et al. 2015 引用）：**说话者看向听者的比例在 20–65% 之间、听者看向说话者的比例在 30–80% 之间**（跨研究差异很大，与情境/文化/亲密程度相关）。([PLOS ONE 2015, Ho, Foulsham, Kingstone](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0136905))
- 较新的自然对话测量（2024 bioRxiv，Schmaelzle 等，60 段双人对话）：说话时看向对方 ~63%，倾听时 ~79%，**互视约占对话总时长的 ~50%**；社会性注视（看向对方）的典型时长为 **2.3–2.7 秒**，单次互视 ~1.5–2.2 秒。([bioRxiv 2024, Real-world study of mutual gaze](https://doi.org/10.1101/2024.08.20.608820) —— 检索摘要见下方来源列表)
- 面部注视（face gaze）科学报告研究（2018 Nature Sci Rep，Foulsham 等）：互视时看脸的比例 ~60–63%，看眼的比例 28–43%、看嘴 6–17%；**说话时离开对方脸部的时间 ~29%，倾听时 ~10%**。([Nature Scientific Reports 2018, 'What can eyes tell us about face gaze?'](https://www.nature.com/articles/s41598-018-34023-2))
- 文化差异存在（东亚文化中对话中直接注视比例普遍低于欧美），但"说话少看、倾听多看"的总体模式跨文化存在。([PLOS ONE 2015](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0136905))

> **工程含义**：角色"说话中"的目标注视率可以设在 ~50–65%（即 1/3–1/2 时间应移开视线），"倾听中"设在 ~80–90%。单次"看着用户"的时间最好限制在 ~2–4 秒以内，然后移开。

### 1.2 互视（mutual gaze）的时长：短才是自然

- 真实对话中互视片段平均 ~2.2 秒；而静态图片实验中被认为"最舒服"的互视时长约 **3.3 秒**（超过则不适）——真实对话中的互视其实短于人们"觉得舒服"的时长。([Sci Rep 2018](https://www.nature.com/articles/s41598-018-34023-2))
- HRI/虚拟人领域引用"人际互视超过 ~3–5 秒即会触发不适/亲密感越界"，因此机器人/虚拟人设计中单次互视上限常设在 3 秒左右。([Mishra & Skantze 2022, arXiv:2210.02866](https://ar5iv.labs.arxiv.org/html/2210.02866))

> **工程含义**：角色"眼神接触"片段建议 0.5–3 秒随机分布，峰值不超过 4 秒；随后必然移开（1–4 秒）再回来。

### 1.3 视线回避（gaze aversion）的时机与功能

- **认知负荷假说（经典）**：回答中等难度问题时人经常移开视线，回避频率与问题难度正相关，且回避能改善表现（Glenberg 等 5 个实验）。([Glenberg, Schroeder & Robertson 1998, Memory & Cognition](https://doi.org/10.3758/bf03211385))
- **谈话情境的量化**（Doherty-Sneddon 等 2002，儿童/成人对照）：**思考时视线回避率 ~76–78%**，说话时 ~27–32%，倾听时 ~26–30%。（检索到的综述引用，来源：[PMC3627297 - Why do children look away?](https://pmc.ncbi.nlm.nih.gov/articles/PMC3627297/)）
- **话轮管理（turn-taking）功能**（Kendon 经典观察，Ho et al. 2015 复现）：
  - 说话者**开口时倾向移开视线**（说话开始后约 700ms 才看向对方）；
  - 说话者**句尾/即将结束时看向对方**，发出"话轮移交"信号（听者通常在 ~400ms 后接话）；
  - 犹豫/卡顿时反而移开视线（表示"我还要继续说"）。
  ([PLOS ONE 2015](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0136905))
- 回避也是**主动的注意脱离机制**：视觉干扰越强、认知负荷越高，回避越多；任务极轻松时几乎不回避。([Abeles & Yuval-Greenberg 2017, Cognition](https://doi.org/10.1016/j.cognition.2017.06.021))
- 视线回避的类型学（虚拟人领域沿用）：**认知型（cognitive，思考/回忆）、社交型（social，调节亲密/礼貌）、情感型（emotive）**，三类有不同的触发条件与时长分布。([Andrist, Mutlu & Gleicher 2013, Conversational Gaze Aversion for Virtual Agents, IVA'13](https://graphics.cs.wisc.edu/Papers/2013/AMG13/AMG13.pdf))（PDF 无法直接抓取正文，参数细节来自检索摘要：三类回避分别以高斯分布采样 onset/duration，参数由真人对话数据拟合，具体数值见原论文）

> **工程含义**：角色"思考中"（如回答/生成回复时）回避率可设 ~70–80%；"说话中"约 1/3 时间移开；"倾听中"基本不回避。移开动作应与话轮边界对齐：开始说话时移开、句尾看回对方。

### 1.4 眨眼规律（独立的微动作通道）

- 正常受试者：**静息 17 次/分，对话 26 次/分，阅读 4.5 次/分**（log-normal 分布，个体差异大）；认知过程对眨眼率的影响远大于年龄/眼色。([Bentivoglio et al. 1997, Investigative Ophthalmology & Visual Science](https://pubmed.ncbi.nlm.nih.gov/9399231/))
- 倾听 vs 说话：**倾听者眨眼率显著高于说话者**（Bevan & Stanton Fraser 2016 引述：倾听 ~53 次/分 vs 说话 ~35 次/分左右量级）；说话任务中眨眼率还受言语运动复杂度影响。([IEEE RO-MAN 2016](https://doi.org/10.1109/roman.2016.7745182))([Perceptual & Motor Skills 2004, 日语/英语对比](https://journals.sagepub.com/doi/10.2466/pms.98.2.463-472))
- **话轮结束眨眼**：听者倾向于在说话者话轮结束（TCU 边界）前 ~20ms 左右眨眼，作为回应/收尾信号；眨眼率可达 ~30 次/分。([Hömke, Holler & Levinson 2017](https://doi.org/10.1075/is.18.3.02hom) —— 检索摘要来源，原始论文为 Sci Rep "Eye blinks are new indices of turn-taking in human face-to-face interaction")
- 单次闭眼时长典型 100–400ms（平均约 300ms 量级），两次眨眼间隔（IEBI）常见 2–10 秒。

> **工程含义**：角色眨眼率：默认 ~15–20 次/分（间隔均值 ~3–4 秒 + 随机浮动），倾听时比说话时更高；可在话轮边界（句尾）安排一次眨眼。Live2D 官方 CubismAutoEyeBlinkInput 默认 Mean=2.5s、MaxDeviation=2s、Timescale=10，可调（见 §2.1）。

### 1.5 扫视（saccade）与微扫视（microsaccade）的动力学参数

- **主序列（main sequence）**：扫视时长 ≈ 37 + 2.7×幅度(deg) ms；峰值速度随幅度准线性增长、约 15–20° 后饱和（~500–600°/s 上限）。实测扫视统计例：幅度 ~9°，峰值速度 160–410°/s，时长 31–68ms（个体差异大）。([Baloh 经典模型；实测数据见 JEMR 2008](https://doi.org/10.16910/jemr.2.2.4))
- **固视（fixation）**：每秒钟约 2–3 次固视，场景感知早期固视时长 ~194–234ms，后期 ~217–265ms；扫视幅度 ~2.5–5.5°（场景感知）。([JEMR 2008](https://doi.org/10.16910/jemr.2.2.4))
- **微扫视**：幅度通常 <1°（典型 ~0.4–0.5°），频率 ~1.5–4.3 次/秒，时长 ~10–20ms，峰值速度 ~66–100°/s；固定注视时持续产生（"眼睛不死"的来源之一）。([Martínez-Conde, Otero-Millan & Macknik 2013, Nature Reviews Neuroscience](https://doi.org/10.1038/nrn3405))
- **眼球漂移/不自主运动**：注视时除微扫视外还有慢速漂移与瞳孔微动（pupil unrest），可用 **1/f 粉噪声**建模。([Duchowski et al. 2015, MIG '15, Eye movement synthesis with 1/f pink noise](https://dl.acm.org/doi/10.1145/2822013.2822043)；[Normoyle et al. 2016 感知评测：粉噪声抖动最自然](https://onlinelibrary.wiley.com/doi/10.1002/cav.1745))
- **眼-头协调**：小角度位移眼动为主，大角度（>~30°）头动参与；眼通常先动、头后到（虚拟人模型中有 EGM/Andrist 眼头协调模型，见 §2.4）。

> **工程含义**：角色每次扫视 = 选定新注视目标（随机或按状态机）→ 按 main sequence 计算过渡时长/速度曲线（Live2D 里表现为把 ParamEyeBallX/Y 平滑插值到目标值的速度/缓动）→ 在注视间隙叠加微扫视/粉噪声抖动。扫视频率 ~每 0.5–2 秒一次小扫视。

---

## 2. 现有"自然视线/眼神动画"实现方案盘点

### 2.1 Live2D 官方体系（Cubism SDK / Editor）

- **自动眨眼 CubismEyeBlink（官方，可直接用）**：
  - `CubismEyeBlink`（C++/TS/Java）驱动 ParamEyeLOpen/ParamEyeROpen，`SetBlinkingInterval(t)` 使间隔在 **0 ~ 2t 秒间随机**；`SetBlinkingSettings(0.8, 0.2, 0.8)` 配置闭眼过程参数。([Live2D SDK Manual - Automatic eye-blinking](https://docs.live2d.com/en/cubism-sdk-manual/autoeyeblink/))
  - Unity 侧 `CubismAutoEyeBlinkInput`：Mean（默认 2.5s，范围 1–10）、MaximumDeviation（默认 2s）、Timescale（默认 10）；**下一次眨眼时间 = Mean + random×2×MaxDev − MaxDev**，即区间 [Mean−MaxDev, Mean+MaxDev]。([Live2D SDK Tutorial - Automatic Eye-blinking Settings](https://docs.live2d.com/en/cubism-sdk-tutorials/eyeblink/))
  - pixi-live2d-display 同样内置 `model.internal.eyeBlink`（Live2DEyeBlink），可直接复用；注意：直接 `setParamFloat('ParamEyeLOpen', v)` 会被 eyeBlink 每帧覆盖，需先禁用它或覆盖其 update（社区已踩坑，见下）。([pixi-live2d-display issue #4](https://github.com/guansss/pixi-live2d-display/issues/4))
- **视线聚焦 LookAt（官方组件，正是"视线追踪/聚焦"的标准做法）**：
  - Unity 组件：`CubismLookController`（挂模型根节点）+ `CubismLookParameter`（挂到具体参数如 ParamAngleX/ParamEyeBallX 上，配 Axis 与 Factor）+ 实现 `ICubismLookTarget` 的目标对象。Controller 有 **BlendMode（Multiply/Additive/Override）** 与 **Damping**（阻尼/跟随速度），即官方原生支持"平滑地看向目标"而不僵硬。([Live2D SDK Manual - Parameter Operation/LookAt](https://docs.live2d.com/4.2/en/cubism-sdk-manual/parameters/))([Live2D 视线追従の設定 教程](https://docs.live2d.com/cubism-sdk-tutorials/lookat/))
  - 官方示例里 LookTarget 即"鼠标光标位置"，映射到世界坐标后驱动 ParamAngleX/Y/Z、ParamBodyAngleX、ParamEyeBallX/Y（dragX*30、dragY*30、bodyAngleX*10、eyeBallX=dragX 等）。([SDK Manual 参数示例代码](https://docs.live2d.com/4.2/en/cubism-sdk-manual/parameters/))
  - Cubism Editor 内置 **"カーソル追従"（光标跟随）** 与 **"ターゲット追従"（目标跟随，参数控制器）** 功能：可在编辑器内调影响度(%)、反転，并烘焙到关键帧；即"看向某目标"的曲线可以直接在编辑器里预览和导出。([Cubism Editor Manual - Cubism Viewer for OW](https://docs.live2d.com/cubism-editor-manual/cubism3-viewer-for-ow/))([Editor Tutorial - ターゲット追従の設定](https://docs.live2d.com/cubism-editor-tutorials/target-tracking-settings/))
- **Live2D 标准参数名**（用于本项目的驱动面）：ParamAngleX/Y/Z（头旋转）、ParamBodyAngleX/Y（身体）、ParamEyeBallX/Y（眼球）、ParamEyeLOpen/ParamEyeROpen（睁眼）、ParamBreath（呼吸）、ParamMouthOpenY。([Live2D 标准参数文档/官方模型 json；pixi-live2d-display API 中均有对应常量](https://guansss.github.io/pixi-live2d-display/api/variables/CubismWebFramework.ParamEyeBallX.html))

### 2.2 浏览器 Live2D：pixi-live2d-display（本项目渲染栈，重点）

- **自带 `focus(x, y, instant?)`**：让模型看向世界坐标某点，内部经 `FocusController` 插值，**不会立即看过去**（平滑跟随）；`autoInteract` 开启时默认跟随鼠标。这是"看向用户/看向某目标"的现成入口。([pixi-live2d-display - Interactions](https://guansss.github.io/pixi-live2d-display/interactions/))([Live2DModel.ts focus 实现](https://github.com/guansss/pixi-live2d-display/blob/1214833/src/Live2DModel.ts))
- 底层还可直接 `setParamFloat()/addToParamFloat()/multParamFloat()` 驱动任意参数（社区 faceapi 接 webcam 追踪即用此法；注意 motionManager.update 每帧重置参数，需在 update 之后覆盖）。([pixi-live2d-display issue #4](https://github.com/guansss/pixi-live2d-display/issues/4))
- **开源参照实现（强烈推荐看）：moeru-ai/airi 的 `useLive2DIdleEyeFocus`**——用 pixi-live2d-display 模拟"待机时的眼球扫视"：
  - 每次扫视随机选目标 `[rand(-1,1), rand(-1,0.7)]`，`focusController.focus(target*0.5, ...)`；
  - `ParamEyeBallX/Y` 以 lerp 因子 0.3 向目标平滑逼近；
  - 扫视间隔来自自定义概率分布 `randomSaccadeInterval()`：**间隔 400ms 为步长、累积概率分布 [7.5%→800ms, 11%→1200ms, 12.5%→1600ms, 14%→2000ms, 12.5%→2400ms, 5%→2800ms, 4%→3200ms, 3%→3600ms, 2%→4000ms, 其余→4000ms+]**（即每 0.8–4.4 秒扫视一次，峰值在 1.2–2.4s）。([animation.ts](https://github.com/moeru-ai/airi/blob/911572fe/packages/stage-ui-live2d/src/composables/live2d/animation.ts))([eye-motions.ts](https://github.com/moeru-ai/airi/blob/911572fe/packages/stage-ui-live2d/src/utils/eye-motions.ts))
  - 该实现自述 "pretty naive"，但方向正确且已上生产（Airi 项目），是"待机扫视"的最小可运行基线。

### 2.3 VRM / VRoid 体系的 LookAt 规范（可借鉴的参数映射）

- VRM 1.0 规范 `VRMC_vrm.lookAt`：定义 LookAt 空间（head 骨偏移 offsetFromHeadBone 为原点）、yaw/pitch 视线方向、四张 **RangeMap（horizontalInner/Outer、verticalUp/Down）**，每张由 `inputMaxValue`（如 90°）与 `outputScale`（如 10）组成；type=bone 时驱动左右眼骨旋转，type=expression 时驱动 lookUp/Down/Left/Right 表情权重。**本质上就是"视线角度 → 参数"的分段映射**，与 Live2D 的 LookAt 同构，可作序列化方案参考。([VRM spec - lookAt.md](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/lookAt.md))
- UniVRM 运行时 `VRMLookAtHead` 等组件有大量工程细节（坐标空间、乘逆旋转等），但实现较重，浏览器端可只借鉴映射思路。

### 2.4 VTuber 软件如何做"视线追踪"（VTube Studio / OpenSeeFace / VSeeFace）

- **VTube Studio**：官方文档明确把输入分成 头部旋转（ParamAngleX/Y/Z）、**眼睛追踪（EyeLeftX/Y、EyeRightX/Y 参数）**、眨眼/单眼眨、嘴部等；输入参数可自由映射到任意 Live2D 参数（线性/曲线）。跟踪质量排序：**iOS(ARKit) > 手机(ARCore，无眼部追踪) > WebCam**；webcam 模式要求 ≥1280x720、≥10–15fps 才有较好眼部与眨眼追踪，且"webcam 眼部追踪不如 iOS 准确"，需要平滑处理——**说明"webcam 级眼部追踪在消费级实现里普遍噪声大、需要强平滑"是本领域共识**。([VTube Studio Official Documentation PDF](https://denchisoft.com/wp-content/uploads/2021/05/VTube_Studio_Documentation_1_8_0_a.pdf))
- **OpenSeeFace**（VSeeFace 的追踪器）：`--gaze-tracking` 开关启用视线追踪，训练数据为 **MPIIGaze + ~12.5 万张 UnityEyes 合成眼图**；输出 70 个 3D 点 + 视线相关特征（eye_l/eye_r 等）+ quaternion/Euler 头部姿态（PnP）。即开源 VTuber 追踪的视线估计 = **瞳孔点相对眼框的几何特征 + 数据驱动回归**，与 MediaPipe 路线类似。([facetracker.py](https://github.com/emilianavt/OpenSeeFace/blob/master/facetracker.py))

### 2.5 学术界的虚拟人/机器人视线行为模型（可直接参数化借鉴）

| 模型 | 出处 | 核心内容 |
|---|---|---|
| **Eyes Alive** | Lee, Badler & Badler, SIGGRAPH 2002 ([ACM TOG](https://dl.acm.org/doi/10.1145/566654.566629)) | 基于扫视经验模型 + 眼动统计模型合成"活"的眼睛；对比实验证明"统计推导的扫视"比"纯随机扫视"更自然。CG 领域视线合成的开山之作。 |
| **EGM（Expressive Gaze Model）** | Lance & Marsella, IVA'08 | 参数化凝视：目标选择（随机漫步/基于意图）+ 眼头协调（幅度阈值分派给眼/头/身）+ 扫视动态学。 |
| **NVBG（Nonverbal Behavior Generator）** | Lee & Marsella, IVA'06 | 文本/情感驱动的非语言行为生成器，含视线行为规则（看对方/回避/向下等）。 |
| **Pelachaud & Bilvi 视线模型** | IVA'03 ([Springer](https://link.springer.com/chapter/10.1007/978-3-540-39396-2_11)) | 面向对话智能体的注视行为建模（看-移开模式的时序参数）。 |
| **Andrist 等 视线回避模型** | IVA'13 ([PDF](https://graphics.cs.wisc.edu/Papers/2013/AMG13/AMG13.pdf)) | 三功能视线回避（认知/社交/情感），**onset/duration 均按高斯分布采样**（参数由真人对话数据拟合）；用户研究证明该回避行为提升拟人度。 |
| **Andrist 等 眼-头-身协调** | CHI'12 / ICMI'12 / TiiS 2015 ([ACM TiiS 2724731](https://dl.acm.org/doi/10.1145/2724731)) | gaze shift = 眼/头/上身协调运动；调节各部分参与度可控制"注意力信号强度"（教学/亲和两种模式）。 |
| **Rickel Gaze Model** | Lee, Marsella, Traum, Gratch, Lance, IVA'07 | 虚拟人"心智之窗"：根据对话状态（自己说/对方说/思考/听）切换注视策略。 |
| **规划式 Gaze Control System** | Mishra & Skantze 2022 ([arXiv:2210.02866](https://ar5iv.labs.arxiv.org/html/2210.02866)) | 基于 PDDL 规划提前 2 秒生成注视计划（每 200ms 步进）；关键参数：**互视上限 ~3–5 秒、亲密调节回避 ~400ms、话轮持有回避在停顿 >800ms 时触发、话轮移交在句末前 ~1000ms 看向对方**；用户研究显示规划式显著优于纯反应式。**与本项目"sequence 化"诉求最接近的学术方案。** |
| **VividTalker** | ICASSP 2026 ([IEEE](https://doi.org/10.1109/icassp55912.2026.11464801)) | 生理学基础的眼动注入：扫视合成 + **对话眨眼节律 15–20 BPM** + 眼头协调；将注视自然度提升 45%、眨眼真实度 MOS 2.1→4.6。 |

- 眼睑运动学：参数化 **lid saccade（随垂直眼动抬降的眼睑）＋ 眨眼模型（不对称速度曲线）**，生成动画与动作捕捉数据统计上不可区分。([Steptoe, Oyekoya & Steed 2010, Eyelid kinematics for virtual characters](https://doi.org/10.1002/cav.354))
- 眼球运动合成综述级参考：**saccadic main sequence + 1/f 粉噪声（微扫视抖动 + 瞳孔微动）** 的感知评测——粉噪声版本最自然，无抖动或未滤波抖动最不自然。([Normoyle et al. 2016](https://onlinelibrary.wiley.com/doi/10.1002/cav.1745))([Duchowski et al. 2015](https://dl.acm.org/doi/10.1145/2822013.2822043))
- 生物力学级扫视动画：基于眼球肌肉激活模型的物理仿真（研究性质，仅作了解）。([Papapavlou & Moustakas, Physics-based modelling of saccadic eye movement](https://scispace.com/pdf/physics-based-modelling-and-animation-of-saccadic-eye-2jqv2pjb2t.pdf))

### 2.6 游戏/Unity 现成资产（思路参考）

- **Realistic Eye Movements（Unity Asset，Artless Games）**：宣称"使用公开学术研究的人类运动数据"，动画眼/头/眼睑；支持看向玩家的**"社交三角"（左右眼分别 + 嘴部区域）**、随机环视、兴趣点；桌面+移动端。与需求 1–4 的功能点几乎一一对应。([Unity Asset Store](https://assetstore.unity.com/packages/tools/animation/realistic-eye-movements-29168))
- **Eyes Animator**：程序化眼球组件，提供"真实/卡通"模式、随机扫视预设、目标跟随滞后等。([Unity Asset Store](https://assetstore.unity.com/packages/3d/animations/eyes-animator-137246))
- **IrisFX - Procedural eye animation**：GPU 程序化眼睛（含眨眼动画），适合不换几何的方案。([Unity Asset Store](https://assetstore.unity.com/packages/tools/animation/irisfx-procedural-eye-animation-46790))
- 共性：**"随机小扫视 + 目标跟随滞后 + 微抖动 + 独立眨眼"是游戏业做"活眼睛"的标准配方**，与本报告 §1.5 的参数对应。

---

## 3. 浏览器端轻量估计"用户是否在看摄像头/屏幕"

### 3.1 MediaPipe FaceLandmarker 能提供什么（本项目已部署）

- 输出 **478 个 3D 面部 landmark**（含高精度虹膜点，需 `refineLandmarks`/模型配置中的 iris 精度）、**blendshape 系数**、以及 **facial transformation matrix**（`outputFacialTransformationMatrixes: true` 时返回"从 canonical 人脸到检测人脸的变换矩阵"，可直接解出头部 yaw/pitch/roll）。([Google AI Edge - Face landmark detection guide for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js))
- 注意：face mesh 的 z 是**相对鼻梁的训练学深度，不是相机标定的绝对深度**——要得到真 3D 头姿需用 solvePnP 类方法（见下）或直接读 transformation matrix。([The Neural Base - Face mesh for AR 教程](https://theneuralbase.com/mediapipe/learn/beginner/face-mesh-for-ar/))
- 浏览器端现成 head-pose demo：**thshao2/head-tracking-pose-estimation**（FaceLandmarker → transformation matrix → yaw/pitch/roll），可直接抄。([GitHub](https://github.com/thshao2/head-tracking-pose-estimation))

### 3.2 头部姿态估计的三种轻量做法（判断"是否正对摄像头"）

1. **读 transformation matrix**（最省事）：FaceLandmarker 直接给矩阵，解欧拉角即可；已有现成浏览器 demo（上条）。
2. **solvePnP**：用已知 3D 面部模型点（如 6 关键点：左眼外角/右眼外角/鼻尖/下巴/左嘴角/右嘴角）与 2D 像素点求旋转向量；相机矩阵可用近似内参（focal ≈ 图像宽度、主点居中），精度对"是否正对"足够。Python 教程多，JS 可用 OpenCV.js 或手写 PnP（或简化用比例近似）。([The Neural Base 教程](https://theneuralbase.com/mediapipe/learn/beginner/face-mesh-for-ar/)；YouTube 教程 "[Real-Time Head Pose Estimation](https://www.youtube.com/watch?v=-toNMaS4SeQ)")
3. **纯几何三角法（零依赖）**：用脸部关键点 x/z 或 y/z 差分做 atan2 近似 yaw/pitch——Vonage 官方博客的"注意力检测"即此法（pitch 用脸上下缘点、yaw 用两眼外角点的 x/z 平面夹角），并给出**注意力评分阈值：|角度|<10° → 满分；10–30° 线性衰减；>30° → 0**。([Vonage Developer Blog - Attention Detection with Video API](https://developer.vonage.com/en/blog/attention-detection-with-vonage-video-api))

> **工程含义**：yaw/pitch 均 <10°（可加 5–10° 迟滞）→"用户正对摄像头/看向屏幕"；>25–30° → 明确"没在看"。12fps 下建议输出端再做 ~0.5s 窗口的多数表决/低通，避免抖动跳变。

### 3.3 视线方向（眼球朝向）的轻量估计

- **虹膜相对眼角位置比（GeoGaze 方案，训练免费、CPU 66fps）**：取每只眼的眼角内外点 + 虹膜中心，算归一化横向位置比 ρh（及纵向比），直接分档：**ρh>0.60 → 看左，<0.40 → 看右，0.40–0.60 → 中间**；同类论文用 **虹膜偏移 ±15% ≈ 眼球旋转 ±15°** 的线性近似。([GeoGaze, TACS 2026](https://doi.org/10.62762/tacs.2025.798133)；[Wheelchair 视线控制论文（摘要引述）](https://doi.org/10.20944/preprints202408.1774.v1) —— 具体 ±15%/±15° 见原文献)
- **MediaPipe FaceMesh 直接给虹膜点**（468/473 等为虹膜中心，连同眼角点），无需额外模型；把"虹膜相对眼角"与"头部姿态"结合 = 用户视线向量。已有 React 参照项目：**eye-tracking-focus-tracker**（MediaPipe FaceMesh：landmark 468/473 相对屏幕中心 + 头姿 → 0–100% focus 分数）。([GitHub 检索结果 eye-tracking-focus-tracker](https://github.com/xycloo/eye-tracking-focus-tracker))
- **WebGazer.js**（若需屏幕注视点坐标）：自标定式 webcam 眼动追踪库——用点击/光标移动隐式训练 Ridge 回归（眼图 patch → 屏幕坐标），无需专用硬件，浏览器内运行；精度文献报告约 4.17° 视觉角（~104–210px 屏幕误差）。注意项目已停止积极维护（2026 年 2 月最后发布），且初始需要用户点 9 个标定点。([WebGazer.js 官网](https://webgazer.cs.brown.edu/))([npm](https://www.npmjs.com/package/webgazer))
- **Eyes Alive 的简化替代**：其实本项目只需"用户是否看向我"的二值/连续判断，**头姿（3.2）+ 虹膜位置比（3.3）两个信号叠加**就足够，不需要 WebGazer 的标定回归——这也符合"不能引入过重模型"的约束。

### 3.4 用户眨眼检测（可选，用于"同步眨眼/回应"）

- 用 MediaPipe 眼皮点算 **EAR（Eye Aspect Ratio）**，阈值 ~0.18 判定闭眼（有论文用于轮椅驾驶/免提控制，12fps 足够捕捉到 300ms 的眨眼）。([预印本 "Hands-Free Control of Wheelchairs" 检索摘要](https://doi.org/10.20944/preprints202408.1774.v1))

### 3.5 与 12fps / 骁龙 865 约束的适配要点（基于来源的事实性建议）

- VTube Studio 官方经验：webcam 追踪 10–15fps 即可"可用"，但要 720p 且强平滑；**眼部信号噪声大是消费级 webcam 追踪的普遍现象**（iOS ARKit 才准）。([VTube Studio 文档](https://denchisoft.com/wp-content/uploads/2021/05/VTube_Studio_Documentation_1_8_0_a.pdf))
- 头部姿态/视线方向都是**低频信号**（人类头动/眼动多数能量 <5Hz），12fps 采样足够；关键是**输出端低通滤波 + 阈值迟滞**，避免在边界值附近反复横跳。
- 无需在 JS 里跑 OpenCV：transformation matrix 读欧拉角、虹膜比例、EAR 都是纯算术，骁龙 865 上开销可忽略。

---

## 4. 现成"自然视线行为"库/算法盘点（是否存在一步到位方案）

**结论：浏览器端不存在"装一个库就得到自然视线行为"的成熟方案**（VTuber 方向全是软硬件组合 + 直播调参，游戏方向是收费 Unity 资产，学术方向是论文级算法）。但存在大量可直接借鉴/复用的**算法配方与参照代码**：

1. **扫视/微扫视合成算法（有论文级现成配方）**：
   - main sequence（幅度→时长/速度）+ 目标间随机选择 + 1/f 粉噪声抖动（微扫视+瞳孔微动）。([Duchowski 2015](https://dl.acm.org/doi/10.1145/2822013.2822043))([Normoyle 2016](https://onlinelibrary.wiley.com/doi/10.1002/cav.1745))
   - 开源生产代码：moeru-ai/airi 的 `useLive2DIdleEyeFocus` + `randomSaccadeInterval`（pixi-live2d-display 栈，与本项目同栈，可直接移植）。([animation.ts](https://github.com/moeru-ai/airi/blob/911572fe/packages/stage-ui-live2d/src/composables/live2d/animation.ts))
2. **注视行为状态机/参数化方案（学术参照）**：Mishra & Skantze 规划式 GCS 的"注视计划序列"、Andrist 三功能视线回避的高斯分布采样、Pelachaud 的看-移开时序参数。都可映射为"状态 + 参数分布"实现。([arXiv:2210.02866](https://ar5iv.labs.arxiv.org/html/2210.02866))([Andrist IVA'13 PDF](https://graphics.cs.wisc.edu/Papers/2013/AMG13/AMG13.pdf))
3. **Live2D 原生半成品**：CubismEyeBlink（眨眼随机化）+ LookAt（阻尼平滑看向目标）+ pixi-live2d-display `focus()`，组装即可覆盖"眨眼 + 平滑视线"，缺的是"何时看/何时移开"的策略层——这正是要自研的状态机部分。
4. **Gaze/attention 相关浏览器库一览**：
   - WebGazer.js（屏幕注视点回归，自标定）——重、已停维护，本项目未必需要。([官网](https://webgazer.cs.brown.edu/))
   - MediaPipe 系列（FaceLandmarker/FaceMesh）——定位、头姿、虹膜的基础设施。([官方 Web 指南](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js))
   - OpenSeeFace（开源 VTuber 追踪器，含 gaze）——Python/C++ 侧，作参照。([GitHub](https://github.com/emilianavt/OpenSeeFace))

---

## 5. 针对本项目的落地要点（按来源事实组织的建议，非实现指令）

以下为调研所得的、可直接进入设计的关键事实/参数锚点：

**感知层（"用户是否在看角色"）**
- 用户正对判断：FaceLandmarker 变换矩阵（或几何近似）→ yaw/pitch；|yaw|、|pitch| < 10° 判定"正对"，>30° 判定"不在看"（Vonage 评分函数可直接复用）([Vonage](https://developer.vonage.com/en/blog/attention-detection-with-vonage-video-api))；辅以虹膜位置比（ρh 0.40/0.60 阈值）判断眼球朝向 ([GeoGaze](https://doi.org/10.62762/tacs.2025.798133))。
- 输出端 12fps + 低通 + 迟滞即可，无需重模型。

**行为层（角色视线状态机）——参数锚点（全部有行为学/论文出处）**
| 行为 | 推荐参数范围（出处） |
|---|---|
| 说话中看向用户比例 | ~50–65%（即 1/3 到一半时间移开）([PLOS 2015](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0136905), [bioRxiv 2024](https://doi.org/10.1101/2024.08.20.608820)) |
| 倾听中看向用户比例 | ~80–90% ([bioRxiv 2024](https://doi.org/10.1101/2024.08.20.608820), [Sci Rep 2018](https://www.nature.com/articles/s41598-018-34023-2)) |
| 单次互视时长 | 0.5–3s，峰值 <4s（超过 ~3.3s 即不适）([Sci Rep 2018](https://www.nature.com/articles/s41598-018-34023-2), [arXiv:2210.02866](https://ar5iv.labs.arxiv.org/html/2210.02866)) |
| 思考中移开视线比例 | ~70–80%（认知回避）([PMC3627297](https://pmc.ncbi.nlm.nih.gov/articles/PMC3627297/), [Glenberg 1998](https://doi.org/10.3758/bf03211385)) |
| 话轮边界对齐 | 开口移开、句尾看回（移交话轮）([PLOS 2015](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0136905))；回避可触发于停顿 >800ms、移交看向提前 ~1000ms ([arXiv:2210.02866](https://ar5iv.labs.arxiv.org/html/2210.02866)) |
| 眨眼 | 默认 ~15–20 次/分（间隔 2–6s 随机）；倾听>说话；话轮边界可加眨 ([Bentivoglio 1997](https://pubmed.ncbi.nlm.nih.gov/9399231/), [VividTalker](https://doi.org/10.1109/icassp55912.2026.11464801))；可直接用 CubismEyeBlink/AutoEyeBlinkInput（Mean 2.5s/Dev 2s 起步）([Live2D 文档](https://docs.live2d.com/en/cubism-sdk-manual/autoeyeblink/)) |
| 扫视 | 每 0.8–4.4s 一次小扫视（airi 分布现成）([airi eye-motions.ts](https://github.com/moeru-ai/airi/blob/911572fe/packages/stage-ui-live2d/src/utils/eye-motions.ts))；固视 200–300ms、扫视时长≈37+2.7×幅度ms ([JEMR 2008](https://doi.org/10.16910/jemr.2.2.4))；微扫视/抖动用 1/f 噪声叠加 ([Duchowski 2015](https://dl.acm.org/doi/10.1145/2822013.2822043)) |
| 眼-头协调 | 小幅目标眼动为主；大偏移（>~30°）才带 ParamAngle/ParamBodyAngle；眼先动头后到 ([TiiS 2015](https://dl.acm.org/doi/10.1145/2724731)) |

**驱动层（把"看哪里"变成 Live2D 参数）**
- 用 pixi-live2d-display 的 `model.focus(x, y)`（自带平滑）或直接 lerp 驱动 ParamEyeBallX/Y（airi 因子 0.3 量级）([pixi-live2d-display interactions](https://guansss.github.io/pixi-live2d-display/interactions/), [airi animation.ts](https://github.com/moeru-ai/airi/blob/911572fe/packages/stage-ui-live2d/src/composables/live2d/animation.ts))；
- 头部跟随幅度控制：ParamAngleX/Y 乘系数（官方示例 dragX*30、bodyAngleX*10 可参考）([Live2D 参数文档](https://docs.live2d.com/4.2/en/cubism-sdk-manual/parameters/))；
- 注意 motionManager.update 每帧重置参数，自定义驱动需在 update 后执行或包裹 update（社区已验证做法）([pixi-live2d-display issue #4](https://github.com/guansss/pixi-live2d-display/issues/4))；
- 若日后要序列化"视线脚本"，VRM lookAt 的 RangeMap（角度→输出分段映射）结构可作为数据格式参考 ([VRM spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/lookAt.md))。

---

## 6. 参考来源全集

**行为学/心理学**
- Ho, Foulsham & Kingstone (2015). *Speaking and Listening with the Eyes: Gaze Signaling during Dyadic Interactions*. PLOS ONE. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0136905
- Schmaelzle et al. (2024, bioRxiv preprint). *Real-world dyadic gaze*（互视约 50%、社会性注视 2.3–2.7s 等数据）. https://doi.org/10.1101/2024.08.20.608820
- Foulsham et al. (2018). *Face-gaze in conversation*. Nature Scientific Reports. https://www.nature.com/articles/s41598-018-34023-2
- Glenberg, Schroeder & Robertson (1998). *Averting the gaze disengages the environment and facilitates remembering*. Memory & Cognition. https://doi.org/10.3758/bf03211385
- Doherty-Sneddon et al. (2002) 相关综述（思考 76–78% / 说话 27–32% / 倾听 26–30% 数据出处检索自 PMC）. https://pmc.ncbi.nlm.nih.gov/articles/PMC3627297/
- Abeles & Yuval-Greenberg (2017). *Gaze aversions as an overt attentional disengagement mechanism*. Cognition. https://doi.org/10.1016/j.cognition.2017.06.021
- Degutyte & Astell (2021). *The Role of Eye Gaze in Regulating Turn Taking in Conversations: A Systematized Review*. Frontiers in Psychology. https://doi.org/10.3389/fpsyg.2021.616471
- Bentivoglio et al. (1997). *Analysis of blink rate patterns in normal subjects*. IOVS. https://pubmed.ncbi.nlm.nih.gov/9399231/
- Bevan & Stanton Fraser (2016). *Evaluating a mobile spontaneous eye blink tracker...* IEEE RO-MAN. https://doi.org/10.1109/roman.2016.7745182
- Hömke, Holler & Levinson (2017) *Eye blinks as indices of turn-taking*（检索摘要）. https://doi.org/10.1075/is.18.3.02hom
- Pannasch et al. (2008). *Visual Fixation Durations and Saccade Amplitudes*. JEMR. https://doi.org/10.16910/jemr.2.2.4
- Martínez-Conde, Otero-Millan & Macknik (2013). *The impact of microsaccades on vision*. Nature Reviews Neuroscience. https://doi.org/10.1038/nrn3405
- 日语/英语任务眨眼对比 (2004). Perceptual & Motor Skills. https://journals.sagepub.com/doi/10.2466/pms.98.2.463-472

**虚拟人/动画领域**
- Lee, Badler & Badler (2002). *Eyes alive*. SIGGRAPH / ACM TOG. https://dl.acm.org/doi/10.1145/566654.566629
- Andrist, Mutlu & Gleicher (2013). *Conversational Gaze Aversion for Virtual Agents*. IVA'13. https://graphics.cs.wisc.edu/Papers/2013/AMG13/AMG13.pdf
- Andrist, Pejsa, Mutlu & Gleicher (2015). *Gaze and Attention Management for Embodied Conversational Agents*. ACM TiiS. https://dl.acm.org/doi/10.1145/2724731
- Mishra & Skantze (2022). *Knowing Where to Look: A Planning-based Architecture to Automate the Gaze Behavior of Social Robots*. arXiv:2210.02866. https://ar5iv.labs.arxiv.org/html/2210.02866
- VividTalker (2026). ICASSP. https://doi.org/10.1109/icassp55912.2026.11464801
- Steptoe, Oyekoya & Steed (2010). *Eyelid kinematics for virtual characters*. CAVW. https://doi.org/10.1002/cav.354
- Duchowski et al. (2015). *Eye movement synthesis with 1/f pink noise*. MIG. https://dl.acm.org/doi/10.1145/2822013.2822043
- Normoyle et al. (2016). *Perceptual evaluation of synthetic gaze jitter*. CAVW. https://onlinelibrary.wiley.com/doi/10.1002/cav.1745
- Papapavlou & Moustakas. *Physics-based modelling and animation of saccadic eye movement*. https://scispace.com/pdf/physics-based-modelling-and-animation-of-saccadic-eye-2jqv2pjb2t.pdf

**Live2D / VRM / pixi-live2d-display**
- Live2D SDK Manual — Automatic eye-blinking. https://docs.live2d.com/en/cubism-sdk-manual/autoeyeblink/
- Live2D SDK Tutorial — Eye-blinking settings. https://docs.live2d.com/en/cubism-sdk-tutorials/eyeblink/
- Live2D SDK Manual — Parameter Operation（LookAt/LookController/LookParameter 与示例代码）. https://docs.live2d.com/4.2/en/cubism-sdk-manual/parameters/
- Live2D 视线追従の設定（教程，日文）. https://docs.live2d.com/cubism-sdk-tutorials/lookat/
- Live2D Editor — Cubism Viewer for OW（カーソル追従等）. https://docs.live2d.com/cubism-editor-manual/cubism3-viewer-for-ow/
- Live2D Editor — ターゲット追従の設定. https://docs.live2d.com/cubism-editor-tutorials/target-tracking-settings/
- pixi-live2d-display（GitHub / API / Interactions / issue #4）. https://github.com/guansss/pixi-live2d-display · https://guansss.github.io/pixi-live2d-display/interactions/ · https://github.com/guansss/pixi-live2d-display/issues/4
- moeru-ai/airi — useLive2DIdleEyeFocus / randomSaccadeInterval（生产级参照实现）. https://github.com/moeru-ai/airi/blob/911572fe/packages/stage-ui-live2d/src/composables/live2d/animation.ts · https://github.com/moeru-ai/airi/blob/911572fe/packages/stage-ui-live2d/src/utils/eye-motions.ts
- VRM spec — lookAt. https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/lookAt.md

**VTuber 追踪**
- VTube Studio Official Documentation（webcam 眼部追踪要求、参数映射、Mouse Input）. https://denchisoft.com/wp-content/uploads/2021/05/VTube_Studio_Documentation_1_8_0_a.pdf
- OpenSeeFace — facetracker.py（gaze-tracking、MPIIGaze+UnityEyes 训练）. https://github.com/emilianavt/OpenSeeFace/blob/master/facetracker.py

**浏览器视线/头姿估计**
- Google AI Edge — Face landmark detection guide for Web（478 点、blendshapes、transformation matrix）. https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
- The Neural Base — Face mesh for AR（z 非标定、solvePnP 头姿、6 关键点）. https://theneuralbase.com/mediapipe/learn/beginner/face-mesh-for-ar/
- thshao2/head-tracking-pose-estimation（transformation matrix → yaw/pitch/roll demo）. https://github.com/thshao2/head-tracking-pose-estimation
- Vonage — Attention Detection with Video API（几何 yaw/pitch、10°/30° 评分）. https://developer.vonage.com/en/blog/attention-detection-with-vonage-video-api
- GeoGaze（虹膜相对眼角位置比、0.40/0.60 阈值、66fps CPU）. https://doi.org/10.62762/tacs.2025.798133
- WebGazer.js. https://webgazer.cs.brown.edu/ · https://www.npmjs.com/package/webgazer
- 轮椅免提控制预印本（EAR≈0.18 眨眼、±15%≈±15° 视线近似，检索摘要）. https://doi.org/10.20944/preprints202408.1774.v1
- eye-tracking-focus-tracker（MediaPipe FaceMesh 专注度示例）. https://github.com/xycloo/eye-tracking-focus-tracker

**Unity/游戏资产（思路参照）**
- Realistic Eye Movements. https://assetstore.unity.com/packages/tools/animation/realistic-eye-movements-29168
- Eyes Animator. https://assetstore.unity.com/packages/3d/animations/eyes-animator-137246
- IrisFX - Procedural eye animation. https://assetstore.unity.com/packages/tools/animation/irisfx-procedural-eye-animation-46790

> 说明：部分 PDF（Andrist IVA'13、VTube Studio 文档）与预印本仅有摘要级信息被本报告引用；标有"检索摘要"的条目表示具体数值来自搜索结果中的论文摘要而非全文精读，引用前建议打开原文复核。webgazer 维护状态（2026-02 末版）与 VividTalker 等时效性信息以检索当时为准。
