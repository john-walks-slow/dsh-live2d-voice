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
 * group, falling back to the standard id for the format
 * ("ParamMouthOpenY" moc3 / "PARAM_MOUTH_OPEN_Y" moc2).
 *
 * The old Cubism 2.1 core exposes setParamFloat(name, value) instead of
 * CubismModel.setParameterValueById — both are routed through setParam().
 */

import { Application } from "pixi.js";
import { Live2DModel as Live2DModelCubism4 } from "pixi-live2d-display-lipsyncpatch/cubism4";
import { Live2DModel as Live2DModelCubism2 } from "pixi-live2d-display-lipsyncpatch/cubism2";
import { logger } from "./logger.js";
import { mixLookChannel, type LookVector } from "./look-math.js";

export interface LookParams {
	camPanGain: number;
	camAngleGain: number;
	/** Head roll (ParamAngleZ, the 3D tilt) gain from the camera. Signed: negative mirrors the tilt. */
	camRollGain: number;
	gyroPanGain: number;
	gyroAngleGain: number;
	gyroRollGain: number;
	panRange: number;
	angleRange: number;
	rollRange: number;
}

export const DEFAULT_LOOK_PARAMS: LookParams = {
	camPanGain: 0.20,
	camAngleGain: 1.0,
	camRollGain: 1.0,
	gyroPanGain: 0.45,
	gyroAngleGain: 0.55,
	gyroRollGain: 1.0,
	panRange: 0.10,
	angleRange: 22,
	rollRange: 6,
};

/** One-tap look presets for the settings popover. */
export const LOOK_PRESETS: ReadonlyArray<{ id: string; label: string; params: LookParams }> = [
	{
		id: "subtle",
		label: "柔和",
		params: { camPanGain: 0.12, camAngleGain: 0.6, camRollGain: 0.6, gyroPanGain: 0.25, gyroAngleGain: 0.35, gyroRollGain: 0.6, panRange: 0.06, angleRange: 14, rollRange: 4 },
	},
	{ id: "standard", label: "标准", params: { ...DEFAULT_LOOK_PARAMS } },
	{
		id: "vivid",
		label: "灵敏",
		params: { camPanGain: 0.3, camAngleGain: 1.4, camRollGain: 1.4, gyroPanGain: 0.6, gyroAngleGain: 0.8, gyroRollGain: 1.4, panRange: 0.16, angleRange: 30, rollRange: 10 },
	},
];

export interface Live2DHandle {
	setExpression(expression: number | string): void;
	/**
	 * Play a motion defined in the model's settings file. Returns true on
	 * success, false if the motion could not be started (missing group,
	 * out-of-range index, etc.).
	 */
	playMotion(motion: { name: string; group: string; index: number }): Promise<boolean>;
	/** Play a random motion from the named group (used by the idle scheduler). */
	playRandomMotion(group: string, priority?: "idle" | "normal" | "force"): Promise<boolean>;
	/** Read the motion catalog baked into the loaded model. */
	getMotions(): { name: string; group: string; index: number }[];
	getEyePosition(): { x: number; y: number };
	/**
	 * Drive the look: camera gaze target + gyro parallax.
	 */
	setLook(camera: { dx: number; dy: number } | null, gyro: { dx: number; dy: number } | null): void;
	setLookParams(params: Partial<LookParams>): void;
	/**
	 * Update the stage layout (third-person mode shifts the two avatars
	 * apart) and refit — no model reload.
	 */
	setLayout(layout: Partial<StageLayout>): void;
	destroy(): void;
}

/**
 * Where a model sits on the stage: the horizontal anchor as a fraction of
 * the container width (0.5 = centered) and a scale multiplier. Third-person
 * mode puts the player's avatar left (~0.28) and the AI's right (~0.72),
 * both slightly smaller.
 */
export interface StageLayout {
	xFraction: number;
	scaleGain: number;
	/** Resting horizontal gaze bias (-1..1): 0 = face the viewer, negative = look left. Third-person gives the two avatars opposing biases so they face each other. */
	faceBiasX: number;
}

