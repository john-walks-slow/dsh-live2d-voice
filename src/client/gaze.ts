/**
 * Experimental front-camera gaze tracking: MediaPipe FaceLandmarker drives
 * the model's focus so the character looks at the user's face.
 *
 * The MediaPipe runtime (JS + wasm) and the face_landmarker model are served
 * through the plugin's own /live2d-voice/gaze/* routes (node_modules + a
 * host-side cached download), so the phone browser never needs external
 * network access. Everything loads lazily — nothing is fetched until the
 * user turns the feature on.
 *
 * The tracker also owns the camera stream, so the "take photo" tool reuses
 * it (captureFrame) instead of opening a second camera.
 */

type GazeState = "starting" | "tracking" | "stopped" | { error: string };

export interface GazeEvents {
	/**
	 * Nose-tip position in the camera frame, x mirrored to self-view
	 * semantics (0..1, 0.5 = centered). `null` = face lost for a while —
	 * the character should drift back to center.
	 */
	onGaze: (x: number | null, y: number) => void;
	onState: (state: GazeState) => void;
}

/** Structural view of the dynamically-imported tasks-vision module. */
interface VisionModule {
	FilesetResolver: { forVisionTasks(path: string): Promise<unknown> };
	FaceLandmarker: {
		createFromOptions(
			fileset: unknown,
			options: {
				baseOptions: { modelAssetPath: string; delegate: "GPU" | "CPU" };
				runningMode: "VIDEO";
				numFaces: number;
			},
		): Promise<FaceLandmarkerLike>;
	};
}

interface FaceLandmarkerLike {
	close(): void;
	detectForVideo(
		video: HTMLVideoElement,
		timestamp: number,
	): { faceLandmarks?: Array<Array<{ x: number; y: number }>> } | null;
}

const VISION_URL = "/live2d-voice/gaze/vision.mjs";
const WASM_BASE = "/live2d-voice/gaze/wasm";
const MODEL_URL = "/live2d-voice/gaze/model";
/** Detection cadence — modest on purpose (old phones). */
const DETECT_INTERVAL_MS = 80;
/** Face lost this long → gaze home. */
const FACE_LOST_MS = 2500;

export class GazeTracker {
	private stream: MediaStream | null = null;
	private video: HTMLVideoElement | null = null;
	private landmarker: FaceLandmarkerLike | null = null;
	private raf = 0;
	private lastDetect = 0;
	private lostSince = 0;
	private events: GazeEvents;
	private running = false;

	constructor(events: GazeEvents) {
		this.events = events;
	}

	get active(): boolean {
		return this.running;
	}

