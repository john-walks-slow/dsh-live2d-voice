#!/usr/bin/env node
/**
 * 手势"不应期"阈值扫描（261010，回答"上一下动作开始后多久，下一次滑动才会被接受"）。
 *
 * 为什么需要它：`gesture-busy.mjs` 的 gap 数据（~626ms / ~2013ms 两档）**是探针自己的节奏**——
 * 每轮滑动后的轮询循环在"被拒"时要跑满 1.5s 窗口、被接受时 ~150ms 就退出，于是 gap 变成了因变量，
 * 只能说明"两个采样点"，不能当边界。本探针改成**自变量驱动**：
 *
 *   1. 先等 `lvMotionBusy === "0"`（确保起始空闲）；
 *   2. 打"武装滑动"，以 5ms 粒度轮询 `lvGestureSeq` 前进的时刻 = **动作开始时刻 t0**；
 *   3. 等到 **t0 + t** 时打第二发（t 由 SWEEP 固定给出，与任何轮询无关）；
 *   4. 记录第二发在 1.5s 窗口内是否被接受、以及**发起瞬间**的 `lvMotionBusy`；
 *   5. 回到 1 等空闲，进入下一个 t。
 *
 * 每个 t 重复 TRIALS 次，交替方向。
 *
 * 用法：
 *   dsh-e2e run docs/features/261010-live2d-touch-mode/gesture-refractory.mjs
 *   SWEEP=800,1000,1200,1400,1600,1800 TRIALS=3 dsh-e2e run …
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const IDLE_INTERVAL = Number(process.env.IDLE_INTERVAL ?? 0);
const SWEEP = String(process.env.SWEEP ?? '800,1000,1200,1400,1600,1800').split(',').map(Number);
const TRIALS = Number(process.env.TRIALS ?? 3);
const ACCEPT_WINDOW_MS = 1500;
const ARM = String(process.env.ARM ?? 'auto').toLowerCase(); // auto | right | left | down（down 在 izumi 上回退为 4.13s 的 Shake）
const READY_K = 5;
const SAMPLE_MS = 100;

if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = () => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, {
    modelPath: '/root/.dsh/live2d-voice-models', modelSelection: 'izumi', liveMode: 'first',
    eyeTracking: false, gyroParallax: false, idleInterval: IDLE_INTERVAL, touchMode: true,
  });
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
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

  const busyNow = () => page.evaluate(() => document.querySelector('.lv-stage')?.dataset?.lvMotionBusy ?? null);
  const waitIdle = async (capMs = 8000) => {
    const d = Date.now() + capMs;
    while (Date.now() < d) { if ((await busyNow()) === '0') return true; await page.waitForTimeout(60); }
    return false;
  };

  let stable = 0;
  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline && stable < READY_K) {
    stable = (await busyNow()) === null ? 0 : stable + 1;
    await page.waitForTimeout(SAMPLE_MS);
  }
  if (stable < READY_K) { console.log('× 字段始终不稳定可读，放弃'); process.exit(1); }
  console.log(`就绪门通过（连续可读 ${READY_K} 次）；武装方向 = ${ARM}\n`);

  const box = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const sx = box.x + box.w * 0.5;
  const sy = box.y + box.h * 0.4;

  /** 打一发滑动：返回"动作开始时刻"（seq 前进）或 null（被拒）。 */
  const fire2 = async (dx, dy) => page.evaluate(async ([fx, fy, ddx, ddy, windowMs]) => {
    const stage = document.querySelector('.lv-stage');
    const seqBefore = Number(stage.dataset.lvGestureSeq ?? 0);
    const ev = (t, x, y) => stage.dispatchEvent(new PointerEvent(t, {
      pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
      buttons: t === 'pointerup' ? 0 : 1,
    }));
    ev('pointerdown', fx, fy);
    await new Promise((r) => setTimeout(r, 40));
    for (let k = 1; k <= 5; k++) ev('pointermove', fx + (ddx * k) / 5, fy + (ddy * k) / 5);
    const busyAtSwipe = stage.dataset.lvMotionBusy ?? null;
    const t0 = performance.now();
    ev('pointerup', fx + ddx, fy + ddy);
    while (performance.now() - t0 < windowMs) {
      if (Number(stage.dataset.lvGestureSeq ?? 0) > seqBefore) {
        return { accepted: true, startAt: performance.now(), busyAtSwipe, value: stage.dataset.lvGesture ?? null };
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    return { accepted: false, startAt: null, busyAtSwipe, value: null };
  }, [sx, sy, dx, dy, ACCEPT_WINDOW_MS]);

  const results = [];
  for (const t of SWEEP) {
    const row = { t, accept: 0, refuse: 0, refuseBusy1: 0, refuseBusy0: 0, samples: [] };
    for (let k = 0; k < TRIALS; k++) {
      // 1) 起始空闲  2) 武装一发（必须被接受，否则本次作废）  3) 精确等待 t 后打第二发
      if (!(await waitIdle())) { console.log(`t=${t} 第 ${k + 1} 次：起始非空闲，跳过`); continue; }
      const armDx = ARM === 'down' ? 0 : ARM === 'right' ? 160 : ARM === 'left' ? -160 : (k % 2 === 0 ? 160 : -160);
      const armDy = ARM === 'down' ? 160 : 0;
      const arm = await fire2(armDx, armDy);
      if (!arm.accepted) { console.log(`t=${t} 第 ${k + 1} 次：武装滑动被拒（起始态异常），跳过`); continue; }
      const target = arm.startAt + t;
      const waitMs = target - (await page.evaluate(() => performance.now()));
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      const second = await fire2(k % 2 === 0 ? -160 : 160, 0);
      row[second.accepted ? 'accept' : 'refuse'] += 1;
      if (!second.accepted) row[second.busyAtSwipe === '1' ? 'refuseBusy1' : 'refuseBusy0'] += 1;
      row.samples.push(`${second.accepted ? 'A' : 'R'}${second.busyAtSwipe === '1' ? '(busy1)' : '(busy0)'}`);
      console.log(`t=${String(t).padStart(4)}ms 第 ${k + 1} 次：第二发 ${second.accepted ? 'ACCEPT' : 'REFUSE'}（busy=${String(second.busyAtSwipe)}）`);
    }
    results.push(row);
  }

  console.log('\n== 扫描结果（自变量 t = 上一下动作开始 → 第二发，单位 ms）==');
  console.log(' t      | 接受 | 拒绝 | 其中"空闲却被拒" | 样本');
  for (const r of results) {
    console.log(`${String(r.t).padStart(6)}  | ${String(r.accept).padStart(4)} | ${String(r.refuse).padStart(4)} | ${String(r.refuseBusy0).padStart(16)} | ${r.samples.join(' ')}`);
  }
  const lastRefuse = [...results].reverse().find((r) => r.refuse > 0);
  const firstAccept = results.find((r) => r.accept > 0);
  console.log(`\n判读：仍有拒绝的最大 t = ${lastRefuse ? `${lastRefuse.t}ms` : '无'}；出现接受的最小 t = ${firstAccept ? `${firstAccept.t}ms` : '无'}`);
  console.log('（注意：headless 帧率≈2fps，动作状态每帧才更新一次，阈值分辨率约 ±0.5s；真机 60fps 会更细）');
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}
