/**
 * Plugin configuration: load/save + resolution helpers.
 *
 * Storage: <DSH_HOME>/live2d-voice.json. Two layers: global defaults plus
 * optional per-workspace overrides keyed by the session's workspace path
 * (see resolveSessionConfig). Override layers may set voiceId / modelPath /
 * modelSelection / speechLanguage / sttLanguage / subtitleLanguage /
 * speechPrompt / emotionMap; credential fields stay global.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Recommended Fish Audio voice presets (same table as the fish-audio skill). */
export const VOICE_PRESETS = [
	{ id: "rem", label: "温柔女仆 · 雷姆", voiceId: "0c7771ca5910484e8a4933068017fcee" },
	{ id: "maid", label: "元气女仆", voiceId: "abf4fa2e25634b41aadc4e0ef9ddaea5" },
	{ id: "frieren", label: "知性女声 · 芙莉莲", voiceId: "c174516c799a42e7be88b96c86cfbd3e" },
	{ id: "furina", label: "娇俏女声 · 芙宁娜", voiceId: "3fd70bbcdb6342df8c0c4143b958944b" },
	{ id: "cute", label: "甜美少女音", voiceId: "0c54c26032024142bf6339dc4d4aca1b" },
	// ── 2026-09-24 第二批：Fish Audio 公共音色库实测收录（20 个，均合成验证通过）──
	// 动漫角色 / 二次元声线
	{ id: "anime-girl", label: "标准动漫少女音", voiceId: "73647cd4ff7c477cb787d5fd8068f3e8" },
	{ id: "ram", label: "傲娇女声 · 拉姆", voiceId: "deb7b4e20b7048b19f96b646bfaa4549" },
	{ id: "teio", label: "元气少女 · 东海帝王", voiceId: "44b6e5eeab214296bcfd73e767225229" },
	{ id: "alya", label: "清冷美少女 · 艾莉雅", voiceId: "15b8bae03d344eafaa53f174fb13cf32" },
	{ id: "teto", label: "电音歌姬 · 重音 Teto", voiceId: "852c5b1d1cd24657bf2865152e67bb3e" },
	{ id: "misuzu", label: "治愈女声 · 神尾观铃", voiceId: "20967b3d497045b78e992924f2f05488" },
	{ id: "fubuki", label: "狐耳娘 · 白上吹雪", voiceId: "5e6675f7a3984e30b2413f81deb677f6" },
	{ id: "hatsuki", label: "软萌幼女 · 岛田叶月", voiceId: "e9377327f5fb4690842604f8455048f5" },
	{ id: "rino", label: "机械妹音 · 机器人里诺", voiceId: "91e378d7b6574841ad5c4f915afdc8b9" },
	// 通用声线类型
	{ id: "genki-woman", label: "元气女声（通用）", voiceId: "5161d41404314212af1254556477c17d" },
	{ id: "calm-woman", label: "沉稳女声（通用）", voiceId: "0089dce5fefb4c6ba9b9f2f0debe1ddc" },
	{ id: "narration-woman", label: "知性旁白女声", voiceId: "825c9e9870494118ad93b6853a22d5e7" },
	{ id: "genki-maid", label: "萌系女仆音", voiceId: "6c777b9c8eee4cd7862e1b073f6c42ec" },
	{ id: "tsundere-girl", label: "傲娇少女音（通用）", voiceId: "4c415bf6872a4700adbda9a2d8b02fbb" },
	{ id: "genki-boy", label: "元气少年音", voiceId: "ed3a1c523b524870a85a5a76cb1e0c3d" },
	// 中文音色
	{ id: "paimon", label: "小飞毯 · 派蒙（原神）", voiceId: "efc1ce3726a64bbc947d53a1465204aa" },
	{ id: "klee", label: "萝莉音 · 可莉（原神）", voiceId: "0b8449eb752c4f888f463fc5d2c0db65" },
	{ id: "loli-zh", label: "萝莉音（中文通用）", voiceId: "f82e3885ac22468eb6c773b96f2c5752" },
	// 英语 / VTuber
	{ id: "filian", label: "英语 VTuber · Filian", voiceId: "39d029582e9743e29f7c9e31fc3149e7" },
	{ id: "neuro-sama", label: "AI 声 · Neuro-sama", voiceId: "b2b2d0fa88ee44d789da28ebbd97421e" },
] as const;

