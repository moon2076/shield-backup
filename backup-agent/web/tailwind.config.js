/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#08090E',      // 深邃极黑底色
        darkCard: '#11131E',    // 玻璃拟态卡片背景
        darkBorder: '#1F2437',  // 边框色
        neonGreen: '#10B981',   // 霓虹绿（健康）
        auroraBlue: '#06B6D4',  // 极光蓝（同步）
        neonPurple: '#8B5CF6',  // 霓虹紫（加密）
        warningOrange: '#F59E0B',// 警示橙
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
