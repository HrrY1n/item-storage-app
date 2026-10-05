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
      ? 'rounded-md border border-line-inner bg-surface px-1.5 py-[3px] text-[11px] leading-none text-ink-tertiary'
      : 'inline-flex min-h-[36px] items-center whitespace-nowrap rounded-pill px-3.5 text-caption leading-none'
  // 未选中：surface + hairline（视觉更轻）；选中：实心墨色（唯一强对比）
  const color = selected
    ? 'border border-accent bg-accent text-ink-inverse'
    : 'border border-line bg-surface text-ink-secondary'

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
