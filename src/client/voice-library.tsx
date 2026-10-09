/**
 * 音色库浮层：检索 Fish 公共音色库、试听、选用。
 *
 * 目录来自宿主（GET /live2d-voice/voices）。条件发到上游按窗口取——免费档对每个查询
 * 各开一个 1000 条窗口（热门榜里日语只有一小片），本地过滤看不到榜外音色。每页 100 条，
 * 「显示更多」追加下一页，不重排已有内容。
 *
 * 浮层 portal 到 document.body：舞台 .lv-stage 带 CSS transform，渲染在其子树里的
 * position:fixed 会被 transform 劫持成相对定位。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "./api.js";
import type { VoiceEntry } from "./types.js";

/** Fish 封面图 CDN（cover_image 是 `coverimage/<id>` 相对路径）。 */
const COVER_BASE = "https://public-platform.r2.fish.audio/";

const LANGUAGES = [
	{ id: "", label: "全部" },
	{ id: "zh", label: "中文" },
	{ id: "ja", label: "日语" },
	{ id: "en", label: "英语" },
	{ id: "ko", label: "韩语" },
];

/** Fish 标签大小写敏感，这里都是实测有量的原样拼写。 */
const TAGS = [
	{ id: "anime", label: "动漫" },
	{ id: "character-voice", label: "角色" },
	{ id: "female", label: "女声" },
	{ id: "male", label: "男声" },
	{ id: "narration", label: "旁白" },
	{ id: "storytelling", label: "讲故事" },
];

const LANGUAGE_LABELS: Record<string, string> = {
	zh: "中文",
	ja: "日语",
	en: "英语",
	ko: "韩语",
	es: "西语",
	fr: "法语",
	de: "德语",
	it: "意语",
	ru: "俄语",
	pt: "葡语",
	ar: "阿语",
	yue: "粤语",
};

function languageLabel(code: string): string {
	return LANGUAGE_LABELS[code.toLowerCase().split("-")[0] ?? ""] ?? code;
}

export interface VoiceLibraryProps {
	/** 当前生效的音色 id（列表里标「当前」）。 */
	currentVoiceId?: string;
	onPick: (entry: VoiceEntry) => void;
	onClose: () => void;
}

