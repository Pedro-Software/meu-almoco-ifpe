'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface QueueInfo {
  currentNumber: number
  totalWaiting: number
  totalToday: number
  avgServiceTime: number
  maxTickets: number
}

export function useRealtimeQueue() {
  const [queueInfo, setQueueInfo] = useState<QueueInfo>({
    currentNumber: 0,
    totalWaiting: 0,
    totalToday: 0,
    avgServiceTime: 45,
    maxTickets: 200,
  })
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  const fetchQueueInfo = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_queue_info')
    if (!error && data) {
      setQueueInfo({
        currentNumber: data.current_number || 0,
        totalWaiting: data.total_waiting || 0,
        totalToday: data.total_today || 0,
        avgServiceTime: data.avg_service_time_seconds || 45,
        maxTickets: data.max_tickets || 200,
      })
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
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

    // Subscribe para novos tickets
    const ticketChannel = supabase
      .channel('realtime:tickets')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => {
          fetchQueueInfo()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(queueChannel)
      supabase.removeChannel(ticketChannel)
    }
  }, [supabase, fetchQueueInfo])

  return { queueInfo, loading, refetch: fetchQueueInfo }
}
