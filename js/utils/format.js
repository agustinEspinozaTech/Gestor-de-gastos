/**
 * Responsabilidad: formateo de moneda ARS sin decimales y parsing.
 * - Separador de miles
 * - Acepta inputs con puntos/espacios y devuelve entero
 */

export function formatARS(value) {
  const n = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
  return n.toLocaleString("es-AR"); // separador de miles para AR
}

export function formatARSWithPrefix(value) {
  return `$ ${formatARS(value)}`;
}

export function parseARS(input) {
  if (input === null || input === undefined) return 0;
  const s = String(input).trim();
  if (!s) return 0;
  // Mantener signo y dígitos
  const cleaned = s.replace(/[^\d-]/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

export function clampInt(n, min, max) {
  const x = Math.trunc(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}
