# AGENTS.md — dsh-live2d-voice

DSH 插件：Live2D 实时语音会话视图。源码 `src/`（host）+ `src/client/`（浏览器 bundle），构建产物 `lib/`，构建 `node build.mjs`。用户文档见 README（面向用户的能力/配置必须写进 README）。

## 必读规范

- **e2e 测试**：`docs/references/260927-e2e-testing.md` —— 分层（light 零 API / heavy 真实 API）、零 API boot、真实 API 门槛。动 e2e 或跑测试前必读。

## 开发循环

```bash
npm install    # ⚠ 可能挪空 node_modules（见 references 文档"技术要点"）
npm run typecheck
npm run build
npm run e2e:light   # 默认验证层（零 API）
```

e2e 实例：隔离 home + acquire-port 动态端口，见 dsh-e2e skill。

## 多 Agent 协作

本仓库常有多 agent 并行修改。提交必须用 commit-own-changes 精确文件提交（worktree 内除外）；功能开发走 worktree（worktree-dev skill）。不要处理自己改动范围之外的变化。
