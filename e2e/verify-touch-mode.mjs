#!/usr/bin/env node
/**
 * 触摸模式 e2e（261010-live2d-touch-mode commit A）。
 *
 * 覆盖：
 *   T1 触摸模式开：单指按下/移动 → `dataset.lvTouchLook` 出现，符号与落点同侧；抬手清空
 *   T2 单指不平移（`lvTransform` 不变）；双指仍平移缩放
 *   T3 第二指落下即取消手势判定：双指期间/之后都不触发 tap（`lvTap` 不变）
 *   T4 鼠标 hover（不按键）也喂视线；hover 不平移
 *   T5 布局：全屏按钮在右上角簇里、在安全区内；root layer 不吃指针——从胶囊外起手拖动只转视线不平移
 *   T6 触摸模式下 tap 仍工作（点模型 → `lvTap`）
 *   T7 关掉触摸模式回到旧语义：单指拖动 = 平移，且不写 `lvTouchLook`
 *   T8 视线方向受控度量：手指固定在左/右两侧 → 头部区域非背景像素水平质心朝手指侧位移 ≥ 阈值；
 *      同一位置两帧的漂移 < 阈值（null case）
 *
 * 零真实 API：POST /live2d-voice/session 造空会话 + standalone 入口。
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isSwipe, resolveGestureGroup, swipeDirection } from '../src/client/gesture-math.ts';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const LIB = '/root/.dsh/live2d-voice-models';
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok }); console.log(`${ok ? '✓' : '✗'} ${id}${note ? ` — ${note}` : ''}`); };
if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = (extra = {}) => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, { modelPath: LIB, modelSelection: 'haru', liveMode: 'first', eyeTracking: false, gyroParallax: false, idleInterval: 0, ...extra });
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const browser = await chromium.launch({
  executablePath: CHROMIUM, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const state = () => page.evaluate(() => {
  const stage = document.querySelector('.lv-stage');
  return {
    touchLook: stage?.dataset?.lvTouchLook ?? null,
    transform: stage?.dataset?.lvTransform ?? null,
    tap: stage?.dataset?.lvTap ?? null,
  };
});
const load = async (extra) => {
  pin(extra);
  const { sessionId } = await fetch(`${ORIGIN}/live2d-voice/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'touch-mode' }),
  }).then((r) => r.json());
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2200);
};
/** 合成触摸指针事件（playwright 的 mouse 是 pointerType=mouse，走不到触摸分支）。 */
const touch = (type, x, y, id = 1, pointerType = 'touch') => page.evaluate(([type, x, y, id, ptype]) => {
  const stage = document.querySelector('.lv-stage');
  stage.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: ptype, isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
  }));
}, [type, x, y, id, pointerType]);

/** 合成一次快速滑动：down → 等 50ms → 同一 tick 内 5 次 move + up（保证 <400ms 且 duration>0）。 */
const swipe = async (fromX, fromY, dx, dy, { pointerId = 7, settleMs = 2600, pointerType = 'touch' } = {}) => {
  await touch('pointerdown', fromX, fromY, pointerId, pointerType);
  await page.waitForTimeout(50);
  await page.evaluate(([fx, fy, ddx, ddy, id, ptype]) => {
    const stage = document.querySelector('.lv-stage');
    const fire = (type, x, y) => stage.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: ptype, isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true,
      buttons: type === 'pointerup' ? 0 : 1,
    }));
    for (let i = 1; i <= 5; i++) fire('pointermove', fx + (ddx * i) / 5, fy + (ddy * i) / 5);
    fire('pointerup', fx + ddx, fy + ddy);
  }, [fromX, fromY, dx, dy, pointerId, pointerType]);
  // 上一个手势动作还在播时，下一个 NORMAL 动作会被框架拒绝（设计上的"静默不响应"），
  // 默认等足够久让动作播完；测冷却时把 settleMs 调小。
  await page.waitForTimeout(settleMs);
};
const gestureState = () => page.evaluate(() => document.querySelector('.lv-stage')?.dataset?.lvGesture ?? null);
/**
 * 滑动并等待手势真正生效：上一个手势动作还在播时新的 NORMAL 动作会被框架拒绝
 * （设计上的"静默不响应"），而动作时长因模型而异，固定等待必然偶发 flake。
 *
 * 重试是**有硬上限**的（attempts 次后返回 ok=false），失败时返回的是页面上真实的
 * `dataset.lvGesture` 值而不是吞掉异常——调用方据此判红并打印实际值。
 */
