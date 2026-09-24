/**
 * Subtitle overlay: the recent dialogue lines rendered as refined glass caption cards.
 */

export interface SubtitleLine {
	id: number;
	role: "assistant" | "user" | "error";
	text: string;
	/** Server-side sentence id — translations attach to it. */
	lineId?: string;
	/** Translation into the subtitle language (subtitleLanguage). */
	translation?: string;
	at: number;
}

export const SUBTITLE_TTL_MS = 14_000;

export function SubtitleOverlay(props: { lines: SubtitleLine[]; visible: boolean; raised?: boolean }) {
	if (!props.visible) return null;
	const live = props.lines.filter((line) => Date.now() - line.at < SUBTITLE_TTL_MS);
	const current = live[live.length - 1];
	const older = live.slice(0, -1).slice(-2); // 历史句最多保留 2 句，避免遮挡

	return (
		<div className={`lv-subs${props.raised ? " lv-subs-raised" : ""}`}>
			{older.map((line) => (
				<div key={line.id} className="lv-sub-old">
					{line.text}
				</div>
			))}
			{current && (
				<div className={`lv-sub-card${current.role === "user" ? " lv-sub-user" : ""}`}>
					<p className="lv-sub-text">{current.text}</p>
					{current.translation && <span className="lv-sub-tr">{current.translation}</span>}
				</div>
			)}
		</div>
	);
}
