// Design tokens — Razorpay-inspired, light-mode only
// Use these in JS when Tailwind class not enough (e.g. inline styles, canvas)

export const tokens = {
  color: {
    background: "#f8fafc",
    foreground: "#1a1c1e",
    card: "#ffffff",
    muted: "#f3f4f6",
    mutedForeground: "#5b5f65",
    border: "#e5e7eb",
    primary: "#0b5fff",
    primaryHover: "#084dd1",
    success: "#0ba36a",
    warning: "#f59e0b",
    danger: "#e11d48",
    sidebar: "#ffffff",
    topbar: "#ffffff",
    topbarPill: "#0a0a13",
  },
  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    pill: "9999px",
  },
  shadow: {
    card: "0 1px 2px rgba(16,24,40,.06), 0 4px 12px rgba(16,24,40,.04)",
    cardHover: "0 4px 8px rgba(16,24,40,.08), 0 8px 24px rgba(16,24,40,.06)",
    button: "0 1px 2px rgba(16,24,40,.08)",
  },
  spacing: {
    page: 24,
    section: 32,
    sidebar: 240,
    topbar: 56,
  },
  typography: {
    h1: { size: 28, lineHeight: 32, weight: 700, letterSpacing: "-0.02em" },
    h2: { size: 20, lineHeight: 28, weight: 600, letterSpacing: "-0.01em" },
    h3: { size: 16, lineHeight: 24, weight: 600 },
    body: { size: 14, lineHeight: 20, weight: 400 },
    small: { size: 12, lineHeight: 16, weight: 400 },
    caption: { size: 11, lineHeight: 14, weight: 500, letterSpacing: "0.04em", uppercase: true },
  },
} as const;

export const spacingScale = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;
