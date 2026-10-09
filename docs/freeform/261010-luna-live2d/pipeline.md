# Luna → Live2D 全自动流水线

把 `/root/agents/luna/` 的立绘，用**全自动**链路做成可在 `dsh-live2d-voice` 里驱动的 Live2D 模型。
不追求商用质量，目标是「她自己有一个会动的身体」。

## 当前状态（2026-10-10 07:10）

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| ① 单图分层 | **受阻** | 全部免费 GPU 路线当天不可用，见下 |
| ② 自动绑定 | 工具链已验证可用 | psd2live 在 aarch64 上跑通，产出 moc3+model3.json+物理+动作 |
| ③ 接入插件 | 未开始 | e2e 实例槽位被其它 agent 占用中 |

**已确认的关键结论：**

1. **原定妆图不能用**。它「一只手抬到脸侧」，手/发/脸三层重叠，See-Through 会把躯干切没、
   把整条手臂塞进 `handwear`、把 `mouth`/`nose` 切成空层。**必须先出一张 A-pose 专用绑定立绘。**
2. A-pose 立绘已生成并选型完成 → `input/apose/luna_apose_d.png`（vision 子代理判定：
   腋下到手腕有连续高对比空隙，正面不歪头、双腿并拢，四项硬要求全满足）。
3. 自动绑定链路完全跑通（见 §② ），瓶颈只在①。

## 流水线

```
立绘(单图)
  └─① See-Through 单图分层 ──→ 分层 PSD（带遮挡补全）
        └─② psd2live 自动绑定 ──→ .moc3 + .model3.json + 物理 + 待机/眨眼/点头/摇头动作
              └─③ 接入 dsh-live2d-voice ──→ 眨眼 / 视线 / 口型 / 呼吸 / 发丝物理
```

### 输入准备

用定妆图当垫图生成 A-pose 立绘（Flow，`gemini-3.0-pro-image`；`gemini-3.1-flash-image`
已被 Flow 拒，报 `rpc=ogiZ0b, code=[5]`）：

```bash
.venv/bin/python scripts/gen_apose.py --ref input/apose/luna_apose_a.png d e
.venv/bin/python scripts/prep_input.py input/apose/luna_apose_d.png input/luna_apose_d_square.png 16
# 头肩裁切图：脸在画布上占比更大，低分辨率下脸部实际像素反而更高
.venv/bin/python scripts/prep_input.py input/apose/luna_apose_d_bust.png  input/luna_apose_d_bust_square.png 8
```

### ① 单图分层：See-Through

**需要 ≥24 GB 显存的 GPU**（实测 bf16 权重就占 9.43 GB）。

| 通道 | 硬件 | 状态 |
| --- | --- | --- |
| ModelScope 创空间（免费不限次） | A10 级 | **当天下线**（`/gradio_api/info` 403 + 推理 `event: error`） |
| HuggingFace ZeroGPU Space | a10g 24GB | **应用自身坏了**（任何参数都抛 `AppError: TypeError`） |
| Google Colab CLI（T4） | 14.56 GB 可用 | **配额耗尽 + 会话被反复回收** |

**在 T4 上跑通 See-Through 的配方**（三条缺一不可，已实测 GPU 100%、显存 9.6 GB）：

1. 权重 `torch_dtype=torch.bfloat16` 加载（上游默认 fp32，SDXL fp32 就要 13 GB）
2. `enable_attention_slicing()` + `enable_vae_slicing()` + `enable_vae_tiling()`
3. `--resolution 768`，且**不要**开 `--group_offload`
   （它拿 CPU 内存换显存，Colab 12.9 GB RAM 无 swap，会被内核 cgroup OOM 杀）

```bash
# 本地跑（ModelScope 可用时）
.venv/bin/python scripts/ms_seethrough.py <正方输入>.png output/bust_1024.psd 1024 42
```

