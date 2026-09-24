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

export interface Live2DHandle {
	/** Apply an expression by name or index; unknown ids are ignored. */
	setExpression(expression: number | string): void;
	/** Make the character look at a stage-local point (pixels). */
	focus(x: number, y: number): void;
	/** When true, camera gaze owns the focus and the mouse is ignored. */
	setGazeMode(enabled: boolean): void;
	destroy(): void;
}

export function isCubismCoreLoaded(): boolean {
	return typeof (globalThis as { Live2DCubismCore?: unknown }).Live2DCubismCore === "object";
}

export async function mountModel(container: HTMLElement, modelUrl: string, getMouth: () => number): Promise<Live2DHandle> {
	const app = new Application({ backgroundAlpha: 0, resizeTo: container, antialias: true });
	container.appendChild(app.view as unknown as HTMLCanvasElement);

	// A failed load must not leave an orphan canvas + WebGL context behind.
	let model: Awaited<ReturnType<typeof Live2DModel.from>>;
	try {
		// Drive model updates from the app's own ticker (v7 Application does
		// not use Ticker.shared by default; one rAF loop for render + update).
		model = await Live2DModel.from(modelUrl, { autoInteract: false, ticker: app.ticker });
	} catch (error) {
		app.destroy(true, { children: true });
		throw error;
	}
	app.stage.addChild(model as never);

	const fit = () => {
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (width === 0 || height === 0) return;
		const internal = model.internalModel;
		const scale = Math.min(width / internal.originalWidth, height / internal.originalHeight) * 0.98;
		model.scale.set(scale);
		model.anchor.set(0.5, 0.5);
		model.position.set(width / 2, height / 2 + height * 0.02);
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
		// Explicitly drive the mouth back to closed when silent — otherwise
		// the last non-zero sample can stick when no motion is updating it.
		const applied = value > 0.002 ? value : 0;
		for (const id of lipSyncIds) internal.coreModel.setParameterValueById(id, applied);
	});

	// Mouse gaze: the character follows the pointer (desktop). Camera gaze
	// (experimental) can override this by calling focus() itself.
	const stage = container;
	let gazeMode = false;
	const onPointerMove = (event: PointerEvent) => {
		if (gazeMode) return; // camera gaze owns the focus
		const rect = stage.getBoundingClientRect();
		model.focus(event.clientX - rect.left, event.clientY - rect.top);
	};
	stage.addEventListener("pointermove", onPointerMove);

	return {
		setExpression(expression) {
			void model.expression(expression).catch((error) => {
				console.warn(`[dsh-live2d-voice] expression ${String(expression)} failed`, error);
			});
		},
		focus(x, y) {
			model.focus(x, y);
		},
		setGazeMode(enabled) {
			gazeMode = enabled;
			if (!enabled) return;
			// Reset to center when the camera takes over.
			const rect = stage.getBoundingClientRect();
			model.focus(rect.width / 2, rect.height * 0.42);
		},
		destroy() {
			stage.removeEventListener("pointermove", onPointerMove);
			observer.disconnect();
			model.destroy();
			app.destroy(true, { children: true });
		},
	};
}
