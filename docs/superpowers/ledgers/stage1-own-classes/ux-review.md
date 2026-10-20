# /admin UX review (18 Oct 2026)

Branch `kaden/own-booking-system`. Read only. Primary user: Catherine, not technical, on an iPhone or iPad, running classes alone.
Bar to meet: the booking modals (`src/components/shared/BookingPanel.tsx`, used by WorkshopBookingModal and PartyModal) and the /staff console (`src/components/staff/*`).

**The short version:** /admin is a row of 7 tabs. Every class screen *replaces* the tab under it, so each tap is a page swap that forgets where you were. Nothing opens as a sheet. Nothing warns before your edits are thrown away. The same job (picking dates) has two different forms. The class form is a 7-section page whose preview ends up under the Save bar. Library and inbox screens show a wall of buttons on every card. None of it uses the panel chrome that customers and crew already have.

---

## 1. The current flow, as Catherine meets it

### Screen map
```
/admin (src/pages/admin.astro: max-w-3xl column = 768px wide at most)
 ├─ Sign in (passcode)                                     AdminApp.tsx:104-114
 └─ Tabs: Calendar · Classes · Library · Block time · Private events · Messages · Teachers   :121
      default tab = Private events                                                         :43
      Calendar ─tap class─▶ [Class bookings]  (replaces the calendar)                      :150
               ─tap other─▶ inline Detail under the item                       CalendarView:85-92
               ─Print─────▶ [Print day]  (replaces the calendar)                           :150
      Classes ─tap──▶ [Class bookings]   ─"New class"─▶ [Editor: new]                      :153
      Library ─Schedule───────────────▶ inline ScheduleDialog inside the card ─▶ [Class bookings]
              ─Change details, then schedule─▶ [Editor: from-library] ─▶ [Class bookings]
              ─Edit / Add a class to the library─▶ [Editor: library] ─▶ back to Library
      [Class bookings] ─Edit class─▶ [Editor: edit] ─Back─▶ [Class bookings]       AdminApp:144
                       ─Run it again─▶ inline ScheduleDialog ─▶ [Class bookings for the copy]
                       ─Back─▶ the tab's list (always)                                     :143
      Block time = its own page: form + "Coming up" list                         BlockTimeForm
      Inbox tabs = filter buttons + long cards with status pills          AdminApp:195-218
```

### Friction points (file:line)
**Navigation and lost state**
1. **The page swaps out. Nothing opens on top.** A "panel" replaces the whole tab (`AdminApp.tsx:126-148`). Opening a class from the calendar unmounts CalendarView, and `initialDay` is never passed (`:150`). So Back always lands on *this* week, in Week view, at the top of the page. The Classes list loses its scroll position the same way.
2. **Unsaved edits are lost with no warning.** This happens on Back (`ClassEditor.tsx:399`), on any tab (`AdminApp.tsx:122` clears the panel), and on reload. There is no leave prompt. Compare BookingPanel's `leavePrompt`.
3. **No URL state.** iOS swipe-back or a refresh leaves /admin, or lands on the "Private events" tab (`:43`). An edit in progress can't be resumed.
4. **Seven equal-weight 48px tab buttons** wrap to 3–4 rows on a phone (`:121`). Class tools and inboxes are mixed together. "Block time" is a whole tab for a job you do once a month.
5. **If any one inbox fetch fails, the whole of /admin fails.** One bad call among applications, requests or messages takes the class tools down with it (`AdminApp.tsx:52-58`).
6. **Back sits in a different place on every screen.** Top right in the editor and bookings (`ClassEditor.tsx:397-400`, `ClassBookings.tsx:78-81`). Top left in Print day (`PrintDay.tsx:50`) and in the bookings loading state (`ClassBookings.tsx:65`).
7. **The success message lands at the top of the page, away from the tap.** One page-level `flash` (`AdminApp.tsx:125`) shows "Added." after a save made at the bottom of a long form. It stays until you change tab. Several screens also print their own notices: `ClassEditor.tsx:561`, `LibraryList.tsx:90` (success shown in the *warning* amber), `BlockTimeForm.tsx:90`.

