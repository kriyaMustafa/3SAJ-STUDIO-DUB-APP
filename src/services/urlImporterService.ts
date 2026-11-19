import * as FileSystem from 'expo-file-system';
import { useProjectStore } from '../store/useProjectStore';

export interface MediaExtractionResult {
  title: string;
  videoUrl: string;
  srtUrl?: string;
  srtContent?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

export interface ImportProgress {
  stage: 'extracting' | 'downloading_video' | 'downloading_subtitles' | 'importing' | 'translating';
  progress: number; // 0.0 to 1.0
  statusText: string;
}

// Configurable backend extraction endpoint (e.g. yt-dlp microservice or custom FastAPI server)
export const DEFAULT_BACKEND_API_URL = 'http://192.168.1.X:8000';
export const DEFAULT_EXTRACTION_API = `${DEFAULT_BACKEND_API_URL}/extract`;

/**
 * Calls Backend Extraction API to resolve a social video URL (YouTube, Bilibili, etc.)
 * into direct downloadable MP4 and SRT subtitle URLs.
 */
export async function fetchMediaFromUrl(
  url: string,
  customBackendUrl?: string
): Promise<MediaExtractionResult> {
  const cleanUrl = url.trim();
  if (!cleanUrl) {
    throw new Error('Please enter a valid video URL.');
  }

  // Handle direct MP4 link if user pastes direct media URL
  if (cleanUrl.toLowerCase().endsWith('.mp4')) {
    const fileName = cleanUrl.split('/').pop()?.replace('.mp4', '') || 'Downloaded_Video';
    return {
      title: decodeURIComponent(fileName),
      videoUrl: cleanUrl,
    };
  }

  // Read backend API URL from store or fallback
  const storeBackendUrl = typeof useProjectStore?.getState === 'function'
    ? useProjectStore.getState().settings?.backendApiUrl
    : undefined;

  const rawUrl = (customBackendUrl || storeBackendUrl || DEFAULT_BACKEND_API_URL).trim();
  const backendApiUrl = rawUrl.replace(/\/+$/, '');

  if (backendApiUrl.includes('192.168.1.X')) {
    throw new Error(
      'Backend Extraction API URL is set to placeholder "http://192.168.1.X:8000". ' +
      'Please go to Settings and enter your PC\'s actual local IP address (e.g., http://192.168.1.50:8000).'
    );
  }

  const endpoint = backendApiUrl.endsWith('/extract')
    ? backendApiUrl
    : `${backendApiUrl}/extract`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ url: cleanUrl }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (!data.videoUrl) {
        throw new Error('Extraction API did not return a valid video download URL.');
      }
      return {
        title: data.title || 'Imported_Video',
        videoUrl: data.videoUrl,
        srtUrl: data.srtUrl,
        srtContent: data.srtContent,
        thumbnailUrl: data.thumbnailUrl,
        durationSeconds: data.durationSeconds,
      };
    } else {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Extraction server responded with status ${response.status}: ${errorText || response.statusText}`);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Connection to extraction API (${endpoint}) timed out after 20 seconds.`);
    }

    // If generic backend extraction is not yet deployed, provide helpful guidance or fallback
    throw new Error(
      `Could not extract media from URL (${err.message || 'Network error'}). ` +
      `Ensure the backend extraction service at ${endpoint} is reachable, or paste a direct video link.`
    );
  }
}

/**
 * Downloads video and subtitle files to local app document storage with progress updates.
 */
export async function downloadMediaAndSubtitles(
  extraction: MediaExtractionResult,
  targetDirectory: string,
  onProgress?: (progress: ImportProgress) => void
): Promise<{ videoPath: string; srtPath: string; title: string }> {
  await FileSystem.makeDirectoryAsync(targetDirectory, { intermediates: true });

  const safeTitle = extraction.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'Video';
  const videoDest = `${targetDirectory}/source_video.mp4`;
  const srtDest = `${targetDirectory}/source_subtitles.srt`;

  // 1. Download Video File with download progress tracking
  onProgress?.({
    stage: 'downloading_video',
    progress: 0.1,
    statusText: 'Connecting to video stream...',
  });

  const videoDownloadResumable = FileSystem.createDownloadResumable(
    extraction.videoUrl,
    videoDest,
    {},
    (downloadProgress) => {
      const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
      if (totalBytesExpectedToWrite > 0) {
        const ratio = totalBytesWritten / totalBytesExpectedToWrite;
        // Map video download to 10% - 85% of overall import progress
        const overallProgress = 0.1 + ratio * 0.75;
        const mbWritten = (totalBytesWritten / (1024 * 1024)).toFixed(1);
        const mbTotal = (totalBytesExpectedToWrite / (1024 * 1024)).toFixed(1);

        onProgress?.({
          stage: 'downloading_video',
          progress: overallProgress,
          statusText: `Downloading Video: ${mbWritten}MB / ${mbTotal}MB (${Math.round(ratio * 100)}%)`,
        });
      }
    }
  );

  const downloadResult = await videoDownloadResumable.downloadAsync();
  if (!downloadResult || downloadResult.status < 200 || downloadResult.status >= 300) {
    throw new Error(`Video download failed with status ${downloadResult?.status || 'unknown'}`);
  }

  // 2. Download or write Subtitles File
  onProgress?.({
    stage: 'downloading_subtitles',
    progress: 0.9,
    statusText: 'Fetching subtitle tracks...',
  });

  if (extraction.srtContent && extraction.srtContent.trim()) {
    // If backend already provided raw SRT text
    await FileSystem.writeAsStringAsync(srtDest, extraction.srtContent);
  } else if (extraction.srtUrl) {
    // Download SRT from URL
    const srtRes = await FileSystem.downloadAsync(extraction.srtUrl, srtDest);
    if (srtRes.status < 200 || srtRes.status >= 300) {
      throw new Error(`Subtitle download failed with status ${srtRes.status}`);
    }
  } else {
    // If no SRT subtitle was provided by the URL, create a starter SRT segment
    // so the user can immediately edit, translate, or generate dubbing
    const placeholderSrt =
      `1\n00:00:00,500 --> 00:00:05,000\n[No subtitle provided - Enter dialogue to translate]\n\n`;
    await FileSystem.writeAsStringAsync(srtDest, placeholderSrt);
  }

  onProgress?.({
    stage: 'importing',
    progress: 1.0,
    statusText: 'Finalizing media assets for project import...',
  });

  return {
    videoPath: videoDest,
    srtPath: srtDest,
    title: safeTitle,
  };
}
