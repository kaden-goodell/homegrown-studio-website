---
name: project-admin-site
description: Kaden wants an admin.homegrowncraftstudio.com management site for workshops (and likely other content)
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ced43d0-929a-442d-9103-4625987a7953
---

Future build: a separate admin site at `admin.homegrowncraftstudio.com` for managing workshops — and likely other content too.

**Why:** Even though Square is the source of truth, the workshop creation flow requires multiple steps across different Square admin views (Appointments for the class schedule, hidden Catalog item for the image). Combine with the fact that the auto-paired catalog item is hidden in Square admin (`productType: CLASS_TICKET` filter), the friction of adding a new workshop with an image is high. The admin site would centralize: pick image file, set schedule, set description, click publish — all in one place.

**How to apply:**
- When implementing new workshop-related features (e.g. the workshops-launch feature with images + detail pages), design the data flow to be admin-friendly. The image upload script (`scripts/upload-workshop-image.ts`) is the API foundation an admin UI would call.
- Don't conflate this with the main site. Main site (`homegrowncraftstudio.com`) is customer-facing read-only; admin site is the operator-facing CMS-style write surface.
- Likely tech: same Astro stack, but mounted at a subdomain. Auth-gated (probably with a single shared password or Square OAuth).
- Workflow it should support at minimum:
  - Create new workshop (calls Square Appointments admin API to create class_schedule)
  - Upload image (calls Square Catalog Images API, attaches to paired CLASS_TICKET item)
  - Edit description (updates the catalog item)
  - Delete workshop (cancels schedule + cleans up orphaned catalog item)
  - Possibly: reservations management, programs management later

Not started yet — flag this whenever workshop/content management comes up.