export function isCubismCoreLoaded(): boolean {
	const g = globalThis as { Live2DCubismCore?: unknown; Live2D?: unknown };
	return typeof g.Live2DCubismCore === "object" || typeof g.Live2D === "object";
}

/**
 * A shared Pixi application (one canvas, one WebGL context) that can host
 * several Live2D models.
 *
 * Why shared: the Cubism SDK keeps a process-global WebGLManager whose `gl`
 * pointer is captured by the most recent context. Two Pixi applications =
 * two WebGL contexts, and the earlier model's per-frame texture binds then
 * fail with "object does not belong to this context" (the first avatar
 * renders blank). One application hosting both avatars keeps Cubism happy.
 */
export interface SharedStage {
	app: Application;
	canvas: HTMLCanvasElement;
	/** Cross-model gesture state: hit-testing and drag ownership. */
	gestures: GestureRegistry;
}

/**
 * Per-stage gesture state shared by every model on the same stage.
 * Each mountModel instance registers into the SAME list, so a pointer-down
 * hit-test can tell which avatar the finger actually landed on; `dragOwner`
 * pins the owning model for the duration of the drag (null = whole-camera
 * pan on empty space / middle / right button). Without the shared list each
 * handler only knows its own bounds and treats "not me" as "empty space",
 * so dragging one avatar dragged BOTH.
 */
export interface GestureRegistry {
	mounts: Array<{ model: GestureTarget }>;
	dragOwner: GestureTarget | null;
}

/** The minimal surface a model must expose for hit-testing. */
export interface GestureTarget {
	getBounds(skipUpdate?: boolean): { x: number; y: number; width: number; height: number };
}

export function createLive2DStage(container: HTMLElement): SharedStage {
	const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
	const app = new Application({
		backgroundAlpha: 0,
		resizeTo: container,
		antialias: true,
		autoDensity: true,
		resolution: Math.max(1, Math.min(dpr, 3)),
	});
	const canvas = app.view as unknown as HTMLCanvasElement;
	container.appendChild(canvas);
	return { app, canvas, gestures: { mounts: [], dragOwner: null } };
}

