---
name: calendly-management
description: >
  Calendly management via REST API v2 plus Playwright UI automation — event types,
  paid bookings with Stripe, availability, routing forms, webhooks, and authentication.
  Use when user says "Calendly", "booking link", "paid consult", "event type",
  "webhook", "PAT", "OAuth", "availability schedule", or "routing form".
---

# Calendly Management

Hybrid skill for Calendly. Prefer API for reads, supported CRUD, webhook setup, and sync. Prefer Playwright for UI-only settings like payment, booking page customization, and plan-gated areas.

## Current User Context

- Public page: `https://calendly.com/{{GITHUB_USERNAME}}`
- Existing free event: `https://calendly.com/{{GITHUB_USERNAME}}/free-consultation`
- Connected integrations observed in UI:
  - Google Calendar (primary + secondary Google accounts)
  - Google Meet
  - Zoom
  - Stripe
- Default observed schedule: daily `9:00 AM – 5:00 PM` CT
- Paid consults created live in UI:
  - `https://calendly.com/{{GITHUB_USERNAME}}/quick-consult`
  - `https://calendly.com/{{GITHUB_USERNAME}}/deep-dive`
  - `https://calendly.com/{{GITHUB_USERNAME}}/strategy-session`

## Operating Principle

1. **API first** for discovery, syncing, and supported event CRUD.
2. **Playwright second** for payment, booking-page options, invitee questions, confirmation settings, and any editor path that the API does not cover.
3. **Verify public links last** by checking the event list plus the live public page.

## Authentication

### Personal Access Token (PAT)
Use PAT for internal / single-account automation.

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Best for {{PARENT_1}}-only automation, cron jobs, and internal assistant skills.

### OAuth 2.1
Use OAuth for public / multi-user apps.

- Authorization endpoint: `https://auth.calendly.com/oauth/authorize`
- Token endpoint: `https://auth.calendly.com/oauth/token`
- Request the minimum scopes needed; new tokens are scope-gated.

### Scope map (official)
From `https://developer.calendly.com/scopes`:

- `users:read` → `GET /users/me`, `GET /users/{uuid}`
- `event_types:read` → `GET /event_types`, `GET /event_types/{uuid}`, `GET /event_type_available_times`
- `event_types:write` → `POST /event_types`, `PATCH /event_types/{uuid}`, `POST /one_off_event_types`
- `availability:read` → `GET /user_busy_times`, `GET /user_availability_schedules`
- `scheduled_events:read` → `GET /scheduled_events`, invitee reads
- `webhooks:read` / `webhooks:write` → webhook subscription reads/writes
- `routing_forms:read` → routing form reads
- `shares:write` / `scheduling_links:write` → single-use scheduling links

## API Base + Conventions

- REST base: `https://api.calendly.com`
- Official docs root: `https://developer.calendly.com/api-docs`
- API guide: `https://developer.calendly.com/getting-started/`
- Use **v2 only**
- Calendly commonly expects full resource URIs, not bare UUIDs
- Start every integration with `GET /users/me`

### Canonical bootstrap flow

```bash
curl --request GET \
  --url https://api.calendly.com/users/me \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

Representative response pattern:

```json
{
  "resource": {
    "uri": "https://api.calendly.com/users/USER_UUID",
    "name": "{{PARENT_1_FULL_NAME}}",
    "slug": "{{GITHUB_USERNAME}}",
    "email": "{{EMAIL}}",
    "scheduling_url": "https://calendly.com/{{GITHUB_USERNAME}}",
    "timezone": "{{TIMEZONE}}",
    "organization": "https://api.calendly.com/organizations/ORG_UUID"
  }
}
```

Store `resource.uri` and `resource.organization` immediately.

## Key REST API Endpoints

### Identity

```http
GET /users/me
GET /users/{uuid}
GET /organization_memberships
```

### Event types

```http
GET /event_types
GET /event_types/{uuid}
POST /event_types
PATCH /event_types/{uuid}
GET /event_type_available_times
POST /one_off_event_types
POST /shares
POST /scheduling_links
```

### Scheduled events / bookings

```http
GET /scheduled_events
GET /scheduled_events/{uuid}
GET /scheduled_events/{uuid}/invitees
GET /scheduled_events/{uuid}/invitees/{invitee_uuid}
POST /invitees
POST /scheduled_events/{uuid}/cancellation
```

### Availability

```http
GET /user_availability_schedules
GET /user_busy_times
GET /event_type_availability_schedules
PATCH /event_type_availability_schedules/{uuid}
```

### Routing

```http
GET /routing_forms
GET /routing_forms/{uuid}
GET /routing_form_submissions
```

### Webhooks

```http
POST /webhook_subscriptions
GET /webhook_subscriptions
GET /webhook_subscriptions/{uuid}
DELETE /webhook_subscriptions/{uuid}
GET /webhook_subscriptions/sample_data
```

## Exact API Request / Response Patterns

> These are the practical patterns to use in agents. Calendly's JS-heavy reference UI sometimes hides the raw examples, so keep the official docs links nearby and verify if fields drift.

### 1) List event types for the current user

```bash
curl --request GET \
  --url 'https://api.calendly.com/event_types?user=https://api.calendly.com/users/USER_UUID&active=true' \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

