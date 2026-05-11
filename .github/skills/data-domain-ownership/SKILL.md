---
name: data-domain-ownership
description: Data folder ownership map — which agent owns which data directory, cross-domain read/write rules, and shared file governance. Use when user says "who owns this data", "can I write to", "data ownership", "cross-domain write", "folder ownership", "domain boundary", "data governance", or any question about data file write permissions.
---

# Data Domain Ownership Skill

Canonical ownership map for all `data/` directories in a family assistant platform. Prevents cross-domain writes and clarifies governance boundaries.

## Core Rule

**Each data folder is owned by a specific domain agent.** Only the owning agent should WRITE to its domain folder. Other agents may READ, but must NOT modify files outside their domain.

## Ownership Map

| Folder | Owner Agent | Contents |
|--------|-------------|----------|
| `data/family/` | family-coordinator | Family member profiles (JSON), schedules |
| `data/finance/` | finance-manager | Debt profile, budget DB, session history |
| `data/meals/` | nutrition-chef | Meal plans, recipes, weekly menus |
| `data/home/` | home-manager | Maintenance schedule, service providers |
| `data/content/` | content-manager | Promo images, editor output, video assets |
| `data/projects/` | coding-agent | Side projects, business proposals, client work |
| `data/shopping/` | nutrition-chef | Shopping lists DB, grocery staples |
| `data/nicu/` | nicu-care | Pumping log, baby journal, NICU schedule |
| `data/agents/{agent}/` | Each agent | Own memory tiers (core.md, working.md, etc.) |

## Shared System Files

These files are **platform-level** — owned by `platform-manager`:

| File | Purpose | Who Can Edit |
|------|---------|-------------|
| `data/constitution.md` | Core principles, all-agent rules | platform-manager (or correction-persistence flow) |
| `data/standing-orders.md` | Operational rules, learned behaviors | platform-manager, correction-persistence flow |
| `data/locations.json` | Saved family locations | Any agent via `add_location` tool |
| `data/google-tokens.json` | OAuth tokens | google-services extension only |

## Cross-Domain Rules

### Reading (ALLOWED)
- Any agent may **read** any data folder for context
- Example: task-coach reads `data/meals/` to know tonight's dinner for briefing

### Writing (RESTRICTED)
- An agent may ONLY write to its own domain folder
- If Agent A needs data created in Agent B's domain → **delegate to Agent B** via `task` tool

### Exceptions
1. **Memory tiers** — each agent writes to its own `data/agents/{self}/` folder only
2. **Correction persistence** — the 3-layer persist flow (`store_memory` + standing-orders + copilot-instructions) is cross-cutting by design
3. **Task/shopping/calendar tools** — these are system-level tools that write to shared databases, not data files

## When to Check This Skill

- Before writing any file under `data/`
- When creating a new data file — confirm the correct owner agent
- When debugging stale data — check if the wrong agent wrote it
- When designing new data flows between agents

## Anti-Patterns

- ❌ Content-editor writing directly to `data/meals/` (not its domain)
- ❌ Task-coach creating files in `data/finance/` (delegate to finance-manager)
- ❌ Any agent modifying another agent's `core.md` or `working.md`
- ❌ Creating data files without knowing which agent owns that folder

## Consuming Agents

- ALL agents that write to `data/` (governance check)
- `platform-manager` — enforces boundaries
- `context-auditor` — detects violations
- `skill-optimizer` — validates during audits
