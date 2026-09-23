/**
 * Volcengine speech-to-text (v3 sauc `bigmodel_nostream`) — one-shot,
 * per-utterance recognition.
 *
 * The browser VAD segments the mic stream into utterances; each closed
 * utterance is recognized in its own short-lived upstream session:
 *
 *   open WSS → full client request (seq=1, JSON+gzip)
 *            → audio frames (seq=2..N, gzip'd PCM chunks; the last one
 *              carries a negative sequence)
 *            → server replies per packet; the final text arrives on the
 *              is_last_package frame, then the socket closes.
 *
 * Why nostream instead of the bidirectional endpoints: bigmodel /
 * bigmodel_async have no Japanese support at all (verified — empty text),
 * while bigmodel_nostream covers 25 languages including ja-JP, and with
 * `request.enable_auto_lang` auto-detection works too (verified zh+ja).
 * The trade-off is no server-side interim text; the client VAD provides
 * the segmentation instead. Buffered audio must be pumped fast — a 200ms
 * live pacing trips error 45000081 on this endpoint.
 *
 * Frame layout (all integers big-endian):
 *   [4B header][4B seq when flags&1][4B payload size][payload]
 *   header byte0: 0x11 (version 1 | header size 1×4B)
 *           byte1: (msg_type << 4) | flags — full client msg=1 flag=pos-seq(0x11),
 *                  audio msg=2 (0x21), last audio flags=neg+seq (0x23)
 *           byte2: (serialization << 4) | compression — full request is
 *                  JSON+gzip (0x11), audio frames raw+gzip (0x01)
 *           byte3: 0x00
 *   server full:  msg 9 (0x9X) · server error: msg 15 (0xFX) + code + size
 */

import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import WebSocket from "ws";

const ASR_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
const RESOURCE_ID = "volc.seedasr.sauc.duration";
/** 200ms of 16kHz s16le mono — the recommended chunk size. */
const CHUNK_BYTES = 6400;

/** Volcengine error codes worth translating for the user. */
const VOLC_ERROR_HINTS: Record<number, string> = {
	45000081: "识别超时（音频流中断过久）",
	45000002: "未检测到有效语音",
	55000031: "识别服务繁忙，请稍后重试",
	45000151: "音频格式错误",
	45000001: "请求参数错误",
};

export interface VolcCredentials {
	/** New-style API key (preferred — a single header). */
	apikey?: string;
	/** Legacy console credentials (fallback when apikey is absent). */
	appid: string;
	accessToken: string;
}

/** Map a config language id to the API's BCP-47 code. */
export function asrLanguageCode(language: string): string | undefined {
	const map: Record<string, string> = { zh: "zh-CN", ja: "ja-JP", en: "en-US" };
	return map[language] ?? undefined;
}

/** Load credentials from a JSON file: apikey alone, or appid+accessToken. */
export function loadVolcCredentials(filePath: string): VolcCredentials | undefined {
	try {
		// Tolerate "~/" — the README example uses it and readFileSync does not expand it.
		const expanded = filePath.startsWith("~/") ? `${homedir()}${filePath.slice(1)}` : filePath;
		const raw = JSON.parse(readFileSync(expanded, "utf-8")) as Partial<VolcCredentials>;
		const apikey = typeof raw.apikey === "string" ? raw.apikey.trim() : "";
		const appid = typeof raw.appid === "string" ? raw.appid.trim() : "";
		const accessToken = typeof raw.accessToken === "string" ? raw.accessToken.trim() : "";
		if (apikey || (appid && accessToken)) {
			return { apikey: apikey || undefined, appid, accessToken };
		}
		return undefined;
	} catch {
		return undefined;
	}
}

interface VolcUtterance {
	text: string;
	definite?: boolean;
}

interface ParsedFrame {
	error: boolean;
	code: number;
	isLast: boolean;
	payload: Record<string, unknown> | null;
}

// ---------- frame codec ----------

function frameHeader(messageType: number, flags: number): Buffer {
	// serial=JSON (0x01) is only meaningful for the full request; audio
	// frames mark raw (0x00). The server accepts both gzip'd payloads.
	const serial = messageType === 0x01 ? 0x10 : 0x00;
	return Buffer.from([0x11, (messageType << 4) | flags, serial | 0x01, 0x00]);
}

function withSize(payload: Buffer): Buffer {
	const size = Buffer.alloc(4);
	size.writeUInt32BE(payload.length);
	return Buffer.concat([size, payload]);
}

function buildFullRequest(payload: unknown): Buffer {
	return Buffer.concat([frameHeader(0x01, 0b0001), i32(1), withSize(gzipSync(Buffer.from(JSON.stringify(payload), "utf8")))]);
}

function buildAudio(seq: number, pcm: Buffer, isLast: boolean): Buffer {
	return Buffer.concat([frameHeader(0x02, isLast ? 0b0011 : 0b0001), i32(isLast ? -seq : seq), withSize(gzipSync(pcm))]);
}

function i32(value: number): Buffer {
	const b = Buffer.alloc(4);
	b.writeInt32BE(value);
	return b;
}

