import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meu Almoço IFPE",
  description: "Sistema de fila virtual para o refeitório do IFPE Belo Jardim. Pegue sua ficha digital e acompanhe a fila em tempo real.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body suppressHydrationWarning className="min-h-screen flex flex-col">

        {children}
      </body>
    </html>
  );
}
