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
├── agent-governance/extension.mjs    # Sub-agent skill-loading + completion quality enforcement (hook only)
├── ask-via-telegram/extension.mjs    # Routes ask_user → Telegram
├── audit-log/extension.mjs           # Logging/audit trail
├── auto-commit/extension.mjs         # Git auto-save on file changes (hook only)
├── blog-pipeline/extension.mjs       # Governed blog issue lifecycle tools (blog_*)
├── budget-tracker/extension.mjs      # Plaid financial connector tools
├── calendar-date-guard/extension.mjs # Blocks calendar events with wrong day-of-week (hook only)
├── cron-scheduler/extension.mjs      # Cron job scheduler (reads cron.json)
├── dev-guard/extension.mjs           # Blocks raw git/hookflow in powershell (hook only)
├── dev-workflow/extension.mjs        # Multi-repo dev with git worktrees
├── exa/extension.mjs                 # Exa AI search & crawl tools
├── exit-plan-guard/extension.mjs     # Blocks exit_plan_mode in autopilot sessions (hook only)
├── family-data/extension.mjs         # Family profiles, preferences
├── financial-connector/extension.mjs # Plaid API integration
├── google-maps/extension.mjs         # Drive time, directions, routes
├── google-services/extension.mjs     # Gmail, GCal, GTasks tools
├── higgsfield/extension.mjs          # Higgsfield AI CLI — video gen, avatars, webproducts
├── home-maintenance/extension.mjs    # Maintenance schedule tools
├── image-crop-deny/extension.mjs     # Blocks hero image resize/crop operations (hook only)
├── image-gen/extension.mjs           # OpenAI gpt-image-2 image generation
├── late-api/extension.mjs            # Late/Zernio social media API
├── life-events/extension.mjs         # Family milestone tracking
├── linkedin-brand-safety/extension.mjs # Blocks LinkedIn messages with non-Copilot AI claims (hook only)
├── locations/extension.mjs           # Saved places management
├── meal-planner/extension.mjs        # Meals, recipes, grocery lists
├── nicu-tracker/extension.mjs        # NICU pump/milk/baby tracking tools
├── perplexity/extension.mjs          # Perplexity AI research tools
├── pitcher-tools/extension.mjs       # Breast milk pitcher-method math tools
├── playwright-bridge/extension.mjs   # Persistent Playwright browser sessions
├── promo-video/extension.mjs         # Higgsfield Marketing Studio promo video generation
├── protected-files/extension.mjs     # Protected file registry + hookflow rule regeneration
├── safe-content-write/extension.mjs  # Detects large PowerShell writes → redirects to create/edit (hook only)
├── self-restart/extension.mjs        # Session restart tool
├── session-commands/extension.mjs    # Session token/cost metrics tools
├── shopping-list/extension.mjs       # Shopping list CRUD
├── tasker-bridge/extension.mjs       # Tasker TTS integration
├── telegram-bridge/extension.mjs     # Telegram messaging bridge
├── tool-fishing-guard/extension.mjs  # Blocks tool_search_tool_regex for known tools (hook only)
├── twilio-sms/extension.mjs          # Twilio SMS messaging
├── vercel-env/extension.mjs          # Vercel project & env management
├── video-analyzer/extension.mjs      # Gemini video analysis tool
├── video-bridge/extension.mjs        # Video recording upload bridge
├── video-ideas/extension.mjs         # Video ideas database tools
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
- **Co-author:** Always includes `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

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
| `agent-governance` | Sub-agent skill-loading + completion quality enforcement | (hook only — onSubagentStart/Stop) |
| `ask-via-telegram` | Routes ask_user to Telegram | (hook only — no tools) |
| `audit-log` | Activity logging | (hook only) |
| `auto-commit` | Git auto-save | (hook only — no tools) |
| `blog-pipeline` | Governed blog issue lifecycle | blog_create_issue, blog_update_issue, blog_transition_stage, blog_list_issues, blog_get_issue |
| `budget-tracker` | Plaid financial data | get_balances, get_transactions, get_spending_summary |
| `calendar-date-guard` | Blocks calendar events with wrong day-of-week | (hook only — onPreToolUse deny) |
| `cron-scheduler` | Scheduled job dispatch | cron_list_jobs, cron_next_run |
| `dev-guard` | Blocks raw git/hookflow in powershell | (hook only — onPreToolUse interceptor) |
| `dev-workflow` | ALL git operations as tools | start_dev_branch, create_vercel_pr, dev_status, dev_add, dev_commit, dev_push, dev_pull, dev_checkout, dev_stash, dev_reset, dev_rebase, dev_merge_pr |
| `exa` | Exa AI search & crawl (sub-agent propagation) | exa_search, exa_search_advanced, exa_crawl, exa_code_context, exa_company_research, exa_people_search, exa_find_similar |
| `exit-plan-guard` | Blocks exit_plan_mode in autopilot sessions | (hook only — onPreToolUse deny) |
| `family-data` | Family profiles | get_family_member, list_family, get_preferences |
| `financial-connector` | Plaid sync | sync_accounts, get_recurring |
| `google-maps` | Navigation | get_drive_time, get_directions, plan_route |
| `google-services` | Gmail/GCal/GTasks | gmail_search, gcal_today, gcal_create_event |
| `higgsfield` | Higgsfield AI CLI — video gen, avatars, webproducts | higgsfield_generate, higgsfield_list_avatars, higgsfield_webproduct_fetch, higgsfield_auth_login |
| `home-maintenance` | Maintenance scheduling | maintenance_due, log_maintenance, add_service_provider |
| `image-crop-deny` | Blocks hero image resize/crop in powershell | (hook only — onPreToolUse deny) |
| `image-gen` | OpenAI gpt-image-2 infographics | generate_image |
| `late-api` | Social media scheduling | late_create_post, late_list_posts, late_presign_upload |
| `life-events` | Family milestone tracking | add_life_event, list_life_events, get_life_event, update_life_event |
| `linkedin-brand-safety` | Blocks outbound LinkedIn messages with non-Copilot AI claims | (hook only — onPreToolUse deny) |
| `locations` | Saved places | find_location, add_location |
| `meal-planner` | Meals & recipes | set_meal, get_meal_plan, add_recipe |
| `nicu-tracker` | NICU pump, milk, and baby tracking | log_pump, log_feed, get_pump_summary, get_feed_summary, nicu_daily_report |
| `perplexity` | Perplexity AI research (sub-agent propagation) | perplexity_search, perplexity_reason, perplexity_deep_research |
| `pitcher-tools` | Breast milk pitcher-method math | pitcher_calculate, pitcher_graph, pitcher_status |
| `playwright-bridge` | Persistent Playwright browser sessions | playwright_navigate, playwright_click, playwright_type, playwright_screenshot, playwright_session_start, playwright_session_close |
| `promo-video` | Higgsfield Marketing Studio promo video for {{PERSONAL_DOMAIN}} articles | generate_promo_video |
| `protected-files` | Protected file registry + hookflow rule regeneration | protect_file, unprotect_file, list_protected_files |
| `safe-content-write` | Redirects large PowerShell here-string writes to create/edit | (hook only — onPreToolUse advisory) |
| `self-restart` | Session restart | restart_session |
| `session-commands` | Session token/cost metrics | session_compact, session_usage, session_cost_analysis |
| `shopping-list` | Shopping CRUD | add_to_shopping_list, shopping_list, check_off_item |
| `tasker-bridge` | Android Tasker TTS | tasker_status, tasker_start_tunnel |
| `task-originator-notify` | Enforces `<originator_notify>` metadata on `task` prompts, `write_agent` messages, and originator notifications | (hook only — delegation/steering validator + notifier) |
| `telegram-bridge` | Telegram messaging | telegram_send_message, telegram_send_photo |
| `tool-fishing-guard` | Blocks tool_search_tool_regex for well-known tools | (hook only — onPreToolUse deny) |
| `twilio-sms` | Twilio SMS messaging | send_sms |
| `vercel-env` | Vercel project & env management | vercel_list_projects, vercel_list_env_vars, vercel_set_env_var, vercel_list_deployments, vercel_get_runtime_logs |
| `video-analyzer` | Gemini video AI | analyze_video |
| `video-bridge` | Video recording upload | video_bridge_status, video_bridge_start |
| `video-ideas` | Video ideas database | add_video_idea, list_video_ideas, update_video_idea, get_video_idea |

## Anti-Patterns

- ❌ External npm dependencies (extensions must be zero-dep)
- ❌ Synchronous file reads in hook hot paths without caching
- ❌ Uncaught errors in handlers (crashes the extension)
- ❌ Blocking `session.send()` in tight loops
- ❌ Exposing secrets via tool return values
- ❌ Creating tools with generic names ("do_thing") — be specific
- ❌ Modifying extension.mjs and expecting hot-reload (requires restart)

## Hook Propagation to Sub-Agents

**Hooks DO propagate to sub-agents launched via the `task` tool.** Extensions using `onPreToolUse`/`onPostToolUse` hooks (like `dev-guard`) enforce governance consistently across both the main session and sub-agent sessions.

**Defense-in-depth:** Prompt-level enforcement in agent definitions (`.github/agents/*.agent.md`), the constitution, standing orders, and copilot-instructions all reinforce governance rules as a redundant layer alongside hook enforcement. This belt-and-suspenders approach ensures governance even if an extension fails to load.
