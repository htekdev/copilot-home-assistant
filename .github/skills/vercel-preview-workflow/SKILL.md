---
name: vercel-preview-workflow
description: >
  Vercel-connected site deployment workflow — branch + PR, wait for Vercel preview,
  extract preview URL, send to {{PARENT_1}} for review, merge only after approval. Use when
  agent says "create PR", "deploy preview", "Vercel preview", "review site changes",
  "push to Vercel", "deploy changes", "site update", "preview URL", "merge PR",
  or makes any code change to a Vercel-connected repository.
---

# Vercel Preview Workflow Skill

**MANDATORY for ALL Vercel-connected repos.** Every code change to a Vercel site must go through this workflow — no exceptions.

## Known Vercel-Connected Repos

| Repo | Site | Domain |
|------|------|--------|
| `{{GITHUB_USERNAME}}/personal-site` | {{PERSONAL_DOMAIN}} | {{PERSONAL_DOMAIN}} |
| `{{GITHUB_USERNAME}}/client-site-a` | Client Site A | client-site-a.example.com |
| `{{GITHUB_USERNAME}}/client-site-b` | Client Site B | client-site-b.example.com |

> If you're unsure whether a repo is Vercel-connected, check for a `vercel.json` or Vercel integration in the repo settings.

---

## Core Rules

1. **🚫 NEVER commit directly to `main`** on any Vercel-connected repo. Main = production. Pushing to main triggers a production deploy with no review.
2. **ALWAYS create a branch + PR** for every change, no matter how small.
3. **ALWAYS wait for the Vercel preview URL** before notifying {{PARENT_1}}.
4. **ALWAYS send the preview URL to {{PARENT_1}}** via Telegram so he can review the live preview.
5. **NEVER merge until {{PARENT_1}} approves** the preview.

---

## Complete Workflow

### Step 1 — Create Branch & Make Changes

```powershell
$repo = "{repo-name}"
$repoPath = "C:\Repos\{{GITHUB_USERNAME}}\$repo"
Set-Location $repoPath
git checkout main
git pull origin main

# Create feature branch
$branch = "feat/{short-description}"
git checkout -b $branch

# Make your changes...
# Run build validation
npm run build

# Commit and push
git add -A
git commit -m "feat: {description}" --trailer "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin $branch
```

### Step 2 — Create PR

```powershell
$prUrl = gh pr create --repo "{{GITHUB_USERNAME}}/$repo" --base main --head $branch `
  --title "{emoji} {description}" `
  --body "## Changes`n`n- {change 1}`n- {change 2}`n`n## Preview`n`nWaiting for Vercel preview deployment..."
Write-Output "PR created: $prUrl"
```

### Step 3 — Wait for Vercel Preview URL

Vercel's {{EMPLOYER_PARENT}} integration posts a comment on the PR with the preview URL. This typically takes 30-120 seconds after the PR is created.

**Polling method — use `gh api`:**

```powershell
$owner = "{{GITHUB_USERNAME}}"
$repo = "{repo-name}"
$prNumber = "{pr-number}"  # extract from PR creation output

# Poll for Vercel bot comment (retry up to 10 times, 15s apart)
$maxAttempts = 10
$attempt = 0
$previewUrl = $null

while ($attempt -lt $maxAttempts -and -not $previewUrl) {
    $attempt++
    Start-Sleep -Seconds 15

    $comments = gh api "repos/$owner/$repo/issues/$prNumber/comments" --jq '.[].body' 2>$null

    # Vercel bot comments contain the preview URL
    # Look for deployment URL patterns
    if ($comments) {
        # Match Vercel preview URL pattern
        $match = [regex]::Match($comments, 'https://[a-zA-Z0-9-]+\.vercel\.app')
        if ($match.Success) {
            $previewUrl = $match.Value
        }

        # Also check for custom preview domain patterns
        if (-not $previewUrl) {
            $match = [regex]::Match($comments, '\*\*Preview\*\*:?\s*(https://[^\s\)]+)')
            if ($match.Success) {
                $previewUrl = $match.Groups[1].Value
            }
        }

        # Check for Vercel deployment comment with inspect URL
        if (-not $previewUrl) {
            $match = [regex]::Match($comments, '(https://[a-zA-Z0-9-]+--[a-zA-Z0-9-]+\.vercel\.app)')
            if ($match.Success) {
                $previewUrl = $match.Value
            }
        }
    }

    if (-not $previewUrl) {
        Write-Output "Attempt $attempt/$maxAttempts - Vercel preview not ready yet..."
    }
}

