'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface QueueInfo {
  currentNumber: number
  totalWaiting: number
  totalToday: number
  avgServiceTime: number
  maxTickets: number
  alertThreshold: number
}

export function useRealtimeQueue() {
  const [queueInfo, setQueueInfo] = useState<QueueInfo>({
    currentNumber: 0,
    totalWaiting: 0,
    totalToday: 0,
    avgServiceTime: 45,
    maxTickets: 200,
    alertThreshold: 10,
  })
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  const fetchQueueInfo = useCallback(async () => {
    // Buscar dados do painel público (baseado em reservations)
    const { data, error } = await supabase.rpc('get_public_panel_reservations')
    if (!error && data) {
      // Buscar também alert_threshold e max_tickets do queue_state
      const { data: qState } = await supabase
        .from('queue_state')
        .select('avg_service_time_seconds, max_tickets, alert_threshold')
        .eq('id', 1)
        .single()

      setQueueInfo({
        currentNumber: data.current_number || 0,
        totalWaiting: data.total_waiting || 0,
        totalToday: data.total_today || 0,
        avgServiceTime: qState?.avg_service_time_seconds || 45,
        maxTickets: qState?.max_tickets || 200,
        alertThreshold: qState?.alert_threshold || 10,
      })
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchQueueInfo()

    // Subscribe para mudanças na tabela queue_state
    const queueChannel = supabase
      .channel('realtime:queue_state')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'queue_state' },
        () => {
          fetchQueueInfo()
        }
      )
      .subscribe()

    // Subscribe para mudanças em reservations (substitui tickets)
    const reservationChannel = supabase
      .channel('realtime:reservations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        () => {
          fetchQueueInfo()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(queueChannel)
      supabase.removeChannel(reservationChannel)
    }
  }, [supabase, fetchQueueInfo])

  return { queueInfo, loading, refetch: fetchQueueInfo }
}
