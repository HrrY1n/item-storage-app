import type { ReactNode } from 'react'

export default function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-section text-ink-primary">{title}</h2>
      {action}
    </div>
  )
}
