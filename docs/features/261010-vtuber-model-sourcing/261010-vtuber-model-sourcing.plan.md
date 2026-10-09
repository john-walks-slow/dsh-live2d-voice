# 261010 为「自己玩」补充 Live2D 形象：模型获取与可用性治理

## 一、需求原文理解

> 「全网搜刮真的适合用于这个项目玩耍的模型（不是随包发布，而是自己玩）。官方那些角色不够吸引人；游戏解包很多视线/嘴型/动画不是为这种用途设计的。最好是那种免费 VTuber 皮，或许那是最适合的？」

拆成三条：
1. **用途**：本机个人自用（`/root/.dsh/live2d-voice-models/`），不随插件发布、不再分发、不商用。
2. **痛点**：现有 75 个模型两头都不讨好——官方样例"不好看"，游戏拆包"驱动不上/不像活的"。
3. **假设**：免费 VTuber 皮（VTube Studio 生态的完整绑定模型）可能最适合；需要验证并落地。

## 二、现状证据（本次实测，非推断）

用新写的体检器 `tools/scan-model-params.cjs` 扫全库 69 个 moc3 模型（含读取 moc3 版本字节 + Cubism Core 参数表 + 每参数 min/max）：

- **适配分 ≥10/15 的只有 29 个**；`game-fantastic-days`（素晴日）11 个模型**全军覆没**（适配分 2）。
- 根因不是"画得不好"，而是**参数 ID 对不上**：
  - 插件把参数 ID 按**文件格式**硬编码（moc2 → `PARAM_ANGLE_X`，moc3 → `ParamAngleX`，`src/client/model.ts:374-401`）。
  - 但大量 **moc3 模型用的是旧版大写 ID**（素晴日全 11 个、官方 tsumiki / chitose / epsilon / hibiki / izumi / haru-classic / miku / shizuku / unitychan / tororo …）。
  - 实测：**26 个模型补齐别名解析后即可完全驱动**（眼/头/身/口全齐，仅 ID 大小写不同）。另有 5 个（GFL 的 `ParamEyeX/ParamX` 命名）需要一张小别名表。
- 结论：**"游戏拆包不好玩"里，有相当一部分是插件的可修缺陷，不是素材的原罪。**

另：内置 Cubism Core 实测 `MocVersion_50 = 5`（5.1.0），**moc3 v6（Cubism 5.3 导出）无解**，官方免费素材 Ren 即因此排除。

## 三、调研结论（两份深度调研已归档）

- `docs/research/261010-free-vtuber-models-jp-en.research.md`
- `docs/research/261010-free-vtuber-models-cn.research.md`

要点：
1. **免费 VTuber 皮确实存在且量不小**：BOOTH 免费 Live2D 模型实测 **799 件**；VTube Studio Steam Workshop 1,233 条目（模型类 452）。但免费池里"完整绑定"的约十之一二，必须逐个体检 + 读条款。
2. **VTS 皮与插件天然契合**：VTS 面捕驱动的就是 `ParamAngleX/Y/Z`、`ParamEyeBallX/Y`、`ParamMouthOpenY`、`ParamBodyAngle*` 这套标准 ID，正是插件写死的那套。**比游戏拆包契合度高得多** → 用户的假设成立。
3. **获取闸门**：BOOTH 免费件下载 **302 → pixiv 登录**；ENRAI 需注册；Steam Workshop 需 Steam 客户端 / x86_64 SteamCMD（本机 aarch64 无官方二进制）；Live2D 官网样例与 GitHub 可直连。
4. **中文圈没有"免费皮套库"**：供给碎片化在 B站工房/UP 主配布/网盘/QQ 群；「公皮」是量贩不是免费。免费完整皮最集中的一手来源仍是 BOOTH。
5. **最佳长期解**：`see-through`（单图拆层）→ `psd2live` / Stretchy Studio（自动绑定，输出标准 `Param*` 的 moc3）→ 自有画风、许可干净。插件只需要"头/身/眼/口/眉"这一薄层，绑定深度要求远低于直播 VTuber。

## 四、交付物与用户路径

### 用户视角（最终要有的体验）

打开设置页 → 模型列表多出一个 **「VTuber（免费配布）」** 分类 → 挑一个好看的角色 → 视线跟随摄像头、说话时嘴动、头部随人转。想要更多时，有一条**能自己再跑**的补充通道。

### 交付物

