/**
 * The error every owner-settings check throws: an HTTP status, a sentence an
 * owner can act on, and the field it is about. Its own module so the pure,
 * browser-safe rules (src/lib/parties/party-times.ts) can throw it without
 * pulling in a store. src/lib/studio-settings.ts re-exports it.
 *
 * Client-safe: no imports.
 */
export class SettingsError extends Error {
  constructor(public status: number, message: string, public field?: string) { super(message) }
}
