/**
 * Web routes on the host webserver (composed dsh web profiles only; a missing
 * webserver degrades to a no-op with one log line):
 *
 *   GET  /live2d-voice/stream?session=<id>   SSE event stream (the Live view)
 *   GET  /live2d-voice/asr/ws?session=..     WebSocket upstream: one VAD
 *                                           utterance of live PCM frames in,
 *                                           interim/final text over SSE
 *   POST /live2d-voice/asr/recognize?lang=.. one buffered utterance of 16k
 *                                           PCM in (octet-stream), text out
 *   GET  /live2d-voice/config[?session=..]   sanitized config + voice presets
 *                                           (with session: the workspace-
 *                                            overlaid effective config)
 *   POST /live2d-voice/config                update config fields (global)
 *   POST /live2d-voice/message               submit a user message to a session
 *   GET  /live2d-voice/model[?session=..]   which .model3.json to render +
 *                                           the full model catalog
 *   GET  /live2d-voice/models/*              model assets (traversal-guarded)
 *   GET  /live2d-voice/core/live2dcubismcore.min.js  Cubism Core runtime
 *
 * Plus a `webserver/index-inject` row loading the Cubism Core script on every
 * index.html render (the model loader requires window.Live2DCubismCore).
 */

import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync, createWriteStream, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { join, resolve, sep, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { WebSocketServer } from "ws";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { LANGUAGE_OPTIONS, VOICE_PRESETS, resolveModelCatalog, resolveModelSelection, resolveSessionConfig, type ModelEntry, type PluginConfig } from "./config.js";
import type { SseHub } from "./events.js";
import { loadVolcCredentials, recognizeUtterance, StreamingAsrSession } from "./asr.js";

const BODY_MAX_BYTES = 64 * 1024;
/** 16kHz s16le mono ≈ 32KB/s — 2MB ≈ one minute of speech, far above the client's 20s cap. */
const PCM_MAX_BYTES = 2 * 1024 * 1024;
/** Below 100ms of audio the recognizer has nothing to work with. */
const PCM_MIN_BYTES = 3200;
const MODELS_PREFIX = "/live2d-voice/models";
const GAZE_PREFIX = "/live2d-voice/gaze";
const FACE_LANDMARKER_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const FACE_LANDMARKER_MAX_BYTES = 16 * 1024 * 1024;
const CORE_SCRIPT_PATH = "/live2d-voice/core/live2dcubismcore.min.js";

interface WebServerLike {
	register(route: { kind: "exact" | "prefix"; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void;
	registerUpgrade(route: { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void> }): () => void;
}

export interface RouteDeps {
	hub: SseHub;
	getConfig: () => PluginConfig;
	saveConfig: (patch: Partial<PluginConfig>) => PluginConfig;
	resolveKeys: (config: PluginConfig) => string[];
	/** The camera tool's pending-capture bridge. */
	cameraBridge: { deliver(requestId: string, shot: { dataUrl: string; width: number; height: number } | null): boolean };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage, maxBytes = BODY_MAX_BYTES): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > maxBytes) throw new Error("body too large");
		chunks.push(chunk as Buffer);
	}
	const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body must be a JSON object");
	return parsed as Record<string, unknown>;
}

/** Read a raw binary request body (bounded). */
async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > maxBytes) throw new Error("body too large");
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

/** The sanitized config served to the GUI: API keys never leave the host. */
function publicConfig(config: PluginConfig, keyCount: number) {
	const { apiKeys: _apiKeys, ...rest } = config;
	const asrConfigured = config.asrCredentialsFile
		? loadVolcCredentials(config.asrCredentialsFile) !== undefined
		: false;
	return { ...rest, apiKeyCount: keyCount, asrConfigured };
}

function mimeOf(path: string): string {
	if (path.endsWith(".html")) return "text/html; charset=utf-8";
	if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
	if (path.endsWith(".json")) return "application/json; charset=utf-8";
	if (path.endsWith(".png")) return "image/png";
	if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
	if (path.endsWith(".webp")) return "image/webp";
	if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
	if (path.endsWith(".wasm")) return "application/wasm";
	return "application/octet-stream";
}

