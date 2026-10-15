import { describe, expect, it } from 'vitest'
import { getIconPath } from '../../data/icons'
import { buildPresetAssets } from '../seed'
import { assetRepository } from './assetRepository'

const phone = buildPresetAssets('2026-10-15T00:00:00.000Z').find((asset) => asset.id === 'preset-phone')!

describe('assetRepository.iconUrl', () => {
  it('旧备份中的已知 preset 路径跟随当前图标资源', () => {
    expect(assetRepository.iconUrl({ ...phone, path: '/icons/items/obsolete-phone.svg' })).toBe(getIconPath('phone'))
  })

  it('未收录的历史 preset 继续使用原有路径', () => {
    expect(assetRepository.iconUrl({ ...phone, id: 'preset-removed', path: '/icons/items/removed.svg' })).toBe('/icons/items/removed.svg')
  })

  it('用户资产的路径不被同名 preset 覆盖', () => {
    expect(assetRepository.iconUrl({ ...phone, kind: 'from_photo', path: '/assets/my-phone.png' })).toBe('/assets/my-phone.png')
  })

  it('缺失资产回落到当前通用图标', () => {
    expect(assetRepository.iconUrl(undefined)).toBe(getIconPath('other'))
  })
})
