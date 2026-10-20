### Task 3: Stores — library (with versions), scheduled classes, blocked time

**Files:**
- Create: `src/lib/classes/library-store.ts`, `src/lib/classes/class-store.ts`, `src/lib/classes/blocked-time.ts`
- Test: `tests/lib/classes/stores.test.ts`

**Interfaces:**

```ts
// library-store.ts (kv 'class-library')
export async function listLibrary(opts?: { includeArchived?: boolean }): Promise<LibraryClass[]>
export async function getLibrary(id: string): Promise<LibraryClass | null>
export async function saveLibraryVersion(input: { id?: string; content: ClassContent; by: By; note: string }): Promise<LibraryClass> // new id when absent; appends version n+1
export async function restoreLibraryVersion(id: string, version: number, by: By): Promise<LibraryClass> // appends a copy as a new version
export async function archiveLibrary(id: string, archived: boolean, by: By): Promise<LibraryClass>
// class-store.ts (kv 'classes')
export async function listClasses(range?: { fromIso: string; toIso: string }): Promise<ScheduledClass[]> // overlapping range
export async function getClass(id: string): Promise<ScheduledClass | null>
export async function createClass(input: { content: ClassContent; sessions: Session[]; libraryId?: string; libraryVersion?: number; status: ClassStatus; by: By }): Promise<ScheduledClass>
export async function updateClass(id: string, patch: { content?: ClassContent; sessions?: Session[]; status?: ClassStatus; square?: ScheduledClass['square'] }, by: By, change: string): Promise<ScheduledClass> // CAS
// blocked-time.ts (kv 'blocked-time')
export interface BlockedTime { id: string; startIso: string; endIso: string; reason: string; by: By; at: string }
export async function listBlocked(range?: { fromIso: string; toIso: string }): Promise<BlockedTime[]>
export async function addBlocked(input: { startIso: string; endIso: string; reason: string; by: By }): Promise<BlockedTime>
export async function removeBlocked(id: string, by: By): Promise<void>
```

`By` is `import type { By } from '@lib/staff-auth'`. Keys: `lib-{id}`, `class-{id}`, `blocked-{id}`; `listClasses` reads every `class-` key (the store is small; add an index only if a test shows it is needed).

- [ ] **Step 1: Failing tests** (fs-backed kv as in `tests/lib/event-meta.test.ts`): versions increment and keep `by`; restore appends; archived hidden by default; class create/get/update keeps history capped at 100; update CAS retries on a lost race (mock `setIfMatch` once false); range filter; blocked add/list/remove; invalid content refused through `validateContent`.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): library, class and blocked-time stores`.

