import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { categoryPath } from '../domain/categoryTree'
import {
  calculateTotalCostCents,
  formatCents,
  formatCentsCompact,
  formatPurchaseDate,
  platformLabel,
  todayString,
} from '../domain/purchase'
import {
  DISPOSAL_METHOD_LABELS,
  dailyCostOf,
  effectiveCostCents,
  isDisposed,
  isOwned,
  isWishlist,
  ownershipDaysOf,
  statusOf,
  warrantyInfo,
} from '../domain/lifecycle'
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
import { StatusChip, WarrantyChip } from '../components/StatusChip'
import DisposalSheet, { type DisposalResult } from '../components/DisposalSheet'
import ConvertToOwnedSheet, { type PurchaseInput } from '../components/ConvertToOwnedSheet'
import { useToast } from '../components/Toast'

/** 三级信息行：左标签右数值，中间以极细虚线引导 */
function SpecRow({
  label,
  value,
  money,
  strong,
}: {
  label: string
  value: string
  money?: boolean
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="shrink-0 text-caption text-ink-tertiary">{label}</span>
      <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dashed border-line" />
      <span
        className={`num shrink-0 text-right text-caption ${
          strong
            ? 'text-item font-medium text-ink-primary'
            : money
              ? 'text-money'
              : 'text-ink-secondary'
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

/** 生命周期操作：只列业务上有意义的动作，不为了凑格子硬加 */
function ActionButton({
  label,
  hint,
  onClick,
  tone = 'plain',
}: {
  label: string
  hint?: string
  onClick: () => void
  tone?: 'plain' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 rounded-control border px-3 transition-colors duration-150 active:opacity-70 ${
        tone === 'danger'
          ? 'border-line text-danger active:bg-danger-soft'
          : 'border-line bg-surface text-ink-primary active:bg-surface-sunken'
      }`}
    >
      <span className="text-secondary">{label}</span>
      {hint && <span className="text-[10px] text-ink-tertiary">{hint}</span>}
    </button>
  )
}

/**
 * 物品详情：一份"物品档案"。
 *
 * 顺序：Hero（这是谁 + 值多少）→ 状态 → 保修 → 处置 → 投入明细 → 标签 → 备注 → 生命周期操作
 * 刻意不做成一堆等高卡片：用打光盘面、留白、hairline 与字号差建立节奏。
 */
