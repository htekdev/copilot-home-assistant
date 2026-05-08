---
name: video-pipeline
description: Video production pipeline for creator brands — editing, quality review, intro/outro concat, publishing, and platform distribution. Use when user says "process video", "publish video", "video pipeline", "edit video", "quality review", "burn captions", "concat intro", "video auto-publish", or any video production activity.
---

# Video Pipeline Skill

Complete end-to-end video production workflow for a reusable media production team. This skill documents the canonical pipeline from raw recording to multi-platform publish.

## Pipeline Order (ALWAYS follow this sequence)

1. **Edit Silence** — Remove silent regions from raw video
2. **Transcribe** — Generate transcript from audio
3. **Generate Captions** — Create ASS/SRT subtitle file from transcript
4. **Burn Captions** — Hard-code captions into video
5. **Quality Review** — Automated quality check (MUST pass before proceeding)
6. **Concat Intro/Outro** — Prepend/append brand bumpers
7. **Generate Variants** — Create platform-specific aspect ratio versions
8. **Publish** — Upload and schedule across all platforms

## Configuration

All pipeline config lives in: `data/content/video-pipeline/config.json`

Key settings:
- `publishing.platforms` — account IDs for each platform
- `publishing.profileId` — Late/Zernio profile: `{{LATE_PROFILE_ID}}`
- `introOutro.sourceDir` — `{{VIDEO_ASSET_DIR}}`
- `qualityReview.maxRetries` — 2 attempts before escalating to the operator

## Step 1: Silence Removal

```
Tool: vidpipe-remove_silence
Parameters:
  videoPath: [input video path]
  output: [output path with "-edited" suffix]
  threshold: "-30dB"
  minDuration: 0.5
```

**Rules:**
- Add 50ms padding on each side to avoid clipping words
- Output file naming: `{original-name}-edited.mp4`

## Step 2: Transcription

Use Gemini AI via `analyze_video` with prompt requesting word-level timestamps. Or use external transcription service. Output: JSON array of `{start, end, text}` segments.

## Step 3: Caption Generation

Generate ASS subtitle file from transcript segments.

**Caption Style Standards (default preference):**
- Font: Arial Bold
- Size: 21pt (NEVER >24 for 720p vertical)
- Color: White text, black outline (2px), drop shadow
- Position: Bottom-center, MarginV=25+
- Max lines: 2 visible at once
- Word wrapping: Break at natural phrase boundaries

**Platform-Specific Safe Zones:**
| Platform | Aspect | Caption Zone |
|----------|--------|-------------|
| TikTok/Reels/Shorts | 9:16 | Middle 70% vertically |
| Instagram Feed | 1:1 | Bottom 30% |
| YouTube Main | 16:9 | Bottom 10% (traditional) |

## Step 4: Burn Captions

```
Tool: vidpipe-burn_captions
Parameters:
  videoPath: [edited video]
  captionsFile: [ASS file path]
  output: [output with "-captioned" suffix]
```

## Step 5: Quality Review (CRITICAL — MUST PASS)

```
Tool: analyze_video (Gemini AI)
Prompt: [use qualityReview.promptTemplate from config.json]
```

**Mandatory Checks:**
1. ✅ Captions stay in bottom 25% of frame (no overflow)
2. ✅ Face clearly visible throughout (not obstructed)
3. ✅ No bad editorial cuts (jump cuts, awkward transitions)
4. ✅ Audio quality (no clipping, appropriate volume)
5. ✅ Framing appropriate (face visible, not cut off)

**Critical Lessons Learned (from `data/content/video-pipeline/quality-checklist.md`):**
- FontSize=21 (not 36!), MarginV=25+ for 720×1280 vertical
- Face region (top 60% of vertical) must remain unobstructed
- After concat, verify output duration ≈ sum of inputs (±2s)
- Silence removal can clip word starts — use 50ms padding

**Failure Protocol:**
1. FAIL → identify issue → fix → re-review (retry 1)
2. Still FAIL → adjust approach → re-review (retry 2)
3. Still FAIL after 2 retries → **STOP. Notify the operator. Do NOT publish.**

