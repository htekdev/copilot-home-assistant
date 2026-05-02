import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { joinSession } from "@github/copilot-sdk/extension";

const REPO_ROOT = resolve(
  dirname(import.meta.url.replace("file:///", "")),
  "..", "..", ".."
);
const DB_DIR = join(REPO_ROOT, "data");
const DB_PATH = join(DB_DIR, "action-tracker.db");
const TEMPLATES_DIR = join(REPO_ROOT, "data", "task-templates");

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
if (!existsSync(TEMPLATES_DIR)) mkdirSync(TEMPLATES_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// --- PRAGMA: enforce foreign keys ---
db.exec("PRAGMA foreign_keys = ON");

// =====================================================================
// Phase 1: Schema — includes v2 columns + cancelled status + trigger_log
// =====================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    assignee TEXT DEFAULT '',
    title TEXT NOT NULL,
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('urgent','high','medium','low')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','blocked','cancelled')),
    due_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    recurrence TEXT DEFAULT '',
    location TEXT DEFAULT '',
    depends_on_csv TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by TEXT DEFAULT 'user',
    surface TEXT DEFAULT 'human',
    on_complete TEXT DEFAULT '',
    estimated_minutes INTEGER DEFAULT 0,
    template_instance TEXT DEFAULT '',
    source_template_id TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS action_deps (
    action_id TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (action_id, depends_on),
    FOREIGN KEY (action_id) REFERENCES actions(id),
    FOREIGN KEY (depends_on) REFERENCES actions(id)
  );
  CREATE TABLE IF NOT EXISTS trigger_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    completed_task_id TEXT NOT NULL,
    trigger_template_id TEXT NOT NULL,
    trigger_index INTEGER NOT NULL,
    fired_at TEXT DEFAULT (datetime('now')),
    instance_id TEXT DEFAULT '',
    UNIQUE(completed_task_id, trigger_template_id, trigger_index)
  );
`);

// --- Migration: add columns that may be missing from older schema ---
const colCheck = db.prepare("PRAGMA table_info(actions)").all();
const colNames = new Set(colCheck.map(c => c.name));
const migrations = [
  ["assignee", "TEXT DEFAULT ''"],
  ["category", "TEXT DEFAULT 'general'"],
  ["recurrence", "TEXT DEFAULT ''"],
  ["location", "TEXT DEFAULT ''"],
  ["depends_on_csv", "TEXT DEFAULT ''"],
  ["created_by", "TEXT DEFAULT 'user'"],
  ["surface", "TEXT DEFAULT 'human'"],
  // v2 columns
  ["on_complete", "TEXT DEFAULT ''"],
  ["estimated_minutes", "INTEGER DEFAULT 0"],
  ["template_instance", "TEXT DEFAULT ''"],
  ["source_template_id", "TEXT DEFAULT ''"],
];

// Rename 'customer' to 'assignee' if migrating from msix-home schema
// Must happen BEFORE the add-column loop to avoid duplicate 'assignee' column
if (colNames.has("customer") && !colNames.has("assignee")) {
  db.exec("ALTER TABLE actions RENAME COLUMN customer TO assignee");
  colNames.add("assignee");
  colNames.delete("customer");
}
for (const [col, def] of migrations) {
  if (!colNames.has(col)) {
    db.exec(`ALTER TABLE actions ADD COLUMN ${col} ${def}`);
  }
}

// --- Upgrade CHECK constraint: add 'cancelled' status if not present ---
// SQLite doesn't allow ALTER CHECK, but we can check by inserting a test row.
// If the old CHECK doesn't allow 'cancelled', we rebuild the constraint.
// Safest approach: try an insert with cancelled status in a transaction.
try {
  db.exec("SAVEPOINT check_cancelled");
  db.exec("INSERT INTO actions (id, title, status) VALUES ('__check_cancelled_status__', '__test__', 'cancelled')");
  db.exec("DELETE FROM actions WHERE id = '__check_cancelled_status__'");
  db.exec("RELEASE check_cancelled");
} catch {
  // Old schema doesn't allow 'cancelled' — need to recreate table
  // This is a no-op if the table was just created with the new schema above
  try {
    db.exec("ROLLBACK TO check_cancelled");
    db.exec("RELEASE check_cancelled");
  } catch { /* already released */ }
  // Recreate with new CHECK — preserve all data
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS actions_new (
        id TEXT PRIMARY KEY,
        assignee TEXT DEFAULT '',
        title TEXT NOT NULL,
        priority TEXT DEFAULT 'medium' CHECK(priority IN ('urgent','high','medium','low')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','blocked','cancelled')),
        due_date TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        category TEXT DEFAULT 'general',
        recurrence TEXT DEFAULT '',
        location TEXT DEFAULT '',
        depends_on_csv TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        created_by TEXT DEFAULT 'user',
        surface TEXT DEFAULT 'human',
        on_complete TEXT DEFAULT '',
        estimated_minutes INTEGER DEFAULT 0,
        template_instance TEXT DEFAULT '',
        source_template_id TEXT DEFAULT ''
      );
      INSERT INTO actions_new SELECT
        id, assignee, title, priority, status, due_date, notes, category,
        recurrence, location, depends_on_csv, created_at, updated_at,
        COALESCE(created_by, 'user'),
        COALESCE(surface, 'human'),
        COALESCE(on_complete, ''),
        COALESCE(estimated_minutes, 0),
        COALESCE(template_instance, ''),
        COALESCE(source_template_id, '')
      FROM actions;
      DROP TABLE actions;
      ALTER TABLE actions_new RENAME TO actions;
    `);
  } catch { /* migration already done or table was fresh */ }
}

// --- Indexes ---
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_actions_surface_status ON actions(surface, status);
  CREATE INDEX IF NOT EXISTS idx_actions_created_by ON actions(created_by);
  CREATE INDEX IF NOT EXISTS idx_actions_template_instance ON actions(template_instance);
  CREATE INDEX IF NOT EXISTS idx_actions_source_template ON actions(source_template_id);
  CREATE INDEX IF NOT EXISTS idx_trigger_log_task ON trigger_log(completed_task_id, trigger_template_id);
