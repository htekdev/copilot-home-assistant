---
name: data-governance
description: >
  Data governance pattern — protected files registry, extension tools for governed data,
  migration workflow from raw edits to validated tools. Use when user says "data governance",
  "protect file", "create data tool", "extension for data", "governed data", "protected files",
  "data migration", "schema enforcement", or any data persistence architecture activity.
---

# Data Governance Skill

How to protect data files with dedicated extension tools that validate input, enforce schema, and handle side effects — eliminating raw `edit`/`create` operations on critical data.

## Architecture — The Privileged Writer Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AGENT (AI layer)                              │
│  "Log pump: 85 mL"                                                  │
│                                                                      │
│  ┌─ Tries edit on nicu.db ──┐     ┌─ Calls log_pump(85) ──────────┐│
│  │ BLOCKED by hookflow      │     │ Succeeds — tool returns stats  ││
│  │ "Use log_pump instead"   │     │                                ││
│  └──────────────────────────┘     └────────────┬───────────────────┘│
└─────────────────────────────────────────────────┼───────────────────┘
                                                  │
┌─────────────────────────────────────────────────┼───────────────────┐
│              HOOKFLOW LAYER (SDK runtime)        │                    │
│  .{{EMPLOYER_PARENT}}/hookflows/block-protected-files.md     │                    │
│  ┌──────────────────────────────────────┐       │                    │
│  │ event: file  lifecycle: pre          │       │ (tools bypass      │
│  │ pattern: "data/nicu/..."             │       │  hookflows — they  │
│  │ action: block                        │       │  use Node.js fs    │
│  │ → Blocks edit/create tool calls      │       │  directly)         │
│  └──────────────────────────────────────┘       │                    │
└─────────────────────────────────────────────────┼───────────────────┘
                                                  │
┌─────────────────────────────────────────────────┼───────────────────┐
│              EXTENSION LAYER (Node.js process)   │                    │
│  .{{EMPLOYER_PARENT}}/extensions/nicu-tracker/extension.mjs  │                    │
│  ┌──────────────────────────────────────┐       │                    │
│  │ log_pump handler:                    │◄──────┘                    │
│  │   1. Validate input                  │                            │
│  │   2. db.prepare("INSERT...").run()   │  ← PRIVILEGED WRITER      │
│  │   3. Update schedule.json            │    (writes directly to     │
│  │   4. Return summary                  │     filesystem via Node.js │
│  └──────────────────────────────────────┘     fs/sqlite, NOT via     │
│                                                SDK tool calls)        │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Insight: Two Separate Layers

| Layer | What It Does | How It Works | File Location |
|-------|-------------|--------------|---------------|
| **Hookflows** | ENFORCE protection | Block agent `edit`/`create` calls via SDK runtime | `.{{EMPLOYER_PARENT}}/hookflows/block-protected-files.md` |
| **Extensions** | PROVIDE tools | Write to governed files via Node.js `fs`/`sqlite` directly | `.{{EMPLOYER_PARENT}}/extensions/{name}/extension.mjs` |

**Hookflows block agent tool calls.** When an agent calls `edit` or `create`, the SDK runtime checks hookflows BEFORE executing. If a hookflow matches (event: file, lifecycle: pre, pattern matches the path), it blocks the call and returns the denial message.

**Extension tools bypass hookflows.** When `log_pump` writes to `nicu.db`, it uses `DatabaseSync` (Node.js `node:sqlite`) directly in the extension's own process. This is NOT an agent tool call — it's privileged filesystem access. Hookflows only intercept the SDK tool layer, not Node.js I/O.

**This makes the extension the ONLY authorized writer** to governed data files. Agents cannot reach the data except through the extension's validated tools.

This is the same pattern as `action-tracker`: agents can't `edit action-tracker.db` directly (binary file, no reason to), but `add_task`/`complete_task` tools write to it via `DatabaseSync`. The hookflow formalizes this as an enforced rule.

### Enforcement Mechanisms (Ranked by Reliability)

