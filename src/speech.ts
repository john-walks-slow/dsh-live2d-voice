/**
 * The llm/stream tap: sentence the assistant stream, drive expressions and
 * subtitles, and synthesize speech sentence-by-sentence while the model is
 * still writing. When the stream ends, the whole utterance is translated
 * into the configured subtitle language through a single one-shot llm call
 * (one TTFT instead of one per sentence) that reuses the session's own
 * provider/model (never tapped back: it carries no sessionId and no
 * purpose); the result is split back onto the per-line subtitles.
 *
 * Only sessions with a live SSE listener (an open Live2D view) are tapped;
 * every other stream passes through untouched — except recently-exited
 * sessions, whose completion clears the exit reminder (see system-prompt.ts).
 *
 * The TTS queue is decoupled from the generator: once the model stream ends
 * the generator returns immediately (the agent turn settles without waiting
 * for audio synthesis) and a background drain emits audio-end/speech-end when
 * the queue settles. A new stream for the same session aborts the previous
 * utterance's pending TTS so audio never overlaps.
 */

import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { SentenceBuffer, extractEmotionTags, extractMotionTags } from "./sentence.js";
import { PCM_SAMPLE_RATE, synthesize } from "./tts.js";
import { languageLabel, type PluginConfig } from "./config.js";
import type { SseHub } from "./events.js";
import type { SpeechModes } from "./system-prompt.js";

interface SpeechDeps {
	hub: SseHub;
	modes: SpeechModes;
	getConfig: () => PluginConfig;
	resolveKeys: (config: PluginConfig) => string[];
	/** Per-session effective config (global ⊕ workspace override). */
	resolveSession: (sessionId: string) => PluginConfig;
}

interface ActiveSpeech {
	utteranceId: string;
	abort: AbortController;
}

/** The provider/model a session last conversed with (translation reuses it). */
interface SessionModel {
	provider: string;
	model: string;
}

/**
 * Serial translation queue with a small backlog cap: subtitles are timely —
 * when more than two sentences are still waiting, the oldest queued
 * translation is dropped (its line is stale by the time it would render).
 */
class TranslationQueue {
	private tasks: Array<() => Promise<void>> = [];
	private running = false;

	push(task: () => Promise<void>): void {
		this.tasks.push(task);
		if (this.tasks.length > 2) this.tasks.shift();
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (this.tasks.length > 0) {
				const task = this.tasks.shift();
				if (!task) continue;
				try {
					await task();
				} catch {
					/* one bad task must never stall the queue (or the host) */
				}
			}
		} finally {
			this.running = false;
		}
	}
}

/**
 * Install the tap. Returns `supersede(sessionId)`: abort the session's
 * in-flight assistant TTS — the third-person player pipeline calls it when
 * the user's new line interrupts the AI mid-speech.
 */
export function applySpeechTap(ctx: Context, deps: SpeechDeps): (sessionId: string) => void {
	const active = new Map<string, ActiveSpeech>();
	const translations = new Map<string, TranslationQueue>();

	/**
	 * One-shot translation of a whole utterance: one llm call, one TTFT
	 * (instead of one call per sentence stacking latency). Returns the
	 * translated text; the caller splits it back onto the per-line
	 * subtitles. Best-effort: "" means "no translation".
	 */
	const translateOnce = async (
		sessionId: string,
		model: SessionModel,
		text: string,
		targetLanguage: string,
		signal: AbortSignal,
	): Promise<string> => {
		if (signal.aborted || !deps.hub.has(sessionId)) return "";
		let translated = "";
		try {
			const stream = ctx.llm.stream({
				provider: model.provider,
				model: model.model,
				messages: [createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })],
				system: `You translate speech subtitles. Translate the user's text into ${languageLabel(targetLanguage)}. Reply with ONLY the translation — no notes, no quotes, no original text. If the text is already in the target language, reply with it unchanged. Keep it natural and concise.`,
				signal,
			});
			for await (const chunk of stream) {
				if (signal.aborted) return "";
				if (chunk.type === "text-delta" && chunk.text) translated += chunk.text;
			}
		} catch {
			return ""; // translation is best-effort; the original line stands
		}
		const trimmed = translated.trim();
		return trimmed !== text ? trimmed : "";
	};

	ctx.on("llm/stream", (options, next) => {
		const sessionId = options.sessionId === undefined ? "" : String(options.sessionId);
		// Auxiliary calls (titles, compaction) pass through untouched.
		if (!sessionId || options.purpose !== undefined) return next();
		if (!deps.hub.has(sessionId)) {
			// Unwatched, but a recently-exited session's turn end clears the
			// exit reminder in the system prompt — observe completion only
			// for those sessions, leave everything else fully untouched.
			if (!deps.modes.isExited(sessionId)) return next();
			const stream = next();
			return (async function* () {
				try {
					for await (const chunk of stream) yield chunk;
				} finally {
					deps.modes.clearExited(sessionId);
				}
			})();
		}
		// The conversation's own model — translation calls reuse it.
		return speak(deps, active, translations, translateOnce, sessionId, { provider: options.provider, model: options.model }, next());
	});

	// REC-05: the last SSE listener for a session left — stop synthesizing
	// audio nobody will hear (saves Fish Audio quota) and drop its queue.
	deps.hub.onLastClose((sessionId) => {
		active.get(sessionId)?.abort.abort();
		translations.delete(sessionId);
	});

	// Third-person: a new player line interrupts the AI's pending synthesis.
	return (sessionId: string) => {
		active.get(sessionId)?.abort.abort();
	};
}

