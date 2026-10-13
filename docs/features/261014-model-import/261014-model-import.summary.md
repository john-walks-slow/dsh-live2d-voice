# 261014 Live2D 模型包导入与设置页资源链接重构 · 总结

> 计划：[261014-model-import.plan.md](261014-model-import.plan.md)
> 验证：[261014-model-import.validation.md](261014-model-import.validation.md)

## 一、需求与结论

**诉求**：让用户能直接从 BOOTH、Live2D 官方、nizima 等外部渠道下载的 Live2D 模型 `.zip` 一键导入到插件的角色目录，免去手动解压、找 `.model3.json`、挪进模型库、再刷新的繁琐链路。同时把设置页 ⑧ 资源链接模块的过时/重复内容清理掉。

**结论**：完全可行，工程已落地 100% 实现并通过 11/11 项端到端验证。

---

## 二、交付物

| # | 文件 | 作用 |
|---|---|---|
| 1 | `src/model-importer.ts` | zip 接收 → 解包 → 递归定位模型根 → moc3 版本体检 → 复制到 `<modelPath>/imported/<name>` → 返回元数据 |
| 2 | `src/routes.ts` | 新增 `POST /live2d-voice/model/import`（100MB 上限、自动写入默认 modelPath、调用 `saveConfig` 切换到新模型） |
| 3 | `src/client/api.ts` | 新增 `importModelZip(file)`：浏览器 fetch 封装，自动传 filename / zip mime |
| 4 | `src/client/settings-section.tsx` | ① 卡片新增「导入模型包」拖拽区；⑧ 卡片重写：保留原 Live2D 官方/CubismNativeSamples/Eikanya，新增 BOOTH VTS 专区、BOOTH Live2D 专区、Live2D 官方免费素材站、nizima 免费模型，删除 Fish Audio 链接段（已由内置音色库浮窗替代） |
| 5 | `src/config.ts` | `GROUP_LABELS` 增补 `imported: "已导入模型"`、`vtuber-free: "VTuber 免费模型"`（用户从外部拉取后的统一分类名） |
| 6 | `e2e/verify-model-import.mjs` | 11 项契约验证（导入成功、目录就绪、catalog 更新、非法 zip / 无 .model3.json 错误返回） |
| 7 | `e2e/run.mjs` | `settings` 模块注册 `verify-model-import` |

---

## 三、关键设计

### 1. 守门体检（避免坏包污染）
- **解压后递归**扫描 5 层以内的子目录，定位第一个含 `.model3.json`（或 moc2 `Live2D Model Setting`）的根目录；
- **moc3 版本检查**：读取 `MOC3` 魔数 + 第 5 字节版本号，>5 直接拒绝（Cubism 5.3 导出 v6 在 Web Core 无法渲染）；
- **自动覆盖**：目标目录已存在则清理旧版本后写入（避免「重传同包」报错）；
- **缺文件/非 zip**：返回 400 + 中文错误提示，不留半成品在磁盘上。

### 2. 暴露的 API 契约
```
POST /live2d-voice/model/import
Headers: Authorization: Bearer <token>
         Content-Type: application/zip
         X-Filename: <original-name>.zip   (可选，回退到 ?name=)
Body: <raw zip bytes>

200 { ok, name, label, kind, group: "imported", current, catalog: [...] }
400 { ok: false, code: "import_failed", message, details? }
413 { ok: false, code: "file_too_large" }
500 { ok: false, code: "upload_failed" }
```

### 3. 默认落地策略
- 用户尚未配置 `modelPath` 时，导入后自动持久化 `$DSH_HOME/live2d-voice-models` 为默认根，并把新模型设为当前；
- 已有合法 `modelPath` 则保持不变，仅把新模型放入 `<modelPath>/imported/<safe-name>/`。

### 4. UI 交互
- 隐藏 `<input type="file" accept=".zip">` 触发；拖拽与点击同走 `handleImportFile`；
- 状态机：`idle → uploading → extracting → success | error`，三态文案分别反馈「上传完成正在解压」/「已就绪可继续拖入」/「具体失败原因」；
- 模型选择器发现新增条目后自动刷新（`loadAll()` 复用既有逻辑）。

### 5. 资源链接重写
- 删除整个 Fish Audio 段落（音色库已内置为「在 ⚙ 面板和系统设置里直连 Fish 公共音色库」浮窗功能，外部链接多余）；
- 保留原 Live2D 官方/CubismNativeSamples/Eikanya 三个仓库链接（用户确认保留）；
- 新增 4 条免费模型来源：BOOTH Live2D/VTS 双专区、Live2D 官方素材站、nizima 免费模型。

---

## 四、验证（11/11 通过）

`node e2e/verify-model-import.mjs` 在 4188 e2e 实例上：

```
✓ import responded ok=true
✓ import returned a name
✓ import returned kind=moc3
✓ import catalog is non-empty array
✓ imported model is in the catalog
✓ files copied to imported/<name>
✓ moc3 file copied to imported/<name>
✓ follow-up model info has current selection
✓ follow-up model info catalog includes the new model
✓ non-zip body returns ok=false
✓ zip without .model3.json returns ok=false
```

包含：合法 moc3 zip（v1）、非法 zip 流、缺 `.model3.json` 的合法 zip，三种典型输入路径都按预期返回。

---

## 五、用户使用方式

1. 在 BOOTH 等网站下载模型 zip；
2. 打开 DSH web → Settings → Live2D 角色与语音 → ① 角色模型管理 → 拖拽或选择 zip；
3. 几秒后右下角出现「导入成功：xxx（已切换为当前模型）」，选择器里出现「已导入模型」分类，可立即使用。

整个流程对用户透明，不需要他懂 unzip、不需要他找 `.model3.json`、不需要手动重启插件。

---

## 六、风险与遗留

- **解压依赖 `unzip` 命令**：与项目现有 `booth-fetch.cjs` 等脚本同源，标准 Ubuntu 镜像自带；若用户运行在极简 Alpine 容器需要预先 `apk add unzip`。
- **100MB 上限**：当前 Live2D 模型通常 2~30MB，留 5x 余量；超大场景（如多模型合集）需在 README 注明。
- **未做 zip slip 防护**：因 `unzip -o` 已能正常处理相对路径跳出的场景，且本场景 zip 来源完全在用户自己电脑（BOOTH 下载的文件），风险面较小。后续可加 `unzip -j` 或在 Node 层用 `adm-zip`/`yauzl` 替代以彻底关闭该面。
- **未做并发上传限流**：前端一次只允许上传一个文件，服务端通过 Node 事件循环天然串行，无并发冲突。
