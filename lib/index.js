// src/config.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var VOICE_PRESETS = [
  { id: "rem", label: "Rem \xB7 \u6E29\u67D4\u5973\u4EC6", voiceId: "0c7771ca5910484e8a4933068017fcee" },
  { id: "maid", label: "\u5143\u6C14\u5973\u4EC6", voiceId: "abf4fa2e25634b41aadc4e0ef9ddaea5" },
  { id: "frieren", label: "\u8299\u8389\u83B2 \xB7 \u77E5\u6027", voiceId: "c174516c799a42e7be88b96c86cfbd3e" },
  { id: "furina", label: "\u8299\u5B81\u5A1C \xB7 \u5A07\u4FCF", voiceId: "3fd70bbcdb6342df8c0c4143b958944b" },
  { id: "cute", label: "Cute Girl \xB7 \u751C\u7F8E", voiceId: "0c54c26032024142bf6339dc4d4aca1b" }
];
var LANGUAGE_OPTIONS = [
  { id: "auto", label: "\u81EA\u52A8" },
  { id: "ja", label: "\u65E5\u672C\u8A9E" },
  { id: "zh", label: "\u4E2D\u6587" },
  { id: "en", label: "English" }
];
function languageLabel(language) {
  const map = { zh: "\u7B80\u4F53\u4E2D\u6587", ja: "\u65E5\u8BED", en: "English", ko: "\uD55C\uAD6D\uC5B4" };
  return map[language] ?? language;
}
function speechLanguageInstruction(language) {
  const map = {
    ja: "\u65E0\u8BBA\u7528\u6237\u4F7F\u7528\u4EC0\u4E48\u8BED\u8A00\uFF0C\u4F60\u90FD\u59CB\u7EC8\u7528\u65E5\u8BED\u81EA\u7136\u4EA4\u6D41\uFF08\u7528\u6237\u4F1A\u770B\u5230\u5B57\u5E55\u7FFB\u8BD1\uFF09\u3002",
    zh: "\u65E0\u8BBA\u7528\u6237\u4F7F\u7528\u4EC0\u4E48\u8BED\u8A00\uFF0C\u4F60\u90FD\u59CB\u7EC8\u7528\u4E2D\u6587\u81EA\u7136\u4EA4\u6D41\u3002",
    en: "Whatever language the user speaks, always reply naturally in English."
  };
  return map[language] ?? "";
}
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
  modelSelection: "",
  voiceId: VOICE_PRESETS[0].voiceId,
  ttsModel: "s2.1-pro-free",
  apiKeys: [],
  apiKeyFile: "",
  sttLanguage: "auto",
  asrCredentialsFile: join(homedir(), ".config/volc-asr/credentials.json"),
  speechLanguage: "ja",
  subtitleLanguage: "zh",
  speechPrompt: "",
  eyeTracking: false,
  gyroParallax: false,
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
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      ...raw,
      emotionMap: { ...DEFAULT_EMOTION_MAP, ...raw.emotionMap ?? {} },
      workspaces: raw.workspaces ?? {},
      apiKeys: Array.isArray(raw.apiKeys) ? raw.apiKeys.filter((k) => typeof k === "string" && k) : []
    };
    if (raw.speechLanguage === void 0 && config.sttLanguage === "zh") {
      config.sttLanguage = "auto";
    }
    return config;
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
function resolveModelCatalog(config) {
  if (!config.modelPath) return [];
  const models = [];
  let rootEntries;
  try {
    rootEntries = readdirSync(config.modelPath);
  } catch {
    return [];
  }
  const direct = rootEntries.filter((file) => file.endsWith(".model3.json")).sort();
  if (direct.length > 0) {
    for (const entry of direct) {
      models.push({ name: entry.replace(/\.model3\.json$/, ""), relative: entry });
    }
    return models;
  }
  for (const dir of rootEntries.slice().sort((a, b) => a.localeCompare(b))) {
    try {
      const dirPath = join(config.modelPath, dir);
      if (!statSync(dirPath).isDirectory()) continue;
      const entry = readdirSync(dirPath).find((file) => file.endsWith(".model3.json"));
      if (entry) models.push({ name: dir, relative: `${dir}/${entry}` });
    } catch {
      continue;
    }
  }
  return models;
}
function resolveModelSelection(config, catalog) {
  if (catalog.length === 0) return void 0;
  return catalog.find((model) => model.name === config.modelSelection) ?? catalog[0];
}
function resolveSessionConfig(agents, config, sessionId) {
  if (!sessionId) return config;
  try {
    const agent = agents.get(sessionId);
    const cwd = agent?.session?.header?.cwd;
    if (!cwd) return config;
    const override = config.workspaces[cwd];
    if (!override) return config;
    return {
      ...config,
      ...override,
      emotionMap: { ...config.emotionMap, ...override.emotionMap ?? {} }
    };
  } catch {
    return config;
  }
}

