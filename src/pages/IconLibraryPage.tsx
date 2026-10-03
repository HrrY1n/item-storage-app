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
      <div className="px-5 pt-4">
        <p className="text-caption leading-relaxed text-ink-tertiary">
          当前为占位图标（{assets.length} 个）。资源以独立资产形式管理，
          后续将整体替换为统一风格的 AI 生成图标包，页面无需改动。
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {ordered.map((asset) => (
            <div
              key={asset.id}
              className="overflow-hidden rounded-2xl border border-black/[0.05] bg-white p-2 shadow-card"
            >
              <img
                src={asset.path ?? '/icons/items/other.svg'}
                alt=""
                className="aspect-square w-full rounded-xl object-cover"
                draggable={false}
              />
              <p className="mt-1.5 truncate text-center text-caption text-ink-tertiary">
                {asset.id.replace('preset-', '')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
