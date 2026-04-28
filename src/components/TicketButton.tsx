'use client'

import { useState } from 'react'
import { useCountdown } from '@/hooks/useCountdown'
import { createClient } from '@/lib/supabase/client'
import { formatTimeRemaining } from '@/lib/utils'
import { Utensils, Clock, AlertCircle, Loader2 } from 'lucide-react'

interface TicketButtonProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onTicketIssued: (ticket: any) => void
}

export function TicketButton({ onTicketIssued }: TicketButtonProps) {
  const { totalSeconds, isOpen, isClosed } = useCountdown()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const supabase = createClient()

  const handleGetTicket = async () => {
    if (!isOpen) return
    
    setLoading(true)
    setError(null)
    
    try {
      const { data, error: rpcError } = await supabase.rpc('issue_ticket')
      
      if (rpcError) {
        console.error('RPC Error details:', rpcError)
        setError(`Erro no servidor: ${rpcError.message || rpcError.details || 'Erro desconhecido'}`)
      } else if (data.error) {
        setError(data.error)
      } else if (data.success) {
        onTicketIssued(data.ticket)
      }
    } catch (err) {
      setError('Ocorreu um erro inesperado.')
    } finally {
      setLoading(false)
    }
  }

  if (isClosed) {
    return (
      <div className="w-full bg-gray-100 rounded-xl p-6 text-center">
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-gray-600">Distribuição Encerrada</h3>
        <p className="text-gray-500 text-sm mt-1">O horário de emissão de fichas para hoje já acabou.</p>
      </div>
    )
  }

  if (!isOpen) {
    return (
      <div className="w-full bg-orange-50 rounded-xl p-6 text-center border border-orange-100">
        <Clock className="w-12 h-12 text-orange-400 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-gray-800">Próxima Abertura</h3>
        <p className="text-gray-600 mt-2 font-mono text-2xl font-bold">
          {formatTimeRemaining(totalSeconds)}
        </p>
        <p className="text-orange-600 text-sm mt-2">Aguarde o horário para pegar sua ficha (11:30)</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <button
        onClick={handleGetTicket}
        disabled={loading}
        className="w-full bg-[#00913f] hover:bg-green-700 disabled:opacity-75 disabled:cursor-not-allowed text-white rounded-2xl py-5 px-6 shadow-lg transform transition-all active:scale-95 flex flex-col items-center justify-center gap-2"
      >
        {loading ? (
          <Loader2 className="w-8 h-8 animate-spin" />
        ) : (
          <Utensils className="w-8 h-8" />
        )}
        <span className="text-xl font-bold">Pegar Ficha Agora</span>
      </button>

      {error && (
        <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}
