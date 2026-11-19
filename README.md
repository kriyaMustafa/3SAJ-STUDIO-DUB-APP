# 3SAJ Studio - Khmer AI Video Localization & Voice-Over Dubbing App

> Production-grade cross-platform mobile application (Android & iOS) built with **React Native (Expo SDK 52+ with Custom Dev Client)** and **TypeScript** for automated AI Video Localization and Khmer Voice-Over Dubbing.

---

## 🌟 Highlights & Key Capabilities

- **Zero Watermark Guarantee:** Final rendering utilizes high-speed FFmpeg stream copy (`-c:v copy -c:a aac`) without re-encoding video streams or applying logos.
- **Strict Segment ID Integrity:** Subtitle segments (`.srt`) maintain exact numeric IDs throughout ingestion, batch translation, and targeted repairs. Never merges, skips, or renumbers lines.
- **Multi-Mode Translation Engine:**
  1. **BYOK (Bring Your Own Key) AI API:** Direct REST client for **Google Gemini (1.5 Flash/Pro), OpenAI (GPT-4o/mini), Anthropic Claude (3.5 Sonnet), and DeepSeek (Chat/R1)** with configurable batch sizes (30, 50, 100).
  2. **Free Google Translate Fallback:** Zero-cost rapid translation for budget workflows.
  3. **Manual Batch Copy-Paste Mode:** Pre-engineered prompt generator + smart regex parser for free web chat LLMs (ChatGPT / Claude web).
- **Custom Glossary & Name Lock:** Key-value dictionary (e.g. `萧炎 = សៀវយាន`) injected into system prompts to ensure character and sect names remain consistent across episodes.
- **Edge-TTS & Unique Tone Shifting:**
  - Voices: `km-KH-PisethNeural` (Male) and `km-KH-SreymomNeural` (Female).
  - Presets:
    - `Adult (Default)`: Pitch `0Hz`, Rate `+0%`
    - `Old Man / Elder`: Pitch `-18Hz`, Rate `-8%`
    - `Child / Kid`: Pitch `+30Hz`, Rate `+10%`
  - Concurrency Control: Configurable parallel TTS pool (1 to 15 concurrent requests) with exponential backoff retry.
  - Auto Time-Stretch (Fit-to-Slot): Dynamically applies FFmpeg `atempo` (clamped 1.0x to 1.45x) if speech duration exceeds segment timestamp slot.
- **Targeted Range Repair (ID-to-ID):** Re-Translate, Re-TTS (with voice/tone overrides), or Manually Edit specific segment ranges (e.g. ID `45` to `60`) without touching the rest of the project.
- **BGM Modes:**
  - **BGM OFF (Fast Ducking Mode - On-Device):** Keeps original video audio at 12% volume during speech or applies FFmpeg `sidechaincompress` auto-ducking alongside the merged Khmer speech track.
  - **BGM ON (Studio Vocal Separation Mode):** Uploads extracted audio to a FastAPI Demucs endpoint to strip vocals and isolate clean instrumental BGM.
- **SQLite Checkpoint Persistence & Auto-Resume:** Auto-saves every segment and checkpoint to `expo-sqlite`. If the app closes or loses internet, work resumes from the exact pending segment ID.
- **One-Tap Cache Cleanup:** Frees up device storage by wiping temporary `.mp3`/`.wav` chunk files while preserving final exported videos.

---

## 📁 Project Architecture & File Structure

