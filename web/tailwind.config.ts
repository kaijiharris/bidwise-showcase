import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#04080F',
          900: '#080D1A',
          800: '#0E1628',
          700: '#141F35',
          600: '#1A2844',
        },
        // BidWise brand palette (from brand kit)
        brand: {
          blue:  '#10A7FF',
          cyan:  '#2DE2FF',
          deep:  '#0B5CFF',
          night: '#08111F',
          navy:  '#111B2B',
          graph: '#1A2433',
          slate: '#6B778A',
        },
        // Blueprint Instrument tokens (values live as CSS custom properties in
        // globals.css so the paper-white chapter can invert them via cascade)
        bp: {
          base:   'var(--bp-base)',
          panel:  'var(--bp-panel)',
          deep:   'var(--bp-panel-deep)',
          accent: 'var(--bp-accent)',
          bright: 'var(--bp-accent-bright)',
          paper:  'var(--bp-paper)',
          ink:    'var(--bp-ink)',
          text1:  'var(--bp-text-1)',
          text2:  'var(--bp-text-2)',
          text3:  'var(--bp-text-3)',
        },
        // Keep emerald for deal score indicators (green = good deal is intuitive)
        emerald: {
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
        },
      },
      fontFamily: {
        sans:    ['var(--font-inter)', 'Inter', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'Inter', 'sans-serif'],
        mono:    ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.4s ease',
        'slide-up':   'slideUp 0.4s ease',
        'slide-down': 'slideDown 0.2s ease forwards',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideDown: { from: { opacity: '0', transform: 'translateY(-8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      backgroundImage: {
        'logo-gradient':  'linear-gradient(135deg, #10A7FF 0%, #2DE2FF 60%, #10A7FF 100%)',
        'brand-gradient': 'linear-gradient(135deg, #10A7FF 0%, #2DE2FF 100%)',
      },
      boxShadow: {
        'brand':    '0 4px 24px rgba(16,167,255,0.25)',
        'brand-lg': '0 8px 40px rgba(16,167,255,0.35)',
        'card':     '0 1px 3px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.2)',
      },
    },
  },
  plugins: [],
}

export default config
