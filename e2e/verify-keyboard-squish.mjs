#!/usr/bin/env node
/**
 * 键盘弹出压扁诊断（260925）：
 * 用户反馈：软键盘弹出后模型"基本不缩了，但被压扁一点"。
 *
 * 流程（大视口导航 + 切手机视口，避免移动布局导航问题）：
 *   状态 0：412x915 正常态 baseline
 *   状态 1：打开键盘面板（keyboard-open 类 + locked-height 写入）
 *   状态 2：模拟 Android IME 压缩 layout viewport（root 高度压到 60%）
 *
 * 每态测量：
 *   - canvas buffer 纵横比 vs CSS 盒纵横比（不等 = CSS 拉伸）
 *   - stage clientHeight / locked-height（钉高是否生效）
 *   - dataset.lvTransform（模型 scale/pan 是否保持）
 *   - 视觉等比：隐藏 UI 后按 root 区域裁剪，非背景 bbox 纵横比
 *
 * 判定：transform 不变 + buffer==CSS + 视觉 ratio 不变 → 无压扁。
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});
// 桌面视口导航（移动布局下 session tree 不渲染），挂载后切手机尺寸
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
const page = await ctx.newPage();
const sleep = (ms) => page.waitForTimeout(ms);
let pass = 0, fail = 0;
const check = (id, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${id} ${note}`);
  ok ? pass++ : fail++;
};

try {
  await page.goto('http://127.0.0.1:4188/?token=e2etest', { waitUntil: 'domcontentloaded', timeout: 30000 });
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

  // 切手机尺寸再测
  await page.setViewportSize({ width: 412, height: 915 });
  await sleep(1200);

  const probe = () => page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    const stage = document.querySelector('.lv-stage');
    const canvas = stage?.querySelector('canvas');
    if (!root || !stage || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return {
      rootRect: { x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) },
      stageH: stage.clientHeight,
      lockedHeight: root.style.getPropertyValue('--lv-locked-height') || null,
      imeHeight: root.style.getPropertyValue('--lv-ime-height') || null,
      kbClass: root.classList.contains('lv-keyboard-open'),
      bufW: canvas.width, bufH: canvas.height,
      cssW: Math.round(r.width), cssH: Math.round(r.height),
      transform: stage.dataset.lvTransform ?? null,
    };
  });

  const hideUi = (hide) => page.evaluate((h) => {
    for (const sel of ['.lv-hud', '.lv-subs', '.lv-toast', '.lv-input', '.lv-micbar']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (h) el.setAttribute('style', 'display:none');
      else if (el.getAttribute('style') === 'display:none') el.removeAttribute('style');
    }
  }, hide);

  const shot = async (path) => {
    await hideUi(true);
    await sleep(250);
    await page.screenshot({ path });
    await hideUi(false);
  };

  // ---- 状态 0：正常态 baseline ----
  const s0 = await probe();
  await shot('/tmp/squish-A-normal.png');

  // ---- 状态 1：打开键盘面板 ----
  await page.evaluate(() => {
    const btn = document.querySelector('.lv-hud button[title*="键盘"], .lv-hud button[title*="打字"]');
    btn?.click();
  });
  await sleep(700);
  const s1 = await probe();
  await shot('/tmp/squish-B-kbopen.png');

  // ---- 状态 2：模拟 IME 压缩 layout viewport（root 压到 60%）----
  await page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    // inset:0 下 inline height 覆盖 bottom —— 模拟"顶部对齐、底部被键盘吃掉"
    root.style.height = '60%';
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(900);
  const s2 = await probe();
  await shot('/tmp/squish-C-ime-squish.png');

  const ratio = (w, h) => (h > 0 ? (w / h).toFixed(4) : 'n/a');
  console.log([
    ['state', 'rootH', 'stageH', 'locked', 'buf', 'bufRatio', 'css', 'cssRatio', 'tf'].join('\t'),
    ['0 normal', s0.rootRect.h, s0.stageH, s0.lockedHeight ?? '-', `${s0.bufW}x${s0.bufH}`, ratio(s0.bufW, s0.bufH), `${s0.cssW}x${s0.cssH}`, ratio(s0.cssW, s0.cssH), s0.transform].join('\t'),
    ['1 kb-open', s1.rootRect.h, s1.stageH, s1.lockedHeight ?? '-', `${s1.bufW}x${s1.bufH}`, ratio(s1.bufW, s1.bufH), `${s1.cssW}x${s1.cssH}`, ratio(s1.cssW, s1.cssH), s1.transform].join('\t'),
    ['2 ime-40%', s2.rootRect.h, s2.stageH, s2.lockedHeight ?? '-', `${s2.bufW}x${s2.bufH}`, ratio(s2.bufW, s2.bufH), `${s2.cssW}x${s2.cssH}`, ratio(s2.cssW, s2.cssH), s2.transform].join('\t'),
  ].join('\n'));
  writeFileSync('/tmp/squish-probe.json', JSON.stringify({ s0, s1, s2 }, null, 2));

  // ---- 断言 ----
  check('S1a', s1.kbClass === true && !!s1.lockedHeight, `键盘开：kbClass=${s1.kbClass} locked=${s1.lockedHeight}`);

  // 钉高生效：IME 压缩后 stage 高度不缩（= locked-height）
  const lockedH = parseFloat(s1.lockedHeight ?? '0');
  check('S1b', s2.stageH === s1.stageH && Math.abs(s2.stageH - lockedH) <= 1,
    `钉高：stage ${s1.stageH} → ${s2.stageH}（locked=${lockedH}）`);

  // transform 不变（模型 scale/pan 不重算）
  check('S2', s0.transform === s2.transform, `transform ${s0.transform} → ${s2.transform}`);

  // buffer == CSS（无 CSS 拉伸）
  const bufRatio2 = s2.bufW / s2.bufH;
  const cssRatio2 = s2.cssW / s2.cssH;
  check('S3', Math.abs(bufRatio2 - cssRatio2) / cssRatio2 < 0.02,
    `buffer(${s2.bufW}x${s2.bufH}=${bufRatio2.toFixed(3)}) == css(${s2.cssW}x${s2.cssH}=${cssRatio2.toFixed(3)})`);

  // 视觉等比：A vs C（按 root 裁剪）
  const visual = execSync(`python3 - <<'PY'
from PIL import Image

CLIPS = {
    'A': (${s0.rootRect.x}, ${s0.rootRect.y}, ${s0.rootRect.x + s0.rootRect.w}, ${s0.rootRect.y + s0.rootRect.h}),
    'B': (${s1.rootRect.x}, ${s1.rootRect.y}, ${s1.rootRect.x + s1.rootRect.w}, ${s1.rootRect.y + s1.rootRect.h}),
    'C': (${s2.rootRect.x}, ${s2.rootRect.y}, ${s2.rootRect.x + s2.rootRect.w}, ${s2.rootRect.y + s2.rootRect.h}),
}
PATHS = {'A': '/tmp/squish-A-normal.png', 'B': '/tmp/squish-B-kbopen.png', 'C': '/tmp/squish-C-ime-squish.png'}

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

for k in ['A', 'B', 'C']:
    r = model_ratio(PATHS[k], CLIPS[k])
    print(f"{k}: {r:.4f}" if r else f"{k}: none")
PY`, { encoding: 'utf8' }).trim();
  console.log('  视觉:', visual.replace(/\n/g, ' | '));
  const [ra, rc] = [...visual.matchAll(/([\d.]+)/g)].map((m) => parseFloat(m[1]));
  check('S4', ra && rc && Math.abs(ra - rc) / ra < 0.05, `模型视觉纵横比 A=${ra} → C=${rc}（等比）`);

  // micbar 隐藏验证：静默态组件不挂载，注入假元素验证 CSS 规则生效
  const micHidden = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'lv-micbar';
    document.body.appendChild(probe);
    const hidden = getComputedStyle(probe).display === 'none';
    probe.remove();
    return hidden;
  });
  check('S5', micHidden === true, `micbar CSS display:none=${micHidden}`);

  console.log(`\n${pass + fail} 项：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.error('Fatal:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
