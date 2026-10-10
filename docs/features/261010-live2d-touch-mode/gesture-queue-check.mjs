#!/usr/bin/env node
/**
 * "拒绝"到底是**丢弃**还是**排队**？ACCEPT 到底是**返回值 true** 还是**真的在播**？
 * （261010，抢占方案的前置钉子 #1）
 *
 * 本探针在每个 t 上记录**两个互相独立的量**：
 *   A. 返回值面：`lvGestureSeq` 是否前进（产品只在 `motion()` 的 Promise 返回 true 时才写它）；
 *   B. 实际播放面：滑动之后 `lvMotionBusy` 是否真的变成 `"1"`（动作成为当前动作）；
 *   C. 排队面：被拒之后**再等 3s**，`lvGestureSeq`/`lvGesture` 是否迟到出现（若出现 ⇒ 是排队不是丢弃）。
 *
 * 记录表：t | seq前进(返回值) | busy在1s内变1(真的在播) | 3s内迟到出现(排队)
 *
 * 用法：dsh-e2e run docs/features/261010-live2d-touch-mode/gesture-queue-check.mjs
 *      SWEEP=200,600,1000,1400,1800,2100 TRIALS=2 dsh-e2e run …
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const SWEEP = String(process.env.SWEEP ?? '200,600,1000,1400,1800,2100').split(',').map(Number);
const TRIALS = Number(process.env.TRIALS ?? 2);
const LATE_WINDOW_MS = 3000;
const READY_K = 5;
const SAMPLE_MS = 100;

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

  const readStage = () => page.evaluate(() => {
    const st = document.querySelector('.lv-stage');
    return { seq: Number(st?.dataset?.lvGestureSeq ?? 0), busy: st?.dataset?.lvMotionBusy ?? null, value: st?.dataset?.lvGesture ?? null };
  });
  const waitIdle = async (capMs = 8000) => {
    const d = Date.now() + capMs;
    while (Date.now() < d) { if ((await readStage()).busy === '0') return true; await page.waitForTimeout(60); }
    return false;
  };

  let stable = 0;
  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline && stable < READY_K) {
    stable = (await readStage()).busy === null ? 0 : stable + 1;
    await page.waitForTimeout(SAMPLE_MS);
  }
  if (stable < READY_K) { console.log('× 字段始终不稳定可读，放弃'); process.exit(1); }
  console.log(`就绪门通过；t 扫描 = ${SWEEP.join(', ')}ms；每档 ${TRIALS} 次\n`);

  const box = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const sx = box.x + box.w * 0.5;
  const sy = box.y + box.h * 0.4;

  const swipe = async (dx) => page.evaluate(async ([fx, fy, ddx]) => {
    const stage = document.querySelector('.lv-stage');
    const ev = (t, x, y) => stage.dispatchEvent(new PointerEvent(t, {
      pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
      buttons: t === 'pointerup' ? 0 : 1,
    }));
    ev('pointerdown', fx, fy);
    await new Promise((r) => setTimeout(r, 40));
    for (let k = 1; k <= 5; k++) ev('pointermove', fx + (ddx * k) / 5, fy);
    const busyAtSwipe = stage.dataset.lvMotionBusy ?? null;
    ev('pointerup', fx + ddx, fy);
    return { busyAtSwipe };
  }, [sx, sy, dx]);

  const rows = [];
  for (const t of SWEEP) {
    const row = { t, trials: [] };
    for (let k = 0; k < TRIALS; k++) {
      if (!(await waitIdle())) { console.log(`t=${t} #${k + 1}: 起始非空闲，跳过`); continue; }
      // 武装一发（等它真的在播：busy 变 1）
      const before = await readStage();
      await swipe(160);
      let armed = false;
      const armDeadline = Date.now() + 1500;
      while (Date.now() < armDeadline) {
        const now = await readStage();
        if (now.seq > before.seq && now.busy === '1') { armed = true; break; }
        await page.waitForTimeout(25);
      }
      if (!armed) { console.log(`t=${t} #${k + 1}: 武装未进入播放态，跳过`); continue; }

      // 精确等待 t（以"武装确认在播"的时刻为基准，误差即轮询粒度 25ms）
      await page.waitForTimeout(t);

      // 第二发
      const seqBefore = (await readStage()).seq;
      const at = await swipe(-160);
      // A/B：1s 内看返回值面与播放面
      let seqAdvanced = false, playedWithin1s = false;
      const t1 = Date.now() + 1000;
      while (Date.now() < t1) {
        const now = await readStage();
        if (now.seq > seqBefore) seqAdvanced = true;
        if (now.busy === '1') playedWithin1s = true;
        if (seqAdvanced && playedWithin1s) break;
        await page.waitForTimeout(25);
      }
      // C：再等 3s 看是否迟到（排队）
      let late = false;
      const t2 = Date.now() + LATE_WINDOW_MS;
      while (Date.now() < t2) {
        if ((await readStage()).seq > seqBefore) { late = true; break; }
        await page.waitForTimeout(50);
      }
      row.trials.push({ busyAtSwipe: at.busyAtSwipe, seqAdvanced, playedWithin1s, late });
      console.log(`t=${String(t).padStart(4)}ms #${k + 1}: busy(瞬间)=${String(at.busyAtSwipe)} 返回值(seq前进)=${seqAdvanced ? 'Y' : 'N'} 1s内在播=${playedWithin1s ? 'Y' : 'N'} 3s内迟到(排队)=${late && !seqAdvanced ? 'Y' : 'N'}`);
      await waitIdle();
    }
    rows.push(row);
  }

  console.log('\n== 汇总（t = 上一下动作"确认在播"后等待时长；每档 2 次）==');
  console.log(' t(ms) | 拒绝次数 | 其中:返回值N | 其中:1s内未在播 | 其中:3s内迟到(排队)');
  for (const r of rows) {
    const refused = r.trials.filter((x) => !x.seqAdvanced);
    console.log(`${String(r.t).padStart(6)} | ${String(refused.length).padStart(8)} | ${String(refused.length).padStart(12)} | ${String(r.trials.filter((x) => !x.playedWithin1s).length).padStart(14)} | ${String(r.trials.filter((x) => x.late && !x.seqAdvanced).length).padStart(20)}`);
  }
  const anyQueued = rows.some((r) => r.trials.some((x) => x.late && !x.seqAdvanced));
  const anyAcceptedNotPlaying = rows.some((r) => r.trials.some((x) => x.seqAdvanced && !x.playedWithin1s));
  console.log(`\n判读：${anyQueued ? '出现"返回值 false 但稍后自行出现" ⇒ 存在排队，诊断需改写' : '没有任何"迟到出现" ⇒ 被拒 = 丢弃，不是排队'}`);
  console.log(`      ${anyAcceptedNotPlaying ? '出现"返回 true 但 1s 内未在播" ⇒ 返回值与实际播放不一致，需要查' : '所有返回 true 的都在 1s 内进入播放态 ⇒ 返回值 = 真的起播'}`);
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}
