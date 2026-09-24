/**
 * Fullscreen immersive gaze calibration overlay.
 *
 * Guides the user through a 5-point calibration (Center -> Up -> Down -> Left -> Right).
 * At each step:
 * 1. The character moves her eyes & head to face the designated target.
 * 2. The user is instructed to look directly into the character's eyes.
 * 3. The camera tracks user's facial landmark in real-time, sampling stable frames.
 * 4. The system calculates accurate screen coordinates taking viewport dimensions
 *    and the character's current position/scale on screen into account.
 * 5. Solves a least-squares affine transformation matrix and persists it.
 */

import { useEffect, useRef, useState } from "react";
import type { Live2DHandle } from "./model.js";
import {
	type AffineGazeMatrix,
	type CalibrationSample,
	solveCalibrationMatrix,
} from "./gaze.js";

export interface CalibrationOverlayProps {
	active: boolean;
	modelHandle: Live2DHandle | null;
	stageElement: HTMLElement | null;
	onRawLandmarkSubscribe: (listener: ((rawX: number, rawY: number) => void) | null) => void;
	onComplete: (matrix: AffineGazeMatrix) => void;
	onCancel: () => void;
}

interface StepConfig {
	id: "center" | "up" | "down" | "left" | "right";
	label: string;
	title: string;
	subtitle: string;
	calcFocusAndTarget: (
		eyeX: number,
		eyeY: number,
		w: number,
		h: number,
	) => { focusX: number; focusY: number; targetX: number; targetY: number };
}

const STEPS: StepConfig[] = [
	{
		id: "center",
		label: "1/5 正中",
		title: "请将面部朝向准星方向",
		subtitle: "保持自然握持，略微转动面部朝向屏幕中央的准星",
		calcFocusAndTarget: (ex, ey, _w, _h) => ({
			focusX: ex,
			focusY: ey - 20,
			targetX: ex,
			targetY: ey,
		}),
	},
	{
		id: "up",
		label: "2/5 上方",
		title: "请将面部朝向上方准星",
		subtitle: "略微抬头或移动面部，朝向上方准星位置",
		calcFocusAndTarget: (ex, ey, _w, h) => {
			const delta = Math.min(h * 0.38, 280);
			return {
				focusX: ex,
				focusY: Math.max(10, ey - h * 0.45),
				targetX: ex,
				targetY: Math.max(30, ey - delta),
			};
		},
	},
	{
		id: "down",
		label: "3/5 下方",
		title: "请将面部朝向下方准星",
		subtitle: "略微低头或移动面部，朝向下方准星位置",
		calcFocusAndTarget: (ex, ey, _w, h) => {
			const delta = Math.min(h * 0.38, 280);
			return {
				focusX: ex,
				focusY: Math.min(h - 10, ey + h * 0.45),
				targetX: ex,
				targetY: Math.min(h - 30, ey + delta),
			};
		},
	},
	{
		id: "left",
		label: "4/5 向左",
		title: "请将面部朝向左侧准星",
		subtitle: "略微转向左侧，面部朝向左侧准星位置",
		calcFocusAndTarget: (ex, ey, w, _h) => {
			const delta = Math.min(w * 0.40, 320);
			return {
				focusX: Math.max(10, ex - w * 0.48),
				focusY: ey,
				targetX: Math.max(30, ex - delta),
				targetY: ey,
			};
		},
	},
	{
		id: "right",
		label: "5/5 向右",
		title: "请将面部朝向右侧准星",
		subtitle: "略微转向右侧，面部朝向右侧准星位置",
		calcFocusAndTarget: (ex, ey, w, _h) => {
			const delta = Math.min(w * 0.40, 320);
			return {
				focusX: Math.min(w - 10, ex + w * 0.48),
				focusY: ey,
				targetX: Math.min(w - 30, ex + delta),
				targetY: ey,
			};
		},
	},
];

