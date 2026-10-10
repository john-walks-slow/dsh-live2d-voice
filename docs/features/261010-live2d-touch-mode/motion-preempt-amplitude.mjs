#!/usr/bin/env node
/**
 * 抢占的**幅度辅助判据**（261010-gesture-preempt）：抢占那一帧到底有没有"跳变"？
 *
 * 主判据不在这里（主判据是确定性的：preemptGesture 计数、手势值/序列号前进、
 * lvMotionBusy=1，见 `e2e/verify-touch-mode.mjs` 的 T16/T19/T20/T21/T22）。
 * 本脚本只负责回答"观感"这一层，并按验收口径自带**负对照**：
 *
 *   判据（辅助）：跨抢占窗口的帧间姿态最大增量 ≤ 该动作**自己播放时的帧间增量峰值**
 *                （即"抢占那一下没有比这个动作正常播放时更快的姿态变化"）
 *   负对照（必须变红）：注入一次 30° 人为跳变 → 同一判据必须判红
 *
 * 为什么不用"≤基准 p95×1.5"：基准窗口里的样本既有"几乎不动的帧"也有"动作自己的
 * 最快帧"，p95 对样本量极敏感（同一份代码实测 p95 在 0.2°~30° 之间跳），
 * 该口径在这里不可复现。峰值口径与"观感"对应得更直接，且负对照能稳定判红。
 *
 * 两趟同一套测量代码，只有"跨越那一刻发生了什么"不同：
 *   mode=preempt —— 真手势抢占（真实滑动触发，不是手搓 stopAll+start）
 *   mode=snap    —— 同一时刻注入 30°（模拟真跳变，验证判据的探测能力）
 *
 * 采样点：`afterMotionUpdate`（动作混合刚写完、focus/表情/呼吸/物理之前）= 动作自己的姿态。
 * **不能**放在 `beforeModelUpdate`：那里读到的参数已被库自带 autoInteract 的
 * focus（pointermove → focus×30 → ANGLE_XYZ）改过，滑动本身就会在序列里留下一个
 * ~30° 的合法尖峰，阈值被抬到 45°，负对照永远红不了（第一版实测的坑）。
 *
 * 需要**临时探针构建**，在 src/client/model.ts 里插入：
 *
 *   (internal as unknown as { on: (event: string, cb: () => void) => unknown }).on("afterMotionUpdate", () => {
 *     const probe = window as unknown as {
 *       __lvProbeLog?: Array<Record<string, number | string | null>>;
 *       __lvProbeSnapDeg?: number | null;
 *     };
 *     if (!probe.__lvProbeLog) return;
 *     const coreModel = (internal as unknown as { coreModel?: { getParameterValueById?: (id: string) => number } }).coreModel;
 *     const read = (id: string) => (typeof coreModel?.getParameterValueById === "function" ? coreModel.getParameterValueById(id) : Number.NaN);
 *     const r3 = (v: number) => Math.round(v * 1000) / 1000;
 *     if (probe.__lvProbeSnapDeg) {
 *       setParam(LOOK_IDS.angleY, read(LOOK_IDS.angleY) + probe.__lvProbeSnapDeg);
 *       setParam(LOOK_IDS.bodyY, read(LOOK_IDS.bodyY) + probe.__lvProbeSnapDeg / 2);
 *       probe.__lvProbeLog.push({ t: Math.round(performance.now()), snap: probe.__lvProbeSnapDeg });
 *       probe.__lvProbeSnapDeg = null;
 *     }
 *     probe.__lvProbeLog.push({ t: Math.round(performance.now()),
 *       ax: r3(read(LOOK_IDS.angleX)), ay: r3(read(LOOK_IDS.angleY)), az: r3(read(LOOK_IDS.angleZ)),
 *       bx: r3(read(LOOK_IDS.bodyX)), by: r3(read(LOOK_IDS.bodyY)), bz: r3(read(LOOK_IDS.bodyZ)), m: r3(getMouth()) });
 *   });
 *
 * 跑法：`dsh-e2e run docs/features/261010-live2d-touch-mode/motion-preempt-amplitude.mjs`
 * 帧率：headless 软件渲染默认低到 ~0.4 帧/s，必须带下面那组反节流开关，否则"帧间增量"没有意义。
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const SNAP_DEG = Number(process.env.SNAP_DEG ?? 30);
const WINDOW_BEFORE_MS = 30;
const WINDOW_AFTER_MS = 300;
const RATIO = 1.5;

if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = () => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, {
    modelPath: '/root/.dsh/live2d-voice-models', modelSelection: 'izumi', liveMode: 'first',
    eyeTracking: false, gyroParallax: false, idleInterval: 0, touchMode: true,
  });
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

/** 帧间姿态增量序列：{ tMid, d }（d = 该帧三个头部角度里变化最大的那个）。 */
const series = (log) => {
  const frames = log.filter((e) => typeof e.ax === 'number');
  const out = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    out.push({
      tMid: (a.t + b.t) / 2,
      d: Math.max(
        Math.abs(b.ax - a.ax), Math.abs(b.ay - a.ay), Math.abs(b.az - a.az),
        Math.abs(b.bx - a.bx), Math.abs(b.by - a.by), Math.abs(b.bz - a.bz),
      ),
    });
  }
  return { frames, deltas: out };
};
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : Number.NaN);

