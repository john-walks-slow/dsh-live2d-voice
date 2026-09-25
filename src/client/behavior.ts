/**
 * Natural gaze/head/body behavior controller — the "mind" that decides where
 * the character looks and how it holds its head/body, instead of mechanically
 * tracking the user's face.
 *
 * Pure policy: no DOM, no Live2D params, no imports. The view feeds it the
 * perception + conversation state and it returns screen-space look targets
 * and head/body pose intents; model.ts turns those into parameters.
 *
 * Timing anchors come from the behavior-science research report
 * (docs/features/260925-lively-gaze/260925-gaze-behavior-research.md §5):
 *  - mutual gaze episodes 0.5–3s (beyond ~3.3s reads as staring);
 *  - speakers look at the listener ~50–65% of the time (aversion at turn
 *    start, look back at turn end); listeners ~80–90%;
 *  - thinking → aversion ~70–80% (cognitive gaze aversion);
 *  - saccades every 0.8–4.4s (airi distribution), micro-saccades on top;
 *  - head follows eyes (eyes lead, head lags); body joins only on large
 *    shifts (Andrist/EGM eye-head-body coordination).
 *
 * Everything tunable lives in BehaviorTuning so "调手感只改一处".
 */

export type BehaviorState = "eye-contact" | "aversion" | "wander" | "scan" | "thinking" | "rest";

export interface BehaviorInput {
	/** Screen-space face position (0..1, 0.5 = center); null = face lost. */
	face: { x: number; y: number } | null;
	/** Perception verdict: is the user looking at the camera right now. */
	userLooking: boolean;
	/** Edge pulse: user just started looking (the character "notices"). */
	userLookRising: boolean;
	/** Whose speech is playing right now. */
	speaking: "assistant" | "player" | null;
	/** The user is talking (mic active / ASR interim). */
	userSpeaking: boolean;
	/** Assistant is generating a reply (post-submit, pre-speech). */
	thinking: boolean;
	/** Pulse: a sentence boundary just hit while speaking (turn-yield look). */
	sentenceBoundary: boolean;
	/** Pulse: the assistant just started speaking (turn-start aversion). */
	speechStart: boolean;
}

export interface BehaviorOutput {
	/** Screen-space look target (0..1); the driver maps it to params. */
	x: number;
	y: number;
	/** Nod envelope 0..1 (a nod in progress) — driver maps to head pitch. */
	nod: number;
	/** Head tilt -1..1 (negative = tilt left) — driver maps to roll. */
	tilt: number;
	/** Extra head turn -1..1 (negative = turn left) — driver maps to yaw. */
	turn: number;
	/** Body sway -1..1 (slow sinusoidal) — driver maps to body yaw. */
	bodySway: number;
	state: BehaviorState;
}

export interface BehaviorTuning {
	// ── 视线 (gaze) ──
	/** 单次互视时长范围 (ms)。超过 ~3.3s 即"盯人"不适。 */
	eyeContactMinMs: number;
	eyeContactMaxMs: number;
	/** 回避时长范围 (ms)。 */
	aversionMinMs: number;
	aversionMaxMs: number;
	/** 说话时看向用户的占比 (0..1)。真实 ~50–65%。 */
	speakLookRatio: number;
	/** 倾听时看向用户的占比 (0..1)。真实 ~80–90%。 */
	listenLookRatio: number;
	/** 思考时回避占比 (0..1)。真实 ~70–80%。 */
	thinkAversionRatio: number;
	/** 全局活泼度 (0.5–1.5)：>1 更频繁互视/扫视、回避更短。 */
	liveliness: number;
	// ── 扫视 (saccade) ──
	/** 扫视间隔倍率 (airi 分布基线的乘数)。 */
	saccadeScale: number;
	/** 微扫视幅度（屏比例，0..0.1）。 */
	microSaccadeAmp: number;
	// ── 头/身 (head & body) ──
	/** 倾听认同点头间隔 (秒)；0 = 关闭。 */
	nodEverySec: number;
	/** 思考/好奇歪头概率 (0..1)。 */
	headTiltProb: number;
	/** 重心微摆周期 (ms)。 */
	bodySwayPeriodMs: number;
	/** 视线回避时头跟随转向幅度（度）。 */
	aversionTurnDeg: number;
}

