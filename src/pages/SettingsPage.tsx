import { useRef, useState, type ChangeEvent } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ConfirmDialog, { AlertDialog } from '../components/Dialogs'
import { useToast } from '../components/Toast'
import { APP_VERSION } from '../appInfo'
import {
  downloadBlob,
  exportBackup,
  readAndValidateBackup,
  restoreFromPayload,
} from '../services/backupService'
import { isStandalone } from '../services/pwa'
import type { BackupPayload, BackupSummary } from '../domain/backup'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="animate-fade-rise mt-7 px-5">
      <p className="mb-2.5 px-1 text-label text-ink-tertiary">{title}</p>
      <div className="divide-y divide-line-inner overflow-hidden rounded-surface border border-line bg-white shadow-card">
        {children}
      </div>
    </section>
  )
}

function RowLayout({ label, hint, trailing }: { label: string; hint?: string; trailing?: ReactNode }) {
  return (
    <>
      <span className="flex-1">
        <span className="block text-body text-ink-primary">{label}</span>
        {hint && <span className="mt-0.5 block text-caption text-ink-tertiary">{hint}</span>}
      </span>
      {trailing}
    </>
  )
}

/** 可用项（链接） */
function RowLink({ to, label, hint }: { to: string; label: string; hint?: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-neutral-50"
    >
      <RowLayout
        label={label}
        hint={hint}
        trailing={<Chevron />}
      />
    </Link>
  )
}

/** 可用项（按钮） */
function RowButton({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string
  hint?: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-neutral-50 disabled:opacity-50"
    >
      <RowLayout label={label} hint={hint} trailing={<Chevron />} />
    </button>
  )
}

function Chevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neutral-200">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

const IOS_INSTALL_STEPS = `1. 使用 Safari 打开本页面
2. 点击底部「分享」按钮
3. 向下滚动，选择「添加到主屏幕」`

function formatExportedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

export default function SettingsPage() {
  const { toast, show } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState<'export' | 'restore' | null>(null)
  const [pending, setPending] = useState<{ summary: BackupSummary; payload: BackupPayload } | null>(
    null,
  )
  const [iosOpen, setIosOpen] = useState(false)

  const standalone = isStandalone()

  async function handleExport() {
    if (busy) return
    setBusy('export')
    try {
      const { blob, fileName, summary } = await exportBackup()
      downloadBlob(blob, fileName)
      show(`已导出 ${summary.itemCount} 件物品的备份`)
    } catch {
      show('导出失败，请重试')
    } finally {
      setBusy(null)
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 重置 input，允许连续选择同一个文件重试
    e.target.value = ''
    if (!file) return

    setBusy('restore')
    try {
      const result = await readAndValidateBackup(file)
      if (!result.ok) {
        show(result.error)
        return
      }
      // 只到"摘要 + 等待确认"这一步，尚未触碰数据库
      setPending({ summary: result.summary, payload: result.payload })
    } catch {
      show('无法读取该文件')
    } finally {
      setBusy(null)
    }
  }

  async function handleConfirmRestore() {
    if (!pending) return
    setBusy('restore')
    try {
      await restoreFromPayload(pending.payload)
      setPending(null)
      show('已从备份恢复全部数据')
    } catch {
      setPending(null)
      show('恢复失败，当前数据未被改动')
    } finally {
      setBusy(null)
    }
  }

  const restoreSummary = pending
    ? `备份时间：${formatExportedAt(pending.summary.exportedAt)}\n物品 ${pending.summary.itemCount} · 分类 ${pending.summary.categoryCount} · 标签 ${pending.summary.tagCount} · 资产 ${pending.summary.assetCount}`
    : ''

  return (
    <div className="pt-[calc(16px+env(safe-area-inset-top))]">
      <div className="px-5">
        <h1 className="text-page-title text-ink-primary">设置</h1>
      </div>

      <Group title="数据管理">
        <RowButton
          label="导出备份"
          hint={busy === 'export' ? '正在生成…' : '生成完整备份文件（ZIP）'}
          disabled={busy !== null}
          onClick={handleExport}
        />
        <RowButton
          label="恢复备份"
          hint={busy === 'restore' ? '正在解析…' : '从备份文件替换当前全部数据'}
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
        />
      </Group>

      <Group title="内容管理">
        <RowLink to="/settings/categories" label="分类管理" hint="新增、重命名、排序、移动分类" />
        <RowLink to="/settings/tags" label="标签管理" hint="重命名、删除、合并标签" />
        <RowLink to="/settings/icons" label="图标库" hint="浏览统一风格图标资产" />
      </Group>

      <Group title="应用">
        <RowButton
          label="在 iPhone 上安装"
          hint={standalone ? '已从主屏幕运行' : '添加到主屏幕后可全屏使用'}
          onClick={() => setIosOpen(true)}
        />
        <RowButton
          label="关于"
          hint={`v${APP_VERSION} · 数据保存在当前设备浏览器中`}
          onClick={() =>
            show('私人数字物品库 · 数据保存在本机，请定期导出备份')
          }
        />
      </Group>

      {/* 脚注：以一条 hairline 与内容区分开，保持安静但可读 */}
      <div className="mt-8 px-5">
        <div className="border-t border-line-inner pt-4">
          <p className="text-caption leading-relaxed text-ink-tertiary">
            数据保存在当前设备的浏览器存储中，清理浏览器数据或更换设备会导致丢失。
            定期使用「导出备份」是保护数据的可靠方式。
          </p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/zip,.zip"
        className="hidden"
        onChange={handleFileChange}
      />

      <ConfirmDialog
        open={pending !== null}
        title="恢复后将替换当前数据"
        message={restoreSummary}
        confirmLabel="恢复"
        cancelLabel="取消"
        danger
        onConfirm={handleConfirmRestore}
        onCancel={() => setPending(null)}
      />

      <AlertDialog
        open={iosOpen}
        title={standalone ? '已从主屏幕运行' : '在 iPhone 上安装'}
        message={standalone ? '当前已通过主屏幕图标启动。' : IOS_INSTALL_STEPS}
        onClose={() => setIosOpen(false)}
      />

      {toast}
    </div>
  )
}
