/**
 * What the owners read about the register (Square POS) set-up for classes:
 * the class tax, the Classes category, and a register connection that isn't
 * working. Pure and browser-safe, so /admin and the server say the same thing.
 *
 * Every sentence here points at something Catherine can press in /admin
 * (More › Register setup, or a button on the class sheet), never at config.
 */

/** The percentage the class tax must be: what the website adds on the pay step (checkout.ts CLASS_TAX_PERCENT). */
export const REGISTER_TAX_PERCENT = 9

/** The More row and sheet title. */
export const REGISTER_SETUP = 'Register setup'
export const REGISTER_SETUP_PATH = 'More › Register setup'

/** Thrown (before any Square call) when a taxable class would go on the register with no class tax picked. */
export const CLASS_TAX_NOT_SET = "Class tax isn't set up yet."
/** Thrown (before any Square call) when no Classes category is picked. */
export const CLASSES_CATEGORY_NOT_SET = "Classes category isn't set up yet."

/** The class tax isn't picked: where to pick it. */
export const PICK_TAX = `Open ${REGISTER_SETUP_PATH} and pick the ${REGISTER_TAX_PERCENT}% tax.`
export const PICK_CATEGORY = `Open ${REGISTER_SETUP_PATH} and pick the Classes category.`

/** The register connection (Square's access token) isn't working: nothing in /admin can renew it. */
export const REGISTER_DOWN = 'The register connection isn’t working right now. Ring it up at the regular price meanwhile.'
export const REGISTER_DOWN_SHORT = 'The register connection isn’t working right now.'

/** What a refusal carries so the sheet can show the button to Register setup. */
export type SetupNeeded = 'tax' | 'category'
