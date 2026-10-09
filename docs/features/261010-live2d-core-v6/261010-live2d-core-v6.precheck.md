# 261010 P0 前置检查：Cubism Core 升级到 6.0.0（解锁 moc3 v6）

> 触发：`docs/research/261010-l2d-borrow-and-standard-audit.md` 发现参考项目 hacxy/l2d 内置的官方 Core（`csmGetLatestMocVersion() = 6`）能加载我们加载不了的官方 v6 素材 Ren，提出"换一个 Core 文件即可解锁 v6"。
> auto-human 给 P0 定了三条前置：① 官方来源 + 确切版本/哈希（不许从 l2d 拷二进制）；② 先证实或证伪 "Core 6 + pixi-live2d-display(Cubism 4)" 这个官方根本不发布的配对；③ 合入门槛是**渲染层** before/after 回归，不是解析层。
> 本文是 ①② 的结论与 ③ 的方案；**结论：只换 Core 不予采纳**。

## 一、前置 ①：官方来源与确切版本 ✅

官方 Cubism SDK for Web **5-r.5**（发行日期 2026-04-02）可直接下载，无需登录：

| 项 | 值 |
|---|---|
| URL | `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip` |
| zip 大小 / sha256 | 20,708,681 B / `67064a7fb1812cf502f5…` |
| Core 版本 | **06.00.0001**（`Core/CHANGELOG.md`：2026-01-08 "Upgrade Core version to 06.00.0001"） |
| `Core/live2dcubismcore.js` sha256 | `3ba426cc788d74f2…` |
| `Core/live2dcubismcore.min.js` sha256 | `8741f739779b5d52…` |
| 内置 Framework | 5-r.5 |
| 实测 | `csmGetLatestMocVersion() = 6`；`ren.moc3`（v6）加载成功，73 参数、canvas 5200×7000 |

**关键事实**：hacxy/l2d vendored 的 `src/vendor/cubism6/Core/live2dcubismcore.js` 与官方 SDK 5-r.5 的同名文件**字节相同**（sha256 均为 `3ba426cc788d74f2…`）——既证明了 l2d 的 Core 就是官方文件，也说明"从官方自取"完全可行，不必也不该从第三方仓库拷贝。

## 二、前置 ②：Core 6 + Cubism 4 渲染器 —— 证伪"只换一个文件" ❌

三方证据一致指向"这个配对不成对、且有已知的同类破坏先例"：

