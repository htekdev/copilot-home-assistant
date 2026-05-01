/**
 * Tasker Bridge Extension for GitHub Copilot CLI
 *
 * Starts a local HTTP server that receives webhook POSTs from Android Tasker.
 * Incoming phone events are injected into the Copilot CLI session via session.send().
 *
 * CRASH-PROOF: Every async path is wrapped in try/catch. The extension
 * will NEVER crash the host process — worst case it reports "stopped" in
 * tasker_status and lets you retry.
 *
 * Tools:
 *   - tasker_status: Show server URL, connection health, and recent events
 *   - tasker_get_url: Get the local URL for Tasker configuration
 *
 * Configuration:
 *   - TASKER_PORT env var (default: 3847)
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const ENV_FILE = resolve(process.cwd(), ".env");
let TASKER_PORT = parseInt(process.env.TASKER_PORT || "3847", 10);

try {
  if (existsSync(ENV_FILE)) {
    const content = readFileSync(ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key === "TASKER_PORT") TASKER_PORT = parseInt(val, 10);
    }
  }
} catch {
  // .env read failure — use defaults
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let serverUrl = null;
let serverRunning = false;
let bridgeError = null;
let eventLog = [];
const MAX_LOG = 50;
let eventCount = 0;
let startTime = null;
let _server = null;

// Tunnel state
let tunnelUrl = null;
let tunnelListener = null;
const TUNNEL_FILE = resolve(process.cwd(), "data", ".tasker-tunnel-url");

function readTunnelUrl() {
  try {
    if (tunnelUrl) return tunnelUrl;
    if (existsSync(TUNNEL_FILE)) {
      const url = readFileSync(TUNNEL_FILE, "utf-8").trim();
      return url || null;
    }
  } catch {}
  return null;
}

function writeTunnelUrl(url) {
  try { writeFileSync(TUNNEL_FILE, url || "", "utf-8"); } catch {}
}

// ---------------------------------------------------------------------------
// Event formatting
// ---------------------------------------------------------------------------
function formatEvent(payload) {
  const event = payload.event || payload.type || "unknown";
  const ts = payload.timestamp || new Date().toISOString();
  const parts = [`📱 **Tasker Event: ${event}**`, `⏰ ${ts}`];

  if (event === "sms_received" || event === "sms") {
    parts.push(`👤 From: ${payload.from || payload.sender || "unknown"}`);
    parts.push(`💬 "${payload.content || payload.message || payload.body || ""}"`);
  } else if (event === "notification") {
    parts.push(`📦 App: ${payload.app || payload.package || "unknown"}`);
    parts.push(`🔔 ${payload.title || ""}`);
    if (payload.content || payload.text) parts.push(`   ${payload.content || payload.text}`);
  } else if (event === "phone_call" || event === "call") {
    parts.push(`📞 ${payload.direction || "incoming"}: ${payload.number || payload.from || "unknown"}`);
  } else if (event === "location") {
    parts.push(`📍 Lat: ${payload.lat}, Lng: ${payload.lng}`);
  } else if (event === "battery") {
    parts.push(`🔋 ${payload.level || payload.percent}%`);
  } else {
    const skip = new Set(["event", "type", "timestamp"]);
    for (const [k, v] of Object.entries(payload)) {
      if (!skip.has(k) && v != null) {
        parts.push(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// HTTP Server — simple, no port recovery, no process killing
// ---------------------------------------------------------------------------
function startServer(session) {
  return new Promise((resolveP) => {
    try {
      const server = createServer((req, res) => {
        try {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");

          if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
          }

          if (req.method === "GET" && req.url === "/status") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              status: "running",
              events_received: eventCount,
              uptime_seconds: startTime ? Math.round((Date.now() - startTime) / 1000) : 0,
              recent_events: eventLog.slice(-5),
            }));
            return;
          }

          if (req.method === "GET" && req.url === "/") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(`Tasker Bridge running. Events: ${eventCount}`);
            return;
          }

          if (req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
              try {
                const payload = JSON.parse(body);
                eventCount++;
                const logEntry = { ...payload, _received: new Date().toISOString(), _id: eventCount };
                eventLog.push(logEntry);
                if (eventLog.length > MAX_LOG) eventLog.shift();

                const formatted = formatEvent(payload);
                try {
                  session.send(`[Tasker Phone Event]\n${formatted}`);
                } catch {
                  // session.send failure — log but don't crash
                }

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, event_id: eventCount }));
              } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
              }
            });
            return;
          }

          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        } catch {
          try { res.writeHead(500); res.end("Internal error"); } catch {}
        }
      });

      server.on("error", (err) => {
        bridgeError = err.code === "EADDRINUSE"
          ? `Port ${TASKER_PORT} in use — set TASKER_PORT in .env`
          : err.message;
        resolveP(null);
      });

      server.listen(TASKER_PORT, "0.0.0.0", () => {
        serverRunning = true;
        startTime = Date.now();
        serverUrl = `http://localhost:${TASKER_PORT}`;
        resolveP(server);
      });
    } catch (err) {
      bridgeError = err.message;
      resolveP(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
function cleanup() {
  try {
    if (_server) { _server.close(); _server = null; }
    serverRunning = false;
  } catch {}
}

process.on("exit", cleanup);
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// ---------------------------------------------------------------------------
// Extension entry point — joinSession MUST complete for the extension to load
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      try {
        if (serverRunning) {
          return {
            additionalContext: `📱 Tasker Bridge active at ${serverUrl}. Events: ${eventCount}`,
          };
        }
        if (bridgeError) {
          return {
            additionalContext: `📱 Tasker Bridge failed: ${bridgeError}`,
          };
        }
      } catch {}
    },
  },
  tools: [
    {
      name: "tasker_status",
      description: "Show Tasker Bridge server status, URL, uptime, and recent phone events.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          const uptime = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
          const mins = Math.floor(uptime / 60);
          const secs = uptime % 60;

          const currentTunnel = readTunnelUrl();

          const lines = [
            `🤖 Tasker Bridge`,
            `Status: ${serverRunning ? "🟢 Running" : `🔴 Stopped${bridgeError ? ` (${bridgeError})` : ""}`}`,
            `Local URL: ${serverUrl || "not started"}`,
            `Tunnel: ${currentTunnel || "none — call tasker_start_tunnel to create one"}`,
            `Uptime: ${mins}m ${secs}s`,
            `Events: ${eventCount}`,
          ];

          if (eventLog.length > 0) {
            lines.push(``, `Last ${Math.min(5, eventLog.length)} events:`);
            for (const ev of eventLog.slice(-5)) {
              const type = ev.event || ev.type || "unknown";
              lines.push(`  • [${ev._received}] ${type}${ev.from ? ` from ${ev.from}` : ""}`);
            }
          } else {
            lines.push(`📭 No events yet`);
          }
          return lines.join("\n");
        } catch (err) {
          return `❌ Error reading status: ${err.message}`;
        }
      },
    },
    {
      name: "tasker_get_url",
      description: "Get the URL for configuring Tasker HTTP Request actions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          if (!serverRunning) {
            return `🔴 Tasker Bridge is not running.${bridgeError ? ` Error: ${bridgeError}` : ""}`;
          }

          // Read tunnel URL if available
          const currentTunnel = readTunnelUrl();

          const configUrl = currentTunnel || serverUrl;
          const lines = [
            `🔗 Tasker Bridge URL: ${configUrl}`,
            currentTunnel ? `   (ngrok tunnel → localhost:${TASKER_PORT})` : `   (local only — call tasker_start_tunnel for public URL)`,
            ``,
            `Tasker Config:`,
            `  Action: HTTP Request`,
            `  Method: POST`,
            `  URL: ${configUrl}`,
            `  Content-Type: application/json`,
            `  Body: { "event": "sms_received", "from": "%SMSRF", "content": "%SMSRB" }`,
          ];
          return lines.join("\n");
        } catch (err) {
          return `❌ Error: ${err.message}`;
        }
      },
    },
    {
      name: "tasker_start_tunnel",
      description: "Start an ngrok tunnel to expose the Tasker Bridge publicly. Requires @ngrok/ngrok npm package.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          if (!serverRunning) {
            return "🔴 Tasker Bridge server isn't running — can't tunnel to nothing.";
          }
          if (tunnelListener) {
            const existing = readTunnelUrl();
            return `🟢 Tunnel already active: ${existing || "unknown URL"}`;
          }

          // Dynamic import — only loaded when user explicitly asks
          let ngrok;
          try {
            ngrok = await import("@ngrok/ngrok");
          } catch {
            return "❌ @ngrok/ngrok not installed. Run: npm install @ngrok/ngrok";
          }

          let authtoken = process.env.NGROK_AUTHTOKEN || "";
          if (!authtoken && existsSync(ENV_FILE)) {
            try {
              const content = readFileSync(ENV_FILE, "utf-8");
              for (const line of content.split("\n")) {
                const trimmed = line.trim();
                if (trimmed.startsWith("NGROK_AUTHTOKEN=")) {
                  authtoken = trimmed.slice(trimmed.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
                }
              }
            } catch {}
          }

          const listener = await ngrok.default.forward({
            addr: TASKER_PORT,
            authtoken: authtoken || undefined,
          });

          tunnelUrl = listener.url();
          tunnelListener = listener;
          writeTunnelUrl(tunnelUrl);

          return [
            `🟢 Tunnel active!`,
            ``,
            `Public URL: ${tunnelUrl}`,
            `→ localhost:${TASKER_PORT}`,
            ``,
            `Configure Tasker to POST to: ${tunnelUrl}`,
          ].join("\n");
        } catch (err) {
          return `❌ Failed to start tunnel: ${err.message}`;
        }
      },
    },
    {
      name: "tasker_stop_tunnel",
      description: "Stop the ngrok tunnel. The local Tasker Bridge server keeps running.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          if (!tunnelListener) {
            tunnelUrl = null;
            writeTunnelUrl("");
            return "ℹ️ No active tunnel to stop.";
          }

          try { await tunnelListener.close(); } catch {}
          tunnelListener = null;
          tunnelUrl = null;
          writeTunnelUrl("");

          return "🛑 Tunnel stopped. Local bridge still running at " + (serverUrl || `localhost:${TASKER_PORT}`);
        } catch (err) {
          tunnelListener = null;
          tunnelUrl = null;
          writeTunnelUrl("");
          return `⚠️ Tunnel cleanup error: ${err.message}. State reset.`;
        }
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Non-blocking startup — wrapped in try/catch so it NEVER crashes the host
// NO ngrok at startup. Tunnel only starts when tasker_start_tunnel is called.
// ---------------------------------------------------------------------------
try {
  const server = await startServer(session);
  _server = server;
  if (!server) {
    console.error(`⚠️ Tasker Bridge: ${bridgeError || "failed to start"} — tools still available`);
  }
} catch (err) {
  bridgeError = err.message;
  console.error(`⚠️ Tasker Bridge startup failed: ${err.message} — tools still available`);
}
