# 「用 AI 把自己的 OC 变成 Live2D」可行性、技术边界与落地路线调研

- 调研日期：2026-10-10（Asia/Shanghai）
- 调研范围：从单张立绘/插画出发做 Live2D 建模的全链路 AI 辅助现状（自动切图 / 遮挡补全 / 自动绑定 / 参数与动画生成）；替代格式（PNGTuber / Spine / VRM-3D）；开源项目、商业产品、学术论文、社区实践与代工行情；输入要求、输出质量、价格、耗时、版权与商用限制；最省力现实路线。
- 说明：本报告所有事实均附来源链接；原文为日/英文处保留原术语。「现状判断」类段落仅复述来源的结论，不做无依据延伸。

---

## 0. 结论速览（TL;DR）

| 问题 | 现状（2026-10） | 依据 |
|---|---|---|
| 「一张图进、可直播的 Live2D 模型出」的一键工具存在吗？ | **不存在**。整条链路中「概念设计」和「素材分层」两段已被 AI 大幅加速，**绑定（rigging）这一段仍无任何工具能自动化到可直播质量**。ArcLoop 的指南直接写明「这台机器并不存在」；See-Through 作者自己的 GitHub README 也写「Is this Image-to-Live2D? We don't think so — at least, not yet.」 | [ArcLoop](https://arcloop.ai/handbook/zh-CN/ai-art-to-vtuber-model-pipeline)、[see-through README](https://github.com/shitagaki-lab/see-through) |
| 学术上被解决了吗？ | 2026-07 出现了**首个端到端系统** Bunraku（单张立绘 → 有序 RGBA 层 + 每层形变网格 + 参数驱动的 keypose 顶点位移），并发布了 Live2D-Bench 与 8,884 模型语料。但论文自己给的指标是「per-vertex direction cosine 0.768（中位数 0.828）」，且未见公开可用的推理代码/权重。**属研究前沿，不等于可用工具** | [arXiv:2607.27348](https://arxiv.org/abs/2607.27348) |
| 分层/补全有可用的开源工具吗？ | **有**。See-Through（Apache-2.0 + OpenRAIL++ 权重，允许商用）可把单张动漫图切成最多 23 层（含遮挡区域 inpaint）并导出 PSD；HF Space / ModelScope 有免费 demo | [GitHub](https://github.com/shitagaki-lab/see-through)、[HF 权重页](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d) |
| 自动绑定有可用工具吗？ | **只有实验性项目**：psd2live（PSD→cmo3/moc3，自带 MCP 接口）、Stretchy Studio（浏览器端，可导出 Live2D runtime 与 cmo3）、Live2D Master Agent（一句话全流程）。三者均自述「未通过 Cubism Editor 效果一致性验收」或处于早期；**社区对它是否骗人也很有争议** | [psd2live](https://github.com/tsunehimatoi/psd2live)、[Stretchy Studio](https://github.com/pelmentor/stretchystudio)、[Live2D Master Agent](https://github.com/mw2wbyys6t-sudo/Live2D) |
| 官方 Cubism Editor 有什么 AI 能力？ | 5.0 起有「面部动作的自动生成」；5.1 起有「变形器的自动生成」「摇摆运动的自动生成」；另有「自动网格生成」「自动图形路径生成」。全部是**编辑器内的半自动辅助**，不是自动建模 | [变形器自动生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/auto-generation-of-deformer/)、[5.1 新功能](https://docs.live2d.com/zh-CHS/cubism-editor-manual/new-function5-1/) |
| 官方对「全自动」的态度？ | Live2D 官方 AI 研究政策明文：**「AIによる全自動モデリングは目指しません」**，且「イラストから全自動でLive2Dモデル化するような研究はLive2D社では行いません」 | [nizima AI研究ポリシー](https://docs.nizima.com/ai-research-policy/) |
| 花钱找人做要多少？ | 中文圈一条龙 2,000–6,000 元（米画师某橱窗 5,580 元/套卖了 30 件）；纯建模 800–2,000 元。日本 モデリングのみ 8–15 万円、フルセット 15–22 万円。Fiverr 纯绑定 70–200 美元（头/半身/全身），画+绑 600–1,000 美元 | [cpengx](https://www.cpengx.cn/productivity/m-ai-live2d.html)、[shiroikarasu](https://shiroikarasu.net/live2d-vtuber-model-guide/)、[Fiverr gig](https://www.fiverr.com/nekkonimestore/design-and-rigging-anime-character-live2d-model-and-vtuber-for-stream) |
| 时间？ | 专业模型师做一个全身模型 **4–8 周、约 1,000 美元**（Bunraku 论文）；日本 wiki 的工时拆分：立绘 3 天 / 拆件 3 天（50 件，30 分钟/件）/ 建模 3 天 / 动作 6 小时。自学：3 个月入门、6–8 个月能商用、1 年熟练 | [arXiv:2607.27348](https://arxiv.org/abs/2607.27348)、[live2d.wiki](http://live2d.wiki.fc2.com/wiki/Live2D%E3%83%A2%E3%83%87%E3%83%AB%E4%BD%9C%E6%88%90%E8%B2%BB) |
| 最大的两个法律雷 | ①**自己的 Live2D 语音对话网页应用 = Expandable Application（可扩展性应用程序）**，即使个人也要单独审查+签约+分成；②**nizima / Live2D Creative Awards 全面封禁「图片生成 AI 制作的插画」及其 Live2D 化作品**（用检测工具审） | [Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/)、[nizima AI政策](https://docs.nizima.com/guide/ai-policy/) |

---

## 1. 流程基线：传统 Live2D 全流程每一步在干什么、要多少工

参考来源：[410STUDIO 流程解说](https://www.410studio.co.jp/column/live2d-model-production-flow)、[KEREN 术语讲座](https://kerenblog.com/2025/06/14/live2d/)、[shiroikarasu 2026 版指南](https://shiroikarasu.net/live2d-vtuber-model-guide/)、[ArcLoop 中文流程指南](https://arcloop.ai/handbook/zh-CN/ai-art-to-vtuber-model-pipeline)、[psd2live 的图层命名规范](https://github.com/tsunehimatoi/psd2live)。

1. **角色设计**：人设、配色、轮廓、2–3 个「任何表情下都不变」的身份锚点。
2. **立绘（对应 Live2D 的构图）**：中性姿势、正面或 3/4 侧、**手臂离开躯干**、头发边界清晰。分辨率要够用——委托圈的常见标准是 **4000px 量级画布**（ArcLoop 原文写「4000px 量级」，并要求在开始切图之前就把主图生成/放大到位，因为部件在绑定中会被缩放和形变）。
3. **素材分层 / 拆件（官方术语「素材分け」，俗称「切图」「拆分」）**：把一张图拆成 30–60 个以上（精致委托远超此数）命名图层，并且**把画面里被遮住的部分补画出来**——刘海下面的额头、睫毛下面的眼睑、张口时的口腔内部、外套下面的躯干。
   - 真正的分层「工作原理」是：只有被单独画出、能被独立形变的部分才能动；**看不见的地方必须人工/工具「幻觉」出来**，这正是 See-Through 论文要解决的问题（[ACM SIGGRAPH 论文](https://dl.acm.org/doi/full/10.1145/3799902.3811209)）。
4. **建模 / 绑定（rigging）**：导入 PSD → 每个部件建三角网格（ArtMesh）→ 建变形器（Warp / Rotation / Glue）→ 建参数（ParamAngleX/Y/Z、ParamEyeLOpen…）→ 做 keyform 与物理。见 [官方导出格式说明](https://docs.live2d.com/zh-CHS/cubism-editor-manual/export-moc3-motion3-files/)。
5. **动画 / 口型 / 表情**：待机动作、物理摆动、面捕参数映射、按键表情。
6. **接入**：VTube Studio / nizima LIVE / SDK for Web / Unity 等。

### 官方对「一张图需要多少层」的部件命名口径（可直接当拆件清单用）
psd2live 项目整理了一套中英日对照的部件命名规范，可作为拆件目标清单：

| 部位 | 推荐英文名 | 常用中文/日文别名 | 行为 |
|---|---|---|---|
| 头发 | front hair / back hair | 前发、后发、前髪、後ろ髪 | 独立头壳跟随 + 物理摆动 |
| 脸 | face / facedetail | 脸、脸颊、顔、肌、腮红 | 轮廓与细节 |
| 眼睛 | eyewhite / eyelash / irides / eye_close | 眼白、睫毛、瞳孔、闭眼 | 支持左右拆分、瞳孔剪切 |
| 眉毛 | eyebrow | 眉、眉毛、まゆ | 左右拆分 + 透视联动 |
| 鼻子 | nose | 鼻 | 最大立体深度位移 |
| 嘴巴 | mouth / mouth_open | 嘴、口、张嘴 | 最大张口原图（**建议带清晰描边**） |
| 口腔内 | tooth-t / tooth-b / tongue | 上牙、下牙、舌头 | 以 mouth 为剪切蒙版 |
| 身体 | neck / topwear / bottomwear / legwear | 脖子、上衣、裤子、裙子 | 偏航、俯仰、呼吸 |
| 饰品 | headwear / earwear / neckwear / tail / wings | 头饰、耳饰、项链、尾巴、翅膀 | 挂载父级变形器 |

来源：[psd2live README](https://github.com/tsunehimatoi/psd2live)

### 工时与部件数量的行业口径
- 日本 wiki 的逐项报价/工时（可作为「全手工」基准）：
  - 立绘作成 3 日 / 24 小时 / 10 万円
  - PSD 部件分割 3 日 / 10 万円（50 部件，**约 30 分钟 1 件**）
  - Live2D 建模 3 日 / 10 万円
  - 动作制作 6 小时 / 2 万円
  - FaceRig 集成 3 小时 / 1 万円
  - **合计 34 万円**
  来源：[live2d.wiki.fc2.com](http://live2d.wiki.fc2.com/wiki/Live2D%E3%83%A2%E3%83%87%E3%83%AB%E4%BD%9C%E6%88%90%E8%B2%BB)
- 部件数分级（日本接单方口径）：超简易 50–100 件 / 简易 100–150 / 标准 150–200 / 复杂 200–300 / 最高级 300+。来源：[kraz-live2d 料金](https://kraz-live2d.com/price/)
- 专业模型师工时（论文口径）：**4–8 周、约 1,000 美元 / 全身模型**；模型由 30–100 个 RGBA 层组成。来源：[Bunraku 论文](https://arxiv.org/html/2607.27348v1)
- 一个社区开发者（独立项目 LUSE）的复盘：纯建模师「**4–8 小时**」能产出一个可用 rig；而程序化自动生成「任意角色动画级 rig」**目前无解**。来源：[Patreon Dev Note 3](https://www.patreon.com/posts/dev-note-3-live-158420264)

---

## 2. 现状总览：各环节自动化程度分级（2026-10）

| 环节 | 自动化程度 | 可用工具 / 方法 | 剩余人工 |
|---|---|---|---|
| 概念设计 / 立绘 | ★★★★★ | Gemini/即梦/Grok/SDXL/Flux/ComfyUI，角色一致性用「角色资产+参考图」锁 | 选图、局部修（分辨率放大到 4000px 级） |
| 单图 → 分层 PSD（含遮挡补全） | ★★★★☆（研究 SOTA）/ ★★★☆☆（工程可用） | See-Through、LayerDiffuse、OmniPSD、商业 SaaS | 拆分被合并的部件（左右手）、重排层序、修边缘与遮挡处的补图 |
| 切图前把「被遮挡部位」画出来 | ★★★★☆（间接） | 让 AI 出「同一角色的闭眼 / 张嘴 / 撩开头发 / 脱外套」参考视角，照着描 | 描线与风格对齐 |
| 网格 / 变形器 / 参数（绑定） | ★★☆☆☆（GUI 半自动） | Cubism 官方「自动网格生成」「变形器自动生成」「面部动作自动生成」「摇摆运动自动生成」 | 大头仍在这：keyform、九轴、物理调参 |
| 端到端自动绑定（研究） | ★★☆☆☆ | Bunraku（无公开可用权重）、Spiritus（ACM MM'25）、psd2live、Stretchy Studio、Live2D Master Agent | 大量修补；未通过官方效果验收 |
| 口型 / 表情驱动 | ★★★★★ | Cubism MotionSync（CRI LipSync，免版税）、音量 RMS 驱动、Preston Blair 式 viseme | 参数映射与调参 |
| 待机动作 / 物理摆动 | ★★★★☆ | Cubism「摇摆运动的自动生成」+ 自动物理；psd2live 生成 6 秒循环 idle.motion3.json | 精细调参 |
| 导出 moc3 / moc3 编译 | ★★☆☆☆ | 官方 Cubism Editor GUI（无 CLI）；替代：Umamo CLI、psd2live、Stretchy Studio | 官方路径必须人工点 |

---

## 3. 环节 A：概念设计与立绘（AI 已经很成熟）

- **AI 最适合的地方就是这一步**，是整条流程里「生成技术用得最狠、最划算」的一环；把角色做成「角色资产」后每次以 `@` 引用它生成，可保证差分之间不跑设定。来源：[ArcLoop 中文指南](https://arcloop.ai/handbook/zh-CN/ai-art-to-vtuber-model-pipeline)
- 实操案例（繁中教程）：用 Grok 生成半身 → 用 Gemini 向下扩画全身 → 再用绘图软件补尾巴/改配色/调头身比 → 用 ILoveIMG 免费放大 4 倍做高分辨率拆件源图。来源：<https://live.rookiesavior.net/article/details/gemini-grok-live2d>
- **为绑定而画的姿势要求**：正面、中性姿势、手臂离体、头发边界可辨、4000px 级画布。来源同上 ArcLoop。

---

## 4. 环节 B：素材分层（切图 + 遮挡补全）——目前 AI 帮得最多、也最容易翻车的一段

### 4.1 学术 SOTA

**① See-Through: Single-image Layer Decomposition for Anime Characters（SIGGRAPH 2026）**
- 论文：<https://dl.acm.org/doi/full/10.1145/3799902.3811209>；预印本：<https://arxiv.org/abs/2602.03749>；代码：<https://github.com/shitagaki-lab/see-through>
- 做了什么：把单张动画插画分解为 **19 个语义部件**（v0.0.1）/ **最多 23 层**（V3 模型）的**全 inpaint RGBA 图层**，并推断**逐片段的绘制顺序（pseudo-depth）**，支持单层内的「前发/后发」这类自遮挡细分（在 alpha 掩膜内对 pseudo-depth 做 K=2 K-Means 分层）。
- 关键技术：SDXL + LayerDiff 3D（透明层生成）+ 微调 Marigold（动画向 pseudo-depth）+ SAM-HQ 部件分割（[训练管线说明](https://github.com/shitagaki-lab/see-through/blob/main/training/README.md)）+ Body Part Consistency Module（跨层注意力，保证 19 层互相一致）。
- 数据来源：**用商用 Live2D 模型反推训练标签**（通过解析 .moc3 的 ArtMesh 可见性掩膜拿到像素级监督），配套工具 [CubismPartExtr](https://github.com/shitagaki-lab/CubismPartExtr)。
- 已知缺陷（论文自述）：一体式服装（高腰裙、旗袍、一字肩）会在 Topwear/Bottomwear 重复出现；配件出现在多层；pseudo-depth 不干净时无法稳定再分层。这些「在图层编辑器里容易修」。
- 作者自己的定位：**「Is this Image-to-Live2D? We don't think so — at least, not yet.」** 理由是三点：① 自动分解追求语义正确，而 Live2D 艺术家会为形变行为做不同的切分决策；② 绑定（网格、物理、动作曲线）**不在本项目范围内**，而这才是最关键最耗人的一步；③ 专业作品是「层结构 + 补图风格 + 绑定」整体设计的。作者认为输出可以当作「有用的起点」。
- 论文中的可用性验证：把结果导出为分层 PSD 交给**专业动画师做关键帧**，动画师反馈「**基本可直接用于木偶式动画，只需微小手工修改**」。
- **License（重要）**：代码 Apache-2.0；权重 Apache-2.0 + 继承依赖模型许可（Animagine XL 4.0 / SDXL 1.0 = CreativeML Open RAIL++-M；LayerDiffuse = CreativeML Open RAIL-M；VAE = MIT）。**明确写「Commercial use is permitted」**，但需在分发/托管时把 Open RAIL 的第 5 段与 Attachment A 使用限制作为可执行条款提供给用户。来源：[HF seethroughv0.0.2_layerdiff3d](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d)、[marigold 权重页](https://huggingface.co/layerdifforg/seethroughv0.0.1_marigold)
- **可用入口**：HF Space（ZeroGPU，注册后**每天 1–2 次 PSD 提取，每次 2–3 分钟，1280 分辨率**）<https://huggingface.co/spaces/24yearsold/see-through-demo>；中国大陆可用 ModelScope demo（当前免费、分辨率略高）<https://modelscope.cn/studios/ljsabc/See-Through>；量化模型自动下载，PSNR ~30 dB / SSIM ~0.96（vs bf16）。
- **官方声明（防骗）**：「本项目为开源研究项目，我们**未开设任何付费服务**。如遇到以此功能收费的网站，均与我们无关。」另有一份授权声明禁止将其用于「与 Live2D 竞争」的场景（见 §10.6）。

**② 相关论文谱系**
- **OmniPSD: Layered PSD Generation with Diffusion Transformer**（arXiv 2512.09247，NUS ShowLab）：支持 text→PSD 与 image→PSD 双向；image→PSD 用 Flux-Kontext + RGBA-VAE 迭代式「抽取前景→擦除前景→重建背景」。<https://arxiv.org/html/2512.09247v1>
- **PSDiffusion**（arXiv 2505.11468）：多前景层联合生成 + 层间交互建模。<https://arxiv.org/html/2505.11468v2>
- **LayerDiffuse**（lllyasviel）：latent transparency，ComfyUI 插件 <https://github.com/huchenlei/ComfyUI-layerdiffuse>，模型 <https://huggingface.co/LayerDiffusion/layerdiffusion-v1>；社区中文教程：<http://www.csdndoc.com/thread/15173.html>
- **Spiritus: A Semantic-Driven Framework for Layered 2D Character...**（ACM MM'25）：text+sketch 输入 → 自动部件分割 → 自适应网格系统自动绑骨 → **导出 Spine 兼容骨骼动画**（15 根主骨，命名参考 VRM）。<https://dl.acm.org/doi/10.1145/3746059.3747707>
- **How to Train Your Dragon: Automatic Diffusion-Based Rigging for Characters with Diverse Topologies**（arXiv 2503.15586）：给 3–5 张带骨架标注的示例帧，微调后可为该角色生成任意新姿势图像。<https://arxiv.org/html/2503.15586>
- 3D 自动绑骨谱系（作为对照）：**UniRig**（<https://arxiv.org/html/2504.12451v1>）、**DRiVE**（CVPR 2025）、**ASMR**（Eurographics 2025）、**Auto-Connect**（NeurIPS 2025）。
- **Remesher**（SIGGRAPH 2026 Course）：把 ComfyUI 工作流封装为 Python Typer CLI + agent skill（text→image→GLB→rigged GLB），主张「graph → API prompt JSON → CLI → agent skill」的生产化路径。<https://dl.acm.org/doi/full/10.1145/3799820.3812509>

**③ 端到端 Live2D 生成的唯一代表：Bunraku**
- **Bunraku: Turning a Single Illustration into an Editable Live2D Character**，arXiv:2607.27348，2026-07-29 提交（作者来自清华等相关团队：Junhao Chen, Jingjia Mao, Dayong Li, Chenghai Li, Saining Zhang, Zhihao Li, Hao Zhao, Yufei Wang, Ruqi Huang）。
- 声称是**第一个从单张插画生成 Live2D runtime 所消费的全部结构信息**的系统：有序 RGBA 层 + 每层三角网格 + 参数驱动的 keypose 顶点位移（即参数→顶点偏移映射，也就是「绑定」本身）。
- Stage 1：Live2D 器官级 taxonomy 下的分层扩散，输出有序 RGBA 栈并补全遮挡区域。
- Stage 2：由 alpha 通道单独构建贴合内容的三角网格；**把所有层的所有顶点当作一个 token 序列联合预测位移**（自注意力跨层边界），每个位移分解为「有界方向 + log 幅度」。论文明确说：**联合预测（而非逐层独立预测）是最大收益来源；把网络放大 112 倍则毫无收益。**
- 指标：50 个 held-out 角色、无 teacher forcing 时 **逐顶点方向余弦 0.768（中位 0.828）**。
- 附带贡献：**Live2D-Bench**（首个该任务的标准 benchmark）+ **8,884 个模型的 Live2D 语料**（带层与动画监督）。
- 论文对现状的判断原文（可引用）：*"Producing one has nonetheless resisted automation."*；*"A senior artist spends four to eight weeks and roughly one thousand US dollars per full-body model"*。
- 局限（论文自述的间接证据）：**未见公开代码/权重**（截至调研时在 arXiv 页面无 code 链接，仅项目页；需继续跟进）。对「层缺失」这类跨层不一致，论文说「任何动画模型都无法修复」。

- **补充传闻性来源（低置信度，仅供交叉参考）**：一篇博客描述了一个「全生成式 AI 工具链」的完整实验（ChatGPT Images 2.0 出图 → SDXL(WAI-Illustrious) 均质化 → See-Through 分层 → 手工拆分被合并部件与重排层 → 让 GPT-5.6 写自定义 OpenGL 渲染引擎），作者自称「无动画/插画背景也能做」。<https://blog.return.moe/en/2026/07/19/towards-fully-automated-live2d-style-animation/>。该来源对未来有大量预测性判断，**本报告只采信其流程描述，不采信其预测**。

### 4.2 可用的开源实现与「实际质量」
参考来源：[Reddit 讨论快照（see-through）](https://reddit.sentinel-team.org/posts/1sdswrw/snapshots/2026-04-09T20%3A33%3A34.459213Z)、[r/Live2D 关于 AI 做 Live2D 的提问帖快照](https://reddit.sentinel-team.org/posts/1wm6p3f/snapshots/2026-09-26T00%3A10%3A19.642204Z)、[Stretchy Studio 发布帖快照](https://reddit.sentinel-team.org/posts/1sjj7ta/snapshots/2026-04-13T16%3A49%3A44.836172Z)

社区实测反馈（原话级）：
- 「Initial result looks great! 我试了，即使复杂角色图效果也不错，但**需要一些后处理**（重排一些层、拆分左右手臂，不算太复杂）。可惜后半段（绑定和动画）也**非平凡**。一个典型定制 Live2D，画全部分件的成本约 $500，这个模型已经替你做了，但剩下的绑定动画成本**至少还要约 $500**，所以还不到能随意生成华丽 Live2D 角色的阶段……yet。」
- 「自动分层工具生成的遮罩很粗糙，**每一条重要边界——眼睛、嘴巴、发丝边缘——都还需要手动清理**。」（ArcLoop 中文分层指南）
- 「我试了也能分层，但**backfilling（补被遮挡区域）很难**。」
- 一个独立开发者两次尝试程序化管线后的结论：*「Cubism 的 `.moc3` 运行格式是二进制不透明格式；`.cmo3` 源文件是 zip 里的 XML 且被逆向工程过（Stretchy Studio 会写它）。但 **`.cmo3` → `.moc3` 的编译步骤需要 Cubism Editor 本体**。Editor 没有脚本 API、没有 CLI 导出。**你无法端到端自动化 Cubism**。你可以做一次模板 rig 再程序化换贴图，但无法程序化生成全新的 Cubism rig。」*（注意：此帖写于 2026-05，**早于** Cubism 5.4 alpha 新增编辑 API，见 §5.2；但「无 CLI 导出」与「模板 rig + 换贴图」的结论在 5.4 下仍成立）
- 同一作者的建议路径排序：① 学 Cubism → 模板 rig + 图集换贴图；② 有预算 → **直接付费给 Live2D 绑定师**（4–8 小时产出一个 rig）；③ 有 ML 训练能力 → 微调 mesh 预测模型。

### 4.3 商业 SaaS（含价格、风险与克隆站问题）
- **ImageToLayers（imagetolayers.com）**：商业化分层 SaaS，第三方模型（fal / Replicate，含 Qwen-Image-Layered、Nano Banana、GPT Image 2 等）驱动。
  - 价格：Starter Trial $0（20 一次性 credits，仅 3 个工具，**仅个人使用**，文件保留 7 天）；**Creator $19/月（1,000 credits/月，含 PSD/ZIP 导出 + 商用权，$120/年）**；**Studio $49/月（3,000 credits，优先处理、团队、API、1 年文件保留，$360/年）**。
  - 计价：**Image to Layers / Detailed Layers = 60 credits/次**；**Character into Layers = 30 credits/图**；Background Remover = 15 或 30 credits/图。
  - 商用限制：**付费计划可商用，但「还要看输出所用第三方模型自身的条款」**；免费试用输出仅限个人使用。
  - 厂商自述（很重要，别当成品）：「分层不是恢复设计者原始图层」「被遮挡区域的重建是 AI 估计值，不是恢复原始像素」「头发、玻璃、柔和阴影、运动模糊、重叠物可能需要人工再修」。
  - 来源：[官方定价与工具页](https://www.imagetolayers.com/solutions/character-into-layers)、[第三方评测（Catalora，2026-10-03）](https://catalora.ai/tool/imagetolayers)
  - **⚠️ 克隆站警告**：官方发布安全公告，点名 **imagetolayers.org 是仿冒站**（抄品牌与素材、接第三方低质 API、退款风险、克隆站使用 Creem/Waffo 支付通道），并称唯一官方域名是 imagetolayers.com。<https://www.image-to-layers.com/blog/imagetolayers-org-fake-clone-alert>（该公告本身来自另一个域名的「安全团队」，其权威性无法独立验证，**此处仅如实转述双方口径**）。同类站点还有 imagetopsd.net、pixmind.io、image2layer.com、image-layered.app 等，均为第三方商业服务，与 See-Through 作者无关。
- **官方 Live2D 自家的分层工具：素材分割 Photoshop 插件（Material Separation Photoshop Plugin）**
  - 用途：建模前工序「素材分け」的半自动**裁剪（切り抜き）**与**填充/扩展（塗りつぶし・塗り広げ）**；支持多图层/分组一起处理、剪贴蒙版结构保留。
  - **需要 Cubism PRO 许可证**（42 天试用期内也可用）；**Photoshop 2024/2025 必须已安装**；安装约需 6GB 空间；macOS 版仅支持 Apple Silicon。
  - 官方强调采用的 AI 技术是**从选区周边信息推断新图层的颜色与 alpha 值的 DeepLearning，不使用扩散模型的图像生成 AI**，因此「不存在侵害学习数据版权的可能性」；训练数据来自**获得 AI 研究许可的 nizima 投稿作品**。
  - 正式版 R1 于 **2025-10-28** 发布，PRO 用户不需额外付费。
  - 来源：[下载页](https://www.live2d.com/en/cubism/download/material-separation-ps-plugin/)、[使用手册](https://docs.live2d.com/zh-CHS/cubism-editor-manual/material-separation-ps-plugin-manual/)、[PR TIMES 新闻稿](https://prtimes.jp/main/html/rd/p/000000130.000024818.html)

### 4.4 社区做法：用 AI 生成「缺失视角」而不是靠猜
ArcLoop 的中文分层指南给出一套可执行的方法论（这是目前最实用的「AI 辅助拆件」姿势）：
- 别把那张插画当唯一真相来源，**把角色做成「角色资产」，随时向它索取缺失视角**：同脸闭眼版、同脸张大嘴版、撩起全部头发的同角色、脱掉外套的服装版。
- 三个 AI 图特有的坑：① 遮挡物背后什么都没有（刘海后没有额头、领口后没有脖子）；② **光影被烘焙进部件边界之间**（刘海投在脸上的阴影属于头发位置，切图时留在脸上会导致头发动了阴影不动——这是「赶工 AI 图」最常见的破绽）；③ 边界纠缠（发丝与睫毛/领口交织、双马尾前后穿插）。
- 拆件顺序 SOP：锁定主图 → 先生成整套隐藏区域参考图 → 按组切（不要按像素切）→ 用参考图补全暴露区域 → 重画边界光影（投影单独建层）→ 压平（每部件合并成一个图层、应用掉图层蒙版、不带路径数据）→ 逐项核对格式（**PSD、RGB、8bit、sRGB**，缺一就会被 Editor 拒绝导入）→ 命名规则朴素即可（`hair_front_L` / `eye_ball_R` / `mouth_inner`）。
- 常见错误：没确认动作范围就开始切；没参考图直接补画；阴影跨边界烘焙；一整块头发做成一个图层（会像戴头盔）；给没锁定的设计切图。
- 来源：<https://arcloop.ai/handbook/zh-CN/live2d-material-separation-ai-art-guide>
- 官方也有对应文档：素材拆分用 PSD 与载入用 PSD 要分开准备两份；推荐 Photoshop / CLIP STUDIO PAINT。<https://docs.live2d.com/zh-CHS/cubism-editor-manual/divide-the-material/>

---

## 5. 环节 C：绑定（rigging）——最硬的骨头

### 5.1 官方 Cubism Editor 内建的 AI / 自动功能（GUI 半自动）
| 功能 | 起始版本 | 说明 |
|---|---|---|
| **面部动作的自动生成** | Cubism 5.0（2023-09-21） | 由「生成面部变形器」+「生成面部动作」两部分组成；可生成角度 X/Y 动作与四角形状；带「移动级别/变换级别」滑块微调。**仅支持正面朝向的脸**，且要求脸/左眼/右眼/左眉/右眉/嘴的变形器已存在 |
| **变形器的自动生成** | Cubism 5.1（2024-07-29） | 自动生成人形模型全身变形器配置，按图形网格置入位置估计归属；可左右对称生成；**官方明说「该功能利用 AI 技术，根据每个物体的图像信息来估计其属于模型的哪一部位」**，训练数据为获授权用于 AI 研究的 nizima 作品 |
| **摇摆运动的自动生成** | Cubism 5.1 | 自动生成头发/小物件等摆动物体的运动，可调抖动程度，可应用于混合形状 |
| **自动网格生成** | — | 指定点间距（内外）、边界余量、视为透明的 Alpha 值等；有预设保存功能 |
| **自动图形路径生成** | — | 根据「线画」「填充」信息自动创建图形路径，需要素材分离的 PSD |
| **5.4 alpha 新功能** | 5.4 alpha（2026-07-14） | 参数控制器 SDK 支持、模型状态集、**外部连携 API 编辑功能扩充**、纹理集自动布局新算法 |

来源：[面部动作的自动生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/face-auto-edit/)、[变形器的自动生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/auto-generation-of-deformer/)、[5.0 新功能](https://docs.live2d.com/zh-CHS/cubism-editor-manual/new-function5-0/)、[5.1 新功能](https://www.live2d.com/zh-CHS/cubism/update/update_5_1_00/)、[自动网格生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/mesh-edit/)、[自动图形路径生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/artpath-auto-edit/)、[5.4 alpha 发布公告](https://www.live2d.com/zh-CHS/information/cubism-5_4-alpha/)

**5.4 alpha 的时间窗**：可用至 **2026-10-18**（alpha1 在 2026-09-14 后不可用，需装 alpha2）；无需付费许可证即可试用；alpha 版创建的数据只能在 alpha 版使用，官方不提供任何保证/技术支持。来源同上。

### 5.2 官方外部连携 API（5.4 alpha 新增编辑系）——自动化的最大杠杆，但有硬边界
- 通信：**WebSocket，JSON(UTF-8)，默认端口 22033**；Editor 是 server，外部程序是 client；需 `RegisterPlugin` 拿 token，用户必须在设置对话框勾选「许可」；**编辑类操作还需要额外勾选「编辑」权限**。
- 事务：**编辑必须 `EditBegin` / `EditEnd` 包裹**，执行时 Editor 会弹对话框并锁住用户操作。
- **已公开的编辑系命令全集**（我从官方 alpha 手册页面机械抓取，共 35 个方法名）：
  `AddGlow, AddParameter, AddParameterGroup, AddParameterKey, AddPart, AddRotationDeformer, AddSelectedObjects, AddWarpDeformer, DeleteObject, DeleteParameter, DeleteParameterGroup, DeleteParameterKey, EditArtMesh, EditBegin, EditEnd, EditGlue, EditParameter, EditParameterGroup, EditPart, EditRotationDeformer, EditSendLog, EditSendProgress, EditWarpDeformer, GetDeformerStructure, GetIsEditApproval, GetObject, GetObjectsByParameterKeys, GetParameterKeys, GetParameterStructure, GetPartStructure, GetSelectedObjecs, MoveObjectOnPartsPalette, MoveParameter, MoveParameterGroup, MoveParameterKey`
  以及只读系：`GetParameterValues / SetParameterValues / GetParameters / GetParameterGroups / GetDocuments / GetDocument / GetCurrentDocumentUID / GetCurrentModelUID / GetCurrentEditMode / GetPhysicsInfo / ClearParameterValues / SetGlobalVersion / SendCubismLog`，事件：`NotifyMocFileExported / NotifyPhysicsFileExported / NotifyMotionFileExported / NotifyMotionSyncFileExported / NotifyChangeEditMode`。
- **关键边界（我实测抓取页面得出）**：该页面全文 **不含** `AddArtMesh`、`Import`、`PSD`、`Texture` 相关方法。
  → 结论：**5.4 alpha 的编辑 API 可以新增/编辑 参数、Part、Warp/Rotation 变形器、Glue、ArtMesh 属性，但无法创建 ArtMesh（即无法把美术图导进来）、也无法导入 PSD 或操作纹理集。**「把美术变成模型」的那一步（PSD 导入 + 网格生成）**仍然只能在 GUI 里做**。
  来源：[外部连携 API 一览（日）](https://docs.live2d.com/cubism-editor-manual/external-application-integration-api-list/)、[alpha 手册（英）](https://cubism.live2d.com/editor-alpha/doc/manual/alpha1/en/external-api-intergration/index.html)、[外部应用程序连携（Editor 手册）](https://docs.live2d.com/cubism-editor-manual/external-application-integration/)
- **已有第三方 MCP 封装**：`nana7chi/CubismExternalEditMCP` —— 把上述 API 包成 **42 个 MCP 工具**，让 AI Agent 用自然语言操作 Cubism Editor（含批量编辑与失败自动回滚、token 持久化到 `~/.cubism-mcp/token.txt`、Editor 重启后 3 秒自动重连）。限制：仅支持一个模型；每次 Editor 重启需重新授权。来源：<https://github.com/nana7chi/CubismExternalEditMCP>
- 官方 sample：GitHub 上公开了外部连携的样例实现（手册页面有链接）。

### 5.3 第三方「PSD → 自动绑定 → 导出 Live2D」工具（都要自己评估成熟度）

| 项目 | 输入 | 输出 | 自述能力 | 自述限制 / 风险 |
|---|---|---|---|---|
| **psd2live**（tsunehimatoi/psd2live） | 分层 PSD | `.cmo3`（可在 Cubism Modeler 5 二次编辑）+ `.moc3` 文件族（`model3.json` / `cdi3.json` / `physics3.json` / `idle.motion3.json` / 贴图集 4096）+ `psd2live.json` 诊断报告 | 图层语义识别、连通域双侧拆分、自适应三角网格剖分、九轴面部经纬网与解耦变形器层级、头发多摆物理 + 果冻眼动力学、6 秒无缝循环待机动作；三道几何自检闸门（中立姿态保真/极限姿态完整性/变形器镜像对称）；**自带 Bearer Token 的 Streamable HTTP MCP 工作区**，支持 ChatGPT/Codex/Gemini 读工程与参数、写/复制/删多参数 K 帧、追加式分支历史 | README 自己写明：变形路径算法**尚未通过 Cubism Editor 效果一致性验收**；「待实现」包括参数调整、表情与动作差分、简单图层切分、口腔部件拆分、头发拆分与遮挡补全、挥手动作、尾巴变形与物理；「暂不可行」：对部件做逐点精确变形。运行环境 Windows 10/11 x64（Linux/macOS 可跑 CPU 软件光栅化），Windows 包已含 JRE。项目**不包含、不分发**官方 SDK 二进制 |
| **Stretchy Studio** | 打了标签的 PSD（或 See-Through 输出）/ .stretch / PNG | **Live2D runtime**（`.moc3` + `.model3.json` + `.physics3.json` + `.motion3.json`）与 **Cubism 编辑器源**（`.cmo3` + `.can3`，对应 Cubism Editor 5.0）；另可导出 **Spine 4.0 JSON**、PNG/WEBP/JPG 序列 | 自动绑骨（标签化 PSD → 标准 rig）；`DWPose ONNX` 做 AI 关节检测，启发式兜底；变体 `.name` 约定自动生成 Param 交叉淡入；Blender 式时间轴/Dopesheet/F-Curve；程序化待机/聆听/说话/瞥视动作；viewport 求值器是 Cubism warp + pendulum 内核的移植 | 多个 fork/仓库并存（`claudeskydream-hash`、`pelmentor`、`MangoLion`），**原创作者对同名项目的宣称存在争议**：原创者明确说「Live2D 的导出格式完全封闭且无文档，所以那个（官方 moc3 导出）当时是做不到的」。第三方 AI 聚合站点的「与 Live2D 同质量、零成本」说法**未见独立验证**，请以仓库实际代码为准 |
| **Live2D Master Agent**（mw2wbyys6t-sudo/Live2D） | 一句 Prompt | 号称「合规可二创的 Live2D Cubism4 虚拟角色」，含 18 层 PSD、36 骨骼、28 BlendShape、物理、model3.json + physics3.json + 28 个 exp3.json + 纹理图集 | AI 生图（Pollinations/Seedream/SenseNova）→ SAM+ISNet 语义分割 + Amodal 补全 → Live2D 自动绑定 → MediaPipe 面部捕捉 → LLM 对话 → 跨平台桌宠 | 自述由 TRAE 辅助开发；Apache-2.0；**无第三方验证**；「3 分钟产出」类宣称与 §4/§5 的社区共识（绑定无法自动化到直播质量）直接冲突，**建议按「demo 级」看待** |
| **AutoVtuber**（Lee-unhn/AutoVtuber） | 表单（发色/眼色/个性/风格/昵称） | ~8 分钟出 **VSeeFace 可直接加载的 .vrm**（附概念图、七章人设 markdown、chat-ready runtime JSON、VoxCPM 声音样本） | SDXL + AnimagineXL 4.0 LoRA 出概念图 → TripoSR 建 3D 脸型 mesh → MeshFitter 贴到 VRoid base atlas → VRMAssembler 输出 VRM 0.x（含 ARKit 52 blendshapes）；HardwareGuard 1Hz 显存/温度/内存监控 | 是**3D/VRM 路线**（非 Live2D）；依赖 Ollama/SDXL/TripoSR 本地推理 |

来源：[psd2live](https://github.com/tsunehimatoi/psd2live)、[Stretchy Studio (pelmentor)](https://github.com/pelmentor/stretchystudio)、[Stretchy Studio 原创发布帖](https://roboticcontent.com/free-open-source-tool-to-instantly-rig-and-animate-your-illustrations-also-with-mesh-deform/)、[Live2D Master Agent](https://github.com/mw2wbyys6t-sudo/Live2D)、[AutoVtuber](https://github.com/Lee-unhn/AutoVtuber)

### 5.4 开源编辑器 / 运行时（绕开官方工具链的路线，2026 年集中爆发）
这一簇项目在 2026 年 7–8 月同时出现，都以「黑盒逆向」方式实现了 Live2D 文件格式的读写：

**① Umamo（Cubism Editor 的开源替代）** — 与你最相关的一个
- 定位：开源跨平台 2D 木偶动画建模编辑器，**first class 手写笔/触摸支持**，明确目标是「drop-in replacement for the Live2D Cubism Editor」。
- 格式能力表（README 原表）：PSD（读 〇）、CLIP（读 △ 未充分测试）、KRA（读 〇）、**CMO3（读 〇 / 写 〇，已验证 byte-to-byte 兼容）**、**MOC3（读 △ / 写 △，已实现，未充分测试）**。
- **有 headless CLI**（`app/cli` 模块）：
  `dump model.moc3` / `convert model.cmo3 out.moc3`（会生成 moc3 + model3.json + cdi3.json + 贴图） / `convert in.moc3 out.cmo3` / `diff a.cmo3 b.moc3` / `extract model.cmo3 out/`（解包出明文 main.xml + 图层 PNG）。
  注意：`convert in.moc3 out.moc3` 是**重新合成，不保证 byte 相同**；`moc3 → cmo3` 目前「源画材对账未实现，转换后文件在官方 Cubism 编辑器里不显示贴图」。
- 平台：Windows / Linux / macOS 有预编译包（`linux-x64`、`linux-arm64`、`windows-x64`、`macos-arm64`、`macos-x64`）；**Android 尚未可用（图形层未完成）**，iPadOS 可加载但无渲染器。未签名、无安装器、无自动更新。
- 版本节奏：v0.1.0-dev（2026-07-27）→ v0.2.0-dev（2026-08-03，新增「Cubism 5.4 兼容 CMO3 写出」alpha 级支持）→ **v0.2.1-dev（2026-08-11）**。作者（u/Azxiana）自述目标是「圣诞节前做出 release candidate」，做纯爱好项目、不打算赚钱。
- 许可：仓库标注 **GPL-3.0**（另有第三方站点显示为 GPL-3.0 与「144 stars/14 forks」）。
- 已实现/待实现：已实现 CMO3/MOC3 导入导出、PSD/KRA/CLIP 分层美术、Ayagami 与 Cubism 3.0–5.4 运行时目标、可绘制网格与 UV 网格编辑、参数与 keyform 编辑、Blender 式界面；**待实现：变形器编辑、物理与动画、美术来源与纹理图集管线、原生 UMA 格式**。
- 与 Ayagami 的关系：Ayagami 作者称 **Umamo 会内置一个「100% bug 兼容」的 Live2D 物理引擎预览仿真**，以便确认模型在 VTube Studio 里也正常。
- 来源：[GitHub](https://github.com/umamoorg/umamo)、[v0.2.1-dev release](https://github.com/umamoorg/umamo/releases/tag/v0.2.1-dev)、[v0.2.0-dev release](https://github.com/umamoorg/umamo/releases/tag/v0.2.0-dev)、[r/vtubertech 发布帖](https://redlib.vanillax.me/r/vtubertech/comments/1vlafeo/im_working_on_umamo_a_free_open_source/)

**② Ayagami（彩紙，Rust 写的 Live2D 兼容 runtime）**
- 加载并渲染 MOC3（支持到 SDK 5.0 特性：Parts、ArtMeshes、Rotation & Warp deformers、Glue、Blendshape Parameters 等）；提供 `driver`（Live2D 等价插值/外插/变形器链式算法）与 `ayagami-render`（wgpu，支持 Vulkan/Metal/DX/OpenGL/WebGL/WebGPU）。
- **物理引擎从头实现，基于 Runge-Kutta 法，FPS 无关**，作者称「比 Live2D 物理更稳定、少 bug」，并**加了刻意模仿 Live2D 误差的调整**以让动态手感一致；声称「没有 zero-sticking bug」，rigger 常用的「angle 90 locking」技巧仍可用。
- 定位：**只做 runtime / loader / poser**，不是绑定工具、不是完整 VTubing 工具；路线是「工具链黑盒逆向，**不受 Live2D 许可条款约束**」，将采用 **MIT/Apache-2.0 双许可**；官方声明「与 Live2D Inc. 无关联、未获授权、未获背书」。
- 生态：Web demo `demo.ayagami.dev`（100% 本地，模型不上传；用 CSP meta 阻止一切脚本请求）；Godot bindings（ayagami-gd）；**计划集成进 OpenVT**（跨平台 VTube Studio 替代，含节点式跟踪配置，即同时替代 VBridger）。
- 来源：[GitHub](https://github.com/AyagamiDev/ayagami)、[r/vtubertech 帖子](https://redlib.vanillax.me/r/vtubertech/comments/1vl7pjm/ayagami_the_open_source_live2d_now_with_physics/)

**③ nijigenerate / Inochi2D（从 Inochi2D v0.8 分叉出的开源 rig 工具）**
- nijigenerate：nijilive puppet 格式的开源编辑器（BSD 2-Clause）。**v1.0.0-beta1 新增「Introduced API for external programs and AI agents」+「New AI agent panel（需用户显式设置 AI agent）」+ `njc` 命令行客户端 + MCP/ACP 命令集成**；另新增 GridDeformer、DepthEdit/DepthBone（深度感知 rig）、path deformer + Auto Physics（自动生成钟摆式头发运动，无需手工设置）、Welding（等价 Live2D Glue）、动态合成、参数联动、automask/automesh。
- Inochi2D 本体：BSD 2-clause，**对项目集成无授权费**；但**与 Live2D 格式根本性不兼容，无法加载既有 Live2D 模型，必须重做 rig**（PSD 大多可复用）。Inochi Creator 2024-09-30 上 Steam 抢先体验。
- 对 web 端：官方有 Rust 实现 Inox2D，可用于 WebAssembly。
- 来源：[nijigenerate repo](https://github.com/nijigenerate/nijigenerate)、[v1.0.0-beta1 release](https://github.com/nijigenerate/nijigenerate/releases/tag/v1.0.0-beta1)、[Inochi2D 文档](https://docs.inochi2d.com/en/latest/)、[FAQ](https://github.com/Inochi2D/inochi2d/wiki/Frequently-Asked-Questions)

**④ 其他 moc3 读写/逆向项目（技术可行性证据，不要直接用）**
- `QiE2035/moc3-reader-re`：逆向 Cubism 的 moc3 reader（可读可写回，需先清 offset list）。
- `OpenL2D/moc3ingbird`：**MOC3 Format Specification 2.1b**（ImHex hexpat），来自 CVE-2023-27566 的研究——说明 **Cubism Core 是唯一大规模 MOC3 reader 实现，且不做边界检查**（可被构造文件打成 DoS，甚至可能 RCE）。
- `MahouTechnologies/moc3-rs`、`Ludentes/py-moc3`（Python 读写，零依赖，V3.00–V5.00 读+写，round-trip byte 相同）、`Eatgrapes/moc2cmo`、`moc2cmo`（Rust crate，把 moc3 反编译成可读可编辑 cmo3）、Quadrism（CLI，支持 moc/moc3，并可从 JSON 生成 can3 动画）。
- 来源：[moc3-reader-re](https://github.com/QiE2035/moc3-reader-re)、[moc3ingbird](https://github.com/OpenL2D/moc3ingbird)、[moc3-rs](https://github.com/MahouTechnologies/moc3-rs)、[py-moc3](https://github.com/Ludentes/py-moc3)、[moc2cmo](https://docs.rs/moc2cmo/latest/moc2cmo/)、[Live2DHub 讨论帖](https://live2dhub.com/t/topic/6158)

---

## 6. 环节 D：动作 / 表情 / 口型 / 物理

### 6.1 口型（对你做「Live2D 语音对话应用」最关键的一环）
三种官方做法（Cubism SDK Manual「Lip-sync」）：
1. **实时音量驱动**：取音量（0–1）缩放后直接 `setParameterValue` / `addParameterValue`。Web 端 sample 用 `LAppWavFileHandler` 读 wav，`getRms()` 取 RMS 音量，乘 0.8 后写入 lipSync 参数。**注意：sample 不含播放音频的能力**。
2. **动作内嵌口型信息**：在 Editor 里把口型做进 motion，播放时用 `CubismMotion.setEffectIds(lipSyncIds, eyeBlinkIds)` 把 motion 参数替换到目标参数。
3. **专用口型 MotionManager**：单独用一个 motion manager 只控制嘴，把身体/头部动作与口型分离。
来源：[Lip-sync（SDK Manual）](https://docs.live2d.com/en/cubism-sdk-manual/lipsync/)、[Lip-sync Based on Volume of Wav Files (Web)](https://docs.live2d.com/en/cubism-sdk-tutorials/native-lipsync-from-wav-web/)

**Cubism MotionSync Plugin（更高级方案）**：
- 把指定音频转成 viseme 时间序列，并按用户预设的形状混合自动生成嘴部动作；音频分析库目前只有 **[Lip-sync (CRI LipSync)]** 可选；设置（音频分析类型、Mapping、Audio element、Parameter）与模型 `.cmo3` 绑定，也可导出/导入 `.motionsync3.json`。
- 预设：Basic（口形变形 × 嘴开闭两参数）、Vowels only (blend shape) 等；可对每个 viseme 设 Scale 加权。
- **授权（重要）**：MotionSync Plugin 中使用的 CRI Lipsync 已由 Live2D 取得授权，因此 **MotionSync Plugin 可免版税使用、且无需显示 CRIWARE logo**；其许可受 Live2D Proprietary Software / Open Software License Agreement 管辖。**MotionSync Core 不发布在 GitHub**（只能从官方包获取）。
- Web 端：`Cubism SDK MotionSync Plugin for Web` 需要 `MotionSync Core`，只从 GitHub 拿 `CubismWebMotionSyncComponents` **无法运行**，必须用官方包。
- 可调参数（Web）：`SampleRate`（1.0–120.0 fps）、`AudioLevelEffectRatio`（0.0–1.0；用 CRI Lipsync 时设为 0.0 以匹配 Editor 行为）、`BlendRatio`、`Smoothing`。
- Unity 侧：`CubismMotionSyncLinkData/List/Controller` 可在 motion 播放期间同步口型（Cubism 5 SDK MotionSync Plugin for Unity R2+）。
- 来源：[Motion-sync（Editor Manual）](https://docs.live2d.com/en/cubism-editor-manual/motion-sync/)、[MotionSync Plugin for Web](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/)、[Motion-sync Settings (Web)](https://docs.live2d.com/en/cubism-sdk-manual/motion-sync-setting-web/)、[Web 场景用法](https://docs.live2d.com/en/cubism-sdk-manual/use-on-scene-motion-sync-web/)

### 6.2 参数与动作的自动化程度
- **摇摆（物理）运动自动生成**：5.1 起官方支持，可调抖动程度，可作用于 Blend Shape 参数。
- **待机循环动作**：psd2live 会生成 **6 秒无缝循环 `idle.motion3.json`**（胸腔呼吸起伏 + 轻微头身倾斜摇摆 + 自然眨眼）；Stretchy Studio 有程序化 idle/listening/talking/glances/tilts 生成。
- **"动作自动生成"以外的动作/表情**：官方与第三方都没有「文本→Live2D 动作曲线」的成熟方案；论文侧的 3D 方向有 UniMate（SIGGRAPH Asia 2026）、SAMoR、MotionDreamer 等「任意骨架文本驱动动画」，属 3D 领域。<https://techround.co.uk/artificial-intelligence/why-teaching-ai-anatomy-is-the-hardest-leap-in-digital-animation/>
- **参数控制器（5.4 的隐藏价值）**：5.4 起可以把参数控制器导出为 `.paramctrl3.json` 并在 SDK 中使用——「只需在 SDK 中指定坐标，即可自由移动定义的目标，模型实时变化」。**对你的语音对话应用很有用**：可以用「目标坐标」做 IK 式驱动（例如视线跟随、身体朝向），而不用为每个组合手工打 keyform。

---

## 7. 替代格式与替代路线

### 7.1 PNGTuber（最省力、$0 起步）
- 原理：几张静态 PNG，按麦克风音量在「闭嘴/张嘴」间切换，可加眨眼、表情热键、简单摆动；**不需要网格、骨骼、面捕**。
- 工具与价格：
  - **veadotube mini**：免费、Win/macOS/Linux、itch.io 4.9★(946 评分)、极简、低占用、支持 GIF/APNG、无限状态槽 + 快捷键/Stream Deck/WebSocket 控制；作者声明「No generative AI was used」。<https://olmewe.itch.io/veadotube-mini>
  - **PNGTuber Plus**（kaiakairos，Godot 制作）：免费/一次性付费（各处口径不一致：itch 页面可直接下载，Steam 有商店页，另有评测写「约 $10 一次性」）；支持 sprite sheet 动画、正弦波移动、挂载、拖拽惯性、弹跳抖动、按说话/眨眼显隐、随时替换贴图、头像可分享；itch 4.7★(223)。<https://kaiakairos.itch.io/pngtuber-plus>、[Steam](https://store.steampowered.com/app/2596880)
  - **PngTuber Maker**（Steam，免费，有日文 UI）。
  - **VTube Studio 也可以当 PNGTuber 用**（加载静态图），好处是以后升级 Live2D 不用换软件。<https://buypngtuber.com/guides/best-pngtuber-software>
- 成本与时间：美术 $0–$80；设置 30–60 分钟；可跑低端机。**总起步成本 $0–$100**。
- 对比 Live2D 起步成本：$400–$3,000+（模型美术 $150–$1,500+ / 绑定 $200–$2,000+ / 摄像头设备 $0–$800）。
- 中间档：「PNGTuber Plus / Lite Live2D」约 $50–$120（PNGTuber 式口型 + 基本身体摆动 + 2–3 个表情切换），据称「观感约等于完整 Live2D 的 70%，价格 25%」。
- 来源：[AnimArts: Live2D vs PNGTuber 2026](https://animarts.studio/blog/live2d-vs-pngtuber-2026-which-is-right-for-you)、[vtubermodelcommissions 对比](https://vtubermodelcommissions.com/pngtuber-vs-live2d-for-beginners/)、[7 Best PNGTuber Software 2026](https://buypngtuber.com/guides/best-pngtuber-software)

### 7.2 3D / VRM 路线（2026 年 AI 化最彻底的一条）
- **VRoid Studio**：免费、Win/macOS、参数化捏人、直接导出 VRM 0.x / VRM 1.0；「30–90 分钟」出模型，但结果与数百万其他 avatar 共享同一 base mesh（可辨识的「模板感」）。<https://www.tripo3d.ai/blog/3d-vtuber-model-maker>
- **AI 单图/文本 → 3D → 自动绑骨 → FBX/GLB**：
  - Meshy：Image/Text to 3D、Auto Split、Pose（A-Pose/T-Pose/Custom）、Remesh、**Auto Rigging 约 30 秒**、600+ 预设动作、导出 FBX/GLB（Unity/Unreal/Blender/Godot）。免费方案模型为 **CC BY 4.0**，付费计划解锁 Private license。<https://www.meshy.ai/zh/features/ai-animation-generator>
  - Tripo：Text/Image/Multi-view → mesh，**Auto Rig（T-pose humanoid/quadruped）**，导出 GLB/USD/FBX/OBJ/STL/3MF（**该快照未含 VRM**），需另做 VRM authoring 步骤。<https://www.tripo3d.ai/blog/how-to-make-a-vtuber-model-with-ai>
  - 3D 生成模型候选：Meshy 7/6、Tripo v3.1 / P2 Smart Mesh、Rodin 2.0、TRELLIS/TRELLIS 2（微软，CVPR'25 Spotlight）、Hunyuan 3D 3.1/2.1（腾讯，含 PBR 烘焙）。<https://sorceress.games/blog/snap-image-to-3d-model-ai-prop-loop-2026>
- **直出 VRM（含面部 blendshape）**：
  - **Neural4D AnimeArt**：文本/角色设定图 → **VRM 0.x，55 骨、52 个 ARKit/VMC 命名 blendshape、spring physics**，2–3 分钟，Pro 计划。<https://blog.neural4d.com/anime-art-generation/how-to-make-vtuber-model/>
  - **Charakuru**（Nano 制作，Tripo 官方赞助，**2026-10-06 免费发布**）：单张全身立绘 → VRM avatar。需要 Node.js 22+、Chromium 浏览器、支持图像生成与浏览器操作的 Codex、Tripo 账号、Blender 5.2 + VRM Add-on + Blender MCP。由「GPT-6.1 Sol / GPT-6 Astra」操作 Tripo 与 Blender，**用户不需直接接触 Blender**，用户只需 5 步（导入立绘→审生成图→选 3D 候选→调比例→检查动作），agent 会在检查点停下由人决策。**当前尚不支持面部表情与眼球运动。** 使用条款：**年总营收与累计融资均低于 1 亿日元时可商用与非商用**。<https://www.moguravr.com/charakuru-ai-character-modeling-kit-en/>、<https://github.com/nanocle/Charakuru>
- **VRM 追踪生态**：VSeeFace（免费、仅 Windows、**只原生支持 VRM 0.x**）、Warudo（免费+付费 Steam，0.x/1.0 皆可）、VNyan（免费，0.x + 部分 1.0）、Animaze（需经 Animaze Editor 导入）。VRM 定义 55 根 humanoid 骨、其中 **15 根必需**（hips、spine、head、双臂三骨链、双腿三骨链）。导出时**必须勾选 Freeze T-Pose**，否则手会垂成 45 度。典型 avatar 8–40 MB。<https://www.tripo3d.ai/blog/vrm-model-generator>
- **重要提醒**：**VTube Studio 是给 Live2D 用的**，有官方面捕/iPhone 跟踪；把 3D VRM 放进 VTS 模型文件夹不会有 Live2D 行为。<https://www.tripo3d.ai/blog/3d-vtuber-model-maker>

### 7.3 Spine 路线
- **Spine 4.x FFD（网格形变）** 才能做 Live2D 式形变；**Spine Ess（$69）不含 mesh deform**，需要 **Spine Pro（$379）**。
- 一个开发者的实战结论：用 Spine 4.x FFD + 加权网格「死在了未文档化的 schema 细节上（顶点顺序、hull、逐帧 deform 时间轴）——文件能解析但渲染出 NaN bounds」。<https://www.patreon.com/posts/dev-note-3-live-158420264>
- 有 **spine2d-animation-mcp**：从 PSD 导入 → 自动绑骨（基于图层名称与结构）→ 自然语言描述生成动画 → 预览/导出。自述限制：**自动绑定依赖 PSD 图层命名规范；动画模板是预定义的，复杂自定义动画需手工调整；NLP 被简化**。<https://mcp.aibase.cn/server/1917154580204548098>
- **Stretchy Studio 也能导出 Spine 4.0 JSON**（bones/slots/attachments/animation tracks + 自动图集打包），**Spiritus 论文可导出 Spine 兼容骨骼动画**。

### 7.4 Reallusion Cartoon Animator（PSD 模板自动绑定的成熟商业方案）
- 提供 **免费 PSD 角色模板（G3 模板骨 / Free Bone）**，把部件放进对应命名文件夹即可自动绑骨，随后套用内置 motion library；有 **Auto IK Rig for Imported Photoshop Template Characters**、360 度头部、Sprite Sequences 口型、Spring Bone、PSD 往返编辑。
- 局限：它是「2D 木偶动画」而不是 Live2D，生态是 CTA 自己的 runtime（iClone / Unreal 管线），与 VTube Studio / moc3 不通用。
- 来源：[PSD character animation](https://www.reallusion.com/cartoon-animator/PSD-character-animation.html)、[2D Character Creation](https://www.reallusion.com/cartoon-animator/2D-character-creation.html)、[Importing PSD](https://manual.reallusion.com/Cartoon-Animator/Content/Resources/5.1/07-PSD-In/Creating-Assets-with-PSD-Editor.htm)

### 7.5 桌面宠物运行层（他的第三个用途）
大量开源 Electron/Python 桌宠项目已支持 moc3，可直接复用：
- [ChatGPT 桌宠（kirbystudy）](https://github.com/kirbystudy/chatgpt-desktopPet)：Electron + pixi-live2d-display，支持 moc/moc3、拖拽（单/双屏）、开机自启、语音口型同步、ChatGPT 聊天、VITS TTS、壁纸模式。
- [live2dpet（f25h-233）](https://github.com/f25h-233/live2dpet)：PySide6 + live2d-py + ZeroMQ 四进程；Cubism 2.x 与 3+ 渲染、自动眨眼呼吸、眼球追鼠标、LLM 对话、情感 TTS(GPT-SoVITS)、系统监控、截屏视觉分析、随机睡眠与主动搭话。
- [Live2DPet / Live2DPet Enhanced（x380kkm，多个 fork）](https://github.com/dwgx/Live2DPet)：Electron + pixi-live2d-display；模型热导入（自动参数映射、表情/动作自动扫描）、截图+活动窗口的 AI 视觉感知、VOICEVOX 本地 TTS、Whisper 本地 STT、关键帧视觉记忆。
- [NyaDeskPet](https://github.com/gameswu/NyaDeskPet)、[Desktop-pet（git2968）](https://github.com/git2968/Desktop-pet)（支持 Codex `hatch-pet` 的 `pet.json + spritesheet.webp` 格式作为 Live2D 之外的替代）、[DeskPet Live2D（tcmiku）](https://github.com/tcmiku/tools_live2D)。
- 注意所有仓库都强调：**源码许可以不等于素材授权**；Live2D 示例模型（如 Miku）受 Live2D 版权保护，别随手打包发布。

---

## 8. 输入要求对照表

| 路线 | 必需输入 | 单图能否起步 | 主要前置质量要求 |
|---|---|---|---|
| 官方 Cubism 手工建模 | **分层 PSD**（载入用 PSD：每部件合并为一层、蒙版已应用、无路径数据；格式 PSD / RGB / 8bit / sRGB） | ✗ 必须先切图 | 命名唯一、部件拆分粒度与可动范围匹配 |
| See-Through + 人工修 | **单张动漫立绘**（背景可不管，论文说明不重建背景） | ✓ | 正面/3/4 侧、边界清晰、脸上有可见五官；一体式服装与配件容易重复分层 |
| psd2live | **分层 PSD** | ✗ | 图层语义可被识别；命名建议按官方/项目词表 |
| Stretchy Studio | 打了标签的 PSD（可来自 See-Through） | 间接 ✓ | 层名需带标准标签（`face`、`mouth`、`eyewhite-l/r`…）；也能用他自己的启发式/DWPose 自动打标 |
| Bunraku（研究） | **单张插画** | ✓ | 论文未提供部署要求；公开权重情况不明 |
| PNGTuber | 2–4 张透明 PNG（闭嘴/张嘴/眨眼/表情） | 间接 ✓ | 原画需能分离出嘴部 |
| VRM/3D AI 路线 | 单张全身立绘或文本 prompt | ✓ | 中性 T/A-Pose、四肢分离、干净拓扑、去背景；AI 图常需先去底 |
| Cartoon Animator | 按官方模板命名的分层 PSD | ✗ | 必须用其 PSD 模板与文件夹分组规则 |
| Spine | 分层 PSD + 手工/半自动绑骨 | ✗ | 需要 Spine Pro 的 mesh deform |

---

## 9. 价格行情（2026-10）

### 9.1 软件 / 服务
| 项目 | 价格 | 来源 |
|---|---|---|
| Cubism Editor **FREE** | 永久免费；**商用仅限「普通用户」与「小规模事业者」（年销售额 < 1000 万日元）**；超限不能保存 | [FREE/PRO 功能比较](https://www.live2d.com/zh-CHS/cubism/comparison/) |
| Cubism **PRO for indie**（个人 / 年销售额 < 1000 万日元） | 3 年合约 **¥36,720（约 RMB 1,555）**；第三年起平均每月 ¥890；另一口径：月 2,288 円 / 年 15,708 円（约月 1,309 円，含税，2026-10 时点）；帮助页提到包年/1 年合约第二年 11,760 円 | [Live2D Store](https://store.live2d.com/cn/)、[shiroikarasu](https://shiroikarasu.net/live2d-vtuber-model-guide/)、[切换方案帮助页](https://help.live2d.com/zh-CHS/store/store_29/) |
| Cubism **PRO for business**（年销售额 ≥ 1000 万日元） | 需询价（store 页未公开数字）；跨档需切换 | [Live2D Store](https://store.live2d.com/cn/) |
| 素材分割 Photoshop 插件 | **PRO 用户免费**（含 42 天试用期内）；需 PS 2024/2025，安装约 6GB | [下载页](https://www.live2d.com/en/cubism/download/material-separation-ps-plugin/) |
| Cubism SDK | **免初期费用**；发布时才需签约付费；**个人 / 小规模事业者豁免**（Expandable Application 除外） | [SDK 发行许可](https://www.live2d.com/en/sdk/license/) |
| Cubism SDK MotionSync Plugin | **免版税**、无需显示 CRIWARE logo | [Web 插件页](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/) |
| VTube Studio | Steam 免费（去水印 DLC 约 ¥1,520 日元 / ~$10–15 一次性） | [shiroikarasu](https://shiroikarasu.net/live2d-vtuber-model-guide/)、[buypngtuber](https://buypngtuber.com/guides/best-pngtuber-software) |
| Spine Pro / Ess | $379 / $69（Ess 无 mesh deform） | [roboticcontent](https://roboticcontent.com/free-open-source-tool-to-instantly-rig-and-animate-your-illustrations-also-with-mesh-deform/) |
| Inochi2D / nijigenerate / Umamo / Ayagami / See-Through | 免费开源（BSD-2 / GPL-3.0 / MIT+Apache-2.0 / Apache-2.0） | 各自仓库 |
| ImageToLayers | Creator $19/月（$120/年，1000 credits）；Studio $49/月（$360/年） | [Catalora 评测](https://catalora.ai/tool/imagetolayers) |

### 9.2 代工行情（Live2D 建模）
**中文圈**
- 米画师：「画图+拆分+建模一条龙」橱窗 **5,580 元/套**，累计售出 30 件，1121 条评价，准时交稿率 100%。
- B 站工房：Q 版定制 800 元包设计；正比全身定制 2,500 元起；**自带立绘纯建模 800–2,000 元**；买断翻倍。
- 报价模型与参考：Q 版/PNG 轻量款 80–800 元（月 10–20 单，副业 3,000–8,000 元）；正比一条龙 2,000–6,000 元（月 2–4 单，工期 3–6 周）；纯建模/纯拆分 800–2,000 元。
- 加购明码：表情 30–50 元/个、手势 150–300 元、新衣 500–1,500 元/套；**买断翻倍是行规**。
- 来源：[cpengx《AI 做 V 皮》](https://www.cpengx.cn/productivity/m-ai-live2d.html)

**台湾 / 香港（NT$）**
- 純建模（別人畫我建）20,000 起；拆件立繪（我畫我拆）15,000 起；他繪師無拆件立繪（我拆我建）30,000 起；已有設定一條龍 40,000 起；無設定一條龍 48,000 起。——[林雅婷](https://yatingsosmart.wixsite.com/linyating/vtuber-live2d)
- 拆件立繪 25,000–50,000 起；Live2D 建模基礎款 20,000 起（含頭部 XYZ、身體 XYZ、頭髮/衣服/身體物理、呼吸、4 種按鍵表情）；完整 V 皮 = 立繪 30,000 + 建模 20,000 ≈ **50,000 起**。——[白露/HAKURO](https://www.hakuroartwork.com/i0yv91e1-4/this-is-a-title-01)
- 其他档位：簡易建模 5,000 起 / 基礎 15,000 起 / 中階 23,000 起 / 高階 35,000 起 / 精緻 45,000 起（含各档说明与加购项，如 VBridger +4,000、正面手臂+手掌+手指 XYZ 全配 +4,000）。——[筱奈 Live2D 建模](https://shiaonaii-live2d.carrd.co/)
- 参考价（另一位）：基礎半身 5,000+ / 進階半身 8,000+ / 基礎全身 10,000+ / 進階全身 15,000+（台幣）。——[龍龍](https://ryurorolive2d.wixsite.com/live2d/general-4)
- 工期与流程（含分期付款、修改次数、跑单条款）见 [HarukaCC 委托须知](https://harukacc.mysxl.cn/commission)（「常规委托」至少约 4 周；制作周期 30–60 天，立绘+建模可能 6–12 个月；定金 + 尾款；明确「不接 0 拆分经验的立绘」）。

**日本（円）**
- 個人口径：キャラデザ 1–5 万 / イラスト（含拆件）5–15 万 / **モデリングのみ 5–15 万** / フルセット 10–20 万；制作会社：5–10 万 / 10–20 万 / 10–20 万 / 30–80 万。**人气画师含指名料 20 万起；著作权让渡约为制作费的 2–3 倍。**——[v-oshi 2026 版](https://v-oshi.net/articles/vtuber-tachie-live2d)
- 具体报价单实例：モデリングのみ **90,000 円〜** / イラスト+パーツ分け 90,000 円〜 / フルオーダー（デザイン+拆件+建模）**220,000 円〜**；对应ソフト VTubeStudio / nizimaLive；**AI 学习与 AI 生成用途明确禁止**。——[つなぐ / 式守楼花](https://tsunagu.cloud/products/112123)
- 另一个实例：ミニモデル 40,000 円 / 等身シンプル 55,000 円 / 等身スタンダード 85,000 円；加购项极细（瞳・睫毛动作扩充 6,000 / 上顎ライン消し 5,000 / 复杂髪揺れ 8,000–15,000 / 斜め向き原画対応 10,000〜 / **著作権買取 = 見積金額の 120%** / PSD 交付 20,000 / cmo3 交付 = 見積の 50% 加算…）；**明确写「生成AIを利用した資料の作成、ご共有はご遠慮ください」**。——[つなぐ / 5742 号商品](https://tsunagu.cloud/products/7412)
- 一条龙实例（つなぐ 117901）：すべておまかせ 150,000 円（含 4 表情差分）/ モデリングのみ 80,000 円（**已拆件 PSD 自备**，若要代拆 +35,000 円）/ イラストのみ 90,000 円；加购：表情差分 2,000/点、舌出し 4,000、ポーズ差分 5,000、髪型差分 30,000、服装差分 40,000、アニメーション 20,000〜、**著作権譲渡 = 合計の 100% 加算**、psd 交付 20,000、**cmo3（作業データ）交付 = 合計の 50% 加算**；工期参考：设计 2 周 / 拆件立绘 3 周 / 建模 3 周，全工程约 2 个月；模型制作 30–60 天。**注：该商品页写「現在、ご依頼多数のため着手まで 1〜2 か月」。**

**海外（Fiverr / VGen）**
- 纯绑定（提供 ready-to-rig PSD）：**headshot $70 / half-body $140 / full-body $200**（Junigames13）；另一位 headshot 起、fullbody rig only $200。
- 「art + rig」全包：Basic（Bust-up + 标准 rig）**$90** / Standard（Halfbody）**$200** / Premium（Fullbody + 免费 PFP）**$280**；VBridger 支持 **+$200**，Video Debut +$100；工期 5–14 天。——[Nekkonimestore](https://www.fiverr.com/nekkonimestore/design-and-rigging-anime-character-live2d-model-and-vtuber-for-stream)
- 另一档：Half body art + rig **$700** / Full body art + rig **$1,000**（含 art 的全包）；**VBridger rigging +$150**（含 mouth funnel、press lip open、pucker、shrug、jaw open、mouthX）。——[Elisaine](https://www.fiverr.com/elisaine/rig-your-vtuber-avatar-or-design-a-vtuber-characters-for-you)
- 高价档：Base model Full body **$850** / Half **$720** / Bust **$600**；加购：Clothing/accessories $10–300/部件、Expression hotkey $40–200、Hand tracking **$350–600**、Chibi toggle $250、**Cmo3（源文件）$1,000**、**PSD $500**、Express（7–14 天）总价 +30%、**Commercial use +$1,000**。——[Maxasada](https://www.fiverr.com/maxasada/design-live2d-vtuber-facerig-models)
- 极低价档（品质自评「good-quality」）：€50 以下 / €50–100 档，附加表情 $2/个、服装或发型 $6/个、Hips swaying $15。——[Veilof](https://www.fiverr.com/veilof/rig-your-live2d-vtuber-character-model-cheap-and-quick)
- **中文圈的海外溢价结论**：英文市场全身绑定报价 **$500–1500**、知名画师作品 **$2000 起且排队数月**；「同样的活儿贵出 3–5 倍」。——[cpengx](https://www.cpengx.cn/productivity/m-ai-live2d.html)

---

## 10. 版权与商用授权（本报告最需要注意的部分）

### 10.1 Live2D Cubism **Editor** 软件使用授权协议
- **商用门槛**：只有「普通用户」与「小规模事业者」（最近年销售额 < 1000 万日元）可用 FREE 版作商用/营利；其余主体用 FREE 版仅限「非营利目的或监修目的」，输出文件仅限「内部用途 / 非营利 / 监修」。超限则无法保存文件。
- **可以接单**：官方帮助中心明确——「我们不会禁止用户使用 Live2D Cubism Editor 接受第三方的委托来制作作品」，**但不得把软件功能本身作为事实上的主要价值提供给第三方**（例如把只有许可证持有者才能用的输出功能做成服务）。
- 协议原文（5.1.7）：「您不得向第三方提供以『代理使用』为业务内容的承包服务等」，定义是「**把本软件或其功能本身作为事实上的主要价值提供给第三方**」；反面明确：「**您接受第三方委托制作作品、或销售您自己制作的作品，不属于代理使用请负服务**」。
- **5.1.2 禁止反向工程**：不得反向工程、反编译、反汇编或试图破译源代码（例外：为自己使用而修改软件、并为调试该修改而做的反向工程）。
- **5.1.9 其他限制行为**：① **输出文件不得与 Live2D 开发的中介软件（middleware）或可能与之冲突的中介软件组合使用**；② 未经授权不得公开发布软件/输出文件中包含的本软件任何代码与内容；③ 不得抽离软件部分单独使用或发布；④ 不得移除商标/版权标识。
- **一条极易踩的条款（Editor 协议与 Open Software 协议中都有）**：「**以『损害 2D 创作者创造性』为主要目的来开发或出版发行派生作品而使用本软件**」被列为禁止事项。
  → 原文（日）：「想定する主たる用途として、2Dクリエイターの創造性を毀損するおそれのある派生作品の開発または出版・配布を行うために、本ソフトウェアを使用すること。」
  来源：[软件使用授权协议（CN）](https://www.live2d.com/eula/live2D-editor-software-license-agreement_cn.html)、[Software License Agreement (EN)](https://www.live2d.com/eula/live2D-editor-software-license-agreement_en.html)、[我可以使用 Live2D 承接工作吗？](https://help.live2d.com/zh-CHS/store/store_14/)、[我可以出售自己制作的模型文件或作品吗？](https://help.live2d.com/zh-CHS/other/other_14/)

**「代理使用请负服务」与推介服务的关系**（对第三方「AI 代做 Live2D」SaaS 尤其重要）：官方说是否构成由 Live2D 自行裁量；**Live2D 示例模型/素材不得用于商业**（另有单独的《无偿提供素材使用授权协议》与《Live2D Cubism 示例数据使用条件》，一般用户与小规模企业可自由商用，但 unity 酱与初音未来除外）。

### 10.2 Live2D Cubism **SDK 发行许可（出版许可协议）** —— **他做网页端语音对话应用的直接风险点**
- 基本规则：SDK **免初期费用**；**发布时**才需签 SDK 发行许可（Publication License Agreement）并付费，**须在发布前至少 1 个月完成签约**；**个人与小规模事业者（年销售额 < 1000 万日元）免除签约与付费**——**但 Expandable Application 除外**。
- **Expandable Application（可扩展性应用程序）的定义**：*"any work having significant expandability among services or content utilizing SDK products. In particular, it includes the Derivative Work which uses and generates any indefinite numbers of models by adding or combining files or data (e.g. avatar), or, the Derivative Work containing multiple or other works in one title, or accessible to such works through one title (e.g. collection of relevant works or portal)."*
  → **一个能加载任意 Live2D 模型（avatar 系统）的应用，几乎正好落在这个定义里。**
- **要求（所有发布者一致，包括通常被豁免的个人与小规模事业者）**：
  1. 必须有**有效的营收模式**（原则上「完全免费」不予批准）；
  2. 同意**提交销售报告并按营收分成**；
  3. 用于直播的应用程序必须在 EULA/使用条款中包含 Live2D 指定的声明；
  4. 显示 Expandable Application logo 并在 Live2D 的 Showcase 中列出；
  5. 每个 Expandable Application 都要**逐件审查 + 单独签约**；即使满足条件也**不保证获批**；「完全免费的 Expandable Application 在另行规定的条件下**有时**可以获批」。
- **费率表（Expandable Applications）**：
  | | General User / Small-Scale（年销售额 < 1000 万日元） | Middle-Scale（1000 万–1 亿日元） | Large-Scale（≥ 1 亿日元） |
  |---|---|---|---|
  | 基本初始费 | 免费 | $315.99 [¥50,000] | $1,895.94 [¥300,000] |
  | 基本年费（每平台） | 免费 | $1,516.75 [¥240,000] | $7,583.75 [¥1,200,000] |
  | 营收分成 | **¥300/笔 或销售额的 20%，取高者** | 销售额 5% | 销售额 5% |
  - 「Sales」定义含派生作品的销售与使用收益，**第三方平台/市场代收时按扣佣扣税前的金额计**，**广告收入也计入**；需**按季度报告**。
- **追踪软件（VTube Studio / nizima LIVE 等）的特别说明**：这类软件属于 Expandable Application。使用追踪软件做 VTuber 直播时，其 EULA 中有固定声明：*「本应用包含 Live2D Cubism SDK……若把本应用作为业务的主要要素使用，且本应用或其制作内容直接/间接产生的**年销售额超过 2,000 万日元**，则需与 Live2D 另行签订出版许可协议并支付许可费，且**超过后须立即联系**」*——「作为业务的主要要素使用」**包括但不限于从事 VTuber 直播业务**，但**不包括用其发布产品宣传视频**。
- 其他档位（供对照）：Running Royalty（游戏/应用）中规模 **$315.91 初始 + $126.36/月/平台/区域**、大规模 **$1,895.45 + $631.82/月**；区域共 6 个（日本 / 中国大陆港澳台 / 亚洲其他 / 北美 / 欧洲 / 其他），平台共 4 个（iOS / Android / HarmonyOS / **Web**）；一次性购买（主机・PC）大规模 **$22,749.89**，中规模 **$3,791.65**，或按量产 $0.25/份（大规模最低保证 30,000 份）；视频内容 Running Royalty 见 C 计划（中规模 $315.97 + $126.39/月）；另有「非营利内容计划（D/E）」「无营收（如 signage/web content）」等分支。
- 折扣条件：官网列出的费率是**「在内容中显示 Live2D logo 并在 Showcase 页展示内容」后的特别折扣价**；不这么做费率不同（需另询）。
- 来源：[SDK Release License](https://www.live2d.com/en/sdk/license/)、[A. Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/)、[G. Running Royalty for games/apps](https://www.live2d.com/en/sdk/license/running_plan01/)、[C. Running Royalty for video](https://www.live2d.com/en/sdk/license/running_plan02/)、[F. One-time Purchase Console/PC](https://www.live2d.com/en/sdk/license/purchase_plan01/)、[企业规模判定](https://help.live2d.com/en/sdk/sdk_007/)、[哪些情况需要签约](https://help.live2d.com/en/sdk/sdk_001/)

**对他项目的直接含义（据上述条款推演）**
- 若他的「Live2D 语音对话网页应用」**只在本地跑、不对外发布**：开发/验证阶段无需签约。
- 若**对外发布**（哪怕免费），且它能加载任意 moc3 模型（即 avatar 系统），则属 Expandable Application，**个人身份也不能豁免**，需要走审查+单独签约+分成；「完全免费」原则上不予批准。
- 若他改为**只随应用内置自己的模型、用户无法添加任意模型**，则不构成「generates any indefinite numbers of models by adding or combining files」，就不落入 Expandable Application 定义；此时若营收在 1000 万日元以下，个人可直接豁免。**这是产品定位层面的关键决策点。**

### 10.3 Cubism Core 的再配布限制
- Cubism Core（`live2dcubismcore.js` / native lib）**依 Live2D Proprietary Software License Agreement，不在 GitHub 公开、禁止再配布**，只随官方包分发。
- 官方为 Web 提供 **「Cubism Core for Web」（用于 hosting 用途）**——<https://www.live2d.com/en/sdk/download/web/>。
- Live2D 官方论坛答复确认：「**Cubism Core 依据 Proprietary 协议禁止再配布**」，因此第三方库要走「① 只提供依赖 Core 文件的库文件，② 或只提供源码」的路线；同时 Open Software 协议禁止「以会使代码适用 excluded license（开源可改）的方式修改/分发源码」。
- 来源：[Cubism Core（SDK Manual）](https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/)、[官方论坛答复](https://creatorsforum.live2d.com/t/topic/1942)

### 10.4 **nizima / Live2D Creative Awards 对 AI 生成插画的封禁（硬性）**
- **nizima（Live2D 官方市场）政策**（2024-05-07 修订）禁止投稿、销售、以及在定制交易中交付以下作品：
  - 用图片生成 AI 生成的作品；
  - **以图片生成 AI 生成的插画为原画的作品**；
  - **对 AI 生成插画进行描摹（tracing）的作品**；
  - 对 AI 生成插画加笔、变形后的作品；
  - **上述插画 Live2D 化后的作品**；
  - 用图片生成 AI 给自制插画添加原画中不存在的物体的作品。
- **例外**（不属于「AI 生成作品」）：① 对原画中已有物体使用画笔软件内的自动上色、背景涂开等**辅助功能**；② 使用 **Cubism Editor 内的 Live2D 制作辅助功能**（含「动作自动生成」，官方说明其学习用途/过程/目的与图像生成 AI 不同）。
- **审查机制**：nizima 会做数据与销售基准检查，并**使用「图像生成 AI 作品检出判定工具」**；被检出可能拒收；可提交制作过程数据申请复审。官方也承认**目前不存在能完全判定是否使用过 AI 的方法**，因此**存在误判**（未使用 AI 却被拒的可能）：一旦复审后仍判定不可，则不可在 nizima 投稿/销售。
- **Live2D Creative Awards（第 13 届，2026）禁止事项**同口径：**制作过程全部或部分使用图像生成 AI 或类似技术制作的插画，以及使用这些插画制作的内容（含对其加工/修正后的作品）**不得参赛；例外同上（画笔工具辅助、Cubism Editor 制作辅助）。另注意「第三方支付报酬制作的作品」也不可参赛。
- **Live2D 官方 AI 研究政策**（关键立场）：
  1. 「为了创作者幸福」；
  2. **「不以 AI 全自动建模为目标」**——目标是降低达到最低品质所需的工时，把工时留给品质提升；
  3. **「Live2D 公司不会研究从零生成插画、或从插画全自动 Live2D 模型化的技术」**；研究范围仅限**以原画为起点**，用 AI 辅助「素材分け、建模、动画」工序。
  - 数据来源：nizima 投稿模型数据（需创作者在设置中授权；改为不授权后 60 天内从学习中排除）。
- 来源：[nizima「图像生成AIによる作品」投稿限制](https://docs.nizima.com/guide/ai-policy/)、[审查说明](https://docs.nizima.com/guide/ai-policy-itemjudging/)、[Live2D AI 研究政策](https://docs.nizima.com/ai-research-policy/)、[Live2D Creative Awards 13th 禁止事項](https://www.live2d.com/event/awards13/)
- **含义**：他对 OC 的态度如果是「自己用」没有任何障碍（nizima 只是市场政策）；但如果打算在 nizima 出售/接单，**AI 生成的原画即被禁**。社区反馈也印证敌意：*「Live2D 和延伸出去的 VTuber 社区讨厌工作流里出现 AI。祝你别被抓到。之前就有个在 Twitter 上用『AI 工具』一张图做 Live2D VTuber 的人被大面积声讨/取消。」*（[Reddit 快照](https://reddit.sentinel-team.org/posts/1wm6p3f/snapshots/2026-09-26T00%3A10%3A19.642204Z)）。ArcLoop 的指南也建议：**第一封委托沟通就把「画是 AI 来源」说清楚**，「有些人会直接拒接，更多人会接但把清理工作算进报价」。

### 10.5 AI 生成图片在中国的可版权性（判例现状）
- **倾向于可受保护（严格举证）**：
  - **北京互联网法院「春风送来了温柔」案（2023-11 一审，全国首例 AI 文生图著作权案）**：原告用 Stable Diffusion，经选择模型、设计提示词、不断调参生成，体现了审美判断与个性表达，**认定构成美术作品，原告享有著作权**，判赔 500 元 + 公开道歉。法院强调「**人工智能模型不是法律上的主体，不能成为著作权法上的作者**」。<http://news.cyol.com/gb/articles/2025-03/13/content_LgAmMxCGKN.html>
  - **武汉东湖新技术开发区法院（2025-02 报道）**：输入几十个关键词、经几十次输出筛选最终得到图片，关键词与画面元素效果对应、有「映射性」，认定独创性；判侵权方赔偿 4,000 元。<http://society.people.com.cn/n1/2025/0211/c1008-40416238.html>
  - **常熟法院「伴心」案**：用 Midjourney + Photoshop 生成，法院认可平面美术作品受保护并判赔 1 万元，但**立体装置不构成复制不侵权**——原告只登记了图片版权、未打包登记造型/外观专利，留下漏洞。<https://m.yangtse.com/news_details.html?id=4144638>
- **反向判例（严格举证要求）**：
  - **苏州中院 / 张家港（2025-04 生效，全国首例认定 AI 文生图不构成作品）**：**「简单提示词 + AI 生成」不构成作品**。原告无法说明关键「垫图」来源、缺乏创作过程原始记录、且**无法复现同图**，法院认定证据不足，不构成作品、不侵权。<https://www.zjwx.gov.cn/art/2025/4/30/art_1673576_58876696.html>
  - **北京互联网法院（2025-09 发布）「猫咪晶钻吊坠」案**：原告未提交生成过程记录，事后用同款软件「复现描述」不构成原始过程还原，**认定不构成作品，驳回全部诉请**。法院明确举证要求：用户有义务说明**创作思路、输入指令内容、对生成内容选择和修改的过程**并提交证据（提示词、迭代过程、草图、选择记录、修改记录），并建议创作者建立「**过程留痕**」意识。<https://www.ciplawyer.cn/articles/157579.html>
- **实务结论（据最高检采访与判例）**：
  - 独创性判断是**个案认定**；关键在**人类对创作过程的控制和预见**与**对表达要素的个性化选择**；
  - **简单指令（如「画一只猫」）只是思想，不构成作品**；
  - **AI 平台用户协议可能约定版权归属平台**（需公平原则与提示说明义务，否则法院可不采）；
  - **2025-09-01 起《人工智能生成合成内容标识办法》施行，正确标识 AI 生成内容成为法定义务**；案件中被法院肯定的做法是原告主动标注配图由 AI 生成；
  - 另注意**「垫图」侵权风险**：擅自用他人 IP 形象（如奥特曼）做垫图生成相似形象，可能侵害原作者权利。
  - 来源：[最高人民检察院《AI创作的权利边界在哪里？》](https://www.spp.gov.cn/zdgz/202504/t20250425_694112.shtml)、[锦天城《AIGC 版权战》](https://www.allbrightlaw.com/CN/10475/17c7f725ce459637.aspx)
- **对他最有操作性的建议（源自上述判例）**：保住 prompt 记录、参数、多轮迭代与挑选过程、原始素材与「垫图」来源、时间戳，并做著作权登记；不要只靠「简单提示词」。

### 10.6 第三方工具生成 moc3/cmo3 的法律灰区（据现有条款推演，非法律意见）
- **`.moc3` 是封闭二进制格式**，其唯一大规模 reader 是 Live2D Cubism Core（且无边界检查，见 CVE-2023-27566）。
- 现有开源读写实现普遍自述是**「黑盒逆向」/「由反编译 Cubism SDK exporter 移植而来」**：
  - Ayagami：「Black-box reverse engineering! 用 hex editor 看 MOC3 结构，再手工造测试模型喂给 VTube Studio 观察渲染」，并自述「完全黑盒独立实现，**不受 Live2D 许可条款约束**」，且明确声明「与 Live2D 无关联、未获授权、未获背书」。
  - Umamo：「CMO3/MOC3/CLIP 的编辑器格式知识是**通过黑盒观察文件输出独立产出文档**得到的 clean-room reimplementation」；仓库标注 GPL-3.0。
  - py-moc3：「Ported from moc3-reader-re（Cubism SDK exporter 的 Java 反编译）」。
- 相关限制条款：Editor 协议 **5.1.2 禁止反向工程**；Editor 协议 **5.1.9「输出文件不得与 Live2D 开发的中介软件或可能与之冲突的中介软件组合使用」**；Open Software 协议 **5.7 同款限制** + 禁止以开源可改的方式分发。
- **风险归属需分开看**：`psd2live` / `Stretchy Studio` / `Umamo` 这些「写出 moc3/cmo3」的实现者的风险，与**你只是用它们生成的模型来渲染/直播**的风险，并不相同。可明确的是：
  - **你使用「第三方工具产出的 moc3」这件事本身，没有在 Live2D 面向使用者的协议里被点名为禁止行为**（协议禁的是对**Live2D 自家软件**的反向工程、以及「把输出文件与竞争性 middleware 组合使用」）；
  - 但「与竞争性中介软件组合使用」这一条措辞较宽，且判断权 Live2D 保留；**若模型用于商业发布，建议向官方确认或改用官方 Cubism 导出路径**。
  - 另一个必须注意的点：把第三方工具生成的文件放进 VTube Studio 等**含官方 Cubism SDK 的软件**里，等于同时受该软件 EULA（含 SDK 出版许可声明）约束。
- 来源：[moc3ingbird](https://github.com/OpenL2D/moc3ingbird)、[Ayagami](https://github.com/AyagamiDev/ayagami)、[Umamo](https://github.com/umamoorg/umamo)、[py-moc3](https://github.com/Ludentes/py-moc3)、[Live2D Editor EULA (CN)](https://www.live2d.com/eula/live2D-editor-software-license-agreement_cn.html)、[Live2D Open Software EULA (CN)](https://www.live2d.com/eula/live2d-open-software-license-agreement_cn.html)]

### 10.7 其他容易忽略的授权点
- **See-Through 权重是 OpenRAIL++**：**允许商用**，但第 5 段与 Attachment A 的使用限制对**每一次使用**都适用；**若分发权重或其衍生、或作为服务托管，必须把这些限制作为可执行条款写入你与用户之间的条款里并告知用户**。源模型链（Animagine XL 4.0 / SDXL / LayerDiffuse / Marigold / SD2）的许可都要继续遵守。见 [HF 权重页](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d)。
- **Live2D 示例模型不可商用**（除非另有《无偿提供素材使用授权协议》与《示例数据使用条件》；unity 酱与初音未来明确除外）。
- **第三方绑定的著作权让渡（买断）是单独加价项**：日方常见「合計金額の 100% 加算」「見積金額の 120%」，或占用范围的 50%/80% 加算；Fiverr 上有 **Commercial use +$1,000**。做商用一定要在报价阶段确认「版权归属 / 商用范围 / 二次创作 / 能否用于 AI 训练」。
  - 反例：`tsunagu.cloud/products/112123` 明确写 **「×AI学習、AI生成への使用」**；`tsunagu.cloud/products/7412` 明确写 **「生成AIを利用した資料の作成、ご共有はご遠慮ください」**。
- **中国的 AI 标识义务**：见 §10.5。

---

## 11. 路线对照与「最省力」推荐（按证据推演的合成方案）

### 11.1 路线对照表
| 路线 | 起步时间 | 现金成本 | 手工量 | 输出质量 | 是否能给「Live2D 语音对话应用」用 | 主要风险 |
|---|---|---|---|---|---|---|
| **A. 全手工 + 官方 Editor** | 学 3 个月入门 / 6–8 个月商用 | PRO 约 ¥12,240/年（3 年合约 ¥36,720）；或 FREE（有硬限制） | 极大（拆件 + 绑定 + 调参） | 最高，可控 | ✓ 完全合规 | 时间成本最高 |
| **B. AI 加速拆件 + 人工/代工绑定** | 2–6 周（取决于代工排期） | AI 工具 $0–$19/月 + 代工 800–6,000 元（或 $90–$1,000） | 中（拆件修补 + 沟通） | 中高（取决于绑定师） | ✓（但别投 nizima） | 绑定师可能拒接 AI 原画或加价 |
| **C. See-Through/psd2live/Stretchy 全自动链** | 数小时–数天 | $0（除算力） | 中高（修补工具的输出：拆合并部件、重排层、修边缘、修遮挡补图） | **中低**（自述未通过 Editor 一致性验收） | △ 模型可用，但自动产出 moc3 的合规性属灰区（§10.6） | 工具早期、宣称与实际落差大 |
| **D. PNGTuber** | 30–60 分钟 | $0–$100 | 极低 | 低（但足够直播/桌宠） | ✗ 不是 Live2D 模型 | 无实质风险 |
| **E. VRM / 3D 路线** | 30 分钟–数天 | VRoid 免费 / AI 平台月费 | 低–中 | 中（风格受模板或 AI 限制） | ✗ 与 Cubism SDK 不同技术栈 | 需重做应用侧渲染 |

### 11.2 证据支持下的「最省力现实组合」（分目标给）
**目标一：尽快让自己的 OC 在网页应用里动起来（哪怕不能面部追踪）**
按现有证据，最省力的组合是：
1. **See-Through 把立绘切成 PSD**（HF Space/ModelScope 免费，每天 1–2 次；或本地跑量化模型，Apache-2.0 + OpenRAIL++，允许商用）；
2. **用绘图软件按 §4.4 的 SOP 收尾**（拆开被合并的左右手臂、重排层序、修边缘、把阴影单独建层、压平到「载入用 PSD」规格，格式务必 PSD/RGB/8bit/sRGB）；
3. **交给绑定师做「纯建模」**（中文圈 800–2,000 元 / 日本 8–15 万円 / Fiverr $70–$200），并要求交付 `.moc3 + model3.json + physics3.json + 表情/动作文件`；
4. 口型用 **不过 CDN 的两种做法之一**：音量 RMS 驱动（最简单），或 MotionSync Plugin（免版税，需 Core，效果最好）。
理由：**Bunraku 论文、ArcLoop、社区实测、独立开发者复盘四处独立来源一致指向同一结论——「分层已可 AI 化，绑定不可」**，因此最省力的做法是「让 AI 做它已经能做好的那一段，把剩下那一段外包」。

**目标二：想自己动手、不外包，但也不想投入 6–8 个月**
1. **降低模型规格**：做「半身 + 眨眼 + 口型开闭 + 头部 XZ 轴（不做 Y 轴）」的最低规格。日方行内明确说 **Y 轴（上下看）制作难度与成本最高**，XZ 组合「观感差异没有成本差异大」。可选：不做身体、不做腿、不做手（KEREN 讲座观点）。
2. **用 Cubism 官方 AI 半自动功能把体力活压缩**：5.1 起的「变形器的自动生成」（省掉全身变形器搭架子）+「摇摆运动的自动生成」（省掉头发/饰品物理）+ 5.0 起的「面部动作的自动生成」（正面脸限定）+「自动网格生成」。
3. **注意 FREE 版硬限制**（这会直接决定你要不要买 PRO）：纹理文件最多 1 张（≤2048px）、**ArtMesh ≤ 100**、**动作参数 ≤ 30（含 Blend Shape 参数）**、Blend Shape 参数 ≤ 3、变形器 ≤ 50、部件 ≤ 30、ArtPath ≤ 3、Warp 变形器分割数 ≤ 9×9、Draw Order group ≤ 2。对照 §1 的部件数分级（简易模型就 100–150 件），**FREE 版基本只够做「极简模型」**。→ 实务上大概率需要 PRO。
4. **如果决定写代码自动化**：把预算花在 Cubism **5.4 的外部连携编辑 API**（+ 现成的 `CubismExternalEditMCP` 42 个工具）上，用它程序化地批量建参数/部件/变形器、批量写 K 帧——**但要接受「PSD 导入 + ArtMesh 创建」这一步仍需 GUI**（API 名单里没有 AddArtMesh / PSD import / texture 相关命令，见 §5.2）。另外记住 alpha 版本的可用期限制与「数据仅限 alpha 版使用、无任何保证」。
5. **如果连 Cubism 都不想碰**：用 **Umamo（GPL-3.0，有 headless CLI）** 做 cmo3↔moc3 转换与检查，或用 **Stretchy Studio**（浏览器端，可导出 Live2D runtime 与 cmo3）跑一遍自动绑定，再人工挑明显错误修。**但要接受成熟度风险与 §10.6 的合规灰区。**

**目标三：先有个能直播/能当桌宠的形象，慢慢升级**
1. 先用 **veadotube mini 或 PNGTuber Plus**（免费）在几十分钟内上线；
2. 同时用 AI 出「同一角色的闭眼、张嘴、撩头发、脱外套」参考视角（§4.4 的做法），准备完整拆件素材；
3. 攒钱后按目标一的组合外包绑定，升到 Live2D。
理由：ArcLoop 明确把 PNGTuber 称为「正经的过渡路径」，PNGTuber 对比文也都把「先 PNGTuber 后 Live2D」列为最稳妥路径。

**目标四：想走 3D 替代方案（绕开 Live2D 授权复杂度）**
- 想最快：**Neural4D AnimeArt**（文本/设定图 → VRM 0.x，含 52 blendshape + 55 骨 + spring physics，2–3 分钟）或 **Charakuru**（免费，单张全身立绘 → VRM，但目前不支持面部表情与眼动；商用条件是年营收与累计融资均 < 1 亿日元）。
- 想自己控：**VRoid Studio** 捏人 + VSeeFace（仅 VRM 0.x）/ Warudo（0.x+1.0）。
- 想从自己的原画出发：Tripo/Meshy 单图 → mesh + Auto Rig → FBX/GLB → Blender VRM Add-on 或 Unity+UniVRM 打包成 VRM（导出时务必 Freeze T-Pose）。

### 11.3 关键决策点（据条款推演）
- **你的网页应用是否允许用户加载任意 Live2D 模型？** 是 → 属 Expandable Application，个人也不能豁免；否（只内置自己的模型）→ 若年营收 < 1000 万日元，个人可豁免 SDK 发行许可。**建议在设计阶段就把这个边界定清楚。**
- **模型是否会出现在 nizima / Live2D Creative Awards？** 会 → AI 生成的插画及由其制作的 Live2D 作品被明确禁止（含描摹、加笔、变形）。不会 → 无此约束。
- **是否需要商用/买断？** 需要 → 报价阶段就要谈著作权让渡（日方常见 +100%~+120% 加价，Fiverr 有 +$1,000 商用项）。

---

## 12. 坑清单（Checklist）

**拆件/素材**
1. PSD 必须是 **PSD 格式、RGB、8bit、sRGB**，否则 Editor 直接拒绝导入（漏任一项都是「PSD 导不进去」的典型原因）。
2. 图层名必须唯一（重复层名是导入出问题的常见原因）；朴素命名即可（`hair_front_L`）。
3. 要准备**两份 PSD**：「素材拆分用 PSD」（保留文件夹与图层蒙版，便于后期改）和「载入用 PSD」（每部件合并为一层、应用掉蒙版、不含路径数据）。
4. 遮住的部分必须补画：刘海后的额头、睫毛下的眼睑、口腔内部（含牙/舌，若要口型必须画）、外套下的躯干。
5. **阴影不要跨部件边界烘焙**——留在脸上会导致「头发动了阴影不动」，这是赶工 AI 图最明显的破绽；要保留就给投影单独建层。
6. 头发不要做成一块：前发/侧发/后发的运动深度不同，糊成一坨会像戴头盔。
7. 一体式服装（高腰裙/旗袍/一字肩）在 See-Through 里容易 Topwear/Bottomwear 重复出现——要人工合并/删重。
8. See-Through 常把左右手臂合并——需手工拆开。
9. 别在没确认动作范围之前就开始切图（要 ±30° 转头 vs 只眨眼，需要的头发/耳朵覆盖范围差很多）。
10. 画布要在切图前就放大到位（4000px 量级），不要切完再补。

**绑定/工具**
11. **FREE 版限制**：ArtMesh ≤ 100 / 参数 ≤ 30 / 变形器 ≤ 50 / 部件 ≤ 30 / 纹理 1 张 ≤ 2048px / Warp 分割 ≤ 9×9——碰撞前先量一下自己的部件数。
12. Cubism 的「面部动作自动生成」**仅支持正面朝向的脸**；若目标有侧脸要另做。
13. Cubism 的「变形器的自动生成」与「生成面部变形器」不能叠加执行，需先删掉再跑。
14. 5.4 alpha 的数据**只能在 alpha 版使用**、官方**不作任何保证、不支持**，且 **alpha 可用至 2026-10-18**——别把生产管线压在 alpha 版上。
15. 5.4 外部连携 API 的编辑操作需要 `EditBegin/EditEnd` 包裹，且执行时**会锁住 Editor 的用户操作**；name 参数 ID vs UID 的区别（UID 每次连接可能变，参数 ID 不变）。
16. 官方 Editor **没有 CLI 导出**：`.cmo3 → .moc3` 的编译必须在 GUI 里点。
17. 第三方自动产出的 moc3 **未经官方效果验收**（psd2live 自述），务必在 VTube Studio / Cubism Viewer 里逐项验：物理自然度、口型同步、表情切换、不同光照下的贴图、以及在不同 FPS 下的物理表现。
18. Stretchy Studio 有多个同名 fork，**先确认你要用的是哪个仓库的哪份代码**；其第三方宣传文案（「与 Live2D 同质量、零成本」）未见独立验证。
19. Live2D Master Agent / 各类「一句话 3 分钟出皮套」宣称与社区共识冲突，**按 demo 级看待**。
20. 商业 SaaS（ImageToLayers 等）**免费档输出仅限个人使用**；付费档的商用权还受底层第三方模型条款约束；且**注意仿冒域名**（官方公告点名 imagetolayers.org 为克隆站）。

**授权/商用**
21. **Expandable Application 陷阱**：能加载任意模型的 avatar 系统 = 需逐件审查+单独签约+分成（个人也跑不掉）；「完全免费」原则上不获批。
22. 追踪软件 EULA 里的 **2,000 万日元**门槛（VTuber 直播业务算「业务主要要素」，产品宣传视频不算）——很多做直播的人不知道自己已触发。
23. **Cubism Core 禁止再配布**：Web 端要用官方的「Cubism Core for Web（hosting 用途）」，不要自己从别处拷 `live2dcubismcore.js` 打包分发。
24. **nizima 与 Live2D Creative Awards 全面封禁 AI 生成的插画及其 Live2D 化作品**（含描摹、加笔、变形），并且**会用检测工具审**，且**官方承认存在误判**；委托前先跟绑定师如实说明原画来源。
25. 中国的 AI 生成内容**必须标识**（2025-09-01 起《人工智能生成合成内容标识办法》）；主张著作权要**留存创作过程原始记录**（提示词、参数、迭代、筛选、垫图来源、时间戳），否则可能被认定「不构成作品」。
26. 鱼目混珠的「垫图」有侵权风险（用他人 IP 形象做垫图可能侵害原作者权利）。
27. Live2D 官方示例模型（含 Miku、unity 酱、初音未来）**不可随意商用**；开源桌宠仓库的源码许可 ≠ 素材许可。
28. 委托合同必谈：著作权让渡（常见 +100%~+120%）、商用范围、二次创作、修改次数（常见 大改 3 次 / 小改 5 次）、跑单条款、是否允许用于 AI 训练（有接单方明确写 `×AI学習、AI生成への使用`）。

---

## 13. 关键链接索引

**官方（Live2D）**
- 编辑器 AI 功能：[变形器自动生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/auto-generation-of-deformer/) / [面部动作自动生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/face-auto-edit/) / [5.1 新功能](https://docs.live2d.com/zh-CHS/cubism-editor-manual/new-function5-1/) / [自动网格生成](https://docs.live2d.com/zh-CHS/cubism-editor-manual/mesh-edit/) / [自动图形路径](https://docs.live2d.com/zh-CHS/cubism-editor-manual/artpath-auto-edit/)
- [外部连携 API](https://docs.live2d.com/cubism-editor-manual/external-application-integration-api/) / [API 一览](https://docs.live2d.com/cubism-editor-manual/external-application-integration-api-list/) / [5.4 alpha 手册](https://cubism.live2d.com/editor-alpha/doc/manual/alpha1/en/index.html)
- [素材分割 PS 插件下载](https://www.live2d.com/en/cubism/download/material-separation-ps-plugin/) / [使用手册](https://docs.live2d.com/zh-CHS/cubism-editor-manual/material-separation-ps-plugin-manual/)
- [导出嵌入文件（moc3 等 9 种）](https://docs.live2d.com/zh-CHS/cubism-editor-manual/export-moc3-motion3-files/)
- [MotionSync（Editor）](https://docs.live2d.com/en/cubism-editor-manual/motion-sync/) / [MotionSync Plugin for Web](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/) / [Lip-sync](https://docs.live2d.com/en/cubism-sdk-manual/lipsync/)
- 授权：[SDK 发行许可](https://www.live2d.com/en/sdk/license/) / [Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/) / [企业规模判定](https://help.live2d.com/en/sdk/sdk_007/) / [FREE vs PRO](https://www.live2d.com/zh-CHS/cubism/comparison/) / [Store 价格](https://store.live2d.com/cn/) / [Proprietary EULA(EN)](https://live2d.github.io/assets/live2d-proprietary-software-license-agreement_en.html) / [Open Software EULA(EN)](https://live2d.github.io/assets/live2d-open-software-license-agreement_en.html) / [Editor EULA(CN)](https://www.live2d.com/eula/live2D-editor-software-license-agreement_cn.html)
- 政策：[nizima AI 作品投稿限制](https://docs.nizima.com/guide/ai-policy/) / [审查说明](https://docs.nizima.com/guide/ai-policy-itemjudging/) / [Live2D AI 研究政策](https://docs.nizima.com/ai-research-policy/) / [Creative Awards 13th 禁止事项](https://www.live2d.com/event/awards13/)
- 素材：[示例模型库](https://www.live2d.com/en/learn/sample/) / [unity 酱示例数据](https://www.live2d.com/zh-CHS/learn/sample/unity-chan/)

**开源项目**
- 分层：[see-through](https://github.com/shitagaki-lab/see-through) / [HF Space](https://huggingface.co/spaces/24yearsold/see-through-demo) / [ModelScope](https://modelscope.cn/studios/ljsabc/See-Through) / [CubismPartExtr](https://github.com/shitagaki-lab/CubismPartExtr) / [sd-webui-see-through](https://github.com/exo101/sd-webui-see-through) / [ComfyUI-layerdiffuse](https://github.com/huchenlei/ComfyUI-layerdiffuse)
- 自动绑定：[psd2live](https://github.com/tsunehimatoi/psd2live) / [Stretchy Studio](https://github.com/pelmentor/stretchystudio) / [Live2D Master Agent](https://github.com/mw2wbyys6t-sudo/Live2D)
- 编辑器：[Umamo](https://github.com/umamoorg/umamo) / [nijigenerate](https://github.com/nijigenerate/nijigenerate) / [Inochi2D](https://github.com/Inochi2D/inochi-creator)
- 运行时：[Ayagami](https://github.com/AyagamiDev/ayagami)（[demo](https://demo.ayagami.dev)） / [moc3-rs](https://github.com/MahouTechnologies/moc3-rs) / [py-moc3](https://github.com/Ludentes/py-moc3) / [moc3ingbird](https://github.com/OpenL2D/moc3ingbird) / [moc2cmo](https://github.com/Eatgrapes/moc2cmo)
- MCP：[CubismExternalEditMCP](https://github.com/nana7chi/CubismExternalEditMCP) / [spine2d-animation-mcp](https://mcp.aibase.cn/server/1917154580204548098)
- 桌宠：[chatgpt-desktopPet](https://github.com/kirbystudy/chatgpt-desktopPet) / [live2dpet](https://github.com/f25h-233/live2dpet) / [Live2DPet](https://github.com/dwgx/Live2DPet) / [NyaDeskPet](https://github.com/gameswu/NyaDeskPet) / [DeskPet Live2D](https://github.com/tcmiku/tools_live2D)
- 3D 路线：[AutoVtuber](https://github.com/Lee-unhn/AutoVtuber) / [Charakuru](https://github.com/nanocle/Charakuru)

**论文**
- [See-Through (SIGGRAPH 2026)](https://dl.acm.org/doi/full/10.1145/3799902.3811209) · [arXiv](https://arxiv.org/abs/2602.03749)
- [Bunraku (arXiv 2607.27348)](https://arxiv.org/abs/2607.27348) · [全文](https://arxiv.org/html/2607.27348v1)
- [OmniPSD](https://arxiv.org/html/2512.09247v1) · [PSDiffusion](https://arxiv.org/html/2505.11468v2) · [Spiritus (ACM MM'25)](https://dl.acm.org/doi/10.1145/3746059.3747707) · [How to Train Your Dragon](https://arxiv.org/html/2503.15586) · [UniRig](https://arxiv.org/html/2504.12451v1) · [Remesher (SIGGRAPH 2026 Course)](https://dl.acm.org/doi/full/10.1145/3799820.3812509)

**行情/教程/社区**
- [ArcLoop 中文全流程](https://arcloop.ai/handbook/zh-CN/ai-art-to-vtuber-model-pipeline) · [ArcLoop 分层指南](https://arcloop.ai/handbook/zh-CN/live2d-material-separation-ai-art-guide)
- [日本 2026 版制作与发注指南](https://v-oshi.net/articles/vtuber-tachie-live2d) · [shiroikarasu 2026 版](https://shiroikarasu.net/live2d-vtuber-model-guide/) · [kraz-live2d 部件数分级](https://kraz-live2d.com/price/) · [live2d.wiki 工时拆分](http://live2d.wiki.fc2.com/wiki/Live2D%E3%83%A2%E3%83%87%E3%83%AB%E4%BD%9C%E6%88%90%E8%B2%BB) · [KEREN 术语讲座（XZ/XY/XYZ 成本差异）](https://kerenblog.com/2025/06/14/live2d/)
- [中文 V 皮行情分析](https://www.cpengx.cn/productivity/m-ai-live2d.html) · [卡米雷特 B 站建模课目录（可作学习路线图）](https://www.bilibili.com/cheese/play/ss13168) · [Live2D 绘制指南·拆件口诀](https://www.bilibili.com/video/BV16o4y187yV/)
- [AnimArts: Live2D vs PNGTuber 2026](https://animarts.studio/blog/live2d-vs-pngtuber-2026-which-is-right-for-you) · [veadotube mini](https://olmewe.itch.io/veadotube-mini) · [PNGTuber Plus](https://kaiakairos.itch.io/pngtuber-plus)
- [ArcLoop 的「AI 图委托必须提前说明」提醒](https://arcloop.ai/handbook/zh-CN/ai-art-to-vtuber-model-pipeline) · [Reddit 社区态度快照](https://reddit.sentinel-team.org/posts/1wm6p3f/snapshots/2026-09-26T00%3A10%3A19.642204Z) · [另一个独立开发者的两次失败复盘](https://www.patreon.com/posts/dev-note-3-live-158420264)
- 中国 AI 版权判例：[人民网（武汉案）](http://society.people.com.cn/n1/2025/0211/c1008-40416238.html) · [苏州中院不构成作品案](https://www.zjwx.gov.cn/art/2025/4/30/art_1673576_58876696.html) · [北京互联网法院「猫咪晶钻吊坠」案](https://www.ciplawyer.cn/articles/157579.html) · [最高检《AI创作的权利边界在哪里？》](https://www.spp.gov.cn/zdgz/202504/t20250425_694112.shtml) · [扬子晚报「伴心」案](https://m.yangtse.com/news_details.html?id=4144638)

**本报告未能确证 / 待跟进的事项**
1. **Bunraku 是否公开代码与权重**：截至调研时 arXiv 页面无 code 链接，项目页需持续跟进。
2. **Stretchy Studio 的同名仓库关系与真实能力边界**：存在多个 fork 与互相冲突的第三方宣传，需以具体 commit 与自测为准。
3. **Live2D Cubism 5.4 正式版的 API 全集**：当前证据基于 alpha1/alpha2 手册；正式版可能增删命令（尤其是否补齐「ArtMesh 创建 / PSD 导入」）。
4. **live2d.wiki.fc2.com 的 34 万円拆分**：来源为 wiki，非官方，仅供量级参考。
5. **「Live2D 官方非营利内容计划（D/E）」的具体条款**未被本次抓取覆盖（对应 URL 抓取失败），若他的应用定位为非营利发布，建议直接向 Live2D 索取 D/E 计划条款。
6. **See-Through 与「与 Live2D 竞争」相关的授权声明具体措辞**：本次仅见到零散转述，建议直接阅读仓库 LICENSE / NOTICE。
