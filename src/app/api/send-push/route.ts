import { NextResponse } from 'next/server'
import webpush from 'web-push'

// Configura VAPID keys
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@ifpe.edu.br',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
  process.env.VAPID_PRIVATE_KEY as string
)

export async function POST(request: Request) {
  try {
    const { subscription, title, body } = await request.json()

    if (!subscription || !title || !body) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const payload = JSON.stringify({
      title,
      body
    })

    await webpush.sendNotification(subscription, payload)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao enviar push:', error)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