// src/events.ts
var HEARTBEAT_MS = 15e3;
var SseHub = class {
  connections = /* @__PURE__ */ new Map();
  lastCloseListeners = /* @__PURE__ */ new Set();
  firstOpenListeners = /* @__PURE__ */ new Set();
  /**
   * Register a callback fired when a session's LAST connection closes —
   * the Live view is gone, so in-flight work for it should be aborted.
   */
  onLastClose(listener) {
    this.lastCloseListeners.add(listener);
    return () => this.lastCloseListeners.delete(listener);
  }
  /** Register a callback fired when a session's FIRST connection opens. */
  onFirstOpen(listener) {
    this.firstOpenListeners.add(listener);
    return () => this.firstOpenListeners.delete(listener);
  }
  /** Whether at least one Live view listens on this session (speech gate). */
  has(sessionId) {
    return (this.connections.get(sessionId)?.size ?? 0) > 0;
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
    const wasEmpty = set.size === 0;
    set.add(connection);
    if (wasEmpty) for (const listener of this.firstOpenListeners) listener(sessionId);
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
import { createUserMessage } from "@deepseek-ai/dsh-llm";

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
var TranslationQueue = class {
  tasks = [];
  running = false;
  push(task) {
    this.tasks.push(task);
    if (this.tasks.length > 2) this.tasks.shift();
    void this.drain();
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift();
        if (!task) continue;
        try {
          await task();
        } catch {
        }
      }
    } finally {
      this.running = false;
    }
  }
};
function applySpeechTap(ctx, deps) {
  const active = /* @__PURE__ */ new Map();
  const translations = /* @__PURE__ */ new Map();
  const translate = async (sessionId, model, lineId, text, targetLanguage, signal) => {
    if (signal.aborted || !deps.hub.has(sessionId)) return;
    let translated = "";
    try {
      const stream = ctx.llm.stream({
        provider: model.provider,
        model: model.model,
        messages: [createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })],
        system: `You translate speech subtitles. Translate the user's text into ${languageLabel(targetLanguage)}. Reply with ONLY the translation \u2014 no notes, no quotes, no original text. If the text is already in the target language, reply with it unchanged. Keep it natural and concise.`,
        signal
      });
      for await (const chunk of stream) {
        if (signal.aborted) return;
        if (chunk.type === "text-delta" && chunk.text) translated += chunk.text;
      }
    } catch {
      return;
    }
    translated = translated.trim();
    if (translated && translated !== text) {
      deps.hub.emit(sessionId, "subtitle-translation", { lineId, text: translated });
    }
  };
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
    return speak(deps, active, translations, translate, sessionId, { provider: options.provider, model: options.model }, next());
  });
  deps.hub.onLastClose((sessionId) => {
    active.get(sessionId)?.abort.abort();
    translations.delete(sessionId);
  });
}
async function* speak(deps, active, translations, translate, sessionId, model, chunks) {
  const config = deps.resolveSession(sessionId);
  const apiKeys = deps.resolveKeys(deps.getConfig());
  active.get(sessionId)?.abort.abort();
  const controller = new AbortController();
  const utteranceId = randomUUID().slice(0, 8);
  active.set(sessionId, { utteranceId, abort: controller });
  const buffer = new SentenceBuffer();
  let seq = 0;
  let lineSeq = 0;
  let queue = Promise.resolve();
  const enqueue = (sentence) => {
    const lineId = `${utteranceId}-${++lineSeq}`;
    queue = queue.then(
      () => speakSentence(deps, translations, translate, sessionId, model, utteranceId, lineId, sentence, config, apiKeys, controller.signal, () => seq++)
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
async function speakSentence(deps, translations, translate, sessionId, model, utteranceId, lineId, raw, config, apiKeys, signal, nextSeq) {
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
    deps.hub.emit(sessionId, "subtitle", { role: "assistant", text, utteranceId, lineId });
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
  const target = config.subtitleLanguage;
  if (target && target !== "off" && target !== config.speechLanguage && deps.hub.has(sessionId)) {
    let queue = translations.get(sessionId);
    if (queue === void 0) {
      queue = new TranslationQueue();
      translations.set(sessionId, queue);
    }
    queue.push(() => translate(sessionId, model, lineId, text, target, signal));
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
  const language = speechLanguageInstruction(config.speechLanguage);
  if (language) lines.push(`- ${language}`);
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
      const config = deps.resolveSession(sessionId);
      if (!config.modelPath) return "";
      const mode = deps.modes.transition(sessionId, deps.hub.has(sessionId));
      if (mode === "live") return liveSection(config);
      if (mode === "exited") return EXIT_SECTION;
      return "";
    }
  });
}

// src/routes.ts
import { readFileSync as readFileSync3, statSync as statSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, createWriteStream, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { join as join2, resolve, sep, dirname } from "node:path";
import { homedir as homedir3 } from "node:os";
import { fileURLToPath } from "node:url";
import { createUserMessage as createUserMessage2 } from "@deepseek-ai/dsh-llm";

// src/asr.ts
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID as randomUUID2 } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import WebSocket from "ws";
var ASR_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
var RESOURCE_ID = "volc.seedasr.sauc.duration";
var CHUNK_BYTES = 6400;
var VOLC_ERROR_HINTS = {
  45000081: "\u8BC6\u522B\u8D85\u65F6\uFF08\u97F3\u9891\u6D41\u4E2D\u65AD\u8FC7\u4E45\uFF09",
  45000002: "\u672A\u68C0\u6D4B\u5230\u6709\u6548\u8BED\u97F3",
  55000031: "\u8BC6\u522B\u670D\u52A1\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
  45000151: "\u97F3\u9891\u683C\u5F0F\u9519\u8BEF",
  45000001: "\u8BF7\u6C42\u53C2\u6570\u9519\u8BEF"
};
function asrLanguageCode(language) {
  const map = { zh: "zh-CN", ja: "ja-JP", en: "en-US" };
  return map[language] ?? void 0;
}
function loadVolcCredentials(filePath) {
  try {
    const expanded = filePath.startsWith("~/") ? `${homedir2()}${filePath.slice(1)}` : filePath;
    const raw = JSON.parse(readFileSync2(expanded, "utf-8"));
    const apikey = typeof raw.apikey === "string" ? raw.apikey.trim() : "";
    const appid = typeof raw.appid === "string" ? raw.appid.trim() : "";
    const accessToken = typeof raw.accessToken === "string" ? raw.accessToken.trim() : "";
    if (apikey || appid && accessToken) {
      return { apikey: apikey || void 0, appid, accessToken };
    }
    return void 0;
  } catch {
    return void 0;
  }
}
function frameHeader(messageType, flags) {
  const serial = messageType === 1 ? 16 : 0;
  return Buffer.from([17, messageType << 4 | flags, serial | 1, 0]);
}
function withSize(payload) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  return Buffer.concat([size, payload]);
}
function buildFullRequest(payload) {
  return Buffer.concat([frameHeader(1, 1), i32(1), withSize(gzipSync(Buffer.from(JSON.stringify(payload), "utf8")))]);
}
function buildAudio(seq, pcm, isLast) {
  return Buffer.concat([frameHeader(2, isLast ? 3 : 1), i32(isLast ? -seq : seq), withSize(gzipSync(pcm))]);
}
function i32(value) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value);
  return b;
}
function parseFrame(data) {
  const messageType = data[1] >> 4;
  const flags = data[1] & 15;
  const compression = data[2] & 15;
  let offset = (data[0] & 15) * 4;
  if (flags & 1) offset += 4;
  const isLast = (flags & 2) !== 0;
  if (flags & 4) offset += 4;
  if (messageType === 15) {
    const code = data.readInt32BE(offset);
    offset += 8;
    return { error: true, code, isLast, payload: decodePayload(data, offset, compression) };
  }
  if (messageType !== 9) {
    return { error: false, code: 0, isLast, payload: null };
  }
  offset += 4;
  return { error: false, code: 0, isLast, payload: decodePayload(data, offset, compression) };
}
function decodePayload(data, offset, compression) {
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
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
function describeError(frame) {
  const payload = frame.payload ?? {};
  const detail = payload.message ?? payload.error ?? "unknown error";
  const hint = VOLC_ERROR_HINTS[frame.code];
  return `volc asr error ${frame.code}: ${hint ? `${hint}\uFF08` : ""}${String(detail)}${hint ? "\uFF09" : ""}`;
}
function recognizeUtterance(credentials, pcm, language = "auto", timeoutMs = 2e4) {
  return new Promise((resolve2, reject) => {
    if (pcm.length === 0) {
      resolve2("");
      return;
    }
    const headers = {
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Request-Id": randomUUID2()
    };
    if (credentials.apikey) headers["X-Api-Key"] = credentials.apikey;
    else {
      headers["X-Api-App-Key"] = credentials.appid;
      headers["X-Api-Access-Key"] = credentials.accessToken;
    }
    let settled = false;
    let text = "";
    let ws;
    const dispose = () => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
        else ws.terminate();
      } catch {
      }
    };
    const settle = (win) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      dispose();
      win();
    };
    const fail = (message) => settle(() => reject(new Error(message)));
    const timer = setTimeout(() => fail(`volc asr: no result within ${timeoutMs}ms`), timeoutMs);
    ws = new WebSocket(ASR_URL, { headers, handshakeTimeout: 15e3 });
    ws.on("unexpected-response", (_request, response) => {
      let body = "";
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => fail(`volc asr: handshake HTTP ${response.statusCode} ${body.slice(0, 200)}`));
    });
    ws.on("error", (error) => fail(`volc asr: ${error.message}`));
    ws.on("close", () => {
      settle(() => text ? resolve2(text) : reject(new Error("volc asr: connection closed before a result")));
    });
    ws.on("message", (data) => {
      const frame = Array.isArray(data) ? Buffer.concat(data) : data;
      let parsed;
      try {
        parsed = parseFrame(frame);
      } catch {
        return;
      }
      if (parsed.error) {
        fail(describeError(parsed));
        return;
      }
      const result = parsed.payload?.result ?? void 0;
      if (result?.text) text = result.text;
      else if (result?.utterances) {
        const joined = result.utterances.map((u) => u.text).join("");
        if (joined) text = joined;
      }
      if (parsed.isLast) settle(() => resolve2(text));
    });
    ws.on("open", () => {
      const code = asrLanguageCode(language);
      const request = {
        user: { uid: "dsh-live2d-voice" },
        audio: {
          format: "pcm",
          codec: "raw",
          rate: 16e3,
          bits: 16,
          channel: 1,
          ...code ? { language: code } : {}
        },
        request: {
          model_name: "bigmodel",
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          show_utterances: true,
          result_type: "full",
          ...code ? {} : { enable_auto_lang: true }
        }
      };
      try {
        ws.send(buildFullRequest(request));
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

// src/routes.ts
var BODY_MAX_BYTES = 64 * 1024;
var PCM_MAX_BYTES = 2 * 1024 * 1024;
var PCM_MIN_BYTES = 3200;
var MODELS_PREFIX = "/live2d-voice/models";
var GAZE_PREFIX = "/live2d-voice/gaze";
var FACE_LANDMARKER_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
var FACE_LANDMARKER_MAX_BYTES = 16 * 1024 * 1024;
var CORE_SCRIPT_PATH = "/live2d-voice/core/live2dcubismcore.min.js";
function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req, maxBytes = BODY_MAX_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body too large");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body must be a JSON object");
  return parsed;
}
async function readRawBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function publicConfig(config, keyCount) {
  const { apiKeys: _apiKeys, ...rest } = config;
  const asrConfigured = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) !== void 0 : false;
  return { ...rest, apiKeyCount: keyCount, asrConfigured };
}
function mimeOf(path) {
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
function serveFile(res, path, maxAgeSeconds) {
  let data;
  try {
    data = readFileSync3(path);
  } catch {
    return false;
  }
  res.writeHead(200, { "content-type": mimeOf(path), "cache-control": `public, max-age=${maxAgeSeconds}` });
  res.end(data);
  return true;
}
function modelUrl(entry) {
  return `${MODELS_PREFIX}/${entry.relative.split("/").map(encodeURIComponent).join("/")}`;
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
    webServer.register({ kind: "exact", path: "/live2d-voice/asr/recognize", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void (async () => {
        const config = deps.getConfig();
        const credentials = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) : void 0;
        if (credentials === void 0) {
          writeJson(res, 500, { ok: false, error: "\u672A\u914D\u7F6E\u706B\u5C71 ASR \u51ED\u8BC1\uFF08live2d-voice.json \u2192 asrCredentialsFile\uFF0CJSON \u9700\u542B apikey \u6216 appid+accessToken\uFF09" });
          return;
        }
        const language = new URL(req.url ?? "/", "http://localhost").searchParams.get("lang")?.trim() || config.sttLanguage || "auto";
        let pcm;
        try {
          pcm = await readRawBody(req, PCM_MAX_BYTES);
        } catch (error) {
          writeJson(res, 413, { ok: false, error: error instanceof Error ? error.message : String(error) });
          return;
        }
        if (pcm.length < PCM_MIN_BYTES) {
          writeJson(res, 400, { ok: false, error: "\u97F3\u9891\u8FC7\u77ED\uFF08\u4E0D\u8DB3 100ms\uFF09" });
          return;
        }
        const text = await recognizeUtterance(credentials, pcm, language);
        writeJson(res, 200, { ok: true, text });
      })().catch((error) => {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/config", handler: (req, res) => {
      if (req.method === "GET") {
        const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
        const global = deps.getConfig();
        const config = sessionId ? resolveSessionConfig(ctx.agents, global, sessionId) : global;
        writeJson(res, 200, {
          config: publicConfig(config, deps.resolveKeys(global).length),
          presets: VOICE_PRESETS,
          languages: LANGUAGE_OPTIONS
        });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then((body) => {
        const patch = {};
        for (const key of ["modelPath", "modelSelection", "voiceId", "ttsModel", "apiKeyFile", "sttLanguage", "asrCredentialsFile", "speechLanguage", "subtitleLanguage", "speechPrompt"]) {
          if (typeof body[key] === "string") patch[key] = body[key];
        }
        if (typeof body.eyeTracking === "boolean") patch.eyeTracking = body.eyeTracking;
        if (typeof body.gyroParallax === "boolean") patch.gyroParallax = body.gyroParallax;
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
      void readJsonBody(req).then(async (body) => {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const mode = body.mode === "steer" ? "steer" : "queue";
        if (!sessionId || !text) {
          writeJson(res, 400, { code: "bad_message", message: "sessionId and text are required" });
          return;
        }
        let agent = ctx.agents.get(sessionId);
        if (agent === void 0) {
          const found = await ctx.sessionController.resolveAgent(sessionId);
          if (found !== void 0 && "agent" in found && found.agent !== void 0) {
            agent = found.agent;
          } else {
            const detail = found !== void 0 && "error" in found ? String(found.error?.message ?? "session not found") : "session not found";
            writeJson(res, 404, { code: "session_not_found", message: detail });
            return;
          }
        }
        const content = [{ type: "text", text }];
        const message = createUserMessage2({ content, source: { kind: "user" } });
        if (mode === "steer") agent.steer(message);
        else agent.followup(message);
        deps.hub.emit(sessionId, "subtitle", { role: "user", text });
        writeJson(res, 200, { accepted: true });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_message", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/camera-result", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req, 9 * 1024 * 1024).then((body) => {
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
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/model", handler: (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
      const config = sessionId ? resolveSessionConfig(ctx.agents, deps.getConfig(), sessionId) : deps.getConfig();
      const catalog = resolveModelCatalog(config);
      const entry = resolveModelSelection(config, catalog);
      if (entry === void 0) {
        writeJson(res, 200, { configured: Boolean(config.modelPath), url: void 0 });
        return;
      }
      writeJson(res, 200, {
        configured: true,
        url: modelUrl(entry),
        name: entry.name,
        current: entry.name,
        models: catalog.map((model) => ({ name: model.name, url: modelUrl(model) }))
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "prefix", path: MODELS_PREFIX, handler: (req, res) => {
      const config = deps.getConfig();
      const roots = [];
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
      let relative;
      try {
        relative = decodeURIComponent(url.slice(MODELS_PREFIX.length));
      } catch {
        writeJson(res, 400, { code: "bad_path" });
        return;
      }
      for (const root of roots) {
        const target = resolve(join2(root, relative));
        if (target !== root && !target.startsWith(root + sep)) continue;
        let isFile;
        try {
          isFile = statSync2(target).isFile();
        } catch {
          isFile = false;
        }
        if (isFile && serveFile(res, target, 3600)) return;
      }
      writeJson(res, 404, { code: "not_found" });
    } })
  );
  const mediapipeDir = (() => {
    try {
      const require2 = createRequire(import.meta.url);
      let dir = dirname(require2.resolve("@mediapipe/tasks-vision"));
      for (let i = 0; i < 4; i++) {
        if (existsSync2(join2(dir, "wasm")) && existsSync2(join2(dir, "vision_bundle.mjs"))) return dir;
        dir = dirname(dir);
      }
      return "";
    } catch {
      return "";
    }
  })();
  const gazeModelCache = (() => {
    const dir = join2(process.env.DSH_HOME ?? resolve(homedir3(), ".dsh"), "live2d-voice-cache");
    try {
      if (!existsSync2(dir)) mkdirSync2(dir, { recursive: true });
      return join2(dir, "face_landmarker.task");
    } catch {
      return "";
    }
  })();
  let gazeModelPromise = null;
  const ensureGazeModel = () => {
    if (gazeModelCache && existsSync2(gazeModelCache)) return Promise.resolve(gazeModelCache);
    gazeModelPromise ??= (async () => {
      if (!gazeModelCache) throw new Error("cache dir unavailable");
      const response = await fetch(FACE_LANDMARKER_URL);
      if (!response.ok || !response.body) throw new Error(`model download failed: HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") ?? "0");
      if (length > FACE_LANDMARKER_MAX_BYTES) throw new Error("model download too large");
      const temp = `${gazeModelCache}.tmp`;
      await pipeline(response.body, createWriteStream(temp));
      const stat = statSync2(temp);
      if (stat.size > FACE_LANDMARKER_MAX_BYTES || stat.size < 1024) throw new Error("model download corrupt");
      writeFileSync2(gazeModelCache, readFileSync3(temp));
      rmSync(temp, { force: true });
      return gazeModelCache;
    })().catch((error) => {
      gazeModelPromise = null;
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
      let relative;
      try {
        relative = decodeURIComponent(url.slice(GAZE_PREFIX.length)).replace(/^\/+/, "");
      } catch {
        writeJson(res, 400, { code: "bad_path" });
        return;
      }
      void (async () => {
        if (relative === "model") {
          const file = await ensureGazeModel();
          if (!serveFile(res, file, 86400)) writeJson(res, 502, { code: "model_unavailable" });
          return;
        }
        if (!mediapipeDir) {
          writeJson(res, 404, { code: "mediapipe_missing" });
          return;
        }
        if (relative === "vision.mjs") {
          if (!serveFile(res, join2(mediapipeDir, "vision_bundle.mjs"), 0)) writeJson(res, 404, { code: "not_found" });
          return;
        }
        if (relative.startsWith("wasm/")) {
          const root = resolve(join2(mediapipeDir, "wasm"));
          const target = resolve(join2(root, relative.slice(5)));
          if (target !== root && !target.startsWith(root + sep)) {
            writeJson(res, 403, { code: "path_forbidden" });
            return;
          }
          if (!serveFile(res, target, 86400)) writeJson(res, 404, { code: "not_found" });
          return;
        }
        writeJson(res, 404, { code: "not_found" });
      })().catch((error) => {
        writeJson(res, 502, { code: "gaze_asset_error", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
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

// src/camera-tool.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
var CAPTURE_TIMEOUT_MS = 25e3;
var CameraBridge = class {
  constructor(hub) {
    this.hub = hub;
  }
  hub;
  pending = /* @__PURE__ */ new Map();
  /** Ask the session's Live view for a camera frame. Resolves null on timeout. */
  request(sessionId) {
    return new Promise((resolve2) => {
      const requestId = randomUUID3().slice(0, 12);
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve2(null);
      }, CAPTURE_TIMEOUT_MS);
      this.pending.set(requestId, { resolve: resolve2, timer });
      this.hub.emit(sessionId, "camera-capture", { requestId });
    });
  }
  /** The browser delivered (or failed) — called by the result route. */
  deliver(requestId, shot) {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(shot);
    return true;
  }
};
function applyCameraTool(ctx, hub, bridge) {
  const registered = /* @__PURE__ */ new WeakSet();
  const registerOne = (agent) => {
    if (registered.has(agent)) return;
    registered.add(agent);
    agent.ctx.effect(
      () => agent.ctx.tools.register(
        defineTool({
          name: "look_at_user",
          description: "Take one photo from the front camera of the device where the user is watching you (the Live2D voice view), so you can actually see the user and their surroundings. Use it when the user asks you to look at them or at something near them\uFF08\u4F8B\u5982\u7528\u6237\u8BF4\u300C\u770B\u770B\u6211\u300D\u300C\u4F60\u770B\u6211\u8FD9\u8FB9\u300D\uFF09. The photo is taken only with the browser's explicit camera permission on the user's own device. Only available while the user has the Live2D view open; if it errors, tell the user you cannot see them right now.",
          parameters: {},
          output: {
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                ok: { type: "boolean", required: true },
                error: { type: "string" },
                /** Opaque image attachment reference (on success). */
                ref: { type: "object", additionalProperties: true }
              }
            },
            render: (_args, value) => {
              if (!value.ok || !value.ref) {
                return [{ type: "text", text: `(\u62CD\u7167\u5931\u8D25\uFF1A${value.error ?? "\u672A\u77E5\u9519\u8BEF"})` }];
              }
              return [
                { type: "image", attachment: value.ref },
                { type: "text", text: "(\u4E00\u5F20\u521A\u4ECE\u524D\u7F6E\u6444\u50CF\u5934\u62CD\u6444\u7684\u7167\u7247)" }
              ];
            }
          },
          async execute(_args, exec) {
            const sessionId = String(exec.agent?.id ?? "");
            if (!sessionId || !hub.has(sessionId)) {
              return { ok: false, error: "Live2D \u89C6\u56FE\u672A\u6253\u5F00\u2014\u2014\u7528\u6237\u73B0\u5728\u770B\u4E0D\u5230\u4F60\uFF0C\u4E5F\u65E0\u6CD5\u62CD\u7167" };
            }
            const shot = await bridge.request(sessionId);
            if (!shot) return { ok: false, error: "\u6444\u50CF\u5934\u4E0D\u53EF\u7528\u6216\u8D85\u65F6\u672A\u54CD\u5E94" };
            const base64 = shot.dataUrl.includes(",") ? shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1) : shot.dataUrl;
            const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
            const ref = await ctx.attachments.saveImage({
              data: bytes,
              mediaType: "image/jpeg",
              name: "camera.jpg"
            });
            return { ok: true, ref };
          }
        })
      )
    );
  };
  const offCreated = ctx.on("agent/created", (payload) => {
    const a = payload.agent;
    if (!a?.ctx || a.id === void 0) return;
    if (!hub.has(String(a.id))) return;
    registerOne(a);
  });
  const offFirstOpen = hub.onFirstOpen((sessionId) => {
    const agent = ctx.agents.get(sessionId);
    if (agent?.ctx) registerOne(agent);
  });
  return () => {
    offCreated();
    offFirstOpen();
  };
}

// src/index.ts
var name = "dsh-live2d-voice";
var inject = ["agents", "llm", "attachments", "sessionController"];
function apply(ctx) {
  const hub = new SseHub();
  const modes = new SpeechModes();
  const getConfig = loadConfig;
  applySpeechTap(ctx, {
    hub,
    modes,
    getConfig,
    resolveKeys: resolveApiKeys,
    resolveSession: (sessionId) => resolveSessionConfig(ctx.agents, getConfig(), sessionId)
  });
  const disposePrompt = applySystemPrompt(ctx, {
    hub,
    modes,
    getConfig,
    resolveSession: (sessionId) => resolveSessionConfig(ctx.agents, getConfig(), sessionId)
  });
  const cameraBridge = new CameraBridge(hub);
  const disposeCameraTool = applyCameraTool(ctx, hub, cameraBridge);
  const disposeRoutes = installRoutes(ctx, { hub, getConfig, resolveKeys: resolveApiKeys, saveConfig, cameraBridge });
  ctx.logger.info("dsh-live2d-voice: loaded (config: " + loadConfig().voiceId.slice(0, 8) + "\u2026 voice)");
  return () => {
    disposeRoutes?.();
    disposeCameraTool();
    disposePrompt?.();
  };
}
export {
  apply,
  inject,
  name
};
