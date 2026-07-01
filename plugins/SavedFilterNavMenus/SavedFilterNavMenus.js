(() => {
  "use strict";

  if (window.__savedFilterNavMenusLoaded) return;
  window.__savedFilterNavMenusLoaded = true;

  const PLUGIN_ID = "SavedFilterNavMenus";
  const MENU_CLASS = "saved-filter-nav-menu";
  const HOST_CLASS = "saved-filter-nav-menu-host";
  const REFRESH_DELAY_MS = 120;

  const CONTENT_LINKS = [
    { mode: "SCENES", path: "/scenes", labels: ["scenes"] },
    { mode: "IMAGES", path: "/images", labels: ["images"] },
    { mode: "GALLERIES", path: "/galleries", labels: ["galleries"] },
    { mode: "PERFORMERS", path: "/performers", labels: ["performers"] },
    { mode: "STUDIOS", path: "/studios", labels: ["studios"] },
    { mode: "TAGS", path: "/tags", labels: ["tags"] },
    { mode: "SCENE_MARKERS", path: "/scenes/markers", labels: ["markers", "scene markers"] },
  ];

  const state = {
    filtersByMode: new Map(),
    filtersLoaded: false,
    loadPromise: null,
    mountTimer: null,
    observer: null,
    observerActive: false,
  };

  function gqlRequest(query, variables = {}) {
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    })
      .then((response) => response.json())
      .then((json) => {
        if (json.errors?.length) {
          throw new Error(json.errors.map((error) => error.message).join("; "));
        }
        return json.data || {};
      });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeFilters(filters) {
    return Array.from(filters || [])
      .map((filter) => ({
        id: String(filter?.id || ""),
        name: String(filter?.name || "").trim(),
        mode: String(filter?.mode || ""),
        find_filter: filter?.find_filter || {},
        object_filter: filter?.object_filter || {},
        ui_options: filter?.ui_options || {},
      }))
      .filter((filter) => filter.id && filter.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  async function loadSavedFilters() {
    if (state.filtersLoaded) return Promise.resolve();
    if (state.loadPromise) return state.loadPromise;

    const query = `
      query SavedFilterNavMenusFindSavedFilters($mode: FilterMode!) {
        findSavedFilters(mode: $mode) {
          id
          name
          mode
          find_filter {
            q
            page
            per_page
            sort
            direction
          }
          object_filter
          ui_options
        }
      }
    `;

    state.loadPromise = Promise.all(
      CONTENT_LINKS.map(async (item) => {
        try {
          const data = await gqlRequest(query, { mode: item.mode });
          state.filtersByMode.set(item.mode, normalizeFilters(data.findSavedFilters || []));
        } catch (err) {
          console.error(`[${PLUGIN_ID}] failed to load saved filters for ${item.mode}`, err);
          state.filtersByMode.set(item.mode, []);
        }
      })
    )
      .then(() => {
        state.filtersLoaded = true;
      })
      .finally(() => {
        state.loadPromise = null;
      });

    return state.loadPromise;
  }

  function appendFindFilterParams(url, findFilter = {}) {
    const q = String(findFilter.q || "").trim();
    if (q) url.searchParams.set("q", q);

    const sort = String(findFilter.sort || "").trim();
    const direction = String(findFilter.direction || "").trim().toUpperCase();
    const routeDirection = direction === "DESC" ? "desc" : direction === "ASC" ? "asc" : "";
    if (sort) {
      url.searchParams.set("sortby", sort);
      url.searchParams.set("sort", sort);
    }
    if (direction) {
      if (routeDirection) {
        url.searchParams.set("sortdir", routeDirection);
        url.searchParams.set("sortDirection", routeDirection);
      }
      url.searchParams.set("direction", direction);
    }

    const page = Number(findFilter.page);
    const perPage = Number(findFilter.per_page);
    if (Number.isFinite(page) && page > 0) url.searchParams.set("page", String(page));
    if (Number.isFinite(perPage) && perPage > 0) {
      url.searchParams.set("perPage", String(perPage));
      url.searchParams.set("per_page", String(perPage));
    }
  }

  function appendUiOptionParams(url, uiOptions = {}) {
    const displayMode = Number(uiOptions.display_mode);
    const zoomIndex = Number(uiOptions.zoom_index);
    if (Number.isFinite(displayMode)) url.searchParams.set("displayMode", String(displayMode));
    if (Number.isFinite(zoomIndex)) url.searchParams.set("zoomIndex", String(zoomIndex));
  }

  function appendObjectFilterCriteria(url, objectFilter = {}) {
    Object.entries(objectFilter || {}).forEach(([type, criterion]) => {
      if (!type || !criterion || typeof criterion !== "object") return;
      url.searchParams.append(
        "c",
        JSON.stringify({
          type,
          ...criterion,
        })
      );
    });
  }

  function buildSavedFilterHref(item, filter) {
    const url = new URL(item.path, window.location.origin);
    url.searchParams.set("savedFilterId", filter.id);
    url.searchParams.set("saved_filter_id", filter.id);
    appendFindFilterParams(url, filter.find_filter);
    appendObjectFilterCriteria(url, filter.object_filter);
    appendUiOptionParams(url, filter.ui_options);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function getAnchorPath(anchor) {
    try {
      return new URL(anchor.getAttribute("href") || "", window.location.origin).pathname.replace(/\/+$/, "") || "/";
    } catch (err) {
      return "";
    }
  }

  function labelMatches(anchor, item) {
    const text = String(anchor.textContent || "").trim().toLowerCase();
    if (!text) return false;
    return item.labels.some((label) => text === label || text.includes(label));
  }

  function findNavAnchor(item) {
    const wantedPath = String(item.path || "").replace(/\/+$/, "") || "/";
    const scoped = Array.from(document.querySelectorAll("nav a[href], .navbar a[href]"));
    const all = scoped.length ? scoped : Array.from(document.querySelectorAll("a[href]"));
    return (
      all.find(
        (anchor) =>
          anchor instanceof HTMLAnchorElement &&
          getAnchorPath(anchor) === wantedPath &&
          labelMatches(anchor, item)
      ) || null
    );
  }

  function createMenu(item, filters) {
    const menu = document.createElement("div");
    menu.className = MENU_CLASS;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `${item.labels[0]} saved filters`);

    const header = document.createElement("div");
    header.className = "saved-filter-nav-menu__header";
    header.textContent = "Saved Filters";
    menu.appendChild(header);

    filters.forEach((filter) => {
      const link = document.createElement("a");
      link.className = "saved-filter-nav-menu__item";
      link.href = buildSavedFilterHref(item, filter);
      link.setAttribute("role", "menuitem");
      link.title = filter.name;
      link.textContent = filter.name;
      menu.appendChild(link);
    });

    return menu;
  }

  function ensureMenuForItem(item) {
    const filters = state.filtersByMode.get(item.mode) || [];
    const anchor = findNavAnchor(item);
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const host = anchor.closest(".nav-item, li, .dropdown, .btn-group") || anchor.parentElement;
    if (!(host instanceof HTMLElement)) return;

    host.classList.add(HOST_CLASS);
    host.dataset.savedFilterNavMode = item.mode;

    if (!filters.length) {
      host.querySelectorAll(`:scope > .${MENU_CLASS}`).forEach((menu) => menu.remove());
      host.classList.remove("has-saved-filter-nav-menu");
      return;
    }

    const nextSignature = filters.map((filter) => filter.id).join("|");
    const existingMenu = host.querySelector(`:scope > .${MENU_CLASS}`);
    if (
      existingMenu instanceof HTMLElement &&
      existingMenu.dataset.savedFilterNavSignature === nextSignature
    ) {
      host.classList.add("has-saved-filter-nav-menu");
      anchor.setAttribute("aria-haspopup", "true");
      return;
    }

    host.querySelectorAll(`:scope > .${MENU_CLASS}`).forEach((menu) => menu.remove());

    host.classList.add("has-saved-filter-nav-menu");
    anchor.setAttribute("aria-haspopup", "true");
    const menu = createMenu(item, filters);
    menu.dataset.savedFilterNavSignature = nextSignature;
    host.appendChild(menu);
  }

  function mountMenus() {
    pauseObserver();
    try {
      CONTENT_LINKS.forEach(ensureMenuForItem);
    } finally {
      resumeObserver();
    }
  }

  function scheduleMount() {
    window.clearTimeout(state.mountTimer);
    state.mountTimer = window.setTimeout(() => {
      void loadSavedFilters().then(mountMenus);
    }, REFRESH_DELAY_MS);
  }

  function pauseObserver() {
    if (!state.observer || !state.observerActive) return;
    state.observer.disconnect();
    state.observerActive = false;
  }

  function resumeObserver() {
    if (!state.observer || state.observerActive || !document.body) return;
    state.observer.observe(document.body, { childList: true, subtree: true });
    state.observerActive = true;
  }

  function installObservers() {
    if (state.observer) return;
    state.observer = new MutationObserver(scheduleMount);
    resumeObserver();

    window.addEventListener("popstate", scheduleMount);
    document.addEventListener("stash:location", scheduleMount);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleMount();
    });
  }

  function init() {
    if (!document.body) {
      window.setTimeout(init, 50);
      return;
    }
    installObservers();
    scheduleMount();
  }

  init();
})();
