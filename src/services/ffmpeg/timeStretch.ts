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
 */
export function buildAtempoFilter(targetRatio: number): string {
  let ratio = targetRatio;
  if (!isFinite(ratio) || ratio <= 1.0) return 'atempo=1.0';
  if (ratio > 4.0) ratio = 4.0; // clamp maximum speedup to preserve audio intelligibility

  const filters: string[] = [];
  while (ratio > 2.0) {
    filters.push('atempo=2.0');
    ratio /= 2.0;
  }
  if (ratio > 1.001) {
    filters.push(`atempo=${ratio.toFixed(3)}`);
  }
  return filters.length > 0 ? filters.join(',') : 'atempo=1.0';
}

/**
 * Strict Fit-to-Slot Time Stretch.
 * Guarantees TTS audio chunk fits within slotDurationMs (endTime - startTime).
 * Uses chained atempo filters so it never overflows into subsequent segments.
 */
export async function fitAudioToSlot(
  audioPath: string,
  slotDurationMs: number,
  maxAtempo: number = 2.5
): Promise<TimeStretchResult> {
  const actualDurationMs = await getMediaDurationMs(audioPath);

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

  // Calculate speedup ratio needed to fit perfectly into slotDurationMs
  const rawRatio = actualDurationMs / slotDurationMs;
  const clampedRatio = Math.min(Math.max(rawRatio, 1.0), Math.max(maxAtempo, 2.5));

  const atempoFilter = buildAtempoFilter(clampedRatio);
  const isMp3 = audioPath.toLowerCase().endsWith('.mp3');
  const tempOutputPath = isMp3
    ? audioPath.replace(/\.mp3$/i, '_stretched.mp3')
    : audioPath.replace(/\.wav$/i, '_stretched.wav');

  // FFmpeg atempo command: speeds up audio with matching codec
  // We cap duration with -t to guarantee zero slot overrun
  const maxDurationSec = (slotDurationMs / 1000).toFixed(3);
  const codec = isMp3 ? '-c:a libmp3lame -b:a 128k' : '-c:a pcm_s16le';
  const command = `-y -i "${audioPath}" -filter:a "${atempoFilter}" -ar 44100 -ac 1 ${codec} -t ${maxDurationSec} "${tempOutputPath}"`;
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

  const finalDurationMs = await getMediaDurationMs(audioPath);

  return {
    stretched: true,
    ratio: clampedRatio,
    originalDurationMs: actualDurationMs,
    finalDurationMs,
    finalPath: audioPath,
  };
}