**ModelScope 判活**：`/gradio_api/info` 返回 403 + 推理一律 `event: error, data: null` 就是它挂了
（拿一个曾经成功过的输入重跑即可确认是自己还是它的问题）。它会自己恢复，挂轮询即可。

### ② 自动绑定：psd2live

只需 JDK 21，**不需要** x64——官方只发 linux-amd64 包，但 JVM 字节码与架构无关，
解开 deb 用系统 JDK 直接跑主类就能在 **aarch64 上原样工作**（只有它的 Cubism 原生预览需要 x64）：

```bash
dpkg-deb -x PSD2Live-3.2.0-linux-amd64.deb tools/psd2live-deb
java -Xmx1100m -cp "tools/psd2live-deb/opt/psd2live/lib/app/*" io.github.psd2live.MainKt \
  --input output/bust_1024.psd --output work/p2l-out --lang zh
```

产物 12 个文件：`*.moc3`、`*.model3.json`、`*.physics3.json`、`*.cdi3.json`、
`idle/blink/nod/shake.motion3.json`、`*.4096/texture_0*.png`，外加可在 Cubism Editor 二次编辑的 `*.cmo3`。

### ③ 渲染验证：无头浏览器

`scripts/render_moc3.mjs` 用 **dsh-live2d-voice 自己的运行时资产**（pixi.js 7 +
pixi-live2d-display cubism4 + Cubism 4 Core）把模型真跑起来，按包围盒取景，
输出定姿截图（含头部特写）或待机动画帧序列：

```bash
node scripts/render_moc3.mjs work/p2l-out work/render model3.json   # 10 个姿态 + 头部特写
ANIM=1 FRAMES=48 node scripts/render_moc3.mjs ...                    # 待机动画帧 → GIF
```

**必须看运动帧，不能只看静止帧**（第一版就是这么翻车的：静止像样，一转头就散架）。
判图一律交 `vision-reader` 子代理，不自己下结论。

## 目录

```
input/    输入立绘（含 A-pose 候选与裁边后的正方图）
output/   See-Through 产出的分层 PSD
work/     p2l-out 模型文件、render 截图/动画帧、各后台任务日志
scripts/  各阶段脚本（见下）
tools/    psd2live 的 deb 与解包结果
```

关键脚本：

| 脚本 | 用途 |
| --- | --- |
| `gen_apose.py` | 以定妆图为垫图生成 A-pose 绑定专用立绘 |
| `prep_input.py` | 紧致裁边 + 补正方（See-Through 最吃的输入形式） |
| `ms_seethrough.py` | ModelScope 创空间分层（原生 gradio HTTP 协议） |
| `colab_seethrough.py` / `colab_bust_first.py` | Colab 远程分层（含 bf16+slicing 补丁） |
| `colab_pipeline.sh` | Colab 全流程编排（开卡→上传→推理→下载→释放，自带重试） |
| `render_moc3.mjs` | 无头渲染 + 定姿/动画截图 |
| `layers_sheet.py` | 把分层 PSD 摊成接触表，交给 vision 判读 |

## 环境坑

- `no_proxy`/`NO_PROXY` 含 `[::1]` 会让 **httpx2 解析崩溃**（`Invalid port: ':1]'`）。
  调 Python HTTP 客户端前用 `env -i` 清掉或改写这两个变量。
- Python 依赖装在项目内 venv（`.venv`），不动系统 Python（PEP 668）。
- 内存紧张：JVM 给 `-Xmx1100m`，Chromium 一次只留一个实例，跑完立刻退。
- 云 GPU 的通用用法与坑见技能 `cloud-gpu`。

## 下一步

1. 拿到稳定 GPU（Kaggle 免费 T4 9 小时会话 / 付费 GPU）后重跑 ①
2. 用 `layers_sheet.py` + `vision-reader` 判图层，重点看 `topwear` 有没有躯干、`mouth`/`nose` 是否为空
3. ② 重新绑定 → ③ 用运动姿态渲染并交 vision 逐条比对
