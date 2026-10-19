import { useState } from 'react'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import WorkshopTile from '@components/workshops/WorkshopTile'
import { workshopStatus } from '@components/workshops/workshop-status'
import { classAvailability, withSeatsSold } from '@lib/classes/public-class'
import ClassBookingPanel from './ClassBookingPanel'

/**
 * /classes/<id>: one of our own classes on its own page, link-only ones too.
 * The card, with the booking panel open straight away when it can be booked.
 */
export default function ClassPage({ workshop: initial, bookingsOpen }: { workshop: WorkshopData; bookingsOpen: boolean }) {
  const [workshop, setWorkshop] = useState(initial)
  const canBook = bookingsOpen && workshopStatus(workshop).bookable
  const [open, setOpen] = useState(canBook)
  return (
    <div style={{ maxWidth: '26rem', margin: '0 auto', display: 'flex' }}>
      <WorkshopTile workshop={workshop} onBook={bookingsOpen ? () => setOpen(true) : undefined} />
      {open && canBook && workshop.own && (
        <ClassBookingPanel
          workshop={workshop}
          syncUrl={false}
          onClose={() => setOpen(false)}
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
