---
name: heb-grocery
description: H-E-B grocery automation — catalog management, cart building, order history scraping, and delivery ordering using verified product data and Playwright scripts. Use when user says "grocery order", "H-E-B cart", "add to cart", "grocery list", "buy again", "weekly order", "remove from cart", "cart total", "what do we need from HEB", "build the cart", "grocery run", or wants to manage H-E-B delivery orders.
---

# H-E-B Grocery Automation Skill

This skill enables the agent to manage H-E-B grocery delivery orders end-to-end: maintaining a verified product catalog, building/modifying carts via Playwright browser automation, tracking order history, and handling {{PARENT_1}}'s specific quantity preferences and household rules.

## Critical Rules — Read These First

1. **Every item MUST have the full H-E-B product name** — never use generic names like "milk" or "bread." Always use the exact name from H-E-B (e.g., "H-E-B Reduced Fat 2% Milk, 1 gal"). Generic names cause wrong items to be added.

2. **Cart management is BIDIRECTIONAL SYNC** — when {{PARENT_1}} says he doesn't need an item this week, REMOVE it from the cart. Don't just skip adding it. The cart is a living document — add what's needed, remove what's not.

3. **H-E-B 2-step remove process**: Click the `removeItemButton` on the item → then confirm via the `itemConfirmRemove` button. Skipping the confirmation leaves the item in the cart.

4. **Always check `data/scripts/` first** before exploring the H-E-B DOM manually. The Playwright scripts contain tested selectors and flows. Exploring the DOM from scratch wastes tokens and risks using stale selectors.

5. **Produce items trigger ripeness dialogs** — when adding fruits/vegetables (bananas, avocados, limes, etc.), clicking "Add to cart" opens a ripeness selection dialog. The scripts handle this automatically by selecting "No preference."

6. **Items can be temporarily unavailable** — always check availability. If an item is out of stock, suggest substitutes from past orders (the catalog tracks alternatives).

7. **{{PARENT_1}} NEVER shops in-store** — delivery only via H-E-B app/website. Credit card is on file under {{PARENT_2}}'s account. Delivery address: {{HOME_ADDRESS}}.

8. **Past orders are the source of truth** — only add items that have been verified from H-E-B order history. Never add an item that hasn't been confirmed as a real H-E-B product with a valid product ID.

9. **Frequency tracking drives weekly orders** — weekly items (42) go in every order, biweekly items (23) every other week, monthly items (3) once a month, as-needed items (18) only when {{PARENT_1}} specifically requests them.

10. **Rejected items — DO NOT REORDER:**
    - **La Banderita Keto Flour Tortillas** — "disgusting, not edible"
    - **Mission Super Soft Flour Tortillas** — "disgusting, not edible"
    - If {{PARENT_1}} rejects an item, add it to this list and never suggest it again.

---

## Data Architecture

### Grocery Catalog — `data/grocery/items.json`

The catalog is the single source of truth for all H-E-B products. As of April 2026, it contains **86 verified items** scraped from actual H-E-B order history and the Buy It Again page.

**Schema version:** `1.0.0`

```json
{
  "schema_version": "1.0.0",
  "last_updated": "ISO-8601 timestamp",
  "source": "HEB order history + Buy It Again",
  "store_default": "HEB",
  "items": [
    {
      "id": "465325",
      "name": "H-E-B Bakery Flour Tortillas",
      "full_name": "H-E-B Bakery Flour Tortillas, 20 ct",
      "store": "HEB",
      "product_id": "465325",
      "url": "https://www.heb.com/product-detail/h-e-b-bakery-flour-tortillas/465325",
      "category": "bakery",
      "price": "5.12",
      "frequency": "weekly",
      "order_history": ["2026-04-11"],
      "last_ordered": "2026-04-11",
      "verified": true,
      "notes": ""
    }
  ]
}
```