| Mechanism | Reliability | Scope | Notes |
|-----------|------------|-------|-------|
| **Hookflows** (`.{{EMPLOYER_PARENT}}/hookflows/`) | ✅ HIGH | Main session + sub-agents (SDK runtime) | The CORRECT enforcement. File-event hookflows are dispatched by the SDK for ALL tool calls. |
| **Prompt-level rules** (agent `.md` files) | ✅ HIGH | All sessions | "Use log_pump, don't edit nicu.db" in agent instructions. Primary for behavioral guidance. |
| **Extension `onPostToolUse`** | ⚠️ MEDIUM | Main session only | Injects correction context after a blocked edit lands. Defense-in-depth. |
| **Extension `onPreToolUse`** | ❌ NOT DISPATCHED | N/A | SDK v1.0.47 does NOT dispatch `onPreToolUse` to extensions. Kept in code for future SDK versions. |

**Bottom line:** Hookflows are the enforcement mechanism. Extensions provide the tools. Prompt rules teach agents the correct behavior. `onPostToolUse` is a safety net.

## WHY This Pattern Exists

1. **Token waste** — agents read 50KB+ JSON files just to append one entry
2. **Schema drift** — no validation on raw edits → malformed entries
3. **Race conditions** — multiple agents editing same file simultaneously
4. **No side effects** — raw edits can't trigger follow-up actions (reminders, tasks, schedule updates)
5. **Fragile data** — one bad edit corrupts the entire file
6. **Context pollution** — view/edit of large files wastes AI context window

## WHAT It Provides

### 1. Hookflow Guard (`.{{EMPLOYER_PARENT}}/hookflows/block-protected-files.md`)

The PRIMARY enforcement mechanism. A hookflow that intercepts `edit`/`create` calls at the SDK runtime level:

```yaml
---
name: Block edits to governed data files
event: file
action: block
lifecycle: pre
pattern: "data/nicu/(nicu\\.db|pumping-log\\.json|schedule\\.json|baby-journal\\.json)"
---
```

**How it works:**
- SDK runtime dispatches `event: file` for every `edit` and `create` tool call
- `lifecycle: pre` means it fires BEFORE the tool executes
- `pattern` regex matches against the file path — if matched, `action: block` denies the call
- The denial message in the hookflow body tells the agent which tool to use instead
- Works for the main session AND sub-agents (hookflows propagate through the SDK)

**The pattern is auto-generated** from `data/protected-files.json` by the protected-files extension. When the registry changes, the extension updates the hookflow's regex pattern to stay in sync.

### 2. Protected Files Registry (`data/protected-files.json`)

A JSON object mapping relative file paths to denial messages:

```json
{
  "data/nicu/pumping-log.json": "🚫 PROTECTED FILE. Use the `log_pump` tool to add pump sessions, or `get_pump_stats` / `get_pump_history` to read data.",
  "data/nicu/schedule.json": "🚫 PROTECTED FILE. Use `update_pump_schedule` to modify schedule fields."
}
```

**Rules:**
- Keys are relative paths from repo root (forward slashes)
- Values are denial messages that MUST name the correct tool
- Adding a file here (or using `add_protected_file` tool) updates the hookflow pattern automatically
- `view` is NOT blocked — agents can still read for context

### 3. Protected Files Extension (`.{{EMPLOYER_PARENT}}/extensions/protected-files/extension.mjs`)

The extension serves TWO roles:

**a) Registry Manager** — Provides `add_protected_file` / `remove_protected_file` tools that update the registry AND regenerate the hookflow pattern. This is the only way to modify protection rules.

**b) Defense-in-Depth** — Uses `onPostToolUse` to inject correction context if a blocked edit somehow lands. This is a safety net, NOT the primary enforcement. The hookflow is primary.

> **⚠️ SDK v1.0.47:** `onPreToolUse` is NOT dispatched to extensions. Code is present for forward compatibility but currently inert. `onPostToolUse` IS dispatched and works for injecting follow-up context.

### 4. Domain Data Extensions (Privileged Writers)

These extensions are the ONLY code that writes to governed data files. They are **privileged writers** because:
- They run in their own Node.js process, using `fs.writeFileSync` / `DatabaseSync` directly
- Their I/O bypasses the SDK tool layer entirely — hookflows cannot intercept it
- They validate input, enforce schema, handle side effects, and return structured summaries
- Agents interact with data ONLY through these tools — never via raw `edit`/`create`

Dedicated extensions that provide validated tools for each data domain:

| Extension | Data Domain | Tools |
|-----------|-------------|-------|
| `nicu-tracker` | Pumping, baby journal, schedule | log_pump, get_pump_stats, log_baby_weight, etc. |
| *(future)* `budget-data` | Budget tracking | log_expense, get_budget_summary, etc. |
| *(future)* `meal-data` | Meal plans, recipes | set_meal, log_grocery_trip, etc. |