type TranslateOnceFn = (
	sessionId: string,
	model: SessionModel,
	text: string,
	targetLanguage: string,
	signal: AbortSignal,
) => Promise<string>;

/**
 * Wrap one model stream. Emits speech-start/audio-start up front, feeds each
 * complete sentence into the serial TTS queue, and returns as soon as the
 * model stream ends — audio-end/speech-end are emitted by the background
 * queue drain. A superseding stream (or stream error / last listener leaving)
 * aborts pending TTS and emits speech-end(reason:"aborted").
 */
async function* speak(
	deps: SpeechDeps,
	active: Map<string, ActiveSpeech>,
	translations: Map<string, TranslationQueue>,
	translate: TranslateOnceFn,
	sessionId: string,
	model: SessionModel,
	chunks: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
	const config = deps.resolveSession(sessionId);
	const apiKeys = deps.resolveKeys(deps.getConfig());
	// A new utterance supersedes the previous one for this session.
	active.get(sessionId)?.abort.abort();
	const controller = new AbortController();
	const utteranceId = randomUUID().slice(0, 8);
	active.set(sessionId, { utteranceId, abort: controller });

	const buffer = new SentenceBuffer();
	// Whole-utterance source lines, fed to one-shot translation once the
	// stream ends (translation starts in parallel with the TTS drain).
	const lines: Array<{ lineId: string; text: string }> = [];
	let seq = 0;
	let lineSeq = 0;
	// Serial pipeline: each unit waits for the previous TTS call.
	let queue: Promise<void> = Promise.resolve();
	// sentenceSubtitles: per-sentence TTS + subtitle (default, subtitles stay
	// voice-synced). Off → sentences batch into paragraph chunks: one TTS
	// call + one subtitle line per chunk (smoother speech, chunk-level
	// subtitles). Emotion tags still fire per sentence in both modes.
	const sentenceMode = config.sentenceSubtitles !== false;
	const BLOCK_SENTENCES = 3;
	const BLOCK_CHARS = 140;
	const vocabulary = new Set(Object.keys(config.emotionMap));
	let blockLines: string[] = [];
	const enqueueUnit = (lineId: string, text: string): void => {
		queue = queue.then(() =>
			speakSentence(deps, sessionId, utteranceId, lineId, text, config, apiKeys, controller.signal, () => seq++, lines)
		);
	};
	const flushBlock = (): void => {
		if (blockLines.length === 0) return;
		enqueueUnit(`${utteranceId}-${++lineSeq}`, blockLines.join(""));
		blockLines = [];
	};
	const handleSentence = (raw: string): void => {
		if (sentenceMode) {
			const { clean, motions } = extractMotionTags(raw);
			for (const motion of motions) {
				deps.hub.emit(sessionId, "motion", { utteranceId, motion, speaker: "assistant" });
			}
			const cleaned = extractMotionTags(raw).clean;
			enqueueUnit(`${utteranceId}-${++lineSeq}`, cleaned);
			return;
		}
		const { clean: cleanEmotion, emotions } = extractEmotionTags(raw, vocabulary);
		const { clean: cleanMotion, motions } = extractMotionTags(cleanEmotion);
		const emotion = emotions.at(-1);
		if (emotion !== undefined) {
			deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression: config.emotionMap[emotion] });
		}
		for (const motion of motions) {
			deps.hub.emit(sessionId, "motion", { utteranceId, motion, speaker: "assistant" });
		}
		const text = cleanMotion.trim();
		if (!text) return;
		blockLines.push(text);
		const chars = blockLines.reduce((n, line) => n + line.length, 0);
		if (blockLines.length >= BLOCK_SENTENCES || chars >= BLOCK_CHARS) flushBlock();
	};

	let settled = false;
	const settle = (reason: "finish" | "aborted"): void => {
		if (settled) return;
		settled = true;
		if (reason === "finish") deps.hub.emit(sessionId, "audio-end", { utteranceId });
		deps.hub.emit(sessionId, "speech-end", { utteranceId, reason });
		if (active.get(sessionId)?.utteranceId === utteranceId) active.delete(sessionId);
	};

	deps.hub.emit(sessionId, "speech-start", { utteranceId });
	deps.hub.emit(sessionId, "audio-start", { utteranceId, sampleRate: PCM_SAMPLE_RATE });
	if (apiKeys.length === 0) {
		deps.hub.emit(sessionId, "error", { message: "未配置 Fish Audio API key（live2d-voice.json → apiKeys 或 apiKeyFile），语音朗读不可用" });
	}

	// The drain must never reject (TTS failures are reported as error events).
	const drain = () =>
		Promise.resolve(queue)
			.then(() => settle(controller.signal.aborted ? "aborted" : "finish"))
			.catch(() => settle("aborted"));

	try {
		for await (const chunk of chunks) {
			if (chunk.type === "text-delta" && chunk.text) {
				for (const sentence of buffer.push(chunk.text)) handleSentence(sentence);
			}
			yield chunk;
		}
		for (const sentence of buffer.flush()) handleSentence(sentence);
		if (!sentenceMode) flushBlock();
		// Whole-utterance translation: one call, one TTFT — starts as soon as
		// the stream ends, in parallel with the TTS drain (never delays
		// audio). Reuses the serial per-session translation queue.
		const target = config.subtitleLanguage;
		if (target && target !== "off" && target !== config.speechLanguage && lines.length > 0 && deps.hub.has(sessionId)) {
			let tq = translations.get(sessionId);
			if (tq === undefined) {
				tq = new TranslationQueue();
				translations.set(sessionId, tq);
			}
			const snapshot = lines.slice();
			tq.push(() => translateWhole(deps, translate, sessionId, model, snapshot, target, controller.signal));
		}
		// BLK-02: do NOT await the queue here — the turn settles now; the
		// background drain owns audio-end/speech-end.
		void drain();
	} catch (error) {
		controller.abort();
		queue.catch(() => undefined);
		void drain();
		throw error;
	}
}

