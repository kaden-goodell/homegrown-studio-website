import { useState, useMemo } from 'react'
import WorkshopCard from './WorkshopCard'
import type { WorkshopData } from './WorkshopExplorer'

interface SearchViewProps {
  workshops: WorkshopData[]
}

export default function SearchView({ workshops }: SearchViewProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')

  const categories = useMemo(() => {
    const unique = Array.from(new Set(workshops.map((w) => w.category)))
    unique.sort()
    return unique
  }, [workshops])

  const filtered = useMemo(() => {
    return workshops.filter((w) => {
      const matchesQuery = w.name.toLowerCase().includes(query.toLowerCase())
      const matchesCategory = category === 'all' || w.category === category
      return matchesQuery && matchesCategory
    })
  }, [workshops, query, category])

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search workshops..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          className="rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          <option value="all">All</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((workshop) => (
          <WorkshopCard key={workshop.id} workshop={workshop} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-gray-500 py-8">No workshops found.</p>
      )}
    </div>
  )
}