## CHOOSE — SQLite by Default, JSON Only for Config

**The #1 factor is CONCURRENCY.** Multiple agents run simultaneously and may read/write the same data. JSON files have zero concurrency safety — two agents editing the same file = data loss. SQLite with WAL mode handles concurrent reads natively and concurrent read+write safely. This is proven by the agent-mesh extension (`~/.copilot/extensions/agent-mesh/`) which uses SQLite specifically because multiple CLI sessions share the same DB.

**Default to SQLite. Only use JSON when ALL of these are true:**
- Config-like data that changes less than once per day
- Small (< 50 entries, < 5KB)
- No concurrent agent writes possible
- Human readability of the raw file is genuinely needed

### Decision Flowchart

```
START: New data domain to govern
  │
  ├─ Q1: Could MULTIPLE AGENTS write to this data concurrently?
  │   ├─ YES → SQLite (mandatory — JSON will lose data)
  │   └─ NO  → continue
  │
  ├─ Q2: Will the dataset exceed ~100 entries or grow continuously?
  │   ├─ YES → SQLite (scales; JSON gets slow and wastes context)
  │   └─ NO  → continue
  │
  ├─ Q3: Will agents need to FILTER, SORT, or AGGREGATE?
  │   ├─ YES → SQLite (queries are free; JSON = full-file load)
  │   └─ NO  → continue
  │
  ├─ Q4: Is this CONFIG data that rarely changes (schedules, settings)?
  │   ├─ YES → JSON ✅ (human-readable, git-diffable, simple)
  │   └─ NO  → SQLite
  │
  └─ Q5: Is human readability of the raw file essential?
      ├─ YES → JSON (but consider: can tools provide the same readability?)
      └─ NO  → SQLite (agents can't inspect .db = a FEATURE, not a bug)
```

**When in doubt → SQLite.** You never regret concurrency safety. You always regret data loss.

### Decision Matrix (quick reference)

| Data Characteristic | JSON | SQLite |
|---------------------|------|--------|
| Concurrent agent writes | ❌ DATA LOSS RISK | ✅ WAL mode |
| Append-only log, growing | ❌ Slows down | ✅ Scales |
| Current state > history | ❌ | ✅ Best |
| Needs filtering/aggregation | ❌ Full file load | ✅ SQL queries |
| High-volume (100+ entries) | ❌ Slow, huge context | ✅ Fast |
| Config / rarely changes | ✅ Best | ❌ Overkill |
| Human-inspectable without tools | ✅ | ❌ (feature!) |
| Git diffs valuable | ✅ | ❌ Binary |

### The Two Patterns

#### Pattern A: SQLite (DEFAULT)
The standard choice for all governed data.

```
data/{domain}/{domain}.db  ← SQLite database, tools query it
```

- Extensions use `node:sqlite` (`DatabaseSync`) — zero external dependencies (Node 22+ built-in)
- `PRAGMA journal_mode = WAL` for concurrent read+write
- Fast queries, filtering, aggregation at any scale
- Rich text stored in TEXT columns (SQLite handles it fine)
- Extra/variable fields stored as JSON in an `extra_json TEXT` column
- Can't be inspected without tools → agents MUST use governed tools (self-enforcing)
- Proven pattern: `action-tracker.db`, agent-mesh DB

**Examples:** nicu.db (pump sessions + baby journal), action-tracker.db (tasks)

#### Pattern B: JSON (config only)
Only for small, rarely-changing config where human readability matters.

```
data/{domain}/config.json  ← single JSON file, tools read/write it
```

- `readFileSync`/`writeFileSync` — simple but no concurrency
- Git tracks every change — useful for config evolution
- Must stay small (< 5KB) and low-frequency (< 1 write/day)

**Examples:** schedule.json (pump schedule config), gateway-services.json

### SQLite Extension Template

