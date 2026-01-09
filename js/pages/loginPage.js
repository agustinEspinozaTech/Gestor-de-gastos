/**
 * Responsabilidad: pantalla de login/registro.
 * - Dos tabs: Crear usuario / Iniciar sesión
 * - Validación simple
 * - Mensajes claros
 */

import { store } from "../state/store.js";
import { el, button, input, field, card, tabs, errorBox, notice, skeletonLines, showToast } from "../ui/components.js";

export async function renderLoginPage(root, router) {
  let activeTab = "login"; // "login" | "register"
  let regMode = "new"; // "new" | "join"

  const wrapper = el("div", { class: "grid" });

  const header = el("div", { class: "topbar" }, [
    el("div", { class: "brand" }, [
      el("h1", { text: "Gastos en pareja" }),
      el("div", { class: "sub", text: "Control mensual compartido, simple y rápido" })
    ]),
    el("div", { class: "actions" }, [
      button("Ir a Home", {
        variant: "ghost",
        onClick: () => router.navigate("/home")
      })
    ])
  ]);

  const hint = notice("Configurá tu Base ID y token en js/config.js. Si ya lo hiciste, podés crear tu usuario o iniciar sesión.");

  const stateBox = el("div");

  function renderState() {
    const st = store.state;
    stateBox.innerHTML = "";
    if (st.error) stateBox.appendChild(errorBox(st.error));
    else if (st.loading) stateBox.appendChild(card([skeletonLines(4)]));
  }

  const tabsEl = tabs({
    active: activeTab,
    items: [
      { key: "login", label: "Iniciar sesión" },
      { key: "register", label: "Crear usuario" }
    ],
    onChange: (k) => {
      activeTab = k;
      redraw();
    }
  });

  const panel = el("div");

  function loginForm() {
    const email = input({ placeholder: "tu@email.com", type: "email", autocomplete: "email" });
    const pin = input({ placeholder: "1234", type: "password", inputMode: "numeric", autocomplete: "one-time-code" });

    const form = el("form", { class: "form" }, [
      field("Email", email),
      field("Pin (4 a 6 dígitos)", pin),
      button("Ingresar", {
        variant: "primary wide",
        type: "submit"
      })
    ]);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await store.login(email.value, pin.value);
      renderState();
      if (!store.state.error && store.getSession()) {
        showToast("Listo. Entraste.");
        router.navigate("/home");
      }
    });

    return card([
      el("div", { class: "section-title" }, [
        el("h2", { text: "Ingresar" }),
        el("small", { text: "Email + pin" })
      ]),
      form
    ]);
  }

  function registerForm() {
    const name = input({ placeholder: "Nombre", type: "text", autocomplete: "name" });
    const email = input({ placeholder: "tu@email.com", type: "email", autocomplete: "email" });
    const pin = input({ placeholder: "1234", type: "password", inputMode: "numeric", autocomplete: "new-password" });

    const joinCode = input({ placeholder: "Código de hogar", type: "text", autocomplete: "off" });

    const modeSelect = el("select", { class: "select" }, [
      el("option", { value: "new", text: "Crear hogar nuevo" }),
      el("option", { value: "join", text: "Unirme a un hogar existente" })
    ]);
    modeSelect.value = regMode;
    modeSelect.addEventListener("change", () => {
      regMode = modeSelect.value;
      redraw();
    });

    const formKids = [
      field("Nombre", name),
      field("Email", email),
      field("Pin (4 a 6 dígitos)", pin, "Se guarda tal cual (simple, sin seguridad avanzada)."),
      field("Hogar", modeSelect)
    ];

    if (regMode === "join") {
      formKids.push(field("Código de hogar", joinCode, "Pedile el código a tu pareja."));
    } else {
      formKids.push(notice("Al crear hogar nuevo se genera un código compartido. Luego podés pasárselo a tu pareja."));
    }

    const form = el("form", { class: "form" }, [
      ...formKids,
      button("Crear usuario", { variant: "good wide", type: "submit" })
    ]);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await store.register({
        name: name.value,
        email: email.value,
        pin: pin.value,
        mode: regMode,
        householdCodeInput: joinCode.value
      });
      renderState();
      if (!store.state.error && store.getSession()) {
        showToast("Usuario creado. Entraste.");
        router.navigate("/home");
      }
    });

    return card([
      el("div", { class: "section-title" }, [
        el("h2", { text: "Crear usuario" }),
        el("small", { text: "Alta rápida" })
      ]),
      form
    ]);
  }

  function redraw() {
    panel.innerHTML = "";
    panel.appendChild(activeTab === "login" ? loginForm() : registerForm());
  }

  // Subscribirse a cambios del store para reflejar estado
  const unsub = store.subscribe(() => renderState());

  wrapper.appendChild(header);
  wrapper.appendChild(hint);
  wrapper.appendChild(tabsEl);
  wrapper.appendChild(stateBox);
  wrapper.appendChild(panel);

  redraw();
  renderState();

  root.appendChild(wrapper);

  // Cleanup si alguna vez se necesitara (router simple no lo llama, pero queda correcto)
  root._cleanup = () => unsub();
}
