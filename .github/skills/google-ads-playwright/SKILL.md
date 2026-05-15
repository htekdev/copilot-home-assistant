---
name: google-ads-playwright
description: >
  Google Ads management via Playwright browser automation — navigation paths, campaign monitoring,
  conversion tracking, tag management, and performance analysis. Use when user says "check ads",
  "ad performance", "Google Ads", "campaign metrics", "conversion tracking", "ad budget",
  "check conversions", "Google tag", "ad management", "A/B test ads", "optimize ads",
  "ad spend", "bid management", "ad blocker dialog", or any Google Ads activity.
---

# Google Ads Playwright Skill

Automate Google Ads management via Playwright browser control. This skill documents navigation paths, element targeting, and procedures for monitoring and managing {{PARENT_1}}'s Google Ads account.

## Critical Rules — Read These First

1. **Authentication is manual.** {{PARENT_1}} must be signed into Google Ads in the Playwright browser session before any automation runs. If not authenticated, skip gracefully and notify {{PARENT_1}}.

2. **Always dismiss the ad blocker dialog first.** Google Ads shows a persistent "Turn off ad blockers" warning. Dismiss it before interacting with any page elements.

3. **Never change bids, budgets, or campaign settings without explicit approval.** Read-only operations (metrics, conversions, tag status) are safe. Any write operation requires {{PARENT_1}}'s confirmation.

4. **Pages are dynamic and slow.** Always use `waitForSelector` or `waitForTimeout` after navigation. Google Ads loads content asynchronously — elements may not exist immediately.

5. **Log every discovery.** When the daily exploration cron finds new navigation paths or UI patterns, append them to this skill file and update the scripts.

6. **Use `ref` attributes for targeting.** Google Ads elements often have `ref="e941"` style attributes that are more stable than class names.

7. **Campaign creation via Playwright is BLOCKED by passkey re-auth.** Google requires passkey/biometric verification when saving the Keywords & ads step in the campaign creation wizard. Playwright cannot complete hardware passkey challenges (`accounts.google.com/v3/signin/challenge/pk`). The re-auth triggers on the step TRANSITION, not on content changes — even clicking "Next" with zero modifications triggers it. **Workaround**: {{PARENT_1}} creates campaigns manually; agent manages post-creation (monitoring, negative keywords, optimization). **Future fix**: Google Ads REST API with OAuth tokens.

8. **Use `page.fill()` for form inputs, NOT DOM `.value = x`.** Google Ads uses Angular which doesn't detect DOM-level value changes. `page.fill()` properly triggers change detection and input events.

---

## Account Details

| Field | Value |
|-------|-------|
| **Account Name** | {{PROJECT_BRAND}} |
| **Customer ID** | {{GOOGLE_ADS_CUSTOMER_ID}} |
| **Login Email** | {{EMAIL_ADDRESS}} |
| **Google Ads Tag ID** | {{GOOGLE_ADS_TAG_ID}} |
| **Base URL** | https://ads.google.com |
| **Dashboard URL** | https://ads.google.com/aw/campaigns |

### URL Parameters (observed)

These parameters appear in authenticated URLs and may be needed for direct navigation:

```
ocid={{PHONE_NUMBER}}
euid={{GOOGLE_ADS_EUID}}
__u={{PHONE_NUMBER}}
uscid={{PHONE_NUMBER}}
__c={{PHONE_NUMBER}}
```

---

## Navigation Reference

### Primary Pages

| Page | URL Path | How to Get There |
|------|----------|-----------------|
| Campaigns Dashboard | `/aw/campaigns` | Main landing page after login |
| Asset Groups | `/aw/assetgroup` | Campaigns menu > Asset groups (PMax uses these instead of ad groups) |
| Ad Groups | `/aw/adgroups` | N/A for PMax campaigns — redirects to Overview |
| Ads & Assets | `/aw/ads` | Campaigns menu > Ads & assets |
| Keywords | `/aw/keywords` | Campaigns menu > Keywords |
| Audiences | `/aw/audiences` | Campaigns menu > Audiences |
| Conversions Summary | `/aw/conversions` | Goals menu > Conversions > Summary |
| Account Settings | `/aw/accountsettings` | Admin menu > Account settings |
| Billing | `/aw/billing` | Admin menu > Billing & payments |

| Recommendations | `/aw/recommendations` | Campaigns menu (left nav) > Recommendations |

### Tools & Data

