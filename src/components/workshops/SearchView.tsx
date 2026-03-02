import { useState, useMemo } from 'react'
import WorkshopCard from './WorkshopCard'
import type { WorkshopData } from './WorkshopExplorer'

const PAGE_SIZE = 9

interface SearchViewProps {
  workshops: WorkshopData[]
}

/** Parse a YYYY-MM-DD string as a local-midnight Date (avoids UTC shift). */
function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function SearchView({ workshops }: SearchViewProps) {
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const fromDate = dateFrom ? parseLocalDate(dateFrom) : null
    const toDate = dateTo ? parseLocalDate(dateTo) : null

    return workshops.filter((w) => {
      const q = query.toLowerCase().trim()
      const matchesQuery = !q || w.name.toLowerCase().split(/\s+/).some(word => word.startsWith(q))
      const wDate = parseLocalDate(w.date)
      const afterFrom = !fromDate || wDate >= fromDate
      const beforeTo = !toDate || wDate <= toDate
      return matchesQuery && afterFrom && beforeTo
    })
  }, [workshops, query, dateFrom, dateTo])

  // Reset to first page when filters change
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  function goTo(p: number) {
    setPage(Math.max(0, Math.min(p, totalPages - 1)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <input
          type="text"
          placeholder="Search workshops..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0) }}
          className="flex-1 rounded-xl px-5 py-3 text-sm focus:outline-none focus:ring-2 transition-all"
          style={{
            background: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(150, 112, 91, 0.06)',
            color: 'var(--color-text)',
          }}
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
          aria-label="From date"
          placeholder="From"
          className="rounded-xl px-5 py-3 text-sm focus:outline-none focus:ring-2 transition-all"
          style={{
            background: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(150, 112, 91, 0.06)',
            color: dateFrom ? 'var(--color-text)' : 'var(--color-muted)',
          }}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
          aria-label="To date"
          placeholder="To"
          min={dateFrom || undefined}
          className="rounded-xl px-5 py-3 text-sm focus:outline-none focus:ring-2 transition-all"
          style={{
            background: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(150, 112, 91, 0.06)',
            color: dateTo ? 'var(--color-text)' : 'var(--color-muted)',
          }}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {paged.map((workshop) => (
          <WorkshopCard key={workshop.id} workshop={workshop} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center py-12 text-sm" style={{ color: 'var(--color-muted)' }}>No workshops found.</p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-10">
          <button
            onClick={() => goTo(safePage - 1)}
            disabled={safePage === 0}
            aria-label="Previous page"
            className="rounded-lg px-3 py-2 text-sm font-medium transition-all disabled:opacity-30"
            style={{ color: 'var(--color-primary)' }}
          >
            &larr; Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Page ${i + 1}`}
              aria-current={i === safePage ? 'page' : undefined}
              className="rounded-lg w-9 h-9 text-sm font-medium transition-all"
              style={{
                background: i === safePage ? 'var(--color-primary)' : 'rgba(255,255,255,0.5)',
                color: i === safePage ? 'white' : 'var(--color-text)',
              }}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => goTo(safePage + 1)}
            disabled={safePage === totalPages - 1}
            aria-label="Next page"
            className="rounded-lg px-3 py-2 text-sm font-medium transition-all disabled:opacity-30"
            style={{ color: 'var(--color-primary)' }}
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  )
}
