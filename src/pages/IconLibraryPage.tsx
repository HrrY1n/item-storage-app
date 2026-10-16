import { PRESET_ICONS } from '../data/icons'
import { loadRecentIcons } from '../features/ui/recentIcons'
import PageHeader from '../components/PageHeader'
import IconBrowser from '../components/IconBrowser'

export default function IconLibraryPage() {
  return (
    <div>
      <PageHeader title="物品图标库" />
      <p className="px-5 pb-4 pt-5 text-secondary leading-relaxed text-ink-tertiary">
        共 <span className="num text-ink-primary">{PRESET_ICONS.length}</span> 个内置图标。
        在物品表单中点击图标，即可从这里挑选。
      </p>
      <div className="flex h-[calc(100dvh-260px)] min-h-[380px] flex-col sm:h-[calc(100dvh-310px)]">
        <IconBrowser recent={loadRecentIcons()} />
      </div>
    </div>
  )
}
