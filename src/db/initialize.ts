import { db } from './db'
import { APP_VERSION } from '../appInfo'
import { buildPresetAssets, seedIfEmpty, syncPresetAssets, upgradeSchemaVersionMeta } from './seed'
import { upgradeDefaultCategories } from './repositories/categoryRepository'
import { DEFAULT_CATEGORIES_VERSION } from '../data/categories'
import { CURRENT_SCHEMA_VERSION } from '../domain/types'

// 本机完成标记不在备份白名单内；恢复会清掉它，版本或图标元数据变化也会重新检查。
export const LOCAL_DATA_VERSION_KEY = 'localDataVersion'
const localDataVersion = JSON.stringify([
  APP_VERSION,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CATEGORIES_VERSION,
  buildPresetAssets('').map(({ id, path, mime, width, height }) => [id, path, mime, width, height]),
])

/** 已初始化的启动只读一条标记；首次安装和旧库仍完整执行原来的升级流程。 */
export async function initializeLocalData(): Promise<void> {
  const initialized = await db.appMeta.get(LOCAL_DATA_VERSION_KEY)
  if (initialized?.value === localDataVersion) return

  await seedIfEmpty()
  await upgradeSchemaVersionMeta()
  await upgradeDefaultCategories()
  await syncPresetAssets()
  // 只有全部成功才标记完成；事务失败后，下次启动仍会重试。
  await db.appMeta.put({ key: LOCAL_DATA_VERSION_KEY, value: localDataVersion })
}
