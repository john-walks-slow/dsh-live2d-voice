/**
 * Deterministic unit tests for the gaze-behavior controller (behavior.ts).
 *
 * The project has no test framework — this file compiles behavior.ts on the
 * fly with esbuild (already a dev dependency) and asserts against a seeded
 * RNG so every run is reproducible.
 *
 * Run: node --test tests/behavior.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, ".behavior.mjs");
execFileSync(
	"npx",
	["esbuild", join(here, "..", "src/client/behavior.ts"), "--bundle", "--format=esm", `--outfile=${out}`],
	{ stdio: "ignore" },
);
const { BehaviorController, DEFAULT_BEHAVIOR_TUNING } = await import(`${out}?t=${Date.now()}`);

/** mulberry32 — small, fast, deterministic. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const FACE = { x: 0.5, y: 0.42 };
const idleInput = () => ({ face: FACE, userLooking: true, userLookRising: false, speaking: null, userSpeaking: false, thinking: false, sentenceBoundary: false, speechStart: false });

test("outputs stay finite and in range over a long noisy run", () => {
	const ctl = new BehaviorController({}, mulberry32(42));
	let now = 0;
	for (let i = 0; i < 10000; i++) {
		const out = ctl.update(idleInput(), now);
		assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y), `frame ${i}: x/y finite`);
		assert.ok(Number.isFinite(out.nod) && Number.isFinite(out.tilt) && Number.isFinite(out.turn) && Number.isFinite(out.bodySway));
		assert.ok(out.x >= 0 && out.x <= 1 && out.y >= 0 && out.y <= 1);
		assert.ok(out.nod >= 0 && out.nod <= 1.001, `nod envelope 0..1, got ${out.nod}`);
		assert.ok(Math.abs(out.tilt) <= 1.001 && Math.abs(out.turn) <= 1.001 && Math.abs(out.bodySway) <= 1.001);
		now += 16;
	}
});

test("eye-contact dwells stay within the configured bounds", () => {
	const ctl = new BehaviorController({}, mulberry32(7));
	let now = 0;
	let dwells = [];
	let current = null;
	let enteredAt = 0;
	for (let i = 0; i < 60000; i++) {
		const out = ctl.update(idleInput(), now);
		if (out.state !== current) {
			if (current === "eye-contact") dwells.push(now - enteredAt);
			current = out.state;
			enteredAt = now;
		}
		now += 16;
		if (now > 120000) break;
	}
	assert.ok(dwells.length >= 3, `expected several eye-contact episodes, got ${dwells.length}`);
	for (const d of dwells) {
		assert.ok(d >= DEFAULT_BEHAVIOR_TUNING.eyeContactMinMs - 50, `dwell ${d} >= min`);
		assert.ok(d <= DEFAULT_BEHAVIOR_TUNING.eyeContactMaxMs + 1200, `dwell ${d} <= max+frame slack`);
	}
});

test("userLookRising plays the attention script: contact → aversion → contact", () => {
	const ctl = new BehaviorController({}, mulberry32(3));
	let now = 0;
	// Let it settle into some state first.
	for (let i = 0; i < 120; i++) { ctl.update(idleInput(), now); now += 16; }
	const order = [];
	let current = ctl.update({ ...idleInput(), userLookRising: true }, now).state;
	let seen = 1;
	for (let i = 0; i < 2000; i++) {
		now += 16;
		const s = ctl.update(idleInput(), now).state;
		if (s !== current) {
			order.push(current);
			current = s;
			seen++;
		}
		if (seen >= 6) break;
	}
	assert.ok(order.length >= 2, `script produced state changes: ${order.join(" → ")}`);
	assert.equal(order[0], "eye-contact", `attention starts with eye contact, got ${order.join(" → ")}`);
});

test("speechStart begins with an aversion (turn-start)", () => {
	const ctl = new BehaviorController({}, mulberry32(11));
	let now = 0;
	for (let i = 0; i < 120; i++) { ctl.update(idleInput(), now); now += 16; }
	const first = ctl.update({ ...idleInput(), speechStart: true, speaking: "assistant" }, now).state;
	assert.equal(first, "aversion", `turn-start should open with aversion, got ${first}`);
});

test("thinking spends most time in aversion (≈ thinkAversionRatio)", () => {
	const ctl = new BehaviorController({}, mulberry32(99));
	let now = 0;
	const input = () => ({ face: FACE, userLooking: true, userLookRising: false, speaking: null, userSpeaking: false, thinking: true, sentenceBoundary: false, speechStart: false });
	let aversionMs = 0;
	const totalMs = 60000;
	while (now < totalMs) {
		const out = ctl.update(input(), now);
		if (out.state === "aversion") aversionMs += 16;
		now += 16;
	}
	const ratio = aversionMs / totalMs;
	const expected = DEFAULT_BEHAVIOR_TUNING.thinkAversionRatio;
	assert.ok(
		Math.abs(ratio - expected) < 0.25,
		`thinking aversion ratio ${ratio.toFixed(2)} ≈ ${expected} (±0.25)`,
	);
});

test("speaking look-ratio lands near speakLookRatio", () => {
	const ctl = new BehaviorController({}, mulberry32(1234));
	let now = 0;
	const input = () => ({ face: FACE, userLooking: true, userLookRising: false, speaking: "assistant", userSpeaking: false, thinking: false, sentenceBoundary: false, speechStart: false });
	let contactMs = 0;
	const totalMs = 120000;
	while (now < totalMs) {
		const out = ctl.update(input(), now);
		if (out.state === "eye-contact") contactMs += 16;
		now += 16;
	}
	const ratio = contactMs / totalMs;
	const expected = DEFAULT_BEHAVIOR_TUNING.speakLookRatio;
	assert.ok(
		Math.abs(ratio - expected) < 0.2,
		`speaking look ratio ${ratio.toFixed(2)} ≈ ${expected} (±0.2)`,
	);
});

test("listening look-ratio lands near listenLookRatio", () => {
	const ctl = new BehaviorController({}, mulberry32(777));
	let now = 0;
	const input = () => ({ face: FACE, userLooking: true, userLookRising: false, speaking: null, userSpeaking: true, thinking: false, sentenceBoundary: false, speechStart: false });
	let contactMs = 0;
	const totalMs = 120000;
	while (now < totalMs) {
		const out = ctl.update(input(), now);
		if (out.state === "eye-contact") contactMs += 16;
		now += 16;
	}
	const ratio = contactMs / totalMs;
	const expected = DEFAULT_BEHAVIOR_TUNING.listenLookRatio;
	assert.ok(
		Math.abs(ratio - expected) < 0.2,
		`listening look ratio ${ratio.toFixed(2)} ≈ ${expected} (±0.2)`,
	);
});

test("liveliness paces dwells (higher liveliness → shorter contact)", () => {
	const slow = new BehaviorController({ liveliness: 0.5 }, mulberry32(31));
	const fast = new BehaviorController({ liveliness: 1.5 }, mulberry32(31)); // same seed, same sequence
	const measure = (ctl) => {
		let now = 0;
		let dwells = [];
		let current = null;
		let enteredAt = 0;
		for (let i = 0; i < 80000; i++) {
			const out = ctl.update(idleInput(), now);
			if (out.state !== current) {
				if (current === "eye-contact") dwells.push(now - enteredAt);
				current = out.state;
				enteredAt = now;
			}
			now += 16;
			if (now > 90000) break;
		}
		return dwells;
	};
	const slowDwells = measure(slow);
	const fastDwells = measure(fast);
	const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
	assert.ok(slowDwells.length >= 3 && fastDwells.length >= 3);
	assert.ok(avg(fastDwells) < avg(slowDwells), `fast avg ${avg(fastDwells).toFixed(0)}ms < slow avg ${avg(slowDwells).toFixed(0)}ms`);
});

test("setTuning changes timing live", () => {
	const ctl = new BehaviorController({}, mulberry32(5));
	ctl.setTuning({ eyeContactMaxMs: 600, aversionMaxMs: 400 });
	let now = 0;
	let dwells = [];
	let current = null;
	let enteredAt = 0;
	for (let i = 0; i < 60000; i++) {
		const out = ctl.update(idleInput(), now);
		if (out.state !== current) {
			if (current === "eye-contact") dwells.push(now - enteredAt);
			current = out.state;
			enteredAt = now;
		}
		now += 16;
		if (now > 80000) break;
	}
	assert.ok(dwells.length >= 3);
	for (const d of dwells) {
		assert.ok(d <= 600 + 1200, `tuned dwell ${d} <= 600ms + slack`);
	}
});

test("no face → wander/rest/scan cycle still moves the eyes", () => {
	const ctl = new BehaviorController({}, mulberry32(21));
	let now = 0;
	const states = new Set();
	for (let i = 0; i < 20000; i++) {
		states.add(ctl.update({ ...idleInput(), face: null }, now).state);
		now += 16;
	}
	assert.ok(states.has("wander") || states.has("rest") || states.has("scan"), `idle states seen: ${[...states].join(",")}`);
});
