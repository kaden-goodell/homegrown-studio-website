# Admin rebuild to direction D — common rules for 11b-A, 11b-B, 11b-C

Owner-approved 2026-10-19 ("D looks great. Go on it!!!!"; then "smoking hot and easy to use", fix every UI/UX quirk).
Primary user: Catherine — not technical, on an iPhone at home or an iPad at the counter, running the studio alone.

References (read before coding):
- admin-mockup-D.html in this folder: the approved clickable mock-up. Direction D = functions tabbarD/homeD/calD/classesD/inboxD/moreD and the BUILD sheet map (class, new, block, day, item, msg, libitem, party, cafe, closedday, todo, parties, hours, closed, staff, promos, reports). Copy its STRUCTURE, ORDER and WORDING. Its sample data (names, $3,412, "Catherine") is fake — use real data.
- ux-review.md in this folder: the friction list and the P0/P1/P2 fix list. Every P0/P1 item applies; P2 where cheap.

Shell rules
- 5 tabs: Home · Calendar · Classes · Inbox · More. Inbox shows a count badge (new requests+messages+teachers+to-decide).
- Phone (<900px): fixed bottom tab bar (icons + labels, ≥56px, padding-bottom env(safe-area-inset-bottom)). ≥900px (iPad/desktop): left sidebar 220px with "Hometown Studio" on top; /admin page is no longer capped at 768px (fix src/pages/admin.astro container so the app can use the width; keep a sensible max ~1200px).
- Sheets: ONE at a time. Opening something from inside a sheet REPLACES it (no stacking). Phone = bottom sheet (max-height ~92dvh, grab handle, pinned header with title/subtitle + ×, scrollable body, pinned footer). iPad = right-side panel ~420–480px with the page still visible and usable; long forms (New class, Book a party) may be a centered modal on iPad. Escape and × close; focus returns to the opener; background inert on phone. Dirty forms: in-sheet "Leave without saving? [Keep editing] [Leave]" — never window.confirm/alert.
- Hash routing: #home #calendar #classes #inbox #more plus sheet tokens (#class-<id>, #new, #day-2026-10-24, #party-<id>, #more-hours …). Plain tokens only (letters, digits, - _ .). Refresh restores tab + sheet; iOS swipe-back/back button closes the sheet and stays in /admin (pushState for sheets).
- Toasts: one toast region near the bottom (above the tab bar), role=status, 4s, optional Undo. Replaces page-level flash and scattered notices. Failed saves say so ("Didn't save. Try again.").
- Styles: one admin stylesheet src/styles/admin.css using the site's tokens (global.css); one card style, h1 1.5rem / h2 1.15rem / section label .8rem caps; buttons ≥44px; inputs ≥44px and 16px text (no iOS zoom); focus ring + prefers-reduced-motion; works in the site's light theme. Move component inline <style> blocks into it as you touch them.
- Each data source loads on its own with its own error + Try again; a 401 anywhere returns to sign-in. Sign-in: busy state ("Signing in…"), show-passcode toggle, shared card style.
- Empty states: one sentence + the button that fixes it. Loading: skeleton rows inside the area, chrome stays.
- Admin copy is staff-facing (not customer copy) but keep the house style: plain words, no jargon ("Ways to book", "Seat prices", "Extras", "Date 1 · Day · Starts · Ends · Seats"), "Craft Café" never "Open Studio", "party" never "birthday".
- Keep ALL existing admin API contracts (expectedUpdatedAt/stale, confirm/confirmMove, peopleToTell, refund API). Update existing tests to the new structure (never delete coverage); add tests for new behaviour (React Testing Library). tsc clean. Full suite green except the 3 known clock failures in tests/lib/events.test.ts.
- Never cancel/refund anything automatically. Never write to live Square except through already-proven code paths.
- Verify visually: run `npm run dev` (port 4321; .env is the LOCAL env — it talks to REAL Square/Gmail/Quo, so do NOT submit forms that book/charge/email; signing in and browsing is fine) OR better, don't hit real services at all: rely on tests plus Playwright-free checks. Do not push. Do not dispatch subagents.
- Commit in logical commits with conventional messages. Report to the given report file; return status, commits, one-line test summary, concerns.
