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

const legalEntityName = 'Goodell Holdings, LLC' // registered entity; d/b/a Homegrown Studio (confirmed by Kaden 2026-07-10)
const businessAddress = '525 Hughes Rd Ste F, Madison, Alabama 35758'
const adultAge = 19

export const waiverContent = {
  /**
   * Bump on any legalSections change (v1 → v2 …). Stored with every signature.
   * Bumping is a one-way door: records signed at v2 carry a v2 hash and cannot
   * be re-verified if this text is rolled back. Attorney review required before
   * deploying changes (see docs/NEEDS-FROM-KADEN.md).
   */
  version: 'v3', // v3: legal entity name set to Goodell Holdings, LLC (the name renders inside legalSections §opening)
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
      "You’re invited to a party at Homegrown Studio! One quick signature covers you and your own kids for the event — and a full year of visits after. Every adult signs their own.",
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
    pickupLabel: 'Authorized pickup — who may collect your child at a drop-off event (optional)',
    photoHeading: 'Photos at the studio',
    photoNote:
      'We sometimes photograph activities for our website and social media. Either answer is completely fine — it doesn’t affect participation.',
    photoYes: 'Yes — photos that include my household are OK (first names at most)',
    photoNo: 'No — please leave my household out of marketing photos and video',
    agreementHeading: 'The agreement',
    agreementNote: 'Please read the full agreement below before checking the box.',
    releaseCheckboxLabel:
      'I have read and agree to the Participation Agreement above, including the release of liability and the indemnification for my listed children.',
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

  confirmation: {
    headline: 'You’re all set!',
    subline: 'Your signature is on file — show this screen at the front desk if asked.',
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
        `${legalEntityName} d/b/a Homegrown Studio ("the Studio"), ${businessAddress}.`,
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
        'The Studio offers craft activities including, without limitation: painting, pottery and glazing, candle-making, use of heat tools (hot glue guns, wax melters, heat presses, irons), sharp implements (scissors, needles, blades, carving tools), adhesives, paints, dyes, glazes, and other craft materials; and, at designated events, service of beer and wine to guests 21 or older.',
        'I understand that these activities involve inherent risks that cannot be eliminated even with reasonable care, including but not limited to: burns; cuts and puncture wounds; allergic or skin reactions to materials; eye injury; slips, trips, and falls; damage to clothing or personal property; and, for craft items taken home, risks arising from their later use — up to and including serious bodily injury and, in rare circumstances, death. I have had the opportunity to ask questions about these risks. I voluntarily choose to participate, and to allow the minors listed on this form to participate, with full knowledge of these risks, and I assume all such risks for myself.',
      ],
    },
    {
      heading: '3. Release of my own claims',
      body: [
        'In consideration of the Studio permitting me and the listed minors to participate in its activities, I, for myself and my heirs, executors, administrators, and assigns, hereby RELEASE, WAIVE, AND FOREVER DISCHARGE the Studio, its members, owners, managers, employees, instructors, agents, and landlord (together, the "Released Parties") from any and all claims, demands, damages, actions, or causes of action of any kind that I may have, whether now known or unknown, arising out of or related to my presence at the Studio or my participation in its activities, including claims for personal injury, property damage, or wrongful death, AND INCLUDING CLAIMS ARISING FROM THE ORDINARY NEGLIGENCE OF ANY RELEASED PARTY.',
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
