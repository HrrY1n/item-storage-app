interface Props {
  title: string
  subtitle?: string
}

/**
 * 空状态：原创线描插画 —— 「一处留白的展台」。
 * 虚线圈表示尚未放入的物品位置，台面与投影建立空间感，强调色仅用于那一个位置。
 */
function EmptyPlinth() {
  return (
    <svg
      width="140"
      height="104"
      viewBox="0 0 140 104"
      fill="none"
      className="text-ink-faint"
      aria-hidden
    >
      {/* 地面投影：两层，营造柔和落影 */}
      <ellipse cx="70" cy="88" rx="40" ry="5" fill="rgba(23,23,23,0.05)" />
      <ellipse cx="70" cy="88" rx="22" ry="3" fill="rgba(23,23,23,0.04)" />
      {/* 台面与台身 */}
      <path d="M30 76h80" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M36 76v20M104 76v20"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* 留白的位置：虚线圈 + 强调色小点 */}
      <circle
        cx="70"
        cy="44"
        r="20"
        stroke="#B4553B"
        strokeWidth="1.3"
        strokeDasharray="3 6"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="70" cy="44" r="2.6" fill="#B4553B" opacity="0.9" />
      {/* 两侧极细的呼吸线，暗示"还可以放更多" */}
      <path
        d="M26 44h4M110 44h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.4"
      />
      {/* 说明：不在此处添加向上装饰线 —— 在圆形上方会读成"杂点"而非语义元素 */}
    </svg>
  )
}

export default function EmptyState({ title, subtitle }: Props) {
  return (
    <div className="animate-fade-rise flex flex-col items-center px-8 py-14 text-center">
      <EmptyPlinth />
      <p className="mt-6 text-section text-ink-primary">{title}</p>
      {subtitle && (
        <p className="mt-2 max-w-[260px] text-secondary leading-relaxed text-ink-tertiary">
          {subtitle}
        </p>
      )}
    </div>
  )
}
