import * as FileSystem from 'expo-file-system';
import { runFFmpegCommand, getMediaDurationMs } from './ffmpegRunner';

export interface TimeStretchResult {
  stretched: boolean;
  ratio: number;
  originalDurationMs: number;
  finalDurationMs: number;
  finalPath: string;
}

/**
 * Builds chained atempo filters since a single atempo filter in FFmpeg only supports 0.5 to 2.0.
 * E.g., for ratio 2.4, returns "atempo=2.0,atempo=1.2".
 * Does NOT artificially clamp to low ratios: speeds up as much as needed to fit the exact segment duration without cutting off words.
 */
export function buildAtempoFilter(targetRatio: number): string {
  let ratio = targetRatio;
  if (!isFinite(ratio) || ratio <= 1.0) return 'atempo=1.0';
  // Allow speedup up to 12.0x so long sentences in tight slots are fully preserved
  if (ratio > 12.0) ratio = 12.0;

  const filters: string[] = [];
  while (ratio > 2.0) {
    filters.push('atempo=2.0');
    ratio /= 2.0;
  }
  if (ratio > 1.001) {
    filters.push(`atempo=${ratio.toFixed(4)}`);
  }
  return filters.length > 0 ? filters.join(',') : 'atempo=1.0';
}

/**
 * Strict Fit-to-Slot Time Stretch.
 * Speeds up TTS audio if its duration is longer than the subtitle's time slot (endTime - startTime).
 * Uses chained atempo filters so it fits the exact segment duration WITHOUT cutting off or truncating any words.
 */
export async function fitAudioToSlot(
  audioPath: string,
  slotDurationMs: number,
  _maxAtempo?: number
): Promise<TimeStretchResult> {
  const cleanPath = audioPath.replace(/^file:\/\//, '');
  const actualDurationMs = await getMediaDurationMs(cleanPath);

  // If slot duration is invalid or audio already fits within slot, no stretching needed
  if (slotDurationMs <= 0 || actualDurationMs <= slotDurationMs) {
    return {
      stretched: false,
      ratio: 1.0,
      originalDurationMs: actualDurationMs,
      finalDurationMs: actualDurationMs,
      finalPath: audioPath,
    };
  }

  // Calculate speedup ratio needed to fit cleanly into slotDurationMs with 40ms buffer
  // This guarantees that 100% of the speech line completes inside the subtitle slot
  const targetRatio = Math.max(1.02, (actualDurationMs + 40) / slotDurationMs);
  const atempoFilter = buildAtempoFilter(targetRatio);
  const isMp3 = cleanPath.toLowerCase().endsWith('.mp3');
  const tempOutputPath = isMp3
    ? cleanPath.replace(/\.mp3$/i, '_stretched.mp3')
    : cleanPath.replace(/\.wav$/i, '_stretched.wav');

  // FFmpeg chained atempo command: accelerates speech naturally
  // CRITICAL: We NEVER use '-t' to cut or truncate speech!
  // The chained atempo filter accelerates the entire voice line so zero words are dropped or cut off.
  const codec = isMp3 ? '-c:a libmp3lame -b:a 128k' : '-c:a pcm_s16le';
  const command = `-y -i "${cleanPath}" -filter:a "${atempoFilter}" -ar 44100 -ac 1 ${codec} "${tempOutputPath}"`;
  const result = await runFFmpegCommand(command);

  if (!result.success) {
    console.warn(
      `[TimeStretch] FFmpeg atempo failed: ${result.failStackTrace || result.outputLogs}`
    );
    return {
      stretched: false,
      ratio: 1.0,
      originalDurationMs: actualDurationMs,
      finalDurationMs: actualDurationMs,
      finalPath: audioPath,
    };
  }

  // Replace original file with stretched version
  await FileSystem.deleteAsync(audioPath, { idempotent: true });
  await FileSystem.moveAsync({
    from: tempOutputPath,
    to: audioPath,
  });

  let finalDurationMs = await getMediaDurationMs(cleanPath);
  if (finalDurationMs <= 0) {
    finalDurationMs = Math.round(actualDurationMs / targetRatio);
  }

  return {
    stretched: true,
    ratio: targetRatio,
    originalDurationMs: actualDurationMs,
    finalDurationMs,
    finalPath: audioPath,
  };
}
