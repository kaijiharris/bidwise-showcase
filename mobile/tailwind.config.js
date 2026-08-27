/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './features/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // BidWise brand — primary blues
        brand: {
          500: '#10A7FF', // BidWise Blue (primary)
          400: '#2DE2FF', // Electric Cyan
          600: '#0B5CFF', // Deep Blue
        },
        // Neutrals (named to the brand guide)
        midnight: '#08111F',  // main background
        navy: '#111B2B',      // cards / sections
        graphite: '#1A2433',  // elevated surfaces
        slate: '#6B778A',     // borders / disabled
        soft: '#F8FAFC',      // soft white text
        // Status (all tints of blue per brand)
        info: '#10A7FF',
        positive: '#2DE2FF',
        warning: '#74C8FF',
        danger: '#386BFF',
        // Secondary text scale
        muted: '#94A3B8',
        dim: '#475569',
      },
      fontFamily: {
        display: ['SpaceGrotesk_700Bold'],
        'display-semibold': ['SpaceGrotesk_600SemiBold'],
        'display-medium': ['SpaceGrotesk_500Medium'],
        sans: ['Inter_400Regular'],
        'sans-medium': ['Inter_500Medium'],
        'sans-semibold': ['Inter_600SemiBold'],
        'sans-bold': ['Inter_700Bold'],
      },
      borderRadius: {
        card: '16px',
        pill: '999px',
      },
    },
  },
  plugins: [],
}