Typical response shape:

```json
{
  "collection": [
    {
      "uri": "https://api.calendly.com/event_types/EVENT_UUID",
      "name": "Quick Consult",
      "slug": "quick-consult",
      "active": true,
      "duration": 30,
      "booking_uri": "https://calendly.com/{{GITHUB_USERNAME}}/quick-consult",
      "kind": "solo"
    }
  ],
  "pagination": {
    "count": 1,
    "next_page": null
  }
}
```

### 2) Create a one-on-one event type shell

```bash
curl --request POST \
  --url https://api.calendly.com/event_types \
  --header 'Authorization: Bearer YOUR_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "event_type": {
      "name": "Quick Consult",
      "description": "30-minute paid consult.",
      "slug": "quick-consult",
      "duration": 30,
      "active": true,
      "profile": "https://api.calendly.com/profiles/PROFILE_UUID"
    }
  }'
```

Typical response shape:

```json
{
  "resource": {
    "uri": "https://api.calendly.com/event_types/NEW_EVENT_UUID",
    "name": "Quick Consult",
    "slug": "quick-consult",
    "active": true,
    "duration": 30,
    "booking_uri": "https://calendly.com/{{GITHUB_USERNAME}}/quick-consult"
  }
}
```

### 3) Patch an existing event type

```bash
curl --request PATCH \
  --url https://api.calendly.com/event_types/EVENT_UUID \
  --header 'Authorization: Bearer YOUR_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "event_type": {
      "name": "Deep Dive",
      "slug": "deep-dive",
      "description": "60-minute strategy session."
    }
  }'
```

Use API patch for name/description/slug when supported, then use the UI for payment and booking-page controls.

### 4) Event type available times

```bash
curl --request GET \
  --url 'https://api.calendly.com/event_type_available_times?event_type=https://api.calendly.com/event_types/EVENT_UUID&start_time=2026-05-12T00:00:00Z&end_time=2026-05-18T00:00:00Z' \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

Official constraint from Calendly docs: `start_time` and `end_time` must be future dates and the range cannot exceed 7 days.

### 5) Webhook subscription

Official guide: `https://developer.calendly.com/receive-data-from-scheduled-events-in-real-time-with-webhook-subscriptions`

```bash
curl --request POST \
  --url https://api.calendly.com/webhook_subscriptions \
  --header 'Authorization: Bearer YOUR_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "url": "https://your-domain.com/api/calendly/webhook",
    "events": ["invitee.created", "invitee.canceled"],
    "organization": "https://api.calendly.com/organizations/ORG_UUID",
    "scope": "organization"
  }'
```

Typical response shape:

```json
{
  "resource": {
    "uri": "https://api.calendly.com/webhook_subscriptions/WEBHOOK_UUID",
    "callback_url": "https://your-domain.com/api/calendly/webhook",
    "events": ["invitee.created", "invitee.canceled"],
    "scope": "organization",
    "state": "active"
  }
}
```

### 6) Invitee details follow-up after webhook

Official webhook guide says to use the invitee URI from the webhook payload and then call the invitee endpoint for richer data (email, name, answers to questions).

```bash
curl --request GET \
  --url https://api.calendly.com/scheduled_events/EVENT_UUID/invitees/INVITEE_UUID \
  --header 'Authorization: Bearer YOUR_TOKEN'
```

### 7) Reschedule webhook semantics

Official guide: `https://developer.calendly.com/see-how-webhook-payloads-change-when-invitees-reschedule-events`

- Reschedules trigger **both** `invitee.canceled` and `invitee.created`
- The canceled payload has `rescheduled: true`
- The new invitee payload is the active booking
- Old/new invitee URI references live on the invitee model, not the event model

## Event Type API Reality Check

Calendly exposes event-type creation and updates in v2, but it is still not full parity with the editor.

### Safe assumptions
- API is good for list/read/create/patch of basic event types
- API is good for availability reads and webhook-driven sync
- API is **not** the primary path for Stripe payment configuration
- API coverage for advanced editor features can lag the UI

### Safe hybrid pattern
1. API creates the one-on-one shell event type
2. Playwright opens the editor and finishes advanced settings
3. API/webhooks monitor bookings after launch

