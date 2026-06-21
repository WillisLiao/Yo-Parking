/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#0F766E',
        'primary-dark': '#134E4A',
        secondary: '#14B8A6',
        accent: '#0369A1',
        surface: '#F0FDFA',
        muted: '#E8F0F3',
        marker: {
          empty: '#22C55E',
          occupied: '#EF4444',
          uncertain: '#F59E0B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'System'],
      },
    },
  },
  plugins: [],
};
