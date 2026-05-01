/**
 * Financial Connector Extension for GitHub Copilot CLI
 *
 * Bridges the agentic-financial-advisor's Plaid-connected bank data into
 * Copilot CLI so agents (especially finance-manager) can query real bank
 * balances, transactions, spending patterns, and recurring charges.
 *
 * Architecture:
 *   - Reads the existing SQLite DB created by the Electron app (sql.js format,
 *     standard SQLite3-compatible) via Node's built-in `node:sqlite`.
 *   - Calls Plaid API directly via `fetch` — zero npm dependencies.
 *   - Plaid credentials are read from environment variables or from the
 *     agentic-financial-advisor repo's .env file. NEVER hardcoded.
 *
 * Security:
 *   - Access tokens are NEVER logged, returned, or exposed in tool output.
 *   - All token access is strictly internal (DB read → Plaid API call).
 *   - Plaid client_id/secret come from env vars or the .env file only.
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Paths & Config
// ---------------------------------------------------------------------------
const AFA_REPO = "C:\\Repos\\{{GITHUB_USERNAME}}\\agentic-financial-advisor";
const DB_PATH = join(
  process.env.APPDATA || "",
  "agentic-financial-advisor",
  "agentic-financial-advisor",
  "data.db",
);
const AFA_ENV_FILE = join(AFA_REPO, ".env");
const PLAID_ENVS = {
  production: "https://production.plaid.com",
  development: "https://development.plaid.com",
  sandbox: "https://sandbox.plaid.com",
};

// ---------------------------------------------------------------------------
// Env loader — reads Plaid credentials from the AFA .env, never stores them
// ---------------------------------------------------------------------------
let _envCache = null;

function loadEnv() {
  if (_envCache) return _envCache;
  try {
    const raw = readFileSync(AFA_ENV_FILE, "utf-8");
    const vars = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      )
        val = val.slice(1, -1);
      vars[key] = val;
    }
    _envCache = vars;
    return vars;
  } catch {
    return {};
  }
}

function getPlaidConfig() {
  const env = loadEnv();
  const clientId = process.env.PLAID_CLIENT_ID || env.PLAID_CLIENT_ID || "";
  const secret = process.env.PLAID_SECRET || env.PLAID_SECRET || "";
  const plaidEnv = process.env.PLAID_ENV || env.PLAID_ENV || "production";
  const basePath = PLAID_ENVS[plaidEnv] || PLAID_ENVS.production;
  return { clientId, secret, basePath };
}

// ---------------------------------------------------------------------------
// Database — opens the agentic-financial-advisor's existing SQLite DB
// ---------------------------------------------------------------------------
let _db = null;

function getDb() {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `Financial database not found at: ${DB_PATH}. ` +
        "Has the agentic-financial-advisor app been run at least once?",
    );
  }
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  return _db;
}

// ---------------------------------------------------------------------------
// Plaid API helper — raw fetch, no SDK dependency
// ---------------------------------------------------------------------------
async function plaidRequest(endpoint, body = {}) {
  const { clientId, secret, basePath } = getPlaidConfig();
  if (!clientId || !secret) {
    throw new Error(
      "Plaid credentials not configured. Set PLAID_CLIENT_ID and PLAID_SECRET " +
        "environment variables, or ensure .env exists at " +
        AFA_ENV_FILE,
    );
  }

  const res = await fetch(`${basePath}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PLAID-CLIENT-ID": clientId,
      "PLAID-SECRET": secret,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = err.error_code || "UNKNOWN";
    const msg = err.error_message || res.statusText;
    throw new Error(`Plaid API [${code}]: ${msg}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function fmt(n) {
  return (
    "$" +
    Number(n || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// DB read helpers
// ---------------------------------------------------------------------------

function dbGetItems() {
  const d = getDb();
  return d
    .prepare(
      `SELECT id, plaid_item_id AS plaidItemId, institution_id AS institutionId,
        institution_name AS institutionName, source,
        error_code AS errorCode, error_message AS errorMessage,
        created_at AS createdAt
       FROM items ORDER BY created_at DESC`,
    )
    .all();
}

function dbGetAccounts() {
  const d = getDb();
  return d
    .prepare(
      `SELECT a.id, a.item_id AS itemId, a.name,
        a.official_name AS officialName, a.type, a.subtype, a.mask,
        a.current_balance AS currentBalance, a.available_balance AS availableBalance,
        a.currency, a.last_synced_at AS lastSyncedAt,
        i.institution_name AS institutionName,
        i.error_code AS itemErrorCode, i.source AS itemSource
       FROM accounts a
       JOIN items i ON a.item_id = i.id
       ORDER BY i.institution_name, a.type, a.name`,
    )
    .all();
}

function dbGetAccountsByItem(itemId) {
  const d = getDb();
  return d
    .prepare(
      `SELECT id, plaid_account_id AS plaidAccountId, name, type, subtype,
        mask, current_balance AS currentBalance,
        available_balance AS availableBalance
       FROM accounts WHERE item_id = ? ORDER BY type, name`,
    )
    .all(itemId);
}

function dbGetItemAccessToken(itemId) {
  const d = getDb();
  const row = d
    .prepare("SELECT access_token FROM items WHERE id = ?")
    .get(itemId);
  return row?.access_token || null;
}

function dbQueryTransactions(filters) {
  const d = getDb();
  const conds = [];
  const params = [];

  if (filters.startDate) {
    conds.push("t.date >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conds.push("t.date <= ?");
    params.push(filters.endDate);
  }
  if (filters.category) {
    conds.push("LOWER(t.category) = LOWER(?)");
    params.push(filters.category);
  }
  if (filters.search) {
    conds.push(
      "(t.name LIKE ? OR t.merchant_name LIKE ? OR t.category LIKE ?)",
    );
    params.push(
      `%${filters.search}%`,
      `%${filters.search}%`,
      `%${filters.search}%`,
    );
  }
  if (filters.accountId) {
    conds.push("t.account_id = ?");
    params.push(filters.accountId);
  }
  if (filters.minAmount !== undefined) {
    conds.push("t.amount >= ?");
    params.push(filters.minAmount);
  }
  if (filters.maxAmount !== undefined) {
    conds.push("t.amount <= ?");
    params.push(filters.maxAmount);
  }

  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(filters.limit || 50, 200);

  const countRow = d
    .prepare(`SELECT COUNT(*) AS count FROM transactions t ${where}`)
    .get(...params);
  const total = countRow?.count ?? 0;

  const rows = d
    .prepare(
      `SELECT t.id, t.account_id AS accountId, t.amount, t.date, t.name,
        t.merchant_name AS merchantName, t.category, t.subcategory,
        t.pending, a.name AS accountName,
        i.institution_name AS institutionName
       FROM transactions t
       LEFT JOIN accounts a ON t.account_id = a.id
       LEFT JOIN items i ON a.item_id = i.id
       ${where}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ?`,
    )
    .all(...params, limit);

  return { transactions: rows, total };
}

function dbGetSpendingSummary(startDate, endDate) {
  const d = getDb();
  return d
    .prepare(
      `SELECT COALESCE(t.category, 'Uncategorized') AS category,
        ROUND(SUM(t.amount), 2) AS total, COUNT(*) AS count
       FROM transactions t
       WHERE t.date >= ? AND t.date <= ? AND t.amount > 0
       GROUP BY t.category
       ORDER BY SUM(t.amount) DESC`,
    )
    .all(startDate, endDate);
}

function dbGetRecurring() {
  const d = getDb();
  return d
    .prepare(
      `SELECT COALESCE(merchant_name, name) AS merchant,
        ROUND(AVG(amount), 2) AS avgAmount,
        ROUND(MIN(amount), 2) AS minAmount,
        ROUND(MAX(amount), 2) AS maxAmount,
        COUNT(*) AS occurrences,
        MIN(date) AS firstSeen,
        MAX(date) AS lastSeen,
        category
       FROM transactions
       WHERE pending = 0 AND amount > 0
       GROUP BY COALESCE(merchant_name, name), ROUND(amount, 0)
       HAVING COUNT(*) >= 3
       ORDER BY occurrences DESC, AVG(amount) DESC`,
    )
    .all();
}

function dbGetTransactionStats() {
  const d = getDb();
  return d
    .prepare(
      `SELECT COUNT(*) AS total,
        MIN(date) AS earliest,
        MAX(date) AS latest
       FROM transactions`,
    )
    .get();
}

// ---------------------------------------------------------------------------
// Plaid live-sync operations
// ---------------------------------------------------------------------------

async function refreshBalancesForItem(itemId) {
  const token = dbGetItemAccessToken(itemId);
  if (!token) throw new Error(`No access token for item ${itemId}`);

  const minUpdated = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const data = await plaidRequest("/accounts/balance/get", {
    access_token: token,
    options: { min_last_updated_datetime: minUpdated },
  });

  const d = getDb();
  const now = new Date().toISOString();
  const stmt = d.prepare(`
    INSERT INTO accounts (id, item_id, plaid_account_id, name, official_name,
      type, subtype, mask, current_balance, available_balance, currency,
      last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plaid_account_id) DO UPDATE SET
      name = excluded.name, official_name = excluded.official_name,
      current_balance = excluded.current_balance,
      available_balance = excluded.available_balance,
      last_synced_at = excluded.last_synced_at
  `);

  for (const a of data.accounts) {
    stmt.run(
      crypto.randomUUID(),
      itemId,
      a.account_id,
      a.name,
      a.official_name || null,
      a.type,
      a.subtype || null,
      a.mask || null,
      a.balances.current,
      a.balances.available,
      a.balances.iso_currency_code || "USD",
      now,
    );
  }

  return data.accounts.length;
}

async function syncTransactionsForItem(itemId) {
  const token = dbGetItemAccessToken(itemId);
  if (!token) throw new Error(`No access token for item ${itemId}`);

  const d = getDb();
  const accounts = dbGetAccountsByItem(itemId);
  const acctMap = new Map(accounts.map((a) => [a.plaidAccountId, a.id]));

  const cursorRow = d
    .prepare("SELECT cursor FROM sync_state WHERE item_id = ?")
    .get(itemId);
  let cursor = cursorRow?.cursor || undefined;

  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;

  const upsertStmt = d.prepare(`
    INSERT INTO transactions (id, account_id, plaid_transaction_id, amount,
      date, name, merchant_name, category, subcategory, pending, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(plaid_transaction_id) DO UPDATE SET
      amount = excluded.amount, date = excluded.date, name = excluded.name,
      merchant_name = excluded.merchant_name, category = excluded.category,
      subcategory = excluded.subcategory, pending = excluded.pending
  `);

  while (hasMore) {
    const data = await plaidRequest("/transactions/sync", {
      access_token: token,
      cursor,
    });

    for (const txn of data.added || []) {
      upsertStmt.run(
        crypto.randomUUID(),
        acctMap.get(txn.account_id) || txn.account_id,
        txn.transaction_id,
        txn.amount,
        txn.date,
        txn.name || "",
        txn.merchant_name || null,
        txn.personal_finance_category?.primary ||
          txn.category?.[0] ||
          null,
        txn.personal_finance_category?.detailed ||
          txn.category?.[1] ||
          null,
        txn.pending ? 1 : 0,
      );
      added++;
    }

    for (const txn of data.modified || []) {
      upsertStmt.run(
        crypto.randomUUID(),
        acctMap.get(txn.account_id) || txn.account_id,
        txn.transaction_id,
        txn.amount,
        txn.date,
        txn.name || "",
        txn.merchant_name || null,
        txn.personal_finance_category?.primary ||
          txn.category?.[0] ||
          null,
        txn.personal_finance_category?.detailed ||
          txn.category?.[1] ||
          null,
        txn.pending ? 1 : 0,
      );
      modified++;
    }

    if (data.removed?.length > 0) {
      const ids = data.removed
        .map((r) => r.transaction_id)
        .filter(Boolean);
      if (ids.length > 0) {
        // Build dynamic delete with correct number of placeholders
        d.prepare(
          `DELETE FROM transactions WHERE plaid_transaction_id IN (${ids.map(() => "?").join(",")})`,
        ).run(...ids);
      }
      removed += data.removed.length;
    }

    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  // Persist sync cursor
  if (cursor) {
    d.prepare(
      `INSERT INTO sync_state (item_id, cursor, last_synced_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(item_id) DO UPDATE SET
         cursor = excluded.cursor, last_synced_at = CURRENT_TIMESTAMP`,
    ).run(itemId, cursor);
  }

  // Refresh balances too
  await refreshBalancesForItem(itemId);

  // Clear error on success
  d.prepare(
    "UPDATE items SET error_code = NULL, error_message = NULL WHERE id = ?",
  ).run(itemId);

  return { added, modified, removed };
}

// ---------------------------------------------------------------------------
// Session + Tools
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      try {
        const accounts = dbGetAccounts();
        const items = dbGetItems();
        const stats = dbGetTransactionStats();
        const plaidItems = items.filter((i) => i.source !== "import");
        const errorItems = plaidItems.filter((i) => i.errorCode);
        const healthyItems = plaidItems.filter((i) => !i.errorCode);

        let ctx = `[financial-connector] 🏦 ${accounts.length} bank accounts across ${plaidItems.length} Plaid-connected institutions.`;
        ctx += `\n📊 ${stats?.total ?? 0} transactions on file (${stats?.earliest ?? "?"} → ${stats?.latest ?? "?"}).`;

        if (healthyItems.length > 0) {
          ctx += `\n✅ Active: ${healthyItems.map((i) => i.institutionName).join(", ")}`;
        }
        if (errorItems.length > 0) {
          ctx += `\n⚠️ Need re-auth: ${errorItems.map((i) => `${i.institutionName} (${i.errorCode})`).join(", ")}`;
        }

        // Net position
        let assets = 0;
        let liabilities = 0;
        for (const a of accounts) {
          const bal = a.currentBalance || 0;
          if (a.type === "credit" || a.type === "loan") {
            liabilities += Math.abs(bal);
          } else {
            assets += bal;
          }
        }
        ctx += `\n💰 Assets: ${fmt(assets)} | Liabilities: ${fmt(liabilities)} | Net: ${fmt(assets - liabilities)}`;

        return { additionalContext: ctx };
      } catch (e) {
        return {
          additionalContext: `[financial-connector] ⚠️ Error loading: ${e.message}`,
        };
      }
    },
  },

  tools: [
    // -------------------------------------------------------------------
    // 1. get_balances
    // -------------------------------------------------------------------
    {
      name: "get_balances",
      description:
        "Pull current balances from all connected bank accounts. Shows institution, account name, type, and balance. Set refresh=true to fetch live data from Plaid (slower, requires working tokens).",
      parameters: {
        type: "object",
        properties: {
          refresh: {
            type: "boolean",
            description:
              "Fetch live balances from Plaid before returning. Default: false (cached).",
          },
        },
      },
      handler: async (args) => {
        try {
          // Optionally refresh from Plaid first
          if (args.refresh) {
            const items = dbGetItems();
            const results = [];
            for (const item of items) {
              if (item.source === "import" || item.errorCode) {
                results.push({
                  institution: item.institutionName,
                  status: item.errorCode
                    ? `⚠️ ${item.errorCode}`
                    : "📥 manual import",
                  refreshed: false,
                });
                continue;
              }
              try {
                const count = await refreshBalancesForItem(item.id);
                results.push({
                  institution: item.institutionName,
                  status: `✅ refreshed ${count} accounts`,
                  refreshed: true,
                });
              } catch (e) {
                results.push({
                  institution: item.institutionName,
                  status: `❌ ${e.message}`,
                  refreshed: false,
                });
                // Store the error in DB
                const d = getDb();
                const errMatch = e.message.match(/\[([A-Z_]+)\]/);
                if (errMatch) {
                  d.prepare(
                    "UPDATE items SET error_code = ?, error_message = ? WHERE id = ?",
                  ).run(errMatch[1], e.message, item.id);
                }
              }
            }
          }

          // Read accounts from DB
          const accounts = dbGetAccounts();
          if (accounts.length === 0) return "No bank accounts found in the database.";

          // Group by institution
          const byInst = {};
          for (const a of accounts) {
            const inst = a.institutionName || "Unknown";
            if (!byInst[inst]) byInst[inst] = [];
            byInst[inst].push(a);
          }

          const lines = ["## 🏦 Account Balances\n"];
          let totalAssets = 0;
          let totalLiabilities = 0;

          for (const [inst, accts] of Object.entries(byInst)) {
            const errorFlag = accts[0]?.itemErrorCode
              ? ` ⚠️ (${accts[0].itemErrorCode})`
              : "";
            lines.push(`### ${inst}${errorFlag}`);
            lines.push(
              "| Account | Type | Balance | Available | Last Synced |",
            );
            lines.push(
              "|---------|------|--------:|----------:|-------------|",
            );

            for (const a of accts) {
              const bal = a.currentBalance ?? 0;
              const avail =
                a.availableBalance != null
                  ? fmt(a.availableBalance)
                  : "—";
              const synced = a.lastSyncedAt
                ? a.lastSyncedAt.slice(0, 16).replace("T", " ")
                : "never";
              const name = a.mask
                ? `${a.name} (···${a.mask})`
                : a.name;
              const typeLabel = a.subtype
                ? `${a.type}/${a.subtype}`
                : a.type;

              lines.push(
                `| ${name} | ${typeLabel} | ${fmt(bal)} | ${avail} | ${synced} |`,
              );

              if (a.type === "credit" || a.type === "loan") {
                totalLiabilities += Math.abs(bal);
              } else {
                totalAssets += bal;
              }
            }
            lines.push("");
          }

          const net = totalAssets - totalLiabilities;
          const netIcon = net >= 0 ? "🟢" : "🔴";
          lines.push(
            `**Assets:** ${fmt(totalAssets)} | **Liabilities:** ${fmt(totalLiabilities)} | **Net:** ${netIcon} ${fmt(net)}`,
          );

          return lines.join("\n");
        } catch (e) {
          return `❌ Error fetching balances: ${e.message}`;
        }
      },
    },

    // -------------------------------------------------------------------
    // 2. get_transactions
    // -------------------------------------------------------------------
    {
      name: "get_transactions",
      description:
        "Pull recent transactions from all connected accounts. Filter by date range, category, merchant/text search, account ID, or amount range. Returns up to 200 rows.",
      parameters: {
        type: "object",
        properties: {
          start_date: {
            type: "string",
            description:
              "Start date (YYYY-MM-DD). Default: 30 days ago.",
          },
          end_date: {
            type: "string",
            description: "End date (YYYY-MM-DD). Default: today.",
          },
          category: {
            type: "string",
            description:
              "Filter by Plaid category (e.g. FOOD_AND_DRINK, TRANSPORTATION, RENT_AND_UTILITIES).",
          },
          search: {
            type: "string",
            description:
              "Search merchant name, transaction name, or category.",
          },
          account_id: {
            type: "string",
            description: "Filter to a specific account ID.",
          },
          min_amount: {
            type: "number",
            description: "Minimum transaction amount.",
          },
          max_amount: {
            type: "number",
            description: "Maximum transaction amount.",
          },
          limit: {
            type: "number",
            description: "Max results (default 50, max 200).",
          },
        },
      },
      handler: async (args) => {
        try {
          const { transactions, total } = dbQueryTransactions({
            startDate: args.start_date || daysAgo(30),
            endDate: args.end_date || todayISO(),
            category: args.category,
            search: args.search,
            accountId: args.account_id,
            minAmount: args.min_amount,
            maxAmount: args.max_amount,
            limit: args.limit,
          });

          if (transactions.length === 0) {
            return "No transactions found matching the filters.";
          }

          const lines = [
            `## 💳 Transactions (${transactions.length} of ${total})\n`,
          ];
          lines.push(
            "| Date | Description | Category | Amount | Account |",
          );
          lines.push(
            "|------|-------------|----------|-------:|---------|",
          );

          let totalAmount = 0;
          for (const t of transactions) {
            const desc =
              t.merchantName || t.name || "Unknown";
            const cat = t.category || "—";
            const pending = t.pending ? " 🕐" : "";
            const acct = t.accountName
              ? `${t.institutionName || ""} ${t.accountName}`.trim()
              : "—";
            lines.push(
              `| ${t.date} | ${desc}${pending} | ${cat} | ${fmt(t.amount)} | ${acct} |`,
            );
            totalAmount += t.amount;
          }

          lines.push("");
          lines.push(
            `**Total:** ${fmt(totalAmount)} across ${transactions.length} transaction(s)`,
          );
          if (total > transactions.length) {
            lines.push(
              `_Showing ${transactions.length} of ${total} — increase limit or narrow filters._`,
            );
          }

          return lines.join("\n");
        } catch (e) {
          return `❌ Error querying transactions: ${e.message}`;
        }
      },
    },

    // -------------------------------------------------------------------
    // 3. get_spending_summary
    // -------------------------------------------------------------------
    {
      name: "get_spending_summary",
      description:
        "Categorized spending summary for a time period. Shows total spent per Plaid category with counts and percentages. Positive amounts = money leaving accounts (debits).",
      parameters: {
        type: "object",
        properties: {
          start_date: {
            type: "string",
            description:
              "Start date (YYYY-MM-DD). Default: first of current month.",
          },
          end_date: {
            type: "string",
            description: "End date (YYYY-MM-DD). Default: today.",
          },
        },
      },
      handler: async (args) => {
        try {
          const startDate = args.start_date || monthStart();
          const endDate = args.end_date || todayISO();
          const rows = dbGetSpendingSummary(startDate, endDate);

          if (rows.length === 0) {
            return `No spending found between ${startDate} and ${endDate}.`;
          }

          const grandTotal = rows.reduce(
            (s, r) => s + (r.total || 0),
            0,
          );
          const totalCount = rows.reduce(
            (s, r) => s + (r.count || 0),
            0,
          );

          const lines = [
            `## 📊 Spending Summary (${startDate} → ${endDate})\n`,
          ];
          lines.push(
            "| Category | Amount | Txns | % of Total |",
          );
          lines.push(
            "|----------|-------:|-----:|-----------:|",
          );

          for (const r of rows) {
            const pct =
              grandTotal > 0
                ? ((r.total / grandTotal) * 100).toFixed(1)
                : "0.0";
            lines.push(
              `| ${r.category} | ${fmt(r.total)} | ${r.count} | ${pct}% |`,
            );
          }

          lines.push(
            `| **TOTAL** | **${fmt(grandTotal)}** | **${totalCount}** | **100%** |`,
          );

          return lines.join("\n");
        } catch (e) {
          return `❌ Error generating spending summary: ${e.message}`;
        }
      },
    },

    // -------------------------------------------------------------------
    // 4. get_recurring
    // -------------------------------------------------------------------
    {
      name: "get_recurring",
      description:
        "Identify recurring charges and subscriptions. Finds transactions that repeat 3+ times with consistent amounts. Great for subscription audits.",
      parameters: {
        type: "object",
        properties: {
          min_occurrences: {
            type: "number",
            description:
              "Minimum number of occurrences to qualify as recurring. Default: 3.",
          },
        },
      },
      handler: async (args) => {
        try {
          const rows = dbGetRecurring();
          const minOcc = args.min_occurrences || 3;
          const filtered = rows.filter(
            (r) => r.occurrences >= minOcc,
          );

          if (filtered.length === 0) {
            return `No recurring transactions found with ${minOcc}+ occurrences.`;
          }

          // Estimate monthly cost
          let estimatedMonthly = 0;

          const lines = [
            `## 🔄 Recurring Charges (${filtered.length} detected)\n`,
          ];
          lines.push(
            "| Merchant | Avg Amount | Occurrences | First Seen | Last Seen | Category |",
          );
          lines.push(
            "|----------|----------:|-----------:|------------|-----------|----------|",
          );

          for (const r of filtered) {
            lines.push(
              `| ${r.merchant} | ${fmt(r.avgAmount)} | ${r.occurrences}× | ${r.firstSeen} | ${r.lastSeen} | ${r.category || "—"} |`,
            );

            // Rough monthly estimate: if seen in the last 90 days,
            // assume it recurs monthly
            const lastSeen = new Date(r.lastSeen);
            const daysSinceLast = Math.floor(
              (Date.now() - lastSeen.getTime()) / 86400000,
            );
            if (daysSinceLast < 90) {
              estimatedMonthly += r.avgAmount;
            }
          }

          lines.push("");
          lines.push(
            `**Estimated monthly recurring:** ${fmt(estimatedMonthly)}`,
          );
          lines.push(
            `_Based on ${filtered.length} recurring charge(s) active in the last 90 days._`,
          );

          return lines.join("\n");
        } catch (e) {
          return `❌ Error detecting recurring charges: ${e.message}`;
        }
      },
    },

    // -------------------------------------------------------------------
    // 5. sync_accounts
    // -------------------------------------------------------------------
    {
      name: "sync_accounts",
      description:
        "Refresh account data from Plaid: syncs new transactions, updates balances, and reports connection health. Skips institutions with expired tokens. Use after investigating spending or before balance checks for the freshest data.",
      parameters: {
        type: "object",
        properties: {
          institution: {
            type: "string",
            description:
              "Sync only a specific institution by name (partial match). Default: sync all.",
          },
          balances_only: {
            type: "boolean",
            description:
              "Only refresh balances, skip transaction sync. Faster.",
          },
        },
      },
      handler: async (args) => {
        try {
          const items = dbGetItems();
          const plaidItems = items.filter(
            (i) => i.source !== "import",
          );

          // Optionally filter to specific institution
          const target = args.institution
            ? plaidItems.filter((i) =>
                (i.institutionName || "")
                  .toLowerCase()
                  .includes(args.institution.toLowerCase()),
              )
            : plaidItems;

          if (target.length === 0) {
            return args.institution
              ? `No Plaid-connected institution matching "${args.institution}" found.`
              : "No Plaid-connected institutions found.";
          }

          const results = [];
          for (const item of target) {
            // Skip items with known auth errors
            if (item.errorCode) {
              results.push(
                `⚠️ **${item.institutionName}**: Skipped — ${item.errorCode} (needs re-authentication in the app)`,
              );
              continue;
            }

            try {
              if (args.balances_only) {
                const count = await refreshBalancesForItem(item.id);
                results.push(
                  `✅ **${item.institutionName}**: Refreshed ${count} account balance(s)`,
                );
              } else {
                const { added, modified, removed } =
                  await syncTransactionsForItem(item.id);
                results.push(
                  `✅ **${item.institutionName}**: +${added} new, ~${modified} updated, -${removed} removed transactions. Balances refreshed.`,
                );
              }
            } catch (e) {
              // Parse Plaid error code if present
              const errMatch = e.message.match(
                /\[([A-Z_]+)\]/,
              );
              const code = errMatch?.[1] || "ERROR";
              results.push(
                `❌ **${item.institutionName}**: ${code} — ${e.message.replace(/Plaid API \[[A-Z_]+\]: /, "")}`,
              );

              // Persist the error
              if (errMatch) {
                const d = getDb();
                d.prepare(
                  "UPDATE items SET error_code = ?, error_message = ? WHERE id = ?",
                ).run(code, e.message, item.id);
              }
            }
          }

          const lines = ["## 🔄 Sync Results\n"];
          lines.push(results.join("\n"));

          // Show updated balances after sync
          const accounts = dbGetAccounts();
          let assets = 0;
          let liabilities = 0;
          for (const a of accounts) {
            const bal = a.currentBalance || 0;
            if (a.type === "credit" || a.type === "loan") {
              liabilities += Math.abs(bal);
            } else {
              assets += bal;
            }
          }
          lines.push("");
          lines.push(
            `**Post-sync position:** Assets ${fmt(assets)} | Liabilities ${fmt(liabilities)} | Net ${fmt(assets - liabilities)}`,
          );

          return lines.join("\n");
        } catch (e) {
          return `❌ Sync failed: ${e.message}`;
        }
      },
    },
  ],
});
