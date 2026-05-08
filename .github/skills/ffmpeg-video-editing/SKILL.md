---
name: ffmpeg-video-editing
description: >
  FFmpeg video editing patterns for creator workflows — silence removal, caption burning, aspect ratio conversion,
  clip extraction, intro/outro concatenation, and media inspection. Use when user says "edit video",
  "remove silence", "burn captions", "extract clip", "concat intro", "aspect ratio", "ffprobe",
  "caption style", "subtitle filter", "silence detect", or any FFmpeg video editing operation.
---

# FFmpeg Video Editing Skill

Canonical FFmpeg patterns and proven defaults for a reusable video production pipeline. All video editing agents use these commands and settings as their source of truth.

## Media Inspection (ffprobe)

```powershell
ffprobe -v quiet -print_format json -show_format -show_streams "input.mp4"
```
Returns: duration, resolution, codec, bitrate, audio channels, aspect ratio.

## Silence Detection

```powershell
ffmpeg -i "input.mp4" -af "silencedetect=noise=-30dB:d=0.5" -f null - 2>&1
```

**Defaults:**
- Threshold: `-30dB` (captures natural breathing pauses)
- Minimum duration: `0.5s` (catches genuine dead air, not brief pauses)
- Parse output for `silence_start` and `silence_end` lines

**Rules:**
- Add **50ms padding** on each side when cutting to avoid clipping words
- Don't remove silence shorter than 0.5s — it clips speech beginnings

## Silence Removal (Concat Method)

1. Parse silencedetect output → identify "keep" segments (non-silent)
2. Extract each keep-segment:
```powershell
ffmpeg -y -ss [start] -i "input.mp4" -to [duration] -c copy "segment_N.mp4"
```
3. Create concat file (`segments.txt`):
```
file 'segment_1.mp4'
file 'segment_2.mp4'
file 'segment_3.mp4'
```
4. Concatenate:
```powershell
ffmpeg -y -f concat -safe 0 -i segments.txt -c copy "tight_edit.mp4"
```

## Caption Burning (ASS/SRT Subtitles)

