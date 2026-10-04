import type { PresetIcon } from '../data/icons'

interface Props {
  icons: PresetIcon[]
  /** 当前选中的 assetId；不传表示只读浏览（如图标库页面） */
  value?: string
  onPick?: (assetId: string) => void
  /** 网格列数（不同容器宽度需要不同列数） */
  columnsClass?: string
}

const assetIdOfIcon = (icon: PresetIcon) => `preset-${icon.key}`

/**
 * 图标网格：物品图标库与图标选择器共用的展示单元。
 *
 * 一个格子 = 底衬上的图标 + 名称。名称必须显示 —— 图标库的意义是"能找到"，
 * 而不是一堆需要逐个点开猜的图片。
 *
 * 注意：本组件**只导出 React 组件**。混用具名导出（如 assetIdOfIcon）会让
 * React Fast Refresh 失效并在 dev 控制台刷警告。
 */
export default function IconGrid({
  icons,
  value,
  onPick,
  columnsClass = 'grid-cols-4 sm:grid-cols-6',
}: Props) {
  return (
    <div className={`grid gap-2.5 ${columnsClass}`}>
      {icons.map((icon) => {
        const id = assetIdOfIcon(icon)
        const selected = value !== undefined && value === id
        const interactive = Boolean(onPick)

        const content = (
          <>
            <span
              className={`relative block aspect-square w-full overflow-hidden rounded-card border transition-[border-color,transform] duration-150 ease-out-quint ${
                selected ? 'border-accent' : 'border-line'
              } ${interactive ? 'group-active:scale-[0.95]' : ''}`}
            >
              <img
                src={icon.path}
                alt={icon.label}
                className="plate-surface h-full w-full object-cover"
                draggable={false}
                loading="lazy"
              />
              {selected && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-pill bg-accent">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" className="text-ink-inverse">
                    <path d="m5 13 5 5L19 7" />
                  </svg>
                </span>
              )}
            </span>
            <span
              className={`w-full truncate text-center text-[10px] leading-tight ${
                selected ? 'text-accent' : 'text-ink-tertiary'
              }`}
            >
              {icon.label}
            </span>
          </>
        )

        if (!interactive) {
          return (
            <div key={icon.key} className="flex flex-col items-center gap-1.5">
              {content}
            </div>
          )
        }

        return (
          <button
            key={icon.key}
            type="button"
            onClick={() => onPick?.(id)}
            aria-pressed={selected}
            className="group flex flex-col items-center gap-1.5"
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
