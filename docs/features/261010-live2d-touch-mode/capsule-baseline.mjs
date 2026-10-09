#!/usr/bin/env node
/**
 * 层化 before/after 取证脚本（一次性工具，随需求文档留档）。
 *
 * 用途：把 HUD 拆层（`.lv-hud` → root layer + `.lv-capsule` + `.lv-corner`）前后的
 * 胶囊区域做逐像素对比，证明"胶囊盒子与旧 `.lv-hud` 等价"（auto-human 的核对项 1）。
 *
 * 用法：node docs/features/261010-live2d-touch-mode/capsule-baseline.mjs <before|after>
 * 依赖：正在运行的 e2e 实例（DSH_E2E_PORT / DSH_E2E_HOME 由 dsh-e2e run 注入）。
 * 产出：/tmp/capsule-<label>.png（整屏）、/tmp/capsule-<label>.json（胶囊 rect + 角落 rect）
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { writeFileSync } from 'node:fs';

const { chromium } = pw;
const label = process.argv[2] ?? 'before';
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
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `capsule-${label}` }),
  }).then((r) => r.json());
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForTimeout(2500);
  // 悬浮让 HUD 恢复不透明，避免淡出态影响比对
  await page.mouse.move(450, 660);
  await page.waitForTimeout(600);
  if (label !== 'before') {
    // 层化后的胶囊多了一个触摸模式按钮：比对盒子/像素时先把它藏起来，
    // 这样剩下的按钮集合与 baseline 完全一致（否则宽度天然不同）。
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('.lv-capsule button')) {
        if (b.title?.startsWith('触摸模式')) b.style.display = 'none';
      }
    });
    await page.waitForTimeout(200);
  }
  const rects = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    return {
      hud: rect(document.querySelector('.lv-hud')),
      capsule: rect(document.querySelector('.lv-capsule')),
      corner: rect(document.querySelector('.lv-corner')),
      buttons: [...document.querySelectorAll('.lv-hud button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { title: b.title, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }),
    };
  });
  await page.screenshot({ path: `/tmp/capsule-${label}.png` });
  writeFileSync(`/tmp/capsule-${label}.json`, JSON.stringify(rects, null, 2));
  console.log(label, JSON.stringify({ hud: rects.hud, capsule: rects.capsule, corner: rects.corner }));
  console.log('buttons:', rects.buttons.map((b) => `${b.title || '(no title)'}@${b.x},${b.y}`).join(' | '));
} finally {
  await browser.close();
}