export const DEFAULT_BEHAVIOR_TUNING: BehaviorTuning = {
	eyeContactMinMs: 500,
	eyeContactMaxMs: 3000,
	aversionMinMs: 300,
	aversionMaxMs: 1500,
	speakLookRatio: 0.55,
	listenLookRatio: 0.85,
	thinkAversionRatio: 0.75,
	liveliness: 1.0,
	saccadeScale: 1.0,
	microSaccadeAmp: 0.03,
	nodEverySec: 9,
	headTiltProb: 0.3,
	bodySwayPeriodMs: 5200,
	aversionTurnDeg: 4,
};

/** localStorage key for the experiment tuning (client-side, like lookParams). */
export const BEHAVIOR_TUNING_KEY = "lv2d.behavior_tuning";

export function loadBehaviorTuning(): BehaviorTuning {
	try {
		if (typeof window === "undefined" || !window.localStorage) return { ...DEFAULT_BEHAVIOR_TUNING };
		const raw = window.localStorage.getItem(BEHAVIOR_TUNING_KEY);
		if (!raw) return { ...DEFAULT_BEHAVIOR_TUNING };
		return { ...DEFAULT_BEHAVIOR_TUNING, ...(JSON.parse(raw) as Partial<BehaviorTuning>) };
	} catch {
		return { ...DEFAULT_BEHAVIOR_TUNING };
	}
}

export function saveBehaviorTuning(tuning: BehaviorTuning): void {
	try {
		if (typeof window === "undefined" || !window.localStorage) return;
		window.localStorage.setItem(BEHAVIOR_TUNING_KEY, JSON.stringify(tuning));
	} catch {}
}

/** One step of a named behavior script (the "sequence" layer). */
interface ScriptStep {
	state: BehaviorState;
	dwellMs: number;
	/** Optional fixed look target; undefined = let the state pick. */
	target?: { x: number; y: number };
	nod?: number;
}

interface SaccadeSpec {
	/** Cumulative probability steps: [prob, intervalMs]. */
	steps: ReadonlyArray<readonly [number, number]>;
	tailMs: number;
}

/** airi's saccade interval distribution (400ms steps, peak 1.2–2.4s). */
const SACCADE_DIST: SaccadeSpec = {
	steps: [
		[0.075, 800],
		[0.11, 1200],
		[0.125, 1600],
		[0.14, 2000],
		[0.125, 2400],
		[0.05, 2800],
		[0.04, 3200],
		[0.03, 3600],
		[0.02, 4000],
	],
	tailMs: 4400,
};

/** Driver gain applied to a unit turn intent (model.ts TURN_DEG) — used to
 * convert the tuning's aversionTurnDeg into the -1..1 intent space. */
const TURN_REF_DEG = 5;

export class BehaviorController {
	private tuning: BehaviorTuning;
	private rng: () => number;
	private state: BehaviorState = "rest";
	private stateUntil = 0;
	/** Script steps queued (sequence layer); drained one per dwell. */
	private script: ScriptStep[] = [];
	private wanderTarget = { x: 0.5, y: 0.45 };
	private aversionPoint = { x: 0.25, y: 0.75 };
	private scanFrom = { x: 0.15, y: 0.4 };
	private scanTo = { x: 0.85, y: 0.4 };
	private scanStart = 0;
	private scanDuration = 1500;
	private nextSaccadeAt = 0;
	private microOffset = { x: 0, y: 0 };
	private nodActiveUntil = 0;
	private nodStart = 0;
	private tiltTarget = 0;
	private tiltCur = 0;
	private tiltUntil = 0;
	private bodyPhase = 0;
	private nextNodAt = 0;
	private nextScanAt = 0;
	/** How long the current state has already run (for ratio math). */
	private stateDuration = 0;
	private lastNow = 0;

	constructor(tuning: Partial<BehaviorTuning> = {}, rng: () => number = Math.random) {
		this.tuning = { ...DEFAULT_BEHAVIOR_TUNING, ...tuning };
		this.rng = rng;
	}

	setTuning(patch: Partial<BehaviorTuning>): void {
		this.tuning = { ...this.tuning, ...patch };
	}

	get currentState(): BehaviorState {
		return this.state;
	}

	private pick<T>(arr: readonly T[]): T {
		return arr[Math.min(arr.length - 1, Math.floor(this.rng() * arr.length))];
	}

