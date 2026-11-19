import { SubtitleSegment, GlossaryEntry } from '../../types/project';
import { buildPromptWithGlossary, BASE_SYSTEM_PROMPT } from './systemPrompt';
import { parseTranslatedBatch, ParseResult } from './batchCopyPaste';

export async function translateWithDeepSeek(
  segments: SubtitleSegment[],
  apiKey: string,
  modelName: string = 'deepseek-chat',
  glossary: GlossaryEntry[] = [],
  autoVoiceTagging: boolean = true
): Promise<ParseResult> {
  if (!apiKey) {
    throw new Error('DeepSeek API key is missing. Please configure it in Settings.');
  }

  const userContent = buildPromptWithGlossary(segments, glossary, autoVoiceTagging);
  const endpoint = 'https://api.deepseek.com/chat/completions';

  const response = await fetch(endpoint, {
    method: 'POST',
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
    throw new Error(
      errorData.error?.message || `DeepSeek API HTTP Error: ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();
  const textOutput = json.choices?.[0]?.message?.content || '';

  return parseTranslatedBatch(textOutput, segments);
}
