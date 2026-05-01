'use client'

import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { useEffect } from 'react'

export type FeedbackType = 'success' | 'skip_alert' | 'error' | null

interface ValidationFeedbackProps {
  type: FeedbackType
  title: string
  message: string
  onClose: () => void
}

export function ValidationFeedback({ type, title, message, onClose }: ValidationFeedbackProps) {
  useEffect(() => {
    if (!type) return
    if (type === 'success' || type === 'skip_alert') {
      const timer = setTimeout(() => onClose(), 3500)
      return () => clearTimeout(timer)
    }
  }, [type, onClose])

  if (!type) return null

  const config = {
    success: {
      bg: 'var(--gov-green)',
      border: '#146b1a',
      icon: <CheckCircle2 className="w-20 h-20 text-white mb-4 animate-bounce" />,
    },
    skip_alert: {
      bg: '#B25000',
      border: '#7a3700',
      icon: <AlertTriangle className="w-20 h-20 text-white mb-4 animate-pulse" />,
    },
    error: {
      bg: 'var(--gov-red)',
      border: '#b01a06',
      icon: <XCircle className="w-20 h-20 text-white mb-4 animate-[wiggle_1s_ease-in-out_infinite]" />,
    },
  }

  const current = config[type]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in"
      style={{ background: current.bg }}
    >
      <div className="flex flex-col items-center text-center max-w-sm">
        {current.icon}
        <h2 className="text-4xl font-extrabold mb-3 text-white" style={{ fontFamily: 'var(--font-primary)' }}>
          {title}
        </h2>
        <p className="text-white/90 text-lg font-medium mb-8 leading-relaxed">
          {message}
        </p>
        <button
          onClick={onClose}
          className="rounded px-8 py-3 font-bold text-lg transition-colors"
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: '2px solid rgba(255,255,255,0.4)',
            color: '#fff',
          }}
        >
          {type === 'error' ? 'Tentar Novamente' : 'Continuar'}
        </button>
      </div>
    </div>
  )
}
