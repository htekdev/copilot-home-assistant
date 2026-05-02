/**
 * Video Analyzer Extension — Auto-intercepts video content as it flows through
 * the session and triggers the full content-editor pipeline.
 *
 * Two modes:
 * 1. AUTO: onPostToolUse hook detects video file paths in tool output/args
 *    and injects editorial analysis context so the agent auto-processes them.
 * 2. MANUAL: analyze_video tool for on-demand Gemini AI analysis.
 *
 * Gemini upload uses Google's resumable protocol (up to 2GB).
 * API key from %APPDATA%/vidpipe/config.json or GEMINI_API_KEY in .env.
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename, extname } from "node:path";

const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_UPLOAD = 20 * 1024 * 1024; // 20 MB

const MIME_TYPES = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".webm": "video/webm", ".mkv": "video/x-matroska",
};

// Track videos we've already auto-analyzed to avoid duplicates
const analyzedVideos = new Set();

// Regex to detect video file paths in text
const VIDEO_PATH_RE = /(?:[A-Z]:\\|\/)[^\s"'<>|*?]+?telegram-video-\d+\.(?:mp4|mov|webm|mkv|avi)\b/gi;

function getApiKey() {
  const vidpipeCfg = join(process.env.APPDATA || process.env.HOME, "vidpipe", "config.json");
  if (existsSync(vidpipeCfg)) {
    try {
      const cfg = JSON.parse(readFileSync(vidpipeCfg, "utf-8"));
      if (cfg.credentials?.geminiApiKey) return cfg.credentials.geminiApiKey;
    } catch { /* fall through */ }
  }
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf-8").match(/^\s*GEMINI_API_KEY\s*=\s*(.+)/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.GEMINI_API_KEY || null;
}

