#!/usr/bin/env npx tsx
/**
 * Square Setup Script
 *
 * Creates booking custom attribute definitions, webhook subscriptions,
 * and validates catalog structure.
 *
 * Usage:
 *   SQUARE_ACCESS_TOKEN=xxx SQUARE_WEBHOOK_URL=https://your-domain/api/webhooks/square.json npx tsx scripts/setup-square.ts
 *
 * Environment variables:
 *   SQUARE_ACCESS_TOKEN  - Required. Your Square API access token.
 *   SQUARE_ENVIRONMENT   - Optional. "sandbox" or "production" (default: "sandbox")
 *   SQUARE_WEBHOOK_URL   - Required for webhook setup. Your webhook endpoint URL.
 */

import { SquareClient } from 'square'

const token = process.env.SQUARE_ACCESS_TOKEN
const environment = (process.env.SQUARE_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production'
const webhookUrl = process.env.SQUARE_WEBHOOK_URL

if (!token) {
  console.error('Error: SQUARE_ACCESS_TOKEN environment variable is required')
  process.exit(1)
}

const client = new SquareClient({ token, environment })

const summary: { created: string[]; skipped: string[]; warnings: string[] } = {
  created: [],
  skipped: [],
  warnings: [],
}

// --- Custom Attribute Definitions ---

const BOOKING_CUSTOM_ATTRIBUTES = [
  { key: 'event_type', name: 'Event Type', description: 'Type of event booked' },
  { key: 'guest_count', name: 'Guest Count', description: 'Number of guests' },
  { key: 'add_ons', name: 'Add-Ons', description: 'JSON array of selected add-on IDs' },
  { key: 'order_id', name: 'Order ID', description: 'Square order ID linked to this booking' },
  { key: 'special_requests', name: 'Special Requests', description: 'Customer special requests' },
]

async function setupCustomAttributes() {
  console.log('\n--- Booking Custom Attribute Definitions ---')

  for (const attr of BOOKING_CUSTOM_ATTRIBUTES) {
    try {
      await (client.bookings as any).customAttributes.createDefinition({
        customAttributeDefinition: {
          key: attr.key,
          name: attr.name,
          description: attr.description,
          visibility: 'VISIBILITY_READ_WRITE_VALUES',
          schema: { $ref: 'https://developer-production-s.squarecdn.com/schemas/v1/common.json#squareup.common.String' },
        },
      })
      console.log(`  [+] Created: ${attr.key}`)
      summary.created.push(`Custom attribute: ${attr.key}`)
    } catch (error: any) {
      const message = error?.message ?? String(error)
      if (message.includes('CONFLICT') || message.includes('already exists')) {
        console.log(`  [=] Already exists: ${attr.key}`)
        summary.skipped.push(`Custom attribute: ${attr.key} (already exists)`)
      } else {
        console.error(`  [!] Failed: ${attr.key} — ${message}`)
        summary.warnings.push(`Custom attribute ${attr.key}: ${message}`)
      }
    }
  }
}

// --- Webhook Subscriptions ---

const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.updated',
  'payment.created',
  'payment.updated',
  'order.created',
  'order.updated',
]

async function setupWebhooks() {
  console.log('\n--- Webhook Subscriptions ---')

  if (!webhookUrl) {
    console.log('  [!] SQUARE_WEBHOOK_URL not set, skipping webhook setup')
    summary.warnings.push('Webhook setup skipped: SQUARE_WEBHOOK_URL not set')
    return
  }

  try {
    // List existing subscriptions
    const existing = await (client as any).webhookSubscriptions.list()
    const existingUrls = (existing?.subscriptions ?? []).map((s: any) => s.notificationUrl)

    if (existingUrls.includes(webhookUrl)) {
      console.log(`  [=] Subscription already exists for ${webhookUrl}`)
      summary.skipped.push('Webhook subscription (already exists)')
      return
    }

    await (client as any).webhookSubscriptions.create({
      subscription: {
        name: 'Homegrown Studio Booking Events',
        notificationUrl: webhookUrl,
        eventTypes: WEBHOOK_EVENTS,
        apiVersion: '2024-01-18',
      },
      idempotencyKey: `setup-${Date.now()}`,
    })

    console.log(`  [+] Created webhook subscription`)
    console.log(`      URL: ${webhookUrl}`)
    console.log(`      Events: ${WEBHOOK_EVENTS.join(', ')}`)
    summary.created.push(`Webhook subscription: ${webhookUrl}`)
  } catch (error: any) {
    const message = error?.message ?? String(error)
    console.error(`  [!] Failed to create webhook: ${message}`)
    summary.warnings.push(`Webhook: ${message}`)
  }
}

// --- Catalog Validation ---

const EXPECTED_CATEGORIES = ['Workshops', 'Birthday Parties', 'Adult Parties', 'Corporate Events']

async function validateCatalog() {
  console.log('\n--- Catalog Validation ---')

  try {
    const categories: string[] = []
    for await (const item of client.catalog.list({ types: 'CATEGORY' }) as any) {
      categories.push(item.categoryData?.name ?? item.id)
    }

    console.log(`  Found ${categories.length} categories: ${categories.join(', ')}`)

    for (const expected of EXPECTED_CATEGORIES) {
      if (categories.some(c => c.toLowerCase() === expected.toLowerCase())) {
        console.log(`  [ok] ${expected}`)
      } else {
        console.log(`  [!] Missing: ${expected}`)
        summary.warnings.push(`Missing catalog category: ${expected}`)
      }
    }

    // Count items
    let itemCount = 0
    for await (const _ of client.catalog.list({ types: 'ITEM' }) as any) {
      itemCount++
    }
    console.log(`  Total catalog items: ${itemCount}`)
  } catch (error: any) {
    const message = error?.message ?? String(error)
    console.error(`  [!] Catalog validation failed: ${message}`)
    summary.warnings.push(`Catalog: ${message}`)
  }
}

// --- Run ---

async function main() {
  console.log(`Square Setup Script`)
  console.log(`Environment: ${environment}`)
  console.log(`Token: ${token!.slice(0, 8)}...${token!.slice(-4)}`)

  await setupCustomAttributes()
  await setupWebhooks()
  await validateCatalog()

  console.log('\n=== Summary ===')
  console.log(`Created: ${summary.created.length}`)
  for (const item of summary.created) console.log(`  + ${item}`)
  console.log(`Skipped: ${summary.skipped.length}`)
  for (const item of summary.skipped) console.log(`  = ${item}`)
  if (summary.warnings.length > 0) {
    console.log(`Warnings: ${summary.warnings.length}`)
    for (const item of summary.warnings) console.log(`  ! ${item}`)
  }
  console.log('')
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})
