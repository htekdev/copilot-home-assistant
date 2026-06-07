---
name: client-proposal
description: >
  Client proposal generation on {{PERSONAL_DOMAIN}} — create branded, password-gated proposal
  pages with phased scope, pricing, timelines, and shareable URLs. Use when user says
  "create proposal", "client proposal", "write proposal", "proposal for [name]",
  "new proposal", "send proposal", "build proposal page", "proposal draft",
  "update proposal", "revise proposal", or any client proposal activity.
---

# Client Proposal Skill

This skill enables any agent to create professional, branded client proposals hosted on {{PERSONAL_DOMAIN}}. Proposals are full Astro pages with password protection, dark-themed design, and shareable URLs — replacing generic PDF proposals with an interactive web experience that reinforces {{PARENT_1}}'s brand.

## Reference Implementation

The canonical example is the **Blackout Pickleball** proposal:
- **File:** `src/pages/proposals/blackout-pickleball.astro` in `{{GITHUB_USERNAME}}/htek-dev-site`
- **URL:** `https://{{PERSONAL_DOMAIN}}/proposals/blackout-pickleball`
- **Features:** Password gate, table of contents, phased scope, timeline, investment breakdown, terms, "Why {{GITHUB_USERNAME}}" section

---

## Critical Rules — Read These First

1. **Every proposal is a standalone Astro page** at `src/pages/proposals/{client-slug}.astro`. The slug is lowercase-hyphenated from the client/project name (e.g., `blackout-pickleball`, `ahis-consulting`).

2. **Password-gated by default.** All proposals include a client-side password gate so only the intended recipient can view. The password is shared with the client separately (via Telegram, email, or call).

3. **noindex, nofollow.** Proposals are NEVER indexed by search engines. Always include `<meta name="robots" content="noindex, nofollow" />`.

4. **Brand consistency.** Use {{PERSONAL_DOMAIN}}'s existing design system — dark theme (`bg-bg-void`, `bg-bg-surface`), accent colors (`accent-cyan`, `accent-violet`, `accent-green`, `accent-rose`), and Tailwind utility classes.

5. **Data-driven structure.** Define proposal data as typed arrays/objects in the Astro frontmatter, then render with `.map()`. This keeps content separate from markup and makes revisions trivial.

6. **Premium positioning.** Proposals reflect {{PARENT_1}}'s premium pricing strategy. Present value first, investment second. Frame costs as "investment" not "cost/price."

7. **Mobile-first.** Proposals must look excellent on mobile — clients often view them from their phone immediately after receiving the link.

8. **Lead folder integration.** When creating a proposal, update the corresponding lead folder at `data/projects/leads/{slug}/` with proposal status, URL, and pricing in `opportunity.md`.

9. **Versioning via git.** Revisions are tracked through git commits on the htek-dev-site repo. Major revisions can be noted in the proposal number (e.g., `#BP-2026-001` → `#BP-2026-002`).

10. **Always create a follow-up task** after generating a proposal — "Follow up with [client] on proposal" with a due date 2-3 days out.

11. **NEVER suggest Zapier, Make.com, or any no-code automation platform.** {{PARENT_1}} is a senior developer. All integrations should be raw code (Vercel serverless, AWS, custom scripts). No-code tools are never appropriate for his proposals.

12. **Technical spec BEFORE proposal.** For any project with custom development, create a technical spec (`data/specs/{slug}-v1.md`), get it reviewed by multiple models, and resolve architecture decisions BEFORE generating the proposal page. The proposal should reflect DECIDED architecture, not open questions.

---

## Proposal Structure — Lean Default (4 Sections)

**DEFAULT: Use the lean 4-section format.** This is what closes deals. Clients don't want to read 10 pages — they want to understand scope, cost, dependencies, and how to start.

