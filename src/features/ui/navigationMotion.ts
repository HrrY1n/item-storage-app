const tabs = ['/', '/items', '/categories', '/search', '/settings']

export function tabMotionDirection(from: string, to: string): 'forward' | 'back' | 'none' {
  const previous = tabs.indexOf(from), next = tabs.indexOf(to)
  if (previous < 0 || next < 0 || previous === next) return 'none'
  return next > previous ? 'forward' : 'back'
}
