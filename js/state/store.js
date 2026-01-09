/**
 * Responsabilidad: estado global en memoria + acciones para sincronizar con Airtable.
 * - Mantiene sesión, household, items del mes.
 * - Expone acciones: login, register, logout, refresh, CRUD de items, update dailyAdjustment.
 */

import { getSession, setSession, clearSession } from "../storage/localSession.js";
import { listRecords, createRecord, updateRecord, deleteRecord, batchUpdateRecords } from "../api/airtable.js";
import { getMonthId, remainingDaysIncludingToday } from "../utils/date.js";
import { DAILY_TARGET_ARS } from "../config.js";

function escapeAirtableString(s) {
    // En fórmulas, las strings van con comillas simples. Escapar comillas simples duplicándolas.
    return String(s).replace(/'/g, "''");
}

function lower(s) {
    return String(s || "").trim().toLowerCase();
}

function randomHouseholdCode(len = 9) {
    // "legible": sin caracteres ambiguos (0,O,1,I)
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
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
            items: [] // [{ id, householdCode, name, amount, isPaid }]
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

    setLoading(v) {
        this.setState({ loading: !!v });
    }

    setError(msg) {
        this.setState({ error: msg || "" });
    }

    setInfo(msg) {
        this.setState({ info: msg || "" });
    }

    getSession() {
        return this.state.session;
    }

    async logout() {
        clearSession();
        this.setState({ session: null, household: null, items: [] });
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

            // Buscar por email primero (para diferenciar errores)
            const fEmail = `LOWER({email})='${escapeAirtableString(emailNorm)}'`;
            const users = await listRecords("Users", fEmail, { maxRecords: 10 });

            if (users.length === 0) {
                throw new Error("Usuario no existe.");
            }

            const user = users[0];
            const storedPin = String(user.fields?.pin ?? "").trim();
            if (storedPin !== pinNorm) {
                throw new Error("Pin incorrecto.");
            }

            const householdCode = String(user.fields?.householdCode || "").trim();
            if (!householdCode) throw new Error("El usuario no tiene hogar asignado.");

            // Validar hogar
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
        /**
         * mode: "new" | "join"
         */
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

            // Validar duplicado email
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
                // Crear hogar nuevo con código único
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
                await createRecord("Households", {
                    householdCode,
                    monthId,
                    dailyAdjustment: 0
                });
            }

            // Crear usuario
            const createdAt = new Date().toISOString();
            const user = await createRecord("Users", {
                name: nameNorm,
                email: emailNorm,
                pin: pinNorm,
                householdCode,
                createdAt
            });

            const session = {
                userId: user.id,
                userName: nameNorm,
                householdCode
            };
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
                    // 1) Actualizar household
                    await updateRecord("Households", household.id, {
                        monthId: currentMonthId,
                        dailyAdjustment: 0
                    });
                    household.monthId = currentMonthId;
                    household.dailyAdjustment = 0;

                    // 2) Reset isPaid de items del hogar (sin borrar)
                    const fItems = `{householdCode}='${escapeAirtableString(householdCode)}'`;
                    const items = await listRecords("Items", fItems, { maxRecords: 200 });
                    const nowIso = new Date().toISOString();

                    const updates = items.map(it => ({
                        id: it.id,
                        fields: { isPaid: false, updatedAt: nowIso }
                    }));

                    if (updates.length > 0) {
                        // batch de a 10 para que sea más rápido y dentro del límite de Airtable
                        await batchUpdateRecords("Items", updates);
                    }
                }
            }

            // Traer items
            const fItems = `{householdCode}='${escapeAirtableString(householdCode)}'`;
            const itemsRecs = await listRecords("Items", fItems, { maxRecords: 200 });

            const items = itemsRecs.map(r => ({
                id: r.id,
                householdCode: String(r.fields?.householdCode || householdCode),
                name: String(r.fields?.name || ""),
                amount: Math.trunc(Number(r.fields?.amount || 0)),
                isPaid: !!r.fields?.isPaid
            })).sort((a, b) => a.name.localeCompare(b.name, "es"));


            this.setState({ household, items });
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

            this.setState({ items: [newItem, ...this.state.items] });
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
            });

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

            this.setState({
                household: { ...household, dailyAdjustment: adj }
            });

            this.setInfo("Diario actualizado.");
        } catch (e) {
            this.setError(e.message || "No se pudo actualizar el diario.");
        } finally {
            this.setLoading(false);
        }
    }
}

export const store = new Store();
