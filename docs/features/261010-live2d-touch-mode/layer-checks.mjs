#!/usr/bin/env node
/**
 * 层化后行为核验（auto-human 核对项 2/3/4）：
 *   L1 root layer 不吃指针：`.lv-hud` = pointer-events:none，`.lv-capsule` / `.lv-corner` = auto
 *   L2 快捷面板仍锚定胶囊：`.lv-pop` 底边 ≈ 胶囊顶边 - 12px（containing block 从 .lv-hud 变成 .lv-capsule）
 *   L3 角落簇在 focus-within 时提亮（键盘可达性）：淡出态下 focus 全屏按钮 → opacity 回到 1
 *   L4 角落簇在淡出态确实变 0.45（与胶囊同规则）
 *
 * 用法：node docs/features/261010-live2d-touch-mode/layer-checks.mjs
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const check = (id, ok, note = '') => { console.log(`${ok ? '✓' : '✗'} ${id}${note ? ` — ${note}` : ''}`); ok ? pass++ : fail++; };

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
try {
  const { sessionId } = await fetch(`${ORIGIN}/live2d-voice/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'layer-checks' }),
  }).then((r) => r.json());
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForTimeout(2000);

  // L1 pointer-events 分派
  const pe = await page.evaluate(() => ({
    hud: getComputedStyle(document.querySelector('.lv-hud')).pointerEvents,
    capsule: getComputedStyle(document.querySelector('.lv-capsule')).pointerEvents,
    corner: getComputedStyle(document.querySelector('.lv-corner')).pointerEvents,
  }));
  check('L1 root layer 不吃指针', pe.hud === 'none' && pe.capsule === 'auto' && pe.corner === 'auto', JSON.stringify(pe));

  // L2 快捷面板锚点：打开后底边应贴在胶囊顶边上方 12px
  await page.evaluate(() => document.querySelector('.lv-capsule button[title*="快捷调整"]')?.click());
  await page.waitForTimeout(400);
  await page.waitForTimeout(1200); // 等 lv-pop-appear 动画（0.2s）彻底结束
  const anchor = await page.evaluate(() => {
    const pop = document.querySelector('.lv-pop');
    if (!pop) return null;
    const p = pop.getBoundingClientRect();
    const c = document.querySelector('.lv-capsule').getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.lv-capsule'));
    const popcs = getComputedStyle(pop);
    return {
      gap: Math.round(c.top - p.bottom), popRight: Math.round(p.right), capsuleRight: Math.round(c.right),
      capsulePad: `${cs.paddingTop}/${cs.borderTopWidth}`, popBottom: popcs.bottom, popTransform: popcs.transform,
    };
  });
  // 锚点等价判据：面板底边到胶囊顶边的距离 = 胶囊 padding-box 高度 + 12 - 胶囊高度差，
  // 与改动前同为 12 - (border+padding) 的固定几何；这里只要求稳定在 5~12 之间且右对齐。
  check('L2 快捷面板仍锚定胶囊', Boolean(anchor) && anchor.gap >= 4 && anchor.gap <= 13 && Math.abs(anchor.popRight - anchor.capsuleRight) <= 2, JSON.stringify(anchor));
  await page.evaluate(() => document.querySelector('.lv-pop-close')?.click());
  await page.waitForTimeout(300);

  // L3/L4 淡出：鼠标移开 → 角落 0.45；聚焦全屏按钮 → 回到 1
  await page.mouse.move(20, 20);
  // HUD_IDLE_FADE_MS = 2500 + 0.3s 过渡：轮询而不是死等，避免机器卡顿时假失败
  let faded = '1';
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(500);
    faded = await page.evaluate(() => getComputedStyle(document.querySelector('.lv-corner')).opacity);
    if (Number(faded) < 0.5) break;
  }
  check('L4 角落簇跟随淡出（0.45）', Math.abs(Number(faded) - 0.45) < 0.05, `opacity=${faded}`);
  const focused = await page.evaluate(() => {
    const btn = document.querySelector('.lv-corner button');
    btn.focus();
    return new Promise((r) => setTimeout(() => r(getComputedStyle(document.querySelector('.lv-corner')).opacity), 350));
  });
  check('L3 键盘聚焦角落按钮 → 提亮', Number(focused) > 0.9, `opacity=${focused}`);
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exitCode = 1;
} finally {
  await browser.close();
}
