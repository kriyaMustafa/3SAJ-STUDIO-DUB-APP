import { SubtitleSegment, GlossaryEntry } from '../../types/project';
import { ParseResult, parseTranslatedBatch } from './batchCopyPaste';

/**
 * Free Google Translate endpoint with batching and retry logic.
 * Translates texts to Khmer ('km') without requiring an API key.
 */
export async function translateWithGoogleFree(
  segments: SubtitleSegment[],
  glossary: GlossaryEntry[] = []
): Promise<ParseResult> {
  const parsedSegments: {
    id: number;
    translatedText: string;
    gender: 'M' | 'F' | 'AUTO';
    ageTone: 'ADULT' | 'OLD' | 'KID';
  }[] = [];

  // Build glossary lookup map
  const glossaryMap = new Map<string, string>();
  for (const g of glossary) {
    if (g.source && g.target) {
      glossaryMap.set(g.source.toLowerCase(), g.target);
    }
  }

  // Pre-process segments with glossary
  const prepared = segments.map((seg) => {
    let text = seg.originalText;
    for (const [src, tgt] of glossaryMap.entries()) {
      if (text.toLowerCase().includes(src)) {
        text = text.replace(new RegExp(src, 'gi'), tgt);
      }
    }
    return { ...seg, originalText: text };
  });

  // Group into multi-line chunks of 15 segments to minimize HTTP requests
  const CHUNK_SIZE = 15;
  const missingIds: number[] = [];

  for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
    const chunk = prepared.slice(i, i + CHUNK_SIZE);
    const chunkText = chunk.map((s) => `[${s.id}] ${s.originalText}`).join('\n');

    let chunkSuccess = false;
    let attempts = 0;

    while (attempts < 3 && !chunkSuccess) {
      attempts++;
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=km&dt=t&q=${encodeURIComponent(chunkText)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
          },
        });

        if (res.ok) {
          const data = await res.json();
          const translatedBlock = Array.isArray(data[0])
            ? data[0].map((item: any) => item[0]).join('')
            : '';

          const parseRes = parseTranslatedBatch(translatedBlock, chunk);
          if (parseRes.parsedSegments.length > 0) {
            parsedSegments.push(...parseRes.parsedSegments);
            if (parseRes.missingIds.length > 0) {
              // Try individual translation for any missed lines in the chunk
              for (const missedId of parseRes.missingIds) {
                const missedSeg = chunk.find((s) => s.id === missedId);
                if (missedSeg) {
                  const singleTrans = await translateSingleSegment(missedSeg);
                  if (singleTrans) {
                    parsedSegments.push(singleTrans);
                  } else {
                    missingIds.push(missedId);
                  }
                }
              }
            }
            chunkSuccess = true;
          }
        } else if (res.status === 429) {
          // Rate limited: wait 1 second before retrying
          await new Promise((r) => setTimeout(r, 1000 * attempts));
        }
      } catch (err) {
        console.warn(`[GoogleFree] Chunk translation attempt ${attempts} failed:`, err);
        await new Promise((r) => setTimeout(r, 500 * attempts));
      }
    }

    if (!chunkSuccess) {
      // Chunk-level failure, fallback to translating this chunk item by item
      for (const seg of chunk) {
        const singleTrans = await translateSingleSegment(seg);
        if (singleTrans) {
          parsedSegments.push(singleTrans);
        } else {
          missingIds.push(seg.id);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // Small courteous pause between chunks
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    success: missingIds.length === 0,
    parsedSegments,
    missingIds,
    extraIds: [],
    error: missingIds.length > 0 ? `Free translation skipped ${missingIds.length} segments due to rate limit.` : undefined,
  };
}

async function translateSingleSegment(seg: SubtitleSegment): Promise<{
  id: number;
  translatedText: string;
  gender: 'M' | 'F' | 'AUTO';
  ageTone: 'ADULT' | 'OLD' | 'KID';
} | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=km&dt=t&q=${encodeURIComponent(seg.originalText)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translated = Array.isArray(data[0]) ? data[0].map((item: any) => item[0]).join('') : '';
      if (translated.trim()) {
        return {
          id: seg.id,
          translatedText: translated.trim(),
          gender: seg.gender || 'AUTO',
          ageTone: seg.ageTone || 'ADULT',
        };
      }
    }
  } catch (err) {
    console.warn(`[GoogleFree] Single translate failed for ID ${seg.id}:`, err);
  }
  return null;
}
