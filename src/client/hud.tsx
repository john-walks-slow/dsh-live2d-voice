/**
 * The bottom HUD capsule: mic (continuous voice input), TTS mute, subtitles,
 * keyboard input, fullscreen, and the quick-adjust sliders popover.
 *
 * All icons are vector SVGs (no system emojis).
 */

import type { MicState } from "./mic.js";
import type { LanguageOption, VoicePreset } from "./types.js";
import type { ModelCatalog, ModelProviderGroup, ModelSelection } from "./types.js";
import {
	IconMic,
	IconMicOff,
	IconVolume,
	IconVolumeX,
	IconCaptions,
	IconKeyboard,
	IconMaximize,
	IconMinimize,
	IconSliders,
	IconClose,
	IconExternalLink,
	IconCopy,
} from "./icons.js";
import { logger } from "./logger.js";
import { useState } from "react";

export interface HudProps {
	faded: boolean;
	muted: boolean;
	subtitlesOn: boolean;
	inputOpen: boolean;
	popoverOpen: boolean;
	fullscreen: boolean;
	micState: MicState;
	asrConfigured: boolean;
	presets: VoicePreset[];
	languages: LanguageOption[];
	currentVoiceId: string;
	currentSttLanguage: string;
	/** Live2D model catalog */
	models: { name: string; label?: string; url: string }[];
	currentModel?: string;
	apiKeyCount: number;
	speechPrompt: string;
	eyeTracking: boolean;
	gyroParallax: boolean;
	hasCalibration?: boolean;
	/** LLM model catalog for the model selector. */
	modelCatalog: ModelCatalog | null;
	/** Current model selection for this session. */
	currentModelSelection: ModelSelection | null;
	/** Called when the user picks a provider/model/effort. */
	onSelectModel: (provider: string, model: string, reasoningEffort?: string) => void;
	onToggleMute: () => void;
	onToggleSubtitles: () => void;
	onToggleInput: () => void;
	onTogglePopover: () => void;
	onToggleFullscreen: () => void;
	onToggleMic: () => void;
	onToggleEyeTracking: () => void;
	onToggleGyroParallax: () => void;
	onStartCalibration?: () => void;
	onResetCalibration?: () => void;
	onPickVoice: (preset: VoicePreset) => void;
	onPickSttLanguage: (id: string) => void;
	onPickModel: (name: string) => void;
	onSavePrompt: (text: string) => void;
	onOpenGlobalSettings?: () => void;
}

