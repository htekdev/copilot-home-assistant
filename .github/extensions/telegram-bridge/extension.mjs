/**
 * Telegram Bridge Extension for {{PRODUCT}} CLI
 *
 * Bridges Telegram messages <-> Copilot CLI sessions using long polling.
 * - Telegram messages become user prompts in the session.
 * - Assistant responses are forwarded back to Telegram.
 *
 * Requires TELEGRAM_BOT_TOKEN in .env at the project root.
 * Set TELEGRAM_ALLOWED_USERS to a JSON array of user ID strings to restrict access.
 *
 * Set BRIDGE_MODE=standalone in .env to disable this extension
 * (when using the standalone bridge service instead).
 */
import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

// GramJS-powered large file downloader (MTProto, no 20MB limit)
const __dirname = dirname(fileURLToPath(import.meta.url));
let downloadLargeFile = null;
try {
  const mod = await import(resolve(__dirname, "gramjs-downloader.mjs"));
  downloadLargeFile = mod.downloadLargeFile;
} catch {
  // GramJS not available — will fall back to Bot API (with 20MB limit)
}

// ---------------------------------------------------------------------------
// Skip if standalone bridge service is handling Telegram
// ---------------------------------------------------------------------------
function checkBridgeMode() {
  if (process.env.BRIDGE_MODE === "standalone") return true;
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return false;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "BRIDGE_MODE=standalone") return true;
  }
  return false;
}

if (checkBridgeMode()) {
  await joinSession({ tools: [] });
  // Extension loaded but idle — standalone service handles Telegram
} else {

// ---------------------------------------------------------------------------
// Configuration — read from .env
// ---------------------------------------------------------------------------
const ENV_FILE = resolve(process.cwd(), ".env");
let TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
let ALLOWED_USERS_RAW = process.env.TELEGRAM_ALLOWED_USERS || "";
let TELEGRAM_API_ID = process.env.TELEGRAM_API_ID || "";
let TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH || "";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "TELEGRAM_BOT_TOKEN" && !TELEGRAM_TOKEN) TELEGRAM_TOKEN = value;
    if (key === "TELEGRAM_ALLOWED_USERS" && !ALLOWED_USERS_RAW) ALLOWED_USERS_RAW = value;
    if (key === "TELEGRAM_API_ID" && !TELEGRAM_API_ID) TELEGRAM_API_ID = value;
    if (key === "TELEGRAM_API_HASH" && !TELEGRAM_API_HASH) TELEGRAM_API_HASH = value;
  }
}

parseEnvFile(ENV_FILE);

// Parse allowed users as a Set of user ID strings
let ALLOWED_USERS = new Set();
try {
  const parsed = JSON.parse(ALLOWED_USERS_RAW);
  if (Array.isArray(parsed)) {
    ALLOWED_USERS = new Set(parsed.map(String));
  }
} catch {
  // Fall back to empty set — no user restriction
}

function isUserAllowed(userId) {
  if (ALLOWED_USERS.size === 0) return true; // no restriction if empty
  return ALLOWED_USERS.has(String(userId));
}

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------
// Support custom Telegram Bot API server (local server supports up to 2GB file downloads)
let TELEGRAM_API_SERVER = process.env.TELEGRAM_API_SERVER || "";
if (!TELEGRAM_API_SERVER) {
  try {
    const envContent = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf-8") : "";
    for (const line of envContent.split("\n")) {
      const t = line.trim();
      if (t.startsWith("TELEGRAM_API_SERVER=")) {
        let v = t.slice("TELEGRAM_API_SERVER=".length).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        TELEGRAM_API_SERVER = v;
      }
    }
  } catch { /* ignore */ }
}
const API_BASE_HOST = TELEGRAM_API_SERVER || `https://api.telegram.org`;
const API_BASE = `${API_BASE_HOST}/bot${TELEGRAM_TOKEN}`;
const FILE_BASE = `${API_BASE_HOST}/file/bot${TELEGRAM_TOKEN}`;

// Telegram Bot API getFile limit: 20MB for cloud API, ~2GB for local Bot API server
const TELEGRAM_GETFILE_LIMIT = TELEGRAM_API_SERVER ? 2000 * 1024 * 1024 : 20 * 1024 * 1024;

async function telegramApi(method, body = {}) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return data.result;
}

const TELEGRAM_MAX_LENGTH = 4096;

