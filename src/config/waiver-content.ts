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
 * bump (a rebrand, a typo) leaves it where it is. Mirrored verbatim in
 * `docs/waiver-versions/README.md` as `substantiveSince: v1` — keep the two
 * in sync.
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
  version: 'v1', // v1 = the launch text (2026-10-07; attorney redline pending, HOM-98). On every bump: archive the full text to docs/waiver-versions/vN.md (records store version + SHA-256 hash; the archive keeps the text itself readable without git archaeology).
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
    /** Plain visits: optional (we'd call the signer). Drop-off: required —
     *  the signer isn't in the building. Both fields or neither. */
    emergencyNote: 'Who should we call if we can’t reach you? Optional for a regular visit.',
    emergencyNoteDropOff: 'Who should we call if we can’t reach you? Required for drop-off, since you won’t be here.',
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
    notAuthorizedHelper: 'Leave blank to keep what we have on file. Type “None” to remove it.',
    returningPickupHeading: 'Who may pick up?',
    /** Drop-off only, per child (HOM-212) — the Studio never administers medication. */
    medicationsLabel: 'Medications or conditions we should know about — we don’t administer medication.',
    /** Replaces the adult date-of-birth field (Oct 2026): one attestation
     *  tick. Alabama's age of majority is 19. */
    ageConfirmLabel: 'I’m 19 or older',
    ageConfirmNote: 'In Alabama you’re a legal adult at 19. If you’re 18, a parent or guardian signs for you and lists you on theirs.',
    photoHeading: 'Photos at the studio',
    /** Defaults to yes; opting out never affects participation. */
    photoNote:
      'We sometimes photograph activities for our website and social media. Opt out here if you’d rather not — it doesn’t affect participation.',
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

  /** Shown (client) and returned verbatim (server, as the 409 body) when a
   *  returning household's signature predates a substantive agreement change
   *  and must be re-signed in full — see `substantiveSince` above. */
  mustResignNotice: "We've updated the agreement — please read and sign again.",
  /** Same 409 door, different reason: a returning household with no
   *  emergency contact on file RSVPing to a drop-off event. */
  dropOffNeedsContactNotice: 'Drop-off needs an emergency contact on file — please sign a fresh agreement (it takes a minute).',

  confirmation: {
    headline: 'You’re all set!',
    subline: 'Your signature is on file — show this screen at the front desk if asked.',
    /** Shown instead of `subline` right after a fresh signature — we always
     *  email a copy of the agreement on signing
     *  (HOM-216). `{email}` is replaced with the signer's typed email. */
    emailedCopyLine: 'We’ve emailed a copy to {email}.',
    coversLabel: 'This signature covers',
    validLabel: 'Valid through',
    /** Drop-off RSVP done screen — with the posted late fee (`lateFeeLine()`) these are the three lines. */
    dropOffPickupLine: 'We’ll text a pickup code to the phone number on file when you drop off.',
    dropOffIdLine: 'Whoever collects your child needs that code, and photo ID if we don’t know them.',
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
        "(c) Supervision. Private parties and regular Studio activities are NOT drop-off events. I remain responsible for each listed minor at all times while at the Studio, and if I am not personally present I will designate another responsible adult, present at the Studio, who is in charge of each listed minor. The Studio provides craft instruction and facilities; it does not provide childcare or supervision of minors. The only exception is a designated Studio drop-off program, which is governed by Section 4b below.",
      ],
    },
    {
      heading: '4b. Drop-off programs',
      body: [
        'When a listed minor takes part in a designated Studio drop-off program (for example, a camp, a kids’ workshop, or Parents’ Night Out), the following apply to that program, and Section 4(c) is supplemented accordingly:',
        '(a) Supervision. During the program’s posted hours, Studio staff supervise participating minors in the Studio’s craft space. Supervision is group supervision of a structured craft activity; it is not medical care or one-on-one care.',
        '(b) Drop-off and pickup. I will check each minor in with Studio staff at drop-off. Each minor will be released only (i) to me, or (ii) to an adult I have named as authorized, who presents the pickup code issued at check-in and, if not personally known to staff, photo identification. If the person collecting my child cannot provide the code, the Studio will attempt to reach me at the phone number on file before releasing the child, and may decline release until it does. I will tell the Studio in writing of anyone who may NOT collect my child, and I will provide a copy of any court order that restricts custody or contact.',
        '(c) Late pickup. Programs end at the posted time. If a minor has not been collected by the end of the grace period posted for that program, the Studio will call me and then my emergency contact, and the late fee posted for that program at registration applies.',
        '(d) Health. I have disclosed all allergies, medical conditions and medications relevant to my child’s safety. The Studio does not administer medication; a minor who needs medication during the program must be able to self-administer, or I will arrange to come in. I will not bring a child who is ill, and the Studio may ask me to collect a child who becomes ill or whose behavior is unsafe for the group.',
        '(e) Emergencies. The medical authorization in Section 5 applies. Staff will call me as soon as practical after any injury or incident and will give me a written note of what happened.',
        '(f) Program terms. The Studio may cancel a program for insufficient enrollment or staffing, with a full refund as its sole obligation.',
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

  /**
   * "For counsel" note rendered at the bottom of the generated `docs/WAIVER.md`
   * (HOM-219) — kept here, versioned with the text it's about, rather than
   * hand-typed into the doc where it could drift. Not part of `legalSections`:
   * never rendered on the signing page, never hashed into a record.
   */
  counselNotes: [
    'Three things we’d flag ourselves: (1) §6b products — there is no products liability coverage behind it, so it’s the clause that most needs strength; (2) §4(b) parental indemnification — our Alabama minor-waiver workaround (Monster Mountain); (3) the §5 host indemnity in the separate Offsite Event Agreement. Beyond that, redline whatever you’d redline. Deliberately omitted for your judgment: arbitration / jury-trial waiver.',
  ],
}

/** Canonical serialization of the legal text — the string that gets hashed into records. */
export function serializeAgreement(): string {
  return waiverContent.legalSections
    .map((s) => `## ${s.heading}\n${s.body.join('\n')}`)
    .join('\n\n')
}