### ⚠️ Windows Path Critical Issue
On Windows, the `subtitles` filter CANNOT handle absolute paths with colons (`C:\`).
**MUST** `cd` into the directory and use relative filenames.

```powershell
cd "C:\path\to\output\dir"
ffmpeg -y -i "input.mp4" -vf "subtitles=captions.srt:force_style='FontName=Arial Bold,FontSize=21,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Shadow=1,Alignment=2,MarginV=25'" -c:v libx264 -preset fast -crf 18 -c:a copy "captioned.mp4"
```

### Default Caption Style
| Setting | Value | Notes |
|---------|-------|-------|
| Font | Arial Bold | Always bold |
| FontSize | **21** | NEVER >24 for 720p vertical. 36 is TOO BIG. |
| PrimaryColour | `&H00FFFFFF` | White text |
| OutlineColour | `&H00000000` | Black outline |
| Outline | 3 | Thick enough for readability |
| Shadow | 1 | Subtle drop shadow |
| Alignment | 2 | Bottom-center |
| MarginV | **25** | Minimum. Higher = text moves UP from bottom edge. |

### MarginV Direction Rule (CRITICAL)
Higher MarginV values push text **UP** from the bottom edge, NOT down.
- MarginV=25 → captions near the bottom ✅
- MarginV=160 → text pushed up into speaker's face ❌

### Platform-Specific Caption Placement
| Platform | Aspect | Safe Zone |
|----------|--------|-----------|
| TikTok/Reels/Shorts | 9:16 | Captions within middle 70% vertically |
| Instagram Feed | 1:1 | More forgiving, ensure no face overlap |
| YouTube Main | 16:9 | Traditional subtitle position (bottom 10%) |

## Frame-Accurate Clip Extraction

```powershell
# Fast seek + precise cut
ffmpeg -y -ss 00:01:30 -i "input.mp4" -to 00:00:60 -c:v libx264 -c:a aac -preset fast "output_clip.mp4"
```

**Rules:**
- `-ss` before `-i` = fast seek (input seeking)
- `-to` specifies duration from the seek point, NOT absolute timestamp
- Always re-encode clips (`-c:v libx264 -c:a aac`) for frame accuracy

## Aspect Ratio Conversion

### 16:9 → 9:16 (Center Crop for Vertical)
```powershell
ffmpeg -y -i "input.mp4" -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -c:a aac "vertical.mp4"
```

### 16:9 → 1:1 (Square)
```powershell
ffmpeg -y -i "input.mp4" -vf "crop=ih:ih,scale=1080:1080" -c:v libx264 -c:a aac "square.mp4"
```

### 16:9 → 4:5 (Feed)
```powershell
ffmpeg -y -i "input.mp4" -vf "crop=ih*4/5:ih,scale=1080:1350" -c:v libx264 -c:a aac "feed.mp4"
```

## Intro/Outro Concatenation

### Asset Selection (by aspect ratio)
| Aspect | Intro | Outro |
|--------|-------|-------|
| 16:9 | `{{VIDEO_ASSET_DIR}}\intro.mp4` | `{{VIDEO_ASSET_DIR}}\outro.mp4` |
| 9:16 | `{{VIDEO_ASSET_DIR}}\intro-portrait.mp4` | `{{VIDEO_ASSET_DIR}}\outro-portrait.mp4` |
| 1:1 | `{{VIDEO_ASSET_DIR}}\intro-square.mp4` | `{{VIDEO_ASSET_DIR}}\outro-square.mp4` |
| 4:5 | `{{VIDEO_ASSET_DIR}}\intro-feed.mp4` | `{{VIDEO_ASSET_DIR}}\outro-feed.mp4` |

### Duration Rules
| Video Type | Intro? | Outro? |
|------------|--------|--------|
| Main (>60s) | ✅ | ✅ |
| Shorts (<60s) | ❌ | ✅ |
| Medium (60s-5min) | ✅ | ✅ |

### Concat Command (Same Codec)
```powershell
# Create filelist.txt
@"
file '{{VIDEO_ASSET_DIR}}\intro-portrait.mp4'
file 'captioned-final.mp4'
file '{{VIDEO_ASSET_DIR}}\outro-portrait.mp4'
"@ | Set-Content filelist.txt

ffmpeg -y -f concat -safe 0 -i filelist.txt -c copy "output-with-bumpers.mp4"
```

### ⚠️ Time_Base Mismatch Fix (CRITICAL)
If caption-burned video has different time_base than bumpers (common after libx264 re-encode), concat with `-c copy` produces corrupt output (3hr file from 4min source).

**Solution:** ALWAYS re-encode during concat:
```powershell
ffmpeg -y -f concat -safe 0 -i filelist.txt -c:v libx264 -preset fast -crf 18 -c:a aac "output-with-bumpers.mp4"
```

**Validation:** After concat, verify `output duration ≈ sum of input durations (±2s)`. If wildly off → re-encode.

## Transcription (faster-whisper)

```python
from faster_whisper import WhisperModel

model = WhisperModel("base", device="cpu", compute_type="int8")
segments, info = model.transcribe("input.mp4", language="en", word_timestamps=True)

# Generate SRT
for i, segment in enumerate(segments, 1):
    print(f"{i}")
    print(f"{format_time(segment.start)} --> {format_time(segment.end)}")
    print(f"{segment.text.strip()}")
    print()
```

### Model Selection
| Model | Speed | Quality | Use When |
|-------|-------|---------|----------|
| `tiny` | ~10x realtime | Lower | Quick preview |
| `base` | ~5x realtime | Good | Default for speed |
| `small` | ~2x realtime | Better | Final captions |
| `medium` | ~0.5x realtime | High | Accuracy critical |
| `large-v3` | Slow (GPU needed) | Best | Premium content |

Default: `base` for speed. Use `small` for final published captions.

## Telegram Video Delivery

The built-in `telegram_send_photo` does NOT work for video files.
**Use Telegram Bot API `sendVideo` endpoint directly:**

```powershell
$botToken = (Get-Content .env | Where-Object { $_ -match '^TELEGRAM_BOT_TOKEN=' }) -replace 'TELEGRAM_BOT_TOKEN=',''
curl.exe -X POST "https://api.telegram.org/bot$botToken/sendVideo" -F "chat_id={{TELEGRAM_CHAT_ID}}" -F "video=@output.mp4" -F "caption=✅ Your edited video is ready!"
```
Supports files up to 50MB.

## Common Pitfalls
- ❌ Using FontSize=36 (covers speaker's face on vertical video)
- ❌ Using absolute Windows paths in `subtitles` filter (breaks on colon)
- ❌ Using `-c copy` for concat when codecs/time_bases differ
- ❌ Forgetting 50ms padding on silence removal (clips words)
- ❌ Using `telegram_send_photo` for video files
- ❌ Using MarginV=160+ (pushes captions into face area)
