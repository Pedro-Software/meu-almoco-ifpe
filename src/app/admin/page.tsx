'use client'

import { useEffect, useState, useRef } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { useRealtimeQueue } from '@/hooks/useRealtimeQueue'
import { createClient } from '@/lib/supabase/client'
import { ValidationFeedback, FeedbackType } from '@/components/ValidationFeedback'
import { LogOut, Users, QrCode } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface FeedbackState {
  type: FeedbackType
  title: string
  message: string
}

export default function AdminPage() {
  const [feedback, setFeedback] = useState<FeedbackState>({ type: null, title: '', message: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const isScanning = useRef(false)
  const { queueInfo, loading: queueLoading } = useRealtimeQueue()
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') {
        router.push('/dashboard')
        return
      }
      setIsAdmin(true)
    }
    checkAdmin()
  }, [supabase, router])

  useEffect(() => {
    if (!isAdmin) return

    const scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    )

    scanner.render(handleScan, handleError)

    return () => {
      scanner.clear().catch(error => {
        console.error("Failed to clear scanner", error)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  async function handleScan(decodedText: string) {
    if (isScanning.current) return
    isScanning.current = true

    // Pause apparent scanning visual feedback if possible, or just lock the state
    try {
      const { data, error } = await supabase.rpc('validate_ticket', { p_qr_token: decodedText })

      if (error || (data && data.error)) {
         setFeedback({
           type: 'error',
           title: 'Erro de Validação',
           message: data?.error || error?.message || 'QR Code inválido.'
         })
      } else if (data) {
        if (data.type === 'error') {
          setFeedback({
            type: 'error',
            title: 'Ficha Inválida',
            message: data.message
          })
        } else if (data.type === 'skip_alert') {
          setFeedback({
            type: 'skip_alert',
            title: 'Atenção: Número Pulado',
            message: data.message + `\nAluno: ${data.student_name} (Senha #${data.queue_number})`
          })
        } else if (data.type === 'success') {
          setFeedback({
            type: 'success',
            title: 'Sucesso',
            message: `Ficha ${data.queue_number} validada!\nAluno: ${data.student_name}`
          })
        }
      }
    } catch (err) {
      setFeedback({ type: 'error', title: 'Erro de Requisição', message: 'Houve um erro indesejado na conexão.' })
    }
  }

  function handleError(err: unknown) {
    // Ignorar erros comuns de leitura falha por frame
  }

  const handleCloseFeedback = () => {
    setFeedback({ type: null, title: '', message: '' })
    // debounce do scanner
    setTimeout(() => {
      isScanning.current = false
    }, 1500)
  }

  if (!isAdmin) return null

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-gray-900 text-white p-6 shadow-lg relative z-10">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <QrCode className="w-5 h-5 text-green-400" />
              Painel do Administrador
            </h1>
            <p className="text-sm text-gray-400 mt-1">Validação de Fichas IFPE</p>
          </div>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))} className="p-2 hover:bg-gray-800 rounded-full transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-6 px-4 space-y-6">
        
        {/* Realtime Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
            <span className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1 block">Atendido Agora</span>
            <span className="text-3xl font-black text-green-600">
              #{queueInfo?.currentNumber || 0}
            </span>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
            <span className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1 block">Próximo</span
            >
            <span className="text-3xl font-black text-gray-800">
              #{ (queueInfo?.currentNumber || 0) + 1 }
            </span>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center col-span-2 md:col-span-2 flex items-center justify-center gap-4">
            <Users className="w-8 h-8 text-blue-500" />
            <div className="text-left">
              <span className="block text-2xl font-bold text-gray-800">{queueInfo?.totalWaiting || 0}</span>
              <span className="block text-xs font-semibold text-gray-500 uppercase">Na Fila de Espera</span>
            </div>
          </div>
        </div>

        {/* Scanner Component */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2 overflow-hidden">
          <div className="bg-gray-900 rounded-lg p-4 mb-4">
             <h2 className="text-center text-white font-medium mb-2 flex items-center justify-center gap-2">
               <QrCode className="w-5 h-5"/> Aponte a câmera para o QR Code
             </h2>
             <div id="reader" className="w-full bg-black rounded-lg overflow-hidden border-2 border-transparent"></div>
          </div>
        </div>

      </main>

      <ValidationFeedback 
        type={feedback.type} 
        title={feedback.title} 
        message={feedback.message} 
        onClose={handleCloseFeedback} 
      />
    </div>
  )
}
