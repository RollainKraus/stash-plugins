(function () {
  "use strict";

  const PLUGIN_ID = "PerformerTagBasedSupportingImages";
  const PANEL_ID = "ptbsi-performer-supporting-images";
  const HOST_ID = "ptbsi-performer-supporting-images-host";
  const PTO_HOST_ID = "kmv-performer-tags-overhaul-host";
  const LAYOUT_CHANGED_EVENT = "performer-page-layout-changed";
  const ROUTE_RETRY_DELAYS = [0, 150, 400, 900, 1600];
  const STICKY_TOP = 12;
  const PANEL_BOTTOM_GAP = 16;
  const PANEL_SIDE_GAP = 8;
  const PANEL_MIN_HEIGHT = 220;
  const PANEL_BASE_WIDTH = 300;
  const PANEL_MAX_WIDTH = Math.round(PANEL_BASE_WIDTH * 1.5);
  const CROP_STORAGE_KEY = "ptbsi-slot-crops-v1";
  const SLOT_ASPECT_STORAGE_KEY = "ptbsi-slot-aspect-modes-v1";
  const SLOT_ASPECT_MODES = ["tall", "portrait", "square", "landscape"];
  const LOOP_REPEAT_COUNT = 3;
  const LAYOUT_REFRESH_DELAYS = [0, 80, 180, 320];

  const state = {
    currentPerformer: null,
    config: null,
    tagMap: null,
    panelData: null,
    panelKey: null,
    isInjecting: false,
    injectToken: 0,
    scheduledRouteToken: 0,
    scheduledLayoutToken: 0,
    lastPath: "",
    observer: null,
    observerTimer: null,
    slotIndices: new Map(),
    layoutHandlersInstalled: false,
    contentBoundary: null,
    contentHoverTarget: null,
    hoveredContent: false,
    resizeObserver: null,
    observedElements: new Set(),
    cropStore: loadCropStore(),
    slotAspectStore: loadSlotAspectStore(),
    cropEditor: null,
  };

  function gqlRequest(query, variables = {}) {
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

  function getConfigBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return fallback;
  }

  function getConfigNumber(value, fallback, min, max) {
    const parsed = parseInt(String(value || "").trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (Number.isFinite(min) && parsed < min) return fallback;
    if (Number.isFinite(max) && parsed > max) return fallback;
    return parsed;
  }

  function loadCropStore() {
    try {
      const raw = window.localStorage.getItem(CROP_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveCropStore() {
    try {
      window.localStorage.setItem(CROP_STORAGE_KEY, JSON.stringify(state.cropStore));
    } catch (err) {
      void err;
    }
  }

  function loadSlotAspectStore() {
    try {
      const raw = window.localStorage.getItem(SLOT_ASPECT_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveSlotAspectStore() {
    try {
      window.localStorage.setItem(
        SLOT_ASPECT_STORAGE_KEY,
        JSON.stringify(state.slotAspectStore)
      );
    } catch (err) {
      void err;
    }
  }

  function normalizeSlotAspectMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return SLOT_ASPECT_MODES.includes(normalized) ? normalized : "square";
  }

  function getSavedSlotAspectMode(slotKey) {
    return normalizeSlotAspectMode(state.slotAspectStore?.[String(slotKey)]);
  }

  function setSavedSlotAspectMode(slotKey, mode) {
    state.slotAspectStore[String(slotKey)] = normalizeSlotAspectMode(mode);
    saveSlotAspectStore();
  }

  function getAspectRatioForMode(mode) {
    switch (normalizeSlotAspectMode(mode)) {
      case "tall":
        return 9 / 16;
      case "portrait":
        return 2 / 3;
      case "landscape":
        return 4 / 3;
      default:
        return 1;
    }
  }

  function inferSlotAspectModeFromRatio(ratio) {
    const numericRatio = Number(ratio);
    if (!(numericRatio > 0)) return "square";

    let bestMode = "square";
    let bestDistance = Number.POSITIVE_INFINITY;

    SLOT_ASPECT_MODES.forEach((mode) => {
      const modeRatio = getAspectRatioForMode(mode);
      const distance = Math.abs(Math.log(numericRatio / modeRatio));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMode = mode;
      }
    });

    return bestMode;
  }

  function inferSlotAspectMode(slotKey, image) {
    if (!image?.id) return "square";
    const dimensions = getImageDimensions(image);
    if (!dimensions) return "square";
    const crop = getSavedCrop(slotKey, image.id);
    return inferSlotAspectModeFromRatio(getCropAspectRatio(dimensions, crop));
  }

  function getSlotAspectLabel(mode) {
    return getSlotAspectDisplayName(mode);
  }

  function getSlotAspectTitle(mode) {
    return `Slot aspect: ${getSlotAspectDisplayName(mode)}`;
  }

  function getSlotAspectDisplayName(mode) {
    switch (normalizeSlotAspectMode(mode)) {
      case "tall":
        return "9:16";
      case "portrait":
        return "2:3";
      case "landscape":
        return "4:3";
      default:
        return "1:1";
    }
  }

  function updateStoredSlotAspectMode(slotKey, mode) {
    const normalized = normalizeSlotAspectMode(mode);
    setSavedSlotAspectMode(slotKey, normalized);
    const slot = state.panelData?.slots?.find((item) => item.key === slotKey);
    if (slot) {
      slot.aspectMode = normalized;
    }
    return normalized;
  }

  function getCropStoreKey(slotKey, imageId) {
    return `${String(slotKey)}:${String(imageId)}`;
  }

  function normalizeCropRect(rect) {
    if (!rect || typeof rect !== "object") return null;
    const x = Math.max(0, Math.min(1, Number(rect.x) || 0));
    const y = Math.max(0, Math.min(1, Number(rect.y) || 0));
    const width = Math.max(0, Math.min(1, Number(rect.width) || 0));
    const height = Math.max(0, Math.min(1, Number(rect.height) || 0));
    const right = Math.max(x, Math.min(1, x + width));
    const bottom = Math.max(y, Math.min(1, y + height));
    const normalizedWidth = right - x;
    const normalizedHeight = bottom - y;

    if (normalizedWidth < 0.02 || normalizedHeight < 0.02) {
      return null;
    }

    return {
      x,
      y,
      width: normalizedWidth,
      height: normalizedHeight,
    };
  }

  function getSavedCrop(slotKey, imageId) {
    const crop = state.cropStore[getCropStoreKey(slotKey, imageId)];
    return normalizeCropRect(crop);
  }

  function setSavedCrop(slotKey, imageId, crop) {
    const key = getCropStoreKey(slotKey, imageId);
    const normalized = normalizeCropRect(crop);
    if (normalized) {
      state.cropStore[key] = normalized;
    } else {
      delete state.cropStore[key];
    }
    saveCropStore();
  }

  function getPerformerFromPath(pathname) {
    const match = pathname.match(/^\/performers\/(\d+)/);
    if (!match) return null;
    return { id: match[1], type: "performer" };
  }

  function isPerformerPage() {
    return !!getPerformerFromPath(window.location.pathname);
  }

  function getCurrentKey(performer) {
    return performer ? `${performer.type}:${performer.id}` : null;
  }

  function getDetailContainer() {
    return document.querySelector(".detail-container");
  }

  function getContentBoundaryElement(container = getDetailContainer()) {
    const selectors = [
      ":scope > .performer-tabs",
      ":scope > .nav-tabs",
      ":scope > .tab-content",
      ":scope > .scene-divider",
    ];

    if (container) {
      for (const selector of selectors) {
        const match = container.querySelector(selector);
        if (match) return match;
      }

      const nestedMatch =
        container.querySelector(".performer-tabs") ||
        container.querySelector(".nav-tabs") ||
        container.querySelector(".tab-content") ||
        container.querySelector(".scene-divider");

      if (nestedMatch) return nestedMatch;
    }

    const header = getDetailHeader();
    const minBoundaryTop = Math.max(
      getAbsoluteBottom(header) || 0,
      getAbsoluteTop(container) || 0
    );
    const globalSelectors = [
      ".performer-tabs",
      ".nav-tabs",
      ".tab-content",
      ".scene-divider",
    ];

    const candidates = globalSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, list) => list.indexOf(element) === index)
      .filter((element) => !isPluginNode(element))
      .map((element) => ({
        element,
        top: getAbsoluteTop(element),
      }))
      .filter(
        (candidate) =>
          Number.isFinite(candidate.top) && candidate.top > minBoundaryTop
      )
      .sort((left, right) => left.top - right.top);

    return candidates[0]?.element || null;
  }

  function getDetailHeader() {
    return document.querySelector(".detail-header");
  }

  function getAbsoluteTop(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return window.scrollY + rect.top;
  }

  function getAbsoluteRight(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return window.scrollX + rect.right;
  }

  function getAbsoluteBottom(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return window.scrollY + rect.bottom;
  }

  function getOverlayOffsetTargets() {
    return [
      getDetailHeader(),
      document.getElementById(PTO_HOST_ID),
    ].filter(Boolean);
  }

  function clearOverlayOffsets() {
    getOverlayOffsetTargets().forEach((element) => {
      element.style.removeProperty("padding-right");
    });
  }

  function applyOverlayOffsets(overlayLeft, gap = PANEL_SIDE_GAP) {
    getOverlayOffsetTargets().forEach((element) => {
      const targetRight = getAbsoluteRight(element);
      const value =
        Number.isFinite(overlayLeft) && Number.isFinite(targetRight)
          ? Math.max(0, Math.round(targetRight - overlayLeft + gap))
          : 0;

      if (value > 0) {
        element.style.paddingRight = `${value}px`;
      } else {
        element.style.removeProperty("padding-right");
      }
    });
  }

  function updateContentHoverBinding() {
    const nextTarget = state.contentBoundary;
    if (state.contentHoverTarget === nextTarget) return;

    if (state.contentHoverTarget) {
      state.contentHoverTarget.removeEventListener(
        "mouseenter",
        handleContentHoverStart
      );
      state.contentHoverTarget.removeEventListener(
        "mouseleave",
        handleContentHoverEnd
      );
    }

    state.contentHoverTarget = nextTarget;
    state.hoveredContent = false;

    if (nextTarget) {
      nextTarget.addEventListener("mouseenter", handleContentHoverStart);
      nextTarget.addEventListener("mouseleave", handleContentHoverEnd);
    }
  }

  function handleContentHoverStart() {
    state.hoveredContent = true;
    updateFloatingPanelLayout();
  }

  function handleContentHoverEnd() {
    state.hoveredContent = false;
    updateFloatingPanelLayout();
  }

  function ensureLayoutHost() {
    const header = getDetailHeader();
    if (!header) return null;

    const boundary = getContentBoundaryElement();
    state.contentBoundary = boundary || null;
    updateContentHoverBinding();

    let host = document.getElementById(HOST_ID);
    if (host && host.parentNode !== document.body) {
      host.remove();
      host = null;
    }

    if (!host) {
      host = document.createElement("aside");
      host.id = HOST_ID;
      host.className = "performer-tag-based-supporting-images__host";
    }

    if (host.parentNode !== document.body) {
      document.body.appendChild(host);
    }

    return host;
  }

  function scheduleLayoutRefresh(delays = LAYOUT_REFRESH_DELAYS) {
    const token = ++state.scheduledLayoutToken;
    delays.forEach((delay) => {
      window.setTimeout(() => {
        if (token !== state.scheduledLayoutToken) return;
        updateFloatingPanelLayout();
      }, delay);
    });
  }

  function applyRailSizing(host, panel, availableHeight) {
    const fallbackPanelHeight = Math.max(
      PANEL_MIN_HEIGHT,
      window.innerHeight - STICKY_TOP - PANEL_BOTTOM_GAP
    );
    const clampedHostHeight = Number.isFinite(availableHeight)
      ? Math.max(0, Math.round(availableHeight))
      : 0;
    const panelHeight = Number.isFinite(availableHeight)
      ? clampedHostHeight
      : fallbackPanelHeight;
    const clampedPanelHeight = Math.max(0, Math.round(panelHeight));
    const hostRect = host.getBoundingClientRect();
    const hostWidth = Math.max(
      260,
      Math.round(hostRect.width || host.clientWidth || 0)
    );

    host.style.height = Number.isFinite(availableHeight)
      ? `${clampedHostHeight}px`
      : "";
    host.style.minHeight = Number.isFinite(availableHeight)
      ? `${clampedHostHeight}px`
      : "";
    host.style.maxHeight = Number.isFinite(availableHeight)
      ? `${clampedHostHeight}px`
      : "";
    host.style.visibility = "";

    panel.style.height = Number.isFinite(availableHeight)
      ? "100%"
      : `${clampedPanelHeight}px`;
    panel.style.minHeight = Number.isFinite(availableHeight)
      ? `${clampedHostHeight}px`
      : `${clampedPanelHeight}px`;
    panel.style.maxHeight = Number.isFinite(availableHeight)
      ? `${clampedHostHeight}px`
      : `${clampedPanelHeight}px`;
    panel.style.width = hostWidth > 0 ? `${hostWidth}px` : "";

    const shouldHideForBoundary =
      Number.isFinite(availableHeight) && clampedHostHeight < 120;
    panel.classList.toggle("is-hidden", shouldHideForBoundary);
    panel.classList.toggle(
      "is-content-hovered",
      !!state.hoveredContent && !shouldHideForBoundary
    );

    if (!shouldHideForBoundary) {
      panel.classList.remove("is-hidden");
    }
  }

  function updateLoopReelSizing(panel) {
    void panel;
  }

  function updateFloatingPanelLayout() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const host = ensureLayoutHost();
    if (!host) {
      panel.classList.add("is-hidden");
      return;
    }

    if (panel.parentNode !== host) {
      host.appendChild(panel);
    }

    const header = getDetailHeader();
    const detailContainer = getDetailContainer();
    const ptoHost = document.getElementById(PTO_HOST_ID);
    const topCandidates = [getAbsoluteTop(header), getAbsoluteTop(detailContainer)].filter(
      (value) => Number.isFinite(value)
    );
    const rightCandidates = [
      getAbsoluteRight(header),
      getAbsoluteRight(detailContainer),
    ].filter((value) => Number.isFinite(value));
    const bottomCandidates = [
      getAbsoluteBottom(ptoHost),
      getAbsoluteTop(state.contentBoundary),
    ].filter((value) => Number.isFinite(value));

    const overlayTop = topCandidates.length ? Math.min(...topCandidates) : null;
    const overlayRight = rightCandidates.length ? Math.max(...rightCandidates) : null;
    const widthScale = getPanelWidthScale(state.config || {});
    const overlayWidth = Math.max(
      PANEL_BASE_WIDTH,
      Math.min(
        PANEL_MAX_WIDTH,
        Math.round((PANEL_BASE_WIDTH * widthScale) / 100)
      )
    );
    const overlayLeft =
      Number.isFinite(overlayRight) && Number.isFinite(overlayTop)
        ? Math.max(0, Math.round(overlayRight - overlayWidth))
        : null;
    const overlayBottom = bottomCandidates.length ? Math.min(...bottomCandidates) : null;

    host.style.position = "absolute";
    host.style.top = Number.isFinite(overlayTop) ? `${overlayTop}px` : "";
    host.style.left = Number.isFinite(overlayLeft) ? `${overlayLeft}px` : "";
    host.style.width = `${overlayWidth}px`;
    host.style.zIndex = "20";
    applyOverlayOffsets(window.innerWidth > 900 ? overlayLeft : null);

    const hostHeight = Math.max(
      0,
      Math.round(host.getBoundingClientRect().height || host.clientHeight || 0)
    );
    const availableHeight =
      (Number.isFinite(overlayBottom) && Number.isFinite(overlayTop)
        ? overlayBottom - overlayTop - PANEL_BOTTOM_GAP
        : null) ?? (hostHeight > 0 ? hostHeight : null);
    applyRailSizing(host, panel, availableHeight);
    updateLoopReelSizing(panel);
  }

  function getSelectionMode(cfg) {
    const value = String(cfg.a_selectionMode || "").trim().toLowerCase();
    return value === "random" ? "random" : "first";
  }

  function getSlotTagMatchMode(cfg) {
    const value = String(cfg.a_slotTagMatchMode || "").trim().toLowerCase();
    return value === "all" ? "all" : "any";
  }

  function shouldEnableLoopingSlots(slots, cfg) {
    return (
      getConfigBoolean(cfg?.a_loopSlots, true) &&
      Array.isArray(slots) &&
      slots.length > 1
    );
  }

  function getSlotInfoPosition(cfg) {
    const value = String(cfg.a_slotInfoPosition || "").trim().toLowerCase();
    if (value === "bottom" || value === "bottom-center") {
      return "bottom-center";
    }
    return "top-center";
  }

  function getImageHeight(cfg) {
    return getConfigNumber(cfg.a_imageHeight, 210, 80, 1200);
  }

  function getPanelWidthScale(cfg) {
    return getConfigNumber(cfg.a_panelWidthScale, 100, 100, 150);
  }

  function getOverlayBackgroundOpacity(cfg) {
    const parsed = parseFloat(String(cfg.a_overlayBackgroundOpacity || "").trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return String(parsed);
    }
    return "0.3";
  }

  function getOverlayFontColor(cfg) {
    const value = String(cfg.a_overlayFontColor || "").trim();
    return value || "#ffffff";
  }

  function getOverlayBackgroundColor(cfg) {
    const value = String(cfg.a_overlayBackgroundColor || "").trim();
    return value || "#808080";
  }

  function getOverlayFontSize(cfg) {
    const size = getConfigNumber(cfg.a_overlayFontSize, 13, 10, 32);
    return `${size}px`;
  }

  function getPanelOpacity(cfg) {
    const parsed = parseFloat(String(cfg.a_panelOpacity || "").trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return String(parsed);
    }
    return "0.1";
  }

  function getPanelFontColor(cfg) {
    const value = String(cfg.a_panelFontColor || "").trim();
    return value || "#ffffff";
  }

  function getPanelBackgroundColor(cfg) {
    const value = String(cfg.a_panelBackgroundColor || "").trim();
    return value || "#808080";
  }

  function makeSurfaceColor(color, opacity, intensity) {
    const normalizedOpacity = Math.max(0, Math.min(1, Number(opacity) || 0));
    const percent = Math.max(
      0,
      Math.min(100, Math.round(normalizedOpacity * intensity * 10000) / 100)
    );
    return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  }

  function applyPanelVariables(panel, cfg) {
    const panelOpacity = getPanelOpacity(cfg);
    const backgroundColor = getPanelBackgroundColor(cfg);
    const overlayOpacity = getOverlayBackgroundOpacity(cfg);
    const overlayBackgroundColor = getOverlayBackgroundColor(cfg);
    panel.style.setProperty("--ptbsi-image-height", `${getImageHeight(cfg)}px`);
    panel.style.setProperty("--ptbsi-panel-opacity", panelOpacity);
    panel.style.setProperty("--ptbsi-font-color", getPanelFontColor(cfg));
    panel.style.setProperty("--ptbsi-panel-bg-color", backgroundColor);
    panel.style.setProperty(
      "--ptbsi-panel-surface-03",
      makeSurfaceColor(backgroundColor, panelOpacity, 0.88)
    );
    panel.style.setProperty(
      "--ptbsi-panel-surface-04",
      makeSurfaceColor(backgroundColor, panelOpacity, 0.92)
    );
    panel.style.setProperty(
      "--ptbsi-panel-surface-05",
      makeSurfaceColor(backgroundColor, panelOpacity, 0.96)
    );
    panel.style.setProperty(
      "--ptbsi-panel-surface-06",
      makeSurfaceColor(backgroundColor, panelOpacity, 1)
    );
    panel.style.setProperty(
      "--ptbsi-panel-border",
      makeSurfaceColor(backgroundColor, panelOpacity, 1.25)
    );
    panel.style.setProperty(
      "--ptbsi-overlay-font-color",
      getOverlayFontColor(cfg)
    );
    panel.style.setProperty(
      "--ptbsi-overlay-font-size",
      getOverlayFontSize(cfg)
    );
    panel.style.setProperty(
      "--ptbsi-overlay-surface",
      makeSurfaceColor(overlayBackgroundColor, overlayOpacity, 1)
    );
    panel.style.setProperty(
      "--ptbsi-overlay-surface-strong",
      makeSurfaceColor(overlayBackgroundColor, overlayOpacity, 1.2)
    );
    panel.style.setProperty(
      "--ptbsi-overlay-border",
      makeSurfaceColor(overlayBackgroundColor, overlayOpacity, 0.55)
    );
  }

  function shouldOpenInNewTab(cfg) {
    return getConfigBoolean(cfg.a_openInNewTab, true);
  }

  function parseTagList(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseLabelText(value) {
    return String(value || "").trim();
  }

  function readConfigValue(cfg, key, legacyKey) {
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, key)) {
      const value = cfg[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return legacyKey ? cfg?.[legacyKey] : undefined;
  }

  function getSlotConfigs(cfg) {
    const slots = [
      {
        key: "slot1",
        tagNames: parseTagList(cfg.b_slot1Tags || ""),
        customLabel: parseLabelText(readConfigValue(cfg, "c_slot1Label", "j_slot1Label")),
      },
      {
        key: "slot2",
        tagNames: parseTagList(readConfigValue(cfg, "d_slot2Tags", "c_slot2Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "e_slot2Label", "k_slot2Label")),
      },
      {
        key: "slot3",
        tagNames: parseTagList(readConfigValue(cfg, "f_slot3Tags", "d_slot3Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "g_slot3Label", "l_slot3Label")),
      },
      {
        key: "slot4",
        tagNames: parseTagList(readConfigValue(cfg, "h_slot4Tags", "e_slot4Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "i_slot4Label", "m_slot4Label")),
      },
      {
        key: "slot5",
        tagNames: parseTagList(readConfigValue(cfg, "j_slot5Tags", "f_slot5Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "k_slot5Label", "n_slot5Label")),
      },
      {
        key: "slot6",
        tagNames: parseTagList(readConfigValue(cfg, "l_slot6Tags", "g_slot6Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "m_slot6Label", "o_slot6Label")),
      },
    ];

    return slots.filter((slot) => slot.tagNames.length > 0);
  }

  async function loadConfig() {
    try {
      const data = await gqlRequest(`
        query PerformerTagBasedSupportingImagesConfig {
          configuration {
            plugins
          }
        }
      `);
      state.config = data?.configuration?.plugins?.[PLUGIN_ID] || {};
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] config load failed", err);
      state.config = {};
    }
    return state.config;
  }

  async function fetchTagMap() {
    const data = await gqlRequest(`
      query PerformerTagBasedSupportingImagesTags {
        allTags {
          id
          name
        }
      }
    `);

    const map = new Map();
    (data?.allTags || []).forEach((tag) => {
      const name = String(tag?.name || "").trim().toLowerCase();
      if (!name || !tag?.id) return;
      map.set(name, String(tag.id));
    });
    return map;
  }

  async function ensureTagMap(options = {}) {
    const { forceRefresh = false } = options;
    if (state.tagMap && !forceRefresh) return state.tagMap;

    const map = await fetchTagMap();
    state.tagMap = map;
    return map;
  }

  async function fetchPerformerName(performerId) {
    const data = await gqlRequest(
      `
        query PerformerSupportingImagesName($id: ID!) {
          findPerformer(id: $id) {
            id
            name
          }
        }
      `,
      { id: performerId }
    );
    return data?.findPerformer || null;
  }

  async function findImagesForSlot(performerId, tagIds, tagMatchMode = "any") {
    if (!tagIds.length) return [];

    const data = await gqlRequest(
      `
        query PerformerSupportingImagesSlot($imageFilter: ImageFilterType, $filter: FindFilterType) {
          findImages(image_filter: $imageFilter, filter: $filter) {
            images {
              id
              title
              files {
                path
                width
                height
              }
              paths {
                image
                preview
                thumbnail
              }
            }
          }
        }
      `,
      {
        imageFilter: {
          performers: {
            value: [String(performerId)],
            modifier: "INCLUDES",
          },
          tags: {
            value: tagIds.map(String),
            modifier: tagMatchMode === "all" ? "INCLUDES_ALL" : "INCLUDES",
          },
        },
        filter: {
          per_page: 40,
        },
      }
    );

    return data?.findImages?.images || [];
  }

  function getImageUrl(image) {
    return (
      image?.paths?.image ||
      image?.paths?.preview ||
      image?.paths?.thumbnail ||
      ""
    );
  }

  function getImagePageHref(imageId) {
    return `/images/${imageId}`;
  }

  function translateFilterJsonForUrl(jsonString) {
    let inString = false;
    let escape = false;
    return [...String(jsonString || "")]
      .map((char) => {
        if (escape) {
          escape = false;
          return char;
        }
        switch (char) {
          case "\\":
            if (inString) escape = true;
            break;
          case '"':
            inString = !inString;
            break;
          case "{":
            if (!inString) return "(";
            break;
          case "}":
            if (!inString) return ")";
            break;
        }
        return char;
      })
      .join("");
  }

  function buildTagFilterCriterion(slot, tagMatchMode = "any") {
    const tagIds = Array.isArray(slot?.tagIds) ? slot.tagIds.filter(Boolean) : [];
    if (!tagIds.length) return null;

    const items = tagIds.map((id, index) => {
      const numericId = Number(id);
      return {
        id: Number.isFinite(numericId) && numericId > 0 ? numericId : String(id),
        label: slot?.tagNames?.[index] || String(id),
      };
    });

    return {
      type: "tags",
      modifier: tagMatchMode === "all" ? "INCLUDES_ALL" : "INCLUDES",
      value: {
        items,
        excluded: [],
        depth: 0,
      },
    };
  }

  function getFilteredPerformerImagesHref(slot, cfg) {
    const performerId = String(slot?.performerId || "").trim();
    if (!performerId) return "";

    const basePath = `/performers/${encodeURIComponent(performerId)}/images`;
    const criterion = buildTagFilterCriterion(slot, getSlotTagMatchMode(cfg));
    if (!criterion) return basePath;

    const searchParams = new URLSearchParams();
    searchParams.append("c", translateFilterJsonForUrl(JSON.stringify(criterion)));
    return `${basePath}?${searchParams.toString()}`;
  }

  function navigateToPath(path) {
    if (!path) return;
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }

  function getImageDimensions(image) {
    const width = Number(image?.files?.[0]?.width) || 0;
    const height = Number(image?.files?.[0]?.height) || 0;
    if (width > 0 && height > 0) {
      return { width, height, ratio: width / height };
    }
    return null;
  }

  function getImageOrientation(image) {
    const dimensions = getImageDimensions(image);
    if (!dimensions) return "unknown";
    if (dimensions.ratio < 0.9) return "portrait";
    if (dimensions.ratio > 1.1) return "landscape";
    return "square";
  }

  function getCropAspectRatio(dimensions, crop) {
    if (!dimensions) return null;
    if (!crop) return dimensions.ratio;
    const width = dimensions.width * crop.width;
    const height = dimensions.height * crop.height;
    if (!(width > 0 && height > 0)) return dimensions.ratio;
    return width / height;
  }

  function getContainedRect(containerRect, width, height) {
    if (!containerRect || !(width > 0) || !(height > 0)) return null;
    const containerWidth = Math.max(0, containerRect.width);
    const containerHeight = Math.max(0, containerRect.height);
    if (!(containerWidth > 0) || !(containerHeight > 0)) return null;

    const imageRatio = width / height;
    const containerRatio = containerWidth / containerHeight;

    let renderWidth = containerWidth;
    let renderHeight = containerHeight;
    let offsetLeft = 0;
    let offsetTop = 0;

    if (imageRatio > containerRatio) {
      renderHeight = containerWidth / imageRatio;
      offsetTop = (containerHeight - renderHeight) / 2;
    } else {
      renderWidth = containerHeight * imageRatio;
      offsetLeft = (containerWidth - renderWidth) / 2;
    }

    return {
      left: containerRect.left + offsetLeft,
      top: containerRect.top + offsetTop,
      width: renderWidth,
      height: renderHeight,
      right: containerRect.left + offsetLeft + renderWidth,
      bottom: containerRect.top + offsetTop + renderHeight,
    };
  }

  function clampPointToRect(clientX, clientY, rect) {
    if (!rect) return null;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }

    return {
      x: Math.max(rect.left, Math.min(rect.right, clientX)),
      y: Math.max(rect.top, Math.min(rect.bottom, clientY)),
    };
  }

  function selectionFromPoints(start, end) {
    if (!start || !end) return null;
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  function selectionToCrop(selectionRect, imageRect) {
    if (!selectionRect || !imageRect) return null;
    return normalizeCropRect({
      x: (selectionRect.left - imageRect.left) / imageRect.width,
      y: (selectionRect.top - imageRect.top) / imageRect.height,
      width: selectionRect.width / imageRect.width,
      height: selectionRect.height / imageRect.height,
    });
  }

  function snapCropToAspectMode(crop, dimensions, mode) {
    const normalized = normalizeCropRect(crop);
    if (!normalized || !dimensions) return normalized;

    const imageWidth = Number(dimensions.width) || 0;
    const imageHeight = Number(dimensions.height) || 0;
    if (!(imageWidth > 0) || !(imageHeight > 0)) return normalized;

    const targetRatio = getAspectRatioForMode(mode);
    if (!(targetRatio > 0)) return normalized;

    const cropWidth = normalized.width * imageWidth;
    const cropHeight = normalized.height * imageHeight;
    if (!(cropWidth > 0) || !(cropHeight > 0)) return normalized;

    const centerX = (normalized.x + normalized.width / 2) * imageWidth;
    const centerY = (normalized.y + normalized.height / 2) * imageHeight;
    const area = cropWidth * cropHeight;

    let snappedWidth = Math.sqrt(area * targetRatio);
    let snappedHeight = snappedWidth / targetRatio;

    const maxWidth = Math.min(centerX * 2, (imageWidth - centerX) * 2);
    const maxHeight = Math.min(centerY * 2, (imageHeight - centerY) * 2);

    if (snappedWidth > maxWidth) {
      snappedWidth = maxWidth;
      snappedHeight = snappedWidth / targetRatio;
    }

    if (snappedHeight > maxHeight) {
      snappedHeight = maxHeight;
      snappedWidth = snappedHeight * targetRatio;
    }

    if (!(snappedWidth > 0) || !(snappedHeight > 0)) return normalized;

    let left = centerX - snappedWidth / 2;
    let top = centerY - snappedHeight / 2;

    left = Math.max(0, Math.min(imageWidth - snappedWidth, left));
    top = Math.max(0, Math.min(imageHeight - snappedHeight, top));

    return normalizeCropRect({
      x: left / imageWidth,
      y: top / imageHeight,
      width: snappedWidth / imageWidth,
      height: snappedHeight / imageHeight,
    });
  }

  function clampSelectionToRect(selectionRect, deltaX, deltaY, imageRect) {
    if (!selectionRect || !imageRect) return null;
    const width = Number(selectionRect.width) || 0;
    const height = Number(selectionRect.height) || 0;
    if (!(width > 0) || !(height > 0)) return null;

    const maxLeft = imageRect.right - width;
    const maxTop = imageRect.bottom - height;
    return {
      left: Math.max(imageRect.left, Math.min(maxLeft, selectionRect.left + deltaX)),
      top: Math.max(imageRect.top, Math.min(maxTop, selectionRect.top + deltaY)),
      width,
      height,
    };
  }

  function getSnappedSelectionState(selectionRect, imageRect, dimensions) {
    const crop = selectionToCrop(selectionRect, imageRect);
    if (!crop || !dimensions) return null;
    const mode = inferSlotAspectModeFromRatio(selectionRect.width / selectionRect.height);
    const snappedCrop = snapCropToAspectMode(crop, dimensions, mode);
    const snappedSelection = cropToSelection(snappedCrop, imageRect);
    if (!snappedSelection) return null;

    return {
      mode,
      crop: snappedCrop,
      selection: snappedSelection,
    };
  }

  function cropToSelection(crop, imageRect) {
    const normalized = normalizeCropRect(crop);
    if (!normalized || !imageRect) return null;
    return {
      left: imageRect.left + normalized.x * imageRect.width,
      top: imageRect.top + normalized.y * imageRect.height,
      width: normalized.width * imageRect.width,
      height: normalized.height * imageRect.height,
    };
  }

  function findSlotAndImage(slotKey, imageId) {
    const slot = state.panelData?.slots?.find((item) => item.key === slotKey);
    if (!slot) return null;
    const image =
      slot.images.find((item) => String(item.id) === String(imageId)) ||
      slot.images[slot.currentIndex] ||
      slot.images[0];
    if (!image) return null;
    return { slot, image };
  }

  function closeCropEditor() {
    if (!state.cropEditor) return;
    try {
      state.cropEditor.cleanup();
    } catch (err) {
      void err;
    }
    state.cropEditor = null;
  }

  function openCropEditor(slot, image) {
    const dimensions = getImageDimensions(image);
    if (!slot || !image || !dimensions) return;

    closeCropEditor();

    const existingCrop = getSavedCrop(slot.key, image.id);
    const backdrop = document.createElement("div");
    backdrop.className = "performer-tag-based-supporting-images__crop-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "performer-tag-based-supporting-images__crop-dialog";

    const header = document.createElement("div");
    header.className = "performer-tag-based-supporting-images__crop-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "performer-tag-based-supporting-images__crop-title-wrap";

    const title = document.createElement("h3");
    title.className = "performer-tag-based-supporting-images__crop-title";
    title.textContent = "Crop Preview";

    const subtitle = document.createElement("div");
    subtitle.className = "performer-tag-based-supporting-images__crop-subtitle";
    subtitle.textContent = slot.tagNames.join(", ") || "Supporting image";

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const hint = document.createElement("div");
    hint.className = "performer-tag-based-supporting-images__crop-hint";
    hint.textContent = "Drag to draw a crop area. Apply saves this preview only.";

    header.appendChild(titleWrap);
    header.appendChild(hint);

    const stage = document.createElement("div");
    stage.className = "performer-tag-based-supporting-images__crop-stage";

    const stageImage = document.createElement("img");
    stageImage.className = "performer-tag-based-supporting-images__crop-stage-image";
    stageImage.src = getImageUrl(image);
    stageImage.alt = image.title || slot.tagNames.join(", ") || "Supporting image";
    stage.appendChild(stageImage);

    const selection = document.createElement("div");
    selection.className = "performer-tag-based-supporting-images__crop-selection";
    selection.hidden = true;

    const selectionLabel = document.createElement("div");
    selectionLabel.className =
      "performer-tag-based-supporting-images__crop-selection-label";
    selection.appendChild(selectionLabel);

    const selectionHandle = document.createElement("button");
    selectionHandle.type = "button";
    selectionHandle.className =
      "performer-tag-based-supporting-images__crop-selection-handle";
    selectionHandle.setAttribute("aria-label", "Move crop");
    selectionHandle.title = "Move crop";
    selectionHandle.textContent = "+";
    selection.appendChild(selectionHandle);

    stage.appendChild(selection);

    const footer = document.createElement("div");
    footer.className = "performer-tag-based-supporting-images__crop-footer";

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className =
      "performer-tag-based-supporting-images__crop-button performer-tag-based-supporting-images__crop-button--ghost";
    resetButton.textContent = "Reset";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className =
      "performer-tag-based-supporting-images__crop-button performer-tag-based-supporting-images__crop-button--ghost";
    cancelButton.textContent = "Cancel";

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className =
      "performer-tag-based-supporting-images__crop-button performer-tag-based-supporting-images__crop-button--primary";
    applyButton.textContent = "Apply";
    applyButton.disabled = !existingCrop;

    footer.appendChild(resetButton);
    footer.appendChild(cancelButton);
    footer.appendChild(applyButton);

    dialog.appendChild(header);
    dialog.appendChild(stage);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let pointerId = null;
    let pointerStart = null;
    let currentSelection = null;
    let pointerMode = "";
    let moveOriginSelection = null;

    function getImageRect() {
      return getContainedRect(
        stage.getBoundingClientRect(),
        dimensions.width,
        dimensions.height
      );
    }

    function renderSelection() {
      const stageRect = stage.getBoundingClientRect();
      if (
        !currentSelection ||
        currentSelection.width < 2 ||
        currentSelection.height < 2
      ) {
        selection.hidden = true;
        applyButton.disabled = !existingCrop;
        return;
      }

      selection.hidden = false;
      selection.style.left = `${currentSelection.left - stageRect.left}px`;
      selection.style.top = `${currentSelection.top - stageRect.top}px`;
      selection.style.width = `${currentSelection.width}px`;
      selection.style.height = `${currentSelection.height}px`;
      const liveRatio = currentSelection.width / currentSelection.height;
      const liveMode = inferSlotAspectModeFromRatio(liveRatio);
      selectionLabel.textContent = getSlotAspectDisplayName(liveMode);
      applyButton.disabled = false;
    }

    function syncExistingSelection() {
      const imageRect = getImageRect();
      currentSelection = cropToSelection(existingCrop, imageRect);
      renderSelection();
    }

    function handlePointerDown(event) {
      if (event.button !== 0) return;
      const isMoveHandle =
        event.target instanceof Element &&
        event.target.closest(
          ".performer-tag-based-supporting-images__crop-selection-handle"
        );
      if (isMoveHandle && currentSelection) {
        pointerId = event.pointerId;
        pointerMode = "move";
        pointerStart = { x: event.clientX, y: event.clientY };
        moveOriginSelection = { ...currentSelection };
        stage.setPointerCapture(pointerId);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const imageRect = getImageRect();
      const point = clampPointToRect(event.clientX, event.clientY, imageRect);
      if (!point) return;
      pointerId = event.pointerId;
      pointerMode = "draw";
      pointerStart = point;
      moveOriginSelection = null;
      currentSelection = {
        left: point.x,
        top: point.y,
        width: 0,
        height: 0,
      };
      stage.setPointerCapture(pointerId);
      renderSelection();
      event.preventDefault();
    }

    function handlePointerMove(event) {
      if (pointerId !== event.pointerId || !pointerStart) return;
      if (pointerMode === "move" && moveOriginSelection) {
        const imageRect = getImageRect();
        currentSelection = clampSelectionToRect(
          moveOriginSelection,
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
          imageRect
        );
        renderSelection();
        return;
      }

      const imageRect = getImageRect();
      const point = clampPointToRect(event.clientX, event.clientY, imageRect);
      if (!point) return;
      currentSelection = selectionFromPoints(pointerStart, point);
      renderSelection();
    }

    function handlePointerUp(event) {
      if (pointerId !== event.pointerId) return;
      const finishedMode = pointerMode;
      pointerId = null;
      pointerStart = null;
      pointerMode = "";
      moveOriginSelection = null;
      try {
        stage.releasePointerCapture(event.pointerId);
      } catch (err) {
        void err;
      }
      const imageRect = getImageRect();
      if (finishedMode === "draw") {
        const snappedState = getSnappedSelectionState(
          currentSelection,
          imageRect,
          dimensions
        );
        if (snappedState) {
          currentSelection = snappedState.selection;
        } else {
          currentSelection = cropToSelection(existingCrop, imageRect);
        }
      } else if (!selectionToCrop(currentSelection, imageRect)) {
        currentSelection = cropToSelection(existingCrop, imageRect);
      }
      renderSelection();
    }

    function handleApply() {
      const crop = selectionToCrop(currentSelection, getImageRect());
      if (!crop) return;
      const dimensions = getImageDimensions(image);
      const mode = dimensions
        ? inferSlotAspectModeFromRatio(getCropAspectRatio(dimensions, crop))
        : "square";
      const snappedCrop = dimensions
        ? snapCropToAspectMode(crop, dimensions, mode)
        : crop;
      setSavedCrop(slot.key, image.id, snappedCrop);
      if (dimensions) {
        updateStoredSlotAspectMode(slot.key, mode);
      }
      closeCropEditor();
      rerenderPanel();
    }

    function handleReset() {
      setSavedCrop(slot.key, image.id, null);
      closeCropEditor();
      rerenderPanel();
    }

    function handleCancel() {
      closeCropEditor();
    }

    function handleBackdropClick(event) {
      if (event.target === backdrop) {
        closeCropEditor();
      }
    }

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCropEditor();
      } else if (event.key === "Enter" && !applyButton.disabled) {
        event.preventDefault();
        handleApply();
      }
    }

    function handleResize() {
      syncExistingSelection();
    }

    stage.addEventListener("pointerdown", handlePointerDown);
    stage.addEventListener("pointermove", handlePointerMove);
    stage.addEventListener("pointerup", handlePointerUp);
    stage.addEventListener("pointercancel", handlePointerUp);
    resetButton.addEventListener("click", handleReset);
    cancelButton.addEventListener("click", handleCancel);
    applyButton.addEventListener("click", handleApply);
    backdrop.addEventListener("click", handleBackdropClick);
    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", handleResize);

    window.requestAnimationFrame(() => {
      syncExistingSelection();
    });

    state.cropEditor = {
      cleanup() {
        stage.removeEventListener("pointerdown", handlePointerDown);
        stage.removeEventListener("pointermove", handlePointerMove);
        stage.removeEventListener("pointerup", handlePointerUp);
        stage.removeEventListener("pointercancel", handlePointerUp);
        resetButton.removeEventListener("click", handleReset);
        cancelButton.removeEventListener("click", handleCancel);
        applyButton.removeEventListener("click", handleApply);
        backdrop.removeEventListener("click", handleBackdropClick);
        window.removeEventListener("keydown", handleKeydown, true);
        window.removeEventListener("resize", handleResize);
        backdrop.remove();
      },
    };
  }

  function normalizeSlotIndex(slotKey, total, selectionMode) {
    if (total <= 0) return 0;

    if (!state.slotIndices.has(slotKey)) {
      state.slotIndices.set(
        slotKey,
        selectionMode === "random" ? Math.floor(Math.random() * total) : 0
      );
    }

    const current = Number(state.slotIndices.get(slotKey)) || 0;
    const normalized = ((current % total) + total) % total;
    state.slotIndices.set(slotKey, normalized);
    return normalized;
  }

  async function buildPanelData(performer, cfg) {
    let tagMap = await ensureTagMap();
    const performerInfo = await fetchPerformerName(performer.id);
    const selectionMode = getSelectionMode(cfg);
    const tagMatchMode = getSlotTagMatchMode(cfg);
    const slots = getSlotConfigs(cfg);
    const configuredTagNames = slots.flatMap((slot) => slot.tagNames);

    const hasMissingConfiguredTags = configuredTagNames.some(
      (name) => !tagMap.has(name.toLowerCase())
    );

    if (hasMissingConfiguredTags) {
      tagMap = await ensureTagMap({ forceRefresh: true });
    }

    const slotResults = await Promise.all(
      slots.map(async (slot) => {
        try {
          const tagIds = slot.tagNames
            .map((name) => tagMap.get(name.toLowerCase()))
            .filter(Boolean);

          const missingTags = slot.tagNames.filter(
            (name) => !tagMap.has(name.toLowerCase())
          );

          const images =
            tagIds.length === slot.tagNames.length
              ? await findImagesForSlot(performer.id, tagIds, tagMatchMode)
              : [];

          const currentIndex = normalizeSlotIndex(
            slot.key,
            images.length,
            selectionMode
          );
          const currentImage = images[currentIndex] || images[0] || null;
          const savedAspectMode = state.slotAspectStore?.[slot.key];
          const aspectMode = savedAspectMode
            ? normalizeSlotAspectMode(savedAspectMode)
            : inferSlotAspectMode(slot.key, currentImage);

          return {
            ...slot,
            performerId: performer.id,
            tagIds,
            missingTags,
            images,
            currentIndex,
            aspectMode,
            error: "",
          };
        } catch (err) {
          console.error(
            `[PerformerTagBasedSupportingImages] slot load failed for ${slot.key}`,
            err
          );
          return {
            ...slot,
            performerId: performer.id,
            tagIds: [],
            missingTags: [],
            images: [],
            currentIndex: 0,
            aspectMode: getSavedSlotAspectMode(slot.key),
            error: err?.message || "Failed to load slot images.",
          };
        }
      })
    );

    return {
      performer: performerInfo || performer,
      slots: slotResults.filter((slot) => slot.images.length > 0),
    };
  }

  function isPluginNode(node) {
    if (!(node instanceof Element)) return false;
    return (
      node.id === PANEL_ID ||
      node.id === HOST_ID ||
      node.closest(`#${PANEL_ID}`) !== null ||
      node.closest(`#${HOST_ID}`) !== null ||
      Array.from(node.classList || []).some((className) =>
        className.startsWith("performer-tag-based-supporting-images__")
      )
    );
  }

  function shouldIgnoreMutations(mutations) {
    return mutations.every((mutation) => {
      if (isPluginNode(mutation.target)) return true;

      const changedNodes = [
        ...Array.from(mutation.addedNodes || []),
        ...Array.from(mutation.removedNodes || []),
      ];

      return changedNodes.length > 0 && changedNodes.every(isPluginNode);
    });
  }

  function cleanupPanel(options = {}) {
    const { preserveHost = false } = options;
    closeCropEditor();
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const host = document.getElementById(HOST_ID);
    if (!preserveHost) {
      host?.remove();
    }

    clearOverlayOffsets();
    state.contentBoundary = null;
    updateContentHoverBinding();
  }

  function createEmptyState(message) {
    const empty = document.createElement("div");
    empty.className = "performer-tag-based-supporting-images__empty";
    empty.textContent = message;
    return empty;
  }

  function createSlotInfo(slot, cfg, infoPosition) {
    const tagText = slot.customLabel || (slot.tagNames.length
      ? slot.tagNames.join(", ")
      : "No tags configured");
    const tooltipText = slot.tagNames.length
      ? slot.tagNames.join(", ")
      : "No tags configured";

    const info = document.createElement("div");
    info.className = "performer-tag-based-supporting-images__slot-info";
    info.classList.add(
      `performer-tag-based-supporting-images__slot-info--${infoPosition}`
    );

    const href = getFilteredPerformerImagesHref(slot, cfg);
    const label = document.createElement(href ? "a" : "div");
    label.className =
      "performer-tag-based-supporting-images__slot-label performer-tag-based-supporting-images__slot-label--text";
    if (href) {
      label.classList.add(
        "performer-tag-based-supporting-images__slot-label--link"
      );
      label.setAttribute("href", href);
      label.setAttribute("data-ptbsi-tag-filter-href", href);
      label.title = `Open performer images filtered by ${tooltipText}`;
    }
    label.textContent = tagText;
    info.appendChild(label);

    if (slot.tagNames.length) {
      const tooltip = document.createElement("div");
      tooltip.className = "performer-tag-based-supporting-images__tooltip";

      const tooltipTags = document.createElement("div");
      tooltipTags.className =
        "performer-tag-based-supporting-images__tooltip-tags";
      tooltipTags.textContent = tooltipText;

      tooltip.appendChild(tooltipTags);
      info.appendChild(tooltip);
    }

    return info;
  }

  function createCropAction(slot, image) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "performer-tag-based-supporting-images__crop-action";
    button.setAttribute("data-ptbsi-crop", "open");
    button.setAttribute("data-ptbsi-slot-key", slot.key);
    button.setAttribute("data-ptbsi-image-id", String(image.id));
    button.setAttribute("aria-label", "Crop slot preview");
    button.textContent = "▣";

    if (getSavedCrop(slot.key, image.id)) {
      button.classList.add("is-active");
      button.title = "Edit saved crop";
    } else {
      button.title = "Crop preview";
    }

    return button;
  }

  function createAspectAction(slot) {
    const mode = normalizeSlotAspectMode(slot.aspectMode);
    const label = document.createElement("div");
    label.className = "performer-tag-based-supporting-images__aspect-action";
    label.setAttribute("data-ptbsi-aspect-mode", mode);
    label.setAttribute("aria-label", getSlotAspectTitle(mode));
    label.title = getSlotAspectTitle(mode);
    label.textContent = getSlotAspectLabel(mode);
    return label;
  }

  function applyCropPreview(img, crop) {
    const normalized = normalizeCropRect(crop);
    if (!normalized) return;
    img.classList.add("performer-tag-based-supporting-images__image--cropped");
    img.style.left = `${(-normalized.x / normalized.width) * 100}%`;
    img.style.top = `${(-normalized.y / normalized.height) * 100}%`;
    img.style.width = `${100 / normalized.width}%`;
    img.style.height = `${100 / normalized.height}%`;
  }

  function getContainedCropViewportSize(cropAspectRatio, frameAspectRatio) {
    const cropAspect = Number(cropAspectRatio);
    const frameAspect = Number(frameAspectRatio);
    if (!(cropAspect > 0) || !(frameAspect > 0)) {
      return { width: "100%", height: "100%" };
    }

    if (cropAspect >= frameAspect) {
      return {
        width: "100%",
        height: `${Math.max(0, Math.min(100, (frameAspect / cropAspect) * 100))}%`,
      };
    }

    return {
      width: `${Math.max(0, Math.min(100, (cropAspect / frameAspect) * 100))}%`,
      height: "100%",
    };
  }

  function createSlotElement(slot, cfg, options = {}) {
    const { fixedFrame = false } = options;
    const slotEl = document.createElement("section");
    slotEl.className = "performer-tag-based-supporting-images__slot";
    slotEl.setAttribute("data-ptbsi-slot-key", slot.key);
    const aspectMode = normalizeSlotAspectMode(slot.aspectMode);
    const infoPosition = getSlotInfoPosition(cfg);
    slotEl.setAttribute("data-ptbsi-aspect-mode", aspectMode);
    slotEl.classList.add(
      `performer-tag-based-supporting-images__slot--meta-${infoPosition}`
    );
    if (fixedFrame) {
      slotEl.classList.add("performer-tag-based-supporting-images__slot--reel");
    }

    if (!slot.tagNames.length) {
      slotEl.appendChild(createSlotInfo(slot, cfg, getSlotInfoPosition(cfg)));
      slotEl.appendChild(createEmptyState("Add one or more tags to this slot."));
      return slotEl;
    }

    if (slot.missingTags.length) {
      slotEl.appendChild(createSlotInfo(slot, cfg, getSlotInfoPosition(cfg)));
      slotEl.appendChild(
        createEmptyState(`Missing tag(s): ${slot.missingTags.join(", ")}`)
      );
      return slotEl;
    }

    if (slot.error) {
      slotEl.appendChild(createSlotInfo(slot, cfg, getSlotInfoPosition(cfg)));
      slotEl.appendChild(createEmptyState(`Slot error: ${slot.error}`));
      return slotEl;
    }

    if (!slot.images.length) {
      slotEl.appendChild(createSlotInfo(slot, cfg, getSlotInfoPosition(cfg)));
      slotEl.appendChild(
        createEmptyState(
          "No matching image found for this performer and tag combination."
        )
      );
      return slotEl;
    }

    const controls = document.createElement("div");
    controls.className = "performer-tag-based-supporting-images__slot-controls";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "performer-tag-based-supporting-images__nav";
    prev.setAttribute("data-ptbsi-nav", "prev");
    prev.setAttribute("data-ptbsi-slot-key", slot.key);
    prev.setAttribute("aria-label", "Previous image");
    prev.textContent = "<";

    const counter = document.createElement("span");
    counter.className = "performer-tag-based-supporting-images__counter";
    counter.textContent = `${slot.currentIndex + 1}/${slot.images.length}`;

    const next = document.createElement("button");
    next.type = "button";
    next.className = "performer-tag-based-supporting-images__nav";
    next.setAttribute("data-ptbsi-nav", "next");
    next.setAttribute("data-ptbsi-slot-key", slot.key);
    next.setAttribute("aria-label", "Next image");
    next.textContent = ">";

    const canNavigate = slot.images.length > 1;
    prev.disabled = !canNavigate;
    next.disabled = !canNavigate;

    const image = slot.images[slot.currentIndex] || slot.images[0];
    const crop = getSavedCrop(slot.key, image.id);
    const imageLink = document.createElement("a");
    imageLink.className = "performer-tag-based-supporting-images__image-link";
    imageLink.classList.add("performer-tag-based-supporting-images__image-link--ratio");
    imageLink.style.aspectRatio = String(getAspectRatioForMode(aspectMode));
    imageLink.href = getImagePageHref(image.id);
    const dimensions = getImageDimensions(image);
    const orientation = getImageOrientation(image);
    imageLink.setAttribute("data-orientation", orientation);
    if (shouldOpenInNewTab(cfg)) {
      imageLink.target = "_blank";
      imageLink.rel = "noopener";
    }

    const imageFrame = document.createElement("div");
    imageFrame.className = "performer-tag-based-supporting-images__image-frame";
    if (crop) {
      imageFrame.classList.add(
        "performer-tag-based-supporting-images__image-frame--cropped"
      );
    }

    const img = document.createElement("img");
    img.className = "performer-tag-based-supporting-images__image";
    img.src = getImageUrl(image);
    img.alt = image.title || slot.tagNames.join(", ") || "Supporting image";
    img.setAttribute("data-orientation", orientation);
    if (crop) {
      const cropViewport = document.createElement("div");
      cropViewport.className =
        "performer-tag-based-supporting-images__image-crop-viewport";
      const cropAspectRatio = getCropAspectRatio(dimensions, crop);
      const viewportSize = getContainedCropViewportSize(
        cropAspectRatio,
        getAspectRatioForMode(aspectMode)
      );
      cropViewport.style.width = viewportSize.width;
      cropViewport.style.height = viewportSize.height;
      applyCropPreview(img, crop);
      cropViewport.appendChild(img);
      imageFrame.appendChild(cropViewport);
    } else {
      imageFrame.appendChild(img);
    }
    imageLink.appendChild(imageFrame);

    prev.classList.add("performer-tag-based-supporting-images__slot-controls-prev");
    next.classList.add("performer-tag-based-supporting-images__slot-controls-next");
    counter.classList.add(
      "performer-tag-based-supporting-images__slot-controls-count"
    );

    const aspectLabel = createAspectAction(slot);
    aspectLabel.classList.add(
      "performer-tag-based-supporting-images__slot-controls-aspect"
    );

    if (infoPosition === "bottom-center") {
      controls.classList.add(
        "performer-tag-based-supporting-images__slot-controls--with-tag"
      );

      const leftGroup = document.createElement("div");
      leftGroup.className =
        "performer-tag-based-supporting-images__slot-controls-group performer-tag-based-supporting-images__slot-controls-group--left";

      const centerGroup = document.createElement("div");
      centerGroup.className =
        "performer-tag-based-supporting-images__slot-controls-group performer-tag-based-supporting-images__slot-controls-group--center";

      const rightGroup = document.createElement("div");
      rightGroup.className =
        "performer-tag-based-supporting-images__slot-controls-group performer-tag-based-supporting-images__slot-controls-group--right";

      leftGroup.appendChild(prev);
      leftGroup.appendChild(next);
      if (dimensions) {
        const cropAction = createCropAction(slot, image);
        cropAction.classList.add(
          "performer-tag-based-supporting-images__slot-controls-crop"
        );
        leftGroup.appendChild(cropAction);
      }

      const footerInfo = createSlotInfo(slot, cfg, infoPosition);
      footerInfo.classList.add(
        "performer-tag-based-supporting-images__slot-controls-tag"
      );
      centerGroup.appendChild(footerInfo);

      rightGroup.appendChild(aspectLabel);
      rightGroup.appendChild(counter);

      controls.appendChild(leftGroup);
      controls.appendChild(centerGroup);
      controls.appendChild(rightGroup);
    } else {
      const spacer = document.createElement("div");
      spacer.className = "performer-tag-based-supporting-images__slot-controls-spacer";

      controls.appendChild(prev);
      controls.appendChild(next);
      if (dimensions) {
        const cropAction = createCropAction(slot, image);
        cropAction.classList.add(
          "performer-tag-based-supporting-images__slot-controls-crop"
        );
        controls.appendChild(cropAction);
      }
      controls.appendChild(spacer);
      controls.appendChild(aspectLabel);
      controls.appendChild(counter);
    }

    const infoRow = document.createElement("div");
    infoRow.className = "performer-tag-based-supporting-images__slot-meta";
    infoRow.classList.add(
      `performer-tag-based-supporting-images__slot-meta--${infoPosition}`
    );
    infoRow.appendChild(createSlotInfo(slot, cfg, infoPosition));

    if (infoPosition === "top-center") {
      slotEl.appendChild(infoRow);
      slotEl.appendChild(imageLink);
    } else {
      slotEl.appendChild(imageLink);
    }
    slotEl.appendChild(controls);
    return slotEl;
  }

  function renderPanel() {
    const cfg = state.config || {};
    const data = state.panelData;
    if (!data || !data.slots.length) return null;

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "performer-tag-based-supporting-images";
    applyPanelVariables(panel, cfg);
    const slotsWrap = document.createElement("div");
    slotsWrap.className = "performer-tag-based-supporting-images__slots";

    const loopSlots = shouldEnableLoopingSlots(data.slots, cfg);
    if (loopSlots) {
      slotsWrap.classList.add("performer-tag-based-supporting-images__slots--loop");
      slotsWrap.setAttribute(
        "data-ptbsi-loop-segment-size",
        String(data.slots.length)
      );
    }

    const renderSource = loopSlots
      ? Array.from({ length: LOOP_REPEAT_COUNT }, (_, repeatIndex) =>
          data.slots.map((slot) => ({
            slot,
            repeatIndex,
            isLoopClone: repeatIndex !== 1,
          }))
        ).flat()
      : data.slots.map((slot) => ({
          slot,
          repeatIndex: 0,
          isLoopClone: false,
        }));

    renderSource.forEach(({ slot, repeatIndex, isLoopClone }) => {
      try {
        const slotEl = createSlotElement(slot, cfg, { fixedFrame: loopSlots });
        slotEl.setAttribute("data-ptbsi-loop-repeat", String(repeatIndex));
        if (isLoopClone) {
          slotEl.setAttribute("data-ptbsi-loop-clone", "true");
        }
        slotsWrap.appendChild(slotEl);
      } catch (err) {
        console.error(
          `[PerformerTagBasedSupportingImages] slot render failed for ${slot.key}`,
          err
        );
        slotsWrap.appendChild(
          createEmptyState(`Failed to render slot "${slot.key}".`)
        );
      }
    });

    panel.appendChild(slotsWrap);
    attachPanelEvents(panel);
    return panel;
  }

  function getViewportAnchorSlot(slotsWrap, preferredSlot) {
    if (!slotsWrap) return null;
    const preferredSlotElement =
      preferredSlot instanceof Element
        ? preferredSlot.closest(
            ".performer-tag-based-supporting-images__slot[data-ptbsi-slot-key]"
          )
        : null;
    if (preferredSlotElement && slotsWrap.contains(preferredSlotElement)) {
      return preferredSlotElement;
    }

    const wrapRect = slotsWrap.getBoundingClientRect();
    const slots = Array.from(
      slotsWrap.querySelectorAll(
        ".performer-tag-based-supporting-images__slot[data-ptbsi-slot-key]"
      )
    ).filter((element) => element instanceof Element);

    return (
      slots.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > wrapRect.top + 8 && rect.top < wrapRect.bottom - 8;
      }) || slots[0] || null
    );
  }

  function capturePanelViewportState(panel, preferredSlot) {
    const slotsWrap = panel?.querySelector(
      ".performer-tag-based-supporting-images__slots"
    );
    if (!slotsWrap) return null;

    const anchorSlot = getViewportAnchorSlot(slotsWrap, preferredSlot);
    const wrapRect = slotsWrap.getBoundingClientRect();
    const slotRect = anchorSlot?.getBoundingClientRect();

    return {
      scrollTop: Number.isFinite(slotsWrap.scrollTop) ? slotsWrap.scrollTop : 0,
      slotKey: anchorSlot?.getAttribute("data-ptbsi-slot-key") || "",
      loopRepeat: anchorSlot?.getAttribute("data-ptbsi-loop-repeat") || "",
      offsetTop:
        slotRect && wrapRect
          ? Math.round(slotRect.top - wrapRect.top)
          : null,
    };
  }

  function findMatchingViewportSlot(slotsWrap, viewportState) {
    if (!slotsWrap || !viewportState?.slotKey) return null;
    const matches = Array.from(
      slotsWrap.querySelectorAll(
        ".performer-tag-based-supporting-images__slot[data-ptbsi-slot-key]"
      )
    ).filter(
      (element) =>
        element.getAttribute("data-ptbsi-slot-key") === viewportState.slotKey
    );
    if (!matches.length) return null;

    return (
      matches.find(
        (element) =>
          element.getAttribute("data-ptbsi-loop-repeat") === viewportState.loopRepeat
      ) || matches[0]
    );
  }

  function restorePanelViewportState(panel, viewportState) {
    const slotsWrap = panel?.querySelector(
      ".performer-tag-based-supporting-images__slots"
    );
    if (!slotsWrap || !viewportState) return;

    if (Number.isFinite(viewportState.scrollTop)) {
      slotsWrap.scrollTop = viewportState.scrollTop;
    }

    const anchorSlot = findMatchingViewportSlot(slotsWrap, viewportState);
    if (!anchorSlot || !Number.isFinite(viewportState.offsetTop)) return;

    const wrapRect = slotsWrap.getBoundingClientRect();
    const slotRect = anchorSlot.getBoundingClientRect();
    const delta = Math.round(slotRect.top - wrapRect.top - viewportState.offsetTop);
    if (delta !== 0) {
      slotsWrap.scrollTop += delta;
    }
  }

  function captureButtonAnchorState(panel, anchorElement) {
    const slotsWrap = panel?.querySelector(
      ".performer-tag-based-supporting-images__slots"
    );
    if (
      !slotsWrap ||
      !(anchorElement instanceof Element) ||
      !slotsWrap.contains(anchorElement)
    ) {
      return null;
    }

    const slotElement = anchorElement.closest("[data-ptbsi-slot-key]");
    if (!slotElement) return null;

    const wrapRect = slotsWrap.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();
    return {
      slotKey: slotElement.getAttribute("data-ptbsi-slot-key") || "",
      loopRepeat: slotElement.getAttribute("data-ptbsi-loop-repeat") || "",
      navType: anchorElement.getAttribute("data-ptbsi-nav") || "",
      offsetTop: Math.round(anchorRect.top - wrapRect.top),
    };
  }

  function restoreButtonAnchorState(panel, anchorState) {
    const slotsWrap = panel?.querySelector(
      ".performer-tag-based-supporting-images__slots"
    );
    if (
      !slotsWrap ||
      !anchorState?.slotKey ||
      !anchorState?.navType ||
      !Number.isFinite(anchorState.offsetTop)
    ) {
      return;
    }

    const slotElement = Array.from(
      slotsWrap.querySelectorAll(
        ".performer-tag-based-supporting-images__slot[data-ptbsi-slot-key]"
      )
    ).find(
      (element) =>
        element.getAttribute("data-ptbsi-slot-key") === anchorState.slotKey &&
        element.getAttribute("data-ptbsi-loop-repeat") === anchorState.loopRepeat
    );
    if (!slotElement) return;

    const nextAnchor = slotElement.querySelector(
      `[data-ptbsi-nav="${anchorState.navType}"]`
    );
    if (!(nextAnchor instanceof Element)) return;

    const wrapRect = slotsWrap.getBoundingClientRect();
    const anchorRect = nextAnchor.getBoundingClientRect();
    const delta = Math.round(anchorRect.top - wrapRect.top - anchorState.offsetTop);
    if (delta !== 0) {
      slotsWrap.scrollTop += delta;
    }
  }

  function rerenderPanel(options = {}) {
    const { anchorElement = null } = options;
    const existing = document.getElementById(PANEL_ID);
    const viewportState = capturePanelViewportState(existing, anchorElement);
    const nextPanel = renderPanel();
    if (!nextPanel) return;
    if (existing) existing.replaceWith(nextPanel);
    setupLoopingSlots(nextPanel, { viewportState });
    restorePanelViewportState(nextPanel, viewportState);
    updateFloatingPanelLayout();
  }

  function rerenderSlot(slotKey, options = {}) {
    const { anchorElement = null } = options;
    const panel = document.getElementById(PANEL_ID);
    const slot = state.panelData?.slots?.find((item) => item.key === slotKey);
    if (!panel || !slot) {
      rerenderPanel(options);
      return;
    }

    const slotsWrap = panel.querySelector(
      ".performer-tag-based-supporting-images__slots"
    );
    const buttonAnchorState = captureButtonAnchorState(panel, anchorElement);
    const preservedScrollTop =
      slotsWrap && Number.isFinite(slotsWrap.scrollTop) ? slotsWrap.scrollTop : null;
    const cfg = state.config || {};
    const slotElements = Array.from(
      panel.querySelectorAll(
        ".performer-tag-based-supporting-images__slot[data-ptbsi-slot-key]"
      )
    ).filter((element) => element.getAttribute("data-ptbsi-slot-key") === slotKey);

    if (!slotElements.length) {
      rerenderPanel(options);
      return;
    }

    slotElements.forEach((element) => {
      const nextSlot = createSlotElement(slot, cfg, {
        fixedFrame: shouldEnableLoopingSlots(state.panelData?.slots || [], cfg),
      });
      const repeatIndex = element.getAttribute("data-ptbsi-loop-repeat");
      const isLoopClone = element.getAttribute("data-ptbsi-loop-clone");
      if (repeatIndex !== null) {
        nextSlot.setAttribute("data-ptbsi-loop-repeat", repeatIndex);
      }
      if (isLoopClone !== null) {
        nextSlot.setAttribute("data-ptbsi-loop-clone", isLoopClone);
      }
      element.replaceWith(nextSlot);
    });

    if (slotsWrap && Number.isFinite(preservedScrollTop)) {
      slotsWrap.scrollTop = preservedScrollTop;
      window.requestAnimationFrame(() => {
        slotsWrap.scrollTop = preservedScrollTop;
        restoreButtonAnchorState(panel, buttonAnchorState);
      });
    }
    updateFloatingPanelLayout();
  }

  function setupLoopingSlots(panel, options = {}) {
    const { viewportState = null } = options;
    const slotsWrap = panel?.querySelector(
      ".performer-tag-based-supporting-images__slots--loop"
    );
    if (!slotsWrap) return;

    updateLoopReelSizing(panel);
    const segmentSize = Number(
      slotsWrap.getAttribute("data-ptbsi-loop-segment-size")
    );
    if (!Number.isFinite(segmentSize) || segmentSize <= 1) return;

    const setInitialLoopPosition = () => {
      const segmentHeight = Math.round(slotsWrap.scrollHeight / LOOP_REPEAT_COUNT);
      if (!segmentHeight) return;
      if (Number.isFinite(viewportState?.scrollTop) && viewportState.scrollTop >= 0) {
        slotsWrap.scrollTop = viewportState.scrollTop;
      } else {
        slotsWrap.scrollTop = segmentHeight;
      }
      restorePanelViewportState(panel, viewportState);
    };

    window.requestAnimationFrame(() => {
      setInitialLoopPosition();
    });

    slotsWrap.addEventListener("scroll", () => {
      const segmentHeight = Math.round(slotsWrap.scrollHeight / LOOP_REPEAT_COUNT);
      if (!segmentHeight) return;

      if (slotsWrap.scrollTop <= segmentHeight * 0.25) {
        slotsWrap.scrollTop += segmentHeight;
      } else if (slotsWrap.scrollTop >= segmentHeight * 1.75) {
        slotsWrap.scrollTop -= segmentHeight;
      }
    });
  }

  function attachPanelEvents(panel) {
    panel.addEventListener("click", (event) => {
      const tagLink = event.target.closest("[data-ptbsi-tag-filter-href]");
      if (tagLink) {
        const href = tagLink.getAttribute("data-ptbsi-tag-filter-href");
        if (
          href &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigateToPath(href);
        }
        return;
      }

      const cropAction = event.target.closest("[data-ptbsi-crop]");
      if (cropAction) {
        event.preventDefault();
        event.stopPropagation();
        const slotKey = cropAction.getAttribute("data-ptbsi-slot-key");
        const imageId = cropAction.getAttribute("data-ptbsi-image-id");
        const target = findSlotAndImage(slotKey, imageId);
        if (target) {
          openCropEditor(target.slot, target.image);
        }
        return;
      }

      const nav = event.target.closest("[data-ptbsi-nav]");
      if (!nav) return;
      event.preventDefault();
      const slotKey = nav.getAttribute("data-ptbsi-slot-key");
      const direction = nav.getAttribute("data-ptbsi-nav");
      const slot = state.panelData?.slots?.find((item) => item.key === slotKey);
      if (!slot || slot.images.length <= 1) return;

      const delta = direction === "prev" ? -1 : 1;
      const nextIndex =
        ((slot.currentIndex + delta) % slot.images.length + slot.images.length) %
        slot.images.length;

      slot.currentIndex = nextIndex;
      state.slotIndices.set(slotKey, nextIndex);
      rerenderSlot(slotKey, {
        anchorElement: nav.closest("[data-ptbsi-slot-key]"),
      });
    });
  }

  function scheduleRouteInjection() {
    state.scheduledRouteToken += 1;
    const token = state.scheduledRouteToken;
    ROUTE_RETRY_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        if (token !== state.scheduledRouteToken) return;
        injectPanel();
      }, delay);
    });
  }

  function installNavigationHooks() {
    if (window.__ptbsiHistoryWrapped) return;
    window.__ptbsiHistoryWrapped = true;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      const result = originalPushState.apply(this, arguments);
      window.dispatchEvent(new Event("ptbsi:navigation"));
      return result;
    };

    history.replaceState = function () {
      const result = originalReplaceState.apply(this, arguments);
      window.dispatchEvent(new Event("ptbsi:navigation"));
      return result;
    };

    window.addEventListener("popstate", () =>
      window.dispatchEvent(new Event("ptbsi:navigation"))
    );
    window.addEventListener("ptbsi:navigation", handleRouteChange);
  }

  function installObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver((mutations) => {
      if (shouldIgnoreMutations(mutations)) return;
      if (state.observerTimer) window.clearTimeout(state.observerTimer);
      state.observerTimer = window.setTimeout(() => {
        updateFloatingPanelLayout();
      }, 120);
    });
  }

  function installResizeObserver() {
    if (state.resizeObserver || typeof ResizeObserver !== "function") return;
    state.resizeObserver = new ResizeObserver(() => {
      if (state.observerTimer) window.clearTimeout(state.observerTimer);
      state.observerTimer = window.setTimeout(() => {
        updateFloatingPanelLayout();
      }, 80);
    });
  }

  function refreshObservedElements() {
    if (!state.observer) return;

    state.observer.disconnect();
    if (state.resizeObserver) {
      state.observedElements.forEach((element) => {
        try {
          state.resizeObserver.unobserve(element);
        } catch (err) {
          void err;
        }
      });
    }
    state.observedElements.clear();

    const elements = [
      getDetailHeader(),
      getDetailContainer(),
      getContentBoundaryElement(),
    ].filter(Boolean);

    elements.forEach((element) => {
      if (state.observedElements.has(element)) return;
      state.observedElements.add(element);
      if (state.resizeObserver) {
        state.resizeObserver.observe(element);
      }
      state.observer.observe(element, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-expanded"],
      });
    });
  }

  function installDetailInteractionHook() {
    if (window.__ptbsiDetailInteractionHookInstalled) return;
    window.__ptbsiDetailInteractionHookInstalled = true;

    document.addEventListener(
      "click",
      (event) => {
        if (!isPerformerPage()) return;
        const target = event.target;
        if (!(target instanceof Element)) return;

        const withinDetail =
          target.closest(".detail-header") ||
          target.closest(".detail-container");
        if (!withinDetail) return;

        scheduleLayoutRefresh();
      },
      true
    );
  }

  function installLayoutHandlers() {
    if (state.layoutHandlersInstalled) return;
    state.layoutHandlersInstalled = true;
    window.addEventListener("scroll", updateFloatingPanelLayout, { passive: true });
    window.addEventListener("resize", updateFloatingPanelLayout);
    window.addEventListener(LAYOUT_CHANGED_EVENT, () => {
      if (!isPerformerPage()) return;
      refreshObservedElements();
      if (state.panelData) {
        const existing = document.getElementById(PANEL_ID);
        if (existing) existing.remove();
        const host = ensureLayoutHost();
        const panel = renderPanel();
        if (host && panel) {
          host.appendChild(panel);
          setupLoopingSlots(panel);
        }
      }
      scheduleLayoutRefresh([0, 80, 180, 320, 500]);
    });
  }

  async function injectPanel() {
    if (state.isInjecting) return;

    const performer = getPerformerFromPath(window.location.pathname);
    if (!performer) {
      state.scheduledLayoutToken += 1;
      cleanupPanel();
      state.currentPerformer = null;
      state.panelData = null;
      state.panelKey = null;
      state.slotIndices = new Map();
      return;
    }

    const anchor = ensureLayoutHost();
    if (!anchor) return;

    const key = getCurrentKey(performer);
    const existing = document.getElementById(PANEL_ID);
    if (existing && state.panelKey === key) return;

    state.isInjecting = true;
    state.injectToken += 1;
    const token = state.injectToken;

    try {
      const cfg = await loadConfig();
      if (token !== state.injectToken) return;

      if (state.panelKey !== key) {
        state.slotIndices = new Map();
      }

      state.currentPerformer = performer;
      state.panelData = await buildPanelData(performer, cfg);
      if (token !== state.injectToken) return;

      cleanupPanel({ preserveHost: true });

      const host = ensureLayoutHost();
      refreshObservedElements();
      const panel = renderPanel();
      if (!host || !panel) return;
      host.appendChild(panel);
      setupLoopingSlots(panel);
      state.panelKey = key;
      updateFloatingPanelLayout();
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] inject failed", err);
    } finally {
      state.isInjecting = false;
    }
  }

  function handleRouteChange() {
    const path = window.location.pathname;
    if (path === state.lastPath) return;
    state.lastPath = path;
    closeCropEditor();
    state.scheduledLayoutToken += 1;
    refreshObservedElements();
    scheduleRouteInjection();
  }

  function init() {
    installNavigationHooks();
    installObserver();
    installResizeObserver();
    installDetailInteractionHook();
    installLayoutHandlers();
    state.lastPath = window.location.pathname;
    if (isPerformerPage()) {
      refreshObservedElements();
      scheduleRouteInjection();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