| # | 交付物 | 说明 |
|---|---|---|
| D1 | 模型体检器 `tools/scan-model-params.cjs` | 已可用：moc3 版本 + 参数覆盖 + 动作/表情/物理 → 适配度表 + JSON。作为**入库闸门**，后续任何模型先过它 |
| D2 | 全库体检报告 | 现有 75 个模型的适配度矩阵（哪 29 个能玩、哪 26 个修完能玩、哪些废） |
| D3 | **插件参数别名解析** | 让 moc3 里的大写/别名 ID 也能驱动 → 直接救活 26 个现有模型（含素晴日全员） |
| D4 | 免费皮短名单 + 批量下载器 | 抓 BOOTH 免费池元数据，按"完整绑定/标准参数/许可"筛出短名单；下载器登录后一键批量拉取 |
| D5 | 无登录直接可取的模型 | GitHub 自制 moc3 等，体检合格则入库 |
| D6 | 入库与文档 | 新分类目录 + `CATALOG.md` 增补（来源/许可/体检结论） |

### 用户路径

- **主路径（现在就能自己玩）**：D3 合入后，素晴日 / 官方大写 ID 模型点开即活。
- **补充路径 A（需要一次登录）**：用户在 noVNC 里登录 pixiv → 跑 `tools/booth-fetch.cjs` → 自动下载短名单 → 自动体检 → 入 `vtuber-free/`。
- **补充路径 B（无登录）**：直接 `git clone` 自制模型仓库 / 官网直链，过体检器入库。
- **长期路径（可选）**：see-through + psd2live 用自己的图做专属皮。

## 五、实现方案

### 5.1 体检器（D1，已完成原型）

`/root/.dsh/live2d-voice-models/tools/scan-model-params.cjs`
- 走 vm 沙箱加载插件自带的 `assets/cubism4/live2dcubismcore.min.js`（等待 wasm 初始化），逐个 moc3 取参数表与 min/max/default。
- 打分项：视线 3 / 头部朝向 2 / 侧倾 1 / 身体 1 / 口型 2 / 眉毛 1 / 眼球形变 1 / 物理 1 / 表情 1 / 动作 1 = 15。
- 输出 markdown 表 + `model-scan.json`。
- 待补：moc2 分支（用 `assets/cubism2/live2d.min.js`，或仅标注"未扫描"）、CDI3 交叉校验。

### 5.2 插件参数别名解析（D3）

问题定位：`src/client/model.ts` 的 `LOOK_IDS` 在渲染器 bind 时按 `kind`（moc3/moc2）二选一硬编码；模型实际 ID 是 `PARAM_ANGLE_X` 时全部写空。

方案：bind 后**从模型实际参数表解析一次 ID**，而不是按格式猜。

```ts
// coreModel 上已有 getParameterIndex(id): number（pixi-live2d-display Cubism4Model）
const pick = (candidates: string[]): string | null =>
  candidates.find((id) => core.getParameterIndex(id) >= 0) ?? null;
```
- 别名表**只收"同一语义的两个标准写法"**：`ParamAngleX|PARAM_ANGLE_X`、`ParamEyeBallX|PARAM_EYE_BALL_X`、`ParamMouthOpenY|PARAM_MOUTH_OPEN_Y`、`ParamBodyAngleX|PARAM_BODY_ANGLE_X` …。
- **不收** `ParamX/ParamY/ParamEyeX` 这类通用短名（碰撞风险高，收益仅 5 个 GFL 模型）——放弃这批，不做模型名白名单。
- 解析不到时**保持现状**（= 不写入），不引入降级行为差异。
- 口型：`motionManager.lipSyncIds` 优先，其次同样按别名表解析（修掉大写 moc3 无 LipSync 组时的静默失败）。
- 缓存语义：**每次 bind（模型加载/切换）解析一次**，存在该模型实例的闭包里；换模型即重新解析，不存在全局缓存错位。
- **红线：现有 29 个可玩模型一个都不能退化**（回归 e2e 覆盖 camelCase 路径）。

影响面：仅 `src/client/model.ts`（+ 可能 `types`），不动物理/动作/布局逻辑。

> 定位说明：这是"顺手盘活存量资产"，**不计入"找到了好皮"的交付成果**；参数能驱动 ≠ 好看、像活的。

### 5.3 BOOTH 短名单与按需下载（D4）

**不做全量批量下载**（799 件里完整绑定仅十之一二，且选皮是审美行为）。