export async function mountModel(
	container: HTMLElement,
	modelUrl: string,
	getMouth: () => number,
	onContextLost?: () => void,
	layout?: Partial<StageLayout>,
	shared?: SharedStage,
	tag?: string,
): Promise<Live2DHandle> {
	// Owner mode creates (and later destroys) its own application; shared
	// mode reuses one — the model is just added to that stage and its
	// destroy never touches the application or canvas.
	const app = shared?.app ?? createLive2DStage(container).app;
	const canvas = app.view as unknown as HTMLCanvasElement;
	const stageLayout: StageLayout = { xFraction: 0.5, scaleGain: 1, faceBiasX: 0, ...layout };

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
		internalModel: {
			originalWidth: number;
			originalHeight: number;
			coreModel: unknown;
			motionManager: { lipSyncIds?: string[] };
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
		if (!shared) {
			try {
				app.destroy(true, { children: true });
			} catch {}
			if (canvas.parentNode) canvas.remove();
		}
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
		stageLayout.faceBiasX !== 0 ||
		Math.abs(camSm.dx) + Math.abs(camSm.dy) + Math.abs(gyroSm.dx) + Math.abs(gyroSm.dy) > 0.004;
	let lookParams: LookParams = { ...DEFAULT_LOOK_PARAMS };
	let baseX = 0;
	let baseY = 0;
	let baseScale = 1;
	let userScale = 1;
	let userPanX = 0;
	let userPanY = 0;
	let lastNormalWidth = 0;
	let lastNormalHeight = 0;

	const applyTransform = () => {
		model.scale.set(baseScale * userScale);
		const lookX = camSm.dx * lookParams.camPanGain + gyroSm.dx * lookParams.gyroPanGain;
		const lookY = camSm.dy * lookParams.camPanGain + gyroSm.dy * lookParams.gyroPanGain;
		const w = container.clientWidth || 1;
		const h = (container.closest(".lv-root")?.classList.contains("lv-keyboard-open") && lastNormalHeight > 0)
			? lastNormalHeight
			: (container.clientHeight || 1);
		model.position.set(baseX + userPanX - lookX * lookParams.panRange * w, baseY + userPanY - lookY * lookParams.panRange * h);
		// Gesture/zoom state as DOM observables — the e2e suite asserts
		// against them (same convention as dataset.lvPlayer).
		const next = `${Math.round(userPanX)},${Math.round(userPanY)},${userScale.toFixed(3)}`;
		// Per-model key first: on the dual stage two models write the shared
		// lvTransform every frame (last-writer-wins), so per-avatar keys are
		// the stable contract for "which model moved". The shared
		// lvTransform stays for single-model mode / legacy assertions.
		if (tag) {
			const key = `lv${tag}Transform`;
			if (container.dataset[key] !== next) container.dataset[key] = next;
		}
		if (container.dataset.lvTransform !== next) container.dataset.lvTransform = next;
	};

	const fit = () => {
		const width = container.clientWidth;
		let height = container.clientHeight;
		if (width === 0 || height === 0) return;
		const isKeyboardOpen = container.closest(".lv-root")?.classList.contains("lv-keyboard-open");
		if (!isKeyboardOpen) {
			lastNormalWidth = width;
			lastNormalHeight = height;
		} else if (lastNormalHeight > 0 && height < lastNormalHeight) {
			// On mobile, on-screen keyboard shrinks the container: keep the pre-keyboard height
			// so the avatar scale and center position remain invariant. The keyboard merely covers.
			height = lastNormalHeight;
		}
		const internal = model.internalModel;
		baseScale = Math.min(width / internal.originalWidth, height / internal.originalHeight) * 0.98 * stageLayout.scaleGain;
		model.anchor.set(0.5, 0.5);
		baseX = width * stageLayout.xFraction;
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
		coreModel: { setParameterValueById?(id: string, value: number): void; setParamFloat?(id: string, value: number): void };
		motionManager: { lipSyncIds?: string[] };
		on(event: "beforeModelUpdate", listener: () => void): unknown;
	};
	// Cubism 2 uses uppercase PARAM_* ids, Cubism 3+ uses camelCase — the
	// cores are case-sensitive, so keep format-specific fallbacks.
	const MOUTH_FALLBACK = kind === "moc2" ? "PARAM_MOUTH_OPEN_Y" : "ParamMouthOpenY";
	const LOOK_IDS = kind === "moc2"
		? { angleX: "PARAM_ANGLE_X", angleY: "PARAM_ANGLE_Y", angleZ: "PARAM_ANGLE_Z", bodyX: "PARAM_BODY_ANGLE_X", bodyY: "PARAM_BODY_ANGLE_Y", eyeX: "PARAM_EYE_BALL_X", eyeY: "PARAM_EYE_BALL_Y" }
		: { angleX: "ParamAngleX", angleY: "ParamAngleY", angleZ: "ParamAngleZ", bodyX: "ParamBodyAngleX", bodyY: "ParamBodyAngleY", eyeX: "ParamEyeBallX", eyeY: "ParamEyeBallY" };
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
		const value = getMouth();
		const applied = value > 0.002 ? value : 0;
		for (const id of lipSyncIds) setParam(id, applied);
		// Unified look: camera + gyro both contribute to head/body/eye angles.
		// Runs while any source is live AND while the smoothed vectors ease
		// back to zero after both stop, so tracking loss glides home.
		if (lookSettling()) {
			smoothLook();
			const lx = mixSigned(lookParams.camAngleGain, lookParams.gyroAngleGain, camSm, "dx");
			const ly = mixSigned(lookParams.camAngleGain, lookParams.gyroAngleGain, camSm, "dy");
			const lz = mixSigned(lookParams.camRollGain, lookParams.gyroRollGain, camSm, "dx");
			const ar = lookParams.angleRange;
			const rr = lookParams.rollRange;
			const bias = stageLayout.faceBiasX;
			const angles: Array<[string, number]> = [
				[LOOK_IDS.angleX, (bias + lx) * ar],
				[LOOK_IDS.angleY, ly * ar],
				[LOOK_IDS.angleZ, lz * rr],
				[LOOK_IDS.bodyX, (bias + lx) * ar * 0.5],
				[LOOK_IDS.bodyY, ly * ar * 0.5],
				[LOOK_IDS.eyeX, Math.max(-1, Math.min(1, bias + lx))],
				[LOOK_IDS.eyeY, Math.max(-1, Math.min(1, ly))],
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
	// Cross-model gesture registry: every mounted model on the same (shared)
	// stage registers into one list so a pointer-down can decide which avatar
	// the finger landed on. In third-person mode a single-finger drag moves
	// only the avatar the finger actually landed on; tapping empty space pans
	// the whole camera (both avatars). Two-finger pinch, wheel and
	// double-click always act on the whole stage regardless.
	const gestures: GestureRegistry = shared?.gestures ?? { mounts: [], dragOwner: null };
	const registerMount = (m: AnyLive2D) => {
		if (!gestures.mounts.find((e) => e.model === m)) gestures.mounts.push({ model: m });
	};
	const unregisterMount = (m: AnyLive2D) => {
		const i = gestures.mounts.findIndex((e) => e.model === m);
		if (i >= 0) gestures.mounts.splice(i, 1);
	};
	const hitAvatar = (event: PointerEvent): GestureTarget | null => {
		const rect = stage.getBoundingClientRect();
		const gx = event.clientX - rect.left;
		const gy = event.clientY - rect.top;
		for (const { model: m } of gestures.mounts) {
			const b = m.getBounds();
			if (gx >= b.x && gx <= b.x + b.width && gy >= b.y && gy <= b.y + b.height) return m;
		}
		return null;
	};
	registerMount(model);
	const activeTouches = new Map<number, { x: number; y: number }>();
	let lastPinchDist = 0;
	let lastPinchMidX = 0;
	let lastPinchMidY = 0;
	let isMousePanning = false;
	let lastMouseX = 0;
	let lastMouseY = 0;
	let lastSingleTouchX = 0;
	let lastSingleTouchY = 0;

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
				gestures.dragOwner = hitAvatar(event);
			} else if (activeTouches.size === 2) {
				const points = [...activeTouches.values()];
				lastPinchDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
				lastPinchMidX = (points[0].x + points[1].x) / 2;
				lastPinchMidY = (points[0].y + points[1].y) / 2;
			}
		} else if (event.button === 0 || event.button === 1 || event.button === 2) {
			// Left click drags the avatar under the cursor in third-person
			// mode; middle/right click always pans the whole camera.
			isMousePanning = true;
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
			gestures.dragOwner = event.button === 0 ? hitAvatar(event) : null;
			try {
				stage.setPointerCapture(event.pointerId);
			} catch {}
		}
	};

	const onPointerMove = (event: PointerEvent) => {
		event.stopPropagation();

		if (event.pointerType === "touch") {
			if (activeTouches.has(event.pointerId)) {
				activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
			}
			if (activeTouches.size === 1) {
				// Single finger drag: move only the avatar the finger
				// landed on (empty space pans the whole camera).
				const deltaX = event.clientX - lastSingleTouchX;
				const deltaY = event.clientY - lastSingleTouchY;
				if (gestures.dragOwner === null || gestures.dragOwner === model) {
					userPanX += deltaX;
					userPanY += deltaY;
					lastSingleTouchX = event.clientX;
					lastSingleTouchY = event.clientY;
					applyTransform();
				}
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
			// Middle/right drag (owner null) and empty-space hits pan the
			// whole camera; a left-drag owned by a sibling avatar must NOT
			// move this one — that is the per-avatar drag in third-person.
			if (gestures.dragOwner !== null && gestures.dragOwner !== model) return;
			userPanX += event.clientX - lastMouseX;
			userPanY += event.clientY - lastMouseY;
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
			applyTransform();
			return;
		}

		// Mouse hover: no gaze tracking without camera — just idle
	};

	const onPointerUp = (event: PointerEvent) => {
		event.stopPropagation();
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
		gestures.dragOwner = null;
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

	// Every mounted model listens on the stage and keeps its own gesture
	// state. Third-person rule: a single finger drags only the avatar it
	// landed on (hit-test at pointer-down); empty-space drag pans the
	// whole camera. Two-finger pinch, wheel and double-click always act
	// on the entire stage. (Gating listener attach on !shared left NO
	// listeners attached once every mount went through the shared stage.)
	stage.addEventListener("pointerdown", onPointerDown);
	stage.addEventListener("pointermove", onPointerMove);
	stage.addEventListener("pointerup", onPointerUp);
	stage.addEventListener("pointercancel", onPointerUp);
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

	const priorityValue = (priority?: "idle" | "normal" | "force"): number => {
		// pixi-live2d-display MotionPriority enum (NONE=0, IDLE=1, NORMAL=2, FORCE=3)
		switch (priority) {
			case "normal": return 2;
			case "force": return 3;
			case "idle":
			default: return 1;
		}
	};

	return {
		setExpression(expression) {
			void model.expression(expression).catch((error) => {
				logger.warn(`expression ${String(expression)} failed`, error);
			});
		},
		async playMotion(motion) {
			try {
				return await (model as unknown as {
					motion(group: string, index?: number, priority?: number): Promise<boolean>;
				}).motion(motion.group, motion.index, 3);
			} catch (error) {
				logger.warn(`motion ${motion.name} failed`, error);
				return false;
			}
		},
		async playRandomMotion(group, priority) {
			try {
				const fn = (model as unknown as {
					startRandomMotion: (g: string, p?: number) => Promise<boolean>;
				}).startRandomMotion;
				if (typeof fn !== "function") return false;
				return await fn(group, priorityValue(priority));
			} catch (error) {
				logger.warn(`random motion ${group} failed`, error);
				return false;
			}
		},
		getMotions() {
			return motionCatalog.slice();
		},
		getEyePosition() {
			const width = container.clientWidth || 1;
			const height = container.clientHeight || 1;
			const internal = model.internalModel;
			const origH = internal.originalHeight || 1000;
			const currentScale = baseScale * userScale;
			// The eyes in standard models are approximately 22% of logical height above center anchor (0.5)
			const currentCenterX = baseX + userPanX;
			const currentCenterY = baseY + userPanY;
			const eyeY = currentCenterY - 0.22 * origH * currentScale;
			return {
				x: Math.round(currentCenterX),
				y: Math.round(Math.max(20, Math.min(height - 20, eyeY))),
			};
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
		setLayout(next) {
			Object.assign(stageLayout, next);
			fit();
		},
		destroy() {
			canvas.removeEventListener("webglcontextlost", onWebglLost);
			canvas.removeEventListener("webglcontextrestored", onWebglRestored);
			stage.removeEventListener("pointerdown", onPointerDown);
			stage.removeEventListener("pointermove", onPointerMove);
			stage.removeEventListener("pointerup", onPointerUp);
			stage.removeEventListener("pointercancel", onPointerUp);
			stage.removeEventListener("wheel", onWheel);
			stage.removeEventListener("dblclick", onDblClick);
			observer.disconnect();
			try {
				if (model.parent) {
					model.parent.removeChild(model as never);
				}
			} catch {}
			unregisterMount(model);
			if (gestures.dragOwner === model) gestures.dragOwner = null;
			if (tag) delete container.dataset[`lv${tag}Transform`];
			try {
				(model as unknown as { destroy: (options?: unknown) => void }).destroy({
						children: true,
						texture: true,
						baseTexture: true,
					});
				} catch (err) {
				logger.warn("Live2DModel.destroy threw error, safely suppressed", err);
			}
			if (shared) return; // the owner owns the application + canvas
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
