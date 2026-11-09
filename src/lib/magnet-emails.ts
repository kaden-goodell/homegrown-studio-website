// src/lib/magnet-emails.ts
import { sendEmail } from '@lib/email'
import { formatMoney } from '@lib/money'
import { siteConfig } from '@config/site.config'
import { shopConfig } from '@config/shop.config'
import type { MagnetOrder, MagnetStatus } from '@lib/magnet-orders'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const paras = (lines: string[]) => lines.map((l) => `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;color:#3d3229">${esc(l)}</p>`).join('')
const first = (name: string) => name.trim().split(/\s+/)[0] || 'there'

export function sendMagnetConfirmation(o: MagnetOrder) {
  const n = o.magnets.length || o.sets * shopConfig.magnets.setSize
  const lines = [
    `Hi ${first(o.contact.name)},`,
    `Thank you for ordering ${n} photo magnets from Hometown Studio. Your order number is ${o.id}.`,
    o.delivery === 'pickup'
      ? `They will be ready within ${shopConfig.magnets.readyDays} days. We will email you when you can pick them up at the studio.`
      : `We will ship them within ${shopConfig.magnets.readyDays} days to ${o.address}.`,
    `Total paid ${formatMoney(o.amounts.totalCents)}.`,
    o.receiptUrl ? `Your receipt ${o.receiptUrl}` : '',
    `Questions? Reply to this email or call ${siteConfig.contactPhone}.`,
  ].filter(Boolean)
  return sendEmail({ to: o.contact.email, subject: `Your photo magnets are ordered (${o.id})`, text: lines.join('\n\n'), html: paras(lines) })
}

export async function sendMagnetOwnerNotice(o: MagnetOrder, adminUrl: string): Promise<{ sent: boolean }> {
  const lines = [
    `New photo magnet order ${o.id}`,
    `${o.magnets.length} magnets (${o.sets} set${o.sets === 1 ? '' : 's'}), ${o.delivery === 'pickup' ? 'pickup' : `ship to ${o.address}`}`,
    `${o.contact.name} · ${o.contact.email} · ${o.contact.phone}`,
    `Paid ${formatMoney(o.amounts.totalCents)}`,
    `Print it from ${adminUrl}`,
  ]
  const results = await Promise.all(siteConfig.ownerEmails.map((to) =>
    sendEmail({ to, subject: `New magnet order ${o.id}`, text: lines.join('\n'), html: paras(lines) })))
  return { sent: results.some((r) => r.sent) }
}

export async function sendMagnetStatusEmail(o: MagnetOrder, status: MagnetStatus): Promise<{ sent: boolean }> {
  if (status !== 'ready' && status !== 'shipped') return { sent: false }
  const lines = status === 'ready'
    ? [`Hi ${first(o.contact.name)},`, `Your photo magnets are ready to pick up at Hometown Studio. Your order number is ${o.id}.`, `Come by any time we are open. ${siteConfig.contactPhone}`]
    : [`Hi ${first(o.contact.name)},`, `Your photo magnets are on their way to ${o.address}. Your order number is ${o.id}.`, `Thank you for ordering from Hometown Studio.`]
  return sendEmail({
    to: o.contact.email,
    subject: status === 'ready' ? `Your photo magnets are ready (${o.id})` : `Your photo magnets shipped (${o.id})`,
    text: lines.join('\n\n'),
    html: paras(lines),
  })
}
