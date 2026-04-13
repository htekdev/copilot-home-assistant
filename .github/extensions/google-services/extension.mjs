import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..");
const TOKEN_PATH = resolve(REPO_ROOT, "data", "google-tokens.json");
const ENV_PATH = resolve(REPO_ROOT, ".env");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
];

const TIMEZONE = "America/Chicago";

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
// Token management
// ---------------------------------------------------------------------------

function loadTokens() {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  const dir = dirname(TOKEN_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8");
}

async function refreshAccessToken(tokens) {
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
  saveTokens(updated);
  return updated;
}

async function getAccessToken() {
  let tokens = loadTokens();
  if (!tokens?.access_token) throw new Error("Not authenticated. Run the `google_auth_url` tool to start OAuth.");

  const buffer = 60_000; // refresh 60 s before expiry
  if (tokens.expires_at && Date.now() > tokens.expires_at - buffer) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens.access_token;
}

async function googleApi(url, options = {}) {
  const accessToken = await getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}`, ...options.headers };
  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    // One retry after refresh
    const tokens = loadTokens();
    const refreshed = await refreshAccessToken(tokens);
    headers.Authorization = `Bearer ${refreshed.access_token}`;
    res = await fetch(url, { ...options, headers });
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body}`);
  }
  return res.json();
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
  // ---- Auth ---------------------------------------------------------------
  {
    name: "google_auth_status",
    description: "Check if Google OAuth tokens exist and are valid.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const tokens = loadTokens();
      if (!tokens?.access_token) return NOT_AUTH_MSG;
      const expired = tokens.expires_at && Date.now() > tokens.expires_at;
      const hasRefresh = !!tokens.refresh_token;
      if (expired && !hasRefresh) return "Access token expired and no refresh token. Re-authenticate.";
      if (expired) return "Access token expired but refresh token available — will auto-refresh on next API call.";
      const expiresIn = Math.round((tokens.expires_at - Date.now()) / 60000);
      return `✅ Authenticated. Access token valid for ~${expiresIn} min. Refresh token: ${hasRefresh ? "yes" : "no"}.`;
    },
  },
  {
    name: "google_auth_url",
    description:
      "Generate a Google OAuth2 consent URL. The user must visit this URL, grant access, and copy the authorization code.",
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
        `and pass it to the **google_auth_callback** tool.`
      );
    },
  },
  {
    name: "google_auth_callback",
    description: "Exchange an authorization code for OAuth tokens and save them.",
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
      saveTokens(tokens);
      return "✅ Google OAuth tokens saved. You're now authenticated for Gmail, Calendar, and Tasks.";
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
      },
      required: ["query"],
    },
    handler: async ({ query, maxResults = 10 }) => {
      const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
      const list = await googleApi(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
      if (!list.messages?.length) return "No messages found.";

      const summaries = [];
      const ids = list.messages.slice(0, maxResults).map((m) => m.id);

      // Batch-fetch messages (sequential to avoid rate limits on large batches)
      for (const id of ids) {
        const msg = await googleApi(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
        );
        const hdrs = msg.payload?.headers || [];
        const subject = findHeader(hdrs, "Subject") || "(no subject)";
        const from = findHeader(hdrs, "From");
        const date = findHeader(hdrs, "Date");
        const unread = msg.labelIds?.includes("UNREAD") ? " 🔵" : "";
        summaries.push(`• **${subject}**${unread}\n  From: ${from} | ${date}\n  ID: ${msg.id}`);
      }

      const total = list.resultSizeEstimate || ids.length;
      return `Found ~${total} results (showing ${ids.length}):\n\n${summaries.join("\n\n")}`;
    },
  },
  {
    name: "gmail_read",
    description: "Read a specific Gmail message by ID. Returns full headers and decoded body.",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Gmail message ID" },
      },
      required: ["messageId"],
    },
    handler: async ({ messageId }) => {
      const msg = await googleApi(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`
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
      },
      required: ["to", "subject", "body"],
    },
    handler: async ({ to, subject, body, cc, bcc }) => {
      const raw = base64url(buildRfc2822(to, subject, body, { cc, bcc }));
      const result = await googleApi("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      return `✅ Email sent. Message ID: ${result.id}, Thread ID: ${result.threadId}`;
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
      },
      required: ["threadId", "body"],
    },
    handler: async ({ threadId, body }) => {
      // Fetch the thread to get the last message headers
      const thread = await googleApi(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Message-Id&metadataHeaders=References`
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
      });
      return `✅ Reply sent. Message ID: ${result.id}, Thread ID: ${result.threadId}`;
    },
  },
  {
    name: "gmail_unread_count",
    description: "Get the count of unread emails in Gmail inbox.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const list = await googleApi(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+in:inbox&maxResults=1"
      );
      const count = list.resultSizeEstimate || 0;
      return `📬 You have approximately **${count}** unread email${count === 1 ? "" : "s"} in your inbox.`;
    },
  },

  // ---- Google Calendar ----------------------------------------------------
  {
    name: "gcal_today",
    description: "List today's Google Calendar events.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const { timeMin, timeMax } = todayRange();
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        timeZone: TIMEZONE,
      });
      const result = await googleApi(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
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
      },
    },
    handler: async ({ days = 7 } = {}) => {
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
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
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
      },
      required: ["summary", "start", "end"],
    },
    handler: async ({ summary, start, end, location, description, attendees, recurrence }) => {
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
        }
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
      },
      required: ["eventId"],
    },
    handler: async ({ eventId, summary, start, end, location, description }) => {
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
        }
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
      },
      required: ["eventId"],
    },
    handler: async ({ eventId }) => {
      const accessToken = await getAccessToken();
      let res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (res.status === 401) {
        const tokens = loadTokens();
        const refreshed = await refreshAccessToken(tokens);
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
      },
    },
    handler: async ({ taskListId, showCompleted = false } = {}) => {
      const listsRes = await googleApi("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
      const lists = listsRes.items || [];
      if (!lists.length) return "No task lists found.";

      const listSummary = lists.map((l) => `• ${l.title} (ID: ${l.id})`).join("\n");

      const targetList = taskListId || lists[0].id;
      const targetTitle = lists.find((l) => l.id === targetList)?.title || targetList;

      const params = new URLSearchParams({ showCompleted: String(showCompleted), showHidden: String(showCompleted) });
      const tasksRes = await googleApi(
        `https://tasks.googleapis.com/tasks/v1/lists/${targetList}/tasks?${params}`
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
      },
      required: ["title"],
    },
    handler: async ({ title, notes, due, taskListId }) => {
      let listId = taskListId;
      if (!listId) {
        const listsRes = await googleApi("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
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
        }
      );
      return `✅ Task added: **${result.title}**\nID: ${result.id}${result.due ? `\nDue: ${result.due.split("T")[0]}` : ""}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Join session
// ---------------------------------------------------------------------------

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const tokens = loadTokens();
      const hasTokens = !!tokens?.access_token;
      const hasRefresh = !!tokens?.refresh_token;
      const expired = tokens?.expires_at ? Date.now() > tokens.expires_at : true;

      let status;
      if (!hasTokens) {
        status = "❌ Not authenticated. Use `google_auth_url` to connect Gmail, Calendar & Tasks.";
      } else if (expired && !hasRefresh) {
        status = "⚠️ Google tokens expired with no refresh token. Re-authenticate with `google_auth_url`.";
      } else if (expired) {
        status = "🔄 Google access token expired — will auto-refresh on first API call.";
      } else {
        const mins = Math.round((tokens.expires_at - Date.now()) / 60000);
        status = `✅ Google authenticated (token valid ~${mins} min). Gmail, Calendar & Tasks ready.`;
      }

      return {
        additionalContext:
          `[google-services] ${status}\n` +
          "Available tools: google_auth_status, google_auth_url, google_auth_callback, " +
          "gmail_search, gmail_read, gmail_send, gmail_reply, gmail_unread_count, " +
          "gcal_today, gcal_upcoming, gcal_create_event, gcal_update_event, gcal_delete_event, " +
          "gtasks_list, gtasks_add",
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
