'use client'

import { formatEstimate } from '@/lib/utils'
import { Users, Timer, Activity } from 'lucide-react'

interface QueueInfo {
  currentNumber: number
  totalWaiting: number
  avgServiceTime: number
  maxTickets: number
}

interface QueuePanelProps {
  queueInfo: QueueInfo
  userQueueNumber?: number
}

export function QueuePanel({ queueInfo, userQueueNumber }: QueuePanelProps) {
  const hasTicket = userQueueNumber !== undefined
  const peopleAhead = hasTicket 
    ? Math.max(0, userQueueNumber - queueInfo.currentNumber)
    : queueInfo.totalWaiting

  const estimate = formatEstimate(peopleAhead, queueInfo.avgServiceTime)

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Current Number */}
      <div className="col-span-2 bg-gradient-to-br from-green-500 to-[#00913f] rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-4 -mt-4 opacity-10">
          <Users className="w-32 h-32" />
        </div>
        <h3 className="text-green-50 text-sm font-medium mb-1">Chamando Agora</h3>
        <div className="text-5xl font-black tabular-nums">
          {queueInfo.currentNumber > 0 ? `#${queueInfo.currentNumber}` : '-'}
        </div>
        {hasTicket && (
          <div className="mt-4 pt-4 border-t border-green-400/30 flex justify-between items-center text-sm">
            <span>Sua Senha</span>
            <span className="font-bold text-lg">#{userQueueNumber}</span>
          </div>
        )}
      </div>

      {/* Waiting Stats */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
        <Activity className="w-6 h-6 text-blue-500 mb-2" />
        <span className="text-2xl font-bold text-gray-800 tabular-nums">{queueInfo.totalWaiting}</span>
        <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider mt-1">Na Fila</span>
      </div>

      {/* Estimate */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
        <Timer className="w-6 h-6 text-orange-500 mb-2" />
        <span className="text-lg font-bold text-gray-800">{hasTicket && peopleAhead === 0 ? "Sua vez!" : estimate}</span>
        <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider mt-1">Aproximado</span>
      </div>
    </div>
  )
}
