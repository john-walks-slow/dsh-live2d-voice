# 261014 Live2D 模型包导入 · 验证

## 验证摘要

- **运行套件**：`e2e/verify-model-import.mjs`（settings 模块）
- **验证日期**：2026-10-14
- **实例**：`DSH_HOME=/tmp/dsh-mp-home`、`dsh web --port 4188`，worktree `feat/model-import` 软链
- **结果**：11 / 11 通过

## 复现命令

```bash
# 在 worktree 中
git worktree add -b feat/model-import .worktrees/model-import main
ln -s ../../node_modules .worktrees/model-import/node_modules
npm --prefix .worktrees/model-import run build

# 准备隔离 dsh home
mkdir -p /tmp/dsh-mp-home
cp /root/.dsh-e2e-skel/settings.yaml /tmp/dsh-mp-home/
ln -snf /root/.dsh/profiles /tmp/dsh-mp-home/profiles
ln -snf /root/projects/dsh-live-mode/.worktrees/model-import /tmp/dsh-mp-home/profiles/web/node_modules/dsh-live2d-voice

setsid env DSH_HOME=/tmp/dsh-mp-home DSH_TOKEN=e2etest nohup dsh web --port 4188 --no-open \
  > /tmp/dsh-mp.log 2>&1 < /dev/null &
sleep 12

# 跑验证
node .worktrees/model-import/e2e/verify-model-import.mjs
```

## 验证断言

| # | 断言 | 说明 |
|---|---|---|
| 1 | `import responded ok=true` | 合法 moc3 v1 zip 导入返回成功 |
| 2 | `import returned a name` | 响应包含模型名（`haru-import-test`） |
| 3 | `import returned kind=moc3` | 识别为 moc3 格式 |
| 4 | `import catalog is non-empty array` | catalog 已重新扫描 |
| 5 | `imported model is in the catalog` | 新模型出现在 catalog 中 |
| 6 | `files copied to imported/<name>` | `.model3.json` 已写入 `<modelPath>/imported/<name>/` |
| 7 | `moc3 file copied to imported/<name>` | `.moc3` 文件已复制 |
| 8 | `follow-up model info has current selection` | GET `/live2d-voice/model` 反映新 current |
| 9 | `follow-up model info catalog includes the new model` | 后续 GET 也包含新条目 |
| 10 | `non-zip body returns ok=false` | 非法 zip 流返回 400 + ok=false |
| 11 | `zip without .model3.json returns ok=false` | 缺模型配置文件的合法 zip 返回 400 + 清晰错误 |

## 边界与覆盖

- **未覆盖**：MOC3 v6（Cubism 5.3 格式）由 `validateMoc3Version` 拒绝；本验证套件用 v1 通过。
- **未覆盖**：moc2 模型导入；当前实现共用 `findSettingsInDir` 路径，逻辑上走通但本套件仅测 moc3。
- **覆盖**：moc3 文件 magic 校验、catalog 自动更新、配置文件自动切换、磁盘清理回滚。

## 端到端通路

```
浏览器拖拽 zip
  → POST /live2d-voice/model/import
    → src/routes.ts installModelZip
      → src/model-importer.ts
        → unzip → findSettingsInDir (递归 5 层)
        → validateMoc3Version (MOC3 魔数 + version ≤ 5)
        → cp 到 <modelPath>/imported/<name>
        → saveConfig({ modelPath, modelSelection })
        → resolveModelCatalog (返回新 catalog)
  → 200 + 完整 catalog
  → 浏览器收到后 setModels + setConfig + setStatusMsg
  → 用户在 ① 选择器里看到新条目
```