async function sendTelegramMessage(chatId, text) {
  if (!text || text.trim().length === 0) return;
  // Detect if the text already contains HTML tags
  const isAlreadyHtml = /<(?:b|i|u|s|a|code|pre|em|strong)\b[^>]*>/i.test(text);
  const chunks = [];
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
    chunks.push(text.slice(i, i + TELEGRAM_MAX_LENGTH));
  }
  for (const chunk of chunks) {
    try {
      if (isAlreadyHtml) {
        // Already HTML — send directly (just sanitize unsupported tags)
        const sanitized = sanitizeTelegramHtml(chunk);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: sanitized,
          parse_mode: "HTML",
        });
      } else {
        // Convert markdown-ish text to Telegram HTML
        const html = telegramTextToHtml(chunk);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
        });
      }
    } catch {
      // Fall back to plain text (strip all tags)
      const plain = chunk.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      await telegramApi("sendMessage", { chat_id: chatId, text: plain });
    }
    if (chunks.length > 1) await sleep(150);
  }
}

// Sanitize HTML for Telegram — only allows supported tags
function sanitizeTelegramHtml(html) {
  // Telegram supports: b, strong, i, em, u, ins, s, strike, del, a, code, pre
  // Remove unsupported tags but keep their content
  return html
    .replace(/<\/?(?!b|strong|i|em|u|ins|s|strike|del|a|code|pre|\/)[a-z][^>]*>/gi, "")
    .replace(/&amp;amp;/g, "&amp;"); // fix double-encoded ampersands
}

