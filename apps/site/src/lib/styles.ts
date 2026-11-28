import { GALLERY_THEMES, STYLE_IDS } from '@tetsustudio/tokens'

// Every style the site can show: the app styles built into the tokens package
// and the gallery themes (loaded as /themes/<id>.css when picked).
export const ALL_STYLES = [...new Set<string>([...STYLE_IDS, ...GALLERY_THEMES])].sort()
export const GALLERY = new Set<string>(GALLERY_THEMES)
export const STYLE_KEY = 'library-style'
export const MODE_KEY = 'library-mode'

// Runs before paint so the page never flashes the default style.
export const bootScript = `(() => {
  try {
    const style = localStorage.getItem('${STYLE_KEY}') || 'tetsu'
    const mode = localStorage.getItem('${MODE_KEY}') || 'dark'
    const root = document.documentElement
    root.dataset.style = style
    root.classList.toggle('dark', mode === 'dark')
    const link = document.createElement('link')
    link.id = 'theme-css'
    link.rel = 'stylesheet'
    link.href = '/themes/' + style + '.css'
    document.head.appendChild(link)
  } catch {}
})()`
