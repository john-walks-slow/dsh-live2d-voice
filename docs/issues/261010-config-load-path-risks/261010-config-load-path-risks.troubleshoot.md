# 配置读路径风险（torn JSON → 全默认 → 落盘；apiKeys 静默清空）

状态：**已定位、已复现、本轮不修**（决定，非留洞）。跟踪入口：本文件；复现与基线数据见
`docs/features/261010-live2d-touch-mode/261010-live2d-touch-mode.baseline.md` §3.1/§3.2。

## 现象

`src/config.ts` 的读路径（`loadConfig()`，`src/config.ts:285-316`）有几处会**静默改写用户配置**，
其中两处后果较重：

1. **torn / 非法 JSON → 整份配置回到全默认，并在下一次 save 时落盘**
   **两段根因叠加，缺一不可**：
   - **写侧非原子**：`saveConfig` 直接覆盖目标文件（无 tmp + fsync + rename），写入中途被打断就留下半截 JSON；
   - **读侧静默降级**：`loadConfig()` 整个函数体包在 `try/catch` 里，`JSON.parse` 失败即
     `return structuredClone(DEFAULT_CONFIG)`——不抛错、不告警、调用方拿不到"我读的是默认值"的信号。
   随后 `saveConfig(patch)` 的读-改-写（`{ ...loadConfig(), ...patch }`）把这份"全默认"写回磁盘，
   **原配置不可恢复**。
   → 只做原子写只能挡住"写中途被打断"这一类；**外部脚本改坏、手工编辑出错、磁盘满**照样会静默清空，
     因为读侧仍然吞掉解析失败。两条修法要一起上。
2. **`apiKeys` 静默丢元素**
   `Array.isArray(raw.apiKeys) ? raw.apiKeys.filter((k) => typeof k === "string" && k) : []`——
   非数组直接变 `[]`，数组里的 `null`/`""`/数字/对象全部丢弃且无提示。

其余（`idleInterval`/`touchMode` 类型不符回落默认、`workspaces` 无 shape 校验、两条一次性迁移改写
`sttLanguage`/`liveMode`）属"上次已知的小口径"，一并记在 baseline §3.1 的表里。

## 复现（隔离 home，不碰线上）

复现脚本随文档入库（易失的 /tmp 路径不能当"正式跟踪入口"的复现路径）：

```bash
mkdir -p /tmp/lv-cfg-probe
DSH_HOME=/tmp/lv-cfg-probe node docs/issues/261010-config-load-path-risks/load-contract.mjs
```

（脚本只读/写 `$DSH_HOME/live2d-voice.json`，用在隔离目录上，绝不碰线上配置。）

关键两行（原样输出）：

```
① ①a loadConfig 未抛异常，返回 modelSelection="" touchMode=false 字段数=31
① ①b 随后一次 save 落盘：modelSelection=""（原值已被默认值顶替）
② apiKeys ['k1',null,'',123,'k2',{}] → ["k1","k2"]
```

## 影响面（判断依据，不夸大）

- 触发来源：磁盘写满 / 断电 / 进程被杀在写入中途（写侧非原子）；外部脚本改坏、手工编辑出错（读侧静默降级）。
  **两类来源都要靠对应那一段修法挡住**，不能只做原子写。
- 命中后不是"丢一个键"，而是**整个配置面**（模型、音色、语言、提示词、Live 专用模型…）静默回默认。
- 本轮不修的理由：修复要动 `src/`（原子写 + 读失败时抛错/让调用方决定），会改动线上基线并需要重启；
  真机验收窗口期冻结 src/lib。属既有行为，非本次触摸模式引入。

## 建议修法（留给后续，未实施）

1. `saveConfig` 改原子写：写 `*.tmp` → `fsync` → `rename`；
2. `loadConfig` 解析失败**不吞异常**：抛出或返回带 `degraded: true` 的结果，由调用方决定是否继续
   （至少在日志里留一条 ERROR，避免"静默回默认"）；
3. `apiKeys` 过滤时对丢弃的元素记一条 warn（数量 + 类型），或在 UI 上提示；
4. 顺手：`workspaces` 加 shape 校验，`idleInterval` 字符串不再静默回落。

## 关联

- 基线（含完整读路径契约表与三类实测）：`docs/features/261010-live2d-touch-mode/261010-live2d-touch-mode.baseline.md`
- 触摸模式验证记录：`docs/features/261010-live2d-touch-mode/261010-live2d-touch-mode.validation.md`
