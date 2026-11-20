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
 * Builds chained atempo filters for FFmpeg.
 * FFmpeg atempo only supports 0.5 to 2.0 per filter instance.
 * For speedups > 2.0x, multiple atempo filters must be chained (e.g. atempo=2.0,atempo=1.5 for 3.0x).
 * Supports ratios up to 4.0x so long TTS speech cleanly fits into short subtitle segments.
 */
export function buildAtempoFilter(targetRatio: number, maxSpeed: number = 4.0): string {
  let ratio = targetRatio;
  if (!isFinite(ratio) || ratio <= 1.01) return 'atempo=1.0';
  if (ratio > maxSpeed) ratio = maxSpeed;

  const filters: string[] = [];
  while (ratio > 2.0) {
    filters.push('atempo=2.0');
    ratio /= 2.0;
  }
  if (ratio > 1.01) {
    filters.push(`atempo=${ratio.toFixed(4)}`);
  }
  return filters.length > 0 ? filters.join(',') : 'atempo=1.0';
}

/**
 * Fit-to-Slot Time Stretch.
 * Speeds up TTS audio if its duration is longer than the subtitle's time slot (endTime - startTime).
 * Uses chained atempo to accelerate voice to fit the exact segment duration cleanly.
 */
export async function fitAudioToSlot(
  audioPath: string,
  slotDurationMs: number,
  maxAtempo: number = 4.0
): Promise<TimeStretchResult> {
  const cleanPath = audioPath.replace(/^file:\/\//, '');
  const actualDurationMs = await getMediaDurationMs(cleanPath);

  // If slot duration is invalid or audio already fits within slot (with small 20ms tolerance), no stretching needed
  if (slotDurationMs <= 0 || actualDurationMs <= slotDurationMs + 20) {
    return {
      stretched: false,
      ratio: 1.0,
      originalDurationMs: actualDurationMs,
      finalDurationMs: actualDurationMs,
      finalPath: audioPath,
    };
  }

  // Calculate speedup ratio needed to fit cleanly into slotDurationMs, up to maxAtempo (default 4.0x)
  const targetRatio = Math.min(maxAtempo, Math.max(1.02, actualDurationMs / slotDurationMs));
  const atempoFilter = buildAtempoFilter(targetRatio, maxAtempo);
  const isMp3 = cleanPath.toLowerCase().endsWith('.mp3');
  const tempOutputPath = isMp3
    ? cleanPath.replace(/\.mp3$/i, '_stretched.mp3')
    : cleanPath.replace(/\.wav$/i, '_stretched.wav');

  const targetSec = (slotDurationMs / 1000).toFixed(4);
  const codec = isMp3 ? '-c:a libmp3lame -b:a 128k' : '-c:a pcm_s16le';
  const command = `-y -i "${cleanPath}" -filter:a "${atempoFilter}" -t ${targetSec} -ar 44100 -ac 1 ${codec} "${tempOutputPath}"`;
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
  if (finalDurationMs <= 0 || finalDurationMs > slotDurationMs) {
    finalDurationMs = slotDurationMs;
  }

  return {
    stretched: true,
    ratio: targetRatio,
    originalDurationMs: actualDurationMs,
    finalDurationMs,
    finalPath: audioPath,
  };
}
