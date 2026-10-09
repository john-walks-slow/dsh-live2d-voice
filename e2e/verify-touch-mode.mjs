#!/usr/bin/env node
/**
 * 触摸模式 e2e（261010-live2d-touch-mode commit A）。
 *
 * 覆盖：
 *   T1 触摸模式开：单指按下/移动 → `dataset.lvTouchLook` 出现，符号与落点同侧；抬手清空
 *   T2 单指不平移（`lvTransform` 不变）；双指仍平移缩放
 *   T3 第二指落下即取消手势判定：双指期间/之后都不触发 tap（`lvTap` 不变）
 *   T4 鼠标 hover（不按键）也喂视线；hover 不平移
 *   T5 布局：全屏按钮在右上角簇里、在安全区内；root layer 不吃指针——从胶囊外起手拖动只转视线不平移
 *   T6 触摸模式下 tap 仍工作（点模型 → `lvTap`）
 *   T7 关掉触摸模式回到旧语义：单指拖动 = 平移，且不写 `lvTouchLook`
 *   T8 视线方向受控度量：手指固定在左/右两侧 → 头部区域非背景像素水平质心朝手指侧位移 ≥ 阈值；
 *      同一位置两帧的漂移 < 阈值（null case）
 *
 * 零真实 API：POST /live2d-voice/session 造空会话 + standalone 入口。
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const LIB = '/root/.dsh/live2d-voice-models';
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok }); console.log(`${ok ? '✓' : '✗'} ${id}${note ? ` — ${note}` : ''}`); };
if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = (extra = {}) => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, { modelPath: LIB, modelSelection: 'haru', liveMode: 'first', eyeTracking: false, gyroParallax: false, idleInterval: 0, ...extra });
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const browser = await chromium.launch({
  executablePath: CHROMIUM, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const state = () => page.evaluate(() => {
  const stage = document.querySelector('.lv-stage');
  return {
    touchLook: stage?.dataset?.lvTouchLook ?? null,
    transform: stage?.dataset?.lvTransform ?? null,
    tap: stage?.dataset?.lvTap ?? null,
  };
});
const load = async (extra) => {
  pin(extra);
  const { sessionId } = await fetch(`${ORIGIN}/live2d-voice/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'touch-mode' }),
  }).then((r) => r.json());
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2200);
};
/** 合成触摸指针事件（playwright 的 mouse 是 pointerType=mouse，走不到触摸分支）。 */
const touch = (type, x, y, id = 1) => page.evaluate(([type, x, y, id]) => {
  const stage = document.querySelector('.lv-stage');
  stage.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
  }));
}, [type, x, y, id]);

