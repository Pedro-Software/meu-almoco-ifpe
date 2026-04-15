'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError('E-mail ou senha inválidos.')
      } else {
        router.push('/dashboard')
        router.refresh()
      }
    } catch (err) {
      setError('Ocorreu um erro inesperado.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-sm text-center">
          <div className="w-20 h-20 bg-[#00913f] rounded-3xl mx-auto flex items-center justify-center shadow-lg rotate-3">
             <span className="text-white text-3xl font-black -rotate-3">IF</span>
          </div>
          <h2 className="mt-8 text-center text-3xl font-extrabold text-gray-900 tracking-tight">
            Meu Almoço IFPE
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Acesse o refeitório inteligente do campus
          </p>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-sm">
          <form className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-gray-100 space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm text-center font-medium">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-semibold leading-6 text-gray-900">
                E-mail Institucional
              </label>
              <div className="mt-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full rounded-xl border-0 py-3 px-4 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-[#00913f] sm:text-sm sm:leading-6"
                  placeholder="aluno@discente.ifpe.edu.br"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold leading-6 text-gray-900">
                  Senha
                </label>
              </div>
              <div className="mt-2">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-xl border-0 py-3 px-4 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-[#00913f] sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center items-center gap-2 rounded-xl bg-[#00913f] px-3 py-3.5 text-sm font-bold leading-6 text-white shadow-sm hover:bg-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00913f] transition-all disabled:opacity-75 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar'}
              </button>
            </div>
          </form>

          <p className="mt-8 text-center text-sm text-gray-500">
            Ainda não tem conta?{' '}
            <Link href="/register" className="font-semibold leading-6 text-[#00913f] hover:text-green-700">
              Faça seu cadastro agora
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
