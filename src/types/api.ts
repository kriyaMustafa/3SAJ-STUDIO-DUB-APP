import { SubtitleSegment } from './project';

export interface TranslationPromptConfig {
  segments: SubtitleSegment[];
  glossary?: Record<string, string>;
  isAutoVoiceTagging: boolean;
  systemPrompt: string;
}

export interface ParsedSegmentResult {
  id: number;
  gender?: 'M' | 'F';
  ageTone?: 'ADULT' | 'OLD' | 'KID';
  translatedText: string;
}

export interface EdgeTtsRequest {
  text: string;
  voice: string; // e.g. "km-KH-PisethNeural" or "km-KH-SreymomNeural"
  pitch: string; // e.g. "-15Hz", "+30Hz", "0Hz"
  rate: string;  // e.g. "-8%", "+10%", "+0%"
  outputPath: string;
}

export interface DemucsSeparateResponse {
  success: boolean;
  vocalsPath?: string;
  bgmPath?: string;
  error?: string;
}
