'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Volume2 } from 'lucide-react'

interface QueueAlertProps {
  peopleAhead: number
  alertThreshold: number
  isYourTurn: boolean
  hasTicket: boolean
}

export function QueueAlert({ peopleAhead, alertThreshold, isYourTurn, hasTicket }: QueueAlertProps) {
  const [lastAlertCount, setLastAlertCount] = useState<number | null>(null)
  const [showAlert, setShowAlert] = useState(false)
  const [alertMessage, setAlertMessage] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    // Criar o áudio programaticamente usando Web Audio API
    if (typeof window !== 'undefined' && !audioRef.current) {
      audioRef.current = new Audio()
    }
  }, [])

  const playAlertSound = () => {
    try {
      // Usar Web Audio API para gerar um beep
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const oscillator = audioCtx.createOscillator()
      const gainNode = audioCtx.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioCtx.destination)
      
      oscillator.frequency.value = isYourTurn ? 880 : 660
      oscillator.type = 'sine'
      gainNode.gain.value = 0.3
      
      oscillator.start()
      
      // Fade out
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8)
      oscillator.stop(audioCtx.currentTime + 0.8)
    } catch {
      // Audio não suportado
    }
  }

  useEffect(() => {
    if (!hasTicket) return

    if (isYourTurn) {
      setAlertMessage('🎉 É a sua vez! Dirija-se ao refeitório!')
      setShowAlert(true)
      playAlertSound()
      return
    }

    if (peopleAhead <= alertThreshold && peopleAhead > 0) {
      // Só alerta se mudou (pessoa saiu)
      if (lastAlertCount === null || peopleAhead < lastAlertCount) {
        setLastAlertCount(peopleAhead)
        
        if (peopleAhead <= 3) {
          setAlertMessage(`⚡ Faltam apenas ${peopleAhead} pessoa${peopleAhead > 1 ? 's' : ''}! Vá para o refeitório AGORA!`)
        } else if (peopleAhead <= 5) {
          setAlertMessage(`🔔 Faltam ${peopleAhead} pessoas para sua vez! Comece a se dirigir ao refeitório.`)
        } else {
          setAlertMessage(`📢 Faltam ${peopleAhead} pessoas para sua vez. Prepare-se!`)
        }
        setShowAlert(true)
        playAlertSound()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleAhead, isYourTurn, hasTicket, alertThreshold])

  if (!hasTicket || !showAlert) return null

  const isUrgent = isYourTurn || peopleAhead <= 3
  const isWarning = peopleAhead <= 5 && !isUrgent

  return (
    <div 
      className={`rounded-2xl p-4 shadow-lg border-2 animate-[pulse_2s_ease-in-out_infinite] ${
        isUrgent 
          ? 'bg-red-50 border-red-300 text-red-800' 
          : isWarning 
            ? 'bg-orange-50 border-orange-300 text-orange-800' 
            : 'bg-blue-50 border-blue-300 text-blue-800'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-full ${
          isUrgent ? 'bg-red-200' : isWarning ? 'bg-orange-200' : 'bg-blue-200'
        }`}>
          {isUrgent ? (
            <BellRing className="w-6 h-6 animate-[wiggle_0.5s_ease-in-out_infinite]" />
          ) : (
            <Bell className="w-6 h-6" />
          )}
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">{alertMessage}</p>
          {!isYourTurn && (
            <p className="text-xs mt-1 opacity-80">
              Sua senha será chamada em breve. Tempo estimado: ~{Math.ceil(peopleAhead * 0.75)} min
            </p>
          )}
        </div>
        <button 
          onClick={() => setShowAlert(false)}
          className="text-current opacity-50 hover:opacity-100 transition p-1"
          aria-label="Fechar alerta"
        >
          ✕
        </button>
      </div>
      {isYourTurn && (
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold">
          <Volume2 className="w-4 h-4 animate-pulse" />
          <span>Apresente seu QR Code ao funcionário</span>
        </div>
      )}
    </div>
  )
}
