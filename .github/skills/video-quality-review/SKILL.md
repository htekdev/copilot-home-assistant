---
name: video-quality-review
description: Video publishing quality gate — Gemini-powered visual review, caption overflow detection, face visibility, audio quality, framing standards, and retry logic. Use when user says "review video quality", "quality check", "is this publishable", "check captions", "video review", "quality gate", "pre-publish check", or any video needs approval before publishing.
---

# Video Quality Review Skill

Pre-publish quality gate for {{GITHUB_USERNAME}} video content. Uses Gemini AI (via `analyze_video`) to verify videos meet publishing standards before going live.

> **Meta-pattern:** This skill implements the `quality-gate` skill (`.github/skills/quality-gate/SKILL.md`) — the generic check → fix → recheck → escalate pattern, retry strategies, failure policies, and lessons-learned framework.

## When to Invoke

- After captions are burned into the video
- Before intro/outro concat (catch issues early)
- Before uploading to any platform
- When content-editor wants to validate an edit

## The Review Process

### Step 1: Run AI Analysis

```
analyze_video(
  videoPath: "[path to edited video]",
  prompt: "Review this edited video for publishing quality. Check specifically for: 1) Are captions/subtitles overflowing the screen or blocking the speaker's face? 2) Are there bad editorial cuts (jump cuts in speech, awkward transitions)? 3) Any audio issues (clipping, too quiet, background noise)? 4) Is framing appropriate (face visible, not cut off)? 5) Any visual artifacts or encoding issues? Report PASS or FAIL with specific issues found."
)
```

### Step 2: Evaluate Against Critical Checks

| Check | FAIL Criteria | Fix Action |
|-------|--------------|------------|
| **Caption Overflow** | Any caption extends above bottom 25% of frame | Reduce FontSize (max 21pt for 720p vertical), increase MarginV (min 25) |
| **Face Obstruction** | Speaker's face obscured by overlays/captions in top 60% | Reposition overlay, adjust caption area |
| **Audio Clipping** | Distortion, sudden volume drops, background noise | Re-process audio, adjust silence removal padding |
| **Editorial Cuts** | Jump cuts mid-sentence, awkward transitions | Re-edit with better cut points |
| **Framing** | Face cut off, too zoomed, speaker not visible | Re-crop or adjust framing |

### Step 3: Pass/Fail Decision

- **PASS** → Proceed to intro/outro concat and publishing
- **FAIL** → Apply fix, then re-review (max 2 retries)
- **FAIL after 2 retries** → Stop pipeline, notify {{PARENT_1}} via Telegram. Do NOT publish.

## Caption Standards ({{PARENT_1}}'s Preferences)

| Property | Value |
|----------|-------|
| Font | Arial Bold |
| Size | 21pt (NEVER >24 for 720p vertical) |
| Color | White text, black outline (2px), drop shadow |
| Position | Bottom-center, MarginV ≥ 25 |
| Max lines | 2 visible simultaneously |
| Wrapping | Break at natural phrase boundaries |

## Platform-Specific Safe Zones

| Platform Format | Vertical Safe Zone | Caption Placement |
|-----------------|-------------------|-------------------|
| 9:16 (TikTok/Reels/Shorts) | Middle 70% (top/bottom 15% cropped by UI) | Within middle 70% |
| 1:1 (Instagram Feed) | Full frame usable | Bottom 25% |
| 16:9 (YouTube Main) | Full frame | Bottom 10% (traditional) |
| 4:5 (Instagram/Facebook) | Near-full | Bottom 20% |

## Known Issues (Lessons Learned)

### Concat Time_Base Mismatch
- **Problem:** `-c copy` concat produces wildly wrong duration when time_bases differ
- **Root cause:** Caption-burned video = time_base 1/3883000 (libx264 VFR), bumpers = 1/90000
- **Fix:** ALWAYS re-encode during concat: `-c:v libx264 -preset fast -crf 18 -c:a aac`
- **Validation:** After concat, verify output duration ≈ sum of inputs (±2s)

### Silence Removal Audio Clipping
- **Problem:** Aggressive silence removal clips word beginnings/endings
- **Fix:** Minimum silence duration 0.5s, add 50ms padding on each side

## Self-Improvement Loop

After each pipeline run, reflect:
1. Did quality review catch all issues?
2. Any near-misses that should become new checks?
3. Update `data/content/video-pipeline/quality-checklist.md` with new lessons

## Integration

- **Primary consumer:** content-editor agent (video pipeline orchestrator)
- **Config source:** `data/content/video-pipeline/config.json` → `qualityReview` section
- **Lessons file:** `data/content/video-pipeline/quality-checklist.md`
