'use client'

import { QRCodeSVG } from 'qrcode.react'
import { useState, useEffect } from 'react'
import { ShieldAlert, RefreshCw } from 'lucide-react'

interface QRCodeDisplayProps {
  qrToken: string
  queueNumber: number
}

export function QRCodeDisplay({ qrToken, queueNumber }: QRCodeDisplayProps) {
  const [timeLeft, setTimeLeft] = useState(300) // 5 minutos = 300 segundos

  useEffect(() => {
    if (timeLeft <= 0) return

    const interval = setInterval(() => {
      setTimeLeft((prev) => prev - 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [timeLeft])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const isExpired = timeLeft <= 0

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col items-center text-center">
      <h2 className="text-xl font-bold text-gray-800 mb-2">Sua Ficha</h2>
      <p className="text-gray-500 text-sm mb-6">Apresente este QR Code no refeitório</p>

      <div className={`relative p-4 rounded-xl ${isExpired ? 'bg-red-50' : 'bg-gray-50'}`}>
        {!isExpired ? (
          <QRCodeSVG 
            value={qrToken} 
            size={200}
            level="H"
            includeMargin={true}
            className="rounded-lg shadow-sm"
          />
        ) : (
          <div className="w-[200px] h-[200px] flex flex-col items-center justify-center text-red-500">
            <ShieldAlert className="w-16 h-16 mb-2" />
            <span className="font-medium text-sm">QR Code Expirado</span>
            <span className="text-xs text-red-400 text-center mt-2 px-4">
              Por segurança, o código expira após 5 minutos.
            </span>
          </div>
        )}
      </div>

      <div className="mt-8 font-mono text-3xl font-black text-[#00913f] tracking-tighter">
        #{queueNumber.toString().padStart(3, '0')}
      </div>

      {!isExpired ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500 bg-gray-50 px-4 py-2 rounded-full">
          <RefreshCw className="w-4 h-4 animate-spin-slow" />
          <span>Válido por {formatTime(timeLeft)}</span>
        </div>
      ) : (
        <button 
          onClick={() => window.location.reload()}
          className="mt-6 bg-gray-800 text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-gray-700 transition"
        >
          Atualizar Página
        </button>
      )}
    </div>
  )
}
