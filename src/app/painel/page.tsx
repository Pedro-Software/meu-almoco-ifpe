'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Utensils, Users, Clock, CheckCircle2, ArrowRight } from 'lucide-react'

interface PanelInfo {
  current_number: number
  total_served: number
  total_waiting: number
  total_today: number
  next_in_line: Array<{ queue_number: number; student_name: string }>
  recently_served: Array<{ queue_number: number; student_name: string; entered_at: string }>
}

export default function PainelPublico() {
  const [panelInfo, setPanelInfo] = useState<PanelInfo | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const supabase = createClient()

  const fetchPanelInfo = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_public_panel_reservations')
    if (!error && data) setPanelInfo(data)
  }, [supabase])

  useEffect(() => {
    fetchPanelInfo()
    const interval = setInterval(fetchPanelInfo, 5000)
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000)

    const queueChannel = supabase.channel('painel:queue_state')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queue_state' }, () => fetchPanelInfo())
      .subscribe()

    const reservationChannel = supabase.channel('painel:reservations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => fetchPanelInfo())
      .subscribe()

    return () => {
      clearInterval(interval)
      clearInterval(clockInterval)
      supabase.removeChannel(queueChannel)
      supabase.removeChannel(reservationChannel)
    }
  }, [supabase, fetchPanelInfo])

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  if (!panelInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--gov-blue-dark)' }}>
        <div className="w-12 h-12 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--gov-yellow)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col overflow-hidden" style={{ background: '#0D1B2E' }}>

      {/* Header GOV.BR */}
      <header style={{ background: 'var(--gov-blue-dark)', borderBottom: '4px solid var(--gov-yellow)' }} className="px-4 sm:px-8 py-3 sm:py-4 flex justify-between items-center shadow-xl">
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="w-10 h-10 sm:w-14 sm:h-14 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-blue)' }}>
            <Utensils className="w-5 h-5 sm:w-8 sm:h-8 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-white/50 text-xs font-bold tracking-widest hidden sm:inline">GOV.BR</span>
              <span className="text-white/30 text-xs hidden sm:inline">|</span>
              <span className="text-white/60 text-xs hidden sm:inline">IFPE Belo Jardim</span>
            </div>
            <h1 className="text-white font-black text-lg sm:text-3xl tracking-tight leading-none">Meu Almoço IFPE</h1>
            <p className="text-white/50 text-xs sm:text-sm font-medium hidden sm:block mt-0.5">Refeitório — Painel de Atendimento</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl sm:text-4xl font-mono font-bold tabular-nums text-white">{formatTime(currentTime)}</div>
          <p className="text-white/40 text-xs sm:text-sm hidden sm:block mt-0.5">
            {currentTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-3 sm:gap-4 p-3 sm:p-5 overflow-y-auto">

        {/* Número Atual */}
        <div className="lg:col-span-5 flex flex-col gap-3 sm:gap-4">
          <div
            className="rounded flex flex-col items-center justify-center p-6 sm:p-8 relative overflow-hidden min-h-[200px] lg:flex-1"
            style={{ background: 'var(--gov-blue)', boxShadow: '0 8px 32px rgba(19,81,180,0.4)' }}
          >
            <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
            <div className="absolute -bottom-8 -left-8 w-36 h-36 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
            <h2 className="text-white/60 text-xs sm:text-base font-bold uppercase tracking-widest mb-2 sm:mb-3">Chamando Agora</h2>
            <div className="text-7xl sm:text-[9rem] font-black leading-none tabular-nums text-white drop-shadow-lg" style={{ fontFamily: 'var(--font-primary)' }}>
              {panelInfo.current_number > 0 ? panelInfo.current_number : '—'}
            </div>
            {panelInfo.current_number > 0 && (
              <div className="mt-3 sm:mt-4 px-4 py-2 rounded" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <p className="text-white/70 text-xs sm:text-sm font-medium text-center">Apresente-se com seu QR Code</p>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { icon: <Users className="w-4 h-4 sm:w-5 sm:h-5" />, value: panelInfo.total_waiting,  label: 'Na Fila',    color: '#5B9BD5' },
              { icon: <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />, value: panelInfo.total_served,   label: 'Atendidos',  color: '#6BBF6C' },
              { icon: <Clock className="w-4 h-4 sm:w-5 sm:h-5" />, value: panelInfo.total_today,    label: 'Total Hoje', color: '#E8B84B' },
            ].map((s, i) => (
              <div key={i} className="rounded p-3 sm:p-4 text-center" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="flex justify-center mb-1 sm:mb-2" style={{ color: s.color }}>{s.icon}</div>
                <span className="text-xl sm:text-3xl font-black text-white tabular-nums block">{s.value}</span>
                <span className="text-[10px] sm:text-xs font-bold uppercase text-white/40 mt-0.5 block">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Próximos na Fila */}
        <div className="lg:col-span-4 rounded p-4 sm:p-5 flex flex-col" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-xs sm:text-sm font-bold uppercase tracking-widest text-white/40 mb-3 sm:mb-4 flex items-center gap-2">
            <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: 'var(--gov-yellow)' }} />
            Próximos a Serem Chamados
          </h2>
          <div className="flex-1 space-y-2 overflow-y-auto max-h-[40vh] lg:max-h-none dark-scroll">
            {panelInfo.next_in_line.length > 0 ? (
              panelInfo.next_in_line.map((person, index) => (
                <div
                  key={person.queue_number}
                  className="flex items-center justify-between rounded px-3 sm:px-4 py-2.5 sm:py-3"
                  style={{
                    background: index === 0 ? 'rgba(255,205,7,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${index === 0 ? 'rgba(255,205,7,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <span className="text-xl sm:text-2xl font-black tabular-nums" style={{ color: index === 0 ? 'var(--gov-yellow)' : 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-primary)' }}>
                    #{person.queue_number.toString().padStart(3, '0')}
                  </span>
                  <span className="font-semibold text-xs sm:text-sm" style={{ color: index === 0 ? 'rgba(255,205,7,0.8)' : 'rgba(255,255,255,0.4)' }}>
                    {person.student_name.split(' ').slice(0, 2).join(' ')}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center text-white/30 py-8">
                <p className="text-center text-sm sm:text-base">Nenhuma pessoa na fila</p>
              </div>
            )}
          </div>
        </div>

        {/* Últimos Atendidos */}
        <div className="lg:col-span-3 rounded p-4 sm:p-5 flex flex-col" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-xs sm:text-sm font-bold uppercase tracking-widest text-white/40 mb-3 sm:mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
            Últimos Atendidos
          </h2>
          <div className="flex-1 space-y-2 overflow-y-auto max-h-[30vh] lg:max-h-none dark-scroll">
            {panelInfo.recently_served.length > 0 ? (
              panelInfo.recently_served.map((person) => (
                <div
                  key={person.queue_number}
                  className="flex items-center justify-between rounded px-3 sm:px-4 py-2.5 sm:py-3"
                  style={{ background: 'rgba(22,136,33,0.1)', border: '1px solid rgba(22,136,33,0.25)' }}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
                    <span className="text-lg sm:text-xl font-bold text-green-400 tabular-nums">
                      #{person.queue_number.toString().padStart(3, '0')}
                    </span>
                  </div>
                  <span className="text-xs sm:text-sm font-medium text-green-400/60">
                    {person.student_name.split(' ')[0]}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center text-white/30 py-8">
                <p className="text-center text-sm">Nenhum atendimento ainda</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: 'var(--gov-blue-dark)', borderTop: '3px solid var(--gov-yellow)' }} className="py-3 sm:py-4 px-4 sm:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/50 text-xs sm:text-sm font-medium">
            📱 Escaneie o QR Code da sua ficha ao chegar
          </p>
          
          <div className="inline-flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/10">
            <span className="text-[10px] sm:text-xs font-medium text-white/60 uppercase tracking-widest">Desenvolvido por</span>
            <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
            <span className="text-xs sm:text-sm font-bold text-white/90">Pedro Victor & Pedro Borges</span>
          </div>

          <p className="text-white/40 text-xs sm:text-sm font-bold flex-shrink-0 hidden lg:block">
            IFPE Belo Jardim
          </p>
        </div>
      </div>
    </div>
  )
}
