/**
 * 开发环境演示数据（保留自 Phase 2A 的 mock 内容）。
 *
 * ⚠️ 仅开发使用：在浏览器控制台执行 `await window.__loadDemoData()` 才会写入。
 *    生产环境不会自动创建任何演示物品；真实用户首次打开时物品数为 0。
 */
import { ulid } from 'ulid'
import { db } from '../db/db'
import { categoryRepository } from '../db/repositories/categoryRepository'
import { tagRepository } from '../db/repositories/tagRepository'
import type { Category, PurchasePlatform } from '../domain/types'

interface DemoEntry {
  name: string
  category: string
  iconKey: string
  tags: string[]
  note: string
  /** 购买信息（元 / 日期字符串），用于让演示数据覆盖成本指标与概览 */
  price?: number
  extra?: number
  boughtAt?: string
  platform?: PurchasePlatform
}

const DEMO: DemoEntry[] = [
  { name: 'MacBook Pro 14', category: '电脑设备', iconKey: 'laptop', tags: ['Apple', '常用', '贵重'], note: 'M3 Pro，日常工作主力机。', price: 14999, boughtAt: '2023-11-05', platform: 'jd' },
  { name: 'AirPods Pro 2', category: '音频设备', iconKey: 'earbuds', tags: ['Apple', '常用', '白色'], note: '通勤降噪用，充电盒挂绳已换。', price: 1899, extra: 199, boughtAt: '2024-03-12', platform: 'jd' },
  { name: 'iPhone 15 Pro', category: '手机与平板', iconKey: 'phone', tags: ['Apple', '常用'], note: '原色钛金属，256G。', price: 8999, boughtAt: '2023-10-20', platform: 'jd' },
  { name: 'iPad Air 11', category: '手机与平板', iconKey: 'tablet', tags: ['Apple', '阅读'], note: '看 PDF 和画草图，配了妙控键盘。', price: 4799, extra: 899, boughtAt: '2024-08-02', platform: 'taobao' },
  { name: '黑色连帽卫衣', category: '上衣', iconKey: 'tshirt', tags: ['黑色', '冬季', '常用'], note: '优衣库 U 系列，L 码。', price: 399, boughtAt: '2024-11-02', platform: 'taobao' },
  { name: 'Bellroy 双肩包', category: '包袋', iconKey: 'backpack', tags: ['出差', '贵重'], note: '20L，通勤和短途出差都能用。', price: 1290, boughtAt: '2023-06-18', platform: 'taobao' },
  { name: 'Sony WH-1000XM5', category: '音频设备', iconKey: 'headphones', tags: ['索尼', '黑色', '贵重'], note: '头戴降噪，长途飞行用。', price: 2799, extra: 299, boughtAt: '2024-01-08', platform: 'jd' },
  { name: 'Keychron K2 键盘', category: '电脑设备', iconKey: 'keyboard', tags: ['常用', '黑色'], note: '茶轴，蓝牙双模。', price: 599, extra: 129, boughtAt: '2022-09-14', platform: 'taobao' },
  { name: '《人类简史》', category: '书籍', iconKey: 'book', tags: ['纸质', '闲置'], note: '尤瓦尔·赫拉利，读完一遍。', price: 68, boughtAt: '2021-05-03', platform: 'other' },
  { name: '象印保温杯', category: '生活用品', iconKey: 'thermos', tags: ['常用', '白色'], note: '480ml，保温一整天。', price: 269, boughtAt: '2023-12-24', platform: 'pinduoduo' },
  { name: 'New Balance 990v6', category: '鞋履', iconKey: 'sneakers', tags: ['常用'], note: '灰色，日常走路最舒服的一双。', price: 1499, boughtAt: '2023-03-09', platform: 'jd' },
  { name: '尼康 Z fc', category: '数码与电子', iconKey: 'camera', tags: ['摄影', '贵重'], note: '复古造型，配 28mm 定焦。', price: 6299, boughtAt: '2024-05-16', platform: 'zhuanzhuan' },
]

/** 写入演示数据；返回写入数量。重复调用会重复创建，仅用于开发调试。 */
export async function loadDemoData(): Promise<number> {
  const categories = await categoryRepository.listActive()
  const byName = new Map<string, Category>(categories.map((c) => [c.name, c]))
  const now = Date.now()
  let count = 0

  for (const [i, demo] of DEMO.entries()) {
    const category = byName.get(demo.category)
    if (!category) continue
    const tagIds: string[] = []
    for (const t of demo.tags) {
      const tag = await tagRepository.getOrCreate(t)
      tagIds.push(tag.id)
    }
    // 时间错开，保证「最近添加」有顺序
    const createdAt = new Date(now - (DEMO.length - i) * 60_000).toISOString()
    const itemId = ulid()
    await db.transaction('rw', [db.items, db.itemTags], async () => {
      await db.items.add({
        id: itemId,
        name: demo.name,
        categoryId: category.id,
        note: demo.note,
        iconAssetId: `preset-${demo.iconKey}`,
        sourceType: 'preset',
        purchaseDate: demo.boughtAt ?? null,
        purchasePriceCents: demo.price !== undefined ? Math.round(demo.price * 100) : null,
        additionalCostCents: demo.extra !== undefined ? Math.round(demo.extra * 100) : null,
        purchasePlatform: demo.platform ?? null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      })
      if (tagIds.length > 0) {
        await db.itemTags.bulkAdd(tagIds.map((tagId) => ({ itemId, tagId })))
      }
    })
    count++
  }
  return count
}
