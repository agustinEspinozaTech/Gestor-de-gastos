/**
 * Responsabilidad: entrypoint.
 * - Crea router
 * - Renderiza páginas
 * - Maneja arranque con sesión
 */

import { Router } from "./ui/router.js";
import { renderLoginPage } from "./pages/loginPage.js";
import { renderHomePage } from "./pages/homePage.js";
import { renderDailyPage } from "./pages/dailyPage.js";
import { getSession } from "./storage/localSession.js";
import { showToast } from "./ui/components.js";

const root = document.getElementById("app");

const router = new Router({
  root,
  routes: {
    "/login": renderLoginPage,
    "/home": renderHomePage,
    "/daily": renderDailyPage
  }
});

// Manejo simple de cleanup (si un render define root._cleanup)
const originalOnRouteChange = router.onRouteChange.bind(router);
router.onRouteChange = async () => {
  try {
    if (typeof root._cleanup === "function") {
      try { root._cleanup(); } catch {}
      root._cleanup = null;
    }
    await originalOnRouteChange();
  } catch (e) {
    root.innerHTML = "";
    root.appendChild(document.createTextNode("Error inesperado en la app."));
    console.error(e);
  }
};

router.start();

// Redirección inicial si hay sesión
if (getSession()) {
  router.navigate("/home");
} else {
  router.navigate("/login");
}

// Nota visible en consola para facilitar debug
showToast("App lista. Si falta config, revisá js/config.js.");
