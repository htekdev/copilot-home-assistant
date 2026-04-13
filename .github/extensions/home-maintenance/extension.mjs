import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { joinSession } from "@github/copilot-sdk/extension";

const REPO_ROOT = resolve(
  dirname(import.meta.url.replace("file:///", "")),
  "..",
  "..",
  ".."
);

const SCHEDULE_PATH = resolve(REPO_ROOT, "data", "home", "maintenance-schedule.json");
const PROVIDERS_PATH = resolve(REPO_ROOT, "data", "home", "service-providers.json");
const LOG_PATH = resolve(REPO_ROOT, "data", "home", "maintenance-log.json");

const VALID_AREAS = [
  "HVAC",
  "plumbing",
  "electrical",
  "roof",
  "yard",
  "appliance",
  "general",
];

const VALID_PROVIDER_TYPES = [
  "plumber",
  "electrician",
  "hvac",
  "roofer",
  "landscaper",
  "handyman",
  "pest_control",
  "cleaning",
  "appliance_repair",
  "other",
];

const VALID_PRIORITIES = ["low", "medium", "high"];

// ── Helper functions ──────────────────────────────────────────────────────────

async function loadJson(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveJson(filePath, data) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA + "T00:00:00");
  const b = new Date(dateB + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function addMaintenanceTask(args) {
  const { task, area, frequency_months, last_done, notes, priority } = args;

  if (!task || typeof task !== "string") {
    return { error: "Parameter 'task' is required." };
  }
  if (!area || !VALID_AREAS.includes(area)) {
    return { error: `Parameter 'area' must be one of: ${VALID_AREAS.join(", ")}` };
  }
  const freq = Number(frequency_months);
  if (!freq || freq < 1 || freq > 120) {
    return { error: "Parameter 'frequency_months' must be a number between 1 and 120." };
  }
  const effectivePriority = priority || "medium";
  if (!VALID_PRIORITIES.includes(effectivePriority)) {
    return { error: `Parameter 'priority' must be one of: ${VALID_PRIORITIES.join(", ")}` };
  }
  const effectiveLastDone = last_done || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveLastDone)) {
    return { error: "Parameter 'last_done' must be in YYYY-MM-DD format." };
  }

  const schedule = await loadJson(SCHEDULE_PATH);
  const id = slugify(task);

  if (schedule.some((t) => t.id === id)) {
    return { error: `A maintenance task with id '${id}' already exists.` };
  }

  const nextDue = addMonths(effectiveLastDone, freq);

  const entry = {
    id,
    task,
    area,
    frequency_months: freq,
    last_done: effectiveLastDone,
    next_due: nextDue,
    notes: notes || "",
    priority: effectivePriority,
  };

  schedule.push(entry);
  await saveJson(SCHEDULE_PATH, schedule);

  return {
    message: `✅ Maintenance task added: "${task}"`,
    task: entry,
  };
}

async function maintenanceDue(args) {
  const withinDays = Number(args.within_days) || 30;
  const schedule = await loadJson(SCHEDULE_PATH);
  const today = todayStr();

  if (schedule.length === 0) {
    return { message: "No maintenance tasks found. Add some with add_maintenance_task." };
  }

  const items = schedule.map((item) => {
    const dueDate = item.next_due;
    const daysUntilDue = daysBetween(today, dueDate);
    let status;
    let icon;
    if (daysUntilDue < 0) {
      status = "overdue";
      icon = "🔴";
    } else if (daysUntilDue <= withinDays) {
      status = "due_soon";
      icon = "🟡";
    } else {
      status = "up_to_date";
      icon = "🟢";
    }
    return { ...item, days_until_due: daysUntilDue, status, icon };
  });

  // Sort: overdue first (most overdue at top), then due soon, then up to date
  items.sort((a, b) => a.days_until_due - b.days_until_due);

  const overdue = items.filter((i) => i.status === "overdue");
  const dueSoon = items.filter((i) => i.status === "due_soon");
  const upToDate = items.filter((i) => i.status === "up_to_date");

  const lines = [];
  lines.push(`📋 Maintenance Status (within ${withinDays} days)\n`);

  if (overdue.length > 0) {
    lines.push(`🔴 OVERDUE (${overdue.length}):`);
    for (const item of overdue) {
      lines.push(
        `  ${item.icon} ${item.task} — ${Math.abs(item.days_until_due)} days overdue (due ${item.next_due}) [${item.priority}]`
      );
    }
    lines.push("");
  }

  if (dueSoon.length > 0) {
    lines.push(`🟡 DUE SOON (${dueSoon.length}):`);
    for (const item of dueSoon) {
      const label = item.days_until_due === 0 ? "due today" : `in ${item.days_until_due} days`;
      lines.push(
        `  ${item.icon} ${item.task} — ${label} (due ${item.next_due}) [${item.priority}]`
      );
    }
    lines.push("");
  }

  if (upToDate.length > 0) {
    lines.push(`🟢 UP TO DATE (${upToDate.length}):`);
    for (const item of upToDate) {
      lines.push(
        `  ${item.icon} ${item.task} — in ${item.days_until_due} days (due ${item.next_due}) [${item.priority}]`
      );
    }
  }

  return {
    summary: lines.join("\n"),
    overdue_count: overdue.length,
    due_soon_count: dueSoon.length,
    up_to_date_count: upToDate.length,
    items,
  };
}

