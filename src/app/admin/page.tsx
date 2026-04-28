'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { useRealtimeQueue } from '@/hooks/useRealtimeQueue'
import { createClient } from '@/lib/supabase/client'
import { ValidationFeedback, FeedbackType } from '@/components/ValidationFeedback'
import { 
  LogOut, Users, QrCode, BarChart3, UserX, Clock, 
  CheckCircle2, AlertTriangle, ArrowRight, DoorOpen,
  ScanLine, SkipForward, ChevronDown, ChevronUp
} from 'lucide-react'
import { useRouter } from 'next/navigation'

interface FeedbackState {
  type: FeedbackType
  title: string
  message: string
}

interface WaitingTicket {
  id: string
  queue_number: number
  student_name: string
  status: string
  created_at: string
}

interface AdminStats {
  avg_duration_minutes: number
  currently_inside: number
  skipped_count: number
}

export default function AdminPage() {
  const [feedback, setFeedback] = useState<FeedbackState>({ type: null, title: '', message: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState<'scanner' | 'queue' | 'stats'>('scanner')
  const [waitingTickets, setWaitingTickets] = useState<WaitingTicket[]>([])
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(true)
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

  const fetchWaitingTickets = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_waiting_tickets')
    if (!error && data) {
      setWaitingTickets(Array.isArray(data) ? data : [])
    }
  }, [supabase])

  const fetchAdminStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_admin_stats')
    if (!error && data && !data.error) {
      setAdminStats(data)
    }
  }, [supabase])

  useEffect(() => {
    if (!isAdmin) return
    fetchWaitingTickets()
    fetchAdminStats()

    const interval = setInterval(() => {
      fetchWaitingTickets()
      fetchAdminStats()
    }, 10000)

    return () => clearInterval(interval)
  }, [isAdmin, fetchWaitingTickets, fetchAdminStats])

  // Atualizar ao receber evento realtime
  useEffect(() => {
    if (!isAdmin) return

    const channel = supabase
      .channel('admin:updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => {
          fetchWaitingTickets()
          fetchAdminStats()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [isAdmin, supabase, fetchWaitingTickets, fetchAdminStats])

  useEffect(() => {
    if (!isAdmin || !showScanner || activeTab !== 'scanner') return

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
  }, [isAdmin, showScanner, activeTab])

  async function handleScan(decodedText: string) {
    if (isScanning.current) return
    isScanning.current = true

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
        // Atualizar listas
        fetchWaitingTickets()
        fetchAdminStats()
      }
    } catch {
      setFeedback({ type: 'error', title: 'Erro de Requisição', message: 'Houve um erro indesejado na conexão.' })
    }
  }

  function handleError() {
    // Ignorar erros comuns de leitura falha por frame
  }

  const handleCloseFeedback = () => {
    setFeedback({ type: null, title: '', message: '' })
    setTimeout(() => {
      isScanning.current = false
    }, 1500)
  }

  const handleSkipAndRequeue = async (ticketId: string, studentName: string) => {
    setLoadingAction(ticketId)
    try {
      const { data, error } = await supabase.rpc('skip_and_requeue', { p_ticket_id: ticketId })
      if (!error && data?.success) {
        setFeedback({
          type: 'skip_alert',
          title: 'Aluno Reenviado',
          message: data.message
        })
        fetchWaitingTickets()
      } else {
        setFeedback({
          type: 'error',
          title: 'Erro',
          message: data?.error || error?.message || 'Erro ao pular aluno'
        })
      }
    } catch {
      setFeedback({ type: 'error', title: 'Erro', message: 'Erro de conexão' })
    } finally {
      setLoadingAction(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-400"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 pb-20">
      <header className="bg-gray-800 text-white p-6 shadow-lg relative z-10 border-b border-gray-700">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <QrCode className="w-5 h-5 text-green-400" />
              Painel do Administrador
            </h1>
            <p className="text-sm text-gray-400 mt-1">Meu Almoço IFPE — Gerenciamento</p>
          </div>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))} className="p-2 hover:bg-gray-700 rounded-full transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-6 px-4 space-y-6">
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
            <span className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Chamando</span>
            <span className="text-3xl font-black text-green-400">
              #{queueInfo?.currentNumber || 0}
            </span>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
            <span className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Na Fila</span>
            <span className="text-3xl font-black text-blue-400">
              {queueInfo?.totalWaiting || 0}
            </span>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
            <span className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Dentro Agora</span>
            <span className="text-3xl font-black text-yellow-400">
              {adminStats?.currently_inside || 0}
            </span>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
            <span className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Total Hoje</span>
            <span className="text-3xl font-black text-white">
              {queueInfo?.totalToday || 0}
            </span>
          </div>
        </div>

        {/* Extra Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 flex items-center gap-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <Clock className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">{adminStats?.avg_duration_minutes || 0} min</span>
              <span className="block text-xs text-gray-400">Tempo Médio</span>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <UserX className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">{adminStats?.skipped_count || 0}</span>
              <span className="block text-xs text-gray-400">Pulados</span>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <BarChart3 className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">{queueInfo?.maxTickets || 200}</span>
              <span className="block text-xs text-gray-400">Cota Diária</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-800 rounded-xl p-1 border border-gray-700">
          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'scanner' 
                ? 'bg-green-600 text-white shadow-lg' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ScanLine className="w-4 h-4" />
            Scanner QR
          </button>
          <button
            onClick={() => setActiveTab('queue')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'queue' 
                ? 'bg-green-600 text-white shadow-lg' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            Fila ({waitingTickets.length})
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'stats' 
                ? 'bg-green-600 text-white shadow-lg' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Relatório
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'scanner' && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <button 
              onClick={() => setShowScanner(!showScanner)}
              className="w-full flex items-center justify-between p-4 text-white hover:bg-gray-700 transition-colors"
            >
              <span className="flex items-center gap-2 font-bold">
                <QrCode className="w-5 h-5 text-green-400" />
                Câmera de Leitura
              </span>
              {showScanner ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
            {showScanner && (
              <div className="p-4 pt-0">
                <div className="bg-black rounded-lg p-4">
                  <p className="text-center text-gray-400 text-sm mb-3 flex items-center justify-center gap-2">
                    <ScanLine className="w-4 h-4" /> Aponte a câmera para o QR Code do aluno
                  </p>
                  <div id="reader" className="w-full bg-black rounded-lg overflow-hidden"></div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'queue' && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-white font-bold flex items-center gap-2">
                <ArrowRight className="w-5 h-5 text-yellow-400" />
                Fila de Espera — {waitingTickets.length} pessoa{waitingTickets.length !== 1 ? 's' : ''}
              </h3>
              <p className="text-gray-400 text-sm mt-1">
                Clique em &quot;Pular&quot; para reenviar um aluno ao final da fila
              </p>
            </div>
            <div className="divide-y divide-gray-700 max-h-[60vh] overflow-y-auto">
              {waitingTickets.length > 0 ? (
                waitingTickets.map((ticket, index) => {
                  const isPast = ticket.queue_number <= (queueInfo?.currentNumber || 0)
                  return (
                    <div 
                      key={ticket.id}
                      className={`flex items-center justify-between p-4 ${
                        isPast ? 'bg-red-900/20' : index === 0 ? 'bg-yellow-900/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`text-2xl font-black tabular-nums ${
                          isPast ? 'text-red-400' : index === 0 ? 'text-yellow-400' : 'text-gray-300'
                        }`}>
                          #{ticket.queue_number.toString().padStart(3, '0')}
                        </span>
                        <div>
                          <span className="text-white font-medium block">{ticket.student_name}</span>
                          {isPast && (
                            <span className="text-red-400 text-xs flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Não compareceu
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleSkipAndRequeue(ticket.id, ticket.student_name)}
                        disabled={loadingAction === ticket.id}
                        className="flex items-center gap-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/30 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                      >
                        <SkipForward className="w-4 h-4" />
                        {loadingAction === ticket.id ? 'Pulando...' : 'Pular'}
                      </button>
                    </div>
                  )
                })
              ) : (
                <div className="p-12 text-center text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Nenhuma pessoa na fila</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-green-400" />
                Relatório do Dia
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-700/50 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-green-500/20 rounded-lg">
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                    </div>
                    <span className="text-gray-300 font-medium">Fichas Emitidas</span>
                  </div>
                  <span className="text-4xl font-black text-white">{queueInfo?.totalToday || 0}</span>
                  <div className="mt-2 bg-gray-600/50 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, ((queueInfo?.totalToday || 0) / (queueInfo?.maxTickets || 200)) * 100)}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-gray-400 mt-1 block">
                    {queueInfo?.totalToday || 0} / {queueInfo?.maxTickets || 200} cota diária
                  </span>
                </div>

                <div className="bg-gray-700/50 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                      <Users className="w-5 h-5 text-blue-400" />
                    </div>
                    <span className="text-gray-300 font-medium">Atendidos</span>
                  </div>
                  <span className="text-4xl font-black text-white">
                    {(queueInfo?.totalToday || 0) - (queueInfo?.totalWaiting || 0)}
                  </span>
                  <span className="text-gray-400 text-sm ml-2">
                    de {queueInfo?.totalToday || 0}
                  </span>
                </div>

                <div className="bg-gray-700/50 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-orange-500/20 rounded-lg">
                      <Clock className="w-5 h-5 text-orange-400" />
                    </div>
                    <span className="text-gray-300 font-medium">Tempo Médio Refeição</span>
                  </div>
                  <span className="text-4xl font-black text-white">
                    {adminStats?.avg_duration_minutes || '—'}
                  </span>
                  <span className="text-gray-400 text-sm ml-2">minutos</span>
                </div>

                <div className="bg-gray-700/50 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-yellow-500/20 rounded-lg">
                      <DoorOpen className="w-5 h-5 text-yellow-400" />
                    </div>
                    <span className="text-gray-300 font-medium">No Refeitório Agora</span>
                  </div>
                  <span className="text-4xl font-black text-white">
                    {adminStats?.currently_inside || 0}
                  </span>
                  <span className="text-gray-400 text-sm ml-2">pessoas</span>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                <UserX className="w-5 h-5 text-red-400" />
                Não Comparecimentos
              </h3>
              <div className="flex items-center gap-4">
                <span className="text-5xl font-black text-red-400">{adminStats?.skipped_count || 0}</span>
                <div>
                  <p className="text-gray-300 font-medium">alunos foram reenviados ao final da fila</p>
                  <p className="text-gray-500 text-sm mt-1">
                    Porcentagem: {queueInfo?.totalToday ? ((adminStats?.skipped_count || 0) / queueInfo.totalToday * 100).toFixed(1) : '0'}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

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
