/**
 * Speech playback engine: a strictly ordered PCM chunk queue.
 *
 * The host synthesizes sentence audio serially, so SSE arrival order equals
 * playback order — chunks are decoded and scheduled onto one AudioContext
 * timeline (startAt = max(lastEnd, now + 0.12)), giving gapless speech across
 * sentences. Mouth drive is an RMS envelope off an AnalyserNode placed after
 * the gain node, so muting also closes the mouth.
 *
 * The AudioContext is created lazily and starts suspended until a user
 * gesture; PCM arriving while suspended parks in a byte queue and is flushed
 * on resume.
 */

const SCHEDULE_AHEAD_SECONDS = 0.12;

export class SpeechEngine {
	private context: AudioContext | null = null;
	private gainNode: GainNode | null = null;
	private analyser: AnalyserNode | null = null;
	private timeData: Uint8Array<ArrayBuffer> | null = null;
	private sampleRate = 44100;
	private muted = false;
	/** Unscheduled raw PCM bytes (may split samples across SSE chunks). */
	private pending: Uint8Array[] = [];
	private carry: number[] = [];
	private nextTime = 0;
	private readonly sources = new Set<AudioBufferSourceNode>();
	private mouth = 0;
	private lastTick = 0;

	setSampleRate(sampleRate: number): void {
		this.sampleRate = sampleRate;
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		if (this.gainNode && this.context) {
			this.gainNode.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.01);
		}
	}

	get isMuted(): boolean {
		return this.muted;
	}

	speaking(): boolean {
		return this.sources.size > 0;
	}

	/** Current mouth-open value (0..1, smoothed envelope). */
	mouthValue(): number {
		return this.mouth;
	}

	/** Enqueue one base64 PCM chunk. */
	enqueueBase64(b64: string): void {
		const binary = atob(b64);
		const bytes = new Uint8Array(this.carry.length + binary.length);
		for (let i = 0; i < this.carry.length; i++) bytes[i] = this.carry[i];
		for (let i = 0; i < binary.length; i++) bytes[this.carry.length + i] = binary.charCodeAt(i);
		this.carry = [];
		const usable = bytes.length - (bytes.length % 2);
		if (usable < bytes.length) this.carry.push(bytes[usable]);
		if (usable > 0) this.pending.push(bytes.subarray(0, usable));
		this.pump();
	}

	/** Create the AudioContext if needed and try to unlock playback. */
	async resume(): Promise<void> {
		if (!this.context) {
			this.context = new AudioContext();
			this.gainNode = this.context.createGain();
			this.analyser = this.context.createAnalyser();
			this.analyser.fftSize = 512;
			this.analyser.smoothingTimeConstant = 0.2;
			this.timeData = new Uint8Array(this.analyser.fftSize);
			this.gainNode.connect(this.analyser);
			this.analyser.connect(this.context.destination);
			this.gainNode.gain.value = this.muted ? 0 : 1;
		}
		if (this.context.state === "suspended") {
			try {
				await this.context.resume();
			} catch {
				/* needs a real gesture; pending bytes wait */
			}
		}
		if (this.context.state === "running") this.pump();
	}

	/** Smooth the mouth envelope; call once per animation frame. */
	tick(): void {
		const now = performance.now();
		const dt = Math.min(0.1, Math.max(0.001, (now - (this.lastTick || now)) / 1000));
		this.lastTick = now;
		const level = this.analyser ? this.rmsLevel() : 0;
		const tau = level > this.mouth ? 0.05 : 0.13;
		this.mouth += (level - this.mouth) * (1 - Math.exp(-dt / tau));
		if (this.mouth < 0.001) this.mouth = 0;
	}

	private rmsLevel(): number {
		if (!this.analyser || !this.timeData) return 0;
		this.analyser.getByteTimeDomainData(this.timeData);
		let sum = 0;
		for (let i = 0; i < this.timeData.length; i++) {
			const v = (this.timeData[i] - 128) / 128;
			sum += v * v;
		}
		const rms = Math.sqrt(sum / this.timeData.length);
		if (rms < 0.01) return 0;
		return Math.min(1, rms * 8) ** 0.7;
	}

	/** Schedule every parked PCM chunk onto the timeline. */
	private pump(): void {
		if (!this.context || this.context.state !== "running" || this.pending.length === 0) return;
		for (const bytes of this.pending) {
			if (bytes.length === 0) continue;
			const ints = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
			const buffer = this.context.createBuffer(1, ints.length, this.sampleRate);
			const channel = buffer.getChannelData(0);
			for (let i = 0; i < ints.length; i++) channel[i] = ints[i] / 32768;
			const source = this.context.createBufferSource();
			source.buffer = buffer;
			source.connect(this.gainNode!);
			const startAt = Math.max(this.nextTime, this.context.currentTime + SCHEDULE_AHEAD_SECONDS);
			source.start(startAt);
			this.nextTime = startAt + buffer.duration;
			source.onended = () => {
				this.sources.delete(source);
			};
			this.sources.add(source);
		}
		this.pending = [];
	}

	/** Stop everything immediately (an aborted or superseded speech turn). */
	stop(): void {
		for (const source of this.sources) {
			try {
				source.stop();
			} catch {
				/* already stopped */
			}
		}
		this.sources.clear();
		this.pending = [];
		this.carry = [];
		this.nextTime = 0;
	}

	/**
	 * Tear the engine down for good (view unmount): stop playback and close
	 * the AudioContext. Browsers cap live AudioContexts per page (≈6), so a
	 * leak here eventually leaves the whole GUI mute.
	 */
	destroy(): void {
		this.stop();
		this.mouth = 0;
		const context = this.context;
		this.context = null;
		this.gainNode = null;
		this.analyser = null;
		this.timeData = null;
		if (context && context.state !== "closed") {
			void context.close().catch(() => {
				/* already closing */
			});
		}
	}
}
