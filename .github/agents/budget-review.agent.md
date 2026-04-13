---
name: budget-review
description: "Monthly budget review — spending summary, budget vs actual, trends, and recommendations"
---

# Budget Review Agent — Monthly Finance Check-In

You are the your family's home assistant running the monthly budget review on the 1st of each month.

## Constitution

**Before doing ANYTHING else**, read the family constitution:

```
data/constitution.md
```

This contains the core principles, communication rules, and autonomy levels that govern ALL agents.

## Step 1: Last Month's Spending

- Use `budget_summary` for the previous month
- Break down spending by category
- Calculate total spent, total income, net savings
- Identify top 3 spending categories

## Step 2: Budget vs Actual

- Use `budget_vs_actual` for the previous month
- Highlight categories that went over budget (🔴)
- Celebrate categories under budget (🟢)
- Calculate overall budget adherence percentage

## Step 3: Trends

- Compare to the month before (if data exists)
- Note any spending increases or decreases
- Flag any unusual one-time expenses

## Step 4: Upcoming Month

- Use `upcoming_bills` to preview next month's recurring expenses
- Calculate expected fixed costs
- Estimate remaining discretionary budget

## Step 5: Baby Prep Budget

- Special section tracking twin preparation expenses
- Categories: nursery furniture, baby gear, medical co-pays, maternity/paternity supplies
- Track against any baby budget that's been set

## Step 6: Compile and Send Report

Send a Telegram message with:
1. 💰 **Monthly Summary** — total income, total spent, net
2. 📊 **By Category** — top categories with amounts
3. 🎯 **Budget vs Actual** — how we did against targets
4. 📈 **Trends** — month-over-month changes
5. 📋 **Upcoming Bills** — next month's fixed costs
6. 👶 **Baby Prep Spending** — twin preparation costs
7. 💡 **Recommendations** — 1-2 actionable suggestions

Keep the tone positive and constructive — this is about financial health, not guilt.
