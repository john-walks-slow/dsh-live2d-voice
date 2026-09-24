/**
 * Live2D model mounting (Cubism 4 via pixi-live2d-display-lipsyncpatch).
 *
 * Mouth drive bypasses the library's speak()/lipsync path (it requires a
 * truthy currentAudio): instead we hook the internal `beforeModelUpdate`
 * event, which fires each frame after motions/expressions applied their
 * parameters and right before the core model update — so writing
 * ParamMouthOpenY there wins. Lip-sync parameter ids come from the model's
 * LipSync group, falling back to the standard Cubism default id.
 */

import { Application } from "pixi.js";
import { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";
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

export interface Live2DHandle {
	setExpression(expression: number | string): void;
	getEyePosition(): { x: number; y: number };
	setLook(camera: { dx: number; dy: number } | null, gyro: { dx: number; dy: number } | null): void;
	setLookParams(params: Partial<LookParams>): void;
	destroy(): void;
}

export function isCubismCoreLoaded(): boolean {
	return typeof (globalThis as { Live2DCubismCore?: unknown }).Live2DCubismCore === "object";
}

export async function mountModel(
	container: HTMLElement,
	modelUrl: string,
	getMouth: () => number,
	onContextLost?: () => void,
): Promise<Live2DHandle> {
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
	let model: Awaited<ReturnType<typeof Live2DModel.from>>;
	try {
		logger.info(`Loading Live2D model from: ${modelUrl}`);
		// Drive model updates from the app's own ticker (v7 Application does
		// not use Ticker.shared by default; one rAF loop for render + update).
		model = await Live2DModel.from(modelUrl, { autoInteract: false, ticker: app.ticker });
		logger.info(`Live2D model loaded successfully (${model.internalModel.originalWidth}x${model.internalModel.originalHeight})`);
	} catch (error) {
		logger.error(`Failed to load Live2D model from ${modelUrl}`, error);
		app.destroy(true, { children: true });
		throw error;
	}
	app.stage.addChild(model as never);

	let camInput: { dx: number; dy: number } | null = null;
	let gyroInput: { dx: number; dy: number } | null = null;
	let lookParams: LookParams = { ...DEFAULT_LOOK_PARAMS };
	let baseX = 0;
	let baseY = 0;
	let baseScale = 1;
	let userScale = 1;
	let userPanX = 0;
	let userPanY = 0;

	const applyTransform = () => {
		model.scale.set(baseScale * userScale);
		const lookX = (camInput ? camInput.dx * lookParams.camPanGain : 0) + (gyroInput ? gyroInput.dx * lookParams.gyroPanGain : 0);
		const lookY = (camInput ? camInput.dy * lookParams.camPanGain : 0) + (gyroInput ? gyroInput.dy * lookParams.gyroPanGain : 0);
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		model.position.set(baseX + userPanX - lookX * lookParams.panRange * w, baseY + userPanY - lookY * lookParams.panRange * h);
	};

	const fit = () => {
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (width === 0 || height === 0) return;
		const internal = model.internalModel;
		baseScale = Math.min(width / internal.originalWidth, height / internal.originalHeight) * 0.98;
		model.anchor.set(0.5, 0.5);
		baseX = width / 2;
		baseY = height / 2 + height * 0.02;
		applyTransform();
	};
	fit();
	const observer = new ResizeObserver(fit);
	observer.observe(container);

	// The bundled d.ts lost its @pixi/utils import (dts-bundle-generator), so
	// EventEmitter methods and the Cubism4-only lipSyncIds field need a local
	// structural view of the internal model.
	const internal = model.internalModel as unknown as {
		coreModel: { setParameterValueById(id: string, value: number): void };
		motionManager: { lipSyncIds?: string[] };
		on(event: "beforeModelUpdate", listener: () => void): unknown;
	};
	const lipSyncIds: string[] =
		internal.motionManager.lipSyncIds && internal.motionManager.lipSyncIds.length > 0
			? internal.motionManager.lipSyncIds
			: ["ParamMouthOpenY"];
	internal.on("beforeModelUpdate", () => {
		const value = getMouth();
		const applied = value > 0.002 ? value : 0;
		for (const id of lipSyncIds) internal.coreModel.setParameterValueById(id, applied);
		// Unified look: camera + gyro both contribute to head/body/eye angles
		const camOn = camInput !== null;
		const gyroOn = gyroInput !== null;
		if (camOn || gyroOn) {
			const camA = camInput ? lookParams.camAngleGain : 0;
			const gyroA = gyroInput ? lookParams.gyroAngleGain : 0;
			const total = camA + gyroA || 1;
			const lx = ((camInput ? camInput.dx * camA : 0) + (gyroInput ? gyroInput.dx * gyroA : 0)) / total;
			const ly = ((camInput ? camInput.dy * camA : 0) + (gyroInput ? gyroInput.dy * gyroA : 0)) / total;
			const ar = lookParams.angleRange;
			const rr = lookParams.rollRange;
			const angles: Array<[string, number]> = [
				["ParamAngleX", lx * ar],
				["ParamAngleY", ly * ar],
				["ParamAngleZ", lx * rr],
				["ParamBodyAngleX", lx * ar * 0.5],
				["ParamBodyAngleY", ly * ar * 0.5],
				["ParamEyeBallX", lx],
				["ParamEyeBallY", ly],
			];
			for (const [id, v] of angles) internal.coreModel.setParameterValueById(id, v);
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

	stage.addEventListener("pointerdown", onPointerDown);
	stage.addEventListener("pointermove", onPointerMove);
	stage.addEventListener("pointerup", onPointerUp);
	stage.addEventListener("pointercancel", onPointerUp);
	stage.addEventListener("wheel", onWheel, { passive: false });
	stage.addEventListener("dblclick", onDblClick);

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
			if (cam === null && gyro === null) applyTransform();
		},
		setLookParams(params) {
			lookParams = { ...lookParams, ...params };
			applyTransform();
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
				model.destroy();
			} catch (err) {
				logger.warn("Live2DModel.destroy threw error, safely suppressed", err);
			}
			try {
				app.destroy(true, { children: true });
			} catch (err) {
				logger.warn("Pixi Application.destroy threw error, safely suppressed", err);
			}
		},
	};
}
