import costCollapse from './cost-disclosure-collapse.mjs'
import themeLight from './theme-switch-light.mjs'
import iconSelect from './icon-picker-select.mjs'
// 场景注册表：新增场景在此登记。

import itemDetailOpen from './item-detail-open.mjs'
import itemDetailClose from './item-detail-close.mjs'
import costDisclosure from './cost-disclosure.mjs'
import bottomNavSwitch from './bottom-nav-switch.mjs'
import iconPickerOpen from './icon-picker-open.mjs'
import iconPickerClose from './icon-picker-close.mjs'
import themeSwitch from './theme-switch.mjs'
import reducedMotionDetailOpen from './reduced-motion-detail-open.mjs'
import itemDetailOpenSmall from './item-detail-open-small.mjs'
import panelSwipeDismiss from './panel-swipe-dismiss.mjs'
import bottomNavRapidSwitch from './bottom-nav-rapid-switch.mjs'

export const scenarios = [
  itemDetailOpen,
  itemDetailClose,
  costDisclosure,
  bottomNavSwitch,
  iconPickerOpen,
  iconPickerClose,
  themeSwitch,
  reducedMotionDetailOpen,
  itemDetailOpenSmall,
  panelSwipeDismiss,
  bottomNavRapidSwitch,
  costCollapse, themeLight, iconSelect,
]

export function findScenarios(ids) {
  if (!ids || ids.includes('all')) return scenarios
  const found = []
  for (const id of ids) {
    const scenario = scenarios.find(entry => entry.id === id)
    if (!scenario) throw new Error(`未知场景：${id}（可用：${scenarios.map(entry => entry.id).join(', ')}）`)
    found.push(scenario)
  }
  return found
}
