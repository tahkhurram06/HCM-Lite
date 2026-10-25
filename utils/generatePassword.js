// Generates a short, readable temporary password like "Hx7k-Qp29"
// Good enough for a hackathon; not for production.
export function generateTempPassword() {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const pick = (chars, n) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");

  return `${pick(letters, 4)}${pick(digits, 2)}-${pick(letters, 2)}${pick(digits, 2)}`;
}
