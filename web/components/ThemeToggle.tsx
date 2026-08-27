'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="w-8 h-8 rounded-lg border border-slate-200 dark:border-white/10" />
  }

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-white/10"
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
