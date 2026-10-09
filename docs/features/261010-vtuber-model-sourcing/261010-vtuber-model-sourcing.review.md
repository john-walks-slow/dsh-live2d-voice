# 检视报告

## 概要

检视范围为本次 VTuber 模型参数 ID 动态解析相关改动，包含 `src/client/param-ids.ts`、`src/client/model.ts`、`e2e/verify-param-ids.mjs`、`e2e/run.mjs`、`src/client/AGENTS.md` 及 `CHANGELOG.md`。整体架构轻量清晰，核心解析逻辑通过纯函数下沉隔离，基于模型真实参数表探查取代原先按文件格式硬编码，不仅彻底根治了旧版移植与游戏拆包 moc3 模型静默不驱动的顽疾，而且对现有 camelCase 资产保持完全向后兼容，工程实现质量优秀。

## 需求对齐

变更完全满足需求与计划设计（Phase 1a/D3）：
1. 实现了 `resolveParamId` / `resolveParamIds`，将两套官方拼写（camelCase 与 UPPER_SNAKE）建立映射，在两者皆有时 camelCase 优先，两者皆无时保持默认无害写入，未引入破坏性短名别名。
2. `model.ts` 中针对 moc3 与 moc2 核心对象正确探查真实参数表，避开了 Cubism4 wrapper `getParameterIndex()` 虚构索引的深坑。
3. 新增了 `dataset.lvParamIds` 诊断与 E2E 契约，补齐了双段 E2E 验证脚本并集成至 `gaze` 套件。
4. 补充了 `AGENTS.md` 避坑经验与 `CHANGELOG.md` 记录，完全契合计划约束。

## 阻塞问题

无

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-01 | [model.ts:405](src/client/model.ts#L405) | **双模型模式下 `dataset.lvParamIds` 存在覆盖竞态且卸载时未清理**<br>在第三人称（双模型同台）或视频通话（PiP）模式下，AI 与 Player 两个模型均挂载到同一个 stage `container`。当前直接写入 `container.dataset.lvParamIds = ...`，会导致后挂载的模型覆盖先挂载模型的值（last-writer-wins），并且模型销毁（cleanup）时未清理该 dataset 键，不同于 `lvAiTransform`/`lvPlayerTransform` 与 `lvPlayer` 具有清晰的 tag 区分与 cleanup 逻辑。 | 建议遵循现有 tag 契约设计：如果传入了 `tag`（如 `"Ai"` / `"Player"`），除写入共享的 `lvParamIds`（供单模型测试/诊断）外，建议同步写入 `dataset[`lv${tag}ParamIds`]`；并在模型销毁或切换时清理对应 dataset 键，避免双角色排障与测试断言时发生混淆。 |
| S-02 | [param-ids.ts:18-30](src/client/param-ids.ts#L18-L30), [model.ts:440-449](src/client/model.ts#L440-L449) | **`eyeBallForm`、`browLY`、`browRY` 已被 `model.ts` 废除但仍被解析并在 E2E 中作为前置断言**<br>根据 `CHANGELOG.md` 与 `model.ts:440-450`，近期重构已删除了「眉毛上下联动」与「眼球形变联动」，`LOOK_IDS` 实际被驱动的仅有 angleX/Y/Z、bodyX/Y/Z、eyeX/Y。目前 `STANDARD_PARAM_PAIRS` 依然解析了 `eyeBallForm`、`browLY`、`browRY`，且 `verify-param-ids.mjs:47` 强依赖了 `browRY` 存在。虽然保留解析提供了潜在扩展性，但如果某 moc3 模型缺失眉毛参数，在 `probe` 时不会受到实质影响，不过接口定义与当前驱动逻辑存在认知差异。 | 建议在 `param-ids.ts` 的注释中明确说明该 3 个参数为保留字段（当前 look 驱动未绑定但保留标准映射），或评估是否与后续表情系统联动，保持代码意图清晰。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-01 | [verify-param-ids.mjs:29](e2e/verify-param-ids.mjs#L29) | **Chromium 路径硬编码为特定版本与架构缓存**<br>`e2e/verify-param-ids.mjs` 中硬编码了 `/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`。若 playwright 版本更新或在其他容器/环境运行，该绝对路径可能失效。 | 建议优先读取环境变量（如 `process.env.CHROMIUM_PATH`），或通过常规 playwright/playwright-core 启动，仅在缺失时 fallback 到特定路径。 |
| N-02 | [param-ids.ts:70-76](src/client/param-ids.ts#L70-L76) | **`resolveParamIds` 遍历使用了双重查找与类型断言**<br>`Object.keys(STANDARD_PARAM_PAIRS)` 每次查 `STANDARD_PARAM_PAIRS[key]` 并通过 `as` 断言。 | 可直接遍历 `Object.entries(STANDARD_PARAM_PAIRS)` 进行解构，代码可读性与类型推导会更加自然。 |

## 准入结论

**结论**：`准入`

**说明**：核心功能设计严密、逻辑纯粹，完全满足需求，成功解决了 moc3 大写参数导致的驱动失效问题；无阻塞性缺陷与破坏性变更。建议修改项仅涉及双模型场景下的诊断属性命名隔离与残留类型注释，可在后续迭代中结合 tag 契约顺手优化。