| # | Section | What it answers |
|---|---------|-----------------|
| 1 | What am I going to build? | Scope — clear bullet points of deliverables + timeline estimate |
| 2 | How much does it cost? | Pricing — build fee, payment split, optional retainer |
| 3 | What services do we need? | Third-party costs — what client already pays vs. new costs |
| 4 | How do we start? | Next steps — payment, logins, scheduling, "work starts same day" |

### Tone & Style
- **Conversational** — like texting a friend who happens to be a developer
- **Scannable** — bullet points, short sentences, minimal tables
- **No fluff** — no "Why {{GITHUB_USERNAME}}", no numbered badges, no corporate jargon
- **Readable in under 2 minutes** — if it takes longer, cut more
- **One clear CTA** — "Questions? Text me or reply to this message."

### When to use the FULL format (10+ sections)

Only for **enterprise/complex projects** where:
- Multiple stakeholders need different levels of detail
- The project is >$15K and requires formal approval workflows
- The client explicitly asks for a detailed breakdown
- There are regulatory/compliance requirements

For most of {{PARENT_1}}'s clients (friends, referrals, small businesses), the lean format is correct.

> **Lesson learned (CarPlay Mobile Detail, May 2026):** The original 10-section proposal with badges, TOC, and corporate structure gave {{PARENT_1}} anxiety just reading it. Simplified to 4 sections → deal closed same day. Simpler = higher close rate.

### Legacy Full Structure (use only when justified)

| # | Section | Purpose |
|---|---------|---------|
| 00 | Table of Contents | Navigation overview |
| 01 | Executive Summary | What + why |
| 02 | Scope of Work | Detailed deliverables |
| 03 | Customer/User Experience | Flow/journey |
| 04 | Timeline & Milestones | Delivery plan |
| 05 | Technology | Tech stack |
| 06 | Investment | Pricing |
| 07 | What I Need From You | Client prerequisites |
| 08 | Terms & Ownership | Payment terms, IP |
| 09 | Why {{GITHUB_USERNAME}} | Differentiators |

---

## Pre-Proposal Workflow — Budget Discovery + Clarification Questions (MANDATORY)

**CRITICAL: Do NOT jump straight to building a proposal after a scope call.** Before creating any proposal page, the agent MUST complete TWO mandatory gates: Budget Discovery first, then Clarification Questions. This prevents scoping to $59K and discovering the client has a $5K/year IT budget.

> **Lesson learned (Surgikweep, June 2026):** {{PARENT_1}} spent 2 days building a $59K proposal, only to learn on a follow-up call that the client's entire annual IT budget was ~$5K. This caused painful restructuring: $59K → $20K → phased $3K-$7K chunks. The root cause was scoping BEFORE understanding budget constraints. **The correct order is: Discovery → Budget Qualification → Scope to Budget → Proposal.**

---

## Step 0: Budget Discovery (MANDATORY — runs BEFORE clarification questions)

**STOP. Do not write a single line of proposal code until budget constraints are documented.**

After any discovery/scope call, if budget has NOT been explicitly stated, ask {{PARENT_1}} these questions first:

### Budget Discovery Questions (send as one Telegram message)

```
💰 Before I scope this out, need to nail down their budget first — learned this the hard way:

1. What's their current IT/tech budget (annual or monthly)?
2. What's a comfortable monthly investment for them?
3. Who approves purchases over $X? (owner, board, finance team?)
4. Have they budgeted specifically for this project?
5. Any signals from the call — did they mention price sensitivity, past vendor costs, or a number range?

This shapes the whole proposal. Takes 30 seconds but saves days of rework.
```

### What to Do With the Answer

| Budget Signal | Action |
|--------------|--------|
| Explicit number stated | Document in `opportunity.md` → `Budget Constraints` → proceed |
| "Tight budget" / "small business" | Probe: ask for a range. Never assume. |
| "We have budget" / "Not a concern" | Still document the range — "not a concern" ≠ any number |
| {{PARENT_1}} says "just build it" | Flag assumption clearly in lead folder, build to phased $3K-$5K entry option first |
| No answer available yet | **Do not build proposal.** Create task to follow up on budget before scoping. |

