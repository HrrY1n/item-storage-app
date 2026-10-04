import { usePresetAssets } from '../features/data/hooks'
import { presetSortIndex } from '../data/icons'
import PageHeader from '../components/PageHeader'

export default function IconLibraryPage() {
  const assets = usePresetAssets()
  if (!assets) return null
  const ordered = [...assets].sort((a, b) => presetSortIndex(a.id) - presetSortIndex(b.id))

  return (
    <div>
      <PageHeader title="图标库" />
      <div className="animate-fade-rise px-5 pt-5">
        <p className="text-secondary leading-relaxed text-ink-tertiary">
          当前为占位图标（<span className="num">{assets.length}</span> 个）。资源以独立资产形式管理，
          后续将整体替换为统一风格的 AI 生成图标包，页面无需改动。
        </p>
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {ordered.map((asset) => (
            <div
              key={asset.id}
              className="overflow-hidden rounded-card border border-line bg-white p-2 shadow-card"
            >
              <img
                src={asset.path ?? '/icons/items/other.svg'}
                alt=""
                className="aspect-square w-full rounded-control bg-neutral-50 object-cover"
                draggable={false}
              />
              <p className="mt-2 truncate text-center text-caption text-ink-tertiary">
                {asset.id.replace('preset-', '')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
