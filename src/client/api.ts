/**
 * HTTP + SSE client for the /live2d-voice routes (same-origin; the session
 * cookie rides along automatically).
 */

import type {
	AudioPayload,
	AudioStartPayload,
	ErrorPayload,
	ExpressionPayload,
	LanguageOption,
	ModelInfo,
	PublicConfig,
	SpeechEndPayload,
	StreamHandlers,
	SubtitlePayload,
	SubtitleTranslationPayload,
	VoicePreset,
} from "./types.js";

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`);
	return (await response.json()) as T;
}

/**
 * Load the voice presets + the effective config. With a session id the
 * config carries the workspace overlay; without it the global layer.
 */
export function fetchConfig(sessionId?: string): Promise<{ config: PublicConfig; presets: VoicePreset[]; languages: LanguageOption[] }> {
	const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
	return getJson(`/live2d-voice/config${query}`);
}

/** The model descriptor + catalog for the session (workspace-aware). */
export function fetchModelInfo(sessionId?: string): Promise<ModelInfo> {
	const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
	return getJson(`/live2d-voice/model${query}`);
}

export async function saveConfig(patch: Partial<PublicConfig> & { apiKeys?: string[] }): Promise<{ config: PublicConfig }> {
	const response = await fetch("/live2d-voice/config", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!response.ok) throw new Error(`POST /live2d-voice/config → HTTP ${response.status}`);
	return (await response.json()) as { config: PublicConfig };
}

export async function postMessage(sessionId: string, text: string): Promise<void> {
	const response = await fetch("/live2d-voice/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId, text }),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { message?: string };
		throw new Error(body.message ?? `HTTP ${response.status}`);
	}
}

/**
 * Recognize one buffered utterance (VAD-closed by the mic layer): raw 16kHz
 * s16le mono PCM body in, transcript out. Each call is an independent HTTP
 * request, so overlapping segments cannot interleave.
 */
export async function recognizeUtterance(pcm: ArrayBuffer, language: string): Promise<string> {
	const response = await fetch(`/live2d-voice/asr/recognize?lang=${encodeURIComponent(language)}`, {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: pcm,
	});
	const body = (await response.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
	if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
	return body.text ?? "";
}

/**
 * Open the session SSE stream. Returns a closer. EventSource auto-reconnects;
 * listeners tolerate duplicate `hello` events after a reconnect.
 */
export function openStream(sessionId: string, handlers: StreamHandlers): () => void {
	const source = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sessionId)}`);
	const wire = <T>(event: string, handler?: (payload: T) => void) => {
		if (!handler) return;
		source.addEventListener(event, (raw) => {
			try {
				handler(JSON.parse((raw as MessageEvent).data) as T);
			} catch (error) {
				console.error(`[dsh-live2d-voice] bad ${event} payload`, error);
			}
		});
	};
	wire<never>("hello", undefined);
	wire<ExpressionPayload>("expression", handlers.onExpression);
	wire<{ utteranceId: string }>("speech-start", handlers.onSpeechStart);
	wire<SpeechEndPayload>("speech-end", handlers.onSpeechEnd);
	wire<AudioStartPayload>("audio-start", handlers.onAudioStart);
	wire<AudioPayload>("audio", handlers.onAudio);
	wire<{ utteranceId: string }>("audio-end", handlers.onAudioEnd);
	wire<SubtitlePayload>("subtitle", handlers.onSubtitle);
	wire<SubtitleTranslationPayload>("subtitle-translation", handlers.onSubtitleTranslation);
	wire<ErrorPayload>("error", handlers.onError);
	return () => source.close();
}
