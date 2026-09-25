# live-button-style-loss 用户验证

## 验证说明

- 验证对象：Live 按钮偶发失去样式问题的修复（style 标签 data-plugin 认领）
- 环境/前置条件：生产实例 4180（修复已通过 HMR 自动推送到已打开的标签页；新开标签页天然加载新版）；需要有插件 rebuild 的日常开发活动作为触发源

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 在生产 GUI 标签页开着的情况下，让任意插件连续 rebuild 两次（例如另一个 agent 跑 `npm run build`，或本仓库 rebuild），然后回到 GUI 查看首页输入栏的 Live 按钮 | Live 按钮始终保持 pill 样式（圆角、内边距正常），F12 检查 `#dsh-live2d-voice-styles` 存在且 `data-plugin="dsh-live2d-voice"` | | 待验证 | e2e 已用 dsh-token-game 两次 rebuild 实证；此项为生产实机确认 |

## 验证结论

待验证。

## 待跟进

无。
