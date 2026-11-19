import * as MediaLibrary from 'expo-media-library';
import { runFFmpegCommand } from './ffmpegRunner';

export interface MuxResult {
  success: boolean;
  outputPath: string;
  savedToGallery: boolean;
  error?: string;
}

/**
 * Fast Stream Copy Video Muxer.
 * Merges video track with newly dubbed & mixed audio track using `-c:v copy -c:a aac`.
 * Maps only the video stream from input 0 and the audio stream from input 1.
 * Completely discards the original audio from input 0.
 * ZERO WATERMARK guaranteed.
 */
export async function muxVideoWithAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  saveToCameraRoll: boolean = false
): Promise<MuxResult> {
  try {
    // Fast stream copy muxing command:
    // -map 0:v:0 takes ONLY the video stream from the video file (completely stripping original audio 0:a)
    // -map 1:a:0 takes ONLY the dubbed voice audio track from audioPath
    // -c:v copy preserves video quality with 0 re-encoding time and ZERO watermarks
    // -c:a aac -b:a 192k packages high-definition audio
    // -movflags +faststart optimizes MP4 header for instant playback
    const muxCommand = `-y -i "${videoPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -avoid_negative_ts make_zero -fflags +genpts -movflags +faststart "${outputPath}"`;

    let result = await runFFmpegCommand(muxCommand);

    if (!result.success) {
      // Fallback: try with generic stream selectors -map 0:v -map 1:a:0
      const fallbackMux = `-y -i "${videoPath}" -i "${audioPath}" -map 0:v -map 1:a:0 -c:v copy -c:a aac -b:a 192k -avoid_negative_ts make_zero -fflags +genpts -movflags +faststart "${outputPath}"`;
      result = await runFFmpegCommand(fallbackMux);

      if (!result.success) {
        throw new Error(
          `Video muxing failed: ${result.failStackTrace || result.outputLogs}`
        );
      }
    }

    let savedToGallery = false;

    if (saveToCameraRoll) {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          const asset = await MediaLibrary.createAssetAsync(outputPath);
          // Create or save to album "3SAJ Dubbed"
          const album = await MediaLibrary.getAlbumAsync('3SAJ Dubbed');
          if (album === null) {
            await MediaLibrary.createAlbumAsync('3SAJ Dubbed', asset, false);
          } else {
            await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          }
          savedToGallery = true;
        }
      } catch (mediaErr) {
        console.warn('[VideoMuxer] MediaLibrary permission or save error:', mediaErr);
      }
    }

    return {
      success: true,
      outputPath,
      savedToGallery,
    };
  } catch (err: any) {
    return {
      success: false,
      outputPath: '',
      savedToGallery: false,
      error: err.message || 'Muxing failed',
    };
  }
}