async function logMaintenance(args) {
  const { task_id, cost, provider, notes } = args;

  if (!task_id || typeof task_id !== "string") {
    return { error: "Parameter 'task_id' is required." };
  }

  const schedule = await loadJson(SCHEDULE_PATH);
  const taskIndex = schedule.findIndex((t) => t.id === task_id);

  if (taskIndex === -1) {
    const available = schedule.map((t) => `  - ${t.id}: ${t.task}`).join("\n");
    return {
      error: `Task '${task_id}' not found. Available tasks:\n${available || "  (none)"}`,
    };
  }

  const task = schedule[taskIndex];
  const completedDate = todayStr();

  // Update schedule
  task.last_done = completedDate;
  task.next_due = addMonths(completedDate, task.frequency_months);
  schedule[taskIndex] = task;
  await saveJson(SCHEDULE_PATH, schedule);

  // Append to log
  const log = await loadJson(LOG_PATH);
  const logEntry = {
    task_id,
    completed_date: completedDate,
    cost: cost != null ? Number(cost) : 0,
    provider: provider || "",
    notes: notes || "",
  };
  log.push(logEntry);
  await saveJson(LOG_PATH, log);

  return {
    message: `✅ Logged maintenance: "${task.task}"`,
    completed: completedDate,
    next_due: task.next_due,
    log_entry: logEntry,
  };
}

async function addServiceProvider(args) {
  const { name, type, phone, email, rating, notes } = args;

  if (!name || typeof name !== "string") {
    return { error: "Parameter 'name' is required." };
  }
  if (!type || !VALID_PROVIDER_TYPES.includes(type)) {
    return { error: `Parameter 'type' must be one of: ${VALID_PROVIDER_TYPES.join(", ")}` };
  }
  const effectiveRating = rating != null ? Number(rating) : 0;
  if (effectiveRating < 0 || effectiveRating > 5) {
    return { error: "Parameter 'rating' must be between 1 and 5 (or 0 for unrated)." };
  }

  const providers = await loadJson(PROVIDERS_PATH);
  const id = slugify(name);

  if (providers.some((p) => p.id === id)) {
    return { error: `A provider with id '${id}' already exists.` };
  }

  const entry = {
    id,
    name,
    type,
    phone: phone || "",
    email: email || "",
    rating: effectiveRating,
    notes: notes || "",
    last_used: "",
  };

  providers.push(entry);
  await saveJson(PROVIDERS_PATH, providers);

  return {
    message: `✅ Service provider added: "${name}" (${type})`,
    provider: entry,
  };
}