if ($previewUrl) {
    Write-Output "✅ Preview URL: $previewUrl"
} else {
    Write-Output "⚠️ Could not find preview URL after $maxAttempts attempts"
}
```

**Alternative — use `gh pr view` with comments:**

```powershell
$prComments = gh pr view $prNumber --repo "{{GITHUB_USERNAME}}/$repo" --json comments --jq '.comments[].body'
# Parse for Vercel URL as above
```

**Fallback if polling fails:**
- Check the Vercel dashboard directly
- The preview URL pattern is typically: `https://{repo}-{hash}-{team}.vercel.app`
- Or check the PR's deployment status: `gh api repos/$owner/$repo/deployments`

### Step 4 — Send Preview URL to {{PARENT_1}}

Once you have the preview URL, send it to {{PARENT_1}} via Telegram with the `speak` parameter:

```
telegram_send_message(
  chat_id: "{{TELEGRAM_PARENT_1}}",
  text: "🔗 {Project Name} — Preview Ready\n\nPR: {pr_url}\nPreview: {preview_url}\n\nChanges:\n- {change 1}\n- {change 2}\n\nReview the preview and let me know if it looks good to merge.",
  speak: "Preview is ready for {Project Name}. I sent you the link — check it out and let me know if I should merge."
)
```

**Message rules:**
- Include BOTH the PR URL and the preview URL
- List the key changes briefly
- Ask for explicit approval to merge
- Use `speak` parameter ({{PARENT_1}} uses TTS)

### Step 5 — Wait for {{PARENT_1}}'s Approval

Do NOT merge until {{PARENT_1}} explicitly approves. Acceptable approval signals:
- "merge it", "looks good", "LGTM", "ship it", "approved", "go ahead", "merge"
- A {{EMPLOYER_PARENT}} PR approval

### Step 6 — Merge PR

After approval:

```powershell
gh pr merge $prNumber --repo "{{GITHUB_USERNAME}}/$repo" --squash --delete-branch
```

Then update your working memory with the deployment.

---

## Handling Edge Cases

### Vercel preview takes too long (>3 minutes)
- Check if the build failed: `gh pr checks $prNumber --repo "{{GITHUB_USERNAME}}/$repo"`
- If build failed, fix the issue, push again, restart polling
- If build is still running, increase wait time

### Preview URL not found in comments
Some repos use the Vercel {{EMPLOYER_PARENT}} App which posts as a deployment status rather than a comment:
```powershell
# Check deployment statuses
gh api "repos/$owner/$repo/pulls/$prNumber" --jq '.head.sha' | ForEach-Object {
    gh api "repos/$owner/$repo/deployments?sha=$_" --jq '.[0].id' | ForEach-Object {
        gh api "repos/$owner/$repo/deployments/$_/statuses" --jq '.[0].environment_url'
    }
}
```

### Multiple preview URLs
Vercel may post multiple comments (one per push). Always use the **most recent** preview URL.

### {{PARENT_1}} asks for changes
1. Make the requested changes on the same branch
2. Push to the branch (Vercel auto-rebuilds the preview)
3. Wait for the new preview URL
4. Send the updated preview URL to {{PARENT_1}}

---

## Anti-Patterns

- ❌ **Pushing directly to `main`** — this deploys to production without review
- ❌ **Creating a PR but not waiting for the preview URL** — defeats the purpose
- ❌ **Telling {{PARENT_1}} "I created a PR" without the preview URL** — makes him go find it
- ❌ **Merging without {{PARENT_1}}'s explicit approval** — he needs to review the live preview
- ❌ **Sending only the PR URL, not the preview URL** — {{PARENT_1}} wants to see the live site, not read code
- ❌ **Using Fast Mode (direct to main) for Vercel repos** — the `repo-workflow` Fast Mode does NOT apply to Vercel-connected repos

---

## Integration with Other Skills

- **`client-site-lifecycle`** — overrides the "Ship-to-Main" workflow for Vercel sites; use this skill instead
- **`repo-workflow`** — Proper Mode (branch + PR) is the ONLY valid mode for Vercel repos; Fast Mode is prohibited
- **`htek-dev-article`** — articles on {{PERSONAL_DOMAIN}} already use PR workflow; this skill adds the preview URL extraction step
- **`development-pipeline`** — all tiers of changes use this workflow for Vercel repos

---

## Quick Reference

```
Branch → PR → Wait for Vercel → Extract Preview URL → Telegram to {{PARENT_1}} → Wait for Approval → Merge
```

**Never skip a step. Never push to main. Always send the preview URL.**
