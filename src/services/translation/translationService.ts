import {
  SubtitleSegment,
  AppSettings,
  GlossaryEntry,
  AIProvider,
} from '../../types/project';
import { getApiKey } from '../secureStorage';
import { translateWithGemini } from './gemini';
import { translateWithOpenAI } from './openai';
import { translateWithClaude } from './claude';
import { translateWithDeepSeek } from './deepseek';
import { translateWithGoogleFree } from './googleFree';
import { ParseResult } from './batchCopyPaste';
import { dbSaveSegments, dbUpdateProjectCheckpoint } from '../../database/database';

export interface TranslationProgress {
  completed: number;
  total: number;
  currentId: number;
  statusText: string;
}

/**
 * Translates a slice of subtitle segments using the configured provider.
 */
async function translateSliceWithProvider(
  slice: SubtitleSegment[],
  provider: AIProvider,
  modelName: string,
  glossary: GlossaryEntry[],
  autoVoiceTagging: boolean
): Promise<ParseResult> {
  const apiKey = await getApiKey(provider);

  switch (provider) {
    case 'gemini':
      return translateWithGemini(slice, apiKey, modelName, glossary, autoVoiceTagging);
    case 'openai':
      return translateWithOpenAI(slice, apiKey, modelName, glossary, autoVoiceTagging);
    case 'claude':
      return translateWithClaude(slice, apiKey, modelName, glossary, autoVoiceTagging);
    case 'deepseek':
      return translateWithDeepSeek(slice, apiKey, modelName, glossary, autoVoiceTagging);
    default:
      throw new Error(`Unsupported AI Provider: ${provider}`);
  }
}

/**
 * Master translation orchestrator.
 * Handles batching, concurrency, strict ID validation, auto-retry for missed IDs,
 * and SQLite checkpoint persistence.
 */
export async function runTranslationPipeline(
  projectId: string,
  segments: SubtitleSegment[],
  settings: AppSettings,
  glossary: GlossaryEntry[] = [],
  onProgress?: (progress: TranslationProgress) => void,
  isCancelled?: () => boolean,
  onBatchCompleted?: (updated: SubtitleSegment[]) => void
): Promise<SubtitleSegment[]> {
  const updatedSegments = [...segments];
  const autoVoiceTagging = settings.voiceMode === 'AUTO_DETECT';
  // Use optimal slice of 50 for LLM stability and instant incremental screen updates
  const batchSize = Math.max(1, Math.min(settings.batchSize || 200, 50));

  // Filter pending or error segments
  const pendingIndices: number[] = [];
  for (let i = 0; i < updatedSegments.length; i++) {
    if (updatedSegments[i].status !== 'translated' && updatedSegments[i].status !== 'ready') {
      pendingIndices.push(i);
    }
  }

  const totalToTranslate = pendingIndices.length;
  let completedCount = 0;

  if (totalToTranslate === 0) {
    return updatedSegments;
  }

  // Process in batches
  for (let b = 0; b < pendingIndices.length; b += batchSize) {
    if (isCancelled && isCancelled()) break;

    const currentBatchIndices = pendingIndices.slice(b, b + batchSize);
    const batchSegments = currentBatchIndices.map((idx) => updatedSegments[idx]);

    onProgress?.({
      completed: completedCount,
      total: totalToTranslate,
      currentId: batchSegments[0].id,
      statusText: `Translating Batch IDs ${batchSegments[0].id} - ${batchSegments[batchSegments.length - 1].id}...`,
    });

    let result: ParseResult;

    if (settings.translationMode === 'google_free') {
      result = await translateWithGoogleFree(batchSegments, glossary);
    } else {
      let model = settings.geminiModel;
      if (settings.aiProvider === 'openai') model = settings.openaiModel;
      else if (settings.aiProvider === 'claude') model = settings.claudeModel;
      else if (settings.aiProvider === 'deepseek') model = settings.deepseekModel;

      result = await translateSliceWithProvider(
        batchSegments,
        settings.aiProvider,
        model,
        glossary,
        autoVoiceTagging
      );

      // Handle missed IDs: auto-retry missed segments once if any were skipped
      if (result.missingIds.length > 0) {
        const missedSegments = batchSegments.filter((s) => result.missingIds.includes(s.id));
        try {
          const retryResult = await translateSliceWithProvider(
            missedSegments,
            settings.aiProvider,
            model,
            glossary,
            autoVoiceTagging
          );
          // Merge retried results
          result.parsedSegments.push(...retryResult.parsedSegments);
        } catch (retryErr) {
          console.warn('[Translation] Retry for missed IDs failed:', retryErr);
        }
      }
    }

    // Map parsed results back to updatedSegments
    const parsedMap = new Map(result.parsedSegments.map((p) => [p.id, p]));
    const batchToPersist: SubtitleSegment[] = [];

    for (const idx of currentBatchIndices) {
      const seg = updatedSegments[idx];
      const parsed = parsedMap.get(seg.id);

      if (parsed && parsed.translatedText) {
        seg.translatedText = parsed.translatedText;
        if (autoVoiceTagging && parsed.gender) seg.gender = parsed.gender;
        if (autoVoiceTagging && parsed.ageTone) seg.ageTone = parsed.ageTone;
        seg.status = 'translated';
        seg.errorMessage = undefined;
      } else {
        seg.status = 'error';
        seg.errorMessage = 'Failed to extract translation from AI response.';
      }

      batchToPersist.push(seg);
      completedCount++;
    }

    // Auto-save checkpoint to SQLite
    await dbSaveSegments(projectId, batchToPersist);
    onBatchCompleted?.([...updatedSegments]);
    const audioCount = updatedSegments.filter((s) => s.status === 'ready').length;
    const translatedCount = updatedSegments.filter(
      (s) => s.status === 'translated' || s.status === 'ready'
    ).length;
    await dbUpdateProjectCheckpoint(
      projectId,
      batchSegments[batchSegments.length - 1].id,
      translatedCount,
      audioCount
    );

    onProgress?.({
      completed: completedCount,
      total: totalToTranslate,
      currentId: batchSegments[batchSegments.length - 1].id,
      statusText: `Saved checkpoint at ID ${batchSegments[batchSegments.length - 1].id}`,
    });
  }

  return updatedSegments;
}

