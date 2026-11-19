import * as FileSystem from 'expo-file-system';
import { SubtitleSegment, AppSettings, Gender, AgeTone } from '../types/project';
import { resolveVoiceAndTone } from './tts/tonePresets';
import { synthesizeEdgeTts } from './tts/edgeTtsClient';
import { fitAudioToSlot } from './ffmpeg/timeStretch';
import { mixAudioTracks, MixAudioResult } from './ffmpeg/audioDuckMix';
import { muxVideoWithAudio, MuxResult } from './ffmpeg/videoMuxer';
import { runFFmpegCommand } from './ffmpeg/ffmpegRunner';
import { dbSaveSegments, dbUpdateSegment, dbUpdateProjectCheckpoint } from '../database/database';

export interface TTSProgress {
  completed: number;
  total: number;
  currentId: number;
  statusText: string;
}

/**
 * Worker to synthesize a single segment with retry & exponential backoff.
 */
async function processSegmentTTS(
  seg: SubtitleSegment,
  projectWorkspaceDir: string,
  settings: AppSettings,
  maxRetries: number = 3
): Promise<SubtitleSegment> {
  const text = seg.translatedText || seg.originalText;
  if (!text.trim()) {
    return {
      ...seg,
      status: 'error',
      errorMessage: 'Empty text to synthesize',
    };
  }

  const { voice, pitch, rate } = resolveVoiceAndTone(
    settings.voiceMode,
    seg.gender,
    seg.ageTone,
    settings.maleVoice,
    settings.femaleVoice
  );

  const chunksDir = `${projectWorkspaceDir}/tts_chunks`;
  await FileSystem.makeDirectoryAsync(chunksDir, { intermediates: true });

  const chunkPath = `${chunksDir}/chunk_${seg.id}.mp3`;
  let attempt = 0;
  let lastError: any = null;

  while (attempt < maxRetries) {
    try {
      // 1. Synthesize via Edge-TTS / Google Khmer TTS
      await synthesizeEdgeTts({
        text,
        voice,
        pitch,
        rate,
        outputPath: chunkPath,
      });

      // 2. Character Age Tone Shifting via FFmpeg
      if (seg.ageTone === 'OLD') {
        const pitchedPath = chunkPath.replace(/\.mp3$/i, '_old.mp3');
        const pitchCmd = `-y -i "${chunkPath}" -filter:a "asetrate=44100*0.88,atempo=1.136" -vn "${pitchedPath}"`;
        const res = await runFFmpegCommand(pitchCmd);
        if (res.success) {
          await FileSystem.deleteAsync(chunkPath, { idempotent: true });
          await FileSystem.moveAsync({ from: pitchedPath, to: chunkPath });
        }
      } else if (seg.ageTone === 'KID') {
        const pitchedPath = chunkPath.replace(/\.mp3$/i, '_kid.mp3');
        const pitchCmd = `-y -i "${chunkPath}" -filter:a "asetrate=44100*1.15,atempo=0.87" -vn "${pitchedPath}"`;
        const res = await runFFmpegCommand(pitchCmd);
        if (res.success) {
          await FileSystem.deleteAsync(chunkPath, { idempotent: true });
          await FileSystem.moveAsync({ from: pitchedPath, to: chunkPath });
        }
      }

      // 3. Auto Time-Stretch (Fit-to-Slot): Speed up audio if longer than time slot without cutting off words
      const slotDurationMs = seg.endTime - seg.startTime;
      let finalAudioPath = chunkPath;
      let finalDurationMs = slotDurationMs;

      if (slotDurationMs > 0) {
        const stretchRes = await fitAudioToSlot(
          chunkPath,
          slotDurationMs
        );
        finalAudioPath = stretchRes.finalPath;
        finalDurationMs = stretchRes.finalDurationMs;
      }

      return {
        ...seg,
        audioPath: finalAudioPath,
        durationMs: finalDurationMs,
        status: 'ready',
        errorMessage: undefined,
      };
    } catch (err) {
      attempt++;
      lastError = err;
      // Exponential backoff: 500ms, 1000ms, 2000ms
      const backoffMs = Math.min(500 * Math.pow(2, attempt - 1), 3000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return {
    ...seg,
    status: 'error',
    errorMessage: `TTS failed after ${maxRetries} attempts: ${lastError?.message || lastError}`,
  };
}

/**
 * Concurrency worker queue running parallel TTS tasks up to maxConcurrent.
 */
export async function runTtsPipeline(
  projectId: string,
  segments: SubtitleSegment[],
  projectWorkspaceDir: string,
  settings: AppSettings,
  onProgress?: (progress: TTSProgress) => void,
  isCancelled?: () => boolean
): Promise<{
  updatedSegments: SubtitleSegment[];
  allReady: boolean;
}> {
  const updatedSegments = [...segments];
  const maxConcurrent = Math.min(Math.max(1, settings.maxConcurrentTts || 5), 15);

  // Collect segments that need synthesis (translated or pending with text)
  const pendingIndices: number[] = [];
  for (let i = 0; i < updatedSegments.length; i++) {
    if (updatedSegments[i].status !== 'ready') {
      pendingIndices.push(i);
    }
  }

  const total = pendingIndices.length;
  if (total === 0) {
    return { updatedSegments, allReady: true };
  }

  let completedCount = 0;
  let queuePointer = 0;

  // Worker loop
  const runWorker = async (): Promise<void> => {
    while (queuePointer < pendingIndices.length) {
      if (isCancelled && isCancelled()) break;

      const currentIndex = pendingIndices[queuePointer++];
      const seg = updatedSegments[currentIndex];

      onProgress?.({
        completed: completedCount,
        total,
        currentId: seg.id,
        statusText: `Synthesizing Audio for ID ${seg.id}...`,
      });

      const updatedSeg = await processSegmentTTS(
        seg,
        projectWorkspaceDir,
        settings
      );

      updatedSegments[currentIndex] = updatedSeg;
      completedCount++;

      // Checkpoint direct save to SQLite (mutex serialized, no nested transaction)
      await dbUpdateSegment(projectId, updatedSeg);
      const readyCount = updatedSegments.filter((s) => s.status === 'ready').length;
      const transCount = updatedSegments.filter(
        (s) => s.status === 'translated' || s.status === 'ready'
      ).length;
      await dbUpdateProjectCheckpoint(projectId, seg.id, transCount, readyCount);

      onProgress?.({
        completed: completedCount,
        total,
        currentId: seg.id,
        statusText: `Completed ID ${seg.id} (${completedCount}/${total})`,
      });
    }
  };

  // Launch workers
  const workerCount = Math.min(maxConcurrent, pendingIndices.length);
  const workers = Array.from({ length: workerCount }, () => runWorker());
  await Promise.all(workers);

  const allReady = updatedSegments.every((s) => s.status === 'ready');
  return { updatedSegments, allReady };
}

/**
 * Targeted Range Re-TTS: Re-synthesizes audio for specific segment ID range
 * with optional tone or voice override.
 */
export async function reTtsRange(
  projectId: string,
  segments: SubtitleSegment[],
  fromId: number,
  toId: number,
  projectWorkspaceDir: string,
  settings: AppSettings,
  overrideGender?: Gender,
  overrideTone?: AgeTone
): Promise<SubtitleSegment[]> {
  const updatedSegments = [...segments];
  const toPersist: SubtitleSegment[] = [];

  for (let i = 0; i < updatedSegments.length; i++) {
    const s = updatedSegments[i];
    if (s.id >= fromId && s.id <= toId) {
      let targetSeg = { ...s };
      if (overrideGender) targetSeg.gender = overrideGender;
      if (overrideTone) targetSeg.ageTone = overrideTone;

      targetSeg = await processSegmentTTS(
        targetSeg,
        projectWorkspaceDir,
        settings
      );
      updatedSegments[i] = targetSeg;
      toPersist.push(targetSeg);
    }
  }

  if (toPersist.length > 0) {
    await dbSaveSegments(projectId, toPersist);
  }

  return updatedSegments;
}

/**
 * End-to-end Final Video Export:
 * 1. Strips all original audio tracks from the source video.
 * 2. Generates sample-accurate dubbed speech timeline track with zero drift and zero overlap.
 * 3. Fast stream copies video with newly dubbed audio (-c:v copy -c:a aac) with ZERO watermark.
 */
export async function finalizeAndExportVideo(
  videoPath: string,
  segments: SubtitleSegment[],
  projectWorkspaceDir: string,
  settings: AppSettings,
  outputFileName: string = 'export_dubbed.mp4',
  saveToGallery: boolean = true
): Promise<MuxResult> {
  // 1. Build synchronized speech timeline track (all original audio tracks are stripped)
  const mixResult: MixAudioResult = await mixAudioTracks(
    videoPath,
    segments,
    projectWorkspaceDir,
    settings
  );

  if (!mixResult.success) {
    return {
      success: false,
      outputPath: '',
      savedToGallery: false,
      error: mixResult.error || 'Failed to generate dubbed voice timeline.',
    };
  }

  // 2. Mux video stream copy with dubbed audio track (drops all original audio tracks from source)
  const finalVideoOutput = `${projectWorkspaceDir}/${outputFileName}`;
  const muxResult = await muxVideoWithAudio(
    videoPath,
    mixResult.mixedAudioPath,
    finalVideoOutput,
    saveToGallery
  );

  return muxResult;
}
