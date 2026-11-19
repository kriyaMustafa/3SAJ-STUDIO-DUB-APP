import * as FileSystem from 'expo-file-system';
import { SubtitleSegment, AppSettings } from '../../types/project';
import { runFFmpegCommand, getMediaDurationMs } from './ffmpegRunner';
import { buildAtempoFilter } from './timeStretch';

export interface MixAudioResult {
  success: boolean;
  mixedAudioPath: string;
  speechTimelinePath: string;
  error?: string;
}

/**
 * Strict Audio Sync Speech Timeline Generator.
 * 1. Checks every segment's duration against its allotted slot (nextSeg.startTime - curSeg.startTime).
 * 2. If TTS chunk duration > allotted speech slot, applies FFmpeg atempo speedup so it strictly fits.
 * 3. Uses sample-accurate slot padding (apad) so every segment starts at its EXACT startTime with ZERO drift and ZERO overlap.
 * 4. Strips all original audio tracks from the source video completely.
 * 5. Converts every piece to standardized 44100Hz 16-bit mono PCM WAV for flawless, glitch-free concatenation.
 */
export async function buildSpeechTimelineTrack(
  segments: SubtitleSegment[],
  projectWorkspaceDir: string,
  videoPath?: string
): Promise<string> {
  // 1. Filter segments that have audio ready
  const readySegments = segments
    .filter((s) => (s.status === 'ready' || s.audioPath) && s.audioPath)
    .map((s) => ({ ...s }))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  if (readySegments.length === 0) {
    throw new Error('No ready audio segments found to construct speech timeline.');
  }

  // 2. Sanitize timestamps to guarantee strictly increasing start times
  for (let i = 0; i < readySegments.length - 1; i++) {
    const cur = readySegments[i];
    const next = readySegments[i + 1];
    if (next.startTime <= cur.startTime) {
      const minStep = Math.max(50, Math.min(cur.endTime - cur.startTime, 500));
      next.startTime = cur.startTime + minStep;
      if (next.endTime <= next.startTime) {
        next.endTime = next.startTime + 500;
      }
    }
  }

  const timelineDir = `${projectWorkspaceDir}/timeline`;
  await FileSystem.makeDirectoryAsync(timelineDir, { intermediates: true });

  const concatListPath = `${timelineDir}/concat_list.txt`;
  let concatFileContent = '';

  // 3. Initial Silence Padding: From 0 to first segment's startTime
  const firstStartTime = readySegments[0].startTime;
  if (firstStartTime > 0) {
    const initSec = (firstStartTime / 1000).toFixed(4);
    const initSilencePath = `${timelineDir}/initial_silence.wav`;
    const initCmd = `-y -f lavfi -i anullsrc=r=44100:cl=mono -t ${initSec} -ar 44100 -ac 1 -c:a pcm_s16le "${initSilencePath}"`;
    const initRes = await runFFmpegCommand(initCmd);
    if (initRes.success) {
      concatFileContent += `file '${initSilencePath}'\n`;
    }
  }

  // 4. Build sample-accurate slots for each voice segment
  for (let i = 0; i < readySegments.length; i++) {
    const seg = readySegments[i];
    const chunkPath = seg.audioPath!;
    const nextSeg = i + 1 < readySegments.length ? readySegments[i + 1] : null;

    // Slot duration: Spans from this segment's startTime to next segment's startTime
    // (or until seg.endTime for the final segment)
    const slotDurationMs = nextSeg
      ? Math.max(nextSeg.startTime - seg.startTime, 50)
      : Math.max(seg.endTime - seg.startTime, 50);

    // Strict speech bound: Speech must finish within (seg.endTime - seg.startTime) AND before next segment starts
    // This mathematically guarantees that voice segments NEVER overlap!
    const maxSpeechMs = Math.max(
      50,
      Math.min(seg.endTime - seg.startTime, slotDurationMs)
    );

    const slotWavPath = `${timelineDir}/slot_${i}.wav`;
    const slotDurationSec = (slotDurationMs / 1000).toFixed(4);

    let speechDurationMs = seg.durationMs || 0;
    if (speechDurationMs <= 0) {
      speechDurationMs = await getMediaDurationMs(chunkPath);
    }

    // Time-stretch if speech duration exceeds allotted slot
    let filterString = '';
    if (speechDurationMs > maxSpeechMs) {
      const speedRatio = Math.max(1.0, speechDurationMs / maxSpeechMs);
      const atempoFilter = buildAtempoFilter(speedRatio);
      filterString = `${atempoFilter},apad`;
    } else {
      filterString = 'apad';
    }

    // Generate slot: speech placed at timestamp 0 of slot, padded with silence to exact slotDurationSec
    const slotCmd = `-y -i "${chunkPath}" -filter:a "${filterString}" -t ${slotDurationSec} -ar 44100 -ac 1 -c:a pcm_s16le "${slotWavPath}"`;
    let res = await runFFmpegCommand(slotCmd);

    if (!res.success) {
      // Fallback: simple conversion + silence padding
      const fallbackCmd = `-y -i "${chunkPath}" -ar 44100 -ac 1 -c:a pcm_s16le -t ${slotDurationSec} "${slotWavPath}"`;
      res = await runFFmpegCommand(fallbackCmd);
      if (!res.success) {
        // Last resort: fill slot with pure silence so overall timeline never drifts
        const silCmd = `-y -f lavfi -i anullsrc=r=44100:cl=mono -t ${slotDurationSec} -ar 44100 -ac 1 -c:a pcm_s16le "${slotWavPath}"`;
        await runFFmpegCommand(silCmd);
      }
    }

    concatFileContent += `file '${slotWavPath}'\n`;
  }

  // 5. Pad trailing silence so audio duration matches the video length perfectly
  if (videoPath) {
    try {
      const totalVideoDurationMs = await getMediaDurationMs(videoPath);
      const lastSeg = readySegments[readySegments.length - 1];
      const lastSlotDurationMs = Math.max(lastSeg.endTime - lastSeg.startTime, 50);
      const currentTimelineEndMs = lastSeg.startTime + lastSlotDurationMs;

      if (totalVideoDurationMs > currentTimelineEndMs) {
        const trailingMs = totalVideoDurationMs - currentTimelineEndMs;
        if (trailingMs >= 50) {
          const trailingSec = (trailingMs / 1000).toFixed(4);
          const trailingWav = `${timelineDir}/trailing_silence.wav`;
          const trailCmd = `-y -f lavfi -i anullsrc=r=44100:cl=mono -t ${trailingSec} -ar 44100 -ac 1 -c:a pcm_s16le "${trailingWav}"`;
          const trailRes = await runFFmpegCommand(trailCmd);
          if (trailRes.success) {
            concatFileContent += `file '${trailingWav}'\n`;
          }
        }
      }
    } catch (e) {
      console.warn('[Timeline] Video duration probe error:', e);
    }
  }

  await FileSystem.writeAsStringAsync(concatListPath, concatFileContent);

  const speechTrackOutput = `${projectWorkspaceDir}/speech_timeline.wav`;

  // Concatenate all slots into a single uniform, sample-accurate speech timeline
  const concatCommand = `-y -f concat -safe 0 -i "${concatListPath}" -c:a pcm_s16le -ar 44100 -ac 1 "${speechTrackOutput}"`;
  const concatResult = await runFFmpegCommand(concatCommand);

  if (!concatResult.success) {
    throw new Error(
      `Failed to build speech timeline: ${concatResult.failStackTrace || concatResult.outputLogs}`
    );
  }

  return speechTrackOutput;
}

