import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
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
const DB_DIR = resolve(REPO_ROOT, "data", "budget");
const DB_PATH = resolve(DB_DIR, "budget.db");

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT DEFAULT '',
    who TEXT DEFAULT '',
    date TEXT DEFAULT (date('now')),
    recurring INTEGER DEFAULT 0,
    recurrence_period TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS budgets (
    category TEXT NOT NULL,
    month TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (category, month)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS recurring_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    due_day INTEGER NOT NULL,
    frequency TEXT DEFAULT 'monthly',
    auto_pay INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1
  )
`);

// ---------------------------------------------------------------------------
// Category validation
// ---------------------------------------------------------------------------
const EXPENSE_CATEGORIES = new Set([
  "housing",
  "utilities",
  "groceries",
  "dining",
  "transportation",
  "gas",
  "health",
  "insurance",
  "entertainment",
  "shopping",
  "kids",
  "baby",
  "subscriptions",
  "education",
  "savings",
  "giving",
  "other",
]);

const INCOME_CATEGORIES = new Set([
  "salary",
  "freelance",
  "refund",
  "gift",
  "other",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n) {
  return "$" + Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct(n) {
  return `${Math.round(n)}%`;
}

function budgetIcon(used) {
  if (used > 100) return "🔴";
  if (used > 80) return "🟡";
  return "🟢";
}

function validateExpenseCategory(cat) {
  const lower = cat.toLowerCase();
  if (!EXPENSE_CATEGORIES.has(lower)) {
    return `Invalid expense category "${cat}". Valid: ${[...EXPENSE_CATEGORIES].join(", ")}`;
  }
  return null;
}

function validateIncomeCategory(cat) {
  const lower = cat.toLowerCase();
  if (!INCOME_CATEGORIES.has(lower)) {
    return `Invalid income category "${cat}". Valid: ${[...INCOME_CATEGORIES].join(", ")}`;
  }
  return null;
}

function validateWho(who) {
  const lower = (who || "").toLowerCase();
  if (lower && !["hector", "paula", "shared"].includes(lower)) {
    return `Invalid "who" value "${who}". Valid: hector, paula, shared`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------
function addTransaction(type, amount, category, description, who, date) {
  const stmt = db.prepare(
    `INSERT INTO transactions (type, amount, category, description, who, date)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(type, amount, category.toLowerCase(), description || "", (who || "").toLowerCase(), date || todayISO());
  const last = db.prepare("SELECT last_insert_rowid() AS id").get();
  return last.id;
}

function getMonthSummary(month) {
  const prefix = month || currentMonth();

  const expenses = db
    .prepare(
      `SELECT category, SUM(amount) AS total
       FROM transactions
       WHERE type = 'expense' AND date LIKE ? || '%'
       GROUP BY category
       ORDER BY total DESC`,
    )
    .all(prefix);

  const totalExpense = expenses.reduce((s, r) => s + r.total, 0);

  const incomes = db
    .prepare(
      `SELECT category, SUM(amount) AS total
       FROM transactions
       WHERE type = 'income' AND date LIKE ? || '%'
       GROUP BY category
       ORDER BY total DESC`,
    )
    .all(prefix);

  const totalIncome = incomes.reduce((s, r) => s + r.total, 0);

  return { expenses, totalExpense, incomes, totalIncome, net: totalIncome - totalExpense };
}

function getBudgets(month) {
  const m = month || currentMonth();
  return db.prepare("SELECT category, amount FROM budgets WHERE month = ? ORDER BY amount DESC").all(m);
}

function setBudget(category, amount, month) {
  const m = month || currentMonth();
  db.prepare(
    `INSERT INTO budgets (category, month, amount)
     VALUES (?, ?, ?)
     ON CONFLICT(category, month) DO UPDATE SET amount = excluded.amount`,
  ).run(category.toLowerCase(), m, amount);
}

function getActualByCategory(month) {
  const prefix = month || currentMonth();
  const rows = db
    .prepare(
      `SELECT category, SUM(amount) AS total
       FROM transactions
       WHERE type = 'expense' AND date LIKE ? || '%'
       GROUP BY category`,
    )
    .all(prefix);
  const map = {};
  for (const r of rows) map[r.category] = r.total;
  return map;
}

