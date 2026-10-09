#!/usr/bin/env node
/**
 * Experience pass for the param-id alias fix (exploratory, not automation).
 * Loads megumin / tsumiki / enterprise in the standalone app like a real user
 * and records: full-page shots (idle, then ±tilt), idle-motion amplitude (as
 * an objective "does it feel alive" proxy), console/page errors, and layout
 * facts (canvas size, clipping, HUD overlay).
 *
 * Run: dsh-e2e run docs/features/261010-vtuber-model-sourcing/experience-pass.mjs
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
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ['megumin', 'tsumiki', 'enterprise'];

const BEFORE = readFileSync(CFG, 'utf8');
const pin = (name) => {
	const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
	Object.assign(cfg, { modelPath: LIB, modelSelection: name, gyroParallax: true, eyeTracking: false, liveMode: 'first' });
	writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const diffPct = (a, b) => parseFloat(execSync(`python3 - <<'PY'
from PIL import Image, ImageChops
a = Image.open(${JSON.stringify(a)}).convert('RGB'); b = Image.open(${JSON.stringify(b)}).convert('RGB')
if a.size != b.size: b = b.resize(a.size)
d = ImageChops.difference(a, b).convert('L'); px = d.load(); w, h = d.size
print(f"{100.0 * sum(1 for y in range(h) for x in range(w) if px[x,y] > 24) / (w*h):.3f}")
PY`, { encoding: 'utf8' }).trim());

const browser = await chromium.launch({
	executablePath: CHROMIUM, headless: true,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 420, height: 840 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { window.__tiltSeen = 0; window.addEventListener('deviceorientation', () => { window.__tiltSeen++; }, true); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`.slice(0, 160)); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(ORIGIN, '')}`); });
page.on('requestfailed', (r) => errors.push(`REQFAIL ${r.url().replace(ORIGIN, '')} ${r.failure()?.errorText ?? ''}`));

const created = await fetch(`${ORIGIN}/live2d-voice/session`, {
	method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'exp-pass' }),
}).then((r) => r.json());
const URL = `${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(created.sessionId)}`;
mkdirSync(SHOTS, { recursive: true });

const tilt = (gamma) => page.evaluate((g) => {
	const send = (v) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 45, gamma: v, absolute: false }));
	for (let i = 0; i < 12; i++) send(0);
	for (let i = 0; i < 80; i++) send(g);
}, gamma);

try {
	for (const model of MODELS) {
		pin(model);
		const t0 = Date.now();
		errors.length = 0;
		await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
		await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 15000 }).catch(() => {});
		await page.waitForTimeout(4000);
		const s1 = `${SHOTS}/${model}-idle1.png`; await page.screenshot({ path: s1, timeout: 60000 });
		await page.waitForTimeout(2500);
		const s2 = `${SHOTS}/${model}-idle2.png`; await page.screenshot({ path: s2, timeout: 60000 });
		await tilt(30); await page.waitForTimeout(2500);
		const s3 = `${SHOTS}/${model}-tilt+.png`; await page.screenshot({ path: s3, timeout: 60000 });
		await tilt(-30); await page.waitForTimeout(2500);
		const s4 = `${SHOTS}/${model}-tilt-.png`; await page.screenshot({ path: s4, timeout: 60000 });

		const info = await page.evaluate(() => {
			const c = document.querySelector('.lv-stage canvas');
			const r = c.getBoundingClientRect();
			const stage = document.querySelector('.lv-stage');
			return {
				paramIds: stage?.dataset?.lvParamIds ?? null,
				canvas: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
				viewport: { w: innerWidth, h: innerHeight },
				tiltSeen: window.__tiltSeen,
				hudButtons: document.querySelectorAll('.lv-root button').length,
				subtitleCards: document.querySelectorAll('.lv-sub-card').length,
				toasts: [...document.querySelectorAll('.lv-toast, [class*=toast]')].map((n) => n.textContent?.slice(0, 40)),
			};
		});
		const idle = diffPct(s1, s2);
		const drive = diffPct(s1, s3);
		console.log(`\n### ${model} — load ${((Date.now() - t0) / 1000).toFixed(1)}s`);
		console.log(`  paramIds=${info.paramIds}`);
		console.log(`  canvas=${JSON.stringify(info.canvas)} viewport=${JSON.stringify(info.viewport)} tiltEvents=${info.tiltSeen} hud=${info.hudButtons} toasts=${JSON.stringify(info.toasts)}`);
		console.log(`  idleMotion=${idle}% tiltDrive=${drive}% ratio=${(drive / Math.max(idle, 0.01)).toFixed(1)}x`);
		console.log(`  errors(${errors.length}): ${errors.slice(0, 6).join(' | ') || 'none'}`);
	}
} finally {
	writeFileSync(CFG, BEFORE);
	await browser.close();
}
