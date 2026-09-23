/**
 * The bottom HUD capsule: mic (Phase 2), TTS mute, subtitles, keyboard input,
 * and the voice settings popover (presets + custom speech prompt).
 *
 * The capsule fades to a whisper after 2.5s of pointer idleness (class
 * toggling owned by the view); hover restores it.
 */

import { useState } from "react";
import type { VoicePreset } from "./types.js";

export interface HudProps {
	faded: boolean;
	muted: boolean;
	subtitlesOn: boolean;
	inputOpen: boolean;
	popoverOpen: boolean;
	presets: VoicePreset[];
	currentVoiceId: string;
	apiKeyCount: number;
	speechPrompt: string;
	onToggleMute: () => void;
	onToggleSubtitles: () => void;
	onToggleInput: () => void;
	onTogglePopover: () => void;
	onPickVoice: (preset: VoicePreset) => void;
	onSavePrompt: (text: string) => void;
}

export function Hud(props: HudProps) {
	const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
	const promptValue = draftPrompt ?? props.speechPrompt;
	return (
		<div className={`lv-hud${props.faded ? " lv-faded" : ""}`}>
			<button
				type="button"
				className="lv-btn"
				disabled
				title="语音输入（规划中，Phase 2 提供）"
			>
				🎙️
			</button>
			<button
				type="button"
				className={`lv-btn${props.muted ? "" : " lv-on"}`}
				title={props.muted ? "取消静音（恢复语音朗读）" : "静音语音朗读"}
				onClick={props.onToggleMute}
			>
				{props.muted ? "🔇" : "🔊"}
			</button>
			<button
				type="button"
				className={`lv-btn${props.subtitlesOn ? " lv-on" : ""}`}
				title={props.subtitlesOn ? "隐藏字幕" : "显示字幕"}
				onClick={props.onToggleSubtitles}
			>
				💬
			</button>
			<button
				type="button"
				className={`lv-btn${props.inputOpen ? " lv-on" : ""}`}
				title={props.inputOpen ? "收起键盘输入" : "键盘输入"}
				onClick={props.onToggleInput}
			>
				⌨️
			</button>
			<div className="lv-hud-sep" />
			<button
				type="button"
				className={`lv-btn${props.popoverOpen ? " lv-on" : ""}`}
				title="语音设置"
				onClick={() => {
					// Closing the drawer discards the unsaved draft.
					if (props.popoverOpen) setDraftPrompt(null);
					props.onTogglePopover();
				}}
			>
				⚙️
			</button>
			{props.popoverOpen && (
				<div className="lv-pop">
					<h4>音色</h4>
					{props.presets.map((preset) => (
						<button
							key={preset.id}
							type="button"
							className={`lv-voice${preset.voiceId === props.currentVoiceId ? " lv-current" : ""}`}
							onClick={() => props.onPickVoice(preset)}
						>
							<span>{preset.label}</span>
							{preset.voiceId === props.currentVoiceId && <span>✓</span>}
						</button>
					))}
					<h4>自定义提示词</h4>
					<textarea
						className="lv-prompt-input"
						value={promptValue}
						rows={3}
						placeholder={"仅在 Live2D 语音模式下生效的额外要求，例如：\n无论用户说什么语言，总是用日语自然交流。"}
						onChange={(event) => setDraftPrompt(event.target.value)}
					/>
					<button
						type="button"
						className="lv-prompt-save"
						disabled={draftPrompt === null || draftPrompt.trim() === props.speechPrompt.trim()}
						onClick={() => {
							props.onSavePrompt(promptValue.trim());
							setDraftPrompt(null);
						}}
					>
						保存提示词
					</button>
					<p className="lv-pop-note">随语音模式注入；切回普通对话自动失效。</p>
					<p className={`lv-pop-note${props.apiKeyCount === 0 ? " lv-warn" : ""}`}>
						{props.apiKeyCount === 0
							? "未配置 Fish Audio API key，语音不可用。在 ~/.dsh/live2d-voice.json 配置 apiKeys 或 apiKeyFile。"
							: `Fish Audio key ×${props.apiKeyCount} · 当前音色立即生效于下一句话`}
					</p>
				</div>
			)}
		</div>
	);
}