	private range(min: number, max: number): number {
		return min + this.rng() * (max - min);
	}

	/** liveliness 总乘子：>1 节奏更快（驻留/扫视间隔缩短），<1 更缓。 */
	private lively(ms: number): number {
		return Math.max(40, ms / this.tuning.liveliness);
	}

	private saccadeIntervalMs(): number {
		const u = this.rng();
		let acc = 0;
		for (const [prob, ms] of SACCADE_DIST.steps) {
			acc += prob;
			if (u < acc) return this.lively(ms * this.tuning.saccadeScale);
		}
		return this.lively((SACCADE_DIST.tailMs + this.rng() * 1600) * this.tuning.saccadeScale);
	}

	/** A random aversion point, weighted toward "thinking" (up/down) vs social (side). */
	private pickAversionPoint(): { x: number; y: number } {
		const j = () => this.rng() * 0.12 - 0.06;
		const side = this.pick([
			{ x: 0.22 + j(), y: 0.72 + j() }, // 左下
			{ x: 0.78 + j(), y: 0.72 + j() }, // 右下
			{ x: 0.45 + j(), y: 0.2 + j() }, // 上方（思考）
			{ x: 0.12 + j(), y: 0.45 + j() }, // 左
			{ x: 0.88 + j(), y: 0.45 + j() }, // 右
		]);
		return { x: Math.max(0.05, Math.min(0.95, side.x)), y: Math.max(0.05, Math.min(0.95, side.y)) };
	}

	private pickWanderTarget(): { x: number; y: number } {
		return {
			x: 0.15 + this.rng() * 0.7,
			y: 0.15 + this.rng() * 0.7,
		};
	}

	/** Start a named behavior script (the sequence layer) — first step applies immediately. */
	private playScript(now: number, steps: ScriptStep[]): void {
		const first = steps[0];
		this.script = steps.slice(1);
		this.setState(first.state, first.dwellMs, now);
		if (first.state === "wander") this.wanderTarget = this.pickWanderTarget();
		if (first.state === "aversion") this.aversionPoint = this.pickAversionPoint();
		if (first.state === "scan") this.startScan(now);
		if (first.nod !== undefined) this.queueNod(now, first.nod);
	}

	/** Advance to the next script step when the current dwell expires. */
	private advanceScript(now: number): void {
		if (now < this.stateUntil) return;
		const step = this.script.shift();
		if (!step) return;
		this.setState(step.state, step.dwellMs, now);
		if (step.state === "wander") this.wanderTarget = this.pickWanderTarget();
		if (step.state === "aversion") this.aversionPoint = this.pickAversionPoint();
		if (step.state === "scan") this.startScan(now);
		if (step.nod !== undefined) this.queueNod(now, step.nod);
	}

	private setState(state: BehaviorState, dwellMs: number, now: number): void {
		this.state = state;
		this.stateDuration = 0;
		this.stateUntil = now + dwellMs;
	}

