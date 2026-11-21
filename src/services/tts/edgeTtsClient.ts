import * as FileSystem from 'expo-file-system';
import { EdgeTtsRequest } from '../../types/api';
import { runFFmpegCommand } from '../ffmpeg/ffmpegRunner';
import {
  generateSecMsGec,
  getEdgeTimestamp,
  generateRandomHex,
  resolveEdgeVoiceName,
  TRUSTED_CLIENT_TOKEN,
  SEC_MS_GEC_VERSION,
} from './secMsGec';

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

/**
 * Pure JavaScript Base64 encoder safe for React Native / Hermes (does not use btoa).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const c1 = b1 >> 2;
    const c2 = ((b1 & 3) << 4) | (b2 >> 4);
    const c3 = ((b2 & 15) << 2) | (b3 >> 6);
    const c4 = b3 & 63;
    output +=
      B64_CHARS.charAt(c1) +
      B64_CHARS.charAt(c2) +
      (i + 1 < bytes.length ? B64_CHARS.charAt(c3) : '=') +
      (i + 2 < bytes.length ? B64_CHARS.charAt(c4) : '=');
  }
  return output;
}

/**
 * Escapes XML entities in text for SSML.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatPitch(pitch?: string): string {
  if (!pitch) return '+0Hz';
  if (!pitch.startsWith('+') && !pitch.startsWith('-')) return `+${pitch}`;
  return pitch;
}

function formatRate(rate?: string): string {
  if (!rate) return '+0%';
  if (!rate.startsWith('+') && !rate.startsWith('-')) return `+${rate}`;
  return rate;
}

/**
 * Generates an SSML string for Edge-TTS with voice, pitch, and rate prosody controls.
 * Microsoft Edge TTS requires xml:lang='en-US' at root and full voice name.
 */
export function buildSsml(
  text: string,
  voice: string,
  pitch: string = '+0Hz',
  rate: string = '+0%'
): string {
  const fullVoice = resolveEdgeVoiceName(voice);
  const escaped = escapeXml(text);
  const formattedPitch = formatPitch(pitch);
  const formattedRate = formatRate(rate);

  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${fullVoice}'>` +
    `<prosody pitch='${formattedPitch}' rate='${formattedRate}' volume='+0%'>` +
    `${escaped}` +
    `</prosody>` +
    `</voice>` +
    `</speak>`
  );
}

/**
 * Helper to safely extract ArrayBuffer from WebSocket data in React Native/Hermes.
 */
async function toArrayBuffer(data: any): Promise<ArrayBuffer | null> {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(data);
    });
  }
  return null;
}

/**
 * Microsoft Edge-TTS WebSocket synthesizer using Piseth and Sreymom voices.
 * Includes complete Sec-MS-GEC DRM signature generation.
 */