function parseFrame(data: Buffer): ParsedFrame {
	const messageType = data[1] >> 4;
	const flags = data[1] & 0x0f;
	const compression = data[2] & 0x0f;
	let offset = (data[0] & 0x0f) * 4;
	if (flags & 0b0001) offset += 4; // sequence
	const isLast = (flags & 0b0010) !== 0;
	if (flags & 0b0100) offset += 4; // event
	if (messageType === 0x0f) {
		// Error frame: code(4) | payload size(4) | payload.
		const code = data.readInt32BE(offset);
		offset += 8;
		return { error: true, code, isLast, payload: decodePayload(data, offset, compression) };
	}
	if (messageType !== 0x09) {
		// Unknown message type — nothing we can do with it.
		return { error: false, code: 0, isLast, payload: null };
	}
	offset += 4; // payload size
	return { error: false, code: 0, isLast, payload: decodePayload(data, offset, compression) };
}

function decodePayload(data: Buffer, offset: number, compression: number): Record<string, unknown> | null {
	let body = data.subarray(Math.min(offset, data.length));
	if (body.length === 0) return null;
	if (compression === 1) {
		try {
			body = gunzipSync(body);
		} catch {
			return null;
		}
	}
	try {
		const parsed = JSON.parse(body.toString("utf-8"));
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function describeError(frame: ParsedFrame): string {
	const payload = (frame.payload ?? {}) as { message?: unknown; error?: unknown };
	const detail = payload.message ?? payload.error ?? "unknown error";
	const hint = VOLC_ERROR_HINTS[frame.code];
	return `volc asr error ${frame.code}: ${hint ? `${hint}（` : ""}${String(detail)}${hint ? "）" : ""}`;
}

// ---------- one-shot recognition ----------

/**
 * Recognize one buffered utterance of 16kHz s16le mono PCM.
 * Resolves with the transcript ("" when the server heard nothing).
 * `language` is a config id: "auto" enables auto-detection, anything else
 * is mapped to a BCP-47 hint (unknown ids fall back to auto).
 */
export function recognizeUtterance(
	credentials: VolcCredentials,
	pcm: Buffer,
	language = "auto",
	timeoutMs = 20_000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (pcm.length === 0) {
			resolve("");
			return;
		}
		const headers: Record<string, string> = {
			"X-Api-Resource-Id": RESOURCE_ID,
			"X-Api-Request-Id": randomUUID(),
		};
		if (credentials.apikey) headers["X-Api-Key"] = credentials.apikey;
		else {
			headers["X-Api-App-Key"] = credentials.appid;
			headers["X-Api-Access-Key"] = credentials.accessToken;
		}

		let settled = false;
		let text = "";
		let ws: WebSocket;
		const dispose = () => {
			try {
				if (ws.readyState === WebSocket.OPEN) ws.close();
				else ws.terminate();
			} catch {
				/* already gone */
			}
		};
		const settle = (win: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			dispose();
			win();
		};
		const fail = (message: string) => settle(() => reject(new Error(message)));
		const timer = setTimeout(() => fail(`volc asr: no result within ${timeoutMs}ms`), timeoutMs);

		ws = new WebSocket(ASR_URL, { headers, handshakeTimeout: 15_000 });
		ws.on("unexpected-response", (_request, response) => {
			let body = "";
			response.on("data", (chunk: Buffer) => (body += chunk));
			response.on("end", () => fail(`volc asr: handshake HTTP ${response.statusCode} ${body.slice(0, 200)}`));
		});
		ws.on("error", (error: Error) => fail(`volc asr: ${error.message}`));
		ws.on("close", () => {
			// The server closes after the final frame. Getting here without
			// isLast but with text is still a usable result.
			settle(() => (text ? resolve(text) : reject(new Error("volc asr: connection closed before a result"))));
		});
		ws.on("message", (data: Buffer | Buffer[]) => {
			// ws may deliver one frame as multiple Buffer fragments — merge first.
			const frame = Array.isArray(data) ? Buffer.concat(data) : data;
			let parsed: ParsedFrame;
			try {
				parsed = parseFrame(frame);
			} catch {
				return; // Never let a malformed frame kill the session.
			}
			if (parsed.error) {
				fail(describeError(parsed));
				return;
			}
			const result = (parsed.payload?.result ?? undefined) as { text?: string; utterances?: VolcUtterance[] } | undefined;
			if (result?.text) text = result.text;
			else if (result?.utterances) {
				const joined = result.utterances.map((u) => u.text).join("");
				if (joined) text = joined;
			}
			if (parsed.isLast) settle(() => resolve(text));
		});
		ws.on("open", () => {
			const code = asrLanguageCode(language);
			const request = {
				user: { uid: "dsh-live2d-voice" },
				audio: {
					format: "pcm",
					codec: "raw",
					rate: 16000,
					bits: 16,
					channel: 1,
					...(code ? { language: code } : {}),
				},
				request: {
					model_name: "bigmodel",
					enable_itn: true,
					enable_punc: true,
					enable_ddc: false,
					show_utterances: true,
					result_type: "full",
					...(code ? {} : { enable_auto_lang: true }),
				},
			};
			try {
				ws.send(buildFullRequest(request));
				// Pump the whole utterance immediately — this endpoint
				// dislikes slow feeds (45000081), and buffered audio is
				// not live anyway.
				let seq = 1;
				for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
					seq += 1;
					const chunk = pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length));
					const isLast = offset + CHUNK_BYTES >= pcm.length;
					ws.send(buildAudio(seq, chunk, isLast));
				}
			} catch (error) {
				fail(`volc asr: send failed (${error instanceof Error ? error.message : String(error)})`);
			}
		});
	});
}