## Live Playwright Navigation Map (Observed)

### Core app navigation
- Scheduling
- AI Assistant
- Meetings
- Recaps
- Availability
- Contacts
- Workflows
- Sell
- Integrations & apps
- Routing
- Analytics
- Admin center

### Scheduling page
- URL: `https://calendly.com/app/scheduling/meeting_types/user/me`
- Sub-tabs observed:
  - Event types
  - Single-use links
  - Meeting polls
- Event cards expose:
  - `Copy link`
  - `View live page`
  - `{Event Name} settings`

### Availability pages
- Schedules: `https://calendly.com/app/availability/schedules`
- Calendar settings: `https://calendly.com/app/availability/calendar_settings`
- Direct navigation to `https://calendly.com/app/availability/advanced_settings` returned 404 during this session; verify live before automating.

### Integrations
- `https://calendly.com/integrations`
- Stripe edit page: `https://calendly.com/integrations/stripe/edit`
- Connected items observed: Zoom, Google Meet, Google Calendar, Stripe

### Meetings
- `https://calendly.com/app/meetings/user/me`
- Useful for exports, manual review, and post-booking spot checks

### Routing
- `https://calendly.com/app/routing/forms/user/me`
- `New routing form` was disabled in this session; treat routing as plan/permission-sensitive

## Working Playwright Selectors and Structures

### Event list / cards
- Event list URL: `https://calendly.com/app/scheduling/meeting_types/user/me`
- Settings button pattern: `button[aria-label="Quick Consult settings"]`
- Public link buttons observed as visible text: `Copy link`, `View live page`

### Create flow
- Entry action: `Create new event type`
- Template button text: `One-on-one`
- Draft title field: `textarea[name="name"]`
- Duration button: `#duration-button`
- Duration combobox: `select[name="eventDuration"]` or combobox with `name="eventDuration"`
- Custom duration input: `input[name="customEventDuration"]`
- Custom duration unit: combobox `name="customEventDurationType"`
- Location step commonly used Zoom in the initial editor
- Creation footer button text: `Create`

### Event editor
- Read/display title area: `#event-name-field`
- Editable title field after activating rename: `textarea[name="name"]`
- More options section reveals advanced panels below

### Booking page options
- Panel container: `[data-testid="bookingPageOptions-panel-content-container"]`
- Slug input: `input[name="slug"]`

### Payment
- Panel container: `[data-testid="payment-panel-content-container"]`
- Toggle: `input[name="paymentSwitch"]`
- Amount field: `#payment-amount-field`
- Alternate amount locator seen in DOM: `input[placeholder="0.00"]`
- Processor area text referenced Stripe when connected

### Duration summary
- Panel container: `[data-testid="duration-panel-content-container"]`
- Final saved summary can normalize custom input into `3 hr`, `1 hr`, etc.

## Step-by-Step Playwright Patterns That Worked

### Pattern A — create a new paid one-on-one event
1. Go to `Scheduling` → `Event types`
2. Click `Create new event type`
3. Choose `One-on-one`
4. Fill `textarea[name="name"]`
5. Set duration from `#duration-button` / duration combobox
6. Choose `Zoom` as location
7. Click `Create`
8. If the initial title sticks awkwardly (for example `New MeetingQuick Consult`), rename immediately in the editor
9. Open `More options`
10. Expand `Booking page options` and set `input[name="slug"]`
11. Expand `Payment`, enable `input[name="paymentSwitch"]`, then set `#payment-amount-field`
12. Wait for the amount summary to reflect `$500.00 USD` or the target amount
13. Return to the Scheduling list and confirm the card shows `Copy link`

### Pattern B — edit an existing event
1. From the Scheduling list, open `{Event Name} settings`
2. Use `Edit`
3. If the editor initially shows summary blocks only, click into the specific section again to force the real inputs to mount
4. For slug/payment work, always use `More options`
5. Save, then re-open once to confirm the field persisted

### Pattern C — duplicate to create a variant fast
1. Open `{Event Name} settings`
2. Choose `Duplicate`
3. Open the duplicate editor
4. Rename the event
5. Change duration / slug / amount
6. Return to Scheduling
7. If the new card shows `Turn On`, activate it before sharing the public link

### Pattern D — activate an off event after duplication
1. Open the duplicated card's settings menu
2. Use `Turn On`
3. Re-check the card for `Copy link`
4. Do not announce the link live until `Copy link` is visible

## Stripe Payment Setup via UI