/**
 * Extracts original audio from video file.
 */
export async function extractOriginalAudio(
  videoPath: string,
  outputPath: string
): Promise<boolean> {
  const cmd = `-y -i "${videoPath}" -vn -ar 44100 -ac 1 -c:a pcm_s16le "${outputPath}"`;
  const res = await runFFmpegCommand(cmd);
  return res.success;
}

/**
 * Calls remote FastAPI / Demucs vocal separation endpoint.
 * Uploads original audio and downloads separated instrumental BGM.
 */
export async function separateBgmWithDemucs(
  audioPath: string,
  endpointUrl: string,
  outputBgmPath: string
): Promise<boolean> {
  try {
    const uploadRes = await FileSystem.uploadAsync(endpointUrl, audioPath, {
      fieldName: 'file',
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    });

    if (uploadRes.status >= 200 && uploadRes.status < 300) {
      const responseData = JSON.parse(uploadRes.body);
      if (responseData.bgmUrl) {
        const downloadRes = await FileSystem.downloadAsync(
          responseData.bgmUrl,
          outputBgmPath
        );
        return downloadRes.status === 200;
      }
      return false;
    }
    return false;
  } catch (err) {
    console.warn('[Demucs] Vocal separation error, fallback to auto-ducking:', err);
    return false;
  }
}

/**
 * Master audio mixing pipeline.
 * Requirement 1: Remove Original Audio: Strip all original audio tracks from the source video
 *                so the exported output contains only the generated/dubbed voice segments.
 * Requirement 2: Strict Audio Sync: Guaranteed sample-accurate speech timeline with zero drift & zero overlap.
 */
export async function mixAudioTracks(
  videoPath: string,
  segments: SubtitleSegment[],
  projectWorkspaceDir: string,
  settings: AppSettings
): Promise<MixAudioResult> {
  try {
    // 1. Build synchronized speech timeline track with zero drift and zero overlap
    const speechTrack = await buildSpeechTimelineTrack(segments, projectWorkspaceDir, videoPath);

    const finalMixedAudio = `${projectWorkspaceDir}/final_mixed_audio.aac`;

    // 2. Encode to high-definition 192k AAC (all original audio tracks are completely stripped)
    console.log('[MixAudio] Exporting pure dubbed speech track (original source audio completely stripped).');
    const encodeCmd = `-y -i "${speechTrack}" -c:a aac -b:a 192k -ar 44100 -ac 1 "${finalMixedAudio}"`;
    const encodeRes = await runFFmpegCommand(encodeCmd);

    const outputAudioPath = encodeRes.success ? finalMixedAudio : speechTrack;

    return {
      success: true,
      mixedAudioPath: outputAudioPath,
      speechTimelinePath: speechTrack,
    };
  } catch (err: any) {
    return {
      success: false,
      mixedAudioPath: '',
      speechTimelinePath: '',
      error: err.message || 'Audio mixing error',
    };
  }
}
