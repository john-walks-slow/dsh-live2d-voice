// e2e/lib/boot.mjs — shared zero-API boot helpers for e2e suites.
//
// Practice (see docs/references/260927-e2e-testing.md): never burn a real
// LLM/TTS round just to obtain a session id. Reuse an existing session —
// open its GUI sidebar row, or hit the standalone entry with ?session= —
// and capture the id from the /live2d-voice/stream?session=<id> request
// the Live2D view issues on attach. Suites that genuinely need agent
// replies send their own probe messages inside their assertion sections,
// never from the boot step.

import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const E2E_URL = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
export const E2E_SESSIONS = process.env.E2E_SESSIONS ?? '/root/.dsh-e2e/sessions';

const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';

/** Shared headless chromium (swiftshader rendering on the ARM box). */
export async function launch() {
	return pw.chromium.launch({
		executablePath: CHROMIUM,
		headless: true,
		args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
	});
}

/**
 * Collect session ids the page attaches to. The Live2D view opens an
 * EventSource on /live2d-voice/stream?session=<id> when it mounts, so the
 * id of the session the view is bound to is captured deterministically —
 * no websocket frame guessing, no prompt needed.
 */
export function streamCollector(page) {
	const ids = new Set();
	page.on('request', (r) => {
		const u = r.url();
		if (!u.includes('/live2d-voice/stream')) return;
		const m = u.match(/[?&]session=(session-[a-f0-9-]{30,})/);
		if (m) ids.add(m[1]);
	});
	return ids;
}

/**
 * Most recently active session id on disk (browser-less, API-less).
 * Layout: <sessionsRoot>/<workspace>/session-<uuid>/session.v3.jsonl.zstd.
 */
export function latestSessionId(sessionsRoot = E2E_SESSIONS) {
	const best = { t: 0, id: null };
	for (const ws of readdirSync(sessionsRoot)) {
		const wsDir = join(sessionsRoot, ws);
		let entries;
		try {
			entries = readdirSync(wsDir);
		} catch {
			continue; // not a directory (locks etc.)
		}
		for (const name of entries) {
			if (!name.startsWith('session-')) continue;
			try {
				const t = statSync(join(wsDir, name, 'session.v3.jsonl.zstd')).mtimeMs;
				if (t > best.t) {
					best.t = t;
					best.id = name;
				}
			} catch {
				// no log yet — session never persisted a turn, skip
			}
		}
	}
	return best.id;
}

/** Absolute log path for a session id (undefined when not on disk). */
export function sessionLogPath(sessionId, sessionsRoot = E2E_SESSIONS) {
	for (const ws of readdirSync(sessionsRoot)) {
		const p = join(sessionsRoot, ws, sessionId, 'session.v3.jsonl.zstd');
		try {
			statSync(p);
			return p;
		} catch {
			// keep looking
		}
	}
	return undefined;
}

/**
 * Click the first existing session row in the GUI sidebar. Zero prompts:
 * the agent stays cold, no LLM/TTS/ASR call happens. Mirrors the pattern
 * proven by verify-v11 D0.
 */
export function openSessionRow(page) {
	return page.evaluate(() => {
		const rows = [...document.querySelectorAll('[role="treeitem"]')].filter(
			(r) => String(r.className).includes('sessionRow') && (r.textContent ?? '').trim() !== 'New Session',
		);
		if (rows.length === 0) return false;
		rows[0].click();
		return true;
	});
}

/** Switch the open session view to the Live2D tab. */
export function openLiveTab(page) {
	return page.evaluate(() => {
		const matches = [...document.querySelectorAll('*')].filter(
			(el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D',
		);
		if (matches.length === 0) return false;
		let t = matches[0];
		while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
		t?.click();
		return Boolean(t);
	});
}

/** Standalone-entry URL for a session (chrome-less full-stage page). */
export function standaloneUrl(sessionId) {
	const origin = new URL(E2E_URL).origin;
	return `${origin}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`;
}
