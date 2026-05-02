import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..");
const ACCOUNTS_PATH = resolve(REPO_ROOT, "data", "google-accounts.json");
const LEGACY_TOKEN_PATH = resolve(REPO_ROOT, "data", "google-tokens.json");
const ENV_PATH = resolve(REPO_ROOT, ".env");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

const TIMEZONE = "{{TIMEZONE}}";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// ---------------------------------------------------------------------------
// .env reader (no dotenv package — parse manually)
// ---------------------------------------------------------------------------

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function getClientCredentials() {
  const env = loadEnv();
  const clientId = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || env.GOOGLE_REDIRECT_URI || "http://localhost:3000/oauth/callback";
  return { clientId, clientSecret, redirectUri };
}

// ---------------------------------------------------------------------------
// Multi-account token management
// ---------------------------------------------------------------------------
// Storage format (data/google-accounts.json):
// {
//   "default": "user@gmail.com",
//   "accounts": {
//     "user@gmail.com": { access_token, refresh_token, expires_at, token_type, scope, email },
//     "work@company.com": { ... }
//   }
// }
// ---------------------------------------------------------------------------

function loadAccountStore() {
  // Try new multi-account file first
  if (existsSync(ACCOUNTS_PATH)) {
    try {
      return JSON.parse(readFileSync(ACCOUNTS_PATH, "utf-8"));
    } catch {
      return { default: null, accounts: {} };
    }
  }

  // Migrate from legacy single-token file
  if (existsSync(LEGACY_TOKEN_PATH)) {
    try {
      const legacy = JSON.parse(readFileSync(LEGACY_TOKEN_PATH, "utf-8"));
      if (legacy?.access_token) {
        const email = legacy.email || "primary";
        const store = {
          default: email,
          accounts: { [email]: legacy },
        };
        saveAccountStore(store);
        return store;
      }
    } catch { /* ignore corrupt legacy file */ }
  }

  return { default: null, accounts: {} };
}

