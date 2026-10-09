# 261010 模型库实时驱动适配度体检

> 体检器：`/root/.dsh/live2d-voice-models/tools/scan-model-params.cjs`（可与插件 `src/client/param-ids.ts` 同源判定）
> 明细：`tools/model-scan.json`　生成日期：2026-10-10

## 一、体检口径

插件每帧只驱动这一薄层标准参数，模型缺哪一项，对应能力就静默失效：

| 能力 | 参数（camelCase / Cubism 2.1 大写两种合法写法） | 分值 |
|---|---|---|
| 视线跟随 | `ParamEyeBallX/Y` | 3 |
| 头部朝向 | `ParamAngleX/Y` | 2 |
| 头部侧倾 | `ParamAngleZ` | 1 |
| 身体朝向 | `ParamBodyAngleX/Z` | 1 |
| 口型同步 | `ParamMouthOpenY` | 2 |
| 眉毛联动 | `ParamBrowLY/RY` | 1 |
| 眼球形变 | `ParamEyeBallForm` | 1 |
| 物理 / 表情 / 动作（≥4 个） | physics3.json / exp3 / motion3 | 各 1 |

- **moc3**：经插件自带 Cubism Core 读真实参数表（含 min/max/default）与 moc3 版本字节。
- **moc2**（Cubism 2.1）：无离线 Web Core 可跑，改为扫描 `.moc` 内标识符串，只判"参数是否存在"，范围未知（工具在表中标注 `moc2`）。
> 说明：其中「眉毛联动」「眼球形变」两项目前是**保留位**——插件当前 look 管线只写头/身/眼 + 口型（`src/client/model.ts`），这两项代表标准参数完备度，不代表现在会被驱动。
> 另：2026-10-10 期间仓库内有另一 agent 正在重构 look 增益语义（未提交），驱动集合以其最终提交为准。

- **moc3 v6（Cubism 5.3 导出）不可用**：内置 Core 5.1.0 上限 `MocVersion_50=5`，v6 直接加载失败（官方免费素材 Ren 因此长期排除）。

## 二、结论

- 全库 **75 个模型**（69 moc3 + 6 moc2），**可直接驱动（≥10/15）62 个**。
- **2026-10-10 的参数 ID 别名解析修复**（插件按模型真实参数表解析 ID，而非按文件格式猜）把 moc3 可驱动数从 **29 → 56**，一次救活 **27 个**原本"点开不动"的模型：

  - official/chitose
  - official/izumi
  - official/tsumiki
  - official/epsilon
  - official/epsilon-lite
  - official/haru-classic
  - official/hibiki
  - official/unitychan
  - game-fantastic-days/aqua
  - game-fantastic-days/aqua-priest
  - game-fantastic-days/chris
  - game-fantastic-days/darkness
  - game-fantastic-days/darkness-armor
  - game-fantastic-days/eris
  - game-fantastic-days/megumin
  - game-fantastic-days/megumin-cape
  - game-fantastic-days/wiz
  - game-fantastic-days/yunyun
  - game-fantastic-days/yunyun-casual
  - official/haruto
  - official/koharu
  - official/miku
  - official/shizuku
  - official/gantzert
  - official/hijiki
  - official/simple
  - official/tororo

  其中含全部 11 个素晴日（Konosuba）拆包模型——它们的 moc3 里用的是 Cubism 2.1 的大写 `PARAM_*` 命名。

## 三、仍不可驱动的 13 个模型

| 模型 | 分 | 缺失能力 | 备注 |
|---|---|---|---|
| game-azur-lane/enterprise | 9/15 | 头部朝向 AngleXY；身体朝向 BodyAngle | — |
| official/wanko | 8/15 | 视线 EyeBallXY | — |
| official/rice | 7/15 | 头部朝向 AngleXY；口型 MouthOpenY | — |
| official/ni-j | 4/15 | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle | — |
| official/nico | 4/15 | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle | — |
| official/nietzsche | 4/15 | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle | — |
| official/nipsilon | 4/15 | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle | — |
| official/nito | 4/15 | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle | — |
| game-girls-frontline/m16a1 | 2/15 | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle | — |
| game-girls-frontline/m4a1 | 2/15 | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle | — |
| game-girls-frontline/sopmod2 | 2/15 | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle | — |
| game-girls-frontline/type95 | 2/15 | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle | — |
| game-girls-frontline/wa2000 | 2/15 | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle | — |

- `game-azur-lane/enterprise`(9)、`official/wanko`(8)、`official/rice`(7)：只差一两项（动画/表情/某个朝向轴），近似可用。
- 5 个少女前线（m4a1/sopmod2/type95/wa2000/m16a1）：参数名是 `ParamX/ParamEyeX` 这类自定义短名，**有意不做自动别名**（碰撞风险高于收益）。
- 5 个官方 moc2 系二头身（nito/nico/ni-j/nipsilon/nietzsche）：moc2 结构自身缺项。

