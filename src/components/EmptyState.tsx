interface Props {
  title: string
  subtitle?: string
}

export default function EmptyState({ title, subtitle }: Props) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-100">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400">
          <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
          <path d="M3 8l9 5 9-5" />
          <path d="M12 13v8" />
        </svg>
      </div>
      <p className="text-item text-ink-secondary">{title}</p>
      {subtitle && <p className="mt-1 text-secondary text-ink-tertiary">{subtitle}</p>}
    </div>
  )
}