**Field definitions:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | H-E-B product ID (same as `product_id`) |
| `name` | string | Short product name |
| `full_name` | string | **Full H-E-B product name with size/count** — this is the canonical name used for matching |
| `store` | string | Always `"HEB"` |
| `product_id` | string | H-E-B's internal product ID from the URL |
| `url` | string | Direct product page URL: `https://www.heb.com/product-detail/{slug}/{product_id}` |
| `category` | string | Product category (see breakdown below) |
| `price` | string | Last known price |
| `frequency` | string | `weekly` \| `biweekly` \| `monthly` \| `as-needed` |
| `order_history` | string[] | Array of ISO dates when ordered |
| `last_ordered` | string | Most recent order date |
| `verified` | boolean | Whether this item was confirmed from real H-E-B data |
| `notes` | string | Special notes (substitution preferences, {{PARENT_1}}'s comments) |

**Catalog breakdown by frequency:**

| Frequency | Count | Description |
|-----------|-------|-------------|
| weekly | 42 | Core staples — included in every order |
| biweekly | 23 | Every-other-week items |
| as-needed | 18 | Only when {{PARENT_1}} requests |
| monthly | 3 | Once-a-month restocks |

**Catalog breakdown by category:**

| Category | Count |
|----------|-------|
| produce | 20 |
| dairy | 17 |
| bakery | 8 |
| household | 8 |
| frozen | 7 |
| meat | 7 |
| pantry | 6 |
| snacks | 5 |
| beverages | 4 |
| supplements | 2 |
| pharmacy | 1 |
| personal_care | 1 |

### Add-Item Workflow

When {{PARENT_1}} wants to add a new item to the catalog:

```
1. Search H-E-B website for the product (use heb-search-product.js)
2. Show {{PARENT_1}} the top 3 results with full names, sizes, and prices
3. {{PARENT_1}} confirms which one (or says none are right)
4. Persist the confirmed item to data/grocery/items.json with:
   - Full H-E-B product name (from the search result)
   - Product ID (from the URL)
   - URL, price, category
   - Frequency (ask {{PARENT_1}})
   - verified: true
5. The item is now available for future cart builds
```

**Never add an item to the catalog without {{PARENT_1}}'s explicit confirmation.**

---

## Playwright Scripts — `data/scripts/`

All scripts are designed for Playwright MCP's `browser_run_code` tool. They must be loaded via the `filename` parameter or their function body pasted directly.

**Prerequisite:** Must be signed in to heb.com ({{PARENT_2}}'s account) with an active session. The delivery address ({{HOME_ADDRESS}}) must be set.

### `heb-add-to-cart.js`

Add a single product by product ID or URL. Handles produce ripeness dialogs automatically.

```
Input:  { productId: "318627" } or { productUrl: "https://..." }
Output: { success: boolean, cartCount: number, cartTotal: string, error?: string }
```

**Key behaviors:**
- Navigates directly to the product page
- Clicks the "Add to cart" button (`data-testid="add-to-cart-button"`)
- Detects and handles ripeness dialogs for produce (selects "No preference")
- Detects "Temporarily unavailable" / "Out of stock" states
- Returns updated cart count and total from the header badge

### `heb-buy-again.js`

Bulk-add items from the Buy It Again page by name matching.

```
Input:  { productNames: ["Coca-Cola Zero", "Bob Evans Liquid Egg", ...] }
Output: { added: string[], skipped: string[], cartCount: number, cartTotal: string }
```

**Key behaviors:**
- Navigates to `https://www.heb.com/my-account/your-orders/buy-it-again`
- Scrolls to load all lazy-loaded sections
- Matches product names case-insensitively against "Add to cart , {name}" buttons
- Handles produce items with generic "Add to cart" buttons via ripeness dialog
- Reports which items were added and which were skipped (not found / out of stock)

### `heb-cart-total.js`

Read the current cart contents, item count, and estimated total.

```
Input:  (none)
Output: { items: [{name, quantity, price}], itemCount: number, subtotal: string, estimatedTotal: string }
```

**Key behaviors:**
- Navigates to `https://www.heb.com/cart`
- Parses each cart item: name, quantity, price
- Reads the Order Summary section for subtotal and estimated total
- **Warning:** Suggested items carousel appears ABOVE cart items — don't confuse them with actual cart contents
- **Quick method:** Read the header badge link on any page: `"Go to Cart page. {N} items in your cart. ${total}"`

### `heb-search-product.js`

Search H-E-B by keyword and return top results.

```
Input:  { query: "keto bread" }
Output: { results: [{name, size, price, productId, url}] }
```

**Key behaviors:**
- Uses the search bar (`input[type="search"]`) or navigates to `https://www.heb.com/search/?q={query}`
- Parses product cards from the results grid
- For exact products, prefer direct URL navigation: `https://www.heb.com/product-detail/{slug}/{product_id}`
- H-E-B search is fuzzy — always cross-reference product_id against the catalog

### `heb-order-history.js`

Scrape order details or the Buy It Again catalog.

```
Input:  { mode: "buy-it-again" } or { mode: "orders", limit: 5 }
Output: { items: [{name, productId, url, price, category}] }
```

**Key behaviors:**
- **Buy It Again mode** (`https://www.heb.com/my-account/your-orders/buy-it-again`): Best source for building the catalog — deduplicates across all orders, organized by category
- **Order History mode** (`https://www.heb.com/my-account/your-orders`): Shows individual orders with dates, totals, and item lists
- Product IDs are extracted from product link URLs: `/product-detail/{slug}/{product_id}`

### `heb-cart-automation.js`

Full cart automation using the verified catalog. This is the **primary script for weekly orders**.

```
Input:  catalogItems: [{ hebProductName: "H-E-B Reduced Fat 2% Milk, 1 gal", quantity: 1 }, ...]
Output: { added: string[], failed: string[], alreadyInCart: string[], cartTotal: string }
```

**Key behaviors:**
- Uses catalog item `full_name` for exact name-verified matching
- Searches Buy It Again first (faster, higher match rate)
- Falls back to regular search if not found in Buy It Again
- **NEVER adds the first random result** — always verifies the product name matches
- Normalizes names for fuzzy matching (strips size/weight suffixes)
- Handles quantity adjustments

**Key H-E-B DOM selectors (as of April 2026):**

| Element | Selector |
|---------|----------|
| Add to cart button | `button[data-testid="add-to-cart-button"]` or `button` with text `"Add to cart , {product name}"` |
| Remove item button | `removeItemButton` (data-testid) |
| Confirm remove | `itemConfirmRemove` (data-testid) |
| Cart badge (any page) | `link "Go to Cart page. {N} items in your cart. ${total}"` |
| Search input | `input[type="search"]` or `placeholder="Search H E B.com"` |
| Ripeness dialog | Dialog `"Choose ripeness for {product name}"` → `button[data-testid="preference-quantity-trigger"]` |
| Buy It Again search | `#buy-it-again-search` |
| Disabled button | `[disabled]` attribute = out of stock |

---

## Cart Rebuild Workflow

This is the standard workflow for building a weekly grocery order:

### Step 1: Load the Catalog
```
Read data/grocery/items.json
Filter items by frequency = "weekly" (42 items for a standard weekly order)
For biweekly items: check if this is the "on" week (based on last_ordered date)
```

### Step 2: Get {{PARENT_1}}'s Input
```
Send itemized list of what's planned for this order
Ask: "Anything you already have or don't need this week?"
Ask: "Any additions or special quantities?"
```

### Step 3: Build the "Already Have" Exclusion List
```
{{PARENT_1}} will say things like "I already have tortillas and milk"
Remove those items from the order list
```

### Step 4: Add Items via Playwright
```
Use heb-cart-automation.js with the filtered item list
Pass specific quantities for items {{PARENT_1}} specified (see Quantities section below)
Monitor for failures/unavailable items
```

### Step 5: Remove Items {{PARENT_1}} Doesn't Need
```
If {{PARENT_1}} says "remove the chips" — use the 2-step remove:
1. Navigate to cart page
2. Find the item
3. Click removeItemButton
4. Click itemConfirmRemove
THIS IS CRITICAL — don't just skip items, actively remove them if already in cart
```

### Step 6: Send Cart Summary
```
Use heb-cart-total.js to read the final cart
Send {{PARENT_1}} an itemized summary:
- Item name × quantity — $price
- Subtotal
- Estimated total
```

### Step 7: Iterate
```
{{PARENT_1}} may request changes:
- "Add 2 more blueberries"
- "Remove the orange juice"
- "Switch to the large eggs"
Handle each change, then re-send the updated summary
Repeat until {{PARENT_1}} approves
```

---

## {{PARENT_1}}'s Custom Quantities

These are {{PARENT_1}}'s specified quantities for items that deviate from the default of 1. Always use these unless {{PARENT_1}} says otherwise for a specific order:

| Item | Quantity | Notes |
|------|----------|-------|
| Limes | 4 | Individual limes, not bags |
| Chicken thighs (2lb stacks) | 4 | Boneless skinless, 2 lb packs |
| Chips (various) | 2 | Usually Tostitos Scoops + one other |
| Bob Evans Liquid Egg Whites | 2-3 | 32 oz cartons |
| Blueberries large (18 oz) | 4 | Fresh, large container |
| Blueberries small (9.8 oz) | 4 | If in stock — sometimes unavailable |
| Splenda | 2-3 | Boxes |
| Mac & cheese (for HJ) | 4 | {{CHILD_1_NAME}}'s staple |
| Chicken meatballs (for HJ) | 2 | {{CHILD_1_NAME}}'s staple |
| Protein pancakes | 2 | Kodiak or similar |

**Default quantity is 1** for all other items unless {{PARENT_1}} specifies otherwise at order time.

---

## Item Availability Handling

When an item is temporarily unavailable or out of stock:

1. **Report it immediately** — "⚠️ {item name} is currently unavailable on H-E-B"
2. **Check the catalog for alternatives** — look at items in the same category with `as-needed` or `biweekly` frequency
3. **Suggest substitutes from past orders** — "You've ordered {alternative} before — want me to add that instead?"
4. **Never silently skip** — {{PARENT_1}} needs to know what's missing so he can decide

---

## Rejected Items List

These items have been explicitly rejected by {{PARENT_1}} and must **NEVER** be reordered or suggested:

| Item | Reason | Date Rejected |
|------|--------|---------------|
| La Banderita Keto Flour Tortillas | "disgusting, not edible, do not reorder" | Apr 2026 |
| Mission Super Soft Flour Tortillas | "disgusting, not edible, do not reorder" | Apr 2026 |

If {{PARENT_1}} rejects a new item, add it to this table and to a `rejected_items` field in the catalog.

---

## H-E-B Website Key URLs

| Page | URL |
|------|-----|
| Home | `https://www.heb.com` |
| Cart | `https://www.heb.com/cart` |
| Buy It Again | `https://www.heb.com/my-account/your-orders/buy-it-again` |
| Order History | `https://www.heb.com/my-account/your-orders` |
| Search | `https://www.heb.com/search/?q={query}` |
| Product Page | `https://www.heb.com/product-detail/{slug}/{product_id}` |

**Authentication:** {{PARENT_2}}'s account must be signed in. Session cookies are managed by Playwright's browser context. If auth expires, the agent will see a login page — notify {{PARENT_1}} to re-authenticate.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Not signed in | Notify {{PARENT_1}} — "H-E-B session expired, need to re-login" |
| Item unavailable | Report to {{PARENT_1}}, suggest substitute from catalog |
| Ripeness dialog appears | Select "No preference" automatically |
| Cart page shows wrong address | Alert {{PARENT_1}} — delivery address must be {{HOME_ADDRESS}} |
| Playwright timeout | Retry once with longer timeout. If persistent, script may need selector update. |
| Price changed significantly | Note the new price, alert {{PARENT_1}} if >20% increase |
| Unknown item requested | Search H-E-B, show top 3 results, get {{PARENT_1}}'s confirmation before adding to catalog |
| Script selector broken | Check if H-E-B updated their DOM. Update the script in `data/scripts/`. |

---

## Agent Instructions

When managing grocery orders:

1. **Load the catalog first** — read `data/grocery/items.json` to know what's available
2. **Check scripts exist** — verify `data/scripts/heb-*.js` files are present before attempting automation
3. **Use the correct script** for each task:
   - Building a full order → `heb-cart-automation.js`
   - Adding a single item → `heb-add-to-cart.js`
   - Quick adds from past orders → `heb-buy-again.js`
   - Reading the cart → `heb-cart-total.js`
   - Finding new products → `heb-search-product.js`
   - Building/updating catalog → `heb-order-history.js`
4. **Apply {{PARENT_1}}'s custom quantities** — see the Quantities table above
5. **Bidirectional sync** — add AND remove as needed
6. **Always confirm before checkout** — send the full cart summary and wait for {{PARENT_1}}'s "looks good"
7. **Update the catalog** after each order:
   - Update `last_ordered` dates for ordered items
   - Add any new items {{PARENT_1}} confirmed
   - Update prices if they changed
   - Add rejected items to the rejected list

### Communication Style for Grocery Orders

- **Be itemized** — always list items with quantities and prices
- **Group by category** — produce, dairy, meat, etc.
- **Flag issues inline** — "⚠️ Blueberries 9.8oz unavailable" right next to the item
- **Show the total prominently** — {{PARENT_1}} wants to see the damage
- **Keep it scannable** — {{PARENT_1}} reviews on his phone via Telegram

### Example Telegram Cart Summary

```
🛒 H-E-B Weekly Order — Ready for Review

🥬 Produce (8 items)
• Limes × 4 — $0.50 ea
• Hass Avocados × 3 — $1.25 ea
• Blueberries 18oz × 4 — $5.48 ea
• ⚠️ Blueberries 9.8oz — UNAVAILABLE

🥩 Meat (3 items)
• Chicken Thighs 2lb × 4 — $8.36 ea
• Ground Turkey 93/7 × 1 — $5.69

🧀 Dairy (5 items)
• Egg Whites 32oz × 3 — $4.97 ea
• 2% Milk 1 gal × 1 — $3.81

... (grouped by category)

💰 Estimated Total: $287.42 (52 items)

Need changes? Just tell me what to add/remove.
```

---

## Maintenance & Catalog Updates

### After Each Order
1. Update `last_ordered` for all items that were in the order
2. Update `order_history` arrays with the order date
3. Update prices if any changed
4. Note any items that were unavailable

### Periodically (Monthly)
1. Scrape Buy It Again page to discover new items {{PARENT_1}} has ordered
2. Cross-reference with catalog — add any missing items (with {{PARENT_1}}'s confirmation)
3. Review `as-needed` items — any that haven't been ordered in 3+ months may be candidates for removal
4. Update prices across the catalog

### When H-E-B Changes Their Website
1. Test each script manually — run with a single item to verify selectors still work
2. Update selectors in the scripts if needed
3. Document the changes in the script header comments
4. The most fragile selectors are: cart badge text, remove button test IDs, ripeness dialog structure
