/**
 * The Live2D conversation view (conversation.view slot entry).
 *
 * Stage = pixi Live2D model driven by the speech engine (mouth) and
 * expression events. Below it: subtitles, the HUD capsule, keyboard input,
 * and the voice popover. Everything persists its toggles in localStorage.
 */

import { useEffect, useRef, useState, type FC } from "react";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { fetchConfig, fetchModelInfo, openStream, postMessage, saveConfig } from "./api.js";
import { SpeechEngine } from "./engine.js";
import { Hud } from "./hud.js";
import { isCubismCoreLoaded, mountModel, type Live2DHandle } from "./model.js";
import { SubtitleOverlay, SUBTITLE_TTL_MS, type SubtitleLine } from "./subtitle.js";
import type { ModelInfo, VoicePreset } from "./types.js";

type Status = "boot" | "no-model" | "core-missing" | "loading" | "ready" | "error";

const HUD_IDLE_FADE_MS = 2500;

/**
 * Submit through the GUI session channel (client runtime). This is the
 * canonical path — it works for cold sessions because the host creates or
 * resumes the agent as part of session/prompt. Returns undefined when the
 * channel is unavailable, so the caller falls back to the host route.
 */
export type SubmitPrompt = (
	sessionId: string,
	text: string,
) => Promise<{ ok: boolean; error?: string }> | undefined;

type ViewProps = ConvViewProps & { submitPrompt?: SubmitPrompt };