// Convert markdown-ish text to Telegram HTML
function telegramTextToHtml(text) {
  return text
    // Escape HTML entities first
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    // Italic *text* or _text_
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>")
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>")
    // Code `text`
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

async function sendTypingAction(chatId) {
  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    /* best-effort */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Gemini video analysis (same direct-call pattern as Whisper for voice notes)
// ---------------------------------------------------------------------------
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MIME = {
  mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  webm: "video/webm", mkv: "video/x-matroska",
};

function getGeminiApiKey() {
  const vidpipeCfg = join(
    process.env.APPDATA || process.env.HOME, "vidpipe", "config.json"
  );
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

async function analyzeVideoWithGemini(videoPath, videoBuffer, ext) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("No Gemini API key configured");

  const mime = GEMINI_MIME[ext] || "video/mp4";
  // Gemini Files API supports up to 2GB uploads
  if (videoBuffer.length > 2000 * 1024 * 1024) {
    throw new Error(`Video too large (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB). Gemini max is 2GB.`);
  }

  // 1. Upload to Gemini Files API using resumable upload protocol
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
  if (!uploadUrl) throw new Error("Upload init succeeded but no upload URL returned");

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
  if (!fileName) throw new Error("Upload succeeded but no file reference returned");

  // 2. Poll until file is ACTIVE
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
  if (file?.state !== "ACTIVE") throw new Error("Timed out waiting for Gemini video processing (120s)");

  // 3. Generate content
  const genRes = await fetch(
    `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { fileData: { mimeType: mime, fileUri: file.uri } },
            { text: "Describe this video concisely. What does it show? Who/what is in it? What are the key topics, actions, or takeaways? Keep it under 300 words." },
          ],
        }],
      }),
    }
  );
  if (!genRes.ok) throw new Error(`Gemini analysis failed: ${await genRes.text()}`);
  const data = await genRes.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "(no analysis returned)";
}

// ---------------------------------------------------------------------------
// Long-polling loop
// ---------------------------------------------------------------------------
let running = false;
let pollOffset = 0;
let activeChatId = null;
let pollController = null;
let typingInterval = null;

async function skipOldUpdates() {
  try {
    const result = await telegramApi("getUpdates", {
      offset: -1,
      limit: 1,
      timeout: 0,
    });
    if (result.length > 0) {
      pollOffset = result[0].update_id + 1;
    }
  } catch {
    /* start from 0 */
  }
}

function startTypingIndicator(chatId) {
  stopTypingIndicator();
  sendTypingAction(chatId);
  typingInterval = setInterval(() => sendTypingAction(chatId), 4000);
}

function stopTypingIndicator() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}

async function pollLoop(session) {
  running = true;

  // Wait briefly for any previous instance's getUpdates to finish dying.
  // Telegram only allows one getUpdates consumer per bot token.
  await sleep(2000);

  await skipOldUpdates();

  try {
    const me = await telegramApi("getMe");
    await session.log(
      `Telegram bot connected: @${me.username} (${me.first_name})`
    );
  } catch (err) {
    await session.log(`Could not verify bot identity: ${err.message}`, {
      level: "warning",
    });
  }

  await session.log("Telegram long polling started — waiting for messages");

  while (running) {
    try {
      pollController = new AbortController();

      const res = await fetch(`${API_BASE}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: pollOffset,
          timeout: 10,
          allowed_updates: ["message"],
        }),
        signal: pollController.signal,
      });

      const data = await res.json();

      if (!data.ok) {
        const isConflict = data.description?.includes("Conflict");
        if (isConflict) {
          // Another instance is still polling — back off and retry
          await session.log(
            "Waiting for previous polling instance to release...",
            { ephemeral: true }
          );
          await sleep(3000);
          continue;
        }
        await session.log(
          `Telegram API error: ${data.description}`,
          { level: "warning" }
        );
        await sleep(5000);
        continue;
      }

      for (const update of data.result) {
        pollOffset = update.update_id + 1;

        if (!update.message) continue;

        const msg = update.message;
        const chatId = String(msg.chat.id);
        const userId = msg.from?.id;
        const from =
          msg.from?.first_name || msg.from?.username || "Unknown";

        // Security: check if the sender is in the allowed users set
        if (!isUserAllowed(userId)) {
          await sendTelegramMessage(
            chatId,
            "Unauthorized. This bot is restricted to authorized family members."
          );
          continue;
        }

        activeChatId = chatId;

        // Debug: log message keys to understand what Telegram sends
        const msgKeys = Object.keys(msg).filter(k => !["message_id", "from", "chat", "date"].includes(k));
        if (msgKeys.length > 0 && !msg.text) {
          await session.log(`[Telegram] ${from} sent: ${msgKeys.join(", ")}`);
        }

        // Handle bot commands
        if (msg.text === "/start") {
          await sendTelegramMessage(
            chatId,
            `Connected! Your chat ID is: ${chatId}\n\n` +
              `Send any message and it will be forwarded to your {{PRODUCT}} CLI session.\n\n` +
              `Commands:\n/status — check bridge status\n/help — show this message`
          );
          continue;
        }

        if (msg.text === "/status") {
          await sendTelegramMessage(
            chatId,
            `Bridge Status\n` +
              `• Polling: ${running ? "active" : "stopped"}\n` +
              `• Chat ID: ${chatId}\n` +
              `• Offset: ${pollOffset}`
          );
          continue;
        }

        if (msg.text === "/help") {
          await sendTelegramMessage(
            chatId,
            `Telegram <-> Copilot CLI Bridge\n\n` +
              `Send any text message and it will be forwarded to your active Copilot CLI session as a user prompt.\n\n` +
              `The assistant's response will be sent back here automatically.\n\n` +
              `Commands:\n/start — welcome message & chat ID\n/status — bridge status\n/help — this message`
          );
          continue;
        }

        // Forward text messages to the session
        if (msg.text) {
          const preview =
            msg.text.length > 80
              ? msg.text.slice(0, 80) + "..."
              : msg.text;
          await session.log(`[Telegram] ${from}: ${preview}`);

          startTypingIndicator(chatId);

          // Fire-and-forget with setTimeout to avoid blocking the poll loop.
          // mode: "immediate" steers the agent mid-turn instead of queuing.
          setTimeout(() => {
            session.send({ prompt: `[Telegram from ${from} (user ${userId})]: ${msg.text}`, mode: "immediate" }).catch((err) => {
              session.log(
                `Failed to inject prompt: ${err.message}`,
                { level: "warning" }
              );
            });
          }, 0);
          continue;
        }

        // Non-text messages — notify user
        if (msg.photo || msg.document || msg.video || msg.voice || msg.sticker) {
          // Handle photos — download and forward as vision input
          if (msg.photo) {
            const caption = msg.caption || "What do you see in this image?";
            const preview =
              caption.length > 80 ? caption.slice(0, 80) + "..." : caption;
            await session.log(`[Telegram] ${from}: ${preview}`);

            startTypingIndicator(chatId);

            setTimeout(async () => {
              try {
                // Get the largest photo (last in array)
                const photo = msg.photo[msg.photo.length - 1];
                const fileInfo = await telegramApi("getFile", {
                  file_id: photo.file_id,
                });
                const fileUrl = `${FILE_BASE}/${fileInfo.file_path}`;

                // Download the image
                const imgRes = await fetch(fileUrl);
                const imgBuffer = await imgRes.arrayBuffer();
                const base64Data = Buffer.from(imgBuffer).toString("base64");

                // Determine mime type from file path
                const ext = fileInfo.file_path.split(".").pop().toLowerCase();
                const mimeMap = {
                  jpg: "image/jpeg",
                  jpeg: "image/jpeg",
                  png: "image/png",
                  gif: "image/gif",
                  webp: "image/webp",
                  bmp: "image/bmp",
                };
                const mimeType = mimeMap[ext] || "image/jpeg";

                await session.send({
                  prompt: `[Telegram from ${from} (user ${userId})]: ${caption}`,
                  mode: "immediate",
                  attachments: [
                    {
                      type: "blob",
                      data: base64Data,
                      mimeType,
                      displayName: fileInfo.file_path.split("/").pop(),
                    },
                  ],
                });
              } catch (err) {
                session.log(
                  `Failed to process image: ${err.message}`,
                  { level: "warning" }
                );
                await sendTelegramMessage(
                  chatId,
                  "Failed to process that image. Try again or send as text."
                );
              }
            }, 0);
            continue;
          }

          // Handle voice notes — transcribe with Whisper and forward as text
          if (msg.voice || msg.audio) {
            const voiceObj = msg.voice || msg.audio;
            await session.log(`[Telegram] ${from}: voice note (${voiceObj.duration}s)`);

            startTypingIndicator(chatId);

            setTimeout(async () => {
              try {
                // Get OpenAI key from vidpipe config
                const vidpipeConfig = join(
                  process.env.APPDATA || process.env.HOME,
                  "vidpipe",
                  "config.json"
                );
                let openaiKey = process.env.OPENAI_API_KEY || "";
                if (!openaiKey && existsSync(vidpipeConfig)) {
                  const vc = JSON.parse(readFileSync(vidpipeConfig, "utf-8"));
                  openaiKey = vc.credentials?.openaiApiKey || "";
                }
                if (!openaiKey) {
                  await sendTelegramMessage(chatId, "No OpenAI API key found for transcription.");
                  return;
                }

                // Download voice file
                const fileInfo = await telegramApi("getFile", { file_id: voiceObj.file_id });
                const fileUrl = `${FILE_BASE}/${fileInfo.file_path}`;
                const audioRes = await fetch(fileUrl);
                const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

                // Send to Whisper API
                const boundary = "----WhisperBoundary" + Date.now();
                const ext = (fileInfo.file_path || "voice.ogg").split(".").pop();
                const filename = `voice.${ext}`;
                const mimeMap = { ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
                const mime = mimeMap[ext] || "audio/ogg";

                const parts = [
                  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
                  audioBuffer,
                  `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`,
                ];
                const bodyBuffer = Buffer.concat([
                  Buffer.from(parts[0]),
                  parts[1],
                  Buffer.from(parts[2]),
                ]);

                const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${openaiKey}`,
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                  },
                  body: bodyBuffer,
                });

                if (!whisperRes.ok) {
                  const errText = await whisperRes.text();
                  throw new Error(`Whisper API ${whisperRes.status}: ${errText}`);
                }

                const result = await whisperRes.json();
                const transcript = result.text || "(empty transcription)";

                await session.log(`Transcribed: ${transcript.slice(0, 100)}...`);
                await session.send({
                  prompt: `[Telegram from ${from} (user ${userId})]: ${transcript}`,
                  mode: "immediate",
                });
              } catch (err) {
                session.log(`Failed to transcribe voice: ${err.message}`, { level: "warning" });
                await sendTelegramMessage(chatId, `Failed to transcribe voice note: ${err.message.slice(0, 100)}`);
              }
            }, 0);
            continue;
          }

          // Handle video messages — download, analyze with Gemini, forward summary as context
          if (msg.video || msg.video_note || msg.document?.mime_type?.startsWith("video/")) {
            const videoObj = msg.video || msg.video_note || msg.document;
            const caption = msg.caption || "";
            const fileSize = videoObj.file_size || 0;
            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
            await session.log(`🎬 [Telegram] ${from}: video received (${fileSizeMB}MB), checking size...`);

            startTypingIndicator(chatId);

            // Check if the file exceeds the Telegram Bot API getFile limit (20MB for cloud API)
            if (fileSize > TELEGRAM_GETFILE_LIMIT) {
              const limitMB = (TELEGRAM_GETFILE_LIMIT / (1024 * 1024)).toFixed(0);

              // Try MTProto download via GramJS (no file size limit)
              if (downloadLargeFile && TELEGRAM_API_ID && TELEGRAM_API_HASH) {
                await session.log(`🎬 Video ${fileSizeMB}MB exceeds Bot API limit — using MTProto (GramJS)...`);
                await sendTelegramMessage(chatId, `📹 Got your video (${fileSizeMB}MB) — downloading via MTProto... ⏳`);

                setTimeout(async () => {
                  try {
                    const dataDir = resolve(process.cwd(), "data");
                    const ext = (videoObj.file_name || videoObj.mime_type || "mp4").split(/[./]/).pop() || "mp4";
                    const videoFile = resolve(dataDir, `telegram-video-${Date.now()}.${ext}`);

                    await downloadLargeFile({
                      fileId: videoObj.file_id,
                      fileSize,
                      outputPath: videoFile,
                      botToken: TELEGRAM_TOKEN,
                      apiId: TELEGRAM_API_ID,
                      apiHash: TELEGRAM_API_HASH,
                      logger: (msg) => session.log(`🎬 ${msg}`),
                    });

                    await session.log(`🎬 Saved to ${videoFile} (${fileSizeMB}MB)`);

                    // Analyze with Gemini (Gemini supports up to 2GB via Files API)
                    const { readFileSync: readFS } = await import("node:fs");
                    const videoBuffer = readFS(videoFile);
                    let summary = "(video analysis unavailable)";
                    try {
                      summary = await analyzeVideoWithGemini(videoFile, videoBuffer, ext);
                      await session.log(`🎬 Gemini summary: ${summary.slice(0, 120)}...`);
                    } catch (gemErr) {
                      await session.log(`🎬 Gemini analysis failed: ${gemErr.message}`, { level: "warning" });
                    }

                    await sendTelegramMessage(chatId, `✅ Video downloaded and analyzed! Processing your request...`);

                    const captionPart = caption ? ` Caption: "${caption}".` : "";
                    await session.send({
                      prompt: `[Telegram from ${from} (user ${userId})]: Sent a video.${captionPart} [Video summary: ${summary}] The video file is at ${videoFile}.`,
                      mode: "immediate",
                    });
                  } catch (err) {
                    await session.log(`🎬 MTProto download error: ${err.message}`, { level: "warning" });
                    await sendTelegramMessage(chatId,
                      `❌ MTProto download failed: ${err.message.slice(0, 150)}\n\n` +
                      `**Workaround:** Save the video locally and share the file path:\n` +
                      `\`C:\\Users\\floreshector\\Videos\\my-video.mp4\``
                    );
                    const captionPart = caption ? ` Caption: "${caption}".` : "";
                    await session.send({
                      prompt: `[Telegram from ${from} (user ${userId})]: Sent a video (${fileSizeMB}MB) but MTProto download failed: ${err.message}.${captionPart} The user has been asked to share the file path instead.`,
                      mode: "immediate",
                    });
                  }
                }, 0);
                continue;
              }

              // No MTProto available — fall back to asking for file path
              await session.log(`🎬 Video too large (${fileSizeMB}MB > ${limitMB}MB) and MTProto not configured`, { level: "warning" });

              await sendTelegramMessage(chatId,
                `📹 Got your video (${fileSizeMB}MB) but Telegram's Bot API has a ${limitMB}MB download limit.\n\n` +
                (downloadLargeFile
                  ? `**To enable large file downloads**, add to your .env:\n\`TELEGRAM_API_ID=your_id\`\n\`TELEGRAM_API_HASH=your_hash\`\n(Get them free at https://my.telegram.org/apps)\n\n`
                  : "") +
                `**Workaround:** Save the video to your computer and share the file path:\n` +
                `\`C:\\Users\\floreshector\\Videos\\my-video.mp4\`\n\n` +
                `I'll pick it up from there and handle the rest! 🎬`
              );

              // Still forward the caption/intent to the session so the agent knows what the user wants
              const captionPart = caption ? ` Caption: "${caption}".` : "";
              await session.send({
                prompt: `[Telegram from ${from} (user ${userId})]: Sent a video (${fileSizeMB}MB) but it exceeds the Telegram Bot API ${limitMB}MB download limit.${captionPart} The user has been asked to share the file path instead. Wait for them to provide a local file path.`,
                mode: "immediate",
              });
              continue;
            }

            setTimeout(async () => {
              try {
                const fileInfo = await telegramApi("getFile", { file_id: videoObj.file_id });
                const fileUrl = `${FILE_BASE}/${fileInfo.file_path}`;
                await session.log(`🎬 Downloading: ${fileInfo.file_path}`);
                const videoRes = await fetch(fileUrl);
                if (!videoRes.ok) throw new Error(`Download failed: HTTP ${videoRes.status}`);
                const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

                // Save video file (kept for downstream agents to use)
                const dataDir = resolve(process.cwd(), "data");
                const ext = (fileInfo.file_path || "video.mp4").split(".").pop();
                const videoFile = resolve(dataDir, `telegram-video-${Date.now()}.${ext}`);
                writeFileSync(videoFile, videoBuffer);
                await session.log(`🎬 Saved to ${videoFile} (${(videoBuffer.length / 1024).toFixed(0)} KB)`);

                // Analyze with Gemini directly (same pattern as voice→Whisper)
                let summary = "(video analysis unavailable)";
                try {
                  summary = await analyzeVideoWithGemini(videoFile, videoBuffer, ext);
                  await session.log(`🎬 Gemini summary: ${summary.slice(0, 120)}...`);
                } catch (gemErr) {
                  await session.log(`🎬 Gemini analysis failed: ${gemErr.message}`, { level: "warning" });
                }

                // Build prompt with summary as context (like voice transcriptions)
                const captionPart = caption ? ` Caption: "${caption}".` : "";
                await session.send({
                  prompt: `[Telegram from ${from} (user ${userId})]: Sent a video.${captionPart} [Video summary: ${summary}] The video file is at ${videoFile}.`,
                  mode: "immediate",
                });
              } catch (err) {
                await session.log(`🎬 Video error: ${err.message}`, { level: "warning" });
                // Detect the "file is too big" error from Telegram API (fallback for when file_size wasn't available)
                if (err.message.includes("file is too big") || err.message.includes("file_size")) {
                  await sendTelegramMessage(chatId,
                    `📹 This video is too large for Telegram's Bot API download limit (20MB).\n\n` +
                    `**Workaround:** Save it locally and share the file path:\n` +
                    `\`C:\\Users\\floreshector\\Videos\\my-video.mp4\`\n\n` +
                    `I'll handle it from there! 🎬`
                  );
                  const captionPart = caption ? ` Caption: "${caption}".` : "";
                  await session.send({
                    prompt: `[Telegram from ${from} (user ${userId})]: Sent a video but it exceeds the Telegram Bot API 20MB download limit.${captionPart} The user has been asked to share the file path instead.`,
                    mode: "immediate",
                  });
                } else {
                  await sendTelegramMessage(chatId, `❌ Failed to process video: ${err.message.slice(0, 200)}`);
                }
              }
            }, 0);
            continue;
          }

          await sendTelegramMessage(
            chatId,
            "Only text, photo, voice, and video messages are supported right now."
          );
        }
      }
    } catch (err) {
      if (err.name === "AbortError") break;
      await session.log(
        `Polling error: ${err.message}`,
        { level: "warning" }
      );
      await sleep(3000);
    }
  }
}

