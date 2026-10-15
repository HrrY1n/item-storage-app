/** update() 只发起更新；必须等安装和激活结束，才可报告检查完成。 */
export async function checkServiceWorkerUpdate(
  registration: ServiceWorkerRegistration | undefined,
): Promise<void> {
  if (!registration) throw new Error('Service Worker is not registered')
  const previous = registration.installing ?? registration.waiting
  await registration.update()
  const worker = registration.installing ?? registration.waiting ?? previous
  if (!worker) return

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      worker.removeEventListener('statechange', onStateChange)
      if (error) reject(error)
      else resolve()
    }
    const onStateChange = () => {
      if (worker.state === 'activated') finish()
      else if (worker.state === 'redundant') finish(new Error('Service Worker installation failed'))
    }
    const timer = setTimeout(() => finish(new Error('Service Worker installation timed out')), 120_000)
    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
}
