# AGENTS.md — dsh-live2d-voice

DSH 插件：Live2D 实时语音会话视图。源码 `src/`（host）+ `src/client/`（浏览器 bundle），构建产物 `lib/`，构建 `node build.mjs`。用户文档见 README（面向用户的能力/配置必须写进 README）。

## 必读规范

- **e2e 测试规范**：`docs/references/260927-e2e-testing.md` —— 业务模块化隔离运行、真实 API 严格孤立、零 API boot、e2e-tester 验收与固化双轨制。任何测试前必读。

## 开发循环

```bash
npm install          # ⚠ 可能挪空 node_modules（见 references 文档"技术要点"）
npm run typecheck
npm run build

# 模块化测试（修改哪个模块只测哪个模块，严禁全量陪跑）：
node e2e/run.mjs <module>    # 如: node e2e/run.mjs gaze / fullscreen / boot
# 单点套件测试：
node e2e/run.mjs verify-boot
```

e2e 实例：隔离 home + acquire-port 动态端口，见 dsh-e2e skill。

> **`npm run build` 是全量构建**：它会把工作树里**任何未提交的 `src/` 改动**一并编进产物——
> 多 agent 并行时，你只改了 client，也会把别人的在途 host 改动写进 `lib/index.js`。
> 处置：**脏着它，别提交**（提交走 commit-own-changes，只提你改的那几个产物文件即可）；
> **不要为了"还原产物"去覆盖文件**（`git show HEAD:lib/index.js > lib/index.js` 之类），
> **也不要用 `npm run build` 去"撤销"它**——build 同样是对他人工作树 src 的一次快照，
> 会把你看到的（可能半改完的）src 编进产物。两者都不是撤销手段。
> 发现产物被误覆盖时：**通知当事人**（在他的 working dir 留 NOTE 或经协调人转达），由他自己决定重建还是重跑。
> 只改 client 时，提交里不应出现 `lib/index.js`。

## 多 Agent 协作

本仓库常有多 agent 并行修改。提交必须用 commit-own-changes 精确文件提交（worktree 内除外）；功能开发走 worktree（worktree-dev skill）。不要处理自己改动范围之外的变化。
