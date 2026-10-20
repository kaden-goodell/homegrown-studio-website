# Task 7 additions (binding, from Task 5 review + fix)
- Always pass endIso to confirmTime; wrap it: on a store failure still save the party record as paid and alert owners (R6).
- Unknown payment outcome: extendHold(partyId, startIso, null, endIso) (no expiry until an owner sorts it); include held:false + clash in the owner alert.
- Owner path for "paid, outcome unclear, never retried": a To decide item 'party-paid-unclear' (confirm the party / it wasn't paid) — mirrors stage-1 R42 'paid-not-seated'; the webhook/reconcile for pty_ orders confirms the hold + record when Square shows the order paid.
- Add 'itm' to idFor; pass rec.packageId to orderLineItems (required).
- From Task 5 re-review: new party id per attempt (confirm/repeat holds only grow ends); owner alerts use owner wording, not the customer "That party time was just taken…" sentence.
- From Task 6 review: delete legacyBookingHeldBy; remove the R10 "book anyway on check error" path; refuse unknown/archived packages when holding; hold the full length incl. every extra-time add-on (minutes helper with add-on counts); never trust the browser's variation id; public party reads skip/batch per-party label lookups.