```javascript
import { DatabaseSync } from "node:sqlite";
import { resolve, dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";

const REPO_ROOT = resolve(
  dirname(import.meta.url.replace("file:///", "")),
  "..", "..", ".."
);

const DB_DIR = join(REPO_ROOT, "data", "my-domain");
const DB_PATH = join(DB_DIR, "my-data.db");

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'active',
    notes_file TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

await joinSession({
  tools: [
    {
      name: "log_entry",
      description: "Log a new entry...",
      parameters: { /* ... */ },
      handler: (args) => {
        const stmt = db.prepare(
          "INSERT INTO entries (date, amount, status) VALUES (?, ?, ?)"
        );
        stmt.run(args.date, args.amount, args.status || "active");
        const last = db.prepare("SELECT last_insert_rowid() as id").get();
        return { message: "✅ Logged", id: last.id };
      },
    },
    {
      name: "get_stats",
      description: "Get summary stats...",
      parameters: { /* ... */ },
      handler: (args) => {
        const days = args.days || 7;
        const row = db.prepare(`
          SELECT COUNT(*) as count, SUM(amount) as total, AVG(amount) as avg
          FROM entries WHERE date >= date('now', '-' || ? || ' days')
        `).get(days);
        return row;
      },
    },
  ],
});
```

### Existing Platform Data — Current State

| Data | Backing | Status | Notes |
|------|---------|--------|-------|
| `data/nicu/nicu.db` | SQLite ✅ | **Live** | Pump sessions + baby journal. Auto-migrated from JSON on first load. |
| `data/nicu/schedule.json` | JSON ✅ | **Live** | Config-like schedule. Rarely changes. JSON is correct. |
| `action-tracker.db` | SQLite ✅ | **Live** | Tasks, templates, triggers. Reference implementation. |
| `data/nicu/pumping-log.json` | JSON → SQLite | **Archived** | Legacy. Data migrated into nicu.db. Kept for git history. |
| `data/nicu/baby-journal.json` | JSON → SQLite | **Archived** | Legacy. Data migrated into nicu.db. Kept for git history. |
| `data/life-events.json` | JSON | **Candidate** | ~30 entries, low-volume. Could stay JSON or migrate. |
| `data/nicu/hydration-log.json` | JSON | **Candidate** | Should be in nicu.db (concurrent agent access). |
| `data/nicu/medication-log.json` | JSON | **Candidate** | Should be in nicu.db (concurrent agent access). |

### Migration Path: JSON → SQLite (Non-Breaking)

The tool interface is the abstraction boundary. When you migrate from JSON to SQLite:

1. The **tool names and parameters stay identical** — agents don't know or care about the backing store
2. The **extension handler** swaps from `readFileSync`/`writeFileSync` to `DatabaseSync` queries
3. A **one-time migration function** reads the JSON, inserts into SQLite, records in a `migrations` table
4. The **protected-files.json** entry adds the `.db` file, marks JSON entries as legacy
5. The old JSON file is **preserved** (kept for git history) — not deleted
6. **Variable/extra fields** go into an `extra_json TEXT` column to handle schema variations

This is why the tool abstraction layer matters — it makes the backing store an implementation detail.

### Proven Reference: agent-mesh Extension

The `agent-mesh` user-level extension at `~/.copilot/extensions/agent-mesh/` is the canonical proof that SQLite works for multi-session concurrent access. Multiple Copilot CLI sessions ({{FAMILY_NAME}}-family, msix-home, vidpipe) all read and write to the same SQLite database simultaneously. It uses WAL mode and has zero data loss in production.

## HOW — Step-by-Step Migration

### Adding a New Governed Data Domain

1. **Identify the data** being raw-edited by agents
2. **Default to SQLite** — only use JSON if it's truly config-like (see flowchart). When in doubt, SQLite.
3. **Define operations** — what do agents actually DO with this data?
   - Append entries? → `log_X` tool
   - Read summaries? → `get_X_stats` tool
   - Update fields? → `update_X` tool
   - Query/filter? → `search_X` tool
4. **Create the extension** at `.{{EMPLOYER_PARENT}}/extensions/{name}/extension.mjs`
   - Use `node:sqlite` (`DatabaseSync`) with WAL mode (see template above)
   - Schema: structured fields as columns, variable/extra fields in `extra_json TEXT`
   - Include a `migrations` table for tracking JSON-to-SQLite data imports
   - Validate ALL inputs before writing
   - Return minimal data (summaries, not entire tables)
   - Handle side effects (task creation, schedule updates)
5. **Register governed files** — use the `add_protected_file` tool to register each file
   - This updates `data/protected-files.json` AND regenerates the hookflow pattern in `.{{EMPLOYER_PARENT}}/hookflows/block-protected-files.md`
   - Register the `.db` file as the primary governed file
   - Also register legacy JSON files if they exist (mark as archived)
   - Verify the hookflow blocks `edit`/`create` calls to the new files
