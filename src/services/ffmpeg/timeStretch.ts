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
 * Builds atempo filter for FFmpeg.
 * Clamps speedup to maxSpeed (default 2.0x max as per user specification "x2 (max x)")
 * to preserve natural Khmer speech clarity and avoid unintelligible chipmunk artifacts.
 */
export function buildAtempoFilter(targetRatio: number, maxSpeed: number = 2.0): string {
  let ratio = targetRatio;
  if (!isFinite(ratio) || ratio <= 1.0) return 'atempo=1.0';
  // Strictly clamp to maxSpeed (2.0x max)
  if (ratio > maxSpeed) ratio = maxSpeed;

  if (Math.abs(ratio - 1.0) < 0.02) {
    return 'atempo=1.0';
  }
  return `atempo=${ratio.toFixed(4)}`;
}

/**
 * Fit-to-Slot Time Stretch.
 * Speeds up TTS audio if its duration is longer than the subtitle's time slot (endTime - startTime).
 * Strictly caps speedup to 2.0x max so voice lines sound natural and are never cut off.
 */
export async function fitAudioToSlot(
  audioPath: string,
  slotDurationMs: number,
  maxAtempo: number = 2.0
): Promise<TimeStretchResult> {
  const cleanPath = audioPath.replace(/^file:\/\//, '');
  const actualDurationMs = await getMediaDurationMs(cleanPath);

  // If slot duration is invalid or audio already fits within slot, no stretching needed
  if (slotDurationMs <= 0 || actualDurationMs <= slotDurationMs + 30) {
    return {
      stretched: false,
      ratio: 1.0,
      originalDurationMs: actualDurationMs,
      finalDurationMs: actualDurationMs,
      finalPath: audioPath,
    };
  }

  // Calculate speedup ratio needed to fit cleanly into slotDurationMs, capped at maxAtempo (2.0x)
  const targetRatio = Math.min(maxAtempo, Math.max(1.02, actualDurationMs / slotDurationMs));
  const atempoFilter = buildAtempoFilter(targetRatio, maxAtempo);
  const isMp3 = cleanPath.toLowerCase().endsWith('.mp3');
  const tempOutputPath = isMp3
    ? cleanPath.replace(/\.mp3$/i, '_stretched.mp3')
    : cleanPath.replace(/\.wav$/i, '_stretched.wav');

  // FFmpeg atempo command: accelerates speech naturally up to 2.0x max
  // CRITICAL: We NEVER use '-t' to cut or truncate speech!
  // The atempo filter accelerates the entire voice line so zero words are dropped or cut off.
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
