import { useState } from 'react'

interface DateRangePickerProps {
  startDate: string
  endDate: string
  onStartChange: (date: string) => void
  onEndChange: (date: string) => void
  minDate?: string
}

export default function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  minDate,
}: DateRangePickerProps) {
  const today = minDate ?? new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="drp-start" className="block text-sm font-medium text-gray-700">
          Start Date
        </label>
        <input
          id="drp-start"
          type="date"
          value={startDate}
          min={today}
          onChange={(e) => {
            onStartChange(e.target.value)
            if (endDate && e.target.value > endDate) {
              onEndChange(e.target.value)
            }
          }}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      </div>
      <div>
        <label htmlFor="drp-end" className="block text-sm font-medium text-gray-700">
          End Date
        </label>
        <input
          id="drp-end"
          type="date"
          value={endDate}
          min={startDate || today}
          onChange={(e) => onEndChange(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      </div>
    </div>
  )
}
