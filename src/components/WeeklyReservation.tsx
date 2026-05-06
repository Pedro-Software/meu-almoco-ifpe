'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronLeft, ChevronRight, Calendar, Lock, Loader2, X, AlertTriangle } from 'lucide-react'

interface Reservation {
  id: string
  reservation_date: string
  status: string
  queue_number?: number
}

export function WeeklyReservation() {
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date()
    if (today.getDay() === 0) today.setDate(today.getDate() + 1)
    if (today.getDay() === 6) today.setDate(today.getDate() + 2)
    return today
  })

  const [weekDays, setWeekDays] = useState<Date[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancellationCounts, setCancellationCounts] = useState<Record<string, number>>({})

  // Modal de cancelamento
  const [cancelModal, setCancelModal] = useState<{ open: boolean; date: Date | null }>({ open: false, date: null })
  const [justification, setJustification] = useState('')
  const [justificationError, setJustificationError] = useState('')

  // Client estável: useMemo garante que a referência não muda entre re-renders
  const supabase = useMemo(() => createClient(), [])

  const calculateWeekDays = useCallback((date: Date) => {
    const days: Date[] = []
    const day = date.getDay() || 7
    const monday = new Date(date)
    monday.setDate(date.getDate() - day + 1)
    monday.setHours(0, 0, 0, 0)
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      days.push(d)
    }
    setWeekDays(days)
    return monday
  }, [])

  const fetchReservations = useCallback(async (monday: Date) => {
    setLoading(true)
    setError(null)
    const tzOffset = monday.getTimezoneOffset() * 60000
    const localISOTime = (new Date(monday.getTime() - tzOffset)).toISOString().split('T')[0]

    const { data, error: rpcError } = await supabase.rpc('get_week_reservations', { p_week_start: localISOTime })
    if (rpcError) {
      setError('Erro ao buscar reservas.')
    } else if (data?.success) {
      setReservations(data.reservations || [])
      setBlockedUntil(data.blocked_until)
      setCancellationCounts(data.cancellation_counts || {})
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    const monday = calculateWeekDays(currentDate)
    fetchReservations(monday)
  }, [currentDate, calculateWeekDays, fetchReservations])

  const nextWeek = () => {
    const next = new Date(currentDate)
    next.setDate(next.getDate() + 7)
    setCurrentDate(next)
  }

  const prevWeek = () => {
    const prev = new Date(currentDate)
    prev.setDate(prev.getDate() - 7)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const currentMonday = new Date(today)
    currentMonday.setDate(today.getDate() - (today.getDay() || 7) + 1)
    const prevMonday = new Date(prev)
    prevMonday.setDate(prev.getDate() - (prev.getDay() || 7) + 1)
    if (prevMonday >= currentMonday) setCurrentDate(prev)
  }

  // Abre o modal de cancelamento ao invés de cancelar direto
  const handleCancelClick = (date: Date) => {
    setJustification('')
    setJustificationError('')
    setCancelModal({ open: true, date })
  }

  // Executa o cancelamento com justificativa
  const confirmCancellation = async () => {
    if (!cancelModal.date) return

    const trimmed = justification.trim()
    if (!trimmed) {
      setJustificationError('Preencha a justificativa para cancelar.')
      return
    }
    if (trimmed.length < 5) {
      setJustificationError('A justificativa deve ter pelo menos 5 caracteres.')
      return
    }

    const date = cancelModal.date
    const tzOffset = date.getTimezoneOffset() * 60000
    const dateStr = (new Date(date.getTime() - tzOffset)).toISOString().split('T')[0]
    setActionLoading(dateStr)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('toggle_reservation', {
      p_date: dateStr,
      p_justification: trimmed
    })

    if (rpcError) {
      setError(rpcError.message)
    } else if (data?.error) {
      setError(data.error)
    } else {
      const monday = calculateWeekDays(currentDate)
      fetchReservations(monday)
    }

    setActionLoading(null)
    setCancelModal({ open: false, date: null })
    setJustification('')
  }

  // Reservar (sem justificativa)
  const toggleReservation = async (date: Date) => {
    if (blockedUntil && new Date(blockedUntil) > new Date()) return
    const tzOffset = date.getTimezoneOffset() * 60000
    const dateStr = (new Date(date.getTime() - tzOffset)).toISOString().split('T')[0]
    setActionLoading(dateStr)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('toggle_reservation', { p_date: dateStr })
    if (rpcError) {
      setError(rpcError.message)
    } else if (data?.error) {
      setError(data.error)
    } else {
      const monday = calculateWeekDays(currentDate)
      fetchReservations(monday)
    }
    setActionLoading(null)
  }

  const formatDayName = (date: Date) =>
    date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase()

  const isToday = (date: Date) => {
    const today = new Date()
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear()
  }

  const canModify = (date: Date) => {
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)

    const dateOnly = new Date(date)
    dateOnly.setHours(0, 0, 0, 0)

    // Não permite datas passadas
    if (dateOnly < today) return false

    // Se for hoje, só permite até 11:30
    if (dateOnly.getTime() === today.getTime()) {
      const hours = now.getHours()
      const minutes = now.getMinutes()
      if (hours > 11 || (hours === 11 && minutes >= 30)) return false
    }

    // REGRA: Abertura com no máximo 2 dias de antecedência
    // Hoje pode reservar: hoje (D), amanhã (D+1), depois de amanhã (D+2)
    const maxDate = new Date(today)
    maxDate.setDate(today.getDate() + 2)
    if (dateOnly > maxDate) return false

    return true
  }

  // Verifica se a data ainda não abriu para reserva (mais de 2 dias no futuro)
  const isNotYetOpen = (date: Date) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dateOnly = new Date(date)
    dateOnly.setHours(0, 0, 0, 0)
    const maxDate = new Date(today)
    maxDate.setDate(today.getDate() + 2)
    return dateOnly > maxDate
  }

  // Retorna a data de abertura da reserva (D-2)
  const getOpeningDate = (date: Date) => {
    const openDate = new Date(date)
    openDate.setDate(openDate.getDate() - 2)
    return openDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  const isPrevDisabled = () => {
    const today = new Date()
    const currentMonday = new Date(today)
    currentMonday.setDate(today.getDate() - (today.getDay() || 7) + 1)
    currentMonday.setHours(0, 0, 0, 0)
    const viewMonday = new Date(currentDate)
    viewMonday.setDate(currentDate.getDate() - (currentDate.getDay() || 7) + 1)
    viewMonday.setHours(0, 0, 0, 0)
    return viewMonday <= currentMonday
  }

  // Retorna quantos cancelamentos o aluno já usou para a data
  const getCancelCount = (date: Date) => {
    const tzOffset = date.getTimezoneOffset() * 60000
    const dateStr = (new Date(date.getTime() - tzOffset)).toISOString().split('T')[0]
    return cancellationCounts[dateStr] || 0
  }

  const isCancelLimitReached = (date: Date) => getCancelCount(date) >= 2

  const reservedCount = reservations.filter(r => r.status === 'reserved' || r.status === 'confirmed').length

  return (
    <div className="gov-card overflow-hidden">

      {/* Header de navegação */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--gray-5)', background: 'var(--gray-2)' }}>
        <button
          onClick={prevWeek}
          disabled={isPrevDisabled() || loading}
          className="p-2 rounded transition-colors hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Semana anterior"
        >
          <ChevronLeft className="w-5 h-5" style={{ color: 'var(--gray-60)' }} />
        </button>

        <div className="flex flex-col items-center">
          <span className="text-sm font-bold" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
            {weekDays.length > 0 && `${weekDays[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} a ${weekDays[4].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`}
          </span>
          <span className="text-xs font-semibold mt-0.5" style={{ color: 'var(--gray-40)' }}>
            {reservedCount} de 5 dias reservados
          </span>
        </div>

        <button
          onClick={nextWeek}
          disabled={loading}
          className="p-2 rounded transition-colors hover:bg-white"
          title="Próxima semana"
        >
          <ChevronRight className="w-5 h-5" style={{ color: 'var(--gray-60)' }} />
        </button>
      </div>

      {/* Bloqueio */}
      {blockedUntil && new Date(blockedUntil) > new Date() && (
        <div className="flex items-start gap-3 p-4 text-sm" style={{ background: 'var(--gov-red-light)', color: 'var(--gov-red)', borderBottom: '1px solid #f4a9a1' }}>
          <Lock className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Conta temporariamente bloqueada</p>
            <p className="mt-0.5">Devido a faltas reincidentes, suas reservas estão bloqueadas até {new Date(blockedUntil).toLocaleDateString('pt-BR')}.</p>
          </div>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="p-3 text-sm text-center font-medium" style={{ background: 'var(--gov-red-light)', color: 'var(--gov-red)', borderBottom: '1px solid #f4a9a1' }}>
          {error}
        </div>
      )}

      {/* Lista de dias */}
      <div>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--gov-blue)' }} />
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--gray-5)' }}>
            {weekDays.map((date, index) => {
              const tzOffset = date.getTimezoneOffset() * 60000
              const dateStr = (new Date(date.getTime() - tzOffset)).toISOString().split('T')[0]
              const reservation = reservations.find(r => r.reservation_date === dateStr)
              const isReserved = !!reservation
              const editable = canModify(date)
              const isActionLoading = actionLoading === dateStr
              const today = isToday(date)
              const cancelCount = getCancelCount(date)
              const cancelLimitReached = isCancelLimitReached(date)
              // O botão de cancelar é desabilitado se atingiu o limite
              const cancelDisabled = isReserved && cancelLimitReached

              return (
                <div
                  key={index}
                  className="flex items-center justify-between px-4 py-3 sm:py-4 transition-colors"
                  style={{ background: isReserved ? 'rgba(22,136,33,0.04)' : '#fff' }}
                >
                  {/* Data */}
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div
                      className="flex flex-col items-center justify-center w-12 h-12 rounded flex-shrink-0"
                      style={{
                        background: today ? 'var(--gov-blue)' : 'var(--gray-2)',
                        border: `1px solid ${today ? 'var(--gov-blue)' : 'var(--gray-5)'}`,
                      }}
                    >
                      <span className="text-[10px] font-bold" style={{ color: today ? 'rgba(255,255,255,0.7)' : 'var(--gray-40)' }}>
                        {formatDayName(date)}
                      </span>
                      <span className="text-lg font-black leading-tight" style={{ color: today ? '#fff' : 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
                        {date.getDate()}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="font-semibold text-sm" style={{ color: isReserved ? 'var(--gov-green)' : 'var(--gray-90)' }}>
                        {isReserved ? 'Almoço Reservado' : 'Sem reserva'}
                      </span>
                      <span className="text-xs mt-0.5" style={{ color: 'var(--gray-40)' }}>
                        {isReserved && reservation?.queue_number && (
                          <span className="flex items-center gap-1" style={{ color: 'var(--gov-blue)', fontWeight: 600 }}>
                            Fila #{reservation.queue_number.toString().padStart(3, '0')}
                          </span>
                        )}
                        {!editable && !isReserved && isNotYetOpen(date) && (
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Abre em {getOpeningDate(date)}</span>
                        )}
                        {!editable && !isReserved && !isNotYetOpen(date) && (
                          <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Prazo encerrado</span>
                        )}
                        {editable && !isReserved && 'Clique para reservar'}
                        {!editable && isReserved && !reservation?.queue_number && 'Não é possível cancelar agora'}
                      </span>
                      {/* Indicador de cancelamentos usados */}
                      {editable && isReserved && cancelCount > 0 && (
                        <span className="text-[10px] font-semibold mt-0.5 flex items-center gap-1" style={{ color: cancelLimitReached ? 'var(--gov-red)' : 'var(--gov-orange)' }}>
                          <AlertTriangle className="w-3 h-3" />
                          {cancelLimitReached
                            ? 'Limite de cancelamentos atingido'
                            : `${cancelCount}/2 cancelamento${cancelCount > 1 ? 's' : ''} usado${cancelCount > 1 ? 's' : ''}`
                          }
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Botão ação */}
                  <button
                    onClick={() => {
                      if (isReserved) {
                        handleCancelClick(date)
                      } else {
                        toggleReservation(date)
                      }
                    }}
                    disabled={!editable || !!isActionLoading || !!(blockedUntil && new Date(blockedUntil) > new Date()) || cancelDisabled}
                    className="btn-gov-primary text-xs px-4 py-2 flex-shrink-0"
                    style={
                      cancelDisabled
                        ? { background: 'var(--gray-5)', color: 'var(--gray-40)', cursor: 'not-allowed', border: 'none' }
                        : isReserved
                        ? { background: 'transparent', color: 'var(--gov-red)', border: '1.5px solid var(--gov-red)' }
                        : !editable
                        ? { background: 'var(--gray-5)', color: 'var(--gray-40)', cursor: 'not-allowed', border: 'none' }
                        : {}
                    }
                  >
                    {isActionLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : cancelDisabled ? (
                      'Bloqueado'
                    ) : isReserved ? (
                      'Cancelar'
                    ) : editable ? (
                      'Reservar'
                    ) : (
                      'Indisponível'
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Nota de regra */}
      <div className="px-4 py-3 flex items-start gap-3" style={{ background: '#E8F0FE', borderTop: '1px solid #c2d5f5' }}>
        <Calendar className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--gov-blue)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--gov-blue)' }}>
          <strong>Regra:</strong> A reserva abre <strong>2 dias antes</strong> e permanece disponível até <strong>11:30 do próprio dia</strong>. Você pode cancelar no máximo <strong>2 vezes por dia</strong>. Quem reserva primeiro tem prioridade na fila.
        </p>
      </div>

      {/* Modal de cancelamento com justificativa */}
      {cancelModal.open && cancelModal.date && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setCancelModal({ open: false, date: null }) }}
        >
          <div
            className="w-full max-w-md rounded-lg shadow-2xl overflow-hidden animate-fade-in"
            style={{ background: '#fff' }}
          >
            {/* Header do modal */}
            <div className="flex items-center justify-between px-5 py-4" style={{ background: 'var(--gov-red-light)', borderBottom: '2px solid var(--gov-red)' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--gov-red)' }}>
                  <AlertTriangle className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm" style={{ color: 'var(--gov-red)' }}>Cancelar Reserva</h3>
                  <p className="text-xs" style={{ color: 'var(--gov-red)', opacity: 0.7 }}>
                    {cancelModal.date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCancelModal({ open: false, date: null })}
                className="p-1.5 rounded hover:bg-white/50 transition-colors"
              >
                <X className="w-5 h-5" style={{ color: 'var(--gov-red)' }} />
              </button>
            </div>

            {/* Corpo do modal */}
            <div className="px-5 py-4 space-y-4">
              {/* Contador de cancelamentos */}
              {cancelModal.date && (
                <div className="flex items-center gap-3 p-3 rounded" style={{ background: 'var(--gray-2)', border: '1px solid var(--gray-5)' }}>
                  <div className="flex gap-1">
                    {[0, 1].map(i => (
                      <div
                        key={i}
                        className="w-3 h-3 rounded-full"
                        style={{
                          background: i < getCancelCount(cancelModal.date!) ? 'var(--gov-red)' : 'var(--gray-10)',
                          border: `1px solid ${i < getCancelCount(cancelModal.date!) ? 'var(--gov-red)' : 'var(--gray-20)'}`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-medium" style={{ color: 'var(--gray-60)' }}>
                    {getCancelCount(cancelModal.date)}/2 cancelamentos utilizados para este dia
                  </span>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: 'var(--gray-90)' }}>
                  Por que deseja cancelar? <span style={{ color: 'var(--gov-red)' }}>*</span>
                </label>
                <textarea
                  value={justification}
                  onChange={(e) => { setJustification(e.target.value); setJustificationError('') }}
                  placeholder="Descreva o motivo do cancelamento..."
                  rows={3}
                  maxLength={500}
                  className="gov-input"
                  style={{ resize: 'vertical', minHeight: '80px', fontSize: '0.875rem' }}
                />
                <div className="flex justify-between items-center mt-1">
                  {justificationError ? (
                    <span className="text-xs font-medium" style={{ color: 'var(--gov-red)' }}>{justificationError}</span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--gray-40)' }}>Mínimo de 5 caracteres</span>
                  )}
                  <span className="text-xs tabular-nums" style={{ color: 'var(--gray-40)' }}>{justification.length}/500</span>
                </div>
              </div>
            </div>

            {/* Ações do modal */}
            <div className="flex gap-3 px-5 py-4" style={{ borderTop: '1px solid var(--gray-5)', background: 'var(--gray-2)' }}>
              <button
                onClick={() => setCancelModal({ open: false, date: null })}
                className="btn-gov-secondary flex-1 text-sm"
              >
                Voltar
              </button>
              <button
                onClick={confirmCancellation}
                disabled={!!actionLoading}
                className="btn-gov-primary flex-1 text-sm"
                style={{ background: 'var(--gov-red)' }}
              >
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Confirmar Cancelamento'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
