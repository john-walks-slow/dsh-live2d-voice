# 261010 为「自己玩」补充 Live2D 形象：模型获取与可用性治理 · 总结

> 计划：[261010-vtuber-model-sourcing.plan.md](261010-vtuber-model-sourcing.plan.md)
> 体检矩阵：[261010-model-suitability.md](261010-model-suitability.md)
> 调研：[JP/EN](../../research/261010-free-vtuber-models-jp-en.research.md)、[中文圈](../../research/261010-free-vtuber-models-cn.research.md)
> 检视：[261010-vtuber-model-sourcing.review.md](261010-vtuber-model-sourcing.review.md)（准入）
> 验收：[261010-param-alias.validation.md](261010-param-alias.validation.md)（首轮不通过 → 修复后复验通过）

## 一、需求与结论

用户诉求：为「自己玩」找真正适配这套实时驱动的模型（不随包发布）；官方样例不好看，游戏拆包驱动不上；怀疑免费 VTuber 皮才是答案。

**调研结论：怀疑成立。** VTube Studio 生态的皮就是被面捕驱动 `ParamAngleX/Y/Z`、`ParamEyeBallX/Y`、`ParamMouthOpenY` 这套标准 ID 的，与插件写死的那套同源；而游戏拆包/旧版移植模型大量使用非标准写法。规模实测：BOOTH 免费 Live2D 模型 846 件候选（本次抓到 846，短名单 515，预览 60），VTS Steam Workshop 模型类 452 个。**免费≠能下载**：BOOTH 免费件下载需 pixiv 登录（匿名 302 → `/users/sign_in`），Workshop 需 Steam 客户端/SteamCMD（本机 aarch64 无官方二进制）。

## 二、交付物状态

| # | 交付物 | 状态 |
|---|---|---|
| D1 | 模型体检器 `tools/scan-model-params.cjs`（moc3 走 Cubism Core 读真实参数表，moc2 走 `.moc` 标识符扫描） | ✅ 完成 |
| D2 | 全库体检报告（75 个模型矩阵，含评分口径与 13 个不可驱动模型的原因） | ✅ 完成 |
| D3 | **插件参数别名解析**（按模型真实参数表解析 ID） | ✅ 完成并验收 |
| D4 | BOOTH 短名单抓取 + 自包含预览页；按勾选下载入库器 | ✅ 完成（下载待登录态） |
| D5 | 无登录可得模型（GitHub 自制 moc3） | ⏸ 已评估未入库（业余水准、无正式许可，价值低于免费池；清单见调研报告 P3） |
| D6 | 入库/文档（CATALOG 增补、CHANGELOG、模块 AGENTS.md） | ✅ 完成（`vtuber-free/` 待 Phase 3 落盘） |

## 三、D3 实施记录（本次唯一的代码改动）

问题：`src/client/model.ts` 按**文件格式**猜参数拼写（moc3→camelCase、moc2→UPPER_SNAKE），而 27 个 moc3 模型（含全部 11 个素晴日拆包）用大写命名 → 视线/头部/口型全部静默失效。

改动：
- 新增 `src/client/param-ids.ts`：标准参数别名表 + `resolveParamIds(kind, has)` 纯函数；**只收官方两种拼写**，不收 `ParamX/ParamEyeX` 这类自定义短名（碰撞风险 > 收益）。
- `model.ts`：绑定模型时按真实参数表解析一次；诊断契约 `dataset.lvParamIds` 与双模型 per-tag `lv{Ai,Player}ParamIds`（destroy 清理）。
- **moc2 不探测**：Cubism 2.1 core 无可枚举参数表，且 `getParamIndex()` 对未声明 id 也发幻影索引（实测首个未知 id 返回索引 == 真实参数总数），探测必然假阳性 → moc2 沿用大写默认（首轮验收正是被这条打死，已修复并复验）。
- 回归套件 `e2e/verify-param-ids.mjs`（纯解析 5 项 + 真实页面 3 个模型 + 无 pageerror = 9/9），已挂进 `gaze` 模块。

验收证据（`261010-param-alias.validation.md`）：写入层取证显示 zongzi(moc2) 由「写进幻影 `ParamAngleX`」反转为「`PARAM_ANGLE_X` 165 次、峰值 18.00°（设计值）」；受控 A/B 像素 diff：tsumiki 4.3×、megumin 4.84%、ar15(camelCase 对照) 386×、m4a1(两种都无) 0% 阴性对照通过。

体检口径下的收益：**moc3 可驱动 29 → 56（+27）**，全库 62/75。

## 四、待用户介入（无法自动化）

1. **Phase 3 下载**：在 noVNC（`https://vnc.johnnren.qzz.io/vnc.html`）登录一次 pixiv → 勾选预览页里的模型 → 跑
   `node /root/.dsh/live2d-voice-models/tools/booth-fetch.cjs --items <id,id> --cookie-file ~/.dsh/booth-cookies.txt`
   （cookie 会过期，脚本检测到 302 即提示重新登录；凭据只从参数/环境变量读，不落产物）。
2. **Workshop 前置验证（10 分钟）**：需要那台 Windows 电脑开机（`192.168.71.90` 当前不可达）。验证两件事：Steam 是否已登录；VTS Workshop 包解开是否为标准 `.model3.json + .moc3`。通过后这条线优先级高于自制皮。

## 五、遗留与风险

- **大画布皮**（VTS 常见 7000×9000）与**场景插画型模型**（如碧蓝航线 enterprise，驱动像素差很大但观感是"整张卡片在转"）需要人工挑；体检器只能给参数面，给不了观感。
- **空闲动作稀疏**：megumin 的 29 个动作全挂在空名组，空闲调度 20s 一次 → 长时间像"会眨眼的立牌"（验收报告体验项，未改代码）。
- **投递与许可**：所有入库模型仅本机个人自用、不再分发；每条的来源与条款记入 `CATALOG.md`。
- **并行改动**：本仓库同期有另一 agent 重构 look 增益语义（未提交）。本次提交只包含 D3 相关文件，不含 `lib/`（混合构建产物）与对方文件。