### Where to Document Budget

Write confirmed budget data to `data/projects/leads/{slug}/opportunity.md` under **Budget Constraints** before proceeding. This is the gate — if that section is empty, scoping hasn't started.

---

### When to Ask Clarification Questions

After Budget Discovery is complete and documented, THEN ask clarification questions about scope details:

### Required Clarification Categories

Ask {{PARENT_1}} about ALL of these before building:

1. **Dependencies & Large Scope Items**
   - Are there any scope items that depend on third-party services or accounts?
   - Any items that are significantly larger than others and should be called out?
   - Any scope items that could be phased or made optional?

2. **Hosting & Infrastructure Mechanics**
   - What hosting is recommended? (Keep existing? Migrate? Who pays?)
   - Are there infrastructure costs the client needs to understand?
   - Who manages DNS, SSL, CDN, etc.?

3. **Third-Party Costs to Itemize**
   - Are there recurring costs beyond {{PARENT_1}}'s fee? (e.g., Twilio, API subscriptions, domain renewal)
   - Should these be listed separately in the Investment section?
   - Does the client pay these directly or does {{PARENT_1}} bundle them?

4. **"What's Required to Get Started" Details**
   - What credentials/logins does {{PARENT_1}} need before starting?
   - What accounts does the client need to create?
   - What's the initial payment required?
   - What's the trigger that starts the clock? (payment received? assets received?)

5. **Pricing Validation**
   - Is the estimated value range correct?
   - Any adjustments based on scope complexity discovered during the call?
   - Split structure (50/50, full upfront, milestone-based)?

### How to Ask

Create a single structured message to {{PARENT_1}} via Telegram:
```
🔍 Before I build the proposal for [Client], quick clarifications:

1. Dependencies: [specific question about this client]
2. Hosting: [specific question]
3. Third-party costs: [list potential ones, ask which to include]
4. To get started: [what do you need from client before work begins?]
5. Pricing: [confirm range/split]

Reply when ready and I'll build it.
```

### What Happens Next

- **If {{PARENT_1}} answers** → Incorporate into proposal, then build
- **If {{PARENT_1}} says "just build it"** → Build with best available info, but flag assumptions clearly in the lead folder
- **If time-sensitive** (deadline promised to client) → Flag the deadline, still ask, but offer to build a draft while waiting for answers

### Anti-Pattern

❌ Receiving a scope call transcript → immediately building the proposal → finding out later it's missing costs, has wrong pricing, or doesn't match {{PARENT_1}}'s intent. This is what happened with the CarPlay Mobile Detail proposal (May 6, 2026) and must never happen again.

---

## Full Pipeline — The Correct Order (MANDATORY)

```
Discovery Call → Budget Discovery (Step 0) → Clarification Questions → Technical Spec → Multi-Model Review → Proposal Generation
```

> **Anti-Pattern:** Discovery Call → Scope → Build $59K Proposal → Find out budget is $5K → Restructure for 2 days. This happened with Surgikweep (June 2026). Never again.

### Step 0: Budget Discovery (BEFORE EVERYTHING — see above)

Ask budget questions, document constraints in `opportunity.md`. Do not proceed until this is done.

### Step 0.5: Technical Spec (BEFORE any proposal code)

After clarification questions are answered, create a **Technical Spec** at `data/specs/{client-slug}-v1.md` that covers:
- Problem statement & goals
- Architecture & tech stack decisions (with rationale)
- Integration details (how each piece connects)
- Third-party costs (validated, with conditional items)
- Timeline with dependencies and blocker mitigations
- What's required from client (phased by timeline)
- Pricing recommendation with market comparison
- Risks & mitigations table
- Success metrics

