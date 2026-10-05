import { useState, type ReactNode } from 'react'
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
  warrantyProgressOf,
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
import { useHeaderCollapse } from '../features/ui/useHeaderCollapse'

/** 分组容器：section 卡 + 标题。整页的 grouped 语言由此统一。 */
function GroupCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3 overflow-hidden rounded-surface border border-line bg-surface shadow-card">
      <p className="px-4 pt-3.5 text-label text-ink-tertiary">{title}</p>
      <div className="px-4 pb-4 pt-2">{children}</div>
    </section>
  )
}

/** Inner cell：分组内更沉一层的信息格，字段行铺在其上 */
function InnerCell({ children }: { children: ReactNode }) {
  return <div className="rounded-control bg-surface-sunken px-3.5 py-2.5">{children}</div>
}

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

/** 记录时间戳（createdAt / updatedAt 是完整 ISO 串，与纯日期字段分开格式化） */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Hero 指标格：数字是结论，标签只是单位说明。指标收在染色区内，因此给足字重 */
function HeroMetric({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="min-w-0 px-3">
      <p className={`num truncate text-section ${money ? 'text-money' : 'text-ink-primary'}`}>{value}</p>
      <p className="mt-1 truncate text-caption text-ink-tertiary">{label}</p>
    </div>
  )
}

/** 生命周期操作：语义 tint 只到 soft 一级，绝不满铺；每块带图标 + 标题 + 副标题 */
function ActionButton({
  label,
  hint,
  icon,
  onClick,
  tone = 'plain',
}: {
  label: string
  hint?: string
  icon: ReactNode
  onClick: () => void
  tone?: 'plain' | 'info' | 'success' | 'money' | 'danger'
}) {
  const tones: Record<string, string> = {
    plain: 'border-line bg-surface text-ink-primary active:bg-surface-sunken',
    info: 'border-transparent bg-info-soft text-info',
    success: 'border-transparent bg-success-soft text-success',
    money: 'border-money-line bg-money-soft text-money-deep',
    danger: 'border-transparent bg-danger-soft text-danger',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[64px] w-full items-center gap-3 rounded-control border px-3.5 text-left transition-colors duration-150 active:opacity-70 ${tones[tone]}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-item font-medium">{label}</span>
        {hint && <span className="mt-0.5 block truncate text-caption text-ink-tertiary">{hint}</span>}
      </span>
    </button>
  )
}

/** 操作区图标：统一 18px 线性图标，颜色继承所在按钮的语义色 */
function ActionGlyph({ d, circle = false }: { d: string; circle?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {circle && <circle cx="12" cy="12" r="8.6" />}
      <path d={d} />
    </svg>
  )
}

/**
 * 物品详情：一份"物品档案"（Phase 2H 重构）。
 *
 * 层级（由高到低）：
 *   Large Title → Hero 身份卡（这是谁 + 值多少）→ 信息分组 → 生命周期操作
 * 分组 = GroupCard（surface）+ InnerCell（sunken）+ hairline，不是一堆等权重卡片。
 * 不伪造数据：保修 / 处置 / 标签 / 备注 / 记录信息都只在有数据时出现。
 */
