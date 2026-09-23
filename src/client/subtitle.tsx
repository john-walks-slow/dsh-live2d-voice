/**
 * Subtitle overlay: the recent dialogue lines (assistant + user) rendered as
 * centered captions. The newest line is large; older lines shrink and dim.
 * Lines expire individually after a while so the stage stays clean.
 */

export interface SubtitleLine {
	id: number;
	role: "assistant" | "user" | "error";
	text: string;
	at: number;
}

export const SUBTITLE_TTL_MS = 14_000;

export function SubtitleOverlay(props: { lines: SubtitleLine[]; visible: boolean }) {
	if (!props.visible) return null;
	const live = props.lines.filter((line) => Date.now() - line.at < SUBTITLE_TTL_MS);
	const current = live[live.length - 1];
	const older = live.slice(0, -1).slice(-3);
	return (
		<div className="lv-subs">
			{older.map((line) => (
				<p key={line.id} className={`lv-sub lv-old${line.role === "user" ? " lv-user" : ""}${line.role === "error" ? " lv-err" : ""}`}>
					{line.text}
				</p>
			))}
			{current && (
				<p key={current.id} className={`lv-sub lv-cur${current.role === "user" ? " lv-user" : ""}${current.role === "error" ? " lv-err" : ""}`}>
					{current.text}
				</p>
			)}
		</div>
	);
}
