#!/usr/bin/env node
/**
 * Standalone 原生全屏 e2e（260925 分场景裁决）：
 * 独立 URL（/live2d-voice/app）的全屏按钮 = 浏览器原生全屏；
 * DSH 内 = 网页 semi 全屏（由 verify-fullscreen-usable.mjs 覆盖）。
 *
 * N1 捕获活跃 session（ws follow 帧，无需发消息）
 * N2 standalone 页面挂载（canvas + HUD，无 GUI chrome）
 * N3 点全屏 → document.fullscreenElement === .lv-root（真全屏，非 semi 类）
 * N4 全屏态 root 铺满视口 + buffer==CSS 等比
 * N5 再点退出 → fullscreenElement === null
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';

const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const page = await ctx.newPage();
const sleep = (ms) => page.waitForTimeout(ms);
let pass = 0, fail = 0;
const check = (id, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${id} ${note}`);
  ok ? pass++ : fail++;
};

try {
  // N1: 从 GUI 的 ws follow 帧捕获活跃 session id
  const sessionIds = new Set();
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      const s = String(f.payload);
      if (s.includes('session/follow')) {
        const m = s.match(/sessionId":"(session-[a-f0-9-]{20,})"/);
        if (m) sessionIds.add(m[1]);
      }
    });
  });
  await page.goto('http://127.0.0.1:4188/?token=e2etest', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  const sid = [...sessionIds][0];
  check('N1', !!sid, `捕获 session ${sid?.slice(0, 20) ?? 'none'}…（共 ${sessionIds.size} 个）`);
  if (!sid) throw new Error('no session captured');

  // N2: standalone 挂载
  await page.goto(`http://127.0.0.1:4188/live2d-voice/app?session=${encodeURIComponent(sid)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-root .lv-stage canvas', { timeout: 20000 });
  await sleep(3000);
  const s2 = await page.evaluate(() => ({
    hud: !!document.querySelector('.lv-hud'),
    guiChrome: !!document.querySelector('[contenteditable="true"][aria-label*="Describe"]'),
  }));
  check('N2', s2.hud && !s2.guiChrome, `standalone 挂载（hud=${s2.hud}, 无宿主chrome=${!s2.guiChrome}）`);

  // N3: 点全屏 → 原生全屏
  await page.locator('.lv-hud button[title^="全屏"]').click({ timeout: 5000 });
  await sleep(900);
  const s3 = await page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    const canvas = document.querySelector('.lv-stage canvas');
    const r = canvas.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return {
      fsEl: document.fullscreenElement === root,
      semiClass: root.classList.contains('lv-fullscreen'),
      vw: window.innerWidth, vh: window.innerHeight,
      rootW: Math.round(rr.width), rootH: Math.round(rr.height),
      buf: { w: canvas.width, h: canvas.height },
      css: { w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
  check('N3', s3.fsEl === true, `原生全屏生效（fullscreenElement=root: ${s3.fsEl}）`);
  check('N4a', s3.rootW === s3.vw && s3.rootH === s3.vh, `root 铺满视口（${s3.rootW}x${s3.rootH} vs ${s3.vw}x${s3.vh}）`);
  const bufRatio = s3.buf.w / s3.buf.h;
  const cssRatio = s3.css.w / s3.css.h;
  check('N4b', Math.abs(bufRatio - cssRatio) / cssRatio < 0.02,
    `buffer(${s3.buf.w}x${s3.buf.h}=${bufRatio.toFixed(3)}) == css(${s3.css.w}x${s3.css.h}=${cssRatio.toFixed(3)})`);

  // N5: 再点退出
  await page.locator('.lv-hud button[title*="退出全屏"]').click({ timeout: 5000 });
  await sleep(600);
  const exited = await page.evaluate(() => document.fullscreenElement === null);
  check('N5', exited, '退出原生全屏');

  console.log(`\n${pass + fail} 项：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.error('Fatal:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
