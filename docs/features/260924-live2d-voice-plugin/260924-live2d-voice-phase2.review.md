# dsh-live2d-voice Phase 2（连续语音输入）检视报告

- 检视对象：`/root/plugins/dsh-live2d-voice` 工作树（git diff + 3 个 untracked 文件 = 完整变更集，基线 4635b0b）
- 检视方式：全量 diff 逐行 + untracked 全文 + 关键文件全文（asr/mic/view/routes/config/engine/hud/styles/types/api/index/build）+ 本机复验（typecheck、lib 产物重建比对、依赖检查、协议帧字节推演、状态机走查）
- 检视重点：asr.ts 帧协议边界、mic.ts 分句状态机、view.tsx 并发竞态、routes 输入校验、config 默认值、bundle 体积

## 准入结论：有条件通过（approve with required changes）

代码质量整体扎实：架构取舍（WS 双向流式 → 本地 VAD + 整句 nostream）有实测背书且注释论证充分；状态机与竞态处理大头都对；产物同步、typecheck 通过。**唯一必须项是 version 仍为 0.1.0**。建议项均为小改动，强烈建议本次顺手修掉 #2/#3/#6/#7（直接影响主用例体验与升级行为）。

---

## 阻塞（提交 v0.2.0 前必须处理）

### B1. package.json 版本号未升
`"version": "0.1.0"`，而 README 已写「连续语音输入（v0.2.0）」。提交前需 bump 到 0.2.0（package-lock.json 同步），否则版本与发布说明矛盾。

---

## 建议（应该修；均为小改）

### S1. 回声防护会误杀短句应答（主用例受损）
`view.tsx looksLikeEcho`：对 normalize 后的目标串逐字做「字符是否在最近 3 句角色台词中出现过」的包含计数，命中率 >0.6 即丢。对中/日文，短促应答（「はい」「うん」「そうだね」）的假名几乎必然出现在角色近 3 句台词里 → 整句被当回声丢弃。触发窗口恰是核心场景：用户在 AI 说话期间以 0.015–0.03 区间的音量插话（不足以跨 barge 阈值 0.03，engine 未被 stop，segmentWhileSpeaking=true → 走回声判定）。
建议：① normalize 后 `target.length < 4` 直接放行；② 用相邻 bigram 重合率替代单字包含率（子串级匹配，误杀率大幅下降）。

### S2. `segmentWhileSpeakingRef` 跨 flight 共享，被后段覆盖
多个 segment 识别并发在飞时，后关闭的 segment 会覆写该 ref，先关闭 segment 的 `.then` 读到的是后者的值 → 其回声判定被旁路。修法极简：`onSegment` 回调里用局部 `const whileSpeaking = engineRef.current?.speaking() === true` 闭包捕获（本来就是同步读，无需 ref）。可与 S1 同一次修改。

### S3. MicCapture.start() 半途失败泄漏麦克风
`getUserMedia` 成功后 `addModule`/`AudioWorkletNode` 构造抛错时，stream 未 stop、AudioContext 未 close；`toggleMic` 的 catch 只设状态不清理 → 标签页持续显示"录音中"（隐私可见）。概率低（blob worklet 极少失败）但影响可见。修法：catch 里补 `mic.stop()`（全可选链，安全）或 `start()` 内部 try/catch 自清理。

### S4. 升级用户的 sttLanguage 卡死 "zh" + speechLanguage 突变 "ja"
`saveConfig` 全量落盘 + `loadConfig` file-over-defaults：Phase 1 用过 ⚙ 面板的用户文件里已固化 `sttLanguage: "zh"`（Phase 1 默认），升级后新默认 "auto" 不生效；同时 `speechLanguage` 字段缺失 → 新默认 "ja" 生效 → **升级用户角色突然只说日语、识别锁中文、且字幕翻译（Phase 3）未上线**，体验断裂。e2e 脚本自己都要显式改写 e2e 配置文件为 auto（verify-voice.mjs L160-163），即为此问题的旁证。
建议做一次性安全迁移：Phase 1 从未暴露过 sttLanguage UI（按钮是禁用占位），故 `raw.speechLanguage === undefined && raw.sttLanguage === "zh"` 可判定为纯 Phase 1 文件 → 置 sttLanguage 为 "auto"（用户一旦在 Phase 2 保存过任何配置，speechLanguage 会被固化，迁移自动跳过）。至少也要在 release note / README 写明。

