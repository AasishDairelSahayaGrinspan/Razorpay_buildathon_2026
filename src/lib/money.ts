/** Money helpers — paise integer only, never float */
export function formatINR(paise: number, currency = "INR"): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(rupees);
}

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function isValidPaise(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