export interface PluginConfig {
	/**
	 * Absolute path of a directory that contains a .model3.json (Cubism 4),
	 * or a directory of model subdirectories (one .model3.json each — the
	 * ⚙ panel then offers a model picker).
	 */
	modelPath: string;
	/** The model selected from the catalog (name = entry / subdir name). */
	modelSelection: string;
	/** Fish Audio reference voice id. */
	voiceId: string;
	/** Fish Audio model name. */
	ttsModel: string;
	/**
	 * Fish Audio API keys (rotated on 401/402/429). Either inline here or via
	 * apiKeyFile (one key per line, or a JSON array).
	 */
	apiKeys: string[];
	/** Optional file that holds API keys (checked first when apiKeys is empty). */
	apiKeyFile: string;
	/**
	 * Voice-input recognition language: "auto" lets the recognizer detect,
	 * or an explicit BCP-47-ish hint ("zh", "ja", "en", …). Only honored by
	 * the nostream (buffered) mode — the streaming endpoint auto-detects
	 * Chinese/English and dialects and cannot lock a language.
	 */
	sttLanguage: string;
	/**
	 * ASR transport: "stream" (default) relays audio live to the optimized
	 * bidirectional endpoint (real-time subtitles, ~0.7s tail latency, no
	 * Japanese); "nostream" keeps the old buffered one-shot per utterance
	 * (full 25-language auto-detect incl. ja-JP, ~1.3s recognition).
	 */
	asrMode: string;
	/**
	 * Microphone soft-gain applied in the capture AudioWorklet before the
	 * VAD/ASR path (1.0 = passthrough; >1 amplifies, with soft limiting).
	 * Raises quiet mics so VAD opens reliably and ASR sees fuller speech.
	 */
	micGain: number;
	/**
	 * Volcengine ASR credentials file (JSON: appid/accessToken/apikey) for
	 * the streaming speech-to-text relay.
	 */
	asrCredentialsFile: string;
	/**
	 * The character's speaking language ("ja" default; "auto" follows the
	 * user). Drives the live-mode instruction "always reply in <language>".
	 */
	speechLanguage: string;
	/**
	 * Subtitle translation target language ("zh" default; "off" disables).
	 * When active, subtitles show original + translated line (Phase 3).
	 */
	subtitleLanguage: string;
	/**
	 * User-authored extra instructions appended to the Live2D speech-format
	 * system-prompt section (e.g. "总是用日语自然交流"). Live-mode only — the
	 * exit reminder tells the model these constraints are gone in chat mode.
	 */
	speechPrompt: string;
	/**
	 * Experimental: front-camera gaze tracking (MediaPipe FaceLandmarker) —
	 * the character looks at the user's face. Off by default; the runtime
	 * downloads lazily on first enable through the plugin's own routes.
	 */
	eyeTracking: boolean;
	/**
	 * Experimental: gyroscope parallax — phone tilt drives head/body angles
	 * and a position offset (the "character behind the screen glass"
	 * illusion). Calibrates the neutral pose on enable.
	 */
	gyroParallax: boolean;
	/** Emotion tag → model expression name/index map. */
	emotionMap: Record<string, number | string>;
	/**
	 * When set, entering the Live2D view automatically switches the session
	 * to this model; exiting restores the previous selection.  Null/undefined
	 * means no auto-switch.
	 */
	liveModel?: { provider: string; model: string; reasoningEffort?: string } | null;

	/** Per-workspace overrides keyed by the workspace root path (cwd). */
	workspaces: Record<string, Partial<PluginConfig>>;
}

/** Display labels for the language pickers (client + prompt share these). */
export const LANGUAGE_OPTIONS = [
	{ id: "auto", label: "自动" },
	{ id: "ja", label: "日本語" },
	{ id: "zh", label: "中文" },
	{ id: "en", label: "English" },
] as const;

/** Human-readable language name (translation target phrasing). */
export function languageLabel(language: string): string {
	const map: Record<string, string> = { zh: "简体中文", ja: "日语", en: "English", ko: "한국어" };
	return map[language] ?? language;
}

