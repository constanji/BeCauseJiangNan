const path = require('node:path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        ink: '#0f1419',
        mist: '#e8edf2',
        accent: '#1a5f4a',
        warn: '#b45309',
        danger: '#b91c1c',
      },
    },
  },
  plugins: [],
};
