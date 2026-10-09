# 261010 触摸模式：线上基线快照（归因锁定）

目的：真机验收（校验表见 `261010-live2d-touch-mode.validation.md` §五）期间，任何人要证明"我声称没动线上行为面"这件事，都能独立重算，而不是只信聊天记录。

## 一、线上跑的就是这一版（合并后未再改动 src/lib）

采集时间：2026-10-10 05:58（合并 `91d44b5` 之后、真机窗口开启之前）

| 产物 | sha256 |
|---|---|
| `lib/client.js` | `7de27bcd233e8d6ca19f9f63584d5c129f178e50e01cf22ff91513af145f0c82` |
| `lib/index.js` | `ba7c4c692bee4f97f0f3eaf4dae72b545fa3d0e2ecf25ffbae3d0d117d975fc7` |
| `lib/standalone.js` | `2b6b27f1cf22301bc2e6df492a255ff2ef5a7c886c189d84951bc0184abc393d` |

**2026-10-10 更新（手势诊断契约）**：客户端新增两个诊断字段（只动 client 侧，`lib/index.js` 未变，
**无需重启 dsh，刷新页面即拿到新 bundle**）：
- `dataset.lvGestureSeq`：手势**真的起播**时单调 +1，被拒绝的滑动不推进 → e2e 的因果归因依据；
- `dataset.lvMotionBusy`：`"1"` = **现在发 NORMAL 手势会被拒**。读的是 pixi `MotionManager` 的
  `state.currentPriority` / `state.reservePriority`（`MotionPriority`：NONE=0 / IDLE=1 / NORMAL=2 / FORCE=3），
  即 `max(current, reserve) >= 2`。**这是精确信号**：队列管理器的 `getCurrentPriority()` 是另一个对象、
  在本构建里恒为 0（源码判定见 `docs/issues/261010-motion-priority-signal/`）。
  e2e 因此改成"等它归零 → **单次**滑动"，不再重试（实测分布 `1 次 ×7`）。

独立重算：

```bash
cd /root/projects/dsh-live-mode && sha256sum lib/client.js lib/index.js lib/standalone.js
```

`lib/index.js` 应含 host 侧修复（`touchMode` 白名单），`lib/client.js` 应含 `lvTouchLook`、`lvGesture`。
下面每行都是**我原样跑过、输出贴在下面对应位置**的（规矩：标"可独立复核"的命令必须先自己跑一遍）：

```bash
$ grep -c "typeof body.touchMode" lib/index.js
1
$ grep -c "lvTouchLook" lib/client.js
1
$ grep -c "lvGesture" lib/client.js
1
$ sed -n 1944p lib/index.js
        if (typeof body.touchMode === "boolean") patch.touchMode = body.touchMode;
```

（第一版写的是 `grep -c "if(typeof body.touchMode"`——产物里 `if (` 与 `typeof` 之间有空格，照抄会得到 `0`，恰好导出"修复没进产物"的相反结论。已改。）

判据来源（不是自证）：这些 sha256 由独立子代理在 `/tmp` 重新 `node build.mjs` 后逐字节复核（`cmp` 全 0），与工作树及提交 `91d44b5` 一致。

## 二、线上运行实例

- 进程：supervisord 托管 `dsh`（pid 随重启变化；2026-10-10 05:32:51 起的那次重启加载本基线）
- 插件解析路径：`/root/.dsh/profiles/web/package.json` → `link:/root/projects/dsh-live-mode`
- client bundle 由宿主按请求读盘 + 内容哈希推送 → **刷新页面即拿到本基线**；host 侧（`lib/index.js`）变更需重启 dsh 才生效

## 三、线上配置写入的如实记录（诚实边界）

- 校验期间为验证 `touchMode` 持久化，对 `/root/.dsh/live2d-voice.json` 做过两次写入：`touchMode:true` → 再 `touchMode:false`（当前值 = 默认关）。
- 写入路径语义：`src/config.ts:321` `saveConfig(patch)` = `{ ...loadConfig(), ...patch }`——**merge**（读-改-写），patch 由 `src/routes.ts` 从 body 白名单逐键构造，那两次 body 只带 `touchMode`。
- **能证实的**：字段名与数量完整（33 个），我能独立对照的三个值（`modelSelection=hiyori`、`liveMode=first`、`apiKeys` 空数组）与用户既有设置一致；`touchMode` 已回到默认关。
- **不能证实的**（不许写成强断言）：33 个字段"完整"只能排除**键被 strip**，排除不了**值被替换**——我**没有**写前快照，也没有跟 schema 默认值逐键比对，所以无法证明其余字段未被默认值顶替；此后再提到这点，措辞只能是"字段数量完整"，不是"用户的字段一个没少"。

### 3.1 `loadConfig()` 的读路径契约（可枚举，不是"未知"）

`src/config.ts:285-316`。底子是 `{ ...structuredClone(DEFAULT_CONFIG), ...raw }`：**未显式处理的键原样透传、完全不校验**；缺失键静默用默认填充。会改写用户值的只有下面这几处：

