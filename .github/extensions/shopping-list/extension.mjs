import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const REPO_ROOT = resolve(
  dirname(import.meta.url.replace("file:///", "")),
  "..",
  "..",
  "..",
);
const DATA_DIR = resolve(REPO_ROOT, "data", "shopping-lists");
const DB_PATH = resolve(DATA_DIR, "shopping.db");

// ---------------------------------------------------------------------------
// Database bootstrap
// ---------------------------------------------------------------------------
function openDb() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS shopping_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item TEXT NOT NULL,
      quantity TEXT DEFAULT '1',
      unit TEXT DEFAULT '',
      category TEXT DEFAULT 'other',
      store TEXT DEFAULT '',
      added_by TEXT DEFAULT '',
      checked_off INTEGER DEFAULT 0,
      list_id TEXT DEFAULT 'current',
      created_at TEXT DEFAULT (datetime('now')),
      checked_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS shopping_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT ''
    );
  `);

  // Ensure the "current" list always exists
  const current = db
    .prepare("SELECT id FROM shopping_lists WHERE id = 'current'")
    .get();
  if (!current) {
    db.prepare(
      "INSERT INTO shopping_lists (id, name, status) VALUES ('current', 'Current List', 'active')",
    ).run();
  }

  return db;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const VALID_CATEGORIES = new Set([
  "produce",
  "dairy",
  "meat",
  "bakery",
  "pantry",
  "frozen",
  "beverages",
  "snacks",
  "household",
  "personal_care",
  "pharmacy",
  "baby",
  "pet",
  "other",
]);

const CATEGORY_EMOJI = {
  produce: "🥬",
  dairy: "🥛",
  meat: "🥩",
  bakery: "🍞",
  pantry: "🥫",
  frozen: "🧊",
  beverages: "🥤",
  snacks: "🍿",
  household: "🏠",
  personal_care: "🧴",
  pharmacy: "💊",
  baby: "👶",
  pet: "🐾",
  other: "📦",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeCategory(raw) {
  if (!raw) return "other";
  const lower = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return VALID_CATEGORIES.has(lower) ? lower : "other";
}

function formatQty(quantity, unit) {
  const q = (quantity || "1").toString().trim();
  const u = (unit || "").trim();
  return u ? `${q} ${u}` : q;
}

function formatItem(row) {
  const check = row.checked_off ? "☑" : "☐";
  const qty = formatQty(row.quantity, row.unit);
  const store = row.store ? ` @ ${row.store}` : "";
  return `  ${check} ${row.item} (${qty})${store}  [id:${row.id}]`;
}

function groupBy(rows, key) {
  const groups = {};
  for (const row of rows) {
    const k = row[key] || "other";
    if (!groups[k]) groups[k] = [];
    groups[k].push(row);
  }
  return groups;
}

function currentItemCount(db) {
  const row = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM shopping_items WHERE list_id = 'current'",
    )
    .get();
  return row?.cnt ?? 0;
}

function uncheckedCount(db) {
  const row = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM shopping_items WHERE list_id = 'current' AND checked_off = 0",
    )
    .get();
  return row?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function addToShoppingList(db, args) {
  const rawItems = (args.items || "").toString().trim();
  if (!rawItems) return "❌ No items provided. Pass a comma-separated list of items to add.";

  const names = rawItems
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return "❌ No valid item names found after parsing.";

  const category = normalizeCategory(args.category);
  const quantity = (args.quantity || "1").toString().trim();
  const unit = (args.unit || "").toString().trim();
  const store = (args.store || "").toString().trim();
  const addedBy = (args.added_by || "").toString().trim();

  const stmt = db.prepare(`
    INSERT INTO shopping_items (item, quantity, unit, category, store, added_by, list_id)
    VALUES (?, ?, ?, ?, ?, ?, 'current')
  `);

  const added = [];
  for (const name of names) {
    stmt.run(name, quantity, unit, category, store, addedBy);
    added.push(name);
  }

  const total = currentItemCount(db);
  const plural = added.length === 1 ? "item" : "items";
  const listing = added.map((n) => `  • ${n}`).join("\n");

  return (
    `✅ Added ${added.length} ${plural} to the shopping list:\n${listing}\n\n` +
    `📋 List now has ${total} total items.`
  );
}

function viewShoppingList(db, args) {
  const storeFilter = (args.store || "").toString().trim();
  const groupByField = (args.group_by || "category").toString().trim();

  let sql =
    "SELECT * FROM shopping_items WHERE list_id = 'current'";
  const params = [];

  if (storeFilter) {
    sql += " AND store LIKE ?";
    params.push(`%${storeFilter}%`);
  }

  sql += " ORDER BY checked_off ASC, category ASC, item ASC";

  const rows = db.prepare(sql).all(...params);
  if (rows.length === 0) return "🛒 Shopping list is empty. Add items with `add_to_shopping_list`.";

  const total = rows.length;
  const checked = rows.filter((r) => r.checked_off).length;
  const unchecked = total - checked;

  let output = `🛒 Shopping List (${total} items — ${unchecked} remaining, ${checked} checked off)\n`;

  if (groupByField === "store") {
    const groups = groupBy(rows, "store");
    for (const [storeName, items] of Object.entries(groups).sort()) {
      const label = storeName || "No store specified";
      output += `\n🏪 ${label}\n`;
      for (const row of items) output += formatItem(row) + "\n";
    }
  } else {
    const groups = groupBy(rows, "category");
    const order = [...VALID_CATEGORIES];
    for (const cat of order) {
      if (!groups[cat]) continue;
      const emoji = CATEGORY_EMOJI[cat] || "📦";
      const label = cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      output += `\n${emoji} ${label}\n`;
      for (const row of groups[cat]) output += formatItem(row) + "\n";
    }
  }

  return output.trimEnd();
}

function checkOffItem(db, args) {
  const identifier = (args.item || args.id || "").toString().trim();
  if (!identifier) return "❌ Provide an item name or id to check off.";

  let rows;
  const asInt = Number(identifier);
  if (Number.isInteger(asInt) && asInt > 0) {
    rows = db
      .prepare(
        "SELECT * FROM shopping_items WHERE id = ? AND list_id = 'current' AND checked_off = 0",
      )
      .all(asInt);
  }

  if (!rows || rows.length === 0) {
    rows = db
      .prepare(
        "SELECT * FROM shopping_items WHERE list_id = 'current' AND checked_off = 0 AND item LIKE ?",
      )
      .all(`%${identifier}%`);
  }

  if (rows.length === 0) {
    return `❌ No unchecked item matching "${identifier}" found on the current list.`;
  }

  const stmt = db.prepare(
    "UPDATE shopping_items SET checked_off = 1, checked_at = datetime('now') WHERE id = ?",
  );
  const names = [];
  for (const row of rows) {
    stmt.run(row.id);
    names.push(row.item);
  }

  const remaining = uncheckedCount(db);
  const plural = names.length === 1 ? "item" : "items";
  return (
    `☑ Checked off ${names.length} ${plural}:\n` +
    names.map((n) => `  ✓ ${n}`).join("\n") +
    `\n\n${remaining} items remaining.`
  );
}

function removeFromList(db, args) {
  const identifier = (args.item || args.id || "").toString().trim();
  if (!identifier) return "❌ Provide an item name or id to remove.";

  let rows;
  const asInt = Number(identifier);
  if (Number.isInteger(asInt) && asInt > 0) {
    rows = db
      .prepare("SELECT * FROM shopping_items WHERE id = ? AND list_id = 'current'")
      .all(asInt);
  }

  if (!rows || rows.length === 0) {
    rows = db
      .prepare(
        "SELECT * FROM shopping_items WHERE list_id = 'current' AND item LIKE ?",
      )
      .all(`%${identifier}%`);
  }

  if (rows.length === 0) {
    return `❌ No item matching "${identifier}" found on the current list.`;
  }

  const stmt = db.prepare("DELETE FROM shopping_items WHERE id = ?");
  const names = [];
  for (const row of rows) {
    stmt.run(row.id);
    names.push(row.item);
  }

  const total = currentItemCount(db);
  const plural = names.length === 1 ? "item" : "items";
  return (
    `🗑️ Removed ${names.length} ${plural}:\n` +
    names.map((n) => `  • ${n}`).join("\n") +
    `\n\n📋 ${total} items remaining on the list.`
  );
}

function clearShoppingList(db) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const archiveId = `list-${Date.now()}`;

  const items = db
    .prepare("SELECT * FROM shopping_items WHERE list_id = 'current'")
    .all();
  const total = items.length;
  const checked = items.filter((r) => r.checked_off).length;

  if (total === 0) return "🛒 Shopping list is already empty — nothing to archive.";

  // Archive items under a new list id
  db.prepare(
    "INSERT INTO shopping_lists (id, name, status, completed_at) VALUES (?, ?, 'completed', ?)",
  ).run(archiveId, `Archived ${ts}`, ts);

  db.prepare(
    "UPDATE shopping_items SET list_id = ? WHERE list_id = 'current'",
  ).run(archiveId);

  return (
    `📦 Archived current list as "${archiveId}":\n` +
    `  • ${total} total items (${checked} were checked off)\n\n` +
    `🛒 New empty shopping list is ready.`
  );
}

function shoppingHistory(db, args) {
  const days = Math.max(1, Number(args.days) || 30);
  const since = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  const rows = db
    .prepare(
      `SELECT * FROM shopping_items
       WHERE checked_off = 1 AND checked_at >= ?
       ORDER BY checked_at DESC`,
    )
    .all(since);

  if (rows.length === 0) {
    return `📜 No purchases recorded in the last ${days} days.`;
  }

  // Group by date
  const byDate = {};
  for (const row of rows) {
    const dateKey = (row.checked_at || row.created_at || "unknown").slice(0, 10);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(row);
  }

  let output = `📜 Purchase History (last ${days} days — ${rows.length} items)\n`;

  for (const [date, items] of Object.entries(byDate).sort().reverse()) {
    output += `\n📅 ${date}\n`;
    for (const row of items) {
      const qty = formatQty(row.quantity, row.unit);
      const cat = row.category !== "other" ? ` [${row.category}]` : "";
      const store = row.store ? ` @ ${row.store}` : "";
      output += `  ✓ ${row.item} (${qty})${cat}${store}\n`;
    }
  }

  // Frequency analysis for recurring suggestions
  const freq = {};
  for (const row of rows) {
    const key = row.item.toLowerCase();
    freq[key] = (freq[key] || 0) + 1;
  }

  const recurring = Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (recurring.length > 0) {
    output += "\n🔄 Frequently purchased (consider adding to next list):\n";
    for (const [name, count] of recurring) {
      output += `  • ${name} (${count}x)\n`;
    }
  }

  return output.trimEnd();
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
const db = openDb();

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const total = currentItemCount(db);
      const remaining = uncheckedCount(db);
      const msg =
        total === 0
          ? "🛒 Shopping list is empty — add items with `add_to_shopping_list`."
          : `🛒 Shopping list has ${total} items (${remaining} still to buy).`;
      return { additionalContext: `[shopping-list] ${msg}` };
    },
  },

  tools: [
    {
      name: "add_to_shopping_list",
      description:
        "Add item(s) to the family shopping list. Accepts comma-separated items (e.g. 'milk, eggs, bread'). " +
        "Categories: produce, dairy, meat, bakery, pantry, frozen, beverages, snacks, household, personal_care, pharmacy, baby, pet, other.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "string",
            description:
              "Item name(s) to add. Comma-separated for multiple (e.g. 'milk, eggs, bread').",
          },
          quantity: {
            type: "string",
            description: "Quantity (default '1'). Examples: '2', '1', '6'.",
          },
          unit: {
            type: "string",
            description:
              "Unit of measure (optional). Examples: 'gallon', 'lb', 'bag', 'bunch', 'box'.",
          },
          category: {
            type: "string",
            description:
              "Category: produce, dairy, meat, bakery, pantry, frozen, beverages, snacks, household, personal_care, pharmacy, baby, pet, other.",
          },
          store: {
            type: "string",
            description: "Preferred store (optional). Examples: 'Costco', 'H-E-B', 'Target'.",
          },
          added_by: {
            type: "string",
            description: "Who added this item (optional).",
          },
        },
        required: ["items"],
      },
      handler: async (args) => addToShoppingList(db, args),
    },
    {
      name: "shopping_list",
      description:
        "View the current family shopping list. Items are grouped by category or store with checkboxes showing purchase status.",
      parameters: {
        type: "object",
        properties: {
          group_by: {
            type: "string",
            description:
              "How to group items: 'category' (default) or 'store'.",
          },
          store: {
            type: "string",
            description: "Filter to a specific store (optional).",
          },
        },
        required: [],
      },
      handler: async (args) => viewShoppingList(db, args),
    },
    {
      name: "check_off_item",
      description:
        "Mark item(s) as purchased / checked off. Supports partial name matching or item id.",
      parameters: {
        type: "object",
        properties: {
          item: {
            type: "string",
            description:
              "Item name (partial match) or numeric id to check off.",
          },
        },
        required: ["item"],
      },
      handler: async (args) => checkOffItem(db, args),
    },
    {
      name: "remove_from_list",
      description:
        "Remove item(s) from the shopping list entirely. Supports partial name matching or item id.",
      parameters: {
        type: "object",
        properties: {
          item: {
            type: "string",
            description:
              "Item name (partial match) or numeric id to remove.",
          },
        },
        required: ["item"],
      },
      handler: async (args) => removeFromList(db, args),
    },
    {
      name: "clear_shopping_list",
      description:
        "Archive the current shopping list and start a fresh empty one. The old list is preserved in history.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: async () => clearShoppingList(db),
    },
    {
      name: "shopping_history",
      description:
        "Show recent purchase history. Useful for remembering recurring items and suggesting what to buy next.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description:
              "How many days of history to show (default 30).",
          },
        },
        required: [],
      },
      handler: async (args) => shoppingHistory(db, args),
    },
  ],
});
