# 视频通话模式总结

日期：2026-09-27 ｜ 分支 `feat/video-call-mode`（基于 6ae6ea5）｜ 版本 1.6.0

## 结果

Live 舞台从「第一人称 / 第三人称」两态升级为 `liveMode: "first" | "third" | "call"` 三态。视频通话模式 = 第一人称的直达管线 + 玩家化身小窗（PiP）：口型随麦克风、头眼随视线追踪、可拖拽吸附角落。29 项新 e2e + 35 项第三人称回归全绿，typecheck/build 干净。

## 关键决策回顾

1. **配置直接换代不做双字段兼容**：`thirdPerson: boolean` → `liveMode` 字符串，`loadConfig` 一行迁移 + `delete` 清除遗留键。避免长期背两个字段的读写分支。
2. **管线零新增**：call 输入路径 == first（`submitText` 只在 `third` 分流，`PlayerPipeline.process` 自守卫）。视频通话没有引入任何新的消息管线，只有"画面"变了。
3. **小窗复用共享 Pixi Application**：不新开 WebGL context（Cubism WebGLManager 单例铁律），用 Graphics 圆角矩形 mask 裁剪到窗内；窗框/名牌/拖拽全在 DOM 覆盖层——拖拽天然不与舞台手势冲突。
4. **填充式取景**：模型按窗宽缩放、顶部锚定窗内 10%，半身像构图，不挑模型的全身/半身形态。
5. **look 位移通道对小窗归零**：舞台 pan（用户拖拽 AI 那只手）不会把小窗模型拖出 mask；转头/侧倾保留，跟随感不丢。

## 踩坑记录

- React 18 批处理下同一 `evaluate` 里连续 dispatch pointermove + pointerup，事件处理器读到的是 stale ref——move 与 up 必须分两次 `ev()` 中间 sleep（已固化在 e2e 脚本）。
- 合成 pointer 事件上调 `setPointerCapture` 抛 NotFoundError——view.tsx 用 try/catch 包裹（有注释说明）。
- PiP 吸附断言不能钉死像素值（浮点/亚像素抖动），用边界带 `|top-(sh-h-12)|<30`。
- 页面残留的会话视图态会让 Live2D tab 首次点击落空（T0b 曾瞬态失败一次，重跑即绿）——boot 断言前等待视图就绪很重要。

## 检视说明

按用户指示直接提交，本分支未走 reviewer 子代理检视；自动化覆盖（29+35 项 e2e、typecheck、build、zero pageerror）见 validation 文档。README/CHANGELOG 已同步 1.6.0。

## 后续（非本分支）

- e2e 实践重构（mock/分层/session 复用）在主仓库独立进行，见 `docs/references/260927-e2e-testing.md`
