interface Props {
  title: string
  subtitle?: string
}

/**
 * 空状态：原创线描插画 —— 「一处留白的展台」。
 * 虚线圈表示尚未放入的物品位置，台面与投影建立空间感，强调色仅用于那一个位置。
 *
 * 颜色全部走语义 token（fill-* / stroke-*），因此深浅两个主题共用同一张插画：
 * 投影用 ink-primary 的低透明度，深色下自动变成"来自上方的光"而不是黑斑。
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
      {/* 地面投影：单层，减少线条噪音 */}
      <ellipse cx="70" cy="88" rx="40" ry="5" className="fill-ink-primary opacity-[0.06]" />
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
        className="stroke-accent"
        strokeWidth="1.3"
        strokeDasharray="3 6"
        strokeLinecap="round"
        opacity="0.8"
      />
      <circle cx="70" cy="44" r="2.6" className="fill-accent" opacity="0.95" />
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