	/**
	 * Decide the next state when the current dwell expires (stochastic +
	 * context). Gaze states alternate: eye-contact is never chosen twice in a
	 * row (a chained mutual gaze would exceed the ~3s "staring" ceiling —
	 * research anchor), aversion chains are allowed only while thinking
	 * (repeated looking-away is natural when lost in thought).
	 */
	private pickNextState(now: number, input: BehaviorInput): void {
		const t = this.tuning;
		const prev = this.state;
		const noFace = input.face === null;

		let contact = t.eyeContactMinMs;
		let aversion = t.aversionMaxMs;
		let allowAversionChain = false;
		// ── thinking: heavy cognitive aversion, with brief glances back ──
		if (input.thinking && !noFace) {
			contact = this.range(400, 900);
			aversion = this.range(t.aversionMinMs, t.aversionMaxMs);
			allowAversionChain = true;
		} else if (input.userSpeaking && !noFace) {
			// Attentive listening: contact listenLookRatio of the time; the
			// check-away dwell is derived so the time fraction matches.
			contact = this.range(t.eyeContactMinMs, Math.min(t.eyeContactMaxMs, 2600));
			aversion = Math.max(250, Math.min(t.aversionMaxMs, (contact * (1 - t.listenLookRatio)) / Math.max(0.05, t.listenLookRatio)));
		} else if (input.speaking && !noFace) {
			// Speaker: look at the listener speakLookRatio of the time; the
			// aversion dwell is derived so the time fraction matches.
			contact = this.range(t.eyeContactMinMs, t.eyeContactMaxMs);
			aversion = Math.max(t.aversionMinMs, Math.min(t.aversionMaxMs, (contact * (1 - t.speakLookRatio)) / Math.max(0.05, t.speakLookRatio)));
		} else if (!noFace) {
			// Watched but idle: contact bursts with proportional aversion.
			// Bounded by the tuning ceiling so "盯人" never exceeds it.
			contact = this.range(Math.min(500, t.eyeContactMaxMs), Math.min(2200, t.eyeContactMaxMs));
			aversion = Math.min(t.aversionMaxMs, contact * 0.43);
		} else if (now >= this.nextScanAt) {
			this.startScan(now);
			this.nextScanAt = now + this.range(10000, 20000);
			return;
		} else if (prev === "wander") {
			this.setState("rest", this.range(2000, 6000), now);
			return;
		} else if (prev === "rest" || prev === "scan") {
			this.setState("wander", this.range(800, 2600), now);
			this.wanderTarget = this.pickWanderTarget();
			return;
		} else {
			this.setState("wander", this.range(800, 2600), now);
			this.wanderTarget = this.pickWanderTarget();
			return;
		}

		// User around but not watching: mostly wander, occasional glance.
		const curious = !noFace && !input.userLooking && !input.thinking && !input.userSpeaking && !input.speaking;
		if (curious) {
			if (prev !== "eye-contact" && this.rng() < 0.25) {
				this.setState("eye-contact", this.range(400, 900), now);
				return;
			}
			this.setState(prev === "wander" ? "rest" : "wander", this.range(400, 2400), now);
			if (this.state === "wander") this.wanderTarget = this.pickWanderTarget();
			return;
		}

		// Gaze alternation (eye-contact ↔ aversion); liveliness paces both.
		if (prev === "eye-contact") {
			this.setState("aversion", this.lively(aversion), now);
			this.aversionPoint = this.pickAversionPoint();
			return;
		}
		if (prev === "aversion" && !allowAversionChain) {
			this.setState("eye-contact", this.lively(contact), now);
			return;
		}
		// Fresh pair (coming from wander/rest/scan): pick per context weight.
		if (this.rng() < (input.thinking ? t.thinkAversionRatio : 0.7)) {
			this.setState("aversion", this.lively(aversion), now);
			this.aversionPoint = this.pickAversionPoint();
		} else {
			this.setState("eye-contact", this.lively(contact), now);
		}
	}

	private startScan(now: number): void {
		const vertical = this.rng() < 0.3;
		const y0 = 0.25 + this.rng() * 0.2;
		this.scanFrom = vertical ? { x: 0.5, y: 0.15 } : { x: 0.12, y: y0 };
		this.scanTo = vertical ? { x: 0.5, y: 0.85 } : { x: 0.88, y: y0 };
		this.scanStart = now;
		this.scanDuration = this.range(1200, 2400);
		this.stateDuration = 0;
		this.stateUntil = now + this.scanDuration;
	}

	private queueNod(now: number, envelope = 1): void {
		this.nodStart = now;
		this.nodActiveUntil = now + 380 * envelope;
	}

	private easeInOut(u: number): number {
		return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
	}

