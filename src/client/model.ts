/**
 * Live2D model mounting — dual format:
 *   moc3 (Cubism 3/4/5) via pixi-live2d-display-lipsyncpatch/cubism4
 *   moc2 (Cubism 2.1 legacy .moc) via the same fork's /cubism2 entry
 * Renderer choice is inferred from the settings URL (*.model3.json = moc3).
 *
 * Mouth drive bypasses the library's speak()/lipsync path (it requires a
 * truthy currentAudio): instead we hook the internal `beforeModelUpdate`
 * event, which fires each frame after motions/expressions applied their
 * parameters and right before the core model update — so writing the mouth
 * param there wins. Lip-sync parameter ids come from the model's LipSync
 * group, falling back to whichever of "ParamMouthOpenY" /
 * "PARAM_MOUTH_OPEN_Y" the model actually declares.
 *
 * The old Cubism 2.1 core exposes setParamFloat(name, value) instead of
 * CubismModel.setParameterValueById — both are routed through setParam().
 */

import { Application } from "pixi.js";
import { Live2DModel as Live2DModelCubism4 } from "pixi-live2d-display-lipsyncpatch/cubism4";
import { Live2DModel as Live2DModelCubism2 } from "pixi-live2d-display-lipsyncpatch/cubism2";
import { logger } from "./logger.js";
import { resolveParamIds } from "./param-ids.js";
import { SWIPE_MIN_DISTANCE_PX, isSwipe, resolveGestureGroup, swipeDirection } from "./gesture-math.js";
import { resolveTapMotion } from "./tap-motion.js";
import {
	mixLookChannel,
	type LookVector,
	type LookParams,
	DEFAULT_LOOK_PARAMS,
	LOOK_PRESETS,
} from "./look-math.js";

export type { LookParams };
export { DEFAULT_LOOK_PARAMS, LOOK_PRESETS };

export interface Live2DHandle {
	setExpression(expression: number | string): void;
	/**
	 * Play a motion defined in the model's settings file. Returns true on
	 * success, false if the motion could not be started (missing group,
	 * out-of-range index, etc.). Scripted motions take the FORCE lane.
	 */
	playMotion(motion: { name: string; group: string; index: number }): Promise<boolean>;
	/** Read the motion catalog baked into the loaded model. */
	getMotions(): { name: string; group: string; index: number }[];
	/**
	 * Touch mode: single-finger drag stops panning (two fingers still do) and
	 * feeds the finger position to the look pipeline instead; tap/swipe
	 * gestures keep working either way.
	 */
	setTouchMode(on: boolean): void;
	/**
	 * Drive the look: camera gaze target + gyro parallax.
	 */
	setLook(camera: { dx: number; dy: number } | null, gyro: { dx: number; dy: number } | null): void;
	setLookParams(params: Partial<LookParams>): void;
	/**
	 * Gate the framework's automatic idle motions. While off, no new idle clip
	 * starts and a playing one (IDLE priority) is stopped — the view turns it
	 * off for the duration of a conversation turn.
	 */
	setIdleEnabled(on: boolean): void;
	destroy(): void;
}

export function isCubismCoreLoaded(): boolean {
	const g = globalThis as { Live2DCubismCore?: unknown; Live2D?: unknown };
	return typeof g.Live2DCubismCore === "object" || typeof g.Live2D === "object";
}

/** Create the stage's Pixi application (one canvas, one WebGL context). */
function createStage(container: HTMLElement): Application {
	const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
	const app = new Application({
		backgroundAlpha: 0,
		resizeTo: container,
		antialias: true,
		autoDensity: true,
		resolution: Math.max(1, Math.min(dpr, 3)),
	});
	container.appendChild(app.view as unknown as HTMLCanvasElement);
	return app;
}

/**
 * Touch-mode look feed. The mount samples the finger/hover position and hands
 * the normalized ±1 vector to whoever owns the look pipeline (view.tsx owns it,
 * because the camera and gyro sources are blended there); `null` means the
 * pointer left, which starts the ease-back window.
 */
export interface TouchLookChannel {
	onTouchLook(vector: { dx: number; dy: number } | null): void;
}

/** Arguments for {@link mountModel}. Named fields replace the positional list
 * so a swapped pair of same-typed options cannot compile. */
export interface MountModelOptions {
	/** Element the canvas is attached to (and the model is centred in). */
	container: HTMLElement;
	modelUrl: string;
	/** Mouth openness for lip sync (0..1), sampled every frame. */
	getMouth: () => number;
	/** Fired when the WebGL context is lost or restored; remount from here. */
	onContextLost?: () => void;
	/** Touch-mode gaze feed (finger / hover position). */
	touchLook?: TouchLookChannel;
	/** Called when a swipe was refused because a *scripted* motion is playing
	 * (the one refusal the user cannot attribute); the HUD flashes its
	 * touch-mode button. Gesture-originated motions are preempted instead. */
	onGestureRefused?: () => void;
}

