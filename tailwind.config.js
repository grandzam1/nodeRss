/** @type {import('tailwindcss').Config} */
// Colors mirror the shadcn-style dark theme tokens the UI was designed with.
export default {
  darkMode: 'class',
  content: ['./public/**/*.html'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(214.3 31.8% 91.4%)',
        input: 'hsl(214.3 31.8% 91.4%)',
        ring: 'hsl(221.2 83.2% 53.3%)',
        background: 'hsl(222.8 84% 4.9%)',
        foreground: 'hsl(210 40% 98%)',
        primary: {
          DEFAULT: 'hsl(210 40% 98%)',
          foreground: 'hsl(222.2 47.4% 11.2%)',
        },
        muted: {
          DEFAULT: 'hsl(217.2 32.6% 17.5%)',
          foreground: 'hsl(215 20.2% 65.1%)',
        },
        card: {
          DEFAULT: 'hsl(222.2 84% 6.5%)',
          foreground: 'hsl(210 40% 98%)',
        },
      },
    },
  },
  plugins: [],
};
