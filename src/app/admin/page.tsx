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
  Shield, UserPlus, Trash2, Mail, Crown, Loader2,
  ArrowLeft
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
  role: string
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
  const [newAdminRole, setNewAdminRole] = useState('admin')
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminSuccess, setAdminSuccess] = useState('')
  const [processingNoShows, setProcessingNoShows] = useState(false)
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

        if (profile?.role !== 'admin' && profile?.role !== 'nutricionista') {
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
    const { data, error } = await supabase.rpc('get_waiting_reservations')
    if (!error && data) {
      setWaitingTickets(Array.isArray(data) ? data : [])
    }
  }, [supabase])

  const fetchAdminStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_admin_reservation_stats')
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
      const { data, error } = await supabase.rpc('manage_admin', { p_email: email, p_action: 'add', p_role: newAdminRole })
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
      const { data, error } = await supabase.rpc('manage_admin', { p_email: email, p_action: 'remove', p_role: 'admin' })
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
        { event: '*', schema: 'public', table: 'reservations' },
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
      const { data, error } = await supabase.rpc('validate_reservation', { p_qr_token: decodedText })

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
        } else if (data.type === 'success') {
          setFeedback({
            type: 'success',
            title: 'Sucesso',
            message: `Ficha ${data.queue_number} validada!\nAluno: ${data.student_name}`
          })

          // Enviar Push Notification se necessário
          if (data.notify && data.notify.subscription) {
            try {
              await fetch('/api/send-push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subscription: data.notify.subscription,
                  title: '🍽️ Meu Almoço IFPE',
                  body: `Estamos no número #${data.notify.current_number.toString().padStart(3, '0')}. Faltam 5 pessoas para o seu número (#${data.notify.queue_number.toString().padStart(3, '0')})!`
                })
              })
            } catch (err) {
              console.error('Erro ao enviar push notification:', err)
            }
          }
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
      const { data, error } = await supabase.rpc('skip_and_requeue_reservation', { p_reservation_id: ticketId })
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

  const handleProcessNoShows = async () => {
    if (!window.confirm('Isso vai marcar todos que não compareceram ontem como "Falta" e bloquear aqueles com 3 faltas no mês. Deseja continuar?')) return;

    setProcessingNoShows(true)
    try {
      const { data, error } = await supabase.rpc('process_no_shows')
      if (error || data?.error) {
        setFeedback({ type: 'error', title: 'Erro', message: data?.error || error?.message || 'Falha ao processar.' })
      } else {
        setFeedback({
          type: 'success',
          title: 'Faltas Processadas',
          message: `${data.no_shows} reservas foram marcadas como falta (No-Show).\n${data.blocked} alunos foram bloqueados temporariamente por reincidência.`
        })
      }
    } catch {
      setFeedback({ type: 'error', title: 'Erro', message: 'Falha na conexão' })
    } finally {
      setProcessingNoShows(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--gray-2)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--gov-blue)', borderTopColor: 'transparent' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--gray-40)' }}>Verificando permissões...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--gray-2)' }}>

      {/* Faixa GOV.BR */}
      <div className="gov-header-bar px-4 py-1.5 flex items-center gap-2 text-xs">
        <span className="font-bold tracking-wider text-white/90">GOV.BR</span>
        <span className="text-white/40">|</span>
        <span className="text-white/60">IFPE Belo Jardim</span>
      </div>

      {/* Header */}
      <header style={{ background: 'var(--gov-blue-dark)', borderBottom: '3px solid var(--gov-yellow)' }} className="px-4 py-4 shadow-md sticky top-0 z-10">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-blue)' }}>
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-base sm:text-lg leading-tight">Painel Administrativo</h1>
              <p className="text-white/50 text-xs hidden sm:block">Meu Almoço IFPE — Gerenciamento</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-semibold transition-colors px-3 py-2 rounded"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <button
              onClick={() => {
                supabase.auth.signOut();
                router.push('/login');
              }}
              className="flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-semibold transition-colors px-3 py-2 rounded"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto w-full px-4 py-6 space-y-5 pb-20">

        {/* Stats Cards Principais */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: 'var(--gray-5)' }}>
          {[
            { label: 'Chamando', value: `#${queueInfo?.currentNumber || 0}`, color: 'var(--gov-green)' },
            { label: 'Na Fila', value: queueInfo?.totalWaiting || 0, color: 'var(--gov-blue)' },
            { label: 'Dentro', value: adminStats?.currently_inside || 0, color: 'var(--gov-orange)' },
            { label: 'Total Hoje', value: queueInfo?.totalToday || 0, color: 'var(--gray-90)' },
          ].map((s, i) => (
            <div key={i} className="bg-white p-4 text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--gray-40)' }}>{s.label}</span>
              <span className="text-2xl sm:text-3xl font-black tabular-nums" style={{ color: s.color, fontFamily: 'var(--font-primary)' }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Extra Stats */}
        <div className="grid grid-cols-3 gap-px" style={{ background: 'var(--gray-5)' }}>
          {[
            { icon: <Clock className="w-4 h-4" />, value: `${adminStats?.avg_duration_minutes || 0}m`, label: 'Tempo Médio', color: 'var(--gov-orange)' },
            { icon: <UserX className="w-4 h-4" />, value: adminStats?.skipped_count || 0, label: 'Pulados', color: 'var(--gov-red)' },
            { icon: <BarChart3 className="w-4 h-4" />, value: queueInfo?.maxTickets || 200, label: 'Cota Diária', color: 'var(--gov-blue)' },
          ].map((s, i) => (
            <div key={i} className="bg-white p-3 flex flex-col sm:flex-row items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: s.color, opacity: 1, color: '#fff' }}>
                {s.icon}
              </div>
              <div className="text-center sm:text-left">
                <span className="text-base sm:text-lg font-black" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>{s.value}</span>
                <span className="block text-[10px] sm:text-xs font-medium" style={{ color: 'var(--gray-40)' }}>{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs — estilo GOV.BR */}
        <div className="gov-card flex overflow-hidden" style={{ borderBottom: '2px solid var(--gray-5)' }}>
          {[
            { key: 'scanner', icon: <ScanLine className="w-4 h-4" />, label: 'Scanner QR', shortLabel: 'QR', activeColor: 'var(--gov-blue)' },
            { key: 'queue', icon: <Users className="w-4 h-4" />, label: `Fila (${waitingTickets.length})`, shortLabel: 'Fila', activeColor: 'var(--gov-blue)' },
            { key: 'stats', icon: <BarChart3 className="w-4 h-4" />, label: 'Relatório', shortLabel: 'Relatório', activeColor: 'var(--gov-blue)' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 sm:py-3.5 text-xs sm:text-sm font-bold transition-all relative"
              style={{
                color: activeTab === tab.key ? tab.activeColor : 'var(--gray-40)',
                background: activeTab === tab.key ? '#E8F0FE' : 'transparent',
                borderBottom: activeTab === tab.key ? `3px solid ${tab.activeColor}` : '3px solid transparent',
              }}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </button>
          ))}
          {isSuperAdmin && (
            <button
              onClick={() => { setActiveTab('admins'); fetchAdminList(); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 sm:py-3.5 text-xs sm:text-sm font-bold transition-all"
              style={{
                color: activeTab === 'admins' ? 'var(--gov-yellow)' : 'var(--gray-40)',
                background: activeTab === 'admins' ? 'var(--gov-blue-dark)' : 'transparent',
                borderBottom: activeTab === 'admins' ? '3px solid var(--gov-yellow)' : '3px solid transparent',
              }}
            >
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">Equipe</span>
              <span className="sm:hidden">Adm</span>
            </button>
          )}
        </div>

        {/* Tab Content */}
        {activeTab === 'scanner' && (
          <div className="gov-card overflow-hidden">
            <button
              onClick={() => setShowScanner(!showScanner)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              style={{ borderBottom: showScanner ? '1px solid var(--gray-5)' : 'none' }}
            >
              <span className="flex items-center gap-3 font-bold" style={{ color: 'var(--gray-90)' }}>
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--gov-blue)' }}>
                  <QrCode className="w-4 h-4 text-white" />
                </div>
                Câmera de Leitura QR
              </span>
              {showScanner ? <ChevronUp className="w-5 h-5" style={{ color: 'var(--gray-40)' }} /> : <ChevronDown className="w-5 h-5" style={{ color: 'var(--gray-40)' }} />}
            </button>
            {showScanner && (
              <div className="p-4">
                <div className="rounded overflow-hidden" style={{ background: '#000' }}>
                  <p className="text-center text-white/60 text-sm py-3 flex items-center justify-center gap-2">
                    <ScanLine className="w-4 h-4" /> Aponte a câmera para o QR Code do aluno
                  </p>
                  <div id="reader" className="w-full bg-black rounded overflow-hidden"></div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'queue' && (
          <div className="gov-card overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: '2px solid var(--gray-5)' }}>
              <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--gray-90)' }}>
                <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: 'var(--gov-orange)' }}>
                  <ArrowRight className="w-4 h-4 text-white" />
                </div>
                Fila de Espera — {waitingTickets.length} pessoa{waitingTickets.length !== 1 ? 's' : ''}
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--gray-40)' }}>
                Clique em &quot;Pular&quot; para reenviar um aluno ao final da fila
              </p>
            </div>
            <div className="divide-y max-h-[60vh] overflow-y-auto" style={{ borderColor: 'var(--gray-5)' }}>
              {waitingTickets.length > 0 ? (
                waitingTickets.map((ticket, index) => {
                  const isPast = ticket.queue_number <= (queueInfo?.currentNumber || 0)
                  return (
                    <div
                      key={ticket.id}
                      className="flex items-center justify-between gap-2 px-5 py-3"
                      style={{ background: isPast ? 'var(--gov-red-light)' : index === 0 ? '#FFFBE6' : '#fff' }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg sm:text-2xl font-black tabular-nums flex-shrink-0" style={{ color: isPast ? 'var(--gov-red)' : index === 0 ? 'var(--gov-orange)' : 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
                          #{ticket.queue_number.toString().padStart(3, '0')}
                        </span>
                        <div className="min-w-0">
                          <span className="font-semibold block text-sm truncate" style={{ color: 'var(--gray-90)' }}>{ticket.student_name}</span>
                          {isPast && (
                            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--gov-red)' }}>
                              <AlertTriangle className="w-3 h-3" /> Não compareceu
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleSkipAndRequeue(ticket.id, ticket.student_name)}
                        disabled={loadingAction === ticket.id}
                        className="btn-gov-secondary text-xs px-3 py-1.5 flex-shrink-0"
                        style={{ borderColor: 'var(--gov-red)', color: 'var(--gov-red)', fontSize: '0.75rem' }}
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                        {loadingAction === ticket.id ? '...' : 'Pular'}
                      </button>
                    </div>
                  )
                })
              ) : (
                <div className="p-12 text-center" style={{ color: 'var(--gray-20)' }}>
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Nenhuma pessoa na fila</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div className="gov-card overflow-hidden">
              <div className="px-5 py-4" style={{ borderBottom: '2px solid var(--gray-5)' }}>
                <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--gray-90)' }}>
                  <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: 'var(--gov-blue)' }}>
                    <BarChart3 className="w-4 h-4 text-white" />
                  </div>
                  Relatório do Dia
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: 'var(--gray-5)' }}>
                <div className="bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--gray-40)' }}>Fichas Emitidas</p>
                  <p className="text-4xl font-black tabular-nums mb-2" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>{queueInfo?.totalToday || 0}</p>
                  <div className="rounded-full h-2 overflow-hidden" style={{ background: 'var(--gray-5)' }}>
                    <div
                      className="h-2 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, ((queueInfo?.totalToday || 0) / (queueInfo?.maxTickets || 200)) * 100)}%`, background: 'var(--gov-blue)' }}
                    />
                  </div>
                  <span className="text-xs mt-1 block" style={{ color: 'var(--gray-40)' }}>
                    {queueInfo?.totalToday || 0} / {queueInfo?.maxTickets || 200} cota diária
                  </span>
                </div>
                <div className="bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--gray-40)' }}>Atendidos</p>
                  <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--gov-green)', fontFamily: 'var(--font-primary)' }}>
                    {(queueInfo?.totalToday || 0) - (queueInfo?.totalWaiting || 0)}
                  </p>
                  <span className="text-sm" style={{ color: 'var(--gray-40)' }}>de {queueInfo?.totalToday || 0} fichas</span>
                </div>
                <div className="bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--gray-40)' }}>Tempo Médio</p>
                  <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--gov-orange)', fontFamily: 'var(--font-primary)' }}>
                    {adminStats?.avg_duration_minutes || '—'}
                  </p>
                  <span className="text-sm" style={{ color: 'var(--gray-40)' }}>minutos na fila</span>
                </div>
                <div className="bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--gray-40)' }}>No Refeitório</p>
                  <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--gov-blue)', fontFamily: 'var(--font-primary)' }}>
                    {adminStats?.currently_inside || 0}
                  </p>
                  <span className="text-sm" style={{ color: 'var(--gray-40)' }}>pessoas agora</span>
                </div>
              </div>
            </div>

            <div className="gov-card p-5" style={{ borderLeft: '4px solid var(--gov-red)' }}>
              <div className="flex items-start gap-4">
                <div>
                  <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--gov-red)', fontFamily: 'var(--font-primary)' }}>{adminStats?.skipped_count || 0}</p>
                  <p className="font-semibold text-sm mt-1" style={{ color: 'var(--gray-90)' }}>não comparecimentos</p>
                  <p className="text-xs" style={{ color: 'var(--gray-40)' }}>
                    {queueInfo?.totalToday ? ((adminStats?.skipped_count || 0) / queueInfo.totalToday * 100).toFixed(1) : '0'}% do total
                  </p>
                </div>
              </div>
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--gray-5)' }}>
                <p className="text-xs mb-3" style={{ color: 'var(--gray-40)' }}>
                  No fim do dia, processe as faltas para advertir os alunos que não cancelaram a reserva e não compareceram.
                </p>
                <button
                  onClick={handleProcessNoShows}
                  disabled={processingNoShows}
                  className="btn-gov-primary w-full"
                  style={{ background: 'var(--gov-red)', fontSize: '0.875rem' }}
                >
                  {processingNoShows ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                  Processar Faltas (Ontem) e Aplicar Bloqueios
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'admins' && isSuperAdmin && (

          <div className="space-y-4 animate-fade-in">
            <div className="gov-card overflow-hidden">
              <div className="px-5 py-4" style={{ borderBottom: '2px solid var(--gray-5)' }}>
                <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--gray-90)' }}>
                  <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: '#866800' }}>
                    <UserPlus className="w-4 h-4 text-white" />
                  </div>
                  Adicionar Membro da Equipe
                </h3>
                <p className="text-sm mt-1" style={{ color: 'var(--gray-40)' }}>
                  Apenas emails institucionais IFPE ({adminList.length}/50)
                </p>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--gray-20)' }} />
                    <input
                      type="email"
                      value={newAdminEmail}
                      onChange={(e) => { setNewAdminEmail(e.target.value); setAdminError(''); setAdminSuccess(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin()}
                      placeholder="email@discente.ifpe.edu.br"
                      className="gov-input pl-10"
                    />
                  </div>
                  <select
                    value={newAdminRole}
                    onChange={(e) => setNewAdminRole(e.target.value)}
                    className="gov-input"
                    style={{ width: 'auto' }}
                  >
                    <option value="admin">Administrador</option>
                    <option value="nutricionista">Nutricionista</option>
                  </select>
                  <button
                    onClick={handleAddAdmin}
                    disabled={adminActionLoading}
                    className="btn-gov-primary"
                    style={{ background: '#866800', whiteSpace: 'nowrap' }}
                  >
                    {adminActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    <span className="hidden sm:inline">Adicionar</span>
                  </button>
                </div>
                {adminError && (
                  <div className="flex items-center gap-2 p-3 rounded text-sm" style={{ background: 'var(--gov-red-light)', color: 'var(--gov-red)', border: '1px solid #f4a9a1' }}>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {adminError}
                  </div>
                )}
                {adminSuccess && (
                  <div className="flex items-center gap-2 p-3 rounded text-sm" style={{ background: 'var(--gov-green-light)', color: 'var(--gov-green)', border: '1px solid #a8dba8' }}>
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    {adminSuccess}
                  </div>
                )}
              </div>
            </div>

            <div className="gov-card overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '2px solid var(--gray-5)' }}>
                <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--gray-90)' }}>
                  <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: 'var(--gov-blue-dark)' }}>
                    <Shield className="w-4 h-4 text-white" />
                  </div>
                  Equipe Cadastrada
                </h3>
                <span className="text-xs font-bold px-2 py-1 rounded" style={{ background: 'var(--gray-5)', color: 'var(--gray-40)' }}>
                  {adminList.length}/50
                </span>
              </div>
              <div className="divide-y max-h-[60vh] overflow-y-auto" style={{ borderColor: 'var(--gray-5)' }}>
                {adminList.length > 0 ? (
                  adminList.map((admin) => (
                    <div key={admin.id} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: admin.is_super_admin ? '#866800' : admin.role === 'nutricionista' ? 'var(--gov-green)' : 'var(--gov-blue)', opacity: 0.15 }}></div>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 absolute" style={{ position: 'relative', background: admin.is_super_admin ? '#FFFBE6' : admin.role === 'nutricionista' ? 'var(--gov-green-light)' : '#E8F0FE', marginLeft: '-2.25rem' }}>
                          {admin.is_super_admin ? <Crown className="w-4 h-4" style={{ color: '#866800' }} /> : <Users className="w-4 h-4" style={{ color: admin.role === 'nutricionista' ? 'var(--gov-green)' : 'var(--gov-blue)' }} />}
                        </div>
                        <div className="min-w-0 ml-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm truncate" style={{ color: 'var(--gray-90)' }}>{admin.full_name}</span>
                            {admin.is_super_admin && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#FFFBE6', color: '#866800' }}>SUPER</span>
                            )}
                            {!admin.is_super_admin && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: admin.role === 'nutricionista' ? 'var(--gov-green-light)' : '#E8F0FE', color: admin.role === 'nutricionista' ? 'var(--gov-green)' : 'var(--gov-blue)' }}>
                                {admin.role === 'nutricionista' ? 'NUTRI' : 'ADMIN'}
                              </span>
                            )}
                          </div>
                          <span className="text-xs truncate block" style={{ color: 'var(--gray-40)' }}>{admin.email}</span>
                        </div>
                      </div>
                      {!admin.is_super_admin && (
                        <button
                          onClick={() => handleRemoveAdmin(admin.email)}
                          disabled={adminActionLoading}
                          className="btn-gov-secondary text-xs px-3 py-1.5 flex-shrink-0"
                          style={{ borderColor: 'var(--gov-red)', color: 'var(--gov-red)', fontSize: '0.75rem' }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Remover</span>
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center" style={{ color: 'var(--gray-20)' }}>
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Nenhum administrador cadastrado</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      <footer style={{ background: 'var(--gov-blue-dark)', borderTop: '3px solid var(--gov-yellow)' }} className="py-6 px-4 flex flex-col items-center mt-8">
        <p className="text-white/50 text-xs mb-3 font-medium tracking-wide">IFPE Belo Jardim · Painel Administrativo</p>
        <div className="inline-flex items-center gap-2 bg-white/5 px-3 sm:px-4 py-2 rounded-full border border-white/10 whitespace-nowrap">
          <span className="text-[10px] sm:text-xs font-medium text-white/60 uppercase tracking-widest">Desenvolvido por</span>
          <div className="w-1 h-1 rounded-full bg-yellow-400 flex-shrink-0"></div>
          <span className="text-xs sm:text-sm font-bold text-white/90">Pedro Victor & Pedro Borges</span>
        </div>
      </footer>

      <ValidationFeedback
        type={feedback.type}
        title={feedback.title}
        message={feedback.message}
        onClose={handleCloseFeedback}
      />
    </div>
  )
}

