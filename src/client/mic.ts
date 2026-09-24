/**
 * Microphone capture + client-side voice activity detection.
 *
 * getUserMedia → AudioWorklet running in-page (blob URL, no extra bundle
 * file): the worklet downsamples to 16 kHz s16 PCM (the ASR wire format)
 * and posts both PCM frames and an RMS level to the main thread.
 *
 * VAD is energy-based with hysteresis: SPEECH starts after `attackMs` above
 * the open threshold, ends after `releaseMs` below the close threshold. The
 * close threshold is lower than the open one so trailing quiet syllables do
 * not split one utterance.
 *
 * Two consumers share one capture:
 *   - streaming (default): every in-speech frame is relayed live via
 *     `onPcm`, and the attack window's 250ms pre-roll rides along on
 *     `onSpeechStart` so the first syllable is not clipped; segment
 *     boundaries arrive as `onSpeechEnd` (release / 20s force-cut / blip).
 *   - buffered (legacy nostream ASR): the closed segment is emitted whole
 *     on `onSegment`; segments shorter than 300ms are dropped as blips,
 *     segments longer than 20s are force-closed.
 *
 * The same level feed drives the barge-in policy: when the engine is
 * playing AI speech, a sustained level above `bargeThreshold` means the user
 * is talking over the character.
 */

export type MicState = "idle" | "requesting" | "listening" | "denied" | "error";

/** Why a speech segment ended. "blip" = too short to submit. */
export type SpeechEndKind = "release" | "forced" | "blip";

export interface MicEvents {
	/** Smoothed 0..1 input level, ~30 fps. */
	onLevel?: (level: number) => void;
	/**
	 * Every 16kHz s16 mono worklet frame, live. The streaming ASR path
	 * relays these as they arrive; the buffered path ignores them.
	 */
	onPcm?: (pcm: Int16Array) => void;
	/** One complete utterance: 16 kHz s16 mono PCM (ArrayBuffer). Buffered path only. */
	onSegment?: (pcm: ArrayBuffer) => void;
	/** Voice started (attack threshold crossed); carries the pre-roll frames. */
	onSpeechStart?: (preRoll: Int16Array[]) => void;
	/**
	 * Voice ended: "release" = silence timeout ended the utterance,
	 * "forced" = the 20s monologue cap cut it, "blip" = too short to submit.
	 */
	onSpeechEnd?: (kind: SpeechEndKind) => void;
	/** Hard failure / permission denial. */
	onError?: (message: string) => void;
}

