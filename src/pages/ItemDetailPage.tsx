import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { categoryPath } from '../domain/categoryTree'
import {
  calculateDailyCostCents,
  calculateOwnershipDays,
  calculateTotalCostCents,
  formatCents,
  formatCentsCompact,
  formatPurchaseDate,
  platformLabel,
} from '../domain/purchase'
import {
  useCategories,
  useItem,
  useItemTagLinks,
  usePresetAssetMap,
  useTags,
} from '../features/data/hooks'
import { itemRepository } from '../db/repositories/itemRepository'
import PageHeader from '../components/PageHeader'
import TagChip from '../components/TagChip'
import { ObjectPlate } from '../components/ItemCard'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/Dialogs'
import { useToast } from '../components/Toast'

/**
 * 三级信息行：左标签右数值，中间以极细虚线引导。
 * 只用于「购买价格 / 附加花费」这类构成明细，字号与对比度都刻意压低。
 */
function SpecRow({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="shrink-0 text-caption text-ink-tertiary">{label}</span>
      <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dashed border-line" />
      <span
        className={`num shrink-0 text-right text-caption ${
          money ? 'text-money' : 'text-ink-secondary'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/** Hero 指标格：数字是结论，标签只是单位说明 */
function HeroMetric({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="min-w-0 px-3">
      <p className={`num truncate text-item ${money ? 'text-money' : 'text-ink-primary'}`}>{value}</p>
      <p className="mt-1 truncate text-caption text-ink-tertiary">{label}</p>
    </div>
  )
}

/**
 * 物品详情：一份"物品档案"。
 *
 * 节奏：
 *   Hero（这是谁 + 值多少）→ 构成明细（这钱怎么来的）→ 备注 → 删除
 * 刻意不做成一堆等高卡片：Hero 用打光盘面 + 三栏数字建立视觉锚点，
 * 明细用「子表面 + 虚线 + 色彩编码」表达加减关系。
 */
export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const item = useItem(id)
  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()

  const loading = !categories || !tags || !links || !assetMap || item === undefined
  if (loading) return null

  if (!item) {
    return (
      <div>
        <PageHeader title="物品" />
        <EmptyState title="物品不存在" subtitle="它可能已经被删除" />
      </div>
    )
  }

  const category = categories.find((c) => c.id === item.categoryId)
  const itemTags = links
    .filter((l) => l.itemId === item.id)
    .map((l) => tags.find((t) => t.id === l.tagId))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
  const iconUrl = assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'

  const totalCents = calculateTotalCostCents(item.purchasePriceCents, item.additionalCostCents)
  const dailyCents = calculateDailyCostCents(totalCents, item.purchaseDate)
  const ownershipDays = item.purchaseDate ? calculateOwnershipDays(item.purchaseDate) : null
  const hasCostBreakdown = item.purchasePriceCents !== null || item.additionalCostCents !== null

  // Hero 三栏：持有天数 / 总投入 / 日均成本
  // （"价格构成"不放在 Hero，避免与下面的明细表重复出现同一个数字）
  const heroMetrics = [
    ownershipDays !== null
      ? { label: '持有天数', value: `${ownershipDays} 天` }
      : null,
    totalCents !== null
      ? { label: '总投入', value: formatCentsCompact(totalCents) }
      : null,
    dailyCents !== null
      ? { label: '日均成本', value: formatCents(dailyCents), money: true }
      : null,
  ].filter((m): m is { label: string; value: string; money?: boolean } => m !== null)

  const purchaseSubline = [
    item.purchasePlatform ? platformLabel(item.purchasePlatform) : null,
    item.purchaseDate ? formatPurchaseDate(item.purchaseDate) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const handleDelete = async () => {
    setConfirmingDelete(false)
    try {
      await itemRepository.softDelete(item.id)
      show('已删除')
      setTimeout(() => navigate(-1), 350)
    } catch (e) {
      show(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div>
      <PageHeader
        title=""
        right={
          <Link
            to={`/items/${item.id}/edit`}
            className="flex min-h-[36px] items-center px-1 text-item text-ink-primary transition-opacity active:opacity-50 sm:hover:opacity-60"
          >
            编辑
          </Link>
        }
      />

      <div className="animate-fade-rise px-5 pt-3">
        {/* Hero：物品是主角。
            打光盘面（plate-surface-lg）提供固定顶光 —— 不是每页随机渐变，
            物品直接落在光盘面上，不套第二层底衬，避免双层边框。 */}
        <section className="overflow-hidden rounded-surface border border-line bg-surface shadow-card">
          <div className="plate-surface-lg px-5 pb-4 pt-5">
            <div className="mx-auto w-[52%]">
              <ObjectPlate
                src={iconUrl}
                alt={item.name}
                className="aspect-square animate-pop-in"
                bare
                plateStyle={{ viewTransitionName: 'item-hero' }}
              />
            </div>

            <div className="mt-5 text-center">
              <h1 className="text-title-card text-ink-primary">{item.name}</h1>
              {category && (
                <Link
                  to={`/categories/${category.id}`}
                  className="group mt-2.5 inline-flex items-center gap-1 text-secondary text-ink-tertiary transition-colors active:opacity-60 sm:hover:text-ink-secondary"
                >
                  {categoryPath(categories, item.categoryId)}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-out-quint sm:group-hover:translate-x-0.5">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </Link>
              )}
            </div>

            {itemTags.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {itemTags.map((tag) => (
                  <TagChip key={tag.id} name={tag.name} />
                ))}
              </div>
            )}

            {purchaseSubline && (
              <p className="num mt-4 text-center text-caption text-ink-tertiary">
                {purchaseSubline}
              </p>
            )}
          </div>

          {/* 三栏关键指标：与下方明细表不重复，只给结论 */}
          {heroMetrics.length > 0 && (
            <div
              className={`grid divide-x divide-line-inner border-t border-line px-2 py-3.5 ${
                heroMetrics.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
              }`}
            >
              {heroMetrics.map((m) => (
                <HeroMetric key={m.label} label={m.label} value={m.value} money={m.money} />
              ))}
            </div>
          )}
        </section>

        {/* 构成明细：子表面 + 虚线 + 金额色，让"这笔钱怎么来的"一眼可读 */}
        {hasCostBreakdown && (
          <section className="mt-3 rounded-surface border border-line bg-surface p-4 shadow-card">
            <p className="text-label text-ink-tertiary">价格明细</p>
            <div className="mt-2.5 rounded-control bg-surface-sunken px-3.5 py-2.5">
              {item.purchasePriceCents !== null && (
                <SpecRow label="购买价格" value={formatCents(item.purchasePriceCents)} />
              )}
              {item.additionalCostCents !== null && (
                <SpecRow
                  label="附加花费"
                  value={formatCents(item.additionalCostCents)}
                  money
                />
              )}
              {totalCents !== null && (
                <>
                  <div className="my-1.5 border-t border-dashed border-line" />
                  <div className="flex items-baseline justify-between pt-0.5">
                    <span className="text-caption text-ink-secondary">合计</span>
                    <span className="num text-item font-medium text-ink-primary">
                      {formatCents(totalCents)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* 备注 */}
        {item.note && (
          <section className="mt-3 rounded-surface border border-line bg-surface p-4 shadow-card">
            <p className="text-label text-ink-tertiary">备注</p>
            <p className="mt-2 text-body leading-relaxed text-ink-secondary">{item.note}</p>
          </section>
        )}

        {/* 删除：弱视觉权重，放在页面靠下，用语义危险色 */}
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="mt-8 flex min-h-[44px] w-full items-center justify-center rounded-control text-secondary text-danger transition-colors active:bg-danger-soft sm:hover:bg-danger-soft"
        >
          删除此物品
        </button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="删除此物品？"
        message="该操作会从物品库中移除该物品。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
      {toast}
    </div>
  )
}
