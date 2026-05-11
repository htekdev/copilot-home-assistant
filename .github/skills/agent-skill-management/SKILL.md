---
name: agent-skill-management
description: Agent/skill architecture management for a family assistant platform — find embedded procedures inside agents, extract reusable skills, detect contradictions between skills and agents, and refactor agents to reference skills safely. Use when user says "extract a skill", "skill audit", "should this be a skill", "refactor agent instructions", "find contradictions", or wants to reduce agent bloat.
---

# Agent Skill Management Skill

This skill teaches agents how to keep the platform's architecture clean: agents should own **identity, memory, autonomy, and context-heavy judgment**; skills should own **reusable procedures, workflows, and integration know-how**.

## Core Mental Model

- **Agent = WHO**
  - Persistent identity
  - Memory across runs (`core.md`, `working.md`, `long-term.md`)
  - Relationship context
  - Autonomy or mission ownership
  - Judgment that depends on accumulated context

- **Skill = HOW**
  - Reusable step-by-step procedure
  - Domain-specific workflow
  - Tool-use patterns and integration guidance
  - Stateless instructions portable across agents
  - Progressive disclosure instead of huge inline prompts

## Decision Framework — Should This Stay in the Agent?

Use this test before extracting anything.

### Keep it in the agent when ANY are true
1. The behavior depends on **persistent memory over time**
2. The behavior requires **personality, relationship, or trust context**
3. The behavior requires **scheduled autonomy** or ongoing monitoring
4. The quality of the decision depends on **accumulated context** rather than a fixed procedure
5. The content describes the agent's **mission, boundaries, escalation rules, or identity**

### Extract to a skill when MOST are true
1. The content is a **repeatable multi-step workflow**
2. The same procedure could help **2+ agents**
3. The instructions are mostly **tool usage, formatting rules, or integration steps**
4. The procedure can be followed without loading long-lived memory
5. The section is bloating the agent prompt without adding identity

### Fast scoring heuristic
Score each candidate 0 or 1 for the following:
- Reusable across agents
- Mostly procedural
- Low dependence on memory
- Low dependence on personality
- Easy to test deterministically

**4-5 = skill candidate**
**2-3 = hybrid; split procedure into a skill but keep judgment in the agent**
**0-1 = keep in the agent**

## What NOT to Turn into a Skill

Never extract:
- Agent identity/personality sections
- Relationship-specific guidance (e.g. a companion agent's voice or task-coach's parent-specific delivery style)
- Memory management rules tied to one agent's tiers
- Domain ownership boundaries that define who is responsible
- Cron-only autonomy instructions
- Decisions that require accumulated longitudinal context

## Skill Extraction Audit Workflow

### Phase 1 — Inventory candidates
1. Read the target agent definition(s)
2. Identify large inline procedures using these signals:
   - 8+ ordered steps
   - Dense tool command reference
   - Repeated workflow headings like Phase 1 / 2 / 3
   - Long formatting rules or templates
   - Sections > ~500 tokens that explain *how* to do something
3. Mark each candidate section with:
   - File path
   - Heading/section name
   - What capability it describes
   - Which other agents might use it

### Phase 2 — Check for reuse and portability
For each candidate, ask:
- Could another agent use this exact procedure with different context?
- Is the procedure tied to the current agent's memory or just to tools/workflow?
- Would extracting it reduce duplication or future drift?
- Would the agent still make sense if the procedure moved out?

If yes, it is a strong skill candidate.

### Phase 3 — Separate identity from procedure
Split the agent section into two buckets:

**Keep in agent**
- Why the agent exists
- What outcomes it owns
- When it should act or escalate
- Any stateful judgment or relationship behavior

**Move to skill**
- Step-by-step workflow
- Commands and tools
- Templates and formatting rules
- Integration recipes
- Decision trees that do not require agent memory

### Phase 4 — Design the skill
Create `.github/skills/{skill-name}/SKILL.md` with:
- YAML frontmatter: `name`, `description`, clear trigger phrases
- Purpose statement
- Inputs / prerequisites / tool inventory
- Canonical workflow
- Rules and anti-patterns
- Integration points (which agents should use it)

Name skills after the capability, not the owning agent.
- Good: `outlook-availability-sync`, `video-publishing-workflow`, `telegram-briefing-format`
- Bad: `task-coach-helper`, `nicu-care-subflow`

## Contradiction Detection Workflow

Contradictions between skills and agents cause hidden drift. Audit both sides.

### Check these contradiction types
1. **Rule conflicts**
   - Skill says "always do X"
   - Agent says "never do X" or omits a required constraint

2. **Tool mismatches**
   - Skill references obsolete tools or old command patterns
   - Agent references a newer pattern than the skill

3. **Workflow divergence**
   - Same capability described differently in the skill and the agent
   - Step order or prerequisites differ

