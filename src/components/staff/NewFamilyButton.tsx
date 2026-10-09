import { signOnIpad } from '@components/staff/DoorSearch'
import { btn } from '@components/staff/ui'

/** Always-visible way to start the signing form, before any searching. */
export default function NewFamilyButton({ event }: { event?: Parameters<typeof signOnIpad>[0] }) {
  return (
    <button
      type="button"
      onClick={() => signOnIpad(event)}
      style={{ ...btn(), width: '100%', minHeight: '2.75rem', marginBottom: '1rem', fontWeight: 700 }}
    >
      ✍️ New family? Sign on this iPad
    </button>
  )
}
