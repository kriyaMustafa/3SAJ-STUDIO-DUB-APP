import { GlossaryEntry, SubtitleSegment } from '../../types/project';

export const BASE_SYSTEM_PROMPT = `You are an expert translator into Cambodian Khmer language (ភាសាខ្មែរ).
Translate the following numbered subtitle segments into natural, engaging spoken Cambodian Khmer script (អក្សរខ្មែរ) suitable for voice-over dubbing.
STRICT RULES:
1. Always output the translation strictly in authentic Cambodian Khmer script (អក្សរខ្មែរ). Never output Chinese or romanized text.
2. Preserve the exact segment ID in brackets at the start of every line. NEVER merge, skip, or renumber IDs.
3. If Auto-Gender/Age mode is enabled, append [M] or [F] and [ADULT], [OLD], or [KID] right after the ID.
4. Keep sentence length concise so spoken Khmer fits the original timing.
5. Format strictly as:
[ID][M/F][ADULT/OLD/KID] អក្សរខ្មែរនៅទីនេះ`;

/**
 * Builds the complete prompt including glossary instructions and segments.
 */
export function buildPromptWithGlossary(
  segments: SubtitleSegment[],
  glossary: GlossaryEntry[] = [],
  autoVoiceTagging: boolean = true
): string {
  let prompt = BASE_SYSTEM_PROMPT;

  if (glossary.length > 0) {
    prompt += `\n\nCUSTOM GLOSSARY / NAME LOCK (Always use these exact Khmer terms):`;
    for (const entry of glossary) {
      if (entry.source && entry.target) {
        prompt += `\n- ${entry.source.trim()} = ${entry.target.trim()}`;
      }
    }
  }

  if (!autoVoiceTagging) {
    prompt += `\n\nNOTE: Auto-Gender/Age tagging is disabled. Format lines simply as: [ID] Khmer translation here`;
  }

  prompt += `\n\nINPUT SUBTITLE SEGMENTS TO TRANSLATE:\n`;
  for (const seg of segments) {
    prompt += `[${seg.id}] ${seg.originalText}\n`;
  }

  return prompt;
}
