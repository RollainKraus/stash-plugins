(function () {
  "use strict";

  const PLUGIN_ID = "ContentBanners";
  const ROUTE_EVENT = "content-banners:navigation";
  const ROUTE_HOOK_STATE_KEY = "__contentBannersRouteHookState";
  const BANNER_MODES = new Set(["preview", "screenshot", "mixed"]);
  const SELECTION_MODES = new Set(["random", "highest_rating", "most_recent_releases", "recently_added"]);
  const DEFAULT_BANNER_OVERLAY = 0.38;
  const DEFAULT_BANNER_BRIGHTNESS = 0.62;
  const DEFAULT_BANNER_SATURATION = 1;
  const DEFAULT_BANNER_BLUR = 0;
  const MAX_BANNER_BLUR_PX = 16;
  const DEFAULTS = {
    bannerContentTypes: "studio:2,performer:2,groups:2,tag:2",
    bannerMode: "mixed",
    selectionMode: "random",
    resultLimit: 40,
    rotationSeconds: 12,
    transitionMs: 700,
    bannerAdjustments: "0.38,0.62,1.0,0.0",
    bannerObjectPosition: "center 18%",
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

  function normalizeContentType(value) {
    const aliases = {
      performers: "performer",
      performer: "performer",
      studios: "studio",
      studio: "studio",
      groups: "group",
      group: "group",
      tags: "tag",
      tag: "tag",
    };
    return aliases[String(value ?? "").trim().toLowerCase()] || "";
  }

  function parseBannerContentTypes(value) {
    const fallback = 1;
    if (value == null) return parseBannerContentTypes(DEFAULTS.bannerContentTypes);

    const entries = String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const counts = new Map();
    entries.forEach((entry) => {
      const [rawType, rawCount] = entry.split(":").map((part) => part.trim().toLowerCase());
      const type = normalizeContentType(rawType);
      if (!type) return;
      const count = Math.round(getConfigNumber(rawCount, fallback, 1, 3));
      counts.set(type, count);
    });
    return counts;
  }

  function getBannerCountForPage(pageType = getCurrentPage()?.type) {
    return state.config.bannerContentTypes.get(pageType) || 0;
  }

  function parseBannerAdjustments(value) {
    const values = String(value ?? "")
      .split(",")
      .map((part) => part.trim());
    return {
      overlay: getConfigNumber(values[0], DEFAULT_BANNER_OVERLAY, 0, 1),
      brightness: getConfigNumber(values[1], DEFAULT_BANNER_BRIGHTNESS, 0, 1),
      saturation: getConfigNumber(values[2], DEFAULT_BANNER_SATURATION, 0, 1),
      blur: getConfigNumber(values[3], DEFAULT_BANNER_BLUR, 0, 1),
    };
  }

  function normalizeObjectPosition(value) {
    const position = String(value ?? DEFAULTS.bannerObjectPosition).trim();
    if (!position || position.length > 60) return DEFAULTS.bannerObjectPosition;
    return /^[a-z0-9.\-+%\s]+$/i.test(position) ? position : DEFAULTS.bannerObjectPosition;
  }

  function getEnabledPageTypes() {
    return new Set(state.config.bannerContentTypes.keys());
  }

  function normalizeConfig(config) {
    const bannerAdjustments = parseBannerAdjustments(config.bannerAdjustments);
    return {
      bannerContentTypes: parseBannerContentTypes(config.bannerContentTypes),
      bannerMode: normalizeMode(config.bannerMode),
      selectionMode: normalizeSelectionMode(config.selectionMode),
      resultLimit: Math.round(getConfigNumber(config.resultLimit, DEFAULTS.resultLimit, 1, 200)),
      rotationSeconds: getConfigNumber(config.rotationSeconds, DEFAULTS.rotationSeconds, 3, 3600),
      transitionMs: getConfigNumber(config.transitionMs, DEFAULTS.transitionMs, 0, 10000),
      overlay: bannerAdjustments.overlay,
      brightness: bannerAdjustments.brightness,
      saturation: bannerAdjustments.saturation,
      blur: bannerAdjustments.blur,
      bannerObjectPosition: normalizeObjectPosition(config.bannerObjectPosition),
      showTitle: getConfigBoolean(config.showTitle, DEFAULTS.showTitle),
    };
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
      state.config = normalizeConfig({ ...DEFAULTS, ...raw });
    } catch (error) {
      console.warn("[ContentBanners] Could not load settings.", error);
      state.config = normalizeConfig(DEFAULTS);
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
      state.target.style.removeProperty("--content-banners-saturation");
      state.target.style.removeProperty("--content-banners-blur");
      state.target.style.removeProperty("--content-banners-blur-inset");
      state.target.style.removeProperty("--content-banners-overlay");
      state.target.style.removeProperty("--content-banners-object-position");
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
    const bannerCount = getBannerCountForPage(page?.type);
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
    const blurPx = state.config.blur * MAX_BANNER_BLUR_PX;
    target.style.setProperty("--content-banners-transition", `${state.config.transitionMs}ms`);
    target.style.setProperty("--content-banners-brightness", String(state.config.brightness));
    target.style.setProperty("--content-banners-saturation", String(state.config.saturation));
    target.style.setProperty("--content-banners-blur", `${blurPx}px`);
    target.style.setProperty("--content-banners-blur-inset", `${Math.ceil(blurPx * 2)}px`);
    target.style.setProperty("--content-banners-overlay", String(state.config.overlay));
    target.style.setProperty("--content-banners-object-position", state.config.bannerObjectPosition);
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
    const filter = {};
    if (page.type === "performer") {
      filter.performers = { value: [page.id], modifier: "INCLUDES_ALL" };
    }
    if (page.type === "studio") {
      filter.studios = { value: [page.id], modifier: "INCLUDES_ALL" };
    }
    if (page.type === "group") {
      filter.groups = { value: [page.id], modifier: "INCLUDES_ALL" };
    }
    if (page.type === "tag") {
      filter.tags = { value: [page.id], modifier: "INCLUDES_ALL" };
    }
    return filter;
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
    state.panelIndexes = Array.from({ length: getBannerCountForPage(page.type) }, (_item, index) => (state.index + index) % Math.max(1, items.length));

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
    const hookState = window[ROUTE_HOOK_STATE_KEY] || {};
    hookState.scheduleRefresh = () => scheduleRefresh();
    window[ROUTE_HOOK_STATE_KEY] = hookState;

    if (!hookState.routeEventListener) {
      hookState.routeEventListener = () => {
        if (typeof hookState.scheduleRefresh === "function") hookState.scheduleRefresh();
      };
      window.addEventListener(ROUTE_EVENT, hookState.routeEventListener);
    }

    if (!hookState.historyPatched) {
      hookState.historyPatched = true;
      ["pushState", "replaceState"].forEach((method) => {
        const original = history[method];
        history[method] = function patchedContentBannersHistoryMethod(...args) {
          const result = original.apply(this, args);
          window.dispatchEvent(new Event(ROUTE_EVENT));
          return result;
        };
      });
      hookState.popstateListener = () => window.dispatchEvent(new Event(ROUTE_EVENT));
      window.addEventListener("popstate", hookState.popstateListener);
    }
  }

  function cleanup() {
    window.clearTimeout(state.rotationTimer);
    window.clearTimeout(state.refreshTimer);
    clearBanner();
    const hookState = window[ROUTE_HOOK_STATE_KEY];
    if (hookState?.routeEventListener) {
      window.removeEventListener(ROUTE_EVENT, hookState.routeEventListener);
      hookState.routeEventListener = null;
    }
    if (hookState?.scheduleRefresh) hookState.scheduleRefresh = null;
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