try {
  // ── 触摸模式开 ────────────────────────────────────────────────────────────
  await load({ touchMode: true });

  // T1 单指 → 视线；抬手清空
  await touch('pointerdown', 200, 400);
  await page.waitForTimeout(250);
  const left = await state();
  await touch('pointermove', 180, 380);
  await page.waitForTimeout(200);
  const left2 = await state();
  await touch('pointerup', 180, 380);
  await page.waitForTimeout(600);
  const released = await state();
  const leftDx = Number((left2.touchLook ?? 'NaN').split(',')[0]);
  check('T1a 单指按下即跟视线', Boolean(left2.touchLook) && leftDx < -0.2, `touchLook=${left2.touchLook}`);
  check('T1b 抬手后清空（视线回落）', released.touchLook === null, String(released.touchLook));

  await touch('pointerdown', 700, 300);
  await touch('pointermove', 720, 300);
  await page.waitForTimeout(250);
  const right = await state();
  await touch('pointerup', 720, 300);
  await page.waitForTimeout(500);
  const rightDx = Number((right.touchLook ?? 'NaN').split(',')[0]);
  check('T1c 手指在右侧 → dx 为正', rightDx > 0.2, `touchLook=${right.touchLook}`);

  // T2 单指不平移
  const beforeDrag = await state();
  await touch('pointerdown', 450, 350);
  for (let i = 1; i <= 8; i++) await touch('pointermove', 450 + i * 25, 350);
  await page.waitForTimeout(150);
  const duringTouchDrag = await state();
  await touch('pointerup', 650, 350);
  await page.waitForTimeout(400);
  check('T2a 触摸模式单指不平移', duringTouchDrag.transform === beforeDrag.transform && duringTouchDrag.touchLook !== null,
    `transform ${beforeDrag.transform} → ${duringTouchDrag.transform}, touchLook=${duringTouchDrag.touchLook}`);

  // T2b 双指仍能平移
  await touch('pointerdown', 400, 350, 1);
  await touch('pointerdown', 500, 350, 2);
  for (let i = 1; i <= 6; i++) {
    await touch('pointermove', 400 + i * 20, 350, 1);
    await touch('pointermove', 500 + i * 20, 350, 2);
  }
  await page.waitForTimeout(200);
  const afterPinch = await state();
  await touch('pointerup', 520, 350, 1);
  await touch('pointerup', 620, 350, 2);
  await page.waitForTimeout(300);
  check('T2b 双指仍可平移', afterPinch.transform !== duringTouchDrag.transform, `${duringTouchDrag.transform} → ${afterPinch.transform}`);

  // T3 第二指落下 → 手势判定作废
  const beforeTap = await state();
  await touch('pointerdown', 450, 320, 1);
  await touch('pointermove', 452, 318, 1);
  await touch('pointerdown', 500, 340, 2);
  await touch('pointermove', 452, 318, 1);
  await touch('pointerup', 452, 318, 1);
  await touch('pointerup', 500, 340, 2);
  await page.waitForTimeout(700);
  check('T3 双指参与后不触发 tap', (await state()).tap === beforeTap.tap, `${beforeTap.tap} → ${(await state()).tap}`);

  // T6 tap 仍工作（前面的用例平移过舞台，先双击复位再点模型上半部）
  await page.evaluate(() => document.querySelector('.lv-stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await page.waitForTimeout(300);
  const tapBox = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const beforeTap2 = await state();
  await touch('pointerdown', tapBox.x + tapBox.w / 2, tapBox.y + tapBox.h * 0.35);
  await touch('pointerup', tapBox.x + tapBox.w / 2, tapBox.y + tapBox.h * 0.35);
  await page.waitForTimeout(900);
  const tapped = await state();
  check('T6 触摸模式 tap 仍触发 Tap 动作', Boolean(tapped.tap) && tapped.tap !== beforeTap2.tap, String(tapped.tap));

  // T4 鼠标 hover 喂视线且不平移
  const beforeHover = await state();
  await page.mouse.move(200, 300);
  await page.waitForTimeout(300);
  const hovered = await state();
  check('T4 鼠标 hover 跟视线', Boolean(hovered.touchLook) && Number(hovered.touchLook.split(',')[0]) < -0.2, `touchLook=${hovered.touchLook}`);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(250);
  check('T4b hover 不平移', (await state()).transform === beforeHover.transform, `${beforeHover.transform} → ${(await state()).transform}`);

  // T5 布局 + root layer 不吃指针（从胶囊外起手拖动）
  const layout = await page.evaluate(() => {
    const corner = document.querySelector('.lv-corner');
    const hud = document.querySelector('.lv-hud');
    const fs = document.querySelector('.lv-hud button[title*="全屏"]');
    const r = corner?.getBoundingClientRect();
    return {
      cornerTopRight: r ? { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right) } : null,
      fullscreenInCorner: Boolean(fs && corner?.contains(fs)),
      hudPointerEvents: hud ? getComputedStyle(hud).pointerEvents : null,
      hudRect: hud ? { w: Math.round(hud.getBoundingClientRect().width), h: Math.round(hud.getBoundingClientRect().height) } : null,
    };
  });
  check('T5a 全屏按钮在右上角簇且在安全区内',
    layout.fullscreenInCorner && layout.cornerTopRight && layout.cornerTopRight.top >= 8 && layout.cornerTopRight.right >= 8,
    JSON.stringify(layout.cornerTopRight));
  check('T5b root layer 不吃指针', layout.hudPointerEvents === 'none', String(layout.hudPointerEvents));

  const beforeLayerDrag = await state();
  await touch('pointerdown', 100, 620); // 胶囊左侧、仍在 root layer 覆盖范围内
  for (let i = 1; i <= 6; i++) await touch('pointermove', 100 + i * 30, 620);
  await page.waitForTimeout(200);
  const layerDrag = await state();
  await touch('pointerup', 280, 620);
  await page.waitForTimeout(400);
  check('T5c 层外起手拖动 = 转视线而非平移',
    layerDrag.touchLook !== null && layerDrag.transform === beforeLayerDrag.transform,
    `touchLook=${layerDrag.touchLook}, transform ${beforeLayerDrag.transform} → ${layerDrag.transform}`);

  // ── T7 关掉触摸模式 ──────────────────────────────────────────────────────
  await load({ touchMode: false });
  const beforePan = await state();
  await touch('pointerdown', 450, 350);
  for (let i = 1; i <= 8; i++) await touch('pointermove', 450 + i * 25, 350);
  await page.waitForTimeout(200);
  const panning = await state();
  await touch('pointerup', 650, 350);
  await page.waitForTimeout(400);
  check('T7 关闭触摸模式：单指恢复平移且不写 lvTouchLook',
    panning.transform !== beforePan.transform && panning.touchLook === null,
    `transform ${beforePan.transform} → ${panning.transform}, touchLook=${panning.touchLook}`);

  // ── T8 视线方向：头部区域非背景像素水平质心 ─────────────────────────────
  await load({ touchMode: true });
  const stageBox = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const shootAt = async (clientX, path) => {
    await touch('pointerdown', clientX, stageBox.y + stageBox.h * 0.45);
    await touch('pointermove', clientX, stageBox.y + stageBox.h * 0.45);
    await page.waitForTimeout(900); // 让视线 settle
    await page.screenshot({ path });
    await touch('pointerup', clientX, stageBox.y + stageBox.h * 0.45);
    await page.waitForTimeout(500);
  };
  await shootAt(stageBox.x + stageBox.w * 0.12, '/tmp/touch-look-left.png');
  await shootAt(stageBox.x + stageBox.w * 0.88, '/tmp/touch-look-right.png');
  // null case：同一位置连续两帧
  await shootAt(stageBox.x + stageBox.w * 0.12, '/tmp/touch-look-left-2.png');
  const centroids = execSync(`python3 - <<'PY'
from PIL import Image
def head_centroid(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    # 只看上半屏（头部区域），背景色取四角平均
    im = im.crop((0, 0, w, int(h * 0.55)))
    w, h = im.size
    px = im.load()
    corners = [px[4, 4], px[w-5, 4], px[4, h-5], px[w-5, h-5]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    xs = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            p = px[x, y]
            if abs(p[0]-bg[0]) + abs(p[1]-bg[1]) + abs(p[2]-bg[2]) > 40:
                xs.append(x)
    return (sum(xs) / len(xs) / w) if xs else None
for label, a, b in [('left-vs-right','/tmp/touch-look-left.png','/tmp/touch-look-right.png'),
                    ('null(left-1 vs left-2)','/tmp/touch-look-left.png','/tmp/touch-look-left-2.png')]:
    ca, cb = head_centroid(a), head_centroid(b)
    print(f"{label}\\t{ca:.4f}\\t{cb:.4f}\\t{abs(cb-ca):.4f}")
PY`, { encoding: 'utf8' }).trim().split('\n');
  const rows = centroids.map((l) => l.split('\t'));
  const lr = rows.find((r) => r[0] === 'left-vs-right');
  const nul = rows.find((r) => r[0].startsWith('null'));
  const shift = Number(lr?.[3]);
  const drift = Number(nul?.[3]);
  // 阈值标定（261010 实测，haru/900x700/第一人称）：手指左右两端时头部区域
  // 非背景像素水平质心位移 0.289，同一位置两帧漂移 0.0002 → 取 0.05（噪声的 250×、
  // 信号的 1/6），既能抓住明显转头也不会被呼吸/眨眼误判。数值记入 validation 文档。
  const THRESHOLD = 0.05;
  check('T8a 头随手指方向移动（质心位移 ≥ 阈值）', shift >= THRESHOLD, `shift=${shift.toFixed(4)} (阈值 ${THRESHOLD})`);
  check('T8b null case 漂移 < 阈值', drift < THRESHOLD, `drift=${drift.toFixed(4)}`);
  check('T8c 方向正确（手指在右时头部质心更大）', Number(lr?.[2]) > Number(lr?.[1]), `left=${lr?.[1]} right=${lr?.[2]}`);

  check('T9 无页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
