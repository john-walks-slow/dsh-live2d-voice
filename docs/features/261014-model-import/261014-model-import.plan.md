# 261014 Live2D 模型包导入与资源链接重构 · 计划

## 一、需求背景与目标

1. **痛点与诉求**：
   - 现阶段用户获取外部 Live2D 角色模型（如 BOOTH、nizima、官方样例）后，需要手动解压、找到嵌套的包含 `.model3.json` 的文件夹、并手工复制进系统底层目录（如 `~/.dsh/live2d-voice-models`），然后再刷新，链路长且容易放错层级导致无法识别。
   - 在公开发布场景下，插件不应依赖宿主环境特异的外部爬虫与鉴权服务，而应提供通用、无阻力的**「模型包 Zip 本地导入」**能力：用户直接在前端拖拽或选择 zip 文件，插件后端完成自动解压、安全与格式体检、放入模型目录并热切换。
   - 设置面板模块 ⑧「找更多模型与音色」含有历史遗留内容：Fish Audio 链接已被内置的「音色库」弹窗完全替代；而游戏拆包链接在版权与驱动适配性上均不理想。需要重构为精选的合规、高质量、契合对话/直播场景的免费模型渠道（BOOTH 免费 VTS 区、Live2D 官方免费素材站、nizima 官方社区）。

2. **核心目标**：
   - **能力一：模型包导入 API (`POST /live2d-voice/model/import`)**
     - 支持上传 `.zip` 压缩包（上限 100MB）；
     - 解包并递归搜索合法模型（`.model3.json` 或 `moc2` 设置）；
     - 守门体检：moc3 版本必须 $\le 5$（防止 v6 无法渲染）；必要文件（纹理、物理等）完整性检查；
     - 自动安装至 `modelPath` 下（规范命名），重新扫描目录并在完成后自动选中该模型；
     - 友好报错：缺少模型文件、moc3 版本超限、解包失败等给出清晰中文提示。
   - **能力二：前端导入 UI**
     - 在设置页模块 ① 角色模型卡片处增加「导入模型包 (.zip)」按钮与拖拽区；
     - 导入状态反馈（上传中 → 解压体检中 → 导入成功并切换）；
   - **能力三：重构设置页模块 ⑧**
     - 移除 Fish Audio 链接与说明；
     - 替换为 BOOTH 免费专区（Live2D / VTS 对应）、Live2D 官方免费素材站、nizima 免费专区；
     - 补充操作指引：下载 zip 后直接在上方点击导入或拖拽即可载入。

---

## 二、架构设计与技术细节

### 1. 后端接口设计

- 路由：`POST /live2d-voice/model/import`
  - 请求头：`Content-Type: application/zip` 或 `application/octet-stream`（URL 带 `?name=<filename>`）
  - 大小限制：最大 100MB（Live2D 模型 zip 通常为 2MB~30MB）
  - 处理流程：
    1. 写入临时文件 `/tmp/dsh-live2d-import-<timestamp>.zip`；
    2. 使用 `unzip` 解包至临时目录；
    3. 递归扫描目录，定位第一个合法的 Live2D 模型根目录（含 `.model3.json` 或 moc2 配置）；
    4. 校验 `.moc3` 版本魔数（字节偏移 0~3 为 `MOC3`，偏移 4 字节为版本号，必须 $\le 5$）；
    5. 若当前配置 `modelPath` 为空，初始化默认目录（`~/.dsh/live2d-voice-models`）；
    6. 将模型目录移动到 `<modelPath>/<safe-name>`（若已有则覆盖或加序号）；
    7. 调用 `saveConfig({ modelSelection: name })`，返回 `{ ok: true, name, label, kind }`；
    8. 清理临时解包文件。

### 2. 前端设计

- 在 `settings-section.tsx` 模块 ①：
  - 在「角色模型」行操作区增加隐藏 `<input type="file" accept=".zip" />` 与「导入模型」按钮；
  - 增加导入状态提示（进度条/文字提示）；
  - 导入成功后触发 `fetchModelInfo` 并更新当前选中项。
- 在 `settings-section.tsx` 模块 ⑧：
  - 更新卡片标题与链接：
    - `https://booth.pm/ja/search/Live2D%20モデル?max_price=0`（BOOTH 免费 Live2D 模型 · VTS 对应）
    - `https://www.live2d.com/zh-CHS/learn/sample/`（Live2D 官方免费素材站）
    - `https://nizima.com/Search/Result?typeId=1&priceMin=0&priceMax=0`（nizima 官方社区免费模型）
  - 去除 Fish Audio 整个区域。

---

## 三、实施计划

1. [x] 创建独立 worktree `feat/model-import` 并初始化环境
2. [x] 编写需求计划文档
3. [ ] 实现后端导入路由 `src/routes.ts` 与模型处理逻辑
4. [ ] 实现前端 `settings-section.tsx` 导入与模块 ⑧ 重构
5. [ ] 样式补充 (`src/client/styles.ts`)
6. [ ] 自动化测试与验证
7. [ ] 编写总结文档并准备合入