`);

// =====================================================================
// Helpers
// =====================================================================
function genId(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug;
}

function uniqueId(title) {
  let id = genId(title);
  const existing = db.prepare("SELECT id FROM actions WHERE id = ?").get(id);
  if (!existing) return id;
  let i = 2;
  while (db.prepare("SELECT id FROM actions WHERE id = ?").get(`${id}-${i}`)) {
    i++;
  }
  return `${id}-${i}`;
}

function formatTable(rows, columns) {
  if (rows.length === 0) return "No items found.";
  const header = "| " + columns.map(c => c.label).join(" | ") + " |";
  const sep = "| " + columns.map(() => "---").join(" | ") + " |";
  const body = rows.map(r =>
    "| " + columns.map(c => {
      const val = r[c.key];
      return val != null ? String(val) : "";
    }).join(" | ") + " |"
  ).join("\n");
  return [header, sep, body].join("\n");
}

const PRIORITY_EMOJI = { urgent: "\uD83D\uDD34", high: "\uD83D\uDFE0", medium: "\uD83D\uDFE1", low: "\uD83D\uDFE2" };

// --- Recurrence helper ---
function computeNextDueDate(dueDate, recurrence) {
  if (!dueDate || !recurrence) return "";
  const d = new Date(dueDate + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  switch (recurrence) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    default: return "";
  }
  return d.toISOString().slice(0, 10);
}

// =====================================================================
// Phase 2: Template Loading with File-Mtime Caching + Validation
// =====================================================================
let _templateCache = null;
let _templateMtimes = null; // Map<filename, mtimeMs>

function loadTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return {};

  // Check mtimes — if all files match cached mtimes, return cache
  let files;
  try {
    files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith(".json"));
  } catch { return {}; }

  const currentMtimes = new Map();
  for (const f of files) {
    try {
      const st = statSync(join(TEMPLATES_DIR, f));
      currentMtimes.set(f, st.mtimeMs);
    } catch { /* skip unreadable files */ }
  }

  // Cache hit: same files, same mtimes
  if (_templateCache && _templateMtimes) {
    let cacheValid = _templateMtimes.size === currentMtimes.size;
    if (cacheValid) {
      for (const [f, mtime] of currentMtimes) {
        if (_templateMtimes.get(f) !== mtime) { cacheValid = false; break; }
      }
    }
    if (cacheValid) return _templateCache;
  }

  // Cache miss — reload all template files
  const templates = {};
  for (const f of files) {
    try {
      const raw = readFileSync(join(TEMPLATES_DIR, f), "utf-8");
      const parsed = JSON.parse(raw);
      // Each file is a single template: { "template_id": { ...template } }
      // Or the file IS the template and the ID is the filename without .json
      if (parsed && typeof parsed === "object") {
        // If the file has a top-level key that looks like a template (has "tasks" array), use filename as ID
        if (Array.isArray(parsed.tasks)) {
          const id = f.replace(/\.json$/, "");
          templates[id] = parsed;
        } else {
          // File contains { "id1": {...}, "id2": {...} } or { "templates": {...} }
          const container = parsed.templates || parsed;
          for (const [id, tmpl] of Object.entries(container)) {
            if (tmpl && Array.isArray(tmpl.tasks)) {
              templates[id] = tmpl;
            }
          }
        }
      }
    } catch { /* skip invalid JSON files */ }
  }

  // Validate: check for cycles in each template
  for (const [id, tmpl] of Object.entries(templates)) {
    try {
      topologicalSort(tmpl.tasks); // throws on cycles
    } catch (e) {
      // Remove invalid templates, log warning
      delete templates[id];
    }
  }

  _templateCache = templates;
  _templateMtimes = currentMtimes;
  return templates;
}

// =====================================================================
// Topological Sort with Cycle Detection (3-color DFS — review fix #4)
// =====================================================================
function topologicalSort(tasks) {
  const sorted = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const taskMap = new Map(tasks.map(t => [t.key, t]));

  for (const task of tasks) {
    color.set(task.key, WHITE);
  }

  function visit(key) {
    const c = color.get(key);
    if (c === BLACK) return; // already processed
    if (c === GRAY) {
      throw new Error(`Cycle detected in template dependencies involving task '${key}'`);
    }
    if (!taskMap.has(key)) {
      throw new Error(`Dependency '${key}' not found in template tasks`);
    }

    color.set(key, GRAY); // visiting
    const task = taskMap.get(key);
    for (const dep of task.depends_on) {
      visit(dep);
    }
    color.set(key, BLACK); // done
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task.key);
  }
  return sorted;
}

// =====================================================================
// Cron Matching (ported from cron-scheduler — review fix #9)
// =====================================================================
function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      let rangeStart = min, rangeEnd = max;
      if (stepMatch[1] !== "*") {
        const rangeParts = stepMatch[1].split("-");
        rangeStart = parseInt(rangeParts[0], 10);
        if (rangeParts.length === 2) rangeEnd = parseInt(rangeParts[1], 10);
      }
      for (let i = rangeStart; i <= rangeEnd; i += step) values.add(i);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }
    values.add(parseInt(part, 10));
  }
  return values;
}

function parseCron(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}" (need 5 fields)`);
  }
  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    daysOfMonth: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    daysOfWeek: parseCronField(fields[4], 0, 6),
  };
}

