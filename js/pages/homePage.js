/**
 * Responsabilidad: pantalla principal (mes actual).
 * - Header Mes Año + Hola usuario + hogar
 * - Botón Actualizar y Cerrar sesión
 * - KPIs: Total / Pendiente / Diario restante
 * - Lista Items (gastos)
 * - NUEVO: Lista ShoppingItems (compras con cantidades)
 */

import { store } from "../state/store.js";
import { el, button, card, errorBox, notice, skeletonLines, createModal, input, field, showToast } from "../ui/components.js";
import { getMonthLabel } from "../utils/date.js";
import { formatARSWithPrefix, parseARS } from "../utils/format.js";

function badgeForPaid(isPaid) {
  return el("span", { class: `badge ${isPaid ? "paid" : "pending"}`, text: isPaid ? "Pagado" : "Pendiente" });
}

function badgeForShopping(done) {
  return el("span", { class: `badge ${done ? "paid" : "pending"}`, text: done ? "Completo" : "Pendiente" });
}

export async function renderHomePage(root, router) {
  const wrapper = el("div", { class: "grid" });

  const top = el("div", { class: "topbar" });
  const left = el("div", { class: "brand" });
  const right = el("div", { class: "actions" });

  const monthTitle = el("h1", { text: getMonthLabel(new Date()) });
  const sub = el("div", { class: "sub" });

  left.appendChild(monthTitle);
  left.appendChild(sub);

  const btnRefresh = button("Actualizar", {
    variant: "primary",
    onClick: async () => {
      await store.loadHouseholdAndItems({ forceResetCheck: true });
      repaint();
      if (!store.state.error) showToast("Actualizado.");
    }
  });

  const btnShopping = button("Lista de compras", {
    variant: "ghost",
    onClick: () => {
      const target = document.getElementById("shopping-section");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  const btnLogout = button("Cerrar sesión", {
    variant: "danger",
    onClick: async () => {
      await store.logout();
      router.navigate("/login");
    }
  });

  right.appendChild(btnRefresh);
  right.appendChild(btnShopping);
  right.appendChild(btnLogout);


  top.appendChild(left);
  top.appendChild(right);

  const stateArea = el("div");
  const kpisArea = el("div", { class: "grid cols-2" });
  const dailyArea = el("div");
  const listArea = el("div");
  const shoppingArea = el("div", { id: "shopping-section" });

  function renderHeaderInfo() {
    const sess = store.getSession();
    const code = sess?.householdCode || "-";
    const name = sess?.userName || "Usuario";
    sub.textContent = `Hola, ${name} · Hogar: ${code}`;
  }

  function renderState() {
    stateArea.innerHTML = "";
    const st = store.state;
    if (st.error) stateArea.appendChild(errorBox(st.error));
    else if (st.loading) stateArea.appendChild(card([skeletonLines(5)]));
  }

  function renderKpis() {
    kpisArea.innerHTML = "";

    const { total, pending, daysLeft, dailyBase, dailyAdjustment, dailyRemaining } = store.computeTotals();

    const k1 = card([
      el("div", { class: "kpi" }, [
        el("div", { class: "label", text: "Total del mes" }),
        el("div", { class: "value", text: formatARSWithPrefix(total) }),
        el("div", { class: "hint", text: "Pagados + pendientes" })
      ])
    ]);

    const k2 = card([
      el("div", { class: "kpi" }, [
        el("div", { class: "label", text: "Pendiente" }),
        el("div", { class: "value", text: formatARSWithPrefix(pending) }),
        el("div", { class: "hint", text: "Solo pendientes" })
      ])
    ]);

    const k3 = card([
      el("div", { class: "kpi" }, [
        el("div", { class: "label", text: "Diario restante" }),
        el("div", { class: "value", text: formatARSWithPrefix(dailyRemaining) }),
        el("div", { class: "hint", text: `Base: ${formatARSWithPrefix(dailyBase)} (${daysLeft} días) · Ajuste: ${formatARSWithPrefix(dailyAdjustment)}` })
      ])
    ]);

    const btnDaily = button("Editar diario", {
      variant: "good wide",
      onClick: () => router.navigate("/daily")
    });

    dailyArea.innerHTML = "";
    dailyArea.appendChild(k3);
    dailyArea.appendChild(el("div", { style: "height:10px" }));
    dailyArea.appendChild(btnDaily);

    kpisArea.appendChild(k1);
    kpisArea.appendChild(k2);
  }

  // ===== Modales de Gastos =====
  function openAddModal() {
    const nm = input({ placeholder: "Ej: Internet" });
    const amt = input({ placeholder: "Ej: 25000", inputMode: "numeric" });

    const content = el("div", {}, [
      el("form", { class: "form" }, [
        field("Nombre", nm),
        field("Monto (ARS)", amt, "Sin decimales. Podés escribir con separadores y se normaliza."),
        el("div", { class: "modal-actions" }, [
          button("Cancelar", { variant: "ghost", onClick: () => modal.close() }),
          button("Guardar", { variant: "primary", type: "submit" })
        ])
      ])
    ]);

    content.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await store.addItem({ name: nm.value, amount: parseARS(amt.value) });
      if (!store.state.error) {
        modal.close();
        repaint();
      }
    });

    const modal = createModal({ title: "Agregar ítem", content, onClose: () => { } });
    modal.open();
  }

  function openEditModal(item) {
    const nm = input({ value: item.name, placeholder: "Nombre" });
    const amt = input({ value: String(item.amount), inputMode: "numeric", placeholder: "Monto" });

    const content = el("div", {}, [
      el("form", { class: "form" }, [
        field("Nombre", nm),
        field("Monto (ARS)", amt),
        el("div", { class: "modal-actions" }, [
          button("Cancelar", { variant: "ghost", onClick: () => modal.close() }),
          button("Guardar", { variant: "primary", type: "submit" })
        ])
      ])
    ]);

    content.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await store.updateItem(item.id, { name: nm.value, amount: parseARS(amt.value) });
      if (!store.state.error) {
        modal.close();
        repaint();
      }
    });

    const modal = createModal({ title: "Editar ítem", content, onClose: () => { } });
    modal.open();
  }

  function renderList() {
    listArea.innerHTML = "";

    const st = store.state;
    const items = st.items || [];

    const head = el("div", { class: "section-title" }, [
      el("h2", { text: "Ítems del mes" }),
      el("small", { text: `${items.length} ítems` })
    ]);

    const addBtn = button("Agregar ítem", { variant: "primary wide", onClick: openAddModal });

    listArea.appendChild(head);

    if (!st.loading && items.length === 0) {
      listArea.appendChild(notice("Todavía no hay ítems. Agregá el primero para empezar."));
      listArea.appendChild(el("div", { style: "height:10px" }));
      listArea.appendChild(addBtn);
      return;
    }

    const list = el("div", { class: "list" });

    for (const it of items) {
      const left = el("div", { class: "left" }, [
        el("div", { class: "name", text: it.name }),
        el("div", { class: "meta", text: formatARSWithPrefix(it.amount) })
      ]);

      const toggle = el("button", { class: "icon-btn", type: "button", text: it.isPaid ? "OK" : "..." });
      toggle.addEventListener("click", async () => {
        await store.updateItem(it.id, { isPaid: !it.isPaid });
        if (!store.state.error) repaint();
      });

      const edit = el("button", { class: "icon-btn", type: "button", text: "Edit" });
      edit.addEventListener("click", () => openEditModal(it));

      const del = el("button", { class: "icon-btn", type: "button", text: "Del" });
      del.addEventListener("click", async () => {
        const yes = confirm(`Eliminar "${it.name}"?`);
        if (!yes) return;
        await store.removeItem(it.id);
        if (!store.state.error) repaint();
      });

      const right = el("div", { class: "right" }, [badgeForPaid(it.isPaid), toggle, edit, del]);
      const row = el("div", { class: "row" }, [left, right]);
      list.appendChild(row);
    }

    listArea.appendChild(list);
    listArea.appendChild(el("div", { style: "height:10px" }));
    listArea.appendChild(addBtn);
  }

  // ===== Shopping (Compras) =====
  function openAddShoppingModal() {
    const nm = input({ placeholder: "Ej: Pasta" });
    const qty = input({ placeholder: "Ej: 5", inputMode: "numeric" });

    const content = el("div", {}, [
      el("form", { class: "form" }, [
        field("Producto", nm),
        field("Cantidad total del mes", qty, "Ej: 5 (se van marcando compras parciales)"),
        el("div", { class: "modal-actions" }, [
          button("Cancelar", { variant: "ghost", onClick: () => modal.close() }),
          button("Guardar", { variant: "primary", type: "submit" })
        ])
      ])
    ]);

    content.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetQty = Math.trunc(Number(qty.value));
      await store.addShoppingItem({ name: nm.value, targetQty });
      if (!store.state.error) {
        modal.close();
        repaint();
      }
    });

    const modal = createModal({ title: "Agregar producto", content, onClose: () => { } });
    modal.open();
  }

  function openEditShoppingModal(item) {
    const nm = input({ value: item.name, placeholder: "Producto" });
    const qty = input({ value: String(item.targetQty), inputMode: "numeric", placeholder: "Cantidad total" });

    const content = el("div", {}, [
      el("form", { class: "form" }, [
        field("Producto", nm),
        field("Cantidad total del mes", qty, "Si bajás la cantidad total por debajo de lo ya comprado, se ajusta automáticamente."),
        el("div", { class: "modal-actions" }, [
          button("Cancelar", { variant: "ghost", onClick: () => modal.close() }),
          button("Guardar", { variant: "primary", type: "submit" })
        ])
      ])
    ]);

    content.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetQty = Math.trunc(Number(qty.value));
      await store.updateShoppingItem(item.id, { name: nm.value, targetQty });
      if (!store.state.error) {
        modal.close();
        repaint();
      }
    });

    const modal = createModal({ title: "Editar producto", content, onClose: () => { } });
    modal.open();
  }

  function openPurchaseModal(item) {
    const remaining = Math.max(0, item.targetQty - item.purchasedQty);
    const delta = input({ placeholder: `Ej: 2 (faltan ${remaining})`, inputMode: "numeric" });

    const content = el("div", {}, [
      el("form", { class: "form" }, [
        field("Comprar ahora (cantidad)", delta, `Compradas: ${item.purchasedQty} de ${item.targetQty}. Faltan: ${remaining}.`),
        el("div", { class: "modal-actions" }, [
          button("Cancelar", { variant: "ghost", onClick: () => modal.close() }),
          button("Registrar", { variant: "primary", type: "submit" })
        ])
      ])
    ]);

    content.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Math.trunc(Number(delta.value));
      await store.recordPurchase(item.id, d);
      if (!store.state.error) {
        modal.close();
        repaint();
      }
    });

    const modal = createModal({ title: "Registrar compra", content, onClose: () => { } });
    modal.open();
  }

  function renderShopping() {
    shoppingArea.innerHTML = "";

    const st = store.state;
    const items = st.shoppingItems || [];

    const head = el("div", { class: "section-title" }, [
      el("h2", { text: "Listado de compras" }),
      el("small", { text: `${items.length} productos` })
    ]);

    const addBtn = button("Agregar producto", { variant: "primary wide", onClick: openAddShoppingModal });

    shoppingArea.appendChild(head);

    if (!st.loading && items.length === 0) {
      shoppingArea.appendChild(notice("Todavía no hay productos. Agregá uno (con cantidad total) y marcá compras parciales."));
      shoppingArea.appendChild(el("div", { style: "height:10px" }));
      shoppingArea.appendChild(addBtn);
      return;
    }

    const list = el("div", { class: "list" });

    for (const it of items) {
      const remaining = Math.max(0, it.targetQty - it.purchasedQty);
      const done = remaining === 0 && it.targetQty > 0;

      const left = el("div", { class: "left" }, [
        el("div", { class: "name", text: it.name }),
        el("div", { class: "meta", text: `Compradas: ${it.purchasedQty} / ${it.targetQty} · Faltan: ${remaining}` })
      ]);

      const plus1 = el("button", { class: "icon-btn", type: "button", text: "+1" });
      plus1.addEventListener("click", async () => {
        await store.recordPurchase(it.id, 1);
        if (!store.state.error) repaint();
      });

      const buyN = el("button", { class: "icon-btn", type: "button", text: "Buy" });
      buyN.addEventListener("click", () => openPurchaseModal(it));

      const edit = el("button", { class: "icon-btn", type: "button", text: "Edit" });
      edit.addEventListener("click", () => openEditShoppingModal(it));

      const del = el("button", { class: "icon-btn", type: "button", text: "Del" });
      del.addEventListener("click", async () => {
        const yes = confirm(`Eliminar "${it.name}"?`);
        if (!yes) return;
        await store.removeShoppingItem(it.id);
        if (!store.state.error) repaint();
      });

      const right = el("div", { class: "right" }, [
        badgeForShopping(done),
        plus1,
        buyN,
        edit,
        del
      ]);

      const row = el("div", { class: "row" }, [left, right]);
      list.appendChild(row);
    }

    shoppingArea.appendChild(list);
    shoppingArea.appendChild(el("div", { style: "height:10px" }));
    shoppingArea.appendChild(addBtn);
  }

  function repaint() {
    renderHeaderInfo();
    renderState();
    renderKpis();
    renderList();
    shoppingArea.appendChild(el("hr", { class: "sep" }));
    renderShopping();

    const st = store.state;
    if (st.info) showToast(st.info);
  }

  const unsub = store.subscribe(() => repaint());

  wrapper.appendChild(top);
  wrapper.appendChild(stateArea);
  wrapper.appendChild(kpisArea);
  wrapper.appendChild(dailyArea);
  wrapper.appendChild(el("hr", { class: "sep" }));
  wrapper.appendChild(listArea);
  wrapper.appendChild(shoppingArea);

  root.appendChild(wrapper);

  if (!store.state.household) {
    await store.loadHouseholdAndItems({ forceResetCheck: true });
  }
  repaint();

  root._cleanup = () => unsub();
}
