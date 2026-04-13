/**
 * Video Analyzer Extension — Analyze videos with Gemini AI.
 *
 * Follows the same simple pattern as the telegram-bridge Whisper transcription:
 * read file → upload to API → get response → return text.
 *
 * API key from %APPDATA%/vidpipe/config.json or GEMINI_API_KEY in .env.
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";

const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_UPLOAD = 20 * 1024 * 1024; // 20 MB simple upload limit

const MIME_TYPES = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".webm": "video/webm", ".mkv": "video/x-matroska",
};

function getApiKey() {
  // Primary: vidpipe config (same pattern as telegram-bridge)
  const vidpipeCfg = join(process.env.APPDATA || process.env.HOME, "vidpipe", "config.json");
  if (existsSync(vidpipeCfg)) {
    try {
      const cfg = JSON.parse(readFileSync(vidpipeCfg, "utf-8"));
      if (cfg.credentials?.geminiApiKey) return cfg.credentials.geminiApiKey;
    } catch { /* fall through */ }
  }
  // Fallback: .env
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf-8").match(/^\s*GEMINI_API_KEY\s*=\s*(.+)/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.GEMINI_API_KEY || null;
}

const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext: getApiKey()
        ? "[video-analyzer] ✅ Gemini API key found. analyze_video tool is ready."
        : "[video-analyzer] ⚠️ No Gemini API key. Set in %APPDATA%/vidpipe/config.json or GEMINI_API_KEY in .env.",
    }),
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
        const apiKey = getApiKey();
        if (!apiKey) return "❌ No Gemini API key configured.";
        if (!existsSync(videoPath)) return `❌ File not found: ${videoPath}`;

        const ext = extname(videoPath).toLowerCase();
        const mime = MIME_TYPES[ext];
        if (!mime) return `❌ Unsupported format: ${ext}. Use ${Object.keys(MIME_TYPES).join(", ")}`;

        const videoBuffer = readFileSync(videoPath);
        if (videoBuffer.length > MAX_UPLOAD) {
          return `❌ File too large (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB). Max 20MB for simple upload.`;
        }

        // 1. Upload to Gemini Files API (multipart, same pattern as Whisper)
        const boundary = "----GeminiBoundary" + Date.now();
        const metadata = JSON.stringify({ file: { displayName: basename(videoPath) } });
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
          videoBuffer,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const uploadRes = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
        });
        if (!uploadRes.ok) return `❌ Upload failed: ${await uploadRes.text()}`;
        const uploaded = await uploadRes.json();
        const fileName = uploaded?.file?.name;
        if (!fileName) return "❌ Upload succeeded but no file reference returned.";

        // 2. Poll until file is ACTIVE (Gemini needs to process the video)
        const deadline = Date.now() + 120_000;
        let file;
        while (Date.now() < deadline) {
          const pollRes = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${apiKey}`);
          if (!pollRes.ok) return `❌ Status check failed: ${await pollRes.text()}`;
          file = await pollRes.json();
          if (file.state === "ACTIVE") break;
          if (file.state === "FAILED") return "❌ Gemini failed to process the video.";
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (file?.state !== "ACTIVE") return "❌ Timed out waiting for video processing (120s).";

        // 3. Send to generateContent
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
        if (!genRes.ok) return `❌ Gemini analysis failed: ${await genRes.text()}`;
        const data = await genRes.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || "❌ No response from Gemini.";
      },
    },
  ],
});
