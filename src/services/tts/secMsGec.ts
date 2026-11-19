/**
 * Microsoft Edge-TTS Sec-MS-GEC DRM Token Generator & Helpers
 * Pure JavaScript implementation compatible with React Native / Hermes (Zero Node.js Buffer dependencies).
 */

const WIN_EPOCH = 11644473600;
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const SEC_MS_GEC_VERSION = '2-143.0.3650.75';

export const FULL_VOICE_PISETH = 'Microsoft Server Speech Text to Speech Voice (km-KH, PisethNeural)';
export const FULL_VOICE_SREYMOM = 'Microsoft Server Speech Text to Speech Voice (km-KH, SreymomNeural)';

const _SHA256_INITIAL = [
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
];
const _SHA256_STATE = [
  0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
  0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
];
const _SHA256_SCHEDULE = [
  0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
  0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
  0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
  0xD258B060, 0x72766564,
];
const _SHA256_ROUND_CONSTANTS = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
];
const _SHA256_ADJUSTMENT = 0xC9DC06A7;
const _SHA256_BLOCK_CONSTANTS = [
  ..._SHA256_ROUND_CONSTANTS.slice(0, 14),
  _SHA256_ADJUSTMENT,
  ..._SHA256_ROUND_CONSTANTS.slice(15)
];
const _SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80;
const _SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0;

const _CS64_COEFFICIENTS = [
  [0xE82E91B1, 0xB32700D0],
  [0x44DE24C6, 0x88DFF51D],
  [0x3BEB65BC, 0x29514038],
  [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5],
  [0x314EF5D5, 0x26E55F3C],
  [0xE92491B1, 0x607801C6],
  [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA],
  [0xDA79FA60, 0x207CC464],
  [0xBED20560, 0x3C3C74F3],
  [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1],
  [0xCB49E3C6, 0xC5626167],
];
const _CS64_FACTOR = 0x82893933;
const _CS64_ADJUSTMENT0 = 0xF2F90B1A;
const _CS64_ADJUSTMENT1 = 0x0B1A0000;

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
function _rol16(value: number): number {
  value = value >>> 0;
  return (((value << 16) | (value >>> 16)) >>> 0);
}
function _sigma0(v: number): number {
  v = v >>> 0;
  return (((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3)) >>> 0);
}
function _sigma1(v: number): number {
  v = v >>> 0;
  return (((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10)) >>> 0);
}

function _expand_sha256_schedule(words: number[], first_word: number = 16): void {
  for (let i = first_word; i < 64; i++) {
    const x = words[i - 2] >>> 0;
    const y = words[i - 15] >>> 0;
    const s1 = ((x >>> 17) ^ (x << 15) ^ (x >>> 19) ^ (x << 13) ^ (x >>> 10)) >>> 0;
    const s0 = ((y >>> 7) ^ (y << 25) ^ (y >>> 18) ^ (y << 14) ^ (y >>> 3)) >>> 0;
    words.push((s1 + words[i - 7] + s0 + words[i - 16]) >>> 0);
  }
}

function _sha256_rounds(state: number[], words: number[], first_round: number = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = first_round === 14 ? _SHA256_BLOCK_CONSTANTS : _SHA256_ROUND_CONSTANTS;
  for (let i = first_round; i < 64; i++) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const t1 = (h + s1 + ch + constants[i] + words[i]) >>> 0;
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = (s0 + maj) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function _sha256_init(dataBytes: Uint8Array): number[] {
  const words: number[] = new Array(14).fill(0);
  const w14 = ((dataBytes[0] << 16) | (dataBytes[1] << 8) | dataBytes[2]) >>> 0;
  const w15 = ((dataBytes[3] << 24) | (dataBytes[4] << 16) | (dataBytes[5] << 8) | dataBytes[6]) >>> 0;
  words.push(w14, w15);

  for (let idx = 16; idx < 30; idx++) {
    let val = _SHA256_SCHEDULE[idx - 16];
    if (idx - 2 >= 14) {
      val += idx === 16 ? (_sigma1(words[idx - 2]) ^ _SHA256_SIGMA1_ADJUSTMENT) : _sigma1(words[idx - 2]);
    }
    if (idx - 7 >= 14) val += words[idx - 7];
    if (idx - 15 >= 14) {
      val += idx === 29 ? (_sigma0(words[idx - 15]) ^ _SHA256_SIGMA0_ADJUSTMENT) : _sigma0(words[idx - 15]);
    }
    words.push(val >>> 0);
  }

  const val29 = (_sigma1(words[28]) + words[23] + _sigma0(words[15]) + words[14] + _SHA256_ADJUSTMENT - _SHA256_ROUND_CONSTANTS[14]) >>> 0;
  words.push(val29);
  _expand_sha256_schedule(words, 31);
  const working = _sha256_rounds(_SHA256_STATE, words, 14);
  return _SHA256_INITIAL.map((x, i) => (x + working[i]) >>> 0);
}

function _sha256_digest(dataBytes: Uint8Array): Uint8Array {
  const length = 57 + dataBytes.length;
  const rem = ((55 - length) % 64 + 64) % 64;
  const padded: number[] = [];
  for (let i = 7; i < dataBytes.length; i++) padded.push(dataBytes[i]);
  padded.push(0x80);
  for (let i = 0; i < rem; i++) padded.push(0);
  const bitLen = BigInt(length * 8);
  for (let i = 7; i >= 0; i--) {
    padded.push(Number((bitLen >> BigInt(i * 8)) & 0xFFn));
  }

  let state = _sha256_init(dataBytes);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let w = 0; w < 16; w++) {
      const idx = offset + w * 4;
      words.push(((padded[idx] << 24) | (padded[idx + 1] << 16) | (padded[idx + 2] << 8) | padded[idx + 3]) >>> 0);
    }
    _expand_sha256_schedule(words, 16);
    const working = _sha256_rounds(state, words, 0);
    state = state.map((x, i) => (x + working[i]) >>> 0);
  }

  const res = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    res[i * 4] = (state[i] >>> 24) & 0xFF;
    res[i * 4 + 1] = (state[i] >>> 16) & 0xFF;
    res[i * 4 + 2] = (state[i] >>> 8) & 0xFF;
    res[i * 4 + 3] = state[i] & 0xFF;
  }
  return res;
}

