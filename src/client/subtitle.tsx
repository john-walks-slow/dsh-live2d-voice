/**
 * Subtitle overlay: the recent dialogue lines (assistant + user) rendered as
 * centered captions. The newest line is large; older lines shrink and dim.
 * Lines expire individually after a while so the stage stays clean.
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

export function SubtitleOverlay(props: { lines: SubtitleLine[]; visible: boolean }) {
	if (!props.visible) return null;
	const live = props.lines.filter((line) => Date.now() - line.at < SUBTITLE_TTL_MS);
	const current = live[live.length - 1];
	const older = live.slice(0, -1).slice(-3);
	const render = (line: SubtitleLine, className: string) => (
		<p key={line.id} className={className}>
			{line.text}
			{line.translation && <span className="lv-sub-tr">{line.translation}</span>}
		</p>
	);
	return (
		<div className="lv-subs">
			{older.map((line) =>
				render(line, `lv-sub lv-old${line.role === "user" ? " lv-user" : ""}${line.role === "error" ? " lv-err" : ""}`),
			)}
			{current &&
				render(current, `lv-sub lv-cur${current.role === "user" ? " lv-user" : ""}${current.role === "error" ? " lv-err" : ""}`)}
		</div>
	);
}
