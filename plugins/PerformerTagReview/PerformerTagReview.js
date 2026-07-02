(function () {
  "use strict";

  const PLUGIN_ID = "PerformerTagReview";
  const HOST_ID = "performer-tag-review-host";
  const WINDOW_ID = "performer-tag-review-window";
  const CLEANUP_KEY = "__performerTagReviewCleanup";
  const LAYOUT_STORAGE_KEY = "PerformerTagReview.windowLayout";
  const QUEUE_AUTO_OPEN_STORAGE_KEY = "PerformerTagReview.queueAutoOpen";
  const REVIEW_STATE_STORAGE_KEY = "PerformerTagReview.reviewStates";
  const PANEL_SCALE_STORAGE_KEY = "PerformerTagReview.panelScale";
  const EXCLUDED_TAGS_STORAGE_KEY = "PerformerTagReview.excludedTagIds";
  const ROUTE_RETRY_DELAYS = [0, 150, 400, 900, 1600];

  const DEFAULT_CONFIG = {
    contentTypes: "scenes,images,galleries",
    pageSize: 200,
    reviewedTagId: "",
    summaryTagLimit: 100,
    tagBlacklist: "",
  };

  const CONTENT_TYPES = {
    scenes: {
      label: "Scenes",
      queryName: "findScenes",
      itemsKey: "scenes",
      filterArg: "scene_filter",
      filterType: "SceneFilterType",
      updateType: "SceneUpdateInput",
      updateName: "sceneUpdate",
      titleField: "title",
    },
    images: {
      label: "Images",
      queryName: "findImages",
      itemsKey: "images",
      filterArg: "image_filter",
      filterType: "ImageFilterType",
      updateType: "ImageUpdateInput",
      updateName: "imageUpdate",
      titleField: "title",
    },
    galleries: {
      label: "Galleries",
      queryName: "findGalleries",
      itemsKey: "galleries",
      filterArg: "gallery_filter",
      filterType: "GalleryFilterType",
      updateType: "GalleryUpdateInput",
      updateName: "galleryUpdate",
      titleField: "title",
    },
  };

  const state = {
    config: null,
    routeToken: 0,
    lastPath: "",
    observer: null,
    dragState: null,
    resizeState: null,
    suppressRoutePanelOpen: false,
    currentPerformerId: "",
    reviewStates: {},
    excludedTagIds: new Set(),
    panel: {
      open: false,
      collapsed: false,
      loading: false,
      applying: false,
      promotingTagId: "",
      railAddingTagId: "",
      removingPerformerTagId: "",
      performer: null,
      allTags: [],
      blacklistedTagIds: new Set(),
      content: {},
      selectedTagIds: new Set(),
      selectedContentTypes: new Set(["scenes", "images", "galleries"]),
      sort: "count",
      filter: "all",
      hidePerformerTags: false,
      performerTagSearch: "",
      summarySearch: "",
      tagRailOpen: false,
      tagRailSearch: "",
      snapshotRailOpen: false,
      expandedTagIds: new Set(),
      lastApplySnapshot: null,
      queue: {
        sourcePerformers: [],
        performers: [],
        loaded: false,
        loading: false,
        checkingSync: false,
        checkingOCounts: false,
        index: -1,
        autoOpen: false,
        sort: "name",
        direction: "asc",
        filterMode: "all",
        hideReviewed: false,
        status: "",
      },
      scale: 1,
      status: "",
      error: "",
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

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function defaultWindowLayout() {
    const width = Math.min(680, Math.max(570, window.innerWidth - 32));
    const height = Math.min(700, Math.max(420, window.innerHeight - 96));
    return {
      left: Math.max(16, window.innerWidth - width - 24),
      top: Math.max(56, Math.round(window.innerHeight * 0.12)),
      width,
      height,
    };
  }

  function normalizeWindowLayout(layout) {
    const fallback = defaultWindowLayout();
    const minWidth = Math.min(570, Math.max(320, window.innerWidth - 24));
    const minHeight = 320;
    const maxWidth = Math.max(minWidth, window.innerWidth - 24);
    const maxHeight = Math.max(minHeight, window.innerHeight - 24);
    const width = clampNumber(Number(layout?.width) || fallback.width, minWidth, maxWidth);
    const height = clampNumber(Number(layout?.height) || fallback.height, minHeight, maxHeight);
    return {
      width,
      height,
      left: clampNumber(Number(layout?.left) || fallback.left, 8, Math.max(8, window.innerWidth - width - 8)),
      top: clampNumber(Number(layout?.top) || fallback.top, 8, Math.max(8, window.innerHeight - height - 8)),
    };
  }

  function readStoredBoolean(key, fallback = false) {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return fallback;
      return stored === "true";
    } catch (err) {
      console.error("[PerformerTagReview] setting read failed", err);
      return fallback;
    }
  }

  function writeStoredBoolean(key, value) {
    try {
      window.localStorage.setItem(key, value ? "true" : "false");
    } catch (err) {
      console.error("[PerformerTagReview] setting write failed", err);
    }
  }

  function readStoredObject(key, fallback = {}) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
      console.error("[PerformerTagReview] object read failed", err);
      return fallback;
    }
  }

  function writeStoredObject(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value || {}));
    } catch (err) {
      console.error("[PerformerTagReview] object write failed", err);
    }
  }

  function readStoredNumber(key, fallback, min, max) {
    try {
      const parsed = Number(window.localStorage.getItem(key));
      if (!Number.isFinite(parsed)) return fallback;
      return clampNumber(parsed, min, max);
    } catch (err) {
      console.error("[PerformerTagReview] number read failed", err);
      return fallback;
    }
  }

  function setPanelScale(nextScale) {
    state.panel.scale = clampNumber(Number(nextScale) || 1, 0.7, 1.25);
    try {
      window.localStorage.setItem(PANEL_SCALE_STORAGE_KEY, String(state.panel.scale));
    } catch (err) {
      console.error("[PerformerTagReview] scale write failed", err);
    }
    renderPanel();
  }

  function configuredReviewedTagId() {
    return String(state.config?.reviewedTagId || "").trim();
  }

  function reviewedTagExists() {
    const reviewedTagId = configuredReviewedTagId();
    if (!reviewedTagId) return true;
    return (state.panel.allTags || []).some((tag) => String(tag.id) === reviewedTagId);
  }

  function reviewedTagWarningText() {
    const reviewedTagId = configuredReviewedTagId();
    if (!reviewedTagId || reviewedTagExists()) return "";
    return `Reviewed Tag ID ${reviewedTagId} was not found. Reviewed state will be saved locally only.`;
  }

  function reviewedTagNoticeText() {
    return configuredReviewedTagId() ? "" : "Reviewed Tag ID is not configured. Reviewed state will be saved locally only.";
  }

  function performerHasReviewedTag(performer) {
    const reviewedTagId = configuredReviewedTagId();
    return !!reviewedTagId && (performer?.tags || []).some((tag) => String(tag.id) === reviewedTagId);
  }

  function getReviewState(performerRef) {
    const performer = typeof performerRef === "object" && performerRef ? performerRef : null;
    const performerId = performer ? performer.id : performerRef;
    const id = String(performerId || "");
    const entry = state.reviewStates[id];
    const localStatus = typeof entry === "string" ? entry : entry?.status || "";
    if (localStatus) return localStatus;
    if (performerHasReviewedTag(performer)) return "reviewed";
    if (state.panel.performer?.id === id && performerHasReviewedTag(state.panel.performer)) return "reviewed";
    return "";
  }

  function setReviewState(performerId, status) {
    const id = String(performerId || "");
    if (!id) return;
    const next = { ...state.reviewStates };
    if (status) next[id] = { status, updatedAt: Date.now() };
    else delete next[id];
    state.reviewStates = next;
    writeStoredObject(REVIEW_STATE_STORAGE_KEY, state.reviewStates);
  }

  function updateQueuePerformerReviewedTag(performerId, addTag) {
    const reviewedTagId = configuredReviewedTagId();
    if (!reviewedTagId) return;
    const tag = allTagById().get(reviewedTagId) || { id: reviewedTagId, name: `Tag ${reviewedTagId}`, sort_name: `Tag ${reviewedTagId}` };
    for (const performer of state.panel.queue.sourcePerformers || []) {
      if (String(performer.id) !== String(performerId)) continue;
      const tags = normalizeTags(performer.tags || []);
      const hasTag = tags.some((performerTag) => performerTag.id === reviewedTagId);
      if (addTag && !hasTag) {
        performer.tags = normalizeTags([...tags, tag]);
      } else if (!addTag && hasTag) {
        performer.tags = tags.filter((performerTag) => performerTag.id !== reviewedTagId);
      } else {
        performer.tags = tags;
      }
      performer.tagCount = performer.tags.length;
    }
  }

  async function syncReviewedTagForCurrentPerformer(status) {
    const reviewedTagId = configuredReviewedTagId();
    const performer = state.panel.performer;
    if (!reviewedTagId || !performer) return;

    const existingIds = new Set((performer.tags || []).map((tag) => String(tag.id)));
    const shouldHaveTag = status === "reviewed";
    const hasTag = existingIds.has(reviewedTagId);
    if (!reviewedTagExists() && (shouldHaveTag || !hasTag)) return;
    if (shouldHaveTag === hasTag) return;

    const nextIds = new Set(existingIds);
    if (shouldHaveTag) nextIds.add(reviewedTagId);
    else nextIds.delete(reviewedTagId);

    await updatePerformerTags(performer.id, nextIds);
    if (shouldHaveTag) {
      const reviewedTag = allTagById().get(reviewedTagId) || { id: reviewedTagId, name: `Tag ${reviewedTagId}`, sort_name: `Tag ${reviewedTagId}` };
      performer.tags = normalizeTags([...(performer.tags || []), reviewedTag]);
    } else {
      performer.tags = normalizeTags((performer.tags || []).filter((tag) => String(tag.id) !== reviewedTagId));
    }
    state.panel.selectedTagIds = new Set((performer.tags || []).map((tag) => tag.id).filter((tagId) => !isTagExcluded(tagId)));
    updateQueuePerformerReviewedTag(performer.id, shouldHaveTag);
  }

  function reviewStatusLabel(status) {
    if (status === "reviewed") return "Reviewed";
    if (status === "skipped") return "Skipped";
    return "Needs review";
  }

  function readStoredStringSet(key) {
    const raw = readStoredObject(key, {});
    if (Array.isArray(raw)) return new Set(raw.map(String));
    return new Set(Object.keys(raw || {}).filter((id) => raw[id]).map(String));
  }

  function writeStoredStringSet(key, values) {
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.from(values || []).map(String)));
    } catch (err) {
      console.error("[PerformerTagReview] set write failed", err);
    }
  }

  function isTagExcluded(tagId) {
    const id = String(tagId || "");
    return id === configuredReviewedTagId() || state.panel.blacklistedTagIds.has(id) || state.excludedTagIds.has(id);
  }

  function toggleExcludedTag(tagId) {
    const id = String(tagId || "");
    if (!id) return;
    if (state.excludedTagIds.has(id)) state.excludedTagIds.delete(id);
    else state.excludedTagIds.add(id);
    writeStoredStringSet(EXCLUDED_TAGS_STORAGE_KEY, state.excludedTagIds);
    state.panel.selectedTagIds.delete(id);
    renderPanel();
  }

  function readWindowLayout() {
    try {
      return normalizeWindowLayout(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}"));
    } catch (err) {
      console.error("[PerformerTagReview] window layout read failed", err);
      return normalizeWindowLayout(null);
    }
  }

  function writeWindowLayout(layout) {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(normalizeWindowLayout(layout)));
    } catch (err) {
      console.error("[PerformerTagReview] window layout write failed", err);
    }
  }

  function restoreLayoutFromCompactAttempt() {
    try {
      if (window.localStorage.getItem("PerformerTagReview.windowLayoutVersion") !== "compact-0.11.8") return;
      const restored = defaultWindowLayout();
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(normalizeWindowLayout(restored)));
      window.localStorage.setItem("PerformerTagReview.windowLayoutVersion", "restored-0.11.10");
    } catch (err) {
      console.error("[PerformerTagReview] compact layout restore failed", err);
    }
  }

  function migrateLayoutToNarrowBase() {
    try {
      if (window.localStorage.getItem("PerformerTagReview.windowLayoutVersion") === "narrow-base-0.11.29") return;
      const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}");
      const fallback = defaultWindowLayout();
      const next = normalizeWindowLayout({
        ...stored,
        width: Math.min(Number(stored.width) || fallback.width, fallback.width),
      });
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
      window.localStorage.setItem("PerformerTagReview.windowLayoutVersion", "narrow-base-0.11.29");
    } catch (err) {
      console.error("[PerformerTagReview] narrow layout migration failed", err);
    }
  }

  function applyWindowLayout(el, layout = readWindowLayout()) {
    const normalized = normalizeWindowLayout(layout);
    el.style.left = `${normalized.left}px`;
    el.style.top = `${normalized.top}px`;
    el.style.width = `${normalized.width}px`;
    el.style.height = `${normalized.height}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    return normalized;
  }

  function currentWindowLayout(el = document.getElementById(WINDOW_ID)) {
    if (!el || state.panel.collapsed) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function saveCurrentWindowLayout() {
    const layout = currentWindowLayout();
    if (layout) writeWindowLayout(layout);
  }

  function footerStatusText(pending) {
    const delta = state.panel.performer && !state.panel.loading && !state.panel.error ? buildDeltaSummaryData() : null;
    const status = state.currentPerformerId ? reviewStatusLabel(getReviewState(state.currentPerformerId)) : "";
    const missing = delta?.contentItemsMissingPerformerTagCount || 0;
    const parts = [];
    if (status) parts.push(status);
    if (missing) parts.push(`${missing} missing`);
    if (pending?.length) parts.push(`${pending.length} pending`);
    return parts.join(" / ");
  }

  function startWindowDrag(event) {
    if (event.button !== 0) return;
    if (state.panel.collapsed) return;
    if (event.target.closest("button,input,select,label,a")) return;
    const windowEl = document.getElementById(WINDOW_ID);
    if (!windowEl) return;
    const layout = currentWindowLayout(windowEl);
    if (!layout) return;
    state.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: layout.left,
      startTop: layout.top,
      width: layout.width,
      height: layout.height,
    };
    windowEl.setPointerCapture?.(event.pointerId);
    windowEl.classList.add("ptr-window-dragging");
    window.addEventListener("pointermove", onWindowDrag);
    window.addEventListener("pointerup", endWindowDrag, { once: true });
    event.preventDefault();
  }

  function onWindowDrag(event) {
    const drag = state.dragState;
    if (!drag) return;
    const windowEl = document.getElementById(WINDOW_ID);
    if (!windowEl) return;
    applyWindowLayout(windowEl, {
      left: drag.startLeft + event.clientX - drag.startX,
      top: drag.startTop + event.clientY - drag.startY,
      width: drag.width,
      height: drag.height,
    });
  }

  function startWindowResize(event) {
    if (event.button !== 0) return;
    if (state.panel.collapsed) return;
    const windowEl = document.getElementById(WINDOW_ID);
    if (!windowEl) return;
    const layout = currentWindowLayout(windowEl);
    if (!layout) return;
    state.resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: layout.left,
      top: layout.top,
      width: layout.width,
      height: layout.height,
    };
    windowEl.setPointerCapture?.(event.pointerId);
    windowEl.classList.add("ptr-window-resizing");
    window.addEventListener("pointermove", onWindowResize);
    window.addEventListener("pointerup", endWindowResize, { once: true });
    event.preventDefault();
    event.stopPropagation();
  }

  function onWindowResize(event) {
    const resize = state.resizeState;
    if (!resize) return;
    const windowEl = document.getElementById(WINDOW_ID);
    if (!windowEl) return;
    applyWindowLayout(windowEl, {
      left: resize.left,
      top: resize.top,
      width: resize.width + event.clientX - resize.startX,
      height: resize.height + event.clientY - resize.startY,
    });
  }

  function endWindowResize() {
    const windowEl = document.getElementById(WINDOW_ID);
    if (windowEl && state.resizeState?.pointerId !== undefined) {
      try {
        windowEl.releasePointerCapture?.(state.resizeState.pointerId);
      } catch (err) {
        // Pointer capture can already be released by the browser.
      }
    }
    state.resizeState = null;
    window.removeEventListener("pointermove", onWindowResize);
    if (windowEl) {
      windowEl.classList.remove("ptr-window-resizing");
      saveCurrentWindowLayout();
    }
  }

  function endWindowDrag() {
    const windowEl = document.getElementById(WINDOW_ID);
    if (windowEl && state.dragState?.pointerId !== undefined) {
      try {
        windowEl.releasePointerCapture?.(state.dragState.pointerId);
      } catch (err) {
        // Pointer capture can already be released by the browser.
      }
    }
    state.dragState = null;
    window.removeEventListener("pointermove", onWindowDrag);
    if (windowEl) {
      windowEl.classList.remove("ptr-window-dragging");
      saveCurrentWindowLayout();
    }
  }

  function getPerformerIdFromPath() {
    const match = window.location.pathname.match(/^\/performers\/(\d+)/);
    return match ? match[1] : "";
  }

  async function gql(query, variables = {}) {
    const response = await fetch("/graphql", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
    const json = await response.json();
    if (json.errors?.length) throw new Error(json.errors.map((err) => err.message).join("; "));
    return json.data || {};
  }

  async function loadConfig() {
    if (state.config) return state.config;
    try {
      const data = await gql(`
        query PerformerTagReviewConfig {
          configuration { plugins }
        }
      `);
      const pluginConfig = data?.configuration?.plugins?.[PLUGIN_ID] || {};
      state.config = {
        contentTypes: parseContentTypes(pluginConfig.contentTypes || DEFAULT_CONFIG.contentTypes),
        pageSize: parseIntSetting(pluginConfig.pageSize, DEFAULT_CONFIG.pageSize, 25, 1000),
        reviewedTagId: String(pluginConfig.reviewedTagId || DEFAULT_CONFIG.reviewedTagId).trim(),
        summaryTagLimit: parseIntSetting(pluginConfig.summaryTagLimit, DEFAULT_CONFIG.summaryTagLimit, 0, 5000),
        tagBlacklist: String(pluginConfig.tagBlacklist || DEFAULT_CONFIG.tagBlacklist),
      };
    } catch (err) {
      console.error("[PerformerTagReview] config load failed", err);
      state.config = {
        contentTypes: parseContentTypes(DEFAULT_CONFIG.contentTypes),
        pageSize: DEFAULT_CONFIG.pageSize,
        reviewedTagId: DEFAULT_CONFIG.reviewedTagId,
        summaryTagLimit: DEFAULT_CONFIG.summaryTagLimit,
        tagBlacklist: DEFAULT_CONFIG.tagBlacklist,
      };
    }
    state.panel.selectedContentTypes = new Set(state.config.contentTypes);
    return state.config;
  }

  function parseIntSetting(value, fallback, min, max) {
    const parsed = parseInt(String(value ?? "").trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (Number.isFinite(min) && parsed < min) return fallback;
    if (Number.isFinite(max) && parsed > max) return fallback;
    return parsed;
  }

  function parseContentTypes(value) {
    const aliases = {
      scene: "scenes",
      scenes: "scenes",
      image: "images",
      images: "images",
      gallery: "galleries",
      galleries: "galleries",
    };
    const parsed = String(value || "")
      .split(",")
      .map((item) => aliases[item.trim().toLowerCase()])
      .filter(Boolean);
    const unique = Array.from(new Set(parsed)).filter((type) => CONTENT_TYPES[type]);
    return unique.length ? unique : ["scenes", "images", "galleries"];
  }

  function splitCsv(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function fetchAllTags() {
    const data = await gql(`
      query PerformerTagReviewAllTags {
        findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
          tags {
            id
            name
            sort_name
            image_path
            children { id }
            parents { id name }
          }
        }
      }
    `);
    return normalizeTags(data?.findTags?.tags || []);
  }

  function buildChildMap(tags) {
    const childMap = new Map();
    for (const tag of tags || []) {
      for (const child of tag.children || []) {
        if (!childMap.has(tag.id)) childMap.set(tag.id, new Set());
        childMap.get(tag.id).add(String(child.id));
      }
    }
    return childMap;
  }

  function collectDescendantIds(tagId, childMap) {
    const ids = new Set([String(tagId)]);
    const queue = Array.from(childMap.get(String(tagId)) || []);
    while (queue.length) {
      const currentId = queue.shift();
      if (ids.has(currentId)) continue;
      ids.add(currentId);
      queue.push(...Array.from(childMap.get(currentId) || []));
    }
    return ids;
  }

  function resolveTagRef(ref, tags) {
    const normalized = String(ref || "").trim();
    if (!normalized) return null;
    const byId = tags.find((tag) => tag.id === normalized);
    if (byId) return byId;
    const matches = tags.filter((tag) => tag.name.trim().toLowerCase() === normalized.toLowerCase());
    return matches.length === 1 ? matches[0] : null;
  }

  function buildBlacklistedTagIds(ruleText, tags) {
    const childMap = buildChildMap(tags);
    const ids = new Set();
    for (const token of splitCsv(ruleText)) {
      const includeDescendants = token.startsWith("!");
      const tagRef = includeDescendants ? token.slice(1).trim() : token;
      const tag = resolveTagRef(tagRef, tags);
      if (!tag) {
        console.warn("[PerformerTagReview] Blacklisted tag not found or ambiguous:", tagRef);
        continue;
      }
      if (includeDescendants) {
        collectDescendantIds(tag.id, childMap).forEach((id) => ids.add(id));
      } else {
        ids.add(tag.id);
      }
    }
    return ids;
  }

  async function fetchPerformer(performerId) {
    const data = await gql(
      `
        query PerformerTagReviewPerformer($id: ID!) {
          findPerformer(id: $id) {
            id
            name
            tags {
              id
              name
              sort_name
              image_path
              children { id }
              parents { id name }
            }
          }
        }
      `,
      { id: String(performerId) }
    );
    const performer = data?.findPerformer;
    if (!performer) throw new Error("Performer not found");
    return {
      ...performer,
      id: String(performer.id),
      tags: normalizeTags(performer.tags),
    };
  }

  async function fetchPerformerQueue() {
    const performers = [];
    const pageSize = Math.min(state.config?.pageSize || DEFAULT_CONFIG.pageSize, 500);
    let page = 1;
    while (true) {
      const data = await gql(
        `
          query PerformerTagReviewQueue($filter: FindFilterType) {
            findPerformers(filter: $filter) {
              performers {
                id
                name
                rating100
                scene_count
                tags { id }
              }
            }
          }
        `,
        { filter: { page, per_page: pageSize, sort: "name", direction: "ASC" } }
      );
      const batch = data?.findPerformers?.performers || [];
      performers.push(
        ...batch.map((performer) => ({
          id: String(performer.id),
          name: performer.name || `Performer ${performer.id}`,
          rating100: Number.isFinite(Number(performer.rating100)) ? Number(performer.rating100) : 0,
          sceneCount: Number(performer.scene_count || 0),
          tagCount: Array.isArray(performer.tags) ? performer.tags.length : 0,
          tags: normalizeTags(performer.tags),
          oCount: null,
          syncStatus: "unknown",
        }))
      );
      if (batch.length < pageSize) break;
      page += 1;
    }
    const seen = new Set();
    return performers
      .filter((performer) => {
        if (seen.has(performer.id)) return false;
        seen.add(performer.id);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function queueIndexForPerformer(performerId) {
    return state.panel.queue.performers.findIndex((performer) => performer.id === String(performerId));
  }

  function syncQueueIndexToPerformer(performerId) {
    if (!state.panel.queue.loaded) return;
    const index = queueIndexForPerformer(performerId);
    if (index >= 0) state.panel.queue.index = index;
  }

  function currentQueuePerformer() {
    return state.panel.queue.performers[state.panel.queue.index] || null;
  }

  function compareQueuePerformers(a, b) {
    const queue = state.panel.queue;
    let result = 0;
    if (queue.sort === "tagCount") {
      result = Number(a.tagCount || 0) - Number(b.tagCount || 0);
    } else if (queue.sort === "sceneCount") {
      result = Number(a.sceneCount || 0) - Number(b.sceneCount || 0);
    } else if (queue.sort === "rating") {
      result = Number(a.rating100 || 0) - Number(b.rating100 || 0);
    } else if (queue.sort === "oCount") {
      result = Number(a.oCount || 0) - Number(b.oCount || 0);
    } else {
      result = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    if (result === 0) result = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return queue.direction === "desc" ? -result : result;
  }

  function applyQueueView(preferredPerformerId = state.currentPerformerId) {
    const queue = state.panel.queue;
    let performers = Array.from(queue.sourcePerformers || []);
    if (queue.filterMode === "unreviewed") {
      performers = performers.filter((performer) => !getReviewState(performer));
    } else if (queue.filterMode === "reviewed") {
      performers = performers.filter((performer) => getReviewState(performer) === "reviewed");
    } else if (queue.filterMode === "skipped") {
      performers = performers.filter((performer) => getReviewState(performer) === "skipped");
    } else if (queue.filterMode === "noTags") {
      performers = performers.filter((performer) => Number(performer.tagCount || 0) <= 0);
    } else if (queue.filterMode === "noScenes") {
      performers = performers.filter((performer) => Number(performer.sceneCount || 0) <= 0);
    } else if (queue.filterMode === "needsSync") {
      performers = performers.filter((performer) => performer.syncStatus !== "synced");
    }
    if (queue.hideReviewed) {
      performers = performers.filter((performer) => getReviewState(performer) !== "reviewed");
    }
    performers.sort(compareQueuePerformers);
    queue.performers = performers;
    const index = queueIndexForPerformer(preferredPerformerId);
    queue.index = index >= 0 ? index : performers.length ? 0 : -1;
  }

  function formatQueueRating(rating100) {
    const rating = Number(rating100 || 0);
    return rating > 0 ? `${(rating / 10).toFixed(1)} rating` : "unrated";
  }

  function formatQueueOCount(performer) {
    return performer.oCount === null || performer.oCount === undefined ? "O's pending" : `${Number(performer.oCount || 0)} O's`;
  }

  async function calculatePerformerOCount(performerId) {
    let page = 1;
    const pageSize = Math.min(state.config?.pageSize || DEFAULT_CONFIG.pageSize, 250);
    let total = 0;
    while (true) {
      const data = await gql(
        `
          query PerformerTagReviewOCountScenes($filter: FindFilterType, $sceneFilter: SceneFilterType) {
            findScenes(filter: $filter, scene_filter: $sceneFilter) {
              scenes {
                id
                o_counter
              }
            }
          }
        `,
        {
          filter: { page, per_page: pageSize, sort: "id", direction: "ASC" },
          sceneFilter: { performers: { modifier: "INCLUDES", value: [String(performerId)] } },
        }
      );
      const scenes = data?.findScenes?.scenes || [];
      total += scenes.reduce((sum, scene) => sum + Math.max(0, Math.round(Number(scene?.o_counter || 0))), 0);
      if (scenes.length < pageSize) break;
      page += 1;
    }
    return total;
  }

  async function ensureQueueOCounts() {
    const queue = state.panel.queue;
    if (queue.sort !== "oCount" || queue.checkingOCounts) return;
    const unknown = queue.sourcePerformers.filter((performer) => performer.oCount === null || performer.oCount === undefined);
    if (!unknown.length) return;
    queue.checkingOCounts = true;
    queue.status = `Calculating O-counts 0 / ${unknown.length}...`;
    renderPanel();

    let checked = 0;
    try {
      for (const performer of unknown) {
        performer.oCount = await calculatePerformerOCount(performer.id);
        checked += 1;
        if (checked === 1 || checked % 10 === 0 || checked === unknown.length) {
          queue.status = `Calculating O-counts ${checked} / ${unknown.length}...`;
          applyQueueView();
          renderPanel();
        }
      }
      queue.status = `Queue sorted by O-count across ${queue.performers.length} performers.`;
    } catch (err) {
      console.error("[PerformerTagReview] queue O-count calculation failed", err);
      queue.status = `Could not finish O-count sort: ${err.message || err}`;
    } finally {
      queue.checkingOCounts = false;
      applyQueueView();
      renderPanel();
    }
  }

  async function performerScenesHavePerformerTags(performerId) {
    const performer = await fetchPerformer(performerId);
    const performerTagIds = new Set((performer.tags || []).map((tag) => tag.id));
    if (!performerTagIds.size) return false;
    let page = 1;
    const pageSize = Math.min(state.config?.pageSize || DEFAULT_CONFIG.pageSize, 250);
    let sceneCount = 0;
    while (true) {
      const data = await gql(
        `
          query PerformerTagReviewSyncScenes($filter: FindFilterType, $sceneFilter: SceneFilterType) {
            findScenes(filter: $filter, scene_filter: $sceneFilter) {
              scenes {
                id
                tags { id }
              }
            }
          }
        `,
        {
          filter: { page, per_page: pageSize, sort: "id", direction: "ASC" },
          sceneFilter: { performers: { modifier: "INCLUDES", value: [String(performerId)] } },
        }
      );
      const scenes = data?.findScenes?.scenes || [];
      sceneCount += scenes.length;
      for (const scene of scenes) {
        const sceneTagIds = new Set((scene.tags || []).map((tag) => String(tag.id)));
        if (Array.from(performerTagIds).some((tagId) => !sceneTagIds.has(tagId))) return false;
      }
      if (scenes.length < pageSize) break;
      page += 1;
    }
    return sceneCount > 0;
  }

  async function ensureQueueSyncStatuses() {
    const queue = state.panel.queue;
    if (queue.filterMode !== "needsSync" || queue.checkingSync) return;
    const unknown = queue.sourcePerformers.filter((performer) => performer.syncStatus === "unknown");
    if (!unknown.length) return;
    queue.checkingSync = true;
    queue.status = `Checking synced performers 0 / ${unknown.length}...`;
    renderPanel();

    let checked = 0;
    try {
      for (const performer of unknown) {
        performer.syncStatus = (await performerScenesHavePerformerTags(performer.id)) ? "synced" : "needsReview";
        checked += 1;
        if (checked === 1 || checked % 10 === 0 || checked === unknown.length) {
          queue.status = `Checking synced performers ${checked} / ${unknown.length}...`;
          applyQueueView();
          renderPanel();
        }
      }
      queue.status = `Queue filtered to ${queue.performers.length} performers.`;
    } catch (err) {
      console.error("[PerformerTagReview] synced queue check failed", err);
      queue.status = `Could not finish synced check: ${err.message || err}`;
    } finally {
      queue.checkingSync = false;
      applyQueueView();
      renderPanel();
    }
  }

  async function loadPerformerQueue() {
    if (state.panel.queue.loading) return;
    state.panel.queue.loading = true;
    state.panel.queue.status = "Loading performer queue...";
    renderPanel();

    try {
      const performers = await fetchPerformerQueue();
      state.panel.queue.sourcePerformers = performers;
      state.panel.queue.loaded = true;
      applyQueueView();
      state.panel.queue.status = performers.length
        ? `${state.panel.queue.performers.length} / ${performers.length} performers shown.`
        : "No performers found.";
    } catch (err) {
      console.error("[PerformerTagReview] queue load failed", err);
      state.panel.queue.status = `Could not load queue: ${err.message || err}`;
    } finally {
      state.panel.queue.loading = false;
      renderPanel();
      ensureQueueSyncStatuses();
      ensureQueueOCounts();
    }
  }

  function openPerformerPageInBackground(performerId) {
    const id = String(performerId || "");
    if (!id) return;
    const nextPath = `/performers/${id}`;
    if (window.location.pathname === nextPath) return;
    state.suppressRoutePanelOpen = true;
    window.history.pushState({}, "", nextPath);
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      window.dispatchEvent(new Event("popstate"));
    }
    window.dispatchEvent(new Event("performer-tag-review-route"));
    window.setTimeout(() => {
      state.suppressRoutePanelOpen = false;
    }, 0);
  }

  async function openQueuePerformer(index) {
    if (!state.panel.queue.loaded || state.panel.queue.loading) return;
    const clampedIndex = clampNumber(index, 0, Math.max(0, state.panel.queue.performers.length - 1));
    const performer = state.panel.queue.performers[clampedIndex];
    if (!performer) return;
    state.panel.queue.index = clampedIndex;
    if (state.panel.queue.autoOpen) openPerformerPageInBackground(performer.id);
    await openPanel(performer.id);
  }

  function moveQueueAfterReview() {
    if (!state.panel.queue.loaded || !state.panel.queue.performers.length) {
      renderPanel();
      return;
    }
    applyQueueView();
    if (!state.panel.queue.performers.length) {
      renderPanel();
      return;
    }
    const currentIndex = queueIndexForPerformer(state.currentPerformerId);
    const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, state.panel.queue.performers.length - 1) : state.panel.queue.index;
    openQueuePerformer(nextIndex);
  }

  async function markCurrentPerformerReviewState(status, advance = false) {
    if (!state.currentPerformerId) return;
    try {
      await syncReviewedTagForCurrentPerformer(status);
      setReviewState(state.currentPerformerId, status);
      state.panel.status = status ? `${reviewStatusLabel(status)}: ${state.panel.performer?.name || "performer"}.` : "Review state cleared.";
      if (advance) {
        moveQueueAfterReview();
      } else {
        applyQueueView();
        renderPanel();
      }
    } catch (err) {
      console.error("[PerformerTagReview] review state update failed", err);
      state.panel.status = `Could not update review state: ${err.message || err}`;
      applyQueueView();
      renderPanel();
    }
  }

  function normalizeTags(tags) {
    return (Array.isArray(tags) ? tags : [])
      .map((tag) => ({
        ...tag,
        id: String(tag.id),
        name: tag.name || `Tag ${tag.id}`,
        sort_name: tag.sort_name || tag.name || `Tag ${tag.id}`,
        children: Array.isArray(tag.children) ? tag.children.map((child) => ({ id: String(child.id) })) : [],
        parents: Array.isArray(tag.parents) ? tag.parents.map((parent) => ({ id: String(parent.id), name: parent.name || "" })) : [],
      }))
      .sort((a, b) => String(a.sort_name || a.name).localeCompare(String(b.sort_name || b.name), undefined, { sensitivity: "base" }));
  }

  async function fetchPerformerContent(performerId, contentType, pluginConfig = state.config || DEFAULT_CONFIG) {
    const cfg = CONTENT_TYPES[contentType];
    const items = [];
    let page = 1;
    while (true) {
      const query = `
        query PerformerTagReviewContent($filter: FindFilterType, $contentFilter: ${cfg.filterType}) {
          ${cfg.queryName}(filter: $filter, ${cfg.filterArg}: $contentFilter) {
            ${cfg.itemsKey} {
              id
              ${cfg.titleField}
              tags {
                id
                name
                sort_name
                image_path
                children { id }
                parents { id name }
              }
            }
          }
        }
      `;
      const data = await gql(query, {
        filter: { page, per_page: pluginConfig.pageSize, sort: "id", direction: "ASC" },
        contentFilter: { performers: { modifier: "INCLUDES", value: [String(performerId)] } },
      });
      const batch = data?.[cfg.queryName]?.[cfg.itemsKey] || [];
      items.push(
        ...batch.map((item) => ({
          id: String(item.id),
          title: item[cfg.titleField] || `${cfg.label.slice(0, -1)} ${item.id}`,
          tags: normalizeTags(item.tags),
        }))
      );
      if (batch.length < pluginConfig.pageSize) break;
      page += 1;
    }
    return items;
  }

  async function updateContentTags(contentType, itemId, tagIds) {
    const cfg = CONTENT_TYPES[contentType];
    const data = await gql(
      `
        mutation PerformerTagReviewUpdateContent($input: ${cfg.updateType}!) {
          ${cfg.updateName}(input: $input) { id }
        }
      `,
      {
        input: {
          id: String(itemId),
          tag_ids: Array.from(new Set(Array.from(tagIds).map(String))).sort((a, b) => Number(a) - Number(b)),
        },
      }
    );
    return data?.[cfg.updateName]?.id || null;
  }

  async function updatePerformerTags(performerId, tagIds) {
    const data = await gql(
      `
        mutation PerformerTagReviewUpdatePerformer($input: PerformerUpdateInput!) {
          performerUpdate(input: $input) { id }
        }
      `,
      {
        input: {
          id: String(performerId),
          tag_ids: Array.from(new Set(Array.from(tagIds).map(String))).sort((a, b) => Number(a) - Number(b)),
        },
      }
    );
    return data?.performerUpdate?.id || null;
  }

  function contentCounts() {
    const counts = {};
    Object.entries(state.panel.content).forEach(([type, items]) => {
      counts[type] = Array.isArray(items) ? items.length : 0;
    });
    return counts;
  }

  function selectedContentItems() {
    const entries = [];
    for (const type of state.panel.selectedContentTypes) {
      const items = state.panel.content[type] || [];
      for (const item of items) entries.push({ type, item });
    }
    return entries;
  }

  function pendingApplyCountsByType() {
    const counts = {};
    for (const type of Object.keys(CONTENT_TYPES)) counts[type] = 0;
    for (const entry of pendingApplyItems()) {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
    }
    return counts;
  }

  function pendingApplyItems() {
    const selectedTagIds = new Set(Array.from(state.panel.selectedTagIds).filter((tagId) => !isTagExcluded(tagId)));
    if (!selectedTagIds.size) return [];
    return selectedContentItems()
      .map(({ type, item }) => {
        const itemTagIds = new Set(item.tags.map((tag) => tag.id));
        const missing = Array.from(selectedTagIds).filter((tagId) => !itemTagIds.has(tagId));
        return { type, item, itemTagIds, missing };
      })
      .filter((entry) => entry.missing.length);
  }

  function buildSummaryRows() {
    const performerTagIds = new Set((state.panel.performer?.tags || []).map((tag) => tag.id));
    const counts = new Map();
    const totalItems = selectedContentItems().length;

    for (const { item } of selectedContentItems()) {
      const seenInItem = new Set();
      for (const tag of item.tags) {
        if (isTagExcluded(tag.id)) continue;
        if (state.panel.hidePerformerTags && performerTagIds.has(tag.id)) continue;
        if (state.panel.summarySearch && !tag.name.toLowerCase().includes(state.panel.summarySearch.toLowerCase())) continue;
        if (state.panel.filter === "parents" && !tag.children.length) continue;
        if (state.panel.filter === "leaf" && tag.children.length) continue;
        if (seenInItem.has(tag.id)) continue;
        seenInItem.add(tag.id);
        if (!counts.has(tag.id)) {
          counts.set(tag.id, { tag, count: 0 });
        }
        counts.get(tag.id).count += 1;
      }
    }

    const rows = Array.from(counts.values());
    rows.sort((a, b) => {
      if (state.panel.sort === "name") {
        return a.tag.name.localeCompare(b.tag.name, undefined, { sensitivity: "base" });
      }
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.name.localeCompare(b.tag.name, undefined, { sensitivity: "base" });
    });

    const limit = state.config?.summaryTagLimit ?? DEFAULT_CONFIG.summaryTagLimit;
    return {
      rows: limit > 0 ? rows.slice(0, limit) : rows,
      totalItems,
      totalTags: rows.length,
    };
  }

  function buildDeltaSummaryData() {
    const performer = state.panel.performer;
    const performerTags = (performer?.tags || []).filter((tag) => !isTagExcluded(tag.id));
    const performerTagIds = new Set(performerTags.map((tag) => tag.id));
    const items = selectedContentItems();
    const contentTagIds = new Set();
    const contentItemsMissingPerformerTags = [];
    const performerTagCoverage = new Map(performerTags.map((tag) => [tag.id, 0]));

    for (const { item } of items) {
      const itemTagIds = new Set((item.tags || []).map((tag) => tag.id));
      let itemMissingPerformerTag = false;
      for (const tag of item.tags || []) {
        if (!isTagExcluded(tag.id)) contentTagIds.add(tag.id);
      }
      for (const tagId of performerTagIds) {
        if (itemTagIds.has(tagId)) {
          performerTagCoverage.set(tagId, (performerTagCoverage.get(tagId) || 0) + 1);
        } else {
          itemMissingPerformerTag = true;
        }
      }
      if (itemMissingPerformerTag) contentItemsMissingPerformerTags.push(item);
    }

    const contentOnlyTags = Array.from(contentTagIds).filter((tagId) => !performerTagIds.has(tagId));
    const performerTagsMissingFromAllContent = performerTags.filter((tag) => (performerTagCoverage.get(tag.id) || 0) === 0);
    const performerTagsNotOnEveryContent = performerTags.filter((tag) => items.length && (performerTagCoverage.get(tag.id) || 0) < items.length);

    return {
      performerTagCount: performerTags.length,
      selectedContentCount: items.length,
      contentTagCount: contentTagIds.size,
      contentOnlyTagCount: contentOnlyTags.length,
      contentItemsMissingPerformerTagCount: contentItemsMissingPerformerTags.length,
      performerTagsMissingFromAllContentCount: performerTagsMissingFromAllContent.length,
      performerTagsNotOnEveryContentCount: performerTagsNotOnEveryContent.length,
      reviewStatus: getReviewState(performer?.id),
    };
  }

  function buildDeltaSummarySection() {
    if (!state.panel.performer || state.panel.loading || state.panel.error) return "";
    if (!state.panel.snapshotRailOpen) {
      return `
        <aside class="ptr-snapshot-rail ptr-snapshot-rail-collapsed">
          <button type="button" class="ptr-side-tab" data-action="open-snapshot-rail" title="Open review snapshot">Snapshot</button>
        </aside>
      `;
    }
    const delta = buildDeltaSummaryData();
    return `
      <aside class="ptr-snapshot-rail ptr-snapshot-rail-open">
        <button type="button" class="ptr-side-tab ptr-side-tab-docked" data-action="close-snapshot-rail" aria-label="Collapse review snapshot">&lt;&lt;</button>
        <div class="ptr-section ptr-rail-content">
          <div class="ptr-section-heading-row">
            <h3>Review Snapshot</h3>
          </div>
          <div class="ptr-delta-grid">
            <div class="ptr-delta-card"><strong>${delta.performerTagCount}</strong><span>performer tags</span></div>
            <div class="ptr-delta-card"><strong>${delta.selectedContentCount}</strong><span>selected content</span></div>
            <div class="ptr-delta-card"><strong>${delta.contentTagCount}</strong><span>content tags found</span></div>
            <div class="ptr-delta-card"><strong>${delta.contentOnlyTagCount}</strong><span>content tags not on performer</span></div>
            <div class="ptr-delta-card"><strong>${delta.contentItemsMissingPerformerTagCount}</strong><span>items missing performer tags</span></div>
            <div class="ptr-delta-card"><strong>${delta.performerTagsNotOnEveryContentCount}</strong><span>performer tags not everywhere</span></div>
          </div>
        </div>
      </aside>
    `;
  }

  function allTagById() {
    return new Map((state.panel.allTags || []).map((tag) => [tag.id, tag]));
  }

  function isTagHiddenFromHierarchy(tagId) {
    const id = String(tagId || "");
    return id === configuredReviewedTagId() || state.panel.blacklistedTagIds.has(id);
  }

  function railTagChildren(tag, tagMap) {
    return (tag.children || [])
      .map((child) => tagMap.get(String(child.id)))
      .filter((child) => child && !isTagHiddenFromHierarchy(child.id))
      .sort((a, b) => String(a.sort_name || a.name).localeCompare(String(b.sort_name || b.name), undefined, { sensitivity: "base" }));
  }

  function railTagMatches(tag, search, tagMap, visited = new Set()) {
    if (!tag || visited.has(tag.id)) return false;
    visited.add(tag.id);
    if (!search) return true;
    if (tag.name.toLowerCase().includes(search)) return true;
    return railTagChildren(tag, tagMap).some((child) => railTagMatches(child, search, tagMap, visited));
  }

  function railRootTags(tagMap) {
    const roots = (state.panel.allTags || [])
      .filter((tag) => !isTagHiddenFromHierarchy(tag.id))
      .filter((tag) => !(tag.parents || []).some((parent) => tagMap.has(String(parent.id))))
      .sort((a, b) => String(a.sort_name || a.name).localeCompare(String(b.sort_name || b.name), undefined, { sensitivity: "base" }));
    return roots.length ? roots : (state.panel.allTags || []).filter((tag) => !isTagHiddenFromHierarchy(tag.id));
  }

  function buildRailTagRows(tags, tagMap, search, depth = 0, visited = new Set()) {
    if (depth > 8) return "";
    return tags
      .filter((tag) => railTagMatches(tag, search, tagMap))
      .map((tag) => {
        if (visited.has(tag.id)) return "";
        const nextVisited = new Set(visited);
        nextVisited.add(tag.id);
        const children = railTagChildren(tag, tagMap).filter((child) => railTagMatches(child, search, tagMap, new Set(nextVisited)));
        const hasChildren = children.length > 0;
        const expanded = !!search || state.panel.expandedTagIds.has(tag.id);
        const onPerformer = (state.panel.performer?.tags || []).some((performerTag) => performerTag.id === tag.id);
        const adding = state.panel.railAddingTagId === tag.id;
        const locallyExcluded = state.excludedTagIds.has(String(tag.id));
        return `
          <div class="ptr-rail-node" style="--ptr-depth:${depth}">
            <div class="ptr-rail-row${onPerformer ? " ptr-on-performer" : ""}${locallyExcluded ? " ptr-excluded" : ""}">
              <button
                type="button"
                class="ptr-rail-tag"
                ${hasChildren ? `data-rail-toggle-id="${escapeHtml(tag.id)}"` : ""}
                title="${escapeHtml(hasChildren ? `${expanded ? "Collapse" : "Expand"} ${tag.name}` : tag.name)}"
                ${hasChildren ? "" : " disabled"}
              >
                <span>${escapeHtml(tag.name)}</span>
                <small>${hasChildren ? (expanded ? "Expanded" : "Collapsed") : "Tag"}</small>
              </button>
              ${
                locallyExcluded
                  ? `<span class="ptr-rail-action ptr-muted">Ignored</span>`
                  : `<button
                      type="button"
                      class="ptr-rail-action${onPerformer ? " ptr-remove" : " ptr-add"}"
                      data-rail-action-tag-id="${escapeHtml(tag.id)}"
                      ${adding ? " disabled" : ""}
                      title="${escapeHtml(onPerformer ? `Remove ${tag.name} from performer` : `Add ${tag.name} to performer and selection`)}"
                    >${adding ? "Adding..." : onPerformer ? "- On Performer" : "+ Add"}</button>`
              }
              <button
                type="button"
                class="ptr-rail-exclude-button${locallyExcluded ? " ptr-active" : ""}"
                data-exclude-tag-id="${escapeHtml(tag.id)}"
                title="${escapeHtml(locallyExcluded ? "Include in sync review" : "Ignore in sync review")}"
                aria-label="${escapeHtml(locallyExcluded ? `Include ${tag.name} in sync review` : `Ignore ${tag.name} in sync review`)}"
              >${locallyExcluded ? "On" : "!"}</button>
            </div>
            ${hasChildren && expanded ? `<div class="ptr-rail-children">${buildRailTagRows(children, tagMap, search, depth + 1, nextVisited)}</div>` : ""}
          </div>
        `;
      })
      .join("");
  }

  function buildTagRail() {
    if (!state.panel.tagRailOpen) {
      return `
        <aside class="ptr-tag-rail ptr-tag-rail-collapsed">
          <button type="button" class="ptr-side-tab" data-action="open-tag-rail" title="Open tag hierarchy">Tags</button>
        </aside>
      `;
    }

    const tagMap = allTagById();
    const search = state.panel.tagRailSearch.trim().toLowerCase();
    const rows = buildRailTagRows(railRootTags(tagMap), tagMap, search);
    return `
      <aside class="ptr-tag-rail ptr-tag-rail-open">
        <button type="button" class="ptr-side-tab ptr-side-tab-docked" data-action="close-tag-rail" aria-label="Collapse tag hierarchy">&lt;&lt;</button>
        <div class="ptr-section ptr-rail-content">
          <div class="ptr-section-heading-row">
            <h3>Tag Hierarchy</h3>
          </div>
          <div class="ptr-toolbar">
            <input class="ptr-input" type="search" data-control="tag-rail-search" placeholder="Search all tags..." value="${escapeHtml(state.panel.tagRailSearch)}">
            <button type="button" class="ptr-button" data-action="collapse-tag-rail-groups">Collapse</button>
          </div>
          <div class="ptr-status">Click a tag to add it. Use ! to ignore a tag in sync review.</div>
          <div class="ptr-rail-tree">
            ${rows || `<div class="ptr-empty">No tags match the current search.</div>`}
          </div>
        </div>
      </aside>
    `;
  }

  function renderHost() {
    const performerId = getPerformerIdFromPath();
    if (!performerId) {
      document.getElementById(HOST_ID)?.remove();
      return;
    }

    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.className = "ptr-host";
    }

    const mount = findButtonMount();
    if (mount?.target) {
      if (mount.mode === "append") {
        mount.target.appendChild(host);
      } else if (mount.target.parentElement) {
        const target = mount.target;
        target.parentElement.insertBefore(host, target.nextSibling);
      }
    } else if (!host.parentElement) {
      document.body.appendChild(host);
    }

    host.innerHTML = `<button type="button" class="ptr-launch-button">Tag Review</button>`;
    host.querySelector("button").addEventListener("click", () => openPanel(performerId));
  }

  function findButtonMount() {
    const appendTarget = [
      ".performer-page .btn-toolbar",
      ".performer-page .btn-group",
      ".performer-page .detail-header-actions",
      ".performer-page .entity-header-actions",
      ".detail-header .btn-toolbar",
      ".detail-header .btn-group",
      ".entity-details .btn-toolbar",
      ".entity-details .btn-group",
      ".entity-header .btn-toolbar",
      ".entity-header .btn-group",
    ]
      .map((selector) => document.querySelector(selector))
      .find(Boolean);
    if (appendTarget) return { target: appendTarget, mode: "append" };

    const afterTarget =
      document.querySelector(".performer-page h1") ||
      document.querySelector(".entity-details h1") ||
      document.querySelector(".detail-header") ||
      document.querySelector(".performer-header") ||
      document.querySelector("h1");
    return afterTarget ? { target: afterTarget, mode: "after" } : null;
  }

  async function openPanel(performerId) {
    state.currentPerformerId = String(performerId);
    syncQueueIndexToPerformer(performerId);
    state.panel.open = true;
    state.panel.collapsed = false;
    state.panel.loading = true;
    state.panel.error = "";
    state.panel.status = "";
    state.panel.content = {};
    state.panel.selectedTagIds = new Set();
    state.panel.lastApplySnapshot = null;
    renderPanel();

    try {
      const config = await loadConfig();
      state.panel.selectedContentTypes = new Set(config.contentTypes);
      const [performer, allTags] = await Promise.all([fetchPerformer(performerId), fetchAllTags()]);
      const contentEntries = await Promise.all(
        config.contentTypes.map(async (contentType) => [contentType, await fetchPerformerContent(performerId, contentType, config)])
      );
      state.panel.performer = performer;
      state.panel.allTags = allTags;
      state.panel.blacklistedTagIds = buildBlacklistedTagIds(config.tagBlacklist, allTags);
      state.panel.content = Object.fromEntries(contentEntries);
      state.panel.selectedTagIds = new Set(performer.tags.map((tag) => tag.id).filter((tagId) => !isTagExcluded(tagId)));
      state.panel.status = reviewedTagWarningText() || reviewedTagNoticeText() || "Review complete.";
    } catch (err) {
      console.error("[PerformerTagReview] panel load failed", err);
      state.panel.error = err.message || String(err);
    } finally {
      state.panel.loading = false;
      renderPanel();
    }
  }

  function closePanel() {
    state.panel.open = false;
    state.panel.collapsed = false;
    document.getElementById(WINDOW_ID)?.remove();
  }

  function renderPanel() {
    if (!state.panel.open) return;
    let windowEl = document.getElementById(WINDOW_ID);
    if (!windowEl) {
      windowEl = document.createElement("div");
      windowEl.id = WINDOW_ID;
      windowEl.className = "ptr-window";
      document.body.appendChild(windowEl);
      applyWindowLayout(windowEl);
    }

    const focusedControl = document.activeElement?.getAttribute?.("data-control") || "";
    const focusedSelectionStart = Number.isFinite(document.activeElement?.selectionStart)
      ? document.activeElement.selectionStart
      : null;

    const wasCollapsed = windowEl.classList.contains("ptr-window-collapsed");
    windowEl.className = `ptr-window${state.panel.collapsed ? " ptr-window-collapsed" : ""}`;
    if (state.panel.collapsed) {
      windowEl.style.width = "auto";
      windowEl.style.height = "auto";
    } else {
      applyWindowLayout(windowEl, wasCollapsed ? readWindowLayout() : currentWindowLayout(windowEl));
    }
    windowEl.innerHTML = state.panel.collapsed ? buildCollapsedPanelHtml() : buildPanelHtml();
    bindPanelEvents(windowEl);

    if (focusedControl) {
      const nextFocus = windowEl.querySelector(`[data-control="${focusedControl}"]`);
      if (nextFocus) {
        nextFocus.focus();
        if (focusedSelectionStart !== null && typeof nextFocus.setSelectionRange === "function") {
          const caret = Math.min(focusedSelectionStart, String(nextFocus.value || "").length);
          nextFocus.setSelectionRange(caret, caret);
        }
      }
    }
  }

  function buildCollapsedPanelHtml() {
    const performer = state.panel.performer;
    const title = performer ? `${performer.name} Tag Review` : "Tag Review";
    return `
      <button type="button" class="ptr-window-tab" data-action="expand-panel" title="${escapeHtml(title)}">
        Tag Review
      </button>
    `;
  }

  function buildPanelHtml() {
    const performer = state.panel.performer;
    const title = performer ? `${performer.name} Tag Summary` : "Tag Review";
    if (state.panel.loading) {
      return `
        <div class="ptr-panel" style="--ptr-scale:${state.panel.scale}">
          <div class="ptr-panel-header">
            <h2 class="ptr-title">${escapeHtml(title)}</h2>
            <div class="ptr-panel-header-actions">
              <button type="button" class="ptr-icon-button" data-action="reset-layout" aria-label="Reset position">R</button>
              <button type="button" class="ptr-icon-button" data-action="collapse-panel" aria-label="Collapse">_</button>
              <button type="button" class="ptr-close" data-action="close" aria-label="Close">&times;</button>
            </div>
          </div>
          <div class="ptr-panel-body"><div class="ptr-section"><div class="ptr-empty">Loading performer content...</div></div></div>
        </div>
      `;
    }

    if (state.panel.error) {
      return `
        <div class="ptr-panel" style="--ptr-scale:${state.panel.scale}">
          <div class="ptr-panel-header">
            <h2 class="ptr-title">${escapeHtml(title)}</h2>
            <div class="ptr-panel-header-actions">
              <button type="button" class="ptr-icon-button" data-action="reset-layout" aria-label="Reset position">R</button>
              <button type="button" class="ptr-icon-button" data-action="collapse-panel" aria-label="Collapse">_</button>
              <button type="button" class="ptr-close" data-action="close" aria-label="Close">&times;</button>
            </div>
          </div>
          <div class="ptr-panel-body"><div class="ptr-section"><div class="ptr-empty">${escapeHtml(state.panel.error)}</div></div></div>
        </div>
      `;
    }

    const pending = pendingApplyItems();
    const pendingCounts = pendingApplyCountsByType();
    const counts = contentCounts();
    const summary = buildSummaryRows();
    const footerStatus = footerStatusText(pending);
    const reviewState = getReviewState(state.currentPerformerId);
    const isReviewed = reviewState === "reviewed";
    const panelStateClass = reviewState ? ` ptr-panel-${reviewState}` : " ptr-panel-needs-review";
    return `
      <div class="ptr-panel ptr-panel-queue-open${panelStateClass}${state.panel.snapshotRailOpen ? " ptr-panel-snapshot-open" : ""}${state.panel.tagRailOpen ? " ptr-panel-tag-open" : ""}" role="complementary" aria-label="${escapeHtml(title)}" style="--ptr-scale:${state.panel.scale}">
        <div class="ptr-panel-header">
          <h2 class="ptr-title">${escapeHtml(title)}</h2>
          <div class="ptr-panel-header-actions">
            <button type="button" class="ptr-icon-button ptr-scale-button" data-action="scale-down" aria-label="Scale down">A-</button>
            <button type="button" class="ptr-icon-button ptr-scale-button" data-action="scale-up" aria-label="Scale up">A+</button>
            <button type="button" class="ptr-icon-button" data-action="reset-layout" aria-label="Reset position">R</button>
            <button type="button" class="ptr-icon-button" data-action="collapse-panel" aria-label="Collapse">_</button>
            <button type="button" class="ptr-close" data-action="close" aria-label="Close">&times;</button>
          </div>
        </div>
        <div class="ptr-panel-body ptr-panel-body-queue-open${state.panel.tagRailOpen ? " ptr-panel-body-tag-open" : ""}${state.panel.snapshotRailOpen ? " ptr-panel-body-snapshot-open" : ""}">
          ${buildQueueSection()}
          ${buildDeltaSummarySection()}
          <section class="ptr-section ptr-performer-section">
            <h3>Performer Tags To Content</h3>
            ${buildContentTypeControls(counts)}
            <div class="ptr-toolbar ptr-performer-tag-toolbar">
              <input class="ptr-input" type="search" data-control="performer-tag-search" placeholder="Search performer tags..." value="${escapeHtml(state.panel.performerTagSearch)}">
              <button type="button" class="ptr-button" data-action="select-all-tags">Select All</button>
              <button type="button" class="ptr-button" data-action="clear-tags">Clear</button>
            </div>
            ${buildPerformerTagGrid()}
            <div class="ptr-status">
              ${selectedContentItems().length} selected content items. ${pending.length} would receive at least one selected tag.
              ${buildPendingCountsText(pendingCounts)}
            </div>
          </section>
          <section class="ptr-section ptr-summary-section">
            <h3>Tags With This Performer</h3>
            <div class="ptr-toolbar ptr-summary-toolbar">
              <input class="ptr-input" type="search" data-control="summary-search" placeholder="Search content tags..." value="${escapeHtml(state.panel.summarySearch)}">
              <select class="ptr-select" data-control="summary-sort">
                <option value="count"${state.panel.sort === "count" ? " selected" : ""}>Count</option>
                <option value="name"${state.panel.sort === "name" ? " selected" : ""}>Name</option>
              </select>
              <select class="ptr-select" data-control="summary-filter">
                <option value="all"${state.panel.filter === "all" ? " selected" : ""}>All</option>
                <option value="leaf"${state.panel.filter === "leaf" ? " selected" : ""}>Leaf</option>
                <option value="parents"${state.panel.filter === "parents" ? " selected" : ""}>Parents</option>
              </select>
              <label class="ptr-checkbox-row">
                <input type="checkbox" data-control="hide-performer-tags"${state.panel.hidePerformerTags ? " checked" : ""}>
                Hide performer tags
              </label>
            </div>
            <div class="ptr-status">${summary.totalTags} matching tags across ${summary.totalItems} selected content items.</div>
            ${buildSummaryList(summary)}
          </section>
          ${buildTagRail()}
        </div>
        <div class="ptr-panel-footer">
          ${footerStatus ? `<div class="ptr-footer-status">${escapeHtml(footerStatus)}</div>` : ""}
          <div class="ptr-toolbar ptr-right">
            <button type="button" class="ptr-button" data-action="queue-prev"${state.panel.queue.loaded && state.panel.queue.index > 0 && !state.panel.queue.loading ? "" : " disabled"}>Previous</button>
            <button type="button" class="ptr-button" data-action="queue-next"${
              state.panel.queue.loaded && state.panel.queue.index < state.panel.queue.performers.length - 1 && !state.panel.queue.loading ? "" : " disabled"
            }>Next</button>
            <button type="button" class="ptr-button ptr-review-toggle${isReviewed ? " ptr-active" : ""}" data-action="toggle-reviewed" aria-pressed="${isReviewed ? "true" : "false"}"${state.currentPerformerId ? "" : " disabled"}>
              ${isReviewed ? "Reviewed" : "Mark Reviewed"}
            </button>
            <button type="button" class="ptr-button" data-action="mark-reviewed"${state.currentPerformerId ? "" : " disabled"}>Reviewed + Next</button>
            <button type="button" class="ptr-button" data-action="mark-skipped"${state.currentPerformerId ? "" : " disabled"}>Skip + Next</button>
            <button type="button" class="ptr-button" data-action="clear-review-state"${reviewState ? "" : " disabled"}>Clear Review</button>
            <button type="button" class="ptr-button" data-action="rescan">Rescan</button>
            <button type="button" class="ptr-button" data-action="undo-apply"${state.panel.lastApplySnapshot && !state.panel.applying ? "" : " disabled"}>Undo Last Apply</button>
            <button type="button" class="ptr-button ptr-primary" data-action="apply-tags"${pending.length && !state.panel.applying ? "" : " disabled"}>
              ${state.panel.applying ? "Applying..." : `Apply To ${pending.length} Items`}
            </button>
          </div>
          <button type="button" class="ptr-resize-grip" data-action="resize-panel" aria-label="Resize panel"></button>
        </div>
      </div>
    `;
  }

  function buildQueueSection() {
    const queue = state.panel.queue;
    const current = currentQueuePerformer();
    const performer = state.panel.performer;
    const currentLabel = current
      ? `${queue.index + 1} / ${queue.performers.length} ${current.name}`
      : performer
      ? performer.name
      : "No performer selected";
    const queueStatus =
      queue.loading || queue.checkingSync || queue.checkingOCounts
        ? queue.status
        : queue.loaded
        ? `${queue.performers.length} / ${queue.sourcePerformers.length} performers shown.`
        : queue.status;
    const reviewedTagWarning = reviewedTagWarningText();
    const reviewedTagNotice = reviewedTagNoticeText();
    return `
      <section class="ptr-section ptr-queue-section">
        <div class="ptr-section-heading-row ptr-queue-heading-row">
          <h3>Review Queue</h3>
          <div class="ptr-queue-position">${escapeHtml(currentLabel)}</div>
        </div>
        <div class="ptr-toolbar ptr-queue-toolbar">
          <button type="button" class="ptr-button" data-action="load-queue"${queue.loading ? " disabled" : ""}>
            ${queue.loading ? "Loading..." : queue.loaded ? "Reload Queue" : "Load Queue"}
          </button>
          <select class="ptr-select" data-control="queue-sort">
            <option value="name"${queue.sort === "name" ? " selected" : ""}>Sort by name</option>
            <option value="tagCount"${queue.sort === "tagCount" ? " selected" : ""}>Sort by tag count</option>
            <option value="sceneCount"${queue.sort === "sceneCount" ? " selected" : ""}>Sort by scene count</option>
            <option value="rating"${queue.sort === "rating" ? " selected" : ""}>Sort by rating</option>
            <option value="oCount"${queue.sort === "oCount" ? " selected" : ""}>Sort by O-count</option>
          </select>
          <button type="button" class="ptr-button ptr-direction-toggle" data-action="toggle-queue-direction" title="Toggle sort direction">
            ${queue.direction === "desc" ? "Desc" : "Asc"}
          </button>
          <select class="ptr-select" data-control="queue-filter">
            <option value="all"${queue.filterMode === "all" ? " selected" : ""}>All performers</option>
            <option value="unreviewed"${queue.filterMode === "unreviewed" ? " selected" : ""}>Needs review</option>
            <option value="reviewed"${queue.filterMode === "reviewed" ? " selected" : ""}>Reviewed</option>
            <option value="skipped"${queue.filterMode === "skipped" ? " selected" : ""}>Skipped</option>
            <option value="noTags"${queue.filterMode === "noTags" ? " selected" : ""}>No performer tags</option>
            <option value="noScenes"${queue.filterMode === "noScenes" ? " selected" : ""}>No scenes</option>
            <option value="needsSync"${queue.filterMode === "needsSync" ? " selected" : ""}>Needs tag sync</option>
          </select>
          <button type="button" class="ptr-button" data-action="open-performer-page"${state.currentPerformerId ? "" : " disabled"}>Open Performer Page</button>
          <label class="ptr-checkbox-row">
            <input type="checkbox" data-control="queue-hide-reviewed"${queue.hideReviewed ? " checked" : ""}>
            Hide reviewed
          </label>
          <label class="ptr-checkbox-row ptr-auto-open">
            <input type="checkbox" data-control="queue-auto-open"${queue.autoOpen ? " checked" : ""}>
            Auto open performer pages
          </label>
        </div>
        ${reviewedTagWarning ? `<div class="ptr-warning">${escapeHtml(reviewedTagWarning)}</div>` : ""}
        ${reviewedTagNotice ? `<div class="ptr-notice">${escapeHtml(reviewedTagNotice)}</div>` : ""}
        ${queueStatus ? `<div class="ptr-status">${escapeHtml(queueStatus)}</div>` : ""}
        ${queue.loaded ? buildQueueList() : ""}
      </section>
    `;
  }

  function buildQueueList() {
    const queue = state.panel.queue;
    if (!queue.performers.length) return `<div class="ptr-empty">No performers in the review queue.</div>`;
    return `
      <div class="ptr-queue-list" aria-label="Performer review queue">
        ${queue.performers
          .map((performer, index) => {
            const active = index === queue.index || performer.id === state.currentPerformerId;
            const reviewState = getReviewState(performer);
            const meta = `${Number(performer.tagCount || 0)} tags / ${Number(performer.sceneCount || 0)} scenes / ${formatQueueRating(
              performer.rating100
            )} / ${formatQueueOCount(performer)}`;
            return `
              <button
                type="button"
                class="ptr-queue-button${active ? " ptr-active" : ""}${reviewState ? ` ptr-${reviewState}` : ""}"
                data-queue-index="${index}"
                title="${escapeHtml(`${performer.name} - ${meta} - ${reviewStatusLabel(reviewState)}`)}"
              >
                <span>${escapeHtml(performer.name)}</span>
                <small>${escapeHtml(meta)}</small>
                <em>${escapeHtml(reviewStatusLabel(reviewState))}</em>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function buildPendingCountsText(counts) {
    const parts = Object.entries(CONTENT_TYPES)
      .map(([type, cfg]) => {
        const count = counts[type] || 0;
        return count ? `${count} ${cfg.label.toLowerCase()}` : "";
      })
      .filter(Boolean);
    return parts.length ? `(${parts.join(", ")})` : "";
  }

  function buildContentTypeControls(counts) {
    return `
      <div class="ptr-toolbar">
        ${Object.entries(CONTENT_TYPES)
          .map(([type, cfg]) => {
            const checked = state.panel.selectedContentTypes.has(type) ? " checked" : "";
            const disabled = state.config?.contentTypes?.includes(type) ? "" : " disabled";
            return `
              <label class="ptr-checkbox-row">
                <input type="checkbox" data-content-type="${type}"${checked}${disabled}>
                ${escapeHtml(cfg.label)} (${counts[type] || 0})
              </label>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function buildPerformerTagGrid() {
    const performerTags = (state.panel.performer?.tags || []).filter((tag) => !isTagExcluded(tag.id));
    if (!performerTags.length) return `<div class="ptr-empty">This performer does not have any tags.</div>`;
    const search = state.panel.performerTagSearch.trim().toLowerCase();
    const tags = performerTags
      .filter((tag) => !search || tag.name.toLowerCase().includes(search))
      .sort((a, b) => String(a.sort_name || a.name).localeCompare(String(b.sort_name || b.name), undefined, { sensitivity: "base" }));
    return `
      <div class="ptr-tag-grid">
        ${
          tags.length
            ? tags
                .map((tag) => {
                  const selected = state.panel.selectedTagIds.has(tag.id);
                  const removing = state.panel.removingPerformerTagId === tag.id;
                  return `
                    <span class="ptr-tag-chip${selected ? " ptr-selected" : ""}${removing ? " ptr-removing" : ""}">
                      <button
                        type="button"
                        class="ptr-tag-chip-main"
                        data-performer-tag-select-id="${escapeHtml(tag.id)}"
                        aria-pressed="${selected ? "true" : "false"}"
                        title="${escapeHtml(selected ? `Remove ${tag.name} from this apply set` : `Use ${tag.name} when applying to content`)}"
                      >
                        <span aria-hidden="true">${selected ? "✓" : "+"}</span>
                        ${escapeHtml(tag.name)}
                      </button>
                      <button
                        type="button"
                        class="ptr-tag-chip-remove"
                        data-performer-tag-remove-id="${escapeHtml(tag.id)}"
                        ${removing ? " disabled" : ""}
                        title="${escapeHtml(`Remove ${tag.name} from performer`)}"
                        aria-label="${escapeHtml(`Remove ${tag.name} from performer`)}"
                      >${removing ? "..." : "×"}</button>
                    </span>
                  `;
                })
                .join("")
            : `<div class="ptr-empty">No performer tags match the current search.</div>`
        }
      </div>
    `;
  }

  function buildSummaryList(summary) {
    if (!summary.rows.length) return `<div class="ptr-empty">No matching tags found for the current filters.</div>`;
    const maxCount = Math.max(...summary.rows.map((row) => row.count), 1);
    const performerTagIds = new Set((state.panel.performer?.tags || []).map((tag) => tag.id));
    return `
      <div class="ptr-summary-list">
        ${summary.rows
          .map(({ tag, count }) => {
            const percent = summary.totalItems ? Math.round((count / summary.totalItems) * 100) : 0;
            const onPerformer = performerTagIds.has(tag.id);
            const selectedToApply = state.panel.selectedTagIds.has(tag.id);
            const isPromoting = state.panel.promotingTagId === tag.id;
            return `
              <div class="ptr-summary-row${onPerformer ? " ptr-on-performer" : ""}${selectedToApply ? " ptr-selected-to-apply" : ""}" title="${escapeHtml(tag.name)}">
                <button
                  type="button"
                  class="ptr-promote-button${onPerformer ? " ptr-promoted" : ""}"
                  data-promote-tag-id="${escapeHtml(tag.id)}"
                  title="${onPerformer ? "Already on performer" : "Add this tag to the performer"}"
                  ${onPerformer || isPromoting ? " disabled" : ""}
                >${isPromoting ? "..." : onPerformer ? "OK" : "<"}</button>
                <div class="ptr-summary-name">${escapeHtml(tag.name)}</div>
                <div class="ptr-summary-count">${count} / ${percent}%</div>
                <div class="ptr-summary-bar"><span style="width:${Math.max(2, Math.round((count / maxCount) * 100))}%"></span></div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function bindPanelEvents(root) {
    root.querySelector('[data-action="close"]')?.addEventListener("click", closePanel);
    root.querySelector('[data-action="collapse-panel"]')?.addEventListener("click", () => {
      saveCurrentWindowLayout();
      state.panel.collapsed = true;
      renderPanel();
    });
    root.querySelector('[data-action="expand-panel"]')?.addEventListener("click", () => {
      state.panel.collapsed = false;
      renderPanel();
    });
    root.querySelector('[data-action="reset-layout"]')?.addEventListener("click", () => {
      const layout = defaultWindowLayout();
      writeWindowLayout(layout);
      const windowEl = document.getElementById(WINDOW_ID);
      if (windowEl) applyWindowLayout(windowEl, layout);
      renderPanel();
    });
    root.querySelector('[data-action="scale-down"]')?.addEventListener("click", () => setPanelScale(state.panel.scale - 0.05));
    root.querySelector('[data-action="scale-up"]')?.addEventListener("click", () => setPanelScale(state.panel.scale + 0.05));
    root.querySelector(".ptr-panel-header")?.addEventListener("pointerdown", startWindowDrag);
    root.querySelector('[data-action="resize-panel"]')?.addEventListener("pointerdown", startWindowResize);
    root.addEventListener("pointerup", saveCurrentWindowLayout);
    root.querySelector('[data-action="load-queue"]')?.addEventListener("click", loadPerformerQueue);
    root.querySelector('[data-action="queue-prev"]')?.addEventListener("click", () => openQueuePerformer(state.panel.queue.index - 1));
    root.querySelector('[data-action="queue-next"]')?.addEventListener("click", () => openQueuePerformer(state.panel.queue.index + 1));
    root.querySelector('[data-action="open-performer-page"]')?.addEventListener("click", () => openPerformerPageInBackground(state.currentPerformerId));
    root.querySelector('[data-action="toggle-reviewed"]')?.addEventListener("click", () => {
      markCurrentPerformerReviewState(getReviewState(state.currentPerformerId) === "reviewed" ? "" : "reviewed", false);
    });
    root.querySelector('[data-action="mark-reviewed"]')?.addEventListener("click", () => markCurrentPerformerReviewState("reviewed", true));
    root.querySelector('[data-action="mark-skipped"]')?.addEventListener("click", () => markCurrentPerformerReviewState("skipped", true));
    root.querySelector('[data-action="clear-review-state"]')?.addEventListener("click", () => markCurrentPerformerReviewState("", false));
    root.querySelector('[data-action="open-snapshot-rail"]')?.addEventListener("click", () => {
      state.panel.snapshotRailOpen = true;
      renderPanel();
    });
    root.querySelector('[data-action="close-snapshot-rail"]')?.addEventListener("click", () => {
      state.panel.snapshotRailOpen = false;
      renderPanel();
    });
    root.querySelector('[data-action="open-tag-rail"]')?.addEventListener("click", () => {
      state.panel.tagRailOpen = true;
      renderPanel();
    });
    root.querySelector('[data-action="close-tag-rail"]')?.addEventListener("click", () => {
      state.panel.tagRailOpen = false;
      renderPanel();
    });
    root.querySelector('[data-action="collapse-tag-rail-groups"]')?.addEventListener("click", () => {
      state.panel.expandedTagIds = new Set();
      renderPanel();
    });
    root.querySelector('[data-control="queue-auto-open"]')?.addEventListener("change", (event) => {
      state.panel.queue.autoOpen = !!event.target.checked;
      writeStoredBoolean(QUEUE_AUTO_OPEN_STORAGE_KEY, state.panel.queue.autoOpen);
      renderPanel();
    });
    root.querySelector('[data-control="queue-sort"]')?.addEventListener("change", (event) => {
      state.panel.queue.sort = event.target.value || "name";
      applyQueueView();
      renderPanel();
      ensureQueueOCounts();
    });
    root.querySelector('[data-action="toggle-queue-direction"]')?.addEventListener("click", () => {
      state.panel.queue.direction = state.panel.queue.direction === "desc" ? "asc" : "desc";
      applyQueueView();
      renderPanel();
    });
    root.querySelector('[data-control="queue-filter"]')?.addEventListener("change", (event) => {
      state.panel.queue.filterMode = event.target.value || "all";
      applyQueueView();
      renderPanel();
      if (state.panel.queue.filterMode === "needsSync") ensureQueueSyncStatuses();
    });
    root.querySelector('[data-control="queue-hide-reviewed"]')?.addEventListener("change", (event) => {
      state.panel.queue.hideReviewed = !!event.target.checked;
      applyQueueView();
      renderPanel();
    });
    root.querySelectorAll("[data-queue-index]").forEach((button) => {
      button.addEventListener("click", () => openQueuePerformer(Number(button.getAttribute("data-queue-index"))));
    });
    root.querySelectorAll("[data-rail-toggle-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const tagId = String(button.getAttribute("data-rail-toggle-id") || "");
        if (!tagId) return;
        if (state.panel.expandedTagIds.has(tagId)) state.panel.expandedTagIds.delete(tagId);
        else state.panel.expandedTagIds.add(tagId);
        renderPanel();
      });
    });
    root.querySelectorAll("[data-rail-action-tag-id]").forEach((button) => {
      button.addEventListener("click", () => toggleRailTagOnPerformer(button.getAttribute("data-rail-action-tag-id")));
    });
    root.querySelectorAll("[data-exclude-tag-id]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleExcludedTag(button.getAttribute("data-exclude-tag-id"));
      });
    });
    root.querySelector('[data-action="select-all-tags"]')?.addEventListener("click", () => {
      state.panel.selectedTagIds = new Set((state.panel.performer?.tags || []).map((tag) => tag.id).filter((tagId) => !isTagExcluded(tagId)));
      renderPanel();
    });
    root.querySelector('[data-action="clear-tags"]')?.addEventListener("click", () => {
      state.panel.selectedTagIds = new Set();
      renderPanel();
    });
    root.querySelector('[data-action="rescan"]')?.addEventListener("click", () => openPanel(state.currentPerformerId));
    root.querySelector('[data-action="apply-tags"]')?.addEventListener("click", applySelectedTags);
    root.querySelector('[data-action="undo-apply"]')?.addEventListener("click", undoLastApply);
    root.querySelectorAll("[data-promote-tag-id]").forEach((button) => {
      button.addEventListener("click", () => promoteContentTagToPerformer(button.getAttribute("data-promote-tag-id")));
    });

    root.querySelectorAll("[data-performer-tag-select-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const tagId = String(button.getAttribute("data-performer-tag-select-id") || "");
        if (!tagId) return;
        if (state.panel.selectedTagIds.has(tagId)) state.panel.selectedTagIds.delete(tagId);
        else state.panel.selectedTagIds.add(tagId);
        renderPanel();
      });
    });

    root.querySelectorAll("[data-performer-tag-remove-id]").forEach((button) => {
      button.addEventListener("click", () => removePerformerTagFromPanel(button.getAttribute("data-performer-tag-remove-id")));
    });

    root.querySelectorAll("[data-content-type]").forEach((input) => {
      input.addEventListener("change", () => {
        const type = input.getAttribute("data-content-type");
        if (!type) return;
        if (input.checked) state.panel.selectedContentTypes.add(type);
        else state.panel.selectedContentTypes.delete(type);
        renderPanel();
      });
    });

    root.querySelector('[data-control="summary-sort"]')?.addEventListener("change", (event) => {
      state.panel.sort = event.target.value || "count";
      renderPanel();
    });
    root.querySelector('[data-control="summary-filter"]')?.addEventListener("change", (event) => {
      state.panel.filter = event.target.value || "all";
      renderPanel();
    });
    root.querySelector('[data-control="hide-performer-tags"]')?.addEventListener("change", (event) => {
      state.panel.hidePerformerTags = !!event.target.checked;
      renderPanel();
    });
    root.querySelector('[data-control="performer-tag-search"]')?.addEventListener("input", (event) => {
      state.panel.performerTagSearch = event.target.value || "";
      renderPanel();
    });
    root.querySelector('[data-control="summary-search"]')?.addEventListener("input", (event) => {
      state.panel.summarySearch = event.target.value || "";
      renderPanel();
    });
    root.querySelector('[data-control="tag-rail-search"]')?.addEventListener("input", (event) => {
      state.panel.tagRailSearch = event.target.value || "";
      renderPanel();
    });
  }

  async function applySelectedTags() {
    const pending = pendingApplyItems();
    if (!pending.length || state.panel.applying) return;
    state.panel.applying = true;
    state.panel.status = `Applying selected tags to ${pending.length} content items...`;
    renderPanel();

    let updated = 0;
    const snapshot = [];
    try {
      for (const entry of pending) {
        snapshot.push({
          type: entry.type,
          id: entry.item.id,
          originalTagIds: Array.from(entry.itemTagIds),
        });
        await updateContentTags(entry.type, entry.item.id, new Set([...entry.itemTagIds, ...entry.missing]));
        const currentIds = new Set(entry.item.tags.map((tag) => tag.id));
        const performerTagsById = new Map((state.panel.performer?.tags || []).map((tag) => [tag.id, tag]));
        entry.missing.forEach((tagId) => {
          if (currentIds.has(tagId)) return;
          const tag = performerTagsById.get(tagId);
          if (tag) entry.item.tags.push(tag);
        });
        updated += 1;
      }
      state.panel.lastApplySnapshot = snapshot;
      state.panel.status = `Updated ${updated} content items.`;
    } catch (err) {
      console.error("[PerformerTagReview] apply failed", err);
      state.panel.status = `Apply failed after ${updated} updates: ${err.message || err}`;
    } finally {
      state.panel.applying = false;
      renderPanel();
    }
  }

  async function undoLastApply() {
    const snapshot = state.panel.lastApplySnapshot;
    if (!Array.isArray(snapshot) || !snapshot.length || state.panel.applying) return;
    state.panel.applying = true;
    state.panel.status = `Undoing last apply for ${snapshot.length} content items...`;
    renderPanel();

    let restored = 0;
    try {
      for (const entry of snapshot) {
        await updateContentTags(entry.type, entry.id, new Set(entry.originalTagIds));
        const item = (state.panel.content[entry.type] || []).find((candidate) => candidate.id === entry.id);
        if (item) {
          const originalIds = new Set(entry.originalTagIds.map(String));
          item.tags = item.tags.filter((tag) => originalIds.has(tag.id));
        }
        restored += 1;
      }
      state.panel.lastApplySnapshot = null;
      state.panel.status = `Restored ${restored} content items.`;
    } catch (err) {
      console.error("[PerformerTagReview] undo failed", err);
      state.panel.status = `Undo failed after ${restored} restores: ${err.message || err}`;
    } finally {
      state.panel.applying = false;
      renderPanel();
    }
  }

  async function promoteContentTagToPerformer(tagId) {
    const normalizedTagId = String(tagId || "");
    const performer = state.panel.performer;
    if (!normalizedTagId || !performer || state.panel.promotingTagId) return;

    const existingIds = new Set((performer.tags || []).map((tag) => tag.id));
    if (existingIds.has(normalizedTagId)) return;

    const summaryTag = buildSummaryRows().rows.find((row) => row.tag.id === normalizedTagId)?.tag;
    if (!summaryTag) return;

    state.panel.promotingTagId = normalizedTagId;
    state.panel.status = `Adding ${summaryTag.name} to ${performer.name}...`;
    renderPanel();

    try {
      const nextIds = new Set([...existingIds, normalizedTagId]);
      await updatePerformerTags(performer.id, nextIds);
      performer.tags = normalizeTags([...performer.tags, summaryTag]);
      state.panel.selectedTagIds.add(normalizedTagId);
      state.panel.status = `Added ${summaryTag.name} to ${performer.name}.`;
    } catch (err) {
      console.error("[PerformerTagReview] promote tag failed", err);
      state.panel.status = `Could not add ${summaryTag.name}: ${err.message || err}`;
    } finally {
      state.panel.promotingTagId = "";
      renderPanel();
    }
  }

  async function removePerformerTagFromPanel(tagId) {
    const normalizedTagId = String(tagId || "");
    const performer = state.panel.performer;
    if (!normalizedTagId || !performer || state.panel.removingPerformerTagId) return;

    const tag = (performer.tags || []).find((performerTag) => performerTag.id === normalizedTagId);
    if (!tag) return;

    const existingIds = new Set((performer.tags || []).map((performerTag) => performerTag.id));
    existingIds.delete(normalizedTagId);
    state.panel.removingPerformerTagId = normalizedTagId;
    state.panel.status = `Removing ${tag.name} from ${performer.name}...`;
    renderPanel();

    try {
      await updatePerformerTags(performer.id, existingIds);
      performer.tags = normalizeTags((performer.tags || []).filter((performerTag) => performerTag.id !== normalizedTagId));
      state.panel.selectedTagIds.delete(normalizedTagId);
      state.panel.status = `Removed ${tag.name} from ${performer.name}.`;
    } catch (err) {
      console.error("[PerformerTagReview] performer tag remove failed", err);
      state.panel.status = `Could not remove ${tag.name}: ${err.message || err}`;
    } finally {
      state.panel.removingPerformerTagId = "";
      renderPanel();
    }
  }

  async function toggleRailTagOnPerformer(tagId) {
    const normalizedTagId = String(tagId || "");
    const performer = state.panel.performer;
    if (!normalizedTagId || !performer || state.panel.railAddingTagId) return;

    const tag = allTagById().get(normalizedTagId);
    if (!tag) return;

    const existingIds = new Set((performer.tags || []).map((performerTag) => performerTag.id));
    if (existingIds.has(normalizedTagId)) {
      state.panel.railAddingTagId = normalizedTagId;
      state.panel.status = `Removing ${tag.name} from ${performer.name}...`;
      renderPanel();

      try {
        const nextIds = new Set(existingIds);
        nextIds.delete(normalizedTagId);
        await updatePerformerTags(performer.id, nextIds);
        performer.tags = normalizeTags((performer.tags || []).filter((performerTag) => performerTag.id !== normalizedTagId));
        state.panel.selectedTagIds.delete(normalizedTagId);
        state.panel.status = `Removed ${tag.name} from ${performer.name}.`;
      } catch (err) {
        console.error("[PerformerTagReview] rail tag remove failed", err);
        state.panel.status = `Could not remove ${tag.name}: ${err.message || err}`;
      } finally {
        state.panel.railAddingTagId = "";
        renderPanel();
      }
      return;
    }

    state.panel.railAddingTagId = normalizedTagId;
    state.panel.status = `Adding ${tag.name} to ${performer.name}...`;
    renderPanel();

    try {
      const nextIds = new Set([...existingIds, normalizedTagId]);
      await updatePerformerTags(performer.id, nextIds);
      performer.tags = normalizeTags([...performer.tags, tag]);
      state.panel.selectedTagIds.add(normalizedTagId);
      state.panel.status = `Added ${tag.name} to ${performer.name} and selected it for content.`;
    } catch (err) {
      console.error("[PerformerTagReview] rail tag add failed", err);
      state.panel.status = `Could not add ${tag.name}: ${err.message || err}`;
    } finally {
      state.panel.railAddingTagId = "";
      renderPanel();
    }
  }

  function scheduleRender() {
    const token = ++state.routeToken;
    ROUTE_RETRY_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        if (token !== state.routeToken) return;
        renderHost();
      }, delay);
    });
  }

  function handleRouteChange() {
    const path = window.location.pathname;
    if (path === state.lastPath) return;
    state.lastPath = path;

    const performerId = getPerformerIdFromPath();
    if (state.panel.open && !state.suppressRoutePanelOpen) {
      if (performerId) {
        if (performerId !== state.currentPerformerId) {
          openPanel(performerId);
        } else {
          renderPanel();
        }
      } else {
        closePanel();
      }
    }
    if (performerId) syncQueueIndexToPerformer(performerId);

    scheduleRender();
  }

  function hookHistory() {
    if (window.__performerTagReviewHistoryHooked) return;
    window.__performerTagReviewHistoryHooked = true;
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    history.pushState = function (...args) {
      const result = pushState.apply(this, args);
      window.dispatchEvent(new Event("performer-tag-review-route"));
      return result;
    };
    history.replaceState = function (...args) {
      const result = replaceState.apply(this, args);
      window.dispatchEvent(new Event("performer-tag-review-route"));
      return result;
    };
    window.addEventListener("popstate", () => window.dispatchEvent(new Event("performer-tag-review-route")));
  }

  function initObserver() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(() => {
      const performerId = getPerformerIdFromPath();
      if (performerId && !document.getElementById(HOST_ID)) scheduleRender();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    if (typeof window[CLEANUP_KEY] === "function") {
      window[CLEANUP_KEY]();
    }

    restoreLayoutFromCompactAttempt();
    migrateLayoutToNarrowBase();
    state.panel.queue.autoOpen = readStoredBoolean(QUEUE_AUTO_OPEN_STORAGE_KEY, false);
    state.reviewStates = readStoredObject(REVIEW_STATE_STORAGE_KEY, {});
    state.excludedTagIds = readStoredStringSet(EXCLUDED_TAGS_STORAGE_KEY);
    state.panel.scale = readStoredNumber(PANEL_SCALE_STORAGE_KEY, 1, 0.7, 1.25);
    hookHistory();
    window.addEventListener("performer-tag-review-route", handleRouteChange);
    initObserver();
    window[CLEANUP_KEY] = () => {
      window.removeEventListener("performer-tag-review-route", handleRouteChange);
      window.removeEventListener("pointermove", onWindowDrag);
      window.removeEventListener("pointermove", onWindowResize);
      state.dragState = null;
      state.resizeState = null;
      state.observer?.disconnect();
      state.observer = null;
      document.getElementById(HOST_ID)?.remove();
      document.getElementById(WINDOW_ID)?.remove();
    };
    state.lastPath = "";
    handleRouteChange();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
