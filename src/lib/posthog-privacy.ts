/**
 * What PostHog may collect on a page (final security review I5).
 *
 * Pages that show customers' details as page text (the owners' /admin, the
 * crew's /staff and its sub-pages, the agreement at the door, the private
 * party pages) are never session-recorded, AND send no autocaptured clicks or
 * element text: an autocaptured tap on "Email Jane Smith the new details"
 * would otherwise carry the family's name (sometimes an email or phone) to
 * PostHog. Pageviews and the explicit operational logs keep working.
 *
 * Client-safe: no imports.
 */

/** Paths whose page text holds customers' details. */
const PRIVATE_TEXT_PATHS = /^\/(admin|staff|waiver|party)(\/|$)/

export interface PostHogPagePrivacy {
  /** never session-recorded */
  noRecording: boolean
  /** no autocapture, no heatmaps, all text and attributes masked */
  privateText: boolean
}

export function posthogPagePrivacy(pathname: string, bare: boolean): PostHogPagePrivacy {
  const privateText = bare || PRIVATE_TEXT_PATHS.test(pathname)
  return { noRecording: privateText, privateText }
}

/** The PostHog init / set_config options a page's privacy adds. */
export function posthogPrivacyOptions(p: PostHogPagePrivacy): {
  disable_session_recording: boolean
  autocapture: boolean
  enable_heatmaps: boolean
  mask_all_text: boolean
  mask_all_element_attributes: boolean
} {
  return {
    disable_session_recording: p.noRecording,
    autocapture: !p.privateText,
    enable_heatmaps: !p.privateText,
    mask_all_text: p.privateText,
    mask_all_element_attributes: p.privateText,
  }
}