/**
 * Resolve the instruction line for the character's speaking language.
 * The Japanese line only promises "（用户会看到字幕翻译）" when subtitle
 * translation is actually active (target set, distinct from the character's
 * language) — with translation off that promise would be a lie.
 */
export function speechLanguageInstruction(language: string, subtitleLanguage = "zh"): string {
	const subtitleOn = subtitleLanguage !== "off" && subtitleLanguage !== language;
	if (language === "ja") {
		return subtitleOn
			? "无论用户使用什么语言，你都始终用日语自然交流（用户会看到字幕翻译）。"
			: "无论用户使用什么语言，你都始终用日语自然交流。";
	}
	const map: Record<string, string> = {
		zh: "无论用户使用什么语言，你都始终用中文自然交流。",
		en: "Whatever language the user speaks, always reply naturally in English.",
	};
	return map[language] ?? "";
}

const DEFAULT_EMOTION_MAP: Record<string, number> = {
	neutral: 0,
	joy: 1,
	sappiness: 1,
	sadness: 2,
	anger: 3,
	surprise: 4,
	fear: 5,
	disgust: 6,
	shy: 7,
};

export const DEFAULT_CONFIG: PluginConfig = {
	modelPath: "",
	modelSelection: "",
	voiceId: VOICE_PRESETS[0].voiceId,
	ttsModel: "s2.1-pro-free",
	apiKeys: [],
	apiKeyFile: "",
	sttLanguage: "auto",
	asrMode: "stream",
	micGain: 1.5,
	asrCredentialsFile: join(homedir(), ".config/volc-asr/credentials.json"),
	speechLanguage: "ja",
	subtitleLanguage: "zh",
	speechPrompt: "",
	eyeTracking: false,
	gyroParallax: false,
	emotionMap: { ...DEFAULT_EMOTION_MAP },
	workspaces: {},
	liveModel: null,
};

export function configFilePath(): string {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "live2d-voice.json");
}

export function loadConfig(): PluginConfig {
	try {
		if (!existsSync(configFilePath())) return structuredClone(DEFAULT_CONFIG);
		const raw = JSON.parse(readFileSync(configFilePath(), "utf-8")) as Partial<PluginConfig>;
		const config: PluginConfig = {
			...structuredClone(DEFAULT_CONFIG),
			...raw,
			emotionMap: { ...DEFAULT_EMOTION_MAP, ...(raw.emotionMap ?? {}) },
			workspaces: raw.workspaces ?? {},
			apiKeys: Array.isArray(raw.apiKeys) ? raw.apiKeys.filter((k) => typeof k === "string" && k) : [],
		};
		// One-time Phase 1 → 2 migration: Phase 1 files never carried
		// speechLanguage (no such field) and its saved configs baked the old
		// sttLanguage default "zh" — which now breaks Japanese recognition.
		// Phase 1 exposed no sttLanguage UI, so that value is always the old
		// default; migrate it to auto. Any Phase 2 save persists
		// speechLanguage, which makes this condition false forever after.
		if (raw.speechLanguage === undefined && config.sttLanguage === "zh") {
			config.sttLanguage = "auto";
		}
		return config;
	} catch {
		return structuredClone(DEFAULT_CONFIG);
	}
}

export function saveConfig(patch: Partial<PluginConfig>): PluginConfig {
	const next: PluginConfig = { ...loadConfig(), ...patch };
	const dir = join(configFilePath(), "..");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(configFilePath(), JSON.stringify(next, null, 2), "utf-8");
	return next;
}

/**
 * Resolve the effective API keys: inline list first, then the key file
 * (JSON array or one key per line).
 */