```
3saj-studio-app/
├── package.json
├── tsconfig.json
├── app.json
├── babel.config.js
├── metro.config.js
├── src/
│   ├── types/
│   │   ├── project.ts               # Core interfaces: Project, SubtitleSegment, Settings, Glossary
│   │   └── api.ts                   # API payload and response types
│   ├── database/
│   │   ├── schema.ts                # SQLite table definitions and indexes
│   │   └── database.ts              # Async data access layer using expo-sqlite
│   ├── services/
│   │   ├── secureStorage.ts         # Secure key storage using expo-secure-store
│   │   ├── srtParser.ts             # Strict SRT parser, serializer, and validation
│   │   ├── translation/
│   │   │   ├── systemPrompt.ts      # Embedded Donghua/Drama localization prompt & glossary injector
│   │   │   ├── batchCopyPaste.ts    # Prompt copy generator & regex parser
│   │   │   ├── gemini.ts            # Google Gemini REST API client
│   │   │   ├── openai.ts            # OpenAI Chat Completions client
│   │   │   ├── claude.ts            # Anthropic Claude Messages client
│   │   │   ├── deepseek.ts          # DeepSeek API client
│   │   │   ├── googleFree.ts        # Free Google Translate fallback
│   │   │   └── translationService.ts# Master translation pipeline & retry orchestrator
│   │   ├── tts/
│   │   │   ├── tonePresets.ts       # Pitch/rate prosody calculator for Adult, Old, Kid
│   │   │   └── edgeTtsClient.ts     # Edge-TTS WebSocket client with REST fallback
│   │   ├── ffmpeg/
│   │   │   ├── ffmpegRunner.ts      # FFmpegKit async executor and duration probe
│   │   │   ├── timeStretch.ts       # Auto atempo time-stretching (1.0x - 1.45x)
│   │   │   ├── audioDuckMix.ts      # Sidechain ducking & Demucs BGM mixing
│   │   │   └── videoMuxer.ts        # Fast stream copy (-c:v copy -c:a aac)
│   │   └── audioPipeline.ts         # Concurrency queue, checkpointing & auto-export
│   ├── store/
│   │   └── useProjectStore.ts       # Zustand store with SQLite checkpoint persistence
│   ├── hooks/
│   │   ├── useAudioPlayer.ts        # Audio chunk preview player hook
│   │   └── useVideoSync.ts          # Synchronized video playback and segment tracking
│   ├── components/
│   │   ├── common/
│   │   │   ├── Header.tsx           # Navigation header
│   │   │   ├── ProgressBar.tsx      # Animated progress bar with cancel button
│   │   │   └── SegmentCard.tsx      # Subtitle segment item with editing & audio preview
│   │   ├── preview/
│   │   │   └── InteractivePreviewPlayer.tsx # Video player with subtitle overlay
│   │   └── modals/
│   │       ├── RangeRepairModal.tsx # ID-to-ID targeted range repair tool
│   │       ├── BatchCopyPasteModal.tsx # Manual batch copy-paste tool
│   │       └── GlossaryModal.tsx    # Key-value character glossary editor
│   └── app/
│       ├── _layout.tsx              # Expo Router root layout
│       ├── index.tsx                # Project Dashboard screen
│       ├── editor/[id].tsx          # Subtitle Editor & Synchronized Preview screen
│       └── settings.tsx             # Settings & Secure API Keys screen
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Android Studio / Xcode for Custom Dev Client (since `ffmpeg-kit-react-native` requires native build)
- Expo CLI (`npm install -g expo-cli`)

### 2. Install Dependencies
```bash
npm install
# or
pnpm install
```

### 3. Generate Custom Dev Client (Prebuild)
Since `ffmpeg-kit-react-native` (Full-GPL) uses native C/C++ audio libraries, generate the native directories:
```bash
npx expo prebuild
```

### 4. Run on Device or Simulator
```bash
# Android
npx expo run:android

# iOS
npx expo run:ios
```

---

## ⚙️ Configuration & Settings

1. Open the app and tap the **Settings** gear icon.
2. Enter your API key(s) under **BYOK AI API Keys**:
   - Google Gemini
   - OpenAI (GPT-4o)
   - Anthropic Claude
   - DeepSeek
3. Choose your default translation mode:
   - `BYOK AI API`
   - `Free Google Translate`
   - `Manual Batch Copy-Paste`
4. Set **Max Concurrent TTS Requests** (Recommended: `5` for optimal speed without triggering rate limits).
5. Enable **Auto Time-Stretch (Fit-to-Slot)** to guarantee speech never overlaps upcoming subtitle segments.
6. Enable **Auto-Export** if you want the app to automatically render and save the final dubbed video to your photo gallery immediately when TTS finishes.
