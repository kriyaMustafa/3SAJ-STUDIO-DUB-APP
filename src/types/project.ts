export type SegmentStatus =
  | 'pending'
  | 'translating'
  | 'translated'
  | 'synthesizing'
  | 'ready'
  | 'error';

export type Gender = 'M' | 'F' | 'AUTO';

export type AgeTone = 'ADULT' | 'OLD' | 'KID';

export type TranslationMode = 'byok' | 'google_free' | 'manual_batch';

export type AIProvider = 'gemini' | 'openai' | 'claude' | 'deepseek';

export type VoiceMode = 'MALE_ONLY' | 'FEMALE_ONLY' | 'AUTO_DETECT';

export type BGMMode = 'OFF_DUCKING' | 'ON_DEMUCS' | 'MUTE_ORIGINAL';

export interface SubtitleSegment {
  id: number; // Strict Segment ID from original SRT
  startTime: number; // Milliseconds
  endTime: number; // Milliseconds
  startTimeFormatted: string; // e.g. "00:01:23,456"
  endTimeFormatted: string;
  originalText: string;
  translatedText: string;
  gender: Gender;
  ageTone: AgeTone;
  audioPath: string | null;
  durationMs: number | null;
  status: SegmentStatus;
  errorMessage?: string;
}

export interface Project {
  id: string;
  name: string;
  videoPath: string;
  srtPath: string;
  workspaceDir: string;
  createdAt: string;
  updatedAt: string;
  totalSegments: number;
  translatedSegments: number;
  audioSegments: number;
  exportPath?: string;
  isExported: boolean;
  lastCheckpointSegmentId: number;
}

export interface GlossaryEntry {
  id: string;
  source: string; // e.g., "萧炎" or "Medusa"
  target: string; // e.g., "សៀវយាន" or "មេឌូសា"
}

export interface TonePresetConfig {
  name: string;
  pitch: string; // e.g., "0Hz", "-18Hz", "+30Hz"
  rate: string; // e.g., "+0%", "-8%", "+10%"
  description: string;
}

export interface AppSettings {
  translationMode: TranslationMode;
  aiProvider: AIProvider;
  geminiModel: string;
  openaiModel: string;
  claudeModel: string;
  deepseekModel: string;
  batchSize: number; // 30, 50, 100
  voiceMode: VoiceMode;
  maleVoice: string; // default "km-KH-PisethNeural"
  femaleVoice: string; // default "km-KH-SreymomNeural"
  maxConcurrentTts: number; // 1 to 15
  autoTimeStretch: boolean;
  maxAtempo: number; // 1.45
  bgmMode: BGMMode;
  duckingVolume: number; // 0.12 (12%)
  demucsEndpoint: string; // e.g. "http://192.168.1.100:8000/api/separate"
  backendApiUrl: string; // e.g. "https://threesaj-studio-dub-app-734y.onrender.com"
  autoExport: boolean;
  workspaceDir: string;
}

export interface RangeRepairOptions {
  fromId: number;
  toId: number;
  action: 'retranslate' | 're_tts' | 'manual_edit';
  overrideGender?: Gender;
  overrideTone?: AgeTone;
  overrideText?: string;
}

export interface BatchCopyPasteUnit {
  batchIndex: number;
  fromId: number;
  toId: number;
  totalInBatch: number;
  isCompleted: boolean;
}
