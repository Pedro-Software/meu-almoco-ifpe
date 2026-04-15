import Link from 'next/link'
import { Utensils } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-24 h-24 bg-[#00913f] rounded-[2rem] mx-auto flex items-center justify-center shadow-2xl mb-8 rotate-3 transform hover:rotate-6 transition-transform">
          <Utensils className="w-12 h-12 text-white -rotate-3" />
        </div>
        
        <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-3">
          Meu Almoço <span className="text-[#00913f]">IFPE</span>
        </h1>
        <p className="text-lg text-gray-600 mb-10 font-medium">
          O novo sistema inteligente de distribuição de fichas do refeitório.
        </p>

        <div className="space-y-4">
          <Link 
            href="/login"
            className="flex w-full justify-center items-center rounded-2xl bg-[#00913f] px-4 py-4 text-lg font-bold text-white shadow-lg shadow-green-600/30 hover:bg-green-700 transition-all active:scale-[0.98]"
          >
            Entrar no Sistema
          </Link>
          
          <Link 
            href="/register"
            className="flex w-full justify-center items-center rounded-2xl bg-white border-2 border-gray-200 px-4 py-4 text-lg font-bold text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50 transition-all active:scale-[0.98]"
          >
            Sou Aluno Novo
          </Link>
        </div>
      </div>
    </div>
  )
}
