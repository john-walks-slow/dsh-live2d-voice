/**
 * The llm/stream tap: sentence the assistant stream, drive expressions and
 * subtitles, and synthesize speech sentence-by-sentence while the model is
 * still writing.
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
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { SentenceBuffer, extractEmotionTags } from "./sentence.js";
import { PCM_SAMPLE_RATE, synthesize } from "./tts.js";
import type { SseHub } from "./events.js";
import type { SpeechModes } from "./system-prompt.js";
import type { PluginConfig } from "./config.js";

interface SpeechDeps {
	hub: SseHub;
	modes: SpeechModes;
	getConfig: () => PluginConfig;
	resolveKeys: (config: PluginConfig) => string[];
}

interface ActiveSpeech {
	utteranceId: string;
	abort: AbortController;
}

export function applySpeechTap(ctx: Context, deps: SpeechDeps): void {
	const active = new Map<string, ActiveSpeech>();

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
		return speak(deps, active, sessionId, next());
	});

	// REC-05: the last SSE listener for a session left — stop synthesizing
	// audio nobody will hear (saves Fish Audio quota).
	deps.hub.onLastClose((sessionId) => {
		active.get(sessionId)?.abort.abort();
	});
}

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
	sessionId: string,
	chunks: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
	const config = deps.getConfig();
	const apiKeys = deps.resolveKeys(config);
	// A new utterance supersedes the previous one for this session.
	active.get(sessionId)?.abort.abort();
	const controller = new AbortController();
	const utteranceId = randomUUID().slice(0, 8);
	active.set(sessionId, { utteranceId, abort: controller });

	const buffer = new SentenceBuffer();
	let seq = 0;
	// Serial sentence pipeline: each entry waits for the previous TTS call.
	let queue: Promise<void> = Promise.resolve();
	const enqueue = (sentence: string): void => {
		queue = queue.then(() =>
			speakSentence(deps, sessionId, utteranceId, sentence, config, apiKeys, controller.signal, () => seq++)
		);
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
				for (const sentence of buffer.push(chunk.text)) enqueue(sentence);
			}
			yield chunk;
		}
		for (const sentence of buffer.flush()) enqueue(sentence);
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
 * emitted with the first PCM chunk so it tracks actual playback rather than
 * racing ahead of synthesis; when no TTS runs (no keys / failure) it falls
 * back to an immediate emit. Never rejects.
 */
async function speakSentence(
	deps: SpeechDeps,
	sessionId: string,
	utteranceId: string,
	raw: string,
	config: PluginConfig,
	apiKeys: string[],
	signal: AbortSignal,
	nextSeq: () => number,
): Promise<void> {
	const vocabulary = new Set(Object.keys(config.emotionMap));
	const { clean, emotions } = extractEmotionTags(raw, vocabulary);
	const emotion = emotions.at(-1);
	if (emotion !== undefined) {
		deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression: config.emotionMap[emotion] });
	}
	const text = clean.trim();
	if (!text) return;
	let subtitled = false;
	const emitSubtitle = (): void => {
		if (subtitled) return;
		subtitled = true;
		deps.hub.emit(sessionId, "subtitle", { role: "assistant", text, utteranceId });
	};
	if (apiKeys.length === 0) {
		emitSubtitle();
		return;
	}
	try {
		await synthesize({ text, voiceId: config.voiceId, model: config.ttsModel, apiKeys, signal }, (pcm) => {
			emitSubtitle();
			deps.hub.emit(sessionId, "audio", { utteranceId, seq: nextSeq(), b64: pcm.toString("base64") });
		});
	} catch (error) {
		if (signal.aborted) return;
		deps.hub.emit(sessionId, "error", { message: error instanceof Error ? error.message : String(error) });
	} finally {
		// No audio will come (TTS failed or produced nothing) — still subtitle.
		emitSubtitle();
	}
}