export async function mountModel({
	container,
	modelUrl,
	getMouth,
	onContextLost,
	touchLook,
	onGestureRefused,
}: MountModelOptions): Promise<Live2DHandle> {
	const app = createStage(container);
	const canvas = app.view as unknown as HTMLCanvasElement;

	const onWebglLost = (e: Event) => {
		e.preventDefault();
		logger.warn("WebGL context lost! High load / GPU reset detected. Triggering model reload...", {
			url: modelUrl,
		});
		if (onContextLost) onContextLost();
	};
	canvas.addEventListener("webglcontextlost", onWebglLost, false);

	const onWebglRestored = () => {
		logger.info("WebGL context restored. Triggering model re-mount...");
		if (onContextLost) onContextLost();
	};
	canvas.addEventListener("webglcontextrestored", onWebglRestored, false);

	// A failed load must not leave an orphan canvas + WebGL context behind.
	// (strip the cache-busting query before inferring the format from the
	// settings-file suffix — `?_v=…` would otherwise hide the .model3.json)
	const kind: "moc2" | "moc3" = /\.model3\.json$/i.test(modelUrl.split("?")[0]) ? "moc3" : "moc2";
	const ModelClass = kind === "moc2" ? Live2DModelCubism2 : Live2DModelCubism4;
	interface AnyLive2D {
		scale: { set(x?: number, y?: number): void };
		position: { set(x: number, y: number): void };
		anchor: { set(x: number, y: number): void };
		parent?: { removeChild(child: never): unknown } | null;
		getBounds(skipUpdate?: boolean): { x: number; y: number; width: number; height: number };
		/** Hit-test in stage coordinates; returns the hit area names (empty when none). */
		hitTest?(x: number, y: number): string[];
		internalModel: {
			originalWidth: number;
			originalHeight: number;
			coreModel: unknown;
			/** Declared HitAreas from the settings file (empty for most ripped models). */
			hitAreas?: Record<string, unknown>;
			motionManager: {
				lipSyncIds?: string[];
				/** Parsed motions per group; `Sound` is stripped at bind (see below). */
				definitions?: Record<string, Array<{ Sound?: string }>>;
			};
			on(event: "beforeModelUpdate", listener: () => void): unknown;
		};
		expression(name: number | string): Promise<unknown>;
		destroy(): void;
	}
	let model: AnyLive2D;
	try {
		logger.info(`Loading ${kind} Live2D model from: ${modelUrl}`);
		// Drive model updates from the app's own ticker (v7 Application does
		// not use Ticker.shared by default; one rAF loop for render + update).
		model = (await ModelClass.from(modelUrl, { autoInteract: false, ticker: app.ticker })) as unknown as AnyLive2D;
		logger.info(`Live2D model loaded successfully (${model.internalModel.originalWidth}x${model.internalModel.originalHeight})`);
	} catch (error) {
		logger.error(`Failed to load Live2D model from ${modelUrl}`, error);
		try {
			app.destroy(true, { children: true });
		} catch {}
		if (canvas.parentNode) canvas.remove();
		throw error;
	}
	app.stage.addChild(model as never);

	let camInput: { dx: number; dy: number } | null = null;
	let gyroInput: { dx: number; dy: number } | null = null;
	// Exponential smoothing toward the targets — the old model.focus() path
	// had this built in (FocusController); without it the discrete gaze
	// samples make pan/angle visibly jitter. ~0.18/frame ≈ 200ms to settle.
	let camSm = { dx: 0, dy: 0 };
	let gyroSm = { dx: 0, dy: 0 };
	const LOOK_LERP = 0.18;

	/**
	 * Blend one channel of two source vectors by their gain weights. Gains
	 * are signed (a negative gain mirrors that source) while the weight stays
	 * absolute — see look-math.ts.
	 */
	const mixSigned = (camGain: number, gyroGain: number, cam: LookVector, channel: "dx" | "dy"): number =>
		mixLookChannel(camGain, gyroGain, cam, gyroSm, channel, camInput !== null, gyroInput !== null);

	/** Advance the smoothed vectors one frame toward their targets. */
	const smoothLook = () => {
		const tx = camInput ?? { dx: 0, dy: 0 };
		const ty = gyroInput ?? { dx: 0, dy: 0 };
		camSm.dx += (tx.dx - camSm.dx) * LOOK_LERP;
		camSm.dy += (tx.dy - camSm.dy) * LOOK_LERP;
		gyroSm.dx += (ty.dx - gyroSm.dx) * LOOK_LERP;
		gyroSm.dy += (ty.dy - gyroSm.dy) * LOOK_LERP;
	};

	/** True while a look source is active or the smoothed vectors have not settled back to zero. */
	const lookSettling = () =>
		camInput !== null ||
		gyroInput !== null ||
		Math.abs(camSm.dx) + Math.abs(camSm.dy) + Math.abs(gyroSm.dx) + Math.abs(gyroSm.dy) > 0.004;
	let lookParams: LookParams = { ...DEFAULT_LOOK_PARAMS };
	let baseX = 0;
	let baseY = 0;
	let baseScale = 1;
	let userScale = 1;
	let userPanX = 0;
	let userPanY = 0;
	let lastNormalHeight = 0;
	let touchMode = false;

	const applyTransform = () => {
		model.scale.set(baseScale * userScale);
		const camSens = lookParams.camSensitivity ?? 1.0;
		const gyroSens = lookParams.gyroSensitivity ?? 1.0;
		const lookX = mixSigned(camSens, gyroSens, camSm, "dx");
		const lookY = mixSigned(camSens, gyroSens, camSm, "dy");
		const w = container.clientWidth || 1;
		const h = (container.closest(".lv-root")?.classList.contains("lv-keyboard-open") && lastNormalHeight > 0)
			? lastNormalHeight
			: (container.clientHeight || 1);
		// In touch mode, the user interacts with the avatar directly — camera
		// parallax pan is disabled so tapping or dragging never jerks the scene.
		const effectivePanX = touchMode ? 0 : (lookX * lookParams.panAmp * w);
		const effectivePanY = touchMode ? 0 : (lookY * lookParams.panAmp * h);
		// Follow on X, counter-move on Y: the canvas Y axis points down, so a
		// look that goes up (dy > 0) has to move the avatar to a smaller Y.
		model.position.set(baseX + userPanX + effectivePanX, baseY + userPanY - effectivePanY);
		// Gesture/zoom state as a DOM observable — the e2e suite asserts
		// against it.
		const next = `${Math.round(userPanX)},${Math.round(userPanY)},${userScale.toFixed(3)}`;
		if (container.dataset.lvTransform !== next) container.dataset.lvTransform = next;
	};

	const fit = () => {
		const width = container.clientWidth;
		let height = container.clientHeight;
		if (width === 0 || height === 0) return;
		const isKeyboardOpen = container.closest(".lv-root")?.classList.contains("lv-keyboard-open");
		if (!isKeyboardOpen) {
			lastNormalHeight = height;
		} else if (lastNormalHeight > 0 && height < lastNormalHeight) {
			// On mobile, on-screen keyboard shrinks the container: keep the pre-keyboard height
			// so the avatar scale and center position remain invariant. The keyboard merely covers.
			height = lastNormalHeight;
		}
		const internal = model.internalModel;
		baseScale = Math.min(width / internal.originalWidth, height / internal.originalHeight) * 0.98;
		model.anchor.set(0.5, 0.5);
		baseX = width / 2;
		baseY = height / 2 + height * 0.02;
		applyTransform();
	};
	fit();
	const observer = new ResizeObserver(() => {
		// 容器尺寸变化（半全屏 fixed 切换、视口旋转、宿主布局变化）时，
		// Pixi 的 resizeTo 只在 window resize 时机可靠触发，跟不住元素级
		// 尺寸变化 —— 旧 buffer 会被 CSS 100% 硬拉到新尺寸（非等比拉伸）。
		// 规范做法：按容器实际 clientWidth/clientHeight 显式 resize
		// renderer，buffer 与 CSS 永远同源等比，再重算模型布局。
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w > 0 && h > 0) app.renderer.resize(w, h);
		fit();
	});
	observer.observe(container);

	// The bundled d.ts lost its @pixi/utils import (dts-bundle-generator), so
	// EventEmitter methods and the lipSyncIds field need a local structural
	// view of the internal model.
	const internal = model.internalModel as unknown as {
		coreModel: {
			setParameterValueById?(id: string, value: number): void;
			setParamFloat?(id: string, value: number): void;
			_model?: { parameters?: { ids?: readonly string[] } };
			_parameterIds?: readonly string[];
		};
		motionManager: {
			lipSyncIds?: string[];
			definitions?: Record<string, Array<{ Sound?: string }>>;
		};
		hitAreas?: Record<string, unknown>;
		on(event: "beforeModelUpdate", listener: () => void): unknown;
	};
	/**
	 * True only when the loaded model really declares this parameter id.
	 * Cubism 4 wrapper: the real id table (`_model.parameters.ids`), never
	 * `getParameterIndex()` — unknown ids fall through to its side dictionary
	 * and get a synthetic index (see src/client/AGENTS.md).
	 * Cubism 2.1: no enumerable table at all, and its `getParamIndex()` also
	 * hands out phantom indices for undeclared ids (measured on the bundled
	 * core: the first unknown id comes back as index == real count), so moc2
	 * skips probing and keeps the UPPER_SNAKE format default.
	 */
	const hasParam = (id: string): boolean => {
		if (kind === "moc2") return false;
		const core = internal.coreModel;
		const ids = core._model?.parameters?.ids ?? core._parameterIds;
		return Array.isArray(ids) ? ids.includes(id) : false;
	};
	// The file suffix does not decide the parameter spelling: many moc3 rigs
	// (legacy ports, game assets) keep the Cubism 2.1 UPPER_SNAKE ids, and the
	// cores are case-sensitive, so a hard-coded guess leaves those models
	// silently undriven. Resolve once against the model's own parameter table
	// (see param-ids.ts) — camelCase still wins when both exist, and a model
	// declaring neither keeps the previous no-op behaviour.
	const resolved = resolveParamIds(kind, hasParam);
	const MOUTH_FALLBACK = resolved.mouth;
	const LOOK_IDS = resolved.look;
	// Diagnostic contract: which ids the drive actually targets.
	container.dataset.lvParamIds = JSON.stringify(resolved);
	// The framework plays a motion's own `Sound` on every motion start — with
	// motion sounds present (33 of the 37 references in the local library ship
	// the file) an idle motion makes the avatar randomly speak recorded lines
	// while a TTS turn is running. Audio is owned by the speech pipeline, so
	// strip the references at bind time (no playback, no requests).
	const motionDefinitions = internal.motionManager.definitions;
	if (motionDefinitions) {
		for (const list of Object.values(motionDefinitions)) {
			for (const definition of list) if (definition?.Sound) delete definition.Sound;
		}
	}
	/** pixi-live2d-display MotionPriority (NONE=0, IDLE=1, NORMAL=2, FORCE=3). */
	const IDLE_PRIORITY = 1;
	const NORMAL_PRIORITY = 2;
	const FORCE_PRIORITY = 3;

	// Automatic idle motions are the framework's own behaviour: whenever the
	// motion lane goes free it plays a random clip from `motionManager.groups.idle`
	// (MotionManager.update → shouldRequestIdleMotion). The view gates that on
	// conversation state — point the lookup at a group no model declares to
	// suspend it, and stop a clip that is already playing so the character does
	// not finish a random animation while you are talking to it. Breath and
	// blink are separate features and keep running either way.
	const IDLE_GROUP = "Idle";
	const NO_IDLE_GROUP = "__idle_suspended__";
	const motionGroups = (internal.motionManager as unknown as { groups?: { idle?: string } }).groups;
	const applyIdleGate = (on: boolean) => {
		if (motionGroups) motionGroups.idle = on ? IDLE_GROUP : NO_IDLE_GROUP;
		// Diagnostic contract (e2e): whether idle clips may start right now.
		const flag = on ? "1" : "0";
		if (container.dataset.lvIdleEnabled !== flag) container.dataset.lvIdleEnabled = flag;
		if (on) return;
		const manager = internal.motionManager as unknown as {
			state?: { currentPriority?: number };
			stopAllMotions?: () => void;
		};
		if ((manager.state?.currentPriority ?? 0) === IDLE_PRIORITY) manager.stopAllMotions?.();
	};
	// Publish the contract at mount (the view re-applies its own gate right
	// after the handle resolves).
	applyIdleGate(true);

	const setParam = (id: string, value: number) => {
		const core = internal.coreModel;
		if (typeof core.setParamFloat === "function") core.setParamFloat(id, value);
		else if (typeof core.setParameterValueById === "function") core.setParameterValueById(id, value);
	};
	const lipSyncIds: string[] =
		internal.motionManager.lipSyncIds && internal.motionManager.lipSyncIds.length > 0
			? internal.motionManager.lipSyncIds
			: [MOUTH_FALLBACK];
	internal.on("beforeModelUpdate", () => {
		// Whether a gesture would be refused right now: gestures are NORMAL
		// priority, so only a playing NORMAL/FORCE motion blocks them (IDLE
		// motions are interrupted by design and must not count — a looping idle
		// clip would otherwise keep this at "1" forever). e2e waits for "0" and
		// then swipes **once** instead of retrying blindly; this hook runs every
		// frame (verified in the same run that measures head displacement).
		// Hint for "would a NORMAL gesture be refused right now" (not the
		// authority — that is `motion()`'s Promise<boolean>, surfaced to tests as
		// lvGestureSeq advancing). Read from pixi's MotionState
		// (MotionPriority.NONE=0, IDLE=1, NORMAL=2, FORCE=3); the Cubism queue
		// manager's own getCurrentPriority() is a different object that stays 0
		// (source ruling: docs/issues/261010-motion-priority-signal/).
		// e2e waits for "0" and then swipes ONCE — no retry.
		const motionManager = internal.motionManager as unknown as {
			state?: { currentPriority?: number; reservePriority?: number };
		};
		const priority = Math.max(motionManager.state?.currentPriority ?? 0, motionManager.state?.reservePriority ?? 0);
		const busy = priority >= 2 ? "1" : "0";
		if (container.dataset.lvMotionBusy !== busy) container.dataset.lvMotionBusy = busy;
		const value = getMouth();
		const applied = value > 0.002 ? value : 0;
		for (const id of lipSyncIds) setParam(id, applied);
		// Unified look: camera + gyro both contribute to head/body/eye angles.
		// Runs while any source is live AND while the smoothed vectors ease
		// back to zero after both stop, so tracking loss glides home.
		if (lookSettling()) {
			smoothLook();
			const camSens = lookParams.camSensitivity ?? 1.0;
			const gyroSens = lookParams.gyroSensitivity ?? 1.0;
			// Sensitivity balances the two sources; the normalized result is then
			// scaled by each channel's amplitude (the single per-channel slider).
			const lx = mixSigned(camSens, gyroSens, camSm, "dx");
			const ly = mixSigned(camSens, gyroSens, camSm, "dy");
			const lz = mixSigned(camSens, gyroSens, camSm, "dx");
			const ex = lx;
			const ey = ly;
			const ar = lookParams.angleAmp;
			const er = lookParams.eyeAmp;
			const rr = lookParams.rollAmp;

			const bzGain = lookParams.bodyZGain ?? 0.4;
			const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

			const angles: Array<[string, number]> = [
				[LOOK_IDS.angleX, lx * ar],
				[LOOK_IDS.angleY, ly * ar],
				[LOOK_IDS.angleZ, lz * rr],
				[LOOK_IDS.bodyX, lx * ar * 0.5],
				[LOOK_IDS.bodyY, ly * ar * 0.5],
				[LOOK_IDS.bodyZ, lz * rr * bzGain],
				[LOOK_IDS.eyeX, clamp1(ex * er)],
				[LOOK_IDS.eyeY, clamp1(ey * er)],
			];
			for (const [id, v] of angles) setParam(id, v);
			applyTransform();
		}

	});

	// Touch / mouse interaction:
	// - 1 finger / mouse drag: pan/drag character
	// - 2 fingers pinch: zoom & pan
	// - Wheel: zoom around cursor
	// - Double click/tap: reset zoom & pan
	const stage = container;
	/** Whether a pointer event landed on the avatar (empty space pans the camera). */
	const hitModel = (event: PointerEvent): boolean => {
		const rect = stage.getBoundingClientRect();
		const gx = event.clientX - rect.left;
		const gy = event.clientY - rect.top;
		const b = model.getBounds();
		return gx >= b.x && gx <= b.x + b.width && gy >= b.y && gy <= b.y + b.height;
	};
	const activeTouches = new Map<number, { x: number; y: number }>();
	let lastPinchDist = 0;
	let lastPinchMidX = 0;
	let lastPinchMidY = 0;
	let isMousePanning = false;
	let lastMouseX = 0;
	let lastMouseY = 0;
	let lastSingleTouchX = 0;
	let lastSingleTouchY = 0;

	// Tap interaction: a press that neither travels beyond TAP_SLOP_PX nor
	// stays longer than TAP_MAX_MS counts as a tap — everything else keeps the
	// pan/zoom semantics. Only the avatar the press landed on responds, and
	// only when the point actually hits it (declared HitAreas, or its visible
	// bounds for the many models that ship without HitAreas).
	const TAP_SLOP_PX = 16;
	const TAP_MAX_MS = 600;
	let press: { x: number; y: number; lastX: number; lastY: number; at: number; onModel: boolean; moved: boolean } | null = null;
	/** Which subsystem started a motion: a scripted (LLM or HUD-picked)
	 * motion, or the user's own tap/flick. */
	type MotionSource = "script" | "gesture";
	// Who started the motion that is playing right now. Written by every start
	// path through startMotion(); never cleared on finish (a looping motion
	// never fires onFinish, and the library does not even register that
	// callback on the public path). Nothing is refused while the lane is free,
	// so a stale value cannot keep refusing input.
	let playingSource: MotionSource | null = null;
	const counters = {
		preemptGesture: 0,
		rejectScript: 0,
		rejectCooldown: 0,
		rejectInvalidGesture: 0,
	};
	/** Swipe motions must not be spammed: a short cooldown keeps the queue sane.
	 * It only debounces repeated input and never takes part in preemption. */
	let gestureCooldownUntil = 0;
	// Acceptance counter for the e2e attribution: observations only, the product
	// never reads it (same as lvGesture/lvTouchLook — DOM diagnostics contract).
	let gestureSeq = 0;
	const GESTURE_COOLDOWN_MS = 400;

	/** Publish the refusal/preemption counters (diagnostics contract). */
	const publishCounters = () => {
		container.dataset.lvPreemptGesture = String(counters.preemptGesture);
		container.dataset.lvRejectScript = String(counters.rejectScript);
		container.dataset.lvRejectCooldown = String(counters.rejectCooldown);
		container.dataset.lvRejectInvalidGesture = String(counters.rejectInvalidGesture);
	};
	publishCounters(); // the keys exist from mount, so e2e can read a stable zero state

	/**
	 * Every motion start goes through here, so `playingSource` always names the
	 * motion that is playing now. It is recorded on *success* only: the library
	 * refuses an IDLE (and any equal-or-lower priority) request while a higher
	 * one plays, and letting a refused request overwrite the owner would send
	 * the next gesture down the "nothing to preempt" path — i.e. straight back
	 * into the silent drop this module is fixing.
	 */
	const startMotion = async (group: string, index: number, priority: number, source: MotionSource): Promise<boolean> => {
		const started = await (model as unknown as { motion(group: string, index?: number, priority?: number): Promise<boolean> })
			.motion(group, index, priority);
		if (started) playingSource = source;
		return started;
	};

	/**
	 * Start a gesture-originated motion (tap or flick). When the library refuses
	 * it because a NORMAL/FORCE motion is already playing, the source of that
	 * motion decides what happens:
	 *   - our own gesture → preempt it. The clip keeps the priority lane for its
	 *     whole duration (1.9–4.1s on the shipped rig), so without this every
	 *     gesture is swallowed until it ends;
	 *   - a scripted/LLM motion → leave it playing and make the refusal visible
	 *     in the HUD (the only refusal the user cannot otherwise attribute);
	 *   - anything else (never observed) → give up quietly.
	 * `onResult` reports whether the gesture motion actually started.
	 */
	const startGesture = (group: string, index: number, onResult: (started: boolean) => void) => {
		const attempt = () => startMotion(group, index, NORMAL_PRIORITY, "gesture");
		void attempt()
			.then((started) => {
				if (started) return onResult(true);
				if (playingSource === "gesture") {
					// Stop the motions only (the model keeps its expression, eye
					// blink and physics); the retry starts with the usual fade-in,
					// so the pose blends from the interrupted clip rather than
					// snapping. `stopSpeaking` inside is a no-op here — this plugin
					// drives the mouth through parameters, not the library's
					// speak()/lipsync path.
					(internal.motionManager as unknown as { stopAllMotions?: () => void }).stopAllMotions?.();
					counters.preemptGesture += 1;
					publishCounters();
					return void attempt().then(onResult).catch(() => onResult(false));
				}
				if (playingSource === "script") {
					counters.rejectScript += 1;
					publishCounters();
					onGestureRefused?.();
				}
				onResult(false);
			})
			.catch(() => onResult(false));
	};

	/**
	 * Touch-mode gaze: normalize the pointer into the ±1 look space relative to
	 * the stage (same space the camera source uses) and hand it to the view,
	 * which blends it with camera/gyro. `dataset.lvTouchLook` is the e2e
	 * contract.
	 */
	const publishTouchLook = (clientX: number, clientY: number) => {
		const rect = stage.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const dx = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width) * 2 - 1));
		const dy = Math.max(-1, Math.min(1, 1 - ((clientY - rect.top) / rect.height) * 2));
		container.dataset.lvTouchLook = `${dx.toFixed(3)},${dy.toFixed(3)}`;
		touchLook?.onTouchLook({ dx, dy });
	};

	const releaseTouchLook = () => {
		delete container.dataset.lvTouchLook;
		touchLook?.onTouchLook(null);
	};

	/**
	 * Handle a tap at stage coordinates. Writes `dataset.lvTap` (`area:group`)
	 * only when a motion is actually started, so e2e can tell "responded" from
	 * "no response" (blank space, no matching motion, or a scripted motion holding
	 * the priority lane).
	 */
	const handleTap = (clientX: number, clientY: number): void => {
		const rect = stage.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const names = typeof model.hitTest === "function" ? model.hitTest(x, y) : [];
		// Overlapping hit areas (e.g. Body over Head) are rare but real: prefer the
		// first one that actually has an answering motion, then fall back to the first hit.
		let area: string | null = names.find((name) => resolveTapMotion(internal.motionManager.definitions, name)) ?? names[0] ?? null;
		if (!area) {
			const bounds = model.getBounds();
			const inside = x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
			if (!inside) return;
		}
		const resolved = resolveTapMotion(internal.motionManager.definitions, area) ??
			resolveTapMotion(internal.motionManager.definitions, null);
		if (!resolved) return;
		startGesture(resolved.group, resolved.index, (started) => {
			if (!started) return;
			container.dataset.lvTap = `${area ?? "body"}:${resolved.group}`;
		});
	};

	/**
	 * Swipe → the model's own gesture motion (`Flick<Direction>` → `Flick` →
	 * `Shake`). Only touch/pen swipes that started on the avatar count (a
	 * swipe over empty space is just a gaze gesture), only in touch mode, and
	 * never during the cooldown. No-op when the rig ships no gesture groups;
	 * when a motion holds the priority lane, `startGesture` decides between
	 * preempting our own gesture and leaving a scripted motion alone.
	 */
	const handleSwipe = (dx: number, dy: number, durationMs: number) => {
		if (!touchMode) return;
		const distance = Math.hypot(dx, dy);
		if (Date.now() < gestureCooldownUntil) {
			// Cooldown is its own layer: it only debounces repeated input and
			// never takes part in the preemption decision.
			if (distance >= SWIPE_MIN_DISTANCE_PX) {
				counters.rejectCooldown += 1;
				publishCounters();
			}
			return;
		}
		if (!isSwipe({ dx, dy, durationMs })) {
			// Only count gestures that *tried* to be a flick (long enough, wrong
			// timing); a plain drag is not a rejected gesture.
			if (distance >= SWIPE_MIN_DISTANCE_PX) {
				counters.rejectInvalidGesture += 1;
				publishCounters();
			}
			return;
		}
		const groups = Object.keys(internal.motionManager.definitions ?? {});
		const direction = swipeDirection(dx, dy);
		const group = resolveGestureGroup(groups, direction);
		if (!group) return;
		const list = internal.motionManager.definitions?.[group] ?? [];
		if (list.length === 0) return;
		const index = Math.floor(Math.random() * list.length);
		gestureCooldownUntil = Date.now() + GESTURE_COOLDOWN_MS;

		startGesture(group, index, (started) => {
			if (!started) {
				// Still refused after the tri-state decision (a FORCE motion won):
				// keep the pre-existing behaviour of releasing the cooldown so the
				// user can try again right away.
				gestureCooldownUntil = Date.now();
				return;
			}
			container.dataset.lvGesture = `${direction}:${group}`;
			// Monotonic acceptance counter: a swipe that was refused does not
			// advance it, so a test can attribute a gesture to *its own* input
			// instead of trusting a stale value.
			container.dataset.lvGestureSeq = String(++gestureSeq);
		});
	};

	const onPointerDown = (event: PointerEvent) => {
		// Stop event from propagating to external gesture listeners
		event.stopPropagation();

		if (event.pointerType === "touch") {
			activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
			// Capture pointer so pointermove and pointerup stream to stage even if finger drifts
			try {
				stage.setPointerCapture(event.pointerId);
			} catch {}
			if (activeTouches.size === 1) {
				lastSingleTouchX = event.clientX;
				lastSingleTouchY = event.clientY;
				press = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, at: Date.now(), onModel: hitModel(event), moved: false };
				if (touchMode) publishTouchLook(event.clientX, event.clientY);
			} else if (activeTouches.size === 2) {
				press = null; // a second finger means pinch, never a tap
				if (touchMode) releaseTouchLook(); // pinch wins: stop following
				const points = [...activeTouches.values()];
				lastPinchDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
				lastPinchMidX = (points[0].x + points[1].x) / 2;
				lastPinchMidY = (points[0].y + points[1].y) / 2;
			}
		} else if (event.button === 0 || event.button === 1 || event.button === 2) {
			// In touch mode, left-click is purely for avatar interaction (no camera pan).
			// Middle/right click keeps panning the camera.
			isMousePanning = !touchMode || event.button !== 0;
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
			press = event.button === 0
				? { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, at: Date.now(), onModel: hitModel(event), moved: false }
				: null;
			if (touchMode && event.button === 0) {
				publishTouchLook(event.clientX, event.clientY);
			}
			try {
				stage.setPointerCapture(event.pointerId);
			} catch {}
		}
	};

	const onPointerMove = (event: PointerEvent) => {
		event.stopPropagation();

		if (press) {
			press.lastX = event.clientX;
			press.lastY = event.clientY;
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP_PX) press.moved = true;
		}

		if (event.pointerType === "touch") {
			if (activeTouches.has(event.pointerId)) {
				activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
			}
			if (activeTouches.size === 1) {
				if (touchMode) {
					// Touch mode: the finger is a gaze pointer, not a camera
					// handle — panning is left to two fingers.
					publishTouchLook(event.clientX, event.clientY);
					return;
				}
				// Single finger drag pans the camera.
				const deltaX = event.clientX - lastSingleTouchX;
				const deltaY = event.clientY - lastSingleTouchY;
				userPanX += deltaX;
				userPanY += deltaY;
				lastSingleTouchX = event.clientX;
				lastSingleTouchY = event.clientY;
				applyTransform();
				return;
			} else if (activeTouches.size >= 2) {
				// Two fingers pinch = zoom & pan
				const points = [...activeTouches.values()];
				const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
				const midX = (points[0].x + points[1].x) / 2;
				const midY = (points[0].y + points[1].y) / 2;

				if (lastPinchDist > 0) {
					const zoomFactor = dist / lastPinchDist;
					userScale = Math.max(0.4, Math.min(4.0, userScale * zoomFactor));
				}
				if (lastPinchMidX !== 0 && lastPinchMidY !== 0) {
					userPanX += midX - lastPinchMidX;
					userPanY += midY - lastPinchMidY;
				}
				lastPinchDist = dist;
				lastPinchMidX = midX;
				lastPinchMidY = midY;
				applyTransform();
				return;
			}
		}

		if (isMousePanning) {
			if (touchMode && event.button === 0) return;
			// Middle/right drag and empty-space hits pan the camera.
			userPanX += event.clientX - lastMouseX;
			userPanY += event.clientY - lastMouseY;
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
			applyTransform();
			return;
		}

		// Mouse hover feeds the same gaze channel in touch mode (no button
		// needed); an actual drag keeps its pan semantics.
		if (touchMode && !isMousePanning && event.pointerType !== "touch") {
			publishTouchLook(event.clientX, event.clientY);
		}
	};

	const onPointerUp = (event: PointerEvent) => {
		event.stopPropagation();
		const pending = press;
		press = null;
		try {
			if (stage.hasPointerCapture(event.pointerId)) {
				stage.releasePointerCapture(event.pointerId);
			}
		} catch {}

		if (event.pointerType === "touch") {
			activeTouches.delete(event.pointerId);
			if (activeTouches.size === 1) {
				const remaining = [...activeTouches.values()][0];
				lastSingleTouchX = remaining.x;
				lastSingleTouchY = remaining.y;
				lastPinchDist = 0;
			} else if (activeTouches.size === 0) {
				lastPinchDist = 0;
				lastPinchMidX = 0;
				lastPinchMidY = 0;
			}
		} else {
			isMousePanning = false;
		}
		if (touchMode && (event.pointerType === "touch" || event.pointerType === "pen") && activeTouches.size === 0) {
			releaseTouchLook();
		}
		// pointercancel must not fire anything; a press that travelled beyond the
		// tap slop first gets a chance to be a swipe gesture, otherwise a tap.
		if (event.type === "pointerup" && pending && pending.onModel) {
			const durationMs = Date.now() - pending.at;
			if (pending.moved && (event.pointerType === "touch" || event.pointerType === "pen")) {
				handleSwipe(pending.lastX - pending.x, pending.lastY - pending.y, durationMs);
			} else if (!pending.moved && durationMs <= TAP_MAX_MS) {
				handleTap(event.clientX, event.clientY);
			}
		}
	};

	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
		userScale = Math.max(0.4, Math.min(4.0, userScale * zoomFactor));
		applyTransform();
	};

	const onDblClick = (event: MouseEvent) => {
		event.stopPropagation();
		userScale = 1;
		userPanX = 0;
		userPanY = 0;
		applyTransform();
	};

	// Pointer gestures on the stage: single-finger / left-button drag pans the
	// camera, two-finger pinch & wheel zoom, double-click resets, a press that
	// neither travels nor lingers is a tap on the avatar.
	stage.addEventListener("pointerdown", onPointerDown);
	stage.addEventListener("pointermove", onPointerMove);
	stage.addEventListener("pointerup", onPointerUp);
	stage.addEventListener("pointercancel", onPointerUp);
	const onPointerLeave = () => {
		if (touchMode) releaseTouchLook();
	};
	stage.addEventListener("pointerleave", onPointerLeave);
	stage.addEventListener("wheel", onWheel, { passive: false });
	stage.addEventListener("dblclick", onDblClick);

	// Cache the motion catalog at mount time — internalModel.motionManager.definitions
	// is the source of truth but re-reading it on every call is wasteful.
	const motionCatalog: { name: string; group: string; index: number }[] = (() => {
		const defs = (model.internalModel as unknown as {
			motionManager: { definitions?: Record<string, unknown[]> };
		}).motionManager.definitions ?? {};
		const seen = new Set<string>();
		const out: { name: string; group: string; index: number }[] = [];
		for (const [group, list] of Object.entries(defs)) {
			if (!Array.isArray(list)) continue;
			list.forEach((item, index) => {
				const file = (item as { File?: string; file?: string })?.File || (item as { File?: string; file?: string })?.file || "";
				const fileBase = file ? file.split("/").pop() || "" : "";
				let base = fileBase.replace(/\.(motion3|exp3|mtn)\.json$|\.mtn$/, "");
				if (!base) base = group ? `${group}_${index}` : `motion_${index}`;
				let name = base;
				if (seen.has(name)) name = `${base}_${index}`;
				seen.add(name);
				out.push({ name, group, index });
			});
		}
		return out;
	})();

	return {
		setExpression(expression) {
			void model.expression(expression).catch((error) => {
				logger.warn(`expression ${String(expression)} failed`, error);
			});
		},
		async playMotion(motion) {
			try {
				// Scripted (LLM motion tag) and HUD-picked motions take the FORCE
				// lane; the source is recorded so a later swipe can tell whose
				// motion it is about to interrupt.
				return await startMotion(motion.group, motion.index, FORCE_PRIORITY, "script");
			} catch (error) {
				logger.warn(`motion ${motion.name} failed`, error);
				return false;
			}
		},
		getMotions() {
			return motionCatalog.slice();
		},
		setTouchMode(on) {
			touchMode = on;
			if (!on) releaseTouchLook();
			applyTransform();
		},
		setLook(cam, gyro) {
			camInput = cam;
			gyroInput = gyro;
			// When both stop, lookSettling() keeps easing the smoothed
			// vectors home — no instant snap here.
		},
		setLookParams(params) {
			lookParams = { ...lookParams, ...params };
			applyTransform();
		},
		setIdleEnabled(on) {
			applyIdleGate(on);
		},
		destroy() {
			canvas.removeEventListener("webglcontextlost", onWebglLost);
			canvas.removeEventListener("webglcontextrestored", onWebglRestored);
			stage.removeEventListener("pointerdown", onPointerDown);
			stage.removeEventListener("pointermove", onPointerMove);
			stage.removeEventListener("pointerup", onPointerUp);
			stage.removeEventListener("pointercancel", onPointerUp);
			stage.removeEventListener("pointerleave", onPointerLeave);
			stage.removeEventListener("wheel", onWheel);
			stage.removeEventListener("dblclick", onDblClick);
			observer.disconnect();
			try {
				if (model.parent) {
					model.parent.removeChild(model as never);
				}
			} catch {}
			delete container.dataset.lvGestureSeq;
			delete container.dataset.lvMotionBusy;
			delete container.dataset.lvPreemptGesture;
			delete container.dataset.lvRejectScript;
			delete container.dataset.lvRejectCooldown;
			delete container.dataset.lvRejectInvalidGesture;
			delete container.dataset.lvTap;
			try {
				(model as unknown as { destroy: (options?: unknown) => void }).destroy({
						children: true,
						texture: true,
						baseTexture: true,
					});
				} catch (err) {
				logger.warn("Live2DModel.destroy threw error, safely suppressed", err);
			}
			try {
				const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext })?.gl;
				const ext = gl?.getExtension("WEBGL_lose_context");
				if (ext) ext.loseContext();
			} catch {}
			try {
				app.destroy(true, { children: true, texture: true, baseTexture: true });
			} catch (err) {
				logger.warn("Pixi Application.destroy threw error, safely suppressed", err);
			}
			if (canvas.parentNode) {
				canvas.remove();
			}
		},
	};
}
