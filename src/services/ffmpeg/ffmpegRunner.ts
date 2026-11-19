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
 * Gets media duration in milliseconds using FFprobeKit.
 */
export async function getMediaDurationMs(filePath: string): Promise<number> {
  try {
    const session = await FFprobeKit.getMediaInformationAsync(filePath);
    const mediaInfo = session.getMediaInformation();
    if (mediaInfo) {
      const durationVal = mediaInfo.getDuration();
      if (durationVal !== undefined && durationVal !== null) {
        return Math.round(Number(durationVal) * 1000);
      }
    }
  } catch (err) {
    console.warn(`[FFprobe] Failed to probe duration for ${filePath}:`, err);
  }
  return 0;
}

/**
 * Cancels all active FFmpeg sessions.
 */
export async function cancelAllFFmpegSessions(): Promise<void> {
  await FFmpegKit.cancel();
}
