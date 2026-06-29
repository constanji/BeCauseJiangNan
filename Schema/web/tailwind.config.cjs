const path = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{js,jsx,ts,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        brand: '#10a37f',
        accent: {
          50: '#effdf5',
          100: '#d9fbe6',
          200: '#b8f3cf',
          300: '#7be8a9',
          400: '#42d27f',
          500: '#1fb964',
          600: '#159954',
          700: '#127a45',
          800: '#115f39',
          900: '#0f4f31',
        },
      },
    },
  },
  plugins: [],
};
