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
import { ObjectPlate } from '../components/ItemCard'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/Dialogs'
import { useToast } from '../components/Toast'

/**
 * 三级信息行：左标签右数值，中间以极细虚线引导。
 * 只用于「购买价格 / 附加花费 / 渠道与日期」这类补充事实，字号与对比度都刻意压低。
 */
function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="shrink-0 text-caption text-ink-tertiary">{label}</span>
      <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dashed border-line" />
      <span className="num shrink-0 text-right text-caption text-ink-secondary">{value}</span>
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

      <div className="animate-fade-rise px-5 pt-3">
        {/* Object：档案卡的主图版（暖白底衬 + 内留白）。
            同时作为「列表卡片 → 详情」的共享元素目标（View Transitions 渐进增强，不支持时无副作用） */}
        <div className="mx-auto w-[64%]">
          <ObjectPlate
            src={iconUrl}
            alt={item.name}
            className="aspect-square rounded-surface border border-line-inner"
            plateStyle={{ viewTransitionName: 'item-hero' }}
          />
        </div>

        {/* 名称与分类路径 */}
        <div className="mt-5 text-center">
          <h1 className="text-title-card text-ink-primary">{item.name}</h1>
          {category && (
            <Link
              to={`/categories/${category.id}`}
              className="group mt-2 inline-flex items-center gap-1 text-secondary text-ink-tertiary transition-colors active:opacity-60 sm:hover:text-ink-secondary"
            >
              {categoryPath(categories, item.categoryId)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-out-quint sm:group-hover:translate-x-0.5">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </Link>
          )}
        </div>

        {/* 标签 */}
        {itemTags.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2" style={{ animationDelay: '100ms' }}>
            {itemTags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} />
            ))}
          </div>
        )}

        {/* 购买信息（有任一字段才显示） */}
        {hasPurchase && (
          <section
            className="mt-6 overflow-hidden rounded-surface border border-line bg-white shadow-card"
            style={{ animationDelay: '140ms' }}
          >
            {/* ① 一级信息：日均使用成本 —— 本产品最独特的结论，做视觉锚点 */}
            {dailyCents !== null && (
              <div className="border-b border-accent-line bg-accent-soft px-4 py-4">
                <p className="text-label text-accent-deep">日均使用成本</p>
                <p className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="num text-metric-lg text-ink-primary">{formatCents(dailyCents)}</span>
                  <span className="text-secondary text-ink-secondary">/ 天</span>
                </p>
                <p className="num mt-1 text-caption text-ink-tertiary">
                  已持有 {ownershipDays} 天 · 按总投入分摊
                </p>
              </div>
            )}

            <div className="px-4 py-3.5">
              {/* ② 二级信息：总投入 */}
              {totalCents !== null && (
                <div className="flex items-baseline justify-between">
                  <span className="text-secondary text-ink-secondary">总投入</span>
                  <span className="num text-body font-medium text-ink-primary">
                    {formatCents(totalCents)}
                  </span>
                </div>
              )}

              {/* ③ 三级信息：构成总投入的补充事实 */}
              {(item.purchasePriceCents !== null ||
                item.additionalCostCents !== null ||
                purchaseSubline) && (
                <div className="mt-2 border-t border-line-inner pt-2">
                  {item.purchasePriceCents !== null && (
                    <SpecRow label="购买价格" value={formatCents(item.purchasePriceCents)} />
                  )}
                  {item.additionalCostCents !== null && (
                    <SpecRow label="附加花费" value={formatCents(item.additionalCostCents)} />
                  )}
                  {purchaseSubline && <SpecRow label="渠道与日期" value={purchaseSubline} />}
                  {dailyCents === null && ownershipDays !== null && (
                    <SpecRow label="已持有" value={`${ownershipDays} 天`} />
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* 备注 */}
        {item.note && (
          <section
            className="mt-3 rounded-surface border border-line bg-white p-4 shadow-card"
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
