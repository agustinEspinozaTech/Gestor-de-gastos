/**
 * Responsabilidad: utilidades de fecha para mes actual, monthId, y cálculo de diario.
 * Usa Date local (cliente).
 */

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function getMonthId(date = new Date()) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  return `${y}-${m}`; // YYYY-MM
}

export function getMonthLabel(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });
  const s = fmt.format(date);
  // Capitalizar primera letra
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function daysInMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  return new Date(y, m + 1, 0).getDate();
}

export function dayOfMonth(date = new Date()) {
  return date.getDate();
}

export function remainingDaysIncludingToday(date = new Date()) {
  const dim = daysInMonth(date);
  const d = dayOfMonth(date);
  return Math.max(1, dim - d + 1);
}
