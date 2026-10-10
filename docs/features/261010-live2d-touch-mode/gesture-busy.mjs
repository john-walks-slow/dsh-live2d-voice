#!/usr/bin/env node
/**
 * `lvMotionBusy` 语义边界探针（261010，为真机验收 12a/12b 的判据取证）。
 *
 * 回答三个问题：
 *   1. **静息态**：会话启动后、不做任何交互时，`lvMotionBusy` 到底是 `"0"` 还是被常驻动画钉住的 `"1"`？
 *      —— 若恒为 `"1"`，验收表 12b 的「空闲时被拒 = bug」分支永远采不到样本，判据形同虚设。
 *   2. **待机动画开着时**（IDLE 优先级动作在播）：busy 是否仍为 `"0"`（设计上 IDLE 不挡 NORMAL 手势）。
 *   3. **发起滑动那一刻**的 busy 取值 vs 该次滑动是否被接受 —— 拒绝必须按**滑动瞬间**的状态归因，
 *      不能等 1.5s 后再看（那时动作可能已播完，会把在播期间的拒绝误记成空闲拒绝）。
 *
 * 轮次设计：先"空闲态连划"若干次（取 busy=0 的样本），再连划若干次不等待（取在播期间的样本，统计采纳率）。
 *
 * 用法：
 *   dsh-e2e run docs/features/261010-live2d-touch-mode/gesture-busy.mjs            # idleInterval=0
 *   IDLE_INTERVAL=8 dsh-e2e run docs/features/261010-live2d-touch-mode/gesture-busy.mjs  # 待机动画开着
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const IDLE_INTERVAL = Number(process.env.IDLE_INTERVAL ?? 0);
const REST_MS = Number(process.env.REST_MS ?? 8000);
const SAMPLE_MS = 100;
const ACCEPT_WINDOW_MS = 1500;

if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = () => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, {
    modelPath: '/root/.dsh/live2d-voice-models', modelSelection: 'izumi', liveMode: 'first',
    eyeTracking: false, gyroParallax: false, idleInterval: IDLE_INTERVAL, touchMode: true,
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
  await page.waitForTimeout(3000);

  const busyNow = () => page.evaluate(() => document.querySelector('.lv-stage')?.dataset?.lvMotionBusy ?? null);
  // 标记元素身份：字段变 null 时，需要区分"只是没写成"还是"整个舞台被重建了"（destroy 会删掉该字段）。
  await page.evaluate(() => {
    const st = document.querySelector('.lv-stage');
    st.dataset.probeMarker = '1';
    (window).__probeCanvas = document.querySelector('.lv-stage canvas');
  });
  const identity = () => page.evaluate(() => {
    const st = document.querySelector('.lv-stage');
    return {
      marker: st?.dataset?.probeMarker ?? null,
      sameCanvas: (window).__probeCanvas === document.querySelector('.lv-stage canvas'),
    };
  });

  console.log(`== 配置：idleInterval=${IDLE_INTERVAL}（0 = 关掉调度器；>0 = 待机动画会周期性起播）==\n`);
  console.log(`== 1) 静息态采样（${REST_MS}ms，不做任何交互）==`);
  const rest = [];
  const restIdent = [];
  const restDeadline = Date.now() + REST_MS;
  while (Date.now() < restDeadline) {
    rest.push(await busyNow());
    restIdent.push(await identity());
    await page.waitForTimeout(SAMPLE_MS);
  }
  const recreated = restIdent.filter((x) => x.marker === null || !x.sameCanvas).length;
  const nulls = rest.filter((v) => v === null).length;
  console.log(`元素身份：舞台被重建的样本 ${recreated}/${restIdent.length}；字段为 null 的样本 ${nulls}/${rest.length}`);
  console.log(nulls === recreated
    ? '→ 字段为 null 与"舞台被重建"完全重合 ⇒ null = 重建中（字段随 destroy 删除），不是「空闲」的信号'
    : `→ null(${nulls}) 与重建(${recreated}) 不重合，需要另找原因`);
  const uniq = [...new Set(rest.map((v) => String(v)))];
  const restZero = rest.filter((v) => v === '0').length;
  console.log(`样本 ${rest.length} 个，取值集合 = {${uniq.join(', ')}}，其中 "0" 占比 ${Math.round((restZero / rest.length) * 100)}%`);
  console.log(restZero === rest.length
    ? '→ 静息态**恒为 "0"**：12b 的「空闲时被拒 = bug」分支采得到样本 ✓'
    : restZero === 0
      ? '→ 静息态**恒为 "1"**：常驻动画把标志钉住了，12b 的空闲分支采不到样本 ✗（需改用队列长度/动作类别判定）'
      : `→ 静息态**在 0/1 之间翻转**（${uniq.join('/')}）：需要按"滑动瞬间"取值归因（下面第 3 步）`);

  const box = await page.evaluate(() => {
    const c = document.querySelector('.lv-stage canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const sx = box.x + box.w * 0.5;
  const sy = box.y + box.h * 0.4;

  /** 发起一次滑动：**滑动瞬间**取 busy，再在 1.5s 窗口内看是否被接受（lvGestureSeq 前进）。 */
  const swipe = async (dx) => page.evaluate(async ([fx, fy, ddx, windowMs]) => {
    const stage = document.querySelector('.lv-stage');
    const seqBefore = Number(stage.dataset.lvGestureSeq ?? 0);
    delete stage.dataset.lvGesture;
    const fire = (t, x, y) => stage.dispatchEvent(new PointerEvent(t, {
      pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
      buttons: t === 'pointerup' ? 0 : 1,
    }));
    fire('pointerdown', fx, fy);
    await new Promise((r) => setTimeout(r, 50));
    for (let k = 1; k <= 5; k++) fire('pointermove', fx + (ddx * k) / 5, fy);
    const busyAtSwipe = stage.dataset.lvMotionBusy ?? null;   // ← 关键时刻：滑动发起瞬间
    const t0 = performance.now();
    fire('pointerup', fx + ddx, fy);
    while (performance.now() - t0 < windowMs) {
      const seqNow = Number(stage.dataset.lvGestureSeq ?? 0);
      if (seqNow > seqBefore) return { accepted: true, busyAtSwipe, value: stage.dataset.lvGesture ?? null, delta: performance.now() - t0 };
      await new Promise((r) => setTimeout(r, 25));
    }
    return { accepted: false, busyAtSwipe, value: null, delta: null };
  }, [sx, sy, dx, ACCEPT_WINDOW_MS]);

  const run = async (label, rounds, waitIdleBetween) => {
    const rows = [];
    for (let i = 0; i < rounds; i++) {
      if (waitIdleBetween) {
        const d = Date.now() + 4000;
        while (Date.now() < d && (await busyNow()) !== '0') await page.waitForTimeout(60);
      }
      const r = await swipe(i % 2 === 0 ? 160 : -160);
      rows.push(r);
      console.log(`${label} 第 ${i + 1} 次：busy(瞬间)=${String(r.busyAtSwipe)} ${r.accepted ? `接受（${Math.round(r.delta)}ms, ${r.value}）` : '拒绝'}`);
    }
    const accepted = rows.filter((r) => r.accepted).length;
    const refusedBusy = rows.filter((r) => !r.accepted && r.busyAtSwipe === '1').length;
    const refusedIdle = rows.filter((r) => !r.accepted && r.busyAtSwipe === '0').length;
    console.log(`→ ${label}：接受 ${accepted}/${rows.length}；拒绝${' '}中 busy=1 ${refusedBusy} 次、busy=0 ${refusedIdle} 次\n`);
    return { accepted, refusedBusy, refusedIdle, total: rows.length };
  };

  console.log('== 2) 空闲态连划（每次先等 busy 归零）==');
  const idleRun = await run('空闲', 6, true);
  console.log('== 3) 不等播完连划（动作在播期间继续划）==');
  const busyRun = await run('连划', 6, false);

  console.log('== 判读 ==');
  console.log(`空闲态：接受 ${idleRun.accepted}/${idleRun.total}${idleRun.refusedIdle ? `，**空闲被拒 ${idleRun.refusedIdle} 次（真 bug 样本）**` : '，无空闲被拒'}`);
  console.log(`在播期间：接受 ${busyRun.accepted}/${busyRun.total}，被拒 ${busyRun.refusedBusy} 次（刻意设计，采纳率 ${Math.round((busyRun.accepted / busyRun.total) * 100)}%）`);
  console.log(`滑动瞬间采样有效性：busy=1 的样本 ${busyRun.refusedBusy + busyRun.accepted} 个 → 证明"在滑动瞬间取状态"能区分两种拒绝`);
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}