export function VoiceLibrary({ currentVoiceId, onPick, onClose }: VoiceLibraryProps) {
	// 输入即时回显，查询走 350ms 防抖（每次查询都是一次上游往返）
	const [keyword, setKeyword] = useState("");
	const [debounced, setDebounced] = useState("");
	const [language, setLanguage] = useState("");
	const [tags, setTags] = useState<string[]>([]);
	const tagsKey = tags.join(",");

	const [entries, setEntries] = useState<VoiceEntry[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(0);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [busyId, setBusyId] = useState("");
	const [playingId, setPlayingId] = useState("");

	/** 请求序号：筛选条件变化后，迟到的旧回包一律丢弃。 */
	const ticket = useRef(0);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const urlRef = useRef("");
	/** 卸载标记：试听请求在关闭浮层后才回来的话，别再播放，并把 objectURL 还回去。 */
	const aliveRef = useRef(true);

	useEffect(
		() => () => {
			aliveRef.current = false;
		},
		[],
	);

	useEffect(() => {
		const id = window.setTimeout(() => setDebounced(keyword.trim()), 350);
		return () => window.clearTimeout(id);
	}, [keyword]);

	const load = useCallback(
		async (target: number, append: boolean, refresh = false) => {
			const mine = ++ticket.current;
			setLoading(true);
			setError("");
			try {
				const window_ = await api.fetchVoices({ title: debounced, language, tags, page: target, refresh });
				if (mine !== ticket.current) return;
				setEntries((prev) => (append ? [...prev, ...window_.entries] : window_.entries));
				setTotal(window_.total);
				setPage(window_.page);
				setHasMore(window_.hasMore);
			} catch (err) {
				if (mine === ticket.current) setError((err as Error).message);
			} finally {
				if (mine === ticket.current) setLoading(false);
			}
		},
		[debounced, language, tagsKey],
	);

	useEffect(() => {
		void load(1, false);
	}, [load]);

	const stopAudio = useCallback(() => {
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current = null;
		}
		if (urlRef.current) {
			URL.revokeObjectURL(urlRef.current);
			urlRef.current = "";
		}
		setPlayingId("");
	}, []);

	// 关闭面板即停音；组件卸载同理
	useEffect(() => stopAudio, [stopAudio]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const audition = async (entry: VoiceEntry): Promise<void> => {
		if (busyId) return;
		if (playingId === entry.id) {
			stopAudio();
			return;
		}
		stopAudio();
		setBusyId(entry.id);
		try {
			const url = await api.previewVoice(entry.id);
			if (!aliveRef.current) {
				URL.revokeObjectURL(url);
				return;
			}
			urlRef.current = url;
			const audio = new Audio(url);
			audioRef.current = audio;
			audio.onended = () => {
				if (audioRef.current === audio) stopAudio();
			};
			await audio.play();
			setPlayingId(entry.id);
		} catch (err) {
			if (aliveRef.current) setError(`试听失败：${(err as Error).message}`);
		} finally {
			if (aliveRef.current) setBusyId("");
		}
	};

	const pick = (entry: VoiceEntry): void => {
		stopAudio();
		onPick(entry);
	};

	return createPortal(
		<div className="lv-vlib-mask lv-vlib-scope" role="presentation" onClick={onClose}>
			<div className="lv-vlib" role="dialog" aria-label="音色库" onClick={(event) => event.stopPropagation()}>
				<header className="lv-vlib-head">
					<input
						className="lv-vlib-search"
						placeholder="搜索音色名（Fish 全库）"
						value={keyword}
						autoFocus
						onChange={(event) => setKeyword(event.target.value)}
					/>
					<button type="button" className="lv-vlib-close" aria-label="关闭音色库" title="关闭" onClick={onClose}>
						×
					</button>
				</header>

				<div className="lv-vlib-filters">
					<div className="lv-vlib-chips">
						{LANGUAGES.map((option) => (
							<button
								key={option.id}
								type="button"
								className={`lv-vlib-chip${language === option.id ? " lv-on" : ""}`}
								onClick={() => setLanguage(option.id)}
							>
								{option.label}
							</button>
						))}
					</div>
					<div className="lv-vlib-chips">
						{TAGS.map((option) => (
							<button
								key={option.id}
								type="button"
								className={`lv-vlib-chip${tags.includes(option.id) ? " lv-on" : ""}`}
								onClick={() =>
									setTags((prev) => (prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id]))
								}
							>
								{option.label}
							</button>
						))}
					</div>
				</div>

				<div className="lv-vlib-status">
					<span>{loading ? "检索中…" : error ? "" : `共 ${total} 条 · 已显示 ${entries.length}`}</span>
					<button type="button" className="lv-vlib-refresh" disabled={loading} onClick={() => void load(1, false, true)}>
						重新抓取
					</button>
				</div>

				{error && (
					<div className="lv-vlib-error" role="alert">
						{error}
					</div>
				)}

				<div className="lv-vlib-list">
					{entries.map((entry) => (
						<article key={entry.id} className={`lv-vlib-row${entry.id === currentVoiceId ? " lv-current" : ""}`}>
							<span className="lv-vlib-cover">
								<span className="lv-vlib-initial">{entry.title.slice(0, 1)}</span>
								{entry.cover && (
									<img
										src={COVER_BASE + entry.cover}
										alt=""
										loading="lazy"
										onError={(event) => {
											event.currentTarget.style.display = "none";
										}}
									/>
								)}
							</span>
							<div className="lv-vlib-info">
								<strong className="lv-vlib-title">{entry.title}</strong>
								{entry.description && <p className="lv-vlib-desc">{entry.description}</p>}
								<p className="lv-vlib-meta">
									{entry.languages.map(languageLabel).join(" · ") || "语言未标注"}
									{entry.likes > 0 ? ` · ♥ ${entry.likes}` : ""}
									{entry.id === currentVoiceId ? " · 当前" : ""}
								</p>
							</div>
							<div className="lv-vlib-actions">
								<button type="button" className="lv-vlib-btn" disabled={busyId !== ""} onClick={() => void audition(entry)}>
									{busyId === entry.id ? "准备中…" : playingId === entry.id ? "停止" : "试听"}
								</button>
								<button type="button" className="lv-vlib-btn lv-primary" onClick={() => pick(entry)}>
									选用
								</button>
							</div>
						</article>
					))}

					{entries.length === 0 && !loading && !error && (
						<p className="lv-vlib-empty">没有匹配的音色，换个关键词或筛选试试。</p>
					)}

					{hasMore && (
						<button type="button" className="lv-vlib-more" disabled={loading} onClick={() => void load(page + 1, true)}>
							{loading ? "加载中…" : `显示更多（还有 ${Math.max(0, total - entries.length)} 条）`}
						</button>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