4. **Authority confusion**
   - Skill implies ownership that should belong to the agent
   - Agent embeds procedures that the skill is supposed to be the source of truth for

5. **Boundary leakage**
   - Skill contains identity/memory/autonomy content that belongs in the agent
   - Agent contains procedural detail that should live in the skill

### How to detect contradictions
1. Read the skill and the consuming agent(s) side by side
2. Extract explicit requirements from both:
   - required tools
   - timing rules
   - formatting rules
   - escalation rules
   - decision boundaries
3. Compare line-by-line for mismatches
4. Resolve with this authority order:
   - Foundational docs (`data/constitution.md`, `.github/copilot-instructions.md`)
   - Agent identity and ownership
   - Skill procedure and tool-use guidance
   - Working memory / recent notes

### Resolution rule
- If the conflict is about **mission / identity / authority**, update the **agent**
- If the conflict is about **procedure / integration / formatting**, update the **skill**
- If both duplicate the same procedural rule, keep the full rule in the **skill** and leave only a brief reference in the agent

## Safe Refactor Workflow — Agent Inline Procedure → Reusable Skill

### Step 1 — Snapshot the current behavior
Before editing:
- Record which agent owns the capability
- Note the current headings and files
- Identify any other agents already duplicating the same procedure
- Preserve any stateful or personality-specific instructions that must remain in the agent

### Step 2 — Create the skill first
1. Write the skill with the full reusable procedure
2. Make the skill the canonical source of truth for that workflow
3. Include anti-patterns and required tools
4. Add trigger phrases so other agents can invoke it naturally

### Step 3 — Refactor the agent to reference the skill
Replace the bulky procedural section with:
- A short **Skill Reference** section
- A short note about what remains agent-specific
- Any decision boundaries the agent still owns

### Step 4 — Preserve the split of responsibilities
After refactor, the agent should still answer:
- Why am I the one doing this?
- What context or memory do I uniquely carry?
- When should I act, escalate, or stay silent?

The skill should answer:
- What exact steps do I follow?
- What tools do I use?
- What templates or formatting rules apply?

### Step 5 — Validate for drift
After refactor:
1. Confirm the agent no longer embeds the full procedure
2. Confirm the skill contains the complete reusable workflow
3. Confirm no key constraints were lost
4. Confirm any consuming agents reference the same skill consistently
5. Search for older duplicated copies and remove or update them

## Standard Agent Update Pattern

When an agent should reference a skill instead of embedding procedure, use this pattern:

```md
## Skill Reference

**Use the {skill-name} skill for all {capability} operations.** The skill at `.github/skills/{skill-name}/SKILL.md` contains the complete workflow, tool-use patterns, rules, and anti-patterns.
```

Then leave only the agent-specific layer, for example:

```md
### Agent-Specific Judgment
- You decide when this workflow should be invoked
- You apply relationship context and memory before using it
- You own escalation and follow-up decisions
```

## Change Management Rules

1. **Extract before duplicating.** If a second agent needs the same workflow, prefer a new skill over copy-paste.
2. **Skills must stay procedural.** Do not move personality or long-lived state into skills.
3. **Agents must stay lean.** After a skill exists, agents should reference it rather than re-documenting it.
4. **One source of truth per procedure.** Avoid partial copies in multiple agents.
5. **Update all consumers together.** If a new skill replaces inline instructions, update every known consuming agent in the same change when safe.

## When to Escalate Instead of Auto-Refactor

Create a task or ask for review if:
- The extraction changes domain ownership
- The procedure is entangled with memory-heavy judgment
- The same workflow is implemented differently on purpose in multiple agents
- Foundational docs may need to change
- The refactor would alter cron behavior or autonomy boundaries

## Recommended Deliverables for a Skill Optimization Pass

For each optimization pass, produce:
1. **Candidate list** — what can be extracted and why
2. **Contradiction list** — agent/skill mismatches and authority decision
3. **Implemented skill(s)** — new or updated `SKILL.md` files
4. **Refactored agent(s)** — shorter agent definitions referencing the skill
5. **Memory update** — record what was audited and changed so future runs avoid duplication

## Anti-Patterns

- ❌ Creating a skill for a personality
- ❌ Creating a skill for memory tier management unique to one agent
- ❌ Leaving the full procedure in the agent after skill extraction
- ❌ Splitting a tiny one-off procedure into a skill no one else will use
- ❌ Letting skill and agent copies drift separately
- ❌ Moving ownership boundaries into the skill

## Bottom Line

Use this skill whenever the platform needs to answer:
- "Should this be a skill or stay in the agent?"
- "How do we extract this workflow safely?"
- "Why are these agent and skill instructions contradicting each other?"
- "How do we slim agents down without losing identity?"

The rule is simple:
**Agents own identity and context. Skills own reusable procedure.**
