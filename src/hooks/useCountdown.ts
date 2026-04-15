'use client'

import { useState, useEffect, useCallback } from 'react'
import { secondsUntilTime } from '@/lib/utils'

interface CountdownState {
  hours: number
  minutes: number
  seconds: number
  totalSeconds: number
  isOpen: boolean
  isClosed: boolean
  isUrgent: boolean
}

export function useCountdown(): CountdownState {
  const [totalSeconds, setTotalSeconds] = useState<number>(() =>
    secondsUntilTime(11, 30)
  )

  const getState = useCallback((): CountdownState => {
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()

    const isOpen = currentMinutes >= 690 && currentMinutes <= 780 // 11:30 - 13:00
    const isClosed = currentMinutes > 780

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const isUrgent = totalSeconds <= 60 && totalSeconds > 0

    return { hours, minutes, seconds, totalSeconds, isOpen, isClosed, isUrgent }
  }, [totalSeconds])

  useEffect(() => {
    const interval = setInterval(() => {
      setTotalSeconds(secondsUntilTime(11, 30))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return getState()
}
