/**
 * Wire types shared by the Live2D view components (SSE payloads + public
 * config shape returned by /live2d-voice/config).
 */

/** Who an utterance belongs to: the AI's avatar or the player's (third-person). */
export type Speaker = "assistant" | "player";

export interface PublicConfig {
	modelPath: string;
	modelSelection: string;
	voiceId: string;
	ttsModel: string;
	apiKeyFile: string;
	sttLanguage: string;
	asrCredentialsFile: string;
	/** "stream" (live bidirectional, default) | "nostream" (buffered one-shot). */
	asrMode: string;
	/** Microphone soft-gain (>1 amplifies before VAD/ASR). */
	micGain?: number;
	/** Browser-level noise suppression on the mic capture. */
	micNoiseSuppression?: boolean;
	speechLanguage: string;
	subtitleLanguage: string;
	/** Per-sentence subtitles/TTS (on by default); off → paragraph chunks. */
	sentenceSubtitles: boolean;
	speechPrompt: string;
	eyeTracking: boolean;
	gyroParallax: boolean;
	emotionMap: Record<string, number | string>;
	/** Third-person mode: the player avatar speaks the (polished) user line first. */
	thirdPerson: boolean;
	/** The player avatar's model (catalog entry name); empty = voice only. */
	playerModelSelection: string;
	/** The player avatar's Fish Audio voice. */
	playerVoiceId: string;
	/** Polish/translate the user's input into the player persona's line. */
	playerPolish: boolean;
	/** The language the player avatar speaks (polish target); auto = keep. */
	playerSpeechLanguage: string;
	/** The player persona description fed to the polish prompt. */
	playerPrompt: string;
	/** Emotion tag → player model expression map. */
	playerEmotionMap: Record<string, number | string>;
	apiKeyCount: number;
	asrConfigured: boolean;
	/** When set, the Live view auto-switches to this model on entry. */
	liveModel?: { provider: string; model: string; reasoningEffort?: string } | null;
}

export interface VoicePreset {
	id: string;
	label: string;
	voiceId: string;
}

export interface LanguageOption {
	id: string;
	label: string;
}

export interface ModelInfo {
	configured: boolean;
	url?: string;
	name?: string;
	/** 中文展示名。 */
	label?: string;
	/** 渲染格式：moc3 (Cubism 3+) 或 moc2 (Cubism 2.1 老格式)。 */
	kind?: "moc2" | "moc3";
	/** 分类名（模型库二级目录）；无分类时为 undefined。 */
	group?: string;
	/** 分类中文显示名。 */
	groupLabel?: string;
	/** The effective selection (equals name). */
	current?: string;
	/** The full catalog when modelPath is a directory of models. */
	models?: { name: string; label?: string; kind?: "moc2" | "moc3"; group?: string; groupLabel?: string; url: string }[];
	/** Third-person mode on (the stage hosts a second, player avatar). */
	thirdPerson?: boolean;
	/** The player avatar's model when third-person is on and a selection matches. */
	player?: { name: string; label?: string; kind?: "moc2" | "moc3"; url: string };
}

export interface ExpressionPayload {
	utteranceId: string;
	emotion: string;
	expression: number | string;
	/** Which avatar the expression drives (absent = assistant). */
	speaker?: Speaker;
}

export interface AudioStartPayload {
	utteranceId: string;
	sampleRate: number;
	/** Which avatar is about to speak (absent = assistant). */
	speaker?: Speaker;
}

export interface AudioPayload {
	utteranceId: string;
	seq: number;
	b64: string;
	/** Which avatar's voice this chunk carries (absent = assistant). */
	speaker?: Speaker;
}

export interface SubtitlePayload {
	role: "assistant" | "user";
	text: string;
	utteranceId?: string;
	/** Stable per-sentence id — translations attach to it. */
	lineId?: string;
	/**
	 * Audio seq of the sentence's first PCM chunk. The client shows the line
	 * when that chunk starts playing (host synthesis runs ahead of browser
	 * playback). Undefined → show immediately (no audio: no keys / TTS fail).
	 */
	audioSeq?: number;
	/** Which avatar said the line (absent = assistant). */
	speaker?: Speaker;
}

/** The camera tool asks the page for a photo (host → browser). */
export interface CameraCapturePayload {
	requestId: string;
}

/** A translated assistant subtitle line (arrives after its original). */
export interface SubtitleTranslationPayload {
	lineId: string;
	text: string;
}

export interface SpeechEndPayload {
	utteranceId: string;
	reason: "finish" | "aborted";
	/** Which avatar's speech ended (absent = assistant). */
	speaker?: Speaker;
}

export interface ErrorPayload {
	message: string;
}

/** One selectable reasoning effort level for a model. */
export interface ModelReasoningEffort {
	id: string;
	name: string;
	description?: string;
}

/** Reasoning metadata for one model route. */
export interface ModelReasoning {
	efforts: readonly ModelReasoningEffort[];
	defaultEffort?: string;
}

/** One model inside a provider group. */
export interface ModelCatalogModel {
	id: string;
	name: string;
	description?: string;
	reasoning?: ModelReasoning;
}

/** One provider and its models. */
export interface ModelProviderGroup {
	id: string;
	name: string;
	models: readonly ModelCatalogModel[];
}

/** Complete model selection (provider + model + optional effort). */
export interface ModelSelection {
	provider: string;
	model: string;
	reasoningEffort?: string;
}

/** The full catalog returned by GET /live2d-voice/model-catalog. */
export interface ModelCatalog {
	default: ModelSelection;
	routableProviders: readonly string[];
	groups: readonly ModelProviderGroup[];
}

export interface StreamHandlers {
	onExpression?: (payload: ExpressionPayload) => void;
	onSpeechStart?: (payload: { utteranceId: string; speaker?: Speaker }) => void;
	onSpeechEnd?: (payload: SpeechEndPayload) => void;
	onAudioStart?: (payload: AudioStartPayload) => void;
	onAudio?: (payload: AudioPayload) => void;
	onAudioEnd?: (payload: { utteranceId: string; speaker?: Speaker }) => void;
	onSubtitle?: (payload: SubtitlePayload) => void;
	onSubtitleTranslation?: (payload: SubtitleTranslationPayload) => void;
	onCameraCapture?: (payload: CameraCapturePayload) => void;
	/** Live ASR interim transcript (updates while the user is speaking). */
	onAsrInterim?: (payload: { text: string; up: string }) => void;
	/** Live ASR final transcript — submit this utterance. */
	onAsrFinal?: (payload: { text: string; up: string }) => void;
	onError?: (payload: ErrorPayload) => void;
}
