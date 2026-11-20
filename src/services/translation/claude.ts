import { SubtitleSegment, GlossaryEntry } from '../../types/project';
import { buildPromptWithGlossary, BASE_SYSTEM_PROMPT } from './systemPrompt';
import { parseTranslatedBatch, ParseResult } from './batchCopyPaste';

export async function translateWithClaude(
  segments: SubtitleSegment[],
  apiKey: string,
  modelName: string = 'claude-3-5-sonnet-20241022',
  glossary: GlossaryEntry[] = [],
  autoVoiceTagging: boolean = true
): Promise<ParseResult> {
  if (!apiKey) {
    throw new Error('Anthropic Claude API key is missing. Please configure it in Settings.');
  }

  const userContent = buildPromptWithGlossary(segments, glossary, autoVoiceTagging);
  const endpoint = 'https://api.anthropic.com/v1/messages';

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
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 8192,
          system: BASE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: userContent,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.error?.message || `Claude API HTTP Error: ${response.status} ${response.statusText}`;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          lastError = new Error(msg);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw new Error(msg);
      }

      const json = await response.json();
      const textOutput =
        json.content
          ?.filter((c: any) => c.type === 'text')
          ?.map((c: any) => c.text)
          ?.join('\n') || '';

      return parseTranslatedBatch(textOutput, segments);
    } catch (err: any) {
      lastError = err;
      if (err.name === 'AbortError') {
        lastError = new Error('Claude API request timed out after 40s.');
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Claude translation failed.');
}
