import * as FileSystem from 'expo-file-system';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';

export interface FFmpegRunResult {
  success: boolean;
  returnCode: number;
  outputLogs: string;
  failStackTrace?: string;
}

/**
 * Executes an FFmpeg command asynchronously with log aggregation.
 */
export async function runFFmpegCommand(
  command: string,
  onProgress?: (progressMs: number) => void
): Promise<FFmpegRunResult> {
  return new Promise((resolve) => {
    let outputLogs = '';

    FFmpegKit.executeAsync(
      command,
      async (session) => {
        const state = await session.getState();
        const returnCode = await session.getReturnCode();
        const failStackTrace = await session.getFailStackTrace();
        const isSuccess = ReturnCode.isSuccess(returnCode);

        resolve({
          success: isSuccess,
          returnCode: returnCode?.getValue() ?? -1,
          outputLogs,
          failStackTrace: failStackTrace ?? undefined,
        });
      },
      (log) => {
        const message = log.getMessage();
        outputLogs += message;
      },
      (statistics) => {
        if (onProgress && statistics) {
          const time = statistics.getTime();
          onProgress(time);
        }
      }
    );
  });
}

/**
 * Gets media duration in milliseconds using FFprobeKit with robust header/file size fallback.
 */
export async function getMediaDurationMs(filePath: string): Promise<number> {
  const cleanPath = filePath.replace(/^file:\/\//, '');

  try {
    // Note: getMediaInformation (NOT getMediaInformationAsync) waits synchronously for the probe to finish
    const session = await FFprobeKit.getMediaInformation(cleanPath, 5000);
    const mediaInfo = session.getMediaInformation();
    if (mediaInfo) {
      const durationVal = mediaInfo.getDuration();
      if (durationVal !== undefined && durationVal !== null) {
        const parsed = Math.round(parseFloat(String(durationVal)) * 1000);
        if (parsed > 0) return parsed;
      }
    }
  } catch (err) {
    console.warn(`[FFprobe] Failed to probe duration for ${cleanPath}:`, err);
  }

  // Fallback: estimate from file size if FFprobe unavailable
  try {
    const uri = filePath.startsWith('file://') ? filePath : `file://${cleanPath}`;
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (fileInfo.exists && fileInfo.size && fileInfo.size > 44) {
      if (cleanPath.toLowerCase().endsWith('.wav')) {
        // 44100 Hz mono 16-bit PCM = 88200 bytes/sec = 88.2 bytes/ms
        const dataBytes = fileInfo.size - 44;
        return Math.round(dataBytes / 88.2);
      } else if (cleanPath.toLowerCase().endsWith('.mp3')) {
        // Edge-TTS standard output is audio-24khz-48kbitrate-mono-mp3 = 48 kbps = 6,000 bytes/sec = 6.0 bytes/ms
        return Math.round(fileInfo.size / 6.0);
      }
    }
  } catch {}

  return 0;
}

/**
 * Cancels all active FFmpeg sessions.
 */
export async function cancelAllFFmpegSessions(): Promise<void> {
  await FFmpegKit.cancel();
}
