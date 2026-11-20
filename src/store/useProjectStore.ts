import { create } from 'zustand';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import {
  Project,
  SubtitleSegment,
  AppSettings,
  GlossaryEntry,
  Gender,
  AgeTone,
  BatchCopyPasteUnit,
} from '../types/project';
import {
  dbGetAllProjects,
  dbGetProject,
  dbSaveProject,
  dbDeleteProject,
  dbGetSegments,
  dbSaveSegments,
  dbUpdateSegment,
  dbGetGlossary,
  dbSaveGlossaryItem,
  dbDeleteGlossaryItem,
  dbGetSetting,
  dbSaveSetting,
} from '../database/database';
import { parseSrtContent } from '../services/srtParser';
import { runTranslationPipeline, retranslateRange } from '../services/translation/translationService';
import { parseTranslatedBatch } from '../services/translation/batchCopyPaste';
import { runTtsPipeline, reTtsRange, finalizeAndExportVideo } from '../services/audioPipeline';
import { getApiKey } from '../services/secureStorage';
import { fetchMediaFromUrl, downloadMediaAndSubtitles, ImportProgress } from '../services/urlImporterService';
import { authService } from '../services/api/authService';
import {
  checkAppLicense,
  checkDailyTranslationQuota,
  recordDailyUsage,
} from '../services/licenseService';
import { TIER_CONFIGS } from '../types/license';

export const DEFAULT_SETTINGS: AppSettings = {
  translationMode: 'byok',
  aiProvider: 'gemini',
  geminiModel: 'gemini-3.5-flash-lite',
  openaiModel: 'gpt-4o-mini',
  claudeModel: 'claude-3-5-sonnet-20241022',
  deepseekModel: 'deepseek-chat',
  batchSize: 200,
  voiceMode: 'AUTO_DETECT',
  maleVoice: 'km-KH-PisethNeural',
  femaleVoice: 'km-KH-SreymomNeural',
  maxConcurrentTts: 5,
  autoTimeStretch: true,
  maxAtempo: 2.0,
  bgmMode: 'MUTE_ORIGINAL',
  duckingVolume: 0.05,
  demucsEndpoint: 'http://192.168.1.100:8000/api/separate',
  backendApiUrl: 'https://threesaj-studio-dub-app.onrender.com',
  autoExport: false,
  workspaceDir: FileSystem.documentDirectory ? `${FileSystem.documentDirectory}3saj_projects` : '3saj_projects',
};

interface ProjectState {
  projects: Project[];
  activeProject: Project | null;
  segments: SubtitleSegment[];
  glossary: GlossaryEntry[];
  settings: AppSettings;

  isTranslating: boolean;
  isSynthesizing: boolean;
  isExporting: boolean;

  progress: {
    completed: number;
    total: number;
    currentId: number;
    statusText: string;
  };

  activeSegmentId: number | null;
  cancelController: { cancelled: boolean };

  // Actions
  initStore: () => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (
    name: string,
    videoUri: string,
    srtUri: string,
    workspaceDir?: string
  ) => Promise<string>;
  importFromUrlAndTranslate: (
    url: string,
    onProgress?: (progress: ImportProgress) => void
  ) => Promise<string>;
  selectProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  cleanupProjectCache: (id: string) => Promise<void>;

  // Subtitle & Segments
  updateSegment: (id: number, partial: Partial<SubtitleSegment>) => Promise<void>;
  setActiveSegmentId: (id: number | null) => void;

  // Translation
  startTranslation: () => Promise<void>;
  cancelOperation: () => void;
  applyPastedBatch: (
    pastedText: string,
    fromId: number,
    toId: number
  ) => Promise<{ success: boolean; error?: string }>;
  repairRangeTranslation: (fromId: number, toId: number) => Promise<void>;

  // TTS
  startTtsSynthesis: () => Promise<void>;
  repairRangeTts: (
    fromId: number,
    toId: number,
    overrideGender?: Gender,
    overrideTone?: AgeTone
  ) => Promise<void>;
  repairRangeManual: (
    fromId: number,
    toId: number,
    overrideText: string
  ) => Promise<void>;

  // Render & Export
  exportFinalVideo: () => Promise<{ success: boolean; path?: string; error?: string }>;

