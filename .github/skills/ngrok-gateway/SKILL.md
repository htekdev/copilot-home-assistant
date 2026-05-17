# ngrok Gateway — Service Registration & Tunnel Access

```yaml
name: ngrok-gateway
description: >
  Register local web services with the ngrok gateway so they're accessible remotely
  via a single tunnel URL. Trigger phrases: "gateway", "register service",
  "local server", "ngrok", "tunnel", "expose port", "dashboard URL",
  "remote access", "service portal".
```

---

## Architecture Overview

The platform runs a **single ngrok tunnel** that reverse-proxies to multiple local services via cookie-based routing. One tunnel, many services.

| Component | Location | Purpose |
|-----------|----------|---------|
| Gateway script | `scripts/ngrok-gateway.mjs` | HTTP server on port **3850** — reverse proxy + service portal |
| Service registry | `data/gateway-services.json` | JSON file listing all registered services |
| Tunnel URL file | `data/.ngrok-gateway-url` | Current ngrok tunnel URL (read by agents) |
| Current tunnel | `{{NGROK_GATEWAY_URL}}` | Live public URL |

### How It Works

```
Internet → ngrok tunnel → localhost:3850 (gateway) → localhost:<service-port>
```

The gateway reads `gateway-services.json`, health-checks each service (TCP connect on its port), and proxies requests based on URL path or cookie. The portal page (`/gateway`) shows all services with live health status.

---

## URL Patterns

| URL | Purpose |
|-----|---------|
| `/gateway` | **Portal** — landing page showing all services with 🟢/🔴 health indicators |
| `/service/<service-id>/` | **Direct proxy** — stateless proxy to that service (prefix stripped) |
| `/service/<service-id>/*` | **Deep links** — proxied with prefix stripped |
| `/switch/<service-id>` | **Legacy cookie route** — sets active-service cookie, redirects to `/` |
| `/gateway/api/services` | **API** — JSON list of all services with `healthy` boolean |
| `/gateway/api/register` | **API** — POST to register a new service at runtime |
| `/gateway/api/unregister` | **API** — POST to remove a service |
| `/*` (everything else) | Proxied to the **active** backend (set by cookie) |

---

## How to Register a Service

### Method 1: File Edit (Preferred for Permanent Services)

Add an entry to `data/gateway-services.json`:

```json
{
  "services": [
    {
      "id": "my-service",
      "name": "My Service",
      "icon": "🔧",
      "port": 4000,
      "description": "What this service does",
      "registered_by": "agent-name"
    }
  ]
}
```

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | URL-safe slug — used in `/service/<id>/` paths |
| `name` | ✅ | Human-readable display name |
| `icon` | ✅ | Single emoji for the portal card |
| `port` | ✅ | Localhost port the service runs on |
| `description` | ✅ | Short description shown on portal card |
| `registered_by` | ✅ | Agent name that created/owns this service |

### Method 2: Runtime API (For Dynamic/Temporary Services)

```bash
curl -X POST http://localhost:3850/gateway/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-service",
    "name": "My Service",
    "icon": "🔧",
    "port": 4000,
    "description": "What this service does",
    "registered_by": "agent-name"
  }'
```

This writes to `gateway-services.json` automatically. Use this when building services at runtime that should register themselves.

---

## How to Unregister a Service

```bash
curl -X POST http://localhost:3850/gateway/api/unregister \
  -H "Content-Type: application/json" \
  -d '{ "id": "service-id" }'
```

This removes the entry from `gateway-services.json`.

---

## ⚠️ CRITICAL RULE: Every Local Web Service MUST Be Registered

**When building ANY new local server, dashboard, tool, or web UI — you MUST register it with the gateway.** No exceptions.

### Mandatory Checklist

1. **Pick an available port** — check `data/gateway-services.json` for existing ports to avoid conflicts
2. **Build and start the service** on the chosen port
3. **Register it** — add entry to `data/gateway-services.json` (file edit for permanent, API for temporary)
4. **Verify** it appears at the gateway portal: `{{NGROK_GATEWAY_URL}}/gateway`
5. **Send the gateway URL to {{PARENT_1}}** — use the gateway path, NOT `localhost`:
   - ✅ `{{NGROK_GATEWAY_URL}}/service/my-service/`
   - ❌ `http://localhost:4000`

### Why This Matters

- {{PARENT_1}} accesses services from his **phone** — localhost is unreachable
- The gateway provides a **single stable URL** that works everywhere
- The portal gives a **central directory** of all running services
- Health checks show **what's up and what's down** at a glance

---

## Starting the Gateway

```bash
node scripts/ngrok-gateway.mjs            # Full mode — starts HTTP server + ngrok tunnel
node scripts/ngrok-gateway.mjs --no-tunnel # Local only — skip ngrok (for testing)
```

- Gateway listens on port **3850** (override with `GATEWAY_PORT` env var)
- Tunnel URL is written to `data/.ngrok-gateway-url` on startup
- The ngrok auth token is read from `.env` (`NGROK_AUTHTOKEN`)

---

## Currently Registered Services

Check live state in `data/gateway-services.json`. As of last update:

| ID | Name | Port | Owner |
|----|------|------|-------|
| `record` | Video Recorder | 3848 | video-bridge |
| `review` | VidPipe Review | 3847 | content-editor |
| `task-dashboard` | Task Dashboard | 3851 | coding-agent |
| `nicu-dashboard` | NICU Twins | 3852 | coding-agent |

---

## Port Allocation Convention

To avoid conflicts, use this range guidance:

| Range | Purpose |
|-------|---------|
| 3847–3849 | Existing services (task dashboard, video recorder, vidpipe review) |
| 3850 | Gateway itself (reserved) |
| 3851–3899 | Available for new services |
| 4000+ | Available for larger/temporary services |

Always check `gateway-services.json` before picking a port.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Service shows 🔴 on portal | Service isn't running — start it on its registered port |
| Gateway itself is down | Run `node scripts/ngrok-gateway.mjs` from repo root |
| Tunnel URL changed | Check `data/.ngrok-gateway-url` for the new URL |
| Can't reach from phone | Verify ngrok tunnel is running (not `--no-tunnel` mode) |
| Port conflict | Change the port in both your service AND `gateway-services.json` |
