/**
 * Ask-via-Telegram Extension
 *
 * Intercepts `ask_user` tool calls and routes questions to Telegram
 * so user can answer from his phone instead of the CLI blocking.
 *
 * Flow:
 * 1. Agent calls ask_user → onPreToolUse fires
 * 2. Extension sends the question to primary user on Telegram
 * 3. Tool call is denied with context explaining the question was forwarded
 * 4. User replies on Telegram → telegram-bridge delivers it as the next user message
 * 5. Agent continues with the answer
 *
 * Requires TELEGRAM_BOT_TOKEN in .env (shared with telegram-bridge).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Configuration — read TELEGRAM_BOT_TOKEN from .env
// ---------------------------------------------------------------------------
const ENV_FILE = resolve(process.cwd(), ".env");
let TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

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
  }
}

parseEnvFile(ENV_FILE);

// primary user's Telegram chat ID — primary recipient for ask_user questions
const PRIMARY_CHAT_ID = process.env.PRIMARY_TELEGRAM_CHAT_ID || "YOUR_TELEGRAM_USER_ID";

// ---------------------------------------------------------------------------
// Telegram API helper
// ---------------------------------------------------------------------------
async function telegramApi(method, body = {}) {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return data.result;
}

async function sendQuestion(chatId, question) {
  const text = `❓ <b>Agent asks:</b>\n\n${escapeHtml(question)}\n\n<i>Reply to this message to answer.</i>`;
  try {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
    return true;
  } catch {
    // Fallback to plain text
    try {
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `❓ Agent asks:\n\n${question}\n\nReply to this message to answer.`,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      if (!TELEGRAM_TOKEN) {
        return {
          additionalContext:
            "[ask-via-telegram] Extension loaded but TELEGRAM_BOT_TOKEN not found. " +
            "ask_user calls will not be intercepted.",
        };
      }
      return {
        additionalContext:
          "[ask-via-telegram] Active — ask_user calls will be routed to primary user's Telegram. " +
          "When you need to ask the user a question, call ask_user as normal. " +
          "The question will be sent to Telegram and the reply will arrive as the next user message. " +
          "Do NOT call ask_user repeatedly — wait for the Telegram reply.",
      };
    },

    onPreToolUse: async (input) => {
      if (input.toolName !== "ask_user") return;
      if (!TELEGRAM_TOKEN) return; // let it through if no token

      const question =
        input.toolArgs?.question ||
        input.toolArgs?.message ||
        input.toolArgs?.prompt ||
        JSON.stringify(input.toolArgs);

      await session.log(`Routing ask_user to Telegram: "${question.slice(0, 80)}..."`, {
        ephemeral: true,
      });

      const sent = await sendQuestion(PRIMARY_CHAT_ID, question);

      if (sent) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason:
            `[ask-via-telegram] Question sent to primary user on Telegram:\n"${question}"\n\n` +
            "His reply will arrive as the next user message via the Telegram bridge. " +
            "WAIT for it — do NOT call ask_user again or proceed without the answer. " +
            "Continue your work once you receive the reply.",
        };
      }

      // If sending failed, let the original ask_user through as fallback
      await session.log("Failed to send to Telegram — falling back to CLI ask_user", {
        level: "warning",
      });
      return;
    },
  },
  tools: [],
});

await session.log("ask-via-telegram extension loaded");