	/** The live camera stream (reused by the camera tool; do not stop it). */
	get cameraStream(): MediaStream | null {
		return this.stream;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.events.onState("starting");
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
				audio: false,
			});
			const video = document.createElement("video");
			video.srcObject = this.stream;
			video.muted = true;
			video.playsInline = true;
			await video.play().catch(() => undefined);
			this.video = video;

			// Runtime import — the URL is a variable so the bundler leaves
			// it as a true dynamic import served by the plugin route.
			const vision = (await import(VISION_URL)) as unknown as VisionModule;
			const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
			const create = (delegate: "GPU" | "CPU") =>
				vision.FaceLandmarker.createFromOptions(fileset, {
					baseOptions: { modelAssetPath: MODEL_URL, delegate },
					runningMode: "VIDEO",
					numFaces: 1,
				});
			// Old phones may lack the WebGL flavor MediaPipe wants.
			this.landmarker = await create("GPU").catch(() => create("CPU"));
			if (!this.running) {
				// Disabled while the model was loading — release everything.
				try {
					this.landmarker.close();
				} catch {
					/* already closed */
				}
				this.landmarker = null;
				this.video?.removeAttribute("srcObject");
				this.video = null;
				this.stream?.getTracks().forEach((track) => track.stop());
				this.stream = null;
				return;
			}

			this.lostSince = 0;
			const loop = () => {
				if (!this.running) return;
				this.raf = requestAnimationFrame(loop);
				const video = this.video;
				const landmarker = this.landmarker;
				if (!video || !landmarker || video.readyState < 2) return;
				const now = performance.now();
				if (now - this.lastDetect < DETECT_INTERVAL_MS) return;
				this.lastDetect = now;
				try {
					const result = landmarker.detectForVideo(video, now);
					// Face mesh landmark 1 = nose tip.
					const nose = result?.faceLandmarks?.[0]?.[1];
					if (nose) {
						this.lostSince = 0;
						this.events.onGaze(1 - nose.x, nose.y);
					} else if (this.lostSince === 0) {
						this.lostSince = now;
					} else if (now - this.lostSince > FACE_LOST_MS) {
						this.events.onGaze(null, 0.5);
					}
				} catch {
					/* a bad frame must not kill the loop */
				}
			};
			this.raf = requestAnimationFrame(loop);
			this.events.onState("tracking");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.stop();
			this.events.onState({ error: message });
		}
	}

	stop(): void {
		this.running = false;
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		try {
			this.landmarker?.close();
		} catch {
			/* already closed */
		}
		this.landmarker = null;
		this.video?.removeAttribute("srcObject");
		this.video = null;
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.events.onState("stopped");
	}

	/**
	 * Capture the current camera frame as a JPEG blob (for the take-photo
	 * tool). Returns null when the camera is not running.
	 */
	captureFrame(maxWidth = 640): Promise<{ blob: Blob; width: number; height: number } | null> | null {
		const video = this.video;
		if (!this.running || !video || video.readyState < 2) return null;
		const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
		const width = Math.round((video.videoWidth || maxWidth) * scale);
		const height = Math.round((video.videoHeight || maxWidth * 0.75) * scale);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return null;
		// Self-view mirroring — match what the user sees in a mirror.
		context.translate(width, 0);
		context.scale(-1, 1);
		context.drawImage(video, 0, 0, width, height);
		return new Promise<{ blob: Blob; width: number; height: number } | null>((resolve) => {
			canvas.toBlob((blob) => resolve(blob ? { blob, width, height } : null), "image/jpeg", 0.85);
		});
	}
}

/**
 * Capture one front-camera photo without the gaze machinery: reuse the
 * given tracker's stream when it is active, otherwise open a short-lived
 * camera, wait for the first frame, and close it again. Resolves a data URL
 * (image/jpeg) or null when the camera is unavailable/denied.
 */
export async function capturePhoto(tracker: GazeTracker | null, maxWidth = 640): Promise<{ dataUrl: string; width: number; height: number } | null> {
	// Reuse the running gaze camera when possible.
	if (tracker?.active) {
		const frame = await tracker.captureFrame(maxWidth);
		if (frame) {
			const dataUrl = await blobToDataUrl(frame.blob);
			return { dataUrl, width: frame.width, height: frame.height };
		}
		return null;
	}
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
			audio: false,
		});
	} catch {
		return null; // denied / no camera
	}
	try {
		const video = document.createElement("video");
		video.srcObject = stream;
		video.muted = true;
		video.playsInline = true;
		await video.play().catch(() => undefined);
		// Wait for the first real frame (bounded).
		const deadline = Date.now() + 5000;
		while ((video.readyState < 2 || !video.videoWidth) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if (video.readyState < 2 || !video.videoWidth) return null;
		const scale = Math.min(1, maxWidth / video.videoWidth);
		const width = Math.round(video.videoWidth * scale);
		const height = Math.round(video.videoHeight * scale);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.translate(width, 0);
		context.scale(-1, 1); // self-view mirroring
		context.drawImage(video, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
		if (!blob) return null;
		const dataUrl = await blobToDataUrl(blob);
		return { dataUrl, width, height };
	} finally {
		stream.getTracks().forEach((track) => track.stop());
	}
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("read failed"));
		reader.readAsDataURL(blob);
	});
}
