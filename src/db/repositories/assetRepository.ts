import { db } from '../db'
import type { Asset } from '../../domain/types'
import { getIconPath, presetIconOfAssetId } from '../../data/icons'

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
    if (!asset) return getIconPath('other')
    // 旧备份可能带旧版资源路径；已知 preset 始终跟随当前图标注册表。
    if (asset.kind === 'preset') {
      const preset = presetIconOfAssetId(asset.id)
      if (preset) return preset.path
    }
    if (asset.path) return asset.path
    if (asset.blob) return URL.createObjectURL(asset.blob)
    return getIconPath('other')
  },
}
