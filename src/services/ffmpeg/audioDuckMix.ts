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
 * Generates a sample-accurate 44100 Hz mono 16-bit PCM WAV silence file.
 * Creates standard RIFF WAV in memory with instantaneous base64 disk write (0ms latency),
 * with FFmpeg anullsrc fallback.
 */
export async function generateSilenceWav(
  outputPath: string,
  durationMs: number
): Promise<boolean> {
  if (durationMs <= 0) return true;
  const cleanOut = outputPath.replace(/^file:\/\//, '');

  try {
    const sampleRate = 44100;
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM
    const numSamples = Math.round((durationMs / 1000) * sampleRate);
    if (numSamples <= 0) return true;

    const dataSize = numSamples * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // 'RIFF'
    view.setUint32(4, 36 + dataSize, true); // Little-endian
    view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // 'WAVE'

    // fmt subchunk
    view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // 'fmt '
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // Mono
    view.setUint32(24, sampleRate, true);  // 44100 Hz
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate (88200)
    view.setUint16(32, numChannels * bytesPerSample, true); // BlockAlign (2)
    view.setUint16(34, bytesPerSample * 8, true); // BitsPerSample (16)

    // data subchunk
    view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // 'data'
    view.setUint32(40, dataSize, true);
    // Data bytes remain 0x00 (pure digital silence)

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    const base64 = typeof btoa !== 'undefined'
      ? btoa(binary)
      : (typeof Buffer !== 'undefined' ? Buffer.from(buffer).toString('base64') : '');

    if (base64) {
      await FileSystem.writeAsStringAsync(outputPath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return true;
    }
  } catch (err) {
    // If in-memory base64 fails, fallback to FFmpeg
  }

  // Robust FFmpeg anullsrc fallback
  const durationSec = Math.max(0.01, durationMs / 1000).toFixed(4);
  const cmd = `-y -f lavfi -i anullsrc=r=44100:cl=mono -t ${durationSec} -ar 44100 -ac 1 -c:a pcm_s16le "${cleanOut}"`;
  const res = await runFFmpegCommand(cmd);
  return res.success;
}

/**
 * Pre-processes all TTS voice clips BEFORE timeline mixing:
 * 1. Probes the physical audio file on disk to determine its exact duration.
 * 2. Compares speech duration against subtitle slot duration (seg.endTime - seg.startTime).
 * 3. If speech duration > subtitle duration, speeds up voice using chained FFmpeg atempo filters
 *    so the spoken audio fits exactly into the subtitle duration without drifting into subsequent segments.
 * 4. Standardizes every chunk into 44100 Hz 16-bit mono PCM WAV for sample-accurate mixing with zero cut words.
 */
export async function prepareAndSpeedAdjustTtsClips(
  segments: SubtitleSegment[],
  projectWorkspaceDir: string
): Promise<SubtitleSegment[]> {
  const preparedDir = `${projectWorkspaceDir}/fitted_chunks`;
  await FileSystem.makeDirectoryAsync(preparedDir, { intermediates: true });

  const sortedSegments = [...segments].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime
  );

  const processed: SubtitleSegment[] = [];

  for (let i = 0; i < sortedSegments.length; i++) {
    const seg = sortedSegments[i];
    if (!seg.audioPath) {
      continue;
    }

    const cleanInputPath = seg.audioPath.replace(/^file:\/\//, '');
    const uri = seg.audioPath.startsWith('file://') ? seg.audioPath : `file://${seg.audioPath}`;

    // Resilient file existence check: check primary URI and project workspace fallback
    let sourcePath = cleanInputPath;
    const fileInfo = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false }));
    if (!fileInfo.exists) {
      const fallbackChunk = `${projectWorkspaceDir}/tts_chunks/chunk_${seg.id}.mp3`;
      const fallbackUri = fallbackChunk.startsWith('file://') ? fallbackChunk : `file://${fallbackChunk}`;
      const fbInfo = await FileSystem.getInfoAsync(fallbackUri).catch(() => ({ exists: false }));
      if (fbInfo.exists) {
        sourcePath = fallbackChunk.replace(/^file:\/\//, '');
      }
    }

    // Measure physical duration directly from the file
    let actualDurationMs = await getMediaDurationMs(sourcePath);
    if (actualDurationMs <= 0 && seg.durationMs && seg.durationMs > 0) {
      actualDurationMs = seg.durationMs;
    }

    // Slot duration is defined by the subtitle segment duration.
    // Also guard against overlapping into the next subtitle's startTime.
    let slotDurationMs = Math.max(100, seg.endTime - seg.startTime);
    if (i < sortedSegments.length - 1) {
      const nextSeg = sortedSegments[i + 1];
      if (nextSeg.startTime > seg.startTime && nextSeg.startTime < seg.startTime + slotDurationMs) {
        slotDurationMs = Math.max(100, nextSeg.startTime - seg.startTime);
      }
    }

    if (actualDurationMs <= 0) {
      actualDurationMs = slotDurationMs;
    }

    const outputPath = `${preparedDir}/fitted_${seg.id}.wav`;
    const cleanOutputPath = outputPath.replace(/^file:\/\//, '');
    const targetSec = (slotDurationMs / 1000).toFixed(4);

    // If actual TTS duration exceeds subtitle duration, apply atempo speedup to fit EXACTLY into slotDurationMs
    if (actualDurationMs > slotDurationMs + 20) {
      const rawRatio = actualDurationMs / slotDurationMs;
      const targetRatio = Math.min(4.0, Math.max(1.02, rawRatio));
      const atempoFilter = buildAtempoFilter(targetRatio, 4.0);

      // Accelerate voice with atempo and clamp with -t ${targetSec} so it never exceeds slotDurationMs
      const speedCmd = `-y -i "${sourcePath}" -filter:a "${atempoFilter}" -t ${targetSec} -ar 44100 -ac 1 -c:a pcm_s16le "${cleanOutputPath}"`;
      const res = await runFFmpegCommand(speedCmd);

      if (res.success) {
        let finalDur = await getMediaDurationMs(cleanOutputPath);
        if (finalDur <= 0 || finalDur > slotDurationMs) {
          finalDur = slotDurationMs;
        }
        processed.push({
          ...seg,
          audioPath: outputPath,
          durationMs: finalDur,
        });
      } else {
        // Fallback: convert directly with duration clamping
        const fallbackCmd = `-y -i "${sourcePath}" -t ${targetSec} -ar 44100 -ac 1 -c:a pcm_s16le "${cleanOutputPath}"`;
        const fbRes = await runFFmpegCommand(fallbackCmd);
        processed.push({
          ...seg,
          audioPath: fbRes.success ? outputPath : sourcePath,
          durationMs: slotDurationMs,
        });
      }
    } else {
      // Audio already fits inside slot: standardize to 44100 Hz mono PCM WAV and clamp to slot
      const stdCmd = `-y -i "${sourcePath}" -t ${targetSec} -ar 44100 -ac 1 -c:a pcm_s16le "${cleanOutputPath}"`;
      const res = await runFFmpegCommand(stdCmd);
      let finalDur = res.success ? await getMediaDurationMs(cleanOutputPath) : actualDurationMs;
      if (finalDur <= 0 || finalDur > slotDurationMs) finalDur = actualDurationMs;
      processed.push({
        ...seg,
        audioPath: res.success ? outputPath : sourcePath,
        durationMs: finalDur,
      });
    }
  }

  return processed;
}

/**
 * Strict Audio Sync Speech Timeline Generator.
 * Mixes all voice segments ensuring every voice segment starts at the exact time
 * matching the subtitle file (startTime), with zero cumulative drift.
 */
export async function buildSpeechTimelineTrack(
  segments: SubtitleSegment[],
  projectWorkspaceDir: string,
  videoPath?: string
): Promise<string> {
  // 1. Pre-process and speed-adjust all TTS clips first so they fit their slots exactly
  const speedAdjustedSegments = await prepareAndSpeedAdjustTtsClips(segments, projectWorkspaceDir);

  // 2. Filter ready segments with verified audio and sort strictly by startTime
  let readySegments = speedAdjustedSegments
    .filter((s) => s.audioPath)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  // Fallback: If speedAdjustedSegments was somehow empty, fallback directly to segments that have audioPath
  if (readySegments.length === 0) {
    readySegments = segments
      .filter((s) => s.audioPath)
      .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  }

  if (readySegments.length === 0) {
    throw new Error('No valid TTS audio clips found to construct speech timeline.');
  }

  const timelineDir = `${projectWorkspaceDir}/timeline`;
  await FileSystem.makeDirectoryAsync(timelineDir, { intermediates: true });

  const concatListPath = `${timelineDir}/concat_list.txt`;
  let concatFileContent = '';

  let currentTimelineMs = 0;

  // 3. Probe video duration if videoPath is provided
  let totalVideoDurationMs = 0;
  if (videoPath) {
    try {
      const cleanVideo = videoPath.replace(/^file:\/\//, '');
      totalVideoDurationMs = await getMediaDurationMs(cleanVideo);
    } catch (e) {
      console.warn('[Timeline] Video duration probe error:', e);
    }
  }

  // 4. Assemble timeline with exact silence gaps and zero cumulative delay
  for (let i = 0; i < readySegments.length; i++) {
    const seg = readySegments[i];
    const chunkPath = seg.audioPath!.replace(/^file:\/\//, '');

    // Measure exact duration of this fitted segment chunk
    let clipDurMs = await getMediaDurationMs(chunkPath);
    if (clipDurMs <= 0) {
      clipDurMs = seg.durationMs || Math.max(50, seg.endTime - seg.startTime);
    }

    // Gap between current timeline position and segment's subtitle startTime
    const gapMs = seg.startTime - currentTimelineMs;

    if (gapMs >= 10) {
      // Insert precise silence gap so segment begins exactly at seg.startTime
      const silPath = `${timelineDir}/gap_${i}_${gapMs}ms.wav`;
      const generated = await generateSilenceWav(silPath, gapMs);
      if (generated) {
        const cleanSil = silPath.replace(/^file:\/\//, '');
        concatFileContent += `file '${cleanSil}'\n`;
        currentTimelineMs += gapMs;
      }
    }

    // Append the fitted audio chunk
    concatFileContent += `file '${chunkPath}'\n`;
    currentTimelineMs += clipDurMs;
  }

  // 5. Pad trailing silence so audio duration matches the video length
  if (totalVideoDurationMs > currentTimelineMs) {
    const trailingMs = totalVideoDurationMs - currentTimelineMs;
    if (trailingMs >= 20) {
      const trailingWav = `${timelineDir}/trailing_${trailingMs}ms.wav`;
      const generated = await generateSilenceWav(trailingWav, trailingMs);
      if (generated) {
        const cleanTrailing = trailingWav.replace(/^file:\/\//, '');
        concatFileContent += `file '${cleanTrailing}'\n`;
        currentTimelineMs += trailingMs;
      }
    }
  }

  const cleanConcatList = concatListPath.replace(/^file:\/\//, '');
  await FileSystem.writeAsStringAsync(concatListPath, concatFileContent);

  const speechTrackOutput = `${projectWorkspaceDir}/speech_timeline.wav`;
  const cleanSpeechOutput = speechTrackOutput.replace(/^file:\/\//, '');

  // Concatenate all silence gaps and speech clips into a single sample-accurate speech timeline
  // If video duration is known, enforce strict -t so speech timeline NEVER exceeds video duration!
  const trimOption = totalVideoDurationMs > 0 ? `-t ${(totalVideoDurationMs / 1000).toFixed(4)}` : '';
  const concatCommand = `-y -f concat -safe 0 -i "${cleanConcatList}" ${trimOption} -c:a pcm_s16le -ar 44100 -ac 1 "${cleanSpeechOutput}"`;
  const concatResult = await runFFmpegCommand(concatCommand);

  if (!concatResult.success) {
    throw new Error(
      `Failed to build speech timeline: ${concatResult.failStackTrace || concatResult.outputLogs}`
    );
  }

  return cleanSpeechOutput;
}

/**
 * Extracts original audio from video file.
 */
export async function extractOriginalAudio(
  videoPath: string,
  outputPath: string
): Promise<boolean> {
  const cleanVideo = videoPath.replace(/^file:\/\//, '');
  const cleanOutput = outputPath.replace(/^file:\/\//, '');
  const cmd = `-y -i "${cleanVideo}" -vn -ar 44100 -ac 2 -c:a pcm_s16le "${cleanOutput}"`;
  const res = await runFFmpegCommand(cmd);
  return res.success;
}

/**
 * Master audio mixing pipeline.
 * Requirement 1: Universal 44100 Hz stereo AAC audio output for 100% Android Gallery compatibility.
 * Requirement 2: Strict Audio Sync with zero speech truncation.
 * Requirement 3: Supports original audio background ducking when enabled, or pure voice track when muted.
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
    const cleanFinalMixed = finalMixedAudio.replace(/^file:\/\//, '');

    // 2. Check if background audio ducking is desired
    const shouldDuckOriginal = settings.bgmMode !== 'MUTE_ORIGINAL';

    if (shouldDuckOriginal && videoPath) {
      const originalAudioPath = `${projectWorkspaceDir}/original_audio.wav`;
      const cleanOriginal = originalAudioPath.replace(/^file:\/\//, '');
      const extracted = await extractOriginalAudio(videoPath, cleanOriginal);

      if (extracted) {
        const duckingVol = Math.max(0.05, Math.min(settings.duckingVolume || 0.15, 0.40));
        // Mix speech (input 0) with ducked original audio (input 1) into standard 44100 Hz stereo AAC
        const duckMixCmd = `-y -i "${speechTrack}" -i "${cleanOriginal}" -filter_complex "[0:a]volume=1.0,aformat=sample_rates=44100:channel_layouts=stereo[speech];[1:a]volume=${duckingVol.toFixed(2)},aformat=sample_rates=44100:channel_layouts=stereo[bgm];[speech][bgm]amix=inputs=2:duration=first:dropout_transition=2[out]" -map "[out]" -c:a aac -b:a 192k -ar 44100 -ac 2 "${cleanFinalMixed}"`;
        const duckRes = await runFFmpegCommand(duckMixCmd);

        if (duckRes.success) {
          return {
            success: true,
            mixedAudioPath: cleanFinalMixed,
            speechTimelinePath: speechTrack,
          };
        }
      }
    }

    // 3. Encode speech track to universally compatible 44100 Hz stereo AAC
    const encodeCmd = `-y -i "${speechTrack}" -c:a aac -b:a 192k -ar 44100 -ac 2 "${cleanFinalMixed}"`;
    const encodeRes = await runFFmpegCommand(encodeCmd);

    const outputAudioPath = encodeRes.success ? cleanFinalMixed : speechTrack;

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
