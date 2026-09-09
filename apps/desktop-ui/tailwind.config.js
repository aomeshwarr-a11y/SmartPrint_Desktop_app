/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0faf4",
          100: "#d9f2e3",
          200: "#b3e5c8",
          300: "#82d3a8",
          400: "#4fb885",
          500: "#2f9c6a",
          600: "#1f7d54",
          700: "#1a6345",
          800: "#174f39",
          900: "#0f3626",
        },
        cream: "#faf6ee",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