  // Settings & Glossary
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  loadGlossary: () => Promise<void>;
  addGlossaryItem: (source: string, target: string) => Promise<void>;
  removeGlossaryItem: (id: string) => Promise<void>;

  // Batch units
  getBatchUnits: () => BatchCopyPasteUnit[];
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProject: null,
  segments: [],
  glossary: [],
  settings: DEFAULT_SETTINGS,

  isTranslating: false,
  isSynthesizing: false,
  isExporting: false,

  progress: {
    completed: 0,
    total: 0,
    currentId: 0,
    statusText: '',
  },

  activeSegmentId: null,
  cancelController: { cancelled: false },

  initStore: async () => {
    try {
      if (FileSystem.documentDirectory && (!get().settings.workspaceDir || get().settings.workspaceDir.startsWith('null'))) {
        set((state) => ({
          settings: { ...state.settings, workspaceDir: `${FileSystem.documentDirectory}3saj_projects` }
        }));
      }
      await get().loadProjects();
      await get().loadGlossary();

      // Load persisted settings from SQLite
      try {
        const savedSettingsStr = await dbGetSetting('app_settings');
        if (savedSettingsStr) {
          const parsed = JSON.parse(savedSettingsStr);
          if (!parsed.batchSize || parsed.batchSize === 50) {
            parsed.batchSize = 200;
          }
          if (!parsed.geminiModel || parsed.geminiModel.includes('1.5') || parsed.geminiModel.includes('2.5')) {
            parsed.geminiModel = 'gemini-3.5-flash-lite';
          }
          if (parsed.translationMode === 'google_free') {
            parsed.translationMode = 'byok';
          }
          if (
            !parsed.backendApiUrl ||
            parsed.backendApiUrl.includes('192.168.1.X') ||
            parsed.backendApiUrl.includes('10.0.2.2') ||
            parsed.backendApiUrl.includes('3saj-studio-dub-app.onrender.com')
          ) {
            parsed.backendApiUrl = 'https://threesaj-studio-dub-app.onrender.com';
          }
          set((state) => ({ settings: { ...state.settings, ...parsed } }));
          authService.setBackendUrl(parsed.backendApiUrl);
        } else {
          authService.setBackendUrl('https://threesaj-studio-dub-app.onrender.com');
        }
      } catch (_) {
        authService.setBackendUrl('https://threesaj-studio-dub-app.onrender.com');
      }
    } catch (err) {
      console.warn('initStore error during startup:', err);
      authService.setBackendUrl('https://threesaj-studio-dub-app.onrender.com');
    }
  },

  loadProjects: async () => {
    const projects = await dbGetAllProjects();
    set({ projects });
  },

  createProject: async (name, videoUri, srtUri, customWorkspace) => {
    const projectId = `proj_${Date.now()}`;
    const baseDir = customWorkspace || get().settings.workspaceDir;
    const projectDir = `${baseDir}/${projectId}`;

    await FileSystem.makeDirectoryAsync(projectDir, { intermediates: true });

    // Copy source files to project workspace
    const destVideo = `${projectDir}/source_video.mp4`;
    const destSrt = `${projectDir}/source_subtitles.srt`;

    await FileSystem.copyAsync({ from: videoUri, to: destVideo });
    await FileSystem.copyAsync({ from: srtUri, to: destSrt });

    // Parse SRT
    const rawSrt = await FileSystem.readAsStringAsync(destSrt);
    const parsedSegments = parseSrtContent(rawSrt);

    const newProject: Project = {
      id: projectId,
      name,
      videoPath: destVideo,
      srtPath: destSrt,
      workspaceDir: projectDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalSegments: parsedSegments.length,
      translatedSegments: 0,
      audioSegments: 0,
      isExported: false,
      lastCheckpointSegmentId: parsedSegments[0]?.id || 1,
    };

    await dbSaveProject(newProject);
    await dbSaveSegments(projectId, parsedSegments);

    await get().loadProjects();
    await get().selectProject(projectId);

    return projectId;
  },

