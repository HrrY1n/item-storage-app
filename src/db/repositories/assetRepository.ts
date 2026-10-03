import { db } from '../db'
import type { Asset } from '../../domain/types'

/**
 * Asset repository —— 图标/照片资产。
 * 当前阶段只有 preset 资产（随应用打包，seed 时写入元数据）。
 */
export const assetRepository = {
  async listPresets(): Promise<Asset[]> {
    return db.assets.where('kind').equals('preset').toArray()
  },

  async getById(id: string): Promise<Asset | undefined> {
    return db.assets.get(id)
  },

  /** 解析资产的展示 URL：preset 用包内路径，其他来源用 Blob objectURL */
  iconUrl(asset: Asset | undefined): string {
    if (!asset) return '/icons/items/other.svg'
    if (asset.path) return asset.path
    if (asset.blob) return URL.createObjectURL(asset.blob)
    return '/icons/items/other.svg'
  },
}
