import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { joinSession } from "@github/copilot-sdk/extension";

const REPO_ROOT = resolve(
  dirname(import.meta.url.replace("file:///", "")),
  "..", "..", ".."
);
const DB_DIR = join(REPO_ROOT, "data");
const DB_PATH = join(DB_DIR, "action-tracker.db");

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    assignee TEXT DEFAULT '',
    title TEXT NOT NULL,
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('urgent','high','medium','low')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','blocked')),
    due_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    recurrence TEXT DEFAULT '',
    location TEXT DEFAULT '',
    depends_on_csv TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS action_deps (
    action_id TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (action_id, depends_on),
    FOREIGN KEY (action_id) REFERENCES actions(id),
    FOREIGN KEY (depends_on) REFERENCES actions(id)
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
];
for (const [col, def] of migrations) {
  if (!colNames.has(col)) {
    db.exec(`ALTER TABLE actions ADD COLUMN ${col} ${def}`);
  }
}
// Rename 'customer' to 'assignee' if migrating from msix-home schema
if (colNames.has("customer") && !colNames.has("assignee")) {
  db.exec("ALTER TABLE actions RENAME COLUMN customer TO assignee");
}

// --- Helpers ---
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

// --- Tool handlers ---

function addTask(args) {
  const {
    title, assignee = "", priority = "medium", due_date = "",
    notes = "", category = "general", recurrence = "", location = "", depends_on
  } = args;
  if (!title) return "Error: title is required.";

  const id = uniqueId(title);

  db.prepare(`
    INSERT INTO actions (id, assignee, title, priority, status, due_date, notes, category, recurrence, location, depends_on_csv)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).run(id, assignee, title, priority, due_date, notes, category, recurrence, location, depends_on || "");

  if (depends_on) {
    const deps = depends_on.split(",").map(d => d.trim()).filter(Boolean);
    for (const dep of deps) {
      db.prepare("INSERT OR IGNORE INTO action_deps (action_id, depends_on) VALUES (?, ?)").run(id, dep);
    }
  }

  return `\u2705 Task created: **${id}**\n- Title: ${title}\n- Assignee: ${assignee || "(unassigned)"}\n- Priority: ${PRIORITY_EMOJI[priority] || ""} ${priority}\n- Due: ${due_date || "(none)"}\n- Category: ${category}\n- Recurrence: ${recurrence || "(none)"}\n- Location: ${location || "(none)"}`;
}

function listTasks(args) {
  const { assignee, status, priority, category, location, due_date_before, due_date_after } = args || {};

  let sql = "SELECT * FROM actions WHERE 1=1";
  const params = [];

  if (assignee) { sql += " AND LOWER(assignee) LIKE ?"; params.push(`%${assignee.toLowerCase()}%`); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  if (priority) { sql += " AND priority = ?"; params.push(priority); }
  if (category) { sql += " AND LOWER(category) LIKE ?"; params.push(`%${category.toLowerCase()}%`); }
  if (location) { sql += " AND LOWER(location) LIKE ?"; params.push(`%${location.toLowerCase()}%`); }
  if (due_date_before) { sql += " AND due_date != '' AND due_date <= ?"; params.push(due_date_before); }
  if (due_date_after) { sql += " AND due_date != '' AND due_date >= ?"; params.push(due_date_after); }

  sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due_date ASC";

  const rows = db.prepare(sql).all(...params);

  if (rows.length === 0) return "No tasks found matching the filter.";

  const mapped = rows.map(r => ({
    ...r,
    pri: `${PRIORITY_EMOJI[r.priority] || ""} ${r.priority}`,
    st: r.status === "done" ? "\u2705" : r.status === "blocked" ? "\uD83D\uDEAB" : r.status === "in_progress" ? "\uD83D\uDD04" : "\u23F3",
  }));

  return `Found ${rows.length} task(s):\n\n` + formatTable(mapped, [
    { key: "st", label: "" },
    { key: "assignee", label: "Assignee" },
    { key: "title", label: "Task" },
    { key: "pri", label: "Priority" },
    { key: "due_date", label: "Due" },
    { key: "category", label: "Category" },
    { key: "status", label: "Status" },
  ]);
}

function updateTask(args) {
  const { id, status, priority, assignee, due_date, notes, title, category, recurrence, location } = args;
  if (!id) return "Error: id is required.";

  const existing = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  if (!existing) return `Error: Task '${id}' not found.`;

  const updates = [];
  const params = [];

  if (status) { updates.push("status = ?"); params.push(status); }
  if (priority) { updates.push("priority = ?"); params.push(priority); }
  if (assignee !== undefined) { updates.push("assignee = ?"); params.push(assignee); }
  if (due_date !== undefined) { updates.push("due_date = ?"); params.push(due_date); }
  if (notes !== undefined) { updates.push("notes = ?"); params.push(notes); }
  if (title) { updates.push("title = ?"); params.push(title); }
  if (category) { updates.push("category = ?"); params.push(category); }
  if (recurrence !== undefined) { updates.push("recurrence = ?"); params.push(recurrence); }
  if (location !== undefined) { updates.push("location = ?"); params.push(location); }

  if (updates.length === 0) return "No fields to update.";

  updates.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE actions SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const updated = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  return `\u2705 Updated **${id}**:\n- Status: ${updated.status}\n- Priority: ${PRIORITY_EMOJI[updated.priority] || ""} ${updated.priority}\n- Assignee: ${updated.assignee || "(unassigned)"}\n- Due: ${updated.due_date || "(none)"}\n- Category: ${updated.category}`;
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
        INSERT INTO actions (id, assignee, title, priority, status, due_date, notes, category, recurrence, location, depends_on_csv)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `).run(nextId, existing.assignee, existing.title, existing.priority, nextDue, existing.notes, existing.category, existing.recurrence, existing.location, "");
      result += `\n\uD83D\uDD04 Recurring task \u2014 next occurrence created: **${nextId}** (due ${nextDue})`;
    }
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

