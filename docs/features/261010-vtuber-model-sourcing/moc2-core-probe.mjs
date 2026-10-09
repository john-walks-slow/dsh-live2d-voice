#!/usr/bin/env node
/**
 * Root-cause probe for the moc2 (`model.json`) path: which branch of
 * `hasParam()` in src/client/model.ts decides that a Cubism 2.1 core declares
 * "ParamAngleX" when its .moc only contains PARAM_ANGLE_X?
 *
 * Traps the global `Live2DModelWebGL` assignment made by
 * /live2d-voice/core/live2d.min.js (loaded before the model mounts), wraps
 * `getParamIndex` / `setParamFloat` on its prototype, and dumps:
 *   - what each queried id returned,
 *   - the shape the plugin's hasParam() sees on that core object,
 *   - the ids the drive actually wrote.
 *
 * Run: dsh-e2e run docs/features/261010-vtuber-model-sourcing/moc2-core-probe.mjs [model]
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = `${HOME}/live2d-voice.json`;
const LIB = '/root/.dsh/live2d-voice-models';
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';
const MODEL = process.argv[2] ?? 'zongzi';
const WATCH = ['ParamAngleX', 'PARAM_ANGLE_X', 'ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y', 'ParamEyeBallX', 'PARAM_EYE_BALL_X', 'PARAM_BODY_ANGLE_X'];

const BEFORE = readFileSync(CFG, 'utf8');
const cfg = JSON.parse(BEFORE);
Object.assign(cfg, { modelPath: LIB, modelSelection: MODEL, gyroParallax: true, eyeTracking: false, liveMode: 'first', idleInterval: 0 });
writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');

const browser = await chromium.launch({
	executablePath: CHROMIUM, headless: true,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 420, height: 840 } });
await ctx.addInitScript((watch) => {
	localStorage.setItem('lv-look-params-v2', JSON.stringify({
		camPanGain: 0, gyroPanGain: 0, camAngleGain: 0, gyroAngleGain: 1,
		camRollGain: 0, gyroRollGain: 0, camEyeGain: 0, gyroEyeGain: 1,
		panRange: 0, angleRange: 40, rollRange: 0, bodyZGain: 0,
	}));
	const log = { gpi: {}, gpiCount: 0, writes: {}, shape: null, patched: false, sdkFound: false };
	window.__moc2Log = log;
	let real;
	const instrument = (Ctor) => {
		const proto = Ctor && Ctor.prototype;
		if (!proto) return;
		log.sdkFound = true;
		for (const name of ['getParamIndex', 'setParamFloat']) {
			const orig = proto[name];
			if (typeof orig !== 'function') continue;
			proto[name] = function (a, b) {
				const out = orig.apply(this, arguments);
				if (name === 'getParamIndex') {
					log.gpiCount++;
					const id = String(a);
					if (watch.includes(id) && log.gpi[id] === undefined) log.gpi[id] = out;
				} else {
					const id = String(a);
					const rec = log.writes[id] || (log.writes[id] = { n: 0, min: Infinity, max: -Infinity });
					rec.n++; if (typeof b === 'number') { rec.min = Math.min(rec.min, b); rec.max = Math.max(rec.max, b); }
					if (!log.shape) {
						log.shape = {
							ctor: this.constructor && this.constructor.name,
							has_model: this._model !== undefined,
							model_parameters_ids: Array.isArray(this._model?.parameters?.ids) ? this._model.parameters.ids.slice(0, 6) : String(this._model?.parameters?.ids),
							has_underscore_parameterIds: Array.isArray(this._parameterIds),
							underscore_parameterIds: Array.isArray(this._parameterIds) ? this._parameterIds.slice(0, 6) : null,
							model_keys: this._model ? Object.keys(this._model).filter((k) => /param/i.test(k)).slice(0, 10) : null,
						};
					}
				}
				return out;
			};
			log.patched = true;
		}
	};
	Object.defineProperty(window, 'Live2DModelWebGL', {
		configurable: true,
		get: () => real,
		set: (v) => { real = v; instrument(v); },
	});
}, WATCH);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
	const created = await fetch(`${ORIGIN}/live2d-voice/session`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'moc2-probe' }),
	}).then((r) => r.json());
	await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(created.sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
	await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 15000 }).catch(() => {});
	await page.waitForTimeout(4000);
	// Feed the gyro channel: neutral calibration burst, then hold +30° roll.
	await page.evaluate(() => {
		const send = (g) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 45, gamma: g, absolute: false }));
		for (let i = 0; i < 12; i++) send(0);
		for (let i = 0; i < 80; i++) send(30);
	});
	await page.waitForTimeout(2500);
	const out = await page.evaluate((watch) => {
		const log = window.__moc2Log;
		const writes = {};
		for (const id of watch) if (log.writes[id]) writes[id] = log.writes[id];
		return {
			gpi: log.gpi, gpiCount: log.gpiCount, patched: log.patched, sdkFound: log.sdkFound,
			writesOfWatchedIds: writes,
			allWrittenIds: Object.keys(log.writes).length,
			shape: log.shape,
			published: document.querySelector('.lv-stage')?.dataset?.lvParamIds,
		};
	}, WATCH);
	console.log(JSON.stringify(out, null, 2));
	if (errors.length) console.log('pageerrors:', errors.slice(0, 3));
} finally {
	writeFileSync(CFG, BEFORE);
	await browser.close();
}
