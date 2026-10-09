#!/usr/bin/env node
/**
 * Tight-interval A/B (exploratory). Pair-diff methods that use a ~2s gap for
 * the noise baseline drown on models with constant breathing/hair physics
 * (hiyori, deepseek-chan, zongzi): the baseline ends up as large as the drive.
 * Here each state is sampled as a *burst* of frames 400ms apart: within-state
 * diffs measure only sub-second motion (small), while the between-state diff
 * measures the ±18° head turn. Median over the burst pairs kills blink luck.
 *
 * Run: dsh-e2e run docs/features/261010-vtuber-model-sourcing/ab-tight.mjs [model...]
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = `${HOME}/live2d-voice.json`;
const LIB = '/root/.dsh/live2d-voice-models';
const SHOTS = resolve(import.meta.dirname, 'shots');
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ['hiyori', 'deepseek-chan', 'zongzi', 'm4a1'];
const EXPECTED = {
	tsumiki: 'PARAM_ANGLE_X', megumin: 'PARAM_ANGLE_X', zongzi: 'PARAM_ANGLE_X',
	hiyori: 'ParamAngleX', 'deepseek-chan': 'ParamAngleX', enterprise: 'ParamAngleX', ar15: 'ParamAngleX',
	m4a1: 'ParamAngleX',
};

const BEFORE = readFileSync(CFG, 'utf8');
const pin = (name) => {
	const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
	Object.assign(cfg, { modelPath: LIB, modelSelection: name, gyroParallax: true, eyeTracking: false, liveMode: 'first', idleInterval: 0 });
	writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const diffPct = (a, b, box) => parseFloat(execSync(`python3 - <<'PY'
from PIL import Image, ImageChops
a = Image.open(${JSON.stringify(a)}).convert('RGB').crop(tuple(${JSON.stringify(box)}))
b = Image.open(${JSON.stringify(b)}).convert('RGB').crop(tuple(${JSON.stringify(box)}))
d = ImageChops.difference(a, b).convert('L'); px = d.load(); w, h = d.size
print(f"{100.0 * sum(1 for y in range(h) for x in range(w) if px[x, y] > 24) / (w * h):.3f}")
PY`, { encoding: 'utf8' }).trim());

const median = (xs) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];

const browser = await chromium.launch({
	executablePath: CHROMIUM, headless: true,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 720, height: 1000 } });
await ctx.addInitScript(() => {
	localStorage.setItem('lv-look-params-v2', JSON.stringify({
		camPanGain: 0, gyroPanGain: 0, camAngleGain: 0, gyroAngleGain: 1,
		camRollGain: 0, gyroRollGain: 0, camEyeGain: 0, gyroEyeGain: 1,
		panRange: 0, angleRange: 40, rollRange: 0, bodyZGain: 0,
	}));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const tilt = (gamma) => page.evaluate((g) => {
	const send = (v) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 45, gamma: v, absolute: false }));
	for (let i = 0; i < 12; i++) send(0);
	for (let i = 0; i < 80; i++) send(g);
}, gamma);

const created = await fetch(`${ORIGIN}/live2d-voice/session`, {
	method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'ab-tight' }),
}).then((r) => r.json());
const URL = `${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(created.sessionId)}`;
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (id, ok, note = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${id}${note ? ` — ${note}` : ''}`); };

const burst = async (prefix, box, n = 3) => {
	const paths = [];
	for (let i = 0; i < n; i++) {
		const p = `${SHOTS}/${prefix}-${i}.png`;
		await page.screenshot({ path: p, clip: { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] }, timeout: 60000 });
		paths.push(p);
		await page.waitForTimeout(400);
	}
	return paths;
};

try {
	for (const model of MODELS) {
		pin(model);
		await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
		await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 15000 }).catch(() => {});
		await page.waitForTimeout(6000); // mount toast gone, model settled
		const ids = await page.evaluate(() => { try { return JSON.parse(document.querySelector('.lv-stage').dataset.lvParamIds); } catch { return null; } });
		const bb = await (await page.$('.lv-stage canvas')).boundingBox();
		// Bottom 20% cut: HUD pill + toasts. Top 55% kept: the head/face band.
		const box = [Math.round(bb.x), Math.round(bb.y), Math.round(bb.x + bb.width), Math.round(bb.y + (bb.height - Math.round(bb.height * 0.2)))];

		const N = await burst(`${model}-tight-N`, box);
		await tilt(30); await page.waitForTimeout(2600);
		const P = await burst(`${model}-tight-P`, box);
		await tilt(-30); await page.waitForTimeout(2600);
		const M = await burst(`${model}-tight-M`, box);

		const within = [...N, ...P, ...M].length ? median([
			diffPct(N[0], N[1], box), diffPct(N[1], N[2], box),
			diffPct(P[0], P[1], box), diffPct(P[1], P[2], box),
			diffPct(M[0], M[1], box), diffPct(M[1], M[2], box),
		]) : 0;
		const drive = median([diffPct(N[0], P[0], box), diffPct(N[1], P[1], box), diffPct(N[2], P[2], box)]);
		const span = median([diffPct(P[0], M[0], box), diffPct(P[1], M[1], box), diffPct(P[2], M[2], box)]);
		console.log(`  ${model}: ids=${ids?.look?.angleX} within=${within}% drive=${drive}% span=${span}% ratio=${(drive / Math.max(within, 0.001)).toFixed(1)}x`);
		if (model === 'm4a1') {
			check(`negative control ${model}: drive ≈ within-state noise`, drive < Math.max(within * 1.6, 0.5), `within=${within}% drive=${drive}%`);
		} else {
			check(`${model}: tilt drive separates from sub-second noise`, drive > within * 3 && drive > 1.5, `within=${within}% drive=${drive}% span=${span}%`);
			check(`${model}: opposite tilts separate too`, span > within * 3, `within=${within}% span=${span}%`);
		}
		check(`${model} publishes ${EXPECTED[model]}`, ids?.look?.angleX === EXPECTED[model], ids ? `${ids.look.angleX}/${ids.look.eyeX}/${ids.mouth}` : 'missing');
	}
	check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
	writeFileSync(CFG, BEFORE);
	await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
