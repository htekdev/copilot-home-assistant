---
name: extension-architecture
description: >
  Copilot CLI extension development and architecture — file structure, joinSession API, hook types,
  tool registration, env file patterns, polling intervals, and extension registry. Use when user says
  "create extension", "modify extension", "extension architecture", "how extensions work", "add tool",
  "extension hooks", "onPostToolUse", "onPreToolUse", "extension.mjs", or any extension development activity.
---

# Extension Architecture Skill

How Copilot CLI extensions work in the {{FAMILY_NAME}} family platform. Reference this when building, modifying, or debugging extensions.

## File Structure

Every extension lives in `.github/extensions/{name}/extension.mjs`:

```
.github/extensions/
├── action-tracker/extension.mjs      # Task/shopping/meal/maintenance tools
├── ask-via-telegram/extension.mjs    # Routes ask_user → Telegram
├── audit-log/extension.mjs           # Logging/audit trail
├── auto-commit/extension.mjs         # Git auto-save on file changes
├── budget-tracker/extension.mjs      # Plaid financial connector tools
├── cron-scheduler/extension.mjs      # Cron job scheduler (reads cron.json)
├── dev-workflow/extension.mjs        # Multi-repo dev with git worktrees
├── exa/extension.mjs                 # Exa AI search & crawl tools
├── family-data/extension.mjs         # Family profiles, preferences
├── financial-connector/extension.mjs # Plaid API integration
├── google-maps/extension.mjs         # Drive time, directions, routes
├── google-services/extension.mjs     # Gmail, GCal, GTasks tools
├── home-maintenance/extension.mjs    # Maintenance schedule tools
├── image-gen/extension.mjs           # OpenAI gpt-image-2 image generation
├── late-api/extension.mjs            # Late/Zernio social media API
├── life-events/extension.mjs         # Family milestone tracking
├── locations/extension.mjs           # Saved places management
├── meal-planner/extension.mjs        # Meals, recipes, grocery lists
├── perplexity/extension.mjs          # Perplexity AI research tools
├── self-restart/extension.mjs        # Session restart tool
├── shopping-list/extension.mjs       # Shopping list CRUD
├── tasker-bridge/extension.mjs       # Tasker TTS integration
├── telegram-bridge/extension.mjs     # Telegram messaging bridge
├── twilio-sms/extension.mjs          # Twilio SMS messaging
├── vercel-env/extension.mjs          # Vercel project & env management
├── video-analyzer/extension.mjs      # Gemini video analysis tool
├── video-bridge/extension.mjs        # Video recording upload bridge
```

## Core Pattern — `joinSession`

Every extension uses the same boilerplate:

```javascript
import { joinSession } from "@github/copilot-sdk/extension";

const session = await joinSession({
  tools: [ /* tool definitions */ ],
  hooks: { /* lifecycle hooks */ }
});
```

The `joinSession` call registers the extension with the Copilot CLI session. It receives:
- `tools` — array of tool definitions exposed to the AI
- `hooks` — lifecycle callbacks for intercepting events

## Tool Registration

Each tool has: `name`, `description`, `parameters` (JSON Schema), and `handler` (async function):

```javascript
tools: [
  {
    name: "my_tool_name",
    description: "What this tool does — shown to the AI for tool selection",
    parameters: {
      type: "object",
      properties: {
        param1: { type: "string", description: "..." },
        param2: { type: "number", description: "..." }
      },
      required: ["param1"]
    },
    handler: async (args) => {
      // args = parsed parameters from the AI's tool call
      // Return: string (displayed to AI), or object with structured data
      return "Result text shown to the AI";
    }
  }
]
```

**Handler return types:**
- `string` — plain text result
- Object/array — JSON-serialized and shown to AI
- Throw error — tool call fails with error message

## Hook Types

### `onSessionStart`
Fires once when the CLI session begins. Returns context injected into the conversation.

```javascript
hooks: {
  onSessionStart: async () => {
    return {
      additionalContext: "[my-ext] Loaded. Status: ready."
    };
  }
}
```

### `onPreToolUse`
Fires BEFORE any tool call executes. Can intercept, modify, or deny tool calls.

```javascript
hooks: {
  onPreToolUse: async (input) => {
    // input.toolName — which tool is being called
    // input.toolArgs — the arguments
    // Return: { deny: true, reason: "..." } to block the call
    // Return: { additionalContext: "..." } to add context
    // Return: undefined/null to allow normally
    if (input.toolName === "ask_user") {
      // Redirect to Telegram instead
      await sendToTelegram(input.toolArgs.question);
      return { deny: true, reason: "Question forwarded to Telegram" };
    }
  }
}
```

