import * as MediaLibrary from 'expo-media-library';
import { runFFmpegCommand } from './ffmpegRunner';

export interface MuxResult {
  success: boolean;
  outputPath: string;
  publicPath?: string;
  savedToGallery: boolean;
  error?: string;
}

/**
 * Fast Stream Copy Video Muxer.
 * Merges video track with newly dubbed & mixed audio track using `-c:v copy -c:a aac`.
 * Maps only the video stream from input 0 and the audio stream from input 1.
 * Completely discards the original audio from input 0.
 * Saves directly into public shared storage (Movies/3SAJ STUDIO via Android MediaStore).
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
    let publicPath = '';

    if (saveToCameraRoll) {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          const cleanUri = outputPath.startsWith('file://') ? outputPath : `file://${outputPath}`;
          const asset = await MediaLibrary.createAssetAsync(cleanUri);
          const albumName = '3SAJ STUDIO';
          const album = await MediaLibrary.getAlbumAsync(albumName);
          if (album === null) {
            // copyAsset: true physically copies the MP4 to public Movies/3SAJ STUDIO on Android storage!
            await MediaLibrary.createAlbumAsync(albumName, asset, true);
          } else {
            await MediaLibrary.addAssetsToAlbumAsync([asset], album, true);
          }
          savedToGallery = true;
          const fileName = outputPath.split('/').pop() || 'dubbed_video.mp4';
          publicPath = `Movies/${albumName}/${fileName}`;
        }
      } catch (mediaErr) {
        console.warn('[VideoMuxer] MediaLibrary permission or save error:', mediaErr);
      }
    }

    return {
      success: true,
      outputPath,
      publicPath,
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
