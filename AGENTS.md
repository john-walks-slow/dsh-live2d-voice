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

## 多 Agent 协作

本仓库常有多 agent 并行修改。提交必须用 commit-own-changes 精确文件提交（worktree 内除外）；功能开发走 worktree（worktree-dev skill）。不要处理自己改动范围之外的变化。
