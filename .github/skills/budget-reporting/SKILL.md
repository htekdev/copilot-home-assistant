---
name: budget-reporting
description: Monthly/weekly budget report generation — spending breakdown, budget vs actual, trends, upcoming bills, and recommendations. Use when user says "budget report", "monthly review", "spending summary", "budget vs actual", "financial report", "where did money go", "money summary", "budget check", or any structured finance reporting.
---

# Budget Reporting Skill

Standard report generation patterns for family budget analysis. Used by budget-review agent, finance-manager, and daily-briefing.

## Report Structure (Canonical Format)

Every budget report follows this structure. Agents may use a subset (e.g., daily-briefing uses only Steps 1 + 5) but the ordering and format are fixed.

### Step 1: Spending Summary

```
get_spending_summary(start_date: "YYYY-MM-01", end_date: "YYYY-MM-DD")
```

**Output format:**
```
💰 Monthly Summary (Month YYYY)
━━━━━━━━━━━━━━━━━━━━━━
Total Spent: $X,XXX
Total Income: $X,XXX
Net: +/-$X,XXX
```

Break down by top categories with amounts and percentages.

### Step 2: Budget vs Actual

Compare each budget category against its target:
- 🟢 Under budget — celebrate
- 🟡 At budget (90-100%) — note
- 🔴 Over budget — flag with amount over

**Calculate overall adherence:** (categories at/under budget) / (total categories) × 100%

### Step 3: Trends

Compare current period to prior period:
```
get_spending_summary(start_date: prior_period_start, end_date: prior_period_end)
```

- Note increases/decreases by category
- Flag unusual one-time expenses
- Identify patterns (recurring charges growing, subscriptions added)

### Step 4: Recurring Charges Audit

```
get_recurring(min_occurrences: 3)
```

- List all subscriptions with monthly amounts
- Flag any new recurring charges since last review
- Total monthly subscription burn

### Step 5: Upcoming Bills

Show bills due in the next 7-30 days depending on context:
- Daily-briefing: next 3 days
- Weekly-planner: next 7 days
- Monthly review: full next month

### Step 6: Recommendations

Generate 1-3 actionable recommendations based on findings:
- Over-budget categories → specific reduction ideas
- Unused subscriptions → cancellation suggestions
- Positive trends → reinforcement

## Tone Rules

- Positive and constructive — this is about financial HEALTH, not guilt
- Use emojis for visual scanning (💰📊🎯📈📋💡)
- Keep concise — Telegram delivery requires brevity
- Lead with the number, then context

## Integration Points

| Consumer Agent | Uses Steps |
|---------------|-----------|
| `budget-review` | All (1-6) — monthly deep dive |
| `daily-briefing` | Step 5 only — bills due soon |
| `finance-manager` | Steps 1, 2, 4 — on-demand checks |
| `weekly-planner` | Steps 1, 5 — spending context for planning |

## Anti-Patterns

- ❌ Lecturing about debt morally
- ❌ Saying "you spent too much on X" without context
- ❌ Recommending cutting essentials (baby, medical, food)
- ❌ Ignoring the NICU twin context — medical costs are non-negotiable