function _words_le4_even(dataBytes: number[]): number[] {
  const padded = [...dataBytes];
  while (padded.length % 4 !== 0) padded.push(0);
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push((padded[i] | (padded[i + 1] << 8) | (padded[i + 2] << 16) | (padded[i + 3] << 24)) >>> 0);
  }
  if (words.length % 2 !== 0) words.push(0);
  return words;
}

function _cs64_digest(dataBytes: Uint8Array, digestBytes: Uint8Array): [number, number] {
  const dv = new DataView(digestBytes.buffer, digestBytes.byteOffset, digestBytes.byteLength);
  let key_a = (dv.getUint32(0, true) | 1) >>> 0;
  let key_b = (dv.getUint32(4, true) | 1) >>> 0;

  const factorA = Math.imul(key_a, _CS64_FACTOR) >>> 0;
  const factorB = Math.imul(key_b, _CS64_FACTOR) >>> 0;
  const factors = [factorA, factorB];

  const terms = _CS64_COEFFICIENTS.map(([coeff], idx) => Math.imul(coeff, factors[idx % 2]) >>> 0);
  const offsets = _CS64_COEFFICIENTS.map(([_, off]) => off);

  const zeroPrefixed: number[] = [0];
  for (let i = 0; i < dataBytes.length; i++) zeroPrefixed.push(dataBytes[i]);
  const words = _words_le4_even(zeroPrefixed);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let term = Math.imul(word, i % 2 === 0 ? key_a : key_b) >>> 0;
    let offset = Math.imul(_rol16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB) >>> 0;
    if (i === 0) {
      term = (term + Math.imul(_CS64_ADJUSTMENT0, factorA)) >>> 0;
      offset = (offset + _CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  }

  let swap_acc = 0, swap_last = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = _rol16((offsets[i] + x) >>> 0);
    let q = Math.imul(t, 0x76F50F34) >>> 0;
    swap_acc = (swap_acc + (Math.imul(_rol16(q), 0xC3EFEA97) + q)) >>> 0;

    t = _rol16((offsets[i + 1] + y) >>> 0);
    q = Math.imul(t, 0x1881CE3C) >>> 0;
    swap_last = (Math.imul(_rol16(q), 0x35BD1EC9) + q) >>> 0;
    swap_acc = (swap_acc + swap_last) >>> 0;

    state = (Math.imul(state, key_a) + x) >>> 0;
    state = Math.imul(_rol16(state), 0xCF98B111) >>> 0;
    state = Math.imul(_rol16(state), 0x87085B9F) >>> 0;
    state = Math.imul(_rol16(state), 0x12CEB96D) >>> 0;
    state = Math.imul(_rol16(state), 0x257E1D83) >>> 0;
    acc = (acc + state) >>> 0;

    t = (Math.imul(state, key_b) + y) >>> 0;
    t = Math.imul(_rol16(t), 0xA27416F5) >>> 0;
    t = Math.imul(_rol16(t), 0xD38396FF) >>> 0;
    state = Math.imul(_rol16(Math.imul(_rol16(t), 0x7C932B89) >>> 0), 0xBFA49F69) >>> 0;
    acc = (acc + state) >>> 0;
  }

  return [(swap_last ^ state) >>> 0, (swap_acc ^ acc) >>> 0];
}

function toHex32LE(val: number): string {
  const b0 = (val & 0xff).toString(16).padStart(2, '0');
  const b1 = ((val >>> 8) & 0xff).toString(16).padStart(2, '0');
  const b2 = ((val >>> 16) & 0xff).toString(16).padStart(2, '0');
  const b3 = ((val >>> 24) & 0xff).toString(16).padStart(2, '0');
  return b0 + b1 + b2 + b3;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.toUpperCase();
}

/**
 * Generates the DRM Sec-MS-GEC token required by Microsoft Edge-TTS WebSocket endpoints.
 */
export function generateSecMsGec(): string {
  let ticks = (Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 10000000;
  const strToHash = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const dataBytes = new Uint8Array(strToHash.length);
  for (let i = 0; i < strToHash.length; i++) {
    dataBytes[i] = strToHash.charCodeAt(i);
  }
  const digest = _sha256_digest(dataBytes);
  const [cs1, cs2] = _cs64_digest(dataBytes, digest);

  return `${(toHex32LE(cs1) + toHex32LE(cs2)).toUpperCase()}-${bytesToHex(digest)}`;
}

/**
 * Returns Edge-TTS compatible GMT timestamp formatted as Javascript date string.
 */
export function getEdgeTimestamp(): string {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

/**
 * Generates a random hex string of specified byte length.
 */
export function generateRandomHex(byteCount: number = 16): string {
  let hex = '';
  for (let i = 0; i < byteCount; i++) {
    hex += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Maps short voice identifiers to full Microsoft Edge-TTS voice names.
 */
export function resolveEdgeVoiceName(voiceId: string): string {
  if (voiceId.includes('Sreymom')) {
    return FULL_VOICE_SREYMOM;
  }
  return FULL_VOICE_PISETH;
}