export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [disposalOpen, setDisposalOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)

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

  const today = todayString()
  const status = statusOf(item)
  const category = categories.find((c) => c.id === item.categoryId)
  const itemTags = links
    .filter((l) => l.itemId === item.id)
    .map((l) => tags.find((t) => t.id === l.tagId))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
  const iconUrl = assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'

  const days = ownershipDaysOf(item, today)
  const gross = calculateTotalCostCents(item.purchasePriceCents, item.additionalCostCents)
  const net = effectiveCostCents(item)
  const daily = dailyCostOf(item, today)
  const warranty = warrantyInfo(item.warrantyExpiresAt, today)
  const sold = isDisposed(item) && item.disposalMethod === 'sold' && item.salePriceCents !== null

  // Hero 三栏的措辞严格按状态区分：
  // - 持有中：持有天数 / 总投入 / 日均成本（原始口径）
  // - 已出售：实际持有天数 / 实际持有成本 / 实际日均成本（净额口径）
  // - 丢弃或其他：天数冻结但没有回收，仍是 实际持有天数 / 总投入 / 日均成本
  const frozen = isDisposed(item)
  const heroMetrics = isWishlist(item)
    ? []
    : [
        days !== null
          ? { label: frozen ? '实际持有天数' : '持有天数', value: `${days} 天` }
          : null,
        net !== null
          ? { label: sold ? '实际持有成本' : '总投入', value: formatCentsCompact(net) }
          : null,
        daily !== null
          ? { label: sold ? '实际日均成本' : '日均成本', value: formatCents(daily), money: true }
          : null,
      ].filter((m): m is { label: string; value: string; money?: boolean } => m !== null)

  const handleDisposal = async (r: DisposalResult) => {
    await itemRepository.update(item.id, {
      name: item.name,
      categoryId: item.categoryId,
      iconAssetId: item.iconAssetId,
      note: item.note,
      tagIds: links.filter((l) => l.itemId === item.id).map((l) => l.tagId),
      status: 'disposed',
      purchaseDate: item.purchaseDate,
      purchasePriceCents: item.purchasePriceCents,
      additionalCostCents: item.additionalCostCents,
      purchasePlatform: item.purchasePlatform,
      warrantyExpiresAt: item.warrantyExpiresAt,
      disposedAt: r.disposedAt,
      disposalMethod: r.disposalMethod,
      salePriceCents: r.salePriceCents,
      disposalNote: r.disposalNote,
    })
    setDisposalOpen(false)
    show('已记录处置')
  }

  const handleConvert = async (p: PurchaseInput) => {
    await itemRepository.convertToOwned(item.id, {
      purchaseDate: p.purchaseDate,
      purchasePriceCents: p.purchasePriceCents,
      additionalCostCents: p.additionalCostCents,
      purchasePlatform: p.purchasePlatform,
      warrantyExpiresAt: p.warrantyExpiresAt,
    })
    setConvertOpen(false)
    show('已转为持有')
  }

  const handleRestore = async () => {
    try {
      await itemRepository.restoreToOwned(item.id)
      show('已恢复为持有')
    } catch (e) {
      show(e instanceof Error ? e.message : '操作失败')
    }
  }

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
        {/* Hero：物品是主角。打光盘面 + 物品直接落在光盘面上（不套第二层底衬） */}
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

            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
              <StatusChip status={status} />
              {isOwned(item) && <WarrantyChip item={item} today={today} />}
            </div>
          </div>

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

        {/* 心愿：明确说明它还不是"持有"，避免误以为已计入总投入 */}
        {isWishlist(item) && (
          <section className="mt-3 rounded-surface border border-accent-line bg-accent-soft px-4 py-3.5">
            <p className="text-label text-accent">心愿物品</p>
            <p className="mt-1.5 text-body leading-relaxed text-ink-secondary">
              还没有购入，因此不计入总投入与日均成本。买到了之后点下方「转为持有」补齐信息。
            </p>
          </section>
        )}

        {/* 保修追踪 */}
        {warranty !== null && isOwned(item) && (
          <section className="mt-3 rounded-surface border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between">
              <p className="text-label text-ink-tertiary">保修追踪</p>
              <WarrantyChip item={item} today={today} />
            </div>
            <p className="mt-2.5 text-body text-ink-primary">{warranty.detail}</p>
            <p className="num mt-1 text-caption text-ink-tertiary">
              到期日：{formatPurchaseDate(warranty.expiresAt)}
            </p>
          </section>
        )}

        {/* 处置信息 */}
        {isDisposed(item) && (
          <section className="mt-3 rounded-surface border border-line bg-surface p-4 shadow-card">
            <p className="text-label text-ink-tertiary">处置信息</p>
            <div className="mt-2.5">
              {item.disposalMethod && (
                <SpecRow label="方式" value={DISPOSAL_METHOD_LABELS[item.disposalMethod]} />
              )}
              {item.disposedAt && (
                <SpecRow label="处置日期" value={formatPurchaseDate(item.disposedAt)} />
              )}
              {sold && <SpecRow label="出售金额" value={formatCents(item.salePriceCents ?? 0)} money />}
              {sold && gross !== null && <SpecRow label="原始总投入" value={formatCents(gross)} />}
              {item.disposalNote && <SpecRow label="备注" value={item.disposalNote} />}
            </div>
            {sold && net !== null && (
              <p className="mt-2 text-caption text-ink-tertiary">
                实际持有成本 = 原始总投入 − 出售金额
                {net < 0 && '（卖得比买得多，实际是收益）'}
              </p>
            )}
            <p className="num mt-2 text-caption text-ink-tertiary">
              持有天数已冻结在处置日，之后不会再增长。
            </p>
          </section>
        )}

        {/* 投入明细：子表面 + 虚线 + 金额色，让"这笔钱怎么来的"一眼可读 */}
        {gross !== null && (
          <section className="mt-3 rounded-surface border border-line bg-surface p-4 shadow-card">
            <p className="text-label text-ink-tertiary">购买与投入</p>
            <div className="mt-2.5 rounded-control bg-surface-sunken px-3.5 py-2.5">
              {item.purchasePriceCents !== null && (
                <SpecRow label="购买价格" value={formatCents(item.purchasePriceCents)} />
              )}
              {item.additionalCostCents !== null && (
                <SpecRow label="附加花费" value={formatCents(item.additionalCostCents)} money />
              )}
              <div className="my-1.5 border-t border-dashed border-line" />
              <div className="flex items-baseline justify-between pt-0.5">
                <span className="text-caption text-ink-secondary">合计</span>
                <span className="num text-item font-medium text-ink-primary">
                  {formatCents(gross)}
                </span>
              </div>
            </div>
            {(item.purchaseDate || item.purchasePlatform) && (
              <div className="mt-2.5">
                {item.purchaseDate && (
                  <SpecRow label="购入时间" value={formatPurchaseDate(item.purchaseDate)} />
                )}
                {item.purchasePlatform && (
                  <SpecRow label="购买渠道" value={platformLabel(item.purchasePlatform)} />
                )}
              </div>
            )}
          </section>
        )}

        {/* 标签 */}
        {itemTags.length > 0 && (
          <section className="mt-3 rounded-surface border border-line bg-surface p-4 shadow-card">
            <p className="text-label text-ink-tertiary">标签</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {itemTags.map((tag) => (
                <TagChip key={tag.id} name={tag.name} />
              ))}
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

        {/* 生命周期操作：按当前状态给出有意义的动作，不凑格子 */}
        <section className="mt-6 grid grid-cols-2 gap-2.5">
          {isWishlist(item) && (
            <ActionButton
              label="转为持有"
              hint="补齐购买信息"
              onClick={() => setConvertOpen(true)}
            />
          )}
          {isOwned(item) && (
            <ActionButton
              label="处置物品"
              hint="出售 / 丢弃 / 其他"
              onClick={() => setDisposalOpen(true)}
            />
          )}
          {isDisposed(item) && (
            <ActionButton
              label="恢复为持有"
              hint="保留购买数据"
              onClick={() => void handleRestore()}
            />
          )}
          <ActionButton label="编辑物品" onClick={() => navigate(`/items/${item.id}/edit`)} />
          <ActionButton label="删除物品" tone="danger" onClick={() => setConfirmingDelete(true)} />
        </section>
      </div>

      <DisposalSheet
        open={disposalOpen}
        item={item}
        onSubmit={handleDisposal}
        onClose={() => setDisposalOpen(false)}
      />
      <ConvertToOwnedSheet
        open={convertOpen}
        item={item}
        onSubmit={handleConvert}
        onClose={() => setConvertOpen(false)}
      />
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