**Creating and editing a class**
8. **The user has to think about the library.** "Add class" sits next to "Add and keep in the library" (`ClassEditor.tsx:572-577`). The second button fires a second update call and can half-fail (`:343-352`). The Library tab has its own "Add a class to the library" (`LibraryList.tsx:40`). That makes three ways in.
9. **"Just this date / Also update the library" shows up on *every* save of a library-based class** (`ClassEditor.tsx:566-570`), even when only the time, the seats or the status changed. "Just this date" is wrong for a class with several dates.
10. **The form is one long page of 7 sections:** Basics, Sessions, Passes & prices, Ticket types, Questions, Add-ons, Rules (`:21-24`, `:404-546`). Basics alone holds name, description, photo, teacher, price, "Usual length", "Usual seats" and status (`:405-434`). "Usual length/seats" only feed default values, but sit beside the per-date seat count (`:422-425` vs `:444`).
11. **The preview never sits beside the form.** The two-column layout needs ≥960px (`:393`), but /admin is capped at 768px (`admin.astro`). The card always renders *below* the sticky save bar (`:583-586`), so on a phone you never see it while typing.
12. **The date-picking UI exists twice and behaves differently.** Editor sessions are labelled "Session 1 day" and don't move the end time when the start changes (`ClassEditor.tsx:441-444`, `:591`). ScheduleDialog is labelled "Date 1 day" and does move it (`ScheduleDialog.tsx:40-47`, `:74-83`). Status choices differ too: 3 in the editor (`:429-431`), 2 in the dialog (`:98-99`).
13. **The move-confirm is a dead end.** When moving a date that has bookings returns people to tell, the normal buttons hide (`ClassEditor.tsx:563`). The only buttons left are "Move and I'll tell them" and Back, which throws away the edit. There is no "Don't move".
14. **Errors don't come to you.** `showErrors` opens the right section (`:288-298`) but doesn't scroll to it or move focus. Catherine taps Save at the bottom and sees nothing change.
15. **A stale save throws away the edit.** `reload()` refills the form from the server ("Make your change again.", `:362-372`).
16. **The photo picker is a bare native file input** (`:411`). No thumbnail beside it. "Remove photo" is a full-width button.
17. **The price grid is a table that scrolls sideways on a phone** (`:456-490`). "Pass", "Ticket type" and "covers" are jargon.

**Class detail, library, calendar**
18. **The bookings screen and the editor are separate pages for one class.** "Cancel this class" sits in the same row as "Edit class", in the same style (`ClassBookings.tsx:89-93`). Dates are a plain list you can't tap (`:83-87`).
19. **Library cards carry 5 buttons each** (`LibraryList.tsx:101-109`), which wrap to 3 rows on a phone. Archive is one tap, the same weight as Edit. "version 4" shows in the summary line (`:85`).
20. **The calendar header is crowded:** title, Week/Month, Last/Today/Next and a 6-colour legend (`CalendarView.tsx:106-123`). Each of the 7 days has its own Print link (`:196`). You can't add from a day: no "+ class here" and no "block this time" (`:198`). Our classes open a full page, while every other item opens inline (`:81-84`): two patterns on one screen.
21. **The month cells use colour dots only** (`:154-156`). The aria-label says how many items, not what they are.
22. **The sandbox panel shows on the live site** until someone taps it (`ClassList.tsx:20`, `:69-82`): "For the test site only… 9% sales tax…".

