/**
 * The Live2D conversation view (conversation.view slot entry).
 *
 * Stage = pixi Live2D model driven by the speech engine (mouth) and
 * expression events. Below it: subtitles, the HUD capsule, keyboard input,
 * the voice popover, and the continuous-listening voice input (VAD +
 * volcengine ASR relay with barge-in interruption). Toggles persist in
 * localStorage.
 */

import { useEffect, useRef, useState, type FC } from "react";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { fetchConfig, fetchModelInfo, openStream, postCameraResult, postMessage, recognizeUtterance, saveConfig } from "./api.js";
import { SpeechEngine } from "./engine.js";
import { Hud } from "./hud.js";
import { isCubismCoreLoaded, mountModel, type Live2DHandle } from "./model.js";
import { MicCapture, type MicState } from "./mic.js";
import { GazeTracker, capturePhoto } from "./gaze.js";
import { TiltParallax } from "./tilt.js";
import { SubtitleOverlay, SUBTITLE_TTL_MS, type SubtitleLine } from "./subtitle.js";
import type { LanguageOption, ModelInfo, VoicePreset } from "./types.js";

type Status = "boot" | "no-model" | "core-missing" | "loading" | "ready" | "error";

/** Minimal Screen Wake Lock Sentinel shape (not in older TS lib DOM). */
interface SentinelLike {
	release: () => Promise<void>;
	addEventListener?: (type: string, listener: () => void) => void;
}

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
	mode?: "queue" | "steer",
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
	// Toast throttle: repeated identical messages within 8s are dropped
	// (a flapping network must not turn into toast spam during long idle).
	const lastToastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
	const showToast = (text: string) => {
		const now = Date.now();
		if (lastToastRef.current.text === text && now - lastToastRef.current.at < 8000) return;
		lastToastRef.current = { text, at: now };
		setToast(text);
	};
	const [presets, setPresets] = useState<VoicePreset[]>([]);
	const [languages, setLanguages] = useState<LanguageOption[]>([]);
	const [voiceId, setVoiceId] = useState("");
	const [apiKeyCount, setApiKeyCount] = useState(-1);
	const [speechPrompt, setSpeechPrompt] = useState("");
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [fullscreen, setFullscreen] = useState(false);
	const [faded, setFaded] = useState(false);
	const activeUtterance = useRef("");

	// Voice input (continuous listening).
	const [micState, setMicState] = useState<MicState>("idle");
	const [micLevel, setMicLevel] = useState(0);
	const [asrPending, setAsrPending] = useState(false);
	const [asrConfigured, setAsrConfigured] = useState(false);
	const [sttLanguage, setSttLanguage] = useState("auto");
	const [eyeTracking, setEyeTracking] = useState(false);
	const gazeRef = useRef<GazeTracker | null>(null);
	const [gyroParallax, setGyroParallax] = useState(false);
	const tiltRef = useRef<TiltParallax | null>(null);
	// Mirror the turn-running flag for non-render callbacks (auto-submit mode).
	const sessionRunning = props.useSession?.((snapshot) => snapshot.running) ?? false;
	const sessionRunningRef = useRef(sessionRunning);
	sessionRunningRef.current = sessionRunning;
	const micRef = useRef<MicCapture | null>(null);
	// sttLanguage at recognition time (config may reload under us).
	const sttLanguageRef = useRef("auto");
	sttLanguageRef.current = sttLanguage;
	// Overlapping segment POSTs in flight (meter shows "识别中…" while > 0).
	const asrPendingCount = useRef(0);
	// Voice submissions are chained so recognition latency cannot reorder them.
	const voiceSubmitChainRef = useRef(Promise.resolve());
	// Mic toggle generation: bumps on stop, cancels an in-flight permission request.
	const micGenerationRef = useRef(0);
	// Meter throttle state (worklet reports ~94×/s).
	const lastLevelAtRef = useRef(0);
	const lastLevelRef = useRef(0);
	/** Rolling transcript of the character's recent speech (echo guard). */
	const assistantEchoRef = useRef("");

	const pushSubtitle = (role: SubtitleLine["role"], text: string, lineId?: string) => {
		if (role === "assistant") {
			// Rolling transcript of what the character said — the echo guard
			// compares incoming ASR text against it.
			assistantEchoRef.current = `${assistantEchoRef.current}\n${text}`.split("\n").slice(-3).join("\n");
		}
		setSubtitles((prev) => [...prev.slice(-5), { id: nextLineId.current++, role, text, lineId, at: Date.now() }]);
	};

	/** A translation landed for an earlier subtitle line — attach it. */
	const attachTranslation = (lineId: string, text: string) => {
		setSubtitles((prev) => prev.map((line) => (line.lineId === lineId ? { ...line, translation: text } : line)));
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

	// Config + model descriptor (workspace-overlaid for this session).
	// sessionId is a dependency: switching sessions must reload the overlay.
	useEffect(() => {
		fetchConfig(sessionId)
			.then(({ config, presets, languages: langs }) => {
				setPresets(presets);
				if (langs) setLanguages(langs);
				setVoiceId(config.voiceId);
				setApiKeyCount(config.apiKeyCount);
				setSpeechPrompt(config.speechPrompt);
				setAsrConfigured(config.asrConfigured);
				setSttLanguage(config.sttLanguage);
				setEyeTracking(config.eyeTracking);
				setGyroParallax(config.gyroParallax);
			})
			.catch((error) => console.error("[dsh-live2d-voice] config load failed", error));
		fetchModelInfo(sessionId)
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
	}, [sessionId]);

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
			onSubtitle: ({ role, text, lineId }) => pushSubtitle(role, text, lineId),
			onSubtitleTranslation: ({ lineId, text }) => attachTranslation(lineId, text),
			onCameraCapture: ({ requestId }) => {
				void (async () => {
					showToast("📸 正在通过前置摄像头拍摄…");
					const shot = await capturePhoto(gazeRef.current);
					if (!shot) showToast("摄像头不可用（未授权或无摄像头）");
					await postCameraResult(requestId, shot);
				})();
			},
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

	// Experimental gaze tracking lifecycle: the tracker runs while the
	// config says so; gaze position drives model.focus, and while active
	// the mouse focus is muted (model.setGazeMode).
	useEffect(() => {
		if (!eyeTracking) {
			gazeRef.current?.stop();
			gazeRef.current = null;
			modelRef.current?.setGazeMode(false);
			return undefined;
		}
		const tracker = new GazeTracker({
			onGaze: (x, y) => {
				const stage = stageRef.current;
				if (!stage) return;
				const width = stage.clientWidth;
				const height = stage.clientHeight;
				if (x === null) {
					modelRef.current?.focus(width / 2, height * 0.42);
					return;
				}
				// Amplify slightly so small head movements are readable.
				const gain = 1.4;
				modelRef.current?.focus(
					width * Math.min(1, Math.max(0, 0.5 + (x - 0.5) * gain)),
					height * Math.min(1, Math.max(0, 0.45 + (y - 0.5) * gain)),
				);
			},
			onState: (state) => {
				if (state === "starting") showToast("视线追踪启动中（首次需下载模型）…");
				else if (state === "tracking") modelRef.current?.setGazeMode(true);
				else if (typeof state === "object") showToast(`视线追踪不可用：${state.error}`);
			},
		});
		gazeRef.current = tracker;
		void tracker.start();
		return () => {
			tracker.stop();
			modelRef.current?.setGazeMode(false);
		};
	}, [eyeTracking]);

	// Experimental gyroscope parallax lifecycle.
	useEffect(() => {
		if (!gyroParallax) {
			tiltRef.current?.stop();
			tiltRef.current = null;
			modelRef.current?.setTilt(null);
			return undefined;
		}
		const parallax = new TiltParallax({
			onTilt: (state) => modelRef.current?.setTilt(state),
			onState: (state) => {
				if (state === "active") showToast("陀螺仪视差已开启（以当前姿势为正中）");
				else if (typeof state === "object") showToast(`陀螺仪视差不可用：${state.error}`);
			},
		});
		tiltRef.current = parallax;
		void parallax.start();
		return () => {
			parallax.stop();
			modelRef.current?.setTilt(null);
		};
	}, [gyroParallax]);

	// First-run hint (once): the icon-only HUD needs one pointer.
	useEffect(() => {
		if (window.localStorage.getItem("lv2d.hinted") === "1") return;
		window.localStorage.setItem("lv2d.hinted", "1");
		showToast("点 🎙 开始语音对话 · ⚙ 音色/语言设置 · ⛶ 全屏");
	}, []);

	// Fullscreen (immersive mode) + screen wake lock. The wake lock is the
	// "leave an old phone on this page" feature: while fullscreen and
	// listening, the screen stays on; it re-acquires after tab switches.
	const toggleFullscreen = () => {
		const root = rootRef.current;
		if (root === null) return;
		if (document.fullscreenElement === root) {
			void Promise.resolve(document.exitFullscreen?.()).catch(() => undefined);
			return;
		}
		// requestFullscreen is missing on iPhone Safari (sync TypeError).
		if (typeof root.requestFullscreen !== "function") {
			showToast("此浏览器不支持全屏");
			return;
		}
		void root.requestFullscreen().catch(() => showToast("此浏览器不允许全屏"));
	};

	useEffect(() => {
		const syncFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current);
		document.addEventListener("fullscreenchange", syncFullscreen);
		return () => document.removeEventListener("fullscreenchange", syncFullscreen);
	}, []);

	useEffect(() => {
		let sentinel: SentinelLike | null = null;
		let cancelled = false;
		const release = () => {
			try {
				void sentinel?.release();
			} catch {
				/* already released */
			}
			sentinel = null;
		};
		const acquire = async () => {
			if (cancelled || !fullscreen || micState !== "listening") return;
			const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<SentinelLike> } };
			if (!nav.wakeLock) return;
			try {
				const requested = await nav.wakeLock.request("screen");
				if (cancelled) {
					try {
						void requested.release();
					} catch {
						/* already gone */
					}
					return;
				}
				sentinel = requested;
				sentinel.addEventListener?.("release", release);
			} catch {
				/* wake lock denied (low battery etc.) — screen may sleep */
			}
		};
		void acquire();
		const onVisible = () => {
			if (document.visibilityState === "visible") void acquire();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", onVisible);
			release();
		};
	}, [fullscreen, micState]);

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
			await saveConfig({ voiceId: preset.voiceId });
			// Display what THIS session will actually use (workspace overlay
			// may shadow the global pick).
			const { config } = await fetchConfig(sessionId);
			setVoiceId(config.voiceId);
			setApiKeyCount(config.apiKeyCount);
			setPopoverOpen(false);
			setToast(config.voiceId === preset.voiceId ? `音色已切换：${preset.label}` : `已保存全局音色 ${preset.label}（本工作区配置了覆盖）`);
		} catch (error) {
			showToast(`音色切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const pickSttLanguage = async (id: string) => {
		try {
			const { config } = await saveConfig({ sttLanguage: id });
			setSttLanguage(config.sttLanguage);
			showToast(`识别语言：${languages.find((l) => l.id === id)?.label ?? id}`);
		} catch (error) {
			showToast(`切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const toggleGyroParallax = async () => {
		const next = !gyroParallax;
		try {
			const { config } = await saveConfig({ gyroParallax: next });
			setGyroParallax(config.gyroParallax);
			if (!config.gyroParallax) showToast("陀螺仪视差已关闭");
		} catch (error) {
			showToast(`切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const toggleEyeTracking = async () => {
		const next = !eyeTracking;
		try {
			const { config } = await saveConfig({ eyeTracking: next });
			setEyeTracking(config.eyeTracking);
			if (!config.eyeTracking) showToast("视线追踪已关闭");
		} catch (error) {
			showToast(`切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const pickModel = async (name: string) => {
		try {
			await saveConfig({ modelSelection: name });
			// Refetch the descriptor — the effect remounts the model.
			const info = await fetchModelInfo(sessionId);
			setModelInfo(info);
			setToast(info.current === name ? `角色已切换：${info.name ?? name}` : `已保存全局角色 ${name}（本工作区配置了覆盖）`);
		} catch (error) {
			showToast(`角色切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const savePrompt = async (text: string) => {
		try {
			const { config } = await saveConfig({ speechPrompt: text });
			setSpeechPrompt(config.speechPrompt);
			showToast(config.speechPrompt.trim() ? "自定义提示词已保存，下一句生效" : "自定义提示词已清空");
		} catch (error) {
			showToast(`保存失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	/** Submit a user line (keyboard draft or a finalized ASR utterance). */
	const submitText = async (text: string, mode: "queue" | "steer" = "queue"): Promise<boolean> => {
		if (!text.trim()) return false;
		try {
			// Canonical path: the GUI session channel (works for cold sessions —
			// the host creates/resumes the agent inside session/prompt).
			const viaClient = props.submitPrompt?.(sessionId, text, mode);
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
			// A new turn is coming — release any barge-in muzzle.
			engineRef.current?.unmuzzle();
			return true;
		} catch (error) {
			showToast(`发送失败：${String((error as Error)?.message ?? error)}`);
			return false;
		}
	};

	const submitDraft = async () => {
		const text = draft.trim();
		if (!text || sending) return;
		setSending(true);
		try {
			if (await submitText(text)) setDraft("");
		} finally {
			setSending(false);
		}
	};

	// ---- Continuous voice input ----

	const stopListening = () => {
		micGenerationRef.current += 1; // Cancel any in-flight permission request.
		micRef.current?.stop();
		micRef.current = null;
		engineRef.current?.unmuzzle();
		setMicState("idle");
		setMicLevel(0);
	};

	// Tear down mic on unmount or session switch.
	useEffect(() => stopListening, [sessionId]);

	/** Heuristic echo check: the ASR text mostly overlaps the character's recent speech. */
	const looksLikeEcho = (text: string): boolean => {
		const recent = assistantEchoRef.current;
		if (!recent) return false;
		const normalize = (s: string) => s.replace(/[\s，。！？、,.!?…~～「」『』（）()・]/g, "");
		const target = normalize(text);
		// Short replies（「はい」「うん」「好的」）almost always overlap the
		// character's recent lines — never treat them as echo.
		if (target.length < 4) return false;
		const source = normalize(recent);
		if (source.length < 2) return false;
		// Adjacent-bigram overlap: substring-level match, far fewer false
		// positives than per-character containment.
		const bigrams = new Set<string>();
		for (let i = 0; i + 1 < target.length; i++) bigrams.add(target.slice(i, i + 2));
		let hits = 0;
		for (const bigram of bigrams) if (source.includes(bigram)) hits++;
		return bigrams.size > 0 && hits / bigrams.size > 0.6;
	};

	const toggleMic = async () => {
		if (micState === "listening" || micState === "requesting") {
			stopListening();
			return;
		}
		if (!asrConfigured) {
			showToast("语音输入未配置：live2d-voice.json → asrCredentialsFile（火山引擎 ASR 凭证）");
			return;
		}
		setMicState("requesting");
		// Generation token: a second click while awaiting permission cancels
		// this attempt (its mic must not come back to life on resolve).
		const generation = ++micGenerationRef.current;
		const mic = new MicCapture({
			onLevel: (level) => {
				// Throttle meter re-renders: the worklet reports ~94×/s,
				// the bar only needs a dozen frames a second.
				const now = performance.now();
				if (now - lastLevelAtRef.current < 66 && Math.abs(level - lastLevelRef.current) < 0.2) return;
				lastLevelAtRef.current = now;
				lastLevelRef.current = level;
				setMicLevel(level);
				// Barge-in: talking over the character silences it — the whole
				// turn gets muzzled (its remaining sentences must not resume
				// over the user). engine.muzzle() carries its own 8s safety
				// that re-allows audio when no segment ever settles.
				if (engineRef.current?.speaking() && MicCapture.isBargeLevel(level)) {
					engineRef.current.muzzle();
					activeUtterance.current = ""; // Drop the rest of its audio too.
				}
			},
			onSegment: (pcm) => {
				// Snapshot per flight: a later segment must not overwrite
				// this one's echo-assessment (speaker-echo check below).
				const whileSpeaking = engineRef.current?.speaking() === true;
				asrPendingCount.current += 1;
				setAsrPending(true);
				void recognizeUtterance(pcm, sttLanguageRef.current)
					.then((text) => {
						if (!text.trim()) return;
						// Speaker echo: recognition of the character's own TTS.
						if (whileSpeaking && looksLikeEcho(text)) return;
						// Interrupt the running turn when the user talked over the AI;
						// otherwise append normally.
						const running = sessionRunningRef.current;
						const bargeInterrupt = engineRef.current?.speaking() === true;
						// Chain submissions so recognition latency jitter cannot
						// reorder two consecutive utterances.
						const submit = () =>
							submitText(text, running || bargeInterrupt ? "steer" : "queue").then(() => undefined);
						voiceSubmitChainRef.current = voiceSubmitChainRef.current.then(submit, submit);
					})
					.catch((error) => {
						showToast(`语音识别错误：${String((error as Error)?.message ?? error)}`);
					})
					.finally(() => {
						asrPendingCount.current -= 1;
						if (asrPendingCount.current <= 0) {
							asrPendingCount.current = 0;
							setAsrPending(false);
						}
						// Segment settled (submitted or dropped): release the
						// muzzle so the next turn can speak.
						engineRef.current?.unmuzzle();
					});
			},
			onError: (message) => {
				showToast(`麦克风错误：${message}`);
				stopListening();
			},
		});
		try {
			await mic.start();
		} catch (error) {
			const name = (error as Error)?.name ?? "";
			setMicState(name === "NotAllowedError" ? "denied" : "error");
			showToast(name === "NotAllowedError" ? "麦克风权限被拒绝，请在浏览器设置中允许" : `麦克风启动失败：${String((error as Error)?.message ?? error)}`);
			return;
		}
		// Cancelled while awaiting permission (double-click) — do not adopt.
		if (generation !== micGenerationRef.current) {
			mic.stop();
			return;
		}
		micRef.current = mic;
		setMicState("listening");
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

			<SubtitleOverlay lines={subtitles} visible={subtitlesOn} raised={micState === "listening" || micState === "requesting"} />

			{micState === "listening" && (
				<div className="lv-micbar">
					<span className={`lv-micdot${engineRef.current?.speaking() ? " lv-muted-dot" : ""}`} />
					<span className="lv-mic-label">
						{asrPending ? "识别中…" : micLevel > 0.04 ? "正在聆听…" : "倾听中（点 🎙 关闭）"}
					</span>
					<span className="lv-mic-meter">
						<span className="lv-mic-fill" style={{ width: `${Math.round(Math.min(1, micLevel) * 100)}%` }} />
					</span>
				</div>
			)}
			{micState === "requesting" && (
				<div className="lv-micbar">
					<span className="lv-micdot" />
					<span className="lv-mic-label">正在请求麦克风权限…</span>
				</div>
			)}

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

			{toast && <div className={`lv-toast${micState === "listening" || micState === "requesting" ? " lv-toast-raised" : ""}`}>{toast}</div>}

			<Hud
				faded={faded}
				muted={muted}
				subtitlesOn={subtitlesOn}
				inputOpen={inputOpen}
				popoverOpen={popoverOpen}
				micState={micState}
				asrConfigured={asrConfigured}
				fullscreen={fullscreen}
				onToggleFullscreen={toggleFullscreen}
				eyeTracking={eyeTracking}
				onToggleEyeTracking={() => void toggleEyeTracking()}
				gyroParallax={gyroParallax}
				onToggleGyroParallax={() => void toggleGyroParallax()}
				presets={presets}
				languages={languages}
				currentVoiceId={voiceId}
				currentSttLanguage={sttLanguage}
				models={modelInfo?.models ?? []}
				currentModel={modelInfo?.current}
				onPickModel={(name) => void pickModel(name)}
				apiKeyCount={apiKeyCount}
				speechPrompt={speechPrompt}
				onToggleMute={toggleMute}
				onToggleSubtitles={toggleSubtitles}
				onToggleInput={() => {
				setPopoverOpen(false);
				setInputOpen((open) => !open);
			}}
				onTogglePopover={() => {
				setInputOpen(false);
				setPopoverOpen((open) => !open);
			}}
				onToggleMic={() => void toggleMic()}
				onPickVoice={(preset) => void pickVoice(preset)}
				onPickSttLanguage={(id) => void pickSttLanguage(id)}
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
