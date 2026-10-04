interface Option<T extends string> {
  value: T
  label: string
}

/**
 * 分段控件（iOS segmented control）。
 *
 * 用"轨道 + 抬起滑块"表达选中，而不是三个各自独立的按钮 ——
 * 这样一眼能看出它们是同一组互斥选项，也比原生 <select> 轻得多、快得多。
 * 纯受控组件，不含任何业务默认值。
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
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-0.5 rounded-pill bg-surface-sunken p-[3px]"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex h-9 flex-1 items-center justify-center rounded-pill text-caption transition-colors duration-200 ease-out-quint ${
              active
                ? 'bg-surface-raised font-medium text-ink-primary shadow-card'
                : 'text-ink-tertiary active:text-ink-secondary'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
