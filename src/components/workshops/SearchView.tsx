import { useState, useMemo } from 'react'
import WorkshopCard from './WorkshopCard'
import type { WorkshopData } from './WorkshopExplorer'

interface SearchViewProps {
  workshops: WorkshopData[]
}

export default function SearchView({ workshops }: SearchViewProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const categories = useMemo(() => {
    const unique = Array.from(new Set(workshops.map((w) => w.category)))
    unique.sort()
    return unique
  }, [workshops])

  const filtered = useMemo(() => {
    return workshops.filter((w) => {
      const matchesQuery = w.name.toLowerCase().includes(query.toLowerCase())
      const matchesCategory = category === 'all' || w.category === category
      const afterFrom = !dateFrom || w.date >= dateFrom
      const beforeTo = !dateTo || w.date <= dateTo
      return matchesQuery && matchesCategory && afterFrom && beforeTo
    })
  }, [workshops, query, category, dateFrom, dateTo])

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <input
          type="text"
          placeholder="Search workshops..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
          onChange={(e) => setDateFrom(e.target.value)}
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
          onChange={(e) => setDateTo(e.target.value)}
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
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          className="rounded-xl px-5 py-3 text-sm focus:outline-none focus:ring-2 transition-all"
          style={{
            background: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(150, 112, 91, 0.06)',
            color: 'var(--color-text)',
          }}
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((workshop) => (
          <WorkshopCard key={workshop.id} workshop={workshop} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center py-12 text-sm" style={{ color: 'var(--color-muted)' }}>No workshops found.</p>
      )}
    </div>
  )
}
