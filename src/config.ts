/**
 * Plugin configuration: load/save + resolution helpers.
 *
 * Storage: <DSH_HOME>/live2d-voice.json. Two layers (global defaults and
 * per-workspace overrides) are stored; Phase 1 reads the global layer while
 * the `workspaces` section is reserved for the per-workspace override feature.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Recommended Fish Audio voice presets (same table as the fish-audio skill). */
export const VOICE_PRESETS = [
	{ id: "rem", label: "Rem · 温柔女仆", voiceId: "0c7771ca5910484e8a4933068017fcee" },
	{ id: "maid", label: "元气女仆", voiceId: "abf4fa2e25634b41aadc4e0ef9ddaea5" },
	{ id: "frieren", label: "芙莉莲 · 知性", voiceId: "c174516c799a42e7be88b96c86cfbd3e" },
	{ id: "furina", label: "芙宁娜 · 娇俏", voiceId: "3fd70bbcdb6342df8c0c4143b958944b" },
	{ id: "cute", label: "Cute Girl · 甜美", voiceId: "0c54c26032024142bf6339dc4d4aca1b" },
] as const;

export interface PluginConfig {
	/** Absolute path of a directory that contains a .model3.json (Cubism 4). */
	modelPath: string;
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
	/** STT language hint (Phase 2; reserved here so config stays stable). */
	sttLanguage: string;
	/**
	 * User-authored extra instructions appended to the Live2D speech-format
	 * system-prompt section (e.g. "总是用日语自然交流"). Live-mode only — the
	 * exit reminder tells the model these constraints are gone in chat mode.
	 */
	speechPrompt: string;
	/** Emotion tag → model expression name/index map. */
	emotionMap: Record<string, number | string>;
	/** Sub-workspace overrides keyed by workspace id (Phase 3). */
	workspaces: Record<string, Partial<PluginConfig>>;
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
	voiceId: VOICE_PRESETS[0].voiceId,
	ttsModel: "s2.1-pro-free",
	apiKeys: [],
	apiKeyFile: "",
	sttLanguage: "zh",
	speechPrompt: "",
	emotionMap: { ...DEFAULT_EMOTION_MAP },
	workspaces: {},
};

export function configFilePath(): string {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "live2d-voice.json");
}

export function loadConfig(): PluginConfig {
	try {
		if (!existsSync(configFilePath())) return structuredClone(DEFAULT_CONFIG);
		const raw = JSON.parse(readFileSync(configFilePath(), "utf-8")) as Partial<PluginConfig>;
		return {
			...structuredClone(DEFAULT_CONFIG),
			...raw,
			emotionMap: { ...DEFAULT_EMOTION_MAP, ...(raw.emotionMap ?? {}) },
			workspaces: raw.workspaces ?? {},
			apiKeys: Array.isArray(raw.apiKeys) ? raw.apiKeys.filter((k) => typeof k === "string" && k) : [],
		};
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
