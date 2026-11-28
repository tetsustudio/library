'use client'

import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-md bg-surface px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{command}</code>
      <button
        type="button"
        aria-label={copied ? 'Copied' : 'Copy command'}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={async () => {
          await navigator.clipboard.writeText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      </button>
    </div>
  )
}
