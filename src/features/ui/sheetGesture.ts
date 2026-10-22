export interface SheetPoint { x: number; y: number; time: number }

/** 网页的手势调校值；不冒充原 App 的原生弹簧/手势参数。 */
export function sheetDragDirection(start: SheetPoint, point: SheetPoint): 'pending' | 'drag' | 'scroll' {
  const x = Math.abs(point.x - start.x), y = point.y - start.y
  if (Math.max(x, Math.abs(y)) < 8) return 'pending'
  return y > x * 1.2 ? 'drag' : 'scroll'
}

export function shouldDismissSheet(distance: number, height: number, velocity: number): boolean {
  return distance >= Math.min(160, height * 0.24) || (distance >= 48 && velocity >= 0.65)
}