**Inboxes and sign-in**
23. **Status pills save on one tap.** There is no undo and no message when it fails: `moveApp/moveRequest/moveMessage` ignore `!res.ok` (`AdminApp.tsx:78-100`). Under the "New" filter, a card disappears the moment you tap "Replied" (`:204`).
24. **Inbox cards show every answer, open, every time** (`EventRequestCard.tsx:47-81`, `AdminApp.tsx:242-251`). Five requests make a very long scroll. There is no "what do I do next" line.
25. **The pills are small:** 0.8rem text (`StatusPills.tsx:6`). On a phone they wrap beside the name. The counts in the tab labels ("Private events (2 new)", `AdminApp.tsx:117`) make the tab row wider still.
26. **Sign-in has no busy state.** Double taps send twice (`:69-76`). There is no show-passcode option. Its glass card looks different from every other admin card (`:106`).

**Visual consistency**
27. **Heading sizes drift:** h1 1.75rem in lists, 1.6rem in the editor and bookings. h2 sizes run 1.2, 1.15 and 1rem (`ClassList.tsx:46`, `ClassEditor.tsx:398`, `PrintDay.tsx:64`, `CalendarView.tsx:195`).
28. **Three card styles:** `glass rounded-2xl` (inbox), `box` (classes, `ui.ts:5`) and staff `card` (`staff/ui.tsx:6`).
29. **Styles are written inline** in each component through `<style>` blocks (`ClassEditor.tsx:391`, `CalendarView.tsx:101`, `PrintDay.tsx:38`). `quiet` is an empty object that does nothing (`ui.ts:12`).
30. **Collapsible sections are buttons styled as headings, not real headings** (`ClassEditor.tsx:631-640`), so the outline is flat for VoiceOver. Every repeated row is labelled "Session 1 day / Session 1 start…" instead of being grouped in a fieldset.
31. **The tabs have `role="tab"` but no tabpanel and no arrow-key support** (`AdminApp.tsx:120-123`). The focus ring comes from global CSS. The `.booking-panel` focus and reduced-motion rules (`booking-panel.css:42`, `:65`) don't apply here.

---

## 2. Three directions to choose from
All three share these parts:
- **AdminSheet:** BookingPanel's shell, with the step bar optional. It is a bottom sheet on phones and a right-side sheet on iPad, like the staff sheets. It has a pinned footer, Escape and the × close, a leave prompt, and focus that returns to what opened it.
- **One class sheet**, with tabs **Bookings · Details · Dates**.
- **One New class sheet**, in 4 steps:
  1. **Start from:** library cards, plus "Start fresh".
  2. **Details:** name, photo, description, price, ages. "More options" opens seat prices, extras, questions and rules.
  3. **Dates.**
  4. **Check & add:** Open or Draft.
