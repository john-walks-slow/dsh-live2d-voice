# 261010 视向参数精简与增益语义修正

## 一、需求原文

> 删除功能：3d空间变换 眉毛联动 眼球联动。默认位移系数负二。视线跟踪玩家的系数希望极细微（应该是转头系数吧）（现在常常觉得视线都转得太多了）…现在我输入0.005和0.1没啥区别…不知道什么原因
>
> 追问答复：两个位移增益都默认 -2；视线系数「眼和头身能不能分开给…但总之都要支持很小」。

拆成四条：

1. **删除** `3D 空间变换`（整组：`transform3dRange` / `transform3dCamGain` / `transform3dGyroGain`）、`眉毛上下联动`（`browGain`）、`眼球形变联动`（`eyeBallFormGain`）——UI 与底层代码一并移除。
2. **位移增益默认 -2**：`camPanGain` 与 `gyroPanGain` 默认值改为 -2（滑条范围相应放宽）。
3. **视线增益拆成「头身」与「眼」两路**，不再共用一个 `camAngleGain`。
4. **极小的增益值必须真的起作用**——现状是 `0.005` 与 `0.1` 完全等效。

## 二、根因（本次实测确认）

`look-math.ts` 的 `mixLookChannel` 把增益当**混合权重**：分母是 `|camGain| + |gyroGain|`。只有一个源在线时：

```
result = (dx * camGain) / |camGain| = dx * sign(camGain)
```

**增益的绝对值被约掉了**——只剩符号。所以摄像头单源在线时 `camAngleGain` 填 0.005 或 0.1 或 1 全都一样（用户观察到的现象）。位移通道走的是另一条路径（`applyTransform` 里直接相乘），所以位移增益本来就线性有效。

这条「权重归一化」语义是 `61dbffe`（增益支持正负）刻意引入的：用绝对值为分母，避免两个相反符号把分母抵消成 0/0。代价就是单源时增益失去幅度含义。

## 三、设计

### 3.1 增益 = 带符号振幅（新语义）

```
result = clamp(camLive ? cam[ch] * camGain : 0 + gyroLive ? gyro[ch] * gyroGain : 0, -1, 1)
```

- 每个源独立贡献「输入 × 自身增益」，符号仍表示反向，`0` = 该源不参与（保留原语义）。
- 单源时线性：0.005 就是 0.005。用户要的「极细微」成立。
- 两源同开时相加后饱和到 ±1：既不会爆掉，也让 `angleRange` / `rollRange` / `panRange` 继续充当硬上限（滑条标签「最大……角度」保持诚实）。
- 删掉 `compute3dTransform` 后，`mixLookChannel` 只有一个消费方（model.ts），改动面收敛。

### 3.2 眼球独立增益

`LookParams` 去掉 `transform3dCamGain` / `transform3dGyroGain` / `transform3dRange` / `browGain` / `eyeBallFormGain`，新增 `camEyeGain` / `gyroEyeGain`：

| 通道 | 摄像头 | 陀螺仪 |
|---|---|---|
| 头 + 身体角度 | `camAngleGain` | `gyroAngleGain` |
| 眼球（ParamEyeBallX/Y） | `camEyeGain` | `gyroEyeGain` |
| 侧倾（ParamAngleZ） | `camRollGain` | `gyroRollGain` |
| 位移 | `camPanGain` | `gyroPanGain` |

眼球按源给增益而非全局乘一个系数：与其余通道对称，且不会出现「头增益为 0 时眼球随之不转」的隐性耦合。滑条顺序：转头 → 眼球 → 旋转 → 位移。

### 3.3 默认值

| 键 | 旧 | 新 | 说明 |
|---|---|---|---|
| `camPanGain` / `gyroPanGain` | 0.20 / 0.45 | **-2** | 用户指定 |
| `camAngleGain` / `gyroAngleGain` | 1.0 / 0.55（旧语义=满幅） | 0.6 / 0.5 | 回应「转得太多」 |
| `camEyeGain` / `gyroEyeGain` | —（旧为满幅 1.0） | 0.4 / 0.4 | 眼球不再满幅甩动 |
| `camRollGain` / `gyroRollGain` | 1.0 / 1.0（旧语义=满幅） | 1.0 / 1.0 | 不变，避免无关观感漂移 |
| `panRange` / `angleRange` / `rollRange` / `bodyZGain` | 0.10 / 8 / 5 / 0.4 | 同前 | 不变 |

位移滑条范围从 -1..1 放宽到 **-3..3**（容纳 -2 默认值；`applyTransform` 是直接相乘、不饱和，故 2× / 3× 位移是真实生效的）。

**存储键升版**：`lv-look-params-v1` → `lv-look-params-v2`。旧值在新语义下含义完全不同（用户存过的 0.005 在旧语义=满幅、新语义≈冻结），必须丢弃重来。

### 3.4 UI 面板（⚙ → 视向灵敏度 → 详细参数）

- 删除 `3D 空间变换` 分组（3 条）与 `扩展可动性` 组的眉毛 / 眼球形变（2 条）。
- `摄像头` / `陀螺仪` 各 4 条（转头 / 眼球 / 旋转 / 位移）。
- `整体幅度` 3 条不变；`扩展可动性` 仅剩 `身体侧倾联动`。
- 第三人称双模型下，`对视停用` 集合从 4 个（转头/旋转）扩到 6 个（+2 个眼球）。
- 共 12 条滑条。

## 四、影响面清单

| 文件 | 改动 |
|---|---|
| `src/client/look-math.ts` | 新语义、参数表、默认值、预设；删 `compute3dTransform` |
| `src/client/model.ts` | 头身/眼分离驱动；删眉毛与眼球形变写入 |
| `src/client/view.tsx` | 删 3D CSS 变换 rAF 段与 import；第三人称停用集合加眼球；存储键 v2 |
| `src/client/hud.tsx` | 分组/滑条/符号集/格式化 |
| `e2e/verify-look-math.mjs` | 断言按新语义重写（小增益线性、单源不再归一化、饱和） |
| `e2e/verify-look-sliders.mjs` | 行数 12、计数器、范围、预设回读值、存储键 |
| `README.md` | 补视向灵敏度面板的用户说明（此前完全没写） |
| `src/client/AGENTS.md` | look 增益语义段落重写 |

不动 `src/client/param-ids.ts`（另一 agent 在途改动，brow / eyeBallForm 的 id 解析保留为惰性条目）。

## 五、验证策略

- 静态：`npm run typecheck`、`npm run build`。
- 纯数学（浏览器无关、零 API）：`node e2e/verify-look-math.mjs` —— 本次语义变更的核心回归锁。
- 面板契约 `verify-look-sliders` 与观感由用户实机确认（见 validation 文档）。
