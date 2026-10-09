/**
 * Fish Audio public voice catalog: paginated window queries + per-page cache.
 *
 * The free tier opens one 1000-entry window per *query* (global hot top 1000,
 * `language=ja` 1000, `tag=anime` 1000, …). Windows differ from each other, so
 * filters must be sent upstream — filtering a locally fetched hot list would
 * only ever see a slice. Each window is paged 100/entry upstream; we fetch one
 * page per request and cache it (a full 1000-entry window costs 3–6.5s, a
 * single page 1.2–3.9s, so page-at-a-time is what keeps the first paint quick).
 *
 * Upstream order is preserved as-is (`sort_by=score`): re-sorting by likes
 * would scramble the page boundaries the client appends across.
 *
 * No disk snapshot: the plugin has no media directory of its own, and a host
 * restart re-fetching one page is cheaper than another file to keep coherent.
 */

import type { PluginConfig } from "./config.js";
import { VOICE_PRESETS } from "./config.js";

/** Fish API base; paths ("/model", "/model/<id>") are appended by the callers. */
const FISH_API_BASE = "https://api.fish.audio";
/** Upstream page size; also the client's "show more" step. */
export const VOICE_PAGE_SIZE = 100;
/** The free tier exposes 1000 entries per window; beyond that paging is empty. */
export const VOICE_MAX_PAGE = 10;
const VOICE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** 48 pages ≈ 4800 entries — a few MB, far above any realistic browsing session. */
const VOICE_PAGE_CACHE_LIMIT = 48;
const FISH_TIMEOUT_MS = 30_000;

/** A upstream query: conditions are AND, multiple tags are OR (Fish's union). */
export interface VoiceQuery {
	/** ISO 639-1 lowercase code (Fish is case-sensitive: `JA` matches nothing). */
	language?: string;
	/** Fish tags verbatim (also case-sensitive: `anime` 100 entries, `ANIME` 3). */
	tags?: string[];
	/** Whole-library title substring search (the only way past the hot window). */
	title?: string;
}

export interface VoiceEntry {
	id: string;
	title: string;
	description: string;
	languages: string[];
	tags: string[];
	likes: number;
	/** Cover path relative to the Fish CDN (`coverimage/<id>`); "" when absent. */
	cover: string;
}

/** One upstream page plus what the client needs to ask for the next one. */
export interface VoicePage {
	entries: VoiceEntry[];
	/** Upstream match count for this query (can exceed what we ever fetch). */
	total: number;
	page: number;
	hasMore: boolean;
}

/** Author-provided sample: pre-rendered audio URL + the text it reads. */
export interface VoiceSample {
	/** Signed URL, expires in ~1h — use immediately, never store. */
	audio: string;
	/** Official example text first, then the author's sample text; "" if neither. */
	text: string;
	languages: string[];
}