| Page | Navigation Path |
|------|----------------|
| Data Manager | Tools menu > Data manager |
| Connected Products | Tools menu > Data manager > Connected products |
| Google Tag Details | Data Manager > Connected products > Google tag > "Manage" button |
| Keyword Planner | Tools menu > Keyword planner |
| Performance Planner | Tools menu > Performance planner |

### Menu Structure

```
├── Campaigns
│   ├── Overview
│   ├── Recommendations
│   ├── Insights and reports
│   ├── Campaigns (main dashboard)
│   ├── Asset groups (PMax — replaces ad groups)
│   ├── Experiments
│   ├── Campaign groups
│   ├── Assets
│   └── Audiences, keywords, and content
├── Goals
│   ├── Conversions
│   │   └── Summary (conversion actions list)
│   └── Customer lists
├── Tools
│   ├── Data manager
│   │   └── Connected products (Google tag lives here)
│   ├── Keyword planner
│   ├── Performance planner
│   └── Ad preview and diagnosis
├── Billing
│   └── Billing & payments
├── Admin
│   ├── Account settings
│   ├── Access and security
│   └── Billing & payments
├── Change history
└── Reports
    ├── Predefined reports
    └── Dashboards
```

---

## Current Conversion Actions

As of 2026-05-11:

| Conversion Action | Source | Status |
|-------------------|--------|--------|
| Lead form | Google hosted | Active |
| SUBMIT_LEAD_FORM (1) | GA4 imported | Active |
| SUBMIT_LEAD_FORM (2) | GA4 imported | Active |
| YouTube subscriptions | YouTube | Active |
| YouTube follow-on views | YouTube | Active |

- Conversions are **GA4-imported** (not standalone Google Ads tags)
- Google tag has **0 hits** (freshly set up as of 2026-05-11)

---

## Common Procedures

### 1. Dismiss Ad Blocker Dialog

Google Ads shows a persistent "Turn off ad blockers" dialog. This MUST be dismissed before any other interaction.

```javascript
// See: data/scripts/google-ads/dismiss-ad-blocker.js
// Try to dismiss any ad blocker warning dialog
const dismissBtn = await page.$('button[aria-label="Close"], [role="dialog"] button');
if (dismissBtn) {
  await dismissBtn.click();
  await page.waitForTimeout(500);
}
// Alternative: press Escape
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
```

### 2. Check Authentication

Before any operation, verify the user is logged in:

```javascript
// Navigate to campaigns dashboard
await page.goto('https://ads.google.com/aw/campaigns');
await page.waitForTimeout(3000);

// Check if we're on a login page
const url = page.url();
if (url.includes('accounts.google.com') || url.includes('signin')) {
  console.log('NOT_AUTHENTICATED: {{PARENT_1}} needs to sign in manually');
  return;
}

// Check for account selector or dashboard content
const hasDashboard = await page.$('[class*="campaign"], [class*="dashboard"]');
if (!hasDashboard) {
  console.log('AUTH_UNCLEAR: Page loaded but dashboard not detected');
}
```

### 3. View Campaign Performance

```javascript
// Navigate to campaigns
await page.goto('https://ads.google.com/aw/campaigns');
await page.waitForTimeout(3000);

// Dismiss ad blocker if present
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Read campaign metrics from the table
const metrics = await page.evaluate(() => {
  const rows = document.querySelectorAll('table tbody tr');
  return Array.from(rows).map(row => {
    const cells = row.querySelectorAll('td');
    return Array.from(cells).map(cell => cell.textContent?.trim());
  });
});
console.log(JSON.stringify(metrics, null, 2));
```

### 4. Check Conversions

```javascript
// Navigate to conversions summary
await page.goto('https://ads.google.com/aw/conversions');
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Read conversion actions
const conversions = await page.evaluate(() => {
  const rows = document.querySelectorAll('table tbody tr');
  return Array.from(rows).map(row => {
    const cells = row.querySelectorAll('td');
    return {
      name: cells[0]?.textContent?.trim(),
      source: cells[1]?.textContent?.trim(),
      status: cells[2]?.textContent?.trim(),
    };
  });
});
console.log(JSON.stringify(conversions, null, 2));
```

### 5. View Google Tag Details

```javascript
// Navigate to data manager connected products
await page.goto('https://ads.google.com/aw/datamanager/connectedproducts');
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Look for Google tag section and click Manage
const manageBtn = await page.$('text=Manage');
if (manageBtn) {
  await manageBtn.click();
  await page.waitForTimeout(3000);
  
  // Tag details may load in an iframe
  const iframe = await page.$('iframe');
  if (iframe) {
    const frame = await iframe.contentFrame();
    const tagId = await frame?.$eval('[class*="tag-id"], [class*="tagId"]', 
      el => el.textContent?.trim());
    console.log('Tag ID:', tagId);
  }
}
```

