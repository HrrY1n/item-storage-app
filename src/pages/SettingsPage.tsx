import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useToast } from '../components/Toast'
import { APP_VERSION } from '../appInfo'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 px-5">
      <p className="mb-2 px-2 text-caption text-ink-tertiary">{title}</p>
      <div className="divide-y divide-black/[0.04] overflow-hidden rounded-2xl border border-black/[0.05] bg-white shadow-card">
        {children}
      </div>
    </section>
  )
}

function RowLayout({ label, hint }: { label: string; hint?: string }) {
  return (
    <>
      <span className="flex-1">
        <span className="block text-body text-ink-primary">{label}</span>
        {hint && <span className="mt-0.5 block text-caption text-ink-tertiary">{hint}</span>}
      </span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neutral-200">
        <path d="m9 6 6 6-6 6" />
      </svg>
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
      <RowLayout label={label} hint={hint} />
    </Link>
  )
}

/** 可用项（按钮） */
function RowButton({ label, hint, onClick }: { label: string; hint?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-neutral-50"
    >
      <RowLayout label={label} hint={hint} />
    </button>
  )
}

/** 未实现项：置灰 + 「即将支持」，不暴露开发阶段编号 */
function SoonRow({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex min-h-[52px] w-full items-center gap-3 px-4">
      <span className="flex-1">
        <span className="block text-body text-neutral-300">{label}</span>
        {hint && <span className="mt-0.5 block text-caption text-neutral-300">{hint}</span>}
      </span>
      <span className="shrink-0 text-caption text-neutral-300">即将支持</span>
    </div>
  )
}

export default function SettingsPage() {
  const { toast, show } = useToast()

  return (
    <div className="pt-[calc(16px+env(safe-area-inset-top))]">
      <div className="px-5">
        <h1 className="text-page-title text-ink-primary">设置</h1>
      </div>

      <Group title="数据管理">
        <SoonRow label="导出备份" hint="生成完整备份文件" />
        <SoonRow label="恢复备份" hint="从备份文件恢复全部数据" />
      </Group>

      <Group title="内容管理">
        <RowLink to="/settings/categories" label="分类管理" hint="新增、重命名、排序、移动分类" />
        <RowLink to="/settings/tags" label="标签管理" hint="重命名、删除、合并标签" />
        <RowLink to="/settings/icons" label="图标库" hint="浏览统一风格图标资产" />
      </Group>

      <Group title="应用">
        <SoonRow label="在 iPhone 上安装" hint="Safari 打开 → 共享 → 添加到主屏幕" />
        <RowButton
          label="关于"
          hint={`v${APP_VERSION} · 数据保存在本机`}
          onClick={() => show('私人数字物品库 · Local-first PWA')}
        />
      </Group>

      {toast}
    </div>
  )
}
