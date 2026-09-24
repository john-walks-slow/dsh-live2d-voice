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
	ModelCatalog,
	ModelInfo,
	ModelSelection,
	PublicConfig,
	CameraCapturePayload,
	SpeechEndPayload,
	StreamHandlers,
	SubtitlePayload,
	SubtitleTranslationPayload,
	VoicePreset,
} from "./types.js";
import { logger } from "./logger.js";

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

export async function postMessage(sessionId: string, text: string, mode: "queue" | "steer" = "queue"): Promise<void> {
	const response = await fetch("/live2d-voice/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId, text, mode }),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { message?: string };
		throw new Error(body.message ?? `HTTP ${response.status}`);
	}
}

/**
 * Submit one user line through the third-person player pipeline: the host
 * polishes it into the player persona's line, speaks it with the player's
 * avatar (SSE speaker:"player" events), and only then submits it to the
 * agent. Resolves as soon as the line is accepted (draft can clear); the
 * line itself arrives over SSE.
 */
export async function postPlayerLine(sessionId: string, text: string, mode: "queue" | "steer" = "queue"): Promise<void> {
	const response = await fetch("/live2d-voice/player-line", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId, text, mode }),
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

export interface AsrUpload {
	/** Identifies this upload in the asr-interim/asr-final SSE payloads. */
	uploadId: string;
	/** Feed one 16kHz s16le mono PCM frame into the upload stream. */
	push(pcm: Int16Array): void;
	/** End the utterance (finalize) — the transcript arrives via asr-final. */
	finish(): void;
	/** Abort the upload (blip / mic stopped mid-word) — no result expected. */
	abort(): void;
	/** Settles when the upstream opens (failures surface via onError). */
	done: Promise<void>;
}

/**
 * Stream one VAD utterance to the host ASR relay over a same-origin
 * WebSocket: binary frames are live PCM, a {"t":"finish"} control message
 * finalizes it, an abrupt close discards it. The transcript never comes
 * back on this socket; it travels over the session SSE as `asr-interim` /
 * `asr-final`.
 *
 * (A fetch ReadableStream body would be the natural choice, but Chromium
 * only streams request bodies over HTTP/2, and the harness webserver
 * speaks HTTP/1.1 — ERR_ALPN_NEGOTIATION_FAILED.)
 */
export function startAsrUpload(sessionId: string, language: string): AsrUpload {
	const pending: Int16Array[] = [];
	const uploadId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	const ws = new WebSocket(`/live2d-voice/asr/ws?session=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(language)}&up=${uploadId}`);
	let settling = false;
	let resolveDone: (() => void) | null = null;
	let rejectDone: ((error: Error) => void) | null = null;
	const done = new Promise<void>((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});
	ws.binaryType = "arraybuffer";
	ws.onopen = () => {
		for (const frame of pending.splice(0)) push(frame);
		resolveDone?.();
	};
	ws.onerror = () => {
		if (!settling) rejectDone?.(new Error("语音上行连接失败"));
	};
	ws.onclose = () => {
		// finish() ends with the server closing this socket — that is the
		// normal path; anything else means the utterance was discarded.
		if (!settling) rejectDone?.(new Error("语音上行连接已断开"));
	};
	const push = (frame: Int16Array): void => {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
		} else if (ws.readyState === WebSocket.CONNECTING) {
			pending.push(frame);
		}
	};
	return {
		uploadId,
		push,
		finish: () => {
			settling = true;
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "finish" }));
		},
		abort: () => {
			settling = true;
			try {
				ws.close();
			} catch {
				/* already gone */
			}
		},
		done,
	};
}

/** Deliver a camera frame (or a failure) for a pending camera-capture request. */
export async function postCameraResult(requestId: string, shot: { dataUrl: string; width: number; height: number } | null): Promise<void> {
	await fetch("/live2d-voice/camera-result", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(shot ? { requestId, ...shot } : { requestId, dataUrl: "" }),
	}).catch(() => undefined);
}

/** Fetch the full model catalog (provider-grouped models + deployment default). */
export function fetchModelCatalog(): Promise<ModelCatalog> {
	return getJson("/live2d-voice/model-catalog");
}

/** Fetch the current model selection for one session. */
export function fetchModelSelection(sessionId: string): Promise<ModelSelection> {
	return getJson(`/live2d-voice/model-selection?session=${encodeURIComponent(sessionId)}`);
}

/** Select a model (and optional reasoning effort) for one session. */
export async function selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<{ selected: ModelSelection }> {
	const response = await fetch("/live2d-voice/select-model", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId, provider, model, reasoningEffort }),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { message?: string };
		throw new Error(body.message ?? `HTTP ${response.status}`);
	}
	return (await response.json()) as { selected: ModelSelection };
}

/**
 * Open the session SSE stream. Returns a closer. EventSource auto-reconnects;
 * listeners tolerate duplicate `hello` events after a reconnect.
 */
export function openStream(sessionId: string, handlers: StreamHandlers): () => void {
	const source = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sessionId)}`);
	logger.info(`SSE stream connecting for session ${sessionId.slice(0, 8)}`);

	source.onopen = () => {
		logger.info("SSE stream opened");
	};

	source.onerror = (e) => {
		logger.warn("SSE stream connection error / reconnecting", e);
	};

	const wire = <T>(event: string, handler?: (payload: T) => void) => {
		if (!handler) return;
		source.addEventListener(event, (raw) => {
			try {
				handler(JSON.parse((raw as MessageEvent).data) as T);
			} catch (error) {
				logger.error(`bad ${event} payload`, error);
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
	wire<CameraCapturePayload>("camera-capture", handlers.onCameraCapture);
	wire<{ text: string; up: string }>("asr-interim", handlers.onAsrInterim);
	wire<{ text: string; up: string }>("asr-final", handlers.onAsrFinal);
	wire<ErrorPayload>("error", handlers.onError);
	return () => source.close();
}
