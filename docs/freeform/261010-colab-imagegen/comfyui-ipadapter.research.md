# Colab 免费档 T4 + ComfyUI：SDXL 动漫角色一致性生图最佳实践调研

> 调研日期：**2026-10-10**
> 目标环境：Google Colab 免费档 **单张 Tesla T4（15 GB 显存）**、ComfyUI 无头运行（`127.0.0.1:8188`，仅 HTTP API 驱动，无公网隧道）
> 基座模型：单文件 SDXL 动漫模型（`OnomaAIResearch/Illustrious-XL-v2.0`、`Laxhar/noobai-XL-1.1`）
> 目标：**参考图垫图**保持原创角色长相 + 服装一致，换姿势/表情/构图；**不做 LoRA 训练**

---

## 0. 核心结论（先看这里）

1. **方案选型：`IP-Adapter Plus Face (SDXL, ViT-H)` 做脸 + `IP-Adapter Plus (SDXL, ViT-H)` 叠一层做整体（服装/配色），是最适合"动漫原创角色一致性"的组合。** 理由：IP-Adapter 用的是 **CLIP 图像编码器**（OpenCLIP ViT-H-14），它是通用图像编码器，对二次元图像完全有效。
2. **不要用 FaceID / InstantID / PuLID。** 这三者全部依赖 **InsightFace（ArcFace）人脸识别模型**，而该模型只在真人照片上训练。ComfyUI_IPAdapter_plus 作者 cubiq 在官方 issue 里原话：**"realistic style works, if it's too stylized it won't work"**，并确认 *"the models are not trained for cartoons or strongly stylized characters"*。这是本次调研中最决定性的证据。
3. **ControlNet 需要，但建议只上"一个"union 模型**：`xinsir/controlnet-union-sdxl-1.0`（一个 2.5 GB 文件覆盖 openpose/depth/canny/lineart/…）。姿势控制首选 **openpose（且用 DWPreprocessor 而非按人脸检测的 OpenposePreprocessor）**；canny 对动漫意义不大（会锁死线稿风格，与 IP-Adapter 抢风格控制权）。
4. **T4 显存是本方案的第一约束，而且 2026 年的 ComfyUI 行为已变化**：ComfyUI 现在默认启用 **DynamicVRAM**，此时 **`--lowvram` 完全失效**（`cli_args.py` 原文：*"Doesn't do anything if dynamic vram is enabled"*）。真正有效的旋钮是 `--fp8_e4m3fn-unet`（T4 上省显存不省时间）、`--vram-headroom`、降分辨率到 SDXL 原生桶（832×1216）。
5. **`--fp8_e4m3fn-unet` 在 T4 上确实省显存**：ComfyUI 的 `supports_fp8_compute()` 只在 compute capability ≥ 8.9（Ada/Blackwell）返回 True；T4 是 SM 7.5，没有 fp8 硬件算力，但 ComfyUI 仍会把权重以 fp8 **存储**、在算子内临时升精度计算 —— **省显存，不省时间**。
6. **`/prompt` 失败的错误信息在 HTTP 400 响应的 `error` + `node_errors` 里；运行期失败（OOM 等）不在 `/prompt` 响应里，而在 `GET /history/<prompt_id>` 的 `status.messages` 里的 `execution_error` 条目。**

---

## 1. 前提与环境事实核实

### 1.1 Colab 免费档 T4 的客观限制（已查证）

