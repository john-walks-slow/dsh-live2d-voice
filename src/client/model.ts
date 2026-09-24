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

export interface LookParams {
	camPanGain: number;
	camAngleGain: number;
	gyroPanGain: number;
	gyroAngleGain: number;
	panRange: number;
	angleRange: number;
	rollRange: number;
}

export const DEFAULT_LOOK_PARAMS: LookParams = {
	camPanGain: 0.20,
	camAngleGain: 1.0,
	gyroPanGain: 0.45,
	gyroAngleGain: 0.55,
	panRange: 0.10,
	angleRange: 22,
	rollRange: 6,
};

/** One-tap look presets for the settings popover. */
export const LOOK_PRESETS: ReadonlyArray<{ id: string; label: string; params: LookParams }> = [
	{
		id: "subtle",
		label: "柔和",
		params: { camPanGain: 0.12, camAngleGain: 0.6, gyroPanGain: 0.25, gyroAngleGain: 0.35, panRange: 0.06, angleRange: 14, rollRange: 4 },
	},
	{ id: "standard", label: "标准", params: { ...DEFAULT_LOOK_PARAMS } },
	{
		id: "vivid",
		label: "灵敏",
		params: { camPanGain: 0.3, camAngleGain: 1.4, gyroPanGain: 0.6, gyroAngleGain: 0.8, panRange: 0.16, angleRange: 30, rollRange: 10 },
	},
];

export interface Live2DHandle {
	setExpression(expression: number | string): void;
	getEyePosition(): { x: number; y: number };
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
	return { app, canvas };
}

export async function mountModel(
	container: HTMLElement,
	modelUrl: string,
	getMouth: () => number,
	onContextLost?: () => void,
	layout?: Partial<StageLayout>,
	shared?: SharedStage,
): Promise<Live2DHandle> {
	// Owner mode creates (and later destroys) its own application; shared
	// mode reuses one — the model is just added to that stage and its
	// destroy never touches the application or canvas.
	const app = shared?.app ?? createLive2DStage(container).app;
	const canvas = app.view as unknown as HTMLCanvasElement;
	const stageLayout: StageLayout = { xFraction: 0.5, scaleGain: 1, ...layout };

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

	const applyTransform = () => {
		model.scale.set(baseScale * userScale);
		const lookX = camSm.dx * lookParams.camPanGain + gyroSm.dx * lookParams.gyroPanGain;
		const lookY = camSm.dy * lookParams.camPanGain + gyroSm.dy * lookParams.gyroPanGain;
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		model.position.set(baseX + userPanX - lookX * lookParams.panRange * w, baseY + userPanY - lookY * lookParams.panRange * h);
	};

	const fit = () => {
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (width === 0 || height === 0) return;
		const internal = model.internalModel;
		baseScale = Math.min(width / internal.originalWidth, height / internal.originalHeight) * 0.98 * stageLayout.scaleGain;
		model.anchor.set(0.5, 0.5);
		baseX = width * stageLayout.xFraction;
		baseY = height / 2 + height * 0.02;
		applyTransform();
	};
	fit();
	const observer = new ResizeObserver(fit);
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
			const camA = camInput !== null ? lookParams.camAngleGain : 0;
			const gyroA = gyroInput !== null ? lookParams.gyroAngleGain : 0;
			const total = camA + gyroA || 1;
			const lx = (camSm.dx * camA + gyroSm.dx * gyroA) / total;
			const ly = (camSm.dy * camA + gyroSm.dy * gyroA) / total;
			const ar = lookParams.angleRange;
			const rr = lookParams.rollRange;
			const angles: Array<[string, number]> = [
				[LOOK_IDS.angleX, lx * ar],
				[LOOK_IDS.angleY, ly * ar],
				[LOOK_IDS.angleZ, lx * rr],
				[LOOK_IDS.bodyX, lx * ar * 0.5],
				[LOOK_IDS.bodyY, ly * ar * 0.5],
				[LOOK_IDS.eyeX, lx],
				[LOOK_IDS.eyeY, ly],
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
			} else if (activeTouches.size === 2) {
				const points = [...activeTouches.values()];
				lastPinchDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
				lastPinchMidX = (points[0].x + points[1].x) / 2;
				lastPinchMidY = (points[0].y + points[1].y) / 2;
			}
		} else if (event.button === 0 || event.button === 1 || event.button === 2) {
			// Left click drag, middle click, or right click initiates pan on desktop
			isMousePanning = true;
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
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
				// Single finger drag = pan
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

	// Shared-mode models are pure visuals (the player avatar): the owner
	// model's listeners already handle all interaction on the stage.
	if (!shared) {
		stage.addEventListener("pointerdown", onPointerDown);
		stage.addEventListener("pointermove", onPointerMove);
		stage.addEventListener("pointerup", onPointerUp);
		stage.addEventListener("pointercancel", onPointerUp);
		stage.addEventListener("wheel", onWheel, { passive: false });
		stage.addEventListener("dblclick", onDblClick);
	}

	return {
		setExpression(expression) {
			void model.expression(expression).catch((error) => {
				logger.warn(`expression ${String(expression)} failed`, error);
			});
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
			if (!shared) {
				stage.removeEventListener("pointerdown", onPointerDown);
				stage.removeEventListener("pointermove", onPointerMove);
				stage.removeEventListener("pointerup", onPointerUp);
				stage.removeEventListener("pointercancel", onPointerUp);
				stage.removeEventListener("wheel", onWheel);
				stage.removeEventListener("dblclick", onDblClick);
			}
			observer.disconnect();
			try {
				model.destroy();
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
				app.destroy(true, { children: true });
			} catch (err) {
				logger.warn("Pixi Application.destroy threw error, safely suppressed", err);
			}
			if (canvas.parentNode) {
				canvas.remove();
			}
		},
	};
}
