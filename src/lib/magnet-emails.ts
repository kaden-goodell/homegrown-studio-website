// src/lib/magnet-emails.ts
import { sendEmail } from '@lib/email'
import { formatMoney } from '@lib/money'
import { siteConfig } from '@config/site.config'
import { shopConfig } from '@config/shop.config'
import { productOf, itemsLabel, type MagnetOrder, type MagnetStatus } from '@lib/magnet-orders'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const paras = (lines: string[]) => lines.map((l) => `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;color:#3d3229">${esc(l)}</p>`).join('')
const first = (name: string) => name.trim().split(/\s+/)[0] || 'there'

/** Customer-facing name: "photo magnets" / "framed silhouette(s)". */
const thing = (o: MagnetOrder) => (productOf(o) === 'silhouettes' ? (o.magnets.length === 1 ? 'framed silhouette' : 'framed silhouettes') : 'photo magnets')
const itIs = (o: MagnetOrder) => (productOf(o) === 'silhouettes' && o.magnets.length === 1 ? { it: 'it', is: 'is', It: 'It', They: 'It' } : { it: 'them', is: 'are', It: 'They', They: 'They' })

export function sendMagnetConfirmation(o: MagnetOrder) {
  const sil = productOf(o) === 'silhouettes'
  const days = sil ? shopConfig.silhouettes.readyDays : shopConfig.magnets.readyDays
  const p = itIs(o)
  const what = sil ? `${o.magnets.length} ${thing(o)}` : `${o.magnets.length || o.sets * shopConfig.magnets.setSize} photo magnets`
  const lines = [
    `Hi ${first(o.contact.name)},`,
    `Thank you for ordering ${what} from Hometown Studio. Your order number is ${o.id}.`,
    o.delivery === 'pickup'
      ? `${p.They} will be ready within ${days} days. We will email you when you can pick ${p.it} up at the studio.`
      : `We will ship ${p.it} within ${days} days to ${o.address}.`,
    sil && o.delivery === 'pickup' ? `Coming by the studio sooner? Ask us and we can usually print it while you are here.` : '',
    sil ? `Want to decorate the frame yourself? Come by the studio any time we are open and we will set you up. It is included.` : '',
    `Total paid ${formatMoney(o.amounts.totalCents)}.`,
    o.receiptUrl ? `Your receipt ${o.receiptUrl}` : '',
    `Questions? Reply to this email or call ${siteConfig.contactPhone}.`,
  ].filter(Boolean)
  return sendEmail({ to: o.contact.email, subject: `Your ${thing(o)} ${p.is === 'is' ? 'is' : 'are'} ordered (${o.id})`, text: lines.join('\n\n'), html: paras(lines) })
}

export async function sendMagnetOwnerNotice(o: MagnetOrder, adminUrl: string): Promise<{ sent: boolean }> {
  const lines = [
    `New ${productOf(o) === 'silhouettes' ? 'silhouette' : 'photo magnet'} order ${o.id}`,
    `${productOf(o) === 'silhouettes' ? itemsLabel(o) : `${o.magnets.length} magnets (${o.sets} set${o.sets === 1 ? '' : 's'})`}, ${o.delivery === 'pickup' ? 'pickup' : `ship to ${o.address}`}`,
    `${o.contact.name} · ${o.contact.email} · ${o.contact.phone}`,
    `Paid ${formatMoney(o.amounts.totalCents)}`,
    `Print it from ${adminUrl}`,
  ]
  const results = await Promise.all(siteConfig.ownerEmails.map((to) =>
    sendEmail({ to, subject: `New ${productOf(o) === 'silhouettes' ? 'silhouette' : 'magnet'} order ${o.id}`, text: lines.join('\n'), html: paras(lines) })))
  return { sent: results.some((r) => r.sent) }
}

export async function sendMagnetStatusEmail(o: MagnetOrder, status: MagnetStatus): Promise<{ sent: boolean }> {
  if (status !== 'ready' && status !== 'shipped') return { sent: false }
  const p = itIs(o)
  const T = thing(o)
  const lines = status === 'ready'
    ? [`Hi ${first(o.contact.name)},`, `Your ${T} ${p.is} ready to pick up at Hometown Studio. Your order number is ${o.id}.`,
       productOf(o) === 'silhouettes' ? `Come by any time we are open. Stay a bit and decorate the frame if you like, it is included. ${siteConfig.contactPhone}` : `Come by any time we are open. ${siteConfig.contactPhone}`]
    : [`Hi ${first(o.contact.name)},`, `Your ${T} ${p.is} on ${p.is === 'is' ? 'its' : 'their'} way to ${o.address}. Your order number is ${o.id}.`, `Thank you for ordering from Hometown Studio.`]
  return sendEmail({
    to: o.contact.email,
    subject: status === 'ready' ? `Your ${T} ${p.is} ready (${o.id})` : `Your ${T} shipped (${o.id})`,
    text: lines.join('\n\n'),
    html: paras(lines),
  })
}
