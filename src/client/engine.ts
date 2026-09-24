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
 *
 * Third-person mode: chunks are tagged with their speaker (the AI's avatar
 * or the player's). The engine tracks which speaker's audio is currently on
 * the timeline; each model's mouth callback asks for its own speaker's
 * envelope, so only the talking avatar moves its mouth while both share one
 * playback queue.
 */

import type { Speaker } from "./types.js";

const SCHEDULE_AHEAD_SECONDS = 0.12;

export class SpeechEngine {
	private context: AudioContext | null = null;
	private gainNode: GainNode | null = null;
	private analyser: AnalyserNode | null = null;
	private timeData: Uint8Array<ArrayBuffer> | null = null;
	private sampleRate = 44100;
	private muted = false;
	/**
	 * Barge-in muzzle: stop the current audio AND drop everything the still
	 * running turn keeps sending until the next submit unmuzzles it. Plain
	 * stop() only silences the current sentence — the turn's remaining
	 * sentences would resume right over the user.
	 */
	private muzzled = false;
	private muzzleTimer = 0;
	/** Unscheduled raw PCM bytes (may split samples across SSE chunks). */
	private pending: Uint8Array[] = [];
	/** Host-side seq for each pending chunk (parallel to `pending`). */
	private pendingSeqs: number[] = [];
	/** Speaker for each pending chunk (parallel to `pending`). */
	private pendingSpeakers: Speaker[] = [];
	private carry: number[] = [];
	private nextTime = 0;
	/** Scheduled chunk start times, in playback order (for subtitle sync). */
	private chunkStarts: Array<{ seq: number; startAt: number; speaker: Speaker }> = [];
	/** Scheduled chunk spans per speaker (which avatar talks when). */
	private speakerSpans: Array<{ speaker: Speaker; startAt: number; endAt: number }> = [];
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

	/**
	 * Current mouth-open value (0..1, smoothed envelope). With `speaker`
	 * (third-person mode) it returns 0 unless that speaker's audio is the
	 * one playing right now — each avatar animates its own mouth only while
	 * it talks, even though both share one playback queue.
	 */
	mouthValue(speaker?: Speaker): number {
		if (speaker !== undefined && speaker !== this.currentSpeaker()) return 0;
		return this.mouth;
	}

	/**
	 * Which avatar's audio occupies the timeline now. Chunks are scheduled
	 * back-to-back; during a span it is that span's speaker, and in the tiny
	 * gaps/silence between spans the previous speaker stands (its envelope
	 * is ~0 there anyway).
	 */
	currentSpeaker(): Speaker {
		if (!this.context || this.context.state !== "running" || this.speakerSpans.length === 0) return "assistant";
		const now = this.context.currentTime;
		// Prune spans that ended long ago (safety; stop() clears them all).
		while (this.speakerSpans.length > 1 && this.speakerSpans[0].endAt < now - 30) this.speakerSpans.shift();
		let current = this.speakerSpans[0].speaker;
		for (const span of this.speakerSpans) {
			if (span.startAt <= now) current = span.speaker;
			else break;
		}
		return current;
	}

	/**
	 * Enqueue one base64 PCM chunk. `seq` is the host-side audio sequence
	 * number of this chunk (when provided) — recorded so the subtitle
	 * scheduler can tell which chunk is playing now. `speaker` tags the
	 * chunk's avatar (third-person mode; absent = assistant).
	 */
	enqueueBase64(b64: string, seq?: number, speaker: Speaker = "assistant"): void {
		if (this.muzzled) return;
		const binary = atob(b64);
		const bytes = new Uint8Array(this.carry.length + binary.length);
		for (let i = 0; i < this.carry.length; i++) bytes[i] = this.carry[i];
		for (let i = 0; i < binary.length; i++) bytes[this.carry.length + i] = binary.charCodeAt(i);
		this.carry = [];
		const usable = bytes.length - (bytes.length % 2);
		if (usable < bytes.length) this.carry.push(bytes[usable]);
		if (usable > 0) {
			this.pending.push(bytes.subarray(0, usable));
			if (typeof seq === "number") this.pendingSeqs.push(seq);
			this.pendingSpeakers.push(speaker);
		}
		this.pump();
	}

	/**
	 * Highest audio seq of `speaker` whose chunk has already started
	 * playing, or -1 when nothing has been scheduled/played yet (and -1
	 * while suspended). Seq spaces are per-speaker — host counters are
	 * per-utterance and independent between the two avatars, so the
	 * subtitle scheduler must ask for the line's own speaker:
	 * `line.audioSeq <= currentSeq(line.speaker)`.
	 */
	currentSeq(speaker: Speaker = "assistant"): number {
		if (!this.context || this.context.state !== "running" || this.chunkStarts.length === 0) return -1;
		const now = this.context.currentTime;
		let last = -1;
		for (const entry of this.chunkStarts) {
			if (entry.startAt > now) break;
			if (entry.speaker === speaker) last = entry.seq;
		}
		return last;
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
		for (let i = 0; i < this.pending.length; i++) {
			const bytes = this.pending[i];
			if (bytes.length === 0) continue;
			const speaker = this.pendingSpeakers[i] ?? "assistant";
			const ints = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
			const buffer = this.context.createBuffer(1, ints.length, this.sampleRate);
			const channel = buffer.getChannelData(0);
			for (let j = 0; j < ints.length; j++) channel[j] = ints[j] / 32768;
			const source = this.context.createBufferSource();
			source.buffer = buffer;
			source.connect(this.gainNode!);
			const startAt = Math.max(this.nextTime, this.context.currentTime + SCHEDULE_AHEAD_SECONDS);
			source.start(startAt);
			this.nextTime = startAt + buffer.duration;
			this.speakerSpans.push({ speaker, startAt, endAt: this.nextTime });
			const seq = this.pendingSeqs[i];
			if (typeof seq === "number") this.chunkStarts.push({ seq, startAt, speaker });
			source.onended = () => {
				this.sources.delete(source);
			};
			this.sources.add(source);
		}
		this.pending = [];
		this.pendingSeqs = [];
		this.pendingSpeakers = [];
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
		this.pendingSeqs = [];
		this.pendingSpeakers = [];
		this.carry = [];
		this.nextTime = 0;
		this.chunkStarts = [];
		this.speakerSpans = [];
	}

	/**
	 * Barge-in: stop now and stay silent — audio from the interrupted turn
	 * is dropped until unmuzzle() (the next successful submit or mic stop).
	 * A safety timer re-allows audio after 8s so a barge that never yields
	 * a submitted segment (e.g. a sub-300ms blip the VAD filters out)
	 * cannot mute the character forever.
	 */
	muzzle(): void {
		this.muzzled = true;
		this.stop();
		if (this.muzzleTimer !== 0) window.clearTimeout(this.muzzleTimer);
		this.muzzleTimer = window.setTimeout(() => {
			this.muzzled = false;
			this.muzzleTimer = 0;
		}, 8000);
	}

	unmuzzle(): void {
		this.muzzled = false;
		if (this.muzzleTimer !== 0) {
			window.clearTimeout(this.muzzleTimer);
			this.muzzleTimer = 0;
		}
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
