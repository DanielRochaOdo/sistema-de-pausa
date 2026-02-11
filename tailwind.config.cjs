module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      colors: {
        brand: {
          50: '#eef8f6',
          100: '#d9f1ed',
          200: '#b3e3da',
          300: '#7dcdc0',
          400: '#3fae9f',
          500: '#1f8b80',
          600: '#136f67',
          700: '#125856',
          800: '#134645',
          900: '#123c3b'
        }
      },
      keyframes: {
        fade: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-in': 'fade 0.6s ease-out'
      },
      boxShadow: {
        soft: '0 25px 50px -20px rgba(15, 23, 42, 0.25)'
      }
    }
  },
  plugins: []
}