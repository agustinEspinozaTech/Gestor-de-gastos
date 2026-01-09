/**
 * Responsabilidad: router hash simple.
 * - Rutas: #/login, #/home, #/daily
 * - Soporta guard de auth
 */

import { getSession } from "../storage/localSession.js";

export class Router {
  constructor({ root, routes }) {
    this.root = root;
    this.routes = routes; // { "/login": fn, "/home": fn, "/daily": fn }
    this.onRouteChange = this.onRouteChange.bind(this);
  }

  start() {
    window.addEventListener("hashchange", this.onRouteChange);
    this.onRouteChange();
  }

  stop() {
    window.removeEventListener("hashchange", this.onRouteChange);
  }

  navigate(path) {
    window.location.hash = `#${path}`;
  }

  getPath() {
    const raw = window.location.hash || "#/login";
    const path = raw.startsWith("#") ? raw.slice(1) : raw;
    return path || "/login";
  }

  async onRouteChange() {
    const path = this.getPath();

    const session = getSession();
    const isAuth = !!session;

    // Guard: si no hay sesión, enviar a login
    if (!isAuth && (path === "/home" || path === "/daily")) {
      this.navigate("/login");
      return;
    }
    // Si hay sesión y pide login, mandar a home
    if (isAuth && path === "/login") {
      this.navigate("/home");
      return;
    }

    const handler = this.routes[path] || this.routes["/login"];
    this.root.innerHTML = "";
    await handler(this.root, this);
  }
}
