/**
 * Wire types shared by the Live2D view components (SSE payloads + public
 * config shape returned by /live2d-voice/config).
 */

export interface PublicConfig {
	modelPath: string;
	modelSelection: string;
	voiceId: string;
	ttsModel: string;
	apiKeyFile: string;
	sttLanguage: string;
	asrCredentialsFile: string;
	speechLanguage: string;
	subtitleLanguage: string;
	speechPrompt: string;
	eyeTracking: boolean;
	emotionMap: Record<string, number | string>;
	apiKeyCount: number;
	asrConfigured: boolean;
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
	/** The effective selection (equals name). */
	current?: string;
	/** The full catalog when modelPath is a directory of models. */
	models?: { name: string; url: string }[];
}

export interface ExpressionPayload {
	utteranceId: string;
	emotion: string;
	expression: number | string;
}

export interface AudioStartPayload {
	utteranceId: string;
	sampleRate: number;
}

export interface AudioPayload {
	utteranceId: string;
	seq: number;
	b64: string;
}

export interface SubtitlePayload {
	role: "assistant" | "user";
	text: string;
	utteranceId?: string;
	/** Stable per-sentence id — translations attach to it. */
	lineId?: string;
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
}

export interface ErrorPayload {
	message: string;
}

export interface StreamHandlers {
	onExpression?: (payload: ExpressionPayload) => void;
	onSpeechStart?: (payload: { utteranceId: string }) => void;
	onSpeechEnd?: (payload: SpeechEndPayload) => void;
	onAudioStart?: (payload: AudioStartPayload) => void;
	onAudio?: (payload: AudioPayload) => void;
	onAudioEnd?: (payload: { utteranceId: string }) => void;
	onSubtitle?: (payload: SubtitlePayload) => void;
	onSubtitleTranslation?: (payload: SubtitleTranslationPayload) => void;
	onCameraCapture?: (payload: CameraCapturePayload) => void;
	onError?: (payload: ErrorPayload) => void;
}
