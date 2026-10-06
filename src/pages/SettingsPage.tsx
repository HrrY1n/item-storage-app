import { useEffect, useRef, useState, type ChangeEvent } from 'react'
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
import {
  commitJoin,
  createSyncSpace,
  currentPairingCode,
  hasSyncSpace,
  parsePairingCode,
  validateJoinPairingCode,
} from '../services/syncService'
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

  /* ---------------- 云端同步（Phase 3B / 3B.1） ---------------- */
  const [syncing, setSyncing] = useState(false)
  const [busySync, setBusySync] = useState(false)
  /**
   * 恢复码：**从本地凭据重建**，不是一次性 toast。
   * 刷新 / PWA 重启后仍能重新取到（最终审查第 3 条）。
   *
   * ⭐ Phase 3B.1 的产品定位变化：真实使用是"只有一台主力手机"，
   *   所以这个词的主要用途不是"给第二台设备配对"，而是
   *   **换手机 / Safari 清了网站数据之后，用它重新连回云端数据**。
   *   协议格式一点没变（仍是 keyId + secret），只是含义说清楚。
   */
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  /** 恢复码是否展开显示（默认收起 —— 它等同于凭据，不该一直摊在屏幕上） */
  const [recoveryVisible, setRecoveryVisible] = useState(false)
  /** 刚创建完同步空间 → 强制展示一次恢复码并给出保存提醒 */
  const [justCreatedRecovery, setJustCreatedRecovery] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  /** 加入时的抉择：云端已有数据 */
  const [joinConflict, setJoinConflict] = useState<number | null>(null)
  const [pendingJoin, setPendingJoin] = useState<{ secret: string; keyId: string } | null>(null)

  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false

  // ⭐ 页面挂载 / 刷新后：从本地已有凭据重建配对码（不发网络请求、不调 bootstrap）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const exists = await hasSyncSpace()
      if (cancelled) return
      setPairingCode(exists ? await currentPairingCode() : null)
    })()
    return () => {
      cancelled = true
    }
  }, [])


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

  /**
   * 入口 A：创建新的同步空间（会立即启用并上传本机数据）。
   *
   * ⭐ 创建成功后**必须让用户看到并保存恢复码** ——
   *   手机丢失 / PWA 数据被清 / Safari 清了网站数据之后，
   *   本机 syncState 里的 secret 会一起消失。没有恢复码，
   *   即使 D1 里的数据还在，也认证不回原来的同步空间。
   */
  const handleCreateSpace = async () => {
    setBusySync(true)
    try {
      await createSyncSpace()
      // 恢复码从本地凭据重建（不依赖 useState，刷新后也能取到）
      const code = await currentPairingCode()
      setPairingCode(code)
      setJustCreatedRecovery(true)
      setRecoveryVisible(true)
      show('同步已开启，请保存恢复码')
      await syncNow()
    } catch {
      show('创建失败，请检查网络后重试')
    } finally {
      setBusySync(false)
    }
  }

  /**
   * 入口 B 步骤 1：粘贴配对码并**只做校验**。
   * ⭐ 此刻不写任何本地凭据、不启用同步 —— 用户还没决定数据方向，
   *   若这里就同步，会把本机数据推上去污染未确认的状态。
   */
  const handleJoin = async () => {
    setBusySync(true)
    try {
      const payload = parsePairingCode(codeInput.trim())
      if (payload === null) {
        show('恢复码格式不正确')
        return
      }
      const result = await validateJoinPairingCode(payload)
      if (!result.ok) {
        show(result.reason === 'offline' ? '当前离线，请联网后重试' : '恢复码无效，请确认后重新粘贴')
        return
      }
      // 校验通过 → 暂存待确认的方向（仍未启用同步）
      setPendingJoin({ secret: payload.secret, keyId: payload.keyId })
      setCodeInput('')
      if (result.recordCount > 0) {
        setJoinConflict(result.recordCount)
      } else {
        setJoinConflict(0)
      }
    } finally {
      setBusySync(false)
    }
  }

  /**
   * 入口 B 步骤 2a：**用云端数据恢复此设备**（换手机的主路径）。
   *
   * 清空本地业务数据后从云端完整拉取。真实场景主要是"新手机 / 数据被清后
   * 重新连回既有云端数据"，因此这是**推荐项**，UI 上也排在首位。
   */
  const handleJoinUseCloud = async () => {
    if (pendingJoin === null) return
    setBusySync(true)
    try {
      await commitJoin({ v: 1, secret: pendingJoin.secret, keyId: pendingJoin.keyId }, 'cloud')
      setJoinConflict(null)
      setPendingJoin(null)
      setRecoveryVisible(false)
      setJustCreatedRecovery(false)
      show('已用云端数据恢复此设备')
      await syncNow()
    } finally {
      setBusySync(false)
    }
  }

  /** 入口 B 步骤 2b：用户选择「以本机为准」→ 本地全量推上云 */
  const handleJoinUseLocal = async () => {
    if (pendingJoin === null) return
    setBusySync(true)
    try {
      await commitJoin({ v: 1, secret: pendingJoin.secret, keyId: pendingJoin.keyId }, 'local')
      setJoinConflict(null)
      setPendingJoin(null)
      show('已启用同步，数据将以本机为准')
      await syncNow()
    } finally {
      setBusySync(false)
    }
  }

  /** 关闭同步：清凭据但保留待推条目（用户数据一条不丢） */
  const handleDisableSync = async () => {
    await syncRepository.disable()
    setPairingCode(null)
    setJoinConflict(null)
    setPendingJoin(null)
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

      {/*──────── 云端同步（Phase 3B / 3B.1）────────*/}
      <Group title="云端同步">
        {syncSummary === null || syncSummary.kind === 'disabled' ? (
          <>
            <div className="px-4 pb-3 pt-3 text-caption leading-relaxed text-ink-tertiary">
              数据始终首先保存在本机。开启后，联网时会自动同步到你的私人云端，
              用于换机恢复，也可以连接其他设备。
            </div>
            <RowButton
              label="开启云端同步"
              hint="在本机开启同步，并生成恢复码"
              onClick={() => void handleCreateSpace()}
              disabled={busySync || !online}
            />
            <div className="px-4 py-3">
              <p className="mb-2 text-caption text-ink-tertiary">
                换过手机，或在别的设备上开启过？在这里粘贴当时的恢复码。
              </p>
              <div className="field-shell flex gap-2 rounded-lg border border-line px-3 py-2 focus-within:border-accent">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCodeInput(e.target.value)}
                  placeholder="粘贴恢复码"
                  className="min-w-0 flex-1 bg-transparent text-body outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleJoin()}
                  disabled={busySync || codeInput.trim() === ''}
                  className="shrink-0 rounded-md px-2 py-1 text-body text-accent disabled:opacity-40"
                >
                  连接
                </button>
              </div>
            </div>
            <p className="px-4 pb-3 text-caption leading-relaxed text-ink-tertiary">
              同步是可选项：关闭时数据只保存在本机。离线时一切照常可用，联网后自动追赶。
            </p>
          </>
        ) : (
          <>
            <RowButton
              label="立即同步"
              hint={syncSummaryToMessage(syncSummary, Date.now())}
              onClick={() => void handleSyncNow()}
              disabled={syncing || !online}
            />

            {/* 恢复码：默认收起，按需展开。它**等同于同步凭据**，不该一直摊在屏幕上。
                值由本地凭据重建，刷新 / 重启后照样能取到（不是一次性提示）。 */}
            {!recoveryVisible ? (
              <RowButton
                label="查看恢复码"
                hint="换机或本机数据丢失后，用它重新连接云端"
                onClick={() => {
                  void (async () => {
                    const code = await currentPairingCode()
                    if (code === null) {
                      show('尚未创建同步空间')
                      return
                    }
                    setPairingCode(code)
                    setRecoveryVisible(true)
                  })()
                }}
                disabled={busySync}
              />
            ) : (
              <div className="px-4 py-3">
                <p className="mb-2 text-caption text-ink-tertiary">
                  换手机、或本机数据被清除后，用这段恢复码重新连接云端数据。
                </p>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 break-all rounded-lg bg-sunken px-3 py-2 text-caption text-ink-secondary">
                    {pairingCode}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (pairingCode === null) return
                      void navigator.clipboard?.writeText(pairingCode)
                      show('恢复码已复制')
                    }}
                    className="shrink-0 rounded-md px-2 py-1 text-body text-accent"
                  >
                    复制
                  </button>
                </div>

                {/* ⭐ 明确警告：恢复码 = 同步凭据 */}
                <p className="mt-2 text-caption leading-relaxed text-danger">
                  {justCreatedRecovery
                    ? '请立刻保存恢复码。更换手机或本机数据丢失后，需要它才能重新连接云端数据。'
                    : '恢复码等同于同步凭据，不要公开分享，也不要发给他人。'}
                </p>

                {justCreatedRecovery && (
                  <button
                    type="button"
                    onClick={() => setJustCreatedRecovery(false)}
                    className="mt-2 rounded-md px-2 py-1 text-body text-accent"
                  >
                    我已保存恢复码
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryVisible(false)
                    setJustCreatedRecovery(false)
                  }}
                  className="mt-1 rounded-md px-2 py-1 text-caption text-ink-tertiary"
                >
                  收起
                </button>
              </div>
            )}

            {syncEnabled && (
              <RowButton
                label="关闭同步"
                hint="清理解锁凭据，本地数据与待同步改动都保留"
                onClick={() => void handleDisableSync()}
              />
            )}
          </>
        )}
      </Group>

      {/* 加入时云端已有数据 → 显式二选一，绝不自动合并 */}
      {joinConflict !== null && pendingJoin !== null && (
        <ConfirmDialog
          open
          title={joinConflict > 0 ? '云端已有数据' : '如何同步数据？'}
          message={
            joinConflict > 0
              ? `云端已有 ${joinConflict} 条记录。\n\n「使用云端数据恢复此设备」会**清空本机**的物品/分类/标签，再从云端完整下载 —— 适合换手机或本机数据丢失后恢复。若本机有未备份的改动，请先导出 ZIP 备份。\n\n「以本机数据为准」会把本机数据全量上传；云端独有的记录会保留。`
              : '「使用云端数据恢复此设备」会清空本机的物品/分类/标签，再从云端完整下载（云端目前为空，因此本机数据会被清掉）。\n「以本机数据为准」会把本机数据全量上传。'
          }
          confirmLabel="使用云端数据恢复此设备"
          cancelLabel="以本机数据为准"
          onConfirm={() => void handleJoinUseCloud()}
          onCancel={() => void handleJoinUseLocal()}
        />
      )}

      {conflicts.length > 0 && (
        <Group title="最近的覆盖记录">
          {conflicts.map((c) => (
            <div key={c.id} className="px-4 py-3">
              <p className="text-caption text-ink-secondary">
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
