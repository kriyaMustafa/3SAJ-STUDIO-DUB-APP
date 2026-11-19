import { SubtitleSegment } from '../types/project';

/**
 * Converts "HH:MM:SS,mmm" or "HH:MM:SS.mmm" to milliseconds.
 */
export function timeStringToMs(timeString: string): number {
  const normalized = timeString.trim().replace('.', ',');
  const parts = normalized.split(',');
  const timeParts = parts[0].split(':').map((n) => parseInt(n, 10));
  const msPart = parseInt(parts[1] || '0', 10);

  const hours = timeParts[0] || 0;
  const minutes = timeParts[1] || 0;
  const seconds = timeParts[2] || 0;

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + msPart;
}

/**
 * Converts milliseconds to "HH:MM:SS,mmm" format.
 */
export function msToTimeString(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = Math.floor(ms % 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (n: number, z = 2) => n.toString().padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(milliseconds, 3)}`;
}

/**
 * Parses raw SRT string into SubtitleSegment objects.
 * CRITICAL RULE: Preserves the original numeric ID exactly.
 */
export function parseSrtContent(rawSrt: string): SubtitleSegment[] {
  const normalized = rawSrt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const rawBlocks = normalized.split(/\n\n+/);
  const segments: SubtitleSegment[] = [];

  for (const block of rawBlocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    // Line 0: Segment ID
    const rawId = parseInt(lines[0], 10);
    if (isNaN(rawId)) continue;

    // Line 1: Timestamp range "00:00:01,000 --> 00:00:04,000"
    const timeMatch = lines[1].match(
      /(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/
    );

    if (!timeMatch) continue;

    const startTimeStr = timeMatch[1].replace('.', ',');
    const endTimeStr = timeMatch[2].replace('.', ',');
    const startTimeMs = timeStringToMs(startTimeStr);
    const endTimeMs = timeStringToMs(endTimeStr);

    // Remaining lines: Subtitle text
    const textLines = lines.slice(2).join(' ').trim();

    segments.push({
      id: rawId,
      startTime: startTimeMs,
      endTime: endTimeMs,
      startTimeFormatted: startTimeStr,
      endTimeFormatted: endTimeStr,
      originalText: textLines,
      translatedText: '',
      gender: 'AUTO',
      ageTone: 'ADULT',
      audioPath: null,
      durationMs: null,
      status: 'pending',
    });
  }

  // Sort by ID to ensure deterministic sequential processing
  return segments.sort((a, b) => a.id - b.id);
}

/**
 * Serializes segments back to valid SRT format.
 */
export function serializeToSrt(
  segments: SubtitleSegment[],
  useTranslated: boolean = true
): string {
  return segments
    .map((seg) => {
      const text = useTranslated && seg.translatedText ? seg.translatedText : seg.originalText;
      return `${seg.id}\n${seg.startTimeFormatted} --> ${seg.endTimeFormatted}\n${text}\n`;
    })
    .join('\n');
}

/**
 * Validates that an array of parsed results contains all expected IDs and no duplicates.
 */
export function validateSegmentIntegrity(
  expectedIds: number[],
  receivedIds: number[]
): { valid: boolean; missingIds: number[]; extraIds: number[] } {
  const expectedSet = new Set(expectedIds);
  const receivedSet = new Set(receivedIds);

  const missingIds = expectedIds.filter((id) => !receivedSet.has(id));
  const extraIds = receivedIds.filter((id) => !expectedSet.has(id));

  return {
    valid: missingIds.length === 0,
    missingIds,
    extraIds,
  };
}
