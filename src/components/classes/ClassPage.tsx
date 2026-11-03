import { useState } from 'react'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import WorkshopTile from '@components/workshops/WorkshopTile'
import { ownWaitlistOpen, workshopStatus } from '@components/workshops/workshop-status'
import { classAvailability, withSeatsSold } from '@lib/classes/public-class'
import ClassBookingPanel from './ClassBookingPanel'

/** Shown while classes are paused and no note came with the page. */
export const BOOKING_NOT_OPEN = 'Online booking is paused for now. Check back soon, or see what’s on the calendar.'

/**
 * /classes/<id>: one of our own classes on its own page, link-only ones too.
 * The card, with the booking panel open straight away when it can be booked.
 */
export default function ClassPage({ workshop: initial, bookingsOpen, closedNote }: { workshop: WorkshopData; bookingsOpen: boolean; closedNote?: string }) {
  const [workshop, setWorkshop] = useState(initial)
  const status = workshopStatus(workshop)
  // Final review I2: a sold-out class with its waitlist open opens the same panel, which takes them through joining it.
  const waitlistable = status.soldOut && !status.closed && ownWaitlistOpen(workshop)
  const canBook = bookingsOpen && (status.bookable || waitlistable)
  // Straight away only when it can be booked; the waitlist opens on a tap.
  const [open, setOpen] = useState(bookingsOpen && status.bookable)
  return (
    <div style={{ maxWidth: '26rem', margin: '0 auto', display: 'flex' }}>
      <WorkshopTile workshop={workshop} {...(bookingsOpen ? { onBook: () => setOpen(true) } : { closedNote: closedNote || BOOKING_NOT_OPEN })} />
      {open && canBook && workshop.own && (
        <ClassBookingPanel
          workshop={workshop}
          syncUrl={false}
          onClose={() => setOpen(false)}
          onAvailability={(own) => setWorkshop((w) => ({ ...w, own, ...classAvailability(own) }))}
          onBooked={(sessionIds, seats) =>
            setWorkshop((w) => {
              if (!w.own) return w
              const own = withSeatsSold(w.own, sessionIds, seats)
              return { ...w, own, ...classAvailability(own) }
            })
          }
        />
      )}
    </div>
  )
}