export async function synthesizeSpeechWebSocket(
  params: EdgeTtsRequest,
  timeoutMs: number = 9000
): Promise<string> {
  const text = params.text.trim();
  if (!text) {
    throw new Error('Empty text for Edge-TTS synthesis');
  }

  const token = generateSecMsGec();
  const connId = generateRandomHex(16);
  const reqId = generateRandomHex(16);
  const timestamp = getEdgeTimestamp();

  const url =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?` +
    `TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connId}` +
    `&Sec-MS-GEC=${token}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  const ssml = buildSsml(text, params.voice, params.pitch, params.rate);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let timer: NodeJS.Timeout | null = null;
    const audioChunks: Uint8Array[] = [];
    let isFinished = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch (_) {}
        ws = null;
      }
    };

    timer = setTimeout(() => {
      if (isFinished) return;
      cleanup();
      reject(new Error(`Edge-TTS WebSocket timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      // Pass standard Edge browser headers with random MUID cookie
      const headers = {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `muid=${generateRandomHex(16).toUpperCase()};`,
      };

      // In React Native, options with headers can be passed as 3rd parameter
      // @ts-ignore - React Native WebSocket options parameter
      ws = new WebSocket(url, null, { headers });
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        // 1. Send speech.config
        const configMsg =
          `X-Timestamp:${timestamp}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: 'false',
                    wordBoundaryEnabled: 'false',
                  },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          }) +
          '\r\n';
        ws?.send(configMsg);

        // 2. Send SSML request
        const ssmlMsg =
          `X-RequestId:${reqId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${timestamp}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml;
        ws?.send(ssmlMsg);
      };

      ws.onmessage = async (event: any) => {
        try {
          if (typeof event.data === 'string') {
            if (event.data.includes('Path:turn.end')) {
              isFinished = true;
              cleanup();

              if (audioChunks.length === 0) {
                reject(new Error('Edge-TTS finished but received zero audio bytes.'));
                return;
              }

              const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
              const merged = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of audioChunks) {
                merged.set(chunk, offset);
                offset += chunk.length;
              }

              const base64Audio = bytesToBase64(merged);
              await FileSystem.writeAsStringAsync(params.outputPath, base64Audio, {
                encoding: FileSystem.EncodingType.Base64,
              });

              resolve(params.outputPath);
            }
          } else {
            const arrayBuf = await toArrayBuffer(event.data);
            if (arrayBuf && arrayBuf.byteLength > 2) {
              const dv = new DataView(arrayBuf);
              const headerLength = dv.getUint16(0, false); // big-endian uint16
                  const payloadOffset = headerLength + 2;
                  if (
                    payloadOffset <= arrayBuf.byteLength &&
                    headerLength > 0 &&
                    headerLength < 4096
                  ) {
                    const headerBytes = new Uint8Array(arrayBuf.slice(2, payloadOffset));
                    let header = '';
                    for (let i = 0; i < headerBytes.length; i++) {
                      header += String.fromCharCode(headerBytes[i]);
                    }
                    const isAudioPayload =
                      !header.includes('Path:turn.start') &&
                      !header.includes('Path:response');

                    if (!isAudioPayload) return;

                    const audioPayload = new Uint8Array(arrayBuf.slice(payloadOffset));
                if (audioPayload.length > 0) {
                  audioChunks.push(audioPayload);
                }
              }
            }
          }
        } catch (msgErr) {
          console.warn('[Edge-TTS] Error handling message:', msgErr);
        }
      };

      ws.onerror = (err: any) => {
        if (isFinished) return;
        cleanup();
        const detail = err?.message || (typeof err === 'string' ? err : 'Network connection failure');
        reject(new Error(`Edge-TTS WebSocket connection error: ${detail}`));
      };

      ws.onclose = (event: any) => {
        if (!isFinished) {
          cleanup();
          const reason = event?.reason ? ` (${event.reason})` : '';
          reject(new Error(`Edge-TTS WebSocket closed before synthesis completed${reason}.`));
        }
      };
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Fallback: Google Translate Khmer TTS client (emergency backup only).
 */
export async function synthesizeGoogleKhmerTts(params: EdgeTtsRequest): Promise<string> {
  const text = params.text.trim();
  if (!text) {
    throw new Error('Empty text for TTS synthesis');
  }

  if (text.length <= 180) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=km&client=tw-ob`;
    const res = await FileSystem.downloadAsync(url, params.outputPath, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      },
    });

    if (res.status === 200) {
      return params.outputPath;
    }
  }

  const parts: string[] = [];
  const words = text.split(/([\s,។]+)/);
  let current = '';

  for (const w of words) {
    if ((current + w).length > 150) {
      if (current.trim()) parts.push(current.trim());
      current = w;
    } else {
      current += w;
    }
  }
  if (current.trim()) parts.push(current.trim());

  if (parts.length <= 1) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 180))}&tl=km&client=tw-ob`;
    const res = await FileSystem.downloadAsync(url, params.outputPath);
    if (res.status === 200) return params.outputPath;
    throw new Error(`Google TTS download failed with HTTP ${res.status}`);
  }

  const tempDir = `${FileSystem.cacheDirectory || ''}tts_split_${Date.now()}`;
  await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

  const downloadedParts: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const partFile = `${tempDir}/part_${i}.mp3`;
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(parts[i])}&tl=km&client=tw-ob`;
    const res = await FileSystem.downloadAsync(url, partFile);
    if (res.status === 200) {
      downloadedParts.push(partFile);
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  if (downloadedParts.length === 0) {
    await FileSystem.deleteAsync(tempDir, { idempotent: true });
    throw new Error('Failed to download audio for any text part');
  }

  if (downloadedParts.length === 1) {
    await FileSystem.copyAsync({ from: downloadedParts[0], to: params.outputPath });
    await FileSystem.deleteAsync(tempDir, { idempotent: true });
    return params.outputPath;
  }

  const concatList = `${tempDir}/list.txt`;
  const listBody = downloadedParts.map((p) => `file '${p}'`).join('\n');
  await FileSystem.writeAsStringAsync(concatList, listBody);

  const concatCmd = `-y -f concat -safe 0 -i "${concatList}" -c copy "${params.outputPath}"`;
  const ffmpegRes = await runFFmpegCommand(concatCmd);

  await FileSystem.deleteAsync(tempDir, { idempotent: true });

  if (!ffmpegRes.success) {
    await FileSystem.copyAsync({ from: downloadedParts[0], to: params.outputPath });
  }

  return params.outputPath;
}

/**
 * Unified Khmer TTS synthesizer.
 * Primary: Edge-TTS WebSocket with genuine Microsoft Piseth (Male) and Sreymom (Female) voices.
 * Retries on failure. Fallback to Google Khmer only if Edge-TTS is completely unavailable.
 */
export async function synthesizeEdgeTts(params: EdgeTtsRequest): Promise<string> {
  // 1. Primary Attempt: Microsoft Edge-TTS (Piseth & Sreymom)
  try {
    return await synthesizeSpeechWebSocket(params, 8000);
  } catch (primaryErr) {
    console.warn('[TTS] Edge-TTS primary attempt failed, retrying Edge-TTS:', primaryErr);
    // 2. Retry Attempt: Microsoft Edge-TTS
    try {
      await new Promise((r) => setTimeout(r, 250));
      return await synthesizeSpeechWebSocket(params, 10000);
    } catch (retryErr) {
      console.warn('[TTS] Edge-TTS retry failed, falling back to Google Khmer:', retryErr);
      // 3. Last Resort Fallback: Google Translate Khmer TTS
      try {
        return await synthesizeGoogleKhmerTts(params);
      } catch (fallbackErr) {
        throw new Error(
          `TTS synthesis failed on both Edge-TTS and fallback: ${
            primaryErr instanceof Error ? primaryErr.message : primaryErr
          }`
        );
      }
    }
  }
}
