(function () {
  "use strict";

  const PLUGIN_ID = "ContentBanners";
  const ROUTE_EVENT = "content-banners:navigation";
  const PAGE_TYPES = new Set(["performer", "studio", "group", "tag"]);
  const BANNER_MODES = new Set(["preview", "screenshot", "mixed"]);
  const SELECTION_MODES = new Set(["random", "highest_rating", "most_recent_releases", "recently_added"]);
  const DEFAULTS = {
    pageTypes: "performer,studio,group,tag",
    bannerMode: "mixed",
    selectionMode: "random",
    resultLimit: 40,
    bannerCount: "studio:2,performer:2,groups:2,tag:2",
    rotationSeconds: 12,
    transitionMs: 700,
    brightnessPercent: 62,
    overlayOpacity: "0.38",
    showTitle: true,
  };

  const state = {
    config: { ...DEFAULTS },
    target: null,
    layer: null,
    titleLayer: null,
    items: [],
    index: 0,
    panelIndexes: [],
    rotationTimer: 0,
    refreshTimer: 0,
    routeToken: 0,
  };

  function gql(query, variables = {}) {
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, variables }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json.errors?.length) throw new Error(json.errors.map((err) => err.message).join("; "));
        return json.data;
      });
  }

  function getConfigBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return fallback;
  }

  function getConfigNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function getConfigString(value, fallback) {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function hasConfigKey(config, key) {
    return Object.prototype.hasOwnProperty.call(config, key);
  }

  function fillMissingConfigDefaults(config) {
    const next = { ...(config || {}) };
    let changed = false;
    Object.entries(DEFAULTS).forEach(([key, value]) => {
      if (hasConfigKey(next, key)) return;
      next[key] = value;
      changed = true;
    });
    return { config: next, changed };
  }

  async function saveConfig(config) {
    await gql(
      `mutation ConfigureContentBanners($pluginId: ID!, $input: Map!) {
        configurePlugin(plugin_id: $pluginId, input: $input)
      }`,
      { pluginId: PLUGIN_ID, input: config }
    );
  }

  function normalizeMode(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return BANNER_MODES.has(normalized) ? normalized : DEFAULTS.bannerMode;
  }

  function normalizeSelectionMode(value) {
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    return SELECTION_MODES.has(normalized) ? normalized : DEFAULTS.selectionMode;
  }

  function getBannerCountForPage(value, pageType = getCurrentPage()?.type) {
    const fallback = 1;
    const direct = Number(value);
    if (Number.isFinite(direct)) return Math.round(getConfigNumber(direct, fallback, 1, 3));

    const entries = String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const aliases = {
      performers: "performer",
      performer: "performer",
      studios: "studio",
      studio: "studio",
      groups: "group",
      group: "group",
      tags: "tag",
      tag: "tag",
      default: "default",
    };
    const counts = new Map();
    entries.forEach((entry) => {
      const [rawType, rawCount] = entry.split(":").map((part) => part.trim().toLowerCase());
      const type = aliases[rawType];
      if (!type) return;
      const count = Math.round(getConfigNumber(rawCount, fallback, 1, 3));
      counts.set(type, count);
    });
    return counts.get(pageType) || counts.get("default") || fallback;
  }

  function normalizeOverlayOpacity(value) {
    return getConfigNumber(value, DEFAULTS.overlayOpacity, 0, 1);
  }

  function getEnabledPageTypes() {
    const values = String(state.config.pageTypes || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => PAGE_TYPES.has(value));
    return new Set(values.length ? values : DEFAULTS.pageTypes.split(","));
  }

  async function loadConfig() {
    try {
      const data = await gql(`
        query ContentBannersConfig {
          configuration {
            plugins
          }
        }
      `);
      const raw = data?.configuration?.plugins?.[PLUGIN_ID] || {};
      const defaults = fillMissingConfigDefaults(raw);
      const hydrated = defaults.config;
      state.config = {
        pageTypes: getConfigString(hydrated.pageTypes, DEFAULTS.pageTypes),
        bannerMode: normalizeMode(hydrated.bannerMode),
        selectionMode: normalizeSelectionMode(hydrated.selectionMode),
        resultLimit: Math.round(getConfigNumber(hydrated.resultLimit, DEFAULTS.resultLimit, 1, 200)),
        bannerCount: getConfigString(hydrated.bannerCount, DEFAULTS.bannerCount),
        rotationSeconds: getConfigNumber(hydrated.rotationSeconds, DEFAULTS.rotationSeconds, 3, 3600),
        transitionMs: getConfigNumber(hydrated.transitionMs, DEFAULTS.transitionMs, 0, 10000),
        brightnessPercent: getConfigNumber(hydrated.brightnessPercent, DEFAULTS.brightnessPercent, 0, 100),
        overlayOpacity: normalizeOverlayOpacity(hydrated.overlayOpacity),
        showTitle: getConfigBoolean(hydrated.showTitle, DEFAULTS.showTitle),
      };
      if (defaults.changed) {
        saveConfig(hydrated).catch((error) => console.warn("[ContentBanners] Could not initialize default settings.", error));
      }
    } catch (error) {
      console.warn("[ContentBanners] Could not load settings.", error);
      state.config = { ...DEFAULTS };
    }
  }

  function getCurrentPage() {
    const match = location.pathname.match(/^\/(performers|studios|groups|tags)\/(\d+)/);
    if (!match) return null;
    const typeMap = {
      performers: "performer",
      studios: "studio",
      groups: "group",
      tags: "tag",
    };
    return { type: typeMap[match[1]], id: match[2] };
  }

  function getTargetHeader() {
    return document.querySelector("div.detail-header");
  }

  function clearBanner() {
    window.clearTimeout(state.rotationTimer);
    window.clearTimeout(state.refreshTimer);
    state.rotationTimer = 0;
    state.refreshTimer = 0;
    if (state.target) {
      state.target.classList.remove("content-banners-target");
      state.target.style.removeProperty("--content-banners-transition");
      state.target.style.removeProperty("--content-banners-brightness");
      state.target.style.removeProperty("--content-banners-overlay");
    }
    state.layer?.remove();
    state.titleLayer?.remove();
    state.target = null;
    state.layer = null;
    state.titleLayer = null;
    state.items = [];
    state.index = 0;
    state.panelIndexes = [];
  }

  function ensureLayer(target, page) {
    const bannerCount = getBannerCountForPage(state.config.bannerCount, page?.type);
    if (
      state.target === target &&
      state.layer?.isConnected &&
      state.titleLayer?.isConnected &&
      state.layer.dataset.bannerCount === String(bannerCount) &&
      state.layer.dataset.pageType === String(page?.type || "")
    ) {
      return state.layer;
    }

    clearBanner();
    state.target = target;
    target.classList.add("content-banners-target");
    applyCssVars(target);

    const layer = document.createElement("div");
    layer.className = "content-banners-layer";
    layer.dataset.bannerCount = String(bannerCount);
    layer.dataset.pageType = String(page?.type || "");
    layer.innerHTML = `
      <div class="content-banners-panels content-banners-panels--count-${bannerCount}">
        ${Array.from({ length: bannerCount }, (_item, index) => `
          <div class="content-banners-panel" data-banner-panel="${index}">
            <div class="content-banners-media content-banners-media--a"></div>
            <div class="content-banners-media content-banners-media--b"></div>
          </div>
        `).join("")}
      </div>
      <div class="content-banners-scrim"></div>
    `;

    const titleLayer = document.createElement("div");
    titleLayer.className = `content-banners-title-layer content-banners-title-layer--count-${bannerCount}`;
    titleLayer.dataset.bannerCount = String(bannerCount);
    titleLayer.innerHTML = Array.from({ length: bannerCount }, (_item, index) => `
      <div class="content-banners-title-panel">
        <a class="content-banners-title" data-banner-title="${index}" target="_blank" rel="noopener noreferrer" hidden></a>
      </div>
    `).join("");

    target.prepend(layer, titleLayer);
    state.layer = layer;
    state.titleLayer = titleLayer;
    return layer;
  }

  function applyCssVars(target) {
    target.style.setProperty("--content-banners-transition", `${state.config.transitionMs}ms`);
    target.style.setProperty("--content-banners-brightness", `${state.config.brightnessPercent}%`);
    target.style.setProperty("--content-banners-overlay", String(state.config.overlayOpacity));
  }

  function getFindFilterForSelectionMode(mode) {
    const base = {
      page: 1,
      per_page: state.config.resultLimit,
      direction: "ASC",
      sort: "random",
    };
    if (mode === "highest_rating") return { ...base, sort: "rating", direction: "DESC" };
    if (mode === "most_recent_releases") return { ...base, sort: "date", direction: "DESC" };
    if (mode === "recently_added") return { ...base, sort: "created_at", direction: "DESC" };
    return base;
  }

  function itemFitsSelectionMode(item, mode) {
    if (mode === "highest_rating") return Number(item.rating100 || 0) > 0;
    if (mode === "most_recent_releases") return Boolean(item.date);
    return true;
  }

  async function loadItemsForMode(page, mode) {
    const data = await gql(`
      query ContentBannersScenes($filter: FindFilterType, $sceneFilter: SceneFilterType) {
        findScenes(filter: $filter, scene_filter: $sceneFilter) {
          scenes {
            id
            title
            date
            rating100
            created_at
            paths {
              screenshot
              preview
            }
          }
        }
      }
    `, {
      filter: getFindFilterForSelectionMode(mode),
      sceneFilter: buildSceneFilter(page),
    });

    return (data?.findScenes?.scenes || [])
      .map((scene) => ({
        id: scene.id,
        title: scene.title || `Scene ${scene.id}`,
        date: scene.date || "",
        rating100: Number(scene.rating100 || 0),
        createdAt: scene.created_at || "",
        screenshot: scene.paths?.screenshot || "",
        preview: scene.paths?.preview || "",
      }))
      .filter((scene) => (scene.screenshot || scene.preview) && itemFitsSelectionMode(scene, mode));
  }

  async function loadItems(page) {
    const mode = state.config.selectionMode;
    if (mode === "random") return loadItemsForMode(page, "random");
    try {
      const items = await loadItemsForMode(page, mode);
      return items.length ? items : loadItemsForMode(page, "random");
    } catch (error) {
      console.warn(`[ContentBanners] Could not load ${mode} banners, falling back to random.`, error);
      return loadItemsForMode(page, "random");
    }
  }

  function buildSceneFilter(page) {
    if (page.type === "performer") {
      return { performers: { value: [page.id], modifier: "INCLUDES_ALL" } };
    }
    if (page.type === "studio") {
      return { studios: { value: [page.id], modifier: "INCLUDES_ALL" } };
    }
    if (page.type === "group") {
      return { groups: { value: [page.id], modifier: "INCLUDES_ALL" } };
    }
    if (page.type === "tag") {
      return { tags: { value: [page.id], modifier: "INCLUDES_ALL" } };
    }
    return {};
  }

  function getMediaType(item) {
    if (state.config.bannerMode === "screenshot") return "image";
    if (state.config.bannerMode === "preview" && item.preview) return "video";
    if (state.config.bannerMode === "mixed" && item.preview) return "video";
    return item.screenshot ? "image" : "";
  }

  function getMediaUrl(item) {
    const type = getMediaType(item);
    if (type === "video") return item.preview;
    if (type === "image") return item.screenshot;
    return "";
  }

  function renderMediaSlot(slot, item) {
    const type = getMediaType(item);
    const url = getMediaUrl(item);
    slot.classList.remove("is-active");
    slot.replaceChildren();

    if (!type || !url) return false;

    if (type === "video") {
      const video = document.createElement("video");
      video.src = url;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.onerror = () => {
        if (item.screenshot) {
          renderImage(slot, item.screenshot);
          requestAnimationFrame(() => slot.classList.add("is-active"));
        } else {
          showNextItem();
        }
      };
      slot.appendChild(video);
      video.play().catch(() => {
        if (item.screenshot) {
          renderImage(slot, item.screenshot);
          requestAnimationFrame(() => slot.classList.add("is-active"));
        }
      });
    } else {
      renderImage(slot, url);
    }

    return true;
  }

  function renderImage(slot, url) {
    slot.replaceChildren();
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    slot.appendChild(image);
  }

  function getSceneUrl(item) {
    return item?.id ? `/scenes/${encodeURIComponent(item.id)}` : "#";
  }

  function showPanelItem(panel, item) {
    if (!panel || !item) return false;
    const slots = Array.from(panel.querySelectorAll(".content-banners-media"));
    const active = slots.find((slot) => slot.classList.contains("is-active"));
    const next = slots.find((slot) => slot !== active) || slots[0];

    if (!renderMediaSlot(next, item)) return false;

    requestAnimationFrame(() => {
      active?.classList.remove("is-active");
      next.classList.add("is-active");
    });

    const title = state.titleLayer?.querySelector(`[data-banner-title="${panel.getAttribute("data-banner-panel")}"]`);
    if (title instanceof HTMLAnchorElement) {
      title.hidden = !state.config.showTitle;
      title.textContent = item.title;
      title.href = getSceneUrl(item);
    }
    return true;
  }

  function showCurrentItems() {
    if (!state.layer || !state.items.length) return;
    state.layer.querySelector(".content-banners-empty")?.remove();

    const panels = Array.from(state.layer.querySelectorAll(".content-banners-panel"));
    const bannerCount = panels.length || 1;
    if (state.panelIndexes.length !== bannerCount) {
      state.panelIndexes = panels.map((_panel, index) => (state.index + index) % state.items.length);
    }

    let rendered = 0;
    panels.forEach((panel, panelIndex) => {
      const itemIndex = state.panelIndexes[panelIndex] % state.items.length;
      if (showPanelItem(panel, state.items[itemIndex])) rendered += 1;
    });

    if (!rendered) {
      showEmpty("No usable banner media found.");
    }
  }

  function showNextItem() {
    if (state.items.length <= 1) return;
    const step = Math.max(1, state.panelIndexes.length || 1);
    state.panelIndexes = state.panelIndexes.map((index) => (index + step) % state.items.length);
    state.index = state.panelIndexes[0] || 0;
    showCurrentItems();
    scheduleRotation();
  }

  function scheduleRotation() {
    window.clearTimeout(state.rotationTimer);
    if (state.items.length <= 1) return;
    state.rotationTimer = window.setTimeout(showNextItem, state.config.rotationSeconds * 1000);
  }

  function showEmpty(message) {
    if (!state.layer) return;
    state.layer.querySelectorAll(".content-banners-media").forEach((slot) => {
      slot.classList.remove("is-active");
      slot.replaceChildren();
    });

    state.titleLayer?.querySelectorAll(".content-banners-title").forEach((title) => {
      title.hidden = true;
      title.textContent = "";
      title.removeAttribute("href");
    });

    let empty = state.layer.querySelector(".content-banners-empty");
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "content-banners-empty";
      state.layer.appendChild(empty);
    }
    empty.textContent = message;
  }

  async function refreshBanner() {
    const token = ++state.routeToken;
    await loadConfig();

    const page = getCurrentPage();
    if (!page || !getEnabledPageTypes().has(page.type)) {
      clearBanner();
      return;
    }

    const target = getTargetHeader();
    if (!target) {
      window.setTimeout(() => {
        if (token === state.routeToken) refreshBanner();
      }, 250);
      return;
    }

    ensureLayer(target, page);
    applyCssVars(target);

    const items = await loadItems(page);
    if (token !== state.routeToken) return;

    state.items = items;
    state.index = Math.floor(Math.random() * Math.max(1, items.length));
    state.panelIndexes = Array.from({ length: getBannerCountForPage(state.config.bannerCount, page.type) }, (_item, index) => (state.index + index) % Math.max(1, items.length));

    if (!items.length) {
      showEmpty("No scene previews found for this page.");
      return;
    }

    showCurrentItems();
    scheduleRotation();
  }

  function scheduleRefresh() {
    window.clearTimeout(state.rotationTimer);
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      refreshBanner().catch((error) => console.warn("[ContentBanners] Refresh failed.", error));
    }, 120);
  }

  function installRouteHooks() {
    window.__contentBannersScheduleRefresh = () => scheduleRefresh();

    if (!window.__contentBannersRouteEventListener) {
      window.__contentBannersRouteEventListener = () => {
        if (typeof window.__contentBannersScheduleRefresh === "function") {
          window.__contentBannersScheduleRefresh();
        }
      };
      window.addEventListener(ROUTE_EVENT, window.__contentBannersRouteEventListener);
    }

    if (!window.__contentBannersRouteHooksInstalled) {
      window.__contentBannersRouteHooksInstalled = true;
      ["pushState", "replaceState"].forEach((method) => {
        const original = history[method];
        history[method] = function patchedContentBannersHistoryMethod(...args) {
          const result = original.apply(this, args);
          window.dispatchEvent(new Event(ROUTE_EVENT));
          return result;
        };
      });
      window.addEventListener("popstate", () => window.dispatchEvent(new Event(ROUTE_EVENT)));
    }
  }

  function cleanup() {
    window.clearTimeout(state.rotationTimer);
    window.clearTimeout(state.refreshTimer);
    clearBanner();
    if (window.__contentBannersScheduleRefresh) window.__contentBannersScheduleRefresh = null;
    if (window.__contentBannersCleanup === cleanup) window.__contentBannersCleanup = null;
  }

  function main() {
    if (typeof window.__contentBannersCleanup === "function") {
      window.__contentBannersCleanup();
    }
    window.__contentBannersCleanup = cleanup;
    installRouteHooks();
    refreshBanner().catch((error) => console.warn("[ContentBanners] Startup failed.", error));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main, { once: true });
  } else {
    main();
  }
})();
