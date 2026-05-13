---
name: vidpipe-workflow
description: VidPipe record → process → review workflow for a family assistant repo — capture with video bridge, process with pinned VidPipe CLI, expose `vidpipe review` with `@ngrok/ngrok`, and notify {{PARENT_1}} via Telegram. Use when user says "VidPipe workflow", "process recorded video", "vidpipe review", "review link", "video bridge to VidPipe", or "record to review flow".
---

# VidPipe Workflow

Canonical workflow for turning a bridge-recorded video into a VidPipe review link {{PARENT_1}} can approve from a phone.

## Verified Baseline

- **Recorder bridge:** `http://localhost:3848`
- **VidPipe review UI:** `http://127.0.0.1:3847`
- **Pinned CLI version:** `vidpipe@1.3.26`
- **Tunnel library:** `@ngrok/ngrok` (**never** `ngrok.exe` on this machine — App Control blocks it)
- **{{PARENT_1}} Telegram:** `{{TELEGRAM_PARENT_1}}` with **mandatory** `speak` text

## Prerequisites

Before running the workflow, confirm:

1. `npx vidpipe@1.3.26 --version`
2. `npx vidpipe@1.3.26 doctor`
3. `.env` contains:
   - `OPENAI_API_KEY`
   - `EXA_API_KEY` *(optional but recommended)*
   - `LATE_API_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `NGROK_AUTHTOKEN`
4. Video bridge server is running on port `3848`
5. `@ngrok/ngrok` is installed for the extension runtime

## End-to-End Flow

1. **Record**
   - {{PARENT_1}} records via the existing mobile bridge on port `3848`
   - Uploaded videos land in `data/recordings/`

2. **Create run workspace**
   - Run directory: `data/video-pipeline-runs/{runId}/`
   - VidPipe output root: `data/video-pipeline-runs/{runId}/vidpipe/`

3. **Process with VidPipe**
   - Use the pinned npm package, not the stale global install:
   ```powershell
   npx vidpipe@1.3.26 process "C:\path\to\video.mp4" --once --output-dir "C:\Repos\{{GITHUB_USERNAME}}\{{FAMILY_NAME}}-family\data\video-pipeline-runs\video-YYYY-MM-DD-NNN\vidpipe" --no-git --progress
   ```
   - This generates transcripts, edited video, captions, shorts, medium clips, blog/social assets, and `publish-queue` items.

4. **Count outputs**
   - Shorts = unique `sourceClip` values from `publish-queue` items where `clipType=short`
   - Mediums = unique `sourceClip` values where `clipType=medium-clip`
   - Longs = unique `sourceVideo` values where `clipType=video` (usually `0` or `1`)

5. **Start VidPipe review UI**
   - Run review against the same VidPipe output root:
   ```powershell
   $env:OUTPUT_DIR = "C:\Repos\{{GITHUB_USERNAME}}\{{FAMILY_NAME}}-family\data\video-pipeline-runs\video-YYYY-MM-DD-NNN\vidpipe"
   npx vidpipe@1.3.26 review --port 3847
   ```
   - The review UI reads `publish-queue/` inside that `OUTPUT_DIR`
   - If `3847` is busy, VidPipe retries upward automatically

6. **Expose the review UI**
   - Use `@ngrok/ngrok` from extension code:
   ```js
   const ngrok = await import("@ngrok/ngrok");
   const listener = await ngrok.default.forward({ addr: 3847, authtoken });
   const reviewUrl = listener.url();
   ```
   - Do **not** call `ngrok.exe`

7. **Notify {{PARENT_1}}**
   - Send Telegram with the public review URL and counts
   - When using the `telegram_send_message` tool, always include `speak`
   - Suggested message shape:
   ```text
   🎬 VidPipe run ready
   • 3 shorts, 2 mediums, 1 long
   • Review: https://...
   • Run: video-2026-05-07-001
   ```
   - Suggested speak text:
   ```text
   Your video is processed and ready to review. I sent the public link and the clip counts.
   ```

## Operational Notes

- Prefer **`npx vidpipe@1.3.26`** over the globally installed binary so the workflow stays pinned to the verified version.
- Keep the review server **single-run scoped** by pointing `OUTPUT_DIR` at that run's VidPipe folder.
- If a newer upload arrives, stop the old review server/tunnel and point the new run at port `3847`.
- VidPipe review is a **queue review UI**, not a clip timeline editor. Approval is done on generated queue items.

## Verification Commands

```powershell
npx vidpipe@1.3.26 --version
npx vidpipe@1.3.26 doctor
npx vidpipe@1.3.26 process --help
npx vidpipe@1.3.26 review --help
```

## Failure / Recovery

### `ngrok.exe` blocked
- Expected on this machine
- Use `@ngrok/ngrok` only

### Local VidPipe repo is broken
- The local checkout at `C:\Repos\{{GITHUB_USERNAME}}\video-pipeline-repo` may need `npm install`
- The family-assistant workflow should still use `npx vidpipe@1.3.26`

### Review UI won’t load
1. Confirm the VidPipe review child process is running
2. Confirm `OUTPUT_DIR\publish-queue\` contains items
3. Recreate the ngrok tunnel for port `3847`

### No clips created
- Check the VidPipe process log
- Review counts from `publish-queue` metadata
- Notify {{PARENT_1}} with the failure summary instead of a dead review link