function taskSummary() {
  const total = db.prepare("SELECT COUNT(*) as c FROM actions").get().c;
  const byStatus = db.prepare("SELECT status, COUNT(*) as c FROM actions GROUP BY status ORDER BY c DESC").all();
  const byPriority = db.prepare("SELECT priority, COUNT(*) as c FROM actions WHERE status != 'done' GROUP BY priority ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END").all();
  const byAssignee = db.prepare("SELECT COALESCE(NULLIF(assignee,''), '(unassigned)') as assignee, COUNT(*) as c FROM actions WHERE status != 'done' GROUP BY assignee ORDER BY c DESC").all();
  const byCategory = db.prepare("SELECT category, COUNT(*) as c FROM actions WHERE status != 'done' GROUP BY category ORDER BY c DESC LIMIT 10").all();
  const overdue = db.prepare("SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done','blocked') AND due_date != '' AND due_date < date('now')").get().c;
  const upcoming = db.prepare("SELECT * FROM actions WHERE status NOT IN ('done','blocked') AND due_date != '' AND due_date <= date('now', '+7 days') ORDER BY due_date ASC LIMIT 5").all();

  let out = `# Task Summary\n\n**Total:** ${total} | **Overdue:** ${overdue}\n\n`;

  out += "## By Status\n" + formatTable(byStatus.map(r => ({ ...r, st: r.status === "done" ? "\u2705" : r.status === "blocked" ? "\uD83D\uDEAB" : r.status === "in_progress" ? "\uD83D\uDD04" : "\u23F3" })), [
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

function getReadyTasks() {
  const rows = db.prepare(`
    SELECT a.* FROM actions a
    WHERE a.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM action_deps ad
      JOIN actions dep ON ad.depends_on = dep.id
      WHERE ad.action_id = a.id AND dep.status != 'done'
    )
    ORDER BY CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, a.due_date ASC
  `).all();

  if (rows.length === 0) return "No ready tasks (all pending items have unmet dependencies or none are pending).";

  return `${rows.length} task(s) ready to start (no blocking dependencies):\n\n` + formatTable(rows.map(r => ({
    ...r, pri: `${PRIORITY_EMOJI[r.priority] || ""} ${r.priority}`
  })), [
    { key: "id", label: "ID" }, { key: "assignee", label: "Assignee" },
    { key: "title", label: "Task" }, { key: "pri", label: "Priority" },
    { key: "category", label: "Category" }, { key: "due_date", label: "Due" },
  ]);
}

// --- Tools array ---
const tools = [
  {
    name: "add_task",
    description: "Create a new family task/action item. Tracks chores, errands, appointments, and to-dos for the Rocha family.",
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
        status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"], description: "Filter by status" },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "Filter by priority" },
        category: { type: "string", description: "Filter by category" },
        location: { type: "string", description: "Filter by location" },
        due_date_before: { type: "string", description: "Tasks due on or before this date (YYYY-MM-DD)" },
        due_date_after: { type: "string", description: "Tasks due on or after this date (YYYY-MM-DD)" },
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
        status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"], description: "New status" },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "New priority" },
        assignee: { type: "string", description: "New assignee" },
        due_date: { type: "string", description: "New due date (YYYY-MM-DD)" },
        notes: { type: "string", description: "New notes" },
        title: { type: "string", description: "New title" },
        category: { type: "string", description: "New category" },
        recurrence: { type: "string", description: "New recurrence pattern" },
        location: { type: "string", description: "New location" },
      },
      required: ["id"],
    },
    handler: async (args) => updateTask(args),
  },
  {
    name: "complete_task",
    description: "Mark a family task as done. If the task recurs, automatically creates the next occurrence.",
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
    description: "Dashboard overview: totals by status, priority, assignee, category, overdue count, and due this week.",
    parameters: { type: "object", properties: {} },
    handler: async () => taskSummary(),
  },
  {
    name: "ready_tasks",
    description: "Show tasks ready to start: pending with all dependencies met (no unfinished blockers).",
    parameters: { type: "object", properties: {} },
    handler: async () => getReadyTasks(),
  },
];

// --- Session ---
const session = await joinSession({
  tools,
  hooks: {
    onSessionStart: async () => {
      const total = db.prepare("SELECT COUNT(*) as c FROM actions").get().c;
      const open = db.prepare("SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done')").get().c;
      const overdue = db.prepare("SELECT COUNT(*) as c FROM actions WHERE status NOT IN ('done','blocked') AND due_date != '' AND due_date < date('now')").get().c;
      return {
        additionalContext:
          `[action-tracker] \uD83D\uDCCB Family task tracker loaded. ${total} total items, ${open} open, ${overdue} overdue.\n` +
          `Tools: add_task, list_tasks, update_task, complete_task, delete_task, task_summary, ready_tasks.\n` +
          `Database: data/action-tracker.db (persisted in repo).`,
      };
    },
  },
});
