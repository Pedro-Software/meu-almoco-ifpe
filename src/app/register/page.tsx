'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isValidIFPEEmail } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

export default function Register() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (!isValidIFPEEmail(email)) {
      setError('Use um email institucional (@discente.ifpe.edu.br ou @ifpe.edu.br)')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres')
      setLoading(false)
      return
    }

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          }
        }
      })

      if (signUpError) {
        setError(signUpError.message)
      } else {
        // Redirect to dashboard on success
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
          <h2 className="mt-4 text-center text-3xl font-extrabold text-gray-900 tracking-tight">
            Criar Conta
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Apenas para alunos do IFPE Belo Jardim
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-sm">
          <form className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-gray-100 space-y-5" onSubmit={handleRegister}>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm text-center font-medium">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-semibold leading-6 text-gray-900">
                Nome Completo
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="block w-full rounded-xl border-0 py-3 px-4 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-[#00913f] sm:text-sm sm:leading-6"
                  placeholder="Pedro Henrique Borges Silva"
                />
              </div>
            </div>

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
              <label className="block text-sm font-semibold leading-6 text-gray-900">
                Senha
              </label>
              <div className="mt-2">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-xl border-0 py-3 px-4 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-[#00913f] sm:text-sm sm:leading-6"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center items-center gap-2 rounded-xl bg-[#00913f] px-3 py-3.5 text-sm font-bold leading-6 text-white shadow-sm hover:bg-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00913f] transition-all disabled:opacity-75 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Cadastrar'}
              </button>
            </div>
          </form>

          <p className="mt-8 text-center text-sm text-gray-500">
            Já possui uma conta?{' '}
            <Link href="/login" className="font-semibold leading-6 text-[#00913f] hover:text-green-700">
              Faça login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