  importFromUrlAndTranslate: async (url, onProgress) => {
    // 0. Verify active app subscription
    const licenseCheck = await checkAppLicense();
    if (!licenseCheck.isValid) {
      const err: any = new Error('No active subscription found. Please subscribe to Flash ($5), Pro ($8), Pro Max ($10), or Unlimited ($15) with ABA KHQR.');
      err.code = 'SUBSCRIPTION_REQUIRED';
      throw err;
    }

    onProgress?.({
      stage: 'extracting',
      progress: 0.05,
      statusText: 'Connecting to extraction service...',
    });

    // 1. Fetch direct MP4 and SRT links
    const backendApiUrl = get().settings.backendApiUrl;
    const extraction = await fetchMediaFromUrl(url, backendApiUrl);

    // 2. Prepare temporary download folder
    const tempDownloadDir = `${FileSystem.cacheDirectory || ''}url_import_${Date.now()}`;
    const { videoPath, srtPath, title } = await downloadMediaAndSubtitles(
      extraction,
      tempDownloadDir,
      onProgress
    );

    onProgress?.({
      stage: 'importing',
      progress: 0.95,
      statusText: 'Creating project database entries...',
    });

    // 3. Create project in SQLite and store
    const newProjectId = await get().createProject(title, videoPath, srtPath);

    // Clean up temporary download directory
    await FileSystem.deleteAsync(tempDownloadDir, { idempotent: true }).catch(() => {});

    // Ensure the new project is set as active so startTranslation works!
    await get().selectProject(newProjectId);

    // 4. Automatically trigger translation
    onProgress?.({
      stage: 'translating',
      progress: 1.0,
      statusText: 'Starting AI translation pipeline...',
    });

    // Run translation
    get().startTranslation().catch((err) => {
      console.warn('[AutoTranslate] Translation failed after URL import:', err);
    });

    return newProjectId;
  },

  selectProject: async (id: string) => {
    const project = await dbGetProject(id);
    if (!project) return;

    const segments = await dbGetSegments(id);
    set({
      activeProject: project,
      segments,
      activeSegmentId: segments[0]?.id || null,
    });
  },

