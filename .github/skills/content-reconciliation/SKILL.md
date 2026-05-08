---
name: content-reconciliation
description: >
  Issue reconciliation workflow — keeps GitHub Issues in your content repo in sync
  with actual Zernio/Late post status. Covers fuzzy matching, label updates, close logic,
  skip rules, and comment templates. Use when user says "reconcile issues", "sync posts to issues",
  "issue reconciliation", "match posts to issues", "pipeline sync", "update issue status from posts".
---

# Content Reconciliation Skill

Keeps GitHub Issues in `{{CONTENT_REPO}}` in sync with actual Zernio/Late post status. Runs as a scheduled cron job (Mon + Thu mornings) and can be triggered manually.

## Reconciliation Workflow

1. **Pull posts** — Paginate through `late_list_posts` for both `scheduled` and `published` statuses (at least 300-500 of each for good coverage).
2. **Pull open issues** — List all open issues from `{{CONTENT_REPO}}`.
3. **Match posts to issues** — Use fuzzy matching on:
   - Issue title vs post content/title (multi-word phrase overlap)
   - Topic-specific keyword matching (e.g., "mythos", "openshell", "copilot cli")
   - Issue number tags in posts (e.g., `issue-197`)
   - A match score threshold of **≥5** to avoid false positives.
4. **Update matched issues:**
   - **Comment** — Leave a structured comment with post IDs, platforms, dates, and status table.
   - **Label** — Set the correct status label:
     - `status:published` if any posts are published
     - `status:scheduled` if posts exist but none published yet
   - Remove stale status labels (`status:draft`, `status:ready`, `status:recorded`) when upgrading.
   - **Close** — Close the issue if it has 3+ published posts and zero remaining scheduled posts (fully rolled out).
5. **Report** — Send a summary notification to the operator with match stats, label changes, and closed issues.
6. **Track orphans** — Note issues with no matching posts (still need recording) and unmatched posts (generic/lifestyle content).

## Skip Logic

- Don't re-comment on issues that already have a recent reconciliation comment (within 3 days).
- Don't downgrade labels (e.g., don't change `status:published` back to `status:scheduled`).
- Issues with `status:article-published` are blog-only — skip video reconciliation for these.

## Comment Template

```markdown
## 🤖 Automated Pipeline Reconciliation

**Total posts found:** X (Y published, Z scheduled)

**Published on:** platform1, platform2
**Scheduled on:** platform3

### Post Details
| Platform | Status | Date | Post ID |
|----------|--------|------|---------|
| youtube | published | 2026-04-14 | `abc123...` |

**Status updated to:** `status:published`
```

## Integration Notes

- Uses the `content-pillar-schema` skill for label definitions and lifecycle transitions.
- Uses the `late-publishing` skill for platform account IDs when querying posts.
- Notify the operator using your preferred messaging channel. Never hardcode chat IDs in this skill.
