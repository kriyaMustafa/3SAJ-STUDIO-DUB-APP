import { SubtitleSegment, GlossaryEntry } from '../../types/project';
import { buildPromptWithGlossary, BASE_SYSTEM_PROMPT } from './systemPrompt';
import { parseTranslatedBatch, ParseResult } from './batchCopyPaste';

export async function translateWithOpenAI(
  segments: SubtitleSegment[],
  apiKey: string,
  modelName: string = 'gpt-4o-mini',
  glossary: GlossaryEntry[] = [],
  autoVoiceTagging: boolean = true
): Promise<ParseResult> {
  if (!apiKey) {
    throw new Error('OpenAI API key is missing. Please configure it in Settings.');
  }

  const userContent = buildPromptWithGlossary(segments, glossary, autoVoiceTagging);
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  let lastError: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: BASE_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: userContent,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.error?.message || `OpenAI API HTTP Error: ${response.status} ${response.statusText}`;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          lastError = new Error(msg);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw new Error(msg);
      }

      const json = await response.json();
      const textOutput = json.choices?.[0]?.message?.content || '';
      return parseTranslatedBatch(textOutput, segments);
    } catch (err: any) {
      lastError = err;
      if (err.name === 'AbortError') {
        lastError = new Error('OpenAI API request timed out after 40s.');
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('OpenAI translation failed.');
}