const analyze = (log, t1, label) => {
  const { frames, deltas } = series(log);
  if (deltas.length < 8) return { label, ok: false, reason: `帧太少（${deltas.length}），反节流开关没生效？` };
  const span = frames[frames.length - 1].t - frames[0].t;
  const baseline = deltas.filter((x) => x.tMid < t1 - 100).map((x) => x.d).sort((a, b) => a - b);
  const inWindow = deltas.filter((x) => x.tMid >= t1 - WINDOW_BEFORE_MS && x.tMid <= t1 + WINDOW_AFTER_MS).map((x) => x.d);
  if (!baseline.length || !inWindow.length) return { label, ok: false, reason: `窗口里没有样本（基准 ${baseline.length} / 窗口 ${inWindow.length}）` };
  const p95 = pct(baseline, 0.95);
  const med = pct(baseline, 0.5);
  const baseMax = baseline[baseline.length - 1];
  const bound = Math.max(...inWindow);
  return {
    label, ok: true,
    frames: frames.length, fps: (frames.length / (span / 1000)).toFixed(1),
    baselineN: baseline.length, med, p95, baseMax,
    bound, threshold: baseMax, p95Threshold: p95 * RATIO,
    green: bound <= baseMax,
  };
};

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  ],
});

const rows = [];
try {
  pin();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();

  const load = async () => {
    const { sessionId } = await fetch(`${ORIGIN}/live2d-voice/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'preempt-amplitude' }),
    }).then((r) => r.json());
    await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
  };
  const hasProbe = () => page.evaluate(() => typeof window.__lvProbeLog !== 'undefined' || true);
  const readCounters = () => page.evaluate(() => {
    const d = document.querySelector('.lv-stage')?.dataset ?? {};
    return { gesture: d.lvGesture ?? null, preempt: Number(d.lvPreemptGesture ?? -1), busy: d.lvMotionBusy ?? null, seq: d.lvGestureSeq ?? null };
  });
  const waitIdle = async (capMs = 8000) => {
    const end = Date.now() + capMs;
    while (Date.now() < end) {
      if ((await readCounters()).busy === '0') return true;
      await page.waitForTimeout(60);
    }
    return false;
  };
  /**
   * 一次测量：滑动 A（被接受）→ 等 600ms（冷却已过、片长未到）→ 跨越动作 → 采样。
   * 两次滑动都在**页内**连发，跨越时刻用页面自己的时钟标记。
   */
  const measure = async ({ mode }) => {
    await load();
    if (!(await hasProbe())) return null;
    await waitIdle();
    await page.evaluate(() => {
      window.__lvProbeLog = [];
      window.__lvProbeSnapDeg = null;
      const stage = document.querySelector('.lv-stage');
      const rect = stage.getBoundingClientRect();
      window.__lvX = rect.left + rect.width * 0.5;
      window.__lvY = rect.top + rect.height * 0.4;
      window.__lvFire = (type, px, py) => stage.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true,
        buttons: type === 'pointerup' ? 0 : 1,
      }));
      window.__lvSwipe = async (dx) => {
        window.__lvFire('pointerdown', window.__lvX, window.__lvY);
        await new Promise((r) => setTimeout(r, 50));
        for (let i = 1; i <= 5; i++) window.__lvFire('pointermove', window.__lvX + (dx * i) / 5, window.__lvY);
        window.__lvFire('pointerup', window.__lvX + dx, window.__lvY);
      };
    });
    const before = await readCounters();
    const marks = await page.evaluate(async ([mode, snapDeg]) => {
      await window.__lvSwipe(160); // A：被接受，动作进入播放态
      await new Promise((r) => setTimeout(r, 600)); // 冷却 400ms 已过、片长（1.9~2.6s）未到
      const pre = { t: performance.now(), gesture: document.querySelector('.lv-stage').dataset.lvGesture ?? null };
      if (mode === 'snap') {
        window.__lvProbeSnapDeg = snapDeg; // 下一帧注入人为跳变
      } else {
        await window.__lvSwipe(-160); // B：真手势抢占
      }
      const t1 = performance.now();
      await new Promise((r) => setTimeout(r, 900));
      return { pre, t1, gestureAfter: document.querySelector('.lv-stage').dataset.lvGesture ?? null };
    }, [mode, SNAP_DEG]);
    const after = await readCounters();
    const log = await page.evaluate(() => window.__lvProbeLog);
    return { before, after, marks, log };
  };

  for (const mode of ['preempt', 'snap']) {
    const res = await measure({ mode });
    if (!res) { console.log(`× 页面里没有 __lvProbeLog（临时探针构建没被服务？）`); process.exit(1); }
    const verdict = analyze(res.log, res.marks.t1, mode);
    rows.push({ mode, verdict, res });
    console.log(`\n── mode=${mode} ──────────────────────────────────────────`);
    console.log(`  手势：${res.marks.pre.gesture} → ${res.marks.gestureAfter}   抢占计数 ${res.before.preempt}→${res.after.preempt}   seq ${res.before.seq}→${res.after.seq}`);
    if (!verdict.ok) { console.log(`  × ${verdict.reason}`); continue; }
    console.log(`  采样：${verdict.frames} 帧 / ${verdict.fps} fps，基准 ${verdict.baselineN} 个帧间增量`);
    console.log(`  基准（跨越前）：中位 ${verdict.med.toFixed(3)}°  p95 ${verdict.p95.toFixed(3)}°  峰值 ${verdict.baseMax.toFixed(3)}°（p95×${RATIO}=${verdict.p95Threshold.toFixed(3)}°，仅记录）`);
    console.log(`  跨越窗口 [t1-${WINDOW_BEFORE_MS}, t1+${WINDOW_AFTER_MS}]ms：最大帧间增量 ${verdict.bound.toFixed(3)}°`);
    console.log(`  判据：跨越 ≤ 动作自身峰值 ${verdict.threshold.toFixed(3)}°  →  ${verdict.green ? '无跳变（绿）' : '检出跳变（红）'}`);
  }
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}

const preempt = rows.find((r) => r.mode === 'preempt')?.verdict;
const snap = rows.find((r) => r.mode === 'snap')?.verdict;
console.log('\n══ 结论 ═══════════════════════════════════════════════');
const realOk = Boolean(preempt?.ok && preempt.green);
const controlOk = Boolean(snap?.ok && !snap.green && snap.bound >= 25);
console.log(`${realOk ? '✓' : '✗'} 真抢占无跳变：${preempt?.ok ? `跨越 ${preempt.bound.toFixed(3)}° ≤ 动作自身峰值 ${preempt.threshold.toFixed(3)}°` : preempt?.reason}`);
console.log(`${controlOk ? '✓' : '✗'} 负对照可判红：注入 ${SNAP_DEG}° → ${snap?.ok ? `跨越 ${snap.bound.toFixed(3)}° > 阈值 ${snap.threshold.toFixed(3)}°` : snap?.reason}`);
process.exit(realOk && controlOk ? 0 : 1);
