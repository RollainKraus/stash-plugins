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
  const PANEL_DEFAULT_WIDTH = 300;
  const PANEL_MIN_WIDTH = 220;
  const PANEL_COLLAPSED_WIDTH = 58;
  const CROP_STORAGE_KEY = "ptbsi-slot-crops-v1";
  const SLOT_ASPECT_STORAGE_KEY = "ptbsi-slot-aspect-modes-v1";
  const SLOT_ASPECT_LOCK_STORAGE_KEY = "ptbsi-slot-aspect-locks-v1";
  const COLLAPSED_STORAGE_KEY = "ptbsi-panel-collapsed-v1";
  const BACKUP_VERSION = 1;
  const SLOT_ASPECT_MODES = ["tall", "portrait", "square", "landscape", "widescreen"];
  const LOOP_REPEAT_COUNT = 3;
  const LAYOUT_REFRESH_DELAYS = [0, 80, 180, 320];
  const QUICK_TAG_CLOSE_DELAY_MS = 140;
  const QUICK_TAG_VIEWPORT_PAD = 8;
  const QUICK_TAG_PANEL_GUTTER = 8;
  const QUICK_TAG_MIN_WIDTH = 220;
  const QUICK_TAG_MIN_HEIGHT = 120;
  const QUICK_TAG_MIN_MAX_HEIGHT = 180;
  const CARD_PREVIEW_GUTTER = 12;
  const CARD_PREVIEW_VIEWPORT_PAD = 8;
  const CARD_PREVIEW_TILE_GAP = 8;
  const CARD_PREVIEW_PANEL_PADDING = 8;
  const CARD_PREVIEW_MIN_PANEL_WIDTH = 220;
  const CARD_PREVIEW_MIN_PANEL_HEIGHT = 220;
  const CARD_PREVIEW_DEFAULT_PANEL_WIDTH = 500;
  const CARD_PREVIEW_DEFAULT_PANEL_HEIGHT = 500;
  const CARD_PREVIEW_MIN_ROW_HEIGHT = 88;
  const CARD_PREVIEW_MAX_ROW_HEIGHT = 260;
  const CARD_PREVIEW_CLOSE_DELAY_MS = 140;
  const quickTagCleanupMap = new WeakMap();
  const quickTagCloseMap = new WeakMap();
  const cardPreviewCleanupMap = new WeakMap();

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
    slotAspectLockStore: loadSlotAspectLockStore(),
    isCollapsed: false,
    cropEditor: null,
    slotSlideshowTimer: null,
    quickTagObserver: null,
    quickTagRefreshHandle: 0,
    quickTagDecorating: false,
    quickTagSlotsKey: "",
    quickTagSlots: null,
    quickTagImageTags: new Map(),
    cardPreviewObserver: null,
    cardPreviewRefreshHandle: 0,
    cardPreviewRoot: null,
    cardPreviewCloseTimer: 0,
    cardPreviewActiveCard: null,
    cardPreviewActivePerformerId: "",
    cardPreviewOpenToken: 0,
    cardPreviewDataCache: new Map(),
    cardPreviewViewportBound: false,
    cardPreviewSessionData: null,
    cardPreviewSlideshowTimer: null,
    quickTagMenus: new Set(),
    quickTagPopupPanels: new Set(),
    navigationHooksInstalled: false,
    originalPushState: null,
    originalReplaceState: null,
    wrappedPushState: null,
    wrappedReplaceState: null,
    handlePopState: null,
    handleNavigation: null,
    detailInteractionHandler: null,
    layoutScrollHandler: null,
    layoutResizeHandler: null,
    layoutChangedHandler: null,
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

  function loadSlotAspectLockStore() {
    try {
      const raw = window.localStorage.getItem(SLOT_ASPECT_LOCK_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveSlotAspectLockStore() {
    try {
      window.localStorage.setItem(
        SLOT_ASPECT_LOCK_STORAGE_KEY,
        JSON.stringify(state.slotAspectLockStore)
      );
    } catch (err) {
      void err;
    }
  }

  function getPanelStateBehavior(cfg) {
    const value = String(cfg?.a_defaultPanelState || "").trim().toLowerCase();
    if (value === "expanded" || value === "always-expanded") {
      return "expanded";
    }
    if (value === "collapsed" || value === "always-collapsed") {
      return "collapsed";
    }
    return "remember";
  }

  function loadCollapsedState(cfg) {
    const behavior = getPanelStateBehavior(cfg);
    if (behavior === "expanded") return false;
    if (behavior === "collapsed") return true;
    try {
      const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (raw === null) return false;
      return raw === "true";
    } catch (err) {
      return false;
    }
  }

  function saveCollapsedState() {
    try {
      window.localStorage.setItem(
        COLLAPSED_STORAGE_KEY,
        state.isCollapsed ? "true" : "false"
      );
    } catch (err) {
      void err;
    }
  }

  function getStoredCollapsedStateValue() {
    try {
      return window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function normalizeBackupObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function normalizeCropBackupStore(value) {
    const source = normalizeBackupObject(value);
    return Object.entries(source).reduce((store, [key, crop]) => {
      const normalizedCrop = normalizeCropRect(crop);
      if (key && normalizedCrop) {
        store[String(key)] = normalizedCrop;
      }
      return store;
    }, {});
  }

  function normalizeSlotAspectBackupStore(value) {
    const source = normalizeBackupObject(value);
    return Object.entries(source).reduce((store, [key, mode]) => {
      const rawMode = String(mode || "").trim().toLowerCase();
      const normalizedMode = SLOT_ASPECT_MODES.includes(rawMode) ? rawMode : "";
      if (key && normalizedMode) {
        store[String(key)] = normalizedMode;
      }
      return store;
    }, {});
  }

  function normalizeSlotAspectLockBackupStore(value) {
    const source = normalizeBackupObject(value);
    return Object.entries(source).reduce((store, [key, locked]) => {
      if (key && locked) {
        store[String(key)] = true;
      }
      return store;
    }, {});
  }

  function buildLocalStateBackupPayload() {
    const crops = normalizeCropBackupStore(state.cropStore);
    const slotAspectModes = normalizeSlotAspectBackupStore(state.slotAspectStore);
    const slotAspectLocks = normalizeSlotAspectLockBackupStore(state.slotAspectLockStore);
    const panelCollapsed = getStoredCollapsedStateValue();

    return {
      plugin: PLUGIN_ID,
      type: "ptbsi-local-state-backup",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      storageKeys: {
        crops: CROP_STORAGE_KEY,
        slotAspectModes: SLOT_ASPECT_STORAGE_KEY,
        slotAspectLocks: SLOT_ASPECT_LOCK_STORAGE_KEY,
        panelCollapsed: COLLAPSED_STORAGE_KEY,
      },
      counts: {
        crops: Object.keys(crops).length,
        slotAspectModes: Object.keys(slotAspectModes).length,
        slotAspectLocks: Object.keys(slotAspectLocks).length,
      },
      data: {
        crops,
        slotAspectModes,
        slotAspectLocks,
        panelCollapsed,
      },
    };
  }

  function getBackupFileName() {
    const stamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/[:]/g, "-");
    return `PerformerTagBasedSupportingImages-backup-${stamp}.json`;
  }

  function downloadJsonBackup(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getBackupFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportLocalStateBackup() {
    downloadJsonBackup(buildLocalStateBackupPayload());
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read backup file."));
      reader.readAsText(file);
    });
  }

  function parseLocalStateBackup(rawText) {
    const parsed = JSON.parse(String(rawText || ""));
    const data = normalizeBackupObject(parsed?.data || parsed);
    return {
      crops: normalizeCropBackupStore(data.crops),
      slotAspectModes: normalizeSlotAspectBackupStore(data.slotAspectModes),
      slotAspectLocks: normalizeSlotAspectLockBackupStore(data.slotAspectLocks),
      panelCollapsed:
        data.panelCollapsed === true ||
        data.panelCollapsed === "true" ||
        data.panelCollapsed === false ||
        data.panelCollapsed === "false"
          ? String(data.panelCollapsed) === "true"
          : null,
    };
  }

  function mergeImportedLocalStateBackup(backup) {
    const crops = normalizeCropBackupStore(backup?.crops);
    const slotAspectModes = normalizeSlotAspectBackupStore(backup?.slotAspectModes);
    const slotAspectLocks = normalizeSlotAspectLockBackupStore(backup?.slotAspectLocks);

    state.cropStore = {
      ...state.cropStore,
      ...crops,
    };
    state.slotAspectStore = {
      ...state.slotAspectStore,
      ...slotAspectModes,
    };
    state.slotAspectLockStore = {
      ...state.slotAspectLockStore,
      ...slotAspectLocks,
    };

    saveCropStore();
    saveSlotAspectStore();
    saveSlotAspectLockStore();

    if (backup?.panelCollapsed != null) {
      state.isCollapsed = !!backup.panelCollapsed;
      saveCollapsedState();
    }

    return {
      crops: Object.keys(crops).length,
      slotAspectModes: Object.keys(slotAspectModes).length,
      slotAspectLocks: Object.keys(slotAspectLocks).length,
    };
  }

  async function importLocalStateBackupFile(file) {
    if (!file) return;
    try {
      const backup = parseLocalStateBackup(await readFileAsText(file));
      const counts = mergeImportedLocalStateBackup(backup);
      rerenderPanel();
      window.alert(
        [
          "Performer Tag Based Supporting Images backup imported.",
          `Crops: ${counts.crops}`,
          `Slot aspect modes: ${counts.slotAspectModes}`,
          `Slot aspect locks: ${counts.slotAspectLocks}`,
        ].join("\n")
      );
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] backup import failed", err);
      window.alert("Could not import this backup JSON file.");
    }
  }

  function promptImportLocalStateBackup() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] || null;
        importLocalStateBackupFile(file);
      },
      { once: true }
    );
    input.click();
  }

  function setCollapsedState(nextValue) {
    state.isCollapsed = !!nextValue;
    saveCollapsedState();
    if (state.isCollapsed) {
      clearOverlayOffsets();
    }
    scheduleLayoutRefresh();
  }

  function normalizeSlotAspectMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return SLOT_ASPECT_MODES.includes(normalized) ? normalized : "square";
  }

  function getSavedSlotAspectMode(slotKey) {
    return normalizeSlotAspectMode(state.slotAspectStore?.[String(slotKey)]);
  }

  function getStoredSlotAspectMode(slotKey) {
    const key = String(slotKey || "");
    if (
      !key ||
      !state.slotAspectStore ||
      !Object.prototype.hasOwnProperty.call(state.slotAspectStore, key)
    ) {
      return "";
    }
    const raw = String(state.slotAspectStore[key] || "").trim();
    return raw ? normalizeSlotAspectMode(raw) : "";
  }

  function setSavedSlotAspectMode(slotKey, mode) {
    state.slotAspectStore[String(slotKey)] = normalizeSlotAspectMode(mode);
    saveSlotAspectStore();
  }

  function isSlotAspectLocked(slotKey) {
    return !!state.slotAspectLockStore?.[String(slotKey)];
  }

  function setSlotAspectLocked(slotKey, locked) {
    const key = String(slotKey || "");
    if (!key) return false;
    if (locked) {
      state.slotAspectLockStore[key] = true;
    } else {
      delete state.slotAspectLockStore[key];
    }
    saveSlotAspectLockStore();
    return !!locked;
  }

  function toggleSlotAspectLocked(slotKey) {
    return setSlotAspectLocked(slotKey, !isSlotAspectLocked(slotKey));
  }

  function getAspectRatioForMode(mode) {
    switch (normalizeSlotAspectMode(mode)) {
      case "tall":
        return 9 / 16;
      case "portrait":
        return 2 / 3;
      case "landscape":
        return 4 / 3;
      case "widescreen":
        return 16 / 9;
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
    const crop = getSavedCrop(slotKey, image);
    return inferSlotAspectModeFromRatio(getCropAspectRatio(dimensions, crop));
  }

  function getSlotAspectLabel(mode) {
    return getSlotAspectDisplayName(mode);
  }

  function getSlotAspectTitle(mode) {
    return `Slot aspect: ${getSlotAspectDisplayName(mode)}`;
  }

  function getSlotAspectLockTitle(mode, locked) {
    const label = getSlotAspectDisplayName(mode);
    return locked
      ? `Slot aspect locked: ${label}. Click to unlock.`
      : `Slot aspect unlocked: ${label}. Click to lock.`;
  }

  function getSlotAspectDisplayName(mode) {
    switch (normalizeSlotAspectMode(mode)) {
      case "tall":
        return "9:16";
      case "portrait":
        return "2:3";
      case "landscape":
        return "4:3";
      case "widescreen":
        return "16:9";
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

  function getSlotCropAspectMode(slot) {
    if (!slot || !isSlotAspectLocked(slot.key)) return "";
    return normalizeSlotAspectMode(slot.aspectMode || getSavedSlotAspectMode(slot.key));
  }

  function getCropStoreKey(slotKey, imageId) {
    return `${String(slotKey)}:${String(imageId)}`;
  }

  function normalizeCropIdentityValue(value) {
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/");
  }

  function getImageStableIdentity(image) {
    if (!image || typeof image !== "object") return "";
    const path =
      image?.files?.find((file) => String(file?.path || "").trim())?.path ||
      image?.file?.path ||
      image?.path ||
      "";
    const normalizedPath = normalizeCropIdentityValue(path);
    return normalizedPath ? `path:${normalizedPath}` : "";
  }

  function getCropStoreKeys(slotKey, imageOrId) {
    const keyPrefix = String(slotKey || "");
    if (!keyPrefix) return [];

    const keys = [];
    const imageId =
      imageOrId && typeof imageOrId === "object" ? imageOrId.id : imageOrId;
    if (imageId !== undefined && imageId !== null && String(imageId).trim()) {
      keys.push(getCropStoreKey(keyPrefix, imageId));
    }

    const stableIdentity = getImageStableIdentity(imageOrId);
    if (stableIdentity) {
      keys.push(getCropStoreKey(keyPrefix, stableIdentity));
    }

    return Array.from(new Set(keys));
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

  function getSavedCrop(slotKey, imageOrId) {
    const keys = getCropStoreKeys(slotKey, imageOrId);
    for (const key of keys) {
      const crop = normalizeCropRect(state.cropStore[key]);
      if (!crop) continue;

      const missingKeys = keys.filter(
        (candidateKey) => !normalizeCropRect(state.cropStore[candidateKey])
      );
      if (missingKeys.length) {
        missingKeys.forEach((candidateKey) => {
          state.cropStore[candidateKey] = crop;
        });
        saveCropStore();
      }

      return crop;
    }
    return null;
  }

  function setSavedCrop(slotKey, imageOrId, crop, options = {}) {
    const { skipSave = false } = options;
    const keys = getCropStoreKeys(slotKey, imageOrId);
    if (!keys.length) return;
    const normalized = normalizeCropRect(crop);
    if (normalized) {
      keys.forEach((key) => {
        state.cropStore[key] = normalized;
      });
    } else {
      keys.forEach((key) => {
        delete state.cropStore[key];
      });
    }
    if (!skipSave) {
      saveCropStore();
    }
  }

  function getPerformerFromPath(pathname) {
    const match = pathname.match(/^\/performers\/(\d+)/);
    if (!match) return null;
    return { id: match[1], type: "performer" };
  }

  function isPerformerPage() {
    return !!getPerformerFromPath(window.location.pathname);
  }

  function isPerformerImagesPage() {
    return /^\/performers\/\d+\/images\/?$/.test(window.location.pathname);
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

  function applyRailSizing(host, panel, availableHeight, options = {}) {
    const { compact = false } = options;
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
      compact ? 0 : state.isCollapsed ? PANEL_COLLAPSED_WIDTH : 260,
      Math.round(hostRect.width || host.clientWidth || 0)
    );

    if (compact) {
      host.style.height = "auto";
      host.style.minHeight = "0";
      host.style.maxHeight = "none";
      panel.style.height = "auto";
      panel.style.minHeight = "0";
      panel.style.maxHeight = "none";
      panel.style.width = "100%";
      panel.classList.toggle("is-collapsed", !!state.isCollapsed);
      host.classList.toggle(
        "performer-tag-based-supporting-images__host--collapsed",
        !!state.isCollapsed
      );
      panel.classList.remove("is-hidden");
      panel.classList.toggle("is-content-hovered", false);
      return;
    }

    if (state.isCollapsed) {
      host.style.height = "auto";
      host.style.minHeight = "0";
      host.style.maxHeight = "none";
    } else {
      host.style.height = Number.isFinite(availableHeight)
        ? `${clampedHostHeight}px`
        : "";
      host.style.minHeight = Number.isFinite(availableHeight)
        ? `${clampedHostHeight}px`
        : "";
      host.style.maxHeight = Number.isFinite(availableHeight)
        ? `${clampedHostHeight}px`
        : "";
    }
    host.style.visibility = "";

    if (state.isCollapsed) {
      panel.style.height = "auto";
      panel.style.minHeight = "0";
      panel.style.maxHeight = "none";
    } else {
      panel.style.height = Number.isFinite(availableHeight)
        ? "100%"
        : `${clampedPanelHeight}px`;
      panel.style.minHeight = Number.isFinite(availableHeight)
        ? `${clampedHostHeight}px`
        : `${clampedPanelHeight}px`;
      panel.style.maxHeight = Number.isFinite(availableHeight)
        ? `${clampedHostHeight}px`
        : `${clampedPanelHeight}px`;
    }
    panel.style.width = hostWidth > 0 ? `${hostWidth}px` : "";
    panel.classList.toggle("is-collapsed", !!state.isCollapsed);
    host.classList.toggle(
      "performer-tag-based-supporting-images__host--collapsed",
      !!state.isCollapsed
    );

    const shouldHideForBoundary =
      !state.isCollapsed &&
      Number.isFinite(availableHeight) &&
      clampedHostHeight < 120;
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
    const isCompactViewport = window.innerWidth <= 900;
    const configuredPanelWidth = getPanelWidth(state.config || {});
    const overlayWidth = state.isCollapsed
      ? PANEL_COLLAPSED_WIDTH
      : configuredPanelWidth;
    const overlayLeft =
      Number.isFinite(overlayRight) && Number.isFinite(overlayTop)
        ? Math.max(0, Math.round(overlayRight - overlayWidth))
        : null;
    const overlayBottom = bottomCandidates.length ? Math.min(...bottomCandidates) : null;

    host.style.position = isCompactViewport ? "static" : "absolute";
    host.style.top = isCompactViewport
      ? ""
      : Number.isFinite(overlayTop)
        ? `${overlayTop}px`
        : "";
    host.style.left = isCompactViewport
      ? ""
      : Number.isFinite(overlayLeft)
        ? `${overlayLeft}px`
        : "";
    host.style.width = isCompactViewport ? "100%" : `${overlayWidth}px`;
    host.style.zIndex = "20";
    if (state.isCollapsed) {
      clearOverlayOffsets();
    } else {
      applyOverlayOffsets(window.innerWidth > 900 ? overlayLeft : null);
    }

    const hostHeight = Math.max(
      0,
      Math.round(host.getBoundingClientRect().height || host.clientHeight || 0)
    );
    const availableHeight = isCompactViewport
      ? null
      : (Number.isFinite(overlayBottom) && Number.isFinite(overlayTop)
          ? overlayBottom - overlayTop - PANEL_BOTTOM_GAP
          : null) ?? (hostHeight > 0 ? hostHeight : null);
    applyRailSizing(host, panel, availableHeight, {
      compact: isCompactViewport,
    });
    updateLoopReelSizing(panel);
  }

  function getSelectionMode(cfg) {
    const value = String(cfg.a_selectionMode || "").trim().toLowerCase();
    return value === "random" ? "random" : "first";
  }

  function getSlotSlideshowSeconds(cfg) {
    return getConfigNumber(cfg?.a_slotSlideshowSeconds, 0, 0, 3600);
  }

  function getSlotTransitionMs(cfg) {
    return getConfigNumber(cfg?.a_slotTransitionMs, 0, 0, 5000);
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

  function getCardPreviewPanelWidth(cfg) {
    return getConfigNumber(
      cfg?.a_cardPreviewPanelWidth,
      CARD_PREVIEW_DEFAULT_PANEL_WIDTH,
      CARD_PREVIEW_MIN_PANEL_WIDTH,
      1400
    );
  }

  function getCardPreviewPanelHeight(cfg) {
    return getConfigNumber(
      cfg?.a_cardPreviewPanelHeight,
      CARD_PREVIEW_DEFAULT_PANEL_HEIGHT,
      CARD_PREVIEW_MIN_PANEL_HEIGHT,
      1400
    );
  }

  function getCardPreviewBackgroundColor(cfg) {
    const value = String(cfg?.a_cardPreviewBackgroundColor || "").trim();
    return value || "#000000";
  }

  function shouldShowEmptyCardPreviewSlots(cfg) {
    return getConfigBoolean(cfg?.a_cardPreviewShowEmptySlots, false);
  }

  function getCardPreviewHoverBehavior(cfg) {
    const rawValue = String(cfg?.a_cardPreviewHoverBehavior || "")
      .trim()
      .toLowerCase();

    switch (rawValue) {
      case "performer card":
      case "performercard":
      case "card":
      case "anywhere":
        return "performer-card";
      case "badge":
        return "badge";
      case "disabled":
      case "disable":
      case "off":
      case "none":
      case "false":
        return "disabled";
      default:
        break;
    }
    return "badge";
  }

  function getCardPreviewSlotOrder(cfg) {
    const raw = String(cfg?.a_cardPreviewSlotOrder || "")
      .replace(/\s+/g, "")
      .trim();
    const fallback = ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"];
    if (!raw) return fallback;
    if (!/^[1-6]{6}$/.test(raw)) return fallback;
    const digits = raw.split("");
    if (new Set(digits).size !== 6) return fallback;
    return digits.map((digit) => `slot${digit}`);
  }

  function getPanelWidth(cfg) {
    return getConfigNumber(
      cfg?.a_panelWidth,
      PANEL_DEFAULT_WIDTH,
      PANEL_MIN_WIDTH,
      1400
    );
  }

  function shouldAutoFitSlotCrops(cfg) {
    return getConfigBoolean(cfg?.a_autoFitSlotCrops, true);
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
    const cardPreviewBackgroundColor = getCardPreviewBackgroundColor(cfg);
    const overlayOpacity = getOverlayBackgroundOpacity(cfg);
    const overlayBackgroundColor = getOverlayBackgroundColor(cfg);
    const transitionMs = getSlotTransitionMs(cfg);
    panel.style.setProperty("--ptbsi-image-height", `${getImageHeight(cfg)}px`);
    panel.style.setProperty("--ptbsi-slot-transition-ms", `${transitionMs}ms`);
    panel.style.setProperty("--ptbsi-panel-opacity", panelOpacity);
    panel.style.setProperty("--ptbsi-font-color", getPanelFontColor(cfg));
    panel.style.setProperty("--ptbsi-panel-bg-color", backgroundColor);
    panel.style.setProperty(
      "--ptbsi-card-preview-bg-color",
      cardPreviewBackgroundColor
    );
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
        includeDescendantTags: getConfigBoolean(
          readConfigValue(cfg, "c1_slot1IncludeSubTags"),
          false
        ),
      },
      {
        key: "slot2",
        tagNames: parseTagList(readConfigValue(cfg, "d_slot2Tags", "c_slot2Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "e_slot2Label", "k_slot2Label")),
        includeDescendantTags: getConfigBoolean(
          readConfigValue(cfg, "e1_slot2IncludeSubTags"),
          false
        ),
      },
      {
        key: "slot3",
        tagNames: parseTagList(readConfigValue(cfg, "f_slot3Tags", "d_slot3Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "g_slot3Label", "l_slot3Label")),
        includeDescendantTags: getConfigBoolean(
          readConfigValue(cfg, "g1_slot3IncludeSubTags"),
          false
        ),
      },
      {
        key: "slot4",
        tagNames: parseTagList(readConfigValue(cfg, "h_slot4Tags", "e_slot4Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "i_slot4Label", "m_slot4Label")),
        includeDescendantTags: getConfigBoolean(
          readConfigValue(cfg, "i1_slot4IncludeSubTags"),
          false
        ),
      },
      {
        key: "slot5",
        tagNames: parseTagList(readConfigValue(cfg, "j_slot5Tags", "f_slot5Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "k_slot5Label", "n_slot5Label")),
        includeDescendantTags: getConfigBoolean(
          readConfigValue(cfg, "k1_slot5IncludeSubTags"),
          false
        ),
      },
      {
        key: "slot6",
        tagNames: parseTagList(readConfigValue(cfg, "l_slot6Tags", "g_slot6Tags")),
        customLabel: parseLabelText(readConfigValue(cfg, "m_slot6Label", "o_slot6Label")),
        includeDescendantTags: getConfigBoolean(
          readConfigValue(cfg, "m1_slot6IncludeSubTags"),
          false
        ),
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
    state.isCollapsed = loadCollapsedState(state.config);
    return state.config;
  }

  function buildTagIndex(tags = []) {
    const byName = new Map();
    const byId = new Map();

    (tags || []).forEach((tag) => {
      const id = String(tag?.id || "").trim();
      const name = String(tag?.name || "").trim();
      if (!id || !name) return;

      const normalizedName = name.toLowerCase();
      byName.set(normalizedName, id);

      byId.set(id, {
        id,
        name,
        childIds: Array.from(tag?.children || [])
          .map((child) => String(child?.id || "").trim())
          .filter(Boolean),
      });
    });

    const descendantsById = new Map();

    function collectDescendants(tagId, visited = new Set()) {
      const safeId = String(tagId || "").trim();
      if (!safeId || visited.has(safeId)) return [];
      if (descendantsById.has(safeId)) {
        return descendantsById.get(safeId);
      }

      const record = byId.get(safeId);
      if (!record) {
        descendantsById.set(safeId, []);
        return [];
      }

      const nextVisited = new Set(visited);
      nextVisited.add(safeId);
      const descendants = [];
      const seen = new Set();

      (record.childIds || []).forEach((childId) => {
        if (!childId || seen.has(childId)) return;
        descendants.push(childId);
        seen.add(childId);
        collectDescendants(childId, nextVisited).forEach((descendantId) => {
          if (!descendantId || seen.has(descendantId)) return;
          descendants.push(descendantId);
          seen.add(descendantId);
        });
      });

      descendantsById.set(safeId, descendants);
      return descendants;
    }

    Array.from(byId.keys()).forEach((id) => {
      collectDescendants(id);
    });

    return { byName, byId, descendantsById };
  }

  function getTagIdByName(tagIndex, name) {
    return tagIndex?.byName?.get(String(name || "").trim().toLowerCase()) || "";
  }

  function hasTagName(tagIndex, name) {
    return !!getTagIdByName(tagIndex, name);
  }

  function getDescendantTagIds(tagIndex, tagId) {
    const safeId = String(tagId || "").trim();
    if (!safeId) return [];
    return Array.from(tagIndex?.descendantsById?.get(safeId) || []).map(String);
  }

  function resolveSlotTagGroups(slot, tagIndex, includeDescendants = false) {
    const groups = [];
    const missingTags = [];

    (slot?.tagNames || []).forEach((name) => {
      const tagId = getTagIdByName(tagIndex, name);
      if (!tagId) {
        missingTags.push(name);
        return;
      }

      const descendantIds = includeDescendants
        ? getDescendantTagIds(tagIndex, tagId)
        : [];
      const groupTagIds = Array.from(new Set([tagId, ...descendantIds].map(String).filter(Boolean)));

      groups.push({
        name,
        tagId,
        tagIds: groupTagIds,
      });
    });

    const tagFilterItems = groups.map((group) => {
      const record = tagIndex?.byId?.get(String(group.tagId));
      return {
        id: String(group.tagId),
        label: record?.name || group.name || String(group.tagId),
      };
    });

    const resolvedTagIds = Array.from(
      new Set(groups.flatMap((group) => group.tagIds).map(String).filter(Boolean))
    );

    return {
      groups,
      missingTags,
      resolvedTagIds,
      directTagIds: groups.map((group) => String(group.tagId)),
      tagFilterItems,
    };
  }

  async function fetchTagMap() {
    const data = await gqlRequest(`
      query PerformerTagBasedSupportingImagesTags {
        allTags {
          id
          name
          children {
            id
          }
        }
      }
    `);

    return buildTagIndex(data?.allTags || []);
  }

  async function ensureTagMap(options = {}) {
    const { forceRefresh = false } = options;
    if (state.tagMap && !forceRefresh) return state.tagMap;

    const map = await fetchTagMap();
    state.tagMap = map;
    return map;
  }

  async function fetchImageTagIds(imageId) {
    const data = await gqlRequest(
      `
        query PerformerSupportingImagesImageTags($id: ID!) {
          findImage(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      { id: imageId }
    );

    return (data?.findImage?.tags || [])
      .map((tag) => String(tag?.id || "").trim())
      .filter(Boolean);
  }

  async function fetchImageDetails(imageId) {
    const data = await gqlRequest(
      `
        query PerformerSupportingImagesImageDetails($id: ID!) {
          findImage(id: $id) {
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
      `,
      { id: imageId }
    );

    return data?.findImage || null;
  }

  async function updateImageTagIds(imageId, tagIds) {
    const data = await gqlRequest(
      `
        mutation PerformerSupportingImagesUpdateImageTags($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(imageId),
          tag_ids: Array.from(new Set((tagIds || []).map(String).filter(Boolean))),
        },
      }
    );

    return data?.imageUpdate?.id || null;
  }

  async function queryImagesForTagSet(
    performerId,
    tagIds,
    selectionMode = "first"
  ) {
    if (!tagIds.length) return [];

    const isRandom = selectionMode === "random";
    const filter = {
      per_page: -1,
      sort: isRandom ? "random" : "created_at",
    };
    if (!isRandom) {
      filter.direction = "DESC";
    }

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
              tags {
                id
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
            modifier: "INCLUDES_ALL",
          },
          tags: {
            value: tagIds.map(String),
            modifier: "INCLUDES",
          },
        },
        filter,
      }
    );

    return data?.findImages?.images || [];
  }

  async function findImagesForSlot(performerId, tagGroups, selectionMode = "first") {
    const groups = Array.isArray(tagGroups)
      ? tagGroups.filter((group) => (group?.tagIds || []).length)
      : [];
    if (!groups.length) return [];

    const unionTagIds = Array.from(
      new Set(groups.flatMap((group) => group.tagIds || []).map(String).filter(Boolean))
    );
    const images = await queryImagesForTagSet(
      performerId,
      unionTagIds,
      selectionMode
    );

    if (groups.length === 1) return images;

    return images.filter((image) => {
      const imageTagIds = new Set(
        (image?.tags || [])
          .map((tag) => String(tag?.id || ""))
          .filter(Boolean)
      );
      return groups.every((group) =>
        group.tagIds.some((tagId) => imageTagIds.has(String(tagId)))
      );
    });
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

  function buildTagFilterCriterion(slot) {
    const items = Array.isArray(slot?.tagFilterItems)
      ? slot.tagFilterItems
          .map((item) => {
            const numericId = Number(item?.id);
            return {
              id:
                Number.isFinite(numericId) && numericId > 0
                  ? numericId
                  : String(item?.id || ""),
              label: String(item?.label || item?.id || ""),
            };
          })
          .filter((item) => item.id && item.label)
      : [];
    if (!items.length) return null;

    return {
      type: "tags",
      modifier: "INCLUDES_ALL",
      value: {
        items,
        excluded: [],
        depth: slot?.includeDescendantTags ? -1 : 0,
      },
    };
  }

  function getFilteredPerformerImagesHref(slot, cfg) {
    const performerId = String(slot?.performerId || "").trim();
    if (!performerId) return "";

    const basePath = `/performers/${encodeURIComponent(performerId)}/images`;
    const criterion = buildTagFilterCriterion(slot);
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

  function selectionFromPointsWithAspect(start, end, aspectRatio) {
    if (!start || !end) return null;
    const ratio = Number(aspectRatio);
    if (!(ratio > 0)) {
      return selectionFromPoints(start, end);
    }

    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const widthFromX = Math.abs(deltaX);
    const widthFromY = Math.abs(deltaY) * ratio;
    const width = Math.min(widthFromX, widthFromY);
    const height = width / ratio;

    const horizontalSign = deltaX < 0 ? -1 : 1;
    const verticalSign = deltaY < 0 ? -1 : 1;

    const target = {
      x: start.x + width * horizontalSign,
      y: start.y + height * verticalSign,
    };

    return selectionFromPoints(start, target);
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

  function getSlotTargetAspectMode(slot) {
    return normalizeSlotAspectMode(
      slot?.aspectMode || getStoredSlotAspectMode(slot?.key) || "square"
    );
  }

  function getSlotFittedCrop(slot, image) {
    const dimensions = getImageDimensions(image);
    if (!slot || !image || !dimensions) return null;
    const aspectMode = getSlotTargetAspectMode(slot);
    const existingCrop = getSavedCrop(slot.key, image);
    const baseCrop = existingCrop || { x: 0, y: 0, width: 1, height: 1 };
    return snapCropToAspectMode(baseCrop, dimensions, aspectMode);
  }

  function areCropsEquivalent(leftCrop, rightCrop, tolerance = 0.0005) {
    const left = normalizeCropRect(leftCrop);
    const right = normalizeCropRect(rightCrop);
    if (!left && !right) return true;
    if (!left || !right) return false;
    return (
      Math.abs(left.x - right.x) <= tolerance &&
      Math.abs(left.y - right.y) <= tolerance &&
      Math.abs(left.width - right.width) <= tolerance &&
      Math.abs(left.height - right.height) <= tolerance
    );
  }

  function doesImageCropFitSlot(slot, image, tolerance = 0.025) {
    const dimensions = getImageDimensions(image);
    const crop = getSavedCrop(slot?.key, image);
    if (!slot || !image || !dimensions || !crop) return false;
    const targetRatio = getAspectRatioForMode(getSlotTargetAspectMode(slot));
    const cropRatio = getCropAspectRatio(dimensions, crop);
    if (!(targetRatio > 0) || !(cropRatio > 0)) return false;
    return Math.abs(Math.log(cropRatio / targetRatio)) <= tolerance;
  }

  function applyFittedCropToSlotImage(slot, image, options = {}) {
    if (!slot?.key || !image?.id) return false;
    const fittedCrop = getSlotFittedCrop(slot, image);
    if (!fittedCrop) return false;
    const existingCrop = getSavedCrop(slot.key, image);
    if (areCropsEquivalent(existingCrop, fittedCrop)) {
      return false;
    }
    setSavedCrop(slot.key, image, fittedCrop, options);
    return true;
  }

  function autoFitSlotImages(slot, images, cfg) {
    if (!shouldAutoFitSlotCrops(cfg)) return false;
    const normalizedImages = Array.isArray(images) ? images : [];
    let didChange = false;
    normalizedImages.forEach((image) => {
      if (applyFittedCropToSlotImage(slot, image, { skipSave: true })) {
        didChange = true;
      }
    });
    if (didChange) {
      saveCropStore();
    }
    return didChange;
  }

  async function loadSlotMatches(
    slot,
    performerId,
    tagMap,
    selectionMode = "first"
  ) {
    const resolvedTags = resolveSlotTagGroups(
      slot,
      tagMap,
      slot?.includeDescendantTags
    );
    const missingTags = resolvedTags.missingTags;
    const images =
      missingTags.length === 0 && resolvedTags.groups.length
        ? await findImagesForSlot(
            performerId,
            resolvedTags.groups,
            selectionMode
          )
        : [];

    return {
      resolvedTags,
      missingTags,
      images,
    };
  }

  function getInitialSlotImageIndex(slotKey, images, selectionMode, options = {}) {
    const imageCount = Array.isArray(images) ? images.length : 0;
    if (!imageCount) return 0;
    if (options.randomize) {
      return Math.floor(Math.random() * imageCount);
    }
    if (options.preserveState === false) {
      return 0;
    }
    return normalizeSlotIndex(slotKey, imageCount, selectionMode);
  }

  function resolveSlotAspectMode(slot, currentImage) {
    const storedAspectMode = getStoredSlotAspectMode(slot?.key);
    if (storedAspectMode) return storedAspectMode;
    if (slot?.aspectMode) return normalizeSlotAspectMode(slot.aspectMode);
    return inferSlotAspectMode(slot?.key, currentImage);
  }

  function buildLoadedSlotViewState(slot, performerId, images, selectionMode, cfg, options = {}) {
    const { autoFit = true } = options;
    const currentIndex = getInitialSlotImageIndex(slot.key, images, selectionMode, options);
    const currentImage = images[currentIndex] || images[0] || null;
    const aspectMode = resolveSlotAspectMode(slot, currentImage);

    if (autoFit) {
      autoFitSlotImages(
        {
          ...slot,
          performerId,
          aspectMode,
        },
        images,
        cfg
      );
    }

    return {
      currentIndex,
      aspectMode,
    };
  }

  async function resolveAutoFitSlot(slot, performerId, cfg, options = {}) {
    if (!slot?.key) return null;

    const storedAspectMode = getStoredSlotAspectMode(slot.key);
    if (storedAspectMode) {
      return {
        ...slot,
        aspectMode: storedAspectMode,
      };
    }

    if (!performerId) {
      return {
        ...slot,
        aspectMode: getSlotTargetAspectMode(slot),
      };
    }

    const tagMap = options.tagMap || (await ensureTagMap());
    const selectionMode = getSelectionMode(cfg);
    const { images } = await loadSlotMatches(
      slot,
      performerId,
      tagMap,
      selectionMode
    );
    const { aspectMode } = buildLoadedSlotViewState(slot, performerId, images, selectionMode, cfg, {
      autoFit: false,
      preserveState: false,
      randomize: selectionMode === "random",
    });

    return {
      ...slot,
      aspectMode,
    };
  }

  async function autoFitImageForSlotAssignment(imageId, slot, cfg, performerId, options = {}) {
    if (!shouldAutoFitSlotCrops(cfg) || !imageId || !slot?.key) return false;
    const image = options.image || (await fetchImageDetails(imageId));
    if (!image) return false;
    const resolvedSlot = await resolveAutoFitSlot(slot, performerId, cfg, options);
    if (!resolvedSlot) return false;
    return applyFittedCropToSlotImage(resolvedSlot, image);
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

  function getSnappedSelectionState(selectionRect, imageRect, dimensions, forcedMode = "") {
    const crop = selectionToCrop(selectionRect, imageRect);
    if (!crop || !dimensions) return null;
    const mode = forcedMode
      ? normalizeSlotAspectMode(forcedMode)
      : inferSlotAspectModeFromRatio(selectionRect.width / selectionRect.height);
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

    const existingCrop = getSavedCrop(slot.key, image);
    const lockedAspectMode = getSlotCropAspectMode(slot);
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
      const liveMode = lockedAspectMode
        ? normalizeSlotAspectMode(lockedAspectMode)
        : inferSlotAspectModeFromRatio(
            currentSelection.width / currentSelection.height
          );
      selectionLabel.textContent = getSlotAspectDisplayName(liveMode);
      selectionLabel.title = getSlotAspectLockTitle(liveMode, !!lockedAspectMode);
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
      currentSelection = lockedAspectMode
        ? selectionFromPointsWithAspect(
            pointerStart,
            point,
            getAspectRatioForMode(lockedAspectMode)
          )
        : selectionFromPoints(pointerStart, point);
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
          dimensions,
          lockedAspectMode
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
      const mode = lockedAspectMode
        ? normalizeSlotAspectMode(lockedAspectMode)
        : dimensions
          ? inferSlotAspectModeFromRatio(getCropAspectRatio(dimensions, crop))
          : "square";
      const snappedCrop = dimensions
        ? snapCropToAspectMode(crop, dimensions, mode)
        : crop;
      setSavedCrop(slot.key, image, snappedCrop);
      if (dimensions) {
        updateStoredSlotAspectMode(slot.key, mode);
      }
      closeCropEditor();
      rerenderPanel();
    }

    function handleReset() {
      setSavedCrop(slot.key, image, null);
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

  function getSlotDisplayName(slot) {
    const match = String(slot?.key || "").match(/slot(\d+)/i);
    return match ? `Slot ${match[1]}` : "Slot";
  }

  function getImageIdFromCard(card) {
    if (!(card instanceof Element)) return "";
    const link = card.querySelector('a[href*="/images/"]');
    const href = String(link?.getAttribute("href") || "");
    const match = href.match(/\/images\/(\d+)/);
    return match ? match[1] : "";
  }

  function getPerformerIdFromCard(card) {
    if (!(card instanceof Element)) return "";
    const link = card.querySelector('a[href*="/performers/"]');
    const href = String(link?.getAttribute("href") || "");
    const match = href.match(/\/performers\/(\d+)/);
    return match ? match[1] : "";
  }

  function getQuickTagSlotCacheKey(cfg) {
    return getSlotConfigs(cfg)
      .map((slot) =>
        [
          slot.key,
          slot.tagNames.join("|"),
          slot.customLabel || "",
          slot.includeDescendantTags ? "1" : "0",
        ].join(":")
      )
      .join(";");
  }

  async function getQuickTagSlots() {
    const cfg = state.config || (await loadConfig());
    const slotsKey = getQuickTagSlotCacheKey(cfg);
    if (state.quickTagSlots && state.quickTagSlotsKey === slotsKey) {
      return state.quickTagSlots;
    }

    const tagMap = await ensureTagMap();
    const slots = getSlotConfigs(cfg).map((slot) => {
      const directTags = (slot.tagNames || []).map((name) => {
        const tagId = getTagIdByName(tagMap, name);
        return {
          id: tagId,
          name,
        };
      });
      const missingTags = directTags
        .filter((tag) => !tag.id)
        .map((tag) => tag.name);
      const tagIds = directTags
        .map((tag) => String(tag.id || "").trim())
        .filter(Boolean);

      return {
        ...slot,
        label: `${getSlotDisplayName(slot)}: ${slot.tagNames.join(", ")}`,
        title: slot.customLabel || slot.tagNames.join(", "),
        tagIds,
        missingTags,
      };
    });

    state.quickTagSlotsKey = slotsKey;
    state.quickTagSlots = slots;
    return slots;
  }

  function setQuickTagMenuStatus(menu, status, message) {
    if (!(menu instanceof Element)) return;
    menu.setAttribute("data-ptbsi-status", status || "");
    const statusEl = menu.querySelector(".performer-tag-based-supporting-images__quick-tag-status");
    if (statusEl) {
      statusEl.textContent = message || "";
    }
  }

  function getActionableQuickTagSlots(slots) {
    return (slots || []).filter((slot) => (slot?.tagIds || []).length > 0);
  }

  function setCachedQuickTagImageTags(imageId, tagIds) {
    state.quickTagImageTags.set(
      String(imageId),
      Array.from(new Set((tagIds || []).map(String).filter(Boolean)))
    );
  }

  function areTagListsEqual(left, right) {
    if (left === right) return true;
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => String(value) === String(right[index]))
    );
  }

  function isQuickTagSlotApplied(slot, imageTagSet) {
    return (
      !!slot &&
      (slot.tagIds || []).length > 0 &&
      slot.tagIds.every((tagId) => imageTagSet.has(String(tagId)))
    );
  }

  function addEventListeners(target, eventNames, handler) {
    eventNames.forEach((eventName) => {
      target.addEventListener(eventName, handler);
    });
  }

  function buildQuickTagUpdate(existingTagIds, slotTagIds) {
    const existing = Array.from(new Set((existingTagIds || []).map(String).filter(Boolean)));
    const slot = Array.from(new Set((slotTagIds || []).map(String).filter(Boolean)));
    const existingSet = new Set(existing);
    const isApplied = slot.length > 0 && slot.every((tagId) => existingSet.has(tagId));
    const nextTagIds = isApplied
      ? existing.filter((tagId) => !slot.includes(tagId))
      : Array.from(new Set([...existing, ...slot]));

    return { existingTagIds: existing, nextTagIds, isApplied };
  }

  function isQuickTagMenuOpen(menu) {
    return menu instanceof Element && menu.classList.contains("is-open");
  }

  function closeQuickTagMenu(menu) {
    if (!(menu instanceof Element)) return;
    const closeHandler = quickTagCloseMap.get(menu);
    if (typeof closeHandler === "function") {
      closeHandler();
    } else {
      menu.classList.remove("is-open");
    }
  }

  function cleanupQuickTagMenuElement(menu) {
    if (!(menu instanceof Element)) return;
    const cleanupHandler = quickTagCleanupMap.get(menu);
    if (typeof cleanupHandler === "function") {
      cleanupHandler();
    }
    quickTagCleanupMap.delete(menu);
    quickTagCloseMap.delete(menu);
  }

  function applyQuickTagMenuSelectionState(menu, imageTagIds, slots) {
    if (!(menu instanceof Element)) return;
    const imageTagSet = new Set((imageTagIds || []).map(String));
    menu
      .querySelectorAll("[data-ptbsi-quick-slot]")
      .forEach((button) => {
        const slotKey = button.getAttribute("data-ptbsi-quick-slot");
        const slot = (slots || []).find((item) => item.key === slotKey);
        const isApplied = isQuickTagSlotApplied(slot, imageTagSet);
        button.classList.toggle("is-applied", isApplied);
        button.setAttribute("aria-pressed", isApplied ? "true" : "false");
      });
  }

  async function syncQuickTagMenuSelectionState(imageId, slots, menu, options = {}) {
    if (!imageId || !(menu instanceof Element)) return [];
    const { forceRefresh = false } = options;
    const cacheKey = String(imageId);
    if (!forceRefresh && state.quickTagImageTags.has(cacheKey)) {
      const cachedTagIds = state.quickTagImageTags.get(cacheKey) || [];
      applyQuickTagMenuSelectionState(menu, cachedTagIds, slots);
      return cachedTagIds;
    }

    setQuickTagMenuStatus(menu, "loading", "Checking tags...");
    try {
      const imageTagIds = await fetchImageTagIds(imageId);
      setCachedQuickTagImageTags(cacheKey, imageTagIds);
      applyQuickTagMenuSelectionState(menu, imageTagIds, slots);
      setQuickTagMenuStatus(menu, "", "");
      return imageTagIds;
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] quick tag state failed", err);
      setQuickTagMenuStatus(menu, "error", "Could not load image tags");
      return [];
    }
  }

  async function toggleSlotTagsOnImage(imageId, slot, menu, slots) {
    if (!imageId || !slot?.tagIds?.length) return;
    setQuickTagMenuStatus(menu, "saving", "Saving...");
    const cfg = state.config || (await loadConfig());

    try {
      const syncedTagIds = await syncQuickTagMenuSelectionState(imageId, slots, menu);
      const { existingTagIds, nextTagIds, isApplied } = buildQuickTagUpdate(
        syncedTagIds,
        slot.tagIds
      );
      const didChange = !areTagListsEqual(existingTagIds, nextTagIds);

      if (!didChange) {
        setCachedQuickTagImageTags(imageId, nextTagIds);
        applyQuickTagMenuSelectionState(menu, nextTagIds, slots);
        setQuickTagMenuStatus(menu, "saved", isApplied ? "Removed" : "Already tagged");
        return;
      }

      await updateImageTagIds(imageId, nextTagIds);
      setCachedQuickTagImageTags(imageId, nextTagIds);
      applyQuickTagMenuSelectionState(menu, nextTagIds, slots);
      const performerId = getPerformerFromPath(window.location.pathname)?.id || "";
      invalidatePerformerCardPreviewCache(performerId);
      setQuickTagMenuStatus(menu, "saved", isApplied ? "Removed" : "Added");

      if (!isApplied) {
        try {
          await autoFitImageForSlotAssignment(imageId, slot, cfg, performerId);
        } catch (err) {
          console.error(
            "[PerformerTagBasedSupportingImages] image auto-fit failed after tag update",
            err
          );
          setQuickTagMenuStatus(menu, "saved", "Added; crop unchanged");
        }
      }
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] image quick tag failed", err);
      setQuickTagMenuStatus(menu, "error", "Tag update failed");
    }
  }

  function closeOtherQuickTagMenus(currentMenu) {
    document
      .querySelectorAll(".performer-tag-based-supporting-images__quick-tag.is-open")
      .forEach((menu) => {
        if (menu !== currentMenu) {
          closeQuickTagMenu(menu);
        }
      });
  }

  function createQuickTagMenu(imageId, slots) {
    const menu = document.createElement("div");
    menu.className = "performer-tag-based-supporting-images__quick-tag";
    menu.setAttribute("data-ptbsi-image-id", String(imageId));
    let closeTimer = 0;
    let viewportEventsBound = false;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "performer-tag-based-supporting-images__quick-tag-toggle";
    trigger.title = "Add slot tags to this image";
    trigger.textContent = "Tag";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    menu.appendChild(trigger);

    const panel = document.createElement("div");
    panel.className = "performer-tag-based-supporting-images__quick-tag-menu";
    panel.setAttribute("role", "menu");
    panel.hidden = true;

    function clearCloseTimer() {
      if (closeTimer) {
        window.clearTimeout(closeTimer);
        closeTimer = 0;
      }
    }

    function positionPanel() {
      if (panel.hidden) return;

      panel.style.maxHeight = `${Math.max(
        QUICK_TAG_MIN_MAX_HEIGHT,
        window.innerHeight - QUICK_TAG_VIEWPORT_PAD * 2
      )}px`;
      panel.style.visibility = "hidden";
      panel.style.left = "0px";
      panel.style.top = "0px";

      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.max(QUICK_TAG_MIN_WIDTH, Math.round(panelRect.width || 260));
      const panelHeight = Math.max(QUICK_TAG_MIN_HEIGHT, Math.round(panelRect.height || 160));

      const spaceRight = window.innerWidth - triggerRect.right - QUICK_TAG_VIEWPORT_PAD;
      const spaceLeft = triggerRect.left - QUICK_TAG_VIEWPORT_PAD;
      const preferRight = spaceRight >= panelWidth || spaceRight >= spaceLeft;

      let left = preferRight
        ? triggerRect.right + QUICK_TAG_PANEL_GUTTER
        : triggerRect.left - panelWidth - QUICK_TAG_PANEL_GUTTER;
      let top = triggerRect.top;

      left = Math.max(
        QUICK_TAG_VIEWPORT_PAD,
        Math.min(left, window.innerWidth - panelWidth - QUICK_TAG_VIEWPORT_PAD)
      );
      top = Math.max(
        QUICK_TAG_VIEWPORT_PAD,
        Math.min(top, window.innerHeight - panelHeight - QUICK_TAG_VIEWPORT_PAD)
      );

      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.visibility = "";
      panel.setAttribute("data-placement", preferRight ? "right" : "left");
    }

    function handleViewportChange() {
      if (isQuickTagMenuOpen(menu)) {
        positionPanel();
      }
    }

    function bindViewportEvents() {
      if (viewportEventsBound) return;
      viewportEventsBound = true;
      window.addEventListener("resize", handleViewportChange);
      window.addEventListener("scroll", handleViewportChange, true);
    }

    function unbindViewportEvents() {
      if (!viewportEventsBound) return;
      viewportEventsBound = false;
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    }

    function closeMenuImmediate() {
      clearCloseTimer();
      menu.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      panel.hidden = true;
      panel.style.visibility = "";
      unbindViewportEvents();
    }

    function openMenu(options = {}) {
      const { forceRefresh = false } = options;
      clearCloseTimer();
      menu.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      panel.hidden = false;
      closeOtherQuickTagMenus(menu);
      bindViewportEvents();
      positionPanel();
      syncQuickTagMenuSelectionState(imageId, slots, panel, { forceRefresh }).then(() => {
        if (isQuickTagMenuOpen(menu)) {
          positionPanel();
        }
      });
    }

    function queueCloseMenu() {
      clearCloseTimer();
      closeTimer = window.setTimeout(() => {
        closeMenuImmediate();
        closeTimer = 0;
      }, QUICK_TAG_CLOSE_DELAY_MS);
    }

    const actionableSlots = getActionableQuickTagSlots(slots);
    if (!actionableSlots.length) {
      const empty = document.createElement("div");
      empty.className = "performer-tag-based-supporting-images__quick-tag-empty";
      empty.textContent = "No configured slot tags";
      panel.appendChild(empty);
    } else {
      actionableSlots.forEach((slot) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "performer-tag-based-supporting-images__quick-tag-option";
        button.setAttribute("role", "menuitem");
        button.setAttribute("data-ptbsi-quick-slot", slot.key);
        button.title = slot.title ? `Add ${slot.title}` : "Add slot tags";
        button.textContent = slot.label;
        panel.appendChild(button);
      });
    }

    const status = document.createElement("div");
    status.className = "performer-tag-based-supporting-images__quick-tag-status";
    panel.appendChild(status);
    document.body.appendChild(panel);
    state.quickTagMenus.add(menu);
    state.quickTagPopupPanels.add(panel);

    [menu, panel].forEach((target) => {
      addEventListeners(target, ["click", "mousedown", "pointerdown"], (event) => {
        event.stopPropagation();
      });
    });

    quickTagCloseMap.set(menu, closeMenuImmediate);
    quickTagCleanupMap.set(menu, () => {
      clearCloseTimer();
      unbindViewportEvents();
      panel.remove();
      state.quickTagMenus.delete(menu);
      state.quickTagPopupPanels.delete(panel);
    });

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      if (isQuickTagMenuOpen(menu)) {
        closeMenuImmediate();
      } else {
        openMenu({ forceRefresh: true });
      }
    });

    [trigger, menu].forEach((target) => {
      target.addEventListener("mouseenter", () => {
        openMenu();
      });
    });

    menu.addEventListener("mouseleave", () => {
      queueCloseMenu();
    });

    panel.addEventListener("mouseenter", () => {
      clearCloseTimer();
    });

    panel.addEventListener("mouseleave", () => {
      queueCloseMenu();
    });

    trigger.addEventListener("focusin", () => {
      openMenu();
    });

    panel.addEventListener("focusin", () => {
      clearCloseTimer();
    });

    panel.addEventListener("focusout", (event) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Element &&
        (panel.contains(nextTarget) || menu.contains(nextTarget))
      ) {
        return;
      }
      queueCloseMenu();
    });

    panel.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-ptbsi-quick-slot]");
      if (!button) return;
      event.preventDefault();
      const slotKey = button.getAttribute("data-ptbsi-quick-slot");
      const slot = (slots || []).find((item) => item.key === slotKey);
      toggleSlotTagsOnImage(imageId, slot, panel, slots);
    });

    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenuImmediate();
        trigger.focus();
      }
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenuImmediate();
      }
    });

    return menu;
  }

  function cleanupQuickTagMenus() {
    state.quickTagMenus.forEach((menu) => {
      cleanupQuickTagMenuElement(menu);
      menu.remove();
    });
    state.quickTagPopupPanels.forEach((panel) => panel.remove());
    state.quickTagMenus.clear();
    state.quickTagPopupPanels.clear();

    document
      .querySelectorAll(".performer-tag-based-supporting-images__quick-tag")
      .forEach((menu) => {
        cleanupQuickTagMenuElement(menu);
        menu.remove();
      });
    document
      .querySelectorAll(".ptbsi-quick-tag-card")
      .forEach((card) => {
        card.classList.remove("ptbsi-quick-tag-card");
        card.removeAttribute("data-ptbsi-quick-tag-image-id");
        card.removeAttribute("data-ptbsi-quick-tag-key");
      });
  }

  async function decorateQuickTagImageCards() {
    state.quickTagRefreshHandle = 0;

    if (!isPerformerImagesPage()) {
      cleanupQuickTagMenus();
      return;
    }
    if (state.quickTagDecorating) return;

    state.quickTagDecorating = true;
    try {
      state.quickTagMenus.forEach((menu) => {
        if (!menu.isConnected || !menu.closest(".image-card")) {
          cleanupQuickTagMenuElement(menu);
          menu.remove();
        }
      });

      const slots = await getQuickTagSlots();
      const actionableSlots = getActionableQuickTagSlots(slots);
      if (!actionableSlots.length) {
        cleanupQuickTagMenus();
        return;
      }

      const slotKey = state.quickTagSlotsKey;
      document.querySelectorAll(".image-card").forEach((card) => {
        if (!(card instanceof HTMLElement)) return;
        if (card.closest(`#${PANEL_ID}`)) return;

        const imageId = getImageIdFromCard(card);
        if (!imageId) return;

        const existingMenu = card.querySelector(
          ".performer-tag-based-supporting-images__quick-tag"
        );
        if (
          existingMenu &&
          card.getAttribute("data-ptbsi-quick-tag-image-id") === imageId &&
          card.getAttribute("data-ptbsi-quick-tag-key") === slotKey
        ) {
          return;
        }

        cleanupQuickTagMenuElement(existingMenu);
        existingMenu?.remove();
        card.classList.add("ptbsi-quick-tag-card");
        card.setAttribute("data-ptbsi-quick-tag-image-id", imageId);
        card.setAttribute("data-ptbsi-quick-tag-key", slotKey);

        card.appendChild(createQuickTagMenu(imageId, slots));
      });
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] quick tag menu failed", err);
    } finally {
      state.quickTagDecorating = false;
    }
  }

  function scheduleQuickTagRefresh() {
    if (state.quickTagRefreshHandle) return;
    state.quickTagRefreshHandle = window.requestAnimationFrame(() => {
      decorateQuickTagImageCards();
    });
  }

  function installQuickTagObserver() {
    if (state.quickTagObserver || typeof MutationObserver !== "function") return;
    state.quickTagObserver = new MutationObserver((mutations) => {
      if (!isPerformerImagesPage()) {
        if (
          document.querySelector(
            ".performer-tag-based-supporting-images__quick-tag"
          )
        ) {
          scheduleQuickTagRefresh();
        }
        return;
      }

      const hasRelevantMutation = mutations.some((mutation) => {
        const changedNodes = [
          ...Array.from(mutation.addedNodes || []),
          ...Array.from(mutation.removedNodes || []),
        ];
        return changedNodes.some(
          (node) =>
            node instanceof Element &&
            !node.closest(".performer-tag-based-supporting-images__quick-tag")
        );
      });
      if (hasRelevantMutation) {
        scheduleQuickTagRefresh();
      }
    });
    state.quickTagObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function shouldEnablePerformerCardPreview() {
    return (
      getCardPreviewHoverBehavior(state.config || {}) !== "disabled" &&
      !isPerformerPage() &&
      document.querySelector(".performer-card") !== null
    );
  }

  function getCardPreviewCacheKey(cfg) {
    return `${getQuickTagSlotCacheKey(cfg)}|${getSelectionMode(cfg)}|${getCardPreviewSlotOrder(cfg).join("")}|${shouldShowEmptyCardPreviewSlots(cfg) ? "show-empty" : "hide-empty"}`;
  }

  function invalidatePerformerCardPreviewCache(performerId) {
    const key = String(performerId || "").trim();
    if (key) {
      state.cardPreviewDataCache.delete(key);
    } else {
      state.cardPreviewDataCache.clear();
    }
  }

  function getCardPreviewInitialIndex(slot, cfg) {
    const total = Number(slot?.images?.length || 0);
    if (!(total > 0)) return 0;
    if (getSelectionMode(cfg) === "random") {
      return Math.floor(Math.random() * total);
    }
    return 0;
  }

  function createPerformerCardPreviewSessionData(data, cfg) {
    const slots = Array.isArray(data?.slots)
      ? data.slots.map((slot) => ({
          ...slot,
          currentIndex: getCardPreviewInitialIndex(slot, cfg),
        }))
      : [];
    return {
      performerId: String(data?.performerId || ""),
      slots,
    };
  }

  function syncExistingPerformerCardPreviewIndices(nextSessionData, existingSessionData) {
    if (
      !nextSessionData ||
      !existingSessionData ||
      String(nextSessionData.performerId || "") !==
        String(existingSessionData.performerId || "")
    ) {
      return nextSessionData;
    }

    const existingSlotMap = new Map(
      (existingSessionData.slots || []).map((slot) => [String(slot?.key || ""), slot])
    );

    nextSessionData.slots = (nextSessionData.slots || []).map((slot) => {
      const existingSlot = existingSlotMap.get(String(slot?.key || ""));
      const total = Number(slot?.images?.length || 0);
      if (!existingSlot || total <= 0) return slot;

      const existingIndex = Number(existingSlot.currentIndex || 0);
      const nextIndex = ((existingIndex % total) + total) % total;
      return {
        ...slot,
        currentIndex: nextIndex,
      };
    });

    return nextSessionData;
  }

  function buildEmptyPerformerCardPreviewSlot(slot, performerId, options = {}) {
    const { missingTags = [] } = options;
    return {
      ...slot,
      performerId: String(performerId || ""),
      images: [],
      currentIndex: 0,
      missingTags: Array.isArray(missingTags) ? missingTags : [],
      isPlaceholder: true,
      aspectMode: getSavedSlotAspectMode(slot.key),
    };
  }

  async function buildPerformerCardPreviewData(performerId, cfg) {
    let tagMap = await ensureTagMap();
    const selectionMode = getSelectionMode(cfg);
    const slots = getSlotConfigs(cfg);
    const showEmptySlots = shouldShowEmptyCardPreviewSlots(cfg);
    const slotOrder = getCardPreviewSlotOrder(cfg);
    const slotOrderMap = new Map(
      slotOrder.map((slotKey, index) => [slotKey, index])
    );
    const configuredTagNames = slots.flatMap((slot) => slot.tagNames);

    const hasMissingConfiguredTags = configuredTagNames.some(
      (name) => !hasTagName(tagMap, name)
    );
    if (hasMissingConfiguredTags) {
      tagMap = await ensureTagMap({ forceRefresh: true });
    }

    const slotResults = await Promise.all(
      slots.map(async (slot) => {
        try {
          const { missingTags, images } = await loadSlotMatches(
            slot,
            performerId,
            tagMap,
            selectionMode
          );

          if (!images.length) {
            return showEmptySlots
              ? buildEmptyPerformerCardPreviewSlot(slot, performerId, {
                  missingTags,
                })
              : null;
          }

          const { currentIndex, aspectMode } = buildLoadedSlotViewState(
            slot,
            performerId,
            images,
            selectionMode,
            cfg,
            {
              preserveState: false,
              randomize: selectionMode === "random",
            }
          );

          return {
            ...slot,
            performerId,
            images,
            currentIndex,
            aspectMode,
            isPlaceholder: false,
          };
        } catch (err) {
          console.error(
            `[PerformerTagBasedSupportingImages] card preview load failed for ${slot.key}`,
            err
          );
          return showEmptySlots
            ? buildEmptyPerformerCardPreviewSlot(slot, performerId)
            : null;
        }
      })
    );

    return {
      performerId: String(performerId),
      slots: slotResults
        .filter((slot) => slot && (showEmptySlots || slot.images.length > 0))
        .sort((left, right) => {
          const leftIndex = slotOrderMap.get(left.key);
          const rightIndex = slotOrderMap.get(right.key);
          return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
        }),
    };
  }

  async function getPerformerCardPreviewData(performerId) {
    const cfg = state.config || (await loadConfig());
    const cacheKey = getCardPreviewCacheKey(cfg);
    const cached = state.cardPreviewDataCache.get(String(performerId));
    if (cached && cached.cacheKey === cacheKey) {
      return cached.data;
    }

    const data = await buildPerformerCardPreviewData(String(performerId), cfg);
    state.cardPreviewDataCache.set(String(performerId), {
      cacheKey,
      data,
    });
    return data;
  }

  function ensurePerformerCardPreviewRoot() {
    if (state.cardPreviewRoot?.isConnected) {
      return state.cardPreviewRoot;
    }

    const root = document.createElement("div");
    root.id = "ptbsi-performer-card-preview-root";
    root.className = "performer-tag-based-supporting-images__card-preview-root";
    document.body.appendChild(root);
    state.cardPreviewRoot = root;
    return root;
  }

  function clearPerformerCardPreviewRoot() {
    const root = state.cardPreviewRoot;
    if (!root) return;
    root.replaceChildren();
  }

  function clearPerformerCardPreviewCloseTimer() {
    if (state.cardPreviewCloseTimer) {
      window.clearTimeout(state.cardPreviewCloseTimer);
      state.cardPreviewCloseTimer = 0;
    }
  }

  function stopPerformerCardPreviewSlideshow() {
    if (state.cardPreviewSlideshowTimer) {
      window.clearInterval(state.cardPreviewSlideshowTimer);
      state.cardPreviewSlideshowTimer = null;
    }
  }

  function unbindPerformerCardPreviewViewportEvents() {
    if (!state.cardPreviewViewportBound) return;
    state.cardPreviewViewportBound = false;
    window.removeEventListener("resize", handlePerformerCardPreviewViewportChange);
    window.removeEventListener("scroll", handlePerformerCardPreviewViewportChange, true);
  }

  function closePerformerCardPreviewImmediate(options = {}) {
    const { preserveActiveCard = false } = options;
    const activeCard = state.cardPreviewActiveCard;
    clearPerformerCardPreviewCloseTimer();
    stopPerformerCardPreviewSlideshow();
    clearPerformerCardPreviewRoot();
    unbindPerformerCardPreviewViewportEvents();
    state.cardPreviewOpenToken += 1;
    state.cardPreviewSessionData = null;
    if (activeCard instanceof HTMLElement) {
      const trigger = activeCard.querySelector(
        ".performer-tag-based-supporting-images__card-preview-trigger"
      );
      if (trigger instanceof HTMLElement) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (!preserveActiveCard) {
      state.cardPreviewActiveCard = null;
      state.cardPreviewActivePerformerId = "";
    }
  }

  function queuePerformerCardPreviewClose() {
    clearPerformerCardPreviewCloseTimer();
    state.cardPreviewCloseTimer = window.setTimeout(() => {
      closePerformerCardPreviewImmediate();
    }, CARD_PREVIEW_CLOSE_DELAY_MS);
  }

  function createPerformerCardPreviewCardCleanup(card) {
    function handleMouseEnter() {
      openPerformerCardPreview(card);
    }

    function handleMouseLeave() {
      queuePerformerCardPreviewClose();
    }

    function handleFocusIn() {
      openPerformerCardPreview(card);
    }

    function handleFocusOut(event) {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Element &&
        state.cardPreviewRoot?.contains(nextTarget)
      ) {
        return;
      }
      queuePerformerCardPreviewClose();
    }

    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);
    card.addEventListener("focusin", handleFocusIn);
    card.addEventListener("focusout", handleFocusOut);

    return () => {
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
      card.removeEventListener("focusin", handleFocusIn);
      card.removeEventListener("focusout", handleFocusOut);
    };
  }

  function createPerformerCardPreviewTrigger(card) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "performer-tag-based-supporting-images__card-preview-trigger";
    trigger.title = "Preview supporting images / next preview image";
    trigger.textContent = "[]";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("data-ptbsi-card-preview-trigger", "true");
    trigger.setAttribute(
      "aria-label",
      "Preview supporting images and advance preview images"
    );

    trigger.addEventListener("mouseenter", () => {
      openPerformerCardPreview(card);
    });
    trigger.addEventListener("mouseleave", () => {
      queuePerformerCardPreviewClose();
    });
    trigger.addEventListener("focusin", () => {
      openPerformerCardPreview(card);
    });
    trigger.addEventListener("focusout", (event) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Element &&
        state.cardPreviewRoot?.contains(nextTarget)
      ) {
        return;
      }
      queuePerformerCardPreviewClose();
    });
    trigger.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await cyclePerformerCardPreviewFromTrigger(card);
      } catch (err) {
        console.error(
          "[PerformerTagBasedSupportingImages] performer card preview cycle failed",
          err
        );
      }
    });

    return trigger;
  }

  function resetPerformerCardPreviewCardDecoration(card, options = {}) {
    const { removeClass = false } = options;
    const cleanup = cardPreviewCleanupMap.get(card);
    if (typeof cleanup === "function") {
      cleanup();
      cardPreviewCleanupMap.delete(card);
    }
    card
      .querySelectorAll(".performer-tag-based-supporting-images__card-preview-trigger")
      .forEach((trigger) => trigger.remove());
    card.removeAttribute("data-ptbsi-card-preview-bound");
    card.removeAttribute("data-ptbsi-card-preview-mode");
    if (removeClass) {
      card.classList.remove("ptbsi-card-preview-card");
    }
  }

  function cleanupPerformerCardPreviewTriggers() {
    document.querySelectorAll(".performer-card").forEach((card) => {
      if (!(card instanceof HTMLElement)) return;
      resetPerformerCardPreviewCardDecoration(card, { removeClass: true });
    });
  }

  function bindPerformerCardPreviewViewportEvents() {
    if (state.cardPreviewViewportBound) return;
    state.cardPreviewViewportBound = true;
    window.addEventListener("resize", handlePerformerCardPreviewViewportChange);
    window.addEventListener("scroll", handlePerformerCardPreviewViewportChange, true);
  }

  function getCardPreviewPanelPlacement(cardRect, cfg) {
    const viewportWidth = Math.max(
      180,
      window.innerWidth - CARD_PREVIEW_VIEWPORT_PAD * 2
    );
    const viewportHeight = Math.max(
      180,
      window.innerHeight - CARD_PREVIEW_VIEWPORT_PAD * 2
    );
    const desiredWidth = getCardPreviewPanelWidth(cfg);
    const desiredHeight = getCardPreviewPanelHeight(cfg);
    const spaceLeft = Math.max(
      0,
      cardRect.left - CARD_PREVIEW_GUTTER - CARD_PREVIEW_VIEWPORT_PAD
    );
    const spaceRight = Math.max(
      0,
      window.innerWidth - cardRect.right - CARD_PREVIEW_GUTTER - CARD_PREVIEW_VIEWPORT_PAD
    );
    const side = spaceRight >= spaceLeft ? "right" : "left";
    const sideSpace = side === "right" ? spaceRight : spaceLeft;

    let width;
    if (sideSpace > 0) {
      width = Math.min(desiredWidth, sideSpace);
      width = Math.max(Math.min(CARD_PREVIEW_MIN_PANEL_WIDTH, sideSpace), width);
    } else {
      width = Math.min(desiredWidth, viewportWidth);
    }

    const height = Math.min(desiredHeight, viewportHeight);
    const leftBase =
      side === "left"
        ? cardRect.left - width - CARD_PREVIEW_GUTTER
        : cardRect.right + CARD_PREVIEW_GUTTER;
    const left = Math.max(
      CARD_PREVIEW_VIEWPORT_PAD,
      Math.min(
        Math.round(leftBase),
        window.innerWidth - width - CARD_PREVIEW_VIEWPORT_PAD
      )
    );
    const top = Math.max(
      CARD_PREVIEW_VIEWPORT_PAD,
      Math.min(
        Math.round(cardRect.top),
        window.innerHeight - height - CARD_PREVIEW_VIEWPORT_PAD
      )
    );

    return { side, left, top, width, height };
  }

  function getCardPreviewSlotAspectRatio(slot) {
    return Math.max(0.35, getAspectRatioForMode(slot?.aspectMode));
  }

  function getCardPreviewJustifiedRowHeight(totalAspectRatio, itemCount, usableWidth) {
    if (!(totalAspectRatio > 0) || !(usableWidth > 0) || !(itemCount > 0)) {
      return CARD_PREVIEW_MIN_ROW_HEIGHT;
    }
    const widthAfterGaps =
      usableWidth - Math.max(0, itemCount - 1) * CARD_PREVIEW_TILE_GAP;
    if (!(widthAfterGaps > 0)) return CARD_PREVIEW_MIN_ROW_HEIGHT;
    return widthAfterGaps / totalAspectRatio;
  }

  function buildCardPreviewJustifiedRow(items, usableWidth) {
    const totalAspectRatio = items.reduce(
      (sum, item) => sum + item.aspectRatio,
      0
    );
    const rawRowHeight = getCardPreviewJustifiedRowHeight(
      totalAspectRatio,
      items.length,
      usableWidth
    );
    const rowHeight = Math.max(72, Math.round(rawRowHeight));
    const preferredPenalty =
      Math.max(0, CARD_PREVIEW_MIN_ROW_HEIGHT - rawRowHeight) +
      Math.max(0, rawRowHeight - CARD_PREVIEW_MAX_ROW_HEIGHT);

    return {
      height: rowHeight,
      preferredPenalty,
      items: items.map(({ slot, aspectRatio }) => ({
        slot,
        aspectRatio,
        height: rowHeight,
        width: Math.max(72, Math.round(rowHeight * aspectRatio)),
      })),
    };
  }

  function buildCardPreviewPreparedItems(slots) {
    return (Array.isArray(slots) ? slots : []).map((slot) => ({
      slot,
      aspectRatio: getCardPreviewSlotAspectRatio(slot),
    }));
  }

  function enumerateCardPreviewPartitions(items) {
    if (!items.length) return [[]];

    const partitions = [];

    function visit(startIndex, currentRows) {
      if (startIndex >= items.length) {
        partitions.push(currentRows.slice());
        return;
      }

      for (let endIndex = startIndex + 1; endIndex <= items.length; endIndex += 1) {
        currentRows.push(items.slice(startIndex, endIndex));
        visit(endIndex, currentRows);
        currentRows.pop();
      }
    }

    visit(0, []);
    return partitions;
  }

  function getCardPreviewLayoutTotalHeight(rows) {
    return (
      rows.reduce((sum, row) => sum + row.height, 0) +
      Math.max(0, rows.length - 1) * CARD_PREVIEW_TILE_GAP
    );
  }

  function buildCardPreviewJustifiedLayout(slots, panelWidth, panelHeight) {
    const preparedItems = buildCardPreviewPreparedItems(slots);
    const usableWidth = Math.max(120, panelWidth - CARD_PREVIEW_PANEL_PADDING * 2);
    const usableHeight = Math.max(120, panelHeight - CARD_PREVIEW_PANEL_PADDING * 2);
    const partitions = enumerateCardPreviewPartitions(preparedItems);

    let bestLayout = null;

    partitions.forEach((partition) => {
      const rows = partition.map((rowItems) =>
        buildCardPreviewJustifiedRow(rowItems, usableWidth)
      );
      const totalHeight = getCardPreviewLayoutTotalHeight(rows);
      const overflow = Math.max(0, totalHeight - usableHeight);
      const unusedHeight = Math.max(0, usableHeight - totalHeight);
      const heightDelta = Math.abs(totalHeight - usableHeight);
      const preferredPenalty = rows.reduce(
        (sum, row) => sum + row.preferredPenalty,
        0
      );
      const averageRowHeight = rows.length
        ? rows.reduce((sum, row) => sum + row.height, 0) / rows.length
        : 0;
      const candidate = {
        rows,
        overflow,
        unusedHeight,
        heightDelta,
        preferredPenalty,
        averageRowHeight,
      };

      if (!bestLayout) {
        bestLayout = candidate;
        return;
      }

      if (!!candidate.overflow !== !!bestLayout.overflow) {
        if (candidate.overflow < bestLayout.overflow) bestLayout = candidate;
        return;
      }

      if (candidate.heightDelta !== bestLayout.heightDelta) {
        if (candidate.heightDelta < bestLayout.heightDelta) bestLayout = candidate;
        return;
      }

      if (candidate.preferredPenalty !== bestLayout.preferredPenalty) {
        if (candidate.preferredPenalty < bestLayout.preferredPenalty) {
          bestLayout = candidate;
        }
        return;
      }

      if (candidate.overflow !== bestLayout.overflow) {
        if (candidate.overflow < bestLayout.overflow) bestLayout = candidate;
        return;
      }

      if (candidate.averageRowHeight > bestLayout.averageRowHeight) {
        bestLayout = candidate;
      }
    });

    if (!bestLayout) {
      return { rows: [] };
    }

    return bestLayout;
  }

  function hasPerformerCardPreviewMultiImageSlots(data) {
    return Array.isArray(data?.slots) && data.slots.some((slot) => (slot?.images?.length || 0) > 1);
  }

  function getPerformerCardPreviewTransitionClass(cfg) {
    return getSlotTransitionMs(cfg) > 0 ? "has-slot-transition" : "";
  }

  function advancePerformerCardPreviewSlots(delta) {
    const data = state.cardPreviewSessionData;
    if (!Array.isArray(data?.slots)) return false;

    let changed = false;
    data.slots.forEach((slot) => {
      const total = Number(slot?.images?.length || 0);
      if (total <= 1) return;
      const currentIndex = Number(slot.currentIndex || 0);
      const nextIndex = ((currentIndex + delta) % total + total) % total;
      if (nextIndex === currentIndex) return;
      slot.currentIndex = nextIndex;
      changed = true;
    });
    return changed;
  }

  function rerenderPerformerCardPreview() {
    const card = state.cardPreviewActiveCard;
    const data = state.cardPreviewSessionData;
    const cfg = state.config || {};
    if (!(card instanceof HTMLElement) || !card.isConnected || !data?.slots?.length) {
      closePerformerCardPreviewImmediate();
      return;
    }
    renderPerformerCardPreview(card, data, cfg);
  }

  function advancePerformerCardPreviewSlideshow() {
    if (document.hidden) return;
    if (advancePerformerCardPreviewSlots(1)) {
      rerenderPerformerCardPreview();
    }
  }

  function syncPerformerCardPreviewPlayback(cfg = state.config || {}) {
    stopPerformerCardPreviewSlideshow();
    const seconds = getSlotSlideshowSeconds(cfg);
    if (!(seconds > 0) || !hasPerformerCardPreviewMultiImageSlots(state.cardPreviewSessionData)) {
      return;
    }
    state.cardPreviewSlideshowTimer = window.setInterval(() => {
      advancePerformerCardPreviewSlideshow();
    }, seconds * 1000);
  }

  function createPerformerCardPreviewTile(slot, cfg, layoutMetrics = {}) {
    const image = slot.images[slot.currentIndex] || slot.images[0];
    const tile = document.createElement("div");
    tile.className = "performer-tag-based-supporting-images__card-preview-tile";
    if ((slot?.images?.length || 0) > 1) {
      tile.classList.add("performer-tag-based-supporting-images__card-preview-tile--multi-image");
    }

    const labelText = slot.customLabel || getSlotDisplayName(slot);
    const placeholderReason = slot?.missingTags?.length
      ? `Missing tag(s): ${slot.missingTags.join(", ")}`
      : "No matching supporting image";
    tile.title = slot?.isPlaceholder
      ? `${labelText}: ${placeholderReason}`
      : `${labelText}: ${slot.tagNames.join(", ") || "Supporting image"}`;

    const frame = document.createElement("div");
    frame.className =
      "performer-tag-based-supporting-images__card-preview-frame performer-tag-based-supporting-images__image-frame";
    if (slot?.isPlaceholder) {
      frame.classList.add("performer-tag-based-supporting-images__card-preview-frame--placeholder");
    }
    if (layoutMetrics.width > 0) {
      tile.style.width = `${layoutMetrics.width}px`;
    }
    if (layoutMetrics.height > 0) {
      frame.style.height = `${layoutMetrics.height}px`;
    }

    if (!image || slot?.isPlaceholder) {
      const placeholder = document.createElement("div");
      placeholder.className =
        "performer-tag-based-supporting-images__card-preview-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      frame.appendChild(placeholder);
      tile.appendChild(frame);
      return tile;
    }

    const img = document.createElement("img");
    img.className =
      "performer-tag-based-supporting-images__card-preview-image performer-tag-based-supporting-images__image";
    img.src = getImageUrl(image);
    img.alt = image.title || labelText || "Supporting image";

    const dimensions = getImageDimensions(image);
    const crop = getSavedCrop(slot.key, image);
    if (crop && dimensions) {
      frame.classList.add("performer-tag-based-supporting-images__image-frame--cropped");
      img.classList.add("performer-tag-based-supporting-images__image--cropped");
      const cropViewport = document.createElement("div");
      cropViewport.className =
        "performer-tag-based-supporting-images__image-crop-viewport";
      const cropAspectRatio = getCropAspectRatio(dimensions, crop);
      const viewportSize = getContainedCropViewportSize(
        cropAspectRatio,
        getAspectRatioForMode(slot.aspectMode)
      );
      cropViewport.style.width = viewportSize.width;
      cropViewport.style.height = viewportSize.height;
      applyCropPreview(img, crop);
      cropViewport.appendChild(img);
      frame.appendChild(cropViewport);
    } else {
      if (crop) {
        applyCropPreview(img, crop);
      }
      frame.appendChild(img);
    }
    tile.appendChild(frame);

    return tile;
  }

  function createPerformerCardPreviewPanel(slots, cfg, cardRect) {
    const descriptor = getCardPreviewPanelPlacement(cardRect, cfg);
    const layout = buildCardPreviewJustifiedLayout(
      slots,
      descriptor.width,
      descriptor.height
    );
    const panel = document.createElement("div");
    panel.className = "performer-tag-based-supporting-images__card-preview-panel";
    const transitionClass = getPerformerCardPreviewTransitionClass(cfg);
    if (transitionClass) {
      panel.classList.add(transitionClass);
    }
    panel.setAttribute("data-placement", descriptor.side);
    panel.style.left = `${descriptor.left}px`;
    panel.style.top = `${descriptor.top}px`;
    panel.style.width = `${descriptor.width}px`;
    panel.style.height = `${descriptor.height}px`;
    applyPanelVariables(panel, cfg);

    const slotsWrap = document.createElement("div");
    slotsWrap.className = "performer-tag-based-supporting-images__card-preview-slots";
    slotsWrap.style.rowGap = `${CARD_PREVIEW_TILE_GAP}px`;

    layout.rows.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "performer-tag-based-supporting-images__card-preview-row";
      rowEl.style.columnGap = `${CARD_PREVIEW_TILE_GAP}px`;
      row.items.forEach(({ slot, width, height }) => {
        const tile = createPerformerCardPreviewTile(slot, cfg, { width, height });
        tile.style.flex = `0 0 ${width}px`;
        rowEl.appendChild(tile);
      });
      slotsWrap.appendChild(rowEl);
    });

    panel.appendChild(slotsWrap);
    return panel;
  }

  function renderPerformerCardPreview(card, data, cfg) {
    if (!(card instanceof HTMLElement) || !data?.slots?.length) {
      closePerformerCardPreviewImmediate({ preserveActiveCard: true });
      return;
    }

    const root = ensurePerformerCardPreviewRoot();
    root.replaceChildren();

    const cardRect = card.getBoundingClientRect();
    const panel = createPerformerCardPreviewPanel(data.slots, cfg, cardRect);
    panel.addEventListener("mouseenter", () => {
      closePerformerCardPreviewImmediate({ preserveActiveCard: true });
    });
    root.appendChild(panel);

    bindPerformerCardPreviewViewportEvents();
    syncPerformerCardPreviewPlayback(cfg);
  }

  async function cyclePerformerCardPreviewFromTrigger(card) {
    if (!(card instanceof HTMLElement)) return;
    const cfg = state.config || (await loadConfig());
    if (getSlotSlideshowSeconds(cfg) > 0) {
      await openPerformerCardPreview(card);
      return;
    }

    const performerId = getPerformerIdFromCard(card);
    if (!performerId) return;

    const needsPreviewLoad =
      state.cardPreviewActiveCard !== card ||
      state.cardPreviewActivePerformerId !== performerId ||
      !Array.isArray(state.cardPreviewSessionData?.slots);

    if (needsPreviewLoad) {
      await openPerformerCardPreview(card);
    }

    if (!hasPerformerCardPreviewMultiImageSlots(state.cardPreviewSessionData)) {
      return;
    }

    clearPerformerCardPreviewCloseTimer();
    if (advancePerformerCardPreviewSlots(1)) {
      rerenderPerformerCardPreview();
    }
  }

  async function openPerformerCardPreview(card, options = {}) {
    const { forceRefresh = false } = options;
    if (!(card instanceof HTMLElement)) return;

    const performerId = getPerformerIdFromCard(card);
    if (!performerId) {
      closePerformerCardPreviewImmediate();
      return;
    }

    clearPerformerCardPreviewCloseTimer();
    state.cardPreviewActiveCard = card;
    state.cardPreviewActivePerformerId = performerId;
    const trigger = card.querySelector(
      ".performer-tag-based-supporting-images__card-preview-trigger"
    );
    if (trigger instanceof HTMLElement) {
      trigger.setAttribute("aria-expanded", "true");
    }
    const token = ++state.cardPreviewOpenToken;

    try {
      const cfg = state.config || (await loadConfig());
      if (forceRefresh) {
        state.cardPreviewDataCache.delete(String(performerId));
      }
      const data = await getPerformerCardPreviewData(performerId);
      if (
        token !== state.cardPreviewOpenToken ||
        state.cardPreviewActiveCard !== card ||
        !card.isConnected
      ) {
        return;
      }

      if (!data?.slots?.length) {
        closePerformerCardPreviewImmediate({ preserveActiveCard: true });
        return;
      }

      const nextSessionData = createPerformerCardPreviewSessionData(data, cfg);
      state.cardPreviewSessionData = syncExistingPerformerCardPreviewIndices(
        nextSessionData,
        state.cardPreviewSessionData
      );
      renderPerformerCardPreview(card, state.cardPreviewSessionData, cfg);
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] performer card preview failed", err);
      closePerformerCardPreviewImmediate({ preserveActiveCard: true });
    }
  }

  function handlePerformerCardPreviewViewportChange() {
    const card = state.cardPreviewActiveCard;
    if (!(card instanceof HTMLElement) || !card.isConnected || !state.cardPreviewSessionData?.slots?.length) {
      closePerformerCardPreviewImmediate();
      return;
    }

    const cfg = state.config || {};
    renderPerformerCardPreview(card, state.cardPreviewSessionData, cfg);
  }

  function decoratePerformerCards() {
    state.cardPreviewRefreshHandle = 0;

    if (state.config === null) {
      loadConfig().then(() => {
        schedulePerformerCardPreviewRefresh();
      });
      return;
    }

    if (!shouldEnablePerformerCardPreview()) {
      closePerformerCardPreviewImmediate();
      cleanupPerformerCardPreviewTriggers();
      return;
    }

    const hoverBehavior = getCardPreviewHoverBehavior(state.config || {});
    document.querySelectorAll(".performer-card").forEach((card) => {
      if (!(card instanceof HTMLElement)) return;
      if (card.closest(`#${PANEL_ID}`)) return;
      card.classList.add("ptbsi-card-preview-card");

      const desiredMode = hoverBehavior;
      const currentMode = card.getAttribute("data-ptbsi-card-preview-mode");
      const hasTrigger =
        card.querySelector(".performer-tag-based-supporting-images__card-preview-trigger") !==
        null;
      if (
        card.getAttribute("data-ptbsi-card-preview-bound") === "true" &&
        currentMode === desiredMode &&
        (desiredMode === "disabled" || hasTrigger)
      ) {
        return;
      }

      resetPerformerCardPreviewCardDecoration(card);

      const triggerHost =
        card.querySelector(".thumbnail-section") ||
        card.querySelector(".card-section") ||
        card;
      if (desiredMode === "badge" || desiredMode === "performer-card") {
        triggerHost.appendChild(createPerformerCardPreviewTrigger(card));
      }
      if (desiredMode === "performer-card") {
        cardPreviewCleanupMap.set(card, createPerformerCardPreviewCardCleanup(card));
      }
      card.setAttribute("data-ptbsi-card-preview-bound", "true");
      card.setAttribute("data-ptbsi-card-preview-mode", desiredMode);
    });
  }

  function schedulePerformerCardPreviewRefresh() {
    if (state.cardPreviewRefreshHandle) return;
    state.cardPreviewRefreshHandle = window.requestAnimationFrame(() => {
      decoratePerformerCards();
    });
  }

  function installPerformerCardPreviewObserver() {
    if (state.cardPreviewObserver || typeof MutationObserver !== "function") return;
    state.cardPreviewObserver = new MutationObserver(() => {
      if (
        state.cardPreviewActiveCard &&
        !state.cardPreviewActiveCard.isConnected
      ) {
        closePerformerCardPreviewImmediate();
      }
      if (
        shouldEnablePerformerCardPreview() ||
        (state.cardPreviewRoot && state.cardPreviewRoot.childElementCount > 0)
      ) {
        schedulePerformerCardPreviewRefresh();
      }
    });
    state.cardPreviewObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async function buildPanelData(performer, cfg) {
    let tagMap = await ensureTagMap();
    const selectionMode = getSelectionMode(cfg);
    const slots = getSlotConfigs(cfg);
    const configuredTagNames = slots.flatMap((slot) => slot.tagNames);

    const hasMissingConfiguredTags = configuredTagNames.some(
      (name) => !hasTagName(tagMap, name)
    );

    if (hasMissingConfiguredTags) {
      tagMap = await ensureTagMap({ forceRefresh: true });
    }

    const slotResults = await Promise.all(
      slots.map(async (slot) => {
        try {
          const { resolvedTags, missingTags, images } = await loadSlotMatches(
            slot,
            performer.id,
            tagMap,
            selectionMode
          );
          const tagIds = resolvedTags.resolvedTagIds;

          const { currentIndex, aspectMode } = buildLoadedSlotViewState(
            slot,
            performer.id,
            images,
            selectionMode,
            cfg
          );

          return {
            ...slot,
            performerId: performer.id,
            tagIds,
            configuredTagIds: resolvedTags.directTagIds,
            tagFilterItems: resolvedTags.tagFilterItems,
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
      performer,
      slots: slotResults,
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
    stopSlotSlideshow();
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

  function createCollapseToggleButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "performer-tag-based-supporting-images__panel-toggle";
    button.setAttribute("data-ptbsi-panel-toggle", "true");
    button.setAttribute(
      "aria-label",
      state.isCollapsed ? "Show supporting images panel" : "Hide supporting images panel"
    );
    button.title = state.isCollapsed
      ? "Show supporting images panel"
      : "Hide supporting images panel";
    button.textContent = state.isCollapsed ? "▴" : "▾";
    return button;
  }

  function createBackupButton(action, label, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "performer-tag-based-supporting-images__backup-button";
    button.setAttribute("data-ptbsi-backup", action);
    button.setAttribute("aria-label", title);
    button.title = title;
    button.textContent = label;
    return button;
  }

  function createPanelToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "performer-tag-based-supporting-images__toolbar";
    toolbar.appendChild(createCollapseToggleButton());
    toolbar.appendChild(
      createBackupButton("export", "Export", "Export crop and aspect backup JSON")
    );
    toolbar.appendChild(
      createBackupButton("import", "Import", "Import crop and aspect backup JSON")
    );
    return toolbar;
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

    if (getSavedCrop(slot.key, image)) {
      button.classList.add("is-active");
      button.title = "Edit saved crop";
    } else {
      button.title = "Crop preview";
    }

    return button;
  }

  function createCropFitAction(slot, image) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "performer-tag-based-supporting-images__crop-action performer-tag-based-supporting-images__crop-fit-action";
    button.setAttribute("data-ptbsi-crop-fit", "apply");
    button.setAttribute("data-ptbsi-slot-key", slot.key);
    button.setAttribute("data-ptbsi-image-id", String(image.id));
    button.setAttribute("aria-label", "Fit crop to slot aspect ratio");
    button.textContent = "Fit";

    if (doesImageCropFitSlot(slot, image)) {
      button.classList.add("is-active");
      button.title = "Crop already fits slot aspect";
    } else if (getSavedCrop(slot.key, image)) {
      button.title = "Fit existing crop to slot aspect";
    } else {
      button.title = "Create crop from slot aspect";
    }

    return button;
  }

  function createAspectAction(slot) {
    const mode = normalizeSlotAspectMode(slot.aspectMode);
    const locked = isSlotAspectLocked(slot.key);
    const label = document.createElement("button");
    label.type = "button";
    label.className = "performer-tag-based-supporting-images__aspect-action";
    if (locked) {
      label.classList.add("is-locked");
    }
    label.setAttribute("data-ptbsi-aspect-toggle", "lock");
    label.setAttribute("data-ptbsi-slot-key", slot.key);
    label.setAttribute("data-ptbsi-aspect-mode", mode);
    label.setAttribute("data-ptbsi-aspect-locked", locked ? "true" : "false");
    label.setAttribute("aria-pressed", locked ? "true" : "false");
    label.setAttribute("aria-label", getSlotAspectLockTitle(mode, locked));
    label.title = getSlotAspectLockTitle(mode, locked);
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
    if ((slot.images?.length || 0) > 1) {
      slotEl.classList.add("performer-tag-based-supporting-images__slot--multi-image");
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
    const crop = getSavedCrop(slot.key, image);
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
        const cropFitAction = createCropFitAction(slot, image);
        cropFitAction.classList.add(
          "performer-tag-based-supporting-images__slot-controls-crop"
        );
        leftGroup.appendChild(cropFitAction);
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
        const cropFitAction = createCropFitAction(slot, image);
        cropFitAction.classList.add(
          "performer-tag-based-supporting-images__slot-controls-crop"
        );
        controls.appendChild(cropFitAction);
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
    if (state.isCollapsed) {
      panel.classList.add("is-collapsed");
    }
    if (getSlotTransitionMs(cfg) > 0) {
      panel.classList.add("has-slot-transition");
    }
    panel.appendChild(createPanelToolbar());
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
    if (!nextPanel) {
      stopSlotSlideshow();
      return;
    }
    if (existing) existing.replaceWith(nextPanel);
    setupLoopingSlots(nextPanel, { viewportState });
    restorePanelViewportState(nextPanel, viewportState);
    updateFloatingPanelLayout();
  }

  function stopSlotSlideshow() {
    if (state.slotSlideshowTimer) {
      window.clearInterval(state.slotSlideshowTimer);
      state.slotSlideshowTimer = null;
    }
  }

  function hasSlideshowEligibleSlots() {
    return Array.isArray(state.panelData?.slots) &&
      state.panelData.slots.some((slot) => (slot?.images?.length || 0) > 1);
  }

  function advanceSlotSlideshow() {
    if (state.isInjecting || state.isCollapsed || state.cropEditor || document.hidden) {
      return;
    }

    const slots = Array.isArray(state.panelData?.slots) ? state.panelData.slots : [];
    let changed = false;

    slots.forEach((slot) => {
      const total = Number(slot?.images?.length || 0);
      if (total <= 1) return;

      const currentIndex = Number(slot.currentIndex || 0);
      const nextIndex = ((currentIndex + 1) % total + total) % total;
      if (nextIndex === currentIndex) return;

      slot.currentIndex = nextIndex;
      state.slotIndices.set(slot.key, nextIndex);
      changed = true;
    });

    if (changed) {
      rerenderPanel();
    }
  }

  function syncSlotSlideshow(cfg = state.config || {}) {
    stopSlotSlideshow();

    const seconds = getSlotSlideshowSeconds(cfg);
    if (!(seconds > 0) || !hasSlideshowEligibleSlots()) return;

    state.slotSlideshowTimer = window.setInterval(() => {
      advanceSlotSlideshow();
    }, seconds * 1000);
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
      const panelToggle = event.target.closest("[data-ptbsi-panel-toggle]");
      if (panelToggle) {
        event.preventDefault();
        event.stopPropagation();
        setCollapsedState(!state.isCollapsed);
        return;
      }

      const backupAction = event.target.closest("[data-ptbsi-backup]");
      if (backupAction) {
        event.preventDefault();
        event.stopPropagation();
        const action = backupAction.getAttribute("data-ptbsi-backup");
        if (action === "export") {
          exportLocalStateBackup();
        } else if (action === "import") {
          promptImportLocalStateBackup();
        }
        return;
      }

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

      const cropFitAction = event.target.closest("[data-ptbsi-crop-fit]");
      if (cropFitAction) {
        event.preventDefault();
        event.stopPropagation();
        const slotKey = cropFitAction.getAttribute("data-ptbsi-slot-key");
        const imageId = cropFitAction.getAttribute("data-ptbsi-image-id");
        const target = findSlotAndImage(slotKey, imageId);
        if (!target) return;
        const fittedCrop = getSlotFittedCrop(target.slot, target.image);
        if (!fittedCrop) return;
        const existingCrop = getSavedCrop(target.slot.key, target.image);
        if (!areCropsEquivalent(existingCrop, fittedCrop)) {
          setSavedCrop(target.slot.key, target.image, fittedCrop);
        }
        rerenderSlot(target.slot.key, {
          anchorElement: cropFitAction.closest("[data-ptbsi-slot-key]"),
        });
        return;
      }

      const aspectAction = event.target.closest("[data-ptbsi-aspect-toggle]");
      if (aspectAction) {
        event.preventDefault();
        event.stopPropagation();
        const slotKey = aspectAction.getAttribute("data-ptbsi-slot-key");
        if (!slotKey) return;
        toggleSlotAspectLocked(slotKey);
        rerenderSlot(slotKey, {
          anchorElement: aspectAction.closest("[data-ptbsi-slot-key]"),
        });
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
    if (state.navigationHooksInstalled) return;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const handlePopState = () =>
      window.dispatchEvent(new Event("ptbsi:navigation"));
    const handleNavigation = () => handleRouteChange();

    const wrappedPushState = function () {
      const result = originalPushState.apply(this, arguments);
      window.dispatchEvent(new Event("ptbsi:navigation"));
      return result;
    };

    const wrappedReplaceState = function () {
      const result = originalReplaceState.apply(this, arguments);
      window.dispatchEvent(new Event("ptbsi:navigation"));
      return result;
    };

    state.originalPushState = originalPushState;
    state.originalReplaceState = originalReplaceState;
    state.wrappedPushState = wrappedPushState;
    state.wrappedReplaceState = wrappedReplaceState;
    state.handlePopState = handlePopState;
    state.handleNavigation = handleNavigation;
    state.navigationHooksInstalled = true;

    history.pushState = wrappedPushState;
    history.replaceState = wrappedReplaceState;
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("ptbsi:navigation", handleNavigation);
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
    if (state.detailInteractionHandler) return;

    state.detailInteractionHandler = (event) => {
      if (!isPerformerPage()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const withinDetail =
        target.closest(".detail-header") ||
        target.closest(".detail-container");
      if (!withinDetail) return;

      scheduleLayoutRefresh();
    };

    document.addEventListener("click", state.detailInteractionHandler, true);
  }

  function installLayoutHandlers() {
    if (state.layoutHandlersInstalled) return;
    state.layoutHandlersInstalled = true;
    state.layoutScrollHandler = updateFloatingPanelLayout;
    state.layoutResizeHandler = updateFloatingPanelLayout;
    state.layoutChangedHandler = () => {
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
          syncSlotSlideshow(state.config || {});
        } else {
          stopSlotSlideshow();
        }
      }
      scheduleLayoutRefresh([0, 80, 180, 320, 500]);
    };
    window.addEventListener("scroll", state.layoutScrollHandler, { passive: true });
    window.addEventListener("resize", state.layoutResizeHandler);
    window.addEventListener(LAYOUT_CHANGED_EVENT, state.layoutChangedHandler);
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
      if (!host || !panel) {
        stopSlotSlideshow();
        return;
      }
      host.appendChild(panel);
      setupLoopingSlots(panel);
      state.panelKey = key;
      syncSlotSlideshow(cfg);
      updateFloatingPanelLayout();
    } catch (err) {
      console.error("[PerformerTagBasedSupportingImages] inject failed", err);
    } finally {
      state.isInjecting = false;
    }
  }

  function disposePluginInstance() {
    state.injectToken += 1;
    state.scheduledRouteToken += 1;
    state.scheduledLayoutToken += 1;

    if (state.observerTimer) {
      window.clearTimeout(state.observerTimer);
      state.observerTimer = null;
    }
    if (state.quickTagRefreshHandle) {
      window.cancelAnimationFrame(state.quickTagRefreshHandle);
      state.quickTagRefreshHandle = 0;
    }
    if (state.cardPreviewRefreshHandle) {
      window.cancelAnimationFrame(state.cardPreviewRefreshHandle);
      state.cardPreviewRefreshHandle = 0;
    }

    state.observer?.disconnect();
    state.resizeObserver?.disconnect();
    state.quickTagObserver?.disconnect();
    state.cardPreviewObserver?.disconnect();
    state.observer = null;
    state.resizeObserver = null;
    state.quickTagObserver = null;
    state.cardPreviewObserver = null;

    cleanupQuickTagMenus();
    closePerformerCardPreviewImmediate();
    state.cardPreviewRoot?.remove();
    state.cardPreviewRoot = null;
    cleanupPanel();

    if (state.detailInteractionHandler) {
      document.removeEventListener("click", state.detailInteractionHandler, true);
      state.detailInteractionHandler = null;
    }
    if (state.layoutScrollHandler) {
      window.removeEventListener("scroll", state.layoutScrollHandler);
      state.layoutScrollHandler = null;
    }
    if (state.layoutResizeHandler) {
      window.removeEventListener("resize", state.layoutResizeHandler);
      state.layoutResizeHandler = null;
    }
    if (state.layoutChangedHandler) {
      window.removeEventListener(LAYOUT_CHANGED_EVENT, state.layoutChangedHandler);
      state.layoutChangedHandler = null;
    }
    if (state.navigationHooksInstalled) {
      window.removeEventListener("popstate", state.handlePopState);
      window.removeEventListener("ptbsi:navigation", state.handleNavigation);
      if (history.pushState === state.wrappedPushState) {
        history.pushState = state.originalPushState;
      }
      if (history.replaceState === state.wrappedReplaceState) {
        history.replaceState = state.originalReplaceState;
      }
      state.navigationHooksInstalled = false;
    }
  }

  function handleRouteChange() {
    const path = window.location.pathname;
    if (path === state.lastPath) return;
    state.lastPath = path;
    closeCropEditor();
    closeOtherQuickTagMenus(null);
    closePerformerCardPreviewImmediate();
    state.scheduledLayoutToken += 1;
    refreshObservedElements();
    scheduleRouteInjection();
    scheduleQuickTagRefresh();
    schedulePerformerCardPreviewRefresh();
  }

  function init() {
    const previousCleanup = window.__ptbsiInstanceCleanup;
    if (typeof previousCleanup === "function") {
      previousCleanup();
    }
    window.__ptbsiInstanceCleanup = disposePluginInstance;

    installNavigationHooks();
    installObserver();
    installResizeObserver();
    installQuickTagObserver();
    installPerformerCardPreviewObserver();
    installDetailInteractionHook();
    installLayoutHandlers();
    state.lastPath = window.location.pathname;
    if (isPerformerPage()) {
      refreshObservedElements();
      scheduleRouteInjection();
    }
    scheduleQuickTagRefresh();
    schedulePerformerCardPreviewRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