### S5. README 配置示例的 `~` 路径是陷阱
示例写 `"asrCredentialsFile": "~/.config/volc-asr/credentials.json"`，但 `loadVolcCredentials` 直接 `readFileSync`，不展开 `~` → 照抄即报"未配置火山 ASR 凭证"，非常迷惑。修法：`loadVolcCredentials` 开头加一行 `~/` 展开为 `join(homedir(), ...)`（README 就不用改了）。

### S6. 卡死 muzzle 状态（窗口极窄但修复一行）
muzzle 的三个释放点（submit 成功 / segment finally / stopListening）都不覆盖「barge segment 不足 300ms 被 MIN 过滤丢弃」的路径：无 onSegment → 无 finally → muzzle 悬挂。此时若新 turn 不经本视图的 submitText 发起（如 GUI Chat 页发送且 Live2D 视图保持挂载），新 turn 音频也被 `enqueueBase64` 的 muzzled 分支吃掉。建议在 SSE `onSpeechStart` 接受新 utteranceId 时顺带 `engineRef.current?.unmuzzle()`——新 turn 的音频天然不应被旧 muzzle 压制，语义上无论如何都成立。

### S7. asr.ts 顶部帧头文档注释与代码不符（代码是对的）
注释写 full client `0x11 0x10 0x01 0x00`、audio `0x11 0x20 0x01 0x00`、last `0x11 0x22 0x01 0x00`；代码实际发 full `[0x11, 0x11, 0x11, 0x00]`（flags=seq 位 + JSON/gzip 序列化位）、audio `0x21`、last `0x23`。实现经真实端点实测验证为正确，注释缺 flags 位、serialization 位也写错——后来者按注释改代码必坏。修注释即可。

### S8. micLevel 以 ~94Hz 触发全视图重渲染
worklet 每 4 个 128-sample block（≈10.7ms @48k）post 一次 level → `setMicLevel` 每秒 ~94 次 → Live2DView 全树 diff 94 次/秒（HUD、字幕列表、表单全量）。移动端耗电卡顿。量表 CSS transition 80ms 本身平滑，主线程节流到 10–15Hz（时间戳门控或 rAF）视觉无差异。

---

## 非阻塞（知悉/择机处理）

### N1. ws 'message' 的 data 可能是 Buffer[]（分片帧）
`parseFrame(data)` 未做 `Array.isArray(data) ? Buffer.concat(data) : data` 归并；分片帧会走"unknown message type"静默跳过，最终以 "connection closed before a result" 报错。火山服务端大概率不分片，失败模式也可接受（有 toast、有 20s 兜底），加一行归并更稳。

### N2. 双 MicState 定义
`src/client/types.ts` 与 `src/client/mic.ts` 各导出一份结构相同的 `MicState`，两处真相源。收敛到一处 import。

### N3. styles.ts 中 `.lv-langs`/`.lv-lang` 定义了两遍
popover 段（+flex/nowrap 版）与「language pills」段（后定义，padding/颜色覆盖前者）重复且相互覆盖，实际生效的是拼合结果。遗留迭代产物，合并去重。

### N4. `lv-muted-dot` 是未定义的死 CSS 类
view.tsx micbar 圆点拼了 `lv-muted-dot`，styles.ts 无此规则 → AI 说话时圆点无变化。删掉或补样式（现状无视觉依赖，纯死代码）。

### N5. requesting 态双击 🎙 的复活竞态
请求权限期间再点按钮 → stopListening（micRef 为 null，实际停不掉 pending 的 getUserMedia）→ 权限授予后 `micRef.current = mic; setMicState("listening")` 复活麦克风。低概率；可在 `await mic.start()` 后校验开关世代再采纳。

### N6. 多 segment 提交顺序可能倒挂
各 segment 独立 fetch，Volc 时延抖动可能令第 2 句先于第 1 句提交（queue 模式下消息顺序颠倒）。VAD 串行化 + 时延差异小，概率低；要彻底解决可按 segment 序号串行提交（链式 promise）。

### N7. HTTP 语义小疵
`readRawBody` 超限抛 "body too large" 被外层统一 500（语义应 413）；客户端中断后 `writeJson` 写已销毁响应与 Phase 1 同 pattern，未见实际问题。可不改。