let pollStarted = false;

// ---------------------------------------------------------------------------
// Dynamic agent discovery — reads .github/agents/*.agent.md at startup.
// The main agent (AI) decides which agent to use — no heuristics.
// ---------------------------------------------------------------------------
function discoverAgents() {
  const agentsDir = resolve(process.cwd(), ".github", "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith(".agent.md"))
    .map((f) => {
      try {
        const content = readFileSync(join(agentsDir, f), "utf-8");
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!fmMatch) return null;
        const fm = fmMatch[1];
        const name = (fm.match(/^name:\s*(.+)/m) || [])[1]?.trim();
        const desc = (fm.match(/^description:\s*"?([^"]*)"?/m) || [])[1]?.trim();
        return name ? { name, description: desc || name } : null;
      } catch { return null; }
    })
    .filter(Boolean);
}

const AVAILABLE_AGENTS = discoverAgents();

// ---------------------------------------------------------------------------
// Session setup
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      if (!TELEGRAM_TOKEN) {
        return {
          additionalContext:
            "[telegram-bridge] Telegram bridge is NOT active. " +
            "The user needs to set TELEGRAM_BOT_TOKEN in .env and reload extensions.",
        };
      }

      const userInfo = ALLOWED_USERS.size > 0
        ? ` (restricted to ${ALLOWED_USERS.size} authorized user(s))`
        : " (accepting all users)";
      return {
        additionalContext:
          `[telegram-bridge] Telegram bridge is ACTIVE${userInfo}. ` +
          `Incoming Telegram messages will appear as user prompts prefixed with the sender's user ID. ` +
          `Use the who_is_asking tool to identify family members by Telegram user ID. ` +
          `All your responses are automatically forwarded to Telegram. ` +
          `You also have a 'telegram_send_message' tool for explicit sends.`,
      };
    },

    onUserPromptSubmitted: async (input) => {
      const prompt = input.prompt || "";
      // Only apply to Telegram messages, not cron jobs (those already delegate)
      if (!prompt.startsWith("[Telegram from")) return;

      // Extract the user ID and message from the prompt
      const userMatch = prompt.match(/\[Telegram from (.+?) \(user (\d+)\)\]: (.+)/s);
      if (!userMatch) return;
      const [, senderName, senderId, userMessage] = userMatch;

      // Get current local time in Central timezone
      const now = new Date();
      const localTime = now.toLocaleString("en-US", {
        timeZone: "{{TIMEZONE}}",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      // Smart dispatch — steer existing agents for follow-ups, launch fresh for new topics
      return {
        modifiedPrompt:
          `[Telegram from ${senderName} (user ${senderId})]: "${userMessage}"\n\n` +
          `Current time: ${localTime} (Central Time).\n` +
          `MANDATORY: You MUST delegate this to background agent(s). Do NOT handle this inline.\n\n` +
          `## STEP 0: STEER vs LAUNCH DECISION (check BEFORE delegating)\n` +
          `Call list_agents() first to see IDLE/RUNNING background agents.\n` +
          `Then decide for EACH distinct task in the message:\n\n` +
          `**STEER an existing agent (write_agent) WHEN ALL of these are true:**\n` +
          `- An IDLE agent exists that was working on a RELATED topic (same domain, same conversation thread)\n` +
          `- The new message is a FOLLOW-UP — correcting, clarifying, adding to, or continuing a prior discussion\n` +
          `  (e.g., "No, the Savor is the subscription card", "also add milk", "what about the other one?")\n` +
          `- The existing agent has CONTEXT that would be LOST by launching fresh (names, decisions, partial work)\n` +
          `- The task is in the SAME domain as what that agent was doing\n` +
          `→ Use write_agent(agent_id, message) to inject the follow-up. The agent wakes up with full prior context.\n\n` +
          `**LAUNCH a NEW agent (task tool) WHEN ANY of these are true:**\n` +
          `- The message is a NEW topic unrelated to any running/idle agent's context\n` +
          `- No idle agents exist, or none have relevant context\n` +
          `- High-quality results are needed with NO dependency on prior context (fresh analysis, clean slate)\n` +
          `- The message is clearly a standalone request (e.g., "what's the weather?", "add eggs to the list")\n` +
          `- You're unsure whether to steer or launch → LAUNCH NEW (safer — clean context never hurts)\n\n` +
          `## STEP 1: Analyze the message\n` +
          `- Identify how many distinct tasks/requests it contains\n` +
          `- For EACH task, apply the steer-vs-launch decision above\n\n` +
          `## STEP 2: Execute\n` +
          `- For follow-ups → write_agent to the relevant idle agent\n` +
          `- For new requests → launch via task tool (pick the best custom agent_type, or general-purpose if none fits)\n` +
          `- If MULTIPLE independent new requests, launch MULTIPLE agents in parallel\n` +
          `- Each agent responds via telegram_send_message (chat_id: "${senderId}")\n\n` +
          `## STEP 3: Acknowledge & continue\n` +
          `- You only send a Telegram yourself for trivial acknowledgments (e.g., "goodnight", "thanks")\n` +
          `- Continue immediately after dispatching — do not wait for results.`,
      };
    },

    onSessionEnd: async () => {
      stopTypingIndicator();
    },
  },

  tools: [
    {
      name: "telegram_send_message",
      description:
        "Send a message to a Telegram chat. If chat_id is omitted, sends to the last active chat. " +
        "Supports Markdown formatting (auto-converted to HTML) and plain text. " +
        "Messages longer than 4096 chars are automatically chunked.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message text to send. Supports **bold**, *italic*, `code`, and [links](url).",
          },
          chat_id: {
            type: "string",
            description:
              "Target Telegram chat ID. Omit to use the last active chat.",
          },
          speak: {
            type: "string",
            description:
              "Short TTS text for Tasker integration (1-2 sentences, no emojis/markdown). " +
              "When provided, 'SPEAK: [text]' is prepended to the message so it appears in notification previews. " +
              "ALWAYS use this when sending to {{PARENT_1}} ({{TELEGRAM_PARENT_1}}). " +
              "Do NOT use for {{PARENT_2}} ({{TELEGRAM_PARENT_2}}) — she doesn't use Tasker TTS.",
          },
        },
        required: ["message"],
      },
      handler: async (args) => {
        const targetChat = args.chat_id || activeChatId;
        if (!targetChat) {
          return {
            textResultForLlm:
              "No active Telegram chat. A user must message the bot first.",
            resultType: "failure",
          };
        }
        if (!TELEGRAM_TOKEN) {
          return {
            textResultForLlm:
              "Telegram bridge is not configured. Set TELEGRAM_BOT_TOKEN in .env.",
            resultType: "failure",
          };
        }
        try {
          // Compose final message: prepend SPEAK: line if speak parameter provided
          let finalMessage = args.message;
          if (args.speak && args.speak.trim()) {
            finalMessage = `SPEAK: ${args.speak.trim()}\n\n${args.message}`;
          }
          await sendTelegramMessage(targetChat, finalMessage);
          return `Message sent to Telegram chat ${targetChat}`;
        } catch (err) {
          return {
            textResultForLlm: `Failed to send: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },
    {
      name: "telegram_get_status",
      description:
        "Get the current Telegram bridge status including uptime, message counts, active chats, and configuration details.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return JSON.stringify(
          {
            configured: !!TELEGRAM_TOKEN,
            polling: running,
            activeChatId: activeChatId || "none",
            allowedUsers: [...ALLOWED_USERS],
            pollOffset,
          },
          null,
          2
        );
      },
    },
    {
      name: "telegram_send_photo",
      description:
        "Send a photo to the connected Telegram chat. Photo can be a URL, local file path, or Telegram file_id. " +
        "Optionally include a caption.",
      parameters: {
        type: "object",
        properties: {
          photo: {
            type: "string",
            description:
              "Photo URL, local file path, or Telegram file_id.",
          },
          caption: {
            type: "string",
            description: "Optional caption for the photo. Supports Markdown formatting.",
          },
          chat_id: {
            type: "string",
            description:
              "Target Telegram chat ID. Omit to use the last active chat.",
          },
        },
        required: ["photo"],
      },
      handler: async (args) => {
        const targetChat = args.chat_id || activeChatId;
        if (!targetChat) {
          return {
            textResultForLlm:
              "No active Telegram chat. A user must message the bot first.",
            resultType: "failure",
          };
        }
        if (!TELEGRAM_TOKEN) {
          return {
            textResultForLlm:
              "Telegram bridge is not configured. Set TELEGRAM_BOT_TOKEN in .env.",
            resultType: "failure",
          };
        }
        try {
          const photoSource = args.photo;
          const isUrl =
            photoSource.startsWith("http://") ||
            photoSource.startsWith("https://");

          if (isUrl) {
            const body = { chat_id: targetChat, photo: photoSource };
            if (args.caption) body.caption = args.caption;
            await telegramApi("sendPhoto", body);
          } else {
            const { readFileSync } = await import("node:fs");
            const { basename } = await import("node:path");
            const fileData = readFileSync(photoSource);
            const fileName = basename(photoSource);
            const formData = new FormData();
            formData.append("chat_id", targetChat);
            formData.append(
              "photo",
              new Blob([fileData]),
              fileName
            );
            if (args.caption) formData.append("caption", args.caption);

            const res = await fetch(
              `${API_BASE}/sendPhoto`,
              { method: "POST", body: formData }
            );
            const data = await res.json();
            if (!data.ok)
              throw new Error(`Telegram API error: ${data.description}`);
          }
          return `Photo sent to Telegram chat ${targetChat}`;
        } catch (err) {
          return {
            textResultForLlm: `Failed to send photo: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Start polling immediately on script load
// ---------------------------------------------------------------------------
if (TELEGRAM_TOKEN) {
  pollLoop(session).catch(async (err) => {
    await session.log(
      `Telegram polling crashed: ${err.message}`,
      { level: "error" }
    );
  });
} else {
  await session.log(
    "TELEGRAM_BOT_TOKEN not found in .env — Telegram bridge disabled",
    { level: "warning" }
  );
}

// ---------------------------------------------------------------------------
// Forward assistant responses -> Telegram
// (Suppressed during cron job execution — use telegram_send_message tool instead)
// ---------------------------------------------------------------------------
let cronJobActive = false;

session.on("user.message", (event) => {
  const prompt = event.data?.content || "";
  if (prompt.startsWith("[Scheduled Task:") || prompt.startsWith("[Scheduled Agent Task:") || prompt.startsWith("[Telegram Agent Task]")) {
    cronJobActive = true;
  } else {
    cronJobActive = false;
  }
});

session.on("assistant.message", async (event) => {
  // Auto-forwarding DISABLED per {{PARENT_1}}'s request (2026-04-12)
  // Agents use telegram_send_message directly when they need to communicate.
  // This prevents duplicate/noisy messages from every assistant response.
  return;
});

// Stop typing when session goes idle (fallback)
session.on("session.idle", () => {
  stopTypingIndicator();
});

} // end BRIDGE_MODE check
