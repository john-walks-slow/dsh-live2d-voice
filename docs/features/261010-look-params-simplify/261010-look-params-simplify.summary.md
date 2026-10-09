# 261010 视向参数精简与增益语义修正 · 实施总结

## 一、做了什么

| 需求 | 结果 |
|---|---|
| 删除 `3D 空间变换` | 删除滑条组、`transform3dRange`/`transform3dCamGain`/`transform3dGyroGain`、`compute3dTransform()`/`Transform3dResult`，以及 `view.tsx` 中每帧给舞台 canvas 写 CSS perspective 的整段逻辑（连同只为它服务的 `camSm`/`gyroSm` 平滑） |
| 删除 `眉毛上下联动` | 删除 `browGain` 滑条与 `ParamBrowLY/RY` 写入 |
| 删除 `眼球形变联动` | 删除 `eyeBallFormGain` 滑条与 `ParamEyeBallForm` 写入 |
| 位移增益默认 -2 | `camPanGain` / `gyroPanGain` 默认 -2；滑条范围 -1..1 → -3..3 |
| 视线系数「眼和头身分开」 | 新增 `camEyeGain` / `gyroEyeGain`，与 `camAngleGain`/`gyroAngleGain`（头+身）独立驱动眼球 |
| 「0.005 和 0.1 没区别」 | 见下节根因与修法 |

## 二、根因与修法（本次核心）

`mixLookChannel` 原本把增益当**归一化混合权重**（分母 `|camGain| + |gyroGain|`）。只有一个源在线时：

```
result = (dx · camGain) / |camGain| = dx · sign(camGain)
```

增益的绝对值被约掉，只剩符号 → `0.005`、`0.1`、`1` 完全等效；用户想「调细」时无论填多小都没反应。（位移通道走 `applyTransform` 直接相乘，是这个 bug 唯一的例外，所以位移一直是线性的。）

修法：增益改为**带符号振幅倍率**，两路 `输入 × 增益` 相加后饱和到 ±1。

- 单源时严格线性：`0.005` 就是 0.5% 幅度。
- 符号语义保留：负值反向，`0` = 该源不参与。
- 两源同开时相加；饱和保证 `angleRange`/`rollRange`/`panRange` 仍是硬上限，滑条标签「最大……」保持诚实。
- 顺带修掉显示层：滑条读数此前固定保留 2 位小数，`0.005` 会显示成 `0.01`，`trimNumber()` 改为按量级自适应精度（<0.01 保留 6 位并去尾零）。

## 三、默认值

| 键 | 旧 | 新 |
|---|---|---|
| `camPanGain` / `gyroPanGain` | 0.20 / 0.45 | **-2 / -2** |
| `camAngleGain` / `gyroAngleGain` | 1.0 / 0.55（旧语义=满幅） | 0.6 / 0.5 |
| `camEyeGain` / `gyroEyeGain` | —（旧为满幅） | 0.4 / 0.4 |
| `camRollGain` / `gyroRollGain` | 1.0 / 1.0 | 1.0 / 1.0（不变） |
| `panRange` / `angleRange` / `rollRange` / `bodyZGain` | 0.10 / 8 / 5 / 0.4 | 不变 |

滑条存储键 `lv-look-params-v1` → `lv-look-params-v2`：旧值在新语义下含义不同（用户存过的 0.005 旧语义=满幅、新语义≈冻结），不迁移、直接回到新默认值。

面板最终 12 条滑条：摄像头 4（转头/眼球/旋转/位移）、陀螺仪 4、整体幅度 3、扩展可动性 1（身体侧倾联动）。第三人称双模型下「对视停用」集合 4 → 6（加 2 个眼球增益）。

## 四、验证

跑了：

- `npm run typecheck` —— 通过。
- `npm run build` —— `lib/{index,client,standalone}.js` 重建；产物里已无 `transform3d`、含 `camEyeGain` 与 `lv-look-params-v2`。
- `node e2e/verify-look-math.mjs` —— 17/17 通过，新增断言直接锁住本次修复（小增益线性、单源不再归一化、负增益镜像、两源相加饱和、删掉的键不存在、预设键集合与默认一致）。

没跑（按 e2e 铁律，含真实 API 的套件默认不跑）：

- `e2e/verify-look-sliders.mjs` —— 面板契约断言已按新结构同步（行数 11、增益 8、顺序含眼球、停用 6、位移 -3..3、标准预设新默认值、存储键 v2），但它需要真实会话轮次，本次未执行；面板与观感交由用户实机确认（见 validation 文档）。

## 五、检视

`docs/features/261010-look-params-simplify/261010-look-params-simplify.review.md` —— 结论 **准入**，无阻塞问题。唯一建议 S-01（极小数 `<0.0001` 显示精度）已采纳：`trimNumber` 对 `<0.01` 改用 6 位小数。

## 六、遗留

- `src/client/param-ids.ts`（另一 agent 在途改动）仍保留 `eyeBallForm` / `browLY` / `browRY` 的 ID 解析条目——驱动侧已不再消费，属无害惰性映射；等该分支稳定后另行清理，本次不动他人的未提交改动。
- `verify-look-sliders.mjs` 仍走「真实会话 + Live2D tab」入口（会烧一轮 LLM）；按既有 backlog，后续可迁移到 `POST /live2d-voice/session` + `/live2d-voice/app?session=` 的零 API 入口。
- 升级后若页面未热重载，需刷新一次；旧代码留下的舞台 `style.transform` 不刷新不会自动清除（本次未加一次性清理代码，靠刷新解决）。
