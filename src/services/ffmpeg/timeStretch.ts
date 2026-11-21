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
 * For speedups > 2.0x, two balanced atempo filters (using sqrt) produce optimal audio clarity.
 * Supports ratios up to 4.0x so long TTS speech cleanly fits into short subtitle segments without distortion.
 */
export function buildAtempoFilter(targetRatio: number, maxSpeed: number = 4.0): string {
  let ratio = targetRatio;
  if (!isFinite(ratio) || ratio <= 1.01) return 'atempo=1.0';
  if (ratio > maxSpeed) ratio = maxSpeed;

  if (ratio <= 2.0) {
    return `atempo=${ratio.toFixed(4)}`;
  }

  // For speedups between 2.0x and 4.0x, balance across two chained filters
  // e.g. for 2.5x: sqrt(2.5) ~= 1.5811 -> atempo=1.5811,atempo=1.5811 (both well within [0.5, 2.0])
  const stage = Math.min(2.0, Math.sqrt(ratio));
  const stage2 = Math.min(2.0, ratio / stage);
  return `atempo=${stage.toFixed(4)},atempo=${stage2.toFixed(4)}`;
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

  // Target 95% of slot (or slot - 80ms) so speech completes cleanly with natural breathing room
  const targetDurationMs = Math.max(100, Math.min(slotDurationMs - 80, slotDurationMs * 0.95));
  const rawRatio = actualDurationMs / targetDurationMs;
  const targetRatio = Math.min(maxAtempo, Math.max(1.02, rawRatio));
  const atempoFilter = buildAtempoFilter(targetRatio, maxAtempo);
  const isMp3 = cleanPath.toLowerCase().endsWith('.mp3');
  const tempOutputPath = isMp3
    ? cleanPath.replace(/\.mp3$/i, '_stretched.mp3')
    : cleanPath.replace(/\.wav$/i, '_stretched.wav');

  const codec = isMp3 ? '-c:a libmp3lame -b:a 128k' : '-c:a pcm_s16le';
  // Note: We do NOT use -t here so atempo processes 100% of speech without cutting off any words or syllables!
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

  // Replace the original only after the stretched file is confirmed present.
  // Some Android builds reject same-directory moveAsync after URI resolution.
  const tempInfo = await FileSystem.getInfoAsync(
    tempOutputPath.startsWith('file://') ? tempOutputPath : `file://${tempOutputPath}`
  );
  if (!tempInfo.exists || (tempInfo.size ?? 0) < 44) {
    await FileSystem.deleteAsync(tempOutputPath, { idempotent: true });
    return {
      stretched: false,
      ratio: 1.0,
      originalDurationMs: actualDurationMs,
      finalDurationMs: actualDurationMs,
      finalPath: audioPath,
    };
  }

  try {
    await FileSystem.deleteAsync(audioPath, { idempotent: true });
    await FileSystem.moveAsync({
      from: tempOutputPath,
      to: audioPath,
    });
  } catch (moveErr) {
    console.warn('[TimeStretch] moveAsync failed; copying stretched audio instead:', moveErr);
    try {
      await FileSystem.copyAsync({
        from: tempOutputPath,
        to: audioPath,
      });
      await FileSystem.deleteAsync(tempOutputPath, { idempotent: true });
    } catch (copyErr) {
      console.warn('[TimeStretch] copyAsync failed; keeping temp output:', copyErr);
      return {
        stretched: true,
        ratio: targetRatio,
        originalDurationMs: actualDurationMs,
        finalDurationMs: Math.round(actualDurationMs / targetRatio),
        finalPath: tempOutputPath,
      };
    }
  }

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
