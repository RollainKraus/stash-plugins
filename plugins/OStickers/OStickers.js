(function () {
  "use strict";

  const PLUGIN_ID = "OStickers";
  const ROUTE_EVENT = "ostickers:navigation";
  const ENABLED_STORAGE_KEY = "ostickers:enabled";
  const TOGGLE_BUTTON_CLASS = "ostickers-toggle-button";
  const DEFAULT_EMOJI = "\u{1F4A6}";
  const DATA_CARD_SELECTOR = [
    "[data-scene-id]",
    "[data-image-id]",
    "[data-performer-id]",
    "[data-studio-id]",
    "[data-group-id]",
    "[data-movie-id]",
  ].join(", ");
  const CARD_LINK_SELECTOR = [
    'a[href*="/scenes/"]',
    'a[href*="/images/"]',
    'a[href*="/performers/"]',
    'a[href*="/studios/"]',
    'a[href*="/groups/"]',
    'a[href*="/movies/"]',
  ].join(", ");
  const CARD_SELECTOR = [
    ".scene-card",
    ".image-card",
    ".performer-card",
    ".studio-card",
    ".group-card",
    ".movie-card",
    DATA_CARD_SELECTOR,
    CARD_LINK_SELECTOR,
  ].join(", ");
  const CONTENT_TYPES = new Set(["scene", "image", "performer", "studio", "group"]);
  const CONTENT_CARD_CLASS_SELECTOR = ".scene-card, .image-card, .performer-card, .studio-card, .group-card, .movie-card";
  const GENERIC_CARD_SELECTOR = ".card";
  const METADATA_CACHE_TTL_MS = 30000;
  const MODES = new Set(["repeat", "incremental", "single", "thresholds"]);
  const IMAGE_MODES = new Set(["random", "fixed"]);
  const ANIMATIONS = new Set(["none", "float", "wiggle", "pulse", "rain"]);
  const REFRESH_DELAYS = [0, 150, 450, 1000];
  const MAX_ASSET_PROBE = 500;

  const DEFAULTS = {
    maxStickers: 50,
    stickersPerOCount: 1,
    mode: "incremental",
    emoji: "",
    imageMode: "random",
    sizePercent: 25,
    opacity: 0.3,
    animation: "none",
    animationSpeedMs: 5000,
    allowOverflow: true,
    hideOnHover: false,
    maxOverflowPercent: 50,
    renderAreaWidth: "0,100",
    renderAreaHeight: "0,100",
    thresholds: "1,5,10,25,50",
    contentTypes: "image,scene,studio,performer,group",
    showOnHomePage: false,
    showOnOtherPages: false,
  };

  const state = {
    config: { ...DEFAULTS },
    metadataCache: new Map(),
    observer: null,
    refreshTimer: 0,
    assetCount: null,
    assetProbePromise: null,
    assetWarningShown: false,
    suppressObserverUntil: 0,
    enabled: getStoredEnabled(),
  };

  function registerRuntime() {
    const previous = window.__ostickersRuntime;
    if (previous?.observer) previous.observer.disconnect();
    if (previous?.refreshTimer) window.clearTimeout(previous.refreshTimer);
    window.__ostickersRuntime = state;
  }

  function getStoredEnabled() {
    try {
      return localStorage.getItem(ENABLED_STORAGE_KEY) !== "false";
    } catch (err) {
      return true;
    }
  }

  function setStoredEnabled(enabled) {
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "true" : "false");
    } catch (err) {
      // Local storage can be unavailable in hardened browser contexts.
    }
  }

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
        if (json.errors?.length) {
          throw new Error(json.errors.map((err) => err.message).join("; "));
        }
        return json.data;
      });
  }

  function getConfigString(value, fallback) {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
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

  function uniqueValues(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function hashString(input) {
    const value = String(input ?? "");
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomUnit(seed) {
    const x = Math.sin(seed * 12.9898) * 43758.5453123;
    return x - Math.floor(x);
  }

  function randomBetween(seed, min, max) {
    return min + randomUnit(seed) * (max - min);
  }

  async function ensureAssetCount() {
    if (getStickerType() !== "image") return 0;
    if (Number.isInteger(state.assetCount)) return state.assetCount;
    if (state.assetProbePromise) return state.assetProbePromise;

    state.assetProbePromise = detectAssetCount()
      .then((count) => {
        state.assetCount = count;
        return count;
      })
      .finally(() => {
        state.assetProbePromise = null;
      });

    return state.assetProbePromise;
  }

  async function detectAssetCount() {
    let count = 0;
    for (let index = 1; index <= MAX_ASSET_PROBE; index += 1) {
      const exists = await assetExists(index);
      if (!exists) break;
      count = index;
    }
    return count;
  }

  function assetExists(index) {
    return new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        resolve(value);
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = `/plugin/${PLUGIN_ID}/assets/${index}.png?probe=${Date.now()}-${index}`;
    });
  }

  async function loadConfig() {
    try {
      const data = await gql(`
        query OStickersConfig {
          configuration {
            plugins
          }
        }
      `);
      const raw = data?.configuration?.plugins?.[PLUGIN_ID] || {};
      state.config = {
        maxStickers: getConfigNumber(raw.maxStickers, DEFAULTS.maxStickers, 1, 500),
        stickersPerOCount: Math.round(getConfigNumber(raw.stickersPerOCount, DEFAULTS.stickersPerOCount, 1, 100)),
        mode: normalizeEnum(raw.mode, MODES, DEFAULTS.mode),
        emoji: String(raw.emoji ?? "").trim(),
        imageMode: normalizeEnum(raw.imageMode, IMAGE_MODES, DEFAULTS.imageMode),
        sizePercent: getConfigNumber(raw.sizePercent, DEFAULTS.sizePercent, 0.05, 100),
        opacity: getConfigNumber(raw.opacity, DEFAULTS.opacity, 0, 1),
        animation: normalizeEnum(raw.animation, ANIMATIONS, DEFAULTS.animation),
        animationSpeedMs: getConfigNumber(raw.animationSpeedMs, DEFAULTS.animationSpeedMs, 200, 60000),
        allowOverflow: getConfigBoolean(raw.allowOverflow, DEFAULTS.allowOverflow),
        hideOnHover: getConfigBoolean(raw.hideOnHover, DEFAULTS.hideOnHover),
        maxOverflowPercent: getConfigNumber(raw.maxOverflowPercent, DEFAULTS.maxOverflowPercent, 0, 100),
        renderAreaWidth: getConfigString(raw.renderAreaWidth, DEFAULTS.renderAreaWidth),
        renderAreaHeight: getConfigString(raw.renderAreaHeight, DEFAULTS.renderAreaHeight),
        thresholds: getConfigString(raw.thresholds, DEFAULTS.thresholds),
        contentTypes: getConfigString(raw.contentTypes, DEFAULTS.contentTypes),
        showOnHomePage: getConfigBoolean(raw.showOnHomePage, DEFAULTS.showOnHomePage),
        showOnOtherPages: getConfigBoolean(raw.showOnOtherPages, DEFAULTS.showOnOtherPages),
      };
    } catch (err) {
      console.warn("[OStickers] Config load failed", err);
      state.config = { ...DEFAULTS };
    }
  }

  function normalizeEnum(value, allowed, fallback) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return allowed.has(normalized) ? normalized : fallback;
  }

  function getEnabledContentTypes() {
    const tokens = String(state.config.contentTypes || "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter((token) => CONTENT_TYPES.has(token));
    return new Set(tokens.length ? uniqueValues(tokens) : DEFAULTS.contentTypes.split(","));
  }

  function parseThresholds() {
    const values = String(state.config.thresholds || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    return uniqueValues(values);
  }

  function parseEmojiList() {
    const emojis = String(state.config.emoji || "")
      .split(",")
      .map((emoji) => emoji.trim())
      .filter(Boolean);
    return emojis;
  }

  function getStickerType() {
    return parseEmojiList().length ? "emoji" : "image";
  }

  function parsePercentRange(value, fallback = [0, 100]) {
    const values = String(value ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((part) => Number.isFinite(part));
    const first = values.length >= 2 ? values[0] : fallback[0];
    const second = values.length >= 2 ? values[1] : fallback[1];
    const min = Math.max(0, Math.min(100, Math.min(first, second)));
    const max = Math.max(0, Math.min(100, Math.max(first, second)));
    return { min, max };
  }

  function getAxisBounds(range, halfSizePercent) {
    const overflowFraction = state.config.allowOverflow
      ? Math.max(0, Math.min(100, state.config.maxOverflowPercent)) / 100
      : 0;
    const edgeCenterInset = halfSizePercent * (1 - overflowFraction * 2);
    let min = state.config.allowOverflow && range.min <= 0
      ? edgeCenterInset
      : range.min;
    let max = state.config.allowOverflow && range.max >= 100
      ? 100 - edgeCenterInset
      : range.max;

    if (!state.config.allowOverflow) {
      min = Math.max(min, halfSizePercent);
      max = Math.min(max, 100 - halfSizePercent);
    }

    if (max < min) {
      const center = (min + max) / 2;
      return { min: center, max: center };
    }

    return { min, max };
  }

  function getCardInfo(card) {
    if (!(card instanceof HTMLElement)) return null;

    const candidates = [
      { type: "scene", id: card.dataset.sceneId || findIdFromHref(card, "/scenes/") },
      { type: "image", id: card.dataset.imageId || findIdFromHref(card, "/images/") },
      { type: "performer", id: card.dataset.performerId || findIdFromHref(card, "/performers/") },
      { type: "studio", id: card.dataset.studioId || findIdFromHref(card, "/studios/") },
      { type: "group", id: card.dataset.groupId || card.dataset.movieId || findIdFromHref(card, "/groups/") || findIdFromHref(card, "/movies/") },
    ];

    const match = candidates.find((candidate) => candidate.id);
    if (!match) return null;

    return {
      type: match.type,
      id: String(match.id),
      cacheKey: `${match.type}:${match.id}`,
    };
  }

  function getActiveBrowseType() {
    const path = String(location.pathname || "").replace(/\/+$/, "").toLowerCase();
    if (path === "/scenes") return "scene";
    if (path === "/images") return "image";
    if (path === "/performers") return "performer";
    if (path === "/studios") return "studio";
    if (path === "/groups" || path === "/movies") return "group";
    return null;
  }

  function getActiveDecorationContext() {
    const path = String(location.pathname || "").replace(/\/+$/, "").toLowerCase() || "/";
    const browseType = getActiveBrowseType();
    if (browseType) return { mode: "browse", browseType };
    if ((path === "/" || path === "/home") && state.config.showOnHomePage) return { mode: "home", browseType: null };
    if (state.config.showOnOtherPages) return { mode: "other", browseType: null };
    return { mode: "disabled", browseType: null };
  }

  function findIdFromHref(card, prefix) {
    const ownHref = card.matches?.(`a[href*="${prefix}"]`) ? card.getAttribute("href") : "";
    const link = card.querySelector(`a[href*="${prefix}"]`);
    const href = ownHref || link?.getAttribute("href") || "";
    const match = href.match(new RegExp(`${prefix.replace(/\//g, "\\/")}([^/?#]+)`));
    return match?.[1] || null;
  }

  function normalizeCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.max(0, Math.round(parsed));
  }

  async function fetchMetadata(info) {
    if (!info?.type || !info?.id) return null;
    const cached = state.metadataCache.get(info.cacheKey);
    if (cached && Date.now() - cached.createdAt < METADATA_CACHE_TTL_MS) return cached.promise;

    const promise = fetchMetadataInner(info)
      .catch((err) => {
        console.warn("[OStickers] Metadata load failed", info.cacheKey, err);
        state.metadataCache.delete(info.cacheKey);
        return null;
      });

    state.metadataCache.set(info.cacheKey, { createdAt: Date.now(), promise });
    return promise;
  }

  async function fetchMetadataInner(info) {
    if (info.type === "scene") {
      const data = await gql(`
        query OStickersScene($id: ID!) {
          findScene(id: $id) {
            id
            o_counter
          }
        }
      `, { id: info.id });
      return { oCount: normalizeCount(data?.findScene?.o_counter) };
    }

    if (info.type === "image") {
      const data = await gql(`
        query OStickersImage($id: ID!) {
          findImage(id: $id) {
            id
            o_counter
          }
        }
      `, { id: info.id });
      return { oCount: normalizeCount(data?.findImage?.o_counter) };
    }

    if (info.type === "performer") {
      const [sceneOCount, imageOCount] = await Promise.all([
        fetchAggregateOCount("performerScene", info.id),
        fetchAggregateOCount("performerImage", info.id),
      ]);
      return { oCount: sceneOCount + imageOCount };
    }

    if (info.type === "studio") {
      const [sceneOCount, imageOCount] = await Promise.all([
        fetchAggregateOCount("studioScene", info.id),
        fetchAggregateOCount("studioImage", info.id),
      ]);
      return { oCount: sceneOCount + imageOCount };
    }

    if (info.type === "group") {
      return { oCount: await fetchGroupOCount(info.id) };
    }

    return { oCount: 0 };
  }

  async function fetchGroupOCount(id) {
    const attempts = [
      () => fetchAggregateOCount("groupScene", id, true),
      () => fetchAggregateOCount("movieScene", id, true),
      () => fetchGroupEntityOCount("findGroup", id),
      () => fetchGroupEntityOCount("findMovie", id),
    ];

    for (const attempt of attempts) {
      const count = await attempt();
      if (count > 0) return count;
    }

    return 0;
  }

  async function fetchGroupEntityOCount(fieldName, id) {
    try {
      const data = await gql(`
        query OStickersGroupEntityOCount($id: ID!) {
          ${fieldName}(id: $id) {
            id
            scenes {
              o_counter
            }
          }
        }
      `, { id: String(id) });
      return sumOCount(data?.[fieldName]?.scenes);
    } catch (err) {
      return 0;
    }
  }

  async function fetchAggregateOCount(kind, id, quiet = false) {
    try {
      if (kind === "performerScene") {
        const data = await gql(`
          query OStickersPerformerSceneOCount($sceneFilter: SceneFilterType) {
            findScenes(scene_filter: $sceneFilter, filter: { per_page: -1 }) {
              scenes {
                o_counter
              }
            }
          }
        `, {
          sceneFilter: {
            performers: {
              value: [String(id)],
              modifier: "INCLUDES_ALL",
            },
          },
        });
        return sumOCount(data?.findScenes?.scenes);
      }

      if (kind === "performerImage") {
        const data = await gql(`
          query OStickersPerformerImageOCount($imageFilter: ImageFilterType) {
            findImages(image_filter: $imageFilter, filter: { per_page: -1 }) {
              images {
                o_counter
              }
            }
          }
        `, {
          imageFilter: {
            performers: {
              value: [String(id)],
              excludes: [],
              modifier: "INCLUDES_ALL",
            },
          },
        });
        return sumOCount(data?.findImages?.images);
      }

      if (kind === "studioScene") {
        const data = await gql(`
          query OStickersStudioSceneOCount($sceneFilter: SceneFilterType) {
            findScenes(scene_filter: $sceneFilter, filter: { per_page: -1 }) {
              scenes {
                o_counter
              }
            }
          }
        `, {
          sceneFilter: {
            studios: {
              value: [String(id)],
              modifier: "INCLUDES_ALL",
            },
          },
        });
        return sumOCount(data?.findScenes?.scenes);
      }

      if (kind === "studioImage") {
        const data = await gql(`
          query OStickersStudioImageOCount($imageFilter: ImageFilterType) {
            findImages(image_filter: $imageFilter, filter: { per_page: -1 }) {
              images {
                o_counter
              }
            }
          }
        `, {
          imageFilter: {
            studios: {
              value: [String(id)],
              excludes: [],
              modifier: "INCLUDES_ALL",
            },
          },
        });
        return sumOCount(data?.findImages?.images);
      }

      if (kind === "groupScene") {
        const data = await gql(`
          query OStickersGroupSceneOCount($sceneFilter: SceneFilterType) {
            findScenes(scene_filter: $sceneFilter, filter: { per_page: -1 }) {
              scenes {
                o_counter
              }
            }
          }
        `, {
          sceneFilter: {
            groups: {
              value: [String(id)],
              modifier: "INCLUDES_ALL",
            },
          },
        });
        return sumOCount(data?.findScenes?.scenes);
      }

      if (kind === "movieScene") {
        const data = await gql(`
          query OStickersMovieSceneOCount($sceneFilter: SceneFilterType) {
            findScenes(scene_filter: $sceneFilter, filter: { per_page: -1 }) {
              scenes {
                o_counter
              }
            }
          }
        `, {
          sceneFilter: {
            movies: {
              value: [String(id)],
              modifier: "INCLUDES_ALL",
            },
          },
        });
        return sumOCount(data?.findScenes?.scenes);
      }
    } catch (err) {
      if (!quiet) console.warn("[OStickers] Aggregate O-count lookup failed", kind, id, err);
    }
    return 0;
  }

  function sumOCount(items) {
    return (items || []).reduce((total, item) => total + normalizeCount(item?.o_counter), 0);
  }

  function buildStickerModels(info, metadata) {
    const oCount = normalizeCount(metadata?.oCount);
    if (!oCount) return [];

    const mode = state.config.mode;
    const maxStickers = Math.round(state.config.maxStickers);
    const stickersPerOCount = Math.max(1, Math.round(state.config.stickersPerOCount || 1));
    const thresholds = parseThresholds();
    const stickerType = getStickerType();
    const emojis = stickerType === "emoji" ? parseEmojiList() : [];
    let countUnits = 0;

    if (mode === "single") {
      countUnits = 1;
    } else if (mode === "thresholds") {
      countUnits = thresholds.filter((threshold) => oCount >= threshold).length;
    } else {
      countUnits = oCount;
    }

    let count = mode === "single" ? 1 : countUnits * stickersPerOCount;
    count = Math.min(Math.max(0, count), maxStickers);
    if (!count) return [];

    const models = [];
    for (let index = 1; index <= count; index += 1) {
      models.push({
        key: `${info.cacheKey}:${mode}:${oCount}:${index}`,
        imageIndex: stickerType === "image" ? resolveImageIndex(mode, oCount, index, info.cacheKey) : null,
        emoji: stickerType === "emoji" ? resolveEmoji(emojis, mode, oCount, index, info.cacheKey) : DEFAULT_EMOJI,
      });
    }
    return models;
  }

  function resolveEmoji(emojis, mode, oCount, index, seedBase) {
    if (!emojis.length) return DEFAULT_EMOJI;
    if (state.config.imageMode === "random") {
      const offset = hashString(`${seedBase}:${mode}:${oCount}:emoji`) % emojis.length;
      return emojis[(offset + index - 1) % emojis.length];
    }

    if (mode === "single") return emojis[(normalizeCount(oCount) - 1) % emojis.length];
    return emojis[(index - 1) % emojis.length];
  }

  function resolveImageIndex(mode, oCount, index, seedBase) {
    const assetCount = getAssetCount();
    if (state.config.imageMode === "random") {
      return (hashString(`${seedBase}:${mode}:${oCount}:${index}`) % assetCount) + 1;
    }

    if (mode === "repeat") return 1;
    if (mode === "single") return wrapAssetIndex(oCount, assetCount);
    return wrapAssetIndex(index, assetCount);
  }

  function wrapAssetIndex(value, assetCount = getAssetCount()) {
    const normalized = normalizeCount(value) || 1;
    return ((normalized - 1) % assetCount) + 1;
  }

  function getAssetCount() {
    return Math.max(1, Number(state.assetCount) || 0);
  }

  function clearRenderedCards() {
    document.querySelectorAll(".ostickers-layer").forEach((layer) => layer.remove());
    document.querySelectorAll(".ostickers-card").forEach((card) =>
      card.classList.remove("ostickers-card", "ostickers-card--hide-on-hover")
    );
  }

  function suppressObserver(ms = 250) {
    state.suppressObserverUntil = Math.max(state.suppressObserverUntil, Date.now() + ms);
  }

  async function enhanceCards() {
    suppressObserver();
    clearRenderedCards();

    if (!state.enabled) return;

    const context = getActiveDecorationContext();
    if (context.mode === "disabled") return;

    if (getStickerType() === "image") {
      const assetCount = await ensureAssetCount();
      if (!assetCount) {
        if (!state.assetWarningShown) {
          console.warn("[OStickers] No sequential PNG assets found in the plugin assets folder.");
          state.assetWarningShown = true;
        }
        return;
      }
    }

    const enabledTypes = getEnabledContentTypes();
    if (context.mode === "browse" && !enabledTypes.has(context.browseType)) return;
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
    const uniqueCards = uniqueValues(cards.map(getStickerCardElement).filter(Boolean));

    for (const card of uniqueCards) {
      const info = getCardInfo(card);
      if (!info || !enabledTypes.has(info.type)) continue;
      if (context.mode === "browse" && info.type !== context.browseType) continue;

      const metadata = await fetchMetadata(info);
      if (!metadata?.oCount) continue;

      const stickers = buildStickerModels(info, metadata);
      if (!stickers.length) continue;

      renderCard(card, info, stickers);
    }

    suppressObserver();
  }

  function getStickerCardElement(node) {
    if (!(node instanceof HTMLElement)) return null;

    if (node.matches(CONTENT_CARD_CLASS_SELECTOR)) return node;
    const contentCard = node.closest(CONTENT_CARD_CLASS_SELECTOR);
    if (contentCard instanceof HTMLElement) return contentCard;

    const genericCard = node.matches(GENERIC_CARD_SELECTOR)
      ? node
      : node.closest(GENERIC_CARD_SELECTOR);
    if (
      genericCard instanceof HTMLElement
      && isReasonableCardElement(genericCard)
      && getCardInfo(genericCard)
    ) {
      return genericCard;
    }

    if ((node.matches(DATA_CARD_SELECTOR) || node.matches(CARD_LINK_SELECTOR)) && isReasonableCardElement(node)) return node;
    return null;
  }

  function isReasonableCardElement(node) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (rect.width < 80 || rect.height < 70) return false;
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const nodeArea = rect.width * rect.height;
    return rect.width <= Math.max(900, window.innerWidth * 0.8)
      && rect.height <= Math.max(900, window.innerHeight * 0.8)
      && nodeArea <= viewportArea * 0.6;
  }

  function renderCard(card, info, stickers) {
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    card.classList.add("ostickers-card");
    card.classList.toggle("ostickers-card--hide-on-hover", !!state.config.hideOnHover);

    const layer = document.createElement("div");
    layer.className = "ostickers-layer";
    layer.style.setProperty("--ostickers-overflow", state.config.allowOverflow ? "visible" : "hidden");

    const stickerSizePx = getStickerSizePx(rect.width, rect.height);
    const placements = [];
    stickers.forEach((sticker, index) => {
      const placement = getPlacement(info, rect, stickerSizePx, index, placements);
      placements.push(placement);
      const element = createStickerElement(sticker, stickerSizePx, placement, index);
      layer.appendChild(element);
    });

    card.appendChild(layer);
  }

  function getStickerSizePx(width, height) {
    const percentage = Math.min(100, Math.max(0.05, state.config.sizePercent));
    const size = width * (percentage / 100);
    const maxSize = state.config.allowOverflow ? Math.max(width, height) : Math.min(width, height);
    return Math.max(8, Math.min(maxSize, size));
  }

  function getPlacement(info, rect, stickerSizePx, index, priorPlacements = []) {
    const halfWidthPercent = (stickerSizePx / rect.width) * 50;
    const halfHeightPercent = (stickerSizePx / rect.height) * 50;
    const seed = hashString(`${info.cacheKey}:${index + 1}`);
    const isRain = state.config.animation === "rain";
    const xRange = parsePercentRange(state.config.renderAreaWidth, [0, 100]);
    const yRange = parsePercentRange(state.config.renderAreaHeight, [0, 100]);
    const xBounds = getAxisBounds(xRange, halfWidthPercent);
    const yBounds = getAxisBounds(yRange, halfHeightPercent);
    const minX = xBounds.min;
    const maxX = xBounds.max;
    const minY = yBounds.min;
    const maxY = yBounds.max;
    const duration = Math.max(200, state.config.animationSpeedMs);
    const rainSpanPx = Math.max(stickerSizePx, ((maxY - minY) / 100) * rect.height);
    const desiredSpacingPx = stickerSizePx * (isRain ? 0.92 : 0.84);
    const attemptCount = isRain ? 24 : 18;
    let bestCandidate = null;
    let bestScore = -1;

    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      const attemptSeed = seed + attempt * 97;
      const candidate = isRain
        ? {
            leftPercent: randomBetween(attemptSeed + 17, minX, maxX),
            topPercent: minY - halfHeightPercent - randomBetween(attemptSeed + 31, 2, 12),
            rotation: randomBetween(attemptSeed + 43, -10, 10),
            delay: -Math.round(randomBetween(attemptSeed + 59, 0, duration)),
            rainOffsetPercent: Math.round(randomBetween(attemptSeed + 71, 8, 22)),
            rainDistancePx: Math.round(rainSpanPx + stickerSizePx * randomBetween(attemptSeed + 83, 1.25, 2)),
          }
        : {
            leftPercent: randomBetween(attemptSeed + 17, minX, maxX),
            topPercent: randomBetween(attemptSeed + 31, minY, maxY),
            rotation: randomBetween(attemptSeed + 43, -14, 14),
            delay: Math.round(randomBetween(attemptSeed + 59, 0, Math.min(duration * 0.6, 3000))),
            rainOffsetPercent: Math.round(randomBetween(attemptSeed + 71, 8, 22)),
            rainDistancePx: Math.round(rainSpanPx + stickerSizePx),
          };

      const score = scorePlacement(candidate, priorPlacements, rect, isRain);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
      if (score >= desiredSpacingPx) {
        return candidate;
      }
    }

    return bestCandidate || {
      leftPercent: randomBetween(seed + 17, minX, maxX),
      topPercent: isRain ? minY - halfHeightPercent - 6 : randomBetween(seed + 31, minY, maxY),
      rotation: randomBetween(seed + 43, -14, 14),
      delay: isRain ? -Math.round(randomBetween(seed + 59, 0, duration)) : Math.round(randomBetween(seed + 59, 0, Math.min(duration * 0.6, 3000))),
      rainOffsetPercent: 12,
      rainDistancePx: Math.round(rainSpanPx + stickerSizePx),
    };
  }

  function scorePlacement(candidate, priorPlacements, rect, isRain) {
    if (!priorPlacements.length) return Number.POSITIVE_INFINITY;

    const candidateX = (candidate.leftPercent / 100) * rect.width;
    const candidateY = (candidate.topPercent / 100) * rect.height;
    let minDistance = Number.POSITIVE_INFINITY;

    priorPlacements.forEach((placement) => {
      const previousX = (placement.leftPercent / 100) * rect.width;
      const previousY = (placement.topPercent / 100) * rect.height;
      const dx = Math.abs(candidateX - previousX);
      const dy = Math.abs(candidateY - previousY);
      const distance = isRain ? dx : Math.hypot(dx, dy);
      minDistance = Math.min(minDistance, distance);
    });

    return minDistance;
  }

  function createStickerElement(sticker, stickerSizePx, placement, index) {
    const node = document.createElement("div");
    const stickerType = getStickerType();
    node.className = `ostickers-sticker${stickerType === "emoji" ? " ostickers-sticker--emoji" : ""}${getAnimationClass()}`;
    node.style.setProperty("--osticker-left", `${placement.leftPercent}%`);
    node.style.setProperty("--osticker-top", `${placement.topPercent}%`);
    node.style.setProperty("--osticker-size", `${stickerSizePx}px`);
    node.style.setProperty("--osticker-opacity", String(state.config.opacity));
    node.style.setProperty("--osticker-rotation", `${placement.rotation}deg`);
    node.style.setProperty("--osticker-animation-duration", `${state.config.animationSpeedMs}ms`);
    node.style.setProperty("--osticker-animation-delay", `${placement.delay}ms`);
    node.style.setProperty("--osticker-rain-offset", `${placement.rainOffsetPercent}%`);
    node.style.setProperty("--osticker-rain-distance", `${placement.rainDistancePx}px`);
    node.dataset.ostickerIndex = String(index + 1);

    if (stickerType === "image") {
      const image = document.createElement("img");
      image.alt = "O sticker";
      image.src = `/plugin/${PLUGIN_ID}/assets/${sticker.imageIndex}.png`;
      node.appendChild(image);
    } else {
      node.textContent = sticker.emoji;
    }

    return node;
  }

  function getAnimationClass() {
    if (state.config.animation === "none") return "";
    return ` ostickers-sticker--${state.config.animation}`;
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      if (!state.enabled) {
        clearRenderedCards();
        return;
      }
      enhanceCards().catch((err) => console.warn("[OStickers] Refresh failed", err));
    }, 80);
  }

  function setupToggleButton() {
    let button = document.querySelector(`.${TOGGLE_BUTTON_CLASS}`);

    const parentNode = document.querySelector(".navbar-buttons");
    if (!(button instanceof HTMLButtonElement) && !(parentNode instanceof HTMLElement)) return false;

    if (!(button instanceof HTMLButtonElement)) {
      button = document.createElement("button");
      button.type = "button";
      button.className = `nav-utility btn minimal ${TOGGLE_BUTTON_CLASS}`;
      button.textContent = DEFAULT_EMOJI;
      parentNode.appendChild(button);
    }

    button.onclick = () => {
      state.enabled = !state.enabled;
      setStoredEnabled(state.enabled);
      updateToggleButton();
      if (state.enabled) {
        scheduleRefresh();
      } else {
        clearRenderedCards();
      }
    };

    updateToggleButton();
    return true;
  }

  function updateToggleButton() {
    const button = document.querySelector(`.${TOGGLE_BUTTON_CLASS}`);
    if (!(button instanceof HTMLButtonElement)) return;
    button.classList.toggle("is-disabled", !state.enabled);
    button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
    button.title = state.enabled ? "O Stickers enabled. Click to hide stickers." : "O Stickers disabled. Click to show stickers.";
  }

  function scheduleToggleButtonSetup() {
    REFRESH_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        if (!setupToggleButton()) {
          window.setTimeout(setupToggleButton, 1500);
        }
      }, delay);
    });
  }

  function installRouteHooks() {
    window.__ostickersRouteHandler = () => {
      scheduleToggleButtonSetup();
      REFRESH_DELAYS.forEach((delay) => window.setTimeout(scheduleRefresh, delay));
    };

    if (!window.__ostickersRouteEventListener) {
      window.__ostickersRouteEventListener = () => {
        if (typeof window.__ostickersRouteHandler === "function") {
          window.__ostickersRouteHandler();
        }
      };
      window.addEventListener(ROUTE_EVENT, window.__ostickersRouteEventListener);
    }

    if (window.__ostickersRouteHooksInstalled) return;
    window.__ostickersRouteHooksInstalled = true;

    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event(ROUTE_EVENT));
        return result;
      };
    });

    window.addEventListener("popstate", () => window.dispatchEvent(new Event(ROUTE_EVENT)));
  }

  async function main() {
    registerRuntime();
    await loadConfig();
    installRouteHooks();
    scheduleToggleButtonSetup();
    state.observer = new MutationObserver(() => {
      if (Date.now() < state.suppressObserverUntil) return;
      setupToggleButton();
      scheduleRefresh();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
    scheduleRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main, { once: true });
  } else {
    main();
  }
})();
