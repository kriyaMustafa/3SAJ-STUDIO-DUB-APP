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

  const response = await fetch(endpoint, {
    method: 'POST',
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
    throw new Error(
      errorData.error?.message || `Claude API HTTP Error: ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();
  const textOutput =
    json.content
      ?.filter((c: any) => c.type === 'text')
      ?.map((c: any) => c.text)
      ?.join('\n') || '';

  return parseTranslatedBatch(textOutput, segments);
}
