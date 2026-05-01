'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut, FileDown, Activity, Users, CalendarDays, Loader2, Download, Utensils, ChevronLeft } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useCallback } from 'react'

interface DailyStat {
  date: string
  weekday: string
  reserved: number
  confirmed: number
  no_show: number
  cancelled: number
}

interface MonthlyStat {
  date: string
  weekday: string
  total: number
  confirmed: number
  no_show: number
}

interface UpcomingStat {
  date: string
  count: number
}

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date()
  const [year, month, day] = dateStr.split('T')[0].split('-').map(Number)
  return new Date(year, month - 1, day)
}

const getWeekdayPT = (dateStr: string, format: 'short' | 'long' = 'short') => {
  return parseLocalDate(dateStr).toLocaleDateString('pt-BR', { weekday: format }).replace('.', '')
}

const formatDatePT = (dateStr: string, options?: Intl.DateTimeFormatOptions) => {
  return parseLocalDate(dateStr).toLocaleDateString('pt-BR', options)
}

export default function NutricionistaDashboard() {
  const [loading, setLoading] = useState(true)
  const [exportLoading, setExportLoading] = useState(false)
  const [upcoming, setUpcoming] = useState<UpcomingStat[]>([])
  const [monthlyData, setMonthlyData] = useState<MonthlyStat[]>([])
  const [monthlySummary, setMonthlySummary] = useState({
    total_reserved: 0,
    total_confirmed: 0,
    total_no_show: 0,
    attendance_rate: 0
  })

  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  const supabase = createClient()
  const router = useRouter()

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'nutricionista' && profile?.role !== 'admin') {
      router.push('/dashboard')
      return
    }

    const { data: upData } = await supabase.rpc('get_upcoming_counts')
    if (upData?.success) {
      setUpcoming(upData.upcoming)
    }

    const { data: monthData } = await supabase.rpc('get_monthly_report', {
      p_month: selectedMonth,
      p_year: selectedYear
    })

    if (monthData?.success) {
      setMonthlyData(monthData.daily)
      setMonthlySummary({
        total_reserved: monthData.total_reserved,
        total_confirmed: monthData.total_confirmed,
        total_no_show: monthData.total_no_show,
        attendance_rate: monthData.attendance_rate
      })
    }

    setLoading(false)
  }, [supabase, router, selectedMonth, selectedYear])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const exportPDF = () => {
    setExportLoading(true)
    const doc = new jsPDF()

    doc.setFontSize(20)
    doc.setTextColor(19, 81, 180)
    doc.text('Meu Almoço IFPE', 14, 22)

    doc.setFontSize(12)
    doc.setTextColor(50, 50, 50)
    doc.text(`Relatório Nutricional — ${selectedMonth.toString().padStart(2, '0')}/${selectedYear}`, 14, 30)

    doc.setFontSize(10)
    doc.text(`Total de Reservas: ${monthlySummary.total_reserved}`, 14, 40)
    doc.text(`Comparecimentos: ${monthlySummary.total_confirmed}`, 14, 45)
    doc.text(`Faltas (No-Show): ${monthlySummary.total_no_show}`, 14, 50)
    doc.text(`Taxa de Frequência: ${monthlySummary.attendance_rate}%`, 14, 55)

    const tableData = monthlyData.map(day => [
      formatDatePT(day.date),
      getWeekdayPT(day.date),
      day.total,
      day.confirmed,
      day.no_show
    ])

    autoTable(doc, {
      startY: 65,
      head: [['Data', 'Dia', 'Reservas', 'Compareceram', 'Faltaram']],
      body: tableData,
      headStyles: { fillColor: [19, 81, 180] },
      alternateRowStyles: { fillColor: [248, 248, 248] },
    })

    doc.save(`relatorio_almoco_${selectedMonth}_${selectedYear}.pdf`)
    setExportLoading(false)
  }

  const exportCSV = () => {
    const headers = ['Data', 'Dia da Semana', 'Total Reservas', 'Compareceram', 'Faltaram']
    const rows = monthlyData.map(day => [
      day.date,
      getWeekdayPT(day.date),
      day.total,
      day.confirmed,
      day.no_show
    ])

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `relatorio_almoco_${selectedMonth}_${selectedYear}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--gray-2)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--gov-blue)', borderTopColor: 'transparent' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--gray-40)' }}>Carregando relatórios...</p>
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

      {/* Header */}
      <header style={{ background: 'var(--gov-blue-dark)', borderBottom: '3px solid var(--gov-green)' }} className="px-4 py-4 shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gov-green)' }}>
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-base sm:text-lg leading-tight">Painel Nutricional</h1>
              <p className="text-white/50 text-xs hidden sm:block">Meu Almoço IFPE</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-semibold transition-colors px-3 py-2 rounded"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <ChevronLeft size={15} />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-semibold transition-colors px-3 py-2 rounded"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-4 py-6 space-y-6">

        {/* Seção: Previsão */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-5 rounded" style={{ background: 'var(--gov-blue)' }} />
            <h2 className="font-bold text-base" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
              Previsão — Próximos 5 Dias Úteis
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {upcoming.map((day, idx) => (
              <div key={idx} className="gov-card p-4 text-center">
                <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--gray-40)' }}>
                  {getWeekdayPT(day.date)}
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--gray-20)' }}>
                  {formatDatePT(day.date, { day: '2-digit', month: '2-digit' })}
                </p>
                <div className="text-4xl font-black tabular-nums" style={{ color: 'var(--gov-blue)', fontFamily: 'var(--font-primary)' }}>
                  {day.count}
                </div>
                <p className="text-xs mt-1 font-medium" style={{ color: 'var(--gov-blue)', opacity: 0.7 }}>reservas</p>
              </div>
            ))}
            {upcoming.length === 0 && (
              <div className="col-span-5 gov-card p-8 text-center" style={{ color: 'var(--gray-20)' }}>
                Nenhuma reserva prevista para os próximos dias.
              </div>
            )}
          </div>
        </section>

        {/* Seção: Relatório Mensal */}
        <section className="gov-card overflow-hidden">
          {/* Header do card */}
          <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ borderBottom: '1px solid var(--gray-5)' }}>
            <div className="flex items-center gap-3">
              <div className="w-1 h-5 rounded" style={{ background: 'var(--gov-green)' }} />
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5" style={{ color: 'var(--gov-green)' }} />
                <h2 className="font-bold text-base" style={{ color: 'var(--gray-90)', fontFamily: 'var(--font-primary)' }}>
                  Relatório Mensal
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="gov-input text-sm py-2"
                style={{ width: 'auto' }}
              >
                {Array.from({ length: 12 }).map((_, i) => (
                  <option key={i+1} value={i+1}>
                    {new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'long' }).replace(/^\w/, c => c.toUpperCase())}
                  </option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="gov-input text-sm py-2"
                style={{ width: 'auto' }}
              >
                {[selectedYear - 1, selectedYear, selectedYear + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Cards de resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background: 'var(--gray-5)' }}>
            {[
              { label: 'Total de Reservas', value: monthlySummary.total_reserved, color: 'var(--gov-blue)' },
              { label: 'Comparecimentos', value: monthlySummary.total_confirmed, color: 'var(--gov-green)' },
              { label: 'Faltas (No-Show)', value: monthlySummary.total_no_show, color: 'var(--gov-red)' },
              { label: 'Taxa de Frequência', value: `${monthlySummary.attendance_rate}%`, color: 'var(--gov-blue-dark)' },
            ].map((stat, i) => (
              <div key={i} className="bg-white p-5">
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--gray-40)' }}>{stat.label}</p>
                <p className="text-3xl font-black tabular-nums" style={{ color: stat.color, fontFamily: 'var(--font-primary)' }}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Botões de exportação */}
          <div className="px-6 py-4 flex gap-3" style={{ borderBottom: '1px solid var(--gray-5)' }}>
            <button
              onClick={exportPDF}
              disabled={exportLoading || monthlyData.length === 0}
              className="btn-gov-primary text-sm px-4 py-2"
              style={exportLoading || monthlyData.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {exportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              Exportar PDF
            </button>
            <button
              onClick={exportCSV}
              disabled={exportLoading || monthlyData.length === 0}
              className="btn-gov-secondary text-sm px-4 py-2"
              style={exportLoading || monthlyData.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </button>
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--gray-2)' }}>
                <tr>
                  {['Data', 'Dia da Semana', 'Reservas', 'Compareceram', 'Faltaram'].map((h, i) => (
                    <th
                      key={i}
                      className={`px-5 py-3 text-xs font-bold uppercase tracking-wider ${i > 1 ? 'text-right' : 'text-left'}`}
                      style={{ color: 'var(--gray-40)', borderBottom: '2px solid var(--gray-5)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyData.length > 0 ? monthlyData.map((day, idx) => (
                  <tr
                    key={idx}
                    style={{
                      background: idx % 2 === 0 ? '#fff' : 'var(--gray-2)',
                      borderBottom: '1px solid var(--gray-5)'
                    }}
                  >
                    <td className="px-5 py-3 font-medium" style={{ color: 'var(--gray-90)' }}>
                      {formatDatePT(day.date)}
                    </td>
                    <td className="px-5 py-3 text-xs font-bold uppercase" style={{ color: 'var(--gray-40)' }}>
                      {getWeekdayPT(day.date)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: 'var(--gray-90)' }}>{day.total}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold" style={{ color: 'var(--gov-green)' }}>{day.confirmed}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold" style={{ color: 'var(--gov-red)' }}>{day.no_show}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm" style={{ color: 'var(--gray-20)' }}>
                      Nenhum dado registrado para este mês.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer style={{ background: 'var(--gov-blue-dark)', borderTop: '3px solid var(--gov-yellow)' }} className="py-6 px-4 flex flex-col items-center mt-8">
        <p className="text-white/50 text-xs mb-3 font-medium tracking-wide">IFPE Belo Jardim · Painel Nutricional</p>
        <div className="inline-flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/10">
          <span className="text-xs font-medium text-white/60 uppercase tracking-widest">Desenvolvido por</span>
          <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
          <span className="text-sm font-bold text-white/90">Pedro Victor & Pedro Borges</span>
        </div>
      </footer>
    </div>
  )
}
