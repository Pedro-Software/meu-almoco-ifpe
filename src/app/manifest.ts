import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Meu Almoço IFPE',
    short_name: 'Almoço IFPE',
    description: 'Sistema de fila virtual para o refeitório do IFPE Belo Jardim',
    start_url: '/',
    display: 'standalone',
    background_color: '#00913f',
    theme_color: '#00913f',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