/** Upload video to Gemini using resumable protocol, return analysis text. */
async function geminiAnalyze(videoPath, prompt) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No Gemini API key configured");
  if (!existsSync(videoPath)) throw new Error(`File not found: ${videoPath}`);

  const ext = extname(videoPath).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) throw new Error(`Unsupported format: ${ext}`);

  const videoBuffer = readFileSync(videoPath);
  if (videoBuffer.length > MAX_UPLOAD) {
    throw new Error(`File too large (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB). Max 20MB.`);
  }

  // Step 1: Init resumable upload
  const initRes = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(videoBuffer.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { displayName: basename(videoPath) } }),
  });
  if (!initRes.ok) throw new Error(`Upload init failed: ${await initRes.text()}`);
  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("No upload URL returned");

  // Step 2: Upload bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(videoBuffer.length),
      "Content-Type": mime,
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`);
  const uploaded = await uploadRes.json();
  const fileName = uploaded?.file?.name;
  if (!fileName) throw new Error("No file reference returned");

  // Step 3: Poll until ACTIVE
  const deadline = Date.now() + 120_000;
  let file;
  while (Date.now() < deadline) {
    const pollRes = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${apiKey}`);
    if (!pollRes.ok) throw new Error(`Status check failed: ${await pollRes.text()}`);
    file = await pollRes.json();
    if (file.state === "ACTIVE") break;
    if (file.state === "FAILED") throw new Error("Gemini failed to process the video");
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (file?.state !== "ACTIVE") throw new Error("Timed out (120s)");

  // Step 4: Generate content
  const genRes = await fetch(
    `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { fileData: { mimeType: mime, fileUri: file.uri } },
            { text: prompt || "Describe this video in detail. What is it about? What are the key moments, topics, and takeaways?" },
          ],
        }],
      }),
    }
  );
  if (!genRes.ok) throw new Error(`Gemini analysis failed: ${await genRes.text()}`);
  const data = await genRes.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "(no response)";
}

/** Run ffprobe and return key metadata as a formatted string. */
function ffprobeInspect(videoPath) {
  try {
    const raw = execFileSync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", videoPath,
    ], { timeout: 10000, encoding: "utf-8" });
    const info = JSON.parse(raw);
    const vs = info.streams?.find((s) => s.codec_type === "video");
    const as = info.streams?.find((s) => s.codec_type === "audio");
    const dur = parseFloat(info.format?.duration || "0").toFixed(1);
    const sizeMB = (parseInt(info.format?.size || "0") / 1048576).toFixed(2);
    const res = vs ? `${vs.width}x${vs.height}` : "unknown";
    const codec = vs?.codec_name || "unknown";
    const ar = vs && vs.width < vs.height ? "vertical (9:16)" : vs && vs.width > vs.height ? "horizontal (16:9)" : "square (1:1)";
    const audioInfo = as ? `${as.codec_name}, ${as.channels}ch, ${as.sample_rate}Hz` : "no audio";
    return `${dur}s | ${res} ${ar} | ${codec} | ${sizeMB}MB | audio: ${audioInfo}`;
  } catch (e) {
    return `(ffprobe failed: ${e.message})`;
  }
}

/** Run FFmpeg silencedetect and return parsed gaps. */
function detectSilence(videoPath) {
  try {
    const raw = execFileSync("ffmpeg", [
      "-i", videoPath, "-af", "silencedetect=noise=-30dB:d=0.5", "-f", "null", "-",
    ], { timeout: 30000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    // silencedetect outputs to stderr
    return "(check stderr)";
  } catch (e) {
    // FFmpeg writes to stderr even on success (exit code 0 comes as error with output)
    const output = (e.stderr || e.stdout || e.message || "").toString();
    const gaps = [];
    const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
    let m;
    while ((m = re.exec(output)) !== null) {
      gaps.push({ start: parseFloat(m[1]), end: parseFloat(m[2]), duration: parseFloat(m[3]) });
    }
    if (gaps.length === 0) return "No silence gaps detected (≥0.5s at -30dB)";
    return gaps.map((g) =>
      `${g.start.toFixed(1)}s–${g.end.toFixed(1)}s (${g.duration.toFixed(1)}s)`
    ).join("\n");
  }
}

/**
 * Build a full auto-analysis report for a video file.
 * Runs ffprobe + silence detection synchronously, Gemini async.
 */
async function buildVideoReport(videoPath) {
  const filename = basename(videoPath);
  const probeInfo = ffprobeInspect(videoPath);
  const silenceInfo = detectSilence(videoPath);

  let geminiSummary;
  try {
    geminiSummary = await geminiAnalyze(videoPath,
      "Analyze this video for editing. Identify: (1) what is happening — content, people, setting, speech, " +
      "(2) the most engaging segments with timestamps for YouTube Shorts, " +
      "(3) any audio/video quality issues, (4) suggested cut points. Return timestamps in MM:SS format."
    );
  } catch (e) {
    geminiSummary = `(Gemini analysis failed: ${e.message})`;
  }

  return [
    `[video-analyzer] 🎬 AUTO-ANALYSIS for ${filename}`,
    `📊 Media: ${probeInfo}`,
    `🔇 Silence gaps:\n${silenceInfo}`,
    `🤖 Gemini editorial analysis:\n${geminiSummary}`,
    ``,
    `⚡ CONTENT-EDITOR: This video has been fully analyzed. You have ffprobe metadata, silence gaps, and Gemini editorial direction above.`,
    `Use this to build an edit plan. Run faster-whisper for transcription if this is a talking-head video.`,
    `Send the edit plan to {{PARENT_1}} via Telegram (chat_id: {{TELEGRAM_PARENT_1}}).`,
  ].join("\n");
}

const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext: getApiKey()
        ? "[video-analyzer] ✅ Ready. Auto-intercepts incoming video content and runs full analysis (ffprobe + Gemini + silence detection)."
        : "[video-analyzer] ⚠️ No Gemini API key. Set in %APPDATA%/vidpipe/config.json or GEMINI_API_KEY in .env.",
    }),

    onPostToolUse: async (input) => {
      // Scan tool output and args for video file paths
      const haystack = [
        typeof input.toolResult === "string" ? input.toolResult : JSON.stringify(input.toolResult || ""),
        JSON.stringify(input.toolArgs || ""),
      ].join(" ");

      const matches = haystack.match(VIDEO_PATH_RE);
      if (!matches) return;

      // Deduplicate and filter to files we haven't analyzed yet
      const uniquePaths = [...new Set(matches)].filter((p) => {
        const normalized = p.replace(/\//g, "\\");
        return !analyzedVideos.has(normalized) && existsSync(normalized);
      });

      if (uniquePaths.length === 0) return;

      // Analyze the first new video found
      const videoPath = uniquePaths[0].replace(/\//g, "\\");
      analyzedVideos.add(videoPath);

      try {
        const report = await buildVideoReport(videoPath);
        return { additionalContext: report };
      } catch (e) {
        return {
          additionalContext: `[video-analyzer] ⚠️ Auto-analysis failed for ${basename(videoPath)}: ${e.message}. Use analyze_video manually.`,
        };
      }
    },
  },

  tools: [
    {
      name: "analyze_video",
      description: "Analyze a video file with Gemini AI. Send a video path and an optional prompt.",
      parameters: {
        type: "object",
        properties: {
          videoPath: { type: "string", description: "Absolute path to the video file" },
          prompt: { type: "string", description: "What to analyze (default: general description)" },
        },
        required: ["videoPath"],
      },
      handler: async ({ videoPath, prompt }) => {
        try {
          return await geminiAnalyze(videoPath, prompt);
        } catch (e) {
          return `❌ ${e.message}`;
        }
      },
    },
  ],
});