## 四、完整体检表

| 模型 | 格式 | moc3 版本 | 参数数 | 适配分 | 动作 | 表情 | 物理 | 缺失 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
|---|---|---|---|---|---|---|---|---|---|
| brand/deepseek-chan | moc3 | 1 | 42 | 14/15 | 5 | 8 | ✓ | — |  |
| game-ripped-food/fotiaoqiang | moc2 | moc2 | - | 14/15 | 4 | 6 | ✓ | — |  |
| game-ripped-food/sixiwangzi | moc2 | moc2 | - | 14/15 | 4 | 6 | ✓ | — |  |
| game-ripped-food/zongzi | moc2 | moc2 | - | 14/15 | 4 | 6 | ✓ | — |  |
| official/chitose | moc3 | 3 | 33 | 14/15 | 4 | 7 | ✓ | — |  |
| official/haru | moc3 | 1 | 42 | 14/15 | 5 | 8 | ✓ | — |  |
| official/izumi | moc3 | 3 | 30 | 14/15 | 10 | 7 | ✓ | — |  |
| official/natori | moc3 | 1 | 96 | 14/15 | 8 | 11 | ✓ | — |  |
| official/tsumiki | moc3 | 3 | 46 | 14/15 | 23 | 10 | ✓ | — |  |
| game-ripped-food/jiaozi | moc2 | moc2 | - | 13/15 | 3 | 5 | ✓ | — |  |
| game-ripped-food/lonjingxiaren | moc2 | moc2 | - | 13/15 | 5 | 7 | ✓ | — |  |
| game-ripped-food/qingtuan | moc2 | moc2 | - | 13/15 | 9 | 0 | ✓ | — |  |
| official/epsilon | moc3 | 3 | 37 | 13/15 | 15 | 8 | ✓ | — |  |
| official/epsilon-lite | moc3 | 3 | 30 | 13/15 | 15 | 8 | ✓ | — |  |
| official/haru-classic | moc3 | 3 | 33 | 13/15 | 23 | 0 | ✓ | — |  |
| official/hibiki | moc3 | 3 | 25 | 13/15 | 5 | 6 | ✓ | — |  |
| official/unitychan | moc3 | 3 | 39 | 13/15 | 16 | 0 | ✓ | — |  |
| official/zundamon | moc3 | 5 | 90 | 13/15 | 23 | 32 | ✓ | — |  |
| game-azur-lane/atago | moc3 | 1 | 182 | 12/15 | 14 | 0 | ✓ | — |  |
| game-azur-lane/ayanami | moc3 | 1 | 261 | 12/15 | 15 | 0 | ✓ | — |  |
| game-azur-lane/belfast | moc3 | 1 | 166 | 12/15 | 15 | 0 | ✓ | — |  |
| game-azur-lane/bismarck | moc3 | 1 | 205 | 12/15 | 15 | 0 | ✓ | — |  |
| game-azur-lane/eugen | moc3 | 2 | 358 | 12/15 | 15 | 0 | ✓ | — |  |
| game-azur-lane/taihou | moc3 | 1 | 189 | 12/15 | 15 | 0 | ✓ | — |  |
| game-azur-lane/unicorn | moc3 | 1 | 248 | 12/15 | 14 | 0 | ✓ | — |  |
| game-azur-lane/zeppelin | moc3 | 1 | 152 | 12/15 | 15 | 0 | ✓ | — |  |
| game-fantastic-days/aqua | moc3 | 2 | 103 | 12/15 | 32 | 0 | ✓ | — |  |
| game-fantastic-days/aqua-priest | moc3 | 2 | 100 | 12/15 | 32 | 0 | ✓ | — |  |
| game-fantastic-days/chris | moc3 | 2 | 101 | 12/15 | 27 | 0 | ✓ | — |  |
| game-fantastic-days/darkness | moc3 | 2 | 97 | 12/15 | 26 | 0 | ✓ | — |  |
| game-fantastic-days/darkness-armor | moc3 | 2 | 101 | 12/15 | 26 | 0 | ✓ | — |  |
| game-fantastic-days/eris | moc3 | 2 | 101 | 12/15 | 26 | 0 | ✓ | — |  |
| game-fantastic-days/megumin | moc3 | 2 | 102 | 12/15 | 29 | 0 | ✓ | — |  |
| game-fantastic-days/megumin-cape | moc3 | 2 | 102 | 12/15 | 29 | 0 | ✓ | — |  |
| game-fantastic-days/wiz | moc3 | 2 | 99 | 12/15 | 25 | 0 | ✓ | — |  |
| game-fantastic-days/yunyun | moc3 | 2 | 99 | 12/15 | 27 | 0 | ✓ | — |  |
| game-fantastic-days/yunyun-casual | moc3 | 2 | 99 | 12/15 | 24 | 0 | ✓ | — |  |
| game-girls-frontline/vector | moc3 | 3 | 42 | 12/15 | 12 | 0 | ✓ | — |  |
| official/haruto | moc3 | 3 | 51 | 12/15 | 11 | 0 | ✓ | — |  |
| official/hiyori | moc3 | 3 | 70 | 12/15 | 10 | 0 | ✓ | — |  |
| official/kei | moc3 | 5 | 31 | 12/15 | 4 | 0 | ✓ | — |  |
| official/kei-lite | moc3 | 5 | 27 | 12/15 | 4 | 0 | ✓ | — |  |
| official/koharu | moc3 | 3 | 52 | 12/15 | 11 | 0 | ✓ | — |  |
| official/mao | moc3 | 5 | 132 | 12/15 | 8 | 8 | ✓ | 口型 MouthOpenY |  |
| official/mark | moc3 | 3 | 21 | 12/15 | 6 | 0 | ✓ | — |  |
| official/miku | moc3 | 3 | 30 | 12/15 | 8 | 0 | ✓ | — |  |
| official/miku-pro | moc3 | 3 | 59 | 12/15 | 8 | 0 | ✓ | — |  |
| official/shizuku | moc3 | 3 | 45 | 12/15 | 4 | 0 | ✓ | 身体朝向 BodyAngle |  |
| game-azur-lane/laffey | moc3 | 1 | 175 | 11/15 | 14 | 0 | ✓ | 头部侧倾 AngleZ |  |
| game-azur-lane/takao | moc3 | 5 | 275 | 11/15 | 111 | 0 | ✓ | — |  |
| game-girls-frontline/g41 | moc3 | 3 | 45 | 11/15 | 12 | 0 | ✓ | — |  |
| game-girls-frontline/hk416 | moc3 | 3 | 54 | 11/15 | 12 | 0 | ✓ | — |  |
| official/miara | moc3 | 3 | 138 | 11/15 | 3 | 0 | ✓ | — |  |
| game-azur-lane/shinano | moc3 | 2 | 308 | 10/15 | 17 | 0 | ✓ | 身体朝向 BodyAngle |  |
| game-girls-frontline/ar15 | moc3 | 3 | 45 | 10/15 | 1 | 0 | - | — |  |
| game-girls-frontline/g11 | moc3 | 3 | 40 | 10/15 | 1 | 0 | - | — |  |
| game-girls-frontline/g36 | moc3 | 3 | 43 | 10/15 | 1 | 0 | - | — |  |
| game-girls-frontline/ump45 | moc3 | 3 | 49 | 10/15 | 1 | 0 | - | — |  |
| official/gantzert | moc3 | 3 | 74 | 10/15 | 6 | 0 | - | — |  |
| official/hijiki | moc3 | 3 | 31 | 10/15 | 9 | 0 | ✓ | 身体朝向 BodyAngle |  |
| official/simple | moc3 | 3 | 24 | 10/15 | 1 | 0 | - | — |  |
| official/tororo | moc3 | 3 | 31 | 10/15 | 9 | 0 | ✓ | 身体朝向 BodyAngle |  |
| game-azur-lane/enterprise | moc3 | 2 | 271 | 9/15 | 30 | 0 | ✓ | 头部朝向 AngleXY；身体朝向 BodyAngle |  |
| official/wanko | moc3 | 1 | 25 | 8/15 | 5 | 0 | ✓ | 视线 EyeBallXY |  |
| official/rice | moc3 | 3 | 96 | 7/15 | 4 | 0 | ✓ | 头部朝向 AngleXY；口型 MouthOpenY |  |
| official/ni-j | moc3 | 2 | 66 | 4/15 | 21 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle |  |
| official/nico | moc3 | 2 | 66 | 4/15 | 21 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle |  |
| official/nietzsche | moc3 | 2 | 66 | 4/15 | 21 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle |  |
| official/nipsilon | moc3 | 2 | 66 | 4/15 | 21 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle |  |
| official/nito | moc3 | 2 | 66 | 4/15 | 21 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；身体朝向 BodyAngle |  |
| game-girls-frontline/m16a1 | moc3 | 3 | 27 | 2/15 | 1 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle |  |
| game-girls-frontline/m4a1 | moc3 | 3 | 35 | 2/15 | 1 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle |  |
| game-girls-frontline/sopmod2 | moc3 | 1 | 33 | 2/15 | 1 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle |  |
| game-girls-frontline/type95 | moc3 | 3 | 40 | 2/15 | 3 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle |  |
| game-girls-frontline/wa2000 | moc3 | 3 | 39 | 2/15 | 1 | 0 | - | 视线 EyeBallXY；头部朝向 AngleXY；头部侧倾 AngleZ；身体朝向 BodyAngle |  |
