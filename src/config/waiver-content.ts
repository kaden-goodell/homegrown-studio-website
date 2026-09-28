/**
 * Participation Agreement content + waiver UI copy — single source of truth.
 *
 * EVERYTHING the waiver system renders comes from this file: the legal text
 * (signed + hashed), the page copy, button labels, and confirmation copy.
 * Edit here and the /waiver page, booking-flow links, and stored records all
 * follow. Bump `version` on ANY change to `legalSections` — records store the
 * version + a content hash so we can always prove which text was signed.
 *
 * legalEntityName: swap in the exact registered LLC name (must match the name
 * used on the lease, insurance certificate, and licenses) once confirmed.
 */

export interface WaiverSection {
  heading: string
  /** Paragraphs. Rendered verbatim; also serialized + hashed into each signed record. */
  body: string[]
}

const legalEntityName = 'Goodell Holdings LLC' // registered entity; d/b/a Hometown Studio (entity confirmed by Kaden 2026-07-10; trade name changed 2026-09-26)
const businessAddress = '525 Hughes Rd Ste F, Madison, Alabama 35758'
const adultAge = 19

/**
 * Earliest agreement version whose text is legally equivalent to the current
 * one. A returning household whose on-file signature predates this version
 * can no longer one-tap RSVP (HOM-210) — the reuse path forces a full
 * re-sign instead of cloning the old signature forward. Bump this forward
 * only when a `legalSections` change is SUBSTANTIVE; an administrative-only
 * bump (e.g. v1→v2, the 2026-09-26 rebrand) leaves it where it is. Mirrored
 * verbatim in `docs/waiver-versions/README.md` as `substantiveSince: v1` —
 * keep the two in sync.
 */
export const substantiveSince = 'v1'

/**
 * Compare two 'vN' version strings by their numeric suffix. An unparsable or
 * missing version sorts before every real version, so a record with no
 * readable version forces a re-sign rather than silently passing.
 */
export function compareVersions(a: string, b: string): number {
  const num = (v: string): number => {
    const m = /^v(\d+)$/.exec(v ?? '')
    return m ? Number(m[1]) : -Infinity
  }
  return num(a) - num(b)
}