	/** Advance one frame. Call from rAF with the current input. */
	update(input: BehaviorInput, now: number): BehaviorOutput {
		const t = this.tuning;
		const dt = this.lastNow > 0 ? Math.max(0, Math.min(250, now - this.lastNow)) : 16;
		this.lastNow = now;
		this.stateDuration += dt;

		// ── context edge handling (the sequence layer) ──
		if (input.userLookRising) {
			// "Noticed you": a short attention script.
			this.playScript(now, [
				{ state: "eye-contact", dwellMs: 1500 },
				{ state: "aversion", dwellMs: 400 },
				{ state: "eye-contact", dwellMs: 2000 },
			]);
		} else if (input.speechStart) {
			// Turn-start aversion ("开口移开"), then look back.
			this.playScript(now, [
				{ state: "aversion", dwellMs: 650 },
				{ state: "eye-contact", dwellMs: 900 },
			]);
		} else if (input.sentenceBoundary && input.speaking) {
			// Turn-yield: look back at the user + small nod.
			this.playScript(now, [{ state: "eye-contact", dwellMs: 800, nod: 1 }]);
		} else if (this.script.length > 0) {
			this.advanceScript(now);
		} else if (now >= this.stateUntil) {
			this.pickNextState(now, input);
		}

		// ── state → look target ──
		let x: number, y: number;
		switch (this.state) {
			case "eye-contact":
				x = input.face?.x ?? 0.5;
				y = input.face?.y ?? 0.5;
				break;
			case "aversion":
				x = this.aversionPoint.x;
				y = this.aversionPoint.y;
				break;
			case "wander":
				x = this.wanderTarget.x;
				y = this.wanderTarget.y;
				break;
			case "scan": {
				const u = this.easeInOut(Math.max(0, Math.min(1, (now - this.scanStart) / this.scanDuration)));
				x = this.scanFrom.x + (this.scanTo.x - this.scanFrom.x) * u;
				y = this.scanFrom.y + (this.scanTo.y - this.scanFrom.y) * u;
				break;
			}
			case "thinking":
				// Rarely reached (thinking usually routes via aversion); safe fallback.
				x = this.aversionPoint.x;
				y = this.aversionPoint.y;
				break;
			default:
				x = 0.5;
				y = 0.52;
		}

		// ── saccades & micro-saccades while fixating ──
		if (now >= this.nextSaccadeAt) {
			this.nextSaccadeAt = now + this.saccadeIntervalMs();
			const amp = t.microSaccadeAmp * (0.5 + this.rng() * 1.5);
			this.microOffset = {
				x: (this.rng() * 2 - 1) * amp,
				y: (this.rng() * 2 - 1) * amp,
			};
		}
		if (this.state === "eye-contact" || this.state === "rest") {
			x += this.microOffset.x;
			y += this.microOffset.y;
		}

		// ── nod ──
		let nod = 0;
		if (now < this.nodActiveUntil) {
			const u = (now - this.nodStart) / Math.max(1, this.nodActiveUntil - this.nodStart);
			nod = Math.sin(Math.PI * Math.min(1, u)); // 0→1→0 envelope
		} else if (input.userSpeaking && now >= this.nextNodAt && t.nodEverySec > 0) {
			this.queueNod(now, 1);
			this.nextNodAt = now + t.nodEverySec * 1000 * (0.7 + this.rng() * 0.8);
		}

		// ── head tilt (thinking / curious) ──
		if (now >= this.tiltUntil) {
			if (this.state === "thinking" && this.rng() < t.headTiltProb) {
				this.tiltTarget = this.rng() < 0.5 ? 1 : -1;
				this.tiltUntil = now + this.range(800, 2400);
			} else if (input.userSpeaking && this.rng() < 0.15) {
				this.tiltTarget = this.rng() < 0.5 ? 0.6 : -0.6;
				this.tiltUntil = now + this.range(900, 2000);
			} else {
				this.tiltTarget = 0;
				this.tiltUntil = now + 400;
			}
		}
		this.tiltCur += (this.tiltTarget - this.tiltCur) * 0.12;

		// ── body sway (slow sinusoid, phase stepped by real frame dt) ──
		this.bodyPhase = (this.bodyPhase + (2 * Math.PI * dt) / t.bodySwayPeriodMs) % (2 * Math.PI);
		const bodySway = Math.sin(this.bodyPhase);

		// ── aversion / gaze-offset head turn (scaled by aversionTurnDeg: the
		// driver applies TURN_REF_DEG per unit, so intent × (deg/REF) = deg) ──
		const faceX = input.face?.x ?? 0.5;
		const gazeOffset = Math.max(-1, Math.min(1, (x - faceX) * 2));
		const turnGain = t.aversionTurnDeg / TURN_REF_DEG;
		let turn = 0;
		if (this.state === "aversion") {
			turn = Math.max(-1, Math.min(1, (x - 0.5) * 2)) * 0.8 * turnGain;
		} else if (this.state === "wander" || this.state === "scan") {
			turn = gazeOffset * 0.4 * turnGain;
		}

		return {
			x: Math.max(0.02, Math.min(0.98, x)),
			y: Math.max(0.02, Math.min(0.98, y)),
			nod,
			tilt: this.tiltCur,
			turn,
			bodySway,
			state: this.state,
		};
	}
}