export function Hud(props: HudProps) {
	const micOn = props.micState === "listening" || props.micState === "requesting";
	const [logCopied, setLogCopied] = useState(false);

	const handleCopyLogs = async () => {
		try {
			const text = logger.exportLogsText();
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				const textarea = document.createElement("textarea");
				textarea.value = text;
				document.body.appendChild(textarea);
				textarea.select();
				document.execCommand("copy");
				document.body.removeChild(textarea);
			}
			setLogCopied(true);
			window.setTimeout(() => setLogCopied(false), 2500);
		} catch (err) {
			logger.warn("Failed to copy logs in HUD", err);
		}
	};

	return (
		<div className={`lv-hud${props.faded ? " lv-faded" : ""}${micOn ? " lv-mic-live" : ""}`}>
			{/* 1. 麦克风录音控制 */}
			<button
				type="button"
				className={`lv-btn lv-mic${micOn ? " lv-on lv-mic-live" : ""}`}
				title={
					!props.asrConfigured
						? "语音输入未配置（可在设置中配置火山 ASR 凭证）"
						: micOn
							? "关闭语音输入"
							: "开启语音对话：连续倾听，说完一句自动发送；说话可直接打断"
				}
				onClick={props.onToggleMic}
			>
				{micOn ? <IconMic size={19} /> : <IconMicOff size={19} />}
			</button>

			{/* 2. 朗读声音静音 */}
			<button
				type="button"
				className={`lv-btn${props.muted ? "" : " lv-on"}`}
				title={props.muted ? "取消静音（开启角色朗读）" : "静音角色语音"}
				onClick={props.onToggleMute}
			>
				{props.muted ? <IconVolumeX size={19} /> : <IconVolume size={19} />}
			</button>

			{/* 3. 双语字幕开关 */}
			<button
				type="button"
				className={`lv-btn${props.subtitlesOn ? " lv-on" : ""}`}
				title={props.subtitlesOn ? "隐藏字幕" : "显示字幕"}
				onClick={props.onToggleSubtitles}
			>
				<IconCaptions size={19} />
			</button>

			{/* 4. 键盘文本输入 */}
			<button
				type="button"
				className={`lv-btn${props.inputOpen ? " lv-on" : ""}`}
				title={props.inputOpen ? "收起键盘输入" : "打字输入"}
				onClick={props.onToggleInput}
			>
				<IconKeyboard size={19} />
			</button>

			{/* 5. 沉浸全屏模式 */}
			<button
				type="button"
				className={`lv-btn${props.fullscreen ? " lv-on" : ""}`}
				title={props.fullscreen ? "退出全屏" : "全屏沉浸模式"}
				onClick={props.onToggleFullscreen}
			>
				{props.fullscreen ? <IconMinimize size={19} /> : <IconMaximize size={19} />}
			</button>

			<div className="lv-hud-sep" />

			{/* 6. 快捷面板（音色与模型快切） */}
			<button
				type="button"
				className={`lv-btn${props.popoverOpen ? " lv-on" : ""}`}
				title="快捷调整（音色与角色）"
				onClick={() => {
					props.onTogglePopover();
				}}
			>
				<IconSliders size={18} />
			</button>

			{/* 快捷弹出面板 */}
			{props.popoverOpen && (
				<div className="lv-pop">
					<div className="lv-pop-head">
						<span>快捷调整</span>
						<button
							type="button"
							className="lv-pop-close"
							title="关闭"
							onClick={() => {
								props.onTogglePopover();
							}}
						>
							<IconClose size={15} />
						</button>
					</div>

					<div className="lv-pop-body">
						{/* 角色模型快切 */}
						{props.models.length > 1 && (
							<>
								<h4>角色模型</h4>
								<div className="lv-langs">
									{props.models.map((model) => (
										<button
											key={model.name}
											type="button"
											className={`lv-lang${model.name === props.currentModel ? " lv-current" : ""}`}
											title={model.name}
											onClick={() => props.onPickModel(model.name)}
										>
											{model.label ?? model.name}
										</button>
									))}
								</div>
							</>
						)}

						{/* LLM 模型与思考程度选择 */}
						{props.modelCatalog && props.modelCatalog.groups.length > 0 && (
							<ModelSelector
								catalog={props.modelCatalog}
								current={props.currentModelSelection}
								onSelect={props.onSelectModel}
							/>
						)}

						{/* 音色快切 */}
						<h4>角色音色</h4>
						<div className="lv-langs">
							{props.presets.map((preset) => (
								<button
									key={preset.id}
									type="button"
									className={`lv-lang${preset.voiceId === props.currentVoiceId ? " lv-current" : ""}`}
									onClick={() => props.onPickVoice(preset)}
								>
									{preset.label}
								</button>
							))}
						</div>

						{/* 识别语言快切 */}
						<h4>识别语言</h4>
						<div className="lv-langs">
							{props.languages.map((language) => (
								<button
									key={language.id}
									type="button"
									className={`lv-lang${language.id === props.currentSttLanguage ? " lv-current" : ""}`}
									onClick={() => props.onPickSttLanguage(language.id)}
								>
									{language.label}
								</button>
							))}
						</div>

						{/* 实验性实时开关 */}
						<h4>体感实验</h4>
						<div className="lv-switch-row">
							<span>视线追踪 (前置摄像头)</span>
							<button
								type="button"
								role="switch"
								aria-checked={props.eyeTracking}
								className={`lv-switch${props.eyeTracking ? " lv-on" : ""}`}
								onClick={props.onToggleEyeTracking}
							>
								<span className="lv-switch-knob" />
							</button>
						</div>
						{props.eyeTracking && (
							<div className="lv-calib-trigger-row">
								<button
									type="button"
									className="lv-btn-calib"
									onClick={() => {
										props.onTogglePopover();
										props.onStartCalibration?.();
									}}
								>
									<span>🎯 智能视线校准</span>
									{props.hasCalibration && <span className="lv-calib-tag">已校准</span>}
								</button>
								{props.hasCalibration && (
									<button
										type="button"
										className="lv-btn-calib-reset"
										title="恢复默认视线参数"
										onClick={props.onResetCalibration}
									>
										重置
									</button>
								)}
							</div>
						)}
						<div className="lv-switch-row">
							<span>陀螺仪 3D 视差</span>
							<button
								type="button"
								role="switch"
								aria-checked={props.gyroParallax}
								className={`lv-switch${props.gyroParallax ? " lv-on" : ""}`}
								onClick={props.onToggleGyroParallax}
							>
								<span className="lv-switch-knob" />
							</button>
						</div>

						{/* 底部跳转完整系统设置 与 复制排查日志 */}
						<div className="lv-pop-footer">
							<button
								type="button"
								className="lv-pop-link"
								onClick={() => {
									props.onTogglePopover();
									if (props.onOpenGlobalSettings) {
										props.onOpenGlobalSettings();
									}
								}}
							>
								<span>系统设置</span>
								<IconExternalLink size={13} />
							</button>

							<button
								type="button"
								className="lv-pop-link"
								style={{ color: logCopied ? "#34d399" : "var(--lv-fg-2)" }}
								onClick={() => void handleCopyLogs()}
							>
								<IconCopy size={12} />
								<span>{logCopied ? "已复制日志 ✓" : "复制排障日志"}</span>
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// ──────────────────────────────────────────────────────────────────────
// ModelSelector: compact two-dropdown LLM model + effort picker.
// ──────────────────────────────────────────────────────────────────────

interface ModelSelectorProps {
	catalog: ModelCatalog;
	current: ModelSelection | null;
	onSelect: (provider: string, model: string, reasoningEffort?: string) => void;
}

function ModelSelector(props: ModelSelectorProps) {
	const { catalog, current } = props;
	const [pending, setPending] = useState(false);

	const currentProvider = current?.provider ?? catalog.default.provider;
	const currentModel = current?.model ?? catalog.default.model;
	const currentEffort = current?.reasoningEffort;

	// Find the selected model to check if it supports reasoning efforts.
	const selectedGroup = catalog.groups.find((g) => g.id === currentProvider);
	const selectedModel = selectedGroup?.models.find((m) => m.id === currentModel);
	const efforts = selectedModel?.reasoning?.efforts ?? [];
	const effectiveEffort = currentEffort ?? selectedModel?.reasoning?.defaultEffort;

	const handleChange = async (value: string, effort?: string) => {
		const sep = value.indexOf(":");
		if (sep < 0) return;
		const provider = value.slice(0, sep);
		const model = value.slice(sep + 1);
		setPending(true);
		try {
			await props.onSelect(provider, model, effort);
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<h4>模型 · 思考程度</h4>
			<select
				className="lv-model-select"
				disabled={pending}
				value={`${currentProvider}:${currentModel}`}
				onChange={(e) => void handleChange(e.target.value)}
			>
				{catalog.groups.map((g) => (
					<optgroup key={g.id} label={g.name}>
						{g.models.map((m) => (
							<option key={m.id} value={`${g.id}:${m.id}`}>
								{m.name}
							</option>
						))}
					</optgroup>
				))}
			</select>
			{efforts.length > 0 && (
				<select
					className="lv-model-select"
					disabled={pending}
					value={effectiveEffort ?? ""}
					onChange={(e) => void handleChange(`${currentProvider}:${currentModel}`, e.target.value || undefined)}
				>
					<option value="">默认</option>
					{efforts.map((eff) => (
						<option key={eff.id} value={eff.id}>
							{eff.name}
						</option>
					))}
				</select>
			)}
		</>
	);
}