Log all new lessons to `data/content/video-pipeline/quality-checklist.md`.

## Step 6: Intro/Outro Concat

**Rules:**
- Main videos: intro + outro
- Shorts: outro only (no intro)
- Medium clips: intro + outro

**Aspect Ratio Matching:**
| Video Ratio | Intro File | Outro File |
|-------------|-----------|-----------|
| 16:9 | `{{VIDEO_ASSET_DIR}}\intro.mp4` | `{{VIDEO_ASSET_DIR}}\outro.mp4` |
| 9:16 | `{{VIDEO_ASSET_DIR}}\intro-portrait.mp4` | `{{VIDEO_ASSET_DIR}}\outro-portrait.mp4` |
| 1:1 | `{{VIDEO_ASSET_DIR}}\intro-square.mp4` | `{{VIDEO_ASSET_DIR}}\outro-square.mp4` |
| 4:5 | `{{VIDEO_ASSET_DIR}}\intro-feed.mp4` | `{{VIDEO_ASSET_DIR}}\outro-feed.mp4` |

**Concat Command (ALWAYS re-encode — never `-c copy` due to time_base mismatch):**
```bash
ffmpeg -f concat -safe 0 -i filelist.txt -c:v libx264 -preset fast -crf 18 -c:a aac output.mp4
```

**⚠️ CRITICAL:** Caption-burned videos have `time_base=1/3883000` from libx264, but bumpers have `time_base=1/90000`. Using `-c copy` produces multi-hour corrupted files. ALWAYS re-encode.

**Post-concat validation:** Check output duration ≈ sum of input durations (±2s). If wildly off → re-encode.

## Step 7: Platform Variants

```
Tool: vidpipe-generate_variants
Parameters:
  videoPath: [final concatenated video]
  platforms: ["tiktok", "youtube", "instagram", "linkedin", "twitter"]
  outputDir: [run output directory]
```

## Step 8: Upload & Publish

### Upload Flow
1. Get presigned URL: `late_presign_upload(filename, content_type="video/mp4")`
2. PUT video to `uploadUrl`
3. Use `publicUrl` in media_items when creating posts

### Create Posts
```
late_create_post(
  content: [platform-specific copy],
  platforms: [{"platform": "youtube", "accountId": "{{YOUTUBE_ACCOUNT_ID}}"}, ...],
  media_items: [{"type": "video", "url": "[publicUrl]"}],
  queue_id: "{{LATE_PROFILE_ID}}",
  timezone: "{{TIMEZONE}}"
)
```

### Platform Account IDs

See `late-publishing` skill for the canonical account ID table. Key IDs for quick reference:
- Profile/Queue: `{{LATE_PROFILE_ID}}`
- YouTube: `{{YOUTUBE_ACCOUNT_ID}}`

## Run ID & Output Structure

- Run ID format: `video-YYYY-MM-DD-NNN`
- Output path: `data/content-editor-output/{run_id}/`
- Context package: `data/content-editor-output/{run_id}/context-package.json`

## Retry Policy (from config)

| Stage | Max Retries | Failure Policy |
|-------|------------|---------------|
| Research | 2 | Continue with partial |
| Planning | 1 | Stop and notify |
| Editing | 2 | Stop and notify |
| Blog | 2 | Partial success (don't block video) |
| Social | 2 | Per-platform independence |
| Upload | 3 | Per-platform retry |
| Scheduling | 1 | Non-fatal |

## Orchestration Model

- **Orchestrator:** content-editor
- **Parallel lanes:** editing, blog, social
- **Sequential prereqs:** research → planning
- **Notify on complete:** Always (notify the operator)

## Anti-Patterns

- ❌ Using `-c copy` for concat (time_base mismatch corruption)
- ❌ FontSize >24 for vertical video captions
- ❌ Publishing without quality review pass
- ❌ Blocking all platforms because one failed
- ❌ Generic "check out my video" social posts (must be specific to content)
- ❌ Missing cross-references to related articles and repos
