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
  const CARD_TYPE_DEFINITIONS = [
    { type: "scene", selector: ".scene-card", datasetKeys: ["sceneId"], hrefPrefixes: ["/scenes/"] },
    { type: "image", selector: ".image-card", datasetKeys: ["imageId"], hrefPrefixes: ["/images/"] },
    { type: "performer", selector: ".performer-card", datasetKeys: ["performerId"], hrefPrefixes: ["/performers/"] },
    { type: "studio", selector: ".studio-card", datasetKeys: ["studioId"], hrefPrefixes: ["/studios/"] },
    { type: "group", selector: ".group-card, .movie-card", datasetKeys: ["groupId", "movieId"], hrefPrefixes: ["/groups/", "/movies/"] },
  ];
  const CONTENT_CARD_CLASS_SELECTOR = ".scene-card, .image-card, .performer-card, .studio-card, .group-card, .movie-card";
  const GENERIC_CARD_SELECTOR = ".card";
  const DEFAULT_ASSET_COUNT = 60;
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
    showToggleButton: true,
  };

  const state = {
    config: { ...DEFAULTS },
    observer: null,
    refreshTimer: 0,
    assetCount: DEFAULT_ASSET_COUNT,
    assetProbePromise: null,
    assetProbeComplete: false,
    assetWarningShown: false,
    enhanceRunning: false,
    refreshQueued: false,
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
    probeAssetCountInBackground();
    if (Number.isInteger(state.assetCount)) return state.assetCount;
    return DEFAULT_ASSET_COUNT;
  }

  function probeAssetCountInBackground() {
    if (state.assetProbeComplete || state.assetProbePromise) return;
    window.setTimeout(() => {
      if (state.assetProbeComplete || state.assetProbePromise || getStickerType() !== "image") return;
      state.assetProbePromise = detectAssetCount()
        .then((count) => {
          state.assetProbeComplete = true;
          if (count > 0 && count !== state.assetCount) {
            state.assetCount = count;
            scheduleRefresh();
          }
          return count;
        })
        .finally(() => {
          state.assetProbePromise = null;
        });
    }, 1200);
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
      image.src = `/plugin/${PLUGIN_ID}/assets/${index}.png`;
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
        showToggleButton: getConfigBoolean(raw.showToggleButton, DEFAULTS.showToggleButton),
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

    const preferredType = getPreferredCardType(card);
    const orderedTypes = uniqueValues([
      preferredType,
      ...CARD_TYPE_DEFINITIONS.map((definition) => definition.type),
    ]);

    const match = orderedTypes
      .map((type) => {
        const definition = getCardTypeDefinition(type);
        return definition ? { type, id: getCardTypeId(card, definition) } : null;
      })
      .find((candidate) => candidate?.id);
    if (!match) return null;

    return {
      type: match.type,
      id: String(match.id),
      cardKey: `${match.type}:${match.id}`,
    };
  }

  function getPreferredCardType(card) {
    const browseType = getActiveBrowseType();
    if (browseType && cardHasTypeSignal(card, browseType)) return browseType;

    const classMatch = CARD_TYPE_DEFINITIONS.find((definition) => card.matches?.(definition.selector));
    if (classMatch) return classMatch.type;

    const datasetMatch = CARD_TYPE_DEFINITIONS.find((definition) => definition.datasetKeys.some((key) => card.dataset?.[key]));
    return datasetMatch?.type || browseType;
  }

  function cardHasTypeSignal(card, type) {
    const definition = getCardTypeDefinition(type);
    if (!definition) return false;
    return Boolean(
      card.matches?.(definition.selector)
      || definition.datasetKeys.some((key) => card.dataset?.[key])
      || definition.hrefPrefixes.some((prefix) => findIdFromHref(card, prefix))
    );
  }

  function getCardTypeDefinition(type) {
    return CARD_TYPE_DEFINITIONS.find((definition) => definition.type === type) || null;
  }

  function getCardTypeId(card, definition) {
    const datasetValue = definition.datasetKeys.map((key) => card.dataset?.[key]).find(Boolean);
    if (datasetValue) return datasetValue;
    return definition.hrefPrefixes.map((prefix) => findIdFromHref(card, prefix)).find(Boolean) || null;
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

  function getCardOCount(card) {
    const datasetCount = getDatasetOCount(card);
    if (datasetCount != null) return datasetCount;

    const selectors = [
      "[title*='O Count' i]",
      "[aria-label*='O Count' i]",
      "[title*='O counter' i]",
      "[aria-label*='O counter' i]",
      "[title*='Orgasm' i]",
      "[aria-label*='Orgasm' i]",
      "[class*='o-count' i]",
      "[class*='ocount' i]",
      "[class*='count' i]",
      "[class*='counter' i]",
      "[class*='stat' i]",
      "svg[data-icon='tint']",
      "svg[data-icon='droplet']",
      "svg[data-icon='water']",
      "i.fa-tint",
      "i.fa-droplet",
      "i.fa-water",
      ".fa-tint",
      ".fa-droplet",
      ".fa-water",
      ".badge",
      ".badge-info",
      ".badge-secondary",
      ".card-count",
      ".card-counts *",
    ].join(", ");
    const elements = uniqueValues(Array.from(card.querySelectorAll(selectors))
      .map((element) => getOCountCandidateElement(card, element)))
      .slice(0, 80);

    for (const element of elements) {
      const parsed = getElementOCount(element);
      if (parsed != null) return parsed;
    }

    return parseDropletOCount(card.textContent || "");
  }

  function getOCountCandidateElement(card, element) {
    const parent = element.closest?.(".badge, .badge-info, .badge-secondary, .card-count, .card-counts > *, .card-section span, .card-section button");
    return parent instanceof HTMLElement && card.contains(parent) ? parent : element;
  }

  function getDatasetOCount(card) {
    const datasetKeys = ["oCounter", "oCount", "ocounter", "ocount", "o_counter"];
    for (const key of datasetKeys) {
      const value = card.dataset?.[key];
      if (value != null && value !== "") return normalizeCount(value);
    }
    const attributeKeys = ["data-o-counter", "data-o-count", "data-ocounter", "data-ocount", "data-o_counter"];
    for (const key of attributeKeys) {
      const value = card.getAttribute?.(key);
      if (value != null && value !== "") return normalizeCount(value);
    }
    return null;
  }

  function getElementOCount(element) {
    const labels = getElementLabels(element);
    const text = getElementVisibleText(element);
    const labelledCount = parseLabelledOCount(`${labels} ${text}`);
    if (labelledCount != null) return labelledCount;

    if (hasOCountLabel(labels) || hasOCountGlyph(labels) || hasOCountIcon(element)) {
      const plainCount = parsePlainCount(text)
        ?? parseOIconClusterCount(element)
        ?? parsePlainCount(getElementNeighborhoodText(element));
      if (plainCount != null) return plainCount;
    }

    return null;
  }

  function getElementNeighborhoodText(element) {
    const parts = [
      getElementVisibleText(element),
      getElementVisibleText(element.parentElement),
      getElementVisibleText(element.previousElementSibling),
      getElementVisibleText(element.nextElementSibling),
    ];
    return parts.filter(Boolean).join(" ");
  }

  function parseOIconClusterCount(element) {
    const clusters = uniqueValues([
      element.closest?.(".badge, .badge-info, .badge-secondary, .card-count, .card-counts > *, .card-section span, .card-section button, [class*='count' i], [class*='stat' i]"),
      element.parentElement,
      element.parentElement?.parentElement,
    ]).filter((cluster) => cluster instanceof HTMLElement);

    for (const cluster of clusters) {
      const clusterLabels = getElementLabels(cluster);
      if (!hasOCountLabel(clusterLabels) && !hasOCountGlyph(clusterLabels) && !hasOCountIcon(cluster)) continue;

      const clusterText = getElementVisibleText(cluster);
      const labelled = parseLabelledOCount(`${clusterLabels} ${clusterText}`);
      if (labelled != null) return labelled;

      const plain = parsePlainCount(clusterText);
      if (plain != null) return plain;
    }

    const siblingCount = parseAdjacentNodeCount(element) ?? parseAdjacentNodeCount(element.parentElement);
    return siblingCount;
  }

  function parseAdjacentNodeCount(element) {
    if (!(element instanceof HTMLElement)) return null;
    const nearbyNodes = [
      element.previousSibling,
      element.nextSibling,
      element.previousElementSibling,
      element.nextElementSibling,
    ];

    for (const node of nearbyNodes) {
      const parsed = parsePlainCount(getNodeVisibleText(node));
      if (parsed != null) return parsed;
    }

    return null;
  }

  function getNodeVisibleText(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node instanceof HTMLElement) return getElementVisibleText(node);
    return "";
  }

  function getElementLabels(element) {
    const labels = [
      element.getAttribute("title"),
      element.getAttribute("aria-label"),
      element.getAttribute("data-original-title"),
      element.className,
      getPseudoContent(element),
    ];
    element.querySelectorAll("[title], [aria-label], [data-original-title], svg, i, .fa, .svg-inline--fa").forEach((child) => {
      labels.push(
        child.getAttribute("title"),
        child.getAttribute("aria-label"),
        child.getAttribute("data-original-title"),
        child.getAttribute("data-icon"),
        child.className,
        getPseudoContent(child),
        child.querySelector("title")?.textContent
      );
    });
    return labels.filter(Boolean).join(" ");
  }

  function getElementVisibleText(element) {
    if (!(element instanceof HTMLElement)) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll("svg, i, .fa, .svg-inline--fa, title").forEach((node) => node.remove());
    return clone.textContent || element.textContent || "";
  }

  function getPseudoContent(element) {
    if (!(element instanceof Element)) return "";
    try {
      return ["::before", "::after"]
        .map((pseudo) => window.getComputedStyle(element, pseudo)?.content || "")
        .map((content) => content.replace(/^['"]|['"]$/g, ""))
        .filter((content) => content && content !== "none" && content !== "normal")
        .join(" ");
    } catch (err) {
      return "";
    }
  }

  function hasOCountIcon(element) {
    const iconSelector = [
      "svg[data-icon='tint']",
      "svg[data-icon='droplet']",
      "svg[data-icon='water']",
      "svg[data-icon='faucet-drip']",
      "i.fa-tint",
      "i.fa-droplet",
      "i.fa-water",
      ".fa-tint",
      ".fa-droplet",
      ".fa-water",
    ].join(", ");
    return element.matches?.(iconSelector)
      || Boolean(element.querySelector?.(iconSelector))
      || hasOCountGlyph(getPseudoContent(element))
      || Array.from(element.querySelectorAll?.("*") || []).slice(0, 20).some((child) => hasOCountGlyph(getPseudoContent(child)));
  }

  function hasOCountLabel(value) {
    return /\bo[\s_-]*(?:count|counter)\b|\bocount\b|\borgasm/i.test(String(value || ""));
  }

  function hasOCountGlyph(value) {
    return /💦|\uf043/i.test(String(value || ""));
  }

  function parseLabelledOCount(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 120) return null;
    const patterns = [
      /\bo[\s_-]*(?:count|counter)\b\s*[:#-]?\s*(\d+)/i,
      /\b(\d+)\s*o(?:'s|s)?\b/i,
      /\bo(?:'s|s)?\s*[:#-]?\s*(\d+)\b/i,
      /\u{1F4A6}\s*(\d+)\b/u,
      /\b(\d+)\s*\u{1F4A6}/u,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return normalizeCount(match[1]);
    }
    return null;
  }

  function parseDropletOCount(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const patterns = [
      /\u{1F4A6}\s*(\d+)\b/u,
      /\b(\d+)\s*\u{1F4A6}/u,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return normalizeCount(match[1]);
    }
    return null;
  }

  function parsePlainCount(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) return null;
    if (/^\d+$/.test(text)) return normalizeCount(text);
    const numbers = text.match(/\d+/g) || [];
    if (numbers.length !== 1) return null;
    return normalizeCount(numbers[0]);
  }

  function buildStickerModels(info, cardOCount) {
    const oCount = normalizeCount(cardOCount);
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
        key: `${info.cardKey}:${mode}:${oCount}:${index}`,
        imageIndex: stickerType === "image" ? resolveImageIndex(mode, oCount, index, info.cardKey) : null,
        emoji: stickerType === "emoji" ? resolveEmoji(emojis, mode, oCount, index, info.cardKey) : DEFAULT_EMOJI,
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
    document.querySelectorAll(".ostickers-card").forEach((card) => {
      card.classList.remove("ostickers-card", "ostickers-card--hide-on-hover");
      delete card.dataset.ostickersSignature;
    });
  }

  function suppressObserver(ms = 250) {
    state.suppressObserverUntil = Math.max(state.suppressObserverUntil, Date.now() + ms);
  }

  function getRenderSignature(info, stickers, rect) {
    const visualConfig = [
      state.config.mode,
      state.config.imageMode,
      state.config.sizePercent,
      state.config.opacity,
      state.config.animation,
      state.config.animationSpeedMs,
      state.config.allowOverflow,
      state.config.hideOnHover,
      state.config.maxOverflowPercent,
      state.config.renderAreaWidth,
      state.config.renderAreaHeight,
      state.config.thresholds,
      state.config.emoji,
      Math.round(rect.width),
      Math.round(rect.height),
    ].join("|");
    return `${info.cardKey}|${stickers.map((sticker) => sticker.key).join(",")}|${hashString(visualConfig)}`;
  }

  function removeCardLayer(card) {
    card.querySelector(":scope > .ostickers-layer")?.remove();
    card.classList.remove("ostickers-card", "ostickers-card--hide-on-hover");
    delete card.dataset.ostickersSignature;
  }

  async function enhanceCards() {
    if (state.enhanceRunning) {
      state.refreshQueued = true;
      return;
    }

    state.enhanceRunning = true;
    try {
      await enhanceCardsInner();
    } finally {
      state.enhanceRunning = false;
      if (state.refreshQueued) {
        state.refreshQueued = false;
        scheduleRefresh();
      }
    }
  }

  async function enhanceCardsInner() {
    suppressObserver();

    if (!state.enabled) {
      clearRenderedCards();
      return;
    }

    const context = getActiveDecorationContext();
    if (context.mode === "disabled") {
      clearRenderedCards();
      return;
    }

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
    if (context.mode === "browse" && !enabledTypes.has(context.browseType)) {
      clearRenderedCards();
      return;
    }
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
    const uniqueCards = uniqueValues(cards.map(getStickerCardElement).filter(Boolean));

    for (const card of uniqueCards) {
      const info = getCardInfo(card);
      if (!info || !enabledTypes.has(info.type)) continue;
      if (context.mode === "browse" && info.type !== context.browseType) continue;
      const oCount = getCardOCount(card);
      if (!oCount) {
        removeCardLayer(card);
        continue;
      }

      const stickers = buildStickerModels(info, oCount);
      if (!stickers.length) {
        removeCardLayer(card);
        continue;
      }

      renderCard(card, info, stickers);
    }

    suppressObserver();
  }

  function getStickerCardElement(node) {
    if (!(node instanceof HTMLElement)) return null;

    const contentCard = node.closest(CONTENT_CARD_CLASS_SELECTOR);
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

    if (node.matches(CONTENT_CARD_CLASS_SELECTOR)) return node;
    if (contentCard instanceof HTMLElement) return contentCard;

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
    const signature = getRenderSignature(info, stickers, rect);
    if (card.dataset.ostickersSignature === signature && card.querySelector(":scope > .ostickers-layer")) {
      card.classList.add("ostickers-card");
      card.classList.toggle("ostickers-card--hide-on-hover", !!state.config.hideOnHover);
      return;
    }

    card.querySelector(":scope > .ostickers-layer")?.remove();
    card.classList.add("ostickers-card");
    card.classList.toggle("ostickers-card--hide-on-hover", !!state.config.hideOnHover);
    card.dataset.ostickersSignature = signature;

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
    const seed = hashString(`${info.cardKey}:${index + 1}`);
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
    if (!state.config.showToggleButton) {
      document.querySelector(`.${TOGGLE_BUTTON_CLASS}`)?.remove();
      return true;
    }

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
      clearRenderedCards();
      updateToggleButton();
      if (state.enabled) {
        scheduleRefresh();
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