export function resolveApiKeys(config: PluginConfig): string[] {
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

// ---------- model catalog ----------

/** 模型显示名映射：目录名 → 中文展示名（未命中的回退为目录名本身）。 */
export const MODEL_LABELS: Record<string, string> = {
	chitose: "千岁 · 男性角色",
	"deepseek-chan": "DeepSeek娘 · 品牌拟人",
	epsilon: "伊普西隆 · 标准版",
	"epsilon-lite": "伊普西隆 · 简易版",
	gantzert: "剑士与飞龙 · Gantzert",
	haru: "春 · 前台接待版",
	"haru-classic": "春 · 经典版",
	haruto: "春翔 · SD 男孩",
	hibiki: "响 · 元气少女",
	hijiki: "羊栖菜 · 黑猫吉祥物",
	hiyori: "桃濑日和 · 元气少女",
	izumi: "泉 · 四种画风",
	kei: "京 · 唇形动态版",
	"kei-lite": "京 · 简易版",
	koharu: "小春 · SD 女孩",
	mao: "虹色Mao · 元气少女",
	mark: "马克君 · 少年",
	miara: "米亚拉 · 全身少女",
	miku: "初音未来",
	"miku-pro": "初音未来 · 增强版",
	natori: "名执尽 · 成年男性",
	"ni-j": "妮托 · 换装にじ",
	nico: "妮托 · 换装にこ",
	nietzsche: "妮托 · 换装にちぇ",
	nipsilon: "妮托 · 换装にぷしろん",
	nito: "妮托 · 二头身",
	rice: "莱斯 · 兔子吉祥物",
	shizuku: "雫 · 女子高中生",
	simple: "简单模型 · 新手向",
	tororo: "山药泥 · 白猫吉祥物",
	tsumiki: "春伞 · 合作少女",
	unitychan: "Unity酱",
	wanko: "碗中小年糕 · 犬系吉祥物",
	zundamon: "俊达萌 · 豆粉吉祥物",
};

export interface ModelEntry {
	/** 存储键：目录名（.model3.json 基名）。配置写入与路径解析使用。 */
	name: string;
	/** 展示名：中文标签，未命中映射时等于 name。 */
	label: string;
	/** File name of the .model3.json, relative to the model root. */
	relative: string;
}

/**
 * Scan modelPath into a catalog. A flat directory (one or more .model3.json
 * files directly inside) keeps Phase 1 behavior; otherwise every
 * first-level subdirectory containing a .model3.json becomes a model.
 */
export function resolveModelCatalog(config: PluginConfig): ModelEntry[] {
	if (!config.modelPath) return [];
	const models: ModelEntry[] = [];
	let rootEntries: string[];
	try {
		rootEntries = readdirSync(config.modelPath);
	} catch {
		return [];
	}
	const direct = rootEntries.filter((file) => file.endsWith(".model3.json")).sort();
	if (direct.length > 0) {
		for (const entry of direct) {
			const name = entry.replace(/\.model3\.json$/, "");
			models.push({ name, label: MODEL_LABELS[name] ?? name, relative: entry });
		}
		return models;
	}
	for (const dir of rootEntries.slice().sort((a, b) => a.localeCompare(b))) {
		// One broken symlink or unreadable directory must not wipe the
		// whole catalog — probe entries individually and skip the bad ones.
		try {
			const dirPath = join(config.modelPath, dir);
			if (!statSync(dirPath).isDirectory()) continue;
			const entry = readdirSync(dirPath).find((file) => file.endsWith(".model3.json"));
			if (entry) models.push({ name: dir, label: MODEL_LABELS[dir] ?? dir, relative: `${dir}/${entry}` });
		} catch {
			continue;
		}
	}
	return models;
}

/** The effective model entry: the selection when it matches, else the first. */
export function resolveModelSelection(config: PluginConfig, catalog: ModelEntry[]): ModelEntry | undefined {
	if (catalog.length === 0) return undefined;
	return catalog.find((model) => model.name === config.modelSelection) ?? catalog[0];
}

// ---------- per-workspace resolution ----------

/** Minimal host shape so config.ts stays independent of the agent types. */
interface AgentsLike {
	get(id: unknown): { session?: { header?: { cwd?: string } } } | undefined;
}

/**
 * The config a session actually runs with: global defaults overlaid with
 * the workspace override matching the session's workspace root (cwd).
 * emotionMap merges key-by-key; everything else replaces when set.
 */
export function resolveSessionConfig(agents: AgentsLike, config: PluginConfig, sessionId: string): PluginConfig {
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
			emotionMap: { ...config.emotionMap, ...(override.emotionMap ?? {}) },
		};
	} catch {
		return config;
	}
}
