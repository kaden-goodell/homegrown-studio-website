# Task 3 report
Status: done. Files: library-store.ts, class-store.ts, blocked-time.ts, tests/lib/classes/stores.test.ts; validate.ts: newId gains 'blk', toIso exported.
Tests: 8 new pass; full suite 2991 pass; tsc 0.
Notes: kv has no delete, so removeBlocked writes a tombstone ({removed:{by,at}}) that listBlocked skips (CAS, 3 attempts); removing twice or an unknown id is a no-op. createClass is a plain set (new id). saveLibraryVersion with an unknown id throws. Library list sorted newest-version first. Restore note is "Restored version N". archiveLibrary does not log `by` (no history field on LibraryClass).
