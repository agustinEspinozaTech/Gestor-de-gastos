/**
 * Responsabilidad: helpers de UI y componentes reutilizables.
 * - Creación de elementos
 * - Modal
 * - Toast
 * - Render de estados (loading/error)
 */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }

  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }

  return node;
}

export function button(label, { variant = "", onClick, type = "button", className = "" } = {}) {
  const cls = ["btn", variant, className].filter(Boolean).join(" ");
  return el("button", { class: cls, type, onClick, text: label });
}

export function input({ value = "", placeholder = "", type = "text", inputMode = "", autocomplete = "off", onInput, onChange } = {}) {
  const props = { class: "input", value, placeholder, type, autocomplete };
  if (inputMode) props.inputmode = inputMode;
  if (onInput) props.onInput = onInput;
  if (onChange) props.onChange = onChange;
  return el("input", props);
}

export function field(label, control, helpText = "") {
  return el("div", { class: "field" }, [
    el("label", { text: label }),
    control,
    helpText ? el("div", { class: "help", text: helpText }) : null
  ]);
}

export function card(children = []) {
  return el("div", { class: "card" }, children);
}

export function notice(text) {
  return el("div", { class: "notice", text });
}

export function errorBox(text) {
  return el("div", { class: "error", text });
}

export function successBox(text) {
  return el("div", { class: "success", text });
}

export function skeletonLines(count = 4) {
  const lines = [];
  for (let i = 0; i < count; i++) lines.push(el("div", { class: "skel" }));
  return el("div", { class: "grid" }, lines);
}

export function createModal({ title = "Modal", content, onClose }) {
  const backdrop = el("div", {
    class: "modal-backdrop",
    onClick: (e) => {
      if (e.target === backdrop) onClose?.();
    }
  });

  const box = el("div", { class: "modal" });
  const header = el("header", {}, [
    el("h3", { text: title }),
    button("Cerrar", { variant: "ghost", onClick: () => onClose?.() })
  ]);

  box.appendChild(header);
  box.appendChild(content);

  backdrop.appendChild(box);

  return {
    open() { document.body.appendChild(backdrop); },
    close() { backdrop.remove(); onClose?.(); }
  };
}

let toastEl = null;
let toastTimer = null;

export function showToast(message, { timeout = 2600 } = {}) {
  if (toastTimer) clearTimeout(toastTimer);
  if (toastEl) toastEl.remove();

  toastEl = el("div", { class: "toast" }, [
    el("div", { class: "msg", text: message }),
    el("button", {
      class: "close",
      text: "X",
      onClick: () => {
        if (toastEl) toastEl.remove();
        toastEl = null;
      }
    })
  ]);

  document.body.appendChild(toastEl);

  toastTimer = setTimeout(() => {
    if (toastEl) toastEl.remove();
    toastEl = null;
  }, timeout);
}

export function tabs({ active, items, onChange }) {
  // items: [{key,label}]
  return el("div", { class: "tabs" },
    items.map(it =>
      el("button", {
        class: `tab ${active === it.key ? "active" : ""}`,
        type: "button",
        onClick: () => onChange?.(it.key),
        text: it.label
      })
    )
  );
}
