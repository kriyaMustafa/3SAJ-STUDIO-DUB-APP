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
export const DEFAULT_BACKEND_API_URL = 'https://threesaj-studio-dub-app-734y.onrender.com';
export const DEFAULT_EXTRACTION_API = `${DEFAULT_BACKEND_API_URL}/extract`;

function toFriendlyExtractionError(status: number, errorText: string): Error {
  const lower = errorText.toLowerCase();
  let detail = errorText;
  try {
    const parsed = JSON.parse(errorText);
    detail = parsed.detail || parsed.error || parsed.message || errorText;
  } catch (_) {}

  if (lower.includes('sign in') || lower.includes('confirm you') || lower.includes('bot')) {
    return new Error('YouTube is temporarily blocking automatic imports on this server. Open the video in a browser or try again shortly.');
  }
  if (lower.includes('tiktok') || lower.includes('webpage')) {
    return new Error('TikTok blocked this video or link. Try copying the full original TikTok URL, or use a direct MP4 link.');
  }
  if (lower.includes('private') || lower.includes('unavailable') || lower.includes('removed')) {
    return new Error('This video is private, removed, region-blocked, or unavailable for download.');
  }
  if (status === 503 || lower.includes('timed out') || lower.includes('waking')) {
    return new Error('The extraction server is waking up or busy. Wait 30 seconds, then try again.');
  }
  if (status >= 500) {
    return new Error('The video server could not extract this link. Check that the link is public and try again.');
  }
  return new Error(detail || 'Could not extract this video URL.');
}

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

  let rawUrl = (customBackendUrl || storeBackendUrl || DEFAULT_BACKEND_API_URL).trim();
  if (!rawUrl || rawUrl.includes('192.168.1.X')) {
    rawUrl = DEFAULT_BACKEND_API_URL;
  }
  const backendApiUrl = rawUrl.replace(/\/+$/, '');

  const endpointsToTry = [
    backendApiUrl.endsWith('/extract') ? backendApiUrl : `${backendApiUrl}/extract`,
  ];
  if (!endpointsToTry.includes(DEFAULT_EXTRACTION_API)) {
    endpointsToTry.push(DEFAULT_EXTRACTION_API);
  }

  let lastError: any = null;

  for (const endpoint of endpointsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

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
        throw toFriendlyExtractionError(response.status, errorText || response.statusText);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Aborted') {
        lastError = new Error('Extraction timed out. The server may still be waking up. Please try again in a few moments.');
      } else {
        lastError = err;
      }
      console.warn(`Extraction attempt failed on ${endpoint}:`, err.message);
    }
  }

  throw new Error(
    lastError?.message ||
    'Could not connect to extraction service. Please make sure your backend server is running and check Backend API URL in Settings.'
  );
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
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...(extraction.videoUrl.includes('tiktok') ? { 'Referer': 'https://www.tiktok.com/' } : {}),
      },
    },
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
