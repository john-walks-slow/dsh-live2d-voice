# UX 打磨 diff + v1.0.0 发布门检视（review3）

- **检视对象**：`git diff a3a759c`（工作树，6 文件）+ 全仓发布就绪度
- **验证手段**：源码走查；e2e 实例（:4188）chromium 1280×800 几何实测；modlens 读图（/tmp/lv-e2e-4-reply.png、/tmp/lv-geo-probe.png）；Phase 1 e2e 复跑 **21/21 全绿**；`npm run build` 重建 **byte-identical**（lib 与 src 完全同步）；typecheck 通过
- **结论**：**修复后可发布**。2 个阻断项（均为小修复），2 个 P1，2 个 P2。

---

## 阻断项

### B1（阻断）「监听态 HUD 可见性」修复完全无效——CSS 选择器永不命中

- `styles.ts` 新规则 `.lv-hud.lv-mic-live.lv-faded { opacity: 0.75 }` 要求**同一个元素**同时携带 `lv-hud`、`lv-mic-live`、`lv-faded` 三类。
- 但 `hud.tsx:47` HUD 容器 className 仅有 `` `lv-hud${props.faded ? " lv-faded" : ""}` ``；`lv-mic-live` 只加在**麦克风按钮**上（`hud.tsx:50`，`lv-btn lv-mic-live`）。
- ⇒ 规则零命中：监听中 HUD 淡出仍降到 0.16，停止按钮照旧隐没——本 diff 宣称修复的问题原样存在。CHANGELOG 的「监听中 HUD 保持 75% 可见」是失实陈述。
- e2e 测不出（纯 CSS 视觉态）；此前的 modlens 视觉验证只覆盖了层间分离，未覆盖 mic-live 淡出态。
- **修复**（一行 + 重建）：`hud.tsx` 根 div 改为 `` `lv-hud${props.faded ? " lv-faded" : ""}${micOn ? " lv-mic-live" : ""}` ``，`npm run build`，肉眼回归一次监听淡出态。

### B2（阻断）idle 态字幕与 toast 落入 HUD 纵向带——实测确认的视觉回归

- HUD 84→140px 后实际占据 **[140, 192]**（实测高 52px），但字幕仅 146→150、toast 仅 146→150——两者整体位于 HUD 带内。
- **实测**（1280×800，发送消息后）：当前字幕行（含译文，46px 高）占 **[167, 213]**，与 HUD 带 [140, 192] **重叠 25px**；`hudOverlapsLines=[false, true]`。modlens 读图原话："HUD 胶囊被字幕文字部分遮挡"。截图见 /tmp/lv-geo-probe.png。
- toast（bottom 150，高约 35px → [150, 185]）完全落在 HUD 带内，z-index 10 直接盖在 HUD 按钮上（换音色/报错 toast 均会触发）。
- 旧布局无此问题（HUD [84,134] vs 字幕 146+，12px 净空）——**本 diff 引入**。「四层清晰分离」只在监听态（subs 266）成立，idle 态不成立。
- **修复建议**：
  - idle 字幕 bottom 150 → **≥200**（HUD 顶 192 + 8px 净空）；
  - toast 同步抬到同一层（监听态与字幕一起抬高，否则 [200,235] 会压住 micbar [204,239]）；
  - `raised` 建议扩展为 `micState === "listening" || micState === "requesting"`——requesting 态 micbar 已在 [204,239]，字幕 150 同样重叠；
  - 改后肉眼回归 idle + requesting + listening 三态。

## P1（发布前必须处理）

1. **package-lock.json 版本陈旧**：lock 根版本仍是 `0.2.0`，package.json 已是 `1.0.0`——clone 仓库后 `npm ci` 会因 root 版本失同步直接失败。`npm install --package-lock-only` 后随发布一并提交。
2. **LICENSE 文件缺失**：package.json 与 README 均声明 MIT，但仓库无 LICENSE 文件、files 数组也未含。公开/商用发布应补齐（dsh-set-model 曾犯同款）。

## P2（建议随发布修复）