### 6. View Asset Groups (Performance Max)

```javascript
// Navigate to asset groups
await page.goto('https://ads.google.com/aw/assetgroup');
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Read asset group data from table
const assetGroups = await page.evaluate(() => {
  const grid = document.querySelector('[aria-label="Asset groups"], grid');
  if (!grid) return { error: 'No grid found' };
  const rows = grid.querySelectorAll('[role="row"]');
  return Array.from(rows).slice(1).map(row => { // skip header
    const cells = row.querySelectorAll('[role="gridcell"]');
    return Array.from(cells).map(c => c.textContent?.trim());
  });
});
console.log(JSON.stringify(assetGroups, null, 2));
```

**Asset Groups table columns:** Status, Asset Group, Campaign, Assets, Ad Strength, Status (eligibility), Audience signal, Search themes, Clicks, Impr., CTR, Avg. CPC, Cost, Conv. rate, Conversions, Cost / conv.

**Key findings (2026-05-14):**
- PMax campaigns use **asset groups** instead of traditional ad groups
- `/aw/adgroups` redirects to Overview for PMax accounts
- Asset groups are accessed via Campaigns menu > Asset groups
- URL includes `assetGroupTableMode=true` parameter
- Ad Strength shown as progress bar with label (Average/Good/Excellent)
- Audience signals and search themes have expandable details

---

### 7. View and Apply Recommendations

```javascript
// Navigate to recommendations
await page.goto('https://ads.google.com/aw/recommendations');
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Read optimization score
const score = await page.evaluate(() => {
  const pb = document.querySelector('[role="progressbar"]');
  return pb?.getAttribute('aria-label') || pb?.textContent?.trim();
});
console.log('Optimization score:', score);

// Read recommendation cards
const cards = await page.evaluate(() => {
  const options = document.querySelectorAll('[role="option"]');
  return Array.from(options).map(o => ({
    text: o.textContent?.trim().substring(0, 200)
  }));
});
console.log(JSON.stringify(cards, null, 2));
```

**Recommendations page structure (2026-05-14):**
- URL: `/aw/recommendations` with `opp=` param for individual recommendations
- Tabs: "Recommendations" (selected) | "Auto-apply settings"
- Shows optimization score as progressbar (0-100%)
- Cards in a `listbox` with `option` items, each with "View recommendation" button
- Detail pages: opp=101 (sitelinks), opp=134 (conversion tracking), opp=221 (video asset)
- Apply workflow: View → select items (checkboxes in tree) → Apply button
- Some recommendations are multi-step wizards (e.g., conversion tracking = 4 steps)
- Sitelinks: select from existing sitelink assets, then Apply. Creates account-level sitelinks.

---



### Element Targeting Strategy

1. **Prefer `ref` attributes**: `[ref="e941"]` — these are fairly stable identifiers
2. **Use `role` attributes**: `[role="button"]`, `[role="dialog"]`, `[role="tab"]`
3. **Use `aria-label`**: `[aria-label="Close"]`, `[aria-label="Settings"]`
4. **Text selectors**: `text=Campaigns`, `text=Conversions`
5. **Avoid class names**: Google Ads uses obfuscated class names that change between deploys

### Handling Dynamic Content

```javascript
// Wait for specific content to load
await page.waitForSelector('table tbody tr', { timeout: 10000 });

// Wait for network idle (all API calls finished)
await page.waitForLoadState('networkidle');

// Retry pattern for flaky elements
async function waitAndClick(page, selector, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      return true;
    } catch (e) {
      await page.waitForTimeout(1000);
    }
  }
  return false;
}
```

### Handling Iframes

Some Google Ads panels (like tag details) open inside iframes:

```javascript
// Find and switch to iframe
const iframeEl = await page.waitForSelector('iframe', { timeout: 5000 });
const frame = await iframeEl.contentFrame();
if (frame) {
  // Now interact with elements inside the iframe
  const content = await frame.textContent('body');
  console.log(content);
}
```

### Extracting Table Data

```javascript
// Generic table extraction for Google Ads
async function extractTable(page) {
  return await page.evaluate(() => {
    const headerCells = document.querySelectorAll('table thead th');
    const headers = Array.from(headerCells).map(h => h.textContent?.trim());
    
    const rows = document.querySelectorAll('table tbody tr');
    const data = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      const rowData = {};
      Array.from(cells).forEach((cell, i) => {
        if (headers[i]) rowData[headers[i]] = cell.textContent?.trim();
      });
      return rowData;
    });
    return { headers, data };
  });
}
```

