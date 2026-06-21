/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./app.js"],
  theme: {
    extend: {
      colors: {
        brand: "#534ab7",
        "brand-light": "#edeaff",
        ink: "#232323",
        muted: "#85827c",
        surface: "#ffffff",
        panel: "#f0eee8",
        line: "#dfdcd4",
        bg: "#faf9f6",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