6. **Update agent instructions** — add tool references in relevant `.agent.md` files
7. **Test** — verify guard blocks edits and tools work
8. **Monitor** — check `onPostToolUse` messages for agents still trying raw edits

### JSON Extension Template (config-only files)

> ⚠️ **Only use for config-like data** that changes < 1x/day and is never written by concurrent agents. For everything else, use the SQLite template above.

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";

const REPO_ROOT = resolve(
  dirname(import.meta.url.replace("file:///", "")),
  "..", "..", ".."
);

const DATA_PATH = resolve(REPO_ROOT, "data", "my-domain", "my-data.json");

function loadData() {
  try {
    if (!existsSync(DATA_PATH)) return [];
    return JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to read data: ${err.message}`);
  }
}

function saveData(data) {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

await joinSession({
  tools: [
    {
      name: "log_my_thing",
      description: "Log a new entry with validated schema...",
      parameters: {
        type: "object",
        properties: {
          field1: { type: "string", description: "..." },
          field2: { type: "number", description: "..." },
        },
        required: ["field1"],
      },
      handler: (args) => {
        // Validate
        if (!args.field1) return { error: "field1 is required" };
        // Load, append, save
        const data = loadData();
        data.push({ ...args, created_at: new Date().toISOString() });
        saveData(data);
        return { message: "✅ Logged", entry: data[data.length - 1] };
      },
    },
  ],
  hooks: {
    onSessionStart: async () => ({
      additionalContext: "[my-ext] Loaded. Tools: log_my_thing.",
    }),
  },
});
```

### Protected Files Registry Entry Template

```json
{
  "data/my-domain/my-data.json": "🚫 PROTECTED FILE. Use the `log_my_thing` tool to add entries, or `get_my_stats` to read data. Do NOT edit this file directly."
}
```

## When to Govern — Quick Checklist

Use the CHOOSE section's flowchart for backing store. Use this checklist for whether to govern at all:

| Signal | Action |
|--------|--------|
| File is > 10KB and growing | Strong candidate — use SQLite |
| Multiple agents write to it | Govern immediately — SQLite with WAL |
| Schema has required fields | Govern (validation prevents drift) |
| Writes should trigger side effects | Govern (tools can trigger actions) |
| File is read-only reference data | Don't govern (view is fine) |
| File is rarely edited (< 1x/week) | Low priority unless schema matters |
| File has complex update logic | Strong candidate |
| Dataset will exceed 500 entries | SQLite or hybrid — JSON won't scale |

## Current Governed Files

| File | Extension | Backing | Tools |
|------|-----------|---------|-------|
| `data/nicu/nicu.db` | nicu-tracker | SQLite ✅ | log_pump, get_pump_stats, get_pump_history, log_baby_weight, log_baby_event |
| `data/nicu/schedule.json` | nicu-tracker | JSON (config) | update_pump_schedule, get_next_pump |
| `data/nicu/pumping-log.json` | nicu-tracker | Archived (→ nicu.db) | Legacy — data migrated to SQLite |
| `data/nicu/baby-journal.json` | nicu-tracker | Archived (→ nicu.db) | Legacy — data migrated to SQLite |
| `action-tracker.db` | action-tracker | SQLite ✅ | add_task, complete_task, list_tasks, etc. |

## Anti-Patterns

- ❌ **Using JSON for any data with concurrent agent writes** — this WILL lose data
- ❌ Creating a "mega-tool" that does everything (bad parameter validation, confusing)
- ❌ Returning entire tables/files from tools (defeats the purpose)
- ❌ **Relying on extension `onPreToolUse` for enforcement** — SDK v1.0.47 does NOT dispatch it. Use hookflows.
- ❌ **Manually editing `block-protected-files.md`** — it's auto-generated from the registry. Use `add_protected_file` / `remove_protected_file` tools.
- ❌ Governing files that are rarely edited (overhead not worth it)
- ❌ Not including tool names in the denial message (agent won't know what to use)
- ❌ Blocking `view` — reading for context is fine and expected
- ❌ Using JSON for data that will exceed 100 entries (use SQLite)
- ❌ Defaulting to JSON "because it's simpler" — concurrency safety > simplicity
- ❌ Forgetting `PRAGMA journal_mode = WAL` — without it, SQLite blocks concurrent reads during writes
- ❌ Forgetting the `extra_json TEXT` column — variable fields WILL appear, and you need somewhere to put them