- **One Block time sheet** and one **Day sheet** (that day's list plus Print).

The same hash URL (`#class/<id>/bookings`, `#new`, `#day/2026-10-24`) puts the screen back after a refresh or a swipe-back.

### A. "One home screen"
```
Home (#)
 ├ Today & this week: agenda rows (time · name · 5 of 12 booked · Draft tag) → Class sheet / Day sheet
 ├ [ + New class ]  [ + Block time ]  [ Print today ]
 ├ Needs you: Requests 2 · Messages 1 · Teachers 0  → Inbox sheet (segments) → item sheet
 └ Links: All upcoming · Library · Calendar   (each opens as a full-height sheet over Home)
```
- **Primary actions:** + New class, tap a row.
- **Where each feature lives:**
  - Calendar, upcoming list and library open as sheets.
  - Block time is a button on Home.
  - Print day is on Home, and in every day header in the calendar.
  - Inboxes sit behind the badge row.
  - Sign-in is the same, restyled.
- **Pros:** one place to start. It answers "what's on today?" without a tap. It is the closest to the modal-first habit.
- **Cons:** sheets open on top of sheets (Home, Library, Class) need care on a phone. You can only get to the calendar from Home.

### B. "Calendar first"
```
Calendar (#) — phone: week as a day list; iPad: 7 columns; Month toggle
 ├ tap empty day / "+" in day header → Add sheet: [New class on this day] [Block time on this day]
 ├ tap any item → its sheet (class sheet / party / blocked / closed)  — one pattern for all
 ├ header: ‹ Week of Oct 19 › · Today · Month · [ Library ] · [ Inbox ●3 ]
 └ Inbox = right tray (Requests · Messages · Teachers); Library = sheet with Schedule on each card
```
- **Primary actions:** tap a day to add, tap an item to open it.
- **Where each feature lives:**
  - "Upcoming classes" becomes a "List" toggle next to Week/Month.
  - Print is in each day sheet.
  - Block time comes from a day.
- **Pros:** the date is picked by tapping the day, so the Dates step comes pre-filled. One "tap anything opens a sheet" rule. Room clashes are visible as she plans.
- **Cons:** the week list is long on a phone. Inbox items are less visible, so the badge has to carry them. A class with several dates shows up on several days.

### C. "Like /staff"
```
StaffHeader-style bar: tabs  This week · Classes · Library · Inbox(3)   + account menu (Sign out)
 ├ This week: staff ThisWeek-style tiles, one per day; class tiles show seats + waiver count → Class sheet
 ├ Classes: tile grid of upcoming; [ + New class ] pinned top-right
 ├ Library: photo tiles; tap → library sheet (Schedule · Edit · Earlier versions · Archive)
 └ Inbox: tiles per item with a status Badge; tap → right-side sheet with full answers + status
```
- **Primary actions:** + New class, open a tile.
- **Where each feature lives:**
  - Calendar month view is a toggle on This week.
  - Block time is a header button.
  - Print is on the day tile.
- **Pros:** one design language for owners and crew. It reuses `staff/ui.tsx` (`card`, `btn`, `Badge`) and the right-side sheets, which already work on the iPad at the counter. Less new styling.
- **Cons:** the staff tiles are made for the door, not for planning. The admin month view still needs its own design. There are 4 tabs instead of 1 home.

**My pick for Catherine: B**, with A's "Needs you" badge in the header. Most admin work is "put a class on a day" or "what's on this day". Calendar-first makes that one tap and puts the date in for her. Choose C if one shared look with the crew matters more.

### Where you land, whichever direction is picked
- **Create:** the class sheet opens on Bookings, with a toast: "Added. It's on the calendar and in your library."
- **Save an edit:** stay in the sheet. Toast: "Saved." The Save button greys out until the next change.
- **Cancel a class:** stay in the sheet. Status shows "Cancelled", then the list of who to contact.
- **Run it again, or schedule from the library:** the new class's sheet opens.
- **Close a sheet:** back exactly where you were (same view and scroll), and that list refreshes.
- **Empty states:** a sentence plus the button that fixes it, for example "No classes coming up. [+ New class]" or "Nothing on this day. [+ Add]".
- **Loading:** skeleton rows inside the sheet; the chrome stays put.
- **Error:** a plain sentence plus [Try again] *inside* the part that failed. The rest of /admin keeps working.

---

## 3. Fix list (applies whichever direction is picked)

### P0, must fix
1. **AdminSheet shell.** Pull BookingPanel's chrome into an optional-steps `AdminSheet` (`shared/BookingPanel.tsx` → new `admin/AdminSheet.tsx`). Render ClassEditor, ClassBookings, PrintDay, ScheduleDialog and BlockTimeForm inside it, instead of swapping the tab (`AdminApp.tsx:126-163`).
   *Check:* open a class from Month view on Oct 24 and close it. Still Month, Oct 24, same scroll. Escape closes. Focus returns to the row. The page behind is inert.
2. **Warn before throwing edits away.** Track dirty state in ClassEditor against `initialForm`. ×, Back, a tab change or Escape with changes shows the in-sheet leave prompt: "Leave without saving? [Keep editing] [Leave]". Never `window.confirm`.
   *Check:* type a name, tap ×. The prompt shows. "Keep editing" keeps the text.
3. **One class sheet with tabs Bookings · Details · Dates.** Merge ClassBookings and ClassEditor (edit mode). Dates uses **one** shared `DateRows` component, pulled out of `ScheduleDialog.tsx:72-93`, where the end time follows the start. The editor's sessions block goes (`ClassEditor.tsx:437-452`). Cancel this class moves to the bottom of Details, in a red outline.
   *Check:* a single date-row UI across the app. "Session" no longer appears in the admin. Changing the start moves the end in every place you pick dates.
4. **Every new class goes into the library automatically.** The server create (`lib/classes/admin-actions.ts:190-208`) makes or updates a library entry when `libraryId` is missing, and links the class to it. Remove "Add and keep in the library" and the follow-up call (`ClassEditor.tsx:343-352`, `:575`). Remove "Add a class to the library" (`LibraryList.tsx:40`). Library entries are made only by adding a class; editing one stays in its sheet.
   *Check:* a test creates a class from scratch, and the library list then has it at version 1. The class's `libraryId` is set. The UI has exactly one "Add class" button.
5. **"Only this class / This class and the library" appears only when it matters.** On Save, compare the built `content` (leaving out `sessions` and `status`) with the latest library version's content. If they are the same, do a plain Save. If they differ, the footer shows the two choices: "Only this class" (primary) and "This class and the library". They replace `ClassEditor.tsx:566-570`. The same choice shows in New class step 4 when she started from the library and changed the details.
   *Check:* changing only the time or seats shows one Save. Changing the price shows the two choices.
6. **The move-confirm gets a way out.** When `toTell` is set (`ClassEditor.tsx:551-563`), show the list of people above the footer, plus [Move and I'll tell them] and [Don't move]. "Don't move" puts the old dates back.
   *Check:* every state of the footer has a way out.
7. **One failing loader doesn't take down the rest.** Each inbox loads on its own, with its own error and Try again (`AdminApp.tsx:49-66`). A 401 from any of them still signs you out.
   *Check:* break messages.json, and Calendar and Classes still work.
8. **Hide the sandbox panel on the live site.** Show it only when the server reports sandbox (`ClassList.tsx:20`, `:69`). Starting from `showSeed=true` is the bug.
   *Check:* production /admin never shows "Set up sandbox".
9. **Errors come to you.** On a failed save, scroll to the first error and focus its field (`ClassEditor.tsx:288`). Also show one line in the footer: "Fix the price under Details."
   *Check:* a blank name plus Save puts focus on Name.
10. **Home screen and navigation.** Implement the direction Kaden picks (A, B or C). The default view is the class home, not Private events (`AdminApp.tsx:43`). Block time stops being a tab. Keep the hash URL state.
    *Check:* refresh on a class sheet opens the same sheet. iOS swipe-back closes the sheet and stays in /admin.

### P1, should fix
11. **New class as a 4-step sheet:** Start from → Details → Dates → Check & add, with BookingPanel's step bar. "More options" (seat prices, extras, questions, rules) stays folded unless it has something in it.
    *Check:* a simple $30 class takes ≤ 4 screens and never opens "More options".
12. **Thin out Details.** Remove "Usual length/Usual seats" from the class Details (`ClassEditor.tsx:422-425`). Fill them in from the first date and keep them library-only. Status becomes a 3-option switch on Dates or in step 4 (`:426-434`).
13. **Preview as a button, not a footer.** Use a "Preview" button in the sheet header that opens the card. Or put it in the 2-column layout only above 960px inside the sheet (`:583-586`; the page max-width breaks it today).
14. **Photo picker.** A thumbnail plus [Choose photo] / [Change] / [Remove], with the native input hidden behind it (`:410-415`).
15. **Price grid on a phone.** Use one card per package with price boxes stacked, instead of a table that scrolls sideways (`:456-490`).
16. **Library cards.** One primary [Schedule]; tap the card to open the library sheet. Edit, Earlier versions and Archive live in the sheet. Archive shows an Undo toast. Drop "version N" from the summary (`LibraryList.tsx:85`, `:101-109`). Success messages use the status style, not amber (`:90`).
17. **Calendar.**
    - Tap an empty day or the "+" in a day header to open the Add sheet with the date filled in.
    - Every item opens a sheet, ours or not (`CalendarView.tsx:81-92`).
    - The legend folds into a "Key" link.
    - One Print, in the day sheet, replaces the 7 links (`:196`).
    - Month cells get a text count, for example "3".
18. **Toasts.** One toast component near the bottom with role="status" that fades after 4 s. It replaces the page-level `flash` (`AdminApp.tsx:125`) and the scattered notices.
19. **Inbox.**
    - Cards fold to a headline (name · kind · date · guests) plus [Call] [Email]. Tap to see every answer in a sheet.
    - The status control is a 44px segmented control.
    - A failed save shows "Didn't save. Try again."
    - Under a filter, a card that changes status stays until you leave the view, with an Undo.
    - Files: `EventRequestCard.tsx`, `MessageCard.tsx`, `StatusPills.tsx`, `AdminApp.tsx:78-100`, `:204`.
20. **Sign-in.** Disable the button with "Signing in…" while it works. Add a show-passcode toggle. Use the shared card style (`AdminApp.tsx:104-114`).
21. **Admin labels: copy changes.** These are not customer copy. Do the swaps in a single change:
    | Now | Becomes |
    |---|---|
    | Session 1 day / start / end / seats | Date 1 › Day · Starts · Ends · Seats (fieldset legend "Date 1") |
    | Passes & prices / Pass / covers | Ways to book / Package / Includes |
    | Ticket types | Seat prices (like Adult and Kid) |
    | Add-ons | Extras |
    | Rules | Ages and booking rules |
    | Usual length (minutes) / Usual seats | How long it usually runs / Seats it usually has (library only) |
    | Just this date / Also update the library | Only this class / This class and the library |
    | Change details, then schedule | (gone: New class › from library) |
    | Add class / Add and keep in the library | Add class |
    | Edit class / Back | (tabs in the sheet; × to close) |
    | Never mind / Keep it / Pick another time | Never mind (cancel words) · Keep it (for destructive prompts only) |
    | Reloaded. Make your change again. | Someone else changed this class. Your edits are kept; check them and save again. |
    | Added. | Added. It's on the calendar and in your library. |
22. **Stale save keeps the edits.** On a 409 stale, get the latest `updatedAt`, keep the typed form, show what changed, and let her save again (`ClassEditor.tsx:362-372`).

### P2, nice to have
23. **One admin stylesheet** (`src/styles/admin.css`):
    - Heading scale: h1 1.5rem, h2 1.15rem, section label 0.8rem caps.
    - One card style. Spacing 0.75rem inside and 1rem between.
    - The `<style>` blocks move out of the components. Delete `quiet` (`ui.ts:12`).
    - Wrap /admin in `.booking-panel` so the focus ring and reduced-motion rules apply.
24. **Collapsible sections become real headings:** `<h2><button aria-expanded>` with a chevron. They open automatically when they have content or an error. Every section stays open on iPad width (`ClassEditor.tsx:629-645`).
25. **Navigation a11y.** Either full tablist (tabpanel, `aria-controls`, arrow keys) or plain nav buttons with `aria-current` (`AdminApp.tsx:120`).
26. **Classes list.** A "Past" toggle. Cancelled classes go into their own folded group at the bottom (`ClassList.tsx:52-68`).
27. **Print day.** A day picker with ‹ › arrows. Print hides the sheet chrome (`PrintDay.tsx:49-56`).
28. **Compact density on phone.** Inside sheets, use 0.5rem gaps between fields and pair the inputs that belong together (Starts and Ends side by side at ≥ 360px). Fields stay at least 44px tall and 16px text.

**Counts: 10 P0 · 12 P1 · 6 P2**
