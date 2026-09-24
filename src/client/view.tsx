/**
 * The Live2D conversation view (conversation.view slot entry).
 *
 * Stage = pixi Live2D model driven by the speech engine (mouth) and
 * expression events. Below it: subtitles, the HUD capsule, keyboard input,
 * the voice popover, and the continuous-listening voice input.
 */

import { useEffect, useRef, useState, useCallback, type FC } from "react";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { fetchConfig, fetchModelInfo, fetchModelCatalog, fetchModelSelection, openStream, postMessage, recognizeUtterance, saveConfig, selectModel, postCameraResult, startAsrUpload, type AsrUpload } from "./api.js";
import { SpeechEngine } from "./engine.js";
import { Hud } from "./hud.js";
import { isCubismCoreLoaded, mountModel, DEFAULT_LOOK_PARAMS, type Live2DHandle, type LookParams } from "./model.js";
import { MicCapture, type MicState } from "./mic.js";
import { GazeTracker, capturePhoto } from "./gaze.js";
import { TiltParallax } from "./tilt.js";
import { SubtitleOverlay, SUBTITLE_TTL_MS, type SubtitleLine } from "./subtitle.js";
import type { LanguageOption, ModelCatalog, ModelInfo, ModelSelection, VoicePreset } from "./types.js";
import { LevelMeter } from "./level-meter.js";
import { IconSpinner, IconSend } from "./icons.js";
import { logger } from "./logger.js";
import { ErrorBoundary } from "./error-boundary.js";

type Status = "boot" | "no-model" | "core-missing" | "loading" | "ready" | "error";

interface SentinelLike {
	release: () => Promise<void>;
	addEventListener?: (type: string, listener: () => void) => void;
}

const HUD_IDLE_FADE_MS = 2500;

export type SubmitPrompt = (
	sessionId: string,
	text: string,
	mode?: "queue" | "steer",
) => Promise<{ ok: boolean; error?: string }> | undefined;

type ViewProps = ConvViewProps & { submitPrompt?: SubmitPrompt; standalone?: boolean };

/** localStorage key for persisted look params (sliders / presets). */
const LOOK_PARAMS_STORE = "lv-look-params-v1";

/** Restore persisted look params, falling back to defaults. */
function loadLookParams(): LookParams {
	try {
		const stored = localStorage.getItem(LOOK_PARAMS_STORE);
		if (stored) return { ...DEFAULT_LOOK_PARAMS, ...(JSON.parse(stored) as Partial<LookParams>) };
	} catch {
		/* corrupted store — fall back to defaults */
	}
	return { ...DEFAULT_LOOK_PARAMS };
}