### Known-good flow
1. Confirm Stripe is already connected at `https://calendly.com/integrations/stripe/edit`
2. Open the event editor
3. Go to `More options` → `Payment`
4. Enable `input[name="paymentSwitch"]`
5. Use `#payment-amount-field` to set the amount
6. Confirm Stripe remains the processor and the amount sticks after blur/save
7. Verify via editor summary or public preview that the event now shows the price in USD

### Known-good amounts used live
- Quick Consult → `500.00`
- Deep Dive → `900.00`
- Strategy Session → `2,500.00`

## Gotchas, Wait Patterns, and Reliable Workarounds

### UI gotchas
- Regular Playwright `click()` often gets intercepted by overlays, sticky headers, or collapsed panels
- `fill()` can fail on React-controlled inputs even when the field looks editable
- Some panels look visually expanded while their actual inputs are still unmounted
- Duplicated events may land in an off/draft-like state until explicitly turned on
- Re-opening `More options` can switch the editor between summary and fully editable states

### Wait patterns
- After opening `More options`, wait for the specific panel container instead of generic page idle
- After toggling payment, wait for `#payment-amount-field` to exist before typing
- After changing slug or amount, blur the field and re-read the value from the DOM
- After turning an event on, wait for the Scheduling list card to show `Copy link`

### Reliable DOM forcing technique
When normal `fill()` does not persist, use the native input setter and dispatch events:

```js
(el, value) => {
  const proto = Object.getPrototypeOf(el)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
```

Use this for `input[name="slug"]`, `#payment-amount-field`, and other React-controlled inputs that ignore standard automation.

### Duration-specific note
- For standard durations, use the built-in options (`30 min`, `1 hr`)
- For custom durations, choose `Custom`, then set `input[name="customEventDuration"]` plus `name="customEventDurationType"`
- Calendly may normalize saved output, so a custom duration can later display as `3 hr`

## Recommended Live Workflow for {{PARENT_1}}'s Consulting Tiers

### Quick Consult
- One-on-one
- `30 min`
- Zoom
- slug: `quick-consult`
- payment: `$500`

### Deep Dive
- One-on-one
- `1 hr`
- Zoom
- slug: `deep-dive`
- payment: `$900`

### Strategy Session
- One-on-one
- `3 hr`
- Zoom
- slug: `strategy-session`
- payment: `$2500`
- Fastest creation path: duplicate Deep Dive, then edit duration/slug/payment and turn it on

## Common Agent Operations

### Verify auth
1. `GET /users/me`
2. Store user URI and organization URI
3. If org-level work is needed, fetch org memberships

### Create a new consulting event type
1. API `POST /event_types` to create the shell when possible
2. Open the event in Playwright
3. Use `More options` for slug, invitee form, booking page, payment
4. Turn on the event if needed
5. Verify `Copy link` on the Scheduling card
6. Open the live page before announcing success

### Check bookings
1. `GET /scheduled_events?user=...`
2. For attendee detail, call invitee endpoints from the webhook/event URIs
3. Use webhooks instead of polling whenever possible

### Manage availability
1. `GET /user_availability_schedules`
2. Use the Availability UI when schedule editing is required
3. Cross-check conflict calendars in `Calendar settings`

### Configure paid consult links
1. Confirm Stripe connection
2. Ensure event exists
3. Open editor → `More options` → `Payment`
4. Set amount and verify the summary/public price
5. Confirm the Scheduling card exposes `Copy link`
6. Share the public URL only after that check passes

### Hook Calendly into {{PERSONAL_DOMAIN}}
1. Create/verify event types in Calendly
2. Register webhook on a Vercel endpoint
3. On `invitee.created`, create/update CRM/task/lead state
4. On `invitee.canceled`, update state and handle reschedule logic
5. Keep payment truth in Stripe; keep booking truth in Calendly

## Useful Official References

- Getting started: `https://developer.calendly.com/getting-started/`
- Scopes: `https://developer.calendly.com/scopes`
- API reference root: `https://developer.calendly.com/api-docs`
- Availability guide: `https://developer.calendly.com/view-event-type-and-user-calendar-availability-data`
- Webhook setup guide: `https://developer.calendly.com/receive-data-from-scheduled-events-in-real-time-with-webhook-subscriptions`
- Reschedule payload guide: `https://developer.calendly.com/see-how-webhook-payloads-change-when-invitees-reschedule-events`
- Stripe help: `https://calendly.com/help/calendly-stripe`

## Guardrails

- Prefer **API** for reads, syncing, and supported event CRUD
- Prefer **Playwright/UI** for payment configuration and advanced booking-page edits
- Verify plan-gated areas like Routing and Advanced settings live before depending on them
- Do not assume every editor option is exposed in REST v2
- For a small number of paid links, UI automation is usually faster than over-building API abstractions too early
- Never announce a booking link as live until the Scheduling card shows `Copy link` and the public page loads