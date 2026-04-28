'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { useRealtimeQueue } from '@/hooks/useRealtimeQueue'
import { createClient } from '@/lib/supabase/client'
import { ValidationFeedback, FeedbackType } from '@/components/ValidationFeedback'
import { 
  LogOut, Users, QrCode, BarChart3, UserX, Clock, 
  CheckCircle2, AlertTriangle, ArrowRight, DoorOpen,
  ScanLine, SkipForward, ChevronDown, ChevronUp,
  Shield, UserPlus, Trash2, Mail, Crown, Loader2
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

interface AdminUser {
  id: string
  email: string
  full_name: string
  is_super_admin: boolean
  created_at: string
}

export default function AdminPage() {
  const [feedback, setFeedback] = useState<FeedbackState>({ type: null, title: '', message: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState<'scanner' | 'queue' | 'stats' | 'admins'>('scanner')
  const [waitingTickets, setWaitingTickets] = useState<WaitingTicket[]>([])
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(true)
  const [adminList, setAdminList] = useState<AdminUser[]>([])
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminSuccess, setAdminSuccess] = useState('')
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

      // Usar RPC para verificar admin (bypassa RLS, evita recursão)
      const { data: checkData, error: checkError } = await supabase.rpc('check_admin_role')

      if (checkError) {
        // Fallback: RPC pode não existir ainda, tentar query direta
        console.log('RPC check_admin_role falhou, usando fallback:', checkError.message)
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
        setIsSuperAdmin(false)
      } else {
        console.log('Admin check via RPC:', checkData)
        if (!checkData?.is_admin) {
          router.push('/dashboard')
          return
        }
        setIsAdmin(true)
        setIsSuperAdmin(checkData?.is_super_admin === true)
      }
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

  const fetchAdminList = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_admins')
    if (!error && data?.success) {
      setAdminList(data.admins || [])
    }
  }, [supabase])

  const handleAddAdmin = async () => {
    setAdminError('')
    setAdminSuccess('')
    const email = newAdminEmail.trim().toLowerCase()

    if (!email) {
      setAdminError('Digite um email')
      return
    }

    if (!email.endsWith('@discente.ifpe.edu.br') && !email.endsWith('@ifpe.edu.br')) {
      setAdminError('Apenas emails institucionais IFPE são aceitos')
      return
    }

    setAdminActionLoading(true)
    try {
      const { data, error } = await supabase.rpc('manage_admin', { p_email: email, p_action: 'add' })
      if (error) {
        setAdminError(error.message)
      } else if (data?.error) {
        setAdminError(data.error)
      } else if (data?.success) {
        setAdminSuccess(data.message)
        setNewAdminEmail('')
        fetchAdminList()
      }
    } catch {
      setAdminError('Erro de conexão')
    } finally {
      setAdminActionLoading(false)
    }
  }

  const handleRemoveAdmin = async (email: string) => {
    setAdminError('')
    setAdminSuccess('')
    setAdminActionLoading(true)
    try {
      const { data, error } = await supabase.rpc('manage_admin', { p_email: email, p_action: 'remove' })
      if (error) {
        setAdminError(error.message)
      } else if (data?.error) {
        setAdminError(data.error)
      } else if (data?.success) {
        setAdminSuccess(data.message)
        fetchAdminList()
      }
    } catch {
      setAdminError('Erro de conexão')
    } finally {
      setAdminActionLoading(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    fetchWaitingTickets()
    fetchAdminStats()
    if (isSuperAdmin) fetchAdminList()

    const interval = setInterval(() => {
      fetchWaitingTickets()
      fetchAdminStats()
    }, 10000)

    return () => clearInterval(interval)
  }, [isAdmin, isSuperAdmin, fetchWaitingTickets, fetchAdminStats, fetchAdminList])

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

  const scannerRef = useRef<Html5QrcodeScanner | null>(null)

  useEffect(() => {
    if (!isAdmin || !showScanner || activeTab !== 'scanner') return

    // Evitar inicialização dupla no React StrictMode
    if (!scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      )

      scannerRef.current.render(handleScan, handleError)
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(error => {
          console.error("Failed to clear scanner", error)
        })
        scannerRef.current = null
      }
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
      <header className="bg-gray-800 text-white p-4 sm:p-6 shadow-lg relative z-10 border-b border-gray-700">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <div>
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <QrCode className="w-5 h-5 text-green-400" />
              Painel Admin
            </h1>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">Meu Almoço IFPE — Gerenciamento</p>
          </div>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))} className="p-2 hover:bg-gray-700 rounded-full transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-6 px-4 space-y-6">
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 sm:p-4 text-center">
            <span className="text-[10px] sm:text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Chamando</span>
            <span className="text-2xl sm:text-3xl font-black text-green-400">
              #{queueInfo?.currentNumber || 0}
            </span>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 sm:p-4 text-center">
            <span className="text-[10px] sm:text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Na Fila</span>
            <span className="text-2xl sm:text-3xl font-black text-blue-400">
              {queueInfo?.totalWaiting || 0}
            </span>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 sm:p-4 text-center">
            <span className="text-[10px] sm:text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Dentro</span>
            <span className="text-2xl sm:text-3xl font-black text-yellow-400">
              {adminStats?.currently_inside || 0}
            </span>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 sm:p-4 text-center">
            <span className="text-[10px] sm:text-xs text-gray-400 font-bold uppercase tracking-wider mb-1 block">Total</span>
            <span className="text-2xl sm:text-3xl font-black text-white">
              {queueInfo?.totalToday || 0}
            </span>
          </div>
        </div>

        {/* Extra Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-2 sm:p-3 flex flex-col sm:flex-row items-center gap-1 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-orange-500/20 rounded-lg">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" />
            </div>
            <div className="text-center sm:text-left">
              <span className="text-sm sm:text-lg font-bold text-white">{adminStats?.avg_duration_minutes || 0}m</span>
              <span className="block text-[10px] sm:text-xs text-gray-400">Tempo Médio</span>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-2 sm:p-3 flex flex-col sm:flex-row items-center gap-1 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-red-500/20 rounded-lg">
              <UserX className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
            </div>
            <div className="text-center sm:text-left">
              <span className="text-sm sm:text-lg font-bold text-white">{adminStats?.skipped_count || 0}</span>
              <span className="block text-[10px] sm:text-xs text-gray-400">Pulados</span>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-2 sm:p-3 flex flex-col sm:flex-row items-center gap-1 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-green-500/20 rounded-lg">
              <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
            </div>
            <div className="text-center sm:text-left">
              <span className="text-sm sm:text-lg font-bold text-white">{queueInfo?.maxTickets || 200}</span>
              <span className="block text-[10px] sm:text-xs text-gray-400">Cota</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-800 rounded-xl p-1 border border-gray-700">
          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'scanner' 
                ? 'bg-green-600 text-white shadow-lg' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ScanLine className="w-4 h-4" />
            <span className="hidden sm:inline">Scanner</span> QR
          </button>
          <button
            onClick={() => setActiveTab('queue')}
            className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-bold transition-all ${
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
            className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'stats' 
                ? 'bg-green-600 text-white shadow-lg' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Relatório</span><span className="sm:hidden">Stats</span>
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => { setActiveTab('admins'); fetchAdminList(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'admins' 
                  ? 'bg-amber-600 text-white shadow-lg' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4" />
              Admins
            </button>
          )}
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
                      className={`flex items-center justify-between gap-2 p-3 sm:p-4 ${
                        isPast ? 'bg-red-900/20' : index === 0 ? 'bg-yellow-900/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                        <span className={`text-lg sm:text-2xl font-black tabular-nums flex-shrink-0 ${
                          isPast ? 'text-red-400' : index === 0 ? 'text-yellow-400' : 'text-gray-300'
                        }`}>
                          #{ticket.queue_number.toString().padStart(3, '0')}
                        </span>
                        <div className="min-w-0">
                          <span className="text-white font-medium block text-sm sm:text-base truncate">{ticket.student_name}</span>
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
                        className="flex items-center gap-1 sm:gap-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/30 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all disabled:opacity-50 flex-shrink-0"
                      >
                        <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        {loadingAction === ticket.id ? '...' : 'Pular'}
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
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-gray-700/50 rounded-xl p-3 sm:p-4">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                    <div className="p-1.5 sm:p-2 bg-green-500/20 rounded-lg">
                      <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
                    </div>
                    <span className="text-gray-300 font-medium text-sm sm:text-base">Fichas Emitidas</span>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black text-white">{queueInfo?.totalToday || 0}</span>
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

                <div className="bg-gray-700/50 rounded-xl p-3 sm:p-4">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                    <div className="p-1.5 sm:p-2 bg-blue-500/20 rounded-lg">
                      <Users className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
                    </div>
                    <span className="text-gray-300 font-medium text-sm sm:text-base">Atendidos</span>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black text-white">
                    {(queueInfo?.totalToday || 0) - (queueInfo?.totalWaiting || 0)}
                  </span>
                  <span className="text-gray-400 text-sm ml-2">
                    de {queueInfo?.totalToday || 0}
                  </span>
                </div>

                <div className="bg-gray-700/50 rounded-xl p-3 sm:p-4">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                    <div className="p-1.5 sm:p-2 bg-orange-500/20 rounded-lg">
                      <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" />
                    </div>
                    <span className="text-gray-300 font-medium text-sm sm:text-base">Tempo Médio</span>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black text-white">
                    {adminStats?.avg_duration_minutes || '—'}
                  </span>
                  <span className="text-gray-400 text-sm ml-2">min</span>
                </div>

                <div className="bg-gray-700/50 rounded-xl p-3 sm:p-4">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                    <div className="p-1.5 sm:p-2 bg-yellow-500/20 rounded-lg">
                      <DoorOpen className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />
                    </div>
                    <span className="text-gray-300 font-medium text-sm sm:text-base">No Refeitório</span>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black text-white">
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

        {activeTab === 'admins' && isSuperAdmin && (
          <div className="space-y-4 animate-fade-in">
            {/* Add Admin Form */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-white font-bold flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-amber-400" />
                  Adicionar Administrador
                </h3>
                <p className="text-gray-400 text-sm mt-1">
                  Apenas emails institucionais IFPE ({adminList.length}/50 admins)
                </p>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="email"
                      value={newAdminEmail}
                      onChange={(e) => { setNewAdminEmail(e.target.value); setAdminError(''); setAdminSuccess(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin()}
                      placeholder="email@discente.ifpe.edu.br"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
                    />
                  </div>
                  <button
                    onClick={handleAddAdmin}
                    disabled={adminActionLoading}
                    className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/50 text-white px-4 py-2.5 rounded-lg text-sm font-bold transition-all disabled:cursor-not-allowed"
                  >
                    {adminActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    <span className="hidden sm:inline">Adicionar</span>
                  </button>
                </div>

                {adminError && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2 text-sm animate-slide-up">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {adminError}
                  </div>
                )}
                {adminSuccess && (
                  <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg px-3 py-2 text-sm animate-slide-up">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    {adminSuccess}
                  </div>
                )}
              </div>
            </div>

            {/* Admin List */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-white font-bold flex items-center gap-2">
                  <Shield className="w-5 h-5 text-amber-400" />
                  Administradores Cadastrados
                  <span className="ml-auto text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-full">
                    {adminList.length}/50
                  </span>
                </h3>
              </div>
              <div className="divide-y divide-gray-700 max-h-[60vh] overflow-y-auto">
                {adminList.length > 0 ? (
                  adminList.map((admin) => (
                    <div key={admin.id} className="flex items-center justify-between gap-2 p-3 sm:p-4 hover:bg-gray-700/30 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-full flex-shrink-0 ${
                          admin.is_super_admin 
                            ? 'bg-amber-500/20' 
                            : 'bg-blue-500/20'
                        }`}>
                          {admin.is_super_admin 
                            ? <Crown className="w-4 h-4 text-amber-400" />
                            : <Users className="w-4 h-4 text-blue-400" />
                          }
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium text-sm truncate">{admin.full_name}</span>
                            {admin.is_super_admin && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold flex-shrink-0">
                                SUPER
                              </span>
                            )}
                          </div>
                          <span className="text-gray-400 text-xs truncate block">{admin.email}</span>
                        </div>
                      </div>
                      {!admin.is_super_admin && (
                        <button
                          onClick={() => handleRemoveAdmin(admin.email)}
                          disabled={adminActionLoading}
                          className="flex items-center gap-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/30 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Remover</span>
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center text-gray-500">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Nenhum administrador cadastrado</p>
                  </div>
                )}
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