/**
 * Speak one sentence: expression → TTS (streaming PCM). The subtitle is
 * emitted with the first PCM chunk's audioSeq so the client shows it when
 * that chunk actually starts playing (host synthesis runs ahead of browser
 * playback — a naive emit would let subtitles race ahead of the voice);
 * when no TTS runs (no keys / failure) audioSeq stays undefined and the
 * client shows it immediately. The clean sentence is also collected into
 * `lines` — the whole utterance is translated once (see translateWhole),
 * never per sentence. Never rejects.
 */
async function speakSentence(
	deps: SpeechDeps,
	sessionId: string,
	utteranceId: string,
	lineId: string,
	raw: string,
	config: PluginConfig,
	apiKeys: string[],
	signal: AbortSignal,
	nextSeq: () => number,
	lines: Array<{ lineId: string; text: string }>,
): Promise<void> {
	const vocabulary = new Set(Object.keys(config.emotionMap));
	const { clean: cleanEmotion, emotions } = extractEmotionTags(raw, vocabulary);
	const { clean, motions } = extractMotionTags(cleanEmotion);
	const emotion = emotions.at(-1);
	if (emotion !== undefined) {
		deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression: config.emotionMap[emotion] });
	}
	for (const motion of motions) {
		deps.hub.emit(sessionId, "motion", { utteranceId, motion, speaker: "assistant" });
	}
	const text = clean.trim();
	if (!text) return;
	lines.push({ lineId, text });
	let subtitled = false;
	const emitSubtitle = (audioSeq?: number): void => {
		if (subtitled) return;
		subtitled = true;
		deps.hub.emit(sessionId, "subtitle", { role: "assistant", text, utteranceId, lineId, audioSeq });
	};
	if (apiKeys.length === 0) {
		emitSubtitle();
		return;
	}
	try {
		await synthesize({ text, voiceId: config.voiceId, model: config.ttsModel, apiKeys, signal }, (pcm) => {
			const seq = nextSeq();
			emitSubtitle(seq);
			deps.hub.emit(sessionId, "audio", { utteranceId, seq, b64: pcm.toString("base64") });
		});
	} catch (error) {
		if (signal.aborted) return;
		deps.hub.emit(sessionId, "error", { message: error instanceof Error ? error.message : String(error) });
	} finally {
		// No audio will come (TTS failed or produced nothing) — still subtitle.
		emitSubtitle();
	}
}

/**
 * Translate a whole utterance with one llm call, then split the translated
 * text back onto the original subtitle lines. Sentence boundaries may shift
 * in translation — attach by index; surplus translated sentences merge into
 * the last line, missing ones leave their line without a translation.
 * Best-effort: never throws.
 */
async function translateWhole(
	deps: SpeechDeps,
	translate: TranslateOnceFn,
	sessionId: string,
	model: SessionModel,
	lines: Array<{ lineId: string; text: string }>,
	targetLanguage: string,
	signal: AbortSignal,
): Promise<void> {
	const whole = lines.map((line) => line.text).join("");
	const translated = await translate(sessionId, model, whole, targetLanguage, signal);
	if (!translated) return;
	const buffer = new SentenceBuffer();
	const sentences = buffer.push(translated);
	sentences.push(...buffer.flush());
	const perLine: string[] = new Array(lines.length).fill("");
	let idx = 0;
	for (const sentence of sentences) {
		if (idx < lines.length) {
			perLine[idx] = sentence;
			idx += 1;
		} else {
			// Surplus translated sentences keep flowing into the final line.
			perLine[perLine.length - 1] += sentence;
		}
	}
	for (let i = 0; i < lines.length; i++) {
		if (perLine[i]) {
			deps.hub.emit(sessionId, "subtitle-translation", { lineId: lines[i].lineId, text: perLine[i] });
		}
	}
}
