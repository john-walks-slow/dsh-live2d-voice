#!/usr/bin/env node
/**
 * 层化等价性验证（auto-human 核对项 1）：`.lv-capsule` 必须与原 `.lv-hud` 逐像素等价。
 *
 * 做法：把胶囊里的**新增触摸模式按钮藏起来**、再把搬到右上角的**全屏按钮挪回胶囊原位置**
 * （分隔线之前），这样按钮集合与顺序与 baseline 完全一致，然后截图 + 报出胶囊 rect，
 * 与 `/tmp/capsule-before.json` 的 `.lv-hud` rect 比对、与 `/tmp/capsule-before.png` 做像素 diff。
 *
 * 用法：node docs/features/261010-live2d-touch-mode/capsule-equiv.mjs
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { writeFileSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
try {
  const { sessionId } = await fetch(`${ORIGIN}/live2d-voice/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'capsule-equiv' }),
  }).then((r) => r.json());
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.mouse.move(450, 660); // 让 HUD 脱离淡出态
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const capsule = document.querySelector('.lv-capsule');
    for (const b of capsule.querySelectorAll('button')) {
      if (b.title?.startsWith('触摸模式')) b.style.display = 'none';
    }
    const fsBtn = [...document.querySelectorAll('.lv-corner button')].find((b) => b.title?.includes('全屏'));
    const sep = capsule.querySelector('.lv-hud-sep');
    if (fsBtn && sep) capsule.insertBefore(fsBtn, sep);
    const r = capsule.getBoundingClientRect();
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, titles: [...capsule.querySelectorAll('button')].map((b) => b.title) };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/capsule-equiv.png' });
  writeFileSync('/tmp/capsule-equiv.json', JSON.stringify(state, null, 2));
  console.log('capsule rect =', JSON.stringify(state.rect));
  console.log('capsule buttons (document order) =', state.titles.join(' | '));
} finally {
  await browser.close();
}
