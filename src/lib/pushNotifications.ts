import { createClient } from '@/lib/supabase/client'

// Converte a VAPID key para Uint8Array
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function registerServiceWorkerAndSubscribe() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications not supported by browser.')
    return null
  }

  try {
    // 1. Registra o Service Worker
    const registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    // 2. Pede permissão se não tiver
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return null
    }

    if (Notification.permission === 'denied') {
      return null
    }

    // 3. Verifica se já está inscrito
    let subscription = await registration.pushManager.getSubscription()

    // 4. Se não estiver, inscreve
    if (!subscription) {
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        console.error('VAPID public key not found')
        return null
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      })
    }

    // 5. Salva a subscription no banco via RPC
    const supabase = createClient()
    const { error } = await supabase.rpc('save_push_subscription', {
      p_subscription: JSON.parse(JSON.stringify(subscription))
    })

    if (error) {
      console.error('Erro ao salvar push subscription no banco:', error)
      return null
    }

    return subscription
  } catch (error) {
    console.error('Erro ao registrar push notification:', error)
    return null
  }
}
