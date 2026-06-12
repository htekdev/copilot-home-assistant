# 🏠 Copilot Home Assistant

**An autonomous AI home assistant powered by GitHub Copilot CLI + Telegram.**

A multi-agent system that manages your family's daily life — tasks, calendars, meals, shopping, finances, health, home maintenance, and more. It runs on the [new standalone GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-for-common-tasks/use-copilot-in-the-cli) (v1.0+), communicates through Telegram, and operates autonomously on scheduled cron jobs.

> **This is a real system.** It was built and battle-tested by a family of four (soon five) to run their household. It's not a demo — it's been managing groceries, paying bill reminders, coordinating schedules, tracking home maintenance, coaching productivity, and sending morning briefings every day.

> **⚠️ CLI Version:** This system requires the **new standalone GitHub Copilot CLI** (`copilot` command, v1.0+). It does **not** use the old deprecated `gh copilot` GitHub CLI extension. If you were using the old extension, you'll need to [migrate to the new CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-for-common-tasks/use-copilot-in-the-cli#replacing-the-retired-copilot-extension) — this system is already built for the new version.

---

## 🎯 What Does It Do?

- **☀️ Morning briefings** — Weather, calendar, tasks, emails, meals, bills, and health reminders delivered to Telegram at 6 AM
- **📋 Task management** — ADD-friendly productivity coaching that nudges you one task at a time
- **🍽️ Meal planning** — Weekly meal plans, recipe management, auto-generated grocery lists
- **💰 Budget tracking** — Expense logging, bill tracking, monthly budget reviews
- **🏠 Home maintenance** — Scheduled maintenance reminders, service provider directory
- **📅 Calendar & scheduling** — Google Calendar integration, event creation, conflict detection
- **📧 Email triage** — Gmail scanning, action item extraction, bill detection
- **🐕 Pet care** — Feeding schedules, vet appointments, medication tracking
- **👶 Health tracking** — Medical appointments, medications, family health goals
- **🎓 Education** — Lesson plans, curriculum tracking, progress milestones for kids
- **📱 Telegram bridge** — Two-way communication: text, voice notes, photos, videos
- **📺 Content pipeline** — Social media scheduling, video analysis, content management
- **🤖 Self-healing** — Platform agent monitors system health, proposes improvements nightly

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Telegram Bridge                     │
│          (two-way communication with family)           │
└──────────────┬───────────────────────┬───────────────┘
               │                       │
┌──────────────▼───────────────────────▼───────────────┐
│                 GitHub Copilot CLI                     │
│           (orchestrates everything)                    │
└──────┬────────┬────────┬────────┬────────┬───────────┘
       │        │        │        │        │