async function findProvider(args) {
  const { type, name } = args;

  if (!type && !name) {
    return { error: "Provide at least one of 'type' or 'name' to search." };
  }

  const providers = await loadJson(PROVIDERS_PATH);

  if (providers.length === 0) {
    return { message: "No service providers found. Add some with add_service_provider." };
  }

  const matches = providers.filter((p) => {
    const typeMatch = type ? p.type.toLowerCase() === type.toLowerCase() : true;
    const nameMatch = name
      ? p.name.toLowerCase().includes(name.toLowerCase())
      : true;
    return typeMatch && nameMatch;
  });

  if (matches.length === 0) {
    const criteria = [type && `type="${type}"`, name && `name contains "${name}"`]
      .filter(Boolean)
      .join(" and ");
    return { message: `No providers found matching ${criteria}.` };
  }

  const stars = (r) => (r > 0 ? "⭐".repeat(r) : "unrated");

  const lines = [`🔧 Service Providers (${matches.length} found):\n`];
  for (const p of matches) {
    lines.push(`  📞 ${p.name} (${p.type}) — ${stars(p.rating)}`);
    if (p.phone) lines.push(`     Phone: ${p.phone}`);
    if (p.email) lines.push(`     Email: ${p.email}`);
    if (p.notes) lines.push(`     Notes: ${p.notes}`);
    if (p.last_used) lines.push(`     Last used: ${p.last_used}`);
    lines.push("");
  }

  return {
    summary: lines.join("\n"),
    count: matches.length,
    providers: matches,
  };
}

async function maintenanceSummary() {
  const schedule = await loadJson(SCHEDULE_PATH);
  const providers = await loadJson(PROVIDERS_PATH);
  const log = await loadJson(LOG_PATH);
  const today = todayStr();

  const overdue = [];
  const upcoming = [];

  for (const item of schedule) {
    const daysUntilDue = daysBetween(today, item.next_due);
    if (daysUntilDue < 0) {
      overdue.push({ ...item, days_overdue: Math.abs(daysUntilDue) });
    } else if (daysUntilDue <= 30) {
      upcoming.push({ ...item, days_until_due: daysUntilDue });
    }
  }

  overdue.sort((a, b) => b.days_overdue - a.days_overdue);
  upcoming.sort((a, b) => a.days_until_due - b.days_until_due);

  const recentLog = log.slice(-5).reverse();

  const lines = [];
  lines.push("🏠 Home Maintenance Summary\n");
  lines.push(`  Total tasks: ${schedule.length}`);
  lines.push(`  Service providers: ${providers.length}`);
  lines.push(`  Total log entries: ${log.length}\n`);

  if (overdue.length > 0) {
    lines.push(`🔴 Overdue (${overdue.length}):`);
    for (const item of overdue) {
      lines.push(`  - ${item.task} — ${item.days_overdue} days overdue [${item.priority}]`);
    }
    lines.push("");
  } else {
    lines.push("🔴 Overdue: None ✨\n");
  }

  if (upcoming.length > 0) {
    lines.push(`🟡 Upcoming (next 30 days, ${upcoming.length}):`);
    for (const item of upcoming) {
      const label =
        item.days_until_due === 0 ? "due today" : `in ${item.days_until_due} days`;
      lines.push(`  - ${item.task} — ${label} [${item.priority}]`);
    }
    lines.push("");
  } else {
    lines.push("🟡 Upcoming (next 30 days): None\n");
  }

  if (recentLog.length > 0) {
    lines.push(`📝 Recent Maintenance Log:`);
    for (const entry of recentLog) {
      const costStr = entry.cost > 0 ? ` — $${entry.cost.toFixed(2)}` : "";
      const providerStr = entry.provider ? ` (${entry.provider})` : "";
      lines.push(`  - ${entry.task_id} on ${entry.completed_date}${costStr}${providerStr}`);
    }
  }

  return {
    summary: lines.join("\n"),
    total_tasks: schedule.length,
    overdue_count: overdue.length,
    upcoming_count: upcoming.length,
    provider_count: providers.length,
    log_count: log.length,
  };
}