### N8. 假阳性 barge 永久静音当前 turn
咳嗽/撞门触发 barge（VAD 开启 + 瞬时电平 >0.03）时 `activeUtterance=""` 不可恢复，当前 turn 后续语音永久丢弃且无新输入顶替；字幕（不经 utterance 门控）继续出 → "哑巴但出字"。设计取舍可接受，如要更稳可在 ASR 空结果时恢复 gate（复杂度不值得，记录即可）。

### N9. e2e 覆盖与文档缺口
- verify-voice.mjs 注释 "see docs for regeneration" 指向不存在：docs/features 只有 Phase 1 文档，`/tmp/t-*-16k.pcm` 再生方法无处可查；
- 「回声场景」实际只验证了非回声放行（L4：AI 播放中喂 ja 且文本≠角色台词 → 通过回声判定提交），**回声被丢弃路径（looksLikeEcho=true → drop）未覆盖**；
- 模块冒烟 7/7、路由冒烟 5/5 的脚本未入库（仅 verify-voice.mjs），仓库内不可复现。
建议随 Phase 2 summary/validation 文档一并补齐。

### N10. 输入框与 micbar 同 bottom:196px，同开时重叠
input（z9）整块盖住 micbar（z8）。纯视觉小疵。

---

## 已验证项（正面确认）

| 项 | 结论 |
| --- | --- |
| typecheck | 本机复跑通过 ✓ |
| lib/ 产物新鲜度 | 按 build.mjs 参数在 /tmp 重建，host/client 两产物与工作树**逐字节一致** ✓ |
| ws 依赖 | dependencies 声明 + node_modules 实装 8.21.3 + lockfile 更新 + host build external ✓（符合 dev-dsh-plugin 铁律） |
| asr.ts 帧协议 | 快灌+负包收尾、isLast 结算、close-with-text 兜底、settled 防重入、20s 总超时 + 15s 握手超时、错误帧 code+payload 解析、坏帧 catch 跳过不杀会话——边界处理完备；实现有真实端点冒烟背书（注释错误见 S7） |
| mic.ts 分句状态机 | 预滚无缺口（attack 窗帧含入 segment）、20s 强切后无缝续段（强制切段后的帧进 preRoll 并入下段）、release 定时器 + lastSpeechAt 双重校验正确、hysteresis 开闭阈值合理、stop() 吐出进行中段落 ✓ |
| muzzle/unmuzzle 主路径 | 三个释放点覆盖全部常规流（识别空文本/回声丢弃/提交失败均走 finally）；所有新 turn 必经 submitText → unmuzzle ✓（边角见 S6） |
| barge→steer 决策 | running||speaking → steer，否则 queue；barge 先 stop 当前句、VAD 确认后再 muzzle 的两段式合理 ✓ |
| routes 输入校验 | 方法检查、2MB/3200B 上下界、lang 白名单化映射（未知 id 落 auto，无注入面）、凭证缺失前置 500 ✓ |
| config 默认值 | auto/ja/zh 组合自洽，speechLanguage auto→无指令行的降级正确（升级断裂见 S4） |
| bundle 体积 | client.js 643,943→654,724 B（+10.8KB / +1.7%），host index.js +9.6KB；mic.ts worklet 以字符串内联、ws 不进浏览器包——影响可接受 ✓ |
| 真机限制声明 | 容器无音频硬件、e2e 用同 context 假麦克风注入、真实麦克风留待真机——README/注释已如实注明 ✓ |

## 检视重点逐项回应

1. **asr.ts 帧协议与边界**：实现正确且健壮（见上表）；两个小瑕疵——文档注释与代码不符（S7）、分片帧未归并（N1）。
2. **mic.ts 分句状态机**：预滚/强切/stop 吐段全对；降采样用请求 48k 上下文保证整数比（构造失败会抛错被 catch 捕获），无隐藏采样率风险；注释说 "first-order IIR" 实为 boxcar 平均（措辞小误，随 S3 顺手改）。
3. **view.tsx 并发与竞态**：主路径闭合；四个边角——回声误杀短句（S1）、ref 跨 flight 覆盖（S2）、悬挂 muzzle（S6）、segment 乱序提交（N6）。
4. **routes.ts 输入校验**：完备（N7 语义小疵除外）。
5. **config 默认值**：新装体验合理；升级迁移是盲区（S4/S5）。
6. **客户端 bundle 体积**：+1.7%，可接受。