1. **README Phase 3 项数陈旧**：开发节写「Phase 3 … 17 项」，脚本实际 **19** 项 check（P0a…P4），与 CHANGELOG（19）、实跑（19/19）不符。改 17→19。
2. **e2e 机器依赖未注明**：四个脚本硬编码 `playwright-core` 导入路径（/root/projects/camoufox-mcp/node_modules）与浏览器二进制绝对路径（camoufox-bin、chromium-1243 arm64）；verify-live / verify-voice 无 env 覆盖（phase3 有 E2E_URL/E2E_CFG，verify-asr 有 ASR_*）。README 已注明 4188 实例、pcm 夹具、模型夹具，但浏览器依赖只在本机成立——公开仓库应在 README 注明或参数化。

## 通过项（重点核对结论）

- **muzzleSafety 生命周期：无泄漏、无误清**。
  - barge 连发：`clearTimeout` 后重挂，无累积 ✓。
  - segment 结算：`.finally()` 清定时器 + unmuzzle ✓（早于 barge 的在途 segment 结算会提前放行，但下一帧 barge level 会重新 muzzle，窗口 <100ms，可接受）。
  - stopListening **不清** view 层 muzzleSafety（任务描述「stopListening 清定时器」不准确——它只经 `unmuzzle()` 清 engine 内建定时器）。残余定时器 ≤8s 后触发一次 `engineRef.current?.unmuzzle()`：stop 路径已 unmuzzle → no-op；期间重启 mic 并 barge 会重挂清掉旧定时器；卸载后 engineRef 为 null 安全。**实际无害**。
  - 但 view 层 8s 定时器与 `engine.muzzle()` **内建的 8s muzzleTimer（engine.ts:170-178，Phase 2 已有）完全冗余**——engine 早已自带同等安全释放。建议直接删掉 view 层 muzzleSafety（少一份重复机制），或注释说明为何双保险。
- **raised 字幕无 TTL 抖动**：`.lv-subs` 容器在 subtitlesOn 期间常驻（零行时渲染空容器），`bottom` 只随 micState 变化；TTL 清扫只增删子节点。0.25s 过渡仅在监听开/关时各触发一次 ✓。
- **CSS 边界**：≤640px 媒体查询加宽字幕/输入为 92% ✓；HUD 实测宽 231px，360px 窄屏放得下 ✓；超宽屏全部居中 + max-width，无问题 ✓。矮横屏（高 <~400px）监听态字幕 266 + 内容 ~126px 可能触顶裁剪（overflow:hidden）——P3 级备忘。
- **调试代码**：无 console.log / TODO / FIXME / debugger。console 使用为 3×error + 1×warn + 1×info（挂载日志），均带 `[dsh-live2d-voice]` 前缀，可接受。
- **构建产物**：lib/client.js、lib/index.js 重建 byte-identical ✓；lib 与本 diff 同步（含 lv-subs-raised / 266px / muzzleSafety）。
- **files 数组与磁盘一致**：lib/index.js、lib/client.js、lib/types/client/index.d.ts、assets/cubism4/live2dcubismcore.min.js、cordis.patch.yml、README.md 全部存在 ✓。
- **README 配置面**：13 个配置字段全部文档化；5 个预设音色与 `VOICE_PRESETS` 一致；asrCredentialsFile/subtitleLanguage 等默认值与 config.ts 一致 ✓。
- **版本一致性**：package.json 1.0.0 = CHANGELOG 1.0.0；README 无冲突版本引用（仅历史 feature 标签）。
- **git status**：恰为预期 6 文件（5 改 + CHANGELOG.md 新增）；`.mnemon/` 已忽略 ✓；.npmrc 无凭据。
- **Phase 1 e2e**：本次在当前构建复跑 **21/21**（第 22 个 check 是无 session 探针时的 else 分支，正常不执行）。

## P3 备忘（不阻断）

- `mic.ts` 的 `speechActive` getter 在 barge 改无条件 muzzle 后已无调用方——死 API，可删。
- README emotionMap「8 情绪默认表」实际默认表 9 键（sappiness 为 joy 别名），表述可更精确。
- `workspaces` 覆盖在实现上是整对象展开（`resolveSessionConfig`），README「凭证类字段只在全局层」是约定而非代码强制——保持现状可，注意文档口径。
- 仓库无任何 git tag（0.1.0–0.3.0 均未打）；发布时记得 commit + tag v1.0.0。
- `console.info` 挂载日志如追求极简可去掉。
