/**
 * Valida se o email é institucional do IFPE
 */
export function isValidIFPEEmail(email: string): boolean {
  const pattern = /^[a-zA-Z0-9._%+-]+@(discente\.ifpe\.edu\.br|estudante\.ifpe\.edu\.br|ifpe\.edu\.br)$/i
  return pattern.test(email)
}

/**
 * Formata tempo restante em string legível
 */
export function formatTimeRemaining(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s'

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  }
  return `${seconds}s`
}

/**
 * Formata estimativa de espera
 */
export function formatEstimate(peopleAhead: number, avgSeconds: number): string {
  const totalMinutes = Math.ceil((peopleAhead * avgSeconds) / 60)
  if (totalMinutes <= 0) return 'Sua vez!'
  if (totalMinutes === 1) return '~1 minuto'
  return `~${totalMinutes} minutos`
}

/**
 * Calcula segundos até um horário alvo hoje
 */
export function secondsUntilTime(targetHour: number, targetMinute: number): number {
  const now = new Date()
  const target = new Date()
  target.setHours(targetHour, targetMinute, 0, 0)

  const diff = Math.floor((target.getTime() - now.getTime()) / 1000)
  return Math.max(0, diff)
}

/**
 * Verifica se estamos no horário de emissão (11:30 - 13:00)
 */
export function isWithinServiceHours(): boolean {
  const now = new Date()
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const totalMinutes = hours * 60 + minutes
  return totalMinutes >= 690 && totalMinutes <= 780 // 11:30 = 690, 13:00 = 780
}

/**
 * Verifica se é antes do horário de abertura (11:30)
 */
export function isBeforeOpening(): boolean {
  const now = new Date()
  const hours = now.getHours()
  const minutes = now.getMinutes()
  return hours * 60 + minutes < 690
}