const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.ratio = Math.ceil(sampleRate / 16000);
		this.tail = [];
		this.levelAccum = 0;
		this.levelCount = 0;
		this.frameCount = 0;
	}
	process(inputs) {
		const input = inputs[0];
		if (!input || input.length === 0) return true;
		const left = input[0];
		if (!left) return true;
		// RMS level for this 128-frame block.
		let sum = 0;
		for (let i = 0; i < left.length; i++) sum += left[i] * left[i];
		const rms = Math.sqrt(sum / left.length);
		this.levelAccum += rms;
		this.levelCount++;
		// Downsample by decimation with a boxcar (moving-average) anti-alias.
		const out = [];
		for (let i = 0; i < left.length; i++) {
			this.tail.push(left[i]);
			if (this.tail.length === this.ratio) {
				let acc = 0;
				for (let j = 0; j < this.tail.length; j++) acc += this.tail[j];
				out.push(acc / this.tail.length);
				this.tail.length = 0;
			}
		}
		if (out.length > 0) {
			const pcm = new Int16Array(out.length);
			for (let i = 0; i < out.length; i++) {
				const v = Math.max(-1, Math.min(1, out[i]));
				pcm[i] = v < 0 ? v * 32768 : v * 32767;
			}
			this.port.postMessage({ pcm }, [pcm.buffer]);
		}
		this.frameCount++;
		if (this.levelCount >= 4) {
			this.port.postMessage({ level: this.levelAccum / this.levelCount });
			this.levelAccum = 0;
			this.levelCount = 0;
		}
		return true;
	}
}
registerProcessor("lv-capture", CaptureProcessor);
`;

/** Energy thresholds tuned for typical phone/laptop mics (linear RMS). */
const OPEN_THRESHOLD = 0.015;
const CLOSE_THRESHOLD = 0.008;
const BARGE_THRESHOLD = 0.03;
const ATTACK_MS = 80;
const RELEASE_MS = 550;
/** Pre-roll kept while idle so the VAD attack does not clip the first syllable. */
const PRE_ROLL_SAMPLES = 16000 * 0.25;
/** Blips shorter than this are noise, not speech. */
const MIN_SEGMENT_SAMPLES = 16000 * 0.3;
/** Force-close over-long monologues (also bounds the upload size). */
const MAX_SEGMENT_SAMPLES = 16000 * 20;

export class MicCapture {
	private stream: MediaStream | null = null;
	private context: AudioContext | null = null;
	private node: AudioWorkletNode | null = null;
	private events: MicEvents;
	private speakingSince = 0;
	private lastSpeechAt = 0;
	private inSpeech = false;
	private releaseTimer = 0;
	private running = false;
	/** Rolling idle audio (attack-window pre-roll). */
	private preRoll: Int16Array[] = [];
	private preRollSamples = 0;
	/** The utterance in progress. */
	private segment: Int16Array[] = [];
	private segmentSamples = 0;

	constructor(events: MicEvents) {
		this.events = events;
	}

	get active(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
		// Anything failing past this point must not leak the mic — the tab
		// would keep showing "recording" with no way to release it.
		try {
			this.context = new AudioContext({ sampleRate: 48000 });
			const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
			const url = URL.createObjectURL(blob);
			try {
				await this.context.audioWorklet.addModule(url);
			} finally {
				URL.revokeObjectURL(url);
			}
			// Mobile browsers suspend AudioContexts while the page is hidden —
		// without an auto-resume the VAD would die silently after the user
		// switches away and back (the "phone left on this page" scenario).
		this.context.onstatechange = () => {
			if (this.running && this.context?.state === "suspended") {
				void this.context.resume().catch(() => undefined);
			}
		};
		this.node = new AudioWorkletNode(this.context, "lv-capture");
			this.node.port.onmessage = (message: MessageEvent) => {
				const data = message.data as { pcm?: Int16Array; level?: number };
				if (data.pcm) this.handleFrame(data.pcm);
				if (data.level !== undefined) this.handleLevel(data.level);
			};
			const source = this.context.createMediaStreamSource(this.stream);
			source.connect(this.node);
			// Worklet outputs nothing — do NOT connect to destination (feedback).
			this.running = true;
		} catch (error) {
			this.stop();
			throw error;
		}
	}

	stop(): void {
		this.running = false;
		if (this.releaseTimer) window.clearTimeout(this.releaseTimer);
		// The utterance in progress is still worth recognizing.
		if (this.inSpeech) {
			this.inSpeech = false;
			this.speakingSince = 0;
			const kind = this.segmentSamples < MIN_SEGMENT_SAMPLES ? "blip" : "release";
			this.emitSegment();
			this.events.onSpeechEnd?.(kind);
		}
		this.node?.port.close();
		this.node?.disconnect();
		this.node = null;
		void this.context?.close().catch(() => undefined);
		this.context = null;
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.preRoll = [];
		this.preRollSamples = 0;
	}

	/** True when the level (sustained) is high enough to count as talking over AI audio. */
	static isBargeLevel(level: number): boolean {
		return level > BARGE_THRESHOLD;
	}

	private handleFrame(pcm: Int16Array): void {
		if (!this.running) return;
		if (this.inSpeech) {
			this.segment.push(pcm);
			this.segmentSamples += pcm.length;
			this.events.onPcm?.(pcm);
			if (this.segmentSamples >= MAX_SEGMENT_SAMPLES) {
				// 20s monologue cap — submit what we have and reset.
				this.inSpeech = false;
				this.speakingSince = 0;
				this.emitSegment();
				this.events.onSpeechEnd?.("forced");
			}
			return;
		}
		// Idle: keep a short rolling pre-roll.
		this.preRoll.push(pcm);
		this.preRollSamples += pcm.length;
		while (this.preRollSamples > PRE_ROLL_SAMPLES && this.preRoll.length > 1) {
			this.preRollSamples -= this.preRoll[0].length;
			this.preRoll.shift();
		}
	}

	/** Hand the closed segment to the consumer (drops sub-300ms blips). */
	private emitSegment(): void {
		const chunks = this.segment;
		const samples = this.segmentSamples;
		this.segment = [];
		this.segmentSamples = 0;
		if (samples < MIN_SEGMENT_SAMPLES || this.events.onSegment === undefined) return;
		const merged = new Int16Array(samples);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.length;
		}
		this.events.onSegment(merged.buffer);
	}

	private handleLevel(level: number): void {
		if (!this.running) return;
		this.events.onLevel?.(Math.min(1, level * 6));
		const now = performance.now();
		if (level >= OPEN_THRESHOLD) this.lastSpeechAt = now;
		if (!this.inSpeech) {
			if (level >= OPEN_THRESHOLD) {
				if (this.speakingSince === 0) this.speakingSince = now;
				if (now - this.speakingSince >= ATTACK_MS) {
					this.inSpeech = true;
					// The attack window itself is speech — keep it. The
					// pre-roll frames go to both consumers: the buffered
					// path prepends them to the utterance, the streaming
					// path relays them into the upload as its opening audio.
					const pre = this.preRoll;
					const preSamples = this.preRollSamples;
					this.preRoll = [];
					this.preRollSamples = 0;
					this.segment = pre.slice(0);
					this.segmentSamples = preSamples;
					this.events.onSpeechStart?.(pre);
				}
			} else {
				this.speakingSince = 0;
			}
		} else if (level < CLOSE_THRESHOLD) {
			if (!this.releaseTimer) {
				this.releaseTimer = window.setTimeout(() => {
					this.releaseTimer = 0;
					if (this.inSpeech && performance.now() - this.lastSpeechAt >= RELEASE_MS) {
						this.inSpeech = false;
						this.speakingSince = 0;
						const kind = this.segmentSamples < MIN_SEGMENT_SAMPLES ? "blip" : "release";
						this.emitSegment();
						this.events.onSpeechEnd?.(kind);
					}
				}, RELEASE_MS + 30);
			}
		}
	}
}
