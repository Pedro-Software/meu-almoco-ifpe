'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Utensils, AlertCircle, ArrowLeft, CheckCircle2, Lock } from 'lucide-react'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.updateUser({
      password: password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
      setTimeout(() => {
        router.push('/login')
      }, 3000)
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      
      {/* Esquerda: Branding Institucional */}
      <div className="hidden md:flex md:w-5/12 flex-col justify-between p-12 text-white relative overflow-hidden" 
           style={{ background: 'linear-gradient(135deg, var(--gov-blue-dark) 0%, var(--gov-blue) 100%)' }}>
        
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white opacity-5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 -right-10 w-64 h-64 bg-white opacity-5 rounded-full blur-2xl"></div>

        <div className="relative z-10 flex flex-col h-full">
          <Link href="/login" className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm font-medium w-fit">
            <ArrowLeft className="w-4 h-4" />
            Voltar para o login
          </Link>

          <div className="mt-auto mb-auto max-w-lg">
            <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/20 mb-6 shadow-xl">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl lg:text-5xl font-black mb-4 leading-tight tracking-tight" style={{ fontFamily: 'var(--font-primary)' }}>
              Nova Senha
            </h1>
            <p className="text-lg font-medium opacity-80 leading-relaxed">
              Defina uma senha forte para garantir a segurança da sua conta institucional.
            </p>
          </div>
          
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs lg:text-sm font-medium opacity-60">
              <span className="font-bold tracking-wider">GOV.BR</span>
              <span>|</span>
              <span>Instituto Federal de Pernambuco</span>
            </div>
            <div className="inline-flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/20 backdrop-blur-sm shadow-lg w-fit">
              <span className="text-xs font-medium text-white/80 tracking-wide uppercase">Desenvolvido por</span>
              <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
              <span className="text-sm font-bold text-white">Pedro Victor & Pedro Borges</span>
            </div>
          </div>
        </div>
      </div>

      {/* Direita: Formulário */}
      <div className="flex-1 md:w-7/12 bg-white flex flex-col justify-center px-6 py-12 md:px-16 lg:px-24 xl:px-32 relative">
        
        <div className="md:hidden absolute top-6 left-6">
          <Link href="/login" className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full inline-flex transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </div>

        <div className="w-full max-w-md mx-auto animate-fade-in-up">
          <div className="mb-8 md:hidden text-center mt-6">
             <div className="w-12 h-12 bg-[var(--gov-blue)] rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg">
                <Lock className="w-6 h-6 text-white" />
             </div>
             <h2 className="text-xl font-black" style={{ color: 'var(--gov-blue-dark)' }}>Meu Almoço IFPE</h2>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-extrabold mb-2" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
              Redefinir Senha
            </h1>
            <p className="text-[15px] leading-relaxed" style={{ color: 'var(--gray-60)' }}>
              Digite e confirme sua nova senha de acesso abaixo.
            </p>
          </div>

          {success ? (
            <div className="p-8 rounded-xl text-center animate-fade-in" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-green-900 mb-2">Senha Alterada!</h3>
              <p className="text-sm text-green-700">
                Sua senha foi atualizada com sucesso. Redirecionando para o login...
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-start gap-3 p-4 rounded-lg mb-6 text-sm font-medium animate-fade-in"
                     style={{ background: 'var(--gov-red-light)', color: 'var(--gov-red)', border: '1px solid #f4a9a1' }}>
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleUpdatePassword} className="flex flex-col gap-5">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-bold mb-2" style={{ color: 'var(--gray-80)' }}>
                    Nova Senha
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-lg border focus:ring-2 focus:outline-none transition-shadow"
                    style={{ borderColor: 'var(--gray-20)', background: '#fff', color: 'var(--gray-90)' }}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-bold mb-2" style={{ color: 'var(--gray-80)' }}>
                    Confirmar Nova Senha
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-lg border focus:ring-2 focus:outline-none transition-shadow"
                    style={{ borderColor: 'var(--gray-20)', background: '#fff', color: 'var(--gray-90)' }}
                    placeholder="Repita a nova senha"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full text-center py-3.5 px-6 rounded-lg font-bold text-white transition-all transform hover:-translate-y-0.5 mt-4 flex justify-center items-center h-[52px]"
                  style={{ 
                    background: 'var(--gov-blue)', 
                    boxShadow: '0 4px 14px rgba(19,81,180,0.3)',
                    opacity: loading ? 0.7 : 1,
                    cursor: loading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Atualizar Senha'}
                </button>
              </form>
            </>
          )}

          {/* Assinatura visível apenas no mobile */}
          <div className="md:hidden mt-8 pt-8 text-center flex flex-col items-center">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Desenvolvido por</span>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full shadow-sm" style={{ background: 'var(--gov-blue-dark)' }}>
              <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
              <span className="text-xs font-bold text-white">Pedro Victor & Pedro Borges</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
