'use client'

import { QRCodeSVG } from 'qrcode.react'
import { useState, useEffect } from 'react'
import { ShieldAlert, RefreshCw, Hash } from 'lucide-react'

interface QRCodeDisplayProps {
  qrToken: string
  queueNumber: number
}

export function QRCodeDisplay({ qrToken, queueNumber }: QRCodeDisplayProps) {
  const [timeLeft, setTimeLeft] = useState(300)

  useEffect(() => {
    if (timeLeft <= 0) return
    const interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000)
    return () => clearInterval(interval)
  }, [timeLeft])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const isExpired = timeLeft <= 0
  const progress = Math.max(0, (timeLeft / 300) * 100)
  const progressColor = timeLeft > 120 ? 'var(--gov-blue)' : timeLeft > 60 ? 'var(--gov-orange)' : 'var(--gov-red)'

  return (
    <div className="gov-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '2px solid var(--gray-5)', background: 'var(--gov-blue-dark)' }}>
        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-yellow)' }}>
          <Hash className="w-4 h-4" style={{ color: 'var(--gov-blue-dark)' }} />
        </div>
        <div>
          <h2 className="text-white font-bold text-base">Sua Ficha de Almoço</h2>
          <p className="text-white/50 text-xs">Apresente este QR Code no refeitório</p>
        </div>
      </div>

      <div className="p-6 flex flex-col items-center">

        {/* Número da fila em destaque */}
        <div className="mb-5 text-center">
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--gray-40)' }}>Número na Fila</p>
          <div
            className="text-6xl font-black tabular-nums"
            style={{ color: 'var(--gov-blue)', fontFamily: 'var(--font-primary)', lineHeight: 1 }}
          >
            #{queueNumber.toString().padStart(3, '0')}
          </div>
        </div>

        {/* Orientação especial para fichas 001-010 */}
        {queueNumber >= 1 && queueNumber <= 10 && (
          <div
            className="w-full flex items-start gap-3 p-3.5 rounded-lg mb-5 text-sm animate-fade-in"
            style={{ background: '#FFF8E1', border: '1.5px solid #FFD54F' }}
          >
            <p className="leading-snug" style={{ color: '#5D4037' }}>
              <strong>Sua ficha está entre 001 e 010.</strong> Dirija-se à frente do refeitório às <strong>11:50</strong> para aguardar o início do atendimento.
            </p>
          </div>
        )}

        {/* QR Code */}
        <div
          className="p-4 rounded mb-4"
          style={{ background: isExpired ? 'var(--gov-red-light)' : 'var(--gray-2)', border: `2px solid ${isExpired ? '#f4a9a1' : 'var(--gray-5)'}` }}
        >
          {!isExpired ? (
            <QRCodeSVG
              value={qrToken}
              size={180}
              level="H"
              includeMargin={true}
              className="rounded"
            />
          ) : (
            <div className="w-[180px] h-[180px] flex flex-col items-center justify-center" style={{ color: 'var(--gov-red)' }}>
              <ShieldAlert className="w-14 h-14 mb-3" />
              <span className="font-bold text-sm text-center">QR Code Expirado</span>
              <span className="text-xs text-center mt-1 px-4 opacity-70">Por segurança, o código expira após 5 minutos.</span>
            </div>
          )}
        </div>

        {/* Timer */}
        {!isExpired ? (
          <div className="w-full">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: progressColor }}>
                <RefreshCw className="w-3 h-3 animate-spin-slow" />
                Válido por {formatTime(timeLeft)}
              </span>
              <span className="text-xs font-bold" style={{ color: progressColor }}>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--gray-5)' }}>
              <div
                className="h-2 rounded-full transition-all duration-1000"
                style={{ width: `${progress}%`, background: progressColor }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => window.location.reload()}
            className="btn-gov-primary mt-2"
          >
            Atualizar Página
          </button>
        )}
      </div>
    </div>
  )
}
