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

## ✅ Browser Isolation — Resolved via playwright-services Extension

**Each service now has its own isolated persistent browser profile** via the `playwright-services` extension (`.github/extensions/playwright-services/extension.mjs`). Google Ads uses `~/.playwright-profiles/google-ads/` and LinkedIn uses `~/.playwright-profiles/linkedin/`. They can run concurrently without conflict.

**Preferred tools:** Use `playwright_service_open({ service: "google-ads" })`, `playwright_service_navigate`, `playwright_service_click`, `playwright_service_snapshot`, etc. These route to the isolated Google Ads profile automatically.

**Defense-in-depth:** The cron schedule still places google-ads-daily-metrics at 17:43 CT (after LinkedIn's last cycle at 17:18 CT) as an extra safety layer, but the architectural isolation means concurrent access no longer causes navigation conflicts.

**Architecture details:** See `.github/skills/linkedin-playwright/references/PLAYWRIGHT_MULTI_SESSION_ARCHITECTURE.md` and `data/playwright/services.json` for the full service registry.

---

## Critical Rules — Read These First

1. **Authentication is manual.** {{PARENT_1}} must be signed into Google Ads in the Playwright browser session before any automation runs. If not authenticated, skip gracefully and notify {{PARENT_1}}.

2. **Always dismiss the ad blocker dialog first.** Google Ads shows a persistent "Turn off ad blockers" warning. Dismiss it before interacting with any page elements.

3. **Never change bids, budgets, or campaign settings without explicit approval.** Read-only operations (metrics, conversions, tag status) are safe. Any write operation requires {{PARENT_1}}'s confirmation.

4. **Pages are dynamic and slow.** Always use `waitForSelector` or `waitForTimeout` after navigation. Google Ads loads content asynchronously — elements may not exist immediately.

5. **Log every discovery.** When the daily exploration cron finds new navigation paths or UI patterns, append them to this skill file and update the scripts.

6. **Use `ref` attributes for targeting.** Google Ads elements often have `ref="e941"` style attributes that are more stable than class names.

7. **Campaign creation via Playwright works — passkey re-auth opens in a separate tab.** Google requires passkey/biometric verification when saving the Keywords & ads step. The passkey challenge opens in a **new browser tab** while the original tab advances to the Budget step. The wizard can continue through Budget → Review → Publish without completing the passkey. **Confirmed 2026-05-17**: "Agentic DevOps Search" campaign (ID 23860997035) published successfully via Playwright despite passkey popup. The re-auth triggers on the step TRANSITION, not on content changes. **Previous behavior** (May 2026): passkey sometimes fully blocked the wizard — this may depend on session state or Google A/B testing.

8. **Use `page.fill()` for form inputs, NOT DOM `.value = x`.** Google Ads uses Angular which doesn't detect DOM-level value changes. `page.fill()` properly triggers change detection and input events.

---

## Account Details

| Field | Value |
|-------|-------|
| **Account Name** | Htek Dev |
| **Customer ID** | {{PHONE_NUMBER}} |
| **Login Email** | {{PARENT_1}}{{EMAIL_ADDRESS}} |
| **Google Ads Tag ID** | AW-18153793739 |
| **Base URL** | https://ads.google.com |
| **Dashboard URL** | https://ads.google.com/aw/campaigns |

### URL Parameters (observed)

These parameters appear in authenticated URLs and may be needed for direct navigation:

```
ocid={{PHONE_NUMBER}}
euid=166612088
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
| Ads & Assets | `/aw/ads` | N/A for PMax campaigns — redirects to Overview. PMax uses Asset Groups. |
| Keywords | `/aw/keywords` | Campaigns menu > Keywords |
| Audiences | `/aw/audiences` | Campaigns menu > Audiences |
| Conversions Summary | `/aw/conversions` | Goals menu > Conversions > Summary |
| Account Settings | `/aw/accountsettings` | Admin menu > Account settings |
| Billing Summary | `/aw/billing/summary` | Billing menu > Summary (note: `/aw/billing` without `/summary` = 404) |
| **Campaign Settings** | `/aw/settings` | Campaigns dashboard > Settings sub-tab (click tab). **Cannot direct-navigate** — ad blocker blocks. Must: 1) load campaigns page, 2) click "Settings" tab. Requires selecting individual campaign from dropdown to load settings rows. |

| Recommendations | `/aw/recommendations` | Campaigns menu (left nav) > Recommendations |
| Change History | `/aw/changehistory` | Left nav > Change history (under Audiences, keywords, and content) |
| **Insights** | `/aw/insights` | Left nav > Insights and reports > Insights. Tabs: Campaigns, Portfolios, Conversion goals, Landing pages, Targeted locations, When your ads showed, Devices. WoW performance comparison. |
| Auction Insights | `/aw/insights/auctioninsights` | Insights and reports > Auction insights |
| Search Terms | `/aw/keywords/searchterms` | Insights and reports > Search terms. Grid: Search term, Match type, Added/Excluded, Campaign, Ad group, Clicks, Impr, CTR, Avg cost, Cost, Network, Conv rate, Conv, Cost/conv. Filters: Campaign status, Add filter. Buttons: "Hide for now", "View search terms insights". Match types: Broad match, Phrase match (close variant), Performance Max. Totals: named terms + "Other search terms" (hidden low-volume) + Account. |
| Devices | `/aw/devices` | Insights and reports > When and where ads showed |
| Channel Performance | `/aw/channel-performance` | Insights and reports > Channel performance |
| Landing Pages | `/aw/landingpages` | Insights and reports > Landing pages |
| Report Editor | `/aw/reporteditor` | Insights and reports > Report editor |
| Dashboards | `/aw/dashboards` | Insights and reports > Dashboards |

### Tools & Data

| Page | Navigation Path |
|------|----------------|
| Data Manager | Tools menu > Data manager |
| Connected Products | Tools menu > Data manager > Connected products |
| Google Tag Details | Data Manager > Connected products > Google tag > "Manage" button |
| Keyword Planner | Tools menu > Planning > Keyword Planner (`/aw/keywordplanner/home`) |
| Performance Planner | Tools menu > Planning > Performance Planner (`/aw/budgetplanner/home`) — NOTE: `/aw/performanceplanner` = 404! |
| Reach Planner | Tools menu > Planning > Reach Planner (`/aw/mediaplanner/home`) |
| Ad Preview & Diagnosis | Tools menu > Troubleshooting (URL TBD — not yet explored) |

### Menu Structure

```
├── Campaigns
│   ├── Overview
│   ├── Recommendations
│   ├── Insights and reports
│   ├── Campaigns (main dashboard)
│   ├── Asset groups (PMax — replaces ad groups)
│   ├── Experiments (/aw/experiments/all/cards)
│   ├── Campaign groups (/aw/campaigngroups/table)
│   ├── Assets
│   └── Audiences, keywords, and content
├── Goals
│   ├── Conversions
│   │   └── Summary (conversion actions list)
│   └── Customer lists
├── Tools
│   ├── Asset studio (/aw/assetstudio) — Tools landing page
│   ├── Planning
│   │   ├── Keyword Planner (/aw/keywordplanner/home)
│   │   ├── Performance Planner (/aw/budgetplanner/home)
│   │   └── Reach Planner (/aw/mediaplanner/home)
│   ├── App advertising hub (/aw/appadvertisinghub/webtoappconnect)
│   ├── Shared library
│   ├── YouTube creator partnerships (Beta) (/aw/creatorpartnerships/analytics)
│   ├── Content suitability (/aw/contentsuitability)
│   ├── Data manager (/aw/datamanager)
│   │   └── Connected products (Google tag lives here)
│   ├── Troubleshooting (Ad Preview lives here — URL TBD)
│   ├── Bulk actions
│   ├── Budgets and bidding
│   └── Business data (/aw/businessdata/assetsetfeed)
├── Billing
│   └── Billing & payments (/aw/billing/summary)
├── Admin
│   ├── Account settings (/aw/policy/account — new!)
│   ├── Access and security
│   └── Billing & payments
├── Change history (/aw/changehistory)
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



### 8. View Billing Summary

```javascript
// Navigate to billing summary
await page.goto('https://ads.google.com/aw/billing/summary');
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Extract billing data from visible text
const billingData = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const texts = [];
  let node;
  while (node = walker.nextNode()) {
    const t = node.textContent?.trim();
    if (t && t.length > 1 && t.length < 200) {
      const parent = node.parentElement;
      if (parent && parent.offsetParent !== null) texts.push(t);
    }
  }
  return texts.filter(t => 
    t.startsWith('$') || t.includes('payment') || t.includes('balance') || 
    t.includes('Mastercard') || t.includes('Visa') || t.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/)
  );
});
console.log(JSON.stringify(billingData, null, 2));
```

**Billing Summary page structure (2026-05-15):**
- URL: `/aw/billing/summary` (NOT `/aw/billing` which is 404)
- Tabs: Summary, Billing activity, Documents, Promotions, Billing transfers, Settings
- Shows: Balance, Next automatic payment date, Last payment, Current month Net cost & Payments
- Payment threshold visible (e.g., $100.00)
- Payment method shown with masked card number
- "Make an optional payment" button available
- "Change payment method" button available
- Year dropdown for historical billing activity

---



### 9. View Audiences

```javascript
// Navigate to audiences page
await page.goto('https://ads.google.com/aw/audiences');
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Extract audience segments from grid
const gridRows = await page.$$('[role="row"]');
const data = [];
for (const row of gridRows) {
  const cells = await row.$$('[role="gridcell"], [role="columnheader"]');
  const rowData = [];
  for (const cell of cells) {
    const text = await cell.textContent();
    rowData.push(text.trim());
  }
  if (rowData.length > 2) data.push(rowData);
}
console.log(JSON.stringify(data, null, 2));
```

**Audiences page structure (2026-05-20):**
- URL: `/aw/audiences`
- Located under: Audiences, keywords, and content > Audiences
- Sub-navigation breadcrumb: Audiences > Audience segments
- Grid columns: Audience segment, Type, Campaign, Ad group, Status, Level, Bid adj., Impr., Interactions, Interaction rate, Avg. cost, Cost, Conv. rate, Conversions, Cost/conv.
- View selector: "Ad group view" dropdown
- Has "Edit audience segments" button (add icon) for adding audience segments
- Same parent nav tabs as Keywords: Keywords, Audiences, Locations, Content, Ad schedule, Advanced bid adjustments
- Filter bar: Campaign status, Ad group status (same as other pages)
- Chart shows clicks over time with date range selector
- Currently empty — "You don't have any audience segments yet" message

---

### 10. View Change History

```javascript
// Navigate to change history
await page.goto('https://ads.google.com/aw/changehistory');
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Extract change entries from table
const changes = await page.evaluate(() => {
  const links = document.querySelectorAll('a');
  const entries = [];
  for (const link of links) {
    const text = link.textContent?.trim();
    if (text && (text.includes('Campaign') || text.includes('Ad group'))) {
      let parent = link.closest('tr, [role="row"]');
      if (parent) {
        entries.push(parent.textContent?.trim().substring(0, 300));
      }
    }
  }
  return entries.slice(0, 20);
});
console.log(JSON.stringify(changes, null, 2));
```

**Change History page structure (2026-05-21):**
- URL: `/aw/changehistory` (with scorecardState and tableState params)
- Left nav: under "Audiences, keywords, and content" section → "Change history"
- Change overview section with 3 tabs: "By user", "By campaign", "Performance"
  - Performance tab: shows Impr, Cost, Conversions, Clicks scorecards + chart
  - Has Metrics, Adjust, Download buttons
- Filter chips (below overview): All changes, Budget, Bidding, Audience, Location, Language, Conversion, Asset, Status, Feed, Other
- Table columns: User/Date & Time ↓, Tool, Change, Campaign, Ad group
- Each change row shows: email, timestamp, "Changes can't be undone"/"Undo" link
- Tool values: "Web client (manual)", could also show "API", "Rules", "Automated"
- Change types observed: "Account-default goals changed", "Conversion created", "Campaign changed", "Budget changed", "1 responsive search ad created"
- Useful for: auditing who changed what, undoing recent changes, debugging issues

---

### 11. Keyword Planner (`/aw/keywordplanner/home`)

**Title**: "Keyword Planner - Htek Dev - Google Ads"  
**Access**: Tools menu > Planning > Keyword Planner  

```javascript
await page.goto('https://ads.google.com/aw/keywordplanner/home');
await page.waitForTimeout(4000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// Remove feature announcement modal that intercepts clicks
await page.evaluate(() => {
  const overlay = document.getElementById('base-root-overlay-container-KP');
  if (overlay) overlay.remove();
  document.querySelectorAll('[pane-id]').forEach(el => el.remove());
});
```

**Page Structure:**
Three main tools displayed as cards:
1. **"Discover new keywords"** — Enter keywords/URL to get ideas; tabs: "Start with keywords" / "Start with a website"
2. **"Get search volume and forecasts"** — Historical metrics + forecasts for a keyword list
3. **"Organize keywords into ad groups"** — Auto-assign keywords to ad groups

**"Plans created by you" section:**
- Columns: Plan, Status, Last modified, Forecast period
- Empty for new accounts with no saved plans

**Key element selectors:**
- Keyword input: `[aria-label="Search input"]` (placeholder: `Try "meal delivery" or "leather boots"`)
- URL filter input: `[aria-label="Enter a site to filter unrelated keywords"]`
- Get results button: `button:has-text("Get results")`
- Language selector: looks for "English (default)" text near `translate` icon
- Location selector: "United States" near `location_on` icon

**Interaction notes (2026-05-22):**
- Feature announcement modal (`pane-id="KP--5"` inside `#base-root-overlay-container-KP`) intercepts ALL pointer events on page load — must call `.remove()` on overlay before clicking
- Ad blocker warning renders at bottom of page (`"Turn off ad blockers"`) — may prevent search results API call from loading
- Input values must be set via `page.fill()` (not DOM value assignment) — Angular-based form
- The "Discover new keywords" panel is inline on the home page (not a separate route)
- Search results navigate to a new URL path (observed pattern, not confirmed — ad blocker prevented)

**Navigation within Tools > Planning menu:**
- Keyword Planner → `/aw/keywordplanner/home`
- Performance Planner → (not yet explored)
- Reach Planner → (not yet explored)
- App advertising hub → (not yet explored)

---
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

## Keywords Page (`/aw/keywords`) — Explored 2026-05-19

**Title**: "Search keywords - Htek Dev - Google Ads"  
**Access**: Campaigns menu > Audiences, keywords, and content > Keywords  
**Note**: Only shows Search campaign keywords. PMax keywords are managed via Asset Groups > Search themes.

### Grid Columns
Keyword, Match type, Campaign, Ad group, Status, Final URL, Impr, Interactions, Interaction rate, Avg cost, Cost, Clicks, Conv rate, Conversions, Avg CPC, Cost/conv

### Tabs
- **Keywords** (default) — active keywords with performance metrics
- **Negative keywords** — excluded terms

### Keyword Statuses
- **Eligible** — keyword is active and serving
- **Not eligible: Low search volume** — keyword is paused by Google due to insufficient search volume

### Filter Bar
- Campaign status (Enabled, Paused)
- Ad group status (Enabled, Paused)

### Data Extraction Pattern
```javascript
// Extract keyword data from the grid
const grid = document.querySelectorAll('[role="grid"]')[2]; // 3rd grid = main data
const rows = grid.querySelectorAll('[role="row"]');
rows.forEach(row => {
  const cells = row.querySelectorAll('[role="gridcell"], [role="columnheader"]');
  // cells[2] = Keyword name, cells[3] = Match type, cells[6] = Status
  // cells[8] = Impressions, cells[13] = Clicks, cells[12] = Cost
});
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
| Multiple Google accounts | Ensure correct account is selected — check for Customer ID {{PHONE_NUMBER}} |

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
- [x] Ads & Assets page — N/A for PMax accounts, redirects to Overview (2026-05-15)
- [x] Keywords page — keyword performance, match types, status, tabs (Keywords/Negative keywords). Grid with full metrics. Status: Eligible or "Low search volume". (2026-05-19)
- [x] Audiences page — audience segments, targeting options (2026-05-20)
- [x] Billing page — balance, payments, net cost, threshold, payment method (2026-05-15)
- [ ] Reports section — predefined report types, custom report builder
- [x] Keyword Planner — search volume, competition data (2026-05-22)
- [ ] Performance Planner — forecasting tools
- [ ] Ad Preview and Diagnosis — test how ads appear
- [x] Change History — audit log of account changes (2026-05-21)
- [🔶] Campaign Settings — bidding strategies, targeting, scheduling (partial 2026-05-22)

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

These scripts are designed to be copy-pasted into `playwright_service_eval` calls after opening `playwright_service_open({ service: "google-ads" })`. Each is self-contained with error handling and auth checking while staying inside the isolated Google Ads profile.

---

## Agent Integration

| Agent | Role |
|-------|------|
| `coding-agent` | Maintains scripts, updates this skill, runs daily exploration |
| `entrepreneur-coach` | References ad performance for business coaching decisions |
| `finance-manager` | Tracks ad spend as a budget line item |
| `content-manager` | Coordinates content promotion via Google Ads |
