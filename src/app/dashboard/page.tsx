'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WeeklyReservation } from '@/components/WeeklyReservation'
import { QRCodeDisplay } from '@/components/QRCodeDisplay'
import { LogOut, User, BellRing, BarChart3, Settings, Utensils, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { registerServiceWorkerAndSubscribe } from '@/lib/pushNotifications'

export default function Dashboard() {
  const [userName, setUserName] = useState<string>('')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [todayReservation, setTodayReservation] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [userRole, setUserRole] = useState<string>('student')
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      setUserName(user.user_metadata?.full_name?.split(' ')[0] || 'Aluno')

      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (profile) {
        setUserRole(profile.role)
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        const sub = await registerServiceWorkerAndSubscribe()
        if (sub) setPushEnabled(true)
      }

      const { data, error } = await supabase.rpc('get_today_reservation')
      if (!error && data?.has_reservation) {
        setTodayReservation({
          ...data.reservation,
          status: data.status
        })
      }
      setLoading(false)
    }
    loadData()
  }, [supabase, router])

  const handleLogout = () => {
    supabase.auth.signOut()
    router.push('/login')
  }

  const handleEnablePush = async () => {
    const sub = await registerServiceWorkerAndSubscribe()
    if (sub) {
      setPushEnabled(true)
      alert('Notificações ativadas! Você será avisado quando sua vez estiver próxima.')
    } else {
      alert('Não foi possível ativar as notificações. Verifique as permissões do seu navegador.')
    }
  }

  const roleLabel = userRole === 'admin'
    ? 'Administrador'
    : userRole === 'nutricionista'
    ? 'Nutricionista'
    : 'Estudante'

  const roleBadgeColor = userRole === 'admin'
    ? { background: '#071D41', color: '#FFCD07' }
    : userRole === 'nutricionista'
    ? { background: '#1351B4', color: '#fff' }
    : { background: 'rgba(255, 255, 255, 0.2)', color: '#fff' }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--gray-2)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--gov-blue)', borderTopColor: 'transparent' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--gray-40)' }}>Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--gray-2)' }}>

      {/* Faixa GOV.BR */}
      <div className="gov-header-bar px-4 py-1.5 flex items-center gap-2 text-xs">
        <span className="font-bold tracking-wider text-white/90">GOV.BR</span>
        <span className="text-white/40">|</span>
        <span className="text-white/60">IFPE Belo Jardim</span>
      </div>

      {/* Header principal */}
      <header style={{ background: 'var(--gov-blue-dark)' }} className="px-4 py-4 shadow-md">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-blue)' }}>
              <Utensils className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-base leading-tight">Meu Almoço IFPE</p>
              <p className="text-white/50 text-xs">Meu painel</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-semibold transition-colors px-3 py-2 rounded"
            style={{ background: 'rgba(255,255,255,0.1)' }}
            title="Sair"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      {/* Seção do usuário */}
      <div style={{ background: 'var(--gov-blue)', borderBottom: '3px solid var(--gov-yellow)' }} className="px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }}>
            <User size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/70 text-xs font-medium">Bem-vindo,</p>
            <p className="text-white font-bold text-lg leading-tight truncate">{userName}</p>
          </div>
          {roleLabel && (
            <span className="px-3 py-1 rounded text-xs font-bold flex-shrink-0" style={roleBadgeColor}>
              {roleLabel}
            </span>
          )}
        </div>
      </div>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-5">

        {/* Banner de Notificações */}
        {!pushEnabled && 'Notification' in window && Notification.permission !== 'denied' && (
          <div
            className="flex items-start gap-4 p-4 rounded animate-fade-in-up"
            style={{ background: '#E8F0FE', border: '1px solid #c2d5f5' }}
          >
            <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-blue)', opacity: 0.15 }}>
              <BellRing size={18} style={{ color: 'var(--gov-blue)' }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <BellRing size={16} style={{ color: 'var(--gov-blue)' }} />
                <h3 className="font-bold text-sm" style={{ color: 'var(--gov-blue-dark)' }}>Ativar Notificações</h3>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--gov-blue)' }}>
                Seja avisado quando faltarem 5 pessoas para a sua vez na fila.
              </p>
              <button
                onClick={handleEnablePush}
                className="btn-gov-primary text-xs px-4 py-2"
              >
                Permitir Avisos
              </button>
            </div>
          </div>
        )}

        {/* QR Code se tem reserva hoje e não fez check-in */}
        {todayReservation && todayReservation.status === 'reserved' && (
          <div className="animate-fade-in-up">
            <QRCodeDisplay
              qrToken={todayReservation.qr_token}
              queueNumber={todayReservation.queue_number}
            />
          </div>
        )}

        {/* Se já fez check-in hoje */}
        {todayReservation && todayReservation.status === 'confirmed' && (
          <div
            className="gov-card p-6 text-center animate-fade-in-up"
            style={{ borderLeft: '4px solid var(--gov-green)' }}
          >
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--gov-green-light)' }}>
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--gov-green)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--gray-90)' }}>Bom Apetite!</h2>
            <p className="text-sm" style={{ color: 'var(--gray-40)' }}>Seu almoço já foi registrado hoje.</p>
          </div>
        )}

        {/* Reservas da semana */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="w-1 h-5 rounded" style={{ background: 'var(--gov-blue)' }} />
            <h2 className="font-bold text-base" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
              Minhas Reservas
            </h2>
          </div>
          <WeeklyReservation />
        </section>

        {/* Botões de acesso privilegiado */}
        {(userRole === 'admin' || userRole === 'nutricionista') && (
          <section>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="w-1 h-5 rounded" style={{ background: 'var(--gov-yellow)' }} />
              <h2 className="font-bold text-base" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
                Acesso Privilegiado
              </h2>
            </div>

            <div className="flex flex-col gap-3">
              {userRole === 'admin' && (
                <button
                  onClick={() => router.push('/admin')}
                  className="gov-card w-full flex items-center justify-between px-5 py-4 hover:shadow-md transition-shadow cursor-pointer animate-fade-in-up"
                  style={{ borderLeft: '4px solid var(--gov-blue-dark)' }}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-blue-dark)' }}>
                      <Settings className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-sm" style={{ color: 'var(--gray-90)' }}>Painel Administrativo</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--gray-40)' }}>Gestão de filas e validação de QR Codes</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--gray-20)' }} />
                </button>
              )}

              {(userRole === 'admin' || userRole === 'nutricionista') && (
                <button
                  onClick={() => router.push('/nutricionista')}
                  className="gov-card w-full flex items-center justify-between px-5 py-4 hover:shadow-md transition-shadow cursor-pointer animate-fade-in-up"
                  style={{ borderLeft: '4px solid var(--gov-green)' }}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-green)' }}>
                      <BarChart3 className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-sm" style={{ color: 'var(--gray-90)' }}>Painel Nutricional</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--gray-40)' }}>Relatórios e previsões de refeições</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--gray-20)' }} />
                </button>
              )}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer style={{ background: 'var(--gov-blue-dark)', borderTop: '3px solid var(--gov-yellow)' }} className="py-6 px-4 flex flex-col items-center mt-8">
        <p className="text-white/50 text-xs mb-3 font-medium tracking-wide">IFPE Belo Jardim · Sistema Institucional</p>
        <div className="inline-flex items-center gap-2 bg-white/5 px-3 sm:px-4 py-2 rounded-full border border-white/10 whitespace-nowrap">
          <span className="text-[10px] sm:text-xs font-medium text-white/60 uppercase tracking-widest">Desenvolvido por</span>
          <div className="w-1 h-1 rounded-full bg-yellow-400 flex-shrink-0"></div>
          <span className="text-xs sm:text-sm font-bold text-white/90">Pedro Victor & Pedro Borges</span>
        </div>
      </footer>
    </div>
  )
}
