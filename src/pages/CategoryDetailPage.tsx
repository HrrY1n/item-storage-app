import { useParams } from 'react-router'
import { categoryPath, collectSubtreeIds } from '../domain/categoryTree'
import { todayString } from '../domain/purchase'
import { useCategories, useItemTagLinks, useItems, usePresetAssetMap, useTags } from '../features/data/hooks'
import { categoryNameOf, tagNamesOf } from '../features/data/viewModels'
import PageHeader from '../components/PageHeader'
import ItemCard from '../components/ItemCard'
import EmptyState from '../components/EmptyState'

export default function CategoryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const categories = useCategories()
  const items = useItems()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()
  // 卡片的持有天数 / 日均成本需要"今天"；已处置物品会在 domain 里冻结到处置日
  const today = todayString()

  const loading = !categories || !items || !tags || !links || !assetMap
  if (loading) return null

  const category = categories.find((c) => c.id === id)
  if (!category) {
    return (
      <div>
        <PageHeader title="分类" />
        <EmptyState title="分类不存在" subtitle="它可能已经被删除" />
      </div>
    )
  }

  const subtree = collectSubtreeIds(categories, category.id)
  const categoryItems = items.filter((i) => subtree.has(i.categoryId))

  return (
    <div>
      <PageHeader title={category.name} />
      <div className="animate-fade-rise px-5 pt-5">
        <p className="text-caption text-ink-tertiary">
          {categoryPath(categories, category.id)}
        </p>
        <p className="mt-1.5 text-secondary text-ink-tertiary">
          <span className="num text-item text-ink-primary">{categoryItems.length}</span> 件物品
        </p>

        {categoryItems.length === 0 ? (
          <EmptyState title="这个分类还没有物品" subtitle="点击右下角 ＋ 新增一件物品吧" />
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {categoryItems.map((item) => (
              <ItemCard
                key={item.id}
                to={`/items/${item.id}`}
                name={item.name}
                iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
                categoryName={categoryNameOf(categories, item.categoryId)}
                tagNames={tagNamesOf(item.id, links, tags)}
                item={item}
                today={today}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
