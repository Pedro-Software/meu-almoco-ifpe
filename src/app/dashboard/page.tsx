'use client'

import { useEffect, useState } from 'react'
import { useRealtimeQueue } from '@/hooks/useRealtimeQueue'
import { createClient } from '@/lib/supabase/client'
import { TicketButton } from '@/components/TicketButton'
import { QueuePanel } from '@/components/QueuePanel'
import { QRCodeDisplay } from '@/components/QRCodeDisplay'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [userName, setUserName] = useState<string>('')
  const [ticket, setTicket] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const { queueInfo, loading: queueLoading } = useRealtimeQueue()
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      setUserName(user.user_metadata?.full_name?.split(' ')[0] || 'Aluno')

      // Verificar se já tem ficha hoje
      const { data, error } = await supabase.rpc('get_my_ticket')
      if (!error && data?.has_ticket) {
        setTicket(data.ticket)
      }
      setLoading(false)
    }
    loadData()
  }, [supabase, router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading || queueLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-[#00913f] text-white p-6 rounded-b-3xl shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Meu Almoço IFPE</h1>
          <button onClick={handleLogout} className="p-2 hover:bg-green-700 rounded-full transition-colors">
            <LogOut size={24} />
          </button>
        </div>
        <p className="text-xl font-medium">Bom almoço, {userName}!</p>
      </header>

      <main className="max-w-md mx-auto mt-6 px-4 space-y-6">
        <QueuePanel 
          queueInfo={queueInfo} 
          userQueueNumber={ticket?.queue_number} 
        />

        {!ticket ? (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Sua Ficha</h2>
            <TicketButton onTicketIssued={(newTicket) => setTicket(newTicket)} />
          </div>
        ) : ticket.status === 'waiting' ? (
          <QRCodeDisplay 
            qrToken={ticket.qr_token} 
            queueNumber={ticket.queue_number} 
          />
        ) : (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Bom Apetite!</h2>
            <p className="text-gray-600">Sua ficha já foi utilizada hoje.</p>
          </div>
        )}
      </main>
    </div>
  )
}
