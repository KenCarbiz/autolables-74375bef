import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        navy: "hsl(var(--navy))",
        // Spread the default Tailwind scale so utilities like `bg-blue-600`
        // still resolve; DEFAULT keeps `bg-blue` mapped to the brand token.
        // Without the spread, the string override deletes the 50–950 scale
        // and `bg-blue-600 text-white` renders as white text on no fill.
        blue: { ...colors.blue, DEFAULT: "hsl(var(--blue))" },
        action: "hsl(var(--action))",
        teal: "hsl(var(--teal))",
        gold: "hsl(var(--gold))",
        light: "hsl(var(--light))",
        mid: "hsl(var(--mid))",
        "muted-custom": "hsl(var(--muted-custom))",
        red: { ...colors.red, DEFAULT: "hsl(var(--red))" },
        "border-custom": "hsl(var(--border-custom))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Wave 2 scale — Apple/Tesla radius ladder
        "xl": "24px",
        "hero": "28px",
      },
      fontFamily: {
        "barlow": ["Barlow", "system-ui", "sans-serif"],
        "barlow-condensed": ["'Barlow Condensed'", "Barlow", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Wave 2 type scale — display-xl down to caption
        "display-xl":  ["4.5rem",   { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "600" }], // 72
        "display-lg":  ["3.5rem",   { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "600" }], // 56
        "display":     ["2.5rem",   { lineHeight: "1.1",  letterSpacing: "-0.025em", fontWeight: "600" }], // 40
        "headline":    ["2rem",     { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "600" }], // 32
        "title":       ["1.5rem",   { lineHeight: "1.25", letterSpacing: "-0.015em", fontWeight: "500" }], // 24
        "subtitle":    ["1.25rem",  { lineHeight: "1.35", letterSpacing: "-0.01em", fontWeight: "500" }], // 20
        "body":        ["1rem",     { lineHeight: "1.5",  letterSpacing: "0",       fontWeight: "400" }], // 16
        "body-sm":     ["0.875rem", { lineHeight: "1.45", letterSpacing: "0",       fontWeight: "400" }], // 14
        "caption":     ["0.75rem",  { lineHeight: "1.4",  letterSpacing: "0",       fontWeight: "400" }], // 12
      },
      letterSpacing: {
        // Wave 2 spacing tokens
        "ui":          "0",
        "label":       "0.14em",    // uppercase UI labels
        "label-wide":  "0.18em",    // section titles
      },
      transitionTimingFunction: {
        // Wave 2 motion ladder — out-expo for enters, fast-in for exits
        "out-expo":  "cubic-bezier(0.22, 1, 0.36, 1)",
        "in-fast":   "cubic-bezier(0.4, 0, 1, 1)",
        "spring":    "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        "120": "120ms",
        "200": "200ms",
        "320": "320ms",
        "480": "480ms",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // Wave 2 baseline motion: fade-in-up, press, ring-pulse
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "ring-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(239, 68, 68, 0.5)" },
          "50%":      { boxShadow: "0 0 0 6px rgba(239, 68, 68, 0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "fade-in-up":     "fade-in-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "ring-pulse":     "ring-pulse 2s cubic-bezier(0.22, 1, 0.36, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
