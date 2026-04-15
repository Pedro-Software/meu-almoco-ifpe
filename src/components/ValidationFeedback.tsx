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

    // Auto close success and warning after 3.5 seconds
    if (type === 'success' || type === 'skip_alert') {
      const timer = setTimeout(() => {
        onClose()
      }, 3500)
      return () => clearTimeout(timer)
    }
  }, [type, onClose])

  if (!type) return null

  const config = {
    success: {
      bg: 'bg-green-500',
      icon: <CheckCircle2 className="w-24 h-24 text-white mb-4 animate-bounce" />,
      titleColor: 'text-white'
    },
    skip_alert: {
      bg: 'bg-yellow-500',
      icon: <AlertTriangle className="w-24 h-24 text-white mb-4 animate-pulse" />,
      titleColor: 'text-white'
    },
    error: {
      bg: 'bg-red-500',
      icon: <XCircle className="w-24 h-24 text-white mb-4 animate-[wiggle_1s_ease-in-out_infinite]" />,
      titleColor: 'text-white'
    }
  }

  const current = config[type]

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-6 transition-all duration-300 animate-in fade-in zoom-in-95 ${current.bg}`}>
      <div className="flex flex-col items-center text-center">
        {current.icon}
        <h2 className={`text-4xl font-extrabold mb-2 ${current.titleColor}`}>
          {title}
        </h2>
        <p className="text-white/90 text-xl font-medium mb-8 max-w-sm">
          {message}
        </p>
        
        <button
          onClick={onClose}
          className="bg-white/20 hover:bg-white/30 text-white border-2 border-white/50 backdrop-blur-sm rounded-full px-8 py-3 font-semibold text-lg transition-colors"
        >
          {type === 'error' ? 'Tentar Novamente' : 'Continuar'}
        </button>
      </div>
    </div>
  )
}