  deleteProject: async (id: string) => {
    const project = await dbGetProject(id);
    if (project?.workspaceDir) {
      await FileSystem.deleteAsync(project.workspaceDir, { idempotent: true });
    }
    await dbDeleteProject(id);

    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProject: state.activeProject?.id === id ? null : state.activeProject,
      segments: state.activeProject?.id === id ? [] : state.segments,
    }));
  },

  cleanupProjectCache: async (id: string) => {
    const project = await dbGetProject(id);
    if (!project?.workspaceDir) return;

    // Delete temporary chunk directories
    const chunksDir = `${project.workspaceDir}/tts_chunks`;
    const timelineDir = `${project.workspaceDir}/timeline`;
    const origAudio = `${project.workspaceDir}/original_audio.wav`;
    const speechTrack = `${project.workspaceDir}/speech_timeline.wav`;
    const mixedAudio = `${project.workspaceDir}/final_mixed_audio.aac`;

    await Promise.all([
      FileSystem.deleteAsync(chunksDir, { idempotent: true }),
      FileSystem.deleteAsync(timelineDir, { idempotent: true }),
      FileSystem.deleteAsync(origAudio, { idempotent: true }),
      FileSystem.deleteAsync(speechTrack, { idempotent: true }),
      FileSystem.deleteAsync(mixedAudio, { idempotent: true }),
    ]);

    // Keep exported video and reset audio segment states in SQLite
    const currentSegments = await dbGetSegments(id);
    const cleaned = currentSegments.map((s) => ({
      ...s,
      audioPath: null,
      status: s.status === 'ready' ? ('translated' as const) : s.status,
    }));
    await dbSaveSegments(id, cleaned);

    if (get().activeProject?.id === id) {
      set({ segments: cleaned });
    }
  },

  updateSegment: async (id: number, partial: Partial<SubtitleSegment>) => {
    const { activeProject, segments } = get();
    if (!activeProject) return;

    // Optimistic UI update: immediately reflects change in memory for 0ms lag
    const updated = segments.map((s) => (s.id === id ? { ...s, ...partial } : s));
    const target = updated.find((s) => s.id === id);
    if (target) {
      set({ segments: updated });
      // Asynchronously persist to SQLite in background
      dbUpdateSegment(activeProject.id, target).catch((err) => {
        console.warn('[updateSegment] Background save failed:', err);
      });
    }
  },

  setActiveSegmentId: (id: number | null) => {
    set({ activeSegmentId: id });
  },

  cancelOperation: () => {
    get().cancelController.cancelled = true;
    set({
      isTranslating: false,
      isSynthesizing: false,
      isExporting: false,
      progress: { completed: 0, total: 0, currentId: 0, statusText: 'Cancelled.' },
    });
  },

  startTranslation: async () => {
    const { activeProject, segments, settings, glossary } = get();
    if (!activeProject || segments.length === 0) return;

    // 0. Verify active app license
    const licenseCheck = await checkAppLicense();
    if (!licenseCheck.isValid) {
      Alert.alert('License Required', licenseCheck.message);
      return;
    }

    // 0.1 Check daily translation quota against user's tier
    const pendingSegments = segments.filter((s) => s.status !== 'translated' && s.status !== 'ready');
    const durationSeconds = pendingSegments.reduce((sum, s) => {
      const segDur = (s.endTime - s.startTime) / 1000;
      return sum + (segDur > 0 ? segDur : 3);
    }, 0);

    const quota = await checkDailyTranslationQuota(licenseCheck.license!, durationSeconds);
    if (!quota.allowed) {
      const usedMin = Math.round(quota.secondsUsed / 60);
      const remainMin = Math.round(quota.secondsRemaining / 60);
      const neededMin = Math.max(1, Math.round(durationSeconds / 60));
      const dailyHours = TIER_CONFIGS[licenseCheck.license!.tier].dailyLimitHours;

      Alert.alert(
        'Daily Translation Limit Reached',
        `Your ${quota.tierName} plan allows up to ${dailyHours}h of translation per day.\n\n` +
          `• Used Today: ${usedMin} min\n` +
          `• Remaining Today: ${remainMin} min\n` +
          `• Required for this video: ${neededMin} min\n\n` +
          `Quota resets at 00:00 midnight. To translate more, upgrade to Pro (3h/d) or Premium (6h/d) in Settings.`
      );
      return;
    }

    if (settings.translationMode === 'manual_batch') {
      Alert.alert(
        'Manual Batch Mode Active',
        'You are currently in Manual Batch Copy-Paste mode. Use the "AI Batch" button on the action bar to copy and paste translated segments, or switch to "Free Google" or "BYOK AI API" in Settings.'
      );
      return;
    }

    if (settings.translationMode === 'byok') {
      const apiKey = await getApiKey(settings.aiProvider);
      if (!apiKey || !apiKey.trim()) {
        Alert.alert(
          'API Key Required',
          `Please configure your ${settings.aiProvider.toUpperCase()} API key in Settings, or switch Translation Mode to "Free Google" to translate without an API key.`
        );
        return;
      }
    }

    const controller = { cancelled: false };
    set({ isTranslating: true, cancelController: controller });

    try {
      const updated = await runTranslationPipeline(
        activeProject.id,
        segments,
        settings,
        glossary,
        (progress) => set({ progress }),
        () => controller.cancelled,
        (batchUpdated) => set({ segments: batchUpdated })
      );

      const transCount = updated.filter(
        (s) => s.status === 'translated' || s.status === 'ready'
      ).length;

      // Record daily translation quota used
      const newlyTranslated = updated.filter(
        (s) =>
          (s.status === 'translated' || s.status === 'ready') &&
          segments.some((orig) => orig.id === s.id && orig.status !== 'translated' && orig.status !== 'ready')
      );
      const newlyTranslatedSeconds = newlyTranslated.reduce((sum, s) => {
        const segDur = (s.endTime - s.startTime) / 1000;
        return sum + (segDur > 0 ? segDur : 3);
      }, 0);
      if (newlyTranslatedSeconds > 0) {
        const idempotencyToken = `trans_${activeProject.id}_${Date.now()}`;
        await recordDailyUsage(newlyTranslatedSeconds, idempotencyToken);
      }

      set({
        segments: updated,
        isTranslating: false,
        activeProject: { ...activeProject, translatedSegments: transCount },
      });
      await get().loadProjects();

      // If Auto-Export is enabled in Settings and translation fully completed without cancellation,
      // seamlessly continue to TTS Dubbing (and after TTS, Auto-Export will render the final video!)
      if (settings.autoExport && !controller.cancelled && transCount === updated.length) {
        await get().startTtsSynthesis();
      }
    } catch (err: any) {
      console.warn('Auto translation error:', err);
      set({
        isTranslating: false,
        progress: {
          ...get().progress,
          statusText: `Translation error: ${err.message || 'Unknown error'}`,
        },
      });
      Alert.alert(
        'Auto Translation Error',
        err.message || 'Failed to complete auto-translation. Please check your internet connection or API settings.'
      );
    }
  },

  applyPastedBatch: async (pastedText: string, fromId: number, toId: number) => {
    const { activeProject, segments } = get();
    if (!activeProject) return { success: false, error: 'No active project' };

    const targetSegments = segments.filter((s) => s.id >= fromId && s.id <= toId);
    const parseResult = parseTranslatedBatch(pastedText, targetSegments);

    if (!parseResult.success) {
      return { success: false, error: parseResult.error || 'Parsing failed.' };
    }

    const parsedMap = new Map(parseResult.parsedSegments.map((p) => [p.id, p]));
    const updated = segments.map((s) => {
      const p = parsedMap.get(s.id);
      if (p) {
        return {
          ...s,
          translatedText: p.translatedText,
          gender: p.gender,
          ageTone: p.ageTone,
          status: 'translated' as const,
        };
      }
      return s;
    });

    const modified = updated.filter((s) => parsedMap.has(s.id));
    await dbSaveSegments(activeProject.id, modified);

    set({ segments: updated });
    await get().loadProjects();
    return { success: true };
  },

  repairRangeTranslation: async (fromId: number, toId: number) => {
    const { activeProject, segments, settings, glossary } = get();
    if (!activeProject) return;

    // License & Quota Check
    const licenseCheck = await checkAppLicense();
    if (!licenseCheck.isValid) {
      Alert.alert('License Required', licenseCheck.message);
      return;
    }

    const rangeSegments = segments.filter((s) => s.id >= fromId && s.id <= toId);
    const rangeSeconds = rangeSegments.reduce((sum, s) => {
      const segDur = (s.endTime - s.startTime) / 1000;
      return sum + (segDur > 0 ? segDur : 3);
    }, 0);

    const quota = await checkDailyTranslationQuota(licenseCheck.license!, rangeSeconds);
    if (!quota.allowed) {
      Alert.alert(
        'Daily Limit Reached',
        `Not enough daily translation quota remaining (${Math.round(quota.secondsRemaining / 60)} min left).`
      );
      return;
    }

    set({ isTranslating: true });
    try {
      const updated = await retranslateRange(
        activeProject.id,
        segments,
        fromId,
        toId,
        settings,
        glossary
      );
      const idempotencyToken = `repair_${activeProject.id}_${fromId}_${toId}_${Date.now()}`;
      await recordDailyUsage(rangeSeconds, idempotencyToken);
      set({ segments: updated, isTranslating: false });
    } catch (err: any) {
      set({ isTranslating: false });
      console.warn('[RepairRange] Translation error:', err);
      Alert.alert('Range Translation Error', err.message || 'Failed to re-translate selected range.');
    }
  },

  startTtsSynthesis: async () => {
    const { activeProject, segments, settings } = get();
    if (!activeProject || segments.length === 0) return;

    const controller = { cancelled: false };
    set({ isSynthesizing: true, cancelController: controller });

    try {
      const { updatedSegments, allReady } = await runTtsPipeline(
        activeProject.id,
        segments,
        activeProject.workspaceDir,
        settings,
        (progress) => set({ progress }),
        () => controller.cancelled
      );

      const readyCount = updatedSegments.filter((s) => s.status === 'ready').length;
      set({
        segments: updatedSegments,
        isSynthesizing: false,
        activeProject: { ...activeProject, audioSegments: readyCount },
      });
      await get().loadProjects();

      // Check Auto-Export toggle: if 100% complete and autoExport is ON, automatically export!
      if (allReady && settings.autoExport) {
        await get().exportFinalVideo();
      }
    } catch (err: any) {
      console.warn('TTS error:', err);
      set({
        isSynthesizing: false,
        progress: {
          ...get().progress,
          statusText: `TTS error: ${err.message || 'Unknown error'}`,
        },
      });
      Alert.alert('TTS Synthesis Error', err.message || 'Failed to generate voice-over audio.');
    }
  },

  repairRangeTts: async (fromId, toId, overrideGender, overrideTone) => {
    const { activeProject, segments, settings } = get();
    if (!activeProject) return;

    set({ isSynthesizing: true });
    try {
      const updated = await reTtsRange(
        activeProject.id,
        segments,
        fromId,
        toId,
        activeProject.workspaceDir,
        settings,
        overrideGender,
        overrideTone
      );
      const readyCount = updated.filter((s) => s.status === 'ready').length;
      set({
        segments: updated,
        isSynthesizing: false,
        activeProject: { ...activeProject, audioSegments: readyCount },
      });
    } catch (err: any) {
      set({ isSynthesizing: false });
      console.warn('[RepairRange] TTS error:', err);
      Alert.alert('Range TTS Error', err.message || 'Failed to generate voice-over for selected range.');
    }
  },

  repairRangeManual: async (fromId, toId, overrideText) => {
    const { activeProject, segments } = get();
    if (!activeProject) return;

    const updated = segments.map((s) => {
      if (s.id >= fromId && s.id <= toId) {
        return {
          ...s,
          translatedText: overrideText,
          status: 'translated' as const,
        };
      }
      return s;
    });

    const changed = updated.filter((s) => s.id >= fromId && s.id <= toId);
    await dbSaveSegments(activeProject.id, changed);
    set({ segments: updated });
  },

  exportFinalVideo: async () => {
    const { activeProject, segments, settings } = get();
    if (!activeProject) return { success: false, error: 'No active project' };

    set({ isExporting: true });
    try {
      // Ensure segments are loaded and have audio
      let exportSegments = segments;
      if (!exportSegments || exportSegments.length === 0 || !exportSegments.some((s) => s.audioPath)) {
        const dbSegs = await dbGetSegments(activeProject.id);
        if (dbSegs && dbSegs.length > 0) {
          exportSegments = dbSegs;
          set({ segments: dbSegs });
        }
      }

      const hasAudio = exportSegments.some((s) => s.audioPath || s.status === 'ready');
      if (!hasAudio) {
        set({ isExporting: false });
        return {
          success: false,
          error: 'No synthesized TTS audio found. Please run "TTS All" first before exporting.',
        };
      }

      const outputFileName = `final_${activeProject.name.replace(/\s+/g, '_')}_dubbed.mp4`;
      const muxResult = await finalizeAndExportVideo(
        activeProject.videoPath,
        exportSegments,
        activeProject.workspaceDir,
        settings,
        outputFileName,
        true // Save to device camera roll
      );

      if (muxResult.success) {
        const updatedProj: Project = {
          ...activeProject,
          isExported: true,
          exportPath: muxResult.outputPath,
          updatedAt: new Date().toISOString(),
        };
        await dbSaveProject(updatedProj);
        set({ activeProject: updatedProj, isExporting: false });
        await get().loadProjects();
        return {
          success: true,
          path: muxResult.outputPath,
          publicPath: muxResult.publicPath || `Movies/3SAJ STUDIO/${outputFileName}`,
          savedToGallery: muxResult.savedToGallery,
        };
      } else {
        set({ isExporting: false });
        return { success: false, error: muxResult.error };
      }
    } catch (err: any) {
      set({ isExporting: false });
      return { success: false, error: err.message };
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    const newSettings = { ...get().settings, ...partial };
    set({ settings: newSettings });
    if (newSettings.backendApiUrl) {
      authService.setBackendUrl(newSettings.backendApiUrl);
    }
    await dbSaveSetting('app_settings', JSON.stringify(newSettings));
  },

  loadGlossary: async () => {
    const glossary = await dbGetGlossary();
    set({ glossary });
  },

  addGlossaryItem: async (source: string, target: string) => {
    await dbSaveGlossaryItem(source, target);
    await get().loadGlossary();
  },

  removeGlossaryItem: async (id: string) => {
    await dbDeleteGlossaryItem(id);
    await get().loadGlossary();
  },

  getBatchUnits: () => {
    const { segments, settings } = get();
    if (segments.length === 0) return [];

    const batchSize = Math.max(1, settings.batchSize || 50);
    const units: BatchCopyPasteUnit[] = [];

    for (let i = 0; i < segments.length; i += batchSize) {
      const slice = segments.slice(i, i + batchSize);
      const isCompleted = slice.every(
        (s) => s.status === 'translated' || s.status === 'ready'
      );
      units.push({
        batchIndex: Math.floor(i / batchSize) + 1,
        fromId: slice[0].id,
        toId: slice[slice.length - 1].id,
        totalInBatch: slice.length,
        isCompleted,
      });
    }

    return units;
  },
}));
