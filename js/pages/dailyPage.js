/**
 * Responsabilidad: pantalla "Editar diario".
 * - Muestra diario base (solo lectura)
 * - Permite editar dailyAdjustment (entero, puede ser negativo)
 * - Guarda en Households.dailyAdjustment
 */

import { store } from "../state/store.js";
import { el, button, card, field, input, errorBox, skeletonLines, showToast } from "../ui/components.js";
import { formatARSWithPrefix, parseARS } from "../utils/format.js";

export async function renderDailyPage(root, router) {
  const wrapper = el("div", { class: "grid" });

  const top = el("div", { class: "topbar" }, [
    el("div", { class: "brand" }, [
      el("h1", { text: "Editar diario" }),
      el("div", { class: "sub", text: "Ajuste del diario compartido del hogar" })
    ]),
    el("div", { class: "actions" }, [
      button("Volver", { variant: "ghost", onClick: () => router.navigate("/home") })
    ])
  ]);

  const stateArea = el("div");
  const contentArea = el("div");

  function renderState() {
    stateArea.innerHTML = "";
    const st = store.state;
    if (st.error) stateArea.appendChild(errorBox(st.error));
    else if (st.loading) stateArea.appendChild(card([skeletonLines(4)]));
  }

  function renderContent() {
    contentArea.innerHTML = "";

    const household = store.state.household;
    if (!household) {
      contentArea.appendChild(card([el("div", { text: "No hay hogar cargado. Volvé a Home y actualizá." })]));
      return;
    }

    const { dailyBase, dailyAdjustment, dailyRemaining, daysLeft } = store.computeTotals();

    const adjInput = input({
      value: String(dailyAdjustment),
      inputMode: "numeric",
      placeholder: "Ej: -50000"
    });

    const form = el("form", { class: "form" }, [
      el("div", { class: "notice" }, [
        el("div", { style: "font-weight:800", text: "Cómo se calcula" }),
        el("div", { style: "font-size:12px; margin-top:6px" },
          `Base = 23.000 × días restantes incluyendo hoy (${daysLeft}). Luego se suma el ajuste.`
        )
      ]),
      field("Diario base (solo lectura)", el("div", { class: "input", style: "display:flex;align-items:center", text: formatARSWithPrefix(dailyBase) })),
      field("Ajuste (puede ser negativo)", adjInput, "Ejemplo: -50000 si ya gastaron de más, o 20000 si quieren aflojar menos."),
      field("Diario restante (resultado)", el("div", { class: "input", style: "display:flex;align-items:center;font-weight:800", text: formatARSWithPrefix(dailyRemaining) })),
      el("div", { class: "grid cols-2" }, [
        button("Volver", { variant: "ghost wide", type: "button", onClick: () => router.navigate("/home") }),
        button("Guardar", { variant: "primary wide", type: "submit" })
      ])
    ]);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = parseARS(adjInput.value);
      // parseARS elimina separadores; conserva signo si lo escriben con "-"
      await store.updateDailyAdjustment(val);
      renderState();
      renderContent();
      if (!store.state.error) {
        showToast("Diario guardado.");
        router.navigate("/home");
      }
    });

    contentArea.appendChild(card([form]));
  }

  const unsub = store.subscribe(() => {
    renderState();
    renderContent();
    if (store.state.info) showToast(store.state.info);
  });

  wrapper.appendChild(top);
  wrapper.appendChild(stateArea);
  wrapper.appendChild(contentArea);
  root.appendChild(wrapper);

  // Asegurar datos cargados
  if (!store.state.household) {
    await store.loadHouseholdAndItems({ forceResetCheck: true });
  }

  renderState();
  renderContent();

  root._cleanup = () => unsub();
}
