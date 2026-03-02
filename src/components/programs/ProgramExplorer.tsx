import { useState } from 'react'
import type { EventType } from '@providers/interfaces/catalog'
import ProgramCard from './ProgramCard'
import EnrollmentModal from './EnrollmentModal'

interface ProgramExplorerProps {
  programs: EventType[]
}

export default function ProgramExplorer({ programs }: ProgramExplorerProps) {
  const [selectedProgram, setSelectedProgram] = useState<EventType | null>(null)

  return (
    <>
      <div style={{
        display: 'grid',
        gap: '1.5rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}>
        {programs.map((program) => (
          <ProgramCard
            key={program.id}
            program={program}
            onEnroll={setSelectedProgram}
          />
        ))}
      </div>

      {selectedProgram && (
        <EnrollmentModal
          program={selectedProgram}
          onClose={() => setSelectedProgram(null)}
        />
      )}
    </>
  )
}