**Then launch 3 parallel code-review agents** (different models) to validate:
- Technical feasibility
- Cost accuracy (are there hidden fees? missing licenses?)
- Timeline realism
- Integration risks and fallback plans
- Pricing validation

**Only after the spec is reviewed and findings are incorporated** do you proceed to build the proposal page. The proposal is a CLIENT-FACING SUMMARY of the reviewed spec — not a first draft.

### Why This Matters

The spec catches errors BEFORE the client sees them:
- WPForms webhooks aren't free (caught in CarPlay review)
- SMS by Zapier has carrier restrictions (caught in CarPlay review)  
- LiteSpeed may not be available on HostGator shared (caught in CarPlay review)
- Content dependency needs interview approach, not "client creates" (caught in CarPlay review)

Without the spec review, these would have been embarrassing corrections after the client already read the proposal.

---

## Technical Process — Creating a New Proposal

### Step 0: Budget Discovery (see Pre-Proposal Workflow above — MANDATORY FIRST GATE)

Ask {{PARENT_1}} the budget discovery questions. Document in `opportunity.md → Budget Constraints`. No scoping or proposals until this section is populated.

### Step 1: Clarification Questions (see Pre-Proposal Workflow above)

Ask {{PARENT_1}} clarification questions about dependencies, hosting, third-party costs, and "what's needed to start." Only proceed to Step 2 after getting answers (or explicit "just build it").

### Step 1.5: Technical Spec + Review (see Full Pipeline above)

Create the spec, run multi-model review, incorporate findings. Only then proceed to building the proposal page.

### Step 2: Gather Client Information

Before writing code, collect from the lead folder or directly from {{PARENT_1}}:
- Client/brand name and contact person
- Project description and goals
- Target launch date
- Budget range (or let {{PARENT_1}} set pricing)
- Any domain/hosting details
- Brand assets (logo, colors, existing site)
- **Third-party costs** (hosting, APIs, subscriptions the client will pay)
- **What's needed to start** (credentials, accounts, initial payment)

### Step 3: Create the Proposal File

Create `src/pages/proposals/{client-slug}.astro` in the `{{GITHUB_USERNAME}}/htek-dev-site` repo.

**DEFAULT: Use the lean 4-section template (see "Proposal Structure — Lean Default" above).**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Navbar from '../../components/Navbar.astro';
import Footer from '../../components/Footer.astro';

const pageTitle = 'Proposal — {Project Title}';
const pageDescription = 'Private proposal for {Client}.';
const PROPOSAL_PASSWORD = '{password}';
---

<BaseLayout title={pageTitle} description={pageDescription}>
  <Fragment slot="head">
    <meta name="robots" content="noindex, nofollow" />
  </Fragment>

  <div class="min-h-screen bg-bg-void">
    <!-- Password Gate (same pattern as carplay-mobile-detail) -->
    <div id="proposal-gate" class="fixed inset-0 z-[999] flex items-center justify-center bg-bg-void">
      <!-- Gate UI -->
    </div>

    <!-- Proposal Content (hidden until authenticated) -->
    <div id="proposal-content" class="hidden">
      <Navbar />
      <main class="mx-auto max-w-3xl px-6 pb-20 pt-28">
        <!-- Section 1: What am I going to build? -->
        <!-- Section 2: How much does it cost? -->
        <!-- Section 3: What services do we need? -->
        <!-- Section 4: How do we start? -->
        <!-- Footer CTA: "Questions? Text me..." -->
      </main>
      <Footer />
    </div>
  </div>
</BaseLayout>
```

**Reference implementation:** `src/pages/proposals/carplay-mobile-detail.astro` (May 2026 — lean format)

For the legacy full format (enterprise/complex only), see the expanded template below:

    <!-- Proposal Content (hidden until authenticated) -->
    <div id="proposal-content" class="hidden">
      <Navbar />
      <main id="main-content" class="pb-20 pt-24">
        <!-- Sections rendered from data arrays -->
      </main>
      <Footer />
    </div>
  </div>
</BaseLayout>

<script>
  // Client-side password check
  const PROPOSAL_PASSWORD = '{password}';
  // Gate logic: show content on correct password, persist in sessionStorage
</script>
```