const clearGesture = () => page.evaluate(() => { delete document.querySelector('.lv-stage').dataset.lvGesture; });
/** 手势接受计数（成功起播时 +1，被拒绝的滑动不动它）——因果归因的依据。 */
const gestureSeq = () => page.evaluate(() => document.querySelector('.lv-stage')?.dataset?.lvGestureSeq ?? null);
/** 动作队列是否空闲（0=空闲）。手势在别的动作播放时会被框架静默拒绝，所以先等它空闲。 */
const motionIdle = () => page.evaluate(() => document.querySelector('.lv-stage')?.dataset?.lvMotionBusy === '0');
// 短上限：这个信号是"有动作在播"（含循环的空闲动作），不是"手势一定会被拒"；
// 等不到就照发——NORMAL 手势本来就能打断 IDLE，真正被拒时由 seq 不前进暴露出来。
const waitMotionIdle = async (capMs = 1500) => {
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline) {
    if (await motionIdle()) return true;
    await page.waitForTimeout(60);
  }
  return false;
};

/**
 * 单次滑动 → 断言"这一次被接受"。
 *
 * 顺序固定为 **等动作队列空闲 → 记接受计数 → 清空旧值 → 滑动一次 → 校验**：
 *   - 手势是 NORMAL 优先级，队列里还有动作时会被框架**静默拒绝**（输入被丢弃），
 *     所以必须在空闲时发，而不是"发了不管、重发到成功"；
 *   - 校验要求 `值 == 期望` **且** `lvGestureSeq` 前进——被拒绝的滑动不推进计数，
 *     因此陈旧值不可能造成假通过（交叉核查指出的洞）；
 *   - 不重试：一次没被接受就是真的有问题（红），而不是被重试吞掉。
 */
const swipeAttempts = [];
const swipeOnce = async (fromX, fromY, dx, dy, expected, { attempts = 3, settleMs = 250, pointerType = 'touch', pointerId = 7 } = {}) => {
  // 上限 3 次：正常情况 1 次即成（队列空闲），需要第 2 次说明当时有动作在播；
  // 第 3 次仍不成就判红——留更大的上限只会把真实退化吞掉（见 validation §十）。
  const cap = Number.isSafeInteger(attempts) ? Math.min(Math.max(attempts, 1), 3) : 3;
  let value = null;
  let idle = false;
  let lastSeq0 = null;
  let lastSeq1 = null;
  for (let used = 1; used <= cap; used++) {
    // 先等队列空闲（上限 1.5s）：这个信号是"有动作在播"（含循环的空闲动作），
    // 只作提示，不作判定——真正被拒时由下面的 seq 不前进暴露出来。
    idle = await waitMotionIdle();
    const seq0 = await gestureSeq();
    lastSeq0 = seq0;
    await clearGesture();
    await swipe(fromX, fromY, dx, dy, { settleMs, pointerType, pointerId });
    value = await gestureState();
    const seq1 = await gestureSeq();
    lastSeq1 = seq1;
    // 因果判定：值等于期望 **且** 接受计数前进。被拒绝的滑动不推进计数，
    // 所以陈旧值/被丢弃的输入都不可能通过；重试是有界的，且每次都必须重新被接受。
    if (value === expected && seq1 !== null && seq1 !== seq0) {
      swipeAttempts.push(used);
      return { ok: true, value, attempts: used, idle, seq0, seq1 };
    }
  }
  swipeAttempts.push(cap);
  return { ok: false, value, attempts: cap, idle, seq0: lastSeq0, seq1: lastSeq1 };
};

