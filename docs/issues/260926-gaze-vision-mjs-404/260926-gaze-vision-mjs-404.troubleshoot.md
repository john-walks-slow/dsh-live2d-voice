# 260926 gaze vision.mjs 加载失败

## 现象

手机端开启「视线追踪」，界面提示：

```
failed to fetch dynamically imported module  gaze/vision.mjs
```

## 根因

插件的 MediaPipe 运行时（`@mediapipe/tasks-vision`）在 **node_modules 里被移走了**。

2026-09-26 00:14 有一次 `npm install` 把原有依赖目录整体挪进了 `node_modules/.ignored/`
（npm 覆盖"非自己放置的同名目录"时的固有行为），其中包括
`@mediapipe/tasks-vision`、`ws`、`react`、`react-dom`、`pixi.js`、`esbuild`、
`pixi-live2d-display-lipsyncpatch`、`typescript`、`@deepseek-ai/*`、`@types/*`。
之后 node_modules 顶层只剩 68 个包，`@mediapipe/` 是个**空目录**。

`src/routes.ts` 的 gaze 资产路由用 `createRequire(import.meta.url).resolve("@mediapipe/tasks-vision")`
定位运行时目录，于是出现两种 404：

| 实例 | 启动时刻 | 现象 |
| :--- | :--- | :--- |
| 线上 4180 | 依赖被移走**之前** | 已缓存到正确目录，但目录下文件没了 → `serveFile` 失败 → `404 {"code":"not_found"}` |
| e2e 4188 | 依赖被移走**之后** | 启动即解析失败 → `mediapipeDir = ""` → `404 {"code":"mediapipe_missing"}` |

浏览器里 `import("/live2d-voice/gaze/vision.mjs")` 拿到 404，于是抛出这句
"failed to fetch dynamically imported module" —— 页面完全看不到服务端给出的
`code`，用户无从判断是缺依赖还是断网。

`/live2d-voice/gaze/model` 一直正常（模型缓存在
`$DSH_HOME/live2d-voice-cache/face_landmarker.task`，与 node_modules 无关），
所以只有"运行时 JS + wasm"这一段挂了。

## 修复

1. `npm install --prefer-offline`（先 `--dry-run` 确认计划：add 52 / change 9，
   含 `add @mediapipe/tasks-vision 0.10.35`）恢复依赖。
2. **线上 4180 无需重启**：`mediapipeDir` 早已解析到正确路径，文件回来后
   `serveFile` 立即成功。重启 e2e 4188 生效。
3. 顺带两处加固（防同类复发）：
   - `src/routes.ts`：MediaPipe 目录改为**懒解析 + 成功才 memoize**，解析失败
     不缓存 → 依赖后装/后修不必重启 DSH 即可恢复。
   - `src/client/gaze.ts`：`import()` 失败时补一次 `fetch` 探测，读取服务端
     `code`，把不可读的浏览器报错换成可执行的提示，例如
     `视线追踪资源加载失败：服务端未安装 @mediapipe/tasks-vision，请在插件目录执行 npm install 后重启 DSH`。

## 验证

`e2e/verify-v11.mjs`（A 资产路由 + B 页内 MediaPipe 管线）全绿：

```
A1 vision.mjs 200 134KB
A2 wasm 200 10.6MB
A3 model 200 3.6MB
B1 FaceLandmarker constructed ({"ok":true,"delegate":"GPU"})
```

两实例 curl 复核：4180 / 4188 的 `gaze/vision.mjs` 均 `200 text/javascript`，
`gaze/wasm/*.wasm` 均 `200 application/wasm`。

## 未覆盖 / 遗留

- 「解析失败不缓存、请求时重试」这条路径未做实机验证：唯一可靠的验证方式是把
  `node_modules/@mediapipe/tasks-vision` 临时移走再移回，而 node_modules 正被
  其他 agent 并发使用（构建窗口内构建会失败），风险不值得。逻辑为 4 行、已走
  代码评审。
- `verify-v11.mjs` 余下红灯与本问题无关，属既有漂移：
  - T1/T2 选择器找 `陀螺仪视差`，HUD 文案早已改成 `陀螺仪 3D 视差`；
  - C1/C2 走 agent 工具回路（首轮 reply 为 null，与 gaze 资产无关）；
  - D2 设置弹窗关闭断言。
- `src/routes.ts` 的懒解析要等下次 DSH 重启才进入线上 4180 进程；当前 4180
  已在正常服务，不需要为此重启。
