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

> **`npm run build` 是全量构建，且是对共享工作树的一次快照**——多 agent 并行时，它会把工作树里
> **任何未提交的 `src/` 改动**（包括别人的在途 host 改动）一并编进 `lib/index.js`。
>
> - **别在共享工作树里为了"核对产物"跑它**（例如只想确认注释是否影响产物）：需要核对字节一致性/可复现性时，
>   用 worktree 或临时 checkout 跑，别在主工作树上跑；
> - 跑完发现 `lib/index.js` 被带上别人的改动：**脏着它，别提交**（提交走 commit-own-changes，
>   只提你改的那几个产物文件；只改 client 时提交里不应出现 `lib/index.js`）；
> - **覆盖文件**（`git show HEAD:lib/index.js > lib/index.js`）和**再跑一次 build** 都**不是**撤销手段：
>   前者用旧字节顶掉别人正在验证的产物，后者把当前（可能半改完的）src 快照进去；
> - 发现产物被误覆盖：**通知当事人**（在他的 working dir 留 NOTE 或经协调人转达），由他自己决定重建还是重跑。

## 多 Agent 协作

本仓库常有多 agent 并行修改。提交必须用 commit-own-changes 精确文件提交（worktree 内除外）；功能开发走 worktree（worktree-dev skill）。不要处理自己改动范围之外的变化。

- **禁止 `git add -A` / `git add .`**：共享工作树里会把**别人未跟踪的草稿**一并带进历史。2026-10-10 就因此把 35 个
  `docs/freeform/**` 草稿写进了未推送历史，事后只能取消跟踪（历史里仍留有它们）。提交一律按**文件/路径**精确 `add`。
