(function () {
  "use strict";

  const PLUGIN_ID = "OStickers";
  const ROUTE_EVENT = "ostickers:navigation";
  const CARD_SELECTOR = ".scene-card, .image-card, .performer-card, .studio-card, [data-scene-id], [data-image-id], [data-performer-id], [data-studio-id]";
  const CONTENT_TYPES = new Set(["scene", "image", "performer", "studio"]);
  const MODES = new Set(["repeat", "incremental", "single", "thresholds"]);
  const STICKER_TYPES = new Set(["image", "emoji"]);
  const IMAGE_MODES = new Set(["random", "fixed"]);
  const ANIMATIONS = new Set(["none", "float", "wiggle", "pulse", "rain"]);
  const REFRESH_DELAYS = [0, 150, 450, 1000];
  const MAX_ASSET_PROBE = 500;

  const DEFAULTS = {
    maxStickers: 50,
    stickersPerOCount: 1,
    mode: "incremental",
    type: "image",
    emoji: "💦",
    imageMode: "random",
    sizePercent: 25,
    opacity: 0.3,
    animation: "none",
    animationSpeedMs: 5000,
    allowOverflow: true,
    thresholds: "1,5,10,25,50",
    contentTypes: "image,scene,studio,performer",
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
    if (state.config.type !== "image") return 0;
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
        type: normalizeEnum(raw.type, STICKER_TYPES, DEFAULTS.type),
        emoji: getConfigString(raw.emoji, DEFAULTS.emoji),
        imageMode: normalizeEnum(raw.imageMode, IMAGE_MODES, DEFAULTS.imageMode),
        sizePercent: getConfigNumber(raw.sizePercent, DEFAULTS.sizePercent, 0.05, 100),
        opacity: getConfigNumber(raw.opacity, DEFAULTS.opacity, 0, 1),
        animation: normalizeEnum(raw.animation, ANIMATIONS, DEFAULTS.animation),
        animationSpeedMs: getConfigNumber(raw.animationSpeedMs, DEFAULTS.animationSpeedMs, 200, 60000),
        allowOverflow: getConfigBoolean(raw.allowOverflow, DEFAULTS.allowOverflow),
        thresholds: getConfigString(raw.thresholds, DEFAULTS.thresholds),
        contentTypes: getConfigString(raw.contentTypes, DEFAULTS.contentTypes),
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

  function getCardInfo(card) {
    if (!(card instanceof HTMLElement)) return null;

    const candidates = [
      { type: "scene", id: card.dataset.sceneId || findIdFromHref(card, "/scenes/") },
      { type: "image", id: card.dataset.imageId || findIdFromHref(card, "/images/") },
      { type: "performer", id: card.dataset.performerId || findIdFromHref(card, "/performers/") },
      { type: "studio", id: card.dataset.studioId || findIdFromHref(card, "/studios/") },
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
    return null;
  }

  function findIdFromHref(card, prefix) {
    const link = card.querySelector(`a[href*="${prefix}"]`);
    const href = link?.getAttribute("href") || "";
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
    if (state.metadataCache.has(info.cacheKey)) return state.metadataCache.get(info.cacheKey);

    const promise = fetchMetadataInner(info)
      .catch((err) => {
        console.warn("[OStickers] Metadata load failed", info.cacheKey, err);
        state.metadataCache.delete(info.cacheKey);
        return null;
      });

    state.metadataCache.set(info.cacheKey, promise);
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

    return { oCount: 0 };
  }

  async function fetchAggregateOCount(kind, id) {
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
    } catch (err) {
      console.warn("[OStickers] Aggregate O-count lookup failed", kind, id, err);
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
        imageIndex: state.config.type === "image" ? resolveImageIndex(mode, oCount, index, info.cacheKey) : null,
        emoji: state.config.emoji || DEFAULTS.emoji,
      });
    }
    return models;
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
    document.querySelectorAll(".ostickers-card").forEach((card) => card.classList.remove("ostickers-card"));
  }

  function suppressObserver(ms = 250) {
    state.suppressObserverUntil = Math.max(state.suppressObserverUntil, Date.now() + ms);
  }

  async function enhanceCards() {
    suppressObserver();
    clearRenderedCards();

    const activeBrowseType = getActiveBrowseType();
    if (!activeBrowseType) return;

    if (state.config.type === "image") {
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
    if (!enabledTypes.has(activeBrowseType)) return;
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
    const uniqueCards = uniqueValues(cards);

    for (const card of uniqueCards) {
      const info = getCardInfo(card);
      if (!info || info.type !== activeBrowseType || !enabledTypes.has(info.type)) continue;

      const metadata = await fetchMetadata(info);
      if (!metadata?.oCount) continue;

      const stickers = buildStickerModels(info, metadata);
      if (!stickers.length) continue;

      renderCard(card, info, stickers);
    }

    suppressObserver();
  }

  function renderCard(card, info, stickers) {
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    card.classList.add("ostickers-card");

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
    const minX = state.config.allowOverflow ? -halfWidthPercent : halfWidthPercent;
    const maxX = state.config.allowOverflow ? 100 + halfWidthPercent : 100 - halfWidthPercent;
    const minY = state.config.allowOverflow ? -halfHeightPercent : halfHeightPercent;
    const maxY = state.config.allowOverflow ? 100 + halfHeightPercent : 100 - halfHeightPercent;
    const duration = Math.max(200, state.config.animationSpeedMs);
    const desiredSpacingPx = stickerSizePx * (isRain ? 0.92 : 0.84);
    const attemptCount = isRain ? 24 : 18;
    let bestCandidate = null;
    let bestScore = -1;

    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      const attemptSeed = seed + attempt * 97;
      const candidate = isRain
        ? {
            leftPercent: randomBetween(attemptSeed + 17, minX, Math.max(minX, maxX)),
            topPercent: -halfHeightPercent - randomBetween(attemptSeed + 31, 2, 12),
            rotation: randomBetween(attemptSeed + 43, -10, 10),
            delay: -Math.round(randomBetween(attemptSeed + 59, 0, duration)),
            rainOffsetPercent: Math.round(randomBetween(attemptSeed + 71, 8, 22)),
            rainDistancePx: Math.round(rect.height + stickerSizePx * randomBetween(attemptSeed + 83, 1.25, 2)),
          }
        : {
            leftPercent: randomBetween(attemptSeed + 17, minX, Math.max(minX, maxX)),
            topPercent: randomBetween(attemptSeed + 31, minY, Math.max(minY, maxY)),
            rotation: randomBetween(attemptSeed + 43, -14, 14),
            delay: Math.round(randomBetween(attemptSeed + 59, 0, Math.min(duration * 0.6, 3000))),
            rainOffsetPercent: Math.round(randomBetween(attemptSeed + 71, 8, 22)),
            rainDistancePx: Math.round(rect.height + stickerSizePx),
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
      leftPercent: randomBetween(seed + 17, minX, Math.max(minX, maxX)),
      topPercent: isRain ? -halfHeightPercent - 6 : randomBetween(seed + 31, minY, Math.max(minY, maxY)),
      rotation: randomBetween(seed + 43, -14, 14),
      delay: isRain ? -Math.round(randomBetween(seed + 59, 0, duration)) : Math.round(randomBetween(seed + 59, 0, Math.min(duration * 0.6, 3000))),
      rainOffsetPercent: 12,
      rainDistancePx: Math.round(rect.height + stickerSizePx),
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
    node.className = `ostickers-sticker${state.config.type === "emoji" ? " ostickers-sticker--emoji" : ""}${getAnimationClass()}`;
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

    if (state.config.type === "image") {
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
      enhanceCards().catch((err) => console.warn("[OStickers] Refresh failed", err));
    }, 80);
  }

  function installRouteHooks() {
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
    window.addEventListener(ROUTE_EVENT, () => {
      REFRESH_DELAYS.forEach((delay) => window.setTimeout(scheduleRefresh, delay));
    });
  }

  async function main() {
    await loadConfig();
    installRouteHooks();
    state.observer = new MutationObserver(() => {
      if (Date.now() < state.suppressObserverUntil) return;
      scheduleRefresh();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
    scheduleRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
