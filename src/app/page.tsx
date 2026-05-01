import Link from 'next/link'
import { Utensils } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      
      {/* Esquerda: Branding Institucional (Oculto no mobile) */}
      <div className="hidden md:flex md:flex-1 md:w-5/12 flex-col justify-between p-8 md:p-12 text-white relative overflow-hidden" 
           style={{ background: 'linear-gradient(135deg, var(--gov-blue-dark) 0%, var(--gov-blue) 100%)' }}>
        
        {/* Decorative background elements */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white opacity-5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 -right-10 w-64 h-64 bg-white opacity-5 rounded-full blur-2xl"></div>

        <div className="relative z-10 flex flex-col h-full">
          {/* Faixa GOV.BR Topo */}
          <div className="flex items-center gap-2 text-xs md:text-sm font-medium opacity-80 mb-12">
            <span className="font-bold tracking-wider">GOV.BR</span>
            <span>|</span>
            <span>IFPE — Instituto Federal de Pernambuco</span>
          </div>

          <div className="mt-auto mb-auto max-w-lg">
            <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/20 mb-6 shadow-xl">
              <Utensils className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl md:text-5xl font-black mb-4 leading-tight tracking-tight" style={{ fontFamily: 'var(--font-primary)' }}>
              Meu Almoço <br/>IFPE
            </h1>
            <p className="text-lg md:text-xl font-medium opacity-80 leading-relaxed max-w-md">
              Sistema inteligente para reservas e controle de acesso ao refeitório do Campus Belo Jardim.
            </p>
          </div>

          <div className="mt-12">
            <p className="opacity-60 text-xs md:text-sm mb-3">Desenvolvido para uso exclusivo de alunos e servidores.</p>
            <div className="inline-flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/20 backdrop-blur-sm shadow-lg">
              <span className="text-xs font-medium text-white/80 tracking-wide uppercase">Desenvolvido por</span>
              <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
              <span className="text-sm font-bold text-white">Pedro Victor & Pedro Borges</span>
            </div>
          </div>
        </div>
      </div>

      {/* Direita: Ações */}
      <div className="flex-1 md:w-7/12 bg-white flex flex-col justify-center px-6 py-12 md:px-16 lg:px-24">
        
        {/* Mobile Header (Visível apenas em telas pequenas) */}
        <div className="md:hidden mb-8 text-center">
           <div className="w-14 h-14 bg-[var(--gov-blue)] rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <Utensils className="w-7 h-7 text-white" />
           </div>
           <h2 className="text-2xl font-black" style={{ color: 'var(--gov-blue-dark)' }}>Meu Almoço IFPE</h2>
        </div>

        <div className="w-full max-w-sm mx-auto animate-fade-in-up">
          <div className="mb-8">
            <h2 className="text-3xl font-extrabold mb-2" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
              Bem-vindo
            </h2>
            <p className="text-[15px] leading-relaxed" style={{ color: 'var(--gray-60)' }}>
              Acesse o sistema para reservar sua refeição e gerar sua ficha digital.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Link
              href="/login"
              className="w-full text-center py-3.5 px-6 rounded-lg font-bold text-white transition-all transform hover:-translate-y-0.5"
              style={{ background: 'var(--gov-blue)', boxShadow: '0 4px 14px rgba(19,81,180,0.3)' }}
            >
              Entrar com E-mail Institucional
            </Link>

            <Link
              href="/register"
              className="w-full text-center py-3.5 px-6 rounded-lg font-bold transition-all border-2 hover:bg-gray-50"
              style={{ borderColor: 'var(--gov-blue)', color: 'var(--gov-blue)' }}
            >
              Sou Aluno Novo — Cadastrar
            </Link>
          </div>

          {/* Link painel */}
          <div className="mt-12 text-center pt-8 border-t border-gray-100">
            <Link
              href="/painel"
              className="inline-flex items-center gap-2 text-sm font-semibold transition-opacity hover:opacity-70"
              style={{ color: 'var(--gov-blue)' }}
            >
              <span className="text-lg">📺</span>
              Acessar Painel do Refeitório (TV)
            </Link>
          </div>

          {/* Assinatura visível apenas no mobile */}
          <div className="md:hidden mt-8 pt-8 border-t border-gray-100 text-center flex flex-col items-center">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Desenvolvido por</span>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: 'var(--gov-blue-dark)' }}>
              <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
              <span className="text-xs font-bold text-white">Pedro Victor & Pedro Borges</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  )
}
