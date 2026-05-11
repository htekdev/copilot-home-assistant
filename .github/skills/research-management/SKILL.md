---
name: research-management
description: >
  Research document lifecycle management — creating, reusing, updating, superseding, and archiving
  research across the platform. Ensures research is saved as research (NOT specs), discoverable by
  all agents, and kept current. Use when user says "research this", "look into", "investigate",
  "find out about", "what do we know about", "save this research", "update research",
  "check prior research", "research document", "research folder", or any agent produces
  research findings that should be persisted.
---

# Research Management Skill

Standard procedure for how ANY agent on the platform creates, stores, discovers, updates, and retires research documents. This skill exists because **research is not a spec** — they serve fundamentally different purposes and belong in different places.

## Why This Exists

Research kept getting saved as specs (`data/specs/`), which is wrong:

| | Research | Spec |
|---|---|---|
| **Purpose** | Capture context for decision-making | Capture requirements for implementation |
| **Audience** | Any agent or human needing context | The agent/person building the thing |
| **Lifecycle** | Updated with new findings, superseded when obsolete | Versioned, frozen once approved |
| **Location** | `data/research/` | `data/specs/` |
| **Mutability** | Living document — update in place | Immutable once approved (create v2 instead) |

**Rule of thumb:** If it answers "what did we learn?" → research. If it answers "what should we build?" → spec.

---

## Critical Rules — Read These First

1. **Research goes in `data/research/`, never in `data/specs/`.** Specs are for implementation requirements. Research is for captured context, analysis, and findings.

2. **Check before creating.** Before starting ANY new research, search `data/research/` for existing documents on the topic. Update existing docs — don't create duplicates.

3. **One canonical document per topic.** If research on "LinkedIn DM capabilities" already exists, update it. Don't create a second file.

4. **Always include sources.** Every claim needs attribution. No "studies show..." without citing which studies.

5. **Use the standard format.** Every research document follows the template below. No exceptions.

6. **Update, don't duplicate.** When new findings arrive for an existing topic, update the existing document's content and bump the `last-updated` timestamp.

7. **Supersede, don't delete.** When a research document is completely replaced by better research, mark the old one `status: superseded` with a `superseded-by` pointer. Never delete research — it's historical context.

8. **Tags are mandatory.** Every research doc must have at least 2 tags for discoverability.

---

## Directory Structure

```
data/research/
├── README.md                          # Explains the structure (this exists)
├── business/                          # Business strategy, pricing, market research
│   ├── freelance-positioning.md
│   └── services-page-metrics.md
├── technical/                         # Technical capabilities, tools, integrations
│   ├── linkedin-dm-capability.md
│   └── multi-agent-orchestration.md
├── marketing/                         # Content strategy, SEO, ads, audience
│   ├── blog-content-strategy.md
│   └── carplay-ads-research.md
├── financial/                         # Budget analysis, cost optimization, pricing
│   └── aws-cost-analysis.md
├── health/                            # Medical, wellness, and caregiving
│   └── family-care-checklist.md
├── platform/                          # Platform architecture, audits, improvements
│   └── context-audit-2026-04.md
└── parenting/                         # Child development, education, activities
    └── pre-k-readiness-research.md
```

### Category Selection Guide

| Category | Use When |
|----------|----------|
| `business/` | Market research, competitive analysis, pricing strategy, business model exploration, client research |
| `technical/` | Tool capabilities, API research, integration feasibility, architecture exploration |
| `marketing/` | Content strategy, SEO research, ad platform research, audience analysis |
| `financial/` | Cost analysis, budget benchmarks, investment research, savings optimization |
| `health/` | Medical research, wellness strategies, and caregiving protocols |
| `platform/` | Platform audits, agent architecture research, performance analysis |
| `parenting/` | Child development, education research, activity planning |

**If a topic doesn't fit:** Use the closest category. When in doubt, use `business/` for external-facing research and `platform/` for internal platform research.

### Naming Convention

```
{descriptive-topic-slug}.md
```

