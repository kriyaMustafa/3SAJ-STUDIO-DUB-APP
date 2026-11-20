import { SubtitleSegment, GlossaryEntry } from '../../types/project';
import { buildPromptWithGlossary } from './systemPrompt';
import { parseTranslatedBatch, ParseResult } from './batchCopyPaste';

export async function translateWithGemini(
  segments: SubtitleSegment[],
  apiKey: string,
  modelName: string = 'gemini-3.5-flash-lite',
  glossary: GlossaryEntry[] = [],
  autoVoiceTagging: boolean = true
): Promise<ParseResult> {
  if (!apiKey) {
    throw new Error('Google Gemini API key is missing. Please configure it in Settings.');
  }

  // Normalize model name: If deprecated 1.5/2.5 or unset, map to gemini-3.5-flash-lite
  let targetModel = modelName;
  if (!targetModel || targetModel.includes('1.5') || targetModel.includes('2.5')) {
    targetModel = 'gemini-3.5-flash-lite';
  }

  const prompt = buildPromptWithGlossary(segments, glossary, autoVoiceTagging);

  const callModel = async (m: string) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      return await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192,
          },
        }),
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response = await callModel(targetModel);

  // If rate-limited (429) or temporary server glitch (503), retry after short backoff
  if (!response.ok && (response.status === 429 || response.status === 503)) {
    console.warn(`[Gemini] ${targetModel} returned status ${response.status}. Retrying in 2s...`);
    await new Promise((r) => setTimeout(r, 2000));
    response = await callModel(targetModel);
  }

  // If initial model returns 404 or still 503, fallback to gemini-3.5-flash
  if (!response.ok && (response.status === 404 || response.status === 503)) {
    console.warn(`[Gemini] ${targetModel} returned status ${response.status}. Falling back to gemini-3.5-flash...`);
    response = await callModel('gemini-3.5-flash');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || `Gemini API HTTP Error: ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();
  const candidate = json.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Gemini translation incomplete or blocked: ${candidate.finishReason}`);
    }
  }

  const textOutput = candidate?.content?.parts?.[0]?.text || '';

  return parseTranslatedBatch(textOutput, segments);
}
