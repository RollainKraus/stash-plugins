(function () {
  "use strict";

  const PLUGIN_ID = "EditTagsOverhaul";
  const PANEL_ID = "kmv-edit-tags-overhaul";
  const STYLE_HIDE_ID = "kmv-edit-tags-overhaul-hide-original";
  const HOVER_PREVIEW_ID = "edit-tags-overhaul-hover-preview";
  const TIMELINE_OVERLAY_ID = "edit-tags-overhaul-timeline-overlay";
  const TAG_CLIPBOARD_STORAGE_KEY = "EditTagsOverhaul.tagClipboard";
  const TIMELINE_MARKERS_STORAGE_KEY = "EditTagsOverhaul.timelineMarkers";
  const TIMELINE_TAG_COLORS_STORAGE_KEY = "EditTagsOverhaul.timelineTagColors";
  const TIMELINE_PALETTE_LAYOUT_STORAGE_KEY = "EditTagsOverhaul.timelinePaletteLayout";
  const QUICK_TAG_OVERLAY_OPEN_STORAGE_KEY = "EditTagsOverhaul.quickTagOverlayOpen";
  const FULLSCREEN_LAYOUT_STORAGE_KEY = "EditTagsOverhaul.fullscreenQuickTagLayout";
  const FULLSCREEN_MINI_PANELS_STORAGE_KEY = "EditTagsOverhaul.fullscreenMiniPanels";
  const ROUTE_EVENT = "edit-tags-overhaul:navigation";
  const ROUTE_HOOK_STATE_KEY = "__editTagsOverhaulRouteHooks";
  const CLEANUP_KEY = "__editTagsOverhaulCleanup";
  const ROUTE_RETRY_DELAYS = [0, 200, 600, 1200, 2000, 3500];
  const TIMELINE_MARKER_GAP_SECONDS = 0.1;
  const TIMELINE_MARKER_MIN_WIDTH_PX = 56;
  const FULLSCREEN_SCALE_STEPS = [0.75, 0.85, 1, 1.15, 1.3];
  const DEFAULT_FULLSCREEN_PANEL_LAYOUT = {
    width: 420,
    height: 520,
    scale: 1,
    minimized: false,
  };
  const DEFAULT_FULLSCREEN_MINI_PANEL_LAYOUT = {
    width: 320,
    height: 400,
  };
  const SUPPLEMENTAL_IMAGE_KEYS = [
    "ctm_supplemental_image_1",
    "ctm_supplemental_image_2",
  ];

  const ENTITY_CONFIG = {
    scene: {
      routeRegex: /^\/scenes\/(\d+)/,
      editContainerId: "scene-edit-details",
      findQuery: `
        query FindSceneForEditTagsOverhaul($id: ID!) {
          findScene(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findScene?.tags || [],
      updateMutation: `
        mutation UpdateSceneTags($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      updateMutationKey: "sceneUpdate",
    },

    gallery: {
      routeRegex: /^\/galleries\/(\d+)/,
      editContainerId: "gallery-edit-details",
      findQuery: `
        query FindGalleryForEditTagsOverhaul($id: ID!) {
          findGallery(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findGallery?.tags || [],
      updateMutation: `
        mutation UpdateGalleryTags($input: GalleryUpdateInput!) {
          galleryUpdate(input: $input) {
            id
          }
        }
      `,
      updateMutationKey: "galleryUpdate",
    },

    image: {
      routeRegex: /^\/images\/(\d+)/,
      editContainerId: "image-edit-details",
      findQuery: `
        query FindImageForEditTagsOverhaul($id: ID!) {
          findImage(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findImage?.tags || [],
      updateMutation: `
        mutation UpdateImageTags($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      updateMutationKey: "imageUpdate",
    },
  };

  const state = {
    currentEntity: null,
    selectedTagIds: new Set(),
    allTags: null,
    config: null,
    isSaving: false,
    injectedForEntityKey: null,
    loadedSelectionEntityKey: null,
    lastPath: "",
    isInjecting: false,
    injectToken: 0,
    scheduledRouteToken: 0,
    currentSearchQuery: "",
    searchIndex: null,
    tagMap: new Map(),
    supplementalImages: new Map(),
    supplementalImagePromises: new Map(),
    hoverTagId: "",
    hoverAnchorRect: null,
    routeEventListener: null,
    tabClickListener: null,
    scrollListener: null,
    resizeListener: null,
    fullscreenChangeListener: null,
    timelineVideo: null,
    timelineVideoListener: null,
    timelineDurationRetry: null,
    timelineDragState: null,
    timelineResizeState: null,
    timelineTimeBadge: null,
    timelineSuppressClick: false,
    timelineRetryCount: 0,
    timelinePaletteOpen: false,
    timelinePaletteColorEditMode: false,
    timelinePaletteLayout: null,
    timelinePaletteDragState: null,
    timelinePairHoverTimer: null,
    timelinePairPointer: { x: -1, y: -1 },
    timelineSceneDurationCache: new Map(),
    fullscreen: {
      root: null,
      launcher: null,
      panel: null,
      resizeObserver: null,
      miniPanels: new Map(),
      miniResizeObservers: new Map(),
      groups: [],
      groupMap: new Map(),
      entityKey: "",
      isBuilding: false,
      dragState: null,
    },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeSupplementalImageId(value) {
    const digits = String(value ?? "").trim().replace(/[^\d]/g, "");
    return digits || "";
  }

  function getSupplementalImageValue(customFields, key) {
    return normalizeSupplementalImageId(customFields?.[key]);
  }

  function getSupplementalImageIdsForTag(tag) {
    return SUPPLEMENTAL_IMAGE_KEYS.map((key) => getSupplementalImageValue(tag?.custom_fields || {}, key)).filter(Boolean);
  }

  function getSupplementalImagePath(imageRecord) {
    return String(imageRecord?.paths?.thumbnail || imageRecord?.paths?.image || imageRecord?.thumbnail || imageRecord?.image_path || "").trim();
  }

  function extractDescriptionPreview(text) {
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(0, 3).join("\n");
  }

  function readTagClipboard() {
    try {
      const raw = window.localStorage.getItem(TAG_CLIPBOARD_STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      const tagIds = Array.isArray(parsed?.tagIds)
        ? parsed.tagIds.map((id) => String(id)).filter(Boolean)
        : [];
      const tags = Array.isArray(parsed?.tags)
        ? parsed.tags
            .map((tag) => ({
              id: String(tag?.id || "").trim(),
              name: String(tag?.name || "").trim(),
            }))
            .filter((tag) => tag.id && tag.name)
        : [];

      if (!tagIds.length || !tags.length) return null;

      return {
        tagIds: Array.from(new Set(tagIds)),
        tags,
        copiedAt: String(parsed?.copiedAt || ""),
      };
    } catch (err) {
      console.error("[EditTagsOverhaul] clipboard read failed", err);
      return null;
    }
  }

  function writeTagClipboard(clipboard) {
    try {
      window.localStorage.setItem(
        TAG_CLIPBOARD_STORAGE_KEY,
        JSON.stringify(clipboard)
      );
    } catch (err) {
      console.error("[EditTagsOverhaul] clipboard write failed", err);
    }
  }

  function readTimelineMarkerStore() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(TIMELINE_MARKERS_STORAGE_KEY) || "{}");
      return {
        version: 1,
        scenes: parsed?.scenes && typeof parsed.scenes === "object" ? parsed.scenes : {},
      };
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline marker read failed", err);
      return { version: 1, scenes: {} };
    }
  }

  function writeTimelineMarkerStore(store) {
    try {
      window.localStorage.setItem(
        TIMELINE_MARKERS_STORAGE_KEY,
        JSON.stringify({ version: 1, scenes: store?.scenes || {} })
      );
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline marker write failed", err);
    }
  }

  function normalizeTimelineTagColors(rawColors) {
    const colors = {};
    if (!rawColors || typeof rawColors !== "object" || Array.isArray(rawColors)) return colors;

    Object.entries(rawColors).forEach(([tagId, color]) => {
      const normalizedTagId = String(tagId || "").trim();
      const normalizedColor = normalizeCustomFieldValue(color);
      if (!normalizedTagId || !isCssColorLike(normalizedColor)) return;
      colors[normalizedTagId] = normalizedColor;
    });
    return colors;
  }

  function readTimelineTagColors() {
    try {
      return normalizeTimelineTagColors(JSON.parse(window.localStorage.getItem(TIMELINE_TAG_COLORS_STORAGE_KEY) || "{}"));
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline tag colors read failed", err);
      return {};
    }
  }

  function writeTimelineTagColors(colors) {
    try {
      window.localStorage.setItem(TIMELINE_TAG_COLORS_STORAGE_KEY, JSON.stringify(normalizeTimelineTagColors(colors)));
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline tag colors write failed", err);
    }
  }

  function setTimelineTagColor(tagId, color) {
    const normalizedTagId = String(tagId || "").trim();
    if (!normalizedTagId) return false;

    const colors = readTimelineTagColors();
    const normalizedColor = normalizeCustomFieldValue(color);
    if (isCssColorLike(normalizedColor)) colors[normalizedTagId] = normalizedColor;
    else delete colors[normalizedTagId];
    writeTimelineTagColors(colors);
    requestTimelineOverlaySync();
    syncRenderedSelectionStates();
    return true;
  }

  function promptTimelineTagColor(tagId) {
    const normalizedTagId = String(tagId || "").trim();
    const tagRecord = getTagRecordById(normalizedTagId);
    if (!normalizedTagId || !tagRecord) return;

    const input = document.createElement("input");
    input.type = "color";
    input.value = getTimelineMarkerRawColor(normalizedTagId) || "#ffffff";
    input.style.position = "fixed";
    input.style.left = "-1000px";
    input.style.top = "-1000px";
    input.addEventListener("change", () => {
      setTimelineTagColor(normalizedTagId, input.value);
      input.remove();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
    window.setTimeout(() => input.remove(), 60000);
  }

  function readTimelinePaletteLayout() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(TIMELINE_PALETTE_LAYOUT_STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object") return null;
      if (!["left", "top", "width", "height"].every((key) => Number.isFinite(Number(parsed[key])))) return null;
      return {
        left: Number.isFinite(Number(parsed.left)) ? Number(parsed.left) : null,
        top: Number.isFinite(Number(parsed.top)) ? Number(parsed.top) : null,
        width: Number.isFinite(Number(parsed.width)) ? Number(parsed.width) : null,
        height: Number.isFinite(Number(parsed.height)) ? Number(parsed.height) : null,
      };
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline palette layout read failed", err);
      return null;
    }
  }

  function writeTimelinePaletteLayout(layout) {
    try {
      window.localStorage.setItem(TIMELINE_PALETTE_LAYOUT_STORAGE_KEY, JSON.stringify(layout || {}));
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline palette layout write failed", err);
    }
  }

  function clearTimelinePaletteLayout() {
    try {
      window.localStorage.removeItem(TIMELINE_PALETTE_LAYOUT_STORAGE_KEY);
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline palette layout reset failed", err);
    }
    state.timelinePaletteLayout = null;
    state.timelinePaletteDragState = null;
  }

  function normalizeTimelineMarkerStore(rawStore) {
    const rawScenes = rawStore?.scenes && typeof rawStore.scenes === "object" ? rawStore.scenes : {};
    const scenes = {};

    Object.entries(rawScenes).forEach(([sceneId, scene]) => {
      const normalizedSceneId = String(scene?.sceneId || sceneId);
      const markers = Array.isArray(scene?.markers)
        ? scene.markers
          .filter((marker) => marker && marker.tagId !== undefined && Number.isFinite(Number(marker.seconds)))
          .map((marker) => ({
            ...marker,
            id: String(marker.id || `${marker.tagId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            tagId: String(marker.tagId),
            tagName: String(marker.tagName || "Tag"),
            seconds: Math.max(0, Number(marker.seconds) || 0),
            endSeconds: Number.isFinite(Number(marker.endSeconds)) ? Math.max(0, Number(marker.endSeconds)) : null,
          }))
        : [];
      if (!markers.length) return;
      scenes[normalizedSceneId] = {
        sceneId: normalizedSceneId,
        updatedAt: String(scene?.updatedAt || new Date().toISOString()),
        markers,
      };
    });

    return { version: 1, scenes };
  }

  function getTimelineMarkerStoreStats(store = readTimelineMarkerStore()) {
    const scenes = store?.scenes && typeof store.scenes === "object" ? store.scenes : {};
    const sceneCount = Object.keys(scenes).length;
    const markerCount = Object.values(scenes).reduce((total, scene) => {
      return total + (Array.isArray(scene?.markers) ? scene.markers.length : 0);
    }, 0);
    return { sceneCount, markerCount };
  }

  function exportTimelineMarkers() {
    const store = normalizeTimelineMarkerStore(readTimelineMarkerStore());
    const timelineTagColors = readTimelineTagColors();
    const stats = getTimelineMarkerStoreStats(store);
    const payload = {
      plugin: PLUGIN_ID,
      type: "timelineMarkers",
      exportedAt: new Date().toISOString(),
      version: 1,
      sceneCount: stats.sceneCount,
      markerCount: stats.markerCount,
      timelineTagColorCount: Object.keys(timelineTagColors).length,
      timelineTagColors,
      scenes: store.scenes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = `edit-tags-overhaul-timeline-markers-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function mergeTimelineMarkerStores(existingStore, importedStore) {
    const merged = normalizeTimelineMarkerStore(existingStore);
    const imported = normalizeTimelineMarkerStore(importedStore);

    Object.entries(imported.scenes).forEach(([sceneId, scene]) => {
      const existingMarkers = Array.isArray(merged.scenes[sceneId]?.markers)
        ? merged.scenes[sceneId].markers
        : [];
      const markerKeys = new Set(existingMarkers.map((marker) => {
        return [marker.tagId, Number(marker.seconds || 0).toFixed(3), Number(marker.endSeconds || 0).toFixed(3)].join("|");
      }));
      const nextMarkers = [...existingMarkers];
      scene.markers.forEach((marker) => {
        const key = [marker.tagId, Number(marker.seconds || 0).toFixed(3), Number(marker.endSeconds || 0).toFixed(3)].join("|");
        if (markerKeys.has(key)) return;
        markerKeys.add(key);
        nextMarkers.push(marker);
      });
      nextMarkers.sort((a, b) => Number(a.seconds || 0) - Number(b.seconds || 0));
      merged.scenes[sceneId] = {
        sceneId,
        updatedAt: new Date().toISOString(),
        markers: nextMarkers,
      };
    });

    return merged;
  }

  function mergeTimelineTagColors(existingColors, importedColors) {
    return {
      ...normalizeTimelineTagColors(existingColors),
      ...normalizeTimelineTagColors(importedColors),
    };
  }

  async function importTimelineMarkersFromFile(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = normalizeTimelineMarkerStore(parsed);
      const importedColors = normalizeTimelineTagColors(parsed?.timelineTagColors);
      const stats = getTimelineMarkerStoreStats(imported);
      const colorCount = Object.keys(importedColors).length;
      if (!stats.markerCount && !colorCount) {
        window.alert?.("No timeline markers or tag colors found in this file.");
        return;
      }

      const replace = window.confirm?.(
        `Import ${stats.markerCount} timeline markers across ${stats.sceneCount} scenes and ${colorCount} tag colors?\n\nOK = replace all local timeline markers and colors.\nCancel = merge with existing local markers and colors.`
      );
      const nextStore = replace
        ? imported
        : mergeTimelineMarkerStores(readTimelineMarkerStore(), imported);
      const nextColors = replace
        ? importedColors
        : mergeTimelineTagColors(readTimelineTagColors(), importedColors);
      writeTimelineMarkerStore(nextStore);
      writeTimelineTagColors(nextColors);
      requestTimelineOverlaySync();
      const nextStats = getTimelineMarkerStoreStats(nextStore);
      window.alert?.(`Timeline markers imported. ${nextStats.markerCount} markers across ${nextStats.sceneCount} scenes and ${Object.keys(nextColors).length} tag colors are now stored locally.`);
    } catch (err) {
      console.error("[EditTagsOverhaul] timeline marker import failed", err);
      window.alert?.("Timeline marker import failed. Make sure the selected file is a valid Edit Tags Overhaul timeline marker export.");
    }
  }

  function promptImportTimelineMarkers() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      importTimelineMarkersFromFile(file);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  }

  function getSceneTimelineMarkers(sceneId) {
    const scene = readTimelineMarkerStore().scenes?.[String(sceneId)];
    return Array.isArray(scene?.markers) ? scene.markers : [];
  }

  function writeSceneTimelineMarkers(sceneId, markers) {
    const store = readTimelineMarkerStore();
    const normalizedSceneId = String(sceneId);
    const cleanedMarkers = Array.isArray(markers) ? markers : [];

    if (!cleanedMarkers.length) {
      delete store.scenes[normalizedSceneId];
    } else {
      store.scenes[normalizedSceneId] = {
        sceneId: normalizedSceneId,
        updatedAt: new Date().toISOString(),
        markers: cleanedMarkers,
      };
    }

    writeTimelineMarkerStore(store);
  }

  function getSortedClipboardTags(tagIds) {
    const tags = Array.from(tagIds)
      .map((tagId) => {
        const tag = state.tagMap.get(String(tagId));
        if (!tag) return null;
        return {
          id: String(tag.id),
          name: String(tag.name || ""),
          sort_name: String(tag.sort_name || tag.name || ""),
        };
      })
      .filter(Boolean);

    tags.sort((a, b) => {
      const aKey = (a.sort_name || a.name || "").toLowerCase();
      const bKey = (b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    return tags.map(({ id, name }) => ({ id, name }));
  }

  function buildClipboardPayloadFromSelection() {
    const tags = getSortedClipboardTags(state.selectedTagIds);
    if (!tags.length) return null;

    return {
      tagIds: tags.map((tag) => tag.id),
      tags,
      copiedAt: new Date().toISOString(),
    };
  }

  function getAvailableClipboardTagIds(clipboard) {
    if (!clipboard || !Array.isArray(clipboard.tagIds)) return [];
    return clipboard.tagIds.filter((tagId) => state.tagMap.has(String(tagId)));
  }

  async function loadConfig() {
    if (state.config) return state.config;

    try {
      const data = await gql(`
        query {
          configuration {
            plugins
          }
        }
      `);
      state.config = data?.configuration?.plugins?.[PLUGIN_ID] || {};
    } catch (err) {
      console.error("[EditTagsOverhaul] config load failed", err);
      state.config = {};
    }

    return state.config;
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

  function isFullscreenQuickTagPanelEnabled(cfg) {
    return getConfigBoolean(cfg?.enableQuickTagPanelOverlay, true);
  }

  function shouldAutoOpenFullscreenQuickTagPanel(cfg) {
    return getConfigBoolean(cfg?.autoOpenQuickTagPanelOverlay, false);
  }

  function getFullscreenButtonPosition(cfg) {
    const normalized = String(cfg?.quickTagPanelButtonPosition ?? "bottomright")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    return ["topright", "topleft", "bottomleft", "bottomright"].includes(normalized)
      ? normalized
      : "bottomright";
  }

  function getFullscreenIdleOpacity(cfg) {
    const parsed = Number(cfg?.quickTagPanelIdleOpacity);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0.1;
    return Math.min(1, Math.max(0.02, parsed));
  }

  function shouldRefreshSceneUIAfterSave(cfg) {
    return getConfigBoolean(cfg?.refreshSceneUIAfterSave, false);
  }

  function shouldUseFullscreenSharedHover(cfg) {
    return getConfigBoolean(cfg?.quickTagPanelSharedHover, false);
  }

  function isTagTimelineOverlayEnabled(cfg) {
    return getConfigBoolean(cfg?.enableTagTimelineOverlay, false);
  }

  function getDisplayMode(cfg) {
    const value = String(cfg.displayMode || "text").trim();
    if (value === "image") return "image";
    if (value === "imageAndText") return "imageAndText";
    return "text";
  }

  function getImageSize(cfg) {
    const raw = String(cfg.imageSize || "").trim();
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 24 && parsed <= 256) return parsed;
    return 52;
  }

  function getSelectedBorderColor(cfg) {
    const value = String(cfg.selectedBorderColor || "").trim();
    return value || "#ffffff";
  }

  function applyPanelVariables(panel, cfg) {
    const imageSize = getImageSize(cfg);
    const stackedImageSize = Math.max(24, imageSize);
    const imageOnlySize = Math.max(24, Math.round(imageSize * 1.2));
    const borderColor = getSelectedBorderColor(cfg);

    panel.style.setProperty("--eto-image-size", `${stackedImageSize}px`);
    panel.style.setProperty("--eto-image-only-size", `${imageOnlySize}px`);
    panel.style.setProperty("--eto-selected-border-color", borderColor);
  }

  async function gql(query, variables = {}) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }

    return json.data;
  }

  async function fetchAllTags() {
    if (state.allTags) return state.allTags;

    const data = await gql(`
      query {
        findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
          tags {
            id
            name
            sort_name
            description
            image_path
            custom_fields
            children {
              id
            }
            parents {
              id
              name
              sort_name
              parents {
                id
                name
                sort_name
              }
            }
          }
        }
      }
    `);

    state.allTags = data?.findTags?.tags || [];
    state.tagMap = new Map(
      state.allTags.map((tag) => [
        String(tag.id),
        {
          ...tag,
          id: String(tag.id),
          description: tag.description || "",
          custom_fields: tag.custom_fields || {},
          image_path: tag.image_path || "",
        },
      ])
    );
    return state.allTags;
  }

  function getEntityFromPath(pathname) {
    for (const [type, cfg] of Object.entries(ENTITY_CONFIG)) {
      const match = pathname.match(cfg.routeRegex);
      if (match) return { type, id: match[1] };
    }
    return null;
  }

  function isSupportedEntityPage() {
    return !!getEntityFromPath(window.location.pathname);
  }

  function getCurrentEntityKey(entity) {
    return entity ? `${entity.type}:${entity.id}` : null;
  }

  function getEditContainer(entityType) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return null;
    return document.getElementById(cfg.editContainerId);
  }

  function getOriginalTagSelectFormGroup(entityType) {
    const edit = getEditContainer(entityType);
    if (!edit) return null;

    const tagSelect = edit.querySelector(".tag-select");
    if (!tagSelect) return null;

    return tagSelect.closest(".form-group");
  }

  function injectHideOriginalStyle() {
    if (document.getElementById(STYLE_HIDE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_HIDE_ID;
    style.textContent = `
      #scene-edit-details .form-group:has(.tag-select),
      #gallery-edit-details .form-group:has(.tag-select),
      #image-edit-details .form-group:has(.tag-select) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function removeHideOriginalStyle() {
    const el = document.getElementById(STYLE_HIDE_ID);
    if (el) el.remove();
  }

  function cleanupPanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    hideHoverPreview();
    state.injectedForEntityKey = null;
  }

  function getHoverPreviewHost() {
    let host = document.getElementById(HOVER_PREVIEW_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOVER_PREVIEW_ID;
    host.className = "edit-tags-overhaul-hover-preview";
    host.setAttribute("aria-hidden", "true");
    document.body.appendChild(host);
    return host;
  }

  function positionHoverPreview(anchorRect) {
    const host = getHoverPreviewHost();
    if (!(host instanceof HTMLElement) || !anchorRect) return;

    const previewWidth = Math.min(540, Math.max(320, Math.floor(window.innerWidth * 0.32)));
    host.style.maxWidth = `${previewWidth}px`;

    const margin = 14;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = host.getBoundingClientRect();
    let left = anchorRect.right + 12;
    let top = anchorRect.top;

    if (left + rect.width + margin > viewportWidth) {
      left = Math.max(margin, anchorRect.left - rect.width - 12);
    }
    if (top + rect.height + margin > viewportHeight) {
      top = Math.max(margin, viewportHeight - rect.height - margin);
    }
    if (top < margin) top = margin;

    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  function hideHoverPreview() {
    const host = document.getElementById(HOVER_PREVIEW_ID);
    if (host) {
      host.classList.remove("is-visible", "is-loading");
      host.setAttribute("aria-hidden", "true");
      host.innerHTML = "";
    }
    state.hoverTagId = "";
    state.hoverAnchorRect = null;
  }

  function showHoverPreviewLoading(anchorRect) {
    const host = getHoverPreviewHost();
    host.innerHTML =
      '<div class="edit-tags-overhaul-hover-preview__card edit-tags-overhaul-hover-preview__card--loading">Loading tag preview...</div>';
    host.classList.add("is-visible", "is-loading");
    host.setAttribute("aria-hidden", "false");
    positionHoverPreview(anchorRect);
  }

  async function ensureSupplementalImagesLoaded(imageIds = []) {
    const ids = Array.from(
      new Set(
        (imageIds || [])
          .map(normalizeSupplementalImageId)
          .filter(Boolean)
      )
    );
    if (!ids.length) return false;

    const uncached = ids.filter((imageId) => !state.supplementalImages.has(imageId));
    if (!uncached.length) return false;

    const requestKey = uncached.slice().sort().join(",");
    if (state.supplementalImagePromises.has(requestKey)) {
      return state.supplementalImagePromises.get(requestKey);
    }

    const request = gql(
      `
        query EditTagsOverhaulSupplementalImages($image_ids: [Int!]) {
          findImages(image_ids: $image_ids, filter: { per_page: -1 }) {
            images {
              id
              paths {
                thumbnail
                image
              }
            }
          }
        }
      `,
      { image_ids: uncached.map((id) => Number(id)).filter(Number.isFinite) }
    )
      .then((data) => {
        const foundMap = new Map(
          (data?.findImages?.images || []).map((image) => [String(image.id), image])
        );
        uncached.forEach((imageId) => {
          state.supplementalImages.set(imageId, foundMap.get(imageId) || null);
        });
        return true;
      })
      .catch((err) => {
        console.error("[EditTagsOverhaul] supplemental image lookup failed", err);
        uncached.forEach((imageId) => {
          state.supplementalImages.set(imageId, null);
        });
        return false;
      })
      .finally(() => {
        state.supplementalImagePromises.delete(requestKey);
      });

    state.supplementalImagePromises.set(requestKey, request);
    return request;
  }

  function renderHoverPreview(tagRecord) {
    const supplementalIds = getSupplementalImageIdsForTag(tagRecord);
    const supplemental1Path = supplementalIds[0]
      ? getSupplementalImagePath(state.supplementalImages.get(supplementalIds[0]))
      : "";
    const primaryImage = String(tagRecord?.image_path || "").trim();
    const supplemental2Path = supplementalIds[1]
      ? getSupplementalImagePath(state.supplementalImages.get(supplementalIds[1]))
      : "";

    const images = [
      supplemental1Path
        ? { path: supplemental1Path, label: "Supplemental image 1" }
        : null,
      primaryImage
        ? { path: primaryImage, label: tagRecord?.name || "Tag image" }
        : null,
      supplemental2Path
        ? { path: supplemental2Path, label: "Supplemental image 2" }
        : null,
    ].filter(Boolean);

    const description = extractDescriptionPreview(tagRecord?.description || "");

    return `
      <div class="edit-tags-overhaul-hover-preview__card">
        <div class="edit-tags-overhaul-hover-preview__title">${escapeHtml(tagRecord?.name || "Tag")}</div>
        <div class="edit-tags-overhaul-hover-preview__image-row">
          ${
            images.length
              ? images
                  .map(
                    (image) => `
                      <div class="edit-tags-overhaul-hover-preview__image-frame">
                        <img src="${escapeHtml(image.path)}" alt="${escapeHtml(image.label)}" />
                      </div>
                    `
                  )
                  .join("")
              : '<div class="edit-tags-overhaul-hover-preview__image-empty">No tag image</div>'
          }
        </div>
        ${
          description
            ? `<div class="edit-tags-overhaul-hover-preview__description">${escapeHtml(description)}</div>`
            : ""
        }
      </div>
    `;
  }

  function getTagRecordById(tagId) {
    return state.tagMap.get(String(tagId)) || null;
  }

  function getCustomFieldValue(customFields, key) {
    if (typeof customFields === "string") {
      const trimmed = customFields.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return getCustomFieldValue(JSON.parse(trimmed), key);
        } catch (error) {
          return "";
        }
      }
      return "";
    }

    if (Array.isArray(customFields)) {
      const targetKey = String(key).toLowerCase();
      for (const entry of customFields) {
        if (Array.isArray(entry)) {
          if (String(entry[0] ?? "").toLowerCase() === targetKey) return entry[1] ?? "";
          continue;
        }
        if (!entry || typeof entry !== "object") continue;
        const fieldNames = [
          entry.id ??
          "",
          entry.key,
          entry.name,
          entry.field_name,
          entry.fieldName,
          typeof entry.field === "string" ? entry.field : "",
          entry.field?.key,
          entry.field?.id,
          entry.field?.name,
          typeof entry.customField === "string" ? entry.customField : "",
          entry.customField?.key,
          entry.customField?.id,
          entry.customField?.name,
        ].filter((name) => name !== undefined && name !== null && String(name).trim() !== "");
        if (fieldNames.some((fieldName) => String(fieldName).toLowerCase() === targetKey)) {
          return entry.value ?? entry.values ?? entry.text ?? entry.data ?? "";
        }
        if (Object.prototype.hasOwnProperty.call(entry, key)) return entry[key];
      }
      return "";
    }

    if (!customFields || typeof customFields !== "object") return "";
    const direct = customFields[key];
    if (direct !== undefined && direct !== null) return direct;
    const matchedKey = Object.keys(customFields).find(
      (fieldKey) => String(fieldKey).toLowerCase() === String(key).toLowerCase()
    );
    if (matchedKey) return customFields[matchedKey];

    for (const value of Object.values(customFields)) {
      if (!value || typeof value !== "object") continue;
      const nestedValue = getCustomFieldValue(value, key);
      if (nestedValue !== "") return nestedValue;
    }
    return "";
  }

  function hasCustomField(customFields, key) {
    if (typeof customFields === "string") {
      const trimmed = customFields.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return hasCustomField(JSON.parse(trimmed), key);
        } catch (error) {
          return false;
        }
      }
      return false;
    }

    const targetKey = String(key).toLowerCase();
    if (Array.isArray(customFields)) {
      return customFields.some((entry) => {
        if (Array.isArray(entry)) return String(entry[0] ?? "").toLowerCase() === targetKey;
        if (!entry || typeof entry !== "object") return false;
        const fieldNames = [
          entry.id ?? "",
          entry.key,
          entry.name,
          entry.field_name,
          entry.fieldName,
          typeof entry.field === "string" ? entry.field : "",
          entry.field?.key,
          entry.field?.id,
          entry.field?.name,
          typeof entry.customField === "string" ? entry.customField : "",
          entry.customField?.key,
          entry.customField?.id,
          entry.customField?.name,
        ].filter((name) => name !== undefined && name !== null && String(name).trim() !== "");
        return (
          fieldNames.some((fieldName) => String(fieldName).toLowerCase() === targetKey) ||
          Object.prototype.hasOwnProperty.call(entry, key)
        );
      });
    }

    if (!customFields || typeof customFields !== "object") return false;
    if (Object.prototype.hasOwnProperty.call(customFields, key)) return true;
    if (Object.keys(customFields).some((fieldKey) => String(fieldKey).toLowerCase() === targetKey)) return true;
    return Object.values(customFields).some((value) => value && typeof value === "object" && hasCustomField(value, key));
  }

  function normalizeCustomFieldValue(value) {
    if (Array.isArray(value)) {
      return value.map(normalizeCustomFieldValue).find(Boolean) || "";
    }
    if (value && typeof value === "object") {
      return normalizeCustomFieldValue(
        value.value ??
        value.values ??
        value.text ??
        value.name ??
        value.label ??
        ""
      );
    }
    const normalized = String(value ?? "").trim();
    const quoted = normalized.match(/^['"](.+)['"]$/);
    return quoted ? quoted[1].trim() : normalized;
  }

  function isTimelineTagRecord(tagRecord) {
    return hasCustomField(tagRecord?.custom_fields, "eto_timeline_tag");
  }

  function shouldShowTimelineMarkerControl(tagRecord, cfg) {
    return (
      isTagTimelineOverlayEnabled(cfg) &&
      !!getCurrentSceneEntity() &&
      isTimelineTagRecord(tagRecord)
    );
  }

  function getTimelineTagColor(tagRecord) {
    const tagId = String(tagRecord?.id || "").trim();
    return tagId ? readTimelineTagColors()[tagId] || "" : "";
  }

  async function ensureHoverTagRecord(tagId) {
    let record = getTagRecordById(tagId);
    if (!record) {
      await fetchAllTags();
      record = getTagRecordById(tagId);
    }
    if (!record) return null;
    const imageIds = getSupplementalImageIdsForTag(record);
    if (imageIds.length) {
      await ensureSupplementalImagesLoaded(imageIds);
    }
    return getTagRecordById(tagId) || record;
  }

  function findHoverTagTarget(start) {
    if (!(start instanceof Element)) return null;
    const button = start.closest("[data-eto-tag-id]");
    if (!(button instanceof HTMLElement)) return null;
    const tagId = String(button.getAttribute("data-eto-tag-id") || "");
    if (!tagId) return null;
    return { anchor: button, tagId };
  }

  function getCurrentSceneEntity() {
    const entity = getEntityFromPath(window.location.pathname);
    return entity?.type === "scene" ? entity : null;
  }

  function getScenePlayerRoot() {
    return document.querySelector(".scene-player, .scene-video, .video-js, [class*='ScenePlayer']");
  }

  function getActiveSceneVideo() {
    const fullscreenVideo = document.fullscreenElement?.querySelector?.("video");
    if (fullscreenVideo) return fullscreenVideo;

    const sceneRoot = getScenePlayerRoot();
    return sceneRoot?.querySelector?.("video") || document.querySelector("video");
  }

  function shouldShowSceneOverlaysOutsideFullscreen(cfg) {
    return isFullscreenQuickTagPanelEnabled(cfg);
  }

  function formatTimelineTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function buildTimelineGridItems(duration) {
    const safeDuration = Math.max(1, Number(duration) || 1);
    const targetSections = 6;
    const niceSteps = [30, 60, 120, 300, 600, 900, 1800, 3600];
    const rawStep = safeDuration / targetSections;
    const step = niceSteps.find((candidate) => candidate >= rawStep) || niceSteps[niceSteps.length - 1];
    const items = [];

    for (let seconds = step; seconds < safeDuration; seconds += step) {
      const left = Math.max(0, Math.min(100, (seconds / safeDuration) * 100));
      items.push({ seconds, left });
      if (items.length >= 10) break;
    }

    return items;
  }

  function cloneTimelinePaletteItem(item) {
    if (!item) return null;
    if (item.type === "leaf") {
      const record = getTagRecordById(item.id);
      if (!isTimelineTagRecord(record || item)) return null;
      return { ...item };
    }

    if (item.type === "subgroup") {
      const subgroupRecord = getTagRecordById(item.id);
      const children = Array.isArray(item.children)
        ? item.children.map(cloneTimelinePaletteItem).filter(Boolean)
        : [];
      if (!children.length && !isTimelineTagRecord(subgroupRecord || item)) return null;
      return { ...item, children };
    }

    return null;
  }

  function buildTimelinePaletteGroups() {
    const cfg = {
      ...(state.config || {}),
      displayMode: "text",
      defaultExpanded: false,
      __fullscreenMainPanel: true,
    };
    const sourceTags = state.allTags || Array.from(state.tagMap.values());
    const groups = buildNestedGroupsPreservingOrder(sourceTags, cfg);
    return groups
      .map((group) => {
        const parentRecord = getTagRecordById(group.parent.id);
        const items = Array.isArray(group.items)
          ? group.items.map(cloneTimelinePaletteItem).filter(Boolean)
          : [];
        if (!items.length && !isTimelineTagRecord(parentRecord || group.parent)) return null;
        return { ...group, items };
      })
      .filter(Boolean);
  }

  function clampTimelineSeconds(seconds, duration) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    return clampNumber(Number(seconds) || 0, 0, safeDuration);
  }

  function getTimelineVideoDuration(video, markers = [], sceneDuration = 0) {
    const stashDuration = Number(sceneDuration);
    if (Number.isFinite(stashDuration) && stashDuration > 0) return stashDuration;

    const directDuration = Number(video?.duration);
    if (Number.isFinite(directDuration) && directDuration > 0) return directDuration;

    const seekable = video?.seekable;
    if (seekable?.length) {
      const seekableEnd = Number(seekable.end(seekable.length - 1));
      if (Number.isFinite(seekableEnd) && seekableEnd > 0) return seekableEnd;
    }

    return Math.max(1, ...markers.map((marker) => Number(marker.seconds || 0) + 60));
  }

  async function fetchSceneTimelineDuration(sceneId) {
    const normalizedSceneId = String(sceneId || "");
    if (!normalizedSceneId) return 0;
    if (state.timelineSceneDurationCache.has(normalizedSceneId)) {
      return state.timelineSceneDurationCache.get(normalizedSceneId) || 0;
    }

    try {
      const data = await gql(`
        query FindSceneTimelineDuration($id: ID!) {
          findScene(id: $id) {
            id
            files {
              duration
            }
          }
        }
      `, { id: normalizedSceneId });
      const durations = Array.isArray(data?.findScene?.files)
        ? data.findScene.files.map((file) => Number(file?.duration)).filter((duration) => Number.isFinite(duration) && duration > 0)
        : [];
      const duration = durations.length ? Math.max(...durations) : 0;
      state.timelineSceneDurationCache.set(normalizedSceneId, duration);
      return duration;
    } catch (err) {
      console.error("[EditTagsOverhaul] scene timeline duration lookup failed", err);
      state.timelineSceneDurationCache.set(normalizedSceneId, 0);
      return 0;
    }
  }

  function getTimelineOverlayDuration(overlay, video, markers = []) {
    const overlayDuration = Number(overlay?.getAttribute?.("data-eto-timeline-duration"));
    if (Number.isFinite(overlayDuration) && overlayDuration > 0) return overlayDuration;
    return getTimelineVideoDuration(video, markers);
  }

  function isTimelineVideoDurationReady(video) {
    const directDuration = Number(video?.duration);
    if (Number.isFinite(directDuration) && directDuration > 0) return true;
    const seekable = video?.seekable;
    if (!seekable?.length) return false;
    const seekableEnd = Number(seekable.end(seekable.length - 1));
    return Number.isFinite(seekableEnd) && seekableEnd > 0;
  }

  function requestTimelineOverlaySync() {
    syncTimelineOverlay().catch((err) => {
      console.error("[EditTagsOverhaul] timeline overlay sync failed", err);
    });
  }

  function scheduleTimelineOverlayRetry() {
    const delay = ROUTE_RETRY_DELAYS[Math.min(state.timelineRetryCount, ROUTE_RETRY_DELAYS.length - 1)] || 250;
    if (state.timelineRetryCount >= ROUTE_RETRY_DELAYS.length) return;
    state.timelineRetryCount += 1;
    if (state.timelineDurationRetry) window.clearTimeout(state.timelineDurationRetry);
    state.timelineDurationRetry = window.setTimeout(() => {
      state.timelineDurationRetry = null;
      requestTimelineOverlaySync();
    }, Math.max(200, delay));
  }

  function handlePanelHoverIn(event) {
    const targetInfo = findHoverTagTarget(event.target);
    if (!targetInfo) return;
    const { anchor, tagId } = targetInfo;
    if (state.hoverTagId === tagId) return;

    const anchorRect = anchor.getBoundingClientRect();
    state.hoverTagId = tagId;
    state.hoverAnchorRect = anchorRect;
    showHoverPreviewLoading(anchorRect);

    ensureHoverTagRecord(tagId).then((record) => {
      if (!record || state.hoverTagId !== tagId) return;
      const host = getHoverPreviewHost();
      host.innerHTML = renderHoverPreview(record);
      host.classList.add("is-visible");
      host.classList.remove("is-loading");
      host.setAttribute("aria-hidden", "false");
      positionHoverPreview(state.hoverAnchorRect || anchorRect);
    });
  }

  function handlePanelHoverOut(event) {
    const activeTagId = String(state.hoverTagId || "");
    if (!activeTagId) return;
    const currentTarget = findHoverTagTarget(event.target);
    if (!currentTarget || currentTarget.tagId !== activeTagId) return;
    const related = event.relatedTarget;
    if (related instanceof Element && currentTarget.anchor.contains(related)) return;
    hideHoverPreview();
  }

  async function fetchEntityTagIds(entityType, entityId) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return new Set();

    const data = await gql(cfg.findQuery, { id: entityId });
    const tags = cfg.findPath(data);
    return new Set(tags.map((t) => String(t.id)));
  }

  async function saveEntityTagIds(entityType, entityId, tagIds) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return null;

    const data = await gql(cfg.updateMutation, {
      input: {
        id: entityId,
        tag_ids: tagIds,
      },
    });

    return data?.[cfg.updateMutationKey]?.id;
  }

  function refreshNativeSceneUIAfterSave(entity) {
    if (entity?.type !== "scene") return;

    const expectedPath = `/scenes/${entity.id}`;
    if (!window.location.pathname.startsWith(expectedPath)) return;

    window.setTimeout(() => {
      if (!window.location.pathname.startsWith(expectedPath)) return;

      try {
        const cleanUrl = new URL(window.location.href);
        const refreshUrl = new URL(window.location.href);
        refreshUrl.searchParams.set("_eto_refresh", String(Date.now()));

        history.replaceState(history.state, "", refreshUrl.toString());
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));

        window.setTimeout(() => {
          if (!window.location.pathname.startsWith(expectedPath)) return;
          history.replaceState(history.state, "", cleanUrl.toString());
          window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
        }, 80);
      } catch (err) {
        console.error("[EditTagsOverhaul] scene UI refresh failed", err);
      }
    }, 50);
  }

  async function persistSelectedTagIds(nextSelectedTagIds) {
    if (!state.currentEntity || state.isSaving) return false;

    const previousSelectedTagIds = new Set(state.selectedTagIds);
    state.selectedTagIds = new Set(
      Array.from(nextSelectedTagIds).map((id) => String(id))
    );
    syncRenderedSelectionStates();

    state.isSaving = true;
    document.body.classList.add("edit-tags-overhaul--saving");
    syncClipboardActionState();

    try {
      await saveEntityTagIds(
        state.currentEntity.type,
        state.currentEntity.id,
        Array.from(state.selectedTagIds)
      );
      state.loadedSelectionEntityKey = getCurrentEntityKey(state.currentEntity);
      if (shouldRefreshSceneUIAfterSave(state.config || {})) {
        refreshNativeSceneUIAfterSave(state.currentEntity);
      }
      return true;
    } catch (err) {
      console.error("[EditTagsOverhaul] tag save failed", err);
      state.selectedTagIds = previousSelectedTagIds;
      syncRenderedSelectionStates();
      return false;
    } finally {
      state.isSaving = false;
      document.body.classList.remove("edit-tags-overhaul--saving");
      syncClipboardActionState();
    }
  }

  function sortItemsBySortNameThenName(items) {
    items.sort((a, b) => {
      const aKey = (a.sort_name || a.name || "").toLowerCase();
      const bKey = (b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
  }

  function buildNestedGroupsPreservingOrder(tags, cfg) {
    const duplicateMultiParentTags = getConfigBoolean(
      cfg.duplicateMultiParentTags,
      false
    );

    const tagMap = new Map();
    tags.forEach((tag) => {
      tagMap.set(String(tag.id), {
        id: String(tag.id),
        name: tag.name,
        sort_name: tag.sort_name || tag.name || "",
        image_path: tag.image_path || "",
        custom_fields: tag.custom_fields || {},
        parents: (tag.parents || []).map((p) => ({
          id: String(p.id),
          name: p.name,
          sort_name: p.sort_name || p.name || "",
          parents: (p.parents || []).map((gp) => ({
            id: String(gp.id),
            name: gp.name,
            sort_name: gp.sort_name || gp.name || "",
          })),
        })),
        childIds: (tag.children || []).map((c) => String(c.id)),
      });
    });

    const topGroupsById = new Map();
    const orderedTopGroups = [];

    const ungrouped = {
      parent: {
        id: "__ungrouped__",
        name: "Ungrouped",
        sort_name: "Ungrouped",
      },
      items: [],
    };

    function isParentTag(tagRecord) {
      return !!(tagRecord && tagRecord.childIds && tagRecord.childIds.length > 0);
    }

    function createLeaf(tagRecord) {
      return {
        type: "leaf",
        id: tagRecord.id,
        name: tagRecord.name,
        sort_name: tagRecord.sort_name || tagRecord.name || "",
        image_path: tagRecord.image_path || "",
        custom_fields: tagRecord.custom_fields || {},
      };
    }

    function ensureTopGroup(parent) {
      const parentId = String(parent.id);
      if (!topGroupsById.has(parentId)) {
        const group = {
          parent: {
            id: parentId,
            name: parent.name,
            sort_name: parent.sort_name || parent.name || "",
          },
          items: [],
          subgroupMap: new Map(),
          leafIds: new Set(),
        };
        topGroupsById.set(parentId, group);
        orderedTopGroups.push(group);
      }
      return topGroupsById.get(parentId);
    }

    function ensureSubgroup(topGroup, parentRecord) {
      if (!topGroup.subgroupMap.has(parentRecord.id)) {
        const subgroup = {
          type: "subgroup",
          id: parentRecord.id,
          name: parentRecord.name,
          sort_name: parentRecord.sort_name || parentRecord.name || "",
          image_path: parentRecord.image_path || "",
          children: [],
          childIds: new Set(),
        };
        topGroup.subgroupMap.set(parentRecord.id, subgroup);
        topGroup.items.push(subgroup);
      }
      return topGroup.subgroupMap.get(parentRecord.id);
    }

    function addLeafToGroup(topGroup, tagRecord) {
      if (!duplicateMultiParentTags && topGroup.leafIds.has(tagRecord.id)) return;
      if (topGroup.leafIds.has(tagRecord.id)) return;

      if (!isParentTag(tagRecord)) {
        topGroup.items.push(createLeaf(tagRecord));
        topGroup.leafIds.add(tagRecord.id);
      }
    }

    function addLeafToSubgroup(subgroup, tagRecord) {
      if (subgroup.childIds.has(tagRecord.id)) return;

      if (!isParentTag(tagRecord)) {
        subgroup.children.push(createLeaf(tagRecord));
        subgroup.childIds.add(tagRecord.id);
      }
    }

    function getParentPaths(tagRecord) {
      if (!tagRecord.parents.length) return [{ type: "ungrouped" }];

      const paths = [];

      for (const immediateParent of tagRecord.parents) {
        const parentRecord = tagMap.get(String(immediateParent.id));

        if (parentRecord && parentRecord.parents && parentRecord.parents.length > 0) {
          for (const topParent of parentRecord.parents) {
            paths.push({
              type: "subgroup",
              topParent,
              subgroupParent: parentRecord,
            });
            if (!duplicateMultiParentTags) return paths;
          }
        } else {
          paths.push({
            type: "group",
            topParent: immediateParent,
          });
          if (!duplicateMultiParentTags) return paths;
        }
      }

      return paths;
    }

    for (const tag of tags) {
      const tagId = String(tag.id);
      const tagRecord = tagMap.get(tagId);
      if (!tagRecord) continue;

      const paths = getParentPaths(tagRecord);

      for (const path of paths) {
        if (path.type === "ungrouped") {
          if (!isParentTag(tagRecord)) {
            const already = ungrouped.items.some((item) => item.id === tagRecord.id);
            if (!already) {
              ungrouped.items.push(createLeaf(tagRecord));
            }
          }
          continue;
        }

        if (path.type === "subgroup") {
          const topGroup = ensureTopGroup(path.topParent);
          const subgroup = ensureSubgroup(topGroup, path.subgroupParent);
          addLeafToSubgroup(subgroup, tagRecord);
          continue;
        }

        if (path.type === "group") {
          const topGroup = ensureTopGroup(path.topParent);
          addLeafToGroup(topGroup, tagRecord);
        }
      }
    }

    orderedTopGroups.sort((a, b) => {
      if (a.parent.id === "__ungrouped__") return 1;
      if (b.parent.id === "__ungrouped__") return -1;

      const aKey = (a.parent.sort_name || a.parent.name || "").toLowerCase();
      const bKey = (b.parent.sort_name || b.parent.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    for (const group of orderedTopGroups) {
      sortItemsBySortNameThenName(group.items);
      for (const item of group.items) {
        if (item.type === "subgroup" && Array.isArray(item.children)) {
          sortItemsBySortNameThenName(item.children);
        }
      }
    }

    sortItemsBySortNameThenName(ungrouped.items);

    if (ungrouped.items.length) {
      const hasUngrouped = orderedTopGroups.some(
        (group) => group.parent.id === "__ungrouped__"
      );
      if (!hasUngrouped) orderedTopGroups.push(ungrouped);
    }

    return orderedTopGroups.map((group) => {
      delete group.subgroupMap;
      delete group.leafIds;
      return group;
    });
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function buildSearchIndex(tags, cfg) {
    const duplicateMultiParentTags = getConfigBoolean(
      cfg.duplicateMultiParentTags,
      false
    );

    const tagMap = new Map();
    tags.forEach((tag) => {
      tagMap.set(String(tag.id), {
        id: String(tag.id),
        name: tag.name,
        sort_name: tag.sort_name || tag.name || "",
        image_path: tag.image_path || "",
        parents: (tag.parents || []).map((p) => ({
          id: String(p.id),
          name: p.name,
          sort_name: p.sort_name || p.name || "",
          parents: (p.parents || []).map((gp) => ({
            id: String(gp.id),
            name: gp.name,
            sort_name: gp.sort_name || gp.name || "",
          })),
        })),
        childIds: (tag.children || []).map((c) => String(c.id)),
      });
    });

    function isParentTag(tagRecord) {
      return !!(tagRecord && tagRecord.childIds && tagRecord.childIds.length > 0);
    }

    function getParentPaths(tagRecord) {
      if (!tagRecord.parents.length) return [{ type: "ungrouped" }];

      const paths = [];

      for (const immediateParent of tagRecord.parents) {
        const parentRecord = tagMap.get(String(immediateParent.id));

        if (parentRecord && parentRecord.parents && parentRecord.parents.length > 0) {
          for (const topParent of parentRecord.parents) {
            paths.push({
              type: "subgroup",
              topParent,
              subgroupParent: parentRecord,
            });
            if (!duplicateMultiParentTags) return paths;
          }
        } else {
          paths.push({
            type: "group",
            topParent: immediateParent,
          });
          if (!duplicateMultiParentTags) return paths;
        }
      }

      return paths;
    }

    const results = [];

    for (const tag of tags) {
      const tagId = String(tag.id);
      const tagRecord = tagMap.get(tagId);
      if (!tagRecord) continue;

      const paths = getParentPaths(tagRecord);
      const parentTag = isParentTag(tagRecord);

      for (const path of paths) {
        let breadcrumb = "Ungrouped";
        let targetKind = parentTag ? "header" : "leaf";
        let targetId = tagRecord.id;
        let groupId = "__ungrouped__";
        let subgroupId = "";

        if (path.type === "group") {
          breadcrumb = path.topParent.name;
          if (parentTag) {
            targetId = String(path.topParent.id);
            groupId = String(path.topParent.id);
          } else {
            groupId = String(path.topParent.id);
          }
        } else if (path.type === "subgroup") {
          breadcrumb = `${path.topParent.name} > ${path.subgroupParent.name}`;
          groupId = String(path.topParent.id);
          subgroupId = String(path.subgroupParent.id);
          if (parentTag) {
            targetId = String(path.subgroupParent.id);
          }
        }

        if (path.type === "ungrouped" && parentTag) {
          targetKind = "header";
        }

        results.push({
          id: tagRecord.id,
          name: tagRecord.name,
          sort_name: tagRecord.sort_name || tagRecord.name || "",
          image_path: tagRecord.image_path || "",
          targetKind,
          targetId,
          groupId,
          subgroupId,
          breadcrumb,
          searchText: normalizeSearchText(
            `${tagRecord.name} ${tagRecord.sort_name} ${breadcrumb}`
          ),
        });

        if (!duplicateMultiParentTags) break;
      }
    }

    results.sort((a, b) => {
      const aKey = (a.sort_name || a.name || "").toLowerCase();
      const bKey = (b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    return results;
  }

  function getSearchResults(query, limit = 30) {
    const normalized = normalizeSearchText(query);
    if (!normalized || !Array.isArray(state.searchIndex)) return [];

    const prefixMatches = [];
    const containsMatches = [];

    for (const item of state.searchIndex) {
      if (!item.searchText.includes(normalized)) continue;
      if (item.searchText.startsWith(normalized)) prefixMatches.push(item);
      else containsMatches.push(item);
      if (prefixMatches.length + containsMatches.length >= limit * 3) break;
    }

    return prefixMatches.concat(containsMatches).slice(0, limit);
  }

  function flashSearchTarget(target) {
    if (!target) return;
    target.classList.remove("edit-tags-overhaul__search-target-flash");
    void target.offsetWidth;
    target.classList.add("edit-tags-overhaul__search-target-flash");
    setTimeout(() => {
      target.classList.remove("edit-tags-overhaul__search-target-flash");
    }, 1600);
  }

  function revealSearchResult(result, panel = document.getElementById(PANEL_ID)) {
    if (!result) return;

    if (!panel) return;

    const groupSection = panel.querySelector(
      `.edit-tags-overhaul__group[data-grouped-scene-parent-id="${CSS.escape(result.groupId)}"]`
    );
    if (groupSection) groupSection.classList.add("is-open");

    let target = null;

    if (result.subgroupId) {
      const subgroupSection = panel.querySelector(
        `.edit-tags-overhaul__subgroup[data-grouped-scene-subgroup-id="${CSS.escape(result.subgroupId)}"]`
      );
      if (subgroupSection) subgroupSection.classList.add("is-open");
      if (result.targetKind === "header") {
        target = subgroupSection || groupSection;
      } else {
        target = subgroupSection?.querySelector(
          `[data-eto-tag-id="${CSS.escape(result.targetId)}"]`
        );
      }
    } else if (result.targetKind === "header") {
      target = groupSection;
    } else if (groupSection) {
      target = groupSection.querySelector(
        `[data-eto-tag-id="${CSS.escape(result.targetId)}"]`
      );
    }

    if (!target && result.targetKind === "header") {
      target = panel.querySelector(
        `[data-eto-header-tag-id="${CSS.escape(result.targetId)}"]`
      )?.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
    }

    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    flashSearchTarget(target);
  }

  function renderSearchResults(panel) {
    if (!panel) return;
    const resultsWrap = panel.querySelector(".edit-tags-overhaul__search-results");
    const emptyEl = panel.querySelector(".edit-tags-overhaul__search-empty");
    if (!resultsWrap || !emptyEl) return;

    resultsWrap.innerHTML = "";

    const query = state.currentSearchQuery || "";
    const trimmed = query.trim();
    if (!trimmed) {
      emptyEl.hidden = true;
      return;
    }

    const results = getSearchResults(trimmed, 24);
    emptyEl.hidden = results.length > 0;

    results.forEach((result) => {
      const row = document.createElement("div");
      row.className = "edit-tags-overhaul__search-result";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "edit-tags-overhaul__search-result-main";
      main.setAttribute("data-eto-search-jump-id", result.id);
      main.setAttribute("data-eto-search-target-id", result.targetId);
      main.setAttribute("data-eto-search-target-kind", result.targetKind);
      main.setAttribute("data-eto-search-group-id", result.groupId);
      if (result.subgroupId) {
        main.setAttribute("data-eto-search-subgroup-id", result.subgroupId);
      }
      main.title = `Reveal ${result.name} in hierarchy`;

      if (result.image_path) {
        const img = document.createElement("img");
        img.className = "edit-tags-overhaul__search-result-image";
        img.src = result.image_path;
        img.alt = result.name;
        main.appendChild(img);
      } else {
        main.classList.add("edit-tags-overhaul__search-result-main--no-image");
      }

      const textWrap = document.createElement("span");
      textWrap.className = "edit-tags-overhaul__search-result-text";

      const nameEl = document.createElement("span");
      nameEl.className = "edit-tags-overhaul__search-result-name";
      nameEl.textContent = result.name;

      const pathEl = document.createElement("span");
      pathEl.className = "edit-tags-overhaul__search-result-path";
      pathEl.textContent = result.breadcrumb;

      textWrap.appendChild(nameEl);
      textWrap.appendChild(pathEl);
      main.appendChild(textWrap);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "edit-tags-overhaul__search-result-toggle";
      toggle.setAttribute("data-eto-search-toggle-id", result.id);
      toggle.title = state.selectedTagIds.has(result.id) ? "Remove tag" : "Add tag";
      toggle.textContent = state.selectedTagIds.has(result.id) ? "\u2713" : "+";
      toggle.classList.toggle("is-selected", state.selectedTagIds.has(result.id));

      row.appendChild(main);
      row.appendChild(toggle);
      resultsWrap.appendChild(row);
    });
  }

  function createSearchControls() {
    const wrap = document.createElement("div");
    wrap.className = "edit-tags-overhaul__search";

    const inputRow = document.createElement("div");
    inputRow.className = "edit-tags-overhaul__search-input-row";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "edit-tags-overhaul__search-input";
    input.placeholder = "Search tags to reveal or toggle";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = state.currentSearchQuery || "";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "edit-tags-overhaul__search-clear";
    clearBtn.textContent = "x";
    clearBtn.setAttribute("aria-label", "Clear tag search");

    const results = document.createElement("div");
    results.className = "edit-tags-overhaul__search-results";

    const empty = document.createElement("div");
    empty.className = "edit-tags-overhaul__search-empty";
    empty.textContent = "No matching tags";
    empty.hidden = true;

    const updateClearState = () => {
      clearBtn.hidden = !input.value;
    };

    input.addEventListener("input", () => {
      state.currentSearchQuery = input.value || "";
      updateClearState();
      renderSearchResults(wrap.closest(".edit-tags-overhaul"));
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (input.value) {
          input.value = "";
          state.currentSearchQuery = "";
          updateClearState();
          renderSearchResults(wrap.closest(".edit-tags-overhaul"));
        }
        return;
      }

      if (event.key === "Enter") {
        const firstResult = wrap.querySelector("[data-eto-search-jump-id]");
        if (firstResult) {
          event.preventDefault();
          firstResult.click();
        }
      }
    });

    clearBtn.addEventListener("click", () => {
      input.value = "";
      state.currentSearchQuery = "";
      updateClearState();
      renderSearchResults(wrap.closest(".edit-tags-overhaul"));
      input.focus();
    });

    updateClearState();
    inputRow.appendChild(input);
    inputRow.appendChild(clearBtn);
    wrap.appendChild(inputRow);
    wrap.appendChild(results);
    wrap.appendChild(empty);
    return wrap;
  }

  function groupHasSelectedTags(group) {
    if (group.parent.id !== "__ungrouped__" && state.selectedTagIds.has(group.parent.id)) {
      return true;
    }

    return group.items.some((item) => {
      if (item.type === "leaf") return state.selectedTagIds.has(item.id);
      if (item.type === "subgroup") {
        if (state.selectedTagIds.has(item.id)) return true;
        return item.children.some((child) => state.selectedTagIds.has(child.id));
      }
      return false;
    });
  }

  function subgroupHasSelectedTags(subgroup) {
    if (state.selectedTagIds.has(subgroup.id)) return true;
    return subgroup.children.some((child) => state.selectedTagIds.has(child.id));
  }

  function syncClipboardActionState(panel = document.getElementById(PANEL_ID)) {
    if (!panel) return;

    const copyBtn = panel.querySelector("[data-eto-copy-tags]");
    const pasteBtn = panel.querySelector("[data-eto-paste-tags]");
    const clipboard = readTagClipboard();
    const availableClipboardIds = getAvailableClipboardTagIds(clipboard);

    if (copyBtn) {
      const selectedCount = state.selectedTagIds.size;
      copyBtn.disabled = selectedCount === 0 || state.isSaving;
      copyBtn.textContent =
        selectedCount > 0 ? `Copy Tags (${selectedCount})` : "Copy Tags";
      copyBtn.setAttribute(
        "title",
        selectedCount > 0
          ? `Copy ${selectedCount} selected tags`
          : "Select tags to copy"
      );
    }

    if (pasteBtn) {
      pasteBtn.disabled = availableClipboardIds.length === 0 || state.isSaving;
      pasteBtn.textContent =
        availableClipboardIds.length > 0
          ? `Paste Tags (${availableClipboardIds.length})`
          : "Paste Tags";
      pasteBtn.setAttribute(
        "title",
        availableClipboardIds.length > 0
          ? `Review and paste ${availableClipboardIds.length} copied tags`
          : "No copied tags available"
      );
    }
  }

  function hidePasteModal(panel = document.getElementById(PANEL_ID)) {
    const modal = panel?.querySelector(".edit-tags-overhaul__paste-modal");
    if (modal) modal.remove();
  }

  function renderPasteModal(panel, clipboard) {
    hidePasteModal(panel);
    if (!panel || !clipboard) return;

    const availableIds = getAvailableClipboardTagIds(clipboard);
    if (!availableIds.length) return;

    const tagNameMap = new Map(
      (clipboard.tags || []).map((tag) => [String(tag.id), String(tag.name || "")])
    );
    const availableTags = availableIds
      .map((tagId) => ({
        id: String(tagId),
        name:
          tagNameMap.get(String(tagId)) ||
          String(state.tagMap.get(String(tagId))?.name || tagId),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

    const unavailableCount = Array.isArray(clipboard.tagIds)
      ? clipboard.tagIds.length - availableIds.length
      : 0;

    const overlay = document.createElement("div");
    overlay.className = "edit-tags-overhaul__paste-modal";
    overlay.innerHTML = `
      <div class="edit-tags-overhaul__paste-modal-backdrop" data-eto-paste-cancel="1"></div>
      <div class="edit-tags-overhaul__paste-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-tags-overhaul-paste-title">
        <div class="edit-tags-overhaul__paste-modal-header">
          <div>
            <div class="edit-tags-overhaul__paste-modal-title" id="edit-tags-overhaul-paste-title">Paste Tags</div>
            <div class="edit-tags-overhaul__paste-modal-subtitle">${availableTags.length} copied tags ready to paste</div>
          </div>
          <button type="button" class="edit-tags-overhaul__paste-modal-close" data-eto-paste-cancel="1" aria-label="Close paste dialog">x</button>
        </div>
        ${
          unavailableCount > 0
            ? `<div class="edit-tags-overhaul__paste-modal-note">${unavailableCount} copied tag${unavailableCount === 1 ? "" : "s"} no longer exist and will be skipped.</div>`
            : ""
        }
        <div class="edit-tags-overhaul__paste-modal-list">
          ${availableTags
            .map(
              (tag) =>
                `<div class="edit-tags-overhaul__paste-modal-tag">${escapeHtml(tag.name)}</div>`
            )
            .join("")}
        </div>
        <div class="edit-tags-overhaul__paste-modal-actions">
          <button type="button" class="edit-tags-overhaul__paste-modal-btn" data-eto-paste-cancel="1">Cancel</button>
          <button type="button" class="edit-tags-overhaul__paste-modal-btn edit-tags-overhaul__paste-modal-btn--secondary" data-eto-paste-action="merge">Merge With Tags</button>
          <button type="button" class="edit-tags-overhaul__paste-modal-btn edit-tags-overhaul__paste-modal-btn--primary" data-eto-paste-action="replace">Replace Tags</button>
        </div>
      </div>
    `;

    panel.appendChild(overlay);
  }

  function updateTagButtonState(button, attached) {
    button.classList.toggle("is-selected", attached);
    button.setAttribute("aria-pressed", attached ? "true" : "false");
  }

  function updateParentToggleState(button, attached) {
    button.classList.toggle("is-selected", attached);
    button.setAttribute("aria-pressed", attached ? "true" : "false");
    button.textContent = attached ? "\u2713" : "+";
    button.setAttribute("title", attached ? "Remove parent tag" : "Add parent tag");
    button.setAttribute("aria-label", attached ? "Remove parent tag" : "Add parent tag");
  }

  function syncRenderedSelectionStates() {
    document.querySelectorAll("[data-eto-tag-id]").forEach((el) => {
      const id = el.getAttribute("data-eto-tag-id");
      updateTagButtonState(el, state.selectedTagIds.has(id));
    });

    document.querySelectorAll("[data-eto-parent-toggle-id]").forEach((el) => {
      const id = el.getAttribute("data-eto-parent-toggle-id");
      updateParentToggleState(el, state.selectedTagIds.has(id));
    });

    document.querySelectorAll("[data-grouped-scene-parent-id]").forEach((section) => {
      const countEl = section.querySelector(".edit-tags-overhaul__selected-count");
      if (!countEl) return;

      const leafButtons = section.querySelectorAll("[data-eto-tag-id]");
      let selectedCount = 0;
      leafButtons.forEach((btn) => {
        if (btn.classList.contains("is-selected")) selectedCount += 1;
      });

      const parentToggle = section.querySelector("[data-eto-parent-toggle-id]");
      if (parentToggle && parentToggle.classList.contains("is-selected")) {
        selectedCount += 1;
      }

      countEl.textContent = selectedCount > 0 ? `${selectedCount} selected` : "";
    });

    document.querySelectorAll("[data-grouped-scene-subgroup-id]").forEach((section) => {
      const countEl = section.querySelector(".edit-tags-overhaul__subgroup-selected-count");
      if (!countEl) return;

      const leafButtons = section.querySelectorAll("[data-eto-tag-id]");
      let selectedCount = 0;
      leafButtons.forEach((btn) => {
        if (btn.classList.contains("is-selected")) selectedCount += 1;
      });

      const parentToggle = section.querySelector("[data-eto-parent-toggle-id]");
      if (parentToggle && parentToggle.classList.contains("is-selected")) {
        selectedCount += 1;
      }

      countEl.textContent = selectedCount > 0 ? `${selectedCount} selected` : "";
    });

    document.querySelectorAll("[data-eto-search-toggle-id]").forEach((el) => {
      const id = el.getAttribute("data-eto-search-toggle-id");
      const selected = state.selectedTagIds.has(id);
      el.classList.toggle("is-selected", selected);
      el.textContent = selected ? "\u2713" : "+";
      el.setAttribute("title", selected ? "Remove tag" : "Add tag");
      el.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    document.querySelectorAll(".edit-tags-overhaul__fullscreen-selected-count").forEach((el) => {
      const selectedCount = state.selectedTagIds.size;
      el.textContent = selectedCount > 0 ? `${selectedCount} selected` : "No tags selected";
    });

    syncClipboardActionState();
    requestTimelineOverlaySync();
  }

  async function onTagToggleClick(tagId) {
    if (!state.currentEntity || state.isSaving) return;

    const wasSelected = state.selectedTagIds.has(tagId);
    const nextSelectedTagIds = new Set(state.selectedTagIds);
    if (wasSelected) nextSelectedTagIds.delete(tagId);
    else nextSelectedTagIds.add(tagId);

    await persistSelectedTagIds(nextSelectedTagIds);
  }

  async function addTimelineMarkerForTag(tagId) {
    const entity = getCurrentSceneEntity();
    const video = getActiveSceneVideo();
    const tagRecord = getTagRecordById(tagId);
    if (!entity || !tagRecord || !isTimelineTagRecord(tagRecord)) return;

    const seconds = video ? Number(video.currentTime) : 0;
    if (!Number.isFinite(seconds)) return;

    if (!state.selectedTagIds.has(String(tagId))) {
      const nextSelectedTagIds = new Set(state.selectedTagIds);
      nextSelectedTagIds.add(String(tagId));
      const saved = await persistSelectedTagIds(nextSelectedTagIds);
      if (!saved) return;
    }

    const markers = getSceneTimelineMarkers(entity.id);
    const sceneDuration = await fetchSceneTimelineDuration(entity.id);
    const duration = getTimelineVideoDuration(video, markers, sceneDuration);
    const minSpan = getTimelineMarkerMinSpanSeconds(duration, getTimelineTrackForTag(tagId));
    const placedSeconds = findAvailableTimelineStart(markers, {
      tagId,
      desiredStart: Math.max(0, seconds),
      duration,
      length: minSpan,
      minSpan,
      biasRight: true,
    });
    markers.push({
      id: `${tagId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tagId: String(tagId),
      tagName: String(tagRecord.name || "Tag"),
      seconds: placedSeconds,
      createdAt: new Date().toISOString(),
    });
    markers.sort((a, b) => Number(a.seconds || 0) - Number(b.seconds || 0));
    writeSceneTimelineMarkers(entity.id, markers);
    requestTimelineOverlaySync();
  }

  function deleteTimelineMarker(sceneId, markerId) {
    const markers = getSceneTimelineMarkers(sceneId).filter((marker) => marker.id !== markerId);
    writeSceneTimelineMarkers(sceneId, markers);
    requestTimelineOverlaySync();
  }

  function updateTimelineMarker(sceneId, markerId, patch, options = {}) {
    const markers = getSceneTimelineMarkers(sceneId);
    const marker = markers.find((item) => String(item.id) === String(markerId));
    if (!marker) return;

    const duration = Math.max(1, Number(options.duration) || getTimelineVideoDuration(getActiveSceneVideo(), markers));
    const minSpan = getTimelineMarkerMinSpanSeconds(duration, options.track || getTimelineTrackForTag(marker.tagId));
    const sameTagMarkers = markers.filter((item) => String(item.tagId) === String(marker.tagId) && String(item.id) !== String(markerId));
    const nextMarker = { ...marker, ...patch, updatedAt: new Date().toISOString() };
    const start = clampTimelineSeconds(Number(nextMarker.seconds || 0), duration);

    if (options.mode === "range") {
      const nextBoundary = sameTagMarkers
        .map((item) => getTimelineMarkerStart(item))
        .filter((itemStart) => itemStart > start)
        .sort((a, b) => a - b)[0];
      const maxEnd = Number.isFinite(nextBoundary)
        ? Math.max(start, nextBoundary - TIMELINE_MARKER_GAP_SECONDS)
        : duration;
      const rawEnd = Number(nextMarker.endSeconds);
      const end = Number.isFinite(rawEnd)
        ? clampNumber(rawEnd, start + 0.1, maxEnd)
        : null;
      nextMarker.seconds = start;
      nextMarker.endSeconds = end && end > start + 0.05 ? end : null;
    } else {
      const rawEnd = Number(nextMarker.endSeconds);
      const hasRange = Number.isFinite(rawEnd) && rawEnd > start + 0.05;
      const length = hasRange ? Math.max(minSpan, rawEnd - start) : minSpan;
      const placedStart = findAvailableTimelineStart(markers, {
        markerId,
        tagId: marker.tagId,
        desiredStart: start,
        duration,
        length,
        minSpan,
      });
      nextMarker.seconds = placedStart;
      nextMarker.endSeconds = hasRange ? Math.min(duration, placedStart + (rawEnd - start)) : null;
    }

    const nextMarkers = markers.map((item) => String(item.id) === String(markerId) ? nextMarker : item);
    nextMarkers.sort((a, b) => Number(a.seconds || 0) - Number(b.seconds || 0));
    writeSceneTimelineMarkers(sceneId, nextMarkers);
    requestTimelineOverlaySync();
  }

  function handleCopyTagsClick(panel) {
    const clipboard = buildClipboardPayloadFromSelection();
    if (!clipboard) return;
    writeTagClipboard(clipboard);
    hidePasteModal(panel);
    syncClipboardActionState(panel);
  }

  function handlePasteTagsClick(panel) {
    if (state.isSaving) return;
    const clipboard = readTagClipboard();
    if (!clipboard) return;
    renderPasteModal(panel, clipboard);
  }

  async function handlePasteAction(mode, panel) {
    if (state.isSaving) return;

    const clipboard = readTagClipboard();
    const availableIds = getAvailableClipboardTagIds(clipboard);
    if (!availableIds.length) {
      hidePasteModal(panel);
      syncClipboardActionState(panel);
      return;
    }

    const nextSelectedTagIds =
      mode === "replace"
        ? new Set(availableIds)
        : new Set([...state.selectedTagIds, ...availableIds]);

    const saved = await persistSelectedTagIds(nextSelectedTagIds);
    if (saved) hidePasteModal(panel);
  }

  function createParentToggleButton(tagId) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__parent-toggle-btn";
    btn.setAttribute("data-eto-parent-toggle-id", tagId);
    updateParentToggleState(btn, state.selectedTagIds.has(tagId));
    return btn;
  }

  function createFullscreenPopoutButton(groupId, groupName) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__fullscreen-popout-btn";
    btn.setAttribute("data-eto-fullscreen-popout-group-id", String(groupId));
    btn.setAttribute("aria-label", `Pop out ${groupName}`);
    btn.setAttribute("title", `Pop out ${groupName}`);
    btn.textContent = "\u21E4";
    return btn;
  }

  function createTimelineMarkerButton(tagId, tagName) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__timeline-tag-btn";
    const colorStyle = getTimelineColorStyle(tagId);
    if (colorStyle) btn.setAttribute("style", colorStyle);
    btn.setAttribute("data-eto-timeline-tag-id", String(tagId));
    btn.setAttribute("aria-label", `Add timeline marker for ${tagName}`);
    btn.setAttribute("title", `Add timeline marker for ${tagName} at current time`);
    btn.innerHTML = '<span class="edit-tags-overhaul__timeline-tag-icon" aria-hidden="true">\u25F7</span>';
    return btn;
  }

  function createTagControl(child, cfg) {
    const tagButton = createTagButton(child, cfg);
    const timelineTagRecord = getTagRecordById(child.id) || child;
    const showTimelineButton = shouldShowTimelineMarkerControl(timelineTagRecord, cfg);

    if (!showTimelineButton) return tagButton;

    const mode = getDisplayMode(cfg);
    const hasImage = !!child.image_path;
    const wrap = document.createElement("span");
    wrap.className = "edit-tags-overhaul__tag-control";
    if (mode === "image" && hasImage) wrap.classList.add("edit-tags-overhaul__tag-control--image");
    else if (mode === "imageAndText" && hasImage) wrap.classList.add("edit-tags-overhaul__tag-control--image-and-text");
    else wrap.classList.add("edit-tags-overhaul__tag-control--text");
    wrap.appendChild(tagButton);
    wrap.appendChild(createTimelineMarkerButton(child.id, child.name));
    return wrap;
  }

  function createTagButton(child, cfg) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__tag";
    btn.setAttribute("data-eto-tag-id", child.id);
    btn.title = child.name;

    const mode = getDisplayMode(cfg);
    const hasImage = !!child.image_path;

    if (mode === "image" && hasImage) {
      btn.classList.add("edit-tags-overhaul__tag--image-only");

      const img = document.createElement("img");
      img.className = "edit-tags-overhaul__tag-image";
      img.src = child.image_path;
      img.alt = child.name;
      btn.appendChild(img);
    } else if (mode === "imageAndText" && hasImage) {
      btn.classList.add("edit-tags-overhaul__tag--image-and-text");

      const img = document.createElement("img");
      img.className = "edit-tags-overhaul__tag-image";
      img.src = child.image_path;
      img.alt = child.name;
      btn.appendChild(img);

      const label = document.createElement("span");
      label.className = "edit-tags-overhaul__tag-label";
      label.textContent = child.name;
      btn.appendChild(label);
    } else {
      btn.classList.add("edit-tags-overhaul__tag--text");

      const label = document.createElement("span");
      label.className = "edit-tags-overhaul__tag-label";
      label.textContent = child.name;
      btn.appendChild(label);
    }

    updateTagButtonState(btn, state.selectedTagIds.has(child.id));
    return btn;
  }

  function createSubgroupSection(subgroup, cfg) {
    const section = document.createElement("section");
    section.className = "edit-tags-overhaul__subgroup";
    section.setAttribute("data-grouped-scene-subgroup-id", subgroup.id);
    section.setAttribute("data-eto-header-tag-id", subgroup.id);

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__subgroup-header";
    header.setAttribute("data-eto-toggle-section", "1");

    const left = document.createElement("div");
    left.className = "edit-tags-overhaul__subgroup-header-main";

    const title = document.createElement("span");
    title.className = "edit-tags-overhaul__subgroup-title";
    title.textContent = subgroup.name;

    const meta = document.createElement("span");
    meta.className = "edit-tags-overhaul__subgroup-meta";

    const selectedCount = document.createElement("span");
    selectedCount.className = "edit-tags-overhaul__subgroup-selected-count";

    const totalCount = document.createElement("span");
    totalCount.className = "edit-tags-overhaul__subgroup-total-count";
    totalCount.textContent = `${subgroup.children.length + 1}`;

    meta.appendChild(selectedCount);
    meta.appendChild(totalCount);

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "edit-tags-overhaul__header-actions";
    if (
      shouldShowTimelineMarkerControl(getTagRecordById(subgroup.id), cfg)
    ) {
      actions.appendChild(createTimelineMarkerButton(subgroup.id, subgroup.name));
    }
    actions.appendChild(createParentToggleButton(subgroup.id));

    header.appendChild(left);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "edit-tags-overhaul__subgroup-body";

    subgroup.children.forEach((child) => {
      body.appendChild(createTagControl(child, cfg));
    });

    const defaultExpanded =
      getConfigBoolean(cfg.subgroupsDefaultExpanded, getConfigBoolean(cfg.defaultExpanded, false)) ||
      (getConfigBoolean(cfg.autoExpandIfSelected, false) &&
        subgroupHasSelectedTags(subgroup));

    section.classList.toggle("is-open", defaultExpanded);

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function createGroupSection(group, cfg) {
    const section = document.createElement("section");
    section.className = "edit-tags-overhaul__group";
    section.setAttribute("data-grouped-scene-parent-id", group.parent.id);

    if (group.parent.id !== "__ungrouped__") {
      section.setAttribute("data-eto-header-tag-id", group.parent.id);
    }

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__header";
    header.setAttribute("data-eto-toggle-section", "1");

    if (cfg.__fullscreenMainPanel) {
      header.appendChild(createFullscreenPopoutButton(group.parent.id, group.parent.name));
    }

    const left = document.createElement("div");
    left.className = "edit-tags-overhaul__header-main";

    const title = document.createElement("span");
    title.className = "edit-tags-overhaul__title";
    title.textContent = group.parent.name;

    const meta = document.createElement("span");
    meta.className = "edit-tags-overhaul__meta";

    const selectedCount = document.createElement("span");
    selectedCount.className = "edit-tags-overhaul__selected-count";

    let itemCount = 0;
    group.items.forEach((item) => {
      if (item.type === "leaf") itemCount += 1;
      if (item.type === "subgroup") itemCount += item.children.length + 1;
    });
    if (group.parent.id !== "__ungrouped__") itemCount += 1;

    const totalCount = document.createElement("span");
    totalCount.className = "edit-tags-overhaul__total-count";
    totalCount.textContent = `${itemCount}`;

    meta.appendChild(selectedCount);
    meta.appendChild(totalCount);

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "edit-tags-overhaul__header-actions";

    if (group.parent.id !== "__ungrouped__") {
      if (
        shouldShowTimelineMarkerControl(getTagRecordById(group.parent.id), cfg)
      ) {
        actions.appendChild(createTimelineMarkerButton(group.parent.id, group.parent.name));
      }
      actions.appendChild(createParentToggleButton(group.parent.id));
    }

    header.appendChild(left);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "edit-tags-overhaul__body";

    group.items.forEach((item) => {
      if (item.type === "leaf") body.appendChild(createTagControl(item, cfg));
      else if (item.type === "subgroup") body.appendChild(createSubgroupSection(item, cfg));
    });

    const defaultExpanded =
      getConfigBoolean(cfg.defaultExpanded, false) ||
      (getConfigBoolean(cfg.autoExpandIfSelected, false) &&
        groupHasSelectedTags(group));

    section.classList.toggle("is-open", defaultExpanded);

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function attachPanelEventDelegation(panel) {
    panel.addEventListener("mouseover", handlePanelHoverIn);
    panel.addEventListener("mouseout", handlePanelHoverOut);

    panel.addEventListener("click", (event) => {
      const copyTagsBtn = event.target.closest("[data-eto-copy-tags]");
      if (copyTagsBtn) {
        event.preventDefault();
        event.stopPropagation();
        handleCopyTagsClick(panel);
        return;
      }

      const pasteTagsBtn = event.target.closest("[data-eto-paste-tags]");
      if (pasteTagsBtn) {
        event.preventDefault();
        event.stopPropagation();
        handlePasteTagsClick(panel);
        return;
      }

      const pasteCancelBtn = event.target.closest("[data-eto-paste-cancel]");
      if (pasteCancelBtn) {
        event.preventDefault();
        event.stopPropagation();
        hidePasteModal(panel);
        return;
      }

      const pasteActionBtn = event.target.closest("[data-eto-paste-action]");
      if (pasteActionBtn) {
        event.preventDefault();
        event.stopPropagation();
        handlePasteAction(
          pasteActionBtn.getAttribute("data-eto-paste-action"),
          panel
        );
        return;
      }

      const timelineTagBtn = event.target.closest("[data-eto-timeline-tag-id]");
      if (timelineTagBtn) {
        event.preventDefault();
        event.stopPropagation();
        addTimelineMarkerForTag(timelineTagBtn.getAttribute("data-eto-timeline-tag-id"));
        timelineTagBtn.blur?.();
        return;
      }

      const parentToggleBtn = event.target.closest("[data-eto-parent-toggle-id]");
      if (parentToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = parentToggleBtn.getAttribute("data-eto-parent-toggle-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const tagBtn = event.target.closest("[data-eto-tag-id]");
      if (tagBtn) {
        event.preventDefault();
        const tagId = tagBtn.getAttribute("data-eto-tag-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const searchToggleBtn = event.target.closest("[data-eto-search-toggle-id]");
      if (searchToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = searchToggleBtn.getAttribute("data-eto-search-toggle-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const searchJumpBtn = event.target.closest("[data-eto-search-jump-id]");
      if (searchJumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        revealSearchResult({
          id: searchJumpBtn.getAttribute("data-eto-search-jump-id"),
          targetId: searchJumpBtn.getAttribute("data-eto-search-target-id"),
          targetKind: searchJumpBtn.getAttribute("data-eto-search-target-kind"),
          groupId: searchJumpBtn.getAttribute("data-eto-search-group-id"),
          subgroupId: searchJumpBtn.getAttribute("data-eto-search-subgroup-id") || "",
        });
        return;
      }

      const toggleHeader = event.target.closest("[data-eto-toggle-section]");
      if (toggleHeader) {
        const section = toggleHeader.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
        if (section) section.classList.toggle("is-open");
      }
    });

    panel.addEventListener("mousedown", (event) => {
      if (event.button !== 1) return;
      const target = event.target.closest(
        "[data-eto-tag-id], [data-eto-toggle-section], [data-eto-search-jump-id]"
      );
      if (target) event.preventDefault();
    });

    panel.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;

      const tagBtn = event.target.closest("[data-eto-tag-id]");
      if (tagBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = tagBtn.getAttribute("data-eto-tag-id");
        if (tagId) window.open(`/tags/${tagId}`, "_blank", "noopener");
        return;
      }

      const searchJumpBtn = event.target.closest("[data-eto-search-jump-id]");
      if (searchJumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = searchJumpBtn.getAttribute("data-eto-search-jump-id");
        if (tagId) window.open(`/tags/${tagId}`, "_blank", "noopener");
        return;
      }

      const toggleHeader = event.target.closest("[data-eto-toggle-section]");
      if (toggleHeader) {
        const section = toggleHeader.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
        const tagId = section?.getAttribute("data-eto-header-tag-id");
        if (!tagId) return;

        event.preventDefault();
        event.stopPropagation();
        window.open(`/tags/${tagId}`, "_blank", "noopener");
      }
    });
  }

  function createPanel(groups, cfg) {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "edit-tags-overhaul";

    applyPanelVariables(panel, cfg);

    const titleRow = document.createElement("div");
    titleRow.className = "edit-tags-overhaul__panel-header";

    const heading = document.createElement("h6");
    heading.className = "edit-tags-overhaul__panel-title";
    heading.textContent = cfg.panelTitle || "Grouped Tags";

    const summary = document.createElement("div");
    summary.className = "edit-tags-overhaul__panel-summary";
    summary.textContent = `${groups.length} groups`;

    const headerInfo = document.createElement("div");
    headerInfo.className = "edit-tags-overhaul__panel-header-info";
    headerInfo.appendChild(heading);
    headerInfo.appendChild(summary);

    const panelActions = document.createElement("div");
    panelActions.className = "edit-tags-overhaul__panel-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "edit-tags-overhaul__panel-btn";
    copyBtn.setAttribute("data-eto-copy-tags", "1");
    copyBtn.textContent = "Copy Tags";

    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.className = "edit-tags-overhaul__panel-btn";
    pasteBtn.setAttribute("data-eto-paste-tags", "1");
    pasteBtn.textContent = "Paste Tags";

    panelActions.appendChild(copyBtn);
    panelActions.appendChild(pasteBtn);

    titleRow.appendChild(headerInfo);
    titleRow.appendChild(panelActions);
    panel.appendChild(titleRow);

    const searchControls = createSearchControls();
    panel.appendChild(searchControls);

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "edit-tags-overhaul__groups";

    groups.forEach((group) => {
      groupsWrap.appendChild(createGroupSection(group, cfg));
    });

    panel.appendChild(groupsWrap);
    attachPanelEventDelegation(panel);
    renderSearchResults(panel);
    syncClipboardActionState(panel);
    return panel;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function readFullscreenLayout() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FULLSCREEN_LAYOUT_STORAGE_KEY) || "{}");
      return {
        x: Number.isFinite(Number(parsed.x)) ? Number(parsed.x) : null,
        y: Number.isFinite(Number(parsed.y)) ? Number(parsed.y) : null,
        width: Number.isFinite(Number(parsed.width)) ? Number(parsed.width) : DEFAULT_FULLSCREEN_PANEL_LAYOUT.width,
        height: Number.isFinite(Number(parsed.height)) ? Number(parsed.height) : DEFAULT_FULLSCREEN_PANEL_LAYOUT.height,
        scale: Number.isFinite(Number(parsed.scale)) ? Number(parsed.scale) : DEFAULT_FULLSCREEN_PANEL_LAYOUT.scale,
        minimized: Boolean(parsed.minimized),
      };
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag panel layout read failed", err);
      return { x: null, y: null, ...DEFAULT_FULLSCREEN_PANEL_LAYOUT };
    }
  }

  function writeFullscreenLayout(layout) {
    try {
      window.localStorage.setItem(FULLSCREEN_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag panel layout write failed", err);
    }
  }

  function clearFullscreenLayout() {
    try {
      window.localStorage.removeItem(FULLSCREEN_LAYOUT_STORAGE_KEY);
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag panel layout reset failed", err);
    }
  }

  function readQuickTagOverlayOpenState() {
    try {
      const value = window.localStorage.getItem(QUICK_TAG_OVERLAY_OPEN_STORAGE_KEY);
      if (value === "true") return true;
      if (value === "false") return false;
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag panel open state read failed", err);
    }
    return null;
  }

  function writeQuickTagOverlayOpenState(open) {
    try {
      window.localStorage.setItem(QUICK_TAG_OVERLAY_OPEN_STORAGE_KEY, open ? "true" : "false");
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag panel open state write failed", err);
    }
  }

  function readFullscreenMiniPanelLayouts() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FULLSCREEN_MINI_PANELS_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag mini panel layout read failed", err);
      return {};
    }
  }

  function writeFullscreenMiniPanelLayouts(layouts) {
    try {
      window.localStorage.setItem(FULLSCREEN_MINI_PANELS_STORAGE_KEY, JSON.stringify(layouts || {}));
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag mini panel layout write failed", err);
    }
  }

  function removeFullscreenMiniPanelLayout(groupId) {
    const layouts = readFullscreenMiniPanelLayouts();
    delete layouts[String(groupId)];
    writeFullscreenMiniPanelLayouts(layouts);
  }

  function getFullscreenViewport() {
    const fullscreenElement = document.fullscreenElement;
    const rect = fullscreenElement?.getBoundingClientRect?.();
    return {
      width: Math.max(320, Math.round(rect?.width || window.innerWidth || 1280)),
      height: Math.max(240, Math.round(rect?.height || window.innerHeight || 720)),
    };
  }

  function normalizeFullscreenLayout(layout = readFullscreenLayout()) {
    const viewport = getFullscreenViewport();
    const width = clampNumber(layout.width, 300, Math.max(300, viewport.width - 32));
    const height = clampNumber(layout.height, 240, Math.max(240, viewport.height - 32));
    const defaultX = Math.max(16, viewport.width - width - 24);
    const defaultY = Math.max(16, Math.round(viewport.height * 0.12));
    return {
      x: clampNumber(layout.x ?? defaultX, 8, Math.max(8, viewport.width - width - 8)),
      y: clampNumber(layout.y ?? defaultY, 8, Math.max(8, viewport.height - 48)),
      width,
      height,
      scale: clampNumber(layout.scale, FULLSCREEN_SCALE_STEPS[0], FULLSCREEN_SCALE_STEPS[FULLSCREEN_SCALE_STEPS.length - 1]),
      minimized: Boolean(layout.minimized),
    };
  }

  function getFullscreenPanelLayout() {
    return normalizeFullscreenLayout(readFullscreenLayout());
  }

  function normalizeFullscreenMiniPanelLayout(rawLayout = {}, index = 0) {
    const viewport = getFullscreenViewport();
    const width = clampNumber(
      rawLayout.width ?? DEFAULT_FULLSCREEN_MINI_PANEL_LAYOUT.width,
      240,
      Math.max(240, viewport.width - 32)
    );
    const height = clampNumber(
      rawLayout.height ?? DEFAULT_FULLSCREEN_MINI_PANEL_LAYOUT.height,
      180,
      Math.max(180, viewport.height - 32)
    );
    const hasSavedPosition =
      Number.isFinite(Number(rawLayout.x)) &&
      Number.isFinite(Number(rawLayout.y));
    const defaultX = Math.max(16, Math.round((viewport.width - width) / 2) + index * 28);
    const defaultY = Math.max(16, Math.round((viewport.height - height) / 2) + index * 24);
    return {
      x: clampNumber(hasSavedPosition ? rawLayout.x : defaultX, 8, Math.max(8, viewport.width - width - 8)),
      y: clampNumber(hasSavedPosition ? rawLayout.y : defaultY, 8, Math.max(8, viewport.height - 48)),
      width,
      height,
    };
  }

  function persistCurrentFullscreenPanelLayout() {
    const panel = state.fullscreen.panel;
    if (!panel) return;
    const current = getFullscreenPanelLayout();
    const rect = panel.getBoundingClientRect();
    const minimized = panel.classList.contains("is-minimized");
    writeFullscreenLayout({
      ...current,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: minimized ? current.width : Math.round(rect.width),
      height: minimized ? current.height : Math.round(rect.height),
      minimized,
    });
  }

  function persistFullscreenMiniPanelLayout(groupId, panel) {
    if (!groupId || !panel) return;
    const layouts = readFullscreenMiniPanelLayouts();
    const rect = panel.getBoundingClientRect();
    layouts[String(groupId)] = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    writeFullscreenMiniPanelLayouts(layouts);
  }

  function applyFullscreenPanelLayout(panel = state.fullscreen.panel) {
    if (!panel) return;
    const layout = getFullscreenPanelLayout();
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
    panel.style.width = `${layout.width}px`;
    panel.style.height = `${layout.height}px`;
    panel.style.setProperty("--eto-fullscreen-scale", String(layout.scale));
    panel.classList.toggle("is-minimized", layout.minimized);
    updateFullscreenMinimizeButton(panel, layout.minimized);
    syncFullscreenMiniPanelScale();
  }

  function applyFullscreenSharedHoverSetting(root = state.fullscreen.root, cfg = state.config || {}) {
    const enabled = shouldUseFullscreenSharedHover(cfg);
    root?.classList.toggle("edit-tags-overhaul__fullscreen-root--shared-hover", enabled);
    if (!enabled) document.body.classList.remove("edit-tags-overhaul-shared-hover-active");
  }

  function refreshSharedHoverBodyClass() {
    const enabled = shouldUseFullscreenSharedHover(state.config || {});
    const active = enabled && Boolean(
      document.querySelector(".edit-tags-overhaul--fullscreen-panel:hover, .edit-tags-overhaul--fullscreen-panel.is-dragging, .edit-tags-overhaul-timeline-overlay:hover, .edit-tags-overhaul-timeline-overlay.is-resizing")
    );
    document.body.classList.toggle("edit-tags-overhaul-shared-hover-active", active);
  }

  function scheduleSharedHoverRefresh() {
    window.setTimeout(refreshSharedHoverBodyClass, 20);
  }

  function attachSharedHoverListeners(target) {
    if (!target || target.__editTagsOverhaulSharedHoverAttached) return;
    target.__editTagsOverhaulSharedHoverAttached = true;
    target.addEventListener("pointerenter", refreshSharedHoverBodyClass);
    target.addEventListener("pointerleave", scheduleSharedHoverRefresh);
  }

  function isTimelinePairElement(target) {
    return Boolean(
      target?.closest?.(".edit-tags-overhaul-timeline-overlay, .edit-tags-overhaul--timeline-palette-panel")
    );
  }

  function isTimelinePairPointerInside() {
    if (
      document.querySelector(
        ".edit-tags-overhaul-timeline-overlay.is-resizing, .edit-tags-overhaul--timeline-palette-panel.is-dragging"
      )
    ) {
      return true;
    }

    const { x, y } = state.timelinePairPointer || {};
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return false;
    if (isTimelinePairElement(document.elementFromPoint(x, y))) return true;

    return Array.from(
      document.querySelectorAll(".edit-tags-overhaul-timeline-overlay, .edit-tags-overhaul--timeline-palette-panel")
    ).some((element) => {
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
  }

  function setTimelinePairHoverActive(active) {
    document.body.classList.toggle("edit-tags-overhaul-timeline-hover-active", active);
  }

  function refreshTimelinePairHoverBodyClass() {
    setTimelinePairHoverActive(isTimelinePairPointerInside());
  }

  function scheduleTimelinePairHoverRefresh(delay = 160) {
    if (state.timelinePairHoverTimer) window.clearTimeout(state.timelinePairHoverTimer);
    state.timelinePairHoverTimer = window.setTimeout(() => {
      state.timelinePairHoverTimer = null;
      refreshTimelinePairHoverBodyClass();
    }, delay);
  }

  function handleTimelinePairPointerEnter(event) {
    state.timelinePairPointer = { x: event.clientX, y: event.clientY };
    if (state.timelinePairHoverTimer) {
      window.clearTimeout(state.timelinePairHoverTimer);
      state.timelinePairHoverTimer = null;
    }
    setTimelinePairHoverActive(true);
  }

  function handleTimelinePairPointerMove(event) {
    state.timelinePairPointer = { x: event.clientX, y: event.clientY };
    setTimelinePairHoverActive(true);
  }

  function handleTimelinePairPointerLeave(event) {
    state.timelinePairPointer = { x: event.clientX, y: event.clientY };
    scheduleTimelinePairHoverRefresh();
  }

  function attachTimelinePairHoverListeners(target) {
    if (!target || target.__editTagsOverhaulTimelineHoverAttached) return;
    target.__editTagsOverhaulTimelineHoverAttached = true;
    target.addEventListener("pointerenter", handleTimelinePairPointerEnter);
    target.addEventListener("pointermove", handleTimelinePairPointerMove);
    target.addEventListener("pointerleave", handleTimelinePairPointerLeave);
  }

  function applyFullscreenMiniPanelLayout(panel, layout) {
    if (!panel) return;
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
    panel.style.width = `${layout.width}px`;
    panel.style.height = `${layout.height}px`;
    panel.style.setProperty("--eto-fullscreen-scale", String(getFullscreenPanelLayout().scale));
  }

  function syncFullscreenMiniPanelScale() {
    const scale = String(getFullscreenPanelLayout().scale);
    state.fullscreen.miniPanels.forEach((panel) => {
      panel.style.setProperty("--eto-fullscreen-scale", scale);
    });
  }

  function updateFullscreenMinimizeButton(panel, minimized) {
    const button = panel?.querySelector("[data-eto-fullscreen-minimize]");
    if (!button) return;
    button.textContent = minimized ? "\u25A1" : "\u2212";
    button.setAttribute(
      "aria-label",
      minimized ? "Expand quick tag panel overlay" : "Minimize quick tag panel overlay"
    );
    button.setAttribute("title", minimized ? "Expand" : "Minimize");
  }

  function changeFullscreenPanelScale(delta) {
    const layout = getFullscreenPanelLayout();
    const currentIndex = FULLSCREEN_SCALE_STEPS.reduce((bestIndex, step, index) => {
      return Math.abs(step - layout.scale) < Math.abs(FULLSCREEN_SCALE_STEPS[bestIndex] - layout.scale)
        ? index
        : bestIndex;
    }, 0);
    const nextIndex = clampNumber(currentIndex + delta, 0, FULLSCREEN_SCALE_STEPS.length - 1);
    writeFullscreenLayout({ ...layout, scale: FULLSCREEN_SCALE_STEPS[nextIndex] });
    applyFullscreenPanelLayout();
  }

  function setFullscreenPanelMinimized(minimized) {
    const layout = getFullscreenPanelLayout();
    writeFullscreenLayout({ ...layout, minimized });
    applyFullscreenPanelLayout();
  }

  function resetFullscreenPanelLayout() {
    clearFullscreenLayout();
    clearTimelinePaletteLayout();
    applyFullscreenPanelLayout();
    requestTimelineOverlaySync();
  }

  function startFullscreenPanelDrag(event) {
    const panel = event.target.closest(".edit-tags-overhaul--fullscreen-panel");
    if (!panel || event.button !== 0 || event.target.closest("button, input, a")) return;

    const rect = panel.getBoundingClientRect();
    state.fullscreen.dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      panel,
      groupId: panel.getAttribute("data-eto-fullscreen-mini-group-id") || "",
    };

    panel.setPointerCapture?.(event.pointerId);
    panel.classList.add("is-dragging");
    event.preventDefault();
  }

  function handleFullscreenPanelDrag(event) {
    const drag = state.fullscreen.dragState;
    const panel = drag?.panel;
    if (!drag || !panel || event.pointerId !== drag.pointerId) return;

    const viewport = getFullscreenViewport();
    const x = clampNumber(event.clientX - drag.offsetX, 8, Math.max(8, viewport.width - drag.width - 8));
    const y = clampNumber(event.clientY - drag.offsetY, 8, Math.max(8, viewport.height - 48));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  function stopFullscreenPanelDrag(event) {
    const drag = state.fullscreen.dragState;
    const panel = drag?.panel;
    if (!drag || !panel || event.pointerId !== drag.pointerId) return;

    panel.releasePointerCapture?.(event.pointerId);
    panel.classList.remove("is-dragging");
    state.fullscreen.dragState = null;
    if (drag.groupId) persistFullscreenMiniPanelLayout(drag.groupId, panel);
    else persistCurrentFullscreenPanelLayout();
  }

  function attachFullscreenPanelEventDelegation(panel) {
    panel.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-eto-fullscreen-drag]")) startFullscreenPanelDrag(event);
    });
    panel.addEventListener("pointermove", handleFullscreenPanelDrag);
    panel.addEventListener("pointerup", stopFullscreenPanelDrag);
    panel.addEventListener("pointercancel", stopFullscreenPanelDrag);

    panel.addEventListener("click", (event) => {
      const minimizeBtn = event.target.closest("[data-eto-fullscreen-minimize]");
      if (minimizeBtn) {
        event.preventDefault();
        event.stopPropagation();
        setFullscreenPanelMinimized(!panel.classList.contains("is-minimized"));
        minimizeBtn.blur?.();
        return;
      }

      const scaleBtn = event.target.closest("[data-eto-fullscreen-scale]");
      if (scaleBtn) {
        event.preventDefault();
        event.stopPropagation();
        changeFullscreenPanelScale(Number(scaleBtn.getAttribute("data-eto-fullscreen-scale")) || 0);
        scaleBtn.blur?.();
        return;
      }

      const resetBtn = event.target.closest("[data-eto-fullscreen-reset]");
      if (resetBtn) {
        event.preventDefault();
        event.stopPropagation();
        resetFullscreenPanelLayout();
        resetBtn.blur?.();
        return;
      }

      const paletteColorModeBtn = event.target.closest("[data-eto-timeline-palette-color-mode]");
      if (paletteColorModeBtn) {
        event.preventDefault();
        event.stopPropagation();
        state.timelinePaletteColorEditMode = !state.timelinePaletteColorEditMode;
        requestTimelineOverlaySync();
        paletteColorModeBtn.blur?.();
        return;
      }

      const timelineTagBtn = event.target.closest("[data-eto-timeline-tag-id]");
      if (timelineTagBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = timelineTagBtn.getAttribute("data-eto-timeline-tag-id");
        if (state.timelinePaletteColorEditMode && timelineTagBtn.closest("[data-eto-timeline-palette]")) {
          promptTimelineTagColor(tagId);
        } else {
          addTimelineMarkerForTag(tagId);
        }
        timelineTagBtn.blur?.();
        return;
      }

      const popoutBtn = event.target.closest("[data-eto-fullscreen-popout-group-id]");
      if (popoutBtn) {
        event.preventDefault();
        event.stopPropagation();
        openFullscreenMiniPanel(popoutBtn.getAttribute("data-eto-fullscreen-popout-group-id"));
        popoutBtn.blur?.();
        return;
      }

      const miniCloseBtn = event.target.closest("[data-eto-fullscreen-mini-close]");
      if (miniCloseBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeFullscreenMiniPanel(miniCloseBtn.getAttribute("data-eto-fullscreen-mini-close"), true);
        miniCloseBtn.blur?.();
        return;
      }

      if (panel.classList.contains("is-minimized") && event.target.closest("[data-eto-fullscreen-drag]")) {
        event.preventDefault();
        setFullscreenPanelMinimized(false);
        return;
      }

      const parentToggleBtn = event.target.closest("[data-eto-parent-toggle-id]");
      if (parentToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = parentToggleBtn.getAttribute("data-eto-parent-toggle-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const tagBtn = event.target.closest("[data-eto-tag-id]");
      if (tagBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = tagBtn.getAttribute("data-eto-tag-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const searchToggleBtn = event.target.closest("[data-eto-search-toggle-id]");
      if (searchToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = searchToggleBtn.getAttribute("data-eto-search-toggle-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const searchJumpBtn = event.target.closest("[data-eto-search-jump-id]");
      if (searchJumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        revealSearchResult(
          {
            id: searchJumpBtn.getAttribute("data-eto-search-jump-id"),
            targetId: searchJumpBtn.getAttribute("data-eto-search-target-id"),
            targetKind: searchJumpBtn.getAttribute("data-eto-search-target-kind"),
            groupId: searchJumpBtn.getAttribute("data-eto-search-group-id"),
            subgroupId: searchJumpBtn.getAttribute("data-eto-search-subgroup-id") || "",
          },
          panel
        );
        return;
      }

      const toggleHeader = event.target.closest("[data-eto-toggle-section]");
      if (toggleHeader) {
        event.preventDefault();
        event.stopPropagation();
        const section = toggleHeader.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
        if (section) section.classList.toggle("is-open");
      }
    });
  }

  function getFullscreenGroupById(groupId) {
    return state.fullscreen.groupMap.get(String(groupId)) || null;
  }

  function createFullscreenMiniPanel(group, cfg, layout) {
    const groupId = String(group.parent.id);
    const panel = document.createElement("section");
    panel.className = "edit-tags-overhaul edit-tags-overhaul--fullscreen-panel edit-tags-overhaul--fullscreen-mini-panel";
    panel.setAttribute("data-eto-fullscreen-mini-group-id", groupId);
    applyPanelVariables(panel, cfg);
    panel.style.setProperty("--eto-fullscreen-idle-opacity", String(getFullscreenIdleOpacity(cfg)));

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__fullscreen-header";
    header.setAttribute("data-eto-fullscreen-drag", "1");

    const titleWrap = document.createElement("div");
    titleWrap.className = "edit-tags-overhaul__fullscreen-title-wrap";

    const title = document.createElement("div");
    title.className = "edit-tags-overhaul__fullscreen-title";
    title.textContent = group.parent.name;

    titleWrap.appendChild(title);

    const controls = document.createElement("div");
    controls.className = "edit-tags-overhaul__fullscreen-controls";
    controls.innerHTML = `
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-mini-close="${escapeHtml(groupId)}" aria-label="Collapse ${escapeHtml(group.parent.name)} back to main panel" title="Collapse to main panel">−</button>
    `;

    header.appendChild(titleWrap);
    header.appendChild(controls);
    panel.appendChild(header);

    const content = document.createElement("div");
    content.className = "edit-tags-overhaul__fullscreen-content";

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "edit-tags-overhaul__groups edit-tags-overhaul__fullscreen-groups";
    groupsWrap.appendChild(createGroupSection(group, {
      ...cfg,
      defaultExpanded: true,
      subgroupsDefaultExpanded: false,
      autoExpandIfSelected: false,
      __fullscreenMainPanel: false,
    }));
    content.appendChild(groupsWrap);
    panel.appendChild(content);

    attachFullscreenPanelEventDelegation(panel);
    applyFullscreenMiniPanelLayout(panel, layout);
    announceFullscreenPanel(panel);
    return panel;
  }

  function announceFullscreenPanel(panel) {
    panel.classList.add("is-new", "edit-tags-overhaul__search-target-flash");
    window.setTimeout(() => {
      panel.classList.remove("is-new", "edit-tags-overhaul__search-target-flash");
    }, 3000);
  }

  function openFullscreenMiniPanel(groupId, layoutOverride = null, persist = true) {
    const normalizedGroupId = String(groupId || "");
    const group = getFullscreenGroupById(normalizedGroupId);
    if (!group || !state.fullscreen.root) return null;

    const existingPanel = state.fullscreen.miniPanels.get(normalizedGroupId);
    if (existingPanel) {
      announceFullscreenPanel(existingPanel);
      return existingPanel;
    }

    const cfg = {
      ...(state.config || {}),
      displayMode: "text",
      defaultExpanded: true,
      subgroupsDefaultExpanded: false,
      autoExpandIfSelected: false,
    };
    const panelIndex = state.fullscreen.miniPanels.size;
    const layout = normalizeFullscreenMiniPanelLayout(layoutOverride || {}, panelIndex);
    const panel = createFullscreenMiniPanel(group, cfg, layout);

    state.fullscreen.root.appendChild(panel);
    state.fullscreen.miniPanels.set(normalizedGroupId, panel);

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => persistFullscreenMiniPanelLayout(normalizedGroupId, panel));
      observer.observe(panel);
      state.fullscreen.miniResizeObservers.set(normalizedGroupId, observer);
    }

    if (persist) persistFullscreenMiniPanelLayout(normalizedGroupId, panel);
    syncRenderedSelectionStates();
    return panel;
  }

  function closeFullscreenMiniPanel(groupId, forgetLayout = false) {
    const normalizedGroupId = String(groupId || "");
    const observer = state.fullscreen.miniResizeObservers.get(normalizedGroupId);
    observer?.disconnect();
    state.fullscreen.miniResizeObservers.delete(normalizedGroupId);

    state.fullscreen.miniPanels.get(normalizedGroupId)?.remove();
    state.fullscreen.miniPanels.delete(normalizedGroupId);

    if (forgetLayout) removeFullscreenMiniPanelLayout(normalizedGroupId);
  }

  function closeFullscreenMiniPanels() {
    Array.from(state.fullscreen.miniPanels.keys()).forEach((groupId) => {
      closeFullscreenMiniPanel(groupId, false);
    });
  }

  function applyTimelinePalettePanelLayout(panel) {
    const layout = state.timelinePaletteLayout || readTimelinePaletteLayout();
    const width = Math.round(clampNumber(layout?.width ?? 384, 240, Math.max(240, window.innerWidth - 24)));
    const height = Math.round(clampNumber(layout?.height ?? Math.min(window.innerHeight * 0.48, 384), 180, Math.max(180, window.innerHeight - 24)));
    const defaultLeft = Math.round((window.innerWidth - width) / 2);
    const defaultTop = Math.round((window.innerHeight - height) / 2);
    const left = clampNumber(layout ? Number(layout.left) || 0 : defaultLeft, 8, Math.max(8, window.innerWidth - width - 8));
    const top = clampNumber(layout ? Number(layout.top) || 0 : defaultTop, 8, Math.max(8, window.innerHeight - height - 8));

    if (layout) state.timelinePaletteLayout = layout;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.bottom = "auto";
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  }

  function createTimelineTagPalettePanel() {
    const cfg = {
      ...(state.config || {}),
      displayMode: "text",
      defaultExpanded: true,
      subgroupsDefaultExpanded: false,
      autoExpandIfSelected: false,
      __fullscreenMainPanel: false,
    };
    const groups = buildTimelinePaletteGroups();
    const panel = document.createElement("section");
    panel.className = "edit-tags-overhaul edit-tags-overhaul--fullscreen-panel edit-tags-overhaul--fullscreen-mini-panel edit-tags-overhaul--timeline-palette-panel";
    panel.setAttribute("data-eto-timeline-palette", "1");
    applyPanelVariables(panel, cfg);
    panel.style.setProperty("--eto-fullscreen-idle-opacity", String(getFullscreenIdleOpacity(state.config || {})));

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__fullscreen-header";
    header.setAttribute("data-eto-timeline-palette-drag", "1");

    const titleWrap = document.createElement("div");
    titleWrap.className = "edit-tags-overhaul__fullscreen-title-wrap";

    const title = document.createElement("div");
    title.className = "edit-tags-overhaul__fullscreen-title";
    title.textContent = "Timeline Tags";
    titleWrap.appendChild(title);

    const controls = document.createElement("div");
    controls.className = "edit-tags-overhaul__fullscreen-controls";

    const colors = document.createElement("button");
    colors.type = "button";
    colors.className = `edit-tags-overhaul__fullscreen-control${state.timelinePaletteColorEditMode ? " is-active" : ""}`;
    colors.setAttribute("data-eto-timeline-palette-color-mode", "1");
    colors.setAttribute("aria-pressed", state.timelinePaletteColorEditMode ? "true" : "false");
    colors.setAttribute("aria-label", "Toggle timeline tag color editing");
    colors.setAttribute("title", state.timelinePaletteColorEditMode ? "Color editing is on" : "Edit timeline tag colors");
    colors.textContent = state.timelinePaletteColorEditMode ? "Editing Tag Colors..." : "Edit Tag Colors";
    colors.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      state.timelinePaletteColorEditMode = !state.timelinePaletteColorEditMode;
      requestTimelineOverlaySync();
    });
    controls.appendChild(colors);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "edit-tags-overhaul__fullscreen-control";
    close.setAttribute("data-eto-timeline-palette-close", "1");
    close.setAttribute("aria-label", "Close timeline tag palette");
    close.setAttribute("title", "Close timeline tag palette");
    close.textContent = "\u2212";
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      closeTimelineTagPalettePanel();
    });
    controls.appendChild(close);

    header.appendChild(titleWrap);
    header.appendChild(controls);
    panel.appendChild(header);

    const content = document.createElement("div");
    content.className = "edit-tags-overhaul__fullscreen-content";

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "edit-tags-overhaul__groups edit-tags-overhaul__fullscreen-groups";

    if (groups.length) {
      groups.forEach((group) => groupsWrap.appendChild(createGroupSection(group, cfg)));
    } else {
      const empty = document.createElement("div");
      empty.className = "edit-tags-overhaul__timeline-palette-empty";
      empty.textContent = "No timeline tags found";
      groupsWrap.appendChild(empty);
    }

    content.appendChild(groupsWrap);
    panel.appendChild(content);
    attachFullscreenPanelEventDelegation(panel);
    return panel;
  }

  function mountTimelineTagPalettePanel(overlay) {
    if (!overlay) return null;
    document.querySelectorAll("[data-eto-timeline-palette]").forEach((existing) => existing.remove());
    const panel = createTimelineTagPalettePanel();
    const paletteRoot = document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.body;
    paletteRoot.appendChild(panel);
    attachSharedHoverListeners(panel);
    attachTimelinePairHoverListeners(panel);
    applyTimelinePalettePanelLayout(panel);
    panel.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, a, textarea, select")) return;
      if (event.target.closest("[data-eto-timeline-palette-drag]")) startTimelinePaletteDrag(event);
    });
    panel.addEventListener("pointermove", updateTimelinePaletteDrag);
    panel.addEventListener("pointerup", (event) => {
      stopTimelinePaletteDrag(event);
      persistTimelinePaletteLayout();
    });
    panel.addEventListener("pointercancel", (event) => {
      stopTimelinePaletteDrag(event);
      persistTimelinePaletteLayout();
    });
    panel.addEventListener("click", (event) => {
      const closeBtn = event.target.closest("[data-eto-timeline-palette-close]");
      if (!closeBtn) return;

      event.preventDefault();
      event.stopPropagation();
      closeTimelineTagPalettePanel();
    });
    return panel;
  }

  function closeTimelineTagPalettePanel() {
    state.timelinePaletteOpen = false;
    document.querySelectorAll("[data-eto-timeline-palette]").forEach((palette) => palette.remove());
    scheduleTimelinePairHoverRefresh(0);
    requestTimelineOverlaySync();
    releaseTimelineFocus();
  }

  function removeTimelineOverlay() {
    document.getElementById(TIMELINE_OVERLAY_ID)?.remove();
    document.querySelectorAll("[data-eto-timeline-palette]").forEach((palette) => palette.remove());
    document.body.classList.remove("edit-tags-overhaul-timeline-hover-active");
    if (state.timelinePairHoverTimer) window.clearTimeout(state.timelinePairHoverTimer);
    state.timelinePairHoverTimer = null;
    state.timelinePairPointer = { x: -1, y: -1 };
    state.timelineTimeBadge?.remove();
    state.timelineTimeBadge = null;
    state.timelineDragState = null;
    state.timelineResizeState = null;
    state.timelinePaletteDragState = null;
    if (state.timelineVideo && state.timelineVideoListener) {
      removeTimelineVideoListeners(state.timelineVideo, state.timelineVideoListener);
    }
    if (state.timelineDurationRetry) window.clearTimeout(state.timelineDurationRetry);
    state.timelineDurationRetry = null;
    state.timelineVideo = null;
    state.timelineVideoListener = null;
  }

  function addTimelineVideoListeners(video, listener) {
    if (!video || !listener) return;
    ["loadedmetadata", "loadeddata", "durationchange", "canplay", "play"].forEach((eventName) => {
      video.addEventListener(eventName, listener);
    });
  }

  function removeTimelineVideoListeners(video, listener) {
    if (!video || !listener) return;
    ["loadedmetadata", "loadeddata", "durationchange", "canplay", "play"].forEach((eventName) => {
      video.removeEventListener(eventName, listener);
    });
  }

  function getTimelineMarkerStart(marker) {
    return Math.max(0, Number(marker?.seconds || 0));
  }

  function getTimelineMarkerEnd(marker, minSpan) {
    const start = getTimelineMarkerStart(marker);
    const endSeconds = Number(marker?.endSeconds);
    return Number.isFinite(endSeconds) && endSeconds > start
      ? Math.max(start, endSeconds)
      : start + minSpan;
  }

  function getTimelineMarkerMinSpanSeconds(duration, track = null) {
    const safeDuration = Math.max(1, Number(duration) || 1);
    const trackWidth = Number(track?.getBoundingClientRect?.().width || 0);
    if (trackWidth > 0) {
      return clampNumber((TIMELINE_MARKER_MIN_WIDTH_PX / trackWidth) * safeDuration, 0.25, safeDuration);
    }
    return Math.min(Math.max(0.75, safeDuration * 0.004), 6);
  }

  function getTimelineTrackForTag(tagId) {
    const overlay = document.getElementById(TIMELINE_OVERLAY_ID);
    if (!overlay) return null;
    return Array.from(overlay.querySelectorAll("[data-eto-timeline-track-tag-id]"))
      .find((track) => String(track.getAttribute("data-eto-timeline-track-tag-id")) === String(tagId)) || null;
  }

  function findAvailableTimelineStart(markers, options) {
    const tagId = String(options?.tagId || "");
    const markerId = options?.markerId ? String(options.markerId) : "";
    const duration = Math.max(1, Number(options?.duration) || 1);
    const length = clampNumber(options?.length, 0.1, duration);
    const desiredStart = clampNumber(options?.desiredStart, 0, Math.max(0, duration - length));
    const minSpan = Math.max(0.1, Number(options?.minSpan) || length);
    const biasRight = Boolean(options?.biasRight);
    const intervals = markers
      .filter((marker) => String(marker?.tagId || "") === tagId && (!markerId || String(marker?.id) !== markerId))
      .map((marker) => ({
        start: getTimelineMarkerStart(marker),
        end: getTimelineMarkerEnd(marker, minSpan),
      }))
      .sort((a, b) => a.start - b.start);

    const gaps = [];
    let cursor = 0;
    intervals.forEach((interval) => {
      const gapEnd = Math.max(0, interval.start - TIMELINE_MARKER_GAP_SECONDS);
      if (gapEnd - cursor >= length) gaps.push({ start: cursor, end: gapEnd });
      cursor = Math.max(cursor, interval.end + TIMELINE_MARKER_GAP_SECONDS);
    });
    if (duration - cursor >= length) gaps.push({ start: cursor, end: duration });
    if (!gaps.length) return desiredStart;

    if (biasRight) {
      const rightGap = gaps.find((gap) => gap.end - length >= desiredStart);
      if (rightGap) return clampNumber(desiredStart, rightGap.start, rightGap.end - length);
    }

    return gaps
      .map((gap) => {
        const start = clampNumber(desiredStart, gap.start, gap.end - length);
        return { start, distance: Math.abs(start - desiredStart) };
      })
      .sort((a, b) => a.distance - b.distance)[0].start;
  }

  function getTimelineOverlayMount(video) {
    const fullscreenElement = document.fullscreenElement;
    if (video && fullscreenElement?.contains(video)) return { mount: fullscreenElement, fixed: false };

    const mount =
      video?.closest?.(".scene-player, .scene-video, .video-js, [class*='ScenePlayer']") ||
      getScenePlayerRoot() ||
      video?.parentElement ||
      document.body;
    return { mount, fixed: mount === document.body };
  }

  function isCssColorLike(value) {
    const color = normalizeCustomFieldValue(value);
    if (!color) return false;
    if (window.CSS?.supports?.("color", color)) return true;
    return /^(#(?:[0-9a-f]{3,8})|rgb\(|rgba\(|hsl\(|hsla\()/i.test(color);
  }

  function softenTimelineColor(value) {
    const color = normalizeCustomFieldValue(value);
    if (!isCssColorLike(color)) return "";

    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
      const raw = hex[1];
      const expanded = raw.length <= 4
        ? raw.split("").map((char) => char + char).join("")
        : raw;
      const r = parseInt(expanded.slice(0, 2), 16);
      const g = parseInt(expanded.slice(2, 4), 16);
      const b = parseInt(expanded.slice(4, 6), 16);
      const sourceAlpha = expanded.length >= 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
      const alpha = Math.min(0.5, Math.max(0, sourceAlpha));
      return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    }

    const rgb = color.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (rgb) {
      const alpha = Math.min(0.5, Math.max(0, Number(rgb[4] ?? 1) || 0.5));
      return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha.toFixed(3)})`;
    }

    const mixedColor = `color-mix(in srgb, ${color} 50%, transparent)`;
    return window.CSS?.supports?.("color", mixedColor) ? mixedColor : color;
  }

  function getTimelineMarkerColor(tagId, marker = null) {
    const customColor = normalizeCustomFieldValue(getTimelineTagColor(getTagRecordById(tagId)));
    if (isCssColorLike(customColor)) return softenTimelineColor(customColor);
    return "";
  }

  function getTimelineMarkerRawColor(tagId) {
    const color = normalizeCustomFieldValue(getTimelineTagColor(getTagRecordById(tagId)));
    return isCssColorLike(color) ? color : "";
  }

  function getTimelineColorStyle(tagId, marker = null) {
    const color = getTimelineMarkerColor(tagId, marker);
    const rawColor = getTimelineMarkerRawColor(tagId);
    return [
      color ? `--eto-timeline-marker-color: ${color}` : "",
      rawColor ? `--eto-timeline-marker-icon-color: ${rawColor}` : "",
    ].filter(Boolean).join("; ");
  }

  function ensureTimelineTimeBadge() {
    if (state.timelineTimeBadge) return state.timelineTimeBadge;
    const badge = document.createElement("div");
    badge.className = "edit-tags-overhaul-timeline-overlay__time-badge";
    badge.setAttribute("aria-hidden", "true");
    document.body.appendChild(badge);
    state.timelineTimeBadge = badge;
    return badge;
  }

  function updateTimelineTimeBadge(seconds, clientX, clientY) {
    const badge = ensureTimelineTimeBadge();
    badge.textContent = formatTimelineTime(seconds);
    badge.style.left = `${Math.round(clientX)}px`;
    badge.style.top = `${Math.round(clientY - 28)}px`;
    badge.classList.add("is-visible");
  }

  function hideTimelineTimeBadge() {
    state.timelineTimeBadge?.classList.remove("is-visible");
  }

  function releaseTimelineFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(`#${TIMELINE_OVERLAY_ID}`)) {
      active.blur();
    }
  }

  function seekTimelineMarker(markerBtn) {
    const video = getActiveSceneVideo();
    const seconds = Number(markerBtn?.getAttribute?.("data-eto-timeline-seconds"));
    if (video && Number.isFinite(seconds)) {
      video.currentTime = Math.max(0, seconds);
      const playPromise = video.paused ? null : video.play?.();
      if (playPromise?.catch) playPromise.catch(() => {});
    }
    releaseTimelineFocus();
  }

  function getTimelineSecondsFromPointer(track, clientX, duration) {
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? clampNumber((clientX - rect.left) / rect.width, 0, 1) : 0;
    return clampTimelineSeconds(ratio * duration, duration);
  }

  function startTimelineResize(event, overlay) {
    if (event.button !== 0) return;
    state.timelineResizeState = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: overlay.getBoundingClientRect().height,
      overlay,
    };
    overlay.setPointerCapture?.(event.pointerId);
    overlay.classList.add("is-resizing");
    event.preventDefault();
    event.stopPropagation();
  }

  function updateTimelineResize(event) {
    const resize = state.timelineResizeState;
    if (!resize || event.pointerId !== resize.pointerId) return;
    const nextHeight = clampNumber(resize.startHeight + (event.clientY - resize.startY), 54, Math.max(120, window.innerHeight * 0.42));
    resize.overlay.style.height = `${Math.round(nextHeight)}px`;
    event.preventDefault();
  }

  function stopTimelineResize(event) {
    const resize = state.timelineResizeState;
    if (!resize || event.pointerId !== resize.pointerId) return;
    resize.overlay.releasePointerCapture?.(event.pointerId);
    resize.overlay.classList.remove("is-resizing");
    state.timelineResizeState = null;
    releaseTimelineFocus();
  }

  function persistTimelinePaletteLayout() {
    const palette = document.querySelector("[data-eto-timeline-palette]");
    if (!palette) return;

    const paletteRect = palette.getBoundingClientRect();
    state.timelinePaletteLayout = {
      left: Math.round(paletteRect.left),
      top: Math.round(paletteRect.top),
      width: Math.round(paletteRect.width),
      height: Math.round(paletteRect.height),
    };
    writeTimelinePaletteLayout(state.timelinePaletteLayout);
  }

  function startTimelinePaletteDrag(event) {
    if (event.button !== 0) return;
    if (event.target.closest("button, input, a, textarea, select")) return;

    const palette = event.target.closest("[data-eto-timeline-palette]");
    if (!palette) return;

    const paletteRect = palette.getBoundingClientRect();
    state.timelinePaletteDragState = {
      pointerId: event.pointerId,
      palette,
      offsetX: event.clientX - paletteRect.left,
      offsetY: event.clientY - paletteRect.top,
      width: paletteRect.width,
      height: paletteRect.height,
      minLeft: 8,
      maxLeft: Math.max(8, window.innerWidth - paletteRect.width - 8),
      minTop: 8,
      maxTop: Math.max(8, window.innerHeight - paletteRect.height - 8),
    };

    palette.setPointerCapture?.(event.pointerId);
    palette.classList.add("is-dragging");
    event.preventDefault();
    event.stopPropagation();
  }

  function updateTimelinePaletteDrag(event) {
    const drag = state.timelinePaletteDragState;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const left = clampNumber(event.clientX - drag.offsetX, drag.minLeft, drag.maxLeft);
    const top = clampNumber(event.clientY - drag.offsetY, drag.minTop, drag.maxTop);

    drag.palette.style.left = `${Math.round(left)}px`;
    drag.palette.style.top = `${Math.round(top)}px`;
    drag.palette.style.bottom = "auto";
    state.timelinePaletteLayout = {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(drag.palette.getBoundingClientRect().width || drag.width),
      height: Math.round(drag.palette.getBoundingClientRect().height || drag.height),
    };
    writeTimelinePaletteLayout(state.timelinePaletteLayout);
    event.preventDefault();
  }

  function stopTimelinePaletteDrag(event) {
    const drag = state.timelinePaletteDragState;
    if (!drag || event.pointerId !== drag.pointerId) return;

    drag.palette.releasePointerCapture?.(event.pointerId);
    drag.palette.classList.remove("is-dragging");
    persistTimelinePaletteLayout();
    state.timelinePaletteDragState = null;
    releaseTimelineFocus();
  }

  function startTimelineMarkerDrag(event, overlay) {
    const handle = event.target.closest("[data-eto-timeline-marker-range-handle]");
    const marker = event.target.closest("[data-eto-timeline-marker-id]");
    if (event.button !== 0 || !marker) return;

    const track = marker.closest(".edit-tags-overhaul-timeline-overlay__track");
    const sceneId = marker.getAttribute("data-eto-timeline-scene-id");
    const markerId = marker.getAttribute("data-eto-timeline-marker-id");
    const duration = getTimelineOverlayDuration(overlay, getActiveSceneVideo(), getSceneTimelineMarkers(sceneId));
    const startSeconds = Number(marker.getAttribute("data-eto-timeline-seconds")) || 0;
    const endSeconds = Number(marker.getAttribute("data-eto-timeline-end-seconds"));
    const hasEnd = Number.isFinite(endSeconds) && endSeconds > startSeconds;
    const pointerSeconds = getTimelineSecondsFromPointer(track, event.clientX, duration);
    const pointerOffsetSeconds = handle ? 0 : pointerSeconds - startSeconds;

    state.timelineDragState = {
      pointerId: event.pointerId,
      mode: handle ? "range" : "move",
      sceneId,
      markerId,
      marker,
      track,
      duration,
      startSeconds,
      endSeconds: hasEnd ? endSeconds : null,
      rangeDuration: hasEnd ? endSeconds - startSeconds : 0,
      pointerOffsetSeconds,
      moved: false,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      shiftKey: event.shiftKey,
    };

    marker.setPointerCapture?.(event.pointerId);
    marker.classList.add("is-dragging");
    if (handle) marker.classList.add("edit-tags-overhaul-timeline-overlay__marker--range");
    event.preventDefault();
    event.stopPropagation();
  }

  function updateTimelineMarkerDrag(event) {
    const drag = state.timelineDragState;
    if (!drag || event.pointerId !== drag.pointerId || !drag.track) return;

    const pointerSeconds = getTimelineSecondsFromPointer(drag.track, event.clientX, drag.duration);
    const movedPixels = Math.hypot(event.clientX - drag.pointerStartX, event.clientY - drag.pointerStartY);
    if (movedPixels < 4 && !drag.moved) return;
    drag.moved = true;

    if (drag.mode === "range") {
      const endSeconds = Math.max(drag.startSeconds + 0.1, pointerSeconds);
      const left = Math.max(0, Math.min(100, (drag.startSeconds / drag.duration) * 100));
      const width = Math.max(0.6, Math.min(100 - left, ((endSeconds - drag.startSeconds) / drag.duration) * 100));
      drag.marker.style.left = `${left}%`;
      drag.marker.style.width = `max(3.4rem, ${width}%)`;
      drag.marker.setAttribute("data-eto-timeline-end-seconds", String(endSeconds));
      updateTimelineTimeBadge(endSeconds, event.clientX, event.clientY);
      return;
    }

    let nextStart = pointerSeconds - drag.pointerOffsetSeconds;
    let nextEnd = null;
    if (drag.endSeconds !== null) {
      const maxStart = Math.max(0, drag.duration - drag.rangeDuration);
      nextStart = clampNumber(nextStart, 0, maxStart);
      nextEnd = nextStart + drag.rangeDuration;
    } else {
      nextStart = clampTimelineSeconds(nextStart, drag.duration);
    }
    const left = Math.max(0, Math.min(100, (nextStart / drag.duration) * 100));
    drag.marker.style.left = `${left}%`;
    drag.marker.setAttribute("data-eto-timeline-seconds", String(nextStart));
    if (nextEnd !== null) drag.marker.setAttribute("data-eto-timeline-end-seconds", String(nextEnd));
    updateTimelineTimeBadge(nextStart, event.clientX, event.clientY);
  }

  function stopTimelineMarkerDrag(event) {
    const drag = state.timelineDragState;
    if (!drag || event.pointerId !== drag.pointerId) return;

    drag.marker.releasePointerCapture?.(event.pointerId);
    drag.marker.classList.remove("is-dragging");
    hideTimelineTimeBadge();

    if (drag.moved) {
      state.timelineSuppressClick = true;
      const seconds = clampTimelineSeconds(Number(drag.marker.getAttribute("data-eto-timeline-seconds")), drag.duration);
      const rawEnd = Number(drag.marker.getAttribute("data-eto-timeline-end-seconds"));
      const patch = { seconds };
      if (Number.isFinite(rawEnd) && rawEnd > seconds + 0.05) {
        patch.endSeconds = clampTimelineSeconds(rawEnd, drag.duration);
      } else {
        patch.endSeconds = null;
      }
      updateTimelineMarker(drag.sceneId, drag.markerId, patch, {
        mode: drag.mode,
        duration: drag.duration,
        track: drag.track,
      });
    } else if (!drag.shiftKey && drag.mode === "move") {
      state.timelineSuppressClick = true;
      seekTimelineMarker(drag.marker);
    }

    state.timelineDragState = null;
    releaseTimelineFocus();
  }

  function ensureTimelineOverlay(mountInfo) {
    let overlay = document.getElementById(TIMELINE_OVERLAY_ID);
    if (overlay && overlay.parentElement !== mountInfo.mount) {
      overlay.remove();
      overlay = null;
    }

    if (!overlay) {
      overlay = document.createElement("section");
      overlay.id = TIMELINE_OVERLAY_ID;
      overlay.className = "edit-tags-overhaul-timeline-overlay";
      overlay.addEventListener("pointerdown", (event) => {
        const resizeHandle = event.target.closest("[data-eto-timeline-resize-handle]");
        if (resizeHandle) {
          startTimelineResize(event, overlay);
          return;
        }
        if (event.target.closest("[data-eto-timeline-export], [data-eto-timeline-import]")) {
          event.stopPropagation();
          return;
        }
        if (event.target.closest("[data-eto-timeline-palette-close], [data-eto-timeline-palette-color-mode]")) {
          event.stopPropagation();
          return;
        }
        if (event.target.closest("[data-eto-timeline-palette-drag]")) {
          startTimelinePaletteDrag(event);
          return;
        }
        if (event.target.closest("[data-eto-timeline-palette-toggle], [data-eto-timeline-palette]")) {
          event.stopPropagation();
          return;
        }
        const markerBtn = event.target.closest("[data-eto-timeline-marker-id]");
        if (markerBtn) {
          startTimelineMarkerDrag(event, overlay);
        }
      });
      overlay.addEventListener("pointermove", (event) => {
        updateTimelineResize(event);
        updateTimelinePaletteDrag(event);
        updateTimelineMarkerDrag(event);
      });
      overlay.addEventListener("pointerup", (event) => {
        stopTimelineResize(event);
        stopTimelinePaletteDrag(event);
        persistTimelinePaletteLayout();
        stopTimelineMarkerDrag(event);
      });
      overlay.addEventListener("pointercancel", (event) => {
        stopTimelineResize(event);
        stopTimelinePaletteDrag(event);
        persistTimelinePaletteLayout();
        stopTimelineMarkerDrag(event);
      });
      overlay.addEventListener("click", (event) => {
        if (state.timelineSuppressClick) {
          state.timelineSuppressClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        const markerBtn = event.target.closest("[data-eto-timeline-marker-id]");
        const exportBtn = event.target.closest("[data-eto-timeline-export]");
        const importBtn = event.target.closest("[data-eto-timeline-import]");
        const paletteToggle = event.target.closest("[data-eto-timeline-palette-toggle]");
        const paletteClose = event.target.closest("[data-eto-timeline-palette-close]");
        if (!markerBtn && !exportBtn && !importBtn && !paletteToggle && !paletteClose) return;

        event.preventDefault();
        event.stopPropagation();

        if (paletteToggle) {
          state.timelinePaletteOpen = !state.timelinePaletteOpen;
          requestTimelineOverlaySync();
          releaseTimelineFocus();
          return;
        }

        if (paletteClose) {
          closeTimelineTagPalettePanel();
          return;
        }

        if (exportBtn) {
          exportTimelineMarkers();
          releaseTimelineFocus();
          return;
        }

        if (importBtn) {
          promptImportTimelineMarkers();
          releaseTimelineFocus();
          return;
        }

        const sceneId = markerBtn.getAttribute("data-eto-timeline-scene-id");
        const markerId = markerBtn.getAttribute("data-eto-timeline-marker-id");
        if (event.shiftKey) {
          deleteTimelineMarker(sceneId, markerId);
          releaseTimelineFocus();
          return;
        }

        seekTimelineMarker(markerBtn);
      });
      overlay.addEventListener("contextmenu", (event) => {
        const markerBtn = event.target.closest("[data-eto-timeline-marker-id]");
        if (!markerBtn) return;

        event.preventDefault();
        event.stopPropagation();
        deleteTimelineMarker(
          markerBtn.getAttribute("data-eto-timeline-scene-id"),
          markerBtn.getAttribute("data-eto-timeline-marker-id")
        );
        releaseTimelineFocus();
      });
      mountInfo.mount.appendChild(overlay);
    }

    overlay.classList.toggle("edit-tags-overhaul-timeline-overlay--fixed", mountInfo.fixed);
    overlay.style.setProperty("--eto-fullscreen-idle-opacity", String(getFullscreenIdleOpacity(state.config || {})));
    attachSharedHoverListeners(overlay);
    attachTimelinePairHoverListeners(overlay);
    if (!mountInfo.fixed && mountInfo.mount instanceof HTMLElement) {
      const position = window.getComputedStyle(mountInfo.mount).position;
      if (position === "static") {
        mountInfo.mount.style.position = "relative";
      }
    }

    return overlay;
  }

  function renderTimelineOverlay(overlay, entity, markers, video, sceneDuration = 0) {
    const duration = Math.max(1, getTimelineVideoDuration(video, markers, sceneDuration));
    const gridItems = buildTimelineGridItems(duration);
    const gridHtml = gridItems
      .map((item) => `
        <span
          class="edit-tags-overhaul-timeline-overlay__grid-line"
          style="left: ${item.left}%"
          aria-hidden="true"
          title="${formatTimelineTime(item.seconds)}"
        ></span>
      `)
      .join("");
    const gridAxisHtml = gridItems
      .map((item) => `
        <span
          class="edit-tags-overhaul-timeline-overlay__grid-label"
          style="left: ${item.left}%"
        >${formatTimelineTime(item.seconds)}</span>
      `)
      .join("");
    const groupedMarkers = new Map();

    markers.forEach((marker) => {
      const tagId = String(marker.tagId || "");
      if (!tagId) return;
      if (!groupedMarkers.has(tagId)) groupedMarkers.set(tagId, []);
      groupedMarkers.get(tagId).push(marker);
    });

    const rows = Array.from(groupedMarkers.entries())
      .map(([tagId, rowMarkers]) => {
        const tagRecord = getTagRecordById(tagId);
        const tagName = tagRecord?.name || rowMarkers[0]?.tagName || "Tag";
        return { tagId, tagName, markers: rowMarkers.sort((a, b) => Number(a.seconds || 0) - Number(b.seconds || 0)) };
      })
      .sort((a, b) => a.tagName.localeCompare(b.tagName, undefined, { sensitivity: "base" }));

    overlay.setAttribute("data-eto-timeline-duration", String(duration));

    overlay.innerHTML = `
      <div class="edit-tags-overhaul-timeline-overlay__header">
        <button
          type="button"
          class="edit-tags-overhaul-timeline-overlay__title-btn${state.timelinePaletteOpen ? " is-open" : ""}"
          data-eto-timeline-palette-toggle="1"
          aria-expanded="${state.timelinePaletteOpen ? "true" : "false"}"
          title="Show timeline tag palette"
        >Timeline Tags</button>
        <span>Click seeks. Shift/right-click removes. ${formatTimelineTime(duration)}</span>
        <span class="edit-tags-overhaul-timeline-overlay__header-actions">
          <button type="button" class="edit-tags-overhaul-timeline-overlay__header-btn" data-eto-timeline-export="1" aria-label="Export all timeline markers" title="Export all timeline markers">Export</button>
          <button type="button" class="edit-tags-overhaul-timeline-overlay__header-btn" data-eto-timeline-import="1" aria-label="Import timeline markers" title="Import timeline markers">Import</button>
        </span>
      </div>
      <div class="edit-tags-overhaul-timeline-overlay__grid-axis" aria-hidden="true">
        ${gridAxisHtml}
      </div>
      <div class="edit-tags-overhaul-timeline-overlay__rows">
        ${rows.length
          ? rows
          .map((row) => {
            return `
              <div class="edit-tags-overhaul-timeline-overlay__row">
                <span class="edit-tags-overhaul-timeline-overlay__label">${escapeHtml(row.tagName)}</span>
                <div class="edit-tags-overhaul-timeline-overlay__track" data-eto-timeline-track-tag-id="${escapeHtml(row.tagId)}">
                  ${gridHtml}
                  ${row.markers
                    .map((marker) => {
                      const seconds = Math.max(0, Number(marker.seconds || 0));
                      const endSeconds = Math.max(seconds, Number(marker.endSeconds || 0));
                      const hasRange = Number.isFinite(endSeconds) && endSeconds > seconds + 0.05;
                      const left = Math.max(0, Math.min(100, (seconds / duration) * 100));
                      const rangeWidth = hasRange ? Math.max(0.6, Math.min(100 - left, ((endSeconds - seconds) / duration) * 100)) : 0;
                      const markerStyle = [
                        `left: ${left}%`,
                        getTimelineColorStyle(row.tagId, marker),
                        hasRange ? `width: max(3.4rem, ${rangeWidth}%)` : "",
                      ].filter(Boolean).join("; ");
                      const rawColor = getTimelineMarkerRawColor(row.tagId);
                      return `
                        <button
                          type="button"
                          class="edit-tags-overhaul-timeline-overlay__marker${hasRange ? " edit-tags-overhaul-timeline-overlay__marker--range" : ""}"
                          style="${markerStyle}"
                          title="${escapeHtml(row.tagName)} / ${formatTimelineTime(seconds)}${hasRange ? ` - ${formatTimelineTime(endSeconds)}` : ""}${rawColor ? ` / ${escapeHtml(rawColor)}` : ""}"
                          data-eto-timeline-scene-id="${escapeHtml(entity.id)}"
                          data-eto-timeline-marker-id="${escapeHtml(marker.id)}"
                          data-eto-timeline-seconds="${seconds}"
                          ${hasRange ? `data-eto-timeline-end-seconds="${endSeconds}"` : ""}
                        ><span>${escapeHtml(row.tagName)}</span><span class="edit-tags-overhaul-timeline-overlay__range-handle" data-eto-timeline-marker-range-handle="1" title="Drag to set duration"></span></button>
                      `;
                    })
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")
          : '<div class="edit-tags-overhaul-timeline-overlay__empty">No timeline markers yet</div>'}
      </div>
      <button type="button" class="edit-tags-overhaul-timeline-overlay__resize-handle" data-eto-timeline-resize-handle="1" aria-label="Resize timeline panel" title="Resize timeline panel"></button>
    `;
    if (state.timelinePaletteOpen) mountTimelineTagPalettePanel(overlay);
    else document.querySelectorAll("[data-eto-timeline-palette]").forEach((palette) => palette.remove());
  }

  async function syncTimelineOverlay() {
    const cfg = state.config || (await loadConfig());
    const entity = getCurrentSceneEntity();
    if (
      !isTagTimelineOverlayEnabled(cfg) ||
      !entity ||
      !state.fullscreen.panel ||
      (!document.fullscreenElement && !shouldShowSceneOverlaysOutsideFullscreen(cfg))
    ) {
      state.timelineRetryCount = 0;
      removeTimelineOverlay();
      return;
    }

    const markers = getSceneTimelineMarkers(entity.id);
    const video = getActiveSceneVideo();

    await fetchAllTags();
    state.timelineRetryCount = 0;
    const mountInfo = getTimelineOverlayMount(video);
    const overlay = ensureTimelineOverlay(mountInfo);
    const sceneDuration = await fetchSceneTimelineDuration(entity.id);
    renderTimelineOverlay(overlay, entity, markers, video, sceneDuration);

    if (state.timelineVideo !== video) {
      if (state.timelineVideo && state.timelineVideoListener) {
        removeTimelineVideoListeners(state.timelineVideo, state.timelineVideoListener);
      }
      state.timelineVideo = video;
      state.timelineVideoListener = video ? () => syncTimelineOverlay() : null;
      if (video && state.timelineVideoListener) {
        addTimelineVideoListeners(video, state.timelineVideoListener);
      }
    }

    if (!video) {
      if (state.timelineDurationRetry) window.clearTimeout(state.timelineDurationRetry);
      state.timelineDurationRetry = window.setTimeout(() => {
        state.timelineDurationRetry = null;
        requestTimelineOverlaySync();
      }, 750);
    } else if (isTimelineVideoDurationReady(video) && state.timelineDurationRetry) {
      window.clearTimeout(state.timelineDurationRetry);
      state.timelineDurationRetry = null;
    }
  }

  function restoreFullscreenMiniPanels() {
    const cfg = state.config || {};
    if (!shouldAutoOpenFullscreenQuickTagPanel(cfg)) return;

    const layouts = readFullscreenMiniPanelLayouts();
    Object.entries(layouts).forEach(([groupId, layout], index) => {
      openFullscreenMiniPanel(groupId, normalizeFullscreenMiniPanelLayout(layout, index), false);
    });
  }

  function createFullscreenPanel(groups, cfg) {
    const panel = document.createElement("section");
    panel.className = "edit-tags-overhaul edit-tags-overhaul--fullscreen-panel";
    applyPanelVariables(panel, cfg);
    panel.style.setProperty("--eto-fullscreen-idle-opacity", String(getFullscreenIdleOpacity(cfg)));

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__fullscreen-header";
    header.setAttribute("data-eto-fullscreen-drag", "1");

    const titleWrap = document.createElement("div");
    titleWrap.className = "edit-tags-overhaul__fullscreen-title-wrap";

    const title = document.createElement("div");
    title.className = "edit-tags-overhaul__fullscreen-title";
    title.textContent = "Quick Tags";

    const selectedCount = document.createElement("div");
    selectedCount.className = "edit-tags-overhaul__fullscreen-selected-count";
    selectedCount.textContent = state.selectedTagIds.size > 0 ? `${state.selectedTagIds.size} selected` : "No tags selected";

    titleWrap.appendChild(title);
    titleWrap.appendChild(selectedCount);

    const controls = document.createElement("div");
    controls.className = "edit-tags-overhaul__fullscreen-controls";
    controls.innerHTML = `
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-scale="-1" aria-label="Decrease panel scale">A-</button>
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-scale="1" aria-label="Increase panel scale">A+</button>
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-reset="1" aria-label="Reset quick tag panel overlay layout" title="Reset layout">↺</button>
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-minimize="1" aria-label="Minimize quick tag panel overlay" title="Minimize">−</button>
    `;

    header.appendChild(titleWrap);
    header.appendChild(controls);
    panel.appendChild(header);

    const content = document.createElement("div");
    content.className = "edit-tags-overhaul__fullscreen-content";
    content.appendChild(createSearchControls());

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "edit-tags-overhaul__groups edit-tags-overhaul__fullscreen-groups";
    groups.forEach((group) => {
      groupsWrap.appendChild(createGroupSection(group, cfg));
    });
    content.appendChild(groupsWrap);
    panel.appendChild(content);

    attachFullscreenPanelEventDelegation(panel);
    renderSearchResults(panel);

    return panel;
  }

  function getFullscreenSceneEntity() {
    const entity = getEntityFromPath(window.location.pathname);
    return entity?.type === "scene" ? entity : null;
  }

  function getQuickTagOverlayMount(cfg) {
    const entity = getFullscreenSceneEntity();
    if (!entity) return null;

    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement) return { mount: fullscreenElement, entity, fullscreen: true };
    return { mount: document.body, entity, fullscreen: false };
  }

  async function buildFullscreenPanel() {
    if (state.fullscreen.isBuilding || !state.fullscreen.root) return;
    const entity = getFullscreenSceneEntity();
    if (!entity) return;

    state.fullscreen.isBuilding = true;
    try {
      const entityKey = getCurrentEntityKey(entity);
      state.currentEntity = entity;
      const [cfg, allTags] = await Promise.all([loadConfig(), fetchAllTags()]);
      await ensureSelectedTagIds(entity);

      if (!state.fullscreen.root) return;

      const fullscreenCfg = {
        ...cfg,
        displayMode: "text",
        defaultExpanded: getConfigBoolean(cfg.defaultExpanded, false),
        __fullscreenMainPanel: true,
      };
      const groups = buildNestedGroupsPreservingOrder(allTags, fullscreenCfg);
      state.fullscreen.groups = groups;
      state.fullscreen.groupMap = new Map(groups.map((group) => [String(group.parent.id), group]));
      state.searchIndex = buildSearchIndex(allTags, fullscreenCfg);
      const panel = createFullscreenPanel(groups, fullscreenCfg);

      closeFullscreenMiniPanels();
      state.fullscreen.panel?.remove();
      state.fullscreen.panel = panel;
      state.fullscreen.entityKey = entityKey;
      state.fullscreen.root.appendChild(panel);
      applyFullscreenPanelLayout(panel);
      attachSharedHoverListeners(panel);
      syncRenderedSelectionStates();
      if (shouldAutoOpenFullscreenQuickTagPanel(cfg)) restoreFullscreenMiniPanels();
      requestTimelineOverlaySync();

      if (window.ResizeObserver) {
        state.fullscreen.resizeObserver?.disconnect();
        state.fullscreen.resizeObserver = new ResizeObserver(() => persistCurrentFullscreenPanelLayout());
        state.fullscreen.resizeObserver.observe(panel);
      }
    } catch (err) {
      console.error("[EditTagsOverhaul] quick tag panel overlay failed", err);
    } finally {
      state.fullscreen.isBuilding = false;
    }
  }

  function closeFullscreenPanel(persistOpenState = false) {
    if (persistOpenState && shouldAutoOpenFullscreenQuickTagPanel(state.config || {})) {
      writeQuickTagOverlayOpenState(false);
    }
    state.fullscreen.resizeObserver?.disconnect();
    state.fullscreen.resizeObserver = null;
    closeFullscreenMiniPanels();
    state.fullscreen.panel?.remove();
    state.fullscreen.panel = null;
    state.fullscreen.entityKey = "";
    state.fullscreen.groups = [];
    state.fullscreen.groupMap = new Map();
    requestTimelineOverlaySync();
  }

  function createFullscreenLauncher() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "edit-tags-overhaul__fullscreen-launcher";
    button.textContent = "Tags";
    button.setAttribute("aria-label", "Open quick tag panel overlay");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.fullscreen.panel) {
        closeFullscreenPanel(true);
      } else {
        if (shouldAutoOpenFullscreenQuickTagPanel(state.config || {})) {
          writeQuickTagOverlayOpenState(true);
        }
        buildFullscreenPanel().finally(() => requestTimelineOverlaySync());
      }
    });
    return button;
  }

  function cleanupFullscreenOverlay() {
    closeFullscreenPanel();
    state.fullscreen.root?.remove();
    state.fullscreen.root = null;
    state.fullscreen.launcher = null;
    state.fullscreen.dragState = null;
  }

  async function syncFullscreenOverlay() {
    const cfg = await loadConfig();
    const mountInfo = getQuickTagOverlayMount(cfg);
    if (!mountInfo || !isFullscreenQuickTagPanelEnabled(cfg)) {
      cleanupFullscreenOverlay();
      return;
    }

    if (state.fullscreen.root?.parentElement !== mountInfo.mount) {
      cleanupFullscreenOverlay();
      const root = document.createElement("div");
      root.className = "edit-tags-overhaul__fullscreen-root";
      const launcher = createFullscreenLauncher();
      launcher.classList.add(`edit-tags-overhaul__fullscreen-launcher--${getFullscreenButtonPosition(cfg)}`);
      root.appendChild(launcher);
      mountInfo.mount.appendChild(root);
      state.fullscreen.root = root;
      state.fullscreen.launcher = root.querySelector(".edit-tags-overhaul__fullscreen-launcher");
      applyFullscreenSharedHoverSetting(root, cfg);
      attachSharedHoverListeners(root);
      if (shouldAutoOpenFullscreenQuickTagPanel(cfg) && readQuickTagOverlayOpenState() !== false) {
        await buildFullscreenPanel();
        requestTimelineOverlaySync();
      }
    } else {
      applyFullscreenSharedHoverSetting(state.fullscreen.root, cfg);
      const entityKey = getCurrentEntityKey(mountInfo.entity);
      if (state.fullscreen.panel && state.fullscreen.entityKey && state.fullscreen.entityKey !== entityKey) {
        closeFullscreenPanel();
      }
      if (shouldAutoOpenFullscreenQuickTagPanel(cfg) && readQuickTagOverlayOpenState() !== false && !state.fullscreen.panel) {
        await buildFullscreenPanel();
        requestTimelineOverlaySync();
      }
    }
  }

  async function ensureSelectedTagIds(entity) {
    const entityKey = getCurrentEntityKey(entity);
    if (state.loadedSelectionEntityKey === entityKey) return state.selectedTagIds;

    state.selectedTagIds = await fetchEntityTagIds(entity.type, entity.id);
    state.loadedSelectionEntityKey = entityKey;
    return state.selectedTagIds;
  }

  async function injectPanelIfPossible() {
    if (state.isInjecting) return false;
    if (!isSupportedEntityPage()) return false;

    const entity = getEntityFromPath(window.location.pathname);
    if (!entity) return false;

    const formGroup = getOriginalTagSelectFormGroup(entity.type);
    if (!formGroup) return false;

    const entityKey = getCurrentEntityKey(entity);
    const existingPanel = document.getElementById(PANEL_ID);
    if (state.injectedForEntityKey === entityKey && existingPanel) return true;

    state.isInjecting = true;
    const token = ++state.injectToken;

    try {
      state.currentEntity = entity;

      const [cfg, allTags] = await Promise.all([loadConfig(), fetchAllTags()]);
      await ensureSelectedTagIds(entity);

      if (token !== state.injectToken) return false;

      const latestEntity = getEntityFromPath(window.location.pathname);
      const latestEntityKey = getCurrentEntityKey(latestEntity);
      if (!latestEntity || latestEntityKey !== entityKey) return false;

      const currentPanel = document.getElementById(PANEL_ID);
      if (currentPanel) currentPanel.remove();

      state.currentEntity = latestEntity;

      const groups = buildNestedGroupsPreservingOrder(allTags, cfg);
      state.searchIndex = buildSearchIndex(allTags, cfg);
      if (!groups.length) return false;

      const panel = createPanel(groups, cfg);
      formGroup.parentNode.insertBefore(panel, formGroup.nextSibling);

      injectHideOriginalStyle();
      syncRenderedSelectionStates();

      state.injectedForEntityKey = entityKey;
      return true;
    } finally {
      if (token === state.injectToken) state.isInjecting = false;
    }
  }

  function scheduleRouteInjects() {
    const routeToken = ++state.scheduledRouteToken;

    for (const delay of ROUTE_RETRY_DELAYS) {
      setTimeout(() => {
        if (routeToken !== state.scheduledRouteToken) return;
        injectPanelIfPossible().catch((err) => {
          console.error("[EditTagsOverhaul] injection failed", err);
        });
      }, delay);
    }
  }

  function scheduleDelayedInject(delay = 150) {
    const routeToken = ++state.scheduledRouteToken;

    setTimeout(() => {
      if (routeToken !== state.scheduledRouteToken) return;
      injectPanelIfPossible().catch((err) => {
        console.error("[EditTagsOverhaul] delayed injection failed", err);
      });
    }, delay);
  }

  function handleRouteChange() {
    const path = window.location.pathname + window.location.search;
    if (path === state.lastPath) return false;
    state.lastPath = path;
    hideHoverPreview();

    if (!isSupportedEntityPage()) {
      cleanupPanel();
      removeHideOriginalStyle();
      removeTimelineOverlay();
      state.timelineRetryCount = 0;
      state.currentEntity = null;
      state.selectedTagIds = new Set();
      state.loadedSelectionEntityKey = null;
      state.currentSearchQuery = "";
      state.searchIndex = null;
      state.scheduledRouteToken += 1;
      return true;
    }

    const entity = getEntityFromPath(window.location.pathname);
    const entityKey = getCurrentEntityKey(entity);

    if (entityKey !== state.loadedSelectionEntityKey) {
      state.selectedTagIds = new Set();
    }

    state.timelineRetryCount = 0;
    cleanupPanel();
    return true;
  }

  function installHistoryHooks() {
    const hookState = window[ROUTE_HOOK_STATE_KEY] || {};
    window[ROUTE_HOOK_STATE_KEY] = hookState;

    if (hookState.installed) return;
    hookState.installed = true;

    const dispatchRouteEvent = () => {
      window.dispatchEvent(new Event(ROUTE_EVENT));
    };

    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function patchedEditTagsOverhaulHistoryMethod(...args) {
        const result = original.apply(this, args);
        setTimeout(dispatchRouteEvent, 0);
        return result;
      };
    });

    hookState.popstateListener = () => {
      setTimeout(dispatchRouteEvent, 0);
    };
    window.addEventListener("popstate", hookState.popstateListener);
  }

  function installTabClickHook() {
    state.tabClickListener = (event) => {
      const target = event.target.closest("a, button, [role='tab']");
      if (!target) return;

      const text = (target.textContent || "").trim().toLowerCase();
      const href = target.getAttribute("href") || "";

      const looksLikeEditTab =
        text === "edit" ||
        text.includes("edit") ||
        href.includes("/edit") ||
        target.getAttribute("data-rb-event-key") === "edit";

      if (!looksLikeEditTab) return;

      scheduleDelayedInject(100);
      scheduleDelayedInject(400);
      scheduleDelayedInject(900);
    };

    document.addEventListener("click", state.tabClickListener);
  }

  function handleRouteEvent() {
    handleRouteChange();
    scheduleRouteInjects();
    requestTimelineOverlaySync();
    syncFullscreenOverlay().catch((err) => {
      console.error("[EditTagsOverhaul] quick tag panel overlay sync failed", err);
    });
  }

  function cleanup() {
    state.scheduledRouteToken += 1;
    state.injectToken += 1;
    hideHoverPreview();
    cleanupPanel();
    cleanupFullscreenOverlay();
    removeTimelineOverlay();
    removeHideOriginalStyle();

    if (state.routeEventListener) {
      window.removeEventListener(ROUTE_EVENT, state.routeEventListener);
      state.routeEventListener = null;
    }
    if (state.tabClickListener) {
      document.removeEventListener("click", state.tabClickListener);
      state.tabClickListener = null;
    }
    if (state.scrollListener) {
      window.removeEventListener("scroll", state.scrollListener, true);
      state.scrollListener = null;
    }
    if (state.resizeListener) {
      window.removeEventListener("resize", state.resizeListener);
      state.resizeListener = null;
    }
    if (state.fullscreenChangeListener) {
      document.removeEventListener("fullscreenchange", state.fullscreenChangeListener);
      state.fullscreenChangeListener = null;
    }

    if (window[CLEANUP_KEY] === cleanup) window[CLEANUP_KEY] = null;
  }

  function init() {
    if (typeof window[CLEANUP_KEY] === "function") {
      window[CLEANUP_KEY]();
    }
    window[CLEANUP_KEY] = cleanup;

    installHistoryHooks();
    state.routeEventListener = handleRouteEvent;
    window.addEventListener(ROUTE_EVENT, state.routeEventListener);

    installTabClickHook();
    state.scrollListener = hideHoverPreview;
    state.resizeListener = hideHoverPreview;
    state.fullscreenChangeListener = () => {
      syncFullscreenOverlay().catch((err) => {
        console.error("[EditTagsOverhaul] quick tag panel overlay sync failed", err);
      });
      requestTimelineOverlaySync();
    };
    window.addEventListener("scroll", state.scrollListener, true);
    window.addEventListener("resize", state.resizeListener);
    document.addEventListener("fullscreenchange", state.fullscreenChangeListener);
    handleRouteChange();
    scheduleRouteInjects();
    requestTimelineOverlaySync();
    syncFullscreenOverlay().catch((err) => {
      console.error("[EditTagsOverhaul] quick tag panel overlay sync failed", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
