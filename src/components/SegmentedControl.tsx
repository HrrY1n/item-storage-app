interface Option<T extends string> {
  value: T
  label: string
  /** 可选的次要说明（如列表页的件数计数）；始终排在标签之后，用等宽数字 */
  hint?: string
  /**
   * 禁用该选项（仍渲染、仍可读，只是不响应点击）。
   *
   * 处置二级筛选用它实现"数量为 0 时显示但禁用"——
   * 隐藏会让控件宽度在切换时跳动，破坏 §6.1 的布局稳定性要求。
   */
  disabled?: boolean
}

/**
 * 分段控件（iOS segmented control）。
 *
 * 用"轨道 + 抬起滑块"表达选中，而不是三个各自独立的按钮 ——
 * 这样一眼能看出它们是同一组互斥选项，也比原生 <select> 轻得多、快得多。
 * 纯受控组件，不含任何业务默认值。
 *
 * 全站**唯一**的分段控件实现：设置页的外观模式、物品列表页的生命周期切换都用它，
 * 避免同一控件在两处长成两副样子。
 */
export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  const focusValue = options.find(option => option.value === value && !option.disabled)?.value
    ?? options.find(option => !option.disabled)?.value
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-0.5 rounded-pill bg-surface-sunken p-[3px]"
    >
      {options.map((o) => {
        const active = o.value === value
        const disabled = o.disabled === true
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={o.value === focusValue ? 0 : -1}
            disabled={disabled}
            onKeyDown={(event) => {
              const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
              const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return
              event.preventDefault()
              const enabled = options.filter(option => !option.disabled)
              const index = enabled.findIndex(option => option.value === o.value)
              const next = event.key === 'Home'
                ? enabled[0]
                : event.key === 'End'
                  ? enabled[enabled.length - 1]
                  : enabled[(index + (forward ? 1 : -1) + enabled.length) % enabled.length]
              if (!next) return
              onChange(next.value)
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[options.indexOf(next)]?.focus()
            }}
            onClick={() => {
              if (disabled) return
              onChange(o.value)
            }}
            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-pill text-caption transition-colors duration-200 ease-out-quint ${
              disabled
                ? 'cursor-default text-ink-faint'
                : active
                  ? 'bg-surface-raised font-medium text-ink-primary shadow-card'
                  : 'text-ink-tertiary active:text-ink-secondary'
            }`}
          >
            {o.label}
            {o.hint !== undefined && (
              <span className={`num text-[11px] ${active ? 'text-ink-tertiary' : 'text-ink-faint'}`}>
                {o.hint}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
