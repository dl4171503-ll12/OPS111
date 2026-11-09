/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './guardian/**/*.{html,ts,tsx}', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        campus: {
          sky: '#7ec8e3',
          grass: '#6bcB77',
          sun: '#ffd166',
          brick: '#e07a5f',
          ink: '#2b2d42',
          cream: '#fff8f0',
          mint: '#00b4a8',
          grape: '#6a4c93',
        },
      },
      fontFamily: {
        display: ['"Fredoka"', '"ZCOOL KuaiLe"', 'system-ui', 'sans-serif'],
        body: ['"Nunito"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px rgba(43,45,66,0.12)',
      },
    },
  },
  plugins: [],
};