function addRecurringBill(name, amount, category, dueDay, frequency, autoPay) {
  const stmt = db.prepare(
    `INSERT INTO recurring_bills (name, amount, category, due_day, frequency, auto_pay)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(name, amount, category.toLowerCase(), dueDay, frequency || "monthly", autoPay ? 1 : 0);
  const last = db.prepare("SELECT last_insert_rowid() AS id").get();
  return last.id;
}

function getUpcomingBills(days) {
  const today = new Date();
  const currentDay = today.getDate();
  const currentYear = today.getFullYear();
  const currentMonthIdx = today.getMonth();

  const bills = db
    .prepare("SELECT * FROM recurring_bills WHERE active = 1 ORDER BY due_day")
    .all();

  const upcoming = [];

  for (const bill of bills) {
    // For monthly bills, check current and next month
    if (bill.frequency === "monthly") {
      for (let offset = 0; offset <= 1; offset++) {
        const targetMonth = currentMonthIdx + offset;
        const targetYear = currentYear + Math.floor(targetMonth / 12);
        const targetMonthNorm = targetMonth % 12;

        const daysInMonth = new Date(targetYear, targetMonthNorm + 1, 0).getDate();
        const effectiveDay = Math.min(bill.due_day, daysInMonth);
        const dueDate = new Date(targetYear, targetMonthNorm, effectiveDay);

        const diffMs = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= days) {
          upcoming.push({
            ...bill,
            due_date: dueDate.toISOString().slice(0, 10),
            days_until: diffDays,
          });
        }
      }
    } else if (bill.frequency === "quarterly") {
      // Check next 3 months
      for (let offset = 0; offset <= 3; offset++) {
        const targetMonth = currentMonthIdx + offset;
        const targetYear = currentYear + Math.floor(targetMonth / 12);
        const targetMonthNorm = targetMonth % 12;

        if (targetMonthNorm % 3 !== 0) continue;

        const daysInMonth = new Date(targetYear, targetMonthNorm + 1, 0).getDate();
        const effectiveDay = Math.min(bill.due_day, daysInMonth);
        const dueDate = new Date(targetYear, targetMonthNorm, effectiveDay);

        const diffMs = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= days) {
          upcoming.push({
            ...bill,
            due_date: dueDate.toISOString().slice(0, 10),
            days_until: diffDays,
          });
        }
      }
    } else if (bill.frequency === "yearly") {
      for (let yearOff = 0; yearOff <= 1; yearOff++) {
        const targetYear = currentYear + yearOff;
        const daysInMonth = new Date(targetYear, currentMonthIdx + 1, 0).getDate();
        const effectiveDay = Math.min(bill.due_day, daysInMonth);
        const dueDate = new Date(targetYear, currentMonthIdx, effectiveDay);

        const diffMs = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= days) {
          upcoming.push({
            ...bill,
            due_date: dueDate.toISOString().slice(0, 10),
            days_until: diffDays,
          });
        }
      }
    }
  }

  upcoming.sort((a, b) => a.days_until - b.days_until);
  return upcoming;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatSummary(month) {
  const m = month || currentMonth();
  const { expenses, totalExpense, incomes, totalIncome, net } = getMonthSummary(m);

  const lines = [`## 📊 Budget Summary — ${m}\n`];

  if (incomes.length > 0) {
    lines.push("### 💰 Income");
    lines.push("| Category | Amount | % of Total |");
    lines.push("|----------|-------:|----------:|");
    for (const r of incomes) {
      const p = totalIncome > 0 ? (r.total / totalIncome) * 100 : 0;
      lines.push(`| ${r.category} | ${fmt(r.total)} | ${pct(p)} |`);
    }
    lines.push(`| **Total** | **${fmt(totalIncome)}** | |`);
    lines.push("");
  }

  if (expenses.length > 0) {
    lines.push("### 💸 Expenses");
    lines.push("| Category | Amount | % of Total |");
    lines.push("|----------|-------:|----------:|");
    for (const r of expenses) {
      const p = totalExpense > 0 ? (r.total / totalExpense) * 100 : 0;
      lines.push(`| ${r.category} | ${fmt(r.total)} | ${pct(p)} |`);
    }
    lines.push(`| **Total** | **${fmt(totalExpense)}** | |`);
    lines.push("");
  }

  if (expenses.length === 0 && incomes.length === 0) {
    lines.push("_No transactions recorded for this month._\n");
  }

  const netIcon = net >= 0 ? "🟢" : "🔴";
  lines.push(`### Net: ${netIcon} ${fmt(net)}`);

  return lines.join("\n");
}

function formatBudgetVsActual(month) {
  const m = month || currentMonth();
  const budgets = getBudgets(m);

  if (budgets.length === 0) {
    return `## Budget vs Actual — ${m}\n\n_No budgets set for this month._ Use \`set_budget\` to create one.`;
  }

  const actual = getActualByCategory(m);

  const lines = [`## 📋 Budget vs Actual — ${m}\n`];
  lines.push("| Status | Category | Budget | Actual | Remaining | % Used |");
  lines.push("|:------:|----------|-------:|-------:|----------:|-------:|");

  let totalBudget = 0;
  let totalActual = 0;

  for (const b of budgets) {
    const spent = actual[b.category] || 0;
    const remaining = b.amount - spent;
    const usedPct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
    const icon = budgetIcon(usedPct);

    totalBudget += b.amount;
    totalActual += spent;

    lines.push(
      `| ${icon} | ${b.category} | ${fmt(b.amount)} | ${fmt(spent)} | ${fmt(remaining)} | ${pct(usedPct)} |`,
    );
  }

  const totalRemaining = totalBudget - totalActual;
  const totalUsedPct = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;
  const totalIcon = budgetIcon(totalUsedPct);

  lines.push(
    `| ${totalIcon} | **TOTAL** | **${fmt(totalBudget)}** | **${fmt(totalActual)}** | **${fmt(totalRemaining)}** | **${pct(totalUsedPct)}** |`,
  );

  return lines.join("\n");
}

function formatUpcomingBills(days) {
  const bills = getUpcomingBills(days);

  if (bills.length === 0) {
    return `## 📅 Upcoming Bills (next ${days} days)\n\n_No bills due in the next ${days} days._ 🎉`;
  }

  const total = bills.reduce((s, b) => s + b.amount, 0);

  const lines = [`## 📅 Upcoming Bills — next ${days} days\n`];
  lines.push("| Due Date | Days | Name | Amount | Category | Auto-Pay |");
  lines.push("|----------|-----:|------|-------:|----------|:--------:|");

  for (const b of bills) {
    const apIcon = b.auto_pay ? "✅" : "❌";
    const urgency = b.days_until <= 3 ? " ⚠️" : "";
    lines.push(
      `| ${b.due_date}${urgency} | ${b.days_until} | ${b.name} | ${fmt(b.amount)} | ${b.category} | ${apIcon} |`,
    );
  }

  lines.push(`\n**Total due:** ${fmt(total)}`);

  return lines.join("\n");
}

function sessionStartSummary() {
  const m = currentMonth();
  const { totalExpense, totalIncome, net } = getMonthSummary(m);
  const budgets = getBudgets(m);
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);

  const lines = [`💰 **Rocha Family Budget — ${m}**`];

  if (totalBudget > 0) {
    const usedPct = (totalExpense / totalBudget) * 100;
    const icon = budgetIcon(usedPct);
    lines.push(`${icon} Spent ${fmt(totalExpense)} of ${fmt(totalBudget)} budget (${pct(usedPct)})`);
  } else {
    lines.push(`💸 Spent: ${fmt(totalExpense)}`);
  }

  lines.push(`💰 Income: ${fmt(totalIncome)}`);
  const netIcon = net >= 0 ? "🟢" : "🔴";
  lines.push(`${netIcon} Net: ${fmt(net)}`);

  const upcoming = getUpcomingBills(7);
  if (upcoming.length > 0) {
    const upTotal = upcoming.reduce((s, b) => s + b.amount, 0);
    lines.push(`📅 ${upcoming.length} bill(s) due within 7 days (${fmt(upTotal)})`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Join session — tools + hooks
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext:
        "[budget-tracker] Family finance tracker active.\n" +
        sessionStartSummary(),
    }),
  },
  tools: [
    // -----------------------------------------------------------------------
    // 1. add_expense
    // -----------------------------------------------------------------------
    {
      name: "add_expense",
      description:
        "Log a family expense. Categories: housing, utilities, groceries, dining, transportation, gas, health, insurance, entertainment, shopping, kids, baby, subscriptions, education, savings, giving, other.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Expense amount in dollars" },
          category: { type: "string", description: "Expense category" },
          description: { type: "string", description: "What was purchased" },
          who: {
            type: "string",
            description: "Who spent it: hector, paula, or shared",
          },
          date: {
            type: "string",
            description: "Date (YYYY-MM-DD). Defaults to today.",
          },
        },
        required: ["amount", "category"],
      },
      handler: async (args) => {
        const catErr = validateExpenseCategory(args.category);
        if (catErr) return catErr;
        const whoErr = validateWho(args.who);
        if (whoErr) return whoErr;
        if (args.amount <= 0) return "Amount must be positive.";

        const id = addTransaction(
          "expense",
          args.amount,
          args.category,
          args.description,
          args.who,
          args.date,
        );

        const who = args.who ? ` (${args.who})` : "";
        const desc = args.description ? ` — ${args.description}` : "";
        return (
          `💸 Expense #${id} recorded: ${fmt(args.amount)} in **${args.category.toLowerCase()}**${desc}${who} on ${args.date || todayISO()}`
        );
      },
    },

    // -----------------------------------------------------------------------
    // 2. add_income
    // -----------------------------------------------------------------------
    {
      name: "add_income",
      description:
        "Log family income. Categories: salary, freelance, refund, gift, other.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Income amount in dollars" },
          category: { type: "string", description: "Income category" },
          description: { type: "string", description: "Source or note" },
          who: {
            type: "string",
            description: "Who earned it: hector, paula, or shared",
          },
          date: {
            type: "string",
            description: "Date (YYYY-MM-DD). Defaults to today.",
          },
        },
        required: ["amount", "category"],
      },
      handler: async (args) => {
        const catErr = validateIncomeCategory(args.category);
        if (catErr) return catErr;
        const whoErr = validateWho(args.who);
        if (whoErr) return whoErr;
        if (args.amount <= 0) return "Amount must be positive.";

        const id = addTransaction(
          "income",
          args.amount,
          args.category,
          args.description,
          args.who,
          args.date,
        );

        const who = args.who ? ` (${args.who})` : "";
        const desc = args.description ? ` — ${args.description}` : "";
        return (
          `💰 Income #${id} recorded: ${fmt(args.amount)} in **${args.category.toLowerCase()}**${desc}${who} on ${args.date || todayISO()}`
        );
      },
    },

    // -----------------------------------------------------------------------
    // 3. budget_summary
    // -----------------------------------------------------------------------
    {
      name: "budget_summary",
      description:
        "Month-to-date spending summary with income, expenses by category, and net balance.",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Month as YYYY-MM. Defaults to current month.",
          },
        },
        required: [],
      },
      handler: async (args) => formatSummary(args.month),
    },

    // -----------------------------------------------------------------------
    // 4. set_budget
    // -----------------------------------------------------------------------
    {
      name: "set_budget",
      description: "Set or update a monthly budget target for a spending category.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Expense category" },
          amount: {
            type: "number",
            description: "Monthly budget amount in dollars",
          },
          month: {
            type: "string",
            description: "Month as YYYY-MM. Defaults to current month.",
          },
        },
        required: ["category", "amount"],
      },
      handler: async (args) => {
        const catErr = validateExpenseCategory(args.category);
        if (catErr) return catErr;
        if (args.amount <= 0) return "Budget amount must be positive.";

        const m = args.month || currentMonth();
        setBudget(args.category, args.amount, m);
        return `✅ Budget set: **${args.category.toLowerCase()}** → ${fmt(args.amount)}/month for ${m}`;
      },
    },

    // -----------------------------------------------------------------------
    // 5. budget_vs_actual
    // -----------------------------------------------------------------------
    {
      name: "budget_vs_actual",
      description:
        "Compare actual spending against budgets for the month. Shows status indicators: 🟢 under, 🟡 near (>80%), 🔴 over budget.",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Month as YYYY-MM. Defaults to current month.",
          },
        },
        required: [],
      },
      handler: async (args) => formatBudgetVsActual(args.month),
    },

    // -----------------------------------------------------------------------
    // 6. add_recurring_bill
    // -----------------------------------------------------------------------
    {
      name: "add_recurring_bill",
      description:
        "Register a recurring bill (rent, utilities, subscriptions, etc.).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Bill name (e.g., Rent, Netflix)" },
          amount: { type: "number", description: "Bill amount in dollars" },
          category: { type: "string", description: "Expense category" },
          due_day: {
            type: "number",
            description: "Day of month bill is due (1-31)",
          },
          frequency: {
            type: "string",
            description: "How often: monthly, quarterly, or yearly. Default: monthly.",
          },
          auto_pay: {
            type: "boolean",
            description: "Is this bill on auto-pay? Default: false.",
          },
        },
        required: ["name", "amount", "category", "due_day"],
      },
      handler: async (args) => {
        const catErr = validateExpenseCategory(args.category);
        if (catErr) return catErr;
        if (args.amount <= 0) return "Amount must be positive.";
        if (args.due_day < 1 || args.due_day > 31) return "due_day must be between 1 and 31.";

        const freq = args.frequency || "monthly";
        if (!["monthly", "quarterly", "yearly"].includes(freq)) {
          return `Invalid frequency "${freq}". Valid: monthly, quarterly, yearly.`;
        }

        const id = addRecurringBill(
          args.name,
          args.amount,
          args.category,
          args.due_day,
          freq,
          args.auto_pay || false,
        );

        const apLabel = args.auto_pay ? " (auto-pay ✅)" : "";
        return (
          `📋 Recurring bill #${id} added: **${args.name}** — ${fmt(args.amount)} ${freq} on day ${args.due_day}${apLabel}`
        );
      },
    },

    // -----------------------------------------------------------------------
    // 7. upcoming_bills
    // -----------------------------------------------------------------------
    {
      name: "upcoming_bills",
      description: "Show recurring bills due within the next N days.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Look-ahead window in days. Default: 14.",
          },
        },
        required: [],
      },
      handler: async (args) => {
        const days = args.days && args.days > 0 ? args.days : 14;
        return formatUpcomingBills(days);
      },
    },
  ],
});
