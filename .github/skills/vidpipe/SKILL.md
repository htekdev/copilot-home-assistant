---
name: vidpipe
description: >
  VidPipe CLI video processing — run the VidPipe pipeline on a recorded video, monitor progress,
  launch the review server, and handle the full flow from recording to review-ready. Use when user says
  "process video", "vidpipe", "run vidpipe", "video processing", "review server", "pipeline log",
  "process recording", or when the video-bridge extension sends a processing request via session.send().
---

# VidPipe Processing Skill

How to process a video recording through VidPipe and prepare it for review. This is the canonical reference for any agent that receives a video processing request from the video-bridge extension.

## ⚠️ CRITICAL: Long-Running Process

VidPipe processing takes **5–30+ minutes** depending on video length. It performs silence removal, transcription, captioning, clip generation, thumbnail creation, and social post drafting — all in one pipeline run.

**NEVER** spawn VidPipe from an extension or short-lived context. Always run it from a session/agent where long execution is expected.

## Default Paths (from `%APPDATA%\vidpipe\config.json`)

| Path | Purpose |
|------|---------|
| `C:\VidPipe\output` | Default output directory — all processed videos land here |
| `C:\VidPipe\brand.json` | Brand config (logos, fonts, colors) |
| `C:\VidPipe\schedule.json` | Platform-specific posting schedules |

**DO NOT override `--output-dir`** — let VidPipe use its default `C:\VidPipe\output`. This keeps all outputs in one predictable location and avoids fragmented output across run directories.

## Step 1: Process the Video

Run VidPipe via npx (version pinned at 1.3.26):

```bash
npx vidpipe@1.3.26 process "<video-file-path>" --once --progress
```

### Valid Flags

| Flag | Purpose |
|------|---------|
| `--once` | Process a single file and exit (don't watch for new files) |
| `--progress` | Show progress updates during processing |
| `--verbose` | Extra logging output |
| `--no-silence-removal` | Skip silence removal step |
| `--no-shorts` | Skip short clip generation |
| `--no-medium-clips` | Skip medium clip generation |

**Invalid flags:** `--no-git` does NOT exist — never use it.

### Monitoring Progress

VidPipe writes real-time progress to `pipeline.log` inside the output subfolder. To monitor:

1. Wait ~10 seconds after starting for the output subfolder to appear
2. Check `C:\VidPipe\output\` for the newest subfolder (named after the video)
3. Tail `pipeline.log` inside that subfolder for live progress
4. Look for `"Pipeline complete"` to know processing finished

### Output Structure

After processing, VidPipe creates a subfolder in `C:\VidPipe\output\` containing:

```
C:\VidPipe\output\<video-name>\
├── pipeline.log          # Full processing log
├── transcript.json       # Word-level transcript
├── summary.json          # AI-generated summary
├── <video>-processed.mp4 # Primary processed video
├── shorts/               # Short clips (<60s)
├── medium-clips/         # Medium clips (1-5min)
├── social-posts/         # Generated social media copy
└── thumbnails/           # AI-generated thumbnails
```

### Error Handling

If VidPipe fails:
1. Check `pipeline.log` for the specific error
2. Common issues: FFmpeg not found, Gemini API timeout, disk space
3. Notify {{PARENT_1}} via Telegram with the error details
4. Do NOT retry automatically — wait for {{PARENT_1}}'s instructions

## Step 2: Launch the Review Server

After processing completes successfully, start the review server so {{PARENT_1}} can review on his phone:

```bash
npx vidpipe@1.3.26 review --port 3847
```

Set the `OUTPUT_DIR` environment variable to the VidPipe output directory:

```
OUTPUT_DIR=C:\VidPipe\output
```

The review server serves a web UI at `http://localhost:3847` that shows:
- All processed videos with thumbnails
- Short/medium clip previews
- Approve/reject buttons for each item

### Making the Review Server Accessible

The video-bridge extension registers a "review" service with the ngrok gateway. Once the review server is running on port 3847, the gateway routes traffic to it automatically. No separate tunnel is needed.

## Step 3: Notify {{PARENT_1}}

After processing completes and the review server is ready, send {{PARENT_1}} a Telegram message:

```
🎬 *VidPipe review ready*
• Shorts: {count}
• Mediums: {count}
• Longs: {count}
• Review: {review_url}
```

Use the `speak` parameter: "Your video was processed. I found X shorts, Y medium clips, and Z long videos. Review link is ready."

## Full Flow (triggered by video-bridge extension)

When the video-bridge extension receives a recording upload, it sends a `session.send()` message to the agent. Here's the expected flow:

1. **Receive processing request** — message includes file path, filename, size, duration, and run ID
2. **Run VidPipe** — `npx vidpipe@1.3.26 process "<file>" --once --progress`
3. **Monitor progress** — tail `pipeline.log` in the output subfolder
4. **Count outputs** — scan the output subfolder for shorts/, medium-clips/, and primary video
5. **Start review server** — `npx vidpipe@1.3.26 review --port 3847` with `OUTPUT_DIR=C:\VidPipe\output`
6. **Notify {{PARENT_1}}** — Telegram with counts and review URL
7. **Wait for approval** — {{PARENT_1}} reviews on phone, approves/rejects via the review UI
8. **On approval** — the video-bridge extension handles the publish flow via a separate `session.send()`

## Windows-Specific Notes

- VidPipe is a Node.js CLI tool — `npx.cmd` requires `shell: true` on Windows
- NVM-for-Windows may leave `node` missing from PATH — if spawning fails, check `%LOCALAPPDATA%\nvm\` for installed versions and prepend to PATH
- FFmpeg must be in PATH (VidPipe depends on it for all video operations)
