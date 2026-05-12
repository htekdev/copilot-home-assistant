---
name: shopping-trip-closeout
description: Post-shopping-trip workflow — check off purchased items, log expenses to budget tracker, and sync inventory. Use when user says "got groceries", "back from shopping", "bought the items", "went to store", "shopping done", "picked up groceries", "HEB run done", "Costco trip", or any indication a shopping trip was completed.
---

# Shopping Trip Closeout Skill

Multi-step procedure for processing a completed shopping trip. Ensures the shopping list, budget tracker, and task system all stay in sync.

## When to Trigger

This skill activates when:
- A user says they went shopping or bought items
- A grocery delivery is confirmed
- A shopping-related task is marked done
- A receipt or purchase is mentioned

## The Workflow

### Step 1 — Check Off Purchased Items

Cross-reference what was bought against the active shopping list:

```
shopping_list()                    # See current list
check_off_item(item: "[name]")    # For each purchased item
```

**Rules:**
- If the user says "got everything" → check off ALL items on the list
- If the user mentions specific items → check off only those
- If an item was substituted → check off original, optionally add note

### Step 2 — Log Expenses

Prompt to log the total spent (or itemized if provided):

**If the user provides a total:**
```
# Create a task or log via finance tools:
add_task(
  title: "Log $[amount] grocery expense at [store]",
  category: "finance",
  priority: "medium",
  assignee: "shared",
  notes: "Shopping trip to [store] on [date]. Total: $[amount]."
)
```

**If the user provides a receipt/breakdown:**
- Log each category separately if possible (produce, meat, household, etc.)
- Create ONE summary task rather than multiple

### Step 3 — Sync Inventory (If Applicable)

For recurring staples (dog food, diapers, formula, cleaning supplies):
- If a quantity item was purchased, update any relevant tracking
- If a recurring "buy X" task existed, complete it

### Step 4 — Archive Completed List (Optional)

If ALL items are checked off:
```
clear_shopping_list()  # Archives current list, starts fresh
```

**Only do this if the user confirms everything was purchased.** Partial trips leave the list active with unchecked items.

## Store-Specific Notes

| Store | Account IDs / Notes |
|-------|-------------------|
| H-E-B | Primary grocery. Use `heb-grocery` skill for catalog/cart management |
| Costco | Bulk items. Typically larger totals ($150-300). Separate budget category. |
| Target | Mixed (household + grocery). Split expense if significant. |
| Amazon | Online orders. Often auto-tracked via email. |

## Integration with Other Skills

- **`heb-grocery`** — For H-E-B specific cart and order management
- **`finance-task-lifecycle`** — Expense logging patterns
- **`task-management`** — Completing shopping-related tasks

## Consuming Agents

- Main session (handles "I'm back from the store" messages)
- `nutrition-chef` (owns shopping lists)
- `finance-manager` (owns expense tracking)
- `task-coach` (may serve shopping tasks)

## Anti-Patterns

- ❌ Forgetting to check off items after a trip (list goes stale)
- ❌ Not prompting for expense logging (budget tracking gaps)
- ❌ Archiving a list when only some items were bought
- ❌ Assuming all items were purchased without confirmation
- ❌ Creating multiple expense tasks for one shopping trip (batch into one)