function serveFile(res: ServerResponse, path: string, maxAgeSeconds: number): boolean {
	let data: Buffer;
	try {
		data = readFileSync(path);
	} catch {
		return false;
	}
	res.writeHead(200, { "content-type": mimeOf(path), "cache-control": `public, max-age=${maxAgeSeconds}` });
	res.end(data);
	return true;
}

/** The asset URL of a catalog entry (each path segment encoded). */
function modelUrl(entry: ModelEntry): string {
	return `${MODELS_PREFIX}/${entry.relative.split("/").map(encodeURIComponent).join("/")}`;
}

export function installRoutes(ctx: Context, deps: RouteDeps): (() => void) | undefined {
	const webServer = (ctx as unknown as { get: (name: string, strict?: boolean) => unknown }).get("webServer", false) as WebServerLike | undefined;
	if (webServer === undefined || webServer === null) {
		ctx.logger.info("dsh-live2d-voice: no webserver composed; web routes not installed.");
		return undefined;
	}
	const disposers: Array<() => void> = [];

	// SSE stream.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/stream", handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim();
			if (!sessionId) {
				writeJson(res, 400, { code: "session_required", message: "query parameter `session` is required" });
				return;
			}
			deps.hub.attach(sessionId, req, res);
		} })
	);

	// Speech-to-text: one VAD-closed utterance (16k s16le mono PCM body) in,
	// transcript JSON out. Each request drives its own short-lived upstream
	// session, so concurrent utterances are naturally isolated.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/asr/recognize", handler: (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void (async () => {
				const config = deps.getConfig();
				const credentials = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) : undefined;
				if (credentials === undefined) {
					writeJson(res, 500, { ok: false, error: "未配置火山 ASR 凭证（live2d-voice.json → asrCredentialsFile，JSON 需含 apikey 或 appid+accessToken）" });
					return;
				}
				const language = new URL(req.url ?? "/", "http://localhost").searchParams.get("lang")?.trim() || config.sttLanguage || "auto";
				let pcm: Buffer;
				try {
					pcm = await readRawBody(req, PCM_MAX_BYTES);
				} catch (error) {
					writeJson(res, 413, { ok: false, error: error instanceof Error ? error.message : String(error) });
					return;
				}
				if (pcm.length < PCM_MIN_BYTES) {
					writeJson(res, 400, { ok: false, error: "音频过短（不足 100ms）" });
					return;
				}
				const text = await recognizeUtterance(credentials, pcm, language);
				writeJson(res, 200, { ok: true, text });
			})().catch((error: unknown) => {
				writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
			});
		} })
	);

	// Streaming speech-to-text: a WebSocket upgrade per VAD utterance. The
	// browser (streaming ASR mode) relays live 16k s16le mono PCM binary
	// frames; the host feeds them into a Volcengine streaming session
	// (bigmodel_async + nostream second pass) and pushes real-time interim
	// text over the session SSE as `asr-interim`, the final transcript as
	// `asr-final`. Control messages: {"t":"finish"} finalizes the utterance,
	// a raw disconnect (or {"t":"abort"}) discards it silently.
	//
	// Why WebSocket and not a POST body? Chromium refuses ReadableStream
	// upload bodies over HTTP/1.1 (ERR_ALPN_NEGOTIATION_FAILED — streaming
	// requests need HTTP/2), and the harness webserver speaks HTTP/1.1.
	const asrWss = new WebSocketServer({ noServer: true });
	disposers.push(
		webServer.registerUpgrade({ path: "/live2d-voice/asr/ws", handler: (req, socket, head) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			const sessionId = url.searchParams.get("session")?.trim() ?? "";
			const up = url.searchParams.get("up")?.trim() ?? "";
			if (!sessionId) {
				socket.destroy();
				return;
			}
			const config = deps.getConfig();
			const credentials = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) : undefined;
			if (credentials === undefined) {
				socket.destroy();
				return;
			}
			asrWss.handleUpgrade(req, socket, head, (ws) => {
				// The `up` id rides along on every ASR event so only the view
				// that actually uploaded this utterance acts on it — other
				// view instances (kept-alive tabs, a second device) see the
				// event but must not submit the same utterance again.
				const emitInterim = (text: string) => deps.hub.emit(sessionId, "asr-interim", { text, up });
				const session = new StreamingAsrSession(credentials, emitInterim);
				let finalized = false;
				let size = 0;
				ws.on("message", (data, isBinary) => {
					if (finalized) return;
					if (isBinary) {
						const chunk = data as Buffer;
						size += chunk.length;
						if (size > PCM_MAX_BYTES) {
							// Unbounded monologue — discard the session.
							session.abort();
							ws.close();
							return;
						}
						session.feed(chunk);
						return;
					}
					try {
						const control = JSON.parse(String(data)) as { t?: string };
						if (control.t === "finish") {
							finalized = true;
							void session
								.end()
								.then((text) => deps.hub.emit(sessionId, "asr-final", { text, up }))
								.catch((error: unknown) => {
									deps.hub.emit(sessionId, "error", { message: error instanceof Error ? error.message : String(error) });
								})
								.finally(() => ws.close());
						} else if (control.t === "abort") {
							finalized = true;
							session.abort();
							ws.close();
						}
					} catch {
						/* malformed control frame — ignore */
					}
				});
				ws.on("close", () => {
					if (!finalized) session.abort();
				});
				ws.on("error", () => {
					if (!finalized) session.abort();
				});
			});
		} })
	);
	disposers.push(() => {
		for (const client of asrWss.clients) client.terminate();
		asrWss.close();
	});

	// Config read (sanitized) + write.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/config", handler: (req, res) => {
			if (req.method === "GET") {
				const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
				const global = deps.getConfig();
				const config = sessionId
					? resolveSessionConfig(ctx.agents, global, sessionId)
					: global;
				writeJson(res, 200, {
					config: publicConfig(config, deps.resolveKeys(global).length),
					presets: VOICE_PRESETS,
					languages: LANGUAGE_OPTIONS,
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void readJsonBody(req)
				.then((body) => {
					const patch: Partial<PluginConfig> = {};
					for (const key of ["modelPath", "modelSelection", "voiceId", "ttsModel", "apiKeyFile", "sttLanguage", "asrMode", "asrCredentialsFile", "speechLanguage", "subtitleLanguage", "speechPrompt"] as const) {
						if (typeof body[key] === "string") patch[key] = body[key] as string;
					}
					if (typeof body.eyeTracking === "boolean") patch.eyeTracking = body.eyeTracking;
					if (typeof body.gyroParallax === "boolean") patch.gyroParallax = body.gyroParallax;
					if (Array.isArray(body.apiKeys)) {
						patch.apiKeys = body.apiKeys.filter((key): key is string => typeof key === "string" && key.length > 0);
					}
					if (typeof body.emotionMap === "object" && body.emotionMap !== null && !Array.isArray(body.emotionMap)) {
						const emotionMap: Record<string, number | string> = {};
						for (const [emotion, expression] of Object.entries(body.emotionMap as Record<string, unknown>)) {
							if (typeof expression === "number" || typeof expression === "string") emotionMap[emotion] = expression;
						}
						patch.emotionMap = emotionMap;
					}
					// liveModel: object (provider+model+optional effort) or null to clear.
					if (body.liveModel === null) {
						patch.liveModel = null;
					} else if (typeof body.liveModel === "object" && !Array.isArray(body.liveModel)) {
						const lm = body.liveModel as Record<string, unknown>;
						if (typeof lm.provider === "string" && typeof lm.model === "string") {
							patch.liveModel = {
								provider: lm.provider,
								model: lm.model,
								...(typeof lm.reasoningEffort === "string" && lm.reasoningEffort ? { reasoningEffort: lm.reasoningEffort } : {}),
							};
						}
					}
					const saved = deps.saveConfig(patch);
					writeJson(res, 200, { config: publicConfig(saved, deps.resolveKeys(saved).length) });
				})
				.catch((error: unknown) => {
					writeJson(res, 400, { code: "bad_config", message: error instanceof Error ? error.message : String(error) });
				});
		} })
	);

	// Message submission (the Live view's text input).
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/message", handler: (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void readJsonBody(req)
				.then(async (body) => {
					const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
					const text = typeof body.text === "string" ? body.text.trim() : "";
					const mode = body.mode === "steer" ? "steer" : "queue";
					if (!sessionId || !text) {
						writeJson(res, 400, { code: "bad_message", message: "sessionId and text are required" });
						return;
					}
					let agent = ctx.agents.get(sessionId as SessionId);
					if (agent === undefined) {
						// Cold session (e.g. after a host restart): resolve through
						// the session controller so the agent resumes WITH its
						// preset (a bare registry resume would skip setup).
						const found = await (
							ctx as unknown as {
								sessionController: { resolveAgent(id: SessionId): Promise<{ agent?: unknown; error?: { message?: string } }> };
							}
						).sessionController.resolveAgent(sessionId as SessionId);
						if (found !== undefined && "agent" in found && found.agent !== undefined) {
							agent = found.agent as NonNullable<typeof agent>;
						} else {
							const detail = found !== undefined && "error" in found ? String(found.error?.message ?? "session not found") : "session not found";
							writeJson(res, 404, { code: "session_not_found", message: detail });
							return;
						}
					}
					const content: ContentBlock[] = [{ type: "text", text }];
					const message = createUserMessage({ content, source: { kind: "user" } });
					if (mode === "steer") agent.steer(message);
					else agent.followup(message);
					deps.hub.emit(sessionId, "subtitle", { role: "user", text });
					writeJson(res, 200, { accepted: true });
				})
				.catch((error: unknown) => {
					writeJson(res, 400, { code: "bad_message", message: error instanceof Error ? error.message : String(error) });
				});
		} })
	);

	// Camera tool result: the browser delivers the captured frame for a
	// pending `camera-capture` request (or reports failure with null).
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/camera-result", handler: (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			// 640px JPEG base64 lands at 55–310KB; allow generous headroom.
			void readJsonBody(req, 9 * 1024 * 1024)
				.then((body) => {
					const requestId = typeof body.requestId === "string" ? body.requestId : "";
					const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
					const width = Number(body.width) || 0;
					const height = Number(body.height) || 0;
					if (!requestId) {
						writeJson(res, 400, { code: "bad_request", message: "requestId is required" });
						return;
					}
					if (dataUrl.length > 8 * 1024 * 1024) {
						writeJson(res, 413, { code: "too_large", message: "image too large" });
						return;
					}
					const shot = dataUrl.startsWith("data:image/jpeg") ? { dataUrl, width, height } : null;
					writeJson(res, 200, { ok: deps.cameraBridge.deliver(requestId, shot) });
				})
				.catch((error: unknown) => {
					writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
				});
		} })
	);

	// Model descriptor for the view: the effective selection plus the whole
	// catalog (the ⚙ panel offers a picker when there is more than one).
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/model", handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
			const config = sessionId
				? resolveSessionConfig(ctx.agents, deps.getConfig(), sessionId)
				: deps.getConfig();
			const catalog = resolveModelCatalog(config);
			const entry = resolveModelSelection(config, catalog);
			if (entry === undefined) {
				writeJson(res, 200, { configured: Boolean(config.modelPath), url: undefined });
				return;
			}
			writeJson(res, 200, {
				configured: true,
				url: modelUrl(entry),
				name: entry.name,
				label: entry.label,
				current: entry.name,
				models: catalog.map((model) => ({
					name: model.name,
					label: model.label,
					url: modelUrl(model),
				})),
			});
		} })
	);

	// Model assets (traversal-guarded static file serving). Roots include
	// every workspace-overridden modelPath so catalog URLs generated against
	// an override root actually resolve (override roots win, global last).
	disposers.push(
		webServer.register({ kind: "prefix", path: MODELS_PREFIX, handler: (req, res) => {
			const config = deps.getConfig();
			const roots: string[] = [];
			for (const override of Object.values(config.workspaces ?? {})) {
				const path = typeof override.modelPath === "string" ? override.modelPath.trim() : "";
				if (path && !roots.includes(resolve(path))) roots.push(resolve(path));
			}
			if (config.modelPath && !roots.includes(resolve(config.modelPath))) roots.push(resolve(config.modelPath));
			if (roots.length === 0) {
				writeJson(res, 404, { code: "model_not_configured" });
				return;
			}
			const url = (req.url ?? "").split("?")[0];
			let relative: string;
			try {
				relative = decodeURIComponent(url.slice(MODELS_PREFIX.length));
			} catch {
				writeJson(res, 400, { code: "bad_path" });
				return;
			}
			for (const root of roots) {
				const target = resolve(join(root, relative));
				if (target !== root && !target.startsWith(root + sep)) continue; // wrong root — try next
				let isFile: boolean;
				try {
					isFile = statSync(target).isFile();
				} catch {
					isFile = false;
				}
				if (isFile && serveFile(res, target, 3600)) return;
			}
			writeJson(res, 404, { code: "not_found" });
		} })
	);

	// Experimental gaze tracking assets: the MediaPipe runtime is served
	// from the plugin's own node_modules, and the face_landmarker model is
	// downloaded once (through the host's network) and cached — the phone
	// browser never needs external network access.
	const mediapipeDir = (() => {
		try {
			const require = createRequire(import.meta.url);
			// The package exports map hides package.json — resolve the entry
			// and walk up to the directory that owns it.
			let dir = dirname(require.resolve("@mediapipe/tasks-vision"));
			for (let i = 0; i < 4; i++) {
				if (existsSync(join(dir, "wasm")) && existsSync(join(dir, "vision_bundle.mjs"))) return dir;
				dir = dirname(dir);
			}
			return "";
		} catch {
			return "";
		}
	})();
	const gazeModelCache = (() => {
		const dir = join(process.env.DSH_HOME ?? resolve(homedir(), ".dsh"), "live2d-voice-cache");
		try {
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			return join(dir, "face_landmarker.task");
		} catch {
			return "";
		}
	})();
	let gazeModelPromise: Promise<string> | null = null;
	const ensureGazeModel = (): Promise<string> => {
		if (gazeModelCache && existsSync(gazeModelCache)) return Promise.resolve(gazeModelCache);
		gazeModelPromise ??= (async () => {
			if (!gazeModelCache) throw new Error("cache dir unavailable");
			const response = await fetch(FACE_LANDMARKER_URL);
			if (!response.ok || !response.body) throw new Error(`model download failed: HTTP ${response.status}`);
			const length = Number(response.headers.get("content-length") ?? "0");
			if (length > FACE_LANDMARKER_MAX_BYTES) throw new Error("model download too large");
			const temp = `${gazeModelCache}.tmp`;
			await pipeline(response.body, createWriteStream(temp));
			const stat = statSync(temp);
			if (stat.size > FACE_LANDMARKER_MAX_BYTES || stat.size < 1024) throw new Error("model download corrupt");
			writeFileSync(gazeModelCache, readFileSync(temp)); // atomic-ish publish
			rmSync(temp, { force: true });
			return gazeModelCache;
		})().catch((error: unknown) => {
			gazeModelPromise = null; // allow retry on the next request
			throw error;
		});
		return gazeModelPromise;
	};
	disposers.push(
		webServer.register({ kind: "prefix", path: GAZE_PREFIX, handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			const url = (req.url ?? "").split("?")[0];
			let relative: string;
			try {
				relative = decodeURIComponent(url.slice(GAZE_PREFIX.length)).replace(/^\/+/, "");
			} catch {
				writeJson(res, 400, { code: "bad_path" });
				return;
			}
			void (async () => {
				if (relative === "model") {
					const file = await ensureGazeModel();
					if (!serveFile(res, file, 86_400)) writeJson(res, 502, { code: "model_unavailable" });
					return;
				}
				if (!mediapipeDir) {
					writeJson(res, 404, { code: "mediapipe_missing" });
					return;
				}
				if (relative === "vision.mjs") {
					if (!serveFile(res, join(mediapipeDir, "vision_bundle.mjs"), 0)) writeJson(res, 404, { code: "not_found" });
					return;
				}
				if (relative.startsWith("wasm/")) {
					const root = resolve(join(mediapipeDir, "wasm"));
					const target = resolve(join(root, relative.slice(5)));
					if (target !== root && !target.startsWith(root + sep)) {
						writeJson(res, 403, { code: "path_forbidden" });
						return;
					}
					if (!serveFile(res, target, 86_400)) writeJson(res, 404, { code: "not_found" });
					return;
				}
				writeJson(res, 404, { code: "not_found" });
			})().catch((error: unknown) => {
				writeJson(res, 502, { code: "gaze_asset_error", message: error instanceof Error ? error.message : String(error) });
			});
		} })
	);

	// Standalone Live2D entry: a self-contained page for one session —
	// no GUI chrome, just the character. /live2d-voice/app?session=<id>
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/app", handler: (_req, res) => {
			const page = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/standalone.html");
			if (!serveFile(res, page, 0)) writeJson(res, 404, { code: "standalone_missing" });
		} })
	);
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/app/bundle.js", handler: (_req, res) => {
			const bundle = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/standalone.js");
			if (!serveFile(res, bundle, 0)) writeJson(res, 404, { code: "standalone_bundle_missing" });
		} })
	);

	// Cubism Core runtime (bundled with the plugin).
	const corePath = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/cubism4/live2dcubismcore.min.js");
	disposers.push(
		webServer.register({ kind: "exact", path: CORE_SCRIPT_PATH, handler: (_req, res) => {
			if (!serveFile(res, corePath, 86_400)) writeJson(res, 404, { code: "core_missing" });
		} })
	);

	// Client diagnostics / error logger: records browser-side crashes,
	// WebGL context lost, unhandled rejections, and ErrorBoundary events to host logs.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/client-log", handler: async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405, { allow: "POST" });
				res.end();
				return;
			}
			try {
				const body = await readJsonBody(req, 32 * 1024);
				const level = String(body.level || "info").toLowerCase();
				const msg = String(body.message || "(empty message)");
				const details = body.details ? ` | ${typeof body.details === "object" ? JSON.stringify(body.details) : String(body.details)}` : "";
				const sid = body.sessionId ? ` [sid:${String(body.sessionId).slice(0, 8)}]` : "";
				const logLine = `[dsh-live2d-voice:client]${sid} ${msg}${details}`;
				if (level === "error") {
					ctx.logger.error(logLine);
				} else if (level === "warn") {
					ctx.logger.warn(logLine);
				} else {
					ctx.logger.info(logLine);
				}
				writeJson(res, 200, { ok: true });
			} catch (error) {
				writeJson(res, 400, { ok: false, error: String((error as Error)?.message ?? error) });
			}
		} })
	);

	// Load Cubism Core on every index.html render (pixi-live2d-display needs
	// window.Live2DCubismCore before the first model loads).
	disposers.push(
		ctx.on("webserver/index-inject", (table) => {
			table.push({ kind: "script-src", placement: "head", src: CORE_SCRIPT_PATH });
		})
	);

	// Enter-live activation: inject a minimal "enter live mode" system-style
	// user message (which leaves the session's blank state) and immediately
	// cancel the turn so the model never generates content. The Live2D
	// speech-format system prompt is injected separately by system-prompt.ts
	// once the view's SSE stream is up — no reply audio is produced here.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/enter-live", handler: (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void readJsonBody(req)
				.then(async (body) => {
					const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
					if (!sessionId) {
						writeJson(res, 400, { code: "session_required", message: "sessionId is required" });
						return;
					}
					let agent = ctx.agents.get(sessionId as SessionId);
					if (agent === undefined) {
						const sc = (ctx as unknown as {
							sessionController: { resolveAgent(id: SessionId): Promise<{ agent?: unknown; error?: { message?: string } }> };
						}).sessionController;
						const found = await sc.resolveAgent(sessionId as SessionId);
						if (found !== undefined && "agent" in found && found.agent !== undefined) {
							agent = found.agent as NonNullable<typeof agent>;
						} else {
							const detail = found !== undefined && "error" in found ? String(found.error?.message ?? "session not found") : "session not found";
							writeJson(res, 404, { code: "session_not_found", message: detail });
							return;
						}
					}
					// 1) A system-style activation message — makes the session
					// non-blank so DSH renders views for it.
					const message = createUserMessage({
						content: [{ type: "text", text: "Enter live mode." }],
						source: { kind: "user" },
					});
					agent.followup(message);
					// 2) Immediately cancel so no assistant content is generated.
					const sc = (ctx as unknown as {
						sessionController: { cancel(request: { sessionId: SessionId }): unknown };
					}).sessionController;
					const requestCancel = () => {
						try {
							sc.cancel({ sessionId: sessionId as SessionId });
						} catch {
							// best effort
						}
					};
					requestCancel();
					globalThis.setTimeout(requestCancel, 120);
					writeJson(res, 200, { ok: true });
				})
				.catch((error: unknown) => {
					writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
				});
		} })
	);

	// Model catalog: the full provider-grouped list of available models plus
	// the deployment default selection.  Served to the Live view's model
	// selector.  Uses the session controller's modelCatalog() method.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/model-catalog", handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void (async () => {
				try {
					const sc = (ctx as unknown as { sessionController: { modelCatalog(): Promise<unknown> } }).sessionController;
					const catalog = await sc.modelCatalog();
					writeJson(res, 200, catalog);
				} catch (error) {
					writeJson(res, 500, { code: "catalog_error", message: error instanceof Error ? error.message : String(error) });
				}
			})();
		} })
	);

	// Current model selection for one session: reads the agent's last request
	// header (provider/model/reasoningEffort), falling back to the catalog
	// default when no request has been made yet (blank session).
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/model-selection", handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void (async () => {
				const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
				if (!sessionId) {
					writeJson(res, 400, { code: "session_required", message: "query parameter `session` is required" });
					return;
				}
				try {
					const sc = (ctx as unknown as {
						sessionController: {
							resolveAgent(id: SessionId): Promise<{ agent?: unknown; error?: { message?: string } }>;
							modelCatalog(): Promise<{ default: { provider: string; model: string; reasoningEffort?: string } }>;
						};
					}).sessionController;
					const found = await sc.resolveAgent(sessionId as SessionId);
					const agent = found?.agent as
						| { session?: { requestHeader?: () => { config?: { provider: string; model: string; reasoningEffort?: string } } | undefined } }
						| undefined;
					const header = agent?.session?.requestHeader?.();
					if (header?.config) {
						writeJson(res, 200, {
							provider: header.config.provider,
							model: header.config.model,
							...header.config.reasoningEffort === undefined ? {} : { reasoningEffort: header.config.reasoningEffort },
						});
						return;
					}
					// No request header yet — fall back to the catalog default.
					const catalog = await sc.modelCatalog();
					writeJson(res, 200, catalog.default);
				} catch (error) {
					writeJson(res, 500, { code: "selection_error", message: error instanceof Error ? error.message : String(error) });
				}
			})();
		} })
	);

	// Select a model for one session: delegates to the session controller's
	// selectModel() which validates and installs the selection.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/select-model", handler: (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void readJsonBody(req)
				.then(async (body) => {
					const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
					const provider = typeof body.provider === "string" ? body.provider : "";
					const model = typeof body.model === "string" ? body.model : "";
					const reasoningEffort = typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined;
					if (!sessionId || !provider || !model) {
						writeJson(res, 400, { code: "bad_request", message: "sessionId, provider, and model are required" });
						return;
					}
					const sc = (ctx as unknown as {
						sessionController: {
							selectModel(request: { sessionId: SessionId; provider: string; model: string; reasoningEffort?: string }): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }>;
						};
					}).sessionController;
					const result = await sc.selectModel({ sessionId: sessionId as SessionId, provider, model, reasoningEffort });
					writeJson(res, 200, result);
				})
				.catch((error: unknown) => {
					writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
				});
		} })
	);

	return () => {
		for (const dispose of disposers) dispose();
	};
}
