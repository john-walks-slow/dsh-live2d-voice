// src/config.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var VOICE_PRESETS = [
  { id: "rem", label: "Rem \xB7 \u6E29\u67D4\u5973\u4EC6", voiceId: "0c7771ca5910484e8a4933068017fcee" },
  { id: "maid", label: "\u5143\u6C14\u5973\u4EC6", voiceId: "abf4fa2e25634b41aadc4e0ef9ddaea5" },
  { id: "frieren", label: "\u8299\u8389\u83B2 \xB7 \u77E5\u6027", voiceId: "c174516c799a42e7be88b96c86cfbd3e" },
  { id: "furina", label: "\u8299\u5B81\u5A1C \xB7 \u5A07\u4FCF", voiceId: "3fd70bbcdb6342df8c0c4143b958944b" },
  { id: "cute", label: "Cute Girl \xB7 \u751C\u7F8E", voiceId: "0c54c26032024142bf6339dc4d4aca1b" }
];
var DEFAULT_EMOTION_MAP = {
  neutral: 0,
  joy: 1,
  sappiness: 1,
  sadness: 2,
  anger: 3,
  surprise: 4,
  fear: 5,
  disgust: 6,
  shy: 7
};
var DEFAULT_CONFIG = {
  modelPath: "",
  voiceId: VOICE_PRESETS[0].voiceId,
  ttsModel: "s2.1-pro-free",
  apiKeys: [],
  apiKeyFile: "",
  sttLanguage: "zh",
  speechPrompt: "",
  emotionMap: { ...DEFAULT_EMOTION_MAP },
  workspaces: {}
};
function configFilePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "live2d-voice.json");
}
function loadConfig() {
  try {
    if (!existsSync(configFilePath())) return structuredClone(DEFAULT_CONFIG);
    const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
    return {
      ...structuredClone(DEFAULT_CONFIG),
      ...raw,
      emotionMap: { ...DEFAULT_EMOTION_MAP, ...raw.emotionMap ?? {} },
      workspaces: raw.workspaces ?? {},
      apiKeys: Array.isArray(raw.apiKeys) ? raw.apiKeys.filter((k) => typeof k === "string" && k) : []
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}
function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  const dir = join(configFilePath(), "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configFilePath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}
function resolveApiKeys(config) {
  if (config.apiKeys.length > 0) return [...config.apiKeys];
  if (config.apiKeyFile) {
    try {
      if (!existsSync(config.apiKeyFile)) return [];
      const text = readFileSync(config.apiKeyFile, "utf-8").trim();
      if (text.startsWith("[")) {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string" && k) : [];
      }
      return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

// src/events.ts
var HEARTBEAT_MS = 15e3;
var SseHub = class {
  connections = /* @__PURE__ */ new Map();
  lastCloseListeners = /* @__PURE__ */ new Set();
  /**
   * Register a callback fired when a session's LAST connection closes —
   * the Live view is gone, so in-flight work for it should be aborted.
   */
  onLastClose(listener) {
    this.lastCloseListeners.add(listener);
    return () => this.lastCloseListeners.delete(listener);
  }
  /** Whether at least one Live view listens on this session (speech gate). */
  has(sessionId) {
    return this.connections.get(sessionId)?.size !== void 0 && (this.connections.get(sessionId)?.size ?? 0) > 0;
  }
  attach(sessionId, req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    let closed = false;
    const connection = {
      sessionId,
      send: (event, data) => {
        if (closed || res.writableEnded) return;
        res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
      },
      close: () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        const set2 = this.connections.get(sessionId);
        if (set2) {
          set2.delete(connection);
          if (set2.size === 0) {
            this.connections.delete(sessionId);
            for (const listener of this.lastCloseListeners) listener(sessionId);
          }
        }
        try {
          res.end();
        } catch {
        }
      }
    };
    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded) return;
      res.write(": keepalive\n\n");
    }, HEARTBEAT_MS);
    req.on("close", () => connection.close());
    res.on("close", () => connection.close());
    let set = this.connections.get(sessionId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.connections.set(sessionId, set);
    }
    set.add(connection);
    res.write(": connected\n\n");
    connection.send("hello", { sessionId });
    return connection;
  }
  emit(sessionId, event, data) {
    const set = this.connections.get(sessionId);
    if (!set) return;
    for (const connection of set) connection.send(event, data);
  }
};

// src/speech.ts
import { randomUUID } from "node:crypto";

// src/sentence.ts
var TERMINATOR = /[。！？!?…\n]/;
var PAUSES = ["\uFF0C", ",", "\u3001", "\uFF1B", ";", "\uFF1A", " ", ")", "\uFF09"];
function extractEmotionTags(text, vocabulary) {
  if (!text.includes("[")) return { clean: text, emotions: [] };
  const emotions = [];
  const clean = text.replace(/\[([a-zA-Z][a-zA-Z0-9_-]*)\]/g, (whole, tag) => {
    if (!vocabulary.has(tag)) return whole;
    emotions.push(tag);
    return "";
  });
  return { clean, emotions };
}
var SentenceBuffer = class {
  constructor(softLimit = 120) {
    this.softLimit = softLimit;
  }
  softLimit;
  buffer = "";
  push(text) {
    this.buffer += text;
    const out = [];
    for (; ; ) {
      const sentence = this.cutOne();
      if (sentence === void 0) break;
      if (sentence.trim()) out.push(sentence);
    }
    return out;
  }
  /** Drain whatever remains (no terminator needed). */
  flush() {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim() ? [rest] : [];
  }
  /** Remove and return the next complete sentence, or undefined if none yet. */
  cutOne() {
    const match = TERMINATOR.exec(this.buffer);
    if (match?.index !== void 0) {
      let end = match.index + 1;
      while (end < this.buffer.length && TERMINATOR.test(this.buffer[end])) end += 1;
      if (end < this.buffer.length && '\u300D\u300F\u201D"()\uFF09)'.includes(this.buffer[end])) end += 1;
      const sentence2 = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      return sentence2;
    }
    if (this.buffer.length < this.softLimit) return void 0;
    const half = Math.floor(this.softLimit / 2);
    let cutAt = -1;
    for (const pause of PAUSES) {
      const index = this.buffer.lastIndexOf(pause);
      if (index > Math.max(cutAt, half)) cutAt = index;
    }
    const take = cutAt > 0 ? cutAt + 1 : this.softLimit;
    const sentence = this.buffer.slice(0, take);
    this.buffer = this.buffer.slice(take);
    return sentence;
  }
};

// src/tts.ts
var FISH_TTS_URL = "https://api.fish.audio/v1/tts";
var PCM_SAMPLE_RATE = 44100;
var TtsError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
  status;
};
async function synthesize(options, onPcm) {
  if (options.apiKeys.length === 0) throw new TtsError("no Fish Audio API key configured", void 0);
  let lastError;
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
  throw lastError ?? new TtsError("TTS failed", void 0);
}
async function synthesizeWithKey(options, key, onPcm) {
  const response = await fetch(FISH_TTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      model: options.model
    },
    body: JSON.stringify({
      text: options.text,
      reference_id: options.voiceId,
      format: "pcm",
      latency: "balanced"
    }),
    signal: options.signal
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new TtsError(`Fish TTS HTTP ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }
  const reader = response.body.getReader();
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) await onPcm(Buffer.from(value));
  }
}

// src/speech.ts
function applySpeechTap(ctx, deps) {
  const active = /* @__PURE__ */ new Map();
  ctx.on("llm/stream", (options, next) => {
    const sessionId = options.sessionId === void 0 ? "" : String(options.sessionId);
    if (!sessionId || options.purpose !== void 0) return next();
    if (!deps.hub.has(sessionId)) {
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
  deps.hub.onLastClose((sessionId) => {
    active.get(sessionId)?.abort.abort();
  });
}
async function* speak(deps, active, sessionId, chunks) {
  const config = deps.getConfig();
  const apiKeys = deps.resolveKeys(config);
  active.get(sessionId)?.abort.abort();
  const controller = new AbortController();
  const utteranceId = randomUUID().slice(0, 8);
  active.set(sessionId, { utteranceId, abort: controller });
  const buffer = new SentenceBuffer();
  let seq = 0;
  let queue = Promise.resolve();
  const enqueue = (sentence) => {
    queue = queue.then(
      () => speakSentence(deps, sessionId, utteranceId, sentence, config, apiKeys, controller.signal, () => seq++)
    );
  };
  let settled = false;
  const settle = (reason) => {
    if (settled) return;
    settled = true;
    if (reason === "finish") deps.hub.emit(sessionId, "audio-end", { utteranceId });
    deps.hub.emit(sessionId, "speech-end", { utteranceId, reason });
    if (active.get(sessionId)?.utteranceId === utteranceId) active.delete(sessionId);
  };
  deps.hub.emit(sessionId, "speech-start", { utteranceId });
  deps.hub.emit(sessionId, "audio-start", { utteranceId, sampleRate: PCM_SAMPLE_RATE });
  if (apiKeys.length === 0) {
    deps.hub.emit(sessionId, "error", { message: "\u672A\u914D\u7F6E Fish Audio API key\uFF08live2d-voice.json \u2192 apiKeys \u6216 apiKeyFile\uFF09\uFF0C\u8BED\u97F3\u6717\u8BFB\u4E0D\u53EF\u7528" });
  }
  const drain = () => Promise.resolve(queue).then(() => settle(controller.signal.aborted ? "aborted" : "finish")).catch(() => settle("aborted"));
  try {
    for await (const chunk of chunks) {
      if (chunk.type === "text-delta" && chunk.text) {
        for (const sentence of buffer.push(chunk.text)) enqueue(sentence);
      }
      yield chunk;
    }
    for (const sentence of buffer.flush()) enqueue(sentence);
    void drain();
  } catch (error) {
    controller.abort();
    queue.catch(() => void 0);
    void drain();
    throw error;
  }
}
async function speakSentence(deps, sessionId, utteranceId, raw, config, apiKeys, signal, nextSeq) {
  const vocabulary = new Set(Object.keys(config.emotionMap));
  const { clean, emotions } = extractEmotionTags(raw, vocabulary);
  const emotion = emotions.at(-1);
  if (emotion !== void 0) {
    deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression: config.emotionMap[emotion] });
  }
  const text = clean.trim();
  if (!text) return;
  let subtitled = false;
  const emitSubtitle = () => {
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
    emitSubtitle();
  }
}

// src/system-prompt.ts
var SpeechModes = class {
  modes = /* @__PURE__ */ new Map();
  /** Resolve the mode for an assembly; updates state transitions. */
  transition(sessionId, isLive) {
    this.evictIfNeeded();
    if (isLive) {
      this.modes.set(sessionId, "live");
      return "live";
    }
    if (this.modes.get(sessionId) === "live") {
      this.modes.set(sessionId, "exited");
      return "exited";
    }
    return this.modes.get(sessionId);
  }
  isExited(sessionId) {
    return this.modes.get(sessionId) === "exited";
  }
  /** Drop the exit reminder (called after an unwatched turn completes). */
  clearExited(sessionId) {
    if (this.modes.get(sessionId) === "exited") this.modes.delete(sessionId);
  }
  /**
   * Bound the map: sessions deleted mid-live never return to clear their
   * entry, so past a soft cap drop every "exited" entry (they are
   * re-derivable) — live entries must survive as mode truth.
   */
  evictIfNeeded() {
    if (this.modes.size <= 256) return;
    for (const [sessionId, mode] of this.modes) {
      if (mode === "exited") this.modes.delete(sessionId);
    }
  }
};
function sessionKeyOf(agent) {
  if (!agent) return "";
  const session = agent.session;
  if (typeof session === "string") return session;
  if (session && typeof session === "object" && session.id !== void 0) return String(session.id);
  if (agent.id !== void 0) return String(agent.id);
  return "";
}
function liveSection(config) {
  const emotions = Object.keys(config.emotionMap);
  if (emotions.length === 0) return "";
  const lines = [
    "## Live2D \u8BED\u97F3\u6A21\u5F0F\uFF08\u5F53\u524D\u4F1A\u8BDD\uFF09",
    "\u4F60\u7684\u56DE\u590D\u6B63\u88AB\u5B9E\u65F6\u8F6C\u6210\u8BED\u97F3\u6717\u8BFB\u5E76\u9A71\u52A8\u4E00\u4E2A Live2D \u89D2\u8272\u8BF4\u8BDD\uFF0C\u8BF7\u9075\u5B88\uFF1A",
    "- \u7528\u53E3\u8BED\u5316\u3001\u81EA\u7136\u9002\u5408\u6717\u8BFB\u7684\u53E5\u5B50\uFF1B\u4E0D\u8981\u8F93\u51FA\u5217\u8868\u3001\u4EE3\u7801\u5757\u3001\u94FE\u63A5\u6216 Markdown \u7B26\u53F7\uFF1B\u4EE3\u7801\u4E0E\u547D\u4EE4\u6539\u7528\u7B80\u77ED\u53E3\u5934\u63CF\u8FF0\u3002",
    "- \u5728\u6BCF\u53E5\u6216\u6BCF\u4E2A\u8BED\u4E49\u6BB5\u7684\u5F00\u5934\u7528\u65B9\u62EC\u53F7\u60C5\u7EEA\u6807\u7B7E\u6807\u6CE8\u60C5\u7EEA\uFF0C\u53EA\u80FD\u4ECE\u8FD9\u4E9B\u6807\u7B7E\u91CC\u9009\uFF1A",
    `  ${emotions.map((emotion) => `[${emotion}]`).join(" ")}`,
    "- \u6807\u7B7E\u53EA\u7528\u4E8E\u63A7\u5236\u89D2\u8272\u8868\u60C5\uFF0C\u4E0D\u4F1A\u88AB\u6717\u8BFB\uFF1B\u6CA1\u6709\u60C5\u7EEA\u53D8\u5316\u65F6\u7701\u7565\u6807\u7B7E\u5373\u53EF\u3002"
  ];
  const custom = config.speechPrompt.trim();
  if (custom) lines.push("", "\u7528\u6237\u9644\u52A0\u8981\u6C42\uFF1A", custom);
  return lines.join("\n");
}
var EXIT_SECTION = [
  "## \u5DF2\u9000\u51FA Live2D \u8BED\u97F3\u6A21\u5F0F",
  "\u7528\u6237\u5DF2\u5207\u56DE\u666E\u901A\u6587\u5B57\u5BF9\u8BDD\uFF1A\u6B63\u5E38\u4F7F\u7528 Markdown\u3001\u5217\u8868\u4E0E\u4EE3\u7801\u5757\uFF1B\u4E0D\u8981\u518D\u8F93\u51FA\u65B9\u62EC\u53F7 [\u60C5\u7EEA] \u6807\u7B7E\uFF0C\u4E5F\u4E0D\u8981\u518D\u9075\u5B88\u8BED\u97F3\u6717\u8BFB\u7684\u683C\u5F0F\u9650\u5236\u3002"
].join("\n");
function applySystemPrompt(ctx, deps) {
  const systemPrompt = ctx.get("systemPrompt", false);
  if (systemPrompt === void 0 || systemPrompt === null) {
    ctx.logger.info("dsh-live2d-voice: no systemPrompt service composed; speech-format section not installed.");
    return void 0;
  }
  return systemPrompt.section({
    name: "dsh-live2d-voice:speech-format",
    order: 9800,
    text: (context) => {
      const agent = context.agent;
      const sessionId = sessionKeyOf(agent);
      if (!sessionId) return "";
      const config = deps.getConfig();
      if (!config.modelPath) return "";
      const mode = deps.modes.transition(sessionId, deps.hub.has(sessionId));
      if (mode === "live") return liveSection(config);
      if (mode === "exited") return EXIT_SECTION;
      return "";
    }
  });
}

// src/routes.ts
import { readFileSync as readFileSync2, readdirSync, statSync } from "node:fs";
import { join as join2, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
var BODY_MAX_BYTES = 64 * 1024;
var MODELS_PREFIX = "/live2d-voice/models";
var CORE_SCRIPT_PATH = "/live2d-voice/core/live2dcubismcore.min.js";
function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_MAX_BYTES) throw new Error("body too large");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body must be a JSON object");
  return parsed;
}
function publicConfig(config, keyCount) {
  const { apiKeys: _apiKeys, ...rest } = config;
  return { ...rest, apiKeyCount: keyCount };
}
function mimeOf(path) {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
function serveFile(res, path, maxAgeSeconds) {
  let data;
  try {
    data = readFileSync2(path);
  } catch {
    return false;
  }
  res.writeHead(200, { "content-type": mimeOf(path), "cache-control": `public, max-age=${maxAgeSeconds}` });
  res.end(data);
  return true;
}
function findModelEntry(config) {
  if (!config.modelPath) return void 0;
  let files;
  try {
    files = readdirSync(config.modelPath).filter((file) => file.endsWith(".model3.json")).sort();
  } catch {
    return void 0;
  }
  const entry = files[0];
  if (entry === void 0) return void 0;
  return { url: `${MODELS_PREFIX}/${encodeURIComponent(entry)}`, name: entry.replace(/\.model3\.json$/, "") };
}
function installRoutes(ctx, deps) {
  const webServer = ctx.get("webServer", false);
  if (webServer === void 0 || webServer === null) {
    ctx.logger.info("dsh-live2d-voice: no webserver composed; web routes not installed.");
    return void 0;
  }
  const disposers = [];
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
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/config", handler: (req, res) => {
      if (req.method === "GET") {
        const config = deps.getConfig();
        writeJson(res, 200, { config: publicConfig(config, deps.resolveKeys(config).length), presets: VOICE_PRESETS });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then((body) => {
        const patch = {};
        for (const key of ["modelPath", "voiceId", "ttsModel", "apiKeyFile", "sttLanguage", "speechPrompt"]) {
          if (typeof body[key] === "string") patch[key] = body[key];
        }
        if (Array.isArray(body.apiKeys)) {
          patch.apiKeys = body.apiKeys.filter((key) => typeof key === "string" && key.length > 0);
        }
        if (typeof body.emotionMap === "object" && body.emotionMap !== null && !Array.isArray(body.emotionMap)) {
          const emotionMap = {};
          for (const [emotion, expression] of Object.entries(body.emotionMap)) {
            if (typeof expression === "number" || typeof expression === "string") emotionMap[emotion] = expression;
          }
          patch.emotionMap = emotionMap;
        }
        const saved = deps.saveConfig(patch);
        writeJson(res, 200, { config: publicConfig(saved, deps.resolveKeys(saved).length) });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_config", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/message", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then((body) => {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!sessionId || !text) {
          writeJson(res, 400, { code: "bad_message", message: "sessionId and text are required" });
          return;
        }
        const agent = ctx.agents.get(sessionId);
        if (agent === void 0) {
          writeJson(res, 404, { code: "session_not_found", message: `no live session ${sessionId}` });
          return;
        }
        const content = [{ type: "text", text }];
        agent.followup(createUserMessage({ content, source: { kind: "user" } }));
        deps.hub.emit(sessionId, "subtitle", { role: "user", text });
        writeJson(res, 200, { accepted: true });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_message", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/model", handler: (_req, res) => {
      const config = deps.getConfig();
      const entry = findModelEntry(config);
      if (entry === void 0) {
        writeJson(res, 200, { configured: Boolean(config.modelPath), url: void 0 });
        return;
      }
      writeJson(res, 200, { configured: true, url: entry.url, name: entry.name });
    } })
  );
  disposers.push(
    webServer.register({ kind: "prefix", path: MODELS_PREFIX, handler: (req, res) => {
      const config = deps.getConfig();
      if (!config.modelPath) {
        writeJson(res, 404, { code: "model_not_configured" });
        return;
      }
      const url = (req.url ?? "").split("?")[0];
      let relative;
      try {
        relative = decodeURIComponent(url.slice(MODELS_PREFIX.length));
      } catch {
        writeJson(res, 400, { code: "bad_path" });
        return;
      }
      const root = resolve(config.modelPath);
      const target = resolve(join2(root, relative));
      if (target !== root && !target.startsWith(root + sep)) {
        writeJson(res, 403, { code: "path_forbidden" });
        return;
      }
      let isFile;
      try {
        isFile = statSync(target).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile || !serveFile(res, target, 3600)) {
        writeJson(res, 404, { code: "not_found" });
      }
    } })
  );
  const corePath = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/cubism4/live2dcubismcore.min.js");
  disposers.push(
    webServer.register({ kind: "exact", path: CORE_SCRIPT_PATH, handler: (_req, res) => {
      if (!serveFile(res, corePath, 86400)) writeJson(res, 404, { code: "core_missing" });
    } })
  );
  disposers.push(
    ctx.on("webserver/index-inject", (table) => {
      table.push({ kind: "script-src", placement: "head", src: CORE_SCRIPT_PATH });
    })
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}

// src/index.ts
var name = "dsh-live2d-voice";
var inject = ["agents"];
function apply(ctx) {
  const hub = new SseHub();
  const modes = new SpeechModes();
  const getConfig = loadConfig;
  applySpeechTap(ctx, { hub, modes, getConfig, resolveKeys: resolveApiKeys });
  const disposePrompt = applySystemPrompt(ctx, { hub, modes, getConfig });
  const disposeRoutes = installRoutes(ctx, { hub, getConfig, resolveKeys: resolveApiKeys, saveConfig });
  ctx.logger.info("dsh-live2d-voice: loaded (config: " + loadConfig().voiceId.slice(0, 8) + "\u2026 voice)");
  return () => {
    disposeRoutes?.();
    disposePrompt?.();
  };
}
export {
  apply,
  inject,
  name
};
