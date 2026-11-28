import type { Metadata } from 'next'
import { Archivo, Archivo_Black, Fredoka, Inter, JetBrains_Mono, Newsreader, Nunito } from 'next/font/google'
import { Toaster } from '@/components/ui/toast'
import { bootScript } from '@/lib/styles'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader' })
const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' })
const archivoBlack = Archivo_Black({ subsets: ['latin'], weight: '400', variable: '--font-archivo-black' })
const fredoka = Fredoka({ subsets: ['latin'], variable: '--font-fredoka' })

export const metadata: Metadata = {
  title: 'Tetsu library',
  description:
    'Components and design tokens for Tetsu Studio apps: a shadcn registry, the token contract with 14 styles, and packages for tables, reading and writing.',
  metadataBase: new URL('https://library.tetsustudio.com'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fonts = [inter, nunito, jetbrains, newsreader, archivo, archivoBlack, fredoka].map((f) => f.variable).join(' ')
  return (
    <html lang="en" data-style="tetsu" className={`dark ${fonts}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