export function Live2DView(props: ViewProps) {
	const sessionId = String(props.sessionId);
	const rootRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const engineRef = useRef<SpeechEngine | null>(null);
	const modelRef = useRef<Live2DHandle | null>(null);
	const nextLineId = useRef(1);

	const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
	const [status, setStatus] = useState<Status>("boot");
	const [errorText, setErrorText] = useState("");
	const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
	const [subtitlesOn, setSubtitlesOn] = useState(() => window.localStorage.getItem("lv2d.subs") !== "0");
	const [muted, setMuted] = useState(() => window.localStorage.getItem("lv2d.muted") === "1");
	const [inputOpen, setInputOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [presets, setPresets] = useState<VoicePreset[]>([]);
	const [voiceId, setVoiceId] = useState("");
	const [apiKeyCount, setApiKeyCount] = useState(-1);
	const [speechPrompt, setSpeechPrompt] = useState("");
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [faded, setFaded] = useState(false);
	const activeUtterance = useRef("");

	const pushSubtitle = (role: SubtitleLine["role"], text: string) => {
		setSubtitles((prev) => [...prev.slice(-5), { id: nextLineId.current++, role, text, at: Date.now() }]);
	};

	// Speech engine + persisted mute. destroy() on unmount closes the
	// AudioContext — browsers cap live contexts per page (~6).
	useEffect(() => {
		const engine = new SpeechEngine();
		engine.setMuted(window.localStorage.getItem("lv2d.muted") === "1");
		engineRef.current = engine;
		return () => {
			engineRef.current = null;
			engine.destroy();
		};
	}, []);

	// Config + model descriptor.
	useEffect(() => {
		fetchConfig()
			.then(({ config, presets }) => {
				setPresets(presets);
				setVoiceId(config.voiceId);
				setApiKeyCount(config.apiKeyCount);
				setSpeechPrompt(config.speechPrompt);
			})
			.catch((error) => console.error("[dsh-live2d-voice] config load failed", error));
		fetchModelInfo()
			.then((info) => {
				setModelInfo(info);
				if (!info.configured) setStatus("no-model");
				else if (!info.url) setStatus("error");
				else setErrorText("");
			})
			.catch((error) => {
				setStatus("error");
				setErrorText(String((error as Error)?.message ?? error));
			});
	}, []);

	// Live2D model lifecycle.
	useEffect(() => {
		const url = modelInfo?.url;
		if (!url || !stageRef.current) return;
		if (!isCubismCoreLoaded()) {
			setStatus("core-missing");
			return;
		}
		let cancelled = false;
		let handle: Live2DHandle | null = null;
		setStatus("loading");
		mountModel(stageRef.current, url, () => {
			engineRef.current?.tick();
			return engineRef.current?.mouthValue() ?? 0;
		})
			.then((mounted) => {
				if (cancelled) {
					mounted.destroy();
					return;
				}
				handle = mounted;
				modelRef.current = mounted;
				setStatus("ready");
			})
			.catch((error) => {
				if (cancelled) return;
				setStatus("error");
				setErrorText(String((error as Error)?.message ?? error));
			});
		return () => {
			cancelled = true;
			modelRef.current = null;
			handle?.destroy();
		};
	}, [modelInfo?.url]);

	// SSE stream: expressions, audio, subtitles. Audio is utterance-gated:
	// a superseded turn's late chunks are dropped instead of overlapping.
	useEffect(() => {
		if (!sessionId) return undefined;
		const close = openStream(sessionId, {
			onExpression: ({ expression, utteranceId }) => {
				if (utteranceId !== activeUtterance.current) return;
				modelRef.current?.setExpression(expression);
			},
			onSpeechStart: ({ utteranceId }) => {
				if (utteranceId !== activeUtterance.current) {
					// New utterance: drop anything still queued from the old one.
					activeUtterance.current = utteranceId;
					engineRef.current?.stop();
				}
				void engineRef.current?.resume();
			},
			onSpeechEnd: ({ utteranceId, reason }) => {
				// Stale utterance's late "aborted" must not kill the new turn's audio.
				if (utteranceId !== activeUtterance.current) return;
				if (reason === "aborted") engineRef.current?.stop();
			},
			onAudioStart: ({ sampleRate, utteranceId }) => {
				if (utteranceId !== activeUtterance.current) return;
				engineRef.current?.setSampleRate(sampleRate);
			},
			onAudio: ({ b64, utteranceId }) => {
				if (utteranceId !== activeUtterance.current) return;
				engineRef.current?.enqueueBase64(b64);
			},
			onSubtitle: ({ role, text }) => pushSubtitle(role, text),
			onError: ({ message }) => pushSubtitle("error", message),
		});
		return close;
	}, [sessionId]);

	// Subtitle expiry sweep.
	useEffect(() => {
		const timer = window.setInterval(() => {
			setSubtitles((prev) => prev.filter((line) => Date.now() - line.at < SUBTITLE_TTL_MS * 1.5));
		}, 1000);
		return () => window.clearInterval(timer);
	}, []);

	// Toast auto-dismiss.
	useEffect(() => {
		if (!toast) return undefined;
		const timer = window.setTimeout(() => setToast(null), 6000);
		return () => window.clearTimeout(timer);
	}, [toast]);

	// HUD auto-fade (paused while any panel is open).
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		let timer = 0;
		const wake = () => {
			setFaded(false);
			window.clearTimeout(timer);
			timer = window.setTimeout(() => setFaded(true), HUD_IDLE_FADE_MS);
		};
		wake();
		root.addEventListener("pointermove", wake);
		root.addEventListener("pointerdown", wake);
		return () => {
			window.clearTimeout(timer);
			root.removeEventListener("pointermove", wake);
			root.removeEventListener("pointerdown", wake);
		};
	}, [inputOpen, popoverOpen, toast]);

	// Focus the input whenever it opens.
	useEffect(() => {
		if (inputOpen) inputRef.current?.focus();
	}, [inputOpen]);

	const toggleMute = () => {
		const next = !muted;
		setMuted(next);
		window.localStorage.setItem("lv2d.muted", next ? "1" : "0");
		engineRef.current?.setMuted(next);
	};

	const toggleSubtitles = () => {
		const next = !subtitlesOn;
		setSubtitlesOn(next);
		window.localStorage.setItem("lv2d.subs", next ? "1" : "0");
	};

	const pickVoice = async (preset: VoicePreset) => {
		try {
			const { config } = await saveConfig({ voiceId: preset.voiceId });
			setVoiceId(config.voiceId);
			setApiKeyCount(config.apiKeyCount);
			setPopoverOpen(false);
			setToast(`音色已切换：${preset.label}`);
		} catch (error) {
			setToast(`音色切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const savePrompt = async (text: string) => {
		try {
			const { config } = await saveConfig({ speechPrompt: text });
			setSpeechPrompt(config.speechPrompt);
			setToast(config.speechPrompt.trim() ? "自定义提示词已保存，下一句生效" : "自定义提示词已清空");
		} catch (error) {
			setToast(`保存失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const submitDraft = async () => {
		const text = draft.trim();
		if (!text || sending) return;
		setSending(true);
		try {
			// Canonical path: the GUI session channel (works for cold sessions —
			// the host creates/resumes the agent inside session/prompt).
			const viaClient = props.submitPrompt?.(sessionId, text);
			if (viaClient) {
				const result = await viaClient;
				if (!result.ok) throw new Error(result.error ?? "session/prompt rejected");
				// The client channel emits no SSE user line — mirror it locally.
				pushSubtitle("user", text);
			} else {
				// Fallback: plugin host route (requires an already-live agent);
				// it emits the user subtitle over SSE itself.
				await postMessage(sessionId, text);
			}
			setDraft("");
		} catch (error) {
			setToast(`发送失败：${String((error as Error)?.message ?? error)}`);
		} finally {
			setSending(false);
		}
	};

	return (
		<div ref={rootRef} className="lv-root">
			<div ref={stageRef} className="lv-stage" />

			{status !== "ready" && (
				<div className="lv-center">
					<div className="lv-card">
						{status === "boot" && <b>Live2D</b>}
						{status === "loading" && (
							<>
								<b>正在加载角色模型…</b>
								<br />
								{modelInfo?.name}
							</>
						)}
						{status === "no-model" && (
							<>
								<b>Live2D 角色未配置</b>
								<br />
								在 <b>~/.dsh/live2d-voice.json</b> 中设置 <b>modelPath</b> 指向包含
								.model3.json 的目录，保存后刷新本页。
								<br />
								角色、语音与字幕就绪后即可直接对话。
							</>
						)}
						{status === "core-missing" && (
							<>
								<b>Live2D Cubism Core 未加载</b>
								<br />
								插件脚本注入未生效，请重启 dsh 服务后刷新页面。
							</>
						)}
						{status === "error" && (
							<>
								<b>角色加载失败</b>
								<br />
								{errorText}
							</>
						)}
					</div>
				</div>
			)}

			<SubtitleOverlay lines={subtitles} visible={subtitlesOn} />

			{inputOpen && (
				<form
					className="lv-input"
					onSubmit={(event) => {
						event.preventDefault();
						void submitDraft();
					}}
				>
					<input
						ref={inputRef}
						value={draft}
						placeholder={`对角色说点什么…${sending ? "（发送中）" : ""}`}
						onChange={(event) => setDraft(event.target.value)}
					/>
					<button type="submit" disabled={!draft.trim() || sending}>
						发送
					</button>
				</form>
			)}

			{toast && <div className="lv-toast">{toast}</div>}

			<Hud
				faded={faded}
				muted={muted}
				subtitlesOn={subtitlesOn}
				inputOpen={inputOpen}
				popoverOpen={popoverOpen}
				presets={presets}
				currentVoiceId={voiceId}
				apiKeyCount={apiKeyCount}
				speechPrompt={speechPrompt}
				onToggleMute={toggleMute}
				onToggleSubtitles={toggleSubtitles}
				onToggleInput={() => setInputOpen((open) => !open)}
				onTogglePopover={() => setPopoverOpen((open) => !open)}
				onPickVoice={(preset) => void pickVoice(preset)}
				onSavePrompt={(text) => void savePrompt(text)}
			/>
		</div>
	);
}

/**
 * Bind the view to a submit channel (the client runtime's session face).
 * Keeps the component pure-testable: without a channel it falls back to the
 * plugin's own HTTP route.
 */
export function makeLive2DView(submitPrompt: SubmitPrompt): FC<ConvViewProps> {
	return function Live2DViewBound(props: ConvViewProps) {
		return <Live2DView {...props} submitPrompt={submitPrompt} />;
	};
}