### Step 3: Design Patterns

**Section Header Pattern:**
```html
<div class="flex items-center gap-3">
  <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent-cyan text-sm font-bold text-white">{number}</span>
  <div>
    <p class="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">{subtitle}</p>
    <h2 class="font-heading text-2xl font-bold text-text-primary">{title}</h2>
  </div>
</div>
```

**Card Grid Pattern (Scope, Tech):**
```html
<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {items.map((item) => (
    <div class="rounded-xl border border-border-default bg-bg-overlay p-5">
      <span class="text-2xl">{item.icon}</span>
      <h3 class="mt-2 font-semibold text-text-primary">{item.title}</h3>
      <p class="mt-1 text-sm text-text-secondary">{item.description}</p>
    </div>
  ))}
</div>
```

**Timeline Pattern:**
```html
{timelineItems.map((item) => (
  <div class={`rounded-xl border p-5 ${item.launch ? 'border-accent-green bg-accent-green/10' : 'border-border-default bg-bg-overlay'}`}>
    <p class="font-mono text-xs text-accent-cyan">{item.day}</p>
    <h3 class="mt-1 font-semibold text-text-primary">{item.title}</h3>
    <p class="mt-1 text-sm text-text-secondary">{item.description}</p>
  </div>
))}
```

**Investment Section Pattern:**
```html
<!-- Two-column: Build Fee (one-time) + Retainer (monthly) -->
<div class="grid gap-6 md:grid-cols-2">
  <div class="rounded-2xl border border-border-default bg-bg-overlay p-6">
    <p class="font-mono text-xs text-accent-cyan">One-Time Build</p>
    <p class="mt-2 text-4xl font-bold text-text-primary">$X,XXX</p>
    <ul class="mt-4 space-y-2 text-sm text-text-secondary">
      {buildIncludes.map((item) => <li>✓ {item}</li>)}
    </ul>
  </div>
  <div class="rounded-2xl border border-accent-cyan/30 bg-accent-cyan/5 p-6">
    <p class="font-mono text-xs text-accent-cyan">Monthly Retainer</p>
    <p class="mt-2 text-4xl font-bold text-text-primary">$XXX<span class="text-lg text-text-muted">/mo</span></p>
    <ul class="mt-4 space-y-2 text-sm text-text-secondary">
      {retainerIncludes.map((item) => <li>✓ {item}</li>)}
    </ul>
  </div>
</div>

<!-- Third-party costs (ALWAYS include if applicable) -->
<div class="rounded-xl border border-border-default bg-bg-overlay p-5 mt-6">
  <p class="font-mono text-xs text-accent-cyan">Third-Party Costs (paid by you directly)</p>
  <ul class="mt-3 space-y-2 text-sm text-text-secondary">
    {thirdPartyCosts.map((item) => <li>{item.service}: {item.cost} — {item.description}</li>)}
  </ul>
</div>
```

