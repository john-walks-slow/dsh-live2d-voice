# 需求计划：Live2D 动作 (Motion) 支持、Idle 优化与设置面板层级改造

## 1. 需求背景与目标

当前 Live2D 语音交互存在以下问题与优化诉求：
1. **动作（Motion）处于沉睡状态**：目前只支持纯面部表情（Expression）标签，所有模型的全身时间轴动作（Motions，如摸头、打招呼、害羞、战斗动作等）均未接入。大模型不知道当前模型有哪些动作，代码中也未暴露动作播放接口。
2. **Idle 待机动画突变抽动**：底层 `pixi-live2d-display` 默认在 motion 结束后无缝随机抽取下一个 idle 动作，导致角色频繁突变抽动。需要拉长待机动作触发间隔（约 15~30 秒），平时仅保留自然呼吸（Breath）和眨眼（EyeBlink）。
3. **设置面板膨胀与交互层级优化**：
   - 模型选择：改为二级下拉菜单（【分类】+【模型】）。
   - 音色选择：改为二级下拉菜单（【语言】+【音色】）。
   - 动作调试：在模型选择器正下方新增“动作调试”折叠面板（类似陀螺仪高级参数设计，默认收起），展开后展示当前模型的所有动作按钮，支持手动点击触发播放。
4. **大模型动态动作感知与驱动**：
   - 动态向系统提示词（`system-prompt`）注入当前模型支持的全部动作标签（保留原始动作名，如 `[motion:touch_head]`）。
   - 解析模型回复中的动作标签，通过 SSE 通道派发给前端实时播放动作。

---

## 2. 详细设计与实施方案

### 模块 A：动作元数据抽取与后端支持
1. **模型配置解析 (`src/config.ts` / `src/routes.ts`)**：
   - 在加载/解析模型设置文件时（`.model3.json` / `.model.json`），提取 `Motions` / `motions` 定义中的所有可用动作，包含：
     - 动作名称/文件名（如 `touch_head`、`shake`、`main_1`、`Tap`、`sikao` 等）
     - 归属的 group（如 `Idle`、`Tap`、空 group `""` 等）与 group 内部的索引 index
   - 在 `/api/model-info` 接口返回的数据中，附带 `motions: Array<{ name: string; group: string; index: number }>`。
2. **系统提示词动态注入 (`src/system-prompt.ts`)**：
   - 读取当前选定模型的全部动作列表。
   - 在 Live2D 语音指令中增加动作说明：
     `- 你还可以控制角色的身体动作，在回复相应位置插入动作标签：[motion:xxx]（例如 [motion:touch_head]）。没有合适动作时无需添加。`
3. **流式文本动作标签解析 (`src/sentence.ts` / `src/speech.ts` / `src/player.ts`)**：
   - 新增 `extractMotionTags(text, availableMotions)`，从生成的台词中提取 `[motion:xxx]`，并将标签从朗读文本中剥离。
   - 后端通过 `hub.emit(sessionId, "motion", { utteranceId, motion: string, speaker })` 下发 SSE 事件。

### 模块 B：前端渲染与动作驱动 (`src/client/model.ts` / `src/client/view.tsx`)
1. **暴露播放动作接口 (`Live2DHandle`)**：
   - 在 `Live2DHandle` 接口中增加 `playMotion(group: string, index?: number): Promise<boolean>` 和 `getMotions(): MotionItem[]`。
   - 底层调用 `model.motion(group, index, MotionPriority.FORCE)` 触发动作。
2. **Idle 调度治理**：
   - 禁用底层无缝自动 idle 切换。
   - 建立轻量的前端 Idle 调度器：平时每帧只走自然呼吸与眨眼；当空闲时间达到 15~30 秒（随机窗口）且没有音频/用户动作交互时，才轻微随机触发一次待机动作。
3. **SSE 动作事件联动**：
   - `view.tsx` 监听 `motion` 事件，分流驱动 AI 模型或玩家模型播放相应动作。

### 模块 C：设置面板与 HUD UI 改造
1. **模型选择二级 Dropdown (`src/client/hud.tsx` & `src/client/settings-section.tsx`)**：
   - 提取分类列表：官方示例、品牌拟人、食物语、少女前线、素晴日、碧蓝航线等。
   - 第一级 Dropdown 选择分类，第二级 Dropdown 选择该分类下的具体模型。
2. **音色选择二级 Dropdown**：
   - 提取语言/声线大类：中文、日语、英语等。
   - 第一级 Dropdown 选择语言，第二级 Dropdown 选择对应音色。
3. **动作调试折叠抽屉**：
   - 紧邻模型选择器下方，使用类似体感参数的折叠设计（`lv-look-fold` / `lv-look-caret`）。
   - 默认折叠，展开后平铺显示动作按钮，点击即在画布上实时播放该动作。

---

## 3. 验证计划

1. **类型检查与构建测试**：`npx tsc --noEmit`、`node build.mjs`。
2. **静态与单元逻辑测试**：验证标签提取、动作解析、模型目录多格式兼容。
3. **E2E 交互验证**：在 e2e 实例中验证二级下拉切换、动作调试面板展开与点击、大模型回复带标签触发动作。
