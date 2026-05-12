---
name: research-grounded-advice
description: Evidence-based recommendation protocol — search before advising, cite sources, cross-reference claims, and never hallucinate health/parenting/financial guidance. Use when user says "research this first", "cite sources", "evidence-based", "verify before suggesting", "don't make things up", "backed by research", or any agent needs to give health, medical, parenting, or safety advice.
---

# Research-Grounded Advice Skill

Standard protocol for agents that give health, medical, parenting, or safety recommendations. Ensures every suggestion is backed by real sources, never hallucinated.

## Why This Exists

Multiple agents (wellness-coach, parenting-coach, health-coach, nicu-care, fitness-coach) give recommendations that affect human health and wellbeing. Hallucinated medical advice is dangerous. This skill enforces the "search first, cite always" pattern.

## The Protocol

### Step 1 — Search Before Advising

Before providing ANY health/medical/parenting/safety recommendation:

```
1. perplexity-search(query: "[specific question]")       # FIRST CHOICE — best for factual answers with citations
2. exa-web_search_exa(query: "[broader context]")         # SECOND CHOICE — clean content, good for deep dives
3. exa-crawling_exa(urls: ["..."])                        # Read full page content from URLs found above
4. exa-get_code_context_exa(query: "...")                 # For technical/code research specifically
```

**⚠️ TOOL PRIORITY (MANDATORY):**
Follow the `research-tools` skill (`.github/skills/research-tools/SKILL.md`) for the complete search tool hierarchy and parallel research patterns. Key rules:
- **ALWAYS prefer Exa and Perplexity** over `web_search` and `web_fetch`
- `web_search` and `web_fetch` are LAST RESORT only — they frequently fail and return poor results
- For complex research: use `perplexity-reason` or `perplexity-deep_research`
- For code/technical: use `exa-get_code_context_exa` + {{EMPLOYER_PARENT}} MCP tools
- For {{EMPLOYER}}/Azure topics: also use `mslearn-microsoft_docs_search`

**Minimum:** At least ONE search tool must be consulted before giving specific advice.

**For significant recommendations** (medication interactions, emergency guidance, developmental concerns):
- Cross-reference with at least 2 different search tools
- Prefer official sources: ACOG, APA, AAP, CDC, WHO, Postpartum Support International, peer-reviewed journals

### Step 2 — Cite Sources in Response

Always attribute recommendations:
- ✅ "According to the AAP, skin-to-skin contact for at least 60 min/day improves..."
- ✅ "Research from [journal/org] suggests..."
- ✅ "Per ACOG guidelines, postpartum BP monitoring should..."
- ❌ "Studies show that..." (which studies? cite them)
- ❌ Making a specific claim with no attribution

### Step 3 — Acknowledge Uncertainty

If you cannot verify a claim:
- ✅ "I haven't been able to verify this — let me research before suggesting"
- ✅ "This is commonly recommended but I couldn't find a primary source — check with your provider"
- ❌ Presenting unverified information as fact
- ❌ Saying "research shows" without having done the research

### Step 4 — Source Hierarchy

When multiple sources conflict, prefer (in order):
1. **Official clinical guidelines** (ACOG, AAP, APA, CDC)
2. **Peer-reviewed meta-analyses**
3. **Peer-reviewed studies** (RCTs > observational)
4. **Official organization recommendations** (Postpartum Support International, KellyMom for lactation)
5. **Expert consensus** (major hospital systems, established practitioners)
6. **High-quality journalism** (avoid mommy blogs, forum posts, unvetted social media)

## Scope — Which Agents MUST Use This Skill

| Agent | When |
|-------|------|
| `wellness-coach` | ALL recommendations (CBT techniques, medication info, coping strategies) |
| `parenting-coach` | Developmental guidance, behavioral strategies, sibling adjustment |
| `health-coach` | Medical tracking, postpartum guidance, medication management |
| `nicu-care` | NICU protocols, pumping guidance, preterm development |
| `fitness-coach` | Exercise safety, nutrition claims, supplement guidance |

## Anti-Patterns

- ❌ Inventing statistics ("90% of babies..." without a source)
- ❌ Giving medication dosage advice without verification
- ❌ Stating developmental timelines without citing AAP/CDC milestones
- ❌ Making claims about supplement efficacy without evidence
- ❌ Recommending treatments you cannot verify are safe for postpartum/breastfeeding

## Exception: Known Validated Library

If the agent's `core.md` contains a pre-validated technique library (e.g., wellness-coach's CBT techniques), those can be used WITHOUT re-searching every time. But for ANY NEW suggestion beyond the library → search first.
