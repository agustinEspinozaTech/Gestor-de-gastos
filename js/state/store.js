/**
 * Responsabilidad: estado global en memoria + acciones para sincronizar con Airtable.
 * - Mantiene sesión, household, items del mes y shopping del mes.
 * - Expone acciones: login, register, logout, refresh, CRUD de items, update dailyAdjustment.
 * - Agrega: CRUD de ShoppingItems + compras parciales (purchasedQty).
 */

import { getSession, setSession, clearSession } from "../storage/localSession.js";
import { listRecords, createRecord, updateRecord, deleteRecord, batchUpdateRecords } from "../api/airtable.js";
import { getMonthId, remainingDaysIncludingToday } from "../utils/date.js";
import { DAILY_TARGET_ARS } from "../config.js";

function escapeAirtableString(s) {
  return String(s).replace(/'/g, "''");
}

function lower(s) {
  return String(s || "").trim().toLowerCase();
}

function randomHouseholdCode(len = 9) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function clampInt(n, min, max) {
  const x = Math.trunc(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

class Store {
  constructor() {
    this.listeners = new Set();
    this.state = {
      session: getSession(), // {userId,userName,householdCode} | null
      loading: false,
      error: "",
      info: "",
      household: null, // { id, householdCode, monthId, dailyAdjustment }
      items: [], // gastos
      shoppingItems: [] // compras: [{id, householdCode, name, targetQty, purchasedQty}]
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  setLoading(v) { this.setState({ loading: !!v }); }
  setError(msg) { this.setState({ error: msg || "" }); }
  setInfo(msg) { this.setState({ info: msg || "" }); }
  getSession() { return this.state.session; }

  async logout() {
    clearSession();
    this.setState({ session: null, household: null, items: [], shoppingItems: [] });
  }

  async login(email, pin) {
    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const emailNorm = lower(email);
      const pinNorm = String(pin || "").trim();

      if (!emailNorm) throw new Error("El email es obligatorio.");
      if (!pinNorm) throw new Error("El pin es obligatorio.");

      const fEmail = `LOWER({email})='${escapeAirtableString(emailNorm)}'`;
      const users = await listRecords("Users", fEmail, { maxRecords: 10 });

      if (users.length === 0) throw new Error("Usuario no existe.");

      const user = users[0];
      const storedPin = String(user.fields?.pin ?? "").trim();
      if (storedPin !== pinNorm) throw new Error("Pin incorrecto.");

      const householdCode = String(user.fields?.householdCode || "").trim();
      if (!householdCode) throw new Error("El usuario no tiene hogar asignado.");

      const fHouse = `{householdCode}='${escapeAirtableString(householdCode)}'`;
      const households = await listRecords("Households", fHouse, { maxRecords: 10 });
      if (households.length === 0) throw new Error("Hogar inválido.");

      const session = {
        userId: user.id,
        userName: String(user.fields?.name || "Usuario"),
        householdCode
      };

      setSession(session);
      this.setState({ session });
      this.setInfo("Sesión iniciada.");
    } catch (e) {
      this.setError(e.message || "No se pudo iniciar sesión.");
    } finally {
      this.setLoading(false);
    }
  }

  async register({ name, email, pin, mode, householdCodeInput }) {
    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const nameNorm = String(name || "").trim();
      const emailNorm = lower(email);
      const pinNorm = String(pin || "").trim();

      if (!nameNorm) throw new Error("El nombre es obligatorio.");
      if (!emailNorm) throw new Error("El email es obligatorio.");
      if (!pinNorm) throw new Error("El pin es obligatorio.");
      if (!/^\d{4,6}$/.test(pinNorm)) throw new Error("El pin debe tener 4 a 6 dígitos.");

      const fEmail = `LOWER({email})='${escapeAirtableString(emailNorm)}'`;
      const existing = await listRecords("Users", fEmail, { maxRecords: 10 });
      if (existing.length > 0) throw new Error("Ese email ya está registrado.");

      let householdCode = "";

      if (mode === "join") {
        householdCode = String(householdCodeInput || "").trim().toUpperCase();
        if (!householdCode) throw new Error("Ingresá el código de hogar.");
        const fHouse = `{householdCode}='${escapeAirtableString(householdCode)}'`;
        const households = await listRecords("Households", fHouse, { maxRecords: 10 });
        if (households.length === 0) throw new Error("Hogar inválido.");
      } else {
        let tries = 0;
        while (tries < 6) {
          tries += 1;
          const candidate = randomHouseholdCode(9);
          const fHouse = `{householdCode}='${escapeAirtableString(candidate)}'`;
          const found = await listRecords("Households", fHouse, { maxRecords: 10 });
          if (found.length === 0) {
            householdCode = candidate;
            break;
          }
        }
        if (!householdCode) throw new Error("No se pudo generar un código de hogar. Reintentá.");

        const monthId = getMonthId(new Date());
        await createRecord("Households", { householdCode, monthId, dailyAdjustment: 0 });
      }

      const createdAt = new Date().toISOString();
      const user = await createRecord("Users", {
        name: nameNorm,
        email: emailNorm,
        pin: pinNorm,
        householdCode,
        createdAt
      });

      const session = { userId: user.id, userName: nameNorm, householdCode };
      setSession(session);
      this.setState({ session });
      this.setInfo("Usuario creado e ingresado.");
    } catch (e) {
      this.setError(e.message || "No se pudo crear el usuario.");
    } finally {
      this.setLoading(false);
    }
  }

  async loadHouseholdAndItems({ forceResetCheck = true } = {}) {
    const session = this.state.session;
    if (!session) return;

    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const householdCode = session.householdCode;

      const fHouse = `{householdCode}='${escapeAirtableString(householdCode)}'`;
      const households = await listRecords("Households", fHouse, { maxRecords: 10 });
      if (households.length === 0) throw new Error("Hogar inválido.");

      const householdRec = households[0];
      const household = {
        id: householdRec.id,
        householdCode: String(householdRec.fields?.householdCode || householdCode),
        monthId: String(householdRec.fields?.monthId || ""),
        dailyAdjustment: Number(householdRec.fields?.dailyAdjustment || 0)
      };

      // Reset mensual sin historial
      if (forceResetCheck) {
        const currentMonthId = getMonthId(new Date());
        if (household.monthId !== currentMonthId) {
          await updateRecord("Households", household.id, {
            monthId: currentMonthId,
            dailyAdjustment: 0
          });
          household.monthId = currentMonthId;
          household.dailyAdjustment = 0;

          const nowIso = new Date().toISOString();

          // Reset isPaid de Items (gastos)
          const fItems = `{householdCode}='${escapeAirtableString(householdCode)}'`;
          const items = await listRecords("Items", fItems, { maxRecords: 200 });

          const itemUpdates = items.map(it => ({
            id: it.id,
            fields: { isPaid: false, updatedAt: nowIso }
          }));
          if (itemUpdates.length > 0) await batchUpdateRecords("Items", itemUpdates);

          // Reset purchasedQty de ShoppingItems
          const shop = await listRecords("ShoppingItems", fItems, { maxRecords: 200 });
          const shopUpdates = shop.map(si => ({
            id: si.id,
            fields: { purchasedQty: 0, updatedAt: nowIso }
          }));
          if (shopUpdates.length > 0) await batchUpdateRecords("ShoppingItems", shopUpdates);
        }
      }

      // Traer Items (gastos)
      const fItems = `{householdCode}='${escapeAirtableString(householdCode)}'`;
      const itemsRecs = await listRecords("Items", fItems, { maxRecords: 200 });

      const items = itemsRecs.map(r => ({
        id: r.id,
        householdCode: String(r.fields?.householdCode || householdCode),
        name: String(r.fields?.name || ""),
        amount: Math.trunc(Number(r.fields?.amount || 0)),
        isPaid: !!r.fields?.isPaid
      })).sort((a, b) => a.name.localeCompare(b.name, "es"));

      // Traer ShoppingItems (compras)
      const shoppingRecs = await listRecords("ShoppingItems", fItems, { maxRecords: 200 });
      const shoppingItems = shoppingRecs.map(r => ({
        id: r.id,
        householdCode: String(r.fields?.householdCode || householdCode),
        name: String(r.fields?.name || ""),
        targetQty: Math.trunc(Number(r.fields?.targetQty || 0)),
        purchasedQty: Math.trunc(Number(r.fields?.purchasedQty || 0))
      })).sort((a, b) => a.name.localeCompare(b.name, "es"));

      this.setState({ household, items, shoppingItems });
    } catch (e) {
      this.setError(e.message || "No se pudo cargar el hogar.");
    } finally {
      this.setLoading(false);
    }
  }

  computeTotals() {
    const items = this.state.items || [];
    const total = items.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
    const pending = items.reduce((acc, it) => acc + (!it.isPaid ? (Number(it.amount) || 0) : 0), 0);

    const daysLeft = remainingDaysIncludingToday(new Date());
    const dailyBase = DAILY_TARGET_ARS * daysLeft;
    const adj = Number(this.state.household?.dailyAdjustment || 0);
    const dailyRemaining = dailyBase + adj;

    return { total, pending, daysLeft, dailyBase, dailyAdjustment: adj, dailyRemaining };
  }

  // ====== Items (gastos) ======
  async addItem({ name, amount }) {
    const session = this.state.session;
    if (!session) return;

    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const nm = String(name || "").trim();
      const amt = Math.trunc(Number(amount));

      if (!nm) throw new Error("El nombre del ítem es obligatorio.");
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("El monto debe ser un número mayor a 0.");

      const nowIso = new Date().toISOString();
      const rec = await createRecord("Items", {
        householdCode: session.householdCode,
        name: nm,
        amount: amt,
        isPaid: false,
        updatedAt: nowIso
      });

      const newItem = {
        id: rec.id,
        householdCode: session.householdCode,
        name: nm,
        amount: amt,
        isPaid: false
      };

      this.setState({ items: [newItem, ...this.state.items].sort((a, b) => a.name.localeCompare(b.name, "es")) });
      this.setInfo("Ítem agregado.");
    } catch (e) {
      this.setError(e.message || "No se pudo agregar el ítem.");
    } finally {
      this.setLoading(false);
    }
  }

  async updateItem(itemId, fields) {
    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const patch = { ...fields, updatedAt: new Date().toISOString() };
      await updateRecord("Items", itemId, patch);

      const items = this.state.items.map(it => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          ...("name" in fields ? { name: String(fields.name) } : {}),
          ...("amount" in fields ? { amount: Math.trunc(Number(fields.amount || 0)) } : {}),
          ...("isPaid" in fields ? { isPaid: !!fields.isPaid } : {})
        };
      }).sort((a, b) => a.name.localeCompare(b.name, "es"));

      this.setState({ items });
      this.setInfo("Cambios guardados.");
    } catch (e) {
      this.setError(e.message || "No se pudo actualizar el ítem.");
    } finally {
      this.setLoading(false);
    }
  }

  async removeItem(itemId) {
    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      await deleteRecord("Items", itemId);
      const items = this.state.items.filter(it => it.id !== itemId);
      this.setState({ items });
      this.setInfo("Ítem eliminado.");
    } catch (e) {
      this.setError(e.message || "No se pudo eliminar el ítem.");
    } finally {
      this.setLoading(false);
    }
  }

  async updateDailyAdjustment(newAdjustment) {
    const household = this.state.household;
    if (!household) return;

    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const adj = Math.trunc(Number(newAdjustment || 0));
      await updateRecord("Households", household.id, { dailyAdjustment: adj });
      this.setState({ household: { ...household, dailyAdjustment: adj } });
      this.setInfo("Diario actualizado.");
    } catch (e) {
      this.setError(e.message || "No se pudo actualizar el diario.");
    } finally {
      this.setLoading(false);
    }
  }

  // ====== ShoppingItems (compras) ======
  async addShoppingItem({ name, targetQty }) {
    const session = this.state.session;
    if (!session) return;

    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const nm = String(name || "").trim();
      const tq = Math.trunc(Number(targetQty));

      if (!nm) throw new Error("El nombre del producto es obligatorio.");
      if (!Number.isFinite(tq) || tq <= 0) throw new Error("La cantidad total debe ser mayor a 0.");

      const nowIso = new Date().toISOString();
      const rec = await createRecord("ShoppingItems", {
        householdCode: session.householdCode,
        name: nm,
        targetQty: tq,
        purchasedQty: 0,
        updatedAt: nowIso
      });

      const newItem = {
        id: rec.id,
        householdCode: session.householdCode,
        name: nm,
        targetQty: tq,
        purchasedQty: 0
      };

      const shoppingItems = [newItem, ...this.state.shoppingItems].sort((a, b) => a.name.localeCompare(b.name, "es"));
      this.setState({ shoppingItems });
      this.setInfo("Producto agregado.");
    } catch (e) {
      this.setError(e.message || "No se pudo agregar el producto.");
    } finally {
      this.setLoading(false);
    }
  }

  async updateShoppingItem(itemId, fields) {
    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const current = this.state.shoppingItems.find(x => x.id === itemId);
      if (!current) throw new Error("Producto no encontrado.");

      const next = { ...current };

      if ("name" in fields) next.name = String(fields.name || "").trim();
      if ("targetQty" in fields) next.targetQty = Math.trunc(Number(fields.targetQty || 0));
      if ("purchasedQty" in fields) next.purchasedQty = Math.trunc(Number(fields.purchasedQty || 0));

      if (!next.name) throw new Error("El nombre del producto es obligatorio.");
      if (!Number.isFinite(next.targetQty) || next.targetQty <= 0) throw new Error("La cantidad total debe ser mayor a 0.");

      // Clamp: purchasedQty nunca debe superar targetQty ni ser negativa
      next.purchasedQty = clampInt(next.purchasedQty, 0, next.targetQty);

      const patch = {
        name: next.name,
        targetQty: next.targetQty,
        purchasedQty: next.purchasedQty,
        updatedAt: new Date().toISOString()
      };

      await updateRecord("ShoppingItems", itemId, patch);

      const shoppingItems = this.state.shoppingItems.map(it => it.id === itemId ? next : it)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));

      this.setState({ shoppingItems });
      this.setInfo("Producto actualizado.");
    } catch (e) {
      this.setError(e.message || "No se pudo actualizar el producto.");
    } finally {
      this.setLoading(false);
    }
  }

  async recordPurchase(itemId, delta) {
    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      const current = this.state.shoppingItems.find(x => x.id === itemId);
      if (!current) throw new Error("Producto no encontrado.");

      const d = Math.trunc(Number(delta));
      if (!Number.isFinite(d) || d <= 0) throw new Error("La cantidad comprada debe ser mayor a 0.");

      const nextPurchased = clampInt(current.purchasedQty + d, 0, current.targetQty);

      await updateRecord("ShoppingItems", itemId, {
        purchasedQty: nextPurchased,
        updatedAt: new Date().toISOString()
      });

      const shoppingItems = this.state.shoppingItems.map(it => {
        if (it.id !== itemId) return it;
        return { ...it, purchasedQty: nextPurchased };
      });

      this.setState({ shoppingItems });
      this.setInfo("Compra registrada.");
    } catch (e) {
      this.setError(e.message || "No se pudo registrar la compra.");
    } finally {
      this.setLoading(false);
    }
  }

  async removeShoppingItem(itemId) {
    this.setError("");
    this.setInfo("");
    this.setLoading(true);

    try {
      await deleteRecord("ShoppingItems", itemId);
      const shoppingItems = this.state.shoppingItems.filter(it => it.id !== itemId);
      this.setState({ shoppingItems });
      this.setInfo("Producto eliminado.");
    } catch (e) {
      this.setError(e.message || "No se pudo eliminar el producto.");
    } finally {
      this.setLoading(false);
    }
  }
}

export const store = new Store();
