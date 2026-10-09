# 261010 Live2D 交互补齐：点击互动 · 空闲节奏 · 动作音效

> 背景：`docs/research/261010-l2d-borrow-and-standard-audit.md`（hacxy/l2d 借鉴评估 + 我们的标准适配审计）
> 裁决：auto-human 决定 **P1 先做**（点击互动 + 空闲节奏 + 动作音效审计），P0（升级 Cubism Core 到 5.3+/6）另走三条前置验证后再定，P2（Flick/Shake 划动）/P3（表情选择器、参数面板）本轮不做。
> 工作方式：`feat/live2d-interaction` worktree + implement-review。

## 一、目标与非目标

**目标**
1. **点击互动**：点角色有反应——命中 `HitAreas` 时播对应 Tap 动作；无 `HitAreas` 的模型按可见范围判定；点空白不响应。
2. **空闲节奏**：没有 `Idle` 动作组的模型（游戏拆包常见"动作全塞空名组"）不再每 20 秒才动一次。
3. **动作音效**：查清并消除"模型自己随机出声"的缺陷。

**非目标（本轮不做）**
- 划动手势 → `Flick*`/`Shake` 动作映射（P2）。
- 手动表情选择器、运行时参数面板（P3）。
- Cubism Core 升级 / moc3 v6 支持（P0，独立前置验证）。
- 点击附带表情或音效反馈（会与 agent 情绪/语音来源打架，明确不做）。

## 二、设计

### 2.1 点击判定（与现有 pan/zoom 手势共存）

现有手势层（`src/client/model.ts` 的 `stage.addEventListener("pointerdown"/"pointermove"/"pointerup")`）负责单指拖动、双指缩放、滚轮、双击复位。新增一条**点击**分支：

- `pointerdown` 记录起点坐标与时间戳；`pointerup` 时判定：
  - 单指（非双指缩放态）；
  - 总位移 < `TAP_SLOP_PX`（8 CSS px，容手指抖动）；
  - 按下时长 < `TAP_MAX_MS`（500 ms）。
- 满足即视为点击，交由**该模型**（双人舞台下由既有 gesture registry 判定"手指落在谁身上"）处理；不满足则维持原有拖动/缩放语义不变。

### 2.2 命中判定

1. **模型声明了 HitAreas**（`internalModel.hitAreas` 非空，本库 11 个模型）：
   用 `model.hitTest(x, y)`（pixi-live2d-display 自带：内部把舞台坐标转模型坐标、逐 hit area 做几何判定，返回命中的 area 名数组）。
   - 命中 → 取第一个 area 名（`Head`/`Body`）。
   - 未命中 → **不响应**（点空白不播动作）。
2. **模型没有 HitAreas**（本库 21 个带 Tap 动作的模型属此类）：
   用 `model.getBounds()` 判定点是否落在可见包围盒内；在盒内 → 视为整体命中；盒外 → 不响应。

### 2.3 动作选择与优先级

命中后按序找组（大小写不敏感）：

```
Tap<AreaName>  →  Tap  →  TapBody  →  （都不存在：不动作）
```

- 例：命中 `Head` 且有 `TapHead` 组 → 播 `TapHead`；否则回退 `Tap`。
- 播放优先级：当前若有 **NORMAL/FORCE 优先级**动作在播 → **不打断**，本次点击静默忽略；空闲态用 `NORMAL` 播一次。
- 随机选取组内一个动作（与空闲调度一致）。

### 2.4 诊断契约

`container.dataset.lvTap = "<area 名或 'body'|'none'>:<实际播放的组名或 'ignored'>"`，每次点击判定后写入。
遵循既有 dataset 契约惯例（`lvTransform`/`lvParamIds`），供 e2e 断言与排障；`tag` 存在时另写 `lv${tag}Tap`。

### 2.5 空闲节奏（无 `Idle` 组时）

现状：`view.tsx` 的空闲调度在无 `Idle` 组时回退空名组，但仍按 `idleInterval`（默认 20s）触发 → 素晴日 megumin 这类"空名组 29 个短动作"的模型 20 秒才动一次，观感是死的。