function saveAccountStore(store) {
  const dir = dirname(ACCOUNTS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ACCOUNTS_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function resolveAccount(accountParam) {
  const store = loadAccountStore();
  const keys = Object.keys(store.accounts);
  if (!keys.length) return { store, account: null, tokens: null };

  let account;
  if (accountParam) {
    // Match by exact key or case-insensitive partial match
    account = keys.find((k) => k === accountParam) ||
      keys.find((k) => k.toLowerCase().includes(accountParam.toLowerCase()));
    if (!account) return { store, account: null, tokens: null };
  } else {
    account = store.default || keys[0];
  }

  return { store, account, tokens: store.accounts[account] || null };
}

function saveAccountTokens(email, tokens) {
  const store = loadAccountStore();
  store.accounts[email] = tokens;
  if (!store.default) store.default = email;
  saveAccountStore(store);
}

async function refreshAccessToken(tokens, email) {
  const { clientId, clientSecret } = getClientCredentials();
  if (!tokens?.refresh_token) throw new Error("No refresh token available. Re-authenticate with google_auth_url.");
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in .env");

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const updated = {
    ...tokens,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  if (data.refresh_token) updated.refresh_token = data.refresh_token;

  // Persist updated tokens for this account
  if (email) saveAccountTokens(email, updated);
  return updated;
}

async function getAccessToken(accountParam) {
  const { account, tokens } = resolveAccount(accountParam);
  if (!tokens?.access_token) {
    const hint = accountParam ? ` for account "${accountParam}"` : "";
    throw new Error(`Not authenticated${hint}. Run the \`google_auth_url\` tool to start OAuth.`);
  }

  const buffer = 60_000; // refresh 60 s before expiry
  if (tokens.expires_at && Date.now() > tokens.expires_at - buffer) {
    const refreshed = await refreshAccessToken(tokens, account);
    return refreshed.access_token;
  }
  return tokens.access_token;
}

async function googleApi(url, options = {}, accountParam) {
  const accessToken = await getAccessToken(accountParam);
  const headers = { Authorization: `Bearer ${accessToken}`, ...options.headers };
  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    // One retry after refresh
    const { account, tokens } = resolveAccount(accountParam);
    const refreshed = await refreshAccessToken(tokens, account);
    headers.Authorization = `Bearer ${refreshed.access_token}`;
    res = await fetch(url, { ...options, headers });
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchUserEmail(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOT_AUTH_MSG =
  "Not authenticated with Google. Use the **google_auth_url** tool to generate a consent URL, " +
  "visit it in your browser, then pass the authorization code to **google_auth_callback**.";

function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64url(b64) {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function findHeader(headers, name) {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.toLocaleDateString("en-CA", { timeZone: TIMEZONE }) + "T00:00:00");
  const end = new Date(start.getTime() + 86400000);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function nDaysRange(n) {
  const now = new Date();
  const start = new Date(now.toLocaleDateString("en-CA", { timeZone: TIMEZONE }) + "T00:00:00");
  const end = new Date(start.getTime() + n * 86400000);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function buildRfc2822(to, subject, body, { cc, bcc, threadId, messageId, references } = {}) {
  const lines = [];
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(`Subject: ${subject}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  if (messageId) lines.push(`In-Reply-To: ${messageId}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("");
  lines.push(body);
  return lines.join("\r\n");
}

function extractBody(payload) {
  if (payload.body?.data) return decodeBase64url(payload.body.data);
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64url(textPart.body.data);
    const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) return decodeBase64url(htmlPart.body.data);
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return "(no readable body)";
}

function formatEvent(ev) {
  const start = ev.start?.dateTime || ev.start?.date || "?";
  const end = ev.end?.dateTime || ev.end?.date || "";
  const loc = ev.location ? ` | 📍 ${ev.location}` : "";
  const status = ev.status === "cancelled" ? " [CANCELLED]" : "";
  return `• **${ev.summary || "(no title)"}**${status}\n  ${start} → ${end}${loc}\n  ID: ${ev.id}`;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools = [
  // ---- Auth & Account Management ------------------------------------------
  {
    name: "google_auth_status",
    description: "Check if Google OAuth tokens exist and are valid. Shows all connected accounts.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const store = loadAccountStore();
      const keys = Object.keys(store.accounts);
      if (!keys.length) return NOT_AUTH_MSG;

      const lines = [`**Connected Google accounts:** (${keys.length})`];
      for (const email of keys) {
        const t = store.accounts[email];
        const isDefault = email === store.default ? " ⭐ default" : "";
        const expired = t.expires_at && Date.now() > t.expires_at;
        const hasRefresh = !!t.refresh_token;
        let status;
        if (expired && !hasRefresh) status = "❌ expired (no refresh token)";
        else if (expired) status = "🔄 expired (will auto-refresh)";
        else status = `✅ valid (~${Math.round((t.expires_at - Date.now()) / 60000)} min)`;
        lines.push(`• **${email}**${isDefault} — ${status}`);
      }
      return lines.join("\n");
    },
  },
  {
    name: "google_auth_url",
    description:
      "Generate a Google OAuth2 consent URL. The user must visit this URL, grant access, and copy the authorization code. Use to add new accounts or re-authenticate existing ones.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const { clientId, redirectUri } = getClientCredentials();
      if (!clientId) return "Error: GOOGLE_CLIENT_ID not set in .env";
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
      });
      const url = `${GOOGLE_AUTH_URL}?${params}`;
      return (
        `Visit this URL to authorize Google access:\n\n${url}\n\n` +
        `After granting access you'll be redirected. Copy the **code** parameter from the URL ` +
        `and pass it to the **google_auth_callback** tool.\n\n` +
        `The account email will be auto-detected. You can add multiple Google accounts.`
      );
    },
  },
  {
    name: "google_auth_callback",
    description: "Exchange an authorization code for OAuth tokens and save them. Auto-detects the account email.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Authorization code from the OAuth consent redirect" },
      },
      required: ["code"],
    },
    handler: async ({ code }) => {
      const { clientId, clientSecret, redirectUri } = getClientCredentials();
      if (!clientId || !clientSecret) return "Error: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in .env";

      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return `Token exchange failed (${res.status}): ${err}`;
      }

      const data = await res.json();
      const tokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        token_type: data.token_type,
        scope: data.scope,
      };

      // Auto-detect account email
      const email = await fetchUserEmail(data.access_token) || `account-${Date.now()}`;
      tokens.email = email;

      // Save under email key
      saveAccountTokens(email, tokens);

      // Also update legacy file for backward compatibility during transition
      const legacyDir = dirname(LEGACY_TOKEN_PATH);
      if (!existsSync(legacyDir)) mkdirSync(legacyDir, { recursive: true });
      writeFileSync(LEGACY_TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8");

      const store = loadAccountStore();
      const count = Object.keys(store.accounts).length;
      const defaultNote = count === 1 ? " (set as default)" : "";
      return `✅ Google OAuth tokens saved for **${email}**${defaultNote}.\nAuthenticated for Gmail, Calendar, and Tasks.\n\n${count} account${count > 1 ? "s" : ""} connected total.`;
    },
  },
  {
    name: "google_list_accounts",
    description: "List all connected Google accounts with their status.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const store = loadAccountStore();
      const keys = Object.keys(store.accounts);
      if (!keys.length) return "No Google accounts connected. Use `google_auth_url` to add one.";

      const lines = [];
      for (const email of keys) {
        const isDefault = email === store.default ? " ⭐" : "";
        lines.push(`• **${email}**${isDefault}`);
      }
      return `**Connected accounts** (${keys.length}):\n${lines.join("\n")}\n\nDefault: **${store.default}**\nUse \`google_set_default\` to change the default account.`;
    },
  },
  {
    name: "google_set_default",
    description: "Set the default Google account used when no account parameter is specified.",
    parameters: {
      type: "object",
      properties: {
        account: { type: "string", description: "Email address or partial match of the account to set as default" },
      },
      required: ["account"],
    },
    handler: async ({ account }) => {
      const store = loadAccountStore();
      const keys = Object.keys(store.accounts);
      const match = keys.find((k) => k === account) ||
        keys.find((k) => k.toLowerCase().includes(account.toLowerCase()));
      if (!match) return `Account "${account}" not found. Connected: ${keys.join(", ")}`;
      store.default = match;
      saveAccountStore(store);
      return `✅ Default account set to **${match}**.`;
    },
  },
  {
    name: "google_remove_account",
    description: "Remove a connected Google account.",
    parameters: {
      type: "object",
      properties: {
        account: { type: "string", description: "Email address or partial match of the account to remove" },
      },
      required: ["account"],
    },
    handler: async ({ account }) => {
      const store = loadAccountStore();
      const keys = Object.keys(store.accounts);
      const match = keys.find((k) => k === account) ||
        keys.find((k) => k.toLowerCase().includes(account.toLowerCase()));
      if (!match) return `Account "${account}" not found. Connected: ${keys.join(", ")}`;
      delete store.accounts[match];
      if (store.default === match) {
        const remaining = Object.keys(store.accounts);
        store.default = remaining.length ? remaining[0] : null;
      }
      saveAccountStore(store);
      const remaining = Object.keys(store.accounts);
      return `✅ Removed **${match}**. ${remaining.length} account${remaining.length !== 1 ? "s" : ""} remaining.${store.default ? ` Default: ${store.default}` : ""}`;
    },
  },

  // ---- Gmail --------------------------------------------------------------
  {
    name: "gmail_search",
    description: "Search Gmail using Gmail search syntax (e.g. 'from:boss subject:meeting', 'is:unread', 'newer_than:2d').",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        maxResults: { type: "number", description: "Max results (default 10)" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
      required: ["query"],
    },
    handler: async ({ query, maxResults = 10, account }) => {
      const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
      const list = await googleApi(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {}, account);
      if (!list.messages?.length) return "No messages found.";

      const summaries = [];
      const ids = list.messages.slice(0, maxResults).map((m) => m.id);

      // Batch-fetch messages (sequential to avoid rate limits on large batches)
      for (const id of ids) {
        const msg = await googleApi(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          {},
          account
        );
        const hdrs = msg.payload?.headers || [];
        const subject = findHeader(hdrs, "Subject") || "(no subject)";
        const from = findHeader(hdrs, "From");
        const date = findHeader(hdrs, "Date");
        const unread = msg.labelIds?.includes("UNREAD") ? " 🔵" : "";
        summaries.push(`• **${subject}**${unread}\n  From: ${from} | ${date}\n  ID: ${msg.id}`);
      }

      const total = list.resultSizeEstimate || ids.length;
      const acctLabel = account ? ` [${account}]` : "";
      return `Found ~${total} results (showing ${ids.length})${acctLabel}:\n\n${summaries.join("\n\n")}`;
    },
  },
  {
    name: "gmail_read",
    description: "Read a specific Gmail message by ID. Returns full headers and decoded body.",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Gmail message ID" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
      required: ["messageId"],
    },
    handler: async ({ messageId, account }) => {
      const msg = await googleApi(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        {},
        account
      );
      const hdrs = msg.payload?.headers || [];
      const subject = findHeader(hdrs, "Subject") || "(no subject)";
      const from = findHeader(hdrs, "From");
      const to = findHeader(hdrs, "To");
      const date = findHeader(hdrs, "Date");
      const cc = findHeader(hdrs, "Cc");
      const body = extractBody(msg.payload);

      let result = `**Subject:** ${subject}\n**From:** ${from}\n**To:** ${to}\n**Date:** ${date}`;
      if (cc) result += `\n**Cc:** ${cc}`;
      result += `\n**Thread ID:** ${msg.threadId}\n**Message ID:** ${findHeader(hdrs, "Message-Id")}\n**Labels:** ${(msg.labelIds || []).join(", ")}`;
      result += `\n\n---\n\n${body}`;
      return result;
    },
  },
  {
    name: "gmail_send",
    description: "Send a new email via Gmail.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address(es), comma-separated" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: { type: "string", description: "CC recipients (optional)" },
        bcc: { type: "string", description: "BCC recipients (optional)" },
        account: { type: "string", description: "Google account email to send from (optional, uses default if omitted)" },
      },
      required: ["to", "subject", "body"],
    },
    handler: async ({ to, subject, body, cc, bcc, account }) => {
      const raw = base64url(buildRfc2822(to, subject, body, { cc, bcc }));
      const result = await googleApi("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      }, account);
      const acctLabel = account ? ` (from ${account})` : "";
      return `✅ Email sent${acctLabel}. Message ID: ${result.id}, Thread ID: ${result.threadId}`;
    },
  },
  {
    name: "gmail_reply",
    description: "Reply to a Gmail thread. Fetches the original message to set correct headers.",
    parameters: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Gmail thread ID to reply to" },
        body: { type: "string", description: "Reply body text" },
        account: { type: "string", description: "Google account email to reply from (optional, uses default if omitted)" },
      },
      required: ["threadId", "body"],
    },
    handler: async ({ threadId, body, account }) => {
      // Fetch the thread to get the last message headers
      const thread = await googleApi(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Message-Id&metadataHeaders=References`,
        {},
        account
      );
      const lastMsg = thread.messages[thread.messages.length - 1];
      const hdrs = lastMsg.payload?.headers || [];
      const subject = findHeader(hdrs, "Subject");
      const from = findHeader(hdrs, "From");
      const messageId = findHeader(hdrs, "Message-Id");
      const references = findHeader(hdrs, "References");

      const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
      const refChain = references ? `${references} ${messageId}` : messageId;

      const raw = base64url(
        buildRfc2822(from, replySubject, body, { messageId, references: refChain })
      );
      const result = await googleApi("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw, threadId }),
      }, account);
      return `✅ Reply sent. Message ID: ${result.id}, Thread ID: ${result.threadId}`;
    },
  },
  {
    name: "gmail_unread_count",
    description: "Get the count of unread emails in Gmail inbox.",
    parameters: {
      type: "object",
      properties: {
        account: { type: "string", description: "Google account email to check (optional, uses default if omitted)" },
      },
    },
    handler: async ({ account } = {}) => {
      const list = await googleApi(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+in:inbox&maxResults=1",
        {},
        account
      );
      const count = list.resultSizeEstimate || 0;
      const acctLabel = account ? ` (${account})` : "";
      return `📬 You have approximately **${count}** unread email${count === 1 ? "" : "s"} in your inbox${acctLabel}.`;
    },
  },

  // ---- Google Calendar ----------------------------------------------------
  {
    name: "gcal_today",
    description: "List today's Google Calendar events.",
    parameters: {
      type: "object",
      properties: {
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
    },
    handler: async ({ account } = {}) => {
      const { timeMin, timeMax } = todayRange();
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        timeZone: TIMEZONE,
      });
      const result = await googleApi(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        {},
        account
      );
      if (!result.items?.length) return "📅 No events today.";
      return `📅 **Today's events** (${result.items.length}):\n\n${result.items.map(formatEvent).join("\n\n")}`;
    },
  },
  {
    name: "gcal_upcoming",
    description: "List upcoming Google Calendar events for the next N days.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days to look ahead (default 7)" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
    },
    handler: async ({ days = 7, account } = {}) => {
      const { timeMin, timeMax } = nDaysRange(days);
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        timeZone: TIMEZONE,
        maxResults: "50",
      });
      const result = await googleApi(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        {},
        account
      );
      if (!result.items?.length) return `📅 No events in the next ${days} days.`;
      return `📅 **Next ${days} days** (${result.items.length} events):\n\n${result.items.map(formatEvent).join("\n\n")}`;
    },
  },
  {
    name: "gcal_create_event",
    description: "Create a new Google Calendar event. Supports recurring events with recurrence rules.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        start: { type: "string", description: "Start datetime (ISO 8601 / RFC 3339, e.g. 2025-01-15T09:00:00)" },
        end: { type: "string", description: "End datetime (ISO 8601 / RFC 3339)" },
        location: { type: "string", description: "Event location (optional)" },
        description: { type: "string", description: "Event description (optional)" },
        attendees: { type: "string", description: "Comma-separated attendee emails (optional)" },
        recurrence: { type: "string", description: "Recurrence rule (optional). Examples: 'WEEKLY' (every week same day), 'DAILY', 'MONTHLY', 'YEARLY', or full RRULE like 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
      required: ["summary", "start", "end"],
    },
    handler: async ({ summary, start, end, location, description, attendees, recurrence, account }) => {
      const event = {
        summary,
        start: { dateTime: start, timeZone: TIMEZONE },
        end: { dateTime: end, timeZone: TIMEZONE },
      };
      if (location) event.location = location;
      if (description) event.description = description;
      if (attendees) {
        event.attendees = attendees.split(",").map((e) => ({ email: e.trim() }));
      }
      if (recurrence) {
        // Accept shorthand like "WEEKLY" or full RRULE
        const rule = recurrence.startsWith("RRULE:") ? recurrence : `RRULE:FREQ=${recurrence.toUpperCase()}`;
        event.recurrence = [rule];
      }

      const result = await googleApi(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        },
        account
      );
      return `✅ Event created: **${result.summary}**\nID: ${result.id}\nLink: ${result.htmlLink}`;
    },
  },
  {
    name: "gcal_update_event",
    description: "Update an existing Google Calendar event by ID. Only provide fields you want to change.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Calendar event ID" },
        summary: { type: "string", description: "New event title (optional)" },
        start: { type: "string", description: "New start datetime (optional)" },
        end: { type: "string", description: "New end datetime (optional)" },
        location: { type: "string", description: "New location (optional)" },
        description: { type: "string", description: "New description (optional)" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
      required: ["eventId"],
    },
    handler: async ({ eventId, summary, start, end, location, description, account }) => {
      const patch = {};
      if (summary) patch.summary = summary;
      if (start) patch.start = { dateTime: start, timeZone: TIMEZONE };
      if (end) patch.end = { dateTime: end, timeZone: TIMEZONE };
      if (location !== undefined) patch.location = location;
      if (description !== undefined) patch.description = description;

      const result = await googleApi(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
        account
      );
      return `✅ Event updated: **${result.summary}**\nLink: ${result.htmlLink}`;
    },
  },
  {
    name: "gcal_delete_event",
    description: "Delete a Google Calendar event by ID.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Calendar event ID to delete" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
      required: ["eventId"],
    },
    handler: async ({ eventId, account }) => {
      const accessToken = await getAccessToken(account);
      let res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (res.status === 401) {
        const { account: resolvedAcct, tokens } = resolveAccount(account);
        const refreshed = await refreshAccessToken(tokens, resolvedAcct);
        res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${refreshed.access_token}` } }
        );
      }

      if (res.status === 204 || res.ok) return `✅ Event ${eventId} deleted.`;
      const body = await res.text();
      throw new Error(`Delete failed (${res.status}): ${body}`);
    },
  },

  // ---- Google Tasks -------------------------------------------------------
  {
    name: "gtasks_list",
    description: "List Google Tasks. Shows all task lists and tasks from the default list.",
    parameters: {
      type: "object",
      properties: {
        taskListId: { type: "string", description: "Task list ID (optional, defaults to first list)" },
        showCompleted: { type: "boolean", description: "Include completed tasks (default false)" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
    },
    handler: async ({ taskListId, showCompleted = false, account } = {}) => {
      const listsRes = await googleApi("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {}, account);
      const lists = listsRes.items || [];
      if (!lists.length) return "No task lists found.";

      const listSummary = lists.map((l) => `• ${l.title} (ID: ${l.id})`).join("\n");

      const targetList = taskListId || lists[0].id;
      const targetTitle = lists.find((l) => l.id === targetList)?.title || targetList;

      const params = new URLSearchParams({ showCompleted: String(showCompleted), showHidden: String(showCompleted) });
      const tasksRes = await googleApi(
        `https://tasks.googleapis.com/tasks/v1/lists/${targetList}/tasks?${params}`,
        {},
        account
      );
      const tasks = tasksRes.items || [];

      if (!tasks.length) {
        return `**Task Lists:**\n${listSummary}\n\n📋 **${targetTitle}**: No tasks.`;
      }

      const taskLines = tasks.map((t) => {
        const done = t.status === "completed" ? "✅" : "⬜";
        const due = t.due ? ` | Due: ${t.due.split("T")[0]}` : "";
        const notes = t.notes ? `\n    ${t.notes}` : "";
        return `${done} **${t.title}**${due}\n    ID: ${t.id}${notes}`;
      });

      return `**Task Lists:**\n${listSummary}\n\n📋 **${targetTitle}** (${tasks.length} tasks):\n\n${taskLines.join("\n\n")}`;
    },
  },
  {
    name: "gtasks_add",
    description: "Add a new task to Google Tasks.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        notes: { type: "string", description: "Task notes/description (optional)" },
        due: { type: "string", description: "Due date in ISO 8601 (YYYY-MM-DD), optional" },
        taskListId: { type: "string", description: "Task list ID (optional, defaults to first list)" },
        account: { type: "string", description: "Google account email to use (optional, uses default if omitted)" },
      },
      required: ["title"],
    },
    handler: async ({ title, notes, due, taskListId, account }) => {
      let listId = taskListId;
      if (!listId) {
        const listsRes = await googleApi("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {}, account);
        listId = listsRes.items?.[0]?.id;
        if (!listId) return "No task lists found. Create one in Google Tasks first.";
      }

      const task = { title };
      if (notes) task.notes = notes;
      if (due) task.due = `${due}T00:00:00.000Z`;

      const result = await googleApi(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(task),
        },
        account
      );
      return `✅ Task added: **${result.title}**\nID: ${result.id}${result.due ? `\nDue: ${result.due.split("T")[0]}` : ""}`;
    },
  },

  // -----------------------------------------------------------------------
  // YouTube Comment Reply
  // -----------------------------------------------------------------------
  {
    name: "youtube_reply_to_comment",
    description: "Reply to a YouTube comment as the authenticated channel. Requires YouTube OAuth scope (youtube.force-ssl). Use parentId from youtube_comment_threads results.",
    parameters: {
      parentId: { type: "string", description: "The comment ID to reply to (e.g., 'Ugwb-nRZ9LH6W0Qz3F14AaABAg')" },
      text: { type: "string", description: "Reply text (plain text, no HTML)" },
      account: { type: "string", description: "Google account email to use (optional, uses default)" },
    },
    required: ["parentId", "text"],
    handler: async ({ parentId, text, account }) => {
      const body = {
        snippet: {
          parentId,
          textOriginal: text,
        },
      };
      const result = await googleApi(
        "https://www.googleapis.com/youtube/v3/comments?part=snippet",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        account
      );
      const author = result.snippet?.authorDisplayName || "unknown";
      const replyId = result.id || "unknown";
      return `✅ YouTube reply posted!\nReply ID: ${replyId}\nAs: ${author}\nText: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Join session
// ---------------------------------------------------------------------------

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const store = loadAccountStore();
      const keys = Object.keys(store.accounts);

      let status;
      if (!keys.length) {
        status = "❌ Not authenticated. Use `google_auth_url` to connect Gmail, Calendar & Tasks.";
      } else {
        const statuses = keys.map((email) => {
          const t = store.accounts[email];
          const expired = t.expires_at ? Date.now() > t.expires_at : true;
          const hasRefresh = !!t.refresh_token;
          const isDefault = email === store.default ? " ⭐" : "";
          if (expired && !hasRefresh) return `${email}${isDefault}: ❌ expired`;
          if (expired) return `${email}${isDefault}: 🔄 auto-refresh`;
          return `${email}${isDefault}: ✅ valid`;
        });
        status = `${keys.length} account${keys.length > 1 ? "s" : ""} connected: ${statuses.join(", ")}`;
      }

      return {
        additionalContext:
          `[google-services] ${status}\n` +
          "Available tools: google_auth_status, google_auth_url, google_auth_callback, " +
          "google_list_accounts, google_set_default, google_remove_account, " +
          "gmail_search, gmail_read, gmail_send, gmail_reply, gmail_unread_count, " +
          "gcal_today, gcal_upcoming, gcal_create_event, gcal_update_event, gcal_delete_event, " +
          "gtasks_list, gtasks_add, youtube_reply_to_comment\n" +
          "All tools accept an optional `account` parameter to target a specific Google account.",
      };
    },
    onUserPromptSubmitted: async (input) => {
      const prompt = (input.prompt || "").toLowerCase();
      const scheduleKeywords = [
        "schedule", "appointment", "remind", "event", "class",
        "meeting", "recurring", "every week", "every day", "every month",
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
        "gymnastics", "swimming", "ninja", "doctor", "dentist", "vet",
      ];
      if (!scheduleKeywords.some((k) => prompt.includes(k))) return;

      return {
        additionalContext:
          "[google-services] SCHEDULING RULE: Google Calendar is the source of truth for ALL scheduling.\n" +
          "When the user mentions events, appointments, activities, classes, or recurring schedules:\n" +
          "1. ALWAYS create them as Google Calendar events using gcal_create_event\n" +
          "2. You may ALSO save context to family profiles (data/family/*.json) for reference\n" +
          "3. But the calendar event is mandatory — it provides phone notifications and shared visibility\n" +
          "4. For recurring events, create the next occurrence and note the recurrence in the description",
      };
    },
  },
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    handler: async (args) => {
      try {
        return await t.handler(args || {});
      } catch (err) {
        if (err.message.includes("Not authenticated") || err.message.includes("Re-authenticate")) {
          return `⚠️ ${err.message}`;
        }
        return `❌ Error: ${err.message}`;
      }
    },
  })),
});
