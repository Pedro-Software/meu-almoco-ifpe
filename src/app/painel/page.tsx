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
    const { data, error } = await supabase.rpc('get_public_panel_info')
    if (!error && data) {
      setPanelInfo(data)
    }
  }, [supabase])

  useEffect(() => {
    fetchPanelInfo()

    // Atualizar a cada 5 segundos
    const interval = setInterval(fetchPanelInfo, 5000)

    // Relógio
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)

    // Subscribe para atualizações em tempo real
    const queueChannel = supabase
      .channel('painel:queue_state')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'queue_state' },
        () => fetchPanelInfo()
      )
      .subscribe()

    const ticketChannel = supabase
      .channel('painel:tickets')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => fetchPanelInfo()
      )
      .subscribe()

    return () => {
      clearInterval(interval)
      clearInterval(clockInterval)
      supabase.removeChannel(queueChannel)
      supabase.removeChannel(ticketChannel)
    }
  }, [supabase, fetchPanelInfo])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  if (!panelInfo) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-green-400"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#00913f] to-green-600 px-8 py-4 flex justify-between items-center shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
            <Utensils className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Meu Almoço IFPE</h1>
            <p className="text-green-100 text-sm font-medium">Refeitório — Painel de Atendimento</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-mono font-bold tabular-nums">{formatTime(currentTime)}</div>
          <p className="text-green-100 text-sm">{currentTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-12 gap-6 p-6">
        
        {/* Número Atual - Destaque Principal */}
        <div className="col-span-5 flex flex-col gap-6">
          <div className="flex-1 bg-gradient-to-br from-green-600 to-[#00913f] rounded-3xl p-8 flex flex-col items-center justify-center shadow-2xl relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-48 h-48 bg-white/5 rounded-full"></div>
            <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-white/5 rounded-full"></div>
            <h2 className="text-green-100 text-xl font-bold uppercase tracking-widest mb-4">Chamando Agora</h2>
            <div className="text-[10rem] font-black leading-none tabular-nums drop-shadow-lg">
              {panelInfo.current_number > 0 ? panelInfo.current_number : '-'}
            </div>
            {panelInfo.next_in_line.length > 0 && panelInfo.current_number > 0 && (
              <div className="mt-4 bg-white/10 rounded-xl px-6 py-3 backdrop-blur-sm">
                <p className="text-green-100 text-sm font-medium">
                  Apresente-se com seu QR Code
                </p>
              </div>
            )}
          </div>

          {/* Estatísticas */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-2xl p-5 text-center border border-gray-700">
              <Users className="w-6 h-6 text-blue-400 mx-auto mb-2" />
              <span className="text-3xl font-black tabular-nums">{panelInfo.total_waiting}</span>
              <span className="block text-xs text-gray-400 font-bold uppercase mt-1">Na Fila</span>
            </div>
            <div className="bg-gray-800 rounded-2xl p-5 text-center border border-gray-700">
              <CheckCircle2 className="w-6 h-6 text-green-400 mx-auto mb-2" />
              <span className="text-3xl font-black tabular-nums">{panelInfo.total_served}</span>
              <span className="block text-xs text-gray-400 font-bold uppercase mt-1">Atendidos</span>
            </div>
            <div className="bg-gray-800 rounded-2xl p-5 text-center border border-gray-700">
              <Clock className="w-6 h-6 text-orange-400 mx-auto mb-2" />
              <span className="text-3xl font-black tabular-nums">{panelInfo.total_today}</span>
              <span className="block text-xs text-gray-400 font-bold uppercase mt-1">Total Hoje</span>
            </div>
          </div>
        </div>

        {/* Próximos na Fila */}
        <div className="col-span-4 bg-gray-800 rounded-3xl p-6 border border-gray-700 flex flex-col">
          <h2 className="text-lg font-bold uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-yellow-400" />
            Próximos a Serem Chamados
          </h2>
          <div className="flex-1 space-y-2 overflow-hidden">
            {panelInfo.next_in_line.length > 0 ? (
              panelInfo.next_in_line.map((person, index) => (
                <div 
                  key={person.queue_number}
                  className={`flex items-center justify-between rounded-xl px-5 py-4 transition-all ${
                    index === 0 
                      ? 'bg-yellow-500/20 border-2 border-yellow-500/50 animate-[pulse_3s_ease-in-out_infinite]' 
                      : 'bg-gray-700/50 border border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className={`text-3xl font-black tabular-nums ${
                      index === 0 ? 'text-yellow-400' : 'text-gray-300'
                    }`}>
                      #{person.queue_number.toString().padStart(3, '0')}
                    </span>
                  </div>
                  <span className={`font-semibold text-sm ${
                    index === 0 ? 'text-yellow-200' : 'text-gray-400'
                  }`}>
                    {person.student_name.split(' ').slice(0, 2).join(' ')}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <p className="text-center text-lg">Nenhuma pessoa na fila</p>
              </div>
            )}
          </div>
        </div>

        {/* Últimos Atendidos */}
        <div className="col-span-3 bg-gray-800 rounded-3xl p-6 border border-gray-700 flex flex-col">
          <h2 className="text-lg font-bold uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            Últimos Atendidos
          </h2>
          <div className="flex-1 space-y-2 overflow-hidden">
            {panelInfo.recently_served.length > 0 ? (
              panelInfo.recently_served.map((person) => (
                <div 
                  key={person.queue_number}
                  className="flex items-center justify-between bg-green-900/30 border border-green-800/50 rounded-xl px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="text-2xl font-bold text-green-400 tabular-nums">
                      #{person.queue_number.toString().padStart(3, '0')}
                    </span>
                  </div>
                  <span className="text-sm text-green-300/70 font-medium">
                    {person.student_name.split(' ')[0]}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <p className="text-center">Nenhum atendimento ainda</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer ticker */}
      <div className="bg-gradient-to-r from-[#00913f] to-green-600 py-3 px-8">
        <div className="flex items-center justify-between">
          <p className="text-green-100 text-sm font-medium">
            📱 Escaneie o QR Code da sua ficha ao chegar • Fila virtual — sem necessidade de esperar presencialmente
          </p>
          <p className="text-green-100 text-sm font-mono font-bold">
            IFPE Belo Jardim
          </p>
        </div>
      </div>
    </div>
  )
}
