import type { Config, Context } from '@netlify/functions'
import { Resend } from 'resend'

// Program session config — duplicated from site config since Netlify functions
// can't import from the Astro src directory easily
interface ProgramSession {
  id: string
  name: string
  startDate: string
  endDate: string
}

interface ProgramForRoster {
  id: string
  name: string
  schedule: { days: string; time: string }
  sessions: ProgramSession[]
}

interface ChildRoster {
  name: string
  age: string
  allergies: string
  medicalNotes: string
  emergencyContact: string
  authorizedPickup: string
  parentName: string
  parentPhone: string
  parentEmail: string
}

function buildRosterHtml(
  programName: string,
  sessionName: string,
  dates: string,
  schedule: string,
  children: ChildRoster[],
): string {
  const rows = children
    .map(
      (c) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.name}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.age}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.allergies || '—'}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.medicalNotes || '—'}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.emergencyContact}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.authorizedPickup || '—'}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.parentName}<br/>${c.parentPhone}<br/>${c.parentEmail}</td>
    </tr>
  `,
    )
    .join('')

  return `
    <div style="font-family:sans-serif;max-width:800px;margin:0 auto">
      <h1 style="font-size:20px;color:#3d3229">${programName}</h1>
      <h2 style="font-size:16px;color:#6b7280;font-weight:normal">${sessionName} &mdash; ${dates}</h2>
      <p style="color:#6b7280;font-size:14px">${schedule}</p>
      <p style="margin:16px 0;font-size:14px;color:#374151"><strong>${children.length}</strong> enrolled</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#faf8f5">
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Child</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Age</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Allergies</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Medical</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Emergency</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Pickup Auth</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Parent</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

export default async (req: Request, context: Context) => {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log('RESEND_API_KEY not set, skipping roster emails')
    return new Response('No API key', { status: 200 })
  }

  const siteUrl = process.env.URL || 'http://localhost:4321'
  const resend = new Resend(resendKey)

  // TODO: In production, fetch programs config and orders from Square API.
  // For now, this is a skeleton that demonstrates the pattern.
  // The actual implementation would:
  // 1. Load program configs (from a config endpoint or environment)
  // 2. For each program, check if any session starts tomorrow
  // 3. Query Square Orders API for orders containing that session's line items
  // 4. Parse the enrollment JSON from order notes
  // 5. Compile roster and send email

  console.log('Roster check running at', new Date().toISOString())

  // Placeholder: log that the function ran
  return new Response(JSON.stringify({ message: 'Roster check complete' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config: Config = {
  // Run at 9:05 PM CT (which is 3:05 AM UTC next day)
  schedule: '5 3 * * *',
}