### `onPostToolUse`
Fires AFTER a tool call completes. Used for side effects (auto-commit, logging).

```javascript
hooks: {
  onPostToolUse: async (input) => {
    // input.toolName — which tool just completed
    // input.toolArgs — the arguments that were passed
    // Return: { additionalContext: "..." } to inject info
    if (FILE_MODIFY_TOOLS.has(input.toolName)) {
      commitAndPush(input.toolName);
    }
  }
}
```

### `onUserPromptSubmitted`
Fires when a user sends a message (before AI processes it).

```javascript
hooks: {
  onUserPromptSubmitted: async () => {
    // Good for: checking for uncommitted changes, polling, cleanup
    if (hasChanges()) commitAndPush("pre-prompt sync");
  }
}
```

## Session API

The `session` object from `joinSession` provides:

```javascript
session.send({ prompt: "...", mode: "enqueue" }); // Enqueue a new user message
session.log("message", { level: "info" });         // Log to extension output
```

**`session.send()` usage:**
- Used by cron-scheduler to dispatch scheduled jobs
- Used by telegram-bridge to deliver incoming messages
- `mode: "enqueue"` adds to the message queue (async)

## Environment Variables

Extensions read `.env` from the repo root for configuration:

```javascript
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const vars = {};
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}
```

**Common env vars:**
- `TELEGRAM_BOT_TOKEN` — Telegram bot API token
- `CRON_ENABLED` — Enable cron scheduler (true/false)
- `BRIDGE_MODE` — "standalone" disables built-in cron
- `PLAID_CLIENT_ID`, `PLAID_SECRET` — Financial connector
- `OPENAI_API_KEY` — Image generation
- `GEMINI_API_KEY` — Video analysis
- `EXA_API_KEY` — Exa search extension
- `PERPLEXITY_API_KEY` — Perplexity AI extension
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — Twilio SMS
- `VERCEL_TOKEN` — Vercel project & env management

## Common Patterns

### Polling/Intervals
For background tasks (auto-commit, cron checks):

```javascript
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  // Background work — catch changes from sub-agents
}, POLL_INTERVAL_MS);
```

### File Watching (hot-reload config)
```javascript
import { watchFile } from "node:fs";
watchFile(CONFIG_FILE, { interval: 5000 }, () => {
  loadConfig(); // Reload on change
});
```

### Debouncing
```javascript
let lastActionTime = 0;
const DEBOUNCE_MS = 30000;

function debouncedAction() {
  const now = Date.now();
  if (now - lastActionTime < DEBOUNCE_MS) return;
  lastActionTime = now;
  // Execute action
}
```

## Auto-Commit Behavior

The `auto-commit` extension automatically commits and pushes changes:
- **Triggers:** After any file-modifying tool call (edit, create, add_task, etc.)
- **Debounce:** Max 1 commit per 30 seconds
- **Polling fallback:** Every 5 minutes, catches sub-agent changes
- **Commit message:** `Auto-save: {tool-name} (YYYY-MM-DD)`
- **Push command:** Uses `dev_push` tool internally (raw git/hookflow blocked by `dev-guard`)
- **Co-author:** Always includes `Co-authored-by: Copilot <{{EMAIL_ADDRESS}}>`

**Implications for agents:**
- No need to manually `git add/commit/push` for data changes
- File edits via tools are auto-persisted within 30s
- Sub-agent changes (via `task` tool) are caught by the 5-min poll

## Extension Development Rules

1. **Single file:** Each extension = one `extension.mjs` file
2. **ES modules:** Use `import` syntax (not `require`)
3. **Zero external dependencies:** Use only `node:*` built-in modules + `@github/copilot-sdk/extension`
4. **Graceful degradation:** If a required env var is missing, log a warning — don't crash
5. **Idempotent tools:** Tool handlers should be safe to retry
6. **No blocking:** Avoid synchronous I/O in hot paths (hooks fire on every tool call)
7. **Error handling:** Always try/catch in handlers — uncaught errors kill the extension process
8. **Tool naming:** snake_case, descriptive (e.g., `gmail_search`, `get_drive_time`)
9. **Description quality:** Tool descriptions are how the AI decides when to use them — be specific

## Creating a New Extension

1. Create directory: `.github/extensions/{name}/`
2. Create `extension.mjs` with `joinSession` boilerplate
3. Add tools and/or hooks as needed
4. Add any required env vars to `.env`
5. Restart the CLI session (extensions load on startup)
6. Test the tool appears in the AI's available tools

**Note:** Extensions hot-reload their CONFIG files (like cron.json) but the extension CODE requires a session restart to pick up changes.