1. `tools/booth-crawl.cjs`：抓 `booth.pm/ja/search/Live2D モデル?max_price=0`（**无需登录**）→ item id / 标题 / 作者 / 缩略图 / **画布尺寸、是否 follow-gated、导出 SDK 版本（决定 moc3 版本，v6 判废）** / 条款关键词（`再配布/改変/商用/AI`）。
2. 产出 `shortlist.md` + **带缩略图的预览页**（本地 HTML），供用户勾选 10~20 个。
3. `tools/booth-fetch.cjs`：只下勾中的条目。读会话 cookie（运行时导出，**不落 git、不内嵌凭据**；cookie 会过期，**每次运行前提示重新登录**）→ `GET /downloadables/<id>?variation_id=<vid>` → 解包 → 体检 → 合则入 `vtuber-free/<name>/`。
4. 登录：用户到 noVNC（`https://vnc.johnnren.qzz.io/vnc.html`）完成一次 pixiv 登录。

### 5.5 下载物不入 git

模型库在 `/root/.dsh/live2d-voice-models/`（非 git 仓库）；仓库内新增的工具脚本与短名单产物中，**下载物与 cookie 一律写进 `.gitignore`**。

### 5.4 入库规范（D6）

- 新分类目录 `vtuber-free/`（二级目录 = 一个模型，含恰好一个 `.model3.json`），沿用 `CATALOG.md` 的"来源 / 许可 / 体检记录"体例。
- 许可红线：**仅本机个人自用，禁止再分发**；每个模型在 CATALOG 里逐条记原始 URL + 条款要点。

## 六、验证方案

1. **单元级**：体检器对已知样本的判定正确（haru=14、素晴日=2、tsumiki 别名后=满配）。
2. **e2e（headless chromium，无真实 API）**：
   - 新用例 `e2e/verify-param-alias.mjs`：加载大写 ID 模型（tsumiki）与常规模型（hiyori），注入 look 驱动后**回读参数值**，断言两者都被写入；回归断言常规模型不受影响。
   - 新模型入库后跑 `verify-model-load`：路由 200 + 渲染无缺件 + 参数被实际写入。
   - 遵守 e2e 规范：模块化隔离、零真实 API（TTS/LLM 一律 mock）。
3. **用户验证**：给出 2-3 个推荐模型的截图对照（修复前/后视线与口型差异）。

## 七、风险与边界

| 风险 | 处置 |
|---|---|
| BOOTH 下载需 pixiv 登录 | 短名单与下载器先做好；登录只需一次，之后可批量 |
| Steam Workshop 本机 aarch64 无法跑 SteamCMD | 备选：经电脑侧（pc-link）下载后回传；本轮不阻塞主线 |
| 免费皮里"完整绑定"比例低 | 体检器前置过滤 + 短名单人工过条款 |
| moc3 v6（Cubism 5.3）不可用 | 体检器直接判废；购买/下载前先看导出 SDK 版本 |
| 大画布（如 7000×9000）显示偏小/偏移 | 短名单标注画布尺寸；必要时调 stage 默认缩放 |
| 多 agent 并行改仓库 | 只改 `src/client/model.ts` + 新增 e2e 用例；提交走 commit-own-changes |

## 八、分阶段实施（按 auto-human 决议排序）

- **Phase 1a（最先）**：插件参数别名解析 + 回归 e2e（camelCase 不退化 + 大写 ID 生效）。先拿到用户可见收益，也才能分辨"素材不行"还是"插件不行"。
- **Phase 1b（1a 之后）**：体检器定稿（含 moc2 分支或明确标注"未扫描"）+ 全库报告 + BOOTH 短名单抓取脚本。
- **Phase 2（前置验证优先）**：Steam Workshop 路线——**先花 10 分钟在与本机同局域网的 Windows 电脑上验证**：① Steam 是否已登录；② VTS Workshop 模型包解开是否为标准 `.model3.json + .moc3`（而非 VTS 私有封装）。验证通过才投入。**优先级高于 Phase 4**（那里是完整绑定的标准 `Param*` 皮，命中率最高）。
- **Phase 2b（自主）**：无登录可得模型入库（GitHub 自制 moc3 等），过体检。
- **Phase 3（需用户一次介入）**：pixiv 登录 → 用户勾选短名单 10~20 个 → 按需下载 → 体检入库 → CATALOG 增补。
- **Phase 4（可选，长期）**：see-through + psd2live 自制专属皮评估。

> Phase 1a/1b 完成后即可明显改善"自己玩"的体验；Phase 2/3 才引入真正意义上的"VTuber 皮"。
