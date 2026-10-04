import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { categoryPath } from '../domain/categoryTree'
import {
  calculateDailyCostCents,
  calculateOwnershipDays,
  calculateTotalCostCents,
  formatCents,
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
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/Dialogs'
import { useToast } from '../components/Toast'

/** 规格行：左标签右数值，中间以极细引导点连接（表格化但不呆板） */
function SpecRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="shrink-0 text-secondary text-ink-tertiary">{label}</span>
      <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dashed border-line" />
      <span
        className={`num shrink-0 text-right text-body ${
          strong ? 'font-medium text-ink-primary' : 'text-ink-secondary'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

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

  // 购买信息：四个字段全为空则整个区块不显示
  const hasPurchase =
    item.purchaseDate !== null ||
    item.purchasePriceCents !== null ||
    item.additionalCostCents !== null ||
    item.purchasePlatform !== null
  const totalCents = calculateTotalCostCents(item.purchasePriceCents, item.additionalCostCents)
  const dailyCents = calculateDailyCostCents(totalCents, item.purchaseDate)
  const ownershipDays = item.purchaseDate ? calculateOwnershipDays(item.purchaseDate) : null
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
      {/* 编辑入口 */}
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

      <div className="px-5 pt-3">
        {/* 主图：入场轻微上浮（尺寸收敛，让日均成本指标落在首屏内） */}
        <div className="animate-fade-rise mx-auto w-[60%] overflow-hidden rounded-[24px]">
          <img src={iconUrl} alt={item.name} className="aspect-square w-full object-cover" draggable={false} />
        </div>

        {/* 名称与分类路径 */}
        <div className="animate-fade-rise mt-5 text-center" style={{ animationDelay: '60ms' }}>
          <h1 className="text-title-card text-ink-primary">{item.name}</h1>
          {category && (
            <Link
              to={`/categories/${category.id}`}
              className="group mt-2 inline-flex items-center gap-1 text-secondary text-ink-tertiary transition-colors active:opacity-60 sm:hover:text-ink-secondary"
            >
              {categoryPath(categories, item.categoryId)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-spring sm:group-hover:translate-x-0.5">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </Link>
          )}
        </div>

        {/* 标签 */}
        {itemTags.length > 0 && (
          <div className="animate-fade-rise mt-4 flex flex-wrap justify-center gap-2" style={{ animationDelay: '100ms' }}>
            {itemTags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} />
            ))}
          </div>
        )}

        {/* 购买信息（有任一字段才显示） */}
        {hasPurchase && (
          <section
            className="animate-fade-rise mt-6 overflow-hidden rounded-[22px] border border-line bg-white shadow-card"
            style={{ animationDelay: '140ms' }}
          >
            <div className="px-4 pt-4">
              <p className="text-label text-ink-tertiary">购买信息</p>
              <div className="mt-2">
                {item.purchasePriceCents !== null && (
                  <SpecRow label="购买价格" value={formatCents(item.purchasePriceCents)} />
                )}
                {item.additionalCostCents !== null && (
                  <SpecRow label="附加花费" value={formatCents(item.additionalCostCents)} />
                )}
                {totalCents !== null && (
                  <SpecRow label="总投入" value={formatCents(totalCents)} strong />
                )}
                {purchaseSubline && <SpecRow label="渠道与日期" value={purchaseSubline} />}
                {ownershipDays !== null && (
                  <SpecRow label="已持有" value={`${ownershipDays} 天`} />
                )}
              </div>
            </div>

            {/* 指标区：全页视觉锚点 */}
            {dailyCents !== null && (
              <div className="mt-3 border-t border-line-inner bg-accent-soft/60 px-4 py-4">
                <p className="text-label text-accent">日均使用成本</p>
                <p className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="num text-metric-lg text-ink-primary">{formatCents(dailyCents)}</span>
                  <span className="text-secondary text-ink-secondary">/ 天</span>
                </p>
                <p className="mt-1 text-caption text-ink-tertiary">
                  按总投入分摊到持有的每一天
                </p>
              </div>
            )}
          </section>
        )}

        {/* 备注 */}
        {item.note && (
          <section
            className="animate-fade-rise mt-3 rounded-[22px] border border-line bg-white p-4 shadow-card"
            style={{ animationDelay: '180ms' }}
          >
            <p className="text-label text-ink-tertiary">备注</p>
            <p className="mt-2 text-body leading-relaxed text-ink-secondary">{item.note}</p>
          </section>
        )}

        {/* 删除：弱视觉权重，放在页面靠下 */}
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="mt-8 flex min-h-[44px] w-full items-center justify-center text-secondary text-[#C0392B] transition-opacity active:opacity-60 sm:hover:opacity-70"
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
