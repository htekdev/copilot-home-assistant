---
name: Block direct database access via PowerShell
description: Blocks PowerShell commands that interact with SQLite or other local databases. Use extension tools instead.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: '(sqlite3|\.open|\.tables|\.schema|SELECT\s+\*?\s*FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|PRAGMA|BEGIN\s+TRANSACTION|COMMIT\s+TRANSACTION|COMMIT;|ROLLBACK|DatabaseSync|better-sqlite3|sql\.js|node.*sqlite|python.*sqlite|import\s+sqlite)'
---

🚫 **BLOCKED:** Direct database access via PowerShell is not allowed.

Use the proper extension tools to interact with local databases:

| Blocked Pattern | Use Instead | Description |
|----------------|-------------|-------------|
| `sqlite3` CLI | Extension tools (e.g., `log_pump`, `get_pump_history`) | Domain-specific data tools |
| `SELECT/INSERT/UPDATE` in shell | Extension tools or `sql` session tool | Governed data access |
| `DatabaseSync` / `better-sqlite3` | Extension tools | Node.js SQLite access |
| `python -c "import sqlite3..."` | Extension tools | Python SQLite access |
| `.open`, `.tables`, `.schema` | `tool_search_tool_regex` | Discover available data tools |

**Why?** Direct database access bypasses data governance (schema validation, audit logging, domain ownership). All database interactions should go through registered extension tools that enforce the data governance pattern.

**How to find the right tool:**
1. Run `tool_search_tool_regex` with a pattern matching your data need (e.g., `pump`, `task`, `expense`, `bill`)
2. Use the returned tool — it handles schema, validation, and logging automatically
3. If no tool exists for your data need, flag it as a gap — don't work around governance
