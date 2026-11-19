import { SubtitleSegment, GlossaryEntry, Gender, AgeTone } from '../../types/project';
import { buildPromptWithGlossary } from './systemPrompt';

export interface ParseResult {
  success: boolean;
  parsedSegments: {
    id: number;
    translatedText: string;
    gender: Gender;
    ageTone: AgeTone;
  }[];
  missingIds: number[];
  extraIds: number[];
  error?: string;
}

/**
 * Generates prompt text ready to be copied to the clipboard for a given batch.
 */
export function generateBatchPrompt(
  segments: SubtitleSegment[],
  glossary: GlossaryEntry[] = [],
  autoVoiceTagging: boolean = true
): string {
  return buildPromptWithGlossary(segments, glossary, autoVoiceTagging);
}

/**
 * Parses user-pasted LLM translation response.
 * Matches:
 *   [12][M][OLD] សួស្តី...
 *   [13][F][KID] ...
 *   [14] ...
 */
export function parseTranslatedBatch(
  pastedText: string,
  expectedSegments: SubtitleSegment[]
): ParseResult {
  // Normalize full-width brackets and strip Markdown code blocks
  const normalized = pastedText
    .replace(/［/g, '[')
    .replace(/］/g, ']')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '');

  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const parsedMap = new Map<
    number,
    { translatedText: string; gender: Gender; ageTone: AgeTone }
  >();

  // Tolerant regex for:
  // [12][M][OLD] text
  // [12] [M] [OLD] text
  // 12. [12] text
  // - [12] text
  // [ID: 12] text
  const lineRegex = /(?:^\s*(?:\d+[\.\)]|[-*])?\s*)\[(?:ID:\s*)?(\d+)\]\s*(?:\[(M|F)\])?\s*(?:\[(ADULT|OLD|KID)\])?\s*[:\-]?\s*(.*)$/i;

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (match) {
      const id = parseInt(match[1], 10);
      let genderRaw = match[2]?.toUpperCase();
      let ageToneRaw = match[3]?.toUpperCase();
      let translatedText = match[4]?.trim() || '';

      // Secondary check: if gender/tone were in translatedText (e.g. "[M] [ADULT] Text")
      if (!genderRaw) {
        const gMatch = translatedText.match(/^\[(M|F)\]\s*(.*)$/i);
        if (gMatch) {
          genderRaw = gMatch[1].toUpperCase();
          translatedText = gMatch[2].trim();
        }
      }
      if (!ageToneRaw) {
        const aMatch = translatedText.match(/^\[(ADULT|OLD|KID)\]\s*(.*)$/i);
        if (aMatch) {
          ageToneRaw = aMatch[1].toUpperCase();
          translatedText = aMatch[2].trim();
        }
      }

      const gender: Gender =
        genderRaw === 'M' || genderRaw === 'F' ? genderRaw : 'AUTO';
      const ageTone: AgeTone =
        ageToneRaw === 'OLD' || ageToneRaw === 'KID' ? ageToneRaw : 'ADULT';

      if (!isNaN(id) && translatedText.length > 0) {
        parsedMap.set(id, { translatedText, gender, ageTone });
      }
    }
  }

  const expectedIds = expectedSegments.map((s) => s.id);
  const foundIds = Array.from(parsedMap.keys());

  const missingIds = expectedIds.filter((id) => !parsedMap.has(id));
  const extraIds = foundIds.filter((id) => !expectedIds.includes(id));

  const parsedSegments = expectedSegments
    .filter((s) => parsedMap.has(s.id))
    .map((s) => {
      const p = parsedMap.get(s.id)!;
      return {
        id: s.id,
        translatedText: p.translatedText,
        gender: p.gender,
        ageTone: p.ageTone,
      };
    });

  return {
    success: missingIds.length === 0 && parsedSegments.length > 0,
    parsedSegments,
    missingIds,
    extraIds,
    error:
      missingIds.length > 0
        ? `Missing ${missingIds.length} segment IDs: ${missingIds.slice(0, 5).join(', ')}${missingIds.length > 5 ? '...' : ''}`
        : undefined,
  };
}
