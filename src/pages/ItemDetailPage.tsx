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
  if (loading) {
    // useLiveQuery 初次返回 undefined；物品被删后回到本页也为 undefined → 统一按不存在处理前给一帧加载
    return null
  }

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
  const totalCents = calculateTotalCostCents(
    item.purchasePriceCents,
    item.additionalCostCents,
  )
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
      {/* 编辑入口放顶部右侧，保持轻量 */}
      <PageHeader
        title=""
        right={
          <Link
            to={`/items/${item.id}/edit`}
            className="flex min-h-[36px] items-center px-1 text-item text-ink-primary transition-opacity active:opacity-50"
          >
            编辑
          </Link>
        }
      />

      <div className="px-5 pt-2">
        {/* 主图区域 */}
        <div className="mx-auto w-[76%] overflow-hidden rounded-[26px]">
          <img src={iconUrl} alt={item.name} className="aspect-square w-full object-cover" draggable={false} />
        </div>

        {/* 名称与分类路径 */}
        <h1 className="mt-6 text-title-card text-ink-primary">{item.name}</h1>
        {category && (
          <Link
            to={`/categories/${category.id}`}
            className="mt-1.5 inline-flex items-center gap-1 text-secondary text-ink-tertiary transition-opacity active:opacity-50"
          >
            {categoryPath(categories, item.categoryId)}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        )}

        {/* 标签 */}
        {itemTags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {itemTags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} />
            ))}
          </div>
        )}

        {/* 购买信息（有任一字段才显示） */}
        {hasPurchase && (
          <div className="mt-5 rounded-2xl border border-black/[0.05] bg-white p-4 shadow-card">
            <p className="mb-1.5 text-caption font-medium text-ink-tertiary">购买信息</p>
            {item.purchasePriceCents !== null && (
              <p className="text-item text-ink-primary">{formatCents(item.purchasePriceCents)}</p>
            )}
            {item.additionalCostCents !== null && (
              <p className="mt-0.5 text-secondary text-ink-secondary">
                附加花费 {formatCents(item.additionalCostCents)}
              </p>
            )}
            {totalCents !== null && (
              <p className="mt-0.5 text-secondary text-ink-secondary">
                总投入{' '}
                <span className="font-medium text-ink-primary">{formatCents(totalCents)}</span>
              </p>
            )}
            {purchaseSubline && (
              <p className="mt-1 text-secondary text-ink-secondary">{purchaseSubline}</p>
            )}
            {ownershipDays !== null && (
              <p className="mt-1 text-secondary text-ink-secondary">
                已持有 {ownershipDays} 天
              </p>
            )}
            {dailyCents !== null && (
              <p className="mt-0.5 text-secondary text-ink-secondary">
                日均使用成本{' '}
                <span className="font-medium text-ink-primary">{formatCents(dailyCents)} / 天</span>
              </p>
            )}
          </div>
        )}

        {/* 备注 */}
        {item.note && (
          <div className="mt-5 rounded-2xl border border-black/[0.05] bg-white p-4 shadow-card">
            <p className="mb-1 text-caption font-medium text-ink-tertiary">备注</p>
            <p className="text-body text-ink-secondary">{item.note}</p>
          </div>
        )}

        {/* 删除：弱视觉权重，放在页面靠下 */}
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="mt-8 flex min-h-[44px] w-full items-center justify-center text-secondary text-[#DC2626] transition-opacity active:opacity-50"
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
