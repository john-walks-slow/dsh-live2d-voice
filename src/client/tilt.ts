/**
 * Experimental gyroscope parallax: phone tilt drives the character's head /
 * body angles and a slight position offset, creating the "the character is a
 * 3D object behind the screen glass" illusion.
 *
 * DeviceOrientation (alpha/beta/gamma) is calibrated on start — the pose the
 * user holds at enable-time becomes neutral, offsets from it are clamped,
 * smoothed (EMA), and handed to the model as normalized -1..1 values:
 *
 *   dx: roll  (gamma)  — head yaw / roll + horizontal position parallax
 *   dy: pitch (beta)   — head pitch + vertical position parallax
 *   px, py: position parallax (already sign-corrected, -1..1)
 *
 * iOS requires DeviceOrientationEvent.requestPermission() from a user
 * gesture (the ⚙ toggle click is one). Signs follow "window" physics: the
 * character moves opposite to the tilt, like an object behind glass.
 */

export interface TiltState {
	/** Normalized head yaw/roll driver (-1..1). */
	dx: number;
	/** Normalized head pitch driver (-1..1). */
	dy: number;
	/** Position parallax, sign-corrected (-1..1). */
	px: number;
	py: number;
}

type TiltEvents = {
	onTilt: (state: TiltState) => void;
	onState: (state: "active" | "stopped" | { error: string }) => void;
};

/** Neutral-pose capture window: average the first readings. */
const CALIBRATION_SAMPLES = 8;
/** EMA smoothing factor — higher = snappier, lower = floatier. */
const SMOOTHING = 0.35;
/** Max neutral-relative degrees counted. */
const MAX_DEGREES = 30;

interface OrientationReading {
	beta: number;
	gamma: number;
}

export class TiltParallax {
	private events: TiltEvents;
	private running = false;
	private neutral: OrientationReading | null = null;
	private calibration: OrientationReading[] = [];
	private smoothed: TiltState = { dx: 0, dy: 0, px: 0, py: 0 };
	private handler: ((event: DeviceOrientationEvent) => void) | null = null;

	constructor(events: TiltEvents) {
		this.events = events;
	}

	get active(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
		if (this.running) return;
		type PermissionCapable = {
			requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
		};
		const ctor = DeviceOrientationEvent as unknown as PermissionCapable;
		if (typeof ctor.requestPermission === "function") {
			try {
				const verdict = await ctor.requestPermission();
				if (verdict !== "granted") {
					this.events.onState({ error: "陀螺仪权限被拒绝" });
					return;
				}
			} catch {
				this.events.onState({ error: "陀螺仪权限请求失败" });
				return;
			}
		}
		this.neutral = null;
		this.calibration = [];
		this.handler = (event: DeviceOrientationEvent) => {
			if (!this.running || event.beta === null || event.gamma === null) return;
			this.handle({ beta: event.beta, gamma: event.gamma });
		};
		window.addEventListener("deviceorientation", this.handler);
		this.running = true;
		this.events.onState("active");
	}

	stop(): void {
		if (this.handler !== null) window.removeEventListener("deviceorientation", this.handler);
		this.handler = null;
		this.running = false;
		this.neutral = null;
		this.events.onState("stopped");
	}

	private handle(reading: OrientationReading): void {
		// Calibrate the neutral pose from the first stable samples.
		if (this.neutral === null) {
			this.calibration.push(reading);
			if (this.calibration.length < CALIBRATION_SAMPLES) return;
			const sum = this.calibration.reduce((acc, r) => ({ beta: acc.beta + r.beta, gamma: acc.gamma + r.gamma }), { beta: 0, gamma: 0 });
			this.neutral = {
				beta: sum.beta / this.calibration.length,
				gamma: sum.gamma / this.calibration.length,
			};
			return;
		}
		const clampNorm = (degrees: number): number => Math.max(-1, Math.min(1, degrees / MAX_DEGREES));
		// Portrait assumption: gamma = roll, beta = pitch.
		const dx = clampNorm(reading.gamma - this.neutral.gamma);
		const dy = clampNorm(reading.beta - this.neutral.beta);
		// Parallax design:
		// Emphasize position PAN (px, py) to make the model float like an object inside a 3D box,
		// and use subtle, gentle rotation (dx, dy) to avoid unnatural robotic head twisting.
		const target: TiltState = {
			dx: dx * 0.45,
			dy: dy * 0.45,
			px: -dx * 1.2,
			py: dy * 1.0,
		};
		const k = SMOOTHING;
		this.smoothed = {
			dx: this.smoothed.dx + (target.dx - this.smoothed.dx) * k,
			dy: this.smoothed.dy + (target.dy - this.smoothed.dy) * k,
			px: this.smoothed.px + (target.px - this.smoothed.px) * k,
			py: this.smoothed.py + (target.py - this.smoothed.py) * k,
		};
		this.events.onTilt(this.smoothed);
	}
}
