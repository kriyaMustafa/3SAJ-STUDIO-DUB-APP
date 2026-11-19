import os
import re
import json
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import yt_dlp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("3saj-extractor")

app = FastAPI(
    title="3SAJ Studio Video & Subtitle Extraction API",
    description="Backend microservice for 3SAJ Studio App to extract direct MP4 and SRT subtitles from YouTube, TikTok, Bilibili, Facebook, and more.",
    version="1.0.0"
)

# Enable CORS for all origins (so mobile app and web clients can connect freely)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExtractRequest(BaseModel):
    url: str

class ExtractResponse(BaseModel):
    title: str
    videoUrl: str
    srtContent: Optional[str] = None
    srtUrl: Optional[str] = None
    thumbnailUrl: Optional[str] = None
    durationSeconds: Optional[int] = None

def convert_vtt_to_srt(vtt_text: str) -> str:
    """Converts WebVTT format text to standard SRT format."""
    lines = vtt_text.splitlines()
    srt_lines = []
    counter = 1
    i = 0

    # Skip WEBVTT header
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("WEBVTT") or line.startswith("NOTE") or not line:
            i += 1
            continue
        break

    time_pattern = re.compile(
        r"(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})"
    )

    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        # Look for timestamp line
        match = time_pattern.search(line)
        if match:
            # Normalize timestamp to HH:MM:SS,mmm
            parts = line.split("-->")
            start = parts[0].strip().split()[0].replace(".", ",")
            end = parts[1].strip().split()[0].replace(".", ",")

            if start.count(":") == 1:
                start = "00:" + start
            if end.count(":") == 1:
                end = "00:" + end

            srt_lines.append(str(counter))
            srt_lines.append(f"{start} --> {end}")
            counter += 1

            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                clean_text = re.sub(r"<[^>]+>", "", lines[i].strip())
                if clean_text:
                    text_lines.append(clean_text)
                i += 1

            srt_lines.append("\n".join(text_lines))
            srt_lines.append("")
        else:
            i += 1

    return "\n".join(srt_lines)

@app.get("/")
@app.get("/health")
def health_check():
    return {
        "status": "online",
        "service": "3SAJ Studio Extraction Service",
        "version": "1.0.0",
        "supported": ["YouTube", "TikTok", "Bilibili", "Facebook", "Instagram", "Direct MP4"]
    }

@app.post("/extract", response_model=ExtractResponse)
def extract_media(req: ExtractRequest):
    raw_url = req.url.strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="Video URL is required")

    # If already a direct MP4 link
    if raw_url.lower().endswith(".mp4"):
        file_name = raw_url.split("/")[-1].replace(".mp4", "")
        return ExtractResponse(
            title=file_name or "Direct_Video",
            videoUrl=raw_url,
            srtContent="1\n00:00:01,000 --> 00:00:05,000\n[Direct Video - Enter dialogue to translate]\n\n"
        )

    ydl_opts = {
        "format": "best[ext=mp4]/best",
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(raw_url, download=False)
    except Exception as e:
        logger.error(f"yt-dlp extraction error for {raw_url}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract media: {str(e)}")

    if not info:
        raise HTTPException(status_code=404, detail="No media information found for this URL.")

    # If it's a playlist, take the first entry
    if "entries" in info:
        entries = list(info.get("entries", []))
        if entries and entries[0]:
            info = entries[0]
        else:
            raise HTTPException(status_code=404, detail="No videos found in playlist.")

    title = info.get("title") or "Imported_Video"
    duration = info.get("duration")
    thumbnail = info.get("thumbnail")

    # Find the best progressive video URL (with both video and audio)
    video_url = None
    formats = info.get("formats", [])

    # Priority 1: Progressive MP4 format with audio + video (acodec != none & vcodec != none)
    progressive_mp4s = [
        f for f in formats
        if f.get("ext") == "mp4"
        and f.get("vcodec") != "none"
        and f.get("acodec") != "none"
        and f.get("url")
    ]
    if progressive_mp4s:
        # Sort by resolution/height
        progressive_mp4s.sort(key=lambda x: x.get("height") or 0, reverse=True)
        video_url = progressive_mp4s[0].get("url")

    # Priority 2: Any format with audio + video
    if not video_url:
        combined = [
            f for f in formats
            if f.get("vcodec") != "none"
            and f.get("acodec") != "none"
            and f.get("url")
        ]
        if combined:
            combined.sort(key=lambda x: x.get("height") or 0, reverse=True)
            video_url = combined[0].get("url")

    # Priority 3: Fallback to direct url in info
    if not video_url:
        video_url = info.get("url")

    if not video_url:
        raise HTTPException(status_code=500, detail="Could not resolve downloadable video stream URL.")

    # Subtitle Extraction (Chinese, English, auto-captions)
    srt_content = None
    subtitles = info.get("subtitles") or {}
    auto_captions = info.get("automatic_captions") or {}

    # Prefer human subtitles first, then automatic captions
    candidate_subs = None
    for lang in ["zh-Hans", "zh-Hant", "zh", "en", "km"]:
        if lang in subtitles:
            candidate_subs = subtitles[lang]
            break
    if not candidate_subs:
        if subtitles:
            first_lang = next(iter(subtitles))
            candidate_subs = subtitles[first_lang]

    # Fallback to auto-captions if no manual subtitles
    if not candidate_subs:
        for lang in ["zh-Hans", "zh", "en", "km"]:
            if lang in auto_captions:
                candidate_subs = auto_captions[lang]
                break
        if not candidate_subs and auto_captions:
            first_lang = next(iter(auto_captions))
            candidate_subs = auto_captions[first_lang]

    # Download and parse candidate subtitle into SRT format
    if candidate_subs:
        # Look for vtt or srt format
        vtt_entry = next((s for s in candidate_subs if s.get("ext") == "vtt"), None)
        srt_entry = next((s for s in candidate_subs if s.get("ext") == "srt"), None)
        target_sub = srt_entry or vtt_entry or candidate_subs[0]

        if target_sub and target_sub.get("url"):
            try:
                sub_res = requests.get(target_sub["url"], timeout=10)
                if sub_res.status_code == 200:
                    raw_sub = sub_res.text
                    if target_sub.get("ext") == "vtt" or "WEBVTT" in raw_sub:
                        srt_content = convert_vtt_to_srt(raw_sub)
                    else:
                        srt_content = raw_sub
            except Exception as e:
                logger.warn(f"Failed to download subtitles: {e}")

    # If no subtitles found at all, create a starter subtitle so the editor opens ready to dub
    if not srt_content:
        srt_content = (
            "1\n00:00:00,500 --> 00:00:05,000\n[Dialogue 1 - Tap to edit or translate]\n\n"
        )

    return ExtractResponse(
        title=title,
        videoUrl=video_url,
        srtContent=srt_content,
        thumbnailUrl=thumbnail,
        durationSeconds=duration
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
