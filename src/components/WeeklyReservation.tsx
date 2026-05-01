'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronLeft, ChevronRight, Calendar, Lock, Loader2 } from 'lucide-react'

interface Reservation {
  id: string
  reservation_date: string
  status: string
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

  const supabase = createClient()

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
    const limit = new Date()
    limit.setHours(0, 0, 0, 0)
    limit.setDate(limit.getDate() + 1)
    return date > limit
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
                        {!editable && !isReserved && (
                          <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Prazo encerrado</span>
                        )}
                        {editable && !isReserved && 'Clique para reservar'}
                        {!editable && isReserved && 'Não é possível cancelar agora'}
                      </span>
                    </div>
                  </div>

                  {/* Botão ação */}
                  <button
                    onClick={() => toggleReservation(date)}
                    disabled={!editable || !!isActionLoading || !!(blockedUntil && new Date(blockedUntil) > new Date())}
                    className="btn-gov-primary text-xs px-4 py-2 flex-shrink-0"
                    style={
                      isReserved
                        ? { background: 'transparent', color: 'var(--gov-red)', border: '1.5px solid var(--gov-red)' }
                        : !editable
                        ? { background: 'var(--gray-5)', color: 'var(--gray-40)', cursor: 'not-allowed', border: 'none' }
                        : {}
                    }
                  >
                    {isActionLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
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
          <strong>Regra:</strong> Reserve ou cancele com no mínimo <strong>2 dias de antecedência</strong>. Planeje sua semana com antecedência.
        </p>
      </div>
    </div>
  )
}
