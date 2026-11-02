---
name: project_private-events-contact-oct2026
description: /private-events request form, /contact form, grouped top menu, /admin tabs — built 10/17, on PROD since 463b83f (10/17)
metadata:
  type: project
---
Built 2026-10-17 on dev (6fb20d7), NOT on prod — Kaden said "Push to dev, not prod."

- Menu (Kaden picked option A): Parties & Events ▾ (Parties, Private Events, Take Home Kits — kits hidden while `features.kits.enabled` is false), Workshops, Craft Café, Calendar, About ▾ (Our Story, Teach a Class, Contact). Plural labels. Kits stay called "Take Home Kits", never "party in a box".
- Party = our weekend times, booked online. Private event = any day/time, at the studio or "at your place", request → quote ("priced by the event"). No distance limit, no minimum group size on the page (handled with each customer).
- Private event budget: Under $1,000 / $1,000 to $2,500 / $2,500 or more, OPTIONAL, no "not sure" (Kaden: either keep it and make it required, or drop it and keep it optional).
- Contact form requires phone (his "for sure collect email and phone" rule).
- All three public forms share @lib/submissions + components/forms/form-kit; owner emails reply-to the sender; owners also get a text.
- Kaden will mark up copy on the live page himself.

Related: [[project_teach-and-admin-oct2026]]