- Lowercase, hyphen-separated
- Descriptive enough to identify the topic from the filename alone
- No dates in filenames (dates go in frontmatter)
- No version numbers (research docs are updated in place, not versioned)

**Good:** `linkedin-dm-capability.md`, `services-page-metrics.md`, `blog-content-strategy.md`
**Bad:** `research-v1.md`, `2026-05-10-linkedin.md`, `small-business-seo-services-v1.md`

---

## Research Document Template

Every research document MUST follow this format:

```markdown
---
topic: "[Clear, descriptive topic title]"
created: YYYY-MM-DD
last-updated: YYYY-MM-DD
status: active | superseded | archived
author: "[agent-name or user]"
sources:
  - "[URL or description of source 1]"
  - "[URL or description of source 2]"
tags:
  - "[tag1]"
  - "[tag2]"
related-research:
  - "[path/to/related-doc.md]"
superseded-by: "[path/to/newer-doc.md]"  # only if status: superseded
---

# [Topic Title]

## Summary

[2-5 paragraph executive summary of key findings. This is the "compacted context" —
someone reading ONLY this section should understand the core conclusions.]

## Key Findings

### [Finding 1 Title]
[Detailed explanation with evidence and citations]

### [Finding 2 Title]
[Detailed explanation with evidence and citations]

### [Finding N Title]
[Detailed explanation with evidence and citations]

## Raw Data & Evidence

[Supporting data, screenshots references, detailed analysis, benchmark numbers, etc.
This section can be longer — it's the backup for the summary above.]

## Sources & Citations

1. [Source name](URL) — [what it contributed to this research]
2. [Source name](URL) — [what it contributed to this research]

## Open Questions

- [Unanswered questions that need further research]
- [Gaps in the data]

## Related Documents

- [Link to related research doc] — [how it connects]
- [Link to related spec, if applicable] — [relationship]
```

### Required Sections

| Section | Required? | Notes |
|---------|-----------|-------|
| Frontmatter | ✅ Yes | All fields except `superseded-by` and `related-research` |
| Summary | ✅ Yes | The compacted context — most agents will only read this |
| Key Findings | ✅ Yes | At least one finding |
| Raw Data & Evidence | Optional | Include when there's substantial supporting data |
| Sources & Citations | ✅ Yes | At least one source |
| Open Questions | Optional | Include when gaps exist |
| Related Documents | Optional | Include when cross-references exist |

---

## Research Lifecycle

### Phase 1: Discovery — Check Before You Research

Before starting ANY research task:

```
1. glob("data/research/**/*.md") — see what exists
2. grep for topic keywords in data/research/ — find related docs
3. If a matching document exists with status: active → UPDATE it, don't create new
4. If a matching document exists with status: superseded → check what superseded it
5. If nothing exists → proceed to Phase 2
```

**This is not optional.** The #1 anti-pattern is creating duplicate research because an agent didn't check first.

### Phase 2: Create — Save New Research

When creating a new research document:

1. **Choose the right category folder** from the directory structure above
2. **Create the category folder** if it doesn't exist yet (`New-Item -ItemType Directory`)
3. **Use the standard template** — copy the template above, fill in all required sections
4. **Set status to `active`**
5. **Include at least one source** — if the research came from web searches, cite the URLs. If from agent analysis, cite the agent and methodology.
6. **Add tags** — at least 2, chosen for discoverability (other agents will search by these)
7. **Cross-reference** — if related research exists, add it to `related-research` in frontmatter AND update the related doc's `related-research` to point back

### Phase 3: Update — Augment Existing Research

When new findings relate to an existing research document:

1. **Update the Summary** if the new findings change the conclusions
2. **Add new Key Findings** sections (append, don't replace existing findings unless they're wrong)
3. **Add new Sources** to the citations section
4. **Bump `last-updated`** in frontmatter to today's date
5. **If findings CONTRADICT existing content** — update the contradicted section with the correction, noting what changed and why. Don't silently overwrite.

### Phase 4: Supersede — Replace Outdated Research

When research is completely outdated or replaced:

1. **Create the new research document** following Phase 2
2. **Update the old document's frontmatter:**
   - Set `status: superseded`
   - Set `superseded-by: path/to/new-doc.md`
