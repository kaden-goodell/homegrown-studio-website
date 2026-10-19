# Square Setup Guide

Step-by-step instructions for configuring Square Dashboard and connecting to the booking platform.

## Prerequisites

- Square account with Appointments and Payments enabled
- Square Developer account with an application created
- Access to Square Dashboard

## 1. Square Dashboard: Create Categories

In **Items > Categories**, create:

1. **Workshops** — pottery, candle making, etc.
2. **Birthday Parties** — kids birthday packages
3. **Adult Parties** — adult event packages
4. **Corporate Events** — team building, corporate workshops

## 2. Square Dashboard: Create Items

For each event type, create a catalog item:

1. **Name**: e.g., "Pottery Workshop"
2. **Category**: Select the appropriate category
3. **Variations**: Create pricing tiers (e.g., "Standard — $45", "Premium — $65")
4. **Description**: Customer-facing description
5. **Image**: Upload a representative photo
6. **Modifier Lists**: Create add-on options (e.g., "Extra Clay — $10", "Gift Wrap — $5")

### Custom Attribute: Flow Type

To mark an event as "quote only" (no direct booking), add a custom attribute:
- Key: `flow`
- Value: `quote`

Events without this attribute default to the standard booking flow.

## 3. Square Dashboard: Set Up Loyalty (Optional)

In **Loyalty**:

1. Create a loyalty program
2. Set accrual rules (e.g., 1 point per $10 spent)
3. Create reward tiers (e.g., "50% off a workshop" at 10 points)

The platform reads loyalty data via API but does not create programs.

## 4. Run the Setup Script

The setup script creates booking custom attributes and webhook subscriptions.

```bash
# Sandbox
SQUARE_ACCESS_TOKEN=your_sandbox_token \
SQUARE_ENVIRONMENT=sandbox \
SQUARE_WEBHOOK_URL=https://your-netlify-preview-url/api/webhooks/square.json \
npx tsx scripts/setup-square.ts

# Production
SQUARE_ACCESS_TOKEN=your_production_token \
SQUARE_ENVIRONMENT=production \
SQUARE_WEBHOOK_URL=https://ourhometownstudio.com/api/webhooks/square.json \
npx tsx scripts/setup-square.ts
```

The script will:
- Create 5 booking custom attribute definitions (event_type, guest_count, add_ons, order_id, special_requests)
- Create a webhook subscription for booking, order, payment and refund events
- Validate that expected catalog categories exist
- Print a summary of what was created, skipped, or warned about

### Webhook subscription (own classes)

The site needs Square's webhooks so counter (POS) sales and refunds made in
Square reach our class seat list. In the Square Developer Dashboard >
Webhooks, the subscription must have:

- **URL:** `https://ourhometownstudio.com/api/webhooks/square.json`
  (the old `homegrowncraftstudio.com` domain redirects, and Square does not
  follow a redirect on a webhook)
- **Events:** `order.updated`, `payment.updated`, `refund.created`, `refund.updated`

Then copy its signature key into `SQUARE_WEBHOOK_SIGNATURE_KEY` and the same
URL into `SQUARE_WEBHOOK_URL` (below). Without the key every webhook is
refused (500); with a different URL every signature check fails (403). A
nightly catch-up (3 AM) also picks up sales and refunds from the last 48
hours; an owner signed in to /admin can run it now with a POST to
`/api/jobs/reconcile-classes.json?force=1`.

## 5. Configure Environment Variables

### Netlify Dashboard

Set these in **Site configuration > Environment variables**:

| Variable | Value |
|----------|-------|
| `SQUARE_ACCESS_TOKEN` | Your Square API access token |
| `SQUARE_ENVIRONMENT` | `production` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | From Square Developer Dashboard > Webhooks |
| `SQUARE_WEBHOOK_URL` | `https://ourhometownstudio.com/api/webhooks/square.json` (exactly; the old domain redirects and Square won't follow a redirect) |
| `SQUARE_CLASSES_CATEGORY_ID` | The Square category our class items go in |
| `SQUARE_CLASS_TAX_ID` | The Square tax for taxable classes (without it a taxable class stays off the POS) |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL for notifications |

### Local Development (.env)

```env
SQUARE_ACCESS_TOKEN=your_sandbox_token
SQUARE_ENVIRONMENT=sandbox
SQUARE_WEBHOOK_SIGNATURE_KEY=your_sandbox_webhook_key
SQUARE_WEBHOOK_URL=http://localhost:4321/api/webhooks/square.json
SLACK_WEBHOOK_URL=your_slack_webhook_url
PROVIDER_MODE=square
```

## 6. Switch to Square Providers

Set `PROVIDER_MODE=square` in your environment to activate real Square providers.

With `PROVIDER_MODE=mock` (default), the platform uses mock data for development.

## 7. Verify

1. Run locally: `npm run dev`
2. Browse workshops — should show items from your Square catalog
3. Test the booking flow in sandbox mode
4. Check Slack for webhook notifications
5. Deploy to Netlify and verify the deploy preview