function cronMatchesNow(cronExpr, now) {
  try {
    const parsed = parseCron(cronExpr);
    // Opus review fix: Check a time WINDOW, not exact minute.
    // The cron job runs every 15 minutes, so check if the expression
    // matched at any minute in the last 15 minutes to avoid missed ticks.
    const WINDOW_MINUTES = 16; // slightly over 15 to cover edge cases
    for (let offset = 0; offset < WINDOW_MINUTES; offset++) {
      const check = new Date(now.getTime() - offset * 60_000);
      if (
        parsed.minutes.has(check.getMinutes()) &&
        parsed.hours.has(check.getHours()) &&
        parsed.daysOfMonth.has(check.getDate()) &&
        parsed.months.has(check.getMonth() + 1) &&
        parsed.daysOfWeek.has(check.getDay())
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// =====================================================================
// Trigger Engine Helpers
// =====================================================================

// Evaluate a trigger condition against a completed task
function evaluateTaskTrigger(condition, task) {
  if (!condition) return false;
  if (condition.title_contains) {
    if (!task.title.toLowerCase().includes(condition.title_contains.toLowerCase())) return false;
  }
  if (condition.category) {
    if (task.category !== condition.category) return false;
  }
  if (condition.assignee) {
    if (task.assignee !== condition.assignee) return false;
  }
  if (condition.created_by) {
    if (task.created_by !== condition.created_by) return false;
  }
  if (condition.has_tag) {
    if (!task.notes?.toLowerCase().includes(condition.has_tag.toLowerCase())) return false;
  }
  return true;
}

// Instance-scoped template completion check (review fix #2, #10)
// Uses template_instance column, NOT notes LIKE patterns
function checkTemplateCompletion(sourceTemplateId, justCompletedId) {
  // Find the most recent template instance for this template
  // that the just-completed task belongs to
  const justCompleted = db.prepare("SELECT template_instance FROM actions WHERE id = ?").get(justCompletedId);
  if (!justCompleted?.template_instance) return false;

  // Scope check to THIS specific instance
  const instanceTasks = db.prepare(
    "SELECT id, status FROM actions WHERE template_instance = ?"
  ).all(justCompleted.template_instance);

  if (instanceTasks.length === 0) return false;

  // All tasks in this instance must be done (or the one we just completed counts as done)
  return instanceTasks.every(
    t => t.status === "done" || t.status === "cancelled" || t.id === justCompletedId
  );
}

// Build tree visualization for expand_template output
function buildTreeVisualization(created) {
  const lines = [];
  for (const task of created) {
    const depNames = task.deps.length > 0
      ? ` (after: ${task.deps.join(", ")})`
      : " (ready)";
    const timeStr = task.estimated_minutes > 0 ? ` ~${task.estimated_minutes}min` : "";
    lines.push(`  ${task.deps.length === 0 ? "▶" : "⏳"} **${task.id}**${timeStr}${depNames}`);
  }
  return lines.join("\n");
}

// =====================================================================
// Tool Handlers
// =====================================================================

function addTask(args) {
  const {
    title, assignee = "", priority = "medium", due_date = "",
    notes = "", category = "general", recurrence = "", location = "",
    depends_on, created_by = "user", surface = "human",
    on_complete = "", estimated_minutes = 0
  } = args;
  if (!title) return "Error: title is required.";

  // Validate surface value
  const validSurfaces = ["human", "agent", "notify"];
  const safeSurface = validSurfaces.includes(surface) ? surface : "human";

  const id = uniqueId(title);

  // Review fix #5: Validate depends_on IDs exist before inserting
  if (depends_on) {
    const deps = depends_on.split(",").map(d => d.trim()).filter(Boolean);
    for (const dep of deps) {
      const depExists = db.prepare("SELECT id FROM actions WHERE id = ?").get(dep);
      if (!depExists) {
        return `Error: Dependency '${dep}' not found. Cannot create task with missing dependency.`;
      }
    }
  }

  db.prepare(`
    INSERT INTO actions (id, assignee, title, priority, status, due_date, notes, category, recurrence, location, depends_on_csv, created_by, surface, on_complete, estimated_minutes)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, assignee, title, priority, due_date, notes, category, recurrence, location, depends_on || "", created_by, safeSurface, on_complete, estimated_minutes || 0);

  if (depends_on) {
    const deps = depends_on.split(",").map(d => d.trim()).filter(Boolean);
    for (const dep of deps) {
      db.prepare("INSERT OR IGNORE INTO action_deps (action_id, depends_on) VALUES (?, ?)").run(id, dep);
    }
  }

  let result = `\u2705 Task created: **${id}**\n- Title: ${title}\n- Assignee: ${assignee || "(unassigned)"}\n- Priority: ${PRIORITY_EMOJI[priority] || ""} ${priority}\n- Due: ${due_date || "(none)"}\n- Category: ${category}\n- Surface: ${safeSurface}\n- Created by: ${created_by}`;
  if (estimated_minutes > 0) result += `\n- Estimated: ~${estimated_minutes} min`;
  return result;
}

function listTasks(args) {
  const { assignee, status, priority, category, location, due_date_before, due_date_after, created_by, surface } = args || {};

  let sql = "SELECT * FROM actions WHERE 1=1";
  const params = [];

  if (assignee) { sql += " AND LOWER(assignee) LIKE ?"; params.push(`%${assignee.toLowerCase()}%`); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  if (priority) { sql += " AND priority = ?"; params.push(priority); }
  if (category) { sql += " AND LOWER(category) LIKE ?"; params.push(`%${category.toLowerCase()}%`); }
  if (location) { sql += " AND LOWER(location) LIKE ?"; params.push(`%${location.toLowerCase()}%`); }
  if (due_date_before) { sql += " AND due_date != '' AND due_date <= ?"; params.push(due_date_before); }
  if (due_date_after) { sql += " AND due_date != '' AND due_date >= ?"; params.push(due_date_after); }

  // Surface filter
  if (surface && surface !== "all") {
    sql += " AND surface = ?";
    params.push(surface);
  }

  // Created-by filter
  if (created_by) {
    sql += " AND created_by = ?";
    params.push(created_by);
  }

  sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due_date ASC";

  const rows = db.prepare(sql).all(...params);

  if (rows.length === 0) return "No tasks found matching the filter.";

  const mapped = rows.map(r => ({
    ...r,
    pri: `${PRIORITY_EMOJI[r.priority] || ""} ${r.priority}`,
    st: r.status === "done" ? "\u2705" : r.status === "cancelled" ? "\u274C" : r.status === "blocked" ? "\uD83D\uDEAB" : r.status === "in_progress" ? "\uD83D\uDD04" : "\u23F3",
  }));

  return `Found ${rows.length} task(s):\n\n` + formatTable(mapped, [
    { key: "st", label: "" },
    { key: "assignee", label: "Assignee" },
    { key: "title", label: "Task" },
    { key: "pri", label: "Priority" },
    { key: "due_date", label: "Due" },
    { key: "category", label: "Category" },
    { key: "status", label: "Status" },
    { key: "created_by", label: "Created By" },
    { key: "surface", label: "Surface" },
  ]);
}

function updateTask(args) {
  const { id, status, priority, assignee, due_date, notes, title, category, recurrence, location, surface, created_by } = args;
  if (!id) return "Error: id is required.";

  const existing = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  if (!existing) return `Error: Task '${id}' not found.`;

  const updates = [];
  const params = [];

  if (status) {
    const validStatuses = ["pending", "in_progress", "done", "blocked", "cancelled"];
    if (!validStatuses.includes(status)) {
      return `Invalid status "${status}". Must be: ${validStatuses.join(", ")}.`;
    }
    updates.push("status = ?"); params.push(status);
  }
  if (priority) { updates.push("priority = ?"); params.push(priority); }
  if (assignee !== undefined) { updates.push("assignee = ?"); params.push(assignee); }
  if (due_date !== undefined) { updates.push("due_date = ?"); params.push(due_date); }
  if (notes !== undefined) { updates.push("notes = ?"); params.push(notes); }
  if (title) { updates.push("title = ?"); params.push(title); }
  if (category) { updates.push("category = ?"); params.push(category); }
  if (recurrence !== undefined) { updates.push("recurrence = ?"); params.push(recurrence); }
  if (location !== undefined) { updates.push("location = ?"); params.push(location); }

  // Task ownership fields
  if (surface) {
    const validSurfaces = ["human", "agent", "notify"];
    if (!validSurfaces.includes(surface)) {
      return `Invalid surface "${surface}". Must be: human, agent, or notify.`;
    }
    updates.push("surface = ?"); params.push(surface);
  }
  if (created_by !== undefined) {
    updates.push("created_by = ?"); params.push(created_by);
  }

  if (updates.length === 0) return "No fields to update.";

  updates.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE actions SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const updated = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  return `\u2705 Updated **${id}**:\n- Status: ${updated.status}\n- Priority: ${PRIORITY_EMOJI[updated.priority] || ""} ${updated.priority}\n- Assignee: ${updated.assignee || "(unassigned)"}\n- Due: ${updated.due_date || "(none)"}\n- Category: ${updated.category}\n- Surface: ${updated.surface}\n- Created by: ${updated.created_by}`;
}

function completeTask(args) {
  const { id } = args;
  if (!id) return "Error: id is required.";

  const existing = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  if (!existing) return `Error: Task '${id}' not found.`;

  db.prepare("UPDATE actions SET status = 'done', updated_at = datetime('now') WHERE id = ?").run(id);

  let result = `\u2705 Completed: **${id}** \u2014 ${existing.title}`;

  // Auto-create next occurrence for recurring tasks
  if (existing.recurrence && existing.recurrence !== "") {
    const nextDue = computeNextDueDate(existing.due_date, existing.recurrence);
    if (nextDue) {
      const nextId = uniqueId(existing.title);
      db.prepare(`
        INSERT INTO actions (id, assignee, title, priority, status, due_date, notes, category, recurrence, location, depends_on_csv, created_by, surface, on_complete, estimated_minutes)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(nextId, existing.assignee, existing.title, existing.priority, nextDue, existing.notes, existing.category, existing.recurrence, existing.location, "", existing.created_by ?? "user", existing.surface ?? "human", existing.on_complete ?? "", existing.estimated_minutes ?? 0);
      result += `\n\uD83D\uDD04 Recurring task \u2014 next occurrence created: **${nextId}** (due ${nextDue})`;
    }
  }

  // Unblock notification (v1)
  const newlyReady = db.prepare(`
    SELECT a.id, a.title, a.priority FROM actions a
    WHERE a.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM action_deps ad
      JOIN actions dep ON ad.depends_on = dep.id
      WHERE ad.action_id = a.id AND dep.status NOT IN ('done','cancelled')
    )
    AND EXISTS (
      SELECT 1 FROM action_deps ad2
      WHERE ad2.action_id = a.id AND ad2.depends_on = ?
    )
  `).all(id);

  if (newlyReady.length > 0) {
    result += `\n\n\uD83D\uDD13 **Unblocked ${newlyReady.length} task(s):**\n`;
    for (const t of newlyReady) {
      result += `  ${PRIORITY_EMOJI[t.priority] || ""} **${t.id}** \u2014 ${t.title}\n`;
    }
  }

  // Chain progress (v2) — if part of a template instance
  if (existing.template_instance) {
    const progress = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status IN ('done','cancelled') THEN 1 ELSE 0 END) as done
      FROM actions WHERE template_instance = ?
    `).get(existing.template_instance);

    if (progress.total > 1) {
      // Use +1 for the task we just completed (its status update is already committed)
      const remaining = progress.total - progress.done;
      if (remaining === 0) {
        result += `\n\n\uD83C\uDF89 **Chain complete!** All ${progress.total} tasks in this template are done.`;
      } else {
        result += `\n\n\uD83D\uDCCA **Chain progress:** ${progress.done}/${progress.total} done (${remaining} remaining)`;
      }
    }
  }

  // Post-completion instructions (v1/v2)
  if (existing.on_complete && existing.on_complete.trim()) {
    result += `\n\n\uD83D\uDCCB **Post-completion instructions:**\n${existing.on_complete}`;
  }

  return result;
}

function deleteTask(args) {
  const { id } = args;
  if (!id) return "Error: id is required.";

  const existing = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  if (!existing) return `Error: Task '${id}' not found.`;

  db.prepare("DELETE FROM action_deps WHERE action_id = ? OR depends_on = ?").run(id, id);
  db.prepare("DELETE FROM actions WHERE id = ?").run(id);
  return `\uD83D\uDDD1\uFE0F Deleted: **${id}** \u2014 ${existing.title}`;
}

function taskSummary(args) {
  const { surface_filter } = args || {};

  // Review fix #8: Use parameterized queries, not string interpolation
  const validFilters = ["human", "agent", "notify"];
  const safeSurface = (surface_filter && validFilters.includes(surface_filter)) ? surface_filter : null;

  const totalSql = safeSurface
    ? "SELECT COUNT(*) as c FROM actions WHERE surface = ?"
    : "SELECT COUNT(*) as c FROM actions";
  const total = safeSurface
    ? db.prepare(totalSql).get(safeSurface).c
    : db.prepare(totalSql).get().c;

  const byStatusSql = safeSurface
    ? "SELECT status, COUNT(*) as c FROM actions WHERE surface = ? GROUP BY status ORDER BY c DESC"
    : "SELECT status, COUNT(*) as c FROM actions GROUP BY status ORDER BY c DESC";
  const byStatus = safeSurface
    ? db.prepare(byStatusSql).all(safeSurface)
    : db.prepare(byStatusSql).all();

  const byPriSql = safeSurface
    ? "SELECT priority, COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') AND surface = ? GROUP BY priority ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END"
    : "SELECT priority, COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') GROUP BY priority ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END";
  const byPriority = safeSurface
    ? db.prepare(byPriSql).all(safeSurface)
    : db.prepare(byPriSql).all();

  const byAssigneeSql = safeSurface
    ? "SELECT COALESCE(NULLIF(assignee,''), '(unassigned)') as assignee, COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') AND surface = ? GROUP BY assignee ORDER BY c DESC"
    : "SELECT COALESCE(NULLIF(assignee,''), '(unassigned)') as assignee, COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') GROUP BY assignee ORDER BY c DESC";
  const byAssignee = safeSurface
    ? db.prepare(byAssigneeSql).all(safeSurface)
    : db.prepare(byAssigneeSql).all();

  const byCatSql = safeSurface
    ? "SELECT category, COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') AND surface = ? GROUP BY category ORDER BY c DESC LIMIT 10"
    : "SELECT category, COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') GROUP BY category ORDER BY c DESC LIMIT 10";
  const byCategory = safeSurface
    ? db.prepare(byCatSql).all(safeSurface)
    : db.prepare(byCatSql).all();

  const overdueSql = safeSurface
    ? "SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done','blocked','cancelled') AND due_date != '' AND due_date < date('now') AND surface = ?"
    : "SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done','blocked','cancelled') AND due_date != '' AND due_date < date('now')";
  const overdue = safeSurface
    ? db.prepare(overdueSql).get(safeSurface).c
    : db.prepare(overdueSql).get().c;

  const upcomingSql = safeSurface
    ? "SELECT * FROM actions WHERE status NOT IN ('done','blocked','cancelled') AND due_date != '' AND due_date <= date('now', '+7 days') AND surface = ? ORDER BY due_date ASC LIMIT 5"
    : "SELECT * FROM actions WHERE status NOT IN ('done','blocked','cancelled') AND due_date != '' AND due_date <= date('now', '+7 days') ORDER BY due_date ASC LIMIT 5";
  const upcoming = safeSurface
    ? db.prepare(upcomingSql).all(safeSurface)
    : db.prepare(upcomingSql).all();

  const filterLabel = surface_filter && surface_filter !== "all" ? ` (surface: ${surface_filter})` : "";
  let out = `# Task Summary${filterLabel}\n\n**Total:** ${total} | **Overdue:** ${overdue}\n\n`;

  out += "## By Status\n" + formatTable(byStatus.map(r => ({ ...r, st: r.status === "done" ? "\u2705" : r.status === "cancelled" ? "\u274C" : r.status === "blocked" ? "\uD83D\uDEAB" : r.status === "in_progress" ? "\uD83D\uDD04" : "\u23F3" })), [
    { key: "st", label: "" }, { key: "status", label: "Status" }, { key: "c", label: "Count" }
  ]) + "\n\n";

  out += "## By Priority (Open)\n" + formatTable(byPriority.map(r => ({ ...r, pri: `${PRIORITY_EMOJI[r.priority] || ""} ${r.priority}` })), [
    { key: "pri", label: "Priority" }, { key: "c", label: "Count" }
  ]) + "\n\n";

  out += "## By Assignee (Open)\n" + formatTable(byAssignee, [
    { key: "assignee", label: "Assignee" }, { key: "c", label: "Count" }
  ]) + "\n\n";

  out += "## By Category (Open)\n" + formatTable(byCategory, [
    { key: "category", label: "Category" }, { key: "c", label: "Count" }
  ]) + "\n\n";

  // Surface breakdown (always show, regardless of filter)
  const bySurface = db.prepare("SELECT COALESCE(surface, 'human') as surface, COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') GROUP BY surface ORDER BY c DESC").all();
  out += "## By Surface\n" + formatTable(bySurface, [
    { key: "surface", label: "Surface" }, { key: "c", label: "Count" }
  ]) + "\n\n";

  if (upcoming.length > 0) {
    out += "## Due This Week\n" + formatTable(upcoming.map(r => ({
      ...r, pri: `${PRIORITY_EMOJI[r.priority] || ""} ${r.priority}`
    })), [
      { key: "assignee", label: "Assignee" }, { key: "title", label: "Task" },
      { key: "pri", label: "Priority" }, { key: "category", label: "Category" },
      { key: "due_date", label: "Due" }
    ]);
  }

  return out;
}

function getReadyTasks(args) {
  const { surface } = args || {};
  const surfaceClause = surface ? "AND a.surface = ?" : "";
  const params = surface ? [surface] : [];

  // Review fix #5 & #7: Treat cancelled as NOT blocking (cancelled deps count as resolved),
  // but missing deps (dangling references) ARE blocking
  const rows = db.prepare(`
    SELECT a.* FROM actions a
    WHERE a.status = 'pending'
    ${surfaceClause}
    AND NOT EXISTS (
      SELECT 1 FROM action_deps ad
      LEFT JOIN actions dep ON ad.depends_on = dep.id
      WHERE ad.action_id = a.id AND (dep.id IS NULL OR dep.status NOT IN ('done','cancelled'))
    )
    ORDER BY CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, a.due_date ASC
  `).all(...params);

  if (rows.length === 0) return "No ready tasks (all pending items have unmet dependencies or none are pending).";

  const filterLabel = surface ? ` (surface: ${surface})` : "";
  return `${rows.length} task(s) ready to start${filterLabel} (no blocking dependencies):\n\n` + formatTable(rows.map(r => ({
    ...r,
    pri: `${PRIORITY_EMOJI[r.priority] || ""} ${r.priority}`,
    time: r.estimated_minutes > 0 ? `~${r.estimated_minutes}min` : "",
  })), [
    { key: "id", label: "ID" }, { key: "assignee", label: "Assignee" },
    { key: "title", label: "Task" }, { key: "pri", label: "Priority" },
    { key: "category", label: "Category" }, { key: "due_date", label: "Due" },
    { key: "time", label: "Est." },
  ]);
}

// =====================================================================
// Phase 3: expand_template + list_templates + get_dependency_tree
// =====================================================================

function expandTemplate(args) {
  const {
    template_id, overrides = {}, assignee, due_date,
    surface = "human", created_by = "user"
  } = args;
  if (!template_id) return "Error: template_id is required.";

  const templates = loadTemplates();
  const template = templates[template_id];
  if (!template) {
    const available = Object.keys(templates);
    return `Error: Template '${template_id}' not found. Available: ${available.join(", ") || "(none)"}`;
  }

  // Generate unique instance ID
  const instanceId = `${template_id}_${Date.now()}`;
  const keyToId = {};
  const created = [];

  // Topological sort (throws on cycles — review fix #4)
  let sorted;
  try {
    sorted = topologicalSort(template.tasks);
  } catch (e) {
    return `Error: ${e.message}`;
  }

  // Parse overrides if string
  let parsedOverrides = overrides;
  if (typeof overrides === "string") {
    try { parsedOverrides = JSON.parse(overrides); }
    catch { parsedOverrides = {}; }
  }

  // Opus review fix: Validate surface/priority the same way addTask does,
  // since expandTemplate bypasses addTask and does direct SQL inserts.
  const VALID_PRIORITIES = new Set(["urgent", "high", "medium", "low"]);
  const VALID_SURFACES = new Set(["human", "agent", "notify"]);
  const safeSurface = VALID_SURFACES.has(surface) ? surface : "human";

  for (const task of sorted) {
    const depIds = task.depends_on.map(k => keyToId[k]).filter(Boolean);

    // Review fix #5: Validate all depends_on keys resolved
    if (depIds.length !== task.depends_on.length) {
      const missing = task.depends_on.filter(k => !keyToId[k]);
      return `Error: Task '${task.key}' depends on unknown keys: ${missing.join(", ")}`;
    }

    const taskOverride = parsedOverrides[task.key] || {};

    // Process title template variables
    let title = taskOverride.title || task.title_template;
    if (parsedOverrides._variables) {
      for (const [k, v] of Object.entries(parsedOverrides._variables)) {
        title = title.replaceAll(`{${k}}`, v);
      }
    }

    // Opus review fix: Validate priority from template/override (whitelist)
    const rawPriority = taskOverride.priority || task.priority;
    const safePriority = VALID_PRIORITIES.has(rawPriority) ? rawPriority : "medium";

    const id = uniqueId(title);

    db.prepare(`
      INSERT INTO actions (
        id, assignee, title, priority, status, due_date, notes,
        category, recurrence, location, depends_on_csv,
        created_by, surface, on_complete, estimated_minutes,
        template_instance, source_template_id
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskOverride.assignee || assignee || task.assignee || template.default_assignee || "",
      title,
      safePriority,
      taskOverride.due_date || due_date || "",
      `[Template: ${template_id}/${task.key}] ${taskOverride.notes || task.notes || ""}`,
      taskOverride.category || task.category || "general",
      depIds.join(","),
      created_by || "user",
      safeSurface,
      task.on_complete || "",
      task.estimated_minutes || 0,
      instanceId,
      template_id
    );

    // Wire up action_deps
    for (const depId of depIds) {
      db.prepare(
        "INSERT OR IGNORE INTO action_deps (action_id, depends_on) VALUES (?, ?)"
      ).run(id, depId);
    }

    keyToId[task.key] = id;
    created.push({
      key: task.key, id, title, deps: depIds,
      estimated_minutes: task.estimated_minutes || 0,
    });
  }

  // Build output
  const totalMinutes = created.reduce((sum, t) => sum + t.estimated_minutes, 0);
  let result = `\uD83D\uDD17 **Expanded: ${template.name}** (${created.length} tasks`;
  if (totalMinutes > 0) result += `, ~${totalMinutes} min total`;
  result += `)\n`;
  result += `\uD83D\uDCCE Instance: \`${instanceId}\`\n\n`;

  // Tree visualization
  result += buildTreeVisualization(created);

  // Show what's immediately ready
  const readyNow = created.filter(t => t.deps.length === 0);
  if (readyNow.length > 0) {
    result += `\n\n\u2705 **Ready now:** ${readyNow.map(t => t.id).join(", ")}`;
  }
  const blocked = created.filter(t => t.deps.length > 0);
  if (blocked.length > 0) {
    result += `\n\u23F3 **Blocked:** ${blocked.length} task(s) waiting on dependencies`;
  }

  return result;
}

function listTemplates() {
  const templates = loadTemplates();
  const entries = Object.entries(templates);
  if (entries.length === 0) return "No templates found. Add JSON files to data/task-templates/.";

  let result = `\uD83D\uDCCB **${entries.length} template(s) available:**\n\n`;
  for (const [id, tmpl] of entries) {
    const taskCount = tmpl.tasks?.length || 0;
    const triggers = tmpl.triggers?.length || 0;
    const totalMin = (tmpl.tasks || []).reduce((s, t) => s + (t.estimated_minutes || 0), 0);
    const timeStr = totalMin > 0 ? ` (~${totalMin} min)` : "";
    const triggerStr = triggers > 0 ? ` | ${triggers} trigger(s)` : "";
    result += `- **${id}** \u2014 ${tmpl.name} (${taskCount} tasks${timeStr}${triggerStr})\n`;
    if (tmpl.description) result += `  ${tmpl.description}\n`;
  }
  return result;
}

function getDependencyTree(args) {
  const { task_id } = args || {};
  if (!task_id) return "Error: task_id is required.";

  const task = db.prepare("SELECT * FROM actions WHERE id = ?").get(task_id);
  if (!task) return `Error: Task '${task_id}' not found.`;

  // Build transitive dependency tree (upstream)
  function getUpstream(id, depth = 0) {
    if (depth > 20) return []; // safety limit
    const deps = db.prepare(
      "SELECT a.* FROM actions a JOIN action_deps ad ON a.id = ad.depends_on WHERE ad.action_id = ?"
    ).all(id);
    const result = [];
    for (const dep of deps) {
      result.push({ ...dep, depth });
      result.push(...getUpstream(dep.id, depth + 1));
    }
    return result;
  }

  // Build downstream (what depends on this task)
  function getDownstream(id, depth = 0) {
    if (depth > 20) return [];
    const dependents = db.prepare(
      "SELECT a.* FROM actions a JOIN action_deps ad ON a.id = ad.action_id WHERE ad.depends_on = ?"
    ).all(id);
    const result = [];
    for (const dep of dependents) {
      result.push({ ...dep, depth });
      result.push(...getDownstream(dep.id, depth + 1));
    }
    return result;
  }

  const upstream = getUpstream(task_id);
  const downstream = getDownstream(task_id);

  const statusIcon = (s) => s === "done" ? "\u2705" : s === "cancelled" ? "\u274C" : s === "pending" ? "\u23F3" : s === "blocked" ? "\uD83D\uDEAB" : "\uD83D\uDD04";

  let result = `\uD83C\uDF33 **Dependency tree for: ${task_id}**\n\n`;

  if (upstream.length > 0) {
    result += "**⬆ Upstream (this task depends on):**\n";
    for (const dep of upstream) {
      const indent = "  ".repeat(dep.depth + 1);
      result += `${indent}${statusIcon(dep.status)} ${dep.id} \u2014 ${dep.title}\n`;
    }
    result += "\n";
  }

  result += `${statusIcon(task.status)} **${task_id}** \u2014 ${task.title}\n\n`;

  if (downstream.length > 0) {
    result += "**⬇ Downstream (depends on this task):**\n";
    for (const dep of downstream) {
      const indent = "  ".repeat(dep.depth + 1);
      result += `${indent}${statusIcon(dep.status)} ${dep.id} \u2014 ${dep.title}\n`;
    }
  }

  if (upstream.length === 0 && downstream.length === 0) {
    result += "(No dependencies — standalone task)";
  }

  // Template instance info
  if (task.template_instance) {
    const instanceTasks = db.prepare(
      "SELECT id, title, status FROM actions WHERE template_instance = ? ORDER BY created_at"
    ).all(task.template_instance);
    const done = instanceTasks.filter(t => t.status === "done" || t.status === "cancelled").length;
    result += `\n\n\uD83D\uDCCE **Template instance:** \`${task.template_instance}\` (${done}/${instanceTasks.length} complete)`;
  }

  return result;
}

// =====================================================================
// Phase 5: cancel_template_instance + check_scheduled_triggers
// =====================================================================

function cancelTemplateInstance(args) {
  const { instance_id, reason = "" } = args;
  if (!instance_id) return "Error: instance_id is required.";

  // Review fix #7: Use 'cancelled' status, NOT 'done'
  // This prevents cancelled tasks from unblocking downstream work incorrectly
  const tasks = db.prepare(
    "SELECT * FROM actions WHERE template_instance = ? AND status NOT IN ('done', 'cancelled')"
  ).all(instance_id);

  if (tasks.length === 0) return "No active tasks found for this template instance.";

  const cancelNote = reason ? ` [CANCELLED: ${reason}]` : " [CANCELLED]";
  const taskIds = tasks.map(t => t.id);

  db.prepare(
    "UPDATE actions SET status = 'cancelled', notes = notes || ?, updated_at = datetime('now') WHERE template_instance = ? AND status NOT IN ('done', 'cancelled')"
  ).run(cancelNote, instance_id);

  // Opus review fix: Also delete action_deps rows for cancelled tasks (belt-and-suspenders).
  // This prevents cancelled tasks from appearing as dangling dependencies.
  const placeholders = taskIds.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM action_deps WHERE action_id IN (${placeholders}) OR depends_on IN (${placeholders})`
  ).run(...taskIds, ...taskIds);

  return `\uD83D\uDEAB Cancelled ${tasks.length} remaining task(s) from template instance \`${instance_id}\`.\n` +
    tasks.map(t => `  - ${t.title} (was: ${t.status})`).join("\n");
}

function checkScheduledTriggers() {
  const templates = loadTemplates();
  // Use {{TIMEZONE}} timezone to match cron.json
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "{{TIMEZONE}}" });
  const now = new Date(nowStr);
  const due = [];

  for (const [id, template] of Object.entries(templates)) {
    if (!template.triggers) continue;
    for (let i = 0; i < template.triggers.length; i++) {
      const trigger = template.triggers[i];
      if (trigger.type !== "schedule") continue;
      if (!trigger.cron) continue;

      // Dedup check: use template_instance column (review fix #10)
      const dedupHours = trigger.dedup_window_hours || 20;
      const recentExpansion = db.prepare(
        "SELECT id FROM actions WHERE source_template_id = ? AND created_at > datetime('now', ?)"
      ).get(id, `-${dedupHours} hours`);

      if (recentExpansion) continue;

      if (cronMatchesNow(trigger.cron, now)) {
        due.push({ templateId: id, template, trigger });
      }
    }
  }

  if (due.length === 0) return "No scheduled templates due.";

  let result = `\uD83D\uDCC5 **${due.length} scheduled template(s) due:**\n\n`;
  for (const { templateId, template, trigger } of due) {
    const autoStr = trigger.auto_expand ? " (auto-expand)" : " (suggest)";
    result += `- **${templateId}** \u2014 ${template.name}${autoStr}\n`;
    if (trigger.description) result += `  ${trigger.description}\n`;
  }

  // Auto-expand where configured
  for (const { templateId, template, trigger } of due) {
    if (trigger.auto_expand) {
      const expandResult = expandTemplate({
        template_id: templateId,
        created_by: "trigger-engine",
        surface: "human",
      });
      result += `\n\uD83D\uDD17 Auto-expanded **${template.name}**:\n${expandResult}\n`;
    }
  }

  if (due.some(d => !d.trigger.auto_expand)) {
    result += `\nUse \`expand_template\` to instantiate suggested templates.`;
  }

  return result;
}

// =====================================================================
// Tools array
// =====================================================================
const tools = [
  {
    name: "add_task",
    description: "Create a new family task/action item. Tracks chores, errands, appointments, and to-dos for the {{FAMILY_NAME}} family.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title (required)" },
        assignee: { type: "string", description: "Who is responsible: hector, paula, shared, hector-jr, or empty" },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "Priority level (default: medium)" },
        due_date: { type: "string", description: "Due date (YYYY-MM-DD)" },
        notes: { type: "string", description: "Additional notes" },
        category: { type: "string", description: "Task category: general, chore, errand, appointment, school, health, home, finance, shopping, meal, pregnancy, watch" },
        recurrence: { type: "string", description: "Recurrence: daily, weekly, monthly, yearly, or cron expression" },
        location: { type: "string", description: "Location, store, or room" },
        depends_on: { type: "string", description: "Comma-separated IDs of prerequisite tasks" },
        created_by: { type: "string", description: "Which agent created this task. Use agent name (e.g., 'nicu-care', 'finance-manager') or 'user' for direct human requests. Default: 'user'." },
        surface: { type: "string", enum: ["human", "agent", "notify"], description: "Visibility: 'human' = served by task-coach to {{PARENT_1}}/{{PARENT_2}}, 'agent' = agent-internal (never shown to humans), 'notify' = informational (appears in summaries, not served as task). Default: 'human'." },
        on_complete: { type: "string", description: "Post-completion instructions for the agent (e.g., 'Create a reminder task for 2 hours from now')" },
        estimated_minutes: { type: "number", description: "Estimated time to complete in minutes (optional, used for scheduling)" },
      },
      required: ["title"],
    },
    handler: async (args) => { try { return addTask(args); } catch(e) { return `Error: ${e.message}\n${e.stack}`; } },
  },
  {
    name: "list_tasks",
    description: "List family tasks with optional filters. Orders by priority (urgent first), then due date.",
    parameters: {
      type: "object",
      properties: {
        assignee: { type: "string", description: "Filter by assignee" },
        status: { type: "string", enum: ["pending", "in_progress", "done", "blocked", "cancelled"], description: "Filter by status" },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "Filter by priority" },
        category: { type: "string", description: "Filter by category" },
        location: { type: "string", description: "Filter by location" },
        due_date_before: { type: "string", description: "Tasks due on or before this date (YYYY-MM-DD)" },
        due_date_after: { type: "string", description: "Tasks due on or after this date (YYYY-MM-DD)" },
        created_by: { type: "string", description: "Filter by creator agent name (e.g., 'nicu-care', 'user'). Exact match." },
        surface: { type: "string", enum: ["human", "agent", "notify", "all"], description: "Filter by visibility: 'human' (default for task-coach), 'agent', 'notify', or 'all' to see everything. Default: no filter (returns all)." },
      },
    },
    handler: async (args) => listTasks(args),
  },
  {
    name: "update_task",
    description: "Update an existing family task's status, priority, assignee, due date, or notes.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to update (required)" },
        status: { type: "string", enum: ["pending", "in_progress", "done", "blocked", "cancelled"], description: "New status" },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "New priority" },
        assignee: { type: "string", description: "New assignee" },
        due_date: { type: "string", description: "New due date (YYYY-MM-DD)" },
        notes: { type: "string", description: "New notes" },
        title: { type: "string", description: "New title" },
        category: { type: "string", description: "New category" },
        recurrence: { type: "string", description: "New recurrence pattern" },
        location: { type: "string", description: "New location" },
        surface: { type: "string", enum: ["human", "agent", "notify"], description: "New visibility level" },
        created_by: { type: "string", description: "Update the creator (for migration/correction)" },
      },
      required: ["id"],
    },
    handler: async (args) => updateTask(args),
  },
  {
    name: "complete_task",
    description: "Mark a family task as done. If the task recurs, automatically creates the next occurrence. Shows unblocked tasks, chain progress, and post-completion instructions.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to complete (required)" },
      },
      required: ["id"],
    },
    handler: async (args) => completeTask(args),
  },
  {
    name: "delete_task",
    description: "Permanently delete a family task and its dependency links.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to delete (required)" },
      },
      required: ["id"],
    },
    handler: async (args) => deleteTask(args),
  },
  {
    name: "task_summary",
    description: "Dashboard overview: totals by status, priority, assignee, category, surface, overdue count, and due this week. Use surface_filter='human' to see only human-facing tasks.",
    parameters: {
      type: "object",
      properties: {
        surface_filter: { type: "string", enum: ["human", "agent", "notify", "all"], description: "Filter summary to a specific surface level. Default: all." },
      },
    },
    handler: async (args) => taskSummary(args),
  },
  {
    name: "ready_tasks",
    description: "Show tasks ready to start: pending with all dependencies met (no unfinished blockers). Use surface='human' to see only human-facing ready tasks.",
    parameters: {
      type: "object",
      properties: {
        surface: { type: "string", enum: ["human", "agent", "notify"], description: "Filter by surface level. Omit to see all ready tasks." },
      },
    },
    handler: async (args) => getReadyTasks(args),
  },
  // --- v2 Template Tools ---
  {
    name: "expand_template",
    description: "Expand a task template into a full dependency chain. Creates all tasks with pre-wired dependencies. Returns instance ID for tracking/cancellation.",
    parameters: {
      type: "object",
      properties: {
        template_id: { type: "string", description: "Template ID (e.g., 'chicken_marination', 'paula_shower'). Use list_templates to see available." },
        overrides: { type: "string", description: "JSON object of per-task overrides. Keys are task keys, values are objects with title/priority/assignee/etc. Use _variables key for title template substitutions." },
        assignee: { type: "string", description: "Override default assignee for all tasks" },
        due_date: { type: "string", description: "Set due date for all tasks (YYYY-MM-DD)" },
        surface: { type: "string", enum: ["human", "agent", "notify"], description: "Visibility for created tasks. Default: human." },
        created_by: { type: "string", description: "Who initiated this expansion. Default: user." },
      },
      required: ["template_id"],
    },
    handler: async (args) => { try { return expandTemplate(args); } catch(e) { return `Error: ${e.message}\n${e.stack}`; } },
  },
  {
    name: "list_templates",
    description: "Show available task templates with descriptions, task counts, and triggers.",
    parameters: { type: "object", properties: {} },
    handler: async () => listTemplates(),
  },
  {
    name: "get_dependency_tree",
    description: "Show the full upstream and downstream dependency tree for a task. Includes template instance progress if applicable.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID to show dependency tree for" },
      },
      required: ["task_id"],
    },
    handler: async (args) => getDependencyTree(args),
  },
  {
    name: "cancel_template_instance",
    description: "Cancel all remaining tasks from a template expansion. Uses 'cancelled' status (does NOT unblock downstream). Completed tasks are preserved.",
    parameters: {
      type: "object",
      properties: {
        instance_id: { type: "string", description: "Template instance ID (from expand_template output or task's template_instance field)" },
        reason: { type: "string", description: "Why the chain is being cancelled" },
      },
      required: ["instance_id"],
    },
    handler: async (args) => cancelTemplateInstance(args),
  },
  {
    name: "check_scheduled_triggers",
    description: "Check for schedule-based template triggers that are due to fire. Auto-expands templates with auto_expand=true, suggests others.",
    parameters: { type: "object", properties: {} },
    handler: async () => checkScheduledTriggers(),
  },
];

// =====================================================================
// Phase 4: Trigger Engine — onPostToolUse hook
// =====================================================================
// Review fixes addressed:
// #1: Depth counter (max 3), idempotent firing via trigger_log, self-trigger guard
// #2: Instance-scoped completion check via template_instance column
// #3: Race condition protection via trigger_log UNIQUE constraint
// #6: Self-triggering loop prevention via source_template_id check

const MAX_TRIGGER_DEPTH = 3;
let _triggerDepth = 0; // tracks recursive trigger depth within a single call chain

function evaluateTriggersForCompletion(completedTask) {
  _triggerDepth++;
  if (_triggerDepth > MAX_TRIGGER_DEPTH) {
    _triggerDepth--;
    return ""; // depth limit reached — no more chain reactions
  }

  try {
    const templates = loadTemplates();
    const triggeredTemplates = [];

    for (const [templateId, template] of Object.entries(templates)) {
      if (!template.triggers) continue;

      // Review fix #6: Skip templates that this task originated from
      // Don't re-trigger a template from its own instances
      if (completedTask.source_template_id === templateId) continue;

      for (let i = 0; i < template.triggers.length; i++) {
        const trigger = template.triggers[i];

        // Skip schedule triggers (handled by check_scheduled_triggers)
        if (trigger.type === "schedule") continue;

        let match = false;

        if (trigger.type === "on_task_complete") {
          match = evaluateTaskTrigger(trigger.condition, completedTask);
        }

        if (trigger.type === "on_template_complete") {
          if (trigger.condition?.template_id) {
            match = checkTemplateCompletion(trigger.condition.template_id, completedTask.id);
          }
        }

        if (match) {
          // Review fix #1 & #3: Idempotent firing — check trigger_log
          const alreadyFired = db.prepare(
            "SELECT id FROM trigger_log WHERE completed_task_id = ? AND trigger_template_id = ? AND trigger_index = ?"
          ).get(completedTask.id, templateId, i);

          if (alreadyFired) continue; // already fired this exact trigger for this task

          // Log the firing (UNIQUE constraint prevents race conditions — review fix #3)
          try {
            db.prepare(
              "INSERT INTO trigger_log (completed_task_id, trigger_template_id, trigger_index) VALUES (?, ?, ?)"
            ).run(completedTask.id, templateId, i);
          } catch {
            continue; // UNIQUE constraint violation = another path already logged this
          }

          triggeredTemplates.push({ templateId, template, trigger });
        }
      }
    }

    if (triggeredTemplates.length === 0) return "";

    let context = "";
    for (const { templateId, template, trigger } of triggeredTemplates) {
      if (trigger.auto_expand) {
        const result = expandTemplate({
          template_id: templateId,
          created_by: "trigger-engine",
          surface: "human",
        });
        context +=
          `[action-tracker] \uD83D\uDD17 **Auto-triggered: ${template.name}** ` +
          `(triggered by completing "${completedTask.title}")\n${result}\n\n`;
      } else {
        const guardMsg = trigger.guard ? `\n\u26A0\uFE0F Guard: ${trigger.guard}` : "";
        context +=
          `[action-tracker] \uD83D\uDCA1 **Trigger detected:** Completing "${completedTask.title}" ` +
          `matches a trigger for **${template.name}** (${template.tasks.length} steps).${guardMsg}\n` +
          `To expand: \`expand_template("${templateId}")\`\n\n`;
      }
    }

    return context;
  } finally {
    _triggerDepth--;
  }
}

