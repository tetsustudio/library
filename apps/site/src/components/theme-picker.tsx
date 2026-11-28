'use client'

import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ALL_STYLES, GALLERY, MODE_KEY, STYLE_KEY } from '@/lib/styles'

function apply(style: string, mode: string) {
  const root = document.documentElement
  root.dataset.style = style
  root.classList.toggle('dark', mode === 'dark')
  let link = document.getElementById('theme-css') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = 'theme-css'
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  link.href = GALLERY.has(style) ? `/themes/${style}.css` : ''
}

export function ThemePicker() {
  const [style, setStyle] = useState('tetsu')
  const [mode, setMode] = useState('dark')

  useEffect(() => {
    setStyle(localStorage.getItem(STYLE_KEY) || 'tetsu')
    setMode(localStorage.getItem(MODE_KEY) || 'dark')
  }, [])

  const choose = (next: string, nextMode = mode) => {
    setStyle(next)
    setMode(nextMode)
    localStorage.setItem(STYLE_KEY, next)
    localStorage.setItem(MODE_KEY, nextMode)
    apply(next, nextMode)
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="style-picker">
        Style
      </label>
      <select
        id="style-picker"
        value={style}
        onChange={(e) => choose(e.target.value)}
        className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
      >
        {ALL_STYLES.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="icon"
        aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={() => choose(style, mode === 'dark' ? 'light' : 'dark')}
      >
        {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
      </Button>
    </div>
  )
}