调整：**当模型没有 `Idle` 组时**，实际空闲间隔取 `min(idleInterval, 6)` 秒；有 `Idle` 组时行为不变（`idleInterval` 原样）。理由：`Idle` 组动作通常是长循环待机，空名组动作是短演出片段，需要更密的节奏才像活的。`idleInterval=0` 仍表示关闭空闲。

### 2.6 动作音效

**实测缺陷**：`hibiki` 的空闲动作自带 `sounds/hibiki_01.wav` 等语音，插件的空闲调度一播动作，框架就 `SoundManager` 取文件并播放（实测 20 秒内 3 次 `.wav` 请求 + 4 条 "Audio finished playing"）。本库 **37 处动作音效引用中有 33 处文件真实存在**——即角色会在语音通话中随机说出模型自带的语音。

方案：模型绑定时**摘掉动作定义里的 `Sound` 字段**（`internalModel.motionManager.definitions[*][*].Sound`，同时清 `settings.motions` 内的同名对象），使框架的 `getSoundFile()` 返回空 → 既不播放也不产生请求。语音只由插件的 TTS + 口型管线提供。写进 CHANGELOG 与模块 AGENTS.md，将来若要"动作音效开关"再作为配置项加回。

## 三、实现落点

| 文件 | 改动 |
|---|---|
| `src/client/model.ts` | 点击判定 + 命中 + Tap 组选择 + `dataset.lvTap`；绑定时摘除动作 `Sound`；导出必要常量（阈值） |
| `src/client/view.tsx` | 空闲调度：无 `Idle` 组时用 `min(idleInterval, 6)` |
| `e2e/verify-tap.mjs` | 新增套件（见下） |
| `e2e/run.mjs` | 把新套件挂进 `gaze` 模块（沿用手势/视线同层） |
| `src/client/AGENTS.md` | 补 pitfall：点击判定与拖动阈值、动作音效必须摘除 |
| `CHANGELOG.md` | Unreleased 条目 |
| `scripts/init-worktree.sh` | 顺带修掉 `65309cf` 合并时遗留的冲突标记（3 行，阻断 worktree 流程） |

## 四、验证方案（e2e，零真实 API）

新套件 `e2e/verify-tap.mjs`（空会话 + standalone 入口 + 配置 pin 模型）：

1. **有 HitAreas 的模型**（`haru`：Head/Body）：
   - 点头部区域 → `dataset.lvTap` 命中 `Head`，组名 ∈ {TapHead, Tap}
   - 点画布远角空白 → `lvTap` 不变化（不响应）
2. **无 HitAreas 的模型**（`tsumiki`）：点模型包围盒内 → 触发；点盒外 → 不触发
3. **手势共存**：按住并拖动 200px 后松开 → 不产生 tap（`lvTap` 不变），且模型位移（`lvTransform` 变化）
4. **动作音效**：pin `hibiki` + `idleInterval=2`，等待 ≥3 个空闲周期 → 断言 **0 个 `sounds/*.wav` 请求**
5. **空闲节奏**：无 `Idle` 组模型（`megumin`）+ `idleInterval=20` → 6 秒内应发生至少一次动作（通过 `lvTap`/动作契约或请求计数间接断言）

静态：`npm run typecheck` + `node build.mjs`。
真实渲染/主观观感：由用户在自己的会话里点一点确认（模型有反应、不再随机出声）。

## 五、风险

- **误触发**：阈值偏松会把"轻拖"判成点击 → 用 8px + 500ms 双条件，并在 e2e 用 200px 拖动做反例。
- **打断动作**：点击抢占正在播的动作会出戏 → 非空闲态直接忽略（不做打断/排队）。
- **摘 `Sound` 的副作用**：若将来有人依赖动作音效（例如官方 `kei` 的母音口型动作带语音），需要恢复开关；已在 CHANGELOG 记录该行为变更。
- **大画布/超小模型**：包围盒判定对全身像可能偏大 → 仅在无 HitAreas 时使用，且要求点落在 `getBounds()` 内。