export const waiverContent = {
  /**
   * Bump on any legalSections change (v1 → v2 …). Stored with every signature.
   * Bumping is a one-way door: records signed at v2 carry a v2 hash and cannot
   * be re-verified if this text is rolled back. Attorney review required before
   * deploying changes (see docs/NEEDS-FROM-KADEN.md).
   */
  version: 'v2', // v2 (2026-09-26) = v1 text with the trade name changed to Hometown Studio (rebrand after a cease-and-desist; entity unchanged). v1 = the LAUNCH text (2026-08-03; attorney redline pending, HOM-98). Numbering reset from draft-era v4: no production signature ever recorded an earlier version, so v1 starts the permanent series. On every bump: archive the full text to docs/waiver-versions/vN.md (records store version + SHA-256 hash; the archive keeps the text itself readable without git archaeology).
  legalEntityName,
  businessAddress,
  /** Months a signature stays valid before re-signing is required. */
  validityMonths: 12,
  /** Alabama's age of majority — the signer must be at least this old. */
  adultAge: adultAge,

  page: {
    eyebrow: 'Before You Craft',
    headline: 'Participation Agreement',
    subline:
      "One quick signature covers you and your own kids for a full year of studio visits, workshops, and parties. Every adult signs their own.",
    partySubline:
      "You’re invited to a party at Hometown Studio! One quick signature covers you and your own kids for the event — and a full year of visits after. Every adult signs their own.",
  },

  form: {
    adultHeading: 'About you',
    adultNote: `You must be ${adultAge} or older to sign. This covers you plus any children you're the parent or legal guardian of — every other adult signs their own.`,
    minorsHeading: 'Bringing kids? Add them here',
    minorsNote: 'Add any child you’re the parent or legal guardian of. Just you? Skip this part.',
    addMinorLabel: '+ Add a child',
    emergencyHeading: 'Emergency contact',
    emergencyNote: 'Who should we call if we can’t reach you?',
    adultAllergiesLabel: 'Your own allergies or medical conditions (optional)',
    /** "None" chip on an allergies field (adult or child) — fills the literal
     *  string 'None', distinct from a blank left unanswered (HOM-212). */
    allergiesNoneChip: 'None',
    allergiesNoneHelper: 'Leave blank only if you’re not sure.',
    /** Shown only for drop-off events (HOM-212) — a plain visit never asks. */
    pickupLabel: 'Authorized pickup — who else may collect your child? (optional)',
    pickupHelperText:
      'Besides you. They’ll need the pickup code we text you at drop-off, and photo ID if we don’t know them.',
    addPickupLabel: '+ Add another',
    notAuthorizedLabel: 'Anyone who may NOT collect your child? (optional — bring a copy of any court order)',
    /** Heading for the compact pickup block shown on the returning-RSVP
     *  screen when the on-file signature has no pickup rows yet (HOM-212). */
    returningPickupHeading: 'Who may pick up?',
    /** Drop-off only, per child (HOM-212) — the Studio never administers medication. */
    medicationsLabel: 'Medications or conditions we should know about — we don’t administer medication.',
    /**
     * Inline note when the DOB the signer typed makes them 18 (or younger) —
     * Alabama's age of majority is 19 (HOM-212). `{link}` is replaced with
     * this page's own URL so it reads well when texted to a parent.
     */
    underageNote:
      "In Alabama you're a legal adult at 19. If you're 18, a parent or guardian signs for you — they can do it from their phone: {link}.",
    photoHeading: 'Photos at the studio',
    photoNote:
      'We sometimes photograph activities for our website and social media. Either answer is completely fine — it doesn’t affect participation.',
    photoYes: 'Yes — photos that include my household are OK (first names at most)',
    photoNo: 'No — please leave my household out of marketing photos and video',
    agreementHeading: 'The agreement',
    agreementNote: 'Please read the full agreement below before checking the box.',
    releaseCheckboxLabel:
      'I have read and agree to the Participation Agreement above, including the release of liability and the indemnification for my listed children.',
    /** Second checkbox, shown only for drop-off events with minors attending
     *  (HOM-211) — never pre-checked, never merged with `releaseCheckboxLabel`. */
    addendumCheckboxLabel:
      'I have read and agree to the Drop-off Program Addendum for the minors I am registering.',
    signatureLabel: 'Type your full name to sign',
    signatureNote: 'Typing your name here acts as your legal signature.',
    submitLabel: 'Sign the agreement',
    submittingLabel: 'Signing…',
    /** Shown only when kids are crafting and the signer isn't on the list. */
    presenceQuestion: 'Will you be at the party with them?',
    presenceYes: 'Yes — I’ll be there, just not crafting',
    presenceNo: 'No — another adult will be with them',
    responsibleAdultLabel: 'Who should we expect with them?',
    responsibleAdultNote:
      'Every child needs an adult at the party — tell us who to look for (e.g. “Grandma Sue”).',
  },

  /** Shown (client) and returned verbatim (server, as the 409 body) when a
   *  returning household's signature predates a substantive agreement change
   *  and must be re-signed in full — see `substantiveSince` above. */
  mustResignNotice: "We've updated the agreement — please read and sign again.",

  confirmation: {
    headline: 'You’re all set!',
    subline: 'Your signature is on file — show this screen at the front desk if asked.',
    /** Shown instead of `subline` right after a fresh signature — we always
     *  email a copy of the agreement (+ addendum, when accepted) on signing
     *  (HOM-216). `{email}` is replaced with the signer's typed email. */
    emailedCopyLine: 'We’ve emailed a copy to {email}.',
    /** Shown instead of `subline` on a returning-household RSVP that just
     *  accepted the Drop-off Program Addendum (HOM-216) — no typed email to
     *  fill in on that path, so this reads generically ("on file"). */
    emailedAddendumLine: 'We’ve emailed the addendum to your email on file.',
    coversLabel: 'This signature covers',
    validLabel: 'Valid through',
    partyLine: "You’re RSVP’d — see you at the party! 🎉",
    anotherAdultLine: "Bringing another adult? Send them this page’s link — every adult signs their own agreement.",
  },

  /** Copy used where booking flows hand off to the waiver. */
  handoff: {
    hostCta: '✍️ Sign your participation agreement',
    workshopCta: '✍️ Sign the participation agreement before your visit',
  },

  /**
   * The agreement itself. Serialized + SHA-256 hashed into every signed record.
   * Reviewed structure: adult release / minors indemnification / medical /
   * conduct / photo / general terms. Keep headings stable; bump version on edits.
   */
  legalSections: [
    {
      heading: 'Participation Agreement, Release of Liability, Assumption of Risk, and Indemnification',
      body: [
        `${legalEntityName} d/b/a Hometown Studio ("the Studio"), ${businessAddress}.`,
        'READ THIS AGREEMENT CAREFULLY BEFORE SIGNING. It affects your legal rights, includes a release of liability and an agreement to indemnify the Studio, and applies to all of your visits for twelve (12) months from the date signed.',
      ],
    },
    {
      heading: '1. Who this Agreement covers',
      body: [
        'This Agreement is made by the undersigned adult (19 years or older) ("I") on behalf of (a) myself and (b) each minor listed on this form, for whom I represent and warrant that I am the parent or legal guardian.',
      ],
    },
    {
      heading: '2. Activities and acknowledgment of risks',
      body: [
        'The Studio offers craft activities including, without limitation: painting, pottery and glazing, candle-making, use of heat tools (hot glue guns, wax melters, heat presses, irons), sharp implements (scissors, needles, blades, carving tools), adhesives, paints, dyes, glazes, and other craft materials; at designated 21-and-over events, cigar-rolling instruction using raw tobacco leaf; and, at designated events, service of beer and wine to guests 21 or older. Studio activities may take place at the Studio’s premises or at off-site events the Studio conducts at other locations, and this Agreement applies to Studio activities wherever they are conducted.',
        'I understand that these activities involve inherent risks that cannot be eliminated even with reasonable care, including but not limited to: burns; cuts and puncture wounds; allergic or skin reactions to materials; eye injury; slips, trips, and falls; exposure to tobacco leaf and nicotine at 21-and-over cigar events; damage to clothing or personal property; and, for craft items taken home, risks arising from their later use — up to and including serious bodily injury and, in rare circumstances, death. I have had the opportunity to ask questions about these risks. I voluntarily choose to participate, and to allow the minors listed on this form to participate, with full knowledge of these risks, and I assume all such risks for myself.',
      ],
    },
    {
      heading: '3. Release of my own claims',
      body: [
        'In consideration of the Studio permitting me and the listed minors to participate in its activities, I, for myself and my heirs, executors, administrators, and assigns, hereby RELEASE, WAIVE, AND FOREVER DISCHARGE the Studio, its members, owners, managers, employees, instructors, agents, and landlord (together, the "Released Parties") from any and all claims, demands, damages, actions, or causes of action of any kind that I may have, whether now known or unknown, arising out of or related to my presence at the Studio or at any Studio-conducted event, my participation in Studio activities wherever conducted (including off-site events), or my use of items or products obtained from the Studio, including claims for personal injury, property damage, or wrongful death, AND INCLUDING CLAIMS ARISING FROM THE ORDINARY NEGLIGENCE OF ANY RELEASED PARTY.',
        'This release does not extend to injuries caused by the willful or wanton conduct of a Released Party, and nothing in this Agreement waives rights that cannot be waived under Alabama law.',
      ],
    },
    {
      heading: '4. Minors — parent/guardian acknowledgment and indemnification',
      body: [
        'I understand that under Alabama law, a parent’s signature does not waive a minor’s own legal claims. Accordingly, as to each minor listed on this form:',
        '(a) My own claims released. I release the Released Parties, to the fullest extent permitted by law, from any claims that belong to me individually arising out of the minor’s participation, including claims for the minor’s medical expenses, loss of services, or emotional distress, including such claims arising from a Released Party’s ordinary negligence.',
        '(b) INDEMNIFICATION. I agree to INDEMNIFY, DEFEND, AND HOLD HARMLESS the Released Parties from and against any claim, demand, or action brought by or on behalf of a listed minor (including by the minor upon reaching majority, or by any other person on the minor’s behalf) arising out of the minor’s participation in Studio activities, including the Released Parties’ reasonable attorneys’ fees and costs of defense — except to the extent the claim arises from the willful or wanton conduct of a Released Party.',
        "(c) Supervision. Private parties and regular Studio activities are NOT drop-off events. I remain responsible for each listed minor at all times while at the Studio, and if I am not personally present I will designate another responsible adult, present at the Studio, who is in charge of each listed minor. The Studio provides craft instruction and facilities; it does not provide childcare or supervision of minors. Separately, if the Studio offers a designated drop-off program (such as a camp), participation in that program is governed by that program’s own registration terms and check-in/pickup procedures, which I agree to at registration.",
      ],
    },
    {
      heading: '5. Medical authorization',
      body: [
        'If I or a listed minor is injured or becomes ill at the Studio and I am unavailable or unable to consent, I authorize the Studio to obtain emergency medical treatment (including first aid, emergency transport, and treatment by licensed providers) for me or the minor, at my expense.',
      ],
    },
    {
      heading: '6. Rules and conduct',
      body: [
        'I agree, for myself and the listed minors, to follow the Studio’s safety instructions and posted rules; to use tools and materials only as directed; and that the Studio may decline or discontinue participation of any person for safety reasons, with a refund of unused fees as the Studio’s sole obligation.',
        'At events where the Studio serves beer or wine: alcohol is served only to guests 21 or older who present valid identification; I am responsible for my own conduct and decisions while under the influence; I acknowledge that other guests present may consume alcohol and I accept that risk; no outside alcohol may be brought in, and no open container may leave the premises; and the Studio may refuse or discontinue service at its discretion. I agree to hold the Released Parties harmless for any injury or damage arising from the consumption of alcohol, whether by me or by other guests.',
      ],
    },
    {
      heading: '6b. Handmade and take-home products',
      body: [
        'The Studio sells small-batch handmade goods, including candles and topical products such as tallow-based skin balms. As to any such product that I purchase or receive:',
        '(a) I understand these products are handmade in small batches, are not evaluated or approved by the FDA, and are sold without any medical or therapeutic claims.',
        '(b) An ingredient list is provided with each topical product. I am responsible for reviewing it for allergens and sensitivities before use, for myself and for anyone in my household.',
        '(c) I will apply any topical product to a small test area first, and I will discontinue use immediately if irritation or any reaction occurs.',
        '(d) I ASSUME ALL RISK arising from the decision to use, apply, consume, or burn any product obtained from the Studio, and the release and indemnification provisions of this Agreement apply in full to such use, including claims arising from a Released Party’s ordinary negligence in the making of the product.',
        '(e) To the fullest extent permitted by Alabama law, products are provided AS IS, and all implied warranties, including merchantability and fitness for a particular purpose, are disclaimed.',
      ],
    },
    {
      heading: '7. General terms',
      body: [
        'This Agreement is the entire agreement between me and the Studio regarding its subject matter; it is governed by Alabama law, with venue in Madison County, Alabama; if any provision is held unenforceable, the remainder continues in effect; it remains in effect for twelve (12) months from the date signed and applies to all of my and my listed minors’ visits during that period, unless I revoke it in writing (revocation applies prospectively only).',
        'I agree that an electronic signature or a typed name submitted through the Studio’s website or check-in system has the same force as a handwritten signature.',
        'I HAVE READ THIS ENTIRE AGREEMENT, I UNDERSTAND IT, AND I SIGN IT VOLUNTARILY.',
      ],
    },
  ] satisfies WaiverSection[],
}

