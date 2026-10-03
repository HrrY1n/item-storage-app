interface Props {
  /** 标签显示名（不含 # 前缀） */
  name: string
  size?: 'sm' | 'md'
  selected?: boolean
  onClick?: () => void
}

export default function TagChip({ name, size = 'md', selected = false, onClick }: Props) {
  const base =
    size === 'sm'
      ? 'rounded-md px-1.5 py-[3px] text-[11px] leading-none'
      : 'inline-flex min-h-[36px] items-center rounded-full px-3 text-caption leading-none'
  const color = selected
    ? 'bg-neutral-900 text-white'
    : 'bg-neutral-100 text-ink-secondary'

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${color} transition-colors duration-150 active:scale-95`}
      >
        #{name}
      </button>
    )
  }
  return <span className={`${base} ${color}`}>#{name}</span>
}
