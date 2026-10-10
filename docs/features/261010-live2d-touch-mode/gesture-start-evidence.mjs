#!/usr/bin/env node
/**
 * 两件事（261010，验收前置的证据补强）：
 *   A. headless 帧率能不能抬起来：带 `--disable-frame-rate-limit --disable-gpu-vsync` 时实测 rAF 帧率。
 *      （若能到几十 fps，"不跳变"断言的可探测下限就能从 ~10° 压到 1–2°；起不来就写明白下限。）
 *   B. **idle 行的直接观测**：待机动画在播（idleInterval=8）时从空闲发起一次真实滑动，
 *      记录 (1) 返回值 lvGestureSeq 是否前进、(2) 300ms 内 `lvMotionBusy` 是否真的变成 `"1"`。
 *      只证"到达时没被拒"是不够的——必须证"动作真的起了"。
 *
 * 用法：dsh-e2e run docs/features/261010-live2d-touch-mode/gesture-start-evidence.mjs
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const FPS_FLAGS = String(process.env.FPS_FLAGS ?? '1') !== '0';
const SWIPES = Number(process.env.SWIPES ?? 6);

if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = () => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, {
    modelPath: '/root/.dsh/live2d-voice-models', modelSelection: 'izumi', liveMode: 'first',
    eyeTracking: false, gyroParallax: false, idleInterval: 8, touchMode: true,
  });
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const args = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'];
if (FPS_FLAGS) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding');

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args,
});

try {
  pin();
  const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
  const { sessionId } = await fetch(`${ORIGIN}/live2d-voice/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: '/root' }),
  }).then((r) => r.json());
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForTimeout(2500);

  console.log(`== A. 帧率（FPS_FLAGS=${FPS_FLAGS ? 'on' : 'off'}）==`);
  const fps = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(n / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(tick);
  }));
  console.log(`rAF 实测 ≈ ${fps.toFixed(1)} fps（2s 采样）\n`);

  const read = () => page.evaluate(() => {
    const st = document.querySelector('.lv-stage');
    return { seq: Number(st?.dataset?.lvGestureSeq ?? 0), busy: st?.dataset?.lvMotionBusy ?? null, value: st?.dataset?.lvGesture ?? null };
  });
  const waitIdle = async (capMs = 8000) => {
    const d = Date.now() + capMs;
    while (Date.now() < d) { if ((await read()).busy === '0') return true; await page.waitForTimeout(50); }
    return false;
  };

  const box = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const sx = box.x + box.w * 0.5;
  const sy = box.y + box.h * 0.4;
  const swipe = (dx) => page.evaluate(async ([fx, fy, ddx]) => {
    const stage = document.querySelector('.lv-stage');
    const ev = (t, x, y) => stage.dispatchEvent(new PointerEvent(t, {
      pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
      buttons: t === 'pointerup' ? 0 : 1,
    }));
    ev('pointerdown', fx, fy);
    await new Promise((r) => setTimeout(r, 40));
    for (let k = 1; k <= 5; k++) ev('pointermove', fx + (ddx * k) / 5, fy);
    ev('pointerup', fx + ddx, fy);
  }, [sx, sy, dx]);

  console.log('== B. idle 行的直接观测（待机动画在播；每次从 busy=0 起手）==');
  let ok = 0;
  for (let i = 0; i < SWIPES; i++) {
    if (!(await waitIdle())) { console.log(`第 ${i + 1} 次：等空闲超时，跳过`); continue; }
    const before = await read();
    await swipe(i % 2 === 0 ? 160 : -160);
    // 返回值面：seq 是否前进（最多等 1.5s）
    let seqAdvanced = false, seqMs = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) {
      const now = await read();
      if (now.seq > before.seq) { seqAdvanced = true; seqMs = Date.now() - t0; break; }
      await page.waitForTimeout(10);
    }
    // 播放面：300ms 内 busy 是否变 1
    let busyTurnedOn = false, busyMs = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 300) {
      const now = await read();
      if (now.busy === '1') { busyTurnedOn = true; busyMs = Date.now() - t1; break; }
      await page.waitForTimeout(10);
    }
    if (seqAdvanced && busyTurnedOn) ok += 1;
    console.log(`第 ${i + 1} 次：返回值(seq前进)=${seqAdvanced ? `Y(${seqMs}ms)` : 'N'} 300ms内busy→1=${busyTurnedOn ? `Y(${busyMs}ms)` : 'N'}`);
    await waitIdle();
  }
  console.log(`\n判读：${ok}/${SWIPES} 次"返回值 true **且** 动作真的进入播放态" ⇒ ${ok === SWIPES ? 'idle 行不只是"没被拒"，动作确实起了' : '存在只返回 true 却没真的播的情况，需要查'}`);
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}