/** Canonical serialization of the legal text — the string that gets hashed into records. */
export function serializeAgreement(): string {
  return waiverContent.legalSections
    .map((s) => `## ${s.heading}\n${s.body.join('\n')}`)
    .join('\n\n')
}

/**
 * Supplements Agreement §4(c) for studio-run drop-off programs (camps, kids'
 * workshops, Parents' Night Out) — audit finding C3 (HOM-211): §4(c) disclaims
 * supervision while staff are in fact supervising at these events. Attorney
 * has approved the addendum approach (this text has not itself had attorney
 * redline — treat the same way as the base agreement re: docs/NEEDS-FROM-KADEN.md).
 * Shown + accepted only when a drop-off event has a minor attending
 * (`@lib/addendum`'s `addendumRequired`) — separately versioned and hashed
 * from the main agreement so a change here doesn't force every household to
 * re-sign the base Participation Agreement.
 *
 * Bump `version` (a1 → a2 …) on ANY change to `sections`, same rule as
 * `waiverContent.version` — archive the new text to
 * docs/waiver-versions/addendum-aN.md and recompute docs/waiver-versions/hashes.json
 * in the same commit (see docs/waiver-versions/README.md).
 */
export const dropOffAddendum = {
  version: 'a1',
  title: 'Drop-off Program Addendum',
  sections: [
    {
      heading: 'Preamble',
      body: [
        "This addendum applies when I register a listed minor for a designated Studio drop-off program (for example, a camp, a kids' workshop, or Parents' Night Out). The Participation Agreement remains in full effect; §4(c) is supplemented as follows for that program only.",
      ],
    },
    {
      heading: '1. Supervision',
      body: [
        "During the program's posted hours, Studio staff supervise participating minors in the Studio's craft space. Supervision is group supervision of a structured craft activity; it is not medical care or one-on-one care.",
      ],
    },
    {
      heading: '2. Drop-off and pickup',
      body: [
        'I will check each minor in with Studio staff at drop-off. Each minor will be released only (a) to me, or (b) to an adult I have named as authorized, who presents the pickup code issued at check-in and, if not personally known to staff, photo identification. If the person collecting my child cannot provide the code, the Studio will attempt to reach me at the phone number on file before releasing the child, and may decline release until it does. I will tell the Studio in writing of anyone who may NOT collect my child, and I will provide a copy of any court order that restricts custody or contact.',
      ],
    },
    {
      heading: '3. Late pickup',
      body: [
        'Programs end at the posted time. If a minor has not been collected 15 minutes after the end time, the Studio will call me and then my emergency contact, and a late fee of $1 per minute applies from the end of the grace period.',
      ],
    },
    {
      heading: '4. Health',
      body: [
        "I have disclosed all allergies, medical conditions and medications relevant to my child's safety. The Studio does not administer medication; a minor who needs medication during the program must be able to self-administer, or I will arrange to come in. I will not bring a child who is ill, and the Studio may ask me to collect a child who becomes ill or whose behavior is unsafe for the group.",
      ],
    },
    {
      heading: '5. Emergencies',
      body: [
        'The medical authorization in §5 of the Participation Agreement applies. Staff will call me as soon as practical after any injury or incident and will give me a written note of what happened.',
      ],
    },
    {
      heading: '6. Program terms',
      body: [
        'Capacity is limited to 12 minors with at least two adult staff present. The Studio may cancel a program for insufficient enrollment or staffing, with a full refund as its sole obligation.',
      ],
    },
  ] satisfies WaiverSection[],
}

/** Canonical serialization of the addendum text — same scheme as
 *  `serializeAgreement()`, so `addendum-a1.md` is derivable from this. */
export function serializeAddendum(): string {
  return dropOffAddendum.sections
    .map((s) => `## ${s.heading}\n${s.body.join('\n')}`)
    .join('\n\n')
}
