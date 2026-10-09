#!/usr/bin/env node
/**
 * 手势断言 flake 的 A/B 证据（261010，回答"重试语义到底算不算数"）。
 *
 * 同一个页面、同一个模型（izumi）、同一串交替滑动，两种等待策略各跑 ROUNDS 轮：
 *   OLD：固定等待 2600ms 再读（修复前的写法）
 *   NEW：重试到期望手势注册（`swipeExpect` 的语义，硬上限 attempts 次）
 *
 * OLD 的失败不是断言写错，而是**产品设计**造成的：上一个手势动作还在播时，新的
 * NORMAL 动作会被框架静默拒绝——模型 Flick 片段比 2600ms 长的时候，"固定睡一觉"
 * 必然读到上一个手势。NEW 把"等待条件满足"变成"重试到条件满足"，代价是慢一点。
 *
 * 用法：dsh-e2e run docs/features/261010-live2d-touch-mode/gesture-flake-ab.mjs
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const ROUNDS = Number(process.env.ROUNDS ?? 8);

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
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
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
  const gesture = () => page.evaluate(() => document.querySelector('.lv-stage')?.dataset?.lvGesture ?? null);
  // 归因：每次滑动前清空 dataset（否则"读到旧值 == 期望"会假通过，交叉核查指出过这点）
  const clearGesture = () => page.evaluate(() => { delete document.querySelector('.lv-stage').dataset.lvGesture; });

  const swipe = async (dx, settleMs) => {
    const fire = (type, x, y) => page.evaluate(([t, px, py]) => {
      document.querySelector('.lv-stage').dispatchEvent(new PointerEvent(t, {
        pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true,
        buttons: t === 'pointerup' ? 0 : 1,
      }));
    }, [type, x, y]);
    await fire('pointerdown', sx, sy);
    await page.waitForTimeout(50);
    await page.evaluate(([fx, fy, ddx, ddy]) => {
      const stage = document.querySelector('.lv-stage');
      const f = (t, x, y) => stage.dispatchEvent(new PointerEvent(t, {
        pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
        buttons: t === 'pointerup' ? 0 : 1,
      }));
      for (let i = 1; i <= 5; i++) f('pointermove', fx + (ddx * i) / 5, fy + (ddy * i) / 5);
      f('pointerup', fx + ddx, fy + ddy);
    }, [sx, sy, dx, 0]);
    await page.waitForTimeout(settleMs);
  };

  // OLD：固定 2600ms
  const oldResults = [];
  for (let i = 0; i < ROUNDS; i++) {
    const wantDirection = i % 2 === 0 ? 'Right' : 'Left';
    const want = `${wantDirection}:Flick${wantDirection}`;
    await clearGesture();
    await swipe(i % 2 === 0 ? 160 : -160, 2600);
    const got = await gesture();
    oldResults.push(got === want ? 'ok' : `期望 ${want} 实际 ${got}`);
  }

  // NEW：重试到注册（attempts=4 × settle 1200ms）
  const newResults = [];
  for (let i = 0; i < ROUNDS; i++) {
    const wantDirection = i % 2 === 0 ? 'Right' : 'Left';
    const want = `${wantDirection}:Flick${wantDirection}`;
    let value = null; let used = 0;
    for (let n = 1; n <= 4; n++) {
      await clearGesture();
      await swipe(i % 2 === 0 ? 160 : -160, 1200);
      used = n;
      value = await gesture();
      if (value === want) break;
    }
    newResults.push(value === want ? `ok(${used} 次)` : `期望 ${want} 实际 ${value}`);
  }

  const okOld = oldResults.filter((r) => r === 'ok').length;
  const okNew = newResults.filter((r) => r.startsWith('ok')).length;
  console.log(`\nOLD（固定 2600ms 等待）: ${okOld}/${ROUNDS} 通过`);
  oldResults.forEach((r, i) => { if (r !== 'ok') console.log(`  第 ${i + 1} 轮：${r}`); });
  console.log(`NEW（重试到注册，硬上限 4 次 × 1.2s）: ${okNew}/${ROUNDS} 通过`);
  newResults.forEach((r, i) => { if (!r.startsWith('ok')) console.log(`  第 ${i + 1} 轮：${r}`); });
  const attepts = newResults.filter((r) => r.startsWith('ok')).map((r) => Number(r.match(/ok\((\d+)/)?.[1] ?? 0));
  console.log(`\nNEW 的尝试次数分布：${attepts.join(', ')}（1 次即成功 = 动作队列当时空闲）`);
  console.log(`结论：OLD 的失败率 ${(100 * (ROUNDS - okOld) / ROUNDS).toFixed(0)}%，NEW 的失败率 ${(100 * (ROUNDS - okNew) / ROUNDS).toFixed(0)}%`);
  console.log('说明：样本量（各 ' + ROUNDS + ' 轮、单环境单模型）不足以声称"flake 已消除"，只能说明"显著降低"；两者都是清空归因后的口径。');
  process.exitCode = okNew === ROUNDS ? 0 : 1;
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}