| 键 | 处理 | 后果 |
|---|---|---|
| （未列出的 ~29 个键） | 原样透传，无类型/shape 校验 | 值不会被替换；**但也拦不住坏值**（实测 `modelSelection: 123`、`voiceId: {"weird":true}` 原样读回） |
| `idleInterval` | `typeof === "number"` 否则默认 | 字符串/`null` → 静默回落默认（实测 `"20"` → 默认 `20`，**不是**解析成 20） |
| `touchMode` | `typeof === "boolean"` 否则默认 | 任何非布尔值 → 默认 `false` |
| `workspaces` | `raw.workspaces ?? {}` | **无 shape 校验**：数组/字符串照样透传（实测 `[1,2]` 读回仍是 `[1,2]`） |
| `apiKeys` | 必须是数组，且元素必须是"非空 string" | **最坏面**：一次坏写静默清空（实测 `['k1',null,'',123,'k2',{}]` → `["k1","k2"]`）；非数组 → `[]` |
| `emotionMap` / `playerEmotionMap` | 与默认表 merge | 用户侧键一定保留，删不掉 |
| `sttLanguage` | 仅当 `speechLanguage` 缺失且 `sttLanguage === "zh"` | **静默改写用户值**为 `"auto"`（phase 1→2 迁移，只发生一次） |
| `thirdPerson` | 仅当 `liveMode` 缺失且 `thirdPerson === true` | 映射为 `liveMode="third"`，并从载入对象里删掉该键（实测：载入对象无 `thirdPerson`，随后 save 也不写它） |
| **整个函数体外层 `try/catch`** | JSON 解析失败 → `catch` 返回**全默认** | **最严重**：文件一旦 torn，本次读回全默认，**且随后任意一次 `saveConfig` 都是 read-modify-write，会把这个"全默认"落盘**，原值不可恢复 |

实测（`DSH_HOME=/tmp/lv-cfg-probe`，隔离目录，脚本 `docs/issues/261010-config-load-path-risks/load-contract.mjs`，绝不碰线上配置）：

```
① 写坏的 JSON 确实无法解析
① ①a loadConfig 未抛异常，返回 modelSelection="" touchMode=false 字段数=31
① ①b 随后一次 save 落盘：modelSelection=""（原值已被默认值顶替）
② apiKeys ['k1',null,'',123,'k2',{}] → ["k1","k2"]
③ 透传 modelSelection=123 voiceId={"weird":true} speechPrompt="  keep  "
④ idleInterval:"20"→20 touchMode:"yes"→false workspaces:[1,2]→[1,2] apiKeys:"..."→[]
⑤ sttLanguage:"zh"（无 speechLanguage）→"auto"；thirdPerson:true（无 liveMode）→liveMode="third"，载入对象里 thirdPerson 存在? false
⑤ 迁移后一次 save 落盘：liveMode="third"，文件里 thirdPerson 存在? false
```

（①b 的 `""` 就是 `DEFAULT_CONFIG.modelSelection`——坏文件里那行 `"hiyori"` 已被顶替并落盘。）

### 3.2 已知风险（带跟踪入口，不是"候选"）

| 风险 | 复现 | 影响 | 处置 |
|---|---|---|---|
| **torn JSON → 整份配置回默认 → 下次 save 落盘** | `mkdir -p /tmp/lv-cfg-probe && DSH_HOME=/tmp/lv-cfg-probe node docs/issues/261010-config-load-path-risks/load-contract.mjs`（① 段）——写坏 JSON 后 `loadConfig()` 返回全默认，随后任意一次 `saveConfig` 把"全默认"写回磁盘 | 不是丢一个键，是**整个配置面**静默回默认且原值不可恢复；根因是 `saveConfig` 非原子写（直接覆盖，无 tmp+rename） | **本轮不修**（动 src 破冻结/改基线），跟踪入口：[`docs/issues/261010-config-load-path-risks/261010-config-load-path-risks.troubleshoot.md`](../../issues/261010-config-load-path-risks/261010-config-load-path-risks.troubleshoot.md) |
| **`apiKeys` 静默丢元素** | 同脚本 ② 段：`['k1',null,'',123,'k2',{}]` → `["k1","k2"]`；非数组 → `[]` | 一次坏写静默清空用户 key（无提示、无日志） | 同上（同一 issue 记录，含建议修法） |
| 读-写窗口（并发 patch 撞进同一读→写窗口） | 无法稳定复现（微秒级） | 并发写可能被覆盖 | **接受，不修**（所有设置保存路径共有） |

处置决定与理由写在 issue 文件里；冻结期结束后如需修复，按该文件"建议修法"四条走（原子写 + 解析失败不吞异常 + `apiKeys` warn + shape 校验）。

### 3.3 残余风险的处置决定

- (a) **读路径的默认值填充/强转/非法值回退**：已按上表枚举 + 三条实测覆盖，不再写"未知"。其中 `apiKeys` 静默清空与外层 try/catch 的"torn → 全默认 → 下次 save 落盘"是真实风险，**本轮决定不修**（要动 `src/`，破冻结、改线上基线；且属既有行为，非本次引入）。跟踪入口：[`docs/issues/261010-config-load-path-risks/261010-config-load-path-risks.troubleshoot.md`](../../issues/261010-config-load-path-risks/261010-config-load-path-risks.troubleshoot.md)（含复现脚本与建议修法）。
- (b) **读-写窗口**（并发 patch 撞进同一读→写窗口）：也是既有性质，**接受，不修**。
- 两条都是**决定**，不是留洞；真机验收的归因基线以本文件为准。

## 四、验证保留物

- 两个由验证动作产生的空会话（4 行元事件、`zstd -t` 通过、无 torn JSONL）：已从
  `/root/.dsh/sessions/--root--/` 移至 `/root/.dsh/session-log-backups/261010-smoke-cleanup/`（可回退）。
- 线上会话列表中 `session-c50f4e5b-…` 仍有一条宿主内存里的 ghost（`running:false, blank:true`）：下次 dsh 自然重启后消失，已与负责人确认不为此单独重启。