// Template auto-detection for add_task (v1 feature from spec)
function detectTemplateFromTitle(title) {
  const templates = loadTemplates();
  const lower = title.toLowerCase();
  const matches = [];

  for (const [id, tmpl] of Object.entries(templates)) {
    if (!tmpl.trigger_keywords) continue;
    for (const kw of tmpl.trigger_keywords) {
      if (lower.includes(kw.toLowerCase())) {
        matches.push({ id, name: tmpl.name, taskCount: tmpl.tasks?.length || 0 });
        break;
      }
    }
  }

  if (matches.length === 0) return "";
  return matches.map(m =>
    `\uD83D\uDCA1 **Template available:** \`${m.id}\` — ${m.name} (${m.taskCount} tasks). ` +
    `Use \`expand_template("${m.id}")\` instead of a single task for a full dependency chain.`
  ).join("\n");
}

// =====================================================================
// Session
// =====================================================================
const session = await joinSession({
  tools,
  hooks: {
    onSessionStart: async () => {
      const total = db.prepare("SELECT COUNT(*) as c FROM actions").get().c;
      const open = db.prepare("SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled')").get().c;
      const humanOpen = db.prepare("SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done','cancelled') AND surface = 'human'").get().c;
      const overdue = db.prepare("SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done','blocked','cancelled') AND due_date != '' AND due_date < date('now') AND surface = 'human'").get().c;
      const templateCount = Object.keys(loadTemplates()).length;
      return {
        additionalContext:
          `[action-tracker] \uD83D\uDCCB Family task tracker loaded. ${total} total, ${open} open (${humanOpen} human-facing), ${overdue} human overdue.\n` +
          `Tools: add_task, list_tasks, update_task, complete_task, delete_task, task_summary, ready_tasks.\n` +
          `v2 Tools: expand_template, list_templates, get_dependency_tree, cancel_template_instance, check_scheduled_triggers.\n` +
          `Templates: ${templateCount} loaded from data/task-templates/.\n` +
          `Fields: created_by (provenance), surface (human|agent|notify), on_complete, estimated_minutes, template_instance.\n` +
          `Status values: pending, in_progress, done, blocked, cancelled.\n` +
          `Database: data/action-tracker.db (persisted in repo).`,
      };
    },

    onPostToolUse: async (input) => {
      let context = "";

      // Template auto-detection on add_task
      if (input.toolName === "add_task" && input.toolArgs?.title) {
        const detection = detectTemplateFromTitle(input.toolArgs.title);
        if (detection) context += detection + "\n\n";
      }

      // Trigger evaluation on complete_task
      if (input.toolName === "complete_task" && input.toolArgs?.id) {
        const taskId = input.toolArgs.id;
        const completedTask = db.prepare("SELECT * FROM actions WHERE id = ?").get(taskId);
        if (completedTask) {
          const triggerContext = evaluateTriggersForCompletion(completedTask);
          if (triggerContext) context += triggerContext;
        }
      }

      if (context) return { additionalContext: context };
    },
  },
});