---

## Known Issues & Workarounds

| Issue | Workaround |
|-------|-----------|
| Ad blocker dialog blocks interaction | Dismiss with Escape key or close button click before any operation |
| Pages load slowly | Use `waitForTimeout(3000)` minimum after navigation |
| Dynamic class names | Target by `ref`, `role`, `aria-label`, or text content instead |
| iframes for tag details | Use `contentFrame()` to switch context into iframes |
| Authentication expires | Check URL after navigation — if redirected to accounts.google.com, abort and notify |
| Multiple Google accounts | Ensure correct account is selected — check for Customer ID {{GOOGLE_ADS_CUSTOMER_ID}} |

---

## Daily Exploration Protocol

The daily cron job (`google-ads-exploration`) follows this procedure:

1. **Auth check** — Navigate to campaigns, verify login. If not authenticated, notify {{PARENT_1}} and stop.
2. **Dismiss dialogs** — Clear any ad blocker or onboarding popups.
3. **Collect metrics** — Read campaign performance data from the dashboard.
4. **Check conversions** — Navigate to conversions, read status and counts.
5. **Explore new pages** — Visit one unexplored page from the menu structure. Document:
   - URL path and how to reach it
   - Key elements and their selectors
   - What data is available
   - Any new dialogs or patterns
6. **Update this skill** — Append new findings to the Navigation Reference.
7. **Report to {{PARENT_1}}** — Send a Telegram summary with metrics and any new discoveries.

### Exploration Queue (pages not yet documented in detail)

- [x] Asset Groups page — PMax asset groups, ad strength, audience signals (2026-05-14)
- [x] Recommendations page — optimization score, recommendation cards, apply workflow (2026-05-14)
- [ ] Ads & Assets page — ad creative details, performance per ad
- [ ] Keywords page — keyword performance, quality scores, bid data
- [ ] Audiences page — audience segments, targeting options
- [ ] Billing page — spend history, payment methods
- [ ] Reports section — predefined report types, custom report builder
- [ ] Keyword Planner — search volume, competition data
- [ ] Performance Planner — forecasting tools
- [ ] Ad Preview and Diagnosis — test how ads appear
- [ ] Change History — audit log of account changes
- [ ] Campaign settings — bidding strategies, targeting, scheduling

---

## Future Capabilities (Roadmap)

### Phase 1: Monitoring (Current)
- [x] Navigate Google Ads pages
- [x] Read campaign metrics
- [x] Check conversion status
- [x] View Google tag health
- [ ] Daily metric snapshots (store in `data/google-ads/metrics/`)
- [ ] Trend analysis (week-over-week performance)
- [ ] Automated alerts (spend spikes, conversion drops)

### Phase 2: Analysis & Reporting
- [ ] Weekly performance reports via Telegram
- [ ] Campaign comparison (which campaigns perform best)
- [ ] Keyword analysis (quality score trends, search term reports)
- [ ] Audience performance breakdown
- [ ] Cost per conversion tracking
- [ ] ROI calculations by campaign

### Phase 3: Optimization
- [ ] Bid adjustment recommendations
- [ ] Budget reallocation suggestions
- [ ] Keyword pause/enable recommendations
- [ ] Ad copy performance analysis
- [ ] Landing page performance correlation

### Phase 4: A/B Testing & Automation
- [ ] Create A/B test ad variations
- [ ] Monitor test results and declare winners
- [ ] Automated bid adjustments (with approval gates)
- [ ] Campaign creation from templates
- [ ] Automated negative keyword management

---

## Helper Scripts

Reusable Playwright code snippets are stored at `data/scripts/google-ads/`:

| Script | Purpose |
|--------|---------|
| `dismiss-ad-blocker.js` | Handles the ad blocker warning dialog |
| `navigate-to-campaigns.js` | Opens campaigns dashboard with auth check |
| `navigate-to-conversions.js` | Opens conversions summary page |
| `navigate-to-google-tag.js` | Opens Google tag details page |
| `check-ad-performance.js` | Reads campaign metrics from dashboard |

These scripts are designed to be copy-pasted into `browser_run_code_unsafe` calls. Each is self-contained with error handling and auth checking.

---

## Agent Integration

| Agent | Role |
|-------|------|
| `coding-agent` | Maintains scripts, updates this skill, runs daily exploration |
| `entrepreneur-coach` | References ad performance for business coaching decisions |
| `finance-manager` | Tracks ad spend as a budget line item |
| `content-manager` | Coordinates content promotion via Google Ads |