3. **Add a note at the top of the old document:**
   ```markdown
   > ⚠️ **SUPERSEDED** — This research has been replaced by [new-doc.md](path). See that document for current findings.
   ```
4. **Do NOT delete the old document** — it's historical context that may still be referenced

### Phase 5: Archive — Retire Irrelevant Research

When research is no longer relevant (topic is moot, project cancelled, etc.):

1. **Update frontmatter:** Set `status: archived`
2. **Add archive note at the top:**
   ```markdown
   > 📦 **ARCHIVED** — This research is no longer actively maintained. Archived on YYYY-MM-DD. Reason: [why].
   ```
3. **Don't delete** — leave in place for historical reference

---

## Agent Integration

### For ANY Agent Doing Research

When your task involves research (web searches, analysis, investigation):

1. **BEFORE researching:** Check `data/research/` for existing documents on the topic (Phase 1)
2. **AFTER researching:** Save findings using the template (Phase 2) or update existing (Phase 3)
3. **In your response:** Reference the research document path so other agents can find it
4. **In your memory:** Note the research doc path in your working memory for future reference

### For Agents Needing Context

When you need background on a topic before making a decision:

1. **Search `data/research/`** using glob/grep with topic keywords and tags
2. **Read the Summary section** — this gives you compacted context without reading the full doc
3. **Check `status`** — only trust `active` documents. `superseded` means there's a newer version.
4. **Check `last-updated`** — if it's months old, the research may need refreshing before relying on it

### Research-to-Spec Handoff

When research informs a spec:

1. Research lives in `data/research/` — it's the "why" and "what we learned"
2. Spec lives in `data/specs/` — it's the "what to build" derived from the research
3. The spec's frontmatter should reference the research doc(s) that informed it
4. The research doc's `related-research` should link to the spec

```
data/research/technical/linkedin-dm-capability.md  →  informs  →  data/specs/linkedin-dm-v1.md
                  (what's possible)                                (what to build)
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Do This Instead |
|---|---|---|
| ❌ Saving research in `data/specs/` | Specs are for implementation requirements, not context | Save in `data/research/{category}/` |
| ❌ Researching without checking existing docs | Creates duplicates, wastes effort | Always run Phase 1 discovery first |
| ❌ Creating a new doc when one exists on the topic | Fragments knowledge, causes conflicting sources | Update the existing document (Phase 3) |
| ❌ Research without sources/citations | Unverifiable claims, might be hallucinated | Always cite at least one source |
| ❌ Letting research go stale | Agents rely on outdated context for decisions | Update or archive when information changes |
| ❌ Deleting superseded research | Loses historical context | Mark as superseded with pointer to replacement |
| ❌ Saving research only in agent working memory | Lost when memory is trimmed, not discoverable by other agents | Persist to `data/research/` |
| ❌ Embedding research findings in chat responses only | Context lost after session ends | Always persist to file |

---

## Examples

### Example 1: Agent receives "research LinkedIn DM capabilities"

```
1. glob("data/research/**/*linkedin*") → found: data/research/technical/linkedin-dm-capability.md
2. Read it → status: active, last-updated: 2026-05-04
3. It's recent and active → UPDATE this doc with new findings rather than creating new
4. Bump last-updated, add new sources, update summary if conclusions changed
```

### Example 2: Agent finishes researching a brand-new topic

```
1. glob("data/research/**/*pricing*") → no results
2. grep("pricing strategy", "data/research/") → no results
3. No existing research → CREATE new doc at data/research/business/saas-pricing-models.md
4. Use the standard template, fill all required sections
5. Commit the new file
```

### Example 3: Agent finds existing research is completely wrong

```
1. Read data/research/financial/aws-cost-analysis.md → findings are from 3 months ago, AWS changed pricing
2. Create new doc: data/research/financial/aws-cost-analysis.md (same path — update in place if fixable)
3. OR if it's a completely different analysis: create new doc AND mark old as superseded
4. Update old doc: status: superseded, superseded-by: path/to/new-doc.md
```