| 项目 | 事实 | 来源 |
|---|---|---|
| GPU | NVIDIA Tesla T4，16 GB 标称 / 约 15 GB 可用 | [agathasweb 指南](https://uk.agathasweb.com/blog/comfyui-google-colab-gerar-imagens-videos-ia) |
| 免费配额 | 约 15–30 小时 T4/周，动态调整 | 同上 |
| 单次会话上限 | 12 小时，实际常 4–6 小时被回收 | 同上 |
| 空闲超时 | 90 分钟无交互即断 | 同上 |
| 磁盘 | 临时，会话结束即丢 | 同上 |
| 无 GPU 保障 | 高峰时段可能只给到 CPU runtime | 同上 |

> ⚠️ 注意：T4 是 **Turing（SM 7.5）**，不支持 bf16 原生算力，也不支持 Ada 的 fp8 矩阵乘。ComfyUI 在 T4 上走 fp16 路径。

### 1.2 ComfyUI 2026 年的行为变化（重要，已从源码核实）

从 `comfy/cli_args.py`（master 分支，2026-10 抓取）确认：

```
vram_group.add_argument("--lowvram", action="store_true",
    help="Doesn't do anything if dynamic vram is enabled. If dynamic vram
          isn't being used this option makes the text encoders run on the CPU.")
...
parser.add_argument("--disable-dynamic-vram", action="store_true",
    help="Disable dynamic VRAM and use estimate based model loading.")
parser.add_argument("--enable-dynamic-vram", action="store_true",
    help="Enable dynamic VRAM on systems where it's not enabled by default.")
parser.add_argument("--vram-headroom", type=float, default=0,
    help="Set the amount of vram in GB for DynamicVRAM to maintain as extra headroom...")
parser.add_argument("--reserve-vram", type=float, default=None,
    help="Set the amount of vram in GB you want to reserve for use by your OS/other software.")
parser.add_argument("--disable-nvml-pressure", action="store_true",
    help="Use CUDA instead of NVML for DynamicVRAM memory pressure.")
```

以及启用条件：

```python
def enables_dynamic_vram():
    if args.enable_dynamic_vram:
        return True
    return not args.disable_dynamic_vram and not args.highvram \
           and not args.gpu_only and not args.novram and not args.cpu
```

**结论：新装 ComfyUI 在 T4 上 DynamicVRAM 默认开启，`--lowvram` 变成空操作。** 网上大量"T4 上一定要加 `--lowvram`"的教程已经过时。

---

## 2. Q1：IP-Adapter 权重文件（精确 repo + 文件名）

### 2.1 SDXL 需要哪几个文件

**主权重（放 `ComfyUI/models/ipadapter/`）** — 全部来自 `h94/IP-Adapter`，具体是 `sdxl_models/` 子目录：

| 用途 | HF repo | 精确文件名 | 文件大小 | 直链 |
|---|---|---|---|---|
| SDXL 基础 | `h94/IP-Adapter` | `sdxl_models/ip-adapter_sdxl_vit-h.safetensors` | 698 MB | `https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter_sdxl_vit-h.safetensors` |
| **SDXL Plus（推荐）** | `h94/IP-Adapter` | `sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors` | 848 MB | `.../sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors` |
| **SDXL Plus Face（推荐）** | `h94/IP-Adapter` | `sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors` | 848 MB | `.../sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors` |
| SDXL vit-G（需 bigG 编码器） | `h94/IP-Adapter` | `sdxl_models/ip-adapter_sdxl.safetensors` | 703 MB | `.../sdxl_models/ip-adapter_sdxl.safetensors` |

> 已用 HuggingFace API（`/api/models/h94/IP-Adapter/tree/main/sdxl_models`）逐条核实文件名与字节数。

### 2.2 CLIP vision image encoder：**这里是最容易搞错的地方**

`h94/IP-Adapter` 里有**两个名字都叫 `image_encoder` 的目录，含义完全不同**：

| HF 路径 | 实际是什么 | 大小 | 该配哪些 IP-Adapter 权重 |
|---|---|---|---|
| `h94/IP-Adapter/models/image_encoder/model.safetensors` | **OpenCLIP ViT-H-14**（laion2B-s32B-b79K），632M 参数 | 2,528,373,448 B ≈ **2.53 GB** | `*_sd15*`、`ip-adapter_sdxl_vit-h`、`ip-adapter-plus_sdxl_vit-h`、`ip-adapter-plus-face_sdxl_vit-h` |
| `h94/IP-Adapter/sdxl_models/image_encoder/model.safetensors` | **OpenCLIP ViT-bigG-14**（laion2B-39B-b160k） | 3,689,912,664 B ≈ **3.69 GB** | 只有 `ip-adapter_sdxl.safetensors`（vit-G 那一个） |

**我们要的是第一个**（ViT-H-14）。虽然后者的路径里带 `sdxl_models` 字样，但它**不是**给 `_vit-h` 系列用的 —— 这是社区最高频的踩坑点。

**放置方式（必须改名，因为 Unified Loader 用正则匹配文件名）：**

```
ComfyUI/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
```
来源：`https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors`（**下载后重命名**）

**为什么必须叫这个名**：`ComfyUI_IPAdapter_plus/utils.py` 的 `get_clipvision_file()` 用正则匹配：
```python
if preset.startswith("vit-g"):
    pattern = r'(ViT.bigG.14.*39B.b160k|ipadapter.*sdxl|sdxl.*model)\.(bin|safetensors)'
elif preset.startswith("kolors"):
    pattern = r'clip.vit.large.patch14.336\.(bin|safetensors)'
else:
    pattern = r'(ViT.H.14.*s32B.b79K|ipadapter.*sd15|sd1.?5.*model)\.(bin|safetensors)'
```
即 STANDARD / PLUS / PLUS FACE 三个 preset 都只认 `ViT.H.14...s32B.b79K` 这种命名。

### 2.3 Unified Loader 的 preset → 文件映射（源码核实）

`utils.py::get_ipadapter_file(preset, is_sdxl)` 中与 SDXL 相关的分支：

| preset（UI 下拉项） | SDXL 时的正则 | 命中文件 |
|---|---|---|
| `STANDARD (medium strength)` | `ip.adapter.sdxl.vit.h.(safetensors\|bin)$` | `ip-adapter_sdxl_vit-h.safetensors` |
| `VIT-G (medium strength)` | `ip.adapter.sdxl.(safetensors\|bin)$` | `ip-adapter_sdxl.safetensors` |
| `PLUS (high strength)` | `plus.sdxl.vit.h.(safetensors\|bin)$` | `ip-adapter-plus_sdxl_vit-h.safetensors` |
| `PLUS FACE (portraits)` | `plus.face.sdxl.vit.h.(safetensors\|bin)$` | `ip-adapter-plus-face_sdxl_vit-h.safetensors` |
| `FACEID` | `faceid.sdxl.(safetensors\|bin)$` + LoRA `faceid.sdxl.lora.safetensors$` | 需 insightface |
| `FACEID PLUS V2` | `faceid.plusv2.sdxl.(safetensors\|bin)$` + LoRA | 需 insightface |
| `FACEID PORTRAIT (style transfer)` | `portrait.sdxl.(safetensors\|bin)$` | 需 insightface |
| `FACEID PORTRAIT UNNORM - SDXL only (strong)` | `portrait.sdxl.unnorm.(safetensors\|bin)$` | 需 insightface |
| `LIGHT - SD1.5 only` | — | SDXL 下**直接抛异常** |
| `FULL FACE - SD1.5 only` | — | SDXL 下**直接抛异常** |

> 注意正则里的 `.` 是"任意字符"，所以实际文件名不必 100% 逐字符一致，但**推荐严格按官方命名**，否则 legacy loader 与 Unified Loader 混用时容易互相找不到。

### 2.4 Plus / Plus Face / FaceID 在"保持角色长相"上的适用性

| 变体 | 编码器 | 训练数据侧重 | **对动漫原创角色** | 适用场景 |
|---|---|---|---|---|
| **Plus** | CLIP ViT-H-14 | 细粒度 patch 特征，保留构图与细节 | ✅ 有效 | 服装纹理、配色、发色、整体轮廓一致性；换姿势时的"服装不跑" |
| **Plus Face** | CLIP ViT-H-14（人脸裁切数据训练） | 人脸区域 | ✅ 有效（CLIP 是通用编码器） | **脸部长相一致性**，脸占比大的半身/特写 |
| FaceID / FaceID PlusV2 | **ArcFace + CLIP** | 真人 ID embedding | ❌ **不可用** | 真人。动漫角色会触发 "no face detected" 或产出崩坏结果 |
| FaceID Portrait (SDXL) | ArcFace | 真人肖像 | ❌ 不可用 | 真人肖像风格迁移 |
| FaceID Portrait UNNORM | ArcFace | 真人口鼻 | ❌ 不可用 | 真人，强度极大，会压制文本 prompt |

**权威依据：**
- `tencent-ailab/IP-Adapter` 官方 wiki 明确：*"CLIP image encoder: here we use OpenCLIP ViT-H ... **Face recognition model**: here we use arcface model from insightface"* —— 只有 FaceID 系列走 ArcFace。
- 官方 README：*"IP-Adapter for non-square images ... As the image is center cropped in the default image processor of CLIP, IP-Adapter works best for square images."* → **参考图裁成正方形**。
- cubiq 在 [issue #620](https://github.com/cubiq/ComfyUI_IPAdapter_plus/issues/620) 回复：*"the models are not trained for cartoons or strongly stylized characters"* / *"realistic style works, if it's too stylized it won't work"`（针对 InsightFace FaceID）。

### 2.5 显存开销（估算，需自行实测校准）

| 组件 | 显存 | 依据 |
|---|---|---|
| SDXL UNet (fp16) | ≈ **4.9 GB** | ComfyUI 运行日志 `Model SDXL prepared for dynamic VRAM loading. 4897MB Staged`（[issue #13668](https://github.com/Comfy-Org/ComfyUI/issues/13668)） |
| CLIP-ViT-H-14 image encoder (fp16) | ≈ **1.26 GB**（fp32 文件 2.53 GB） | 632M 参数推算 |
| CLIP-ViT-bigG-14 (fp16) | ≈ **1.85 GB**（fp32 文件 3.69 GB） | 推算 |
| IP-Adapter 本体 (plus / plus-face) | ≈ **0.2–0.4 GB** | 22M–200M 参数级别 |
| ControlNet SDXL | ≈ **2.4 GB** | 日志 `Model ControlNet prepared for dynamic VRAM loading. 2397MB Staged` |
| SDXL 双文本编码器 (CLIP-L + CLIP-G, fp16) | ≈ **1.7 GB** | 推算；DynamicVRAM 下会按需换入换出 |

> 这些都是**权重常驻**量。激活（activation）随分辨率增长，是你实测 1024×1536 达 12.1 GB 的主因。分辨率降到 832×1216，token 数从约 1536 降到约 988（−36%），激活显存显著下降。

---

## 3. Q2：ComfyUI 自定义节点 + 精确目录结构

### 3.1 装哪个节点包

**推荐：`cubiq/ComfyUI_IPAdapter_plus`**

| 项目 | 值 |
|---|---|
| GitHub | `https://github.com/cubiq/ComfyUI_IPAdapter_plus` |
| 安装 | `git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus` |
| ComfyUI Registry id | `comfyui_ipadapter_plus`（已查证 `https://api.comfy.org/nodes/comfyui_ipadapter_plus`，下载量 **1,566,518**，repository 字段指向 cubiq 仓库） |
| 维护状态 | ⚠️ 作者于 **2025-04-14** 在 README 顶部声明进入 **"maintenance only"** 模式。功能完整可用，但不要再期待新特性。 |

**关于 `comfyorg/comfyui-ipadapter`**：这是 ComfyUI 官方组织下的一个**镜像/副本**（README 内容与 cubiq 版逐字一致，仍保留 cubiq 的赞助段与仓库链接）。Registry 里登记的仍是 cubiq 仓库。**建议按 Registry 走 cubiq 仓库**；若你从 Registry 搜索安装，装的也是 cubiq 版。

**可选辅助节点：**
- `Fannovel16/comfyui_controlnet_aux`（Registry id `comfyui_controlnet_aux`，下载量 **2,723,734**）—— 提供 openpose / depth / canny / lineart 等预处理器。**用 union ControlNet 时必须装**，否则预处理器列表是空的。
- `ltdrdata/ComfyUI-Manager`（可选，无头环境用 git clone 更可控）。

### 3.2 精确目录结构（最容易放错的部分）

```
ComfyUI/
└── models/
    ├── checkpoints/
    │   ├── Illustrious-XL-v2.0.safetensors      # 6,938,040,674 B
    │   └── NoobAI-XL-v1.1.safetensors           # 7,105,349,958 B
    ├── clip_vision/                             # ← 注意是 clip_vision，不是 clip
    │   └── CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
    │                                            #   来源 h94/IP-Adapter/models/image_encoder/model.safetensors（下载后改名）
    ├── ipadapter/                               # ← 目录默认不存在，必须手动创建
    │   ├── ip-adapter-plus_sdxl_vit-h.safetensors
    │   └── ip-adapter-plus-face_sdxl_vit-h.safetensors
    ├── controlnet/                              # ← 单数，不是 controlnets
    │   └── controlnet-union-sdxl-1.0.safetensors
    ├── loras/
    │   └── (本方案不需要 ip-adapter-faceid_*_lora.safetensors)
    └── insightface/
        └── models/
            └── antelopev2/                      # 仅 InstantID/FaceID 需要，本方案不需要
```

**三个高频踩坑点：**

1. **`models/ipadapter/` 目录不会自动创建。** `IPAdapterPlus.py` 里的逻辑是：
   ```python
   # set the models directory
   if "ipadapter" not in folder_paths.folder_names_and_paths:
       current_paths = [os.path.join(folder_paths.models_dir, "ipadapter")]
   else:
       current_paths, _ = folder_paths.folder_names_and_paths["ipadapter"]
   ```
   目录不存在 → 节点下拉框里看不到任何权重文件（不会报错，只是空的，非常难 debug）。
2. **`models/clip_vision/` 这个名字固定。** 有些第三方整合包会把它写成 `clip_vision_models` 或 `clip/vision`，那就匹配不上。
3. **改名是硬要求**（见 §2.2），不是"建议"。

**也支持 `extra_model_paths.yaml`**（官方 README 明确）：
```yaml
# <placeholder>/extra_model_paths.yaml
comfyui:
    base_path: /content/ComfyUI/
    ipadapter: models/ipadapter
    clip_vision: models/clip_vision
```
这在 Colab 上很有用 —— 模型放 Google Drive，软链/配置指向即可，避免每次会话重下 10 GB。

### 3.3 下载命令模板（Colab cell，走占位符）

```bash
# 注意：Colab 上访问 HuggingFace 一般不需要代理；若需要，自行设置
export HF_ENDPOINT=<your-hf-mirror-or-default>

CKPT_DIR=/content/ComfyUI/models
mkdir -p "$CKPT_DIR"/{ipadapter,clip_vision,controlnet}

# IP-Adapter Plus（推荐两根）
hf download h94/IP-Adapter sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors \
  --local-dir /tmp/ipa
hf download h94/IP-Adapter sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors \
  --local-dir /tmp/ipa
mv /tmp/ipa/sdxl_models/*.safetensors "$CKPT_DIR/ipadapter/"

# CLIP vision（ViT-H，下载后必须改名）
hf download h94/IP-Adapter models/image_encoder/model.safetensors \
  --local-dir /tmp/clipv
mv /tmp/clipv/models/image_encoder/model.safetensors \
   "$CKPT_DIR/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

# ControlNet Union SDXL（见 §4）
hf download xinsir/controlnet-union-sdxl-1.0 diffusion_pytorch_model.safetensors \
  --local-dir /tmp/cn
mv /tmp/cn/diffusion_pytorch_model.safetensors \
   "$CKPT_DIR/controlnet/controlnet-union-sdxl-1.0.safetensors"
```

### 3.4 主要节点名（已从源码核实，2026-10 有效）

| 节点 class_type | 作用 | 返回 |
|---|---|---|
| `IPAdapterUnifiedLoader` | 一次加载 ipadapter + clip_vision（按 preset 自动找文件） | `MODEL`, `IPADAPTER` |
| `IPAdapterModelLoader` | 只加载 ipadapter 本体 | `IPADAPTER` |
| `IPAdapterAdvanced` | 应用 IP-Adapter（**旧版 `IPAdapter Apply` 已删除**） | `MODEL` |
| `IPAdapterFaceID` | FaceID 专用应用节点（**需 insightface，不建议动漫用**） | `MODEL`, `IMAGE` |
| `CLIPVisionLoader` | 核心节点，加载 clip_vision 模型 | `CLIP_VISION` |
| `PrepImageForClipVision` | IPAdapter 包内节点，裁切/缩放参考图 | `IMAGE` |

**`IPAdapterUnifiedLoader` 的 preset 完整可选值**（源码）：
```python
['LIGHT - SD1.5 only (low strength)', 'STANDARD (medium strength)',
 'VIT-G (medium strength)', 'PLUS (high strength)',
 'PLUS FACE (portraits)', 'FULL FACE - SD1.5 only (portraits stronger)']
```
SDXL 下只有 `STANDARD` / `VIT-G` / `PLUS` / `PLUS FACE` 四个可用。

> ⚠️ **多个 Unified Loader 串联时必须用 `ipadapter` 口 daisy chain**，否则所有模型会被加载两遍（官方 NODES.md 明确警告）：*"Multiple unified loaders should always be daisy chained through the `ipadapter` in/out. Failing to do so will cause all models to be loaded twice."* 且**第一个** Unified Loader 的 `ipadapter` 输入**绝不能连接**。

---

## 4. Q3：ControlNet 要不要？用哪个？

### 4.1 结论

**要，但如果只做"A-pose / 指定姿势"这一件事，只装一个 union 模型就够了。** 三个候选的取舍：

| ControlNet 类型 | 对"动漫角色一致性"的价值 | 判断 |
|---|---|---|
| **openpose** | 唯一真正控制**姿势**的手段。契合你的 A-pose 需求。 | ✅ **首选** |
| **depth** | 控制整体体积/前后关系。对动漫线稿意义有限，且与 IP-Adapter 的构图控制重叠。 | ⚠️ 备用 |
| **canny / lineart** | 会强制锁定参考图的线稿与轮廓 → **和 IP-Adapter 抢风格控制权**，导致换姿势时把参考图构图也一起锁死。 | ❌ 不用 |
| `anime_lineart` | 动漫专用线稿提取（`AnimeLineArtPreprocessor`）。若要做"同姿势换风格"才有意义。 | ⚠️ 与本需求无关 |

> 社区反馈也支持这个判断。Civitai 上的实测评论（针对 xinsir openpose SDXL）：*"the performance is inconsistent. If you turn up the strength (~1.3) and set the ending step a bit early (0.5-0.7) it works ok for simple poses ... it also tends to bork the image quality"* —— 所以 **openpose strength 建议从 0.6–0.8 起调，`end_percent` 视情况收到 0.7–0.9**。

### 4.2 SDXL ControlNet 权重（精确 repo + 文件名）

**方案 A（推荐）：一个 union 模型管全部**

| 项目 | 值 |
|---|---|
| repo | `xinsir/controlnet-union-sdxl-1.0` |
| 文件名 | `diffusion_pytorch_model.safetensors`（10 种控制） |
| 大小 | 2,512,030,408 B ≈ **2.51 GB** |
| ProMax 变体 | `diffusion_pytorch_model_promax.safetensors`（2,513,342,408 B，12 控制 + 5 编辑功能） |
| 放到 | `ComfyUI/models/controlnet/controlnet-union-sdxl-1.0.safetensors`（可任意改名） |
| 支持类型 | `openpose`(0) `depth`(1) `hed/pidi/scribble/ted`(2) `canny/lineart/anime_lineart/mlsd`(3) `normal`(4) `segment`(5) `tile`(6) `repaint`(7) |

**关键：这个文件是 diffusers 格式（`diffusion_pytorch_model.safetensors`），ComfyUI 的 `ControlNetLoader` 可以直接加载**，无需转换 —— 社区教程明确：*"Save it inside the `ComfyUI/models/controlnet` folder ... rename it to some unique name"*。

**union 模型必须配 `SetUnionControlNetType` 节点**（ComfyUI 核心节点，`comfy_extras/nodes_controlnet.py`），它的 `type` 可选值是 `["auto"] + union 的 8 个 key`。
⚠️ 若用了超出模型支持范围的 type，ComfyUI 会明确报错并提示换 ProMax：
> `Please consider using the ProMax ControlNet Union model.`

**方案 B：专用单类型模型**

| 类型 | repo | 文件名 | 大小 |
|---|---|---|---|
| openpose | `xinsir/controlnet-openpose-sdxl-1.0` | `diffusion_pytorch_model.safetensors` | 2,502,139,104 B ≈ 2.50 GB |
| depth | `xinsir/controlnet-depth-sdxl-1.0` | `diffusion_pytorch_model.safetensors` | 2,502,139,104 B ≈ 2.50 GB |
| canny | `xinsir/controlnet-canny-sdxl-1.0` | `diffusion_pytorch_model.safetensors` | (同量级) |

> 三个 repo 里的主文件**同名**，所以下多个时必须分别改名或分子目录 —— 这是社区踩过的坑（*"Depth and ZOE depth are named the same ... I can't just copy them into the controlnet folder. They'll overwrite one another"*）。
> 官方 README 声称 openpose 的 mAP = 0.357，高于 `lllyasviel/control_v11p_sd15_openpose` 的 0.326 与 `thibaud/controlnet-openpose-sdxl-1.0` 的 0.209 —— **SOTA openpose**。但这是官方自评，注意坐标。

**方案 C（不推荐）：`thibaud/controlnet-openpose-sdxl-1.0`** —— mAP 仅 0.209，是 xinsir 的三分之一左右，且社区评价"不如 OpenPoseXL2"。跳过。

### 4.3 预处理器节点名（`comfyui_controlnet_aux`，源码核实）

| class_type | 显示名 | 备注 |
|---|---|---|
| `DWPreprocessor` | DWPose Estimator | **推荐给动漫** —— DWPose 对手绘/风格化人体更鲁棒 |
| `OpenposePreprocessor` | OpenPose Pose | 参数：`detect_hand` / `detect_body` / `detect_face` / `resolution` / **`scale_stick_for_xinsr_cn`** |
| `Zoe-DepthMapPreprocessor` | Zoe Depth Map | depth 用 |
| `DepthAnythingV2Preprocessor` | Depth Anything V2 - Relative | depth 备选，更新 |
| `CannyEdgePreprocessor` | Canny Edge | 不用 |
| `AnimeLineArtPreprocessor` | Anime Lineart | 动漫线稿 |

> ⚠️ **`OpenposePreprocessor` 有个专为 xinsir ControlNet 准备的开关 `scale_stick_for_xinsr_cn`，用 xinsir 模型时建议设为 `enable`。** 这个参数不在老教程里，很多人的"xinsir openpose 效果差"就是这个没开。

### 4.4 显存账本（T4 15 GB）+ 够不够

以你实测的 **1024×1536 纯 txt2img = 12.1 GB** 为基线：

| 配置 | 估算峰值 | 1024×1536 | 832×1216 |
|---|---|---|---|
| 纯 txt2img | 12.1 GB（实测） | ✅ 勉强 | ✅ 舒适 |
| + IP-Adapter（+CLIP-ViT-H ≈1.3 GB） | ≈ 13.4 GB | ⚠️ **极险**，碎片化即 OOM | ✅ 可行 |
| + IP-Adapter + ControlNet（+≈2.4 GB） | ≈ 15.8 GB | ❌ **OOM** | ⚠️ 需配合省显存手段 |
| + IP-Adapter ×2（Plus + Plus Face） | +≈0.4 GB | — | ✅ 可行 |

> **结论：1024×1536 + IP-Adapter + ControlNet 在 15 GB T4 上不可行。** 三条出路（按性价比排序）：
> **(a) 降分辨率到 832×1216** —— 最有效、零成本；
> **(b) 加 `--fp8_e4m3fn-unet`** —— UNet 从 4.9 GB → 约 2.5 GB；
> **(c) 拆成两步**：第一遍用 IP-Adapter 出角色定妆图 → 第二遍用 ControlNet + 低强度 IP-Adapter（或纯 img2img）做姿势，中间落盘。

### 4.5 省显存手段（T4 特化，逐项核实）

| 手段 | 命令/做法 | T4 上是否有效 | 说明 |
|---|---|---|---|
| **fp8 UNet** | `--fp8_e4m3fn-unet` | ✅ **省显存**，⚠️ 不快 | ComfyUI 的 `supports_fp8_compute()` 要求 compute capability ≥ 8.9；T4 是 7.5 → 无 fp8 算力。但**权重仍以 fp8 存储**、算子内升精度计算 → 省内存不省时间。原作 comfyanonymous 的博客原话：*"fp8 ... greatly reduces memory usage"*；有 RTX 2060 6 GB 用户实测 fp8 反而**比 fp16 更快**（因为 fp16 需要 offload）。 |
| `--fp8_e5m2-unet` | 同上 | ✅ | e4m3fn 与 e5m2 画质各有取舍，建议两个都试。 |
| **`--lowvram`** | `python main.py --lowvram` | ❌ **在 T4 上已失效** | DynamicVRAM 默认开启时是 no-op（源码 help 文本）。 |
| `--novram` | | ✅ 但极慢 | 会关闭 DynamicVRAM（见 `enables_dynamic_vram()`），回退到老的估算式加载。 |
| `--disable-dynamic-vram` | | ⚠️ | 关掉 DynamicVRAM 后 `--lowvram` 才重新生效。除非 DynamicVRAM 出问题，否则不建议关。 |
| **`--vram-headroom N`** | 如 `--vram-headroom 1` | ✅ | 强制 DynamicVRAM 常留 N GB 空闲。T4 上 15 GB 实际可用约 14 GB，留 1 GB 给系统较稳。 |
| `--reserve-vram N` | | ⚠️ 有已知问题 | 多个 issue 反馈模型加载阶段不遵守该值（[#15666](https://github.com/Comfy-Org/ComfyUI/issues/15666)）。优先用 `--vram-headroom`。 |
| **`--cache-none`** | | ✅ | 每次重跑所有节点，降低 RAM/VRAM 缓存占用。代价是重复执行。 |
| `--disable-smart-memory` | | ✅ | 更激进地把模型 offload 回普通 RAM。 |
| `--use-split-cross-attention` | | ✅ | 省显存的注意力实现（被 xformers 覆盖时忽略）。 |
| **降分辨率** | 832×1216 / 896×1152 | ✅✅ 最有效 | SDXL 原生桶，同时画质更好（动漫模型都在这些桶上训练）。 |
| **`batch_size=1`** | EmptyLatentImage | ✅ | T4 上 batch 2 比 batch 1 慢且更易 OOM。 |
| **`--cpu-vae`** | | ✅ | VAE 在 1024×1536 解码时是显存尖峰源。 |
| **分批两步生成** | 落盘 → 重载 | ✅✅ | 最稳的工程手段，见 §4.4(c)。 |
| 减少 ControlNet 数量 | 只用 1 个 | ✅ | 每个额外 ControlNet ≈ +2.4 GB。 |

**推荐的 T4 启动命令（占位符版）：**

```bash
cd /content/ComfyUI
python main.py \
  --listen 127.0.0.1 --port 8188 \
  --fp8_e4m3fn-unet \
  --vram-headroom 1.0 \
  --use-split-cross-attention \
  --cache-none \
  --disable-auto-launch \
  > /tmp/comfyui.log 2>&1 &
# 轮询直到 http://127.0.0.1:8188/system_stats 返回 200
```

> ⚠️ 注意：**不要**同时加 `--lowvram`（在 T4 上无意义，且会误导后续排查）。
> `--fp8_e4m3fn-unet` 对画质有轻微影响，建议先用 3–5 个种子做 A/B 对比再定。

---

## 5. Q4：最小可 POST 的 SDXL + IP-Adapter 工作流 JSON 骨架

### 5.1 骨架 A：SDXL + IP-Adapter Plus Face（最小可用）

> **这是 API 格式**（`{"node_id": {"class_type": ..., "inputs": {...}}}`），与浏览器里导出的 UI 格式（含 `nodes`/`links` 数组）不同。可直接 POST 到 `/prompt` 的 `prompt` 字段。

```json
{
  "1": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "<your-anime-sdxl.safetensors>" }
  },

  "2": {
    "class_type": "LoadImage",
    "inputs": { "image": "<reference_character.png>" }
  },

  "3": {
    "class_type": "IPAdapterUnifiedLoader",
    "inputs": {
      "model": ["1", 0],
      "preset": "PLUS FACE (portraits)"
    }
  },

  "4": {
    "class_type": "IPAdapterAdvanced",
    "inputs": {
      "model": ["3", 0],
      "ipadapter": ["3", 1],
      "image": ["2", 0],
      "weight": 0.85,
      "weight_type": "linear",
      "combine_embeds": "concat",
      "start_at": 0.0,
      "end_at": 1.0,
      "embeds_scaling": "V only"
    }
  },

  "5": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "clip": ["1", 1],
      "text": "masterpiece, best quality, newest, absurdres, highres, safe, 1girl, solo, <char tags>, <pose tags>, <scene tags>"
    }
  },

  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "clip": ["1", 1],
      "text": "nsfw, worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro"
    }
  },

  "7": {
    "class_type": "EmptyLatentImage",
    "inputs": { "width": 832, "height": 1216, "batch_size": 1 }
  },

  "8": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["4", 0],
      "positive": ["5", 0],
      "negative": ["6", 0],
      "latent_image": ["7", 0],
      "seed": 123456789,
      "steps": 28,
      "cfg": 5.5,
      "sampler_name": "euler_ancestral",
      "scheduler": "normal",
      "denoise": 1.0
    }
  },

  "9": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["8", 0], "vae": ["1", 2] }
  },

  "10": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "char_consistency", "images": ["9", 0] }
  }
}
```

### 5.2 骨架 B：叠第二层 IP-Adapter（Plus 管服装）+ ControlNet openpose 管姿势

在骨架 A 基础上：

```json
{
  "30": {
    "class_type": "IPAdapterUnifiedLoader",
    "inputs": {
      "model": ["3", 0],
      "preset": "PLUS (high strength)",
      "ipadapter": ["3", 1]
    }
  },

  "31": {
    "class_type": "IPAdapterAdvanced",
    "inputs": {
      "model": ["30", 0],
      "ipadapter": ["30", 1],
      "image": ["2", 0],
      "weight": 0.55,
      "weight_type": "linear",
      "combine_embeds": "concat",
      "start_at": 0.0,
      "end_at": 1.0,
      "embeds_scaling": "V only"
    }
  },

  "40": {
    "class_type": "DWPreprocessor",
    "inputs": {
      "image": ["41", 0],
      "detect_hand": "enable",
      "detect_body": "enable",
      "detect_face": "enable",
      "resolution": 1024
    }
  },

  "41": {
    "class_type": "LoadImage",
    "inputs": { "image": "<pose_reference.png>" }
  },

  "42": {
    "class_type": "ControlNetLoader",
    "inputs": { "control_net_name": "controlnet-union-sdxl-1.0.safetensors" }
  },

  "43": {
    "class_type": "SetUnionControlNetType",
    "inputs": { "control_net": ["42", 0], "type": "openpose" }
  },

  "44": {
    "class_type": "ControlNetApplyAdvanced",
    "inputs": {
      "positive": ["5", 0],
      "negative": ["6", 0],
      "control_net": ["43", 0],
      "image": ["40", 0],
      "strength": 0.7,
      "start_percent": 0.0,
      "end_percent": 0.9
    }
  }
}
```

然后把 `KSampler.model` 改成 `["31", 0]`，`KSampler.positive` 改成 `["44", 0]`，`KSampler.negative` 改成 `["44", 1]`。

> **daisy chain 要点**：`30` 号 Unified Loader 的 `ipadapter` 输入接 `["3", 1]`（前一个 loader 的 ipadapter 输出），这样第二层不会重复加载 clip_vision / ipadapter。**`3` 号（第一个）绝对不能接 `ipadapter` 输入。**

### 5.3 关键节点输入字段释义

**`CheckpointLoaderSimple`**
| 字段 | 类型 | 说明 |
|---|---|---|
| `ckpt_name` | string | `models/checkpoints/` 下的文件名。输出 `[0]=MODEL, [1]=CLIP, [2]=VAE` |

**`LoadImage`**
| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | string | `input/` 目录下的文件名；无头场景需先用 `POST /upload/image` 上传，或预先 `cp` 到 `ComfyUI/input/` |

> ⚠️ 无头场景常见坑：`LoadImage` 不会自己下载 URL，必须先调 `POST /upload/image`（multipart form，字段名 `image`），拿到返回的 `name` 再填进 `image`。

**`IPAdapterUnifiedLoader`**
| 字段 | 类型 | 说明 |
|---|---|---|
| `model` | MODEL | 主模型 pipeline。**此节点不改变 model**，输出等于输入（仅做"配置载体"） |
| `preset` | enum | 见 §3.4；SDXL 用 `STANDARD` / `VIT-G` / `PLUS` / `PLUS FACE (portraits)` |
| `ipadapter`（可选） | IPADAPTER | **仅用于串联多个 Unified Loader**，第一个不能接 |
| 输出 | `MODEL`, `IPADAPTER` | 注意顺序：`[0]=model, [1]=ipadapter` |

**`IPAdapterAdvanced`**（源码 `INPUT_TYPES` 原文）
| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `model` | MODEL | 上游 model |
| `ipadapter` | IPADAPTER | 来自 Unified Loader（含 clip_vision 全栈）或 Model Loader（仅模型，需另接 `clip_vision`） |
| `image` | IMAGE | **参考图，建议正方形**；非正方形会被 CLIP 中心裁切 |
| `weight` | FLOAT, default `1.0`, range `-1..5` | SDXL 建议 **0.7–0.9** 起调；`linear` 之外的类型可更高 |
| `weight_type` | enum, default `linear` | 15 种。SDXL 专用：`style transfer` / `composition` / `style and composition` / `style transfer precise` / `composition precise`。**换姿势时若构图被参考图锁死，改用 `style transfer` 或降低 `weight`** |
| `combine_embeds` | enum, default `concat` | 多参考图时：`concat` / `add` / `subtract` / `average` / `norm average`。**低显存建议 `average`**（官方 NODES.md 原文建议） |
| `start_at` | FLOAT, default `0.0` | 从多少比例步数开始施加。想放松一致性可设 0.3 |
| `end_at` | FLOAT, default `1.0` | 到多少比例步数停止 |
| `embeds_scaling` | enum, default `V only` | `V only` / `K+V` / `K+V w/ C penalty` / `K+mean(V) w/ C penalty`。高 weight 时 `K+mean(V) w/ C penalty` 画质更稳 |
| `image_negative`（可选） | IMAGE | 用于负向条件的图（可塞噪音） |
| `attn_mask`（可选） | MASK | 限定 IP-Adapter 影响区域；**宽高比需与 latent 一致** |
| `clip_vision`（可选） | CLIP_VISION | 用 Unified Loader 时可省略 |

**`KSampler`**
| 字段 | 说明 |
|---|---|
| `model` / `positive` / `negative` / `latent_image` | 上游连接 |
| `seed` | 整数；`control_after_generate` 是 UI 概念，API 里不存在 |
| `steps` | NoobAI 官方推荐 **25–30** |
| `cfg` | NoobAI 官方推荐 **5–6**（注意：不是 SD1.5 的 7–8） |
| `sampler_name` | 官方推荐 `Euler a`（API 里字符串是 `euler_ancestral`） |
| `scheduler` | `normal` / `karras` |
| `denoise` | txt2img 为 `1.0` |

**`ControlNetApplyAdvanced`**
| 字段 | 默认 | 说明 |
|---|---|---|
| `positive` / `negative` | — | 输入并输出 CONDITIONING（返回 `[0]=positive, [1]=negative`） |
| `control_net` | — | `ControlNetLoader` 或 `SetUnionControlNetType` 的输出 |
| `image` | — | 预处理后的控制图（openpose 骨架图） |
| `strength` | `1.0` | openpose 建议 **0.6–0.8** |
| `start_percent` / `end_percent` | `0.0` / `1.0` | 社区实测 openpose 收到 `end_percent≈0.7–0.9` 可避免画质劣化 |
| `vae`（可选） | — | 部分 ControlNet 需要 |

**`SetUnionControlNetType`**
| 字段 | 说明 |
|---|---|
| `control_net` | 来自 `ControlNetLoader` |
| `type` | `auto` / `openpose` / `depth` / `hed/pidi/scribble/ted` / `canny/lineart/anime_lineart/mlsd` / `normal` / `segment` / `tile` / `repaint` |

### 5.4 动漫 SDXL 模型的推荐参数（官方 README 核实）

**NoobAI-XL-v1.1**（`Laxhar/noobai-XL-1.1`，官方 README 原文）：
- CFG: **5 ~ 6**
- Steps: **25 ~ 30**
- Sampler: **Euler a**
- 分辨率：总面积约 1024²；推荐桶 `768x1344`, **`832x1216`**, `896x1152`, `1024x1024`, `1152x896`, `1216x832`, `1344x768`
- 正向前缀：`masterpiece, best quality, newest, absurdres, highres, safe,`
- 负向：`nsfw, worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro`
- Caption 顺序：`<1girl/1boy/1other/...>, <character>, <series>, <artists>, <special tags>, <general tags>, <other tags>`

**Illustrious-XL-v2.0**（官方 README）：
- 文件名 `Illustrious-XL-v2.0.safetensors`（6.94 GB）
- README 本身**没有**给推荐采样参数。它是 NoobAI 的基座，沿用 danbooru 风格 tag；社区普遍套用类似 NoobAI 的参数区间。**（此处标注：Illustrious v2.0 的官方推荐参数 = 未查证到，建议自己扫一遍 CFG 4.5–6.5 / steps 24–32。）**

> ⚠️ NoobAI 1.1 是 **v-pred 模型**（社区 workflow 提到 *"vpred-based Noob models"*）。ComfyUI 会自动识别并使用 ZSNR 采样，**不需要手动加 `ModelSamplingDiscrete` 节点**。如果你照抄老 workflow 里有 `ModelSamplingDiscrete`，应当去掉。

---

## 6. Q5：`/prompt` 之后怎么取结果 + 失败信息在哪

### 6.1 完整调用链（已从官方文档 + 源码核实）

```
① POST /upload/image        (multipart, 字段名 image)      → {"name": "...", "subfolder": "", "type": "input"}
② POST /prompt              {"prompt": {<workflow>}, "client_id": "<uuid>"}
                            → 200 {"prompt_id": "<uuid>", "number": N, "node_errors": {}}
                            → 400 {"error": {...}, "node_errors": {"<node_id>": {...}}}
③ GET  /history/<prompt_id> → {"<prompt_id>": {"outputs": {...}, "status": {...}}}
④ GET  /view?filename=...&subfolder=...&type=output  → 二进制图像
```

### 6.2 `/prompt` 响应（成功）

```json
{ "prompt_id": "550e8400-e29b-41d4-a716-446655440000", "number": 1, "node_errors": {} }
```

可选请求字段（全部已验证）：`prompt`（必填）、`client_id`、`extra_data`、`front`（true 时插队）、`number`、`prompt_id`（可自定义 UUID）、`partial_execution_targets`。

### 6.3 `/history/<prompt_id>` 的结构

```json
{
  "<prompt_id>": {
    "prompt": [0, "<prompt_id>", { "<node_id>": {"class_type": "...", "inputs": {}} },
               {"client_id": "...", "create_time": 1700000000000}, ["10"], {}],
    "outputs": {
      "10": {
        "images": [
          { "filename": "char_consistency_00001_.png", "subfolder": "", "type": "output" }
        ]
      }
    },
    "status": {
      "status_str": "success",
      "completed": true,
      "messages": [
        ["execution_start",   {"prompt_id": "...", "timestamp": 1700000000000}],
        ["execution_success", {"prompt_id": "...", "timestamp": 1700000000123}]
      ]
    },
    "meta": { "10": {"node_id": "10", "display_node": "10", "parent_node": null, "real_node_id": "10"} }
  }
}
```

**轮询判定（无头环境推荐）：**
```python
# 伪代码 —— 只查 status.completed，别去猜 outputs 的 key
h = GET(f"{BASE}/history/{prompt_id}").json()
if prompt_id not in h:            continue        # 还没进 history，继续等
entry = h[prompt_id]
if entry["status"]["completed"]:  break           # 成功或失败都置 true
# 成功后：遍历 entry["outputs"][*]["images"] 拿 filename/subfolder/type
```

**注意点（源码级）：**
- `GET /history/<未知 id>` 返回 **`{}`**（不是 404）。所以"prompt 不在 history 里"= 还在队列/执行中。
- `outputs` 的 key 是**节点 id 字符串**，不是 class_type。想稳定取图，就把 `SaveImage` 的节点 id 写死（例如 `"10"`）。
- `status.status_str` ∈ `success` / `error`；`status.completed` 是 bool。
- `entry["prompt"][2]` 是提交时的 workflow dict（安全索引）；**`entry["prompt"][5]` 可能含 `api_key_comfy_org` / `auth_token_comfy_org` 等敏感字段 —— 打日志时不要整条 dump。**

### 6.4 `/view` 的参数

```http
GET /view?filename=<name>&subfolder=<sub>&type=<input|output|temp>
```

| 参数 | 必需 | 说明 |
|---|---|---|
| `filename` | ✅ | 来自 history 的 `images[].filename` |
| `type` | 否 | `input` / `output` / `temp`，**默认 `output`** |
| `subfolder` | 否 | 来自 history 的 `images[].subfolder`；**默认空字符串也要显式传，或省略** |
| `preview` | 否 | 预览格式提示，如 `webp;90` |
| `channel` | 否 | `rgba` / `rgb` / `a` |

> ⚠️ **不要**手动拼 `filename` —— 一律用 history 返回的三元组，否则 `subfolder` 漏了就会 404。

### 6.5 失败信息的三个位置（关键）

| 阶段 | 位置 | 结构 |
|---|---|---|
| **提交即校验失败**（节点名写错、输入类型不匹配、模型文件不存在、返回类型连不上） | **`POST /prompt` 的 HTTP 400 响应** | `{"error": {"type": "prompt_outputs_failed_validation", "message": "...", "details": "...", "extra_info": {}}, "node_errors": {"<node_id>": {"errors": [{"type": "...", "message": "...", "details": "..."}], "dependent_outputs": [...], "class_type": "..."}}}` |
| **运行期失败**（CUDA OOM、insightface 没装、CLIPVision 缺失、ControlNet 格式错） | **`GET /history/<prompt_id>` 的 `status.messages`** | 找 `["execution_error", payload]`，payload 字段（源码 `handle_execution_error` 原文）：`prompt_id`, `node_id`, `node_type`, `executed`, **`exception_message`**, **`exception_type`**, **`traceback`**, `current_inputs`, `current_outputs` |
| **实时** | `GET /ws` WebSocket | `execution_error` / `execution_interrupted` 事件；另可接 `progress` 看进度 |

**运行期错误的 payload 示例结构：**
```json
["execution_error", {
  "prompt_id": "<uuid>",
  "node_id": "3",
  "node_type": "IPAdapterUnifiedLoader",
  "executed": ["1", "2"],
  "exception_message": "ClipVision model not found.",
  "exception_type": "Exception",
  "traceback": ["...", "..."],
  "current_inputs": {"model": ["MODEL"], "preset": ["PLUS FACE (portraits)"]},
  "current_outputs": ["3"]
}]
```

> 💡 **无头调试的实用组合**：
> - 先 `GET /object_info/<NodeClass>` 确认节点存在、看它真实的输入名和 enum 取值 —— 这是排查"新版本节点改名了"的最快手段，不用翻源码。
> - 再 `GET /models/<folder>`（如 `/models/ipadapter`、`/models/clip_vision`）确认 ComfyUI 到底看到了哪些文件 —— 排查"文件放错目录导致下拉框为空"的最快手段。
> - `GET /system_stats` 拿 VRAM 信息；`POST /free`（`{"unload_models": true, "free_memory": true}`）在两次运行之间强制卸载。
> - 所有路由都同时支持 `/api` 前缀（`/api/prompt` ≡ `/prompt`），无头场景用哪个都行。

**常见错误 → 根因速查：**

| 报错 | 根因 |
|---|---|
| `ClipVision model not found.` | `models/clip_vision/` 里文件名不符合正则（见 §2.2/§2.3） |
| `IPAdapter model not found.` | 权重不在 `models/ipadapter/`，或文件名没匹配上 preset 正则 |
| `insightface model is required for FaceID models` | 用了 FaceID 权重但走的是 `IPAdapterAdvanced`；或 insightface 未安装 |
| `Missing CLIPVision model.` | 用了 `IPAdapterModelLoader` 但没接 `CLIPVisionLoader` |
| `Return type mismatch between linked nodes` | 节点间类型不匹配（常见于混用不同 InstantID/IPAdapter 实现的 `INSIGHTFACE` vs `INSIGHTFACEMODEL`） |
| `CUDA out of memory` | 见 §4.4/§4.5 |
| `Please consider using the ProMax ControlNet Union model.` | `SetUnionControlNetType` 的 type 超出当前 union 模型支持范围 |
| `POST /prompt` 返回 **HTTP 500**（不是 400） | JSON body 格式错误。`POST /prompt` / `/queue` / `/history` / `/free` 都不做 JSON 解析兜底，畸形 JSON 直接 500 |

---

## 7. Q6：有没有比 IP-Adapter 更值得试的现成方案？

### 7.1 先给结论

> **在"动漫（非真人）角色一致性 + 免训练 + 15 GB T4"这三个约束下，IP-Adapter Plus / Plus Face 仍然是最优解 —— 不是因为它最强，而是因为其他候选要么在原理上就不适用于二次元，要么在显存上根本跑不起来。**
>
> 唯一真正专为动漫画风设计的工作（AnimeAdapter，arXiv 2605.20237）**权重尚未发布**。

### 7.2 InsightFace 系方案：全部不适用（证据强度：高）

InstantID / PuLID(SDXL) / IP-Adapter FaceID / FaceID PlusV2 **全部以 InsightFace 的 ArcFace 人脸识别模型作为 ID 编码器**。ArcFace 只在真人照片上训练，对二次元人脸要么检测不到，要么给出无意义的 embedding。

**直接证据：**

| 证据 | 内容 | 来源 |
|---|---|---|
| ⭐ **节点作者本人** | cubiq 在 IP-Adapter Plus issue #620 回复：*"the models are not trained for cartoons or strongly stylized characters"*；*"realistic style works, if it's too stylized it won't work"* | [cubiq/ComfyUI_IPAdapter_plus#620](https://github.com/cubiq/ComfyUI_IPAdapter_plus/issues/620) |
| 用户实测 | *"Insightface has lost the ability to detect Anime/manga/toon faces. This is even after I have used SEGS to detect the Toon face, and force face only content into IPAdapter FaceID."* | 同上 |
| InstantID 作者实测 | *"InstantID ... 87% 识别成功，13% 失败cases 典型涉及 **extreme style transfers like heavy anime styling**"* | [apatero 2025-12 对比](https://apatero.com/blog/pulid-vs-instantid-vs-ipadapter-faceid-comparison-2025) |
| 学术论文（强证据） | AnimeAdapter 论文明确指出：IP-Adapter 这类"cross-attention 注入"方法 *"often fail to preserve fine-grained appearance details"*（动漫场景），并专门为此设计动漫适配器 | [arXiv 2605.20237](https://arxiv.org/html/2605.20237v1) |
| 模型卡 | PuLID：*"Identity preservation is weaker in anime and cartoon styles"* | [tasarim.ai PuLID profile](https://tasarim.ai/en/models/pulid) |
| 官方 wiki | IP-Adapter FaceID 系列 = *"a face recognition model ... arcface model from insightface"* | [tencent-ailab/IP-Adapter wiki](https://github.com/tencent-ailab/IP-Adapter/wiki/IP%E2%80%90Adapter%E2%80%90Face) |

**InstantID 具体资料（万一你要试真人）**：
- 模型 repo：`InstantX/InstantID`（注意不是 `InstantID/InstantID`，后者需授权）
  - 主权重：`ip-adapter.bin`（1,691,134,141 B ≈ 1.69 GB）→ `ComfyUI/models/instantid/`
  - ControlNet：`ControlNetModel/diffusion_pytorch_model.safetensors` → `ComfyUI/models/controlnet/`
- 节点：`cubiq/ComfyUI_InstantID`
- **额外依赖 insightface + onnxruntime + onnxruntime-gpu，以及 antelopev2 人脸模型**（约 300 MB，需手动下载解压到 `models/insightface/models/antelopev2/`，且**解压后常出现 `antelopev2/antelopev2/` 双层嵌套导致 `AssertionError: 'detection' in self.models`** —— 这是高频坑）
- **仅支持 SDXL**
- ⚠️ 已知问题：与 IP-Adapter 同时使用会出现身份渐进崩坏（[ComfyUI#12989](https://github.com/Comfy-Org/ComfyUI/issues/12989)）

**PuLID**：
- 版本：`PuLID-v1` / `v1.1`（SDXL）、`PuLID-FLUX-v0.9.0/0.9.1`（FLUX）
- repo：`guozinan/PuLID`（GitHub: `ToTheBeginning/PuLID`）
- 依赖 InsightFace → **同样不适用于动漫**

### 7.3 2025–2026 新方案逐个体检

| 方案 | 基座 | 是否支持 SDXL | 15 GB T4 可行性 | 动漫适用性 | 判断 |
|---|---|---|---|---|---|
| **USO**（ByteDance） | **FLUX.1-dev** | ❌ 发布的权重只有 `uso_flux_v1.0/dit_lora.safetensors`(478 MB) + `projector.safetensors`(21 MB)，**全部依赖 flux1-dev** | ⚠️ README 称 fp8 模式**峰值约 16 GB** —— 已超 T4 15 GB | 未见动漫专项评估；示例全是真人肖像 | ❌ **T4 跑不动**；且与你的 SDXL 动漫基座不兼容 |
| **Qwen-Image-Edit** | Qwen-Image（20B） | ❌ | ❌ 20B 参数 | — | ❌ 显存远超 T4 |
| **OmniGen2 / OmniGen** | 自研 | ❌ | ⚠️ 未见 T4 验证 | — | ❌ 生态与 SDXL 动漫链不兼容 |
| **InstantCharacter**（Tencent） | FLUX | ❌ | ❌ | — | ❌ |
| **DreamO** | FLUX | ❌ | ❌ | — | ❌ |
| **In-Context LoRA (IC-LoRA)** | FLUX | ❌ | ❌ | — | ❌ |
| **ACE++** | FLUX | ❌ | ❌ | — | ❌ |
| **AnimeAdapter** ⭐ | SD 系（IP-Adapter 同类架构） | ✅ 论文基于 SD | 轻量（"lightweight adapter"） | ✅✅ **专为动漫角色一致性设计** | ⚠️ **论文称"code, model weights, and dataset will be publicly released upon acceptance"—— 截至调研日权重未发布，无法使用。值得持续关注。** |
| **ReActor / FaceFusion（换脸）** | 后期处理 | ✅ | ✅ | ❌ InsightFace 系，同样识别不了动漫脸；且是后处理，会"贴脸感" | ❌ |
| **无训练的 prompt 模板 + 固定 seed** | 任意 | ✅ | ✅ | 一般 | ⚠️ 有创作者实测报告：复杂场景下不足，但**作为 IP-Adapter 的补充（固定角色描述模板 + 固定 seed）确实能提高稳定性**，零成本值得做 |
| **角色 LoRA 训练** | SDXL | ✅ | 训不了（Colab 免费档 T4 训练 SDXL LoRA 需数小时且易被回收） | ✅✅ 最强 | ❌ 用户明确排除了训练 |

> **关于"FLUX 系方案更好"的流行说法**：有一篇 2026-03 的创作者实录（[Medium](https://medium.com/@sophie_62065/how-i-solved-character-consistency-in-comfyui-after-trying-controlnet-and-ipadapter-fcd9eda25109)）说最终放弃 ControlNet + IP-Adapter 的复杂管线，改用 **Flux Dev（16 GB+）** + 固定 prompt 模板 + 固定 seed 就解决了。但：**(a)** 该文是单个创作者的经验，不是系统性评测；**(b)** Flux Dev 量级本身就超出 T4 免费档的舒适区；**(c)** 该文的场景是儿童绘本插画（偏通用卡通），不是二次元动漫风格；**(d)** 它不解决"原创角色跨图一致性"的硬约束（固定 seed 只在构图相近时才有效）。**结论：对本题不构成替代方案。**

### 7.4 那"最值得额外试"的是什么？

按性价比排序，在你的约束内**真正值得试**的补充手段：

1. **【最高价值】叠两层 IP-Adapter**：`Plus Face`(weight ≈0.85) 管脸 + `Plus`(weight ≈0.5–0.6) 管服装/配色。这是社区处理"脸+衣服都要一致"的标准做法，成本仅 +0.4 GB。
2. **【高价值】固定角色描述 prompt 模板 + 固定 seed**：把角色的固定 tag 串（发色/瞳色/发型/服装 tag）原样复用，只改姿势/场景部分。零显存成本，与 IP-Adapter 正交。
3. **【中价值】用 `attn_mask` 做区域控制**：让脸部的 IP-Adapter 只作用于画面的人物区域，避免参考图的背景污染构图。IPAdapterAdvanced 的 `attn_mask` 就是为此设计的。
4. **【中价值】`weight_type` 换成 `style transfer`（SDXL 专用）**：当"换姿势后构图被参考图锁死"时，这个 weight_type 只迁移风格不迁移内容 —— 官方 README 明确说它 *"hugely impacts how the composition reacts to the text prompting"*。
5. **【中价值】生成角色定妆表（character sheet）作为参考图**：先用 IP-Adapter 出一张高质量的正面全身定妆图，之后所有生成都以它为参考，而不是以零散的参考图。参考图越"标准"，一致性越稳。
6. **【待观察】AnimeAdapter**：唯一动漫专用方案，等权重开源。

---

## 8. 「我查证过的」vs「不确定的」

### ✅ 已查证（附来源，可直接依赖）

- 所有 HF repo id、文件名、字节数 —— 均通过 HuggingFace API (`/api/models/<repo>/tree/<path>`) 逐条核实
- `ComfyUI_IPAdapter_plus` 的 preset → 文件正则映射、`IPAdapterAdvanced` / `IPAdapterUnifiedLoader` / `IPAdapterFaceID` 的完整 `INPUT_TYPES` —— 读 `IPAdapterPlus.py`、`utils.py` 源码
- 目录结构与改名要求 —— 官方 README 原文 + `IPAdapterPlus.py` 中的 `folder_paths.folder_names_and_paths["ipadapter"]` 注册逻辑
- Registry id `comfyui_ipadapter_plus`（1,566,518 次下载）与 `comfyui_controlnet_aux`（2,723,734 次下载）—— `api.comfy.org`
- `/prompt` / `/history` / `/view` 的请求/响应结构与错误 payload —— ComfyUI 官方文档 `docs.comfy.org` + `execution.py::handle_execution_error` 源码
- `--lowvram` 在 DynamicVRAM 下失效、`--fp8_e4m3fn-unet` 的 T4 语义、`supports_fp8_compute()` 门槛 —— `comfy/cli_args.py`、`comfy/model_management.py`（commit 9953f22）源码 + 维护者博客/issue
- SDXL UNet 4897 MB / ControlNet 2397 MB 的实际 staged 值 —— ComfyUI 运行日志（issue #13668）
- NoobAI-XL-1.1 的推荐参数、prompt 前缀、负向词 —— 官方 HuggingFace model card
- `OpenposePreprocessor` 的 `scale_stick_for_xinsr_cn` 参数、`DWPreprocessor` / `Zoe-DepthMapPreprocessor` / `CannyEdgePreprocessor` / `AnimeLineArtPreprocessor` 的 node id —— `comfyui_controlnet_aux` master 分支源码
- `SetUnionControlNetType` 的 type 枚举与 union 模型报错文案 —— `comfy_extras/nodes_controlnet.py` + `comfy/cldm/control_types.py`
- 作者于 2025-04-14 宣布 IPAdapter_plus 进入 maintenance-only —— 仓库 README 原文
- InsightFace 系不适用于动漫 —— 节点作者本人回复 + 用户实测 + 论文 + 模型卡（四重来源）
- USO 只有 FLUX 权重、fp8 峰值约 16 GB —— 官方 GitHub README + HF 文件列表 + ComfyUI 官方教程
- InstantID 的 repo、文件名、antelopev2 依赖与双层目录坑 —— cubiq/ComfyUI_InstantID README + HF API + ComfyUI issue #10340

### ⚠️ 不确定 / 未查证（报告中已就地标注）

1. **各组件在 T4 上的精确显存峰值** —— 报告中的数字是"权重常驻量推算 + 日志实测值"的混合。**你必须自己在 Colab 上实测校准**，尤其是 832×1216 下 IP-Adapter + ControlNet 的真实峰值。我给的是量级判断（1024×1536 三件套必 OOM；832×1216 有机会）。
2. **`--fp8_e4m3fn-unet` 在 T4(SM7.5) 上"省显存不省时间"的精确程度** —— 维护者博客与 vramready 指南都说省内存；但 [issue #10087](https://github.com/comfyanonymous/ComfyUI/issues/10087) 里有 4070 用户报告 fp8 权重仍被升到 fp16 导致内存不降。该 issue 针对 **FLUX**，SDXL 未见同类报告。**建议实测对比 `torch.cuda.max_memory_allocated()`。**
3. **ComfyUI 最新版本（2026-10）与 maintenance-only 的 IPAdapter_plus 是否存在兼容性断裂** —— GitHub API 被限流，我未能确认两边的最后提交时间。请在你实际安装的版本上跑一次 `IPAdapterUnifiedLoader` 冒烟测试。若节点加载失败，可试 `comfyorg/comfyui-ipadapter` 镜像。
4. **Illustrious-XL-v2.0 的官方推荐采样参数** —— model card 里没有。给的是"沿用 NoobAI 参数区间"的经验判断。
5. **`ip_plus_composition_sdxl.safetensors`（`ostris/ip-composition-adapter`）** —— 这是一个"只迁移构图、忽略风格与内容"的社区 IP-Adapter，可能对"换姿势构图"有用。**我没有实测过它，也没有找到动漫场景的评测**，列为探索项。
6. **AnimeAdapter 权重是否已发布** —— 论文（arXiv 2605.20237，2026-05）称"upon acceptance"。我未在 HF/GitHub 找到权重仓库。请持续关注。
7. **aiofm.info 系列"对比指南"的可信度** —— 该站多篇 2026 年文章结构高度模板化、数据标注"illustrative"，**疑似 AI 生成的 SEO 内容**。我在报告里只把它们当"弱证据"，未采信其具体数值（如"PuLID 88 分 / InstantID 75 分"）。
8. **`thibaud` vs `xinsir` openpose 在 Illustrious/NoobAI 上的实际效果** —— 我只找到 xinsir 的官方自评 mAP 和一条 Civitai 负面评论，**没有针对 Illustrious/NoobAI 基座的系统对比**。建议你自己跑 A/B（同 seed、同 prompt、只换 ControlNet）。

---

## 9. 参考链接汇总

**模型 / 权重**
- [h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter) · [sdxl_models 目录](https://huggingface.co/h94/IP-Adapter/tree/main/sdxl_models)
- [h94/IP-Adapter-FaceID](https://huggingface.co/h94/IP-Adapter-FaceID)（不推荐用于动漫）
- [xinsir/controlnet-union-sdxl-1.0](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0) · [xinsir/controlnet-openpose-sdxl-1.0](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0) · [xinsir/controlnet-depth-sdxl-1.0](https://huggingface.co/xinsir/controlnet-depth-sdxl-1.0)
- [InstantX/InstantID](https://huggingface.co/InstantX/InstantID)（真人）
- [OnomaAIResearch/Illustrious-XL-v2.0](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0)
- [Laxhar/noobai-XL-1.1](https://huggingface.co/Laxhar/noobai-XL-1.1)

**节点 / 代码**
- [cubiq/ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) · [NODES.md](https://github.com/cubiq/ComfyUI_IPAdapter_plus/blob/main/NODES.md) · [examples/](https://github.com/cubiq/ComfyUI_IPAdapter_plus/tree/main/examples)
- [Fannovel16/comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux)
- [cubiq/ComfyUI_InstantID](https://github.com/cubiq/ComfyUI_InstantID)
- [tencent-ailab/IP-Adapter](https://github.com/tencent-ailab/IP-Adapter) · [wiki: IP-Adapter-Face](https://github.com/tencent-ailab/IP-Adapter/wiki/IP%E2%80%90Adapter%E2%80%90Face)
- [bytedance/USO](https://github.com/bytedance/USO) · [USO 项目页](https://bytedance.github.io/USO/)

**ComfyUI 文档 / 源码**
- [Server Routes (HTTP/WS API)](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [API Examples](https://docs.comfy.org/development/comfyui-server/api-examples)
- [Startup Flags](https://docs.comfy.org/development/comfyui-server/startup-flags)
- [Troubleshooting Overview](https://docs.comfy.org/troubleshooting/overview)
- [comfy/cli_args.py（master）](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/cli_args.py)
- [execution.py（execution_error payload）](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/execution.py)
- [comfy/cldm/control_types.py](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/cldm/control_types.py)
- [openapi.yaml](https://github.com/comfyanonymous/ComfyUI/blob/master/openapi.yaml)
- [ComfyUI Registry API](https://api.comfy.org/nodes/comfyui_ipadapter_plus)

**关键 issue / 讨论**
- [cubiq/ComfyUI_IPAdapter_plus#620 — Insightface "no faces detected"（动漫不适用）](https://github.com/cubiq/ComfyUI_IPAdapter_plus/issues/620)
- [Comfy-Org/ComfyUI#13668 — SDXL + ControlNet VRAM 日志](https://github.com/Comfy-Org/ComfyUI/issues/13668)
- [Comfy-Org/ComfyUI#15666 — `--reserve-vram` ignored](https://github.com/Comfy-Org/ComfyUI/issues/15666)
- [Comfy-Org/ComfyUI#12989 — InstantID + IPAdapter 身份崩坏](https://github.com/Comfy-Org/ComfyUI/issues/12989)
- [Comfy-Org/ComfyUI#10340 — InstantID antelopev2 双层目录坑](https://github.com/Comfy-Org/ComfyUI/issues/10340)
- [Comfy-Org/ComfyUI#10087 — fp8 权重被升精度](https://github.com/comfyanonymous/ComfyUI/issues/10087)
- [ComfyUI commit 9953f22 — `--fast` / `supports_fp8_compute`](https://github.com/comfyanonymous/ComfyUI/commit/9953f22fce0ba899da0676a0b374e5d1f72bf259)

**论文**
- [AnimeAdapter: Fine-grained and Consistent Zero-shot Anime Character Generation](https://arxiv.org/html/2605.20237v1) — 唯一动漫专用方案，权重未发布
- [PuLID: Pure and Lightning ID Customization via Contrastive Alignment](https://arxiv.org/html/2404.16022)
- [USO: Unified Style and Subject-Driven Generation](https://arxiv.org/abs/2508.18966)

---

## 附：推荐的落地顺序（T4 实操 checklist）

```
① Colab 起 T4，装 ComfyUI + comfyui_controlnet_aux + ComfyUI_IPAdapter_plus
② 下 4 个文件：动漫 ckpt ×1、ip-adapter-plus_sdxl_vit-h、ip-adapter-plus-face_sdxl_vit-h、
   CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors（改名！）
③ 先跑「纯 txt2img @ 832×1216」确认基线能出图，记录 peak VRAM
④ 加 IP-Adapter Plus Face（weight 0.85），再记录 peak VRAM —— 这一步应该能过
⑤ 加第二层 IP-Adapter Plus（weight 0.55）—— 这一步通常还能过
⑥ 加 ControlNet Union(openpose) + DWPreprocessor（strength 0.7, end_percent 0.9）
   —— 若 OOM，依次：加 --fp8_e4m3fn-unet → 加 --vram-headroom 1 → 拆成两步生成
⑦ 用 /object_info/<Node> 和 /models/<folder> 两个端点做无头自检，别靠猜
```

> **本文档不含任何真实 API key / token。所有路径、域名、UUID 均为占位符或 RFC 标准示例值。**