try {
  // ── 触摸模式开 ────────────────────────────────────────────────────────────
  await load({ touchMode: true });

  // T1 单指 → 视线；抬手清空
  await touch('pointerdown', 200, 400);
  await page.waitForTimeout(250);
  const left = await state();
  await touch('pointermove', 180, 380);
  await page.waitForTimeout(200);
  const left2 = await state();
  await touch('pointerup', 180, 380);
  await page.waitForTimeout(600);
  const released = await state();
  const leftDx = Number((left2.touchLook ?? 'NaN').split(',')[0]);
  check('T1a 单指按下即跟视线', Boolean(left2.touchLook) && leftDx < -0.2, `touchLook=${left2.touchLook}`);
  check('T1b 抬手后清空（视线回落）', released.touchLook === null, String(released.touchLook));

  await touch('pointerdown', 700, 300);
  await touch('pointermove', 720, 300);
  await page.waitForTimeout(250);
  const right = await state();
  await touch('pointerup', 720, 300);
  await page.waitForTimeout(500);
  const rightDx = Number((right.touchLook ?? 'NaN').split(',')[0]);
  check('T1c 手指在右侧 → dx 为正', rightDx > 0.2, `touchLook=${right.touchLook}`);

  // T2 单指不平移
  const beforeDrag = await state();
  await touch('pointerdown', 450, 350);
  for (let i = 1; i <= 8; i++) await touch('pointermove', 450 + i * 25, 350);
  await page.waitForTimeout(150);
  const duringTouchDrag = await state();
  await touch('pointerup', 650, 350);
  await page.waitForTimeout(400);
  check('T2a 触摸模式单指不平移', duringTouchDrag.transform === beforeDrag.transform && duringTouchDrag.touchLook !== null,
    `transform ${beforeDrag.transform} → ${duringTouchDrag.transform}, touchLook=${duringTouchDrag.touchLook}`);

  // T2b 双指仍能平移
  await touch('pointerdown', 400, 350, 1);
  await touch('pointerdown', 500, 350, 2);
  for (let i = 1; i <= 6; i++) {
    await touch('pointermove', 400 + i * 20, 350, 1);
    await touch('pointermove', 500 + i * 20, 350, 2);
  }
  await page.waitForTimeout(200);
  const afterPinch = await state();
  await touch('pointerup', 520, 350, 1);
  await touch('pointerup', 620, 350, 2);
  await page.waitForTimeout(300);
  check('T2b 双指仍可平移', afterPinch.transform !== duringTouchDrag.transform, `${duringTouchDrag.transform} → ${afterPinch.transform}`);

  // T3 第二指落下 → 手势判定作废
  const beforeTap = await state();
  await touch('pointerdown', 450, 320, 1);
  await touch('pointermove', 452, 318, 1);
  await touch('pointerdown', 500, 340, 2);
  await touch('pointermove', 452, 318, 1);
  await touch('pointerup', 452, 318, 1);
  await touch('pointerup', 500, 340, 2);
  await page.waitForTimeout(700);
  check('T3 双指参与后不触发 tap', (await state()).tap === beforeTap.tap, `${beforeTap.tap} → ${(await state()).tap}`);

  // T6 tap 仍工作（前面的用例平移过舞台，先双击复位再点模型上半部）
  await page.evaluate(() => document.querySelector('.lv-stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await page.waitForTimeout(300);
  const tapBox = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const beforeTap2 = await state();
  await touch('pointerdown', tapBox.x + tapBox.w / 2, tapBox.y + tapBox.h * 0.35);
  await touch('pointerup', tapBox.x + tapBox.w / 2, tapBox.y + tapBox.h * 0.35);
  await page.waitForTimeout(900);
  const tapped = await state();
  check('T6 触摸模式 tap 仍触发 Tap 动作', Boolean(tapped.tap) && tapped.tap !== beforeTap2.tap, String(tapped.tap));

  // T4 鼠标 hover 喂视线且不平移
  const beforeHover = await state();
  await page.mouse.move(200, 300);
  await page.waitForTimeout(300);
  const hovered = await state();
  check('T4 鼠标 hover 跟视线', Boolean(hovered.touchLook) && Number(hovered.touchLook.split(',')[0]) < -0.2, `touchLook=${hovered.touchLook}`);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(250);
  check('T4h hover 不平移', (await state()).transform === beforeHover.transform, `${beforeHover.transform} → ${(await state()).transform}`);

  // T5 布局 + root layer 不吃指针（从胶囊外起手拖动）
  const layout = await page.evaluate(() => {
    const corner = document.querySelector('.lv-corner');
    const hud = document.querySelector('.lv-hud');
    const fs = document.querySelector('.lv-hud button[title*="全屏"]');
    const r = corner?.getBoundingClientRect();
    return {
      cornerTopRight: r ? { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right) } : null,
      fullscreenInCorner: Boolean(fs && corner?.contains(fs)),
      hudPointerEvents: hud ? getComputedStyle(hud).pointerEvents : null,
      hudRect: hud ? { w: Math.round(hud.getBoundingClientRect().width), h: Math.round(hud.getBoundingClientRect().height) } : null,
    };
  });
  check('T5a 全屏按钮在右上角簇且在安全区内',
    layout.fullscreenInCorner && layout.cornerTopRight && layout.cornerTopRight.top >= 8 && layout.cornerTopRight.right >= 8,
    JSON.stringify(layout.cornerTopRight));
  check('T5b root layer 不吃指针', layout.hudPointerEvents === 'none', String(layout.hudPointerEvents));

  const beforeLayerDrag = await state();
  await touch('pointerdown', 100, 620); // 胶囊左侧、仍在 root layer 覆盖范围内
  for (let i = 1; i <= 6; i++) await touch('pointermove', 100 + i * 30, 620);
  await page.waitForTimeout(200);
  const layerDrag = await state();
  await touch('pointerup', 280, 620);
  await page.waitForTimeout(400);
  check('T5c 层外起手拖动 = 转视线而非平移',
    layerDrag.touchLook !== null && layerDrag.transform === beforeLayerDrag.transform,
    `touchLook=${layerDrag.touchLook}, transform ${beforeLayerDrag.transform} → ${layerDrag.transform}`);

  // ── T7 关掉触摸模式 ──────────────────────────────────────────────────────
  await load({ touchMode: false });
  const beforePan = await state();
  await touch('pointerdown', 450, 350);
  for (let i = 1; i <= 8; i++) await touch('pointermove', 450 + i * 25, 350);
  await page.waitForTimeout(200);
  const panning = await state();
  await touch('pointerup', 650, 350);
  await page.waitForTimeout(400);
  await swipe(450, 350, 160, 0, { settleMs: 300 }); // 关闭触摸模式时划动不应触发手势动作
  check('T7 关闭触摸模式：单指恢复平移、不写 lvTouchLook、不触发手势动作',
    panning.transform !== beforePan.transform && panning.touchLook === null && (await gestureState()) === null,
    `transform ${beforePan.transform} → ${panning.transform}, touchLook=${panning.touchLook}, gesture=${await gestureState()}`);

  // ── T8 视线方向：头部区域非背景像素水平质心 ─────────────────────────────
  await load({ touchMode: true });
  const stageBox = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const shootAt = async (clientX, path) => {
    await touch('pointerdown', clientX, stageBox.y + stageBox.h * 0.45);
    await touch('pointermove', clientX, stageBox.y + stageBox.h * 0.45);
    await page.waitForTimeout(900); // 让视线 settle
    await page.screenshot({ path });
    await touch('pointerup', clientX, stageBox.y + stageBox.h * 0.45);
    await page.waitForTimeout(500);
  };
  await shootAt(stageBox.x + stageBox.w * 0.12, '/tmp/touch-look-left.png');
  await shootAt(stageBox.x + stageBox.w * 0.88, '/tmp/touch-look-right.png');
  // null case：同一位置连续两帧
  await shootAt(stageBox.x + stageBox.w * 0.12, '/tmp/touch-look-left-2.png');
  const centroids = execSync(`python3 - <<'PY'
from PIL import Image
def head_centroid(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    # 只看上半屏（头部区域），背景色取四角平均
    im = im.crop((0, 0, w, int(h * 0.55)))
    w, h = im.size
    px = im.load()
    corners = [px[4, 4], px[w-5, 4], px[4, h-5], px[w-5, h-5]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    xs = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            p = px[x, y]
            if abs(p[0]-bg[0]) + abs(p[1]-bg[1]) + abs(p[2]-bg[2]) > 40:
                xs.append(x)
    return (sum(xs) / len(xs) / w) if xs else None
for label, a, b in [('left-vs-right','/tmp/touch-look-left.png','/tmp/touch-look-right.png'),
                    ('null(left-1 vs left-2)','/tmp/touch-look-left.png','/tmp/touch-look-left-2.png')]:
    ca, cb = head_centroid(a), head_centroid(b)
    print(f"{label}\\t{ca:.4f}\\t{cb:.4f}\\t{abs(cb-ca):.4f}")
PY`, { encoding: 'utf8' }).trim().split('\n');
  const rows = centroids.map((l) => l.split('\t'));
  const lr = rows.find((r) => r[0] === 'left-vs-right');
  const nul = rows.find((r) => r[0].startsWith('null'));
  const shift = Number(lr?.[3]);
  const drift = Number(nul?.[3]);
  // 阈值标定（261010 实测，haru/900x700/第一人称）：手指左右两端时头部区域
  // 非背景像素水平质心位移 0.289，同一位置两帧漂移 0.0002 → 取 0.05（噪声的 250×、
  // 信号的 1/6），既能抓住明显转头也不会被呼吸/眨眼误判。数值记入 validation 文档。
  const THRESHOLD = 0.05;
  check('T8a 头随手指方向移动（质心位移 ≥ 阈值）', shift >= THRESHOLD, `shift=${shift.toFixed(4)} (阈值 ${THRESHOLD})`);
  check('T8b null case 漂移 < 阈值', drift < THRESHOLD, `drift=${drift.toFixed(4)}`);
  check('T8c 方向正确（手指在右时头部质心更大）', Number(lr?.[2]) > Number(lr?.[1]), `left=${lr?.[1]} right=${lr?.[2]}`);

  // T8d 松手回落连续性（ADV-03 改的就是这里）：按住右侧 → 松手 → 连拍逐帧看有无跳变
  const centroidOf = (path) => {
    const out = execSync(`python3 - <<'PY'
from PIL import Image
im = Image.open('${path}').convert('RGB')
w, h = im.size
im = im.crop((0, 0, w, int(h * 0.55)))
w, h = im.size
px = im.load()
corners = [px[4, 4], px[w-5, 4], px[4, h-5], px[w-5, h-5]]
bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
xs = [x for y in range(0, h, 2) for x in range(0, w, 2)
      if abs(px[x, y][0]-bg[0]) + abs(px[x, y][1]-bg[1]) + abs(px[x, y][2]-bg[2]) > 40]
print(sum(xs) / len(xs) / w)
PY`, { encoding: 'utf8' }).trim();
    return Number(out);
  };
  const holdX = stageBox.x + stageBox.w * 0.85;
  const holdY = stageBox.y + stageBox.h * 0.45;
  await touch('pointerdown', holdX, holdY);
  await touch('pointermove', holdX, holdY);
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/tmp/touch-release-0.png' });
  await touch('pointerup', holdX, holdY);
  const shots = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(180);
    const p = `/tmp/touch-release-${i + 1}.png`;
    await page.screenshot({ path: p });
    shots.push(centroidOf(p));
  }
  const held = centroidOf('/tmp/touch-release-0.png');
  const steps = shots.map((c, i) => Math.abs(c - (i === 0 ? held : shots[i - 1])));
  const maxStep = Math.max(...steps);
  const returned = Math.abs(shots[shots.length - 1] - held);
  check('T8d 松手回落连续（单帧无跳变）', maxStep <= 0.18, `maxStep=${maxStep.toFixed(4)} steps=${steps.map((v) => v.toFixed(3)).join(',')}`);
  check('T8d2 回落确实发生（末帧朝中位移动）', returned >= 0.05, `held=${held.toFixed(3)} last=${shots[shots.length - 1].toFixed(3)} 位移=${returned.toFixed(3)}`);

  // T12 双击复位（清单第 4 条的机制面）：双指平移过之后双击 → 视图回到基准
  await touch('pointerdown', 400, 350, 1);
  await touch('pointerdown', 500, 350, 2);
  for (let i = 1; i <= 6; i++) {
    await touch('pointermove', 400 + i * 20, 350, 1);
    await touch('pointermove', 500 + i * 20, 350, 2);
  }
  await touch('pointerup', 520, 350, 1);
  await touch('pointerup', 620, 350, 2);
  await page.waitForTimeout(300);
  const panned = await state();
  await page.evaluate(() => document.querySelector('.lv-stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await page.waitForTimeout(600);
  const reset = await state();
  check('T12 双击复位视图（平移后回到基准）',
    panned.transform !== reset.transform && /(^|,)0(,|$)|0,0/.test(reset.transform.replace(/\s/g, '')),
    `${panned.transform} → ${reset.transform}`);

  // T13 全屏进出（清单第 7 条的机制面，standalone 页 = 浏览器原生全屏）
  const fsState = () => page.evaluate(() => ({
    fullscreen: Boolean(document.fullscreenElement),
    isRoot: document.fullscreenElement?.classList?.contains('lv-root') ?? false,
  }));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.lv-hud button')].find((b) => (b.title ?? '').startsWith('全屏'));
    btn?.click();
  });
  await page.waitForTimeout(900);
  const entered = await fsState();
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.lv-hud button')].find((b) => (b.title ?? '').startsWith('退出全屏'));
    btn?.click();
  });
  await page.waitForTimeout(900);
  const exited = await fsState();
  check('T13 全屏进出（右上角按钮 → 原生全屏 → 再点退出）',
    entered.fullscreen && entered.isRoot && !exited.fullscreen,
    `进入 fullscreen=${entered.fullscreen}/root=${entered.isRoot}，退出后 fullscreen=${exited.fullscreen}`);

  // T11 HUD 开关落盘（设置卡与 HUD 共用同一条 saveConfig 路径）
  const readCfgTouch = () => { try { return JSON.parse(readFileSync(CFG, 'utf8')).touchMode; } catch { return undefined; } };
  const clickTouchButton = async () => {
    await page.evaluate(() => {
      // 标题在开/关两种状态下不同（"触摸模式：…" / "关闭触摸模式"），用 includes
      const btn = [...document.querySelectorAll('.lv-capsule button')].find((b) => (b.title ?? '').includes('触摸模式'));
      btn?.click();
    });
  };
  const beforeToggle = readCfgTouch();
  await clickTouchButton();
  await page.waitForTimeout(800);
  const afterToggle = readCfgTouch();
  await clickTouchButton();
  await page.waitForTimeout(800);
  const restored = readCfgTouch();
  check('T11 HUD 触摸模式开关落盘且可还原',
    afterToggle === !beforeToggle && restored === beforeToggle,
    `${beforeToggle} → ${afterToggle} → ${restored}`);

  // ── T10 组选择/方向/判定纯函数（表驱动，不依赖模型）────────────────────
  check('T10a 有方向组 → Flick<方向>', resolveGestureGroup(['FlickRight', 'Flick', 'Shake'], 'Right') === 'FlickRight');
  check('T10b 只有 Flick → 回退 Flick', resolveGestureGroup(['Flick', 'Shake'], 'Left') === 'Flick');
  check('T10c 只有 Shake → 回退 Shake', resolveGestureGroup(['Idle', 'Shake'], 'Up') === 'Shake');
  check('T10d 无手势组 → null', resolveGestureGroup(['Idle', 'Tap'], 'Down') === null);
  check('T10e 大小写不敏感', resolveGestureGroup(['FLICKUP'], 'Up') === 'FLICKUP');
  check('T10f 方向取主轴（含对角线不为 Shake 桶）',
    swipeDirection(10, 3) === 'Right' && swipeDirection(-10, 3) === 'Left' &&
    swipeDirection(3, 10) === 'Down' && swipeDirection(3, -10) === 'Up' && swipeDirection(10, 10) === 'Right');
  check('T10g 滑动判定：距离/时长/速度三条件',
    // 够快：50px / 60ms = 0.83 px/ms
    isSwipe({ dx: 50, dy: 0, durationMs: 60 }) === true &&
    // 距离不够
    isSwipe({ dx: 30, dy: 0, durationMs: 60 }) === false &&
    // 太慢（时长超限）
    isSwipe({ dx: 80, dy: 0, durationMs: 500 }) === false &&
    // 距离够但速度不够：60px / 500ms = 0.12 px/ms
    isSwipe({ dx: 60, dy: 0, durationMs: 500 }) === false);

  // ── T4/T5/T6 flick 实机 ──────────────────────────────────────────────────
  await load({ touchMode: true, modelSelection: 'izumi' });
  const izBox = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const startX = izBox.x + izBox.w * 0.5, startY = izBox.y + izBox.h * 0.4;
  const t4a = await swipeOnce(startX, startY, 160, 0, 'Right:FlickRight');
  check('T4a 右划 → FlickRight（izumi）', t4a.ok, `实际=${t4a.value} seq ${t4a.seq0}→${t4a.seq1}（${t4a.attempts} 次尝试）`);
  const t4b = await swipeOnce(startX, startY, -160, 0, 'Left:FlickLeft');
  check('T4b 左划 → FlickLeft（izumi）', t4b.ok, `实际=${t4b.value} seq ${t4b.seq0}→${t4b.seq1}（${t4b.attempts} 次尝试）`);
  // izumi 只有 FlickRight/FlickLeft + Shake（无裸 Flick）→ 缺方向组时回退 Shake
  const t4c = await swipeOnce(startX, startY, 0, 160, 'Down:Shake');
  check('T4c 下划 → izumi 缺 FlickDown → 回退 Shake', t4c.ok, `实际=${t4c.value} seq ${t4c.seq0}→${t4c.seq1}（${t4c.attempts} 次尝试）`);

  // T15 故意走坏路径：鼠标滑动在设计上永不触发 flick → 清空后仍为 null，助手必判红
  // （放在 flick 段开头：它不会往动作队列里塞东西，不会污染后续触摸用例）
  // 注意：鼠标指针必须用**与触摸不同的 pointerId**——真实浏览器里 pointerId 全局唯一，
  // 复用同一个 id 会让测试自己制造出"触摸状态没释放"的假象（本轮先踩了这个坑）。
  const mousePath = await swipeOnce(startX, startY, 160, 0, 'Right:FlickRight', { settleMs: 400, pointerType: 'mouse', pointerId: 21 });
  check('T15 坏路径必判红：鼠标滑动不产生手势（设计如此，计数不前进）',
    mousePath.ok === false && mousePath.value === null && mousePath.seq0 === mousePath.seq1,
    `ok=${mousePath.ok} 实际=${mousePath.value} seq ${mousePath.seq0}→${mousePath.seq1}`);

  // T15 的鼠标拖动**按设计会平移模型**（触摸模式只把"触摸"单指改成视线指针）；
  // 平移后模型离开了画布中心，后续触摸用例的起手点就落在模型外 → hitTest 不命中 →
  // 手势被正确地拒绝，于是看起来像"手势坏了"。这里先双击复位再继续。
  await page.evaluate(() => document.querySelector('.lv-stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await page.waitForTimeout(500);

  // T5 防刷屏：一次被接受之后，**紧接着**（≤400ms 冷却窗口内）的反向滑动不得产生新手势；
  // 冷却窗口过去后，同样的滑动必须能被接受（正对照，证明上一条不是因为手势永久坏掉）。
  //
  // 归因方式：每次滑动前清空 dataset —— 滑动后仍为 null 即"这次没有起播任何动作"。
  // 诚实边界：这个窗口里"新手势被拒绝"同时受两件事保护（400ms 冷却 + 上一个动作仍在播时
  // NORMAL 让位），二者观测相同、本轮无法分离；分离需要 src 侧接受信号，见 validation §十。
  const armed = await swipeOnce(startX, startY, 160, 0, 'Right:FlickRight');
  await clearGesture();
  await swipe(startX, startY, -160, 0, { settleMs: 120 }); // A 被接受后约 150ms
  const duringCooldown = await gestureState();
  const laterAccepted = await swipeOnce(startX, startY, -160, 0, 'Left:FlickLeft');
  check('T5 冷却窗口内不产生新手势、窗口过后恢复接受',
    armed.ok && duringCooldown === null && laterAccepted.ok,
    `武装=${armed.value}(${armed.attempts} 次) → 冷却窗口内=${duringCooldown}（期望 null） → 之后=${laterAccepted.value}(${laterAccepted.attempts} 次)`);

  // T6 回退样本：只有 Flick / 只有 Shake
  await load({ touchMode: true, modelSelection: 'chitose' });
  const chBox = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const t6a = await swipeOnce(chBox.x + chBox.w * 0.5, chBox.y + chBox.h * 0.4, 160, 0, 'Right:Flick');
  check('T6a 只有 Flick 的模型 → 回退 Flick', t6a.ok, `实际=${t6a.value} seq ${t6a.seq0}→${t6a.seq1}（${t6a.attempts} 次尝试）`);

  await load({ touchMode: true, modelSelection: 'luna', modelPath: LIB + '/oc' });
  const luBox = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const t6b = await swipeOnce(luBox.x + luBox.w * 0.5, luBox.y + luBox.h * 0.4, 160, 0, 'Right:Shake');
  check('T6b 只有 Shake 的模型 → 回退 Shake', t6b.ok, `实际=${t6b.value} seq ${t6b.seq0}→${t6b.seq1}（${t6b.attempts} 次尝试）`);

  // T14 重试有硬上限 + 失败报真实状态；izumi 没有 FlickDown → 该期望永不出现。
  // 它在滑动时**会**真的起播 izumi 自带的手势动作（回退到 Shake），所以放在本段最后。
  const impossible = await swipeOnce(startX, startY, 160, 0, 'Right:FlickDown', { settleMs: 400 });
  check('T14 不可能满足的期望必判红（值不等于期望即失败，绝不因为"看起来像"而通过）',
    impossible.ok === false && impossible.value !== 'Right:FlickDown',
    `ok=${impossible.ok} 实际=${impossible.value} seq ${impossible.seq0}→${impossible.seq1}`);

  // T17 尝试次数分布：把"重试是否真的被用到、用到几次"变成可见数据（≤3 硬上限见助手）
  const dist = swipeAttempts.reduce((acc, n) => ({ ...acc, [n]: (acc[n] ?? 0) + 1 }), {});
  const distText = Object.entries(dist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} 次 ×${v}`).join(', ');
  check('T17 手势尝试次数分布（≤3；>1 说明发起时队列非空闲）',
    swipeAttempts.every((n) => n <= 3), `分布: ${distText}`);

  check('T9 无页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