**Investment Section MUST include (per {{PARENT_1}}'s May 6, 2026 feedback):**
- {{PARENT_1}}'s fee clearly separated from third-party costs
- Any recurring costs the client will pay directly (hosting, APIs, subscriptions)
- A "What's Required to Get Started" subsection or link to that section
- Large scope items called out with justification for their cost contribution

### Step 4: Password Gate Script

```html
<script>
  const PROPOSAL_PASSWORD = 'client-chosen-password';
  const STORAGE_KEY = 'proposal-{slug}-auth';

  function unlock() {
    document.getElementById('proposal-gate')?.remove();
    document.getElementById('proposal-content')?.classList.remove('hidden');
    sessionStorage.setItem(STORAGE_KEY, 'true');
  }

  if (sessionStorage.getItem(STORAGE_KEY) === 'true') {
    unlock();
  }

  document.getElementById('proposal-gate-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('proposal-password') as HTMLInputElement;
    if (input.value === PROPOSAL_PASSWORD) {
      unlock();
    } else {
      document.getElementById('proposal-gate-error')?.classList.remove('hidden');
    }
  });
</script>
```

### Step 5: Deploy & Share

1. **Commit** the new proposal file to `{{GITHUB_USERNAME}}/htek-dev-site` main branch
2. **Vercel auto-deploys** — the site rebuilds on push to main
3. **URL format:** `https://{{PERSONAL_DOMAIN}}/proposals/{client-slug}`
4. **Share** the URL + password with the client via Telegram, text, or email
5. **Update lead folder** with proposal URL and status

---

## Workflow for Revisions

1. Edit the data arrays in the frontmatter (not the markup)
2. Commit with message: `proposal({slug}): revise {what changed}`
3. Vercel auto-deploys the update
4. Notify client: "I've updated the proposal — same link, refresh to see changes"
5. If major revision, bump the proposal number in the header

---

## Branding & Styling Guidelines

| Element | Value |
|---------|-------|
| Background (primary) | `bg-bg-void` (deepest dark) |
| Background (sections) | Alternate `bg-bg-void` and `bg-bg-surface` |
| Accent color (primary) | `accent-cyan` — headings, numbers, highlights |
| Accent color (success) | `accent-green` — launch dates, positive callouts |
| Accent color (warning) | `accent-rose` — alerts, gate errors |
| Typography (headings) | `font-heading` (bold, tight tracking) |
| Typography (labels) | `font-mono text-xs uppercase tracking-[0.25em]` |
| Typography (body) | `text-text-secondary` with `leading-7` or `leading-8` |
| Cards | `rounded-xl border border-border-default bg-bg-overlay p-5` |
| Highlight boxes | `rounded-xl border border-accent-cyan/30 bg-accent-cyan/10 p-4` |
| Section spacing | `py-24 md:py-32` between major sections |
| Max width | `max-w-5xl mx-auto px-6` for content container |

### Animations

Add `fade-in` class to sections for scroll-triggered reveal. The site's global CSS handles the animation.

---

## Integration with Leads Manager Skill

When a proposal is created:
1. Update `data/projects/leads/{slug}/opportunity.md` with:
   - Proposal URL
   - Pricing quoted
   - Date sent
   - Status: "proposal_sent"
2. Update `data/projects/leads/_index.md` pipeline stage
3. Create follow-up task via `add_task`:
   - Title: "Follow up with {client} on proposal"
   - Due: 2-3 business days after sending
   - Category: "errand"
   - Assignee: "{{PARENT_1}}"

---

## Anti-Patterns (NEVER do these)

- ❌ Sending a PDF proposal — always use the hosted page
- ❌ Making proposals publicly accessible (no password gate)
- ❌ Using generic template sites (Canva, Notion, Google Docs) — {{PERSONAL_DOMAIN}} IS the brand
- ❌ Hardcoding content in HTML — always use data arrays in frontmatter
- ❌ Allowing search engine indexing of proposals
- ❌ Quoting prices without context/value framing ("Investment" section should sell the value first)
- ❌ Forgetting to update the lead folder after sending
- ❌ Creating proposals without a follow-up task

---

## Checklist — Before Sending to Client

- [ ] Password gate works (test with correct + incorrect passwords)
- [ ] Mobile layout looks clean (test at 375px width)
- [ ] All links work (domain, external references)
- [ ] `noindex, nofollow` meta tag present
- [ ] Proposal number is unique and formatted correctly
- [ ] Investment section clearly states payment terms
- [ ] "What I Need From You" section has actionable items with links
- [ ] Terms section covers IP ownership, cancellation, and ongoing support
- [ ] Lead folder updated with proposal URL and pricing
- [ ] Follow-up task created
