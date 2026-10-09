# 验证报告：261010 Live2D 交互补齐（点击互动 · 空闲调度 · 动作音效）

被测提交：worktree `feat/live2d-interaction`（P1 提交 `c90c23a` + 检视跟进改动）。
环境：`dsh-e2e` 隔离实例（worktree home、动态端口、零真实 API：空会话 + standalone 入口）；模型库 `/root/.dsh/live2d-voice-models`。

## 一、功能项

| 项 | 方法 | 结果 |
|---|---|---|
| 点击命中 HitAreas → 播对应 Tap 动作 | `verify-tap` T1a/T1b（haru，Head/Body） | ✓ `lvTap = "Body:Tap"` |
| 点画布空白不响应 | T1c（远角点击后 `lvTap` 不变） | ✓ |
| 无 HitAreas 的模型按可见包围盒判定 | T2a/T2b（tsumiki：盒内 `body:Tap`；盒外不响应） | ✓ |
| 拖动不误判为点击、拖动仍平移 | T3a/T3b（200px 拖拽：`lvTap` 不变、`lvTransform` 0,0,1.000 → 200,60,1.000） | ✓ |
| 动作自带音效不再播放/不再请求 | T4：hibiki（其 Idle 动作自带 `sounds/*.wav`，且文件真实存在）、`idleInterval=2`、观察窗口 9s；计数口径 = 页面发出的 `/sounds/*.(wav|mp3|ogg|m4a)` 请求**条数** = 0（修复前同一模型默认节奏下 20s 内实测 3 条） | ✓ |
| 空闲节奏契约 | T5a/T5b：`dataset.lvIdleInterval` = 调度器每 1s tick 时**实际生效的间隔秒数**（不是起播次数）；megumin（无 `Idle` 组、配置 20s）→ `6`；haru（有 `Idle` 组、配置 20s）→ `20` | ✓ |
| 无页面错误 | T6（整轮套件 `pageerror` 数 = 0） | ✓ |
| 空闲调度确实会起播动作 | 临时埋点诊断（已移除、已重新构建）：megumin / `idleInterval=20` / 窗口 14s，`playMotion(pick, "idle")` 返回 `started=true`（`00_Wait_01`）；同模型第二次请求在动作未结束时 `started=false`，正是 `MotionState.reserve` 的 IDLE 规则 | ✓ |
| 回归：参数解析 | `verify-param-ids` 9/9（tsumiki/hiyori/zongzi 三个真实模型 + 5 条纯函数断言） | ✓ |
| 回归：视线数学 | `verify-look-math` 17/17 | ✓ |
| 回归：点击套件在最终产物上复跑 | `verify-tap` 11/11（去掉临时埋点、重建 lib 之后再跑一遍） | ✓ |

构建：`npm run typecheck` 通过、`node build.mjs` 产出 `lib/{index,client,standalone}.js`。

## 二、未覆盖与说明

- **独立体验验收未完成**：e2e-tester 跑到 04:22 之后 11 分钟无任何产出、常驻 11 个 chromium（本机可用内存只剩 ~2.7G），按预算终止（这是环境资源问题，不是结论）。因此"主观手感"一层由我做过的像素/请求级检查替代（无怪声、空闲会动、点击有反应），**最终手感建议用户真机点一点**。
- **第三人称套件未跑**：`verify-third-person` 含需要真实 TTS 的既知失败项；P1 未改双人语义（`lvTap` 的 per-tag 契约与 `lvTransform` 同款），手势层新增的判定由 T3 的拖拽反例覆盖。
- **已知边界**：玩家化身没有独立的空闲调度（检视建议 S2，本轮明确不做）；`Flick*`/`Shake` 划动手势不在本批（已排入触摸模式需求 commit B）。

## 三、干净实例复跑（261010 补证）

按 auto-human 要求，在机器安静下来后在**干净的隔离实例**上复跑一次三套件，证据留档：

| 项 | 值 |
|---|---|
| 实例 | worktree `.dsh-e2e-home`、动态端口 **61374**、`dsh-e2e start --wait-ready` |
| 复跑前机器状态 | `uptime` load average 0.00/0.02/0.00；可用内存 2292 MB；常驻 chromium **0** |
| 复跑后机器状态 | 常驻 chromium **0**；`dsh-e2e stop` → "清理干净 / 实例已停止"；可用内存 2071 MB |
| 配置还原 | `live2d-voice.json` 复跑前后 `md5 = 1dc68c3c70dac2466526481fba8150d8`，`cmp` 字节一致 |
| 结果 | verify-tap **11/11**、verify-param-ids **9/9**、verify-look-math **17/17**（均 `退出码 0`） |
| 零真实 API | 空会话（`POST /live2d-voice/session`）+ standalone 入口；不发送任何消息 |

## 四、用户真机验收清单（替代独立体验验收层）

独立 e2e-tester 因环境资源卡死未产出结论（见 §二）。请在自己的会话里按下面 5 条点一遍，任一条不成立就回退本次改动：

1. **点击命中**：点角色（头/身体）→ 有动作反应；连续点多下不会卡死。
2. **点空白无反应**：点画布空白处 → 角色不动（这是刻意的：通话视图里乱播动作出戏）。
3. **拖动仍是拖动**：按住拖动 200px 左右 → 模型平移、**不**误触发动作；滚轮/双指缩放正常；双击复位。
4. **空闲会动**：静置 → 有 `Idle` 组的角色按 `idleInterval` 节奏动；没有 `Idle` 组的拆包模型（如素晴日系列）最多 6 秒动一次，不再像立牌。⚠️ **动作音效已全局关闭**：模型自带的动作语音不再播放（避免通话中角色随机说模型附带的录音）。
5. **无怪声**：静置几分钟，除 TTS 外不应出现任何模型自带的音频。

## 五、结论

**自动化层面通过，独立体验验收待补 / 用户真机确认**：检视准入无阻塞项（两条建议均已处理）；最终产物上 tap 11/11、参数解析 9/9、视线数学 17/17，并在干净实例（端口 61374）复跑一致。用户可见的手感部分（§四）以真机点一遍为准。
