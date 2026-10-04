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
      ? 'rounded-md border border-line-inner bg-white px-1.5 py-[3px] text-[11px] leading-none text-ink-tertiary'
      : 'inline-flex min-h-[36px] items-center rounded-full px-3.5 text-caption leading-none'
  // 未选中：白底 + hairline（视觉更轻）；选中：实心墨色（唯一强对比）
  const color = selected
    ? 'border border-neutral-900 bg-neutral-900 text-white'
    : 'border border-line bg-white text-ink-secondary'

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
