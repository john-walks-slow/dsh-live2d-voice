#!/usr/bin/env node
/**
 * 全屏（网页沉浸半全屏）真实可用性验证（260925 事故回归）：
 * 用户真机反馈：一点全屏"画面拉伸、UI 显示不全、整个界面不能用"。
 *
 * 用手机尺寸视口验证四个层面：
 *   F1 全屏后退出按钮在视口内可点（不被推出屏幕 / 不被宿主盖住）
 *   F2 canvas buffer 纵横比 == CSS 纵横比（无 CSS 拉伸）
 *   F3 模型视觉纵横比在全屏前后不变（PIL 非背景 bbox 等比）
 *   F4 点击退出按钮能退出（不留死路）
 *   F5 宿主 header 被盖住（z-index 生效，半全屏语义成立）
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { execSync } from 'node:child_process';

const { chromium } = pw;
const E2E_URL = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } }); // 桌面布局导航（移动布局的会话树是抽屉）
const page = await ctx.newPage();
const sleep = (ms) => page.waitForTimeout(ms);
let pass = 0, fail = 0;
const check = (id, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${id} ${note}`);
  ok ? pass++ : fail++;
};

try {
  await page.goto(E2E_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')].filter((r) =>
      String(r.className).includes('sessionRow') && (r.textContent ?? '').trim() !== 'New Session');
    if (rows.length > 0) rows[0].click();
  });
  await sleep(3000);
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"]')];
    tabs.find((t) => (t.textContent ?? '').includes('Live2D'))?.click();
  });
  await page.waitForSelector('.lv-root .lv-stage canvas', { timeout: 20000 });
  await sleep(3500);

  // 切到手机尺寸再测（fixed/inset/z-index 的行为只跟视口有关）
  await page.setViewportSize({ width: 412, height: 915 });
  await sleep(1200);

  const probe = () => page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    const stage = document.querySelector('.lv-stage');
    const canvas = stage?.querySelector('canvas');
    const exitBtn = document.querySelector('.lv-hud button[title*="退出全屏"]');
    const enterBtn = document.querySelector('.lv-hud button[title*="全屏"]');
    if (!root || !stage || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const btn = exitBtn ?? enterBtn;
    const br = btn?.getBoundingClientRect();
    return {
      vw, vh,
      rootRect: { x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) },
      rootZ: getComputedStyle(root).zIndex,
      hostRect: { w: Math.round(root.parentElement.getBoundingClientRect().width), h: Math.round(root.parentElement.getBoundingClientRect().height) },
      buf: { w: canvas.width, h: canvas.height },
      css: { w: Math.round(r.width), h: Math.round(r.height) },
      stageH: stage.clientHeight,
      btnVisible: br ? (br.top >= 0 && br.left >= 0 && br.bottom <= vh && br.right <= vw) : null,
      transform: stage.dataset.lvTransform ?? null,
    };
  });

  const s0 = await probe();
  // 视觉测量只看模型本体：隐藏 HUD/字幕/浮层，避免 bbox 被污染
  await page.evaluate(() => {
    for (const sel of ['.lv-hud', '.lv-subs', '.lv-toast', '.lv-micbar']) {
      document.querySelector(sel)?.setAttribute('style', 'display:none');
    }
  });
  await sleep(300);
  await page.screenshot({ path: '/tmp/fs-mobile-A.png' });
  await page.evaluate(() => {
    for (const sel of ['.lv-hud', '.lv-subs', '.lv-toast', '.lv-micbar']) {
      document.querySelector(sel)?.removeAttribute('style');
    }
  });

  // 进入全屏
  await page.evaluate(() => document.querySelector('.lv-hud button[title^="全屏"]')?.click());
  await sleep(900); // 给 renderer.resize + fit 重算留时间
  const s1 = await probe();

  check('F1', s1.btnVisible === true,
    `退出按钮在视口内 (btnVisible=${s1.btnVisible}, viewport ${s1.vw}x${s1.vh}, root ${s1.rootRect.w}x${s1.rootRect.h})`);

  const bufRatio = s1.buf.w / s1.buf.h;
  const cssRatio = s1.css.w / s1.css.h;
  check('F2', Math.abs(bufRatio - cssRatio) / cssRatio < 0.02,
    `buffer(${s1.buf.w}x${s1.buf.h}=${bufRatio.toFixed(3)}) == css(${s1.css.w}x${s1.css.h}=${cssRatio.toFixed(3)})`);

  check('F5', s1.rootZ === '2147483000' && s1.rootRect.w === s1.vw && s1.rootRect.h === s1.vh,
    `root 铺满视口 z=${s1.rootZ} (${s1.rootRect.w}x${s1.rootRect.h} vs viewport ${s1.vw}x${s1.vh})`);
  console.log(`  diag: s0 host=${s0.hostRect.w}x${s0.hostRect.h} stage=${s0.stageH} buf=${s0.buf.w}x${s0.buf.h} tf=${s0.transform}`);
  console.log(`  diag: s1 host=${s1.hostRect.w}x${s1.hostRect.h} stage=${s1.stageH} buf=${s1.buf.w}x${s1.buf.h} tf=${s1.transform}`);

  // B 截图同样隐藏 UI，bbox 只含模型本体
  await page.evaluate(() => {
    for (const sel of ['.lv-hud', '.lv-subs', '.lv-toast', '.lv-micbar']) {
      document.querySelector(sel)?.setAttribute('style', 'display:none');
    }
  });
  await sleep(300);
  await page.screenshot({ path: '/tmp/fs-mobile-B.png' });
  await page.evaluate(() => {
    for (const sel of ['.lv-hud', '.lv-subs', '.lv-toast', '.lv-micbar']) {
      document.querySelector(sel)?.removeAttribute('style');
    }
  });

  // 视觉等比：先按 root 区域裁剪（非全屏时 root 只是页面一部分，
  // 整页 bbox 会混入宿主 UI），再测模型本体 bbox 纵横比
  const visual = execSync(`python3 - <<'PY'
from PIL import Image

ROOT_A = (${s0.rootRect.x}, ${s0.rootRect.y}, ${s0.rootRect.x + s0.rootRect.w}, ${s0.rootRect.y + s0.rootRect.h})
ROOT_B = (${s1.rootRect.x}, ${s1.rootRect.y}, ${s1.rootRect.x + s1.rootRect.w}, ${s1.rootRect.y + s1.rootRect.h})

def model_ratio(path, clip):
    im = Image.open(path).convert('RGB').crop(clip)
    w, h = im.size
    px = im.load()
    corners = [px[8, 8], px[w-9, 8], px[8, h-9], px[w-9, h-9]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    xs, ys = [], []
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            p = px[x, y]
            if abs(p[0]-bg[0]) + abs(p[1]-bg[1]) + abs(p[2]-bg[2]) > 45:
                xs.append(x); ys.append(y)
    if not xs: return None
    bw, bh = max(xs)-min(xs), max(ys)-min(ys)
    return bw / bh if bh > 0 else None

ra = model_ratio('/tmp/fs-mobile-A.png', ROOT_A)
rb = model_ratio('/tmp/fs-mobile-B.png', ROOT_B)
print(f"A ratio={ra:.4f}" if ra else "A: none")
print(f"B ratio={rb:.4f}" if rb else "B: none")
PY`, { encoding: 'utf8' }).trim();
  console.log('  视觉:', visual.replace(/\n/g, ' | '));
  const [ra, rb] = [...visual.matchAll(/ratio=([\d.]+)/g)].map((m) => parseFloat(m[1]));
  check('F3', ra && rb && Math.abs(ra - rb) / ra < 0.05, `模型视觉纵横比 A=${ra} → B=${rb}（等比）`);

  // 点击退出按钮（真实点击，不能 evaluate click —— 要验证可点性）
  const exitBtn = page.locator('.lv-hud button[title*="退出全屏"]');
  await exitBtn.click({ timeout: 5000 });
  await sleep(500);
  const exited = await page.evaluate(() => !document.querySelector('.lv-root')?.classList.contains('lv-fullscreen'));
  check('F4', exited, '点击退出按钮成功退出全屏');

  console.log(`\n${pass + fail} 项：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.error('Fatal:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