┌──────▼──┐ ┌──▼───┐ ┌──▼───┐ ┌──▼───┐ ┌──▼────────┐
│  Agents  │ │ Ext  │ │ Cron │ │ Data │ │Constitution│
│ (17 .md) │ │(16)  │ │ Jobs │ │ (JSON│ │ & Standing │
│          │ │      │ │      │ │  /MD) │ │  Orders    │
└──────────┘ └──────┘ └──────┘ └──────┘ └───────────┘
```

### Core Components

| Component | What It Is | Where It Lives |
|-----------|-----------|----------------|
| **Agents** | Markdown files that define AI personas with domain expertise | `.github/agents/*.agent.md` |
| **Extensions** | Node.js modules that give agents tools (Telegram, Calendar, Budget, etc.) | `.github/extensions/*/extension.mjs` |
| **Cron Jobs** | Scheduled tasks that run agents automatically | `cron.json` |
| **Constitution** | Core rules that govern ALL agent behavior | `data/constitution.md` |
| **Standing Orders** | Learned behaviors and family-specific rules (grows over time) | `data/standing-orders.md` |
| **Family Data** | JSON profiles for each family member | `data/family/*.json` |
| **Agent Memory** | Persistent knowledge each agent accumulates | `data/agents/*-memory.md` |

### How It Works

1. **Telegram Bridge** runs as a background process, forwarding messages to/from Copilot CLI
2. **Cron Scheduler** triggers agents on schedule (morning briefings, heartbeats, weekly reviews)
3. **Agents** are Markdown files that define an AI persona — they read the constitution, load their memory, do their job, and save what they learned
4. **Extensions** provide tools — `telegram_send_message`, `gcal_create_event`, `add_expense`, `set_meal`, etc.
5. **Every correction is permanent** — when you correct the system, it persists the lesson to memory, standing orders, AND copilot-instructions so it never repeats the mistake

---

## 🚀 Quick Start

### Prerequisites

- **[GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-for-common-tasks/use-copilot-in-the-cli)** (v1.0+) — the new **standalone** `copilot` binary. This system does **not** use the old deprecated `gh copilot` extension. If you previously used the extension, [follow the migration guide](https://docs.github.com/en/copilot/how-tos/use-copilot-for-common-tasks/use-copilot-in-the-cli#replacing-the-retired-copilot-extension). Requires a GitHub Copilot subscription.
- [Node.js](https://nodejs.org/) 20+
- A [Telegram Bot](https://core.telegram.org/bots#how-do-i-create-a-bot) (free, takes 2 minutes)
- Optionally: Google Cloud project for Calendar/Gmail/Maps integration

### 1. Clone and Configure

```bash
git clone https://github.com/YOUR_USERNAME/copilot-home-assistant.git
cd copilot-home-assistant
cp .env.example .env
```

### 2. Set Up Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token into `.env` as `TELEGRAM_BOT_TOKEN`
4. Message your new bot — it will print your chat ID
5. Add your chat ID to `TELEGRAM_ALLOWED_USERS` in `.env`

### 3. Customize for Your Family

Edit these files with your family's details:

```
data/family/person1.json    ← Primary parent profile
data/family/person2.json    ← Spouse/partner profile  
data/family/child1.json     ← Child profile (duplicate for more kids)
data/constitution.md        ← Family rules and communication preferences
data/standing-orders.md     ← Specific behavioral rules
data/locations.json         ← Frequently visited places
```

**Search and replace these placeholders** across the repo:
- `{YourName}` → Your first name
- `{Spouse}` → Spouse/partner's name
- `{ChildName}` → Child's name
- `{YourLastName}` → Family last name
- `YOUR_TELEGRAM_USER_ID` → Your Telegram user ID
- `SPOUSE_TELEGRAM_USER_ID` → Spouse's Telegram user ID
- `{your-github-org}` → Your GitHub username or org

### 4. Enable Google Integration (Optional)

For Gmail, Calendar, and Tasks:

1. Create a project at [Google Cloud Console](https://console.cloud.google.com/)
2. Enable Gmail, Calendar, and Tasks APIs
3. Create OAuth 2.0 credentials (Desktop app)
4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env`
5. Run `copilot` and use the `google_auth_url` tool to authenticate

### 5. Start the Assistant

```bash
# Start the GitHub Copilot CLI with the Telegram bridge
copilot

# The cron scheduler and Telegram bridge will start automatically
# via the extensions in .github/extensions/
```

### 6. Enable Cron Jobs

Edit `cron.json` to enable/disable scheduled agents:

```json
{
  "timezone": "America/Chicago",
  "jobs": [
    {
      "id": "morning-briefing",
      "schedule": "0 6 * * 1-5",
      "enabled": true,
      "agent": "daily-briefing"
    }
  ]
}
```

---

## 🤖 Agent Catalog

### Domain Agents (persistent knowledge holders)

These agents **own** a specific area of family life. They load memory, make decisions, and learn over time.

| Agent | Domain | What It Does |
|-------|--------|-------------|
| 🐕 **dog-parent** | Pet care | Feeding schedules, vet appointments, medications, grooming, behavioral notes |
| 👨‍👩‍👧 **family-coordinator** | Scheduling | Family calendar, activity schedules, babysitter coordination, event planning |
| 💰 **finance-manager** | Money | Budget tracking, bill payments, expense categorization, savings goals, debt management |
| ❤️ **health-coach** | Health | Medical appointments, medications, health goals, pregnancy tracking |
| 🏠 **home-manager** | Home | Maintenance schedules, service providers, repairs, appliances, yard work |
| 🍳 **nutrition-chef** | Food | Meal planning, recipes, grocery lists, dietary preferences per family member |
| 🎓 **teacher** | Education | Lesson plans, curriculum tracking, session logging, progress milestones |
| 💻 **coding-agent** | Development | Repository management, code review, CI/CD monitoring, technical debt |
| 📺 **content-manager** | Content | Content pipeline, social media, video analysis, editorial calendar |
| ⚡ **task-coach** | Productivity | ADD-friendly task nudges — one task at a time, momentum tracking |
| 🔧 **platform-manager** | System | Self-monitoring — tracks all agents, extensions, configs. Proposes improvements nightly |

### Task Agents (scheduled procedures)

These agents run on a schedule, execute numbered steps, and send reports.

| Agent | Schedule | What It Produces |
|-------|----------|-----------------|
| ☀️ **daily-briefing** | 6 AM weekdays, 8 AM weekends | Morning briefing with weather, calendar, tasks, emails, meals, bills |
| 📊 **budget-review** | 1st of each month | Monthly spending summary, budget vs actual, trends, recommendations |
| 🍽️ **meal-planner** | Saturday 10 AM | Interactive meal planning session, prompts for weekly menu |
| 📋 **weekly-planner** | Sunday 7 PM | Week review — calendar, tasks, meals, priorities for the week ahead |
| 💓 **heartbeat** | Every 30 min | Background monitor — email scan, calendar reminders, task nudges |
| 🔄 **checkin** | Every 30 min | Orchestrator — delegates to all domain agents, compiles reports |

---

## 🧩 Extension Catalog

Extensions give agents their **tools** — each one adds capabilities the AI can call.

| Extension | Tools Provided | What It Enables |
|-----------|---------------|----------------|
| 📱 **telegram-bridge** | `telegram_send_message`, `telegram_send_photo`, `telegram_get_status` | Two-way Telegram communication (text, voice, photos, video) |
| ⏰ **cron-scheduler** | `cron_list_jobs`, `cron_next_run` | Automated agent scheduling |
| 📋 **action-tracker** | `add_task`, `list_tasks`, `update_task`, `complete_task`, `task_summary` | Task management with priorities, assignees, dependencies |
| 🚀 **agent-launcher** | `launch_agent`, `list_agents_on_disk` | Dynamic agent discovery and delegation |
| ❓ **ask-via-telegram** | `ask_user` | Routes confirmation prompts to Telegram instead of CLI |
| 💾 **auto-commit** | Auto-saves data changes | Automatic git commits when data files change |
| 💰 **budget-tracker** | `add_expense`, `add_income`, `budget_summary`, `set_budget`, `budget_vs_actual`, `add_recurring_bill`, `upcoming_bills` | Full budget management with bill tracking |
| 👨‍👩‍👧 **family-data** | `get_family_member`, `list_family`, `update_family_member`, `get_preferences`, `who_is_asking` | Family profile management, multi-user identification |
| 🗺️ **google-maps** | `get_drive_time`, `get_directions`, `plan_route` | Drive times, directions, multi-stop route optimization |
| 📧 **google-services** | `gmail_search`, `gmail_read`, `gmail_send`, `gcal_today`, `gcal_upcoming`, `gcal_create_event`, `gtasks_list`, `gtasks_add` | Gmail, Google Calendar, Google Tasks |
| 🏠 **home-maintenance** | `add_maintenance_task`, `maintenance_due`, `log_maintenance`, `add_service_provider`, `find_provider`, `maintenance_summary` | Home maintenance scheduling and service provider directory |
| 📺 **late-api** | `late_create_post`, `late_list_posts`, `late_get_queue`, etc. (18 tools) | Social media scheduling across 14 platforms via Late/Zernio |
| 📍 **locations** | `add_location`, `find_location`, `update_location`, `set_home_address` | Saved places for navigation and references |
| 🍽️ **meal-planner** | `set_meal`, `get_meal_plan`, `add_recipe`, `search_recipes`, `get_recipe`, `generate_grocery_list` | Meal planning, recipe management, grocery list generation |
| 🛒 **shopping-list** | `add_to_shopping_list`, `shopping_list`, `check_off_item`, `remove_from_list`, `clear_shopping_list`, `shopping_history` | Family shopping list with categories, stores, and purchase history |
| 📹 **video-analyzer** | `analyze_video` | Gemini AI video analysis for content creation |

---

## 📐 Creating Your Own Agents

### Domain Agent (owns a topic)

Copy the template and fill in the placeholders:

```bash
cp .github/agents/templates/domain-agent-template.md .github/agents/my-agent.agent.md
```

Key sections:
- **Constitution** — Every agent reads the family constitution first
- **Memory** — Loads/saves persistent knowledge between runs
- **Domain Ownership** — What this agent is responsible for
- **Decision Framework** — What to do immediately vs. ask first
- **Integration Points** — How this agent collaborates with others

### Task Agent (runs on schedule)

```bash
cp .github/agents/templates/task-agent-template.md .github/agents/my-task.agent.md
```

Then add it to `cron.json`:

```json
{
  "id": "my-task",
  "schedule": "0 9 * * 1",
  "enabled": true,
  "agent": "my-task"
}
```

### Tips for Good Agents

1. **Be specific** — "You are the family's pet care manager" beats "You help with pets"
2. **Define boundaries** — What does this agent own? What does it delegate?
3. **Set autonomy levels** — What should it do immediately vs. ask permission for?
4. **Include integration points** — How does it work with other agents?
5. **Use memory** — Agents that learn over time are the most useful

---

## 🔧 Creating Your Own Extensions

Extensions are Node.js ESM modules in `.github/extensions/{name}/extension.mjs`. They export a `getTools()` function:

```javascript
export function getTools() {
  return [
    {
      name: "my_tool",
      description: "What this tool does",
      parameters: {
        type: "object",
        properties: {
          param1: { type: "string", description: "First parameter" }
        },
        required: ["param1"]
      },
      run: async ({ param1 }) => {
        // Your tool logic here
        return { content: `Result: ${param1}` };
      }
    }
  ];
}
```

---

## 🏡 Customizing for Your Family

### What to Personalize

1. **Family profiles** (`data/family/*.json`) — Names, dietary preferences, medical info, schedules
2. **Constitution** (`data/constitution.md`) — Your family's rules for the AI
3. **Standing orders** (`data/standing-orders.md`) — Specific behavioral rules learned over time
4. **Locations** (`data/locations.json`) — Frequently visited places
5. **Cron schedule** (`cron.json`) — When agents run
6. **Agent files** — Remove agents you don't need, add ones you do

### Agents You Might Not Need

- `coding-agent` — Only if you're a developer managing repos
- `content-manager` — Only if you create content / manage social media
- `teacher` — Only if you have school-age kids
- `dog-parent` — Only if you have pets (rename to `pet-parent` if needed)

### Agents You Might Want to Add

- **garden-manager** — Track plant watering, seasonal planting, pest control
- **travel-planner** — Trip planning, packing lists, itineraries
- **car-manager** — Oil changes, tire rotations, registration renewals
- **holiday-planner** — Gift lists, party planning, decoration schedules

---

## 🧠 How the System Learns

The most powerful feature isn't any single agent — it's the **continuous learning loop**:

1. You correct the assistant ("Don't suggest recipes — I decide what to cook")
2. The correction is persisted to THREE places:
   - `store_memory` (cross-session memory)
   - `data/standing-orders.md` (behavioral rules)
   - `.github/copilot-instructions.md` (future sessions)
3. The mistake is never repeated
4. Over time, the system becomes deeply personalized to your family

This is captured in the constitution's Core Principle #4:
> *"Every correction is permanent. When you correct the system, persist the lesson. Never repeat the same mistake."*

---

## 📁 Project Structure

```
copilot-home-assistant/
├── .github/
│   ├── agents/                  # AI agent definitions
│   │   ├── templates/           # Templates for creating new agents
│   │   ├── daily-briefing.agent.md
│   │   ├── finance-manager.agent.md
│   │   ├── ... (17 agents)
│   │   └── platform-manager.agent.md
│   ├── extensions/              # Tool providers (Node.js)
│   │   ├── telegram-bridge/     # Telegram two-way communication
│   │   ├── cron-scheduler/      # Automated scheduling
│   │   ├── budget-tracker/      # Expense & income tracking
│   │   ├── ... (16 extensions)
│   │   └── video-analyzer/      # Gemini AI video analysis
│   └── copilot-instructions.md  # Global instructions for all sessions
├── data/
│   ├── agents/                  # Agent persistent memory files
│   ├── family/                  # Family member profiles (JSON)
│   ├── home/                    # Home maintenance & service providers
│   ├── budget/                  # Budget database (auto-created)
│   ├── meal-plans/              # Weekly meal plans (JSON)
│   ├── recipes/                 # Recipe collection (JSON)
│   ├── shopping-lists/          # Shopping list database (auto-created)
│   ├── constitution.md          # Core rules governing all agents
│   ├── standing-orders.md       # Learned behaviors & family rules
│   └── locations.json           # Saved places for navigation
├── cron.json                    # Scheduled agent jobs
├── .env.example                 # Environment variable template
├── .gitignore
├── LICENSE
└── README.md
```

---

## ⚡ Key Design Decisions

- **Agents are Markdown, not code.** Anyone can read, edit, and create agents — no programming required for the agent definitions.
- **Extensions are code, agents are prompts.** Clean separation between capabilities (what the AI *can* do) and behavior (what it *should* do).
- **Constitution → Standing Orders → Agent Instructions.** Three layers of governance, from universal rules down to per-agent behavior.
- **Memory is explicit.** Every domain agent reads a memory file at start and writes it at end. No magic — you can read the memory files to see what the system knows.
- **Corrections are permanent.** The system stores corrections in three places to ensure they survive across sessions.
- **Delegate, don't duplicate.** Each agent owns its domain. The `checkin` agent delegates to specialists — it doesn't try to check everything itself.

---

## 🤝 Contributing

This project is open source and contributions are welcome! Some areas where help would be appreciated:

- **New extensions** — Weather APIs, smart home integrations, fitness trackers
- **New agent templates** — Garden management, travel planning, vehicle maintenance
- **Documentation** — Guides, tutorials, and examples
- **Internationalization** — Adapting for non-English families

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

## 🙏 Credits

Built with the [new standalone GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-for-common-tasks/use-copilot-in-the-cli) — the AI that makes this entire system possible.

The agents, extensions, and architecture were designed and refined through daily use by a real family. Every feature exists because someone needed it.

---

*"Act first, report after. You are autonomous."* — The Constitution