## Extension Registry (What Each Does)

| Extension | Primary Purpose | Key Tools |
|-----------|----------------|-----------|
| `action-tracker` | Task CRUD, templates, dependencies | add_task, complete_task, list_tasks, expand_template |
| `ask-via-telegram` | Routes ask_user to Telegram | (hook only — no tools) |
| `audit-log` | Activity logging | (hook only) |
| `auto-commit` | Git auto-save | (hook only — no tools) |
| `budget-tracker` | Plaid financial data | get_balances, get_transactions, get_spending_summary |
| `cron-scheduler` | Scheduled job dispatch | cron_list_jobs, cron_next_run |
| `dev-guard` | Blocks raw git/hookflow in powershell | (hook only — onPreToolUse interceptor) |
| `dev-workflow` | ALL git operations as tools | start_dev_branch, create_vercel_pr, dev_status, dev_add, dev_commit, dev_push, dev_pull, dev_checkout, dev_stash, dev_reset, dev_rebase, dev_merge_pr |
| `exa` | Exa AI search & crawl (sub-agent propagation) | exa_search, exa_search_advanced, exa_crawl, exa_code_context, exa_company_research, exa_people_search, exa_find_similar |
| `family-data` | Family profiles | get_family_member, list_family, get_preferences |
| `financial-connector` | Plaid sync | sync_accounts, get_recurring |
| `google-maps` | Navigation | get_drive_time, get_directions, plan_route |
| `google-services` | Gmail/GCal/GTasks | gmail_search, gcal_today, gcal_create_event |
| `home-maintenance` | Maintenance scheduling | maintenance_due, log_maintenance, add_service_provider |
| `image-gen` | OpenAI gpt-image-2 infographics | generate_image |
| `late-api` | Social media scheduling | late_create_post, late_list_posts, late_presign_upload |
| `life-events` | Family milestone tracking | add_life_event, list_life_events, get_life_event, update_life_event |
| `locations` | Saved places | find_location, add_location |
| `meal-planner` | Meals & recipes | set_meal, get_meal_plan, add_recipe |
| `perplexity` | Perplexity AI research (sub-agent propagation) | perplexity_search, perplexity_reason, perplexity_deep_research |
| `self-restart` | Session restart | restart_session |
| `shopping-list` | Shopping CRUD | add_to_shopping_list, shopping_list, check_off_item |
| `tasker-bridge` | Android Tasker TTS | tasker_status, tasker_start_tunnel |
| `telegram-bridge` | Telegram messaging | telegram_send_message, telegram_send_photo |
| `twilio-sms` | Twilio SMS messaging | send_sms |
| `vercel-env` | Vercel project & env management | vercel_list_projects, vercel_list_env_vars, vercel_set_env_var, vercel_list_deployments, vercel_get_runtime_logs |
| `video-analyzer` | Gemini video AI | analyze_video |
| `video-bridge` | Video recording upload | video_bridge_status, video_bridge_start |

## Anti-Patterns

- ❌ External npm dependencies (extensions must be zero-dep)
- ❌ Synchronous file reads in hook hot paths without caching
- ❌ Uncaught errors in handlers (crashes the extension)
- ❌ Blocking `session.send()` in tight loops
- ❌ Exposing secrets via tool return values
- ❌ Creating tools with generic names ("do_thing") — be specific
- ❌ Modifying extension.mjs and expecting hot-reload (requires restart)

## ⚠️ CRITICAL LIMITATION: Hooks Do NOT Propagate to Sub-Agents

**Sub-agents launched via the `task` tool do NOT inherit `hooks.json` or `onPreToolUse`/`onPostToolUse` hooks from the parent session.** This is a known limitation in Copilot SDK v1.0.47.

**Impact:** The `dev-guard` extension blocks raw git commands (`git commit`, `git push`, etc.) via `onPreToolUse` hooks. This protection ONLY works in the main session. Sub-agents can freely run raw git commands without being intercepted.

**Mitigation:** Prompt-level enforcement. Every agent file (`.github/agents/*.agent.md`), the constitution (`data/constitution.md`), standing orders (`data/standing-orders.md`), and copilot-instructions (`.github/copilot-instructions.md`) all contain explicit rules requiring dev-workflow tools (`dev_add`, `dev_commit`, `dev_push`, `dev_checkout`, etc.) instead of raw git commands. This is the ONLY reliable enforcement mechanism until the SDK supports hook propagation.

**When building new extensions that enforce governance via hooks:** Document this limitation prominently. Hooks-based governance is a defense-in-depth layer, not the primary enforcement. Prompt-level rules in agent definitions are primary.
