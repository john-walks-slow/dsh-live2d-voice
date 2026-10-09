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
| 动作自带音效不再播放/不再请求 | T4（hibiki，空闲 9s 内 `.wav` 请求数 = 0；期间空闲动作跑了 ≥3 轮） | ✓ |
| 空闲节奏契约 | T5a/T5b（megumin 无 `Idle` 组 → 6s；haru 有 `Idle` 组 → 20s，`dataset.lvIdleInterval`） | ✓ |
| 无页面错误 | T6（整轮套件 `pageerror` 数 = 0） | ✓ |
| 空闲调度确实会起播动作 | 临时埋点诊断（已移除）：megumin 空闲调度输出 `[idle-play] <empty> 00_Wait_01 started=true`；同一模型第二次请求在动作未结束时返回 `started=false`（正是 `MotionState.reserve` 的 IDLE 规则） | ✓ |
| 回归：参数解析 | `verify-param-ids` 9/9（tsumiki/hiyori/zongzi 三个真实模型 + 5 条纯函数断言） | ✓ |
| 回归：视线数学 | `verify-look-math` 17/17 | ✓ |
| 回归：点击套件在最终产物上复跑 | `verify-tap` 11/11（去掉临时埋点、重建 lib 之后再跑一遍） | ✓ |

构建：`npm run typecheck` 通过、`node build.mjs` 产出 `lib/{index,client,standalone}.js`。

## 二、未覆盖与说明

- **独立体验验收未完成**：e2e-tester 跑到 04:22 之后 11 分钟无任何产出、常驻 11 个 chromium（本机可用内存只剩 ~2.7G），按预算终止（这是环境资源问题，不是结论）。因此"主观手感"一层由我做过的像素/请求级检查替代（无怪声、空闲会动、点击有反应），**最终手感建议用户真机点一点**。
- **第三人称套件未跑**：`verify-third-person` 含需要真实 TTS 的既知失败项；P1 未改双人语义（`lvTap` 的 per-tag 契约与 `lvTransform` 同款），手势层新增的判定由 T3 的拖拽反例覆盖。
- **已知边界**：玩家化身没有独立的空闲调度（检视建议 S2，本轮明确不做）；`Flick*`/`Shake` 划动手势不在本批（已排入触摸模式需求 commit B）。

## 三、结论

**准予合并**：检视准入无阻塞项（两条建议均已处理），三项套件在最终产物上全绿（11/11 + 9/9 + 17/17），行为验证覆盖了本批全部用户可见改动。
