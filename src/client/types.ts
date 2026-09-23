/**
 * Wire types shared by the Live2D view components (SSE payloads + public
 * config shape returned by /live2d-voice/config).
 */

export interface PublicConfig {
	modelPath: string;
	voiceId: string;
	ttsModel: string;
	apiKeyFile: string;
	sttLanguage: string;
	speechPrompt: string;
	emotionMap: Record<string, number | string>;
	apiKeyCount: number;
}

export interface VoicePreset {
	id: string;
	label: string;
	voiceId: string;
}

export interface ModelInfo {
	configured: boolean;
	url?: string;
	name?: string;
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
	onError?: (payload: ErrorPayload) => void;
}