1. **官方文档：Framework 与 Core 同版本配套，跨世代升级要连 Framework 一起动。**
   - [SDK Compatibility with Cubism 4.2 Features](https://docs.live2d.com/en/cubism-sdk-manual/compatibility-with-cubism-4-2/)：从旧 4 系升到 4.2 是"整体替换文件"；**若 SDK 被定制过**，除覆盖 Core 外还必须覆盖指定的 Framework 渲染文件（`CubismModel` / 各平台 `CubismRenderer` / `cubismrenderer_webgl.ts` 等）。
   - [SDK compatibility and limitations of Cubism 5.3 features](https://docs.live2d.com/en/cubism-sdk-manual/compatibility-with-cubism-5-3/)：5.3 导出的 MOC 在旧 Core 上直接报 `The Core unsupport later than moc3 ver:[5]. This moc3 ver is [6]`——与我们测到的现象一字不差。
   - 官方 5-r.5 的 CHANGELOG 明写 "Change multiply and screen color functions to **separate class with renamed methods**"；同一版本的 `Framework/src/rendering/cubismrenderer_webgl.ts` 走的是 `model.getRenderOrders()`。我们打包的 Cubism 4 系 framework 调的是**旧名字/旧结构**。
2. **社区实测：Cubism 5 的 Core 在 pixi-live2d-display 上不工作。** [guansss/pixi-live2d-display#118](https://github.com/guansss/pixi-live2d-display/issues/118)：提问者 "The Cubism core 5 can not work with it"；有人建议直接替换 core 文件，回复是 "tried, not work :("。
3. **同类破坏的真实先例（就在我们这条栈上）。** [#177](https://github.com/guansss/pixi-live2d-display/issues/177)：官方 CDN 上的新 core 让 Cubism 4 渲染器在 `CubismRenderer_WebGL.doDrawModel` 处抛 `Cannot read properties of undefined (reading '0')`——原因是新 core 改了 `RenderOrders` 相关结构。也就是说：**即使 moc 版本不变，新 core 也能打断旧 framework 的渲染**，这与"换个文件就好"的直觉正相反（我们的内置 Core 是 5.1.0，早于那次改动）。

**结论**：`Core 6.0.0 + pixi-live2d-display-lipsyncpatch(Cubism 4)` 是官方不存在的组合，官方指引与社区实践都把它标为不可行。要 v6 就必须**连渲染引擎一起换代**，候选：

- [`untitled-pixi-live2d-engine`](https://github.com/guansss/pixi-live2d-display/issues/166)（维护者自述支持 Cubism 2/3/4/5、跟随最新 5.4 SDK、Pixi v8）
- `omniwaifu/pixi-live2d5`（Cubism 5 + Pixi 8，放弃 3/4 部分）

迁移代价需要单独评估：我们的口型（RMS 包络直接写 `ParamMouthOpenY`）、视线/陀螺仪、参数解析（`param-ids.ts`）都是自研的、与引擎无关；要重验的是挂载/舞台共享、hit test（点击互动刚落地）、`dataset` 契约与全部 e2e；另外**Cubism 2.1 模型（本机库 6 个）在替代品里只有部分支持**——这是迁移的硬约束。

## 三、优先级数据：短名单里被 v6 判废的模型数

auto-human 的判据是"≥5 个、或核心素材本身就是 v6 → P0 提到 P1 前面"。实测口径：

- 短名单 515 条里**只有 2 条**描述文字提到 Cubism 5（`【Live2d】【VTS対応】黒柴`、`【Live2D item】【Vtuber Asset】炎 Flame`）；BOOTH 页面普遍不标 SDK 版本，**真实 v6 数量只能下载后读 `.moc3` 版本字节**才知道。
- 本机模型库 75 个里 **0 个 v6**；官方样例目前只有 Ren 一个是 5.3/v6。

**未达阈值 → P0 不抢先，维持 P1（点击互动）先上。**

## 四、前置 ③：渲染层回归方案（留着，等真要动再执行）

若将来启动 v6 支持（不论换 Core 还是换引擎），合入门槛按这个跑：

1. 抽样 6–8 个代表模型，覆盖 Cubism 2.1 / moc3 v3 / v4 / v5、大画布、物理重、mask 重（如 `zongzi`、`haruhi`、`hiyori`、`azur-lane/enterprise`、`haru`）。
2. 同一页面、同一相机与参数状态，旧/新两套各截一帧，做受控 A/B 像素 diff（阈值统计，不靠 VLM 判读）。
3. Ren（5200×7000）单独验：崩溃时先分清是 Core 的问题还是画布/GPU 上限问题，别混在一起下结论。
4. 顺带验：物理/pose/眨眼/呼吸、mask inversion、multiply/screen color（5.3 改名的那批 API 正是高危区）。

## 五、建议

1. **本轮不动 Core**（P1 点击互动已单独交付）。把"v6 需要连渲染引擎换代"作为结论记录，避免以后有人再以为是"换个文件"。
2. 真正的 v6 支持（引擎迁移）作为独立需求排队，触发条件：出现我们真正想用的 v6 模型，或短名单下载抽样里 v6 占比升高（≥5 个）。
3. 若只想要 Ren 这一个模型，先评估"换引擎"的收益/代价是否划算——它是官方示例素材（非商用限制宽松，但仍受 Live2D 素材条款约束），而换引擎要重验全部交互与 e2e。
