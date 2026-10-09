#!/usr/bin/env node
/**
 * 手势注册延迟探针（261010，回答"重试到底是修复还是遮蔽"）。
 *
 * 做法：**单次尝试、不重试**，每轮清空 `dataset.lvGesture` → 派发一次滑动 →
 * 以 25ms 间隔轮询该字段出现值的时刻，记录 delta = 值出现 − 滑动派发结束。
 * 20 轮，方向交替。
 *
 * 判读（2026-10-10 实测口径，20 轮）：
 *   - **被接受的滑动**：值在 34–159ms 内出现（中位 137ms）→ 注册本身很快；
 *   - **被拒绝的滑动**：等 9s 也不会有值——事件已经被消费掉了，光等不可能变绿，
 *     必须再发一次（这就是"重试"存在的原因）；
 *   - 因此本探针测的是"哪一半被拒绝"，而不是"注册有多慢"。要把它变成"等队列空闲
 *     再滑一次"，需要产品每帧发布动作队列状态（试做过 `dataset.lvMotionBusy`，
 *     因钩子在构建里不稳定已回滚，见 validation §十）。
 *
 * 用法：dsh-e2e run docs/features/261010-live2d-touch-mode/gesture-latency.mjs
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const POLL_MS = 25;
const CAP_MS = 9000;

if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = () => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, { modelPath: '/root/.dsh/live2d-voice-models', modelSelection: 'izumi', liveMode: 'first', eyeTracking: false, gyroParallax: false, idleInterval: 0, touchMode: true });
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

  const box = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const sx = box.x + box.w * 0.5;
  const sy = box.y + box.h * 0.4;

  const rows = [];
  for (let i = 0; i < ROUNDS; i++) {
    const dx = i % 2 === 0 ? 160 : -160;
    const want = i % 2 === 0 ? 'Right:FlickRight' : 'Left:FlickLeft';
    const res = await page.evaluate(async ([fx, fy, ddx, pollMs, capMs]) => {
      const stage = document.querySelector('.lv-stage');
      delete stage.dataset.lvGesture;
      const fire = (t, x, y) => stage.dispatchEvent(new PointerEvent(t, {
        pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
        buttons: t === 'pointerup' ? 0 : 1,
      }));
      fire('pointerdown', fx, fy);
      await new Promise((r) => setTimeout(r, 50));
      for (let k = 1; k <= 5; k++) fire('pointermove', fx + (ddx * k) / 5, fy);
      const t0 = performance.now();
      fire('pointerup', fx + ddx, fy);
      let value = null;
      while (performance.now() - t0 < capMs) {
        value = stage.dataset.lvGesture ?? null;
        if (value) return { delta: performance.now() - t0, value };
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return { delta: null, value };
    }, [sx, sy, dx, POLL_MS, CAP_MS]);
    rows.push({ round: i + 1, want, ...res });
    console.log(`第 ${String(i + 1).padStart(2)} 轮 期望 ${want.padEnd(18)} 实得 ${String(res.value).padEnd(18)} delta=${res.delta === null ? '超时无值' : `${Math.round(res.delta)}ms`}`);
  }

  const deltas = rows.filter((r) => r.delta !== null).map((r) => r.delta);
  const missed = rows.length - deltas.length;
  const wrong = rows.filter((r) => r.value && r.value !== r.want).length;
  deltas.sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  console.log(`\n样本 ${ROUNDS} 轮：有值 ${deltas.length}、超时无值 ${missed}、方向不符 ${wrong}`);
  if (deltas.length) {
    console.log(`delta 最小 ${Math.round(deltas[0])}ms / 中位 ${Math.round(median)}ms / 最大 ${Math.round(deltas[deltas.length - 1])}ms`);
    console.log(`有值样本：${deltas.map((d) => Math.round(d)).join(', ')}`);
  }
  console.log(`\n判读：被接受时注册延迟 ${deltas.length ? `${Math.round(deltas[0])}–${Math.round(deltas[deltas.length - 1])}ms` : '无样本'}；被拒绝的滑动等再久也不会有值（输入已被消费），只能重发 —— 这正是助手里"有界重试"存在的原因（配合 lvGestureSeq 做因果校验）。`);
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}