// ── Extension session ─────────────────────────────────────────────────────────

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const schedule = await loadJson(SCHEDULE_PATH);
      const today = todayStr();

      let overdueCount = 0;
      let upcomingThisMonth = 0;

      for (const item of schedule) {
        const daysUntilDue = daysBetween(today, item.next_due);
        if (daysUntilDue < 0) overdueCount++;
        else if (daysUntilDue <= 30) upcomingThisMonth++;
      }

      const parts = ["[home-maintenance] 🏠 Home Maintenance extension active."];
      if (schedule.length === 0) {
        parts.push("No maintenance tasks configured yet.");
      } else {
        parts.push(`Tracking ${schedule.length} maintenance tasks.`);
        if (overdueCount > 0) {
          parts.push(`⚠️ ${overdueCount} task(s) are OVERDUE.`);
        }
        if (upcomingThisMonth > 0) {
          parts.push(`${upcomingThisMonth} task(s) due within 30 days.`);
        }
        if (overdueCount === 0 && upcomingThisMonth === 0) {
          parts.push("All tasks are up to date. ✨");
        }
      }

      return { additionalContext: parts.join(" ") };
    },
  },
  tools: [
    {
      name: "add_maintenance_task",
      description:
        "Add a recurring home maintenance task to the schedule. " +
        "Tracks when it was last done and calculates the next due date.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Name of the maintenance task (e.g. 'Replace HVAC filter')",
          },
          area: {
            type: "string",
            enum: VALID_AREAS,
            description: "Home area this task belongs to",
          },
          frequency_months: {
            type: "number",
            description: "How often this task should be done, in months (1-120)",
          },
          last_done: {
            type: "string",
            description:
              "Date the task was last completed (YYYY-MM-DD). Defaults to today if omitted.",
          },
          notes: {
            type: "string",
            description: "Optional notes (e.g. part numbers, instructions)",
          },
          priority: {
            type: "string",
            enum: VALID_PRIORITIES,
            description: "Task priority. Defaults to 'medium'.",
          },
        },
        required: ["task", "area", "frequency_months"],
      },
      handler: async (args) => JSON.stringify(await addMaintenanceTask(args)),
    },
    {
      name: "maintenance_due",
      description:
        "Show what home maintenance is due or overdue. " +
        "Returns tasks sorted by urgency with color-coded status indicators.",
      parameters: {
        type: "object",
        properties: {
          within_days: {
            type: "number",
            description:
              "Show tasks due within this many days (default: 30). Use a larger number to see further ahead.",
          },
        },
        required: [],
      },
      handler: async (args) => JSON.stringify(await maintenanceDue(args)),
    },
    {
      name: "log_maintenance",
      description:
        "Record that a maintenance task was completed today. " +
        "Updates the schedule with new last_done/next_due dates and appends to the maintenance log.",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description:
              "ID of the maintenance task (slug form, e.g. 'hvac-filter'). Use maintenance_due to see available IDs.",
          },
          cost: {
            type: "number",
            description: "Cost of the maintenance in dollars (optional)",
          },
          provider: {
            type: "string",
            description: "Name of the service provider who did the work (optional)",
          },
          notes: {
            type: "string",
            description: "Notes about this maintenance session (optional)",
          },
        },
        required: ["task_id"],
      },
      handler: async (args) => JSON.stringify(await logMaintenance(args)),
    },
    {
      name: "add_service_provider",
      description:
        "Save a home service provider's contact info and rating for future reference.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the service provider or company",
          },
          type: {
            type: "string",
            enum: VALID_PROVIDER_TYPES,
            description: "Type of service they provide",
          },
          phone: {
            type: "string",
            description: "Phone number (optional)",
          },
          email: {
            type: "string",
            description: "Email address (optional)",
          },
          rating: {
            type: "number",
            description: "Rating from 1-5 stars (optional, 0 = unrated)",
          },
          notes: {
            type: "string",
            description: "Notes about the provider (optional)",
          },
        },
        required: ["name", "type"],
      },
      handler: async (args) => JSON.stringify(await addServiceProvider(args)),
    },
    {
      name: "find_provider",
      description:
        "Search saved service providers by type or name. " +
        "Returns matching providers with contact info and ratings.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: VALID_PROVIDER_TYPES,
            description: "Filter by provider type (e.g. 'plumber', 'electrician')",
          },
          name: {
            type: "string",
            description: "Search by name (partial match, case-insensitive)",
          },
        },
        required: [],
      },
      handler: async (args) => JSON.stringify(await findProvider(args)),
    },
    {
      name: "maintenance_summary",
      description:
        "Get an overview of home maintenance: overdue/upcoming tasks, provider count, and recent log entries.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: async () => JSON.stringify(await maintenanceSummary()),
    },
  ],
});