/**
 * Re-translates a targeted range of segments from `fromId` to `toId`.
 */
export async function retranslateRange(
  projectId: string,
  segments: SubtitleSegment[],
  fromId: number,
  toId: number,
  settings: AppSettings,
  glossary: GlossaryEntry[] = []
): Promise<SubtitleSegment[]> {
  const targetIndices = segments
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s.id >= fromId && s.id <= toId);

  if (targetIndices.length === 0) return segments;

  const slice = targetIndices.map((t) => t.s);
  const autoVoiceTagging = settings.voiceMode === 'AUTO_DETECT';

  let result: ParseResult;
  if (settings.translationMode === 'google_free') {
    result = await translateWithGoogleFree(slice, glossary);
  } else {
    let model = settings.geminiModel;
    if (settings.aiProvider === 'openai') model = settings.openaiModel;
    else if (settings.aiProvider === 'claude') model = settings.claudeModel;
    else if (settings.aiProvider === 'deepseek') model = settings.deepseekModel;

    result = await translateSliceWithProvider(
      slice,
      settings.aiProvider,
      model,
      glossary,
      autoVoiceTagging
    );
  }

  const resultMap = new Map(result.parsedSegments.map((p) => [p.id, p]));
  const updatedSegments = [...segments];
  const toPersist: SubtitleSegment[] = [];

  for (const { s, idx } of targetIndices) {
    const res = resultMap.get(s.id);
    if (res && res.translatedText) {
      updatedSegments[idx] = {
        ...s,
        translatedText: res.translatedText,
        gender: autoVoiceTagging && res.gender ? res.gender : s.gender,
        ageTone: autoVoiceTagging && res.ageTone ? res.ageTone : s.ageTone,
        status: 'translated',
        errorMessage: undefined,
      };
      toPersist.push(updatedSegments[idx]);
    }
  }

  if (toPersist.length > 0) {
    await dbSaveSegments(projectId, toPersist);
  }

  return updatedSegments;
}
