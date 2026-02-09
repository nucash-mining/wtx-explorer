/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wattx: {
          primary: '#3B82F6',
          secondary: '#10B981',
          dark: '#1F2937',
          light: '#F3F4F6',
        }
      }
    },
  },
  plugins: [],
}
