# dsh-live2d-voice 分角色拖动改动检视报告

对 `src/client/model.ts`、`src/client/view.tsx`、`e2e/verify-third-person.mjs`、`src/client/AGENTS.md` 的工作树改动（8442ea8 之上）进行全面检视；另核对构建产物 `lib/client.js` 是否与 src 同步。

## 结论：准入（可合入）。无阻塞问题。

核心修复语义正确，且已验明构建产物与源码同步（lib/client.js 含 `gestures:{mounts:[],dragOwner:null}`、`n?.gestures??{mounts:[],dragOwner:null}`、鼠标 move 的 `dragOwner!==null&&dragOwner!==m → return` 过滤、pointerup 清 owner、applyTransform 的 `lv${tag}Transform` 双键写入、view 传 "Ai"/"Player" tag）。单模型模式行为零变化（局部 registry 兜底 + 原语义不变）。

## 各检视轴结论

- **分角色语义**：共享 GestureRegistry 后 hitAvatar 遍历全 model，pointerdown 一次性确定归属；mouse 左键新增归属过滤，命中模型单动、空白/中键/右键全局平移——"拖一拖二"根因（局部 registry + mouse 无过滤）两条路径都已堵死。
- **双模型事件竞态**：两实例监听同一 stage，事件流一致 → dragOwner/mounts 写入值恒同，各实例只互发自己的 userPan/userScale/activeTouches/lastMouse，无发散路径；双 setPointerCapture 同元素幂等；任一 pointerup 清 owner 语义一致。
- **对视/faceBias**：faceBias 走角度参数（angleX/bodyX），不影响位置，命中判定不受其干扰；dual 下 faceBiasX≠0 → lookSettling() 恒真 → applyTransform 每帧跑 → per-model 键持续刷新，e2e 时机可靠；单模型下仅在事件时写，也够用。
- **destroy 对称**：unregisterMount + 全部监听移除 + observer.disconnect 均对称；模型 destroy 不碰共享 app/canvas 的既有约定未破坏。
- **per-model 键稳定性**：未被拖的模型 userPan 字节级不变 → `dataset[key]!==next` 守卫跳过写，断言"另一模型 ≤10px"实际是精确相等，稳健。

## 采纳与加固项（已全部落实）

1. **destroy 时清干 dragOwner 对自身的引用**：已在 `destroy` 中增加 `if (gestures.dragOwner === model) gestures.dragOwner = null`，防止拖动中销毁导致相机被冻结。
2. **destroy 时删除自己的 per-model dataset 键**：已增加 `if (tag) delete container.dataset[\`lv\${tag}Transform\`]`，避免卸载后残留陈旧数据。
3. **e2e 坐标命中可靠性加固**：
   - 命中点 y 改取 `0.52h`（与模型锚点中心 baseY = 0.52h 精准对齐，避免扁宽模型脱靶）。
   - 两次分角色拖动（拖 player、拖 AI）之间增加 dblclick 复位，彻底消除位移累积引发的跨模型重叠风险。
   - 增加中键拖动断言（`T2c-mid`），断言非左键在角色上拖动仍保持全局平移语义。
