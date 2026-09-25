# 260925 live-button-style-loss 修复总结

## 背景

用户报告：有些时候输入栏的 Live 入口按钮（`.lv-live-entry`）失去样式。诊断（见 `.troubleshoot.md`）确定根因为 dsh 客户端模块系统的样式认领机制与插件 CSS 注入时机错位：`injectLiveStyles()` 在 cordis `apply()` 时机追加的 `<style>` 无 `data-plugin` 标，被后续 (re)materialize 的其他插件 `claimStyles` 认领后，随该插件的 HMR 重载被 `removeOwnedStyles` 连带删除。触发源是宿主 `client-hmr` 无条件 500ms 轮询插件 bundle——任何插件内容变化（生产同样）都会向打开的标签页推 `rebuilt` 帧热重载。

## 修复

`src/client/styles.ts` `injectLiveStyles()`：创建 style 元素时打 `data-plugin="dsh-live2d-voice"`（= graph row id = 包名），回归宿主 canonical 用法（preset-emitted tags arrive pre-tagged）。效果：

- 其他插件 materialize 时的 `style:not([data-plugin])` 选择器不再命中本样式表；
- 本插件自身 HMR 重载时 `removeOwnedStyles` 正确删除旧 tag、apply 重新注入新 tag，生命周期闭环（原先的泄漏也一并消除）。

改动 1 行 + 注释，`lib/client.js` / `lib/standalone.js` 随构建同步。客户端改动经宿主 HMR 自动生效，线上 4180 无需重启。

## 验证

- `npm run typecheck` 通过；`node --check lib/client.js` 通过。
- e2e 回归 `e2e/verify-style-claim.mjs`：修复前 4 FAIL（owner=null → 两次外部插件 rebuild 后样式表被删、按钮 radius 0px）；修复后 ALL PASS（owner 恒为 `dsh-live2d-voice`，两次 rebuild 后样式表存活、按钮保持 999px pill）。
- 生产实机验证项见 `.validation.md`（待用户确认）。

## 遗留

- 生态级同类隐患：所有在 apply() 时机注入未打标 `<style>` 的插件都可能中招（实证时 `@xmanrui/dsh-im` 等 4 个悬空 tag）。属上游/第三方插件问题，不在本仓库修复范围；值得向相关插件作者或 dsh 上游反馈。
