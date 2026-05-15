---
name: client-site-lifecycle
description: >
  Client website domain agent lifecycle — shared development workflow, code quality,
  progress page maintenance, standup/check-in reporting, and diminishing returns
  detection for Astro + Tailwind + Vercel client sites. Use when building or
  maintaining any client website domain agent (client-site-template-a, client-site-template-b, etc.).
---

# Client Site Lifecycle Skill

Reusable procedures for **client website domain agents** — autonomous agents that own a client's Astro + Tailwind + Vercel website from development through post-launch.

This skill captures the patterns shared across all client site agents. **Agent-specific content** (identity, mission, tech stack details, product spec, phase definitions, client-specific escalation) stays in the agent definition.

---

## Development Workflow (Branch + PR + Vercel Preview)

> **⚠️ MANDATORY:** All Vercel-connected client sites MUST use the `vercel-preview-workflow` skill (`.github/skills/vercel-preview-workflow/SKILL.md`) for deployment. **NEVER push directly to `main`** — main = production.

> **⚠️ Git Operations — MANDATORY:** NEVER use raw git commands in powershell. ALWAYS use dev-workflow extension tools. Hooks don't propagate to sub-agents (SDK v1.0.47).

Client websites use a branch + PR workflow with Vercel preview review:

1. **Load memory** → read `working.md` to understand current phase and next steps
2. **Pull latest** → `dev_checkout` to main, then `dev_pull`
3. **Create branch** → `start_dev_branch` with name `feat/{description}`
4. **Implement** → build the next feature/page in the repo
5. **Test locally** → `npm run build` — verify zero errors before pushing
6. **Push branch & create PR** → `dev_push` to push branch, then `create_vercel_pr` to create PR
7. **Wait for Vercel preview** → poll for Vercel bot comment with preview URL
8. **Send preview URL to {{PARENT_1}}** → Telegram with `speak` param, include PR + preview URLs
9. **Wait for approval** → {{PARENT_1}} reviews the live preview
10. **Merge** → `dev_merge_pr` after approval
11. **Update memory** → record progress in `working.md`, append `events.log`

### Rules
- 🚫 **NEVER push directly to `main`** — all changes go through branch + PR + Vercel preview review
- ⚠️ **Always run `npm run build` before pushing** — never break the preview build
- ✅ **Always send the Vercel preview URL to {{PARENT_1}}** — don't make him go find it
- ✅ **Wait for {{PARENT_1}}'s explicit approval** before merging
- For complex integrations (Stripe, Twilio, booking systems), delegate:
  - `task(agent_type="explore")` — research the integration
  - `task(agent_type="coding-agent")` — implement from research

> **Full workflow details:** See `vercel-preview-workflow` skill for polling commands, preview URL extraction, edge cases, and Telegram message templates.

---

## Code Quality Standards

All client sites follow these baseline standards:

- **Astro best practices** — minimal JS, static-first, islands for interactivity
- **Tailwind utility classes** — no custom CSS unless necessary
- **Semantic HTML** for accessibility and SEO
- **Mobile-first responsive design** — majority of traffic is mobile
- **Image optimization** — WebP format, lazy loading, proper sizing
- **Performance targets** — Lighthouse 90+ Performance, 95+ SEO, 90+ Accessibility

---

## Progress Page Maintenance

Every client project has a progress page hosted on **{{PERSONAL_DOMAIN}}** (not the client's site):

- **Pattern:** `src/pages/proposals/{project-slug}/progress.astro` in `{{GITHUB_USERNAME}}/personal-site`
- **URL:** `https://{{PERSONAL_DOMAIN}}/proposals/{project-slug}/progress`
- **Password-gated** — same password as the proposal

### Update Rules
1. After completing a deliverable → update item status to `'done'` in the `phases` array
2. After starting a new phase → set phase status to `'in-progress'`
3. Always update `lastUpdated` at the top of the file
4. Add new deliverables if scope expands — append to the relevant phase
5. Never remove completed items — they serve as a record of work done
6. Commit to `{{GITHUB_USERNAME}}/personal-site` (not the project repo)

---

## Standup / Check-in Reporting

### Morning Standup Format
```
{emoji} {Project Name} Standup — {date}

📊 Phase: {current phase} ({progress %})
✅ Yesterday: {what was accomplished}
🎯 Today: {what's planned}
🚧 Blockers: {any blockers, or "None"}
📈 Status: {on track / ahead / behind}
```

### Hourly Check-in Format (for sprint-mode projects)
```
{emoji} {Project Name} — {date} {time}

📊 Phase: {current phase} ({progress %})
✅ Last hour: {what was accomplished}
🎯 Next: {what's planned}
🚧 Blockers: {any blockers, or "None"}
```

### Reporting Rules
- Send to {{PARENT_1}} via Telegram (chat_id: `{{TELEGRAM_PARENT_1}}`)
- **ALWAYS use `speak` parameter** when messaging {{PARENT_1}}
- Keep reports concise — 5-8 lines max
- Be honest about blockers — escalate early
- During quiet hours (10 PM – 6 AM): work silently, no Telegram unless blocker

---

## Diminishing Returns Detection

After each work cycle, assess:
1. Am I making meaningful progress, or spinning on minor polish?
2. Have I been stuck on the same issue for 2+ cycles?
3. Does the product feel "complete enough" for client review?

**If diminishing returns detected** → send {{PARENT_1}} a summary of what's done and what's left, recommending a **client review checkpoint** before continuing.

---

## Phase Tracking

- Track progress against numbered phases defined in the agent
- Update `working.md` with phase transitions and milestone completions
- Each phase should have clear deliverables and completion criteria
- Move sequentially — don't skip phases unless explicitly directed

---

## Communication Rules (Client Projects)

- **Primary channel:** Telegram to {{PARENT_1}} (chat_id: `{{TELEGRAM_PARENT_1}}`, always `speak`)
- **Blockers only** outside standup/check-in windows — don't spam routine updates
- **Create tasks** for anything requiring human action ({{PARENT_1}} or the client)
- **No direct client communication** — always go through {{PARENT_1}}
- **Escalate costs, scope changes, and client decisions** to {{PARENT_1}}

---

## Autonomy Baseline

### Act Autonomously On
- All implementation decisions within the spec
- Component architecture and code organization
- Responsive design, performance, and accessibility
- Content placeholder text (until real content arrives)
- Git workflow (branch, commit, push to branch, create PR) — but follow `vercel-preview-workflow` skill
- SEO meta tags and social cards

### Always Escalate To {{PARENT_1}}
- Decisions requiring client input (real content, photos, account access)
- Domain DNS transfers (needs client's registrar access)
- Third-party account setup (API keys, payment providers)
- Vercel project creation and connection
- Any cost decisions
- Scope changes beyond the spec
- Direct client communication
