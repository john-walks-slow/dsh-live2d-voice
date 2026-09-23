/**
 * HTTP + SSE client for the /live2d-voice routes (same-origin; the session
 * cookie rides along automatically).
 */

import type {
	ErrorPayload,
	ExpressionPayload,
	ModelInfo,
	PublicConfig,
	StreamHandlers,
	SubtitlePayload,
	VoicePreset,
	SpeechEndPayload,
	AudioStartPayload,
	AudioPayload,
} from "./types.js";

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`);
	return (await response.json()) as T;
}

export function fetchConfig(): Promise<{ config: PublicConfig; presets: VoicePreset[] }> {
	return getJson("/live2d-voice/config");
}

export function fetchModelInfo(): Promise<ModelInfo> {
	return getJson("/live2d-voice/model");
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
	wire<ErrorPayload>("error", handlers.onError);
	return () => source.close();
}
