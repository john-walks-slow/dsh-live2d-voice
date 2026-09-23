/**
 * Fish Audio TTS client: HTTP streaming synthesis with multi-key rotation.
 *
 * Uses POST /v1/tts with format "pcm" — the response body is a chunked byte
 * stream of raw 16-bit LE mono PCM at 44100 Hz (sample rate verified against
 * the wav-format response header). Each onPcm callback receives a Buffer the
 * caller forwards to the client over SSE.
 *
 * Proxying follows Node's global fetch behavior: HTTPS_PROXY/HTTP_PROXY env
 * vars are honored automatically (EnvHttpProxyAgent), which is what this
 * deployment relies on for reaching api.fish.audio.
 */

export interface TtsOptions {
	text: string;
	voiceId: string;
	model: string;
	apiKeys: string[];
	signal?: AbortSignal;
}

export type PcmSink = (chunk: Buffer) => void | Promise<void>;

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
export const PCM_SAMPLE_RATE = 44100;

export class TtsError extends Error {
	constructor(
		message: string,
		readonly status: number | undefined,
	) {
		super(message);
	}
}

/**
 * Synthesize one sentence. Streams PCM chunks into `onPcm` as they arrive so
 * playback can start before the full clip is generated. Rotates API keys on
 * 401/402/429; the last error is rethrown when every key fails.
 */
export async function synthesize(options: TtsOptions, onPcm: PcmSink): Promise<void> {
	if (options.apiKeys.length === 0) throw new TtsError("no Fish Audio API key configured", undefined);
	let lastError: unknown;
	for (const key of options.apiKeys) {
		try {
			await synthesizeWithKey(options, key, onPcm);
			return;
		} catch (error) {
			lastError = error;
			if (error instanceof TtsError && (error.status === 401 || error.status === 402 || error.status === 429)) {
				continue;
			}
			throw error;
		}
	}
	throw lastError ?? new TtsError("TTS failed", undefined);
}

async function synthesizeWithKey(options: TtsOptions, key: string, onPcm: PcmSink): Promise<void> {
	const response = await fetch(FISH_TTS_URL, {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
			model: options.model,
		},
		body: JSON.stringify({
			text: options.text,
			reference_id: options.voiceId,
			format: "pcm",
			latency: "balanced",
		}),
		signal: options.signal,
	});
	if (!response.ok || !response.body) {
		const detail = await response.text().catch(() => "");
		throw new TtsError(`Fish TTS HTTP ${response.status}: ${detail.slice(0, 200)}`, response.status);
	}
	const reader = response.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value && value.byteLength > 0) await onPcm(Buffer.from(value));
	}
}
