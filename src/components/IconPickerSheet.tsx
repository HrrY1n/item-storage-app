import { useEffect, useState } from 'react'
import { loadRecentIcons, persistRecentIcons, pushRecentIcon } from '../features/ui/recentIcons'
import IconBrowser from './IconBrowser'
import ModalSheet from './ModalSheet'

interface Props {
  open: boolean
  value: string
  onSelect: (assetId: string) => void
  onClose: () => void
}

export default function IconPickerSheet({ open, value, onSelect, onClose }: Props) {
  const [recent, setRecent] = useState<string[]>(() => loadRecentIcons())
  useEffect(() => {
    if (!open) return
    setRecent(loadRecentIcons())
  }, [open])

  const handlePick = (assetId: string) => {
    const next = pushRecentIcon(assetId, recent)
    setRecent(next)
    persistRecentIcons(next)
    onSelect(assetId)
    onClose()
  }

  return (
    <ModalSheet open={open} label="选择物品图标" variant="picker" onClose={onClose}>
        <header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-3 sm:pt-5">
          <h2 className="text-section text-ink-primary">选择图标</h2>
          <button data-modal-autofocus type="button" onClick={onClose} aria-label="关闭" className="-mr-1.5 flex h-10 w-10 items-center justify-center rounded-pill text-ink-tertiary transition-colors active:bg-surface-sunken sm:hover:text-ink-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <IconBrowser value={value} recent={recent} onPick={handlePick} />
    </ModalSheet>
  )
}