const SAMPLES_PER_STEP = 24; // ~2.0 seconds of steady tracking (80ms/detect)
const STEP_READY_DELAY_MS = 1200; // "get ready" pause before collecting samples
const STEP_TRANSITION_MS = 900; // delay between steps after completion

export function CalibrationOverlay({
	active,
	modelHandle,
	stageElement,
	onRawLandmarkSubscribe,
	onComplete,
	onCancel,
}: CalibrationOverlayProps) {
	const [stepIdx, setStepIdx] = useState(0);
	const [progress, setProgress] = useState(0);
	const [isTrackingFace, setIsTrackingFace] = useState(false);
	const [reticlePos, setReticlePos] = useState({ x: 0, y: 0 });
	const [stepSuccessPulse, setStepSuccessPulse] = useState(false);
	const [isReady, setIsReady] = useState(false); // "get ready" countdown

	const samplesRef = useRef<Array<{ rawX: number; rawY: number }>>([]);
	const resultsRef = useRef<CalibrationSample[]>([]);
	const lastLandmarkAt = useRef(0);
	const activeStep = STEPS[stepIdx];

	// Reset ALL state when (re)activating — fixes "recalibrate only 1 step" bug
	useEffect(() => {
		if (active) {
			setStepIdx(0);
			setProgress(0);
			setStepSuccessPulse(false);
			setIsReady(false);
			samplesRef.current = [];
			resultsRef.current = [];
		}
	}, [active]);

	// ESC key cancels calibration
	useEffect(() => {
		if (!active) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [active, onCancel]);

	// Initialize step: move character eyes/head towards target
	useEffect(() => {
		if (!active || !modelHandle || !stageElement || !activeStep) return;

		const width = stageElement.clientWidth || window.innerWidth;
		const height = stageElement.clientHeight || window.innerHeight;
		const eyePos = modelHandle.getEyePosition ? modelHandle.getEyePosition() : { x: width / 2, y: height * 0.42 };

		const geom = activeStep.calcFocusAndTarget(eyePos.x, eyePos.y, width, height);

		// Guide character's head and eyes
		modelHandle.focus(geom.focusX, geom.focusY);
		// Reticle centers on character's eyes or eye-gaze target
		setReticlePos({ x: geom.targetX, y: geom.targetY });

		// Reset step sampling state
		samplesRef.current = [];
		setProgress(0);
		setStepSuccessPulse(false);
		setIsReady(false);

		// "Get ready" pause: give the user time to find the reticle before collecting
		const readyTimer = window.setTimeout(() => setIsReady(true), STEP_READY_DELAY_MS);
		return () => clearTimeout(readyTimer);
	}, [active, stepIdx, modelHandle, stageElement, activeStep]);

	// Face landmark subscription & continuous sampling
	useEffect(() => {
		if (!active) {
			onRawLandmarkSubscribe(null);
			return;
		}

		let checkTimer = 0;
		const onLandmark = (rawX: number, rawY: number) => {
			lastLandmarkAt.current = Date.now();
			setIsTrackingFace(true);

			if (stepSuccessPulse || !isReady) return;

			samplesRef.current.push({ rawX, rawY });
			const count = samplesRef.current.length;
			const p = Math.min(100, Math.round((count / SAMPLES_PER_STEP) * 100));
			setProgress(p);

			if (count >= SAMPLES_PER_STEP) {
				// Step completed! Calculate average raw position
				setStepSuccessPulse(true);

				const width = stageElement?.clientWidth || window.innerWidth;
				const height = stageElement?.clientHeight || window.innerHeight;
				const normTargetX = reticlePos.x / width;
				const normTargetY = reticlePos.y / height;

				// Median / trimmed mean for robustness against micro-blinks
				const sortedX = [...samplesRef.current].map((s) => s.rawX).sort((a, b) => a - b);
				const sortedY = [...samplesRef.current].map((s) => s.rawY).sort((a, b) => a - b);
				const trim = Math.floor(sortedX.length * 0.15);
				const validX = sortedX.slice(trim, sortedX.length - trim || 1);
				const validY = sortedY.slice(trim, sortedY.length - trim || 1);
				const avgX = validX.reduce((acc, v) => acc + v, 0) / validX.length;
				const avgY = validY.reduce((acc, v) => acc + v, 0) / validY.length;

				resultsRef.current.push({
					rawX: avgX,
					rawY: avgY,
					targetX: normTargetX,
					targetY: normTargetY,
				});

				// Feedback expression (joy / blink)
				try {
					modelHandle?.setExpression(1);
				} catch {}

				// Advance to next step or complete
				setTimeout(() => {
					if (stepIdx < STEPS.length - 1) {
						setStepIdx((prev) => prev + 1);
						setIsReady(false);
					} else {
						// All 5 steps done! Solve affine transformation matrix
						const matrix = solveCalibrationMatrix(resultsRef.current);
						if (matrix) {
							onComplete(matrix);
						} else {
							onCancel();
						}
					}
				}, 450);
			}
		};

		onRawLandmarkSubscribe(onLandmark);

		// Face lost detector
		checkTimer = window.setInterval(() => {
			if (Date.now() - lastLandmarkAt.current > 350) {
				setIsTrackingFace(false);
			}
		}, 200);

		return () => {
			onRawLandmarkSubscribe(null);
			clearInterval(checkTimer);
		};
	}, [active, stepIdx, stepSuccessPulse, isReady, reticlePos, stageElement, modelHandle, onRawLandmarkSubscribe, onComplete, onCancel]);

	if (!active) return null;

	const radius = 28;
	const circumference = 2 * Math.PI * radius;
	const strokeDashoffset = circumference - (progress / 100) * circumference;

	return (
		<div className="lv-calib-overlay">
			{/* Top guidance compact capsule */}
			<div className="lv-calib-header">
				<div className="lv-calib-header-left">
					<span className="lv-calib-pill">{activeStep.label}</span>
					<span className="lv-calib-title">{activeStep.title}</span>
				</div>
				<button type="button" className="lv-calib-cancel" onClick={onCancel} title="退出校准">
					✕ 退出
				</button>
			</div>

			{/* Target reticle & eye aura */}
			<div
				className={`lv-calib-reticle ${isTrackingFace ? "lv-face-found" : "lv-face-searching"} ${
					stepSuccessPulse ? "lv-pulse-success" : ""
				}`}
				style={{
					left: `${reticlePos.x}px`,
					top: `${reticlePos.y}px`,
				}}
			>
				<svg className="lv-calib-svg" width="72" height="72" viewBox="0 0 72 72">
					{/* Background ring */}
					<circle
						className="lv-calib-track"
						cx="36"
						cy="36"
						r={radius}
						fill="none"
						strokeWidth="3.5"
					/>
					{/* Active progress ring */}
					<circle
						className="lv-calib-prog"
						cx="36"
						cy="36"
						r={radius}
						fill="none"
						strokeWidth="3.5"
						strokeDasharray={circumference}
						strokeDashoffset={strokeDashoffset}
					/>
				</svg>

				{/* Crosshair center dot */}
				<div className="lv-calib-center-dot" />

				{/* Status badge below reticle */}
				<div className="lv-calib-badge">
					{!isReady
						? "准备中…"
						: !isTrackingFace
						? "请将面部对准前置摄像头…"
						: stepSuccessPulse
						? "✓ 完成"
						: `${progress}%`}
				</div>
			</div>

			{/* Bottom subtle guidance */}
			<div className="lv-calib-footer">
				<span className="lv-calib-hint">
					💡 保持自然姿态与舒适距离，系统将智能结合屏幕尺寸与角色视角进行空间三维标定
				</span>
			</div>
		</div>
	);
}