interface RawVoice {
	_id?: unknown;
	id?: unknown;
	title?: unknown;
	description?: unknown;
	languages?: unknown;
	tags?: unknown;
	like_count?: unknown;
	cover_image?: unknown;
	state?: unknown;
	default_text?: unknown;
	samples?: unknown;
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Parse one upstream entry; unrecognized shapes are dropped.
 *
 * Two guards earn their keep: untrained models cannot synthesize (letting them
 * into the list only offers the user voices that fail), and the id must be a
 * 32-hex reference_id (nothing else can be passed as `reference_id`).
 */
export function toVoiceEntry(raw: unknown): VoiceEntry | null {
	const item = (raw ?? {}) as RawVoice;
	const id = str(item._id) || str(item.id);
	if (!/^[0-9a-f]{32}$/.test(id) || item.state !== "trained") return null;
	return {
		id,
		title: str(item.title) || id.slice(0, 8),
		description: str(item.description),
		languages: strList(item.languages),
		tags: strList(item.tags),
		likes: typeof item.like_count === "number" ? item.like_count : 0,
		cover: str(item.cover_image),
	};
}

/** Author's first sample (undefined when the voice has none). */
export function readVoiceSample(raw: unknown): VoiceSample {
	const item = (raw ?? {}) as RawVoice;
	const samples = Array.isArray(item.samples) ? (item.samples as { audio?: unknown; text?: unknown }[]) : [];
	const first = samples[0];
	return {
		audio: str(first?.audio),
		text: str(item.default_text).trim() || str(first?.text).trim(),
		languages: strList(item.languages),
	};
}

interface NormalizedQuery {
	language: string;
	tags: string[];
	title: string;
}

function normalize(query: VoiceQuery): NormalizedQuery {
	return {
		language: (query.language ?? "").trim().toLowerCase(),
		tags: [...new Set((query.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort(),
		title: (query.title ?? "").trim().toLowerCase(),
	};
}

/** Cache key for one (query, page); the page number is appended by the caller. */
export function voiceQueryKey(query: VoiceQuery): string {
	const q = normalize(query);
	const parts: string[] = [];
	if (q.language) parts.push(`language=${q.language}`);
	for (const tag of q.tags) parts.push(`tag=${tag}`);
	if (q.title) parts.push(`title=${q.title}`);
	return parts.join("&");
}

/** Query string appended to `/model?page_size=…&sort_by=score` (values encoded). */
export function voiceQuerySuffix(query: VoiceQuery): string {
	const q = normalize(query);
	const parts: string[] = [];
	if (q.language) parts.push(`language=${encodeURIComponent(q.language)}`);
	for (const tag of q.tags) parts.push(`tag=${encodeURIComponent(tag)}`);
	if (q.title) parts.push(`title=${encodeURIComponent(q.title)}`);
	return parts.length > 0 ? `&${parts.join("&")}` : "";
}

/** Upstream JSON getter; key rotation and the proxy live in the plugin's fetch. */
export type VoiceJsonFetcher = <T>(path: string) => Promise<T>;

/**
 * Fallback preview lines, one per language, used when a voice carries no
 * example text at all (`default_text` and the author's sample text both empty).
 */
const PREVIEW_TEXT: Record<string, string> = {
	ja: "こんにちは。私はあなたのアシスタントです。今日はいい天気ですね。",
	zh: "你好，我是你的语音助手，很高兴认识你。",
	en: "Hello, I am your voice assistant. Nice to meet you.",
};

/** The line a voice previews with when upstream gives no example text. */
export function previewText(languages: string[]): string {
	for (const code of languages) {
		const hit = PREVIEW_TEXT[code.toLowerCase().split("-")[0] ?? ""];
		if (hit) return hit;
	}
	return PREVIEW_TEXT.en ?? "";
}

/**
 * Name for a curated deployment preset.
 *
 * The 25 shipped presets have hand-written Chinese labels that read better
 * than upstream titles ("温柔女仆 · 雷姆" vs "Rem"), and they are the default
 * `voiceId` — resolving them locally keeps the GUI's name display working
 * without a Fish round-trip (and without an upstream error in setups that
 * only ever use presets).
 */
function curatedEntry(id: string): VoiceEntry | undefined {
	const preset = VOICE_PRESETS.find((entry) => entry.voiceId === id);
	if (!preset) return undefined;
	return {
		id,
		title: preset.label,
		description: "",
		languages: preset.lang ? [preset.lang] : [],
		tags: [],
		likes: 0,
		cover: "",
	};
}

export class VoiceCatalogService {
	private readonly pages = new Map<string, { at: number; page: VoicePage }>();
	private readonly inflight = new Map<string, Promise<VoicePage>>();

	constructor(
		private readonly getConfig: () => PluginConfig,
		private readonly resolveKeys: (config: PluginConfig) => string[],
	) {}

	/**
	 * One page of a query window. `refresh` skips the cache read (the user's
	 * explicit re-fetch); an in-flight request is reused either way — it is
	 * already fetching fresh data.
	 */
	list(query: VoiceQuery, page = 1, refresh = false): Promise<VoicePage> {
		const number = Math.min(Math.max(1, Math.trunc(page) || 1), VOICE_MAX_PAGE);
		const key = `${voiceQueryKey(query)}|${number}`;
		if (!refresh) {
			const hit = this.pages.get(key);
			if (hit && Date.now() - hit.at < VOICE_CACHE_TTL_MS) return Promise.resolve(hit.page);
		}
		const running = this.inflight.get(key);
		if (running) return running;
		const job = this.fetchPage(voiceQuerySuffix(query), number)
			.then((result) => {
				this.remember(key, result);
				return result;
			})
			.finally(() => this.inflight.delete(key));
		this.inflight.set(key, job);
		return job;
	}

	/** Resolve a single voice by id — display name for a hand-filled voiceId. */
	async resolve(id: string): Promise<VoiceEntry> {
		const curated = curatedEntry(id);
		if (curated) return curated;
		return this.entryOf(id, await this.fetchJson<RawVoice>(`/model/${id}`));
	}

	/**
	 * Fetch the author's pre-rendered sample for a voice.
	 *
	 * The audio URL is signed and expires in an hour, so it is never cached —
	 * only used right now. Voices without a sample (≈2% of the library) get ""
	 * and the caller falls back to synthesizing the example text.
	 */
	async sample(id: string): Promise<VoiceSample> {
		const raw = await this.fetchJson<RawVoice>(`/model/${id}`);
		// Reject untrained/missing voices here so callers never see a dead link
		this.entryOf(id, raw);
		return readVoiceSample(raw);
	}

	private entryOf(id: string, raw: RawVoice): VoiceEntry {
		const entry = toVoiceEntry(raw);
		if (!entry) throw new Error(`voice ${id} does not exist or is not trained`);
		return entry;
	}

	private async fetchPage(suffix: string, page: number): Promise<VoicePage> {
		const body = await this.fetchJson<{ total?: unknown; items?: unknown[] }>(
			`/model?page_size=${VOICE_PAGE_SIZE}&page_number=${page}&self=false&sort_by=score${suffix}`,
		);
		const entries: VoiceEntry[] = [];
		for (const raw of body.items ?? []) {
			const entry = toVoiceEntry(raw);
			if (entry) entries.push(entry);
		}
		const total = typeof body.total === "number" ? body.total : entries.length;
		return { entries, total, page, hasMore: page < VOICE_MAX_PAGE && page * VOICE_PAGE_SIZE < total };
	}

	/**
	 * Upstream JSON with multi-key rotation.
	 *
	 * Any non-2xx moves to the next key (401/402/429 are per-key quota or
	 * credential problems, and a 5xx may well be transient) — if every key
	 * fails, the last error is rethrown so the route can report it verbatim.
	 *
	 * The global fetch honors HTTPS_PROXY through NODE_USE_ENV_PROXY — the same
	 * path `tts.ts` relies on to reach api.fish.audio from this deployment.
	 */
	private async fetchJson<T>(path: string): Promise<T> {
		const keys = this.resolveKeys(this.getConfig());
		if (keys.length === 0) throw new Error("no Fish Audio API key configured");
		let lastError: unknown = null;
		for (const key of keys) {
			try {
				const response = await fetch(`${FISH_API_BASE}${path}`, {
					headers: { authorization: `Bearer ${key}` },
					signal: AbortSignal.timeout(FISH_TIMEOUT_MS),
				});
				if (!response.ok) {
					const detail = await response.text().catch(() => "");
					lastError = new Error(`Fish catalog HTTP ${response.status}: ${detail.slice(0, 200)}`);
					continue;
				}
				return (await response.json()) as T;
			} catch (error) {
				lastError = error;
			}
		}
		throw new Error(`Fish catalog request failed for every key: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	}

	private remember(key: string, page: VoicePage): void {
		this.pages.set(key, { at: Date.now(), page });
		while (this.pages.size > VOICE_PAGE_CACHE_LIMIT) {
			const oldest = this.pages.keys().next().value;
			if (oldest === undefined) break;
			this.pages.delete(oldest);
		}
	}
}
