import { useEffect, useState } from 'react'

export function useConnectivity() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [cached, setCached] = useState(false)

  useEffect(() => {
    const onConnectivity = () => setOnline(navigator.onLine)
    window.addEventListener('online', onConnectivity)
    window.addEventListener('offline', onConnectivity)
    const worker = import.meta.env.PROD ? navigator.serviceWorker : undefined
    const onController = () => setCached(Boolean(worker?.controller))
    if (worker) {
      worker.addEventListener('controllerchange', onController)
      onController()
      void worker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch(() => {})
    }
    return () => {
      window.removeEventListener('online', onConnectivity)
      window.removeEventListener('offline', onConnectivity)
      worker?.removeEventListener('controllerchange', onController)
    }
  }, [])

  return { online, cached }
}