export function Live2DView(props: ViewProps) {
	const sessionId = String(props.sessionId);
	const rootRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const engineRef = useRef<SpeechEngine | null>(null);
	const modelRef = useRef<Live2DHandle | null>(null);
	const nextLineId = useRef(1);

	useEffect(() => {
		logger.setSessionId(sessionId);
		logger.installGlobalErrorHandlers();
		logger.info(`Live2D view mounted for session: ${sessionId.slice(0, 8)}`);
	}, [sessionId]);

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
	const [asrMode, setAsrMode] = useState("stream");
	const asrModeRef = useRef("stream");
	asrModeRef.current = asrMode;
	/** Live interim transcript shown in the mic bar while listening. */
	const [interimText, setInterimText] = useState("");
	const [eyeTracking, setEyeTracking] = useState(false);
	const gazeRef = useRef<GazeTracker | null>(null);
	const [gyroParallax, setGyroParallax] = useState(false);
	const tiltRef = useRef<TiltParallax | null>(null);
	const camLookRef = useRef<{ dx: number; dy: number } | null>(null);
	const gyroLookRef = useRef<{ dx: number; dy: number } | null>(null);
	// Look params persist locally (client-side preference — no server round-trip).
	const lookParamsRef = useRef<LookParams>(loadLookParams());
	/** State mirror so the HUD sliders re-render on change. */
	const [lookParams, setLookParams] = useState<LookParams>(lookParamsRef.current);

	// LLM model catalog and current selection for the model selector.
	const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
	const [currentModelSelection, setCurrentModelSelection] = useState<ModelSelection | null>(null);

	// Refs for live-model auto-switch: save the original selection on entry,
	// restore it on exit.
	const originalModelRef = useRef<ModelSelection | null>(null);
	const liveModelAppliedRef = useRef(false);

	const sessionRunning = props.useSession?.((snapshot) => snapshot.running) ?? false;
	const sessionRunningRef = useRef(sessionRunning);
	sessionRunningRef.current = sessionRunning;
	const micRef = useRef<MicCapture | null>(null);
	const sttLanguageRef = useRef("auto");
	sttLanguageRef.current = sttLanguage;
	const asrPendingCount = useRef(0);
	const segmentWhileSpeakingRef = useRef(false);
	const assistantEchoRef = useRef("");
	/** The live upload feeding the current speech segment (streaming ASR). */
	const asrUploadRef = useRef<AsrUpload | null>(null);
	/** The upload id of the utterance this view is currently speaking into. */
	const currentUploadRef = useRef<string | null>(null);

	const pushSubtitle = (role: SubtitleLine["role"], text: string, lineId?: string) => {
		if (role === "assistant") {
			assistantEchoRef.current = `${assistantEchoRef.current}\n${text}`.split("\n").slice(-3).join("\n");
		}
		setSubtitles((prev) => [...prev.slice(-5), { id: nextLineId.current++, role, text, lineId, at: Date.now() }]);
	};

	const attachTranslation = (lineId: string, text: string) => {
		setSubtitles((prev) => prev.map((line) => (line.lineId === lineId ? { ...line, translation: text } : line)));
	};

	useEffect(() => {
		const engine = new SpeechEngine();
		engine.setMuted(window.localStorage.getItem("lv2d.muted") === "1");
		engineRef.current = engine;
		return () => {
			engineRef.current = null;
			engine.destroy();
		};
	}, []);

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
				setAsrMode(config.asrMode || "stream");
				micGainRef.current = typeof config.micGain === "number" && config.micGain > 0 ? config.micGain : 1.5;
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

		// Fetch the LLM model catalog and the session's current selection.
		fetchModelCatalog()
			.then((catalog) => {
				setModelCatalog(catalog);
				setCurrentModelSelection(catalog.default);
			})
			.catch((error) => console.error("[dsh-live2d-voice] model catalog load failed", error));

		fetchModelSelection(sessionId)
			.then((selection) => setCurrentModelSelection(selection))
			.catch(() => undefined); // blank sessions may not have a selection yet
	}, [sessionId]);

	// Live-model auto-switch: when the view mounts and the plugin config
	// specifies a liveModel, save the session's current selection and switch
	// to it.  On unmount (leaving the Live view), restore the original.
	useEffect(() => {
		if (!sessionId) return;
		let cancelled = false;
		Promise.all([
			fetchConfig(sessionId),
			fetchModelSelection(sessionId).catch(() => null),
		])
			.then(([data, currentSel]) => {
				if (cancelled) return;
				const lm = data.config.liveModel;
				if (!lm || !currentSel) return;
				const needsSwitch =
					lm.provider !== currentSel.provider ||
					lm.model !== currentSel.model ||
					(lm.reasoningEffort ?? undefined) !== (currentSel.reasoningEffort ?? undefined);
				if (!needsSwitch) return;
				originalModelRef.current = currentSel;
				void selectModel(sessionId, lm.provider, lm.model, lm.reasoningEffort)
					.then((result) => {
						if (cancelled) return;
						setCurrentModelSelection(result.selected);
						liveModelAppliedRef.current = true;
						showToast(`已切换到 Live 专用模型：${result.selected.model}`);
					})
					.catch((error: unknown) => {
						if (cancelled) return;
						showToast(`模型自动切换失败：${String((error as Error)?.message ?? error)}`);
					});
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
			if (liveModelAppliedRef.current && originalModelRef.current) {
				const orig = originalModelRef.current;
				void selectModel(sessionId, orig.provider, orig.model, orig.reasoningEffort)
					.then(() => showToast("已恢复原模型"))
					.catch(() => undefined);
			}
			liveModelAppliedRef.current = false;
			originalModelRef.current = null;
		};
	}, [sessionId]);

	const reloadModel = useCallback(() => {
		logger.info("Explicit reloadModel requested");
		setModelInfo((prev) => (prev ? { ...prev } : prev));
	}, []);

	// Live2D model lifecycle.
	useEffect(() => {
		const rawUrl = modelInfo?.url;
		if (!rawUrl || !stageRef.current) return;
		if (!isCubismCoreLoaded()) {
			logger.warn("Live2D Cubism Core not loaded in window.Live2DCubismCore");
			setStatus("core-missing");
			return;
		}
		// Append cache-busting timestamp to model URL so updated textures or models are not stuck on old browser cache
		const url = rawUrl.includes("?") ? `${rawUrl}&_v=${Date.now()}` : `${rawUrl}?_v=${Date.now()}`;
		let cancelled = false;
		let handle: Live2DHandle | null = null;
		setStatus("loading");
		logger.info(`Mounting Live2D model: ${modelInfo?.name || "unknown"}`);

		// Add a microtask / short debounce to prevent rapid consecutive model switching from trampling WebGL context
		const mountPromise = mountModel(
			stageRef.current,
			url,
			() => {
				engineRef.current?.tick();
				return engineRef.current?.mouthValue() ?? 0;
			},
			() => {
				// WebGL context lost or restored: reload model
				logger.warn("WebGL context lost callback triggered, requesting model reload");
				reloadModel();
			},
		);

		mountPromise
			.then((mounted) => {
				if (cancelled) {
					try {
						mounted.destroy();
					} catch (err) {
						logger.warn("mounted.destroy threw error, safely suppressed", err);
					}
					return;
				}
				handle = mounted;
				modelRef.current = mounted;
				setStatus("ready");
				logger.info(`Live2D model ready: ${modelInfo?.name}`);
				if (gazeRef.current?.active || tiltRef.current?.active) { modelRef.current?.setLook(camLookRef.current, gyroLookRef.current); modelRef.current?.setLookParams(lookParamsRef.current); }
			})
			.catch((error) => {
				if (cancelled) return;
				logger.error(`Live2D mount failed for ${modelInfo?.name}`, error);
				setStatus("error");
				setErrorText(String((error as Error)?.message ?? error));
			});
		return () => {
			cancelled = true;
			modelRef.current = null;
			if (handle) {
				try {
					handle.destroy();
				} catch (err) {
					logger.warn("handle.destroy threw error, safely suppressed", err);
				}
			}
		};
	}, [modelInfo?.url, reloadModel]);

	// Gaze tracking lifecycle: the tracker owns the front camera while the
	// config says so; normalized gaze (dx/dy in -1..1) lands in camLookRef.
	useEffect(() => {
		if (!eyeTracking) {
			gazeRef.current?.stop();
			gazeRef.current = null;
			camLookRef.current = null;
			return undefined;
		}
		const tracker = new GazeTracker({
			onGaze: (x, y) => {
				camLookRef.current = x === null ? null : { dx: (x - 0.5) * 2, dy: (y - 0.5) * 2 };
			},
			onState: (state) => {
				if (state === "starting") {
					// The MediaPipe task (~6 MB) downloads on the very first run only.
					const GAZE_FIRST = "lv-gaze-first-run";
					const first = !localStorage.getItem(GAZE_FIRST);
					if (first) {
						try {
							localStorage.setItem(GAZE_FIRST, "1");
						} catch {
							/* best-effort */
						}
					}
					showToast(first ? "视线追踪启动中（首次需下载识别模型，请稍候）…" : "视线追踪启动中…");
				} else if (typeof state === "object") showToast(`视线追踪不可用：${state.error}`);
			},
		});
		gazeRef.current = tracker;
		void tracker.start();
		return () => {
			tracker.stop();
			camLookRef.current = null;
		};
	}, [eyeTracking]);

	// Gyroscope parallax lifecycle: normalized tilt (dx/dy in -1..1) lands
	// in gyroLookRef; the current pose at start becomes the center.
	useEffect(() => {
		if (!gyroParallax) {
			tiltRef.current?.stop();
			tiltRef.current = null;
			gyroLookRef.current = null;
			return undefined;
		}
		const parallax = new TiltParallax({
			onTilt: (state) => {
				gyroLookRef.current = { dx: state.dx, dy: state.dy };
			},
			onState: (state) => {
				if (state === "active") showToast("陀螺仪视差已开启（以当前姿势为正中）");
				else if (typeof state === "object") showToast(`陀螺仪视差不可用：${state.error}`);
			},
		});
		tiltRef.current = parallax;
		void parallax.start();
		return () => {
			parallax.stop();
			gyroLookRef.current = null;
		};
	}, [gyroParallax]);

	// Unified look loop: while any motion source is active, drive the model
	// every frame from the latest cam/gyro vectors and current look params.
	useEffect(() => {
		let raf = 0;
		const tick = () => {
			if (gazeRef.current?.active || tiltRef.current?.active) {
				modelRef.current?.setLook(camLookRef.current, gyroLookRef.current);
			}
			raf = window.requestAnimationFrame(tick);
		};
		raf = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(raf);
	}, []);

	// SSE stream
	useEffect(() => {
		if (!sessionId) return undefined;
		const close = openStream(sessionId, {
			onExpression: ({ expression, utteranceId }) => {
				if (utteranceId !== activeUtterance.current) return;
				modelRef.current?.setExpression(expression);
			},
			onSpeechStart: ({ utteranceId }) => {
				if (utteranceId !== activeUtterance.current) {
					activeUtterance.current = utteranceId;
					engineRef.current?.stop();
				}
				void engineRef.current?.resume();
			},
			onSpeechEnd: ({ utteranceId, reason }) => {
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
					showToast("正在通过前置摄像头拍摄…");
					const shot = await capturePhoto(gazeRef.current);
					if (!shot) showToast("摄像头不可用（未授权或无摄像头）");
					await postCameraResult(requestId, shot);
				})();
			},
			onAsrInterim: ({ text, up }) => {
				if (asrModeRef.current !== "stream") return;
				// Only the view that uploaded this utterance shows its live
				// transcript — kept-alive view instances must stay silent.
				if (up !== currentUploadRef.current) return;
				setInterimText(text);
			},
			onAsrFinal: ({ text, up }) => {
				if (asrModeRef.current !== "stream") return;
				// Submit only the utterance THIS view uploaded; any other
				// view instance that hears the same asr-final must not
				// re-submit it (that is how duplicate messages happened).
				if (up !== currentUploadRef.current) return;
				handleAsrFinalText(text);
			},
			onError: ({ message }) => {
				pushSubtitle("error", message);
				// A stream failure settles the pending segment (no asr-final
				// will arrive) so the pending counter cannot latch.
				finishAsrSegment();
			},
		});
		return close;
	}, [sessionId]);

	// First-run hint
	useEffect(() => {
		if (window.localStorage.getItem("lv2d.hinted") === "1") return;
		window.localStorage.setItem("lv2d.hinted", "1");
		showToast("点击麦克风开启免键盘对话，滑块可快捷调节角色与音色");
	}, []);

	// Fullscreen & Wake Lock
	const toggleFullscreen = () => {
		const root = rootRef.current;
		if (root === null) return;
		if (document.fullscreenElement === root) {
			void Promise.resolve(document.exitFullscreen?.()).catch(() => undefined);
			return;
		}
		if (typeof root.requestFullscreen !== "function") {
			showToast("当前浏览器环境不支持全屏");
			return;
		}
		void root.requestFullscreen().catch(() => showToast("进入全屏失败"));
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
			if (sentinel) {
				try {
					if (typeof sentinel.release === "function") {
						void sentinel.release().catch(() => undefined);
					}
				} catch {}
				sentinel = null;
			}
		};
		const acquire = async () => {
			if (cancelled || !fullscreen || micState !== "listening") return;
			const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<SentinelLike> } };
			if (!nav.wakeLock) return;
			try {
				const requested = await nav.wakeLock.request("screen");
				if (cancelled) {
					if (requested && typeof requested.release === "function") {
						try {
							void requested.release().catch(() => undefined);
						} catch {}
					}
					return;
				}
				sentinel = requested;
				if (sentinel && typeof sentinel.addEventListener === "function") {
					sentinel.addEventListener("release", release);
				}
			} catch {}
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

	// Subtitle sweep
	useEffect(() => {
		const timer = window.setInterval(() => {
			setSubtitles((prev) => prev.filter((line) => Date.now() - line.at < SUBTITLE_TTL_MS * 1.5));
		}, 1000);
		return () => window.clearInterval(timer);
	}, []);

	// Mount indicator for host CSS suppression
	useEffect(() => {
		document.body.dataset.live2dActive = "true";
		return () => {
			delete document.body.dataset.live2dActive;
		};
	}, []);

	// Toast auto-dismiss
	useEffect(() => {
		if (!toast) return undefined;
		const timer = window.setTimeout(() => setToast(null), 5000);
		return () => window.clearTimeout(timer);
	}, [toast]);

	// Dynamic bottom clearance: host composer is hidden when Live2D is active.
	// Only reserve space if an external composer is actually visible and takes height.
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;

		const updateClearance = () => {
			const seat = document.querySelector(".wSkVaW_composerSeat") || document.querySelector("[class*='composerSeat']");
			if (seat && getComputedStyle(seat).display !== "none") {
				const h = seat.getBoundingClientRect().height;
				root.style.setProperty("--lv-chrome-bottom", `${Math.max(20, Math.round(h + 8))}px`);
			} else {
				root.style.setProperty("--lv-chrome-bottom", "20px");
			}
		};

		updateClearance();
		const ro = new ResizeObserver(updateClearance);
		const seat = document.querySelector(".wSkVaW_composerSeat") || document.querySelector("[class*='composerSeat']");
		if (seat) ro.observe(seat);

		return () => ro.disconnect();
	}, []);

	// HUD auto-fade
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
			const { config } = await fetchConfig(sessionId);
			setVoiceId(config.voiceId);
			setApiKeyCount(config.apiKeyCount);
			setPopoverOpen(false);
			showToast(config.voiceId === preset.voiceId ? `音色已切换：${preset.label}` : `已保存全局音色 ${preset.label}（本工作区配置了覆盖）`);
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

	/** Live-update look params: ref + state + model, no round-trip to the server. */
	const changeLookParams = (patch: Partial<LookParams>) => {
		lookParamsRef.current = { ...lookParamsRef.current, ...patch };
		setLookParams(lookParamsRef.current);
		modelRef.current?.setLookParams(lookParamsRef.current);
		try {
			localStorage.setItem(LOOK_PARAMS_STORE, JSON.stringify(lookParamsRef.current));
		} catch {
			/* quota / private mode — persistence is best-effort */
		}
	};


	const pickModel = async (name: string) => {
		try {
			await saveConfig({ modelSelection: name });
			const info = await fetchModelInfo(sessionId);
			setModelInfo(info);
			showToast(info.current === name ? `角色已切换：${info.label ?? info.name ?? name}` : `已保存全局角色 ${info.label ?? name}（本工作区配置了覆盖）`);
		} catch (error) {
			showToast(`角色切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const handleSelectModel = async (provider: string, model: string, reasoningEffort?: string) => {
		try {
			const { selected } = await selectModel(sessionId, provider, model, reasoningEffort);
			setCurrentModelSelection(selected);
			showToast(`模型已切换：${selected.model}`);
		} catch (error) {
			showToast(`模型切换失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const savePrompt = async (text: string) => {
		try {
			const { config } = await saveConfig({ speechPrompt: text });
			setSpeechPrompt(config.speechPrompt);
			showToast(config.speechPrompt.trim() ? "自定义指令已保存" : "自定义指令已清空");
		} catch (error) {
			showToast(`保存失败：${String((error as Error)?.message ?? error)}`);
		}
	};

	const submitText = async (text: string, mode: "queue" | "steer" = "queue"): Promise<boolean> => {
		if (!text.trim()) return false;
		try {
			const viaClient = props.submitPrompt?.(sessionId, text, mode);
			if (viaClient) {
				const result = await viaClient;
				if (!result.ok) throw new Error(result.error ?? "session/prompt rejected");
				pushSubtitle("user", text);
			} else {
				await postMessage(sessionId, text, mode);
			}
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

	const stopListening = () => {
		micRef.current?.stop();
		micRef.current = null;
		asrUploadRef.current?.abort();
		asrUploadRef.current = null;
		currentUploadRef.current = null;
		engineRef.current?.unmuzzle();
		setMicState("idle");
		setMicLevel(0);
		setInterimText("");
	};

	useEffect(() => stopListening, [sessionId]);

	const looksLikeEcho = (text: string): boolean => {
		const recent = assistantEchoRef.current;
		if (!recent) return false;
		const normalize = (s: string) => s.replace(/[\s，。！？、,.!?…~～「」『』（）()・]/g, "");
		const target = normalize(text);
		if (target.length === 0) return false;
		const source = normalize(recent);
		let hits = 0;
		for (const ch of target) if (source.includes(ch)) hits++;
		return hits / target.length > 0.6;
	};

	/** Account for one settled ASR segment (submitted, dropped, or failed). */
	const finishAsrSegment = () => {
		asrPendingCount.current -= 1;
		if (asrPendingCount.current <= 0) {
			asrPendingCount.current = 0;
			setAsrPending(false);
		}
		currentUploadRef.current = null;
		engineRef.current?.unmuzzle();
		setInterimText("");
	};

	/** The streaming path's final transcript — submit it like a text message. */
	const handleAsrFinalText = (text: string) => {
		if (asrModeRef.current !== "stream") return;
		try {
			if (!text.trim()) return;
			if (segmentWhileSpeakingRef.current && looksLikeEcho(text)) return;
			const running = sessionRunningRef.current;
			const bargeInterrupt = engineRef.current?.speaking() === true;
			void submitText(text, running || bargeInterrupt ? "steer" : "queue");
		} finally {
			finishAsrSegment();
		}
	};

	const toggleMic = async () => {
		if (micState === "listening" || micState === "requesting") {
			stopListening();
			return;
		}
		if (!asrConfigured) {
			showToast("语音输入未配置（可在设置中配置火山 ASR 凭证）");
			return;
		}
		setMicState("requesting");
		const mic = new MicCapture(
			{
				onLevel: (level) => {
				setMicLevel(level);
				if (engineRef.current?.speaking() && MicCapture.isBargeLevel(level)) {
					engineRef.current.muzzle();
					activeUtterance.current = "";
				}
			},
			// Streaming path (default): relay every in-speech frame into the
			// live upload; the VAD boundaries open (with the pre-roll) and
			// close the utterance; the final transcript arrives over SSE.
			onPcm: (pcm) => {
				if (asrModeRef.current !== "stream") return;
				asrUploadRef.current?.push(pcm);
			},
			onSpeechStart: (preRoll) => {
				if (asrModeRef.current !== "stream") return;
				if (asrUploadRef.current !== null) return;
				segmentWhileSpeakingRef.current = engineRef.current?.speaking() === true;
				asrPendingCount.current += 1;
				setAsrPending(true);
				const upload = startAsrUpload(sessionId, sttLanguageRef.current);
				asrUploadRef.current = upload;
				currentUploadRef.current = upload.uploadId;
				for (const frame of preRoll) upload.push(frame);
				upload.done.catch((error) => {
					if (asrModeRef.current !== "stream") return;
					showToast(`语音识别错误：${String((error as Error)?.message ?? error)}`);
				});
			},
			onSpeechEnd: (kind) => {
				if (asrModeRef.current !== "stream") return;
				const upload = asrUploadRef.current;
				if (upload === null) return;
				asrUploadRef.current = null;
				if (kind === "blip") {
					// Too short to be an utterance — discard without a result.
					upload.abort();
					currentUploadRef.current = null;
					finishAsrSegment();
				} else {
					// release / forced — finalize; asr-final owns the submit.
					upload.finish();
				}
			},
			// Buffered path (nostream): the whole VAD-closed segment is
			// recognized in one request.
			onSegment: (pcm) => {
				segmentWhileSpeakingRef.current = engineRef.current?.speaking() === true;
				asrPendingCount.current += 1;
				setAsrPending(true);
				void recognizeUtterance(pcm, sttLanguageRef.current)
					.then((text) => {
						if (!text.trim()) return;
						if (segmentWhileSpeakingRef.current && looksLikeEcho(text)) return;
						const running = sessionRunningRef.current;
						const bargeInterrupt = engineRef.current?.speaking() === true;
						void submitText(text, running || bargeInterrupt ? "steer" : "queue");
					})
					.catch((error) => {
						showToast(`语音识别错误：${String((error as Error)?.message ?? error)}`);
					})
					.finally(() => {
						finishAsrSegment();
					});
			},
			onError: (message) => {
				showToast(`麦克风错误：${message}`);
				stopListening();
			},
		}, { gain: micGainRef.current });
		try {
			await mic.start();
		} catch (error) {
			const name = (error as Error)?.name ?? "";
			setMicState(name === "NotAllowedError" ? "denied" : "error");
			showToast(name === "NotAllowedError" ? "麦克风权限被拒绝，请在浏览器设置中允许" : `麦克风启动失败：${String((error as Error)?.message ?? error)}`);
			return;
		}
		micRef.current = mic;
		setMicState("listening");
	};

	return (
		<div ref={rootRef} className="lv-root" data-no-gesture>
			<div className="lv-ambient" />
			<div ref={stageRef} className="lv-stage" />

			{status !== "ready" && (
				<div className="lv-center">
					<div className="lv-card">
						{status === "boot" && <b>Live2D</b>}
						{status === "loading" && (
							<>
								<b>正在加载角色模型…</b>
								<br />
								{modelInfo?.label ?? modelInfo?.name}
							</>
						)}
						{status === "no-model" && (
							<>
								<b>Live2D 角色未配置</b>
								<br />
								在系统设置中设置 <b>modelPath</b> 指向包含 <code>.model3.json</code> 的目录即可开启对话。
							</>
						)}
						{status === "core-missing" && (
							<>
								<b>Live2D Cubism Core 未就绪</b>
								<br />
								请刷新页面重试。
							</>
						)}
						{status === "error" && (
							<>
								<b>角色加载失败</b>
								<br />
								<span style={{ wordBreak: "break-all" }}>{errorText}</span>
								<div className="lv-card-actions">
									<button type="button" className="lv-card-btn lv-card-btn-primary" onClick={reloadModel}>
										重试加载
									</button>
								</div>
							</>
						)}
					</div>
				</div>
			)}

			<SubtitleOverlay lines={subtitles} visible={subtitlesOn} raised={micState === "listening" || micState === "requesting"} />

			{micState === "listening" && (
				<div className="lv-micbar">
					<LevelMeter level={micLevel} mode={engineRef.current?.speaking() ? "muted" : asrPending ? "pulsing" : "normal"} />
					<span className="lv-mic-label">
						{asrPending
							? interimText
								? interimText
								: "识别中…"
							: engineRef.current?.speaking()
								? "角色说话中（开口可打断）"
								: micLevel > 0.04
									? "正在聆听…"
									: "倾听中，说完自动发送"}
					</span>
				</div>
			)}
			{micState === "requesting" && (
				<div className="lv-micbar">
					<IconSpinner size={16} />
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
						<IconSend size={15} />
						<span>发送</span>
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
				onOpenStandalone={
					props.standalone
						? undefined
						: () => window.open(`/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, "_blank", "noopener")
				}
				eyeTracking={eyeTracking}
				onToggleEyeTracking={() => void toggleEyeTracking()}
				gyroParallax={gyroParallax}
				onToggleGyroParallax={() => void toggleGyroParallax()}
				lookParams={lookParams}
				onLookParamsChange={changeLookParams}
				presets={presets}
				languages={languages}
				currentVoiceId={voiceId}
				currentSttLanguage={sttLanguage}
				models={modelInfo?.models ?? []}
				currentModel={modelInfo?.current}
				onPickModel={(name) => void pickModel(name)}
				modelCatalog={modelCatalog}
				currentModelSelection={currentModelSelection}
				onSelectModel={(provider, model, effort) => void handleSelectModel(provider, model, effort)}
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
				onOpenGlobalSettings={() => {
					// 导航至系统设置
					const btn = document.querySelector('button[title*="Settings"], button[title*="设置"]') as HTMLElement | null;
					btn?.click();
				}}
			/>
		</div>
	);
}

export function makeLive2DView(submitPrompt: SubmitPrompt): FC<ConvViewProps> {
	return function Live2DViewBound(props: ConvViewProps) {
		const [remountKey, setRemountKey] = useState(0);
		return (
			<ErrorBoundary
				key={remountKey}
				fallbackTitle="Live2D 角色视图渲染异常"
				onReset={() => setRemountKey((k) => k + 1)}
			>
				<Live2DView {...props} submitPrompt={submitPrompt} />
			</ErrorBoundary>
		);
	};
}
