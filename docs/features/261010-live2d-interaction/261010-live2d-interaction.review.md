# 检视报告

## 概要

检视范围为 worktree `feat/live2d-interaction` 提交 `c90c23a`，涵盖点击互动判定与动作触发、动作音效摘除、空闲调度器音频门控修复与节奏收紧、e2e 测试及相关文档。整体实现思路精准针对此前 `currentSpeaker()` 永久为真阻断空闲、动作自带音效劫持语音等历史暗病，手势与命中判定设计清晰，测试用例与契约完善。

## 需求对齐

- **点击互动**：满足。结合 8px 位移与 500ms 时长判定 tap，命中 HitAreas（优先 `Tap<Area>`，回退 `Tap`/`TapBody`）及无 HitAreas 时的包围盒回退，以 NORMAL 优先级播放（不打断 NORMAL/FORCE）。
- **动作音效抑制**：满足。在 `mountModel` 阶段直接从 `internalModel.motionManager.definitions` 摘除 `Sound` 属性，彻底阻断框架静默拉取并播放本地 wav 文件。
- **空闲调度与节奏**：满足。将判断语音活跃状态从 `currentSpeaker()` 改为 `engine.speaking()`，彻底救活空闲调度；无 `Idle` 组时收敛至最多 6 秒，空闲动作优先级降为 `idle`。
- **与计划差异**：无偏差与过度设计，边界处理符合预期（不带表情/音效反馈，Flick/Shake 与 Cubism 升级留待后续）。顺带修复了 `scripts/init-worktree.sh` 的冲突标记。

## 阻塞问题

无

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1  | [model.ts:859-860](.worktrees/live2d-interaction/src/client/model.ts#L859-L860) | 实例销毁清理遗漏 `dataset.lvTap` / `dataset.lv${tag}Tap`：在 `destroy()` 时清理了 `lvTransform` 和 `lvParamIds`，但未清理 `lvTap`。在双模型或模型切换场景下，旧模型的 tap 状态会残留在 DOM 上，影响后续交互观察或测试断言。 | 在 `destroy()` 中对称添加 `delete container.dataset.lvTap;` 以及当 tag 存在时 `delete container.dataset[\`lv${tag}Tap\`];`。 |
| S2  | [view.tsx:753-754](.worktrees/live2d-interaction/src/client/view.tsx#L753-L754) | 空闲调度器目前仅针对主模型 `modelRef` 运行，双人（第三人称）模式下玩家模型 `playerModelRef` 始终处于无空闲动作状态。 | 在第三人称模式且存在玩家模型时，空闲调度亦可考虑为 `playerModelRef` 触发相应空闲动作，或在模块设计文档/注释中明确声明玩家模型暂时不纳入独立空闲调度。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1  | [model.ts:549-550](.worktrees/live2d-interaction/src/client/model.ts#L549-L550) | `model.hitTest(x, y)` 返回数组可能包含多个命中的 area（例如重叠的 Head 与 Body），当前直接硬编码取首项 `names[0]`。虽可满足绝大多数模型，但若层级靠前者命中无对应的 Tap 动作组，可能会错失后续有动作组的 area。 | 后续如遇复杂多 HitArea 模型，可在 `names` 中逐个尝试 `tapGroupFor(name)` 找到首个存在动作组的区域。 |
| N2  | [model.ts:430-432](.worktrees/live2d-interaction/src/client/model.ts#L430-L432) | 摘除音效时只清理了 `definitions`，未清理原始 `settings.motions` 对象。虽然框架运行时 `MotionManager` 直接消费 `definitions` 且实测已完全拦截请求，但若未来有其他模块从 `model.internalModel.settings` 读取音效配置，数据可能不一致。 | 备忘：若未来新增外部访问 `settings` 的逻辑，需注意此处差异。 |

## 准入结论

**结论**：`准入`

**说明**：代码架构与实现清晰合理，边界与异常防护充分，契约与 e2e 验证完善，彻底解决了此前空闲调度休克与动作音效串音的重大历史问题。建议修改项不影响核心功能与主流程，可合并入主线。
