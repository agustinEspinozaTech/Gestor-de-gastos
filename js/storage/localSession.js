/**
 * Responsabilidad: persistencia local de sesión (localStorage).
 * Guarda lo mínimo: userId, userName, householdCode.
 */

const KEY = "gastos_pareja_session_v1";

export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.userId || !parsed?.userName || !parsed?.householdCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(session) {
  const safe = {
    userId: String(session.userId),
    userName: String(session.userName),
    householdCode: String(session.householdCode)
  };
  localStorage.setItem(KEY, JSON.stringify(safe));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