export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [disposalOpen, setDisposalOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const { sentinelRef, collapsed } = useHeaderCollapse<HTMLDivElement>()

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
  const warrantyProgress = isOwned(item) ? warrantyProgressOf(item, today) : null
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
        title="物品详情"
        floating
        collapsed={collapsed}
        right={
          <Link
            to={`/items/${item.id}/edit`}
            className="flex min-h-[28px] items-center px-1 text-item text-ink-primary transition-opacity active:opacity-50 sm:hover:opacity-60"
          >
            编辑
          </Link>
        }
      />

      <div className="animate-fade-rise px-5 pt-3">
        {/* Large Title：滚动离场后由 sticky header 的居中小标题接管 */}
        <div ref={sentinelRef}>
          <h1 className="text-page-title text-ink-primary">物品详情</h1>
        </div>

        {/* Hero：物品身份卡。横向布局 —— 名称/状态/分类在左、物品图在右，
            三栏指标收在同一块染色区内（不另起白色底），整卡自成一块材质。
            hero-surface 铺满整卡，因此渐变连续、无接缝。 */}
        <section className="hero-surface mt-3 overflow-hidden rounded-surface border border-hero-line shadow-card">
          <div className="flex items-center gap-4 px-5 pb-3.5 pt-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-title-card text-ink-primary">{item.name}</h2>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <StatusChip status={status} />
                {category && (
                  <Link
                    to={`/categories/${category.id}`}
                    className="group inline-flex min-h-[24px] items-center gap-1 rounded-pill bg-surface-sunken px-2.5 text-caption text-ink-secondary transition-opacity active:opacity-70 sm:hover:opacity-80"
                  >
                    {categoryPath(categories, item.categoryId)}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-out-quint sm:group-hover:translate-x-0.5" aria-hidden>
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </Link>
                )}
                {isOwned(item) && <WarrantyChip item={item} today={today} />}
              </div>
            </div>
            <div className="w-[38%] max-w-[128px] shrink-0">
              <ObjectPlate
                src={iconUrl}
                alt={item.name}
                className="aspect-square animate-pop-in"
                bare
                plateStyle={{ viewTransitionName: 'item-hero' }}
              />
            </div>
          </div>

          {heroMetrics.length > 0 && (
            <div
              className={`grid divide-x divide-hero-line border-t border-hero-line px-2 py-3.5 ${
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

        {/* 购买与投入：section + inner cell，构成"价格怎么来的" */}
        {gross !== null && (
          <GroupCard title="购买与投入">
            <InnerCell>
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
            </InnerCell>
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
          </GroupCard>
        )}

        {/* 保修追踪：有数据才出现；进度条只在可计算时出现 */}
        {warranty !== null && isOwned(item) && (
          <GroupCard title="保修追踪">
            <div className="flex items-center justify-between">
              <p className="text-body text-ink-primary">{warranty.detail}</p>
              <WarrantyChip item={item} today={today} />
            </div>
            <p className="num mt-1 text-caption text-ink-tertiary">
              到期日：{formatPurchaseDate(warranty.expiresAt)}
            </p>
            {warrantyProgress?.ratio != null && warranty.state !== 'expired' && (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
                  <div
                    className={`h-full rounded-pill transition-[width] duration-500 ease-out-quint ${
                      warranty.state === 'expiring' ? 'bg-danger' : 'bg-success'
                    }`}
                    style={{ width: `${Math.max(3, Math.round(warrantyProgress.ratio * 100))}%` }}
                  />
                </div>
                <p className="num mt-1.5 text-caption text-ink-tertiary">
                  保修期已过 {Math.round((1 - warrantyProgress.ratio) * 100)}%
                </p>
              </div>
            )}
          </GroupCard>
        )}

        {/* 处置信息 */}
        {isDisposed(item) && (
          <GroupCard title="处置信息">
            {item.disposalMethod && (
              <SpecRow label="方式" value={DISPOSAL_METHOD_LABELS[item.disposalMethod]} />
            )}
            {item.disposedAt && (
              <SpecRow label="处置日期" value={formatPurchaseDate(item.disposedAt)} />
            )}
            {sold && <SpecRow label="出售金额" value={formatCents(item.salePriceCents ?? 0)} money />}
            {sold && gross !== null && <SpecRow label="原始总投入" value={formatCents(gross)} />}
            {item.disposalNote && <SpecRow label="备注" value={item.disposalNote} />}
            {sold && net !== null && (
              <p className="mt-2 text-caption text-ink-tertiary">
                实际持有成本 = 原始总投入 − 出售金额
                {net < 0 && '（卖得比买得多，实际是收益）'}
              </p>
            )}
            <p className="num mt-2 text-caption text-ink-tertiary">
              持有天数已冻结在处置日，之后不会再增长。
            </p>
          </GroupCard>
        )}

        {/* 标签 */}
        {itemTags.length > 0 && (
          <GroupCard title="标签">
            <div className="flex flex-wrap gap-1.5">
              {itemTags.map((tag) => (
                <TagChip key={tag.id} name={tag.name} />
              ))}
            </div>
          </GroupCard>
        )}

        {/* 备注 */}
        {item.note && (
          <GroupCard title="备注">
            <p className="text-body leading-relaxed text-ink-secondary">{item.note}</p>
          </GroupCard>
        )}

        {/* 记录信息：只有真实的 createdAt / updatedAt，不伪造完整时间线 */}
        <GroupCard title="记录信息">
          <SpecRow label="创建于" value={formatTimestamp(item.createdAt)} />
          {item.updatedAt !== item.createdAt && (
            <SpecRow label="最近更新" value={formatTimestamp(item.updatedAt)} />
          )}
        </GroupCard>

        {/* 生命周期操作：按当前状态给出有意义的动作，语义 tint 只到 soft 一级 */}
        <section className="mt-6 grid grid-cols-2 gap-2.5">
          {isWishlist(item) && (
            <ActionButton
              label="转为持有"
              hint="补齐购买信息"
              tone="success"
              icon={<ActionGlyph circle d="m8.5 12.2 2.4 2.4 4.6-5" />}
              onClick={() => setConvertOpen(true)}
            />
          )}
          {isOwned(item) && (
            <ActionButton
              label="处置物品"
              hint="出售 / 丢弃 / 其他"
              tone="money"
              icon={<ActionGlyph d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.8 12.2h9.4L17.5 7" />}
              onClick={() => setDisposalOpen(true)}
            />
          )}
          {isDisposed(item) && (
            <ActionButton
              label="恢复为持有"
              hint="保留购买数据"
              tone="success"
              icon={<ActionGlyph d="M4 12a8 8 0 1 0 2.6-5.9M4 4.5V10h5.4" />}
              onClick={() => void handleRestore()}
            />
          )}
          <ActionButton
            label="编辑物品"
            hint="修改物品信息"
            tone="info"
            icon={<ActionGlyph d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5zM14.5 7.5l2 2" />}
            onClick={() => navigate(`/items/${item.id}/edit`)}
          />
          <ActionButton
            label="删除物品"
            hint="永久移除"
            tone="danger"
            icon={<ActionGlyph d="M5 7h14M10 7V4.8h4V7M6.5 7l.8 12.2h9.4L17.5 7M10.5 10.5v6M13.5 10.5v6" />}
            onClick={() => setConfirmingDelete(true)}
          />
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
