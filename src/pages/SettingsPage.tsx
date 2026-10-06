import { useRef, useState, type ChangeEvent } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ConfirmDialog, { AlertDialog } from '../components/Dialogs'
import SegmentedControl from '../components/SegmentedControl'
import { useTheme } from '../theme/ThemeProvider'
import { useToast } from '../components/Toast'
import { APP_VERSION } from '../appInfo'
import { PRESET_ICONS } from '../data/icons'
import {
  downloadBlob,
  exportBackup,
  readAndValidateBackup,
  restoreFromPayload,
} from '../services/backupService'
import { isStandalone } from '../services/pwa'
import { usePwaUpdate } from '../features/pwa/PwaUpdateContext'
import { useSync } from '../features/sync/SyncContext'
import { syncSummaryToMessage } from '../features/sync/syncPolicy'
import { syncRepository } from '../db/repositories/syncRepository'
import { createPairingCode, parsePairingCode, registerSecret } from '../services/syncService'
import type { BackupPayload, BackupSummary } from '../domain/backup'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="animate-fade-rise mt-7 px-5">
      <p className="mb-2.5 px-1 text-label text-ink-tertiary">{title}</p>
      <div className="divide-y divide-line-inner overflow-hidden rounded-surface border border-line bg-surface shadow-card">
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
      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-surface-sunken"
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
      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-surface-sunken disabled:opacity-50"
    >
      <RowLayout label={label} hint={hint} trailing={<Chevron />} />
    </button>
  )
}

function Chevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-tertiary">
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
  const { preference, resolved, setPreference } = useTheme()
  const { checkForUpdate } = usePwaUpdate()
  const { summary: syncSummary, syncNow, enabled: syncEnabled, conflicts } = useSync()
  const [checkingUpdate, setCheckingUpdate] = useState(false)

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

  /* ---------------- 跨设备同步（Phase 3B） ---------------- */
  const [syncing, setSyncing] = useState(false)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [busySync, setBusySync] = useState(false)

  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false

  const handleSyncNow = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await syncNow()
      show('同步完成')
    } catch {
      show('同步失败，请稍后重试')
    } finally {
      setSyncing(false)
    }
  }

  /** 生成配对码（A 设备）：不立即启用，等另一台接入 */
  const handleCreateCode = async () => {
    setBusySync(true)
    try {
      const { code, keyId, secret } = await createPairingCode()
      const ok = await registerSecret(secret, keyId)
      if (!ok) {
        show('无法连接服务器，请检查网络后重试')
        return
      }
      setPairingCode(code)
      show('配对码已生成，复制到另一台设备')
    } finally {
      setBusySync(false)
    }
  }

  /** 粘贴配对码（B 设备）：先校验，通过才落库并启用 */
  const handleUseCode = async () => {
    setBusySync(true)
    try {
      const payload = parsePairingCode(codeInput.trim())
      if (payload === null) {
        show('配对码格式不正确')
        return
      }
      const ok = await registerSecret(payload.secret, payload.keyId, payload.workerBaseUrl)
      if (!ok) {
        show('配对码无效，请重新生成')
        return
      }
      await syncRepository.initCredentials(payload.secret, payload.keyId)
      await syncRepository.enqueueAll()
      await syncRepository.setState({ enabled: true })
      setCodeInput('')
      setPairingCode(null)
      show('配对成功，正在首次同步')
      await syncNow()
    } finally {
      setBusySync(false)
    }
  }

  /** 关闭同步：清凭据但保留待推条目（用户数据一条不丢） */
  const handleDisableSync = async () => {
    await syncRepository.disable()
    show('已关闭同步，本地数据不受影响')
  }

  /** 手动检查更新：强制忽略节流；结果用 toast 反馈，不制造版本管理页面 */
  const handleCheckUpdate = async () => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      const result = await checkForUpdate()
      if (result === 'up-to-date') show('当前已是最新版本')
      else if (result === 'updating') show('发现新版本，正在更新')
      else if (result === 'pending-blocked') show('新版本已就绪，将在当前操作完成后更新')
      else show('当前离线，联网后会自动检查更新')
    } catch {
      show('检查更新失败，请稍后重试')
    } finally {
      setCheckingUpdate(false)
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

      {/* 外观：三态主题。默认「跟随系统」，跟随期间系统日夜切换会实时生效 */}
      <Group title="外观">
        <div className="px-4 py-4">
          <RowLayout
            label="外观模式"
            hint={
              preference === 'system'
                ? `跟随系统 · 当前为${resolved === 'dark' ? '深色' : '浅色'}`
                : preference === 'dark'
                  ? '始终使用深色'
                  : '始终使用浅色'
            }
          />
          <div className="mt-3">
            <SegmentedControl
              ariaLabel="外观模式"
              value={preference}
              onChange={setPreference}
              options={[
                { value: 'system', label: '跟随系统' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ]}
            />
          </div>
        </div>
      </Group>

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
        <RowLink to="/settings/icons" label="物品图标库" hint={`浏览全部内置图标（共 ${PRESET_ICONS.length} 个）`} />
      </Group>

      <Group title="跨设备同步">
        {syncSummary === null || syncSummary.kind === 'disabled' ? (
          <>
            <RowButton
              label="启用同步"
              hint="让 iPhone 与电脑共享同一份数据（可选）"
              onClick={() => void handleCreateCode()}
              disabled={busySync}
            />
            <p className="px-4 py-3 text-caption leading-relaxed text-ink-tertiary">
              同步是可选项：关闭时数据只保存在本机。启用后两台设备会互相同步；
              离线时一切照常可用，联网后自动追赶。
            </p>
          </>
        ) : syncSummary.kind === 'needs-setup' ? (
          <>
            <RowButton
              label="粘贴配对码"
              hint="从另一台已生成配对码的设备复制"
              onClick={() => void handleUseCode()}
              disabled={busySync || codeInput.trim() === ''}
            />
            <div className="px-4 py-3">
              <input
                type="text"
                value={codeInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCodeInput(e.target.value)}
                placeholder="粘贴配对码"
                className="field-shell w-full rounded-lg border border-line px-3 py-2 text-body"
              />
            </div>
          </>
        ) : (
          <>
            <RowButton
              label="立即同步"
              hint={syncSummaryToMessage(syncSummary, Date.now())}
              onClick={() => void handleSyncNow()}
              disabled={syncing || !online}
            />
            {pairingCode !== null && (
              <div className="px-4 py-3">
                <p className="mb-2 text-caption text-ink-tertiary">
                  把这段配对码复制到另一台设备，它粘贴后即可接入。
                </p>
                <p className="break-all rounded-lg bg-sunken px-3 py-2 text-caption text-ink-secondary">
                  {pairingCode}
                </p>
              </div>
            )}
            {syncEnabled && (
              <RowButton label="关闭同步" hint="清理解锁凭据，本地数据与待同步改动都保留" onClick={() => void handleDisableSync()} />
            )}
          </>
        )}
      </Group>

      {conflicts.length > 0 && (
        <Group title="最近的覆盖记录">
          {conflicts.map((c) => (
            <div key={c.id} className="px-4 py-3">
              <p className="text-caption text-ink-tertiary">
                {c.entity === 'item' ? '物品' : c.entity === 'category' ? '分类' : '标签'}
                ：{c.loserSummary ?? c.entityId}
              </p>
              <p className="mt-0.5 text-caption text-ink-tertiary">
                已被另一台设备的修改覆盖（{c.winnerSummary ?? '—'}）
              </p>
            </div>
          ))}
        </Group>
      )}

      <Group title="应用">
        <RowButton
          label="在 iPhone 上安装"
          hint={standalone ? '已从主屏幕运行' : '添加到主屏幕后可全屏使用'}
          onClick={() => setIosOpen(true)}
        />
        <RowButton
          label="检查更新"
          hint={checkingUpdate ? '正在检查…' : '主动检查是否有新版本'}
          disabled={checkingUpdate || busy !== null}
          onClick={() => void handleCheckUpdate()}
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
