# 261010 触摸模式：线上基线快照（归因锁定）

目的：真机验收（校验表见 `261010-live2d-touch-mode.validation.md` §五）期间，任何人要证明"我声称没动线上行为面"这件事，都能独立重算，而不是只信聊天记录。

## 一、线上跑的就是这一版（合并后未再改动 src/lib）

采集时间：2026-10-10 05:58（合并 `91d44b5` 之后、真机窗口开启之前）

| 产物 | sha256 |
|---|---|
| `lib/client.js` | `677b75f752456cbdb2abc289b069c28be5d4eada21cc2956f3d58f8ebbcd45bb` |
| `lib/index.js` | `ba7c4c692bee4f97f0f3eaf4dae72b545fa3d0e2ecf25ffbae3d0d117d975fc7` |
| `lib/standalone.js` | `7e306672f9162de33db0af45699a5561ee5f53ac0eece8af5da5c36746ce8f67` |

独立重算：

```bash
cd /root/projects/dsh-live-mode && sha256sum lib/client.js lib/index.js lib/standalone.js
```

`lib/index.js` 应含 host 侧修复（`touchMode` 白名单），`lib/client.js` 应含 `lvTouchLook`、`lvGesture`：

```bash
grep -c "if(typeof body.touchMode" lib/index.js        # ≥1
grep -c "lvTouchLook" lib/client.js                     # ≥1
```

判据来源（不是自证）：这些 sha256 由独立子代理在 `/tmp` 重新 `node build.mjs` 后逐字节复核（`cmp` 全 0），与工作树及提交 `91d44b5` 一致。

## 二、线上运行实例

- 进程：supervisord 托管 `dsh`（pid 随重启变化；2026-10-10 05:32:51 起的那次重启加载本基线）
- 插件解析路径：`/root/.dsh/profiles/web/package.json` → `link:/root/projects/dsh-live-mode`
- client bundle 由宿主按请求读盘 + 内容哈希推送 → **刷新页面即拿到本基线**；host 侧（`lib/index.js`）变更需重启 dsh 才生效

## 三、线上配置写入的如实记录（诚实边界）

- 校验期间为验证 `touchMode` 持久化，对 `/root/.dsh/live2d-voice.json` 做过两次写入：`touchMode:true` → 再 `touchMode:false`（当前值 = 默认关）。
- 写入路径语义：`src/config.ts:321` `saveConfig(patch)` = `{ ...loadConfig(), ...patch }`——**merge**（读-改-写），patch 由 `src/routes.ts` 从 body 白名单逐键构造，那两次 body 只带 `touchMode`。
- **能证实的**：字段名与数量完整（33 个），我能独立对照的三个值（`modelSelection=hiyori`、`liveMode=first`、`apiKeys` 空数组）与用户既有设置一致；`touchMode` 已回到默认关。
- **不能证实的**（不许写成强断言）：
  1. 33 个字段"完整"只能排除**键被 strip**，排除不了**值被替换**——我**没有**写前快照，也没有跟 schema 默认值逐键比对，所以无法证明其余字段未被默认值顶替；此后再提到这点，措辞只能是"字段数量完整"，不是"用户的字段一个没少"。
  2. 残余风险至少两类：(a) **load 路径**的默认值填充 / 类型强转 / 非法 enum 回退——发生在"读"的时刻并被原样落盘，是确定性可复现的行为，未被证否也未被观测到；(b) 读-写窗口（并发写撞进同一窗口，所有设置保存路径共有）。**不是**"仅为微秒级窗口"。
- 当前配置文件 sha256 前缀：`ae59a5fb4e124977`（可作为后续基线）。

## 四、验证保留物

- 两个由验证动作产生的空会话（4 行元事件、`zstd -t` 通过、无 torn JSONL）：已从
  `/root/.dsh/sessions/--root--/` 移至 `/root/.dsh/session-log-backups/261010-smoke-cleanup/`（可回退）。
- 线上会话列表中 `session-c50f4e5b-…` 仍有一条宿主内存里的 ghost（`running:false, blank:true`）：下次 dsh 自然重启后消失，已与负责人确认不为此单独重启。
