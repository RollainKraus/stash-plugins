(function () {
  "use strict";

  const PLUGIN_ID = "CleanUpQueue";
  const PANEL_ID = "cleanup-queue-panel";
  const BUTTON_CLASS = "cleanup-queue-nav-button";
  const BUTTON_ITEM_CLASS = "cleanup-queue-nav-item";
  const FALLBACK_BUTTON_CLASS = "cleanup-queue-fallback-button";
  const ROUTE_EVENT = "cleanup-queue:navigation";

  const DEFAULTS = {
    contentPageSize: 100,
    contentLoadLimit: 1000,
    saveNextShortcut: "Ctrl+Enter",
    skipShortcut: "ArrowRight",
  };

  const CONTENT_TYPES = [
    { value: "scenes", label: "Scenes" },
    { value: "images", label: "Images" },
    { value: "performers", label: "Performers" },
    { value: "studios", label: "Studios" },
  ];

  const MISSING_FIELD_OPTIONS = {
    scenes: [
      { value: "image", label: "Cover image is missing", predicate: (scene) => !scene.screenshot || scene.screenshot.includes("default=true"), focus: "image" },
      { value: "scraper-id", label: "Scraper ID is missing", predicate: (scene) => !hasAnyScraperId(scene), focus: "" },
      { value: "studio", label: "Studio is missing", predicate: (scene) => !scene.studio?.id, focus: "studio" },
      { value: "performers", label: "Performers are missing", predicate: (scene) => !(scene.performers || []).length, focus: "performer" },
      { value: "tags", label: "Tags are missing", predicate: (scene) => !(scene.tags || []).length, focus: "tag" },
      { value: "date", label: "Date is missing", predicate: (scene) => !scene.date, focus: "date" },
      { value: "rating", label: "Rating is missing", predicate: (scene) => !scene.rating100, focus: "rating" },
      { value: "details", label: "Details are missing", predicate: (scene) => !scene.details, focus: "details" },
      { value: "urls", label: "URLs are missing", predicate: (scene) => !(scene.urls || []).length, focus: "urls" },
    ],
    images: [
      { value: "studio", label: "Studio is missing", predicate: (image) => !image.studio?.id, focus: "studio" },
      { value: "performers", label: "Performers are missing", predicate: (image) => !(image.performers || []).length, focus: "performer" },
      { value: "tags", label: "Tags are missing", predicate: (image) => !(image.tags || []).length, focus: "tag" },
      { value: "date", label: "Date is missing", predicate: (image) => !image.date, focus: "date" },
      { value: "rating", label: "Rating is missing", predicate: (image) => !image.rating100, focus: "rating" },
      { value: "details", label: "Details are missing", predicate: (image) => !image.details, focus: "details" },
      { value: "urls", label: "URLs are missing", predicate: (image) => !(image.urls || []).length, focus: "urls" },
    ],
    performers: [
      { value: "image", label: "Image is missing", predicate: (performer) => !performer.imagePath || performer.imagePath.includes("default=true"), focus: "image" },
      { value: "scraper-id", label: "Scraper ID is missing", predicate: (performer) => !hasAnyScraperId(performer), focus: "" },
      { value: "country", label: "Country is missing", predicate: (performer) => !performer.country, focus: "country" },
      { value: "birthdate", label: "Birthdate is missing", predicate: (performer) => !performer.birthdate, focus: "birthdate" },
      { value: "rating", label: "Rating is missing", predicate: (performer) => !performer.rating100, focus: "rating" },
      { value: "details", label: "Details are missing", predicate: (performer) => !performer.details, focus: "details" },
      { value: "tags", label: "Tags are missing", predicate: (performer) => !(performer.tags || []).length, focus: "tag" },
      { value: "urls", label: "URLs are missing", predicate: (performer) => !(performer.urls || []).length, focus: "urls" },
      { value: "no-scenes", label: "No scenes", predicate: (performer) => !Number(performer.sceneCount || 0), focus: "" },
    ],
    studios: [
      { value: "image", label: "Image is missing", predicate: (studio) => !studio.imagePath || studio.imagePath.includes("default=true"), focus: "image" },
      { value: "scraper-id", label: "Scraper ID is missing", predicate: (studio) => !hasAnyScraperId(studio), focus: "" },
      { value: "url", label: "URL is missing", predicate: (studio) => !(studio.urls || []).length, focus: "urls" },
      { value: "rating", label: "Rating is missing", predicate: (studio) => !studio.rating100, focus: "rating" },
      { value: "details", label: "Details are missing", predicate: (studio) => !studio.details, focus: "details" },
      { value: "tags", label: "Tags are missing", predicate: (studio) => !(studio.tags || []).length, focus: "tag" },
      { value: "no-scenes", label: "No scenes", predicate: (studio) => !Number(studio.sceneCount || 0), focus: "" },
    ],
  };

  const state = {
    config: { ...DEFAULTS },
    queue: [],
    contentType: "scenes",
    missingField: "studio",
    scopeFilters: {
      studios: [],
      performers: [],
      tags: [],
    },
    currentIndex: 0,
    completedCount: 0,
    completedIds: new Set(),
    skippedIds: new Set(),
    draft: null,
    draftItemKey: "",
    statusMessage: "",
    statusError: false,
    scrapeSources: [],
    scrapeSourcesLoaded: false,
    selectedScrapeSourceKey: "",
    scraperId: "",
    scrapeLoading: false,
    scrapeResults: [],
    selectedScrapeIndex: -1,
    scrapeError: "",
    matchingTags: false,
    searchTokens: {
      studio: 0,
      performer: 0,
      tag: 0,
      scope: {
        studios: 0,
        performers: 0,
        tags: 0,
      },
    },
    studioSearchTimer: 0,
    performerSearchTimer: 0,
    tagSearchTimer: 0,
    scopeSearchTimers: {
      studios: 0,
      performers: 0,
      tags: 0,
    },
    focusTarget: "",
    loading: false,
    queueLoadToken: 0,
    saving: false,
    navButton: null,
    fallbackButton: null,
    observer: null,
    routeTimer: 0,
    fallbackTimer: 0,
  };

  function gql(query, variables = {}) {
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, variables }),
    })
      .then(async (res) => {
        const text = await res.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_err) {
          json = null;
        }
        if (!res.ok) {
          const message = json?.errors?.length
            ? json.errors.map((err) => err.message).join("; ")
            : text || `GraphQL HTTP ${res.status}`;
          throw new Error(message);
        }
        return json;
      })
      .then((json) => {
        if (json.errors?.length) {
          throw new Error(json.errors.map((err) => err.message).join("; "));
        }
        return json.data;
      });
  }

  function getConfigNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  function getConfigString(value, fallback) {
    const text = String(value || "").trim();
    return text || fallback;
  }

  async function loadConfig() {
    try {
      const data = await gql(`
        query CleanUpQueueConfig {
          configuration {
            plugins
          }
        }
      `);
      const raw = data?.configuration?.plugins?.[PLUGIN_ID] || {};
      state.config = {
        contentPageSize: getConfigNumber(raw.contentPageSize, DEFAULTS.contentPageSize, 25, 500),
        contentLoadLimit: getConfigNumber(raw.contentLoadLimit, DEFAULTS.contentLoadLimit, 25, 10000),
        saveNextShortcut: getConfigString(raw.saveNextShortcut, DEFAULTS.saveNextShortcut),
        skipShortcut: getConfigString(raw.skipShortcut, DEFAULTS.skipShortcut),
      };
    } catch (err) {
      console.warn("[CleanUpQueue] Config load failed", err);
      state.config = { ...DEFAULTS };
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeShortcutKey(value) {
    const key = String(value || "").trim();
    if (!key) return "";
    const lower = key.toLowerCase();
    const named = {
      esc: "escape",
      escape: "escape",
      enter: "enter",
      return: "enter",
      space: " ",
      spacebar: " ",
      tab: "tab",
      backspace: "backspace",
      delete: "delete",
      del: "delete",
      up: "arrowup",
      down: "arrowdown",
      left: "arrowleft",
      right: "arrowright",
    };
    return named[lower] || lower;
  }

  function parseShortcut(value) {
    const parts = String(value || "")
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    const shortcut = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: "",
      label: "",
    };
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === "ctrl" || lower === "control") shortcut.ctrl = true;
      else if (lower === "shift") shortcut.shift = true;
      else if (lower === "alt" || lower === "option") shortcut.alt = true;
      else if (lower === "meta" || lower === "cmd" || lower === "command" || lower === "win") shortcut.meta = true;
      else shortcut.key = normalizeShortcutKey(part);
    }
    shortcut.label = formatShortcutLabel(shortcut);
    return shortcut.key ? shortcut : null;
  }

  function formatShortcutKeyLabel(key) {
    if (key === " ") return "Space";
    if (key.startsWith("arrow")) {
      const direction = key.replace("arrow", "");
      return `Arrow ${direction.charAt(0).toUpperCase()}${direction.slice(1)}`;
    }
    return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  }

  function formatShortcutLabel(shortcut) {
    if (!shortcut?.key) return "";
    return [
      shortcut.ctrl ? "Ctrl" : "",
      shortcut.shift ? "Shift" : "",
      shortcut.alt ? "Alt" : "",
      shortcut.meta ? "Meta" : "",
      formatShortcutKeyLabel(shortcut.key),
    ]
      .filter(Boolean)
      .join("+");
  }

  function renderShortcutKbd(value) {
    const parsed = parseShortcut(value);
    if (!parsed?.label) return `<kbd>Unset</kbd>`;
    return parsed.label
      .split("+")
      .map((part) => `<kbd>${escapeHtml(part)}</kbd>`)
      .join("+");
  }

  function shortcutMatchesEvent(shortcutText, event) {
    const shortcut = parseShortcut(shortcutText);
    if (!shortcut) return false;
    return (
      !!event.ctrlKey === shortcut.ctrl &&
      !!event.shiftKey === shortcut.shift &&
      !!event.altKey === shortcut.alt &&
      !!event.metaKey === shortcut.meta &&
      normalizeShortcutKey(event.key) === shortcut.key
    );
  }

  function normalizeScene(scene) {
    const filePath = String(scene?.files?.[0]?.path || "").trim();
    return {
      type: "scenes",
      id: String(scene?.id || "").trim(),
      title: String(scene?.title || "Untitled scene").trim(),
      code: String(scene?.code || "").trim(),
      date: String(scene?.date || "").trim(),
      details: String(scene?.details || "").trim(),
      director: String(scene?.director || "").trim(),
      rating100: Number.isFinite(Number(scene?.rating100)) ? Number(scene.rating100) : null,
      organized: scene?.organized === true,
      oCounter: Number.isFinite(Number(scene?.o_counter)) ? Math.max(0, Math.round(Number(scene.o_counter))) : 0,
      urls: Array.isArray(scene?.urls) ? scene.urls.map((url) => String(url || "").trim()).filter(Boolean) : [],
      stashIds: normalizeStashIds(scene?.stash_ids),
      screenshot: String(scene?.paths?.screenshot || "").trim(),
      preview: String(scene?.paths?.preview || "").trim(),
      filePath,
      performers: (scene?.performers || [])
        .map((performer) => ({
          id: String(performer?.id || "").trim(),
          name: String(performer?.name || "").trim(),
          imagePath: String(performer?.image_path || "").trim(),
        }))
        .filter((performer) => performer.id && performer.name),
      tags: (scene?.tags || [])
        .map((tag) => ({
          id: String(tag?.id || "").trim(),
          name: String(tag?.name || "").trim(),
          imagePath: String(tag?.image_path || "").trim(),
        }))
        .filter((tag) => tag.id && tag.name),
      studio: scene?.studio?.id
        ? { id: String(scene.studio.id), name: String(scene.studio.name || "Studio") }
        : null,
    };
  }

  function normalizeImage(image) {
    const filePath = String(image?.files?.[0]?.path || "").trim();
    const title = String(image?.title || image?.code || filePath.split(/[\\/]/).pop() || "Untitled image").trim();
    return {
      type: "images",
      id: String(image?.id || "").trim(),
      title,
      code: String(image?.code || "").trim(),
      date: String(image?.date || "").trim(),
      details: String(image?.details || "").trim(),
      director: "",
      rating100: Number.isFinite(Number(image?.rating100)) ? Number(image.rating100) : null,
      organized: image?.organized === true,
      oCounter: Number.isFinite(Number(image?.o_counter)) ? Math.max(0, Math.round(Number(image.o_counter))) : 0,
      urls: Array.isArray(image?.urls) ? image.urls.map((url) => String(url || "").trim()).filter(Boolean) : [],
      screenshot: String(image?.paths?.image || image?.paths?.preview || image?.paths?.thumbnail || "").trim(),
      preview: "",
      filePath,
      performers: (image?.performers || [])
        .map((performer) => ({
          id: String(performer?.id || "").trim(),
          name: String(performer?.name || "").trim(),
          imagePath: String(performer?.image_path || "").trim(),
        }))
        .filter((performer) => performer.id && performer.name),
      tags: (image?.tags || [])
        .map((tag) => ({
          id: String(tag?.id || "").trim(),
          name: String(tag?.name || "").trim(),
          imagePath: String(tag?.image_path || "").trim(),
        }))
        .filter((tag) => tag.id && tag.name),
      studio: image?.studio?.id
        ? { id: String(image.studio.id), name: String(image.studio.name || "Studio") }
        : null,
    };
  }

  function normalizeQueuePerformer(performer) {
    return {
      type: "performers",
      id: String(performer?.id || "").trim(),
      title: String(performer?.name || "Unnamed performer").trim(),
      name: String(performer?.name || "Unnamed performer").trim(),
      disambiguation: String(performer?.disambiguation || "").trim(),
      details: String(performer?.details || "").trim(),
      country: String(performer?.country || "").trim(),
      birthdate: String(performer?.birthdate || "").trim(),
      rating100: Number.isFinite(Number(performer?.rating100)) ? Number(performer.rating100) : null,
      imagePath: String(performer?.image_path || "").trim(),
      sceneCount: Number(performer?.scene_count || 0),
      imageCount: Number(performer?.image_count || 0),
      galleryCount: Number(performer?.gallery_count || 0),
      urls: Array.isArray(performer?.urls) ? performer.urls.map((url) => String(url || "").trim()).filter(Boolean) : [],
      stashIds: normalizeStashIds(performer?.stash_ids),
      tags: (performer?.tags || [])
        .map((tag) => ({ id: String(tag?.id || "").trim(), name: String(tag?.name || "").trim(), imagePath: String(tag?.image_path || "").trim() }))
        .filter((tag) => tag.id && tag.name),
    };
  }

  function normalizeQueueStudio(studio) {
    return {
      type: "studios",
      id: String(studio?.id || "").trim(),
      title: String(studio?.name || "Unnamed studio").trim(),
      name: String(studio?.name || "Unnamed studio").trim(),
      details: String(studio?.details || "").trim(),
      rating100: Number.isFinite(Number(studio?.rating100)) ? Number(studio.rating100) : null,
      imagePath: String(studio?.image_path || "").trim(),
      sceneCount: Number(studio?.scene_count || 0),
      imageCount: Number(studio?.image_count || 0),
      galleryCount: Number(studio?.gallery_count || 0),
      urls: Array.isArray(studio?.urls) ? studio.urls.map((url) => String(url || "").trim()).filter(Boolean) : [],
      stashIds: normalizeStashIds(studio?.stash_ids),
      tags: (studio?.tags || [])
        .map((tag) => ({ id: String(tag?.id || "").trim(), name: String(tag?.name || "").trim(), imagePath: String(tag?.image_path || "").trim() }))
        .filter((tag) => tag.id && tag.name),
      parentStudio: studio?.parent_studio?.id
        ? { id: String(studio.parent_studio.id), name: String(studio.parent_studio.name || "Parent studio") }
        : null,
    };
  }

  function normalizeSearchEntity(entity) {
    const id = String(entity?.id || "").trim();
    const name = String(entity?.name || "").trim();
    if (!id || !name) return null;
    return {
      id,
      name,
      sortName: String(entity?.sort_name || "").trim(),
      aliases: normalizeAliasList(entity?.aliases),
      imagePath: String(entity?.image_path || "").trim(),
    };
  }

  function normalizeStashIds(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => ({
        endpoint: String(item?.endpoint || "").trim(),
        stashId: String(item?.stash_id || "").trim(),
      }))
      .filter((item) => item.endpoint || item.stashId);
  }

  function normalizeScraperEndpoint(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
  }

  function hasAnyScraperId(item) {
    return (item?.stashIds || []).some((stashId) => stashId.stashId);
  }

  function endpointsMatch(candidate, required) {
    const candidateEndpoint = normalizeScraperEndpoint(candidate);
    const requiredEndpoint = normalizeScraperEndpoint(required);
    if (!candidateEndpoint || !requiredEndpoint) return false;
    return candidateEndpoint === requiredEndpoint || candidateEndpoint.includes(requiredEndpoint) || requiredEndpoint.includes(candidateEndpoint);
  }

  function hasScraperIdForEndpoint(item, requiredEndpoint) {
    return (item?.stashIds || []).some((stashId) => stashId.stashId && endpointsMatch(stashId.endpoint, requiredEndpoint));
  }

  function getScraperIdMissingOptions() {
    return (state.scrapeSources || []).map((source) => ({
      value: `scraper-id:${source.key}`,
      label: `${source.label} scraper ID is missing`,
      predicate: (item) => !hasScraperIdForEndpoint(item, source.endpoint),
      focus: "",
    }));
  }

  function normalizeAliasList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeMatchText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function dedupeEntities(items) {
    const seen = new Set();
    return (items || []).filter((item) => {
      const key = String(item?.id || item?.remoteSiteId || item?.name || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeEntityLists(existing, incoming) {
    return dedupeEntities([
      ...(existing || []).map((item) => ({ ...item })),
      ...(incoming || []).map((item) => ({ ...item })),
    ]);
  }

  function normalizeStashIdForInput(value) {
    const endpoint = String(value?.endpoint || "").trim();
    const stashId = String(value?.stash_id || value?.stashId || "").trim();
    return endpoint && stashId ? { endpoint, stash_id: stashId } : null;
  }

  function mergeStashIdsForInput(existing, incoming) {
    const seen = new Set();
    return [...(existing || []), ...(incoming || [])]
      .map(normalizeStashIdForInput)
      .filter(Boolean)
      .filter((stashId) => {
        const key = `${stashId.endpoint}\n${stashId.stash_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function addScrapedStashIdPatch(patch, item, remoteSiteId, endpoint) {
    const stashId = String(remoteSiteId || "").trim();
    const sourceEndpoint = String(endpoint || "").trim();
    if (!stashId || !sourceEndpoint) return;
    patch.stash_ids = mergeStashIdsForInput(item?.stashIds, [{ endpoint: sourceEndpoint, stash_id: stashId }]);
  }

  function isWorkflowBusy() {
    return state.loading || state.saving || state.scrapeLoading || state.matchingTags;
  }

  function cloneDraftForSave(draft) {
    return draft ? JSON.parse(JSON.stringify(draft)) : null;
  }

  function invalidateSearches() {
    state.searchTokens.studio += 1;
    state.searchTokens.performer += 1;
    state.searchTokens.tag += 1;
    Object.keys(state.searchTokens.scope || {}).forEach((kind) => {
      state.searchTokens.scope[kind] += 1;
    });
  }

  function getMissingFieldOptions(contentType = state.contentType) {
    const options = MISSING_FIELD_OPTIONS[contentType] || MISSING_FIELD_OPTIONS.scenes;
    if (contentType === "images") return options;
    const scraperOptions = getScraperIdMissingOptions();
    if (!scraperOptions.length) return options;
    return options.flatMap((option) => (option.value === "scraper-id" ? [option, ...scraperOptions] : [option]));
  }

  function getActiveMissingFieldOption() {
    const options = getMissingFieldOptions();
    return options.find((option) => option.value === state.missingField) || options[0];
  }

  function getQueueTitle() {
    const content = CONTENT_TYPES.find((item) => item.value === state.contentType)?.label || "Scenes";
    const missing = getActiveMissingFieldOption()?.label || "Studio is missing";
    return `${content}: ${missing}`;
  }

  function clearQueueForSelectionChange() {
    invalidateSearches();
    state.queueLoadToken += 1;
    state.loading = false;
    state.queue = [];
    state.currentIndex = 0;
    state.completedCount = 0;
    state.completedIds = new Set();
    state.skippedIds = new Set();
    state.draft = null;
    state.draftItemKey = "";
    state.scrapeResults = [];
    state.selectedScrapeIndex = -1;
    state.scrapeError = "";
    state.focusTarget = "";
    setStatus("Queue settings changed. Load queue to refresh.");
  }

  function getScopeCount() {
    return (
      (state.scopeFilters.studios || []).length +
      (state.scopeFilters.performers || []).length +
      (state.scopeFilters.tags || []).length
    );
  }

  function sceneMatchesScopeFilters(scene) {
    const studioFilters = splitScopeFilters("studios");
    const performerFilters = splitScopeFilters("performers");
    const tagFilters = splitScopeFilters("tags");
    const sceneStudioId = String(scene?.studio?.id || "");
    const scenePerformerIds = new Set((scene?.performers || []).map((performer) => String(performer.id)));
    const sceneTagIds = new Set((scene?.tags || []).map((tag) => String(tag.id)));

    if (studioFilters.include.size && !studioFilters.include.has(sceneStudioId)) return false;
    if (studioFilters.exclude.size && sceneStudioId && studioFilters.exclude.has(sceneStudioId)) return false;
    if (performerFilters.include.size && ![...performerFilters.include].some((id) => scenePerformerIds.has(id))) return false;
    if (performerFilters.exclude.size && [...performerFilters.exclude].some((id) => scenePerformerIds.has(id))) return false;
    if (tagFilters.include.size && ![...tagFilters.include].some((id) => sceneTagIds.has(id))) return false;
    if (tagFilters.exclude.size && [...tagFilters.exclude].some((id) => sceneTagIds.has(id))) return false;
    return true;
  }

  function splitScopeFilters(kind) {
    const filters = { include: new Set(), exclude: new Set() };
    (state.scopeFilters[kind] || []).forEach((item) => {
      const id = String(item?.id || "");
      if (!id) return;
      filters[item.mode === "exclude" ? "exclude" : "include"].add(id);
    });
    return filters;
  }

  function getScopeIds(kind, mode) {
    return (state.scopeFilters[kind] || [])
      .filter((item) => (item.mode === "exclude" ? "exclude" : "include") === mode)
      .map((item) => String(item.id))
      .filter(Boolean);
  }

  function buildSceneScopeFilter() {
    const filter = {};
    addScopeRelationFilter(filter, "studios", "studios");
    addScopeRelationFilter(filter, "performers", "performers");
    addScopeRelationFilter(filter, "tags", "tags");

    return Object.keys(filter).length ? filter : null;
  }

  function buildImageScopeFilter() {
    const filter = {};
    addScopeRelationFilter(filter, "studios", "studios");
    addScopeRelationFilter(filter, "performers", "performers");
    addScopeRelationFilter(filter, "tags", "tags");

    return Object.keys(filter).length ? filter : null;
  }

  function itemMatchesScopeFilters(item) {
    if (item?.type === "images") return sceneMatchesScopeFilters(item);
    if (item?.type !== "scenes") return true;
    return sceneMatchesScopeFilters(item);
  }

  function addScopeRelationFilter(filter, field, kind) {
    const includeIds = getScopeIds(kind, "include");
    const excludeIds = getScopeIds(kind, "exclude");
    if (includeIds.length) {
      filter[field] = { value: includeIds, modifier: "INCLUDES" };
    } else if (excludeIds.length) {
      filter[field] = { value: excludeIds, modifier: "EXCLUDES" };
    }
  }

  function addScopeFilter(kind, item, mode = "include") {
    if (!state.scopeFilters[kind] || !item?.id) return;
    const normalized = {
      ...item,
      mode: mode === "exclude" ? "exclude" : "include",
    };
    state.scopeFilters[kind] = dedupeEntities([
      ...state.scopeFilters[kind].filter((existing) => String(existing.id) !== String(item.id)),
      normalized,
    ]);
    clearQueueForSelectionChange();
    renderPanel();
  }

  function toggleScopeFilterMode(kind, id) {
    if (!state.scopeFilters[kind]) return;
    state.scopeFilters[kind] = state.scopeFilters[kind].map((item) =>
      String(item.id) === String(id)
        ? { ...item, mode: item.mode === "exclude" ? "include" : "exclude" }
        : item
    );
    clearQueueForSelectionChange();
    renderPanel();
  }

  function removeScopeFilter(kind, id) {
    if (!state.scopeFilters[kind]) return;
    state.scopeFilters[kind] = state.scopeFilters[kind].filter((item) => String(item.id) !== String(id));
    clearQueueForSelectionChange();
    renderPanel();
  }

  function clearScopeFilters() {
    state.scopeFilters = { studios: [], performers: [], tags: [] };
    clearQueueForSelectionChange();
    renderPanel();
  }

  function createDraftFromContent(item) {
    return {
      title: item?.title || item?.name || "",
      name: item?.name || item?.title || "",
      disambiguation: item?.disambiguation || "",
      country: item?.country || "",
      birthdate: item?.birthdate || "",
      imageUrl: "",
      imageFileData: "",
      imageFileName: "",
      code: item?.code || "",
      date: item?.date || "",
      details: item?.details || "",
      director: item?.director || "",
      rating: item?.rating100 ? String(Number(item.rating100) / 10) : "",
      organized: !!item?.organized,
      oCounter: Number.isFinite(Number(item?.oCounter)) ? String(item.oCounter) : "0",
      urlsText: (item?.urls || []).join("\n"),
      studio: item?.studio ? { ...item.studio } : null,
      performers: dedupeEntities((item?.performers || []).map((performer) => ({ ...performer }))),
      tags: dedupeEntities((item?.tags || []).map((tag) => ({ ...tag }))),
      missingTags: [],
      remoteSiteId: "",
      scrapeEndpoint: "",
    };
  }

  function parseRatingInput(value) {
    const rating = String(value || "").trim();
    const parsedRating = Number(rating);
    if (rating === "" || !Number.isFinite(parsedRating)) return null;
    return Math.max(0, Math.min(100, Math.round(parsedRating * 10)));
  }

  function parseUrlsInput(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
  }

  function getDraftImageValue(draft) {
    return String(draft?.imageFileData || draft?.imageUrl || "").trim();
  }

  function clearDraftImageFile(draft) {
    if (!draft) return;
    draft.imageFileData = "";
    draft.imageFileName = "";
  }

  function clearDraftImage(draft) {
    if (!draft) return;
    draft.imageUrl = "";
    clearDraftImageFile(draft);
  }

  function ensureDraftForContent(item) {
    if (!item?.id) return null;
    const key = `${item.type || state.contentType}:${item.id}`;
    if (state.draftItemKey !== key || !state.draft) {
      state.draftItemKey = key;
      state.draft = createDraftFromContent(item);
    }
    return state.draft;
  }

  function normalizeStudio(studio) {
    const id = String(studio?.id || "").trim();
    const name = String(studio?.name || "").trim();
    if (!id || !name) return null;
    return {
      id,
      name,
      imagePath: String(studio?.image_path || "").trim(),
    };
  }

  function normalizeScrapeSource(source, index) {
    const endpoint = String(source?.endpoint || "").trim();
    if (!endpoint) return null;
    const label = String(source?.name || source?.endpoint || `Stash-box ${index + 1}`).trim();
    return {
      key: `stashbox:${normalizeScraperEndpoint(endpoint) || index}`,
      label,
      endpoint,
      source: { stash_box_endpoint: endpoint },
    };
  }

  function normalizeScrapedScene(scene) {
    const urls = Array.isArray(scene?.urls) ? scene.urls : [];
    return {
      type: "scenes",
      title: String(scene?.title || "").trim(),
      date: String(scene?.date || "").trim(),
      details: String(scene?.details || "").trim(),
      remoteSiteId: String(scene?.remote_site_id || "").trim(),
      url: String(scene?.url || urls[0] || "").trim(),
      urls: urls.map((url) => String(url || "").trim()).filter(Boolean),
      image: String(scene?.image || "").trim(),
      studio: normalizeScrapedEntity(scene?.studio),
      performers: (scene?.performers || []).map(normalizeScrapedEntity).filter(Boolean),
      tags: (scene?.tags || []).map(normalizeScrapedEntity).filter(Boolean),
      hasScrapedTags: Array.isArray(scene?.tags),
    };
  }

  function normalizeScrapedPerformer(performer) {
    const urls = [
      performer?.url,
      performer?.twitter,
      performer?.instagram,
      ...(Array.isArray(performer?.urls) ? performer.urls : []),
    ]
      .map((url) => String(url || "").trim())
      .filter(Boolean);
    const images = Array.isArray(performer?.images) ? performer.images : [];
    return {
      type: "performers",
      title: String(performer?.name || "Performer match").trim(),
      name: String(performer?.name || "").trim(),
      disambiguation: String(performer?.disambiguation || "").trim(),
      birthdate: String(performer?.birthdate || "").trim(),
      country: String(performer?.country || "").trim(),
      details: String(performer?.details || "").trim(),
      url: urls[0] || "",
      urls,
      image: String(performer?.image || images[0] || "").trim(),
      remoteSiteId: String(performer?.remote_site_id || "").trim(),
      tags: (performer?.tags || []).map(normalizeScrapedEntity).filter(Boolean),
      hasScrapedTags: Array.isArray(performer?.tags),
    };
  }

  function normalizeScrapedStudio(studio) {
    return {
      type: "studios",
      title: String(studio?.name || "Studio match").trim(),
      name: String(studio?.name || "").trim(),
      details: String(studio?.details || "").trim(),
      url: String(studio?.url || "").trim(),
      urls: [String(studio?.url || "").trim()].filter(Boolean),
      image: String(studio?.image || "").trim(),
      remoteSiteId: String(studio?.remote_site_id || "").trim(),
      parentStudio: normalizeScrapedEntity(studio?.parent),
      tags: (studio?.tags || []).map(normalizeScrapedEntity).filter(Boolean),
      hasScrapedTags: Array.isArray(studio?.tags),
    };
  }

  function normalizeScrapedEntity(entity) {
    const name = String(entity?.name || "").trim();
    if (!name) return null;
    return {
      name,
      remoteSiteId: String(entity?.remote_site_id || "").trim(),
      aliases: normalizeAliasList(entity?.aliases),
    };
  }

  async function fetchScenePage(page, perPage) {
    const sceneFilter = buildSceneScopeFilter();
    const data = await gql(
      `
        query CleanUpQueueScenes($page: Int!, $perPage: Int!, $sceneFilter: SceneFilterType) {
          findScenes(scene_filter: $sceneFilter, filter: { page: $page, per_page: $perPage, sort: "updated_at", direction: DESC }) {
            count
            scenes {
              id
              title
              code
              date
              details
              director
              rating100
              organized
              o_counter
              urls
              stash_ids { endpoint stash_id }
              studio { id name }
              performers { id name image_path }
              tags { id name image_path }
              paths { screenshot preview }
              files { path }
            }
          }
        }
      `,
      { page, perPage, sceneFilter }
    );

    return {
      count: Number(data?.findScenes?.count || 0),
      scenes: (data?.findScenes?.scenes || []).map(normalizeScene).filter((scene) => scene.id),
    };
  }

  async function fetchImagePage(page, perPage) {
    const imageFilter = buildImageScopeFilter();
    const data = await gql(
      `
        query CleanUpQueueImages($page: Int!, $perPage: Int!, $imageFilter: ImageFilterType) {
          findImages(image_filter: $imageFilter, filter: { page: $page, per_page: $perPage, sort: "updated_at", direction: DESC }) {
            count
            images {
              id
              title
              code
              date
              details
              rating100
              organized
              o_counter
              urls
              studio { id name }
              performers { id name image_path }
              tags { id name image_path }
              paths { thumbnail preview image }
              files { path }
            }
          }
        }
      `,
      { page, perPage, imageFilter }
    );

    return {
      count: Number(data?.findImages?.count || 0),
      items: (data?.findImages?.images || []).map(normalizeImage).filter((image) => image.id),
    };
  }

  async function fetchPerformerPage(page, perPage) {
    const data = await gql(
      `
        query CleanUpQueuePerformers($page: Int!, $perPage: Int!) {
          findPerformers(filter: { page: $page, per_page: $perPage, sort: "name", direction: ASC }) {
            count
            performers {
              id
              name
              disambiguation
              details
              urls
              stash_ids { endpoint stash_id }
              birthdate
              country
              rating100
              image_path
              scene_count
              image_count
              gallery_count
              tags { id name image_path }
            }
          }
        }
      `,
      { page, perPage }
    );

    return {
      count: Number(data?.findPerformers?.count || 0),
      items: (data?.findPerformers?.performers || []).map(normalizeQueuePerformer).filter((performer) => performer.id),
    };
  }

  async function fetchStudioPage(page, perPage) {
    const data = await gql(
      `
        query CleanUpQueueStudiosQueue($page: Int!, $perPage: Int!) {
          findStudios(filter: { page: $page, per_page: $perPage, sort: "name", direction: ASC }) {
            count
            studios {
              id
              name
              details
              urls
              stash_ids { endpoint stash_id }
              rating100
              image_path
              scene_count
              image_count
              gallery_count
              parent_studio { id name }
              tags { id name image_path }
            }
          }
        }
      `,
      { page, perPage }
    );

    return {
      count: Number(data?.findStudios?.count || 0),
      items: (data?.findStudios?.studios || []).map(normalizeQueueStudio).filter((studio) => studio.id),
    };
  }

  async function fetchContentPage(contentType, page, perPage) {
    if (contentType === "images") return fetchImagePage(page, perPage);
    if (contentType === "performers") return fetchPerformerPage(page, perPage);
    if (contentType === "studios") return fetchStudioPage(page, perPage);
    const result = await fetchScenePage(page, perPage);
    return { count: result.count, items: result.scenes };
  }

  async function loadQueue() {
    if (state.saving || state.scrapeLoading || state.matchingTags) {
      setStatus("Finish the current operation before loading a new queue.", true);
      renderPanel();
      return;
    }
    const missingOption = getActiveMissingFieldOption();
    const contentType = state.contentType;
    const contentLabel = CONTENT_TYPES.find((item) => item.value === contentType)?.label || "Scenes";
    const itemLabel = contentLabel.toLowerCase().replace(/s$/, "");
    const loadToken = state.queueLoadToken + 1;
    state.queueLoadToken = loadToken;
    invalidateSearches();
    state.loading = true;
    state.queue = [];
    state.currentIndex = 0;
    state.completedCount = 0;
    state.completedIds = new Set();
    state.skippedIds = new Set();
    state.draft = null;
    state.draftItemKey = "";
    renderPanel();

    const perPage = state.config.contentPageSize;
    const limit = state.config.contentLoadLimit;
    const missing = [];
    let loaded = 0;
    let total = 0;

    try {
      for (let page = 1; loaded < limit; page += 1) {
        if (loadToken !== state.queueLoadToken) return;
        setStatus(`Loading ${contentLabel.toLowerCase()} ${loaded + 1}-${Math.min(loaded + perPage, limit)}...`);
        const result = await fetchContentPage(contentType, page, Math.min(perPage, limit - loaded));
        if (loadToken !== state.queueLoadToken) return;
        if (!total) total = result.count;
        loaded += result.items.length;
        missing.push(...result.items.filter((item) => missingOption.predicate(item) && itemMatchesScopeFilters(item)));
        if (!result.items.length || loaded >= total || result.items.length < perPage) break;
      }

      state.queue = missing;
      state.currentIndex = 0;
      state.focusTarget = missing.length ? missingOption.focus : "";
      setStatus(
        missing.length
          ? `Loaded ${missing.length} ${itemLabel}${missing.length === 1 ? "" : "s"}: ${missingOption.label.toLowerCase()}.`
          : `No matches found in ${loaded} loaded ${itemLabel}${loaded === 1 ? "" : "s"}.`
      );
    } catch (err) {
      if (loadToken !== state.queueLoadToken) return;
      console.error("[CleanUpQueue] Queue load failed", err);
      setStatus(err.message || "Could not load cleanup queue.", true);
    } finally {
      if (loadToken !== state.queueLoadToken) return;
      state.loading = false;
      renderPanel();
    }
  }

  async function searchStudios(query) {
    const data = await gql(
      `
        query CleanUpQueueStudios($filter: FindFilterType) {
          findStudios(filter: $filter) {
            studios {
              id
              name
              image_path
            }
          }
        }
      `,
      {
        filter: {
          q: query,
          per_page: 20,
          sort: "name",
          direction: "ASC",
        },
      }
    );
    return (data?.findStudios?.studios || []).map(normalizeStudio).filter(Boolean);
  }

  async function searchPerformers(query) {
    const data = await gql(
      `
        query CleanUpQueuePerformers($filter: FindFilterType) {
          findPerformers(filter: $filter) {
            performers {
              id
              name
              image_path
            }
          }
        }
      `,
      {
        filter: {
          q: query,
          per_page: 20,
          sort: "name",
          direction: "ASC",
        },
      }
    );
    return (data?.findPerformers?.performers || []).map(normalizeSearchEntity).filter(Boolean);
  }

  async function searchTags(query) {
    const data = await gql(
      `
        query CleanUpQueueTags($filter: FindFilterType) {
          findTags(filter: $filter) {
            tags {
              id
              name
              sort_name
              aliases
              image_path
            }
          }
        }
      `,
      {
        filter: {
          q: query,
          per_page: 30,
          sort: "name",
          direction: "ASC",
        },
      }
    );
    return (data?.findTags?.tags || []).map(normalizeSearchEntity).filter(Boolean);
  }

  async function loadScrapeSources() {
    try {
      const data = await gql(`
        query CleanUpQueueScrapeSources {
          configuration {
            general {
              stashBoxes {
                endpoint
              }
            }
          }
        }
      `);
      state.scrapeSources = (data?.configuration?.general?.stashBoxes || [])
        .map(normalizeScrapeSource)
        .filter(Boolean);
      state.scrapeSourcesLoaded = true;
      const selectedSourceExists = state.scrapeSources.some((source) => source.key === state.selectedScrapeSourceKey);
      if (!state.selectedScrapeSourceKey && state.scrapeSources.length) {
        state.selectedScrapeSourceKey = state.scrapeSources[0].key;
      } else if (state.selectedScrapeSourceKey !== "scraper" && !selectedSourceExists) {
        state.selectedScrapeSourceKey = state.scrapeSources[0]?.key || "";
      }
      renderPanel();
    } catch (err) {
      console.warn("[CleanUpQueue] Scrape source load failed", err);
      state.scrapeSources = [];
      state.scrapeSourcesLoaded = true;
      state.scrapeError = "Could not load Stash metadata sources.";
      renderPanel();
    }
  }

  function getSelectedScrapeSource() {
    if (state.selectedScrapeSourceKey === "scraper") {
      const id = String(state.scraperId || "").trim();
      return id ? { scraper_id: id } : null;
    }
    return state.scrapeSources.find((source) => source.key === state.selectedScrapeSourceKey)?.source || null;
  }

  function getSelectedScrapeSourceMeta() {
    if (state.selectedScrapeSourceKey === "scraper") {
      return { label: state.scraperId || "Installed scraper", endpoint: "" };
    }
    return state.scrapeSources.find((source) => source.key === state.selectedScrapeSourceKey) || null;
  }

  function getSelectedScrapeEndpoint() {
    return String(getSelectedScrapeSourceMeta()?.endpoint || "").trim();
  }

  function getRemoteMatchUrl(match) {
    if (match.url) return match.url;
    if (!match.remoteSiteId) return "";
    const meta = getSelectedScrapeSourceMeta();
    const endpoint = String(meta?.endpoint || "").trim();
    if (!endpoint) return "";
    try {
      const url = new URL(endpoint, window.location.origin);
      const typePath =
        match.type === "performers"
          ? "performers"
          : match.type === "studios"
            ? "studios"
            : "scenes";
      return `${url.origin}/${typePath}/${encodeURIComponent(match.remoteSiteId)}`;
    } catch (_err) {
      return "";
    }
  }

  function getNativeTaggerUrl(scene) {
    return `/scenes?disp=3&q=${encodeURIComponent(scene?.title || scene?.filePath || "")}`;
  }

  async function scrapeCurrentItemMatches() {
    const item = getCurrentItem();
    if (item?.type === "performers") {
      await scrapePerformerMatches(item);
      return;
    }
    if (item?.type === "studios") {
      await scrapeStudioMatches(item);
      return;
    }
    await scrapeSceneMatches(item);
  }

  async function scrapeSceneMatches(scene = getCurrentItem()) {
    const source = getSelectedScrapeSource();
    if (!scene || !source || state.scrapeLoading) return;

    state.scrapeLoading = true;
    state.scrapeError = "";
    state.scrapeResults = [];
    state.selectedScrapeIndex = -1;
    renderPanel();

    try {
      const data = await scrapeSingleSceneWithFallback(source, { scene_id: String(scene.id) });
      state.scrapeResults = (data?.scrapeSingleScene || []).map(normalizeScrapedScene);
      if (!state.scrapeResults.length) state.scrapeError = "No scrape matches returned.";
    } catch (err) {
      console.warn("[CleanUpQueue] Scene scrape failed", err);
      state.scrapeError = err?.message || "Scrape failed.";
    } finally {
      state.scrapeLoading = false;
      renderPanel();
    }
  }

  async function scrapePerformerMatches(performer) {
    const source = getSelectedScrapeSource();
    if (!performer || !source || state.scrapeLoading) return;

    state.scrapeLoading = true;
    state.scrapeError = "";
    state.scrapeResults = [];
    state.selectedScrapeIndex = -1;
    renderPanel();

    try {
      const data = await scrapeSinglePerformerWithFallback(source, performer);
      state.scrapeResults = (data?.scrapeSinglePerformer || []).map(normalizeScrapedPerformer);
      if (!state.scrapeResults.length) state.scrapeError = "No performer scrape matches returned.";
    } catch (err) {
      console.warn("[CleanUpQueue] Performer scrape failed", err);
      state.scrapeError = err?.message || "Performer scrape failed.";
    } finally {
      state.scrapeLoading = false;
      renderPanel();
    }
  }

  async function scrapeStudioMatches(studio) {
    const source = getSelectedScrapeSource();
    if (!studio || !source || state.scrapeLoading) return;

    state.scrapeLoading = true;
    state.scrapeError = "";
    state.scrapeResults = [];
    state.selectedScrapeIndex = -1;
    renderPanel();

    try {
      const data = await scrapeSingleStudioWithFallback(source, studio);
      state.scrapeResults = (data?.scrapeSingleStudio || []).map(normalizeScrapedStudio);
      if (!state.scrapeResults.length) state.scrapeError = "No studio scrape matches returned.";
    } catch (err) {
      console.warn("[CleanUpQueue] Studio scrape failed", err);
      const message = String(err?.message || "");
      state.scrapeError = message.includes("scrapeSingleStudio") || message.includes("ScrapeSingleStudioInput")
        ? "Studio scraping is not available in this Stash build or selected scraper source."
        : message || "Studio scrape failed.";
    } finally {
      state.scrapeLoading = false;
      renderPanel();
    }
  }

  async function scrapeSingleSceneWithFallback(source, input) {
    const profiles = [
      { media: true, nestedRemoteIds: true, tagAliases: true },
      { media: true, nestedRemoteIds: true, tagAliases: false },
      { media: false, nestedRemoteIds: true, tagAliases: true },
      { media: false, nestedRemoteIds: true, tagAliases: false },
      { media: false, nestedRemoteIds: false, tagAliases: false },
    ];
    let lastError = null;
    for (const profile of profiles) {
      try {
        return await gql(getScrapeSingleSceneQuery(profile), { source, input });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  function getScrapeSingleSceneQuery(profile) {
    const nestedRemoteField = profile.nestedRemoteIds ? "remote_site_id" : "";
    const tagAliasField = profile.tagAliases ? "aliases" : "";
    return `
      query CleanUpQueueScrapeSingleScene($source: ScraperSourceInput!, $input: ScrapeSingleSceneInput!) {
        scrapeSingleScene(source: $source, input: $input) {
          title
          date
          details
          remote_site_id
          ${profile.media ? "image\n          urls" : ""}
          studio { name ${nestedRemoteField} }
          performers { name ${nestedRemoteField} }
          tags { name ${nestedRemoteField} ${tagAliasField} }
        }
      }
    `;
  }

  async function scrapeSinglePerformerWithFallback(source, performer) {
    const inputCandidates = [
      { performer_id: String(performer.id) },
      { query: String(performer.name || performer.title || "").trim() },
    ].filter((input) => Object.values(input).some(Boolean));
    const profiles = [
      { social: true, images: true, tags: true, aliases: true },
      { social: true, images: true, tags: false, aliases: true },
      { social: false, images: true, tags: false, aliases: false },
      { social: false, images: false, tags: false, aliases: false },
    ];
    let lastError = null;
    for (const input of inputCandidates) {
      for (const profile of profiles) {
        try {
          return await gql(getScrapeSinglePerformerQuery(profile), { source, input });
        } catch (err) {
          lastError = err;
        }
      }
    }
    throw lastError;
  }

  function getScrapeSinglePerformerQuery(profile) {
    const tagAliasField = profile.aliases ? "aliases" : "";
    return `
      query CleanUpQueueScrapeSinglePerformer($source: ScraperSourceInput!, $input: ScrapeSinglePerformerInput!) {
        scrapeSinglePerformer(source: $source, input: $input) {
          name
          disambiguation
          birthdate
          country
          details
          url
          remote_site_id
          ${profile.social ? "twitter\n          instagram" : ""}
          ${profile.images ? "images" : ""}
          ${profile.tags ? `tags { name remote_site_id ${tagAliasField} }` : ""}
        }
      }
    `;
  }

  async function scrapeSingleStudioWithFallback(source, studio) {
    const inputCandidates = [
      { studio_id: String(studio.id) },
      { query: String(studio.name || studio.title || "").trim() },
    ].filter((input) => Object.values(input).some(Boolean));
    const profiles = [
      { details: true, parent: true, tags: true, aliases: true },
      { details: true, parent: true, tags: false, aliases: false },
      { details: false, parent: false, tags: false, aliases: false },
    ];
    let lastError = null;
    for (const input of inputCandidates) {
      for (const profile of profiles) {
        try {
          return await gql(getScrapeSingleStudioQuery(profile), { source, input });
        } catch (err) {
          lastError = err;
        }
      }
    }
    throw lastError;
  }

  function getScrapeSingleStudioQuery(profile) {
    const tagAliasField = profile.aliases ? "aliases" : "";
    return `
      query CleanUpQueueScrapeSingleStudio($source: ScraperSourceInput!, $input: ScrapeSingleStudioInput!) {
        scrapeSingleStudio(source: $source, input: $input) {
          name
          url
          image
          remote_site_id
          ${profile.details ? "details" : ""}
          ${profile.parent ? "parent { name remote_site_id }" : ""}
          ${profile.tags ? `tags { name remote_site_id ${tagAliasField} }` : ""}
        }
      }
    `;
  }

  async function updateSceneMetadata(sceneId, patch) {
    const data = await gql(
      `
        mutation CleanUpQueueUpdateSceneMetadata($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      { input: { id: String(sceneId), ...patch } }
    );
    return data?.sceneUpdate?.id || null;
  }

  async function updateImageMetadata(imageId, patch) {
    const data = await gql(
      `
        mutation CleanUpQueueUpdateImageMetadata($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      { input: { id: String(imageId), ...patch } }
    );
    return data?.imageUpdate?.id || null;
  }

  async function updatePerformerMetadata(performerId, patch) {
    const data = await gql(
      `
        mutation CleanUpQueueUpdatePerformerMetadata($input: PerformerUpdateInput!) {
          performerUpdate(input: $input) {
            id
          }
        }
      `,
      { input: { id: String(performerId), ...patch } }
    );
    return data?.performerUpdate?.id || null;
  }

  async function updateStudioMetadata(studioId, patch) {
    const data = await gql(
      `
        mutation CleanUpQueueUpdateStudioMetadata($input: StudioUpdateInput!) {
          studioUpdate(input: $input) {
            id
          }
        }
      `,
      { input: { id: String(studioId), ...patch } }
    );
    return data?.studioUpdate?.id || null;
  }

  async function findEntityByStashId(kind, stashId, endpoint) {
    if (!stashId || !endpoint) return null;
    const definitions = {
      performer: {
        queryName: "findPerformers",
        filterName: "performer_filter",
        selection: "performers",
        fields: "id name",
      },
      studio: {
        queryName: "findStudios",
        filterName: "studio_filter",
        selection: "studios",
        fields: "id name",
      },
      tag: {
        queryName: "findTags",
        filterName: "tag_filter",
        selection: "tags",
        fields: "id name sort_name aliases image_path",
      },
    };
    const def = definitions[kind];
    if (!def) return null;

    try {
      const data = await gql(`
        query CleanUpQueueFindByStashId {
          ${def.queryName}(${def.filterName}: { stash_id_endpoint: { endpoint: ${JSON.stringify(endpoint)}, stash_id: ${JSON.stringify(stashId)}, modifier: EQUALS } }) {
            ${def.selection} { ${def.fields} }
          }
        }
      `);
      return data?.[def.queryName]?.[def.selection]?.[0] || null;
    } catch (err) {
      console.warn("[CleanUpQueue] Scraper ID lookup failed", kind, err);
      return null;
    }
  }

  async function findEntityByName(kind, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    const queryMap = {
      studio: `
        query CleanUpQueueFindStudioByName($filter: FindFilterType) {
          findStudios(filter: $filter) { studios { id name } }
        }
      `,
      performer: `
        query CleanUpQueueFindPerformerByName($filter: FindFilterType) {
          findPerformers(filter: $filter) { performers { id name } }
        }
      `,
      tag: `
        query CleanUpQueueFindTagByName($filter: FindFilterType) {
          findTags(filter: $filter) { tags { id name sort_name aliases image_path } }
        }
      `,
    };
    const selectionMap = {
      studio: ["findStudios", "studios"],
      performer: ["findPerformers", "performers"],
      tag: ["findTags", "tags"],
    };
    const query = queryMap[kind];
    const selection = selectionMap[kind];
    if (!query || !selection) return null;

    const data = await gql(query, {
      filter: { q: trimmed, per_page: 25, sort: "name", direction: "ASC" },
    });
    const items = data?.[selection[0]]?.[selection[1]] || [];
    if (kind !== "tag") {
      return items.find((item) => String(item?.name || "").trim().toLowerCase() === trimmed.toLowerCase()) || null;
    }

    const normalized = normalizeMatchText(trimmed);
    return (
      items.find((item) =>
        [item?.name, item?.sort_name, ...normalizeAliasList(item?.aliases)]
          .map(normalizeMatchText)
          .filter(Boolean)
          .includes(normalized)
      ) || null
    );
  }

  async function createEntity(kind, entity, endpoint) {
    const name = String(entity?.name || "").trim();
    if (!name) return null;
    const stashIds = entity.remoteSiteId && endpoint ? [{ endpoint, stash_id: entity.remoteSiteId }] : [];
    const input = stashIds.length ? { name, stash_ids: stashIds } : { name };
    const mutationMap = {
      studio: ["StudioCreateInput", "studioCreate"],
      performer: ["PerformerCreateInput", "performerCreate"],
      tag: ["TagCreateInput", "tagCreate"],
    };
    const def = mutationMap[kind];
    if (!def) return null;

    const data = await gql(
      `
        mutation CleanUpQueueCreateEntity($input: ${def[0]}!) {
          ${def[1]}(input: $input) {
            id
            name
          }
        }
      `,
      { input }
    );
    return data?.[def[1]] || null;
  }

  async function resolveEntity(kind, entity, endpoint) {
    if (!entity?.name && !entity?.remoteSiteId) return null;
    const byStashId = await findEntityByStashId(kind, entity.remoteSiteId, endpoint);
    if (byStashId) return byStashId;
    const byName = await findEntityByName(kind, entity.name);
    if (byName) return byName;
    return createEntity(kind, entity, endpoint);
  }

  function getScrapedTagSearchTerms(tag) {
    const terms = [tag?.name, ...(tag?.aliases || [])];
    const expanded = [];
    for (const term of terms) {
      const text = String(term || "").trim();
      if (!text) continue;
      expanded.push(text);
      const parts = text
        .split(/\s*(?:>|\/|\\|\||::|:)\s*/g)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 1) expanded.push(parts[parts.length - 1]);
    }
    const seen = new Set();
    return expanded.filter((term) => {
      const key = normalizeMatchText(term);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isTagCandidateMatch(candidate, searchTerms) {
    const candidateTerms = [candidate?.name, candidate?.sort_name, candidate?.sortName, ...normalizeAliasList(candidate?.aliases)]
      .map(normalizeMatchText)
      .filter(Boolean);
    const searchSet = new Set(searchTerms.map(normalizeMatchText).filter(Boolean));
    return candidateTerms.some((term) => searchSet.has(term));
  }

  async function findLocalTagForScrapedTag(tag, endpoint) {
    const byStashId = await findEntityByStashId("tag", tag.remoteSiteId, endpoint);
    if (byStashId?.id) return byStashId;

    const searchTerms = getScrapedTagSearchTerms(tag);
    for (const term of searchTerms) {
      const data = await gql(
        `
          query CleanUpQueueFindTagCandidates($filter: FindFilterType) {
            findTags(filter: $filter) {
              tags {
                id
                name
                sort_name
                aliases
                image_path
              }
            }
          }
        `,
        {
          filter: {
            q: term,
            per_page: 50,
            sort: "name",
            direction: "ASC",
          },
        }
      );
      const candidates = data?.findTags?.tags || [];
      const match = candidates.find((candidate) => isTagCandidateMatch(candidate, searchTerms));
      if (match?.id) return match;
    }
    return null;
  }

  async function matchScrapedTags(scrapedTags, endpoint) {
    const matched = [];
    const missing = [];
    for (const tag of scrapedTags || []) {
      const localTag = await findLocalTagForScrapedTag(tag, endpoint);
      if (localTag?.id) matched.push({ id: String(localTag.id), name: String(localTag.name || tag.name), imagePath: String(localTag.image_path || "") });
      else missing.push({ ...tag });
    }
    return {
      matched: dedupeEntities(matched),
      missing: dedupeEntities(missing),
    };
  }

  function removeMissingTagByName(name) {
    if (!state.draft?.missingTags?.length) return;
    const normalized = String(name || "").trim().toLowerCase();
    state.draft.missingTags = state.draft.missingTags.filter((tag) => {
      const tagName = String(tag.name || "").trim().toLowerCase();
      return tagName !== normalized && !tagName.includes(normalized) && !normalized.includes(tagName);
    });
  }

  async function populateDraftFromScrapedMatch(index) {
    const item = getCurrentItem();
    const match = state.scrapeResults[index];
    const draft = ensureDraftForContent(item);
    if (!item || !match || !draft) return;

    state.selectedScrapeIndex = index;
    state.scrapeError = "";
    if (item.type === "performers" || item.type === "studios") {
      draft.name = match.name || match.title || draft.name || "";
      draft.title = draft.name;
      draft.details = match.details || draft.details || "";
      draft.imageUrl = match.image || draft.imageUrl || "";
      if (match.image) clearDraftImageFile(draft);
      if (item.type === "performers") {
        draft.disambiguation = match.disambiguation || draft.disambiguation || "";
        draft.birthdate = match.birthdate || draft.birthdate || "";
        draft.country = match.country || draft.country || "";
      }
    } else {
      draft.title = match.title || draft.title || "";
      draft.date = match.date || draft.date || "";
      draft.details = match.details || draft.details || "";
      draft.imageUrl = match.image || draft.imageUrl || "";
      if (match.image) clearDraftImageFile(draft);
    }
    const scrapedUrls = (match.urls?.length ? match.urls : match.url ? [match.url] : [])
      .map((url) => String(url || "").trim())
      .filter(Boolean);
    draft.urlsText = Array.from(new Set([...parseUrlsInput(draft.urlsText), ...scrapedUrls])).join("\n");
    if (item.type !== "performers" && item.type !== "studios") {
      draft.studio = match.studio ? { ...match.studio } : draft.studio;
      draft.performers = mergeEntityLists(draft.performers, match.performers || []);
    }
    draft.remoteSiteId = match.remoteSiteId || "";
    draft.scrapeEndpoint = getSelectedScrapeEndpoint();
    if (!match.hasScrapedTags) {
      draft.missingTags = [];
      setStatus(`Loaded scrape match into editor: ${match.title || match.name || "selected match"}.`);
      renderPanel();
      return;
    }

    draft.missingTags = [];
    state.matchingTags = true;
    renderPanel();

    try {
      setStatus("Matching scraped tags to local tags...");
      const tagMatches = await matchScrapedTags(match.tags || [], draft.scrapeEndpoint);
      draft.tags = mergeEntityLists(draft.tags, tagMatches.matched);
      draft.missingTags = tagMatches.missing;
      const missingText = tagMatches.missing.length ? ` ${tagMatches.missing.length} unmatched scraped tag${tagMatches.missing.length === 1 ? "" : "s"} need review.` : "";
      setStatus(`Loaded scrape match into editor: ${match.title || match.name || "selected match"}.${missingText}`);
    } catch (err) {
      console.warn("[CleanUpQueue] Scraped tag matching failed", err);
      draft.missingTags = dedupeEntities((match.tags || []).map((tag) => ({ ...tag })));
      setStatus("Loaded scrape match, but tag matching failed. Review unmatched tags before saving.", true);
    } finally {
      state.matchingTags = false;
      renderPanel();
    }
  }

  async function saveDraftAndNext() {
    const item = getCurrentItem();
    if (!item || state.saving || state.matchingTags) return;
    const savedIndex = state.currentIndex;

    const draft = cloneDraftForSave(ensureDraftForContent(item));
    if (!draft) return;

    try {
      state.saving = true;
      renderPanel();

      const endpoint = draft.scrapeEndpoint || getSelectedScrapeEndpoint();
      setStatus("Resolving edited metadata...");
      const tags = [];
      for (const tag of draft.tags || []) {
        if (!tag.id && !tag.createOnSave) continue;
        const resolved = tag.id ? tag : await resolveEntity("tag", tag, endpoint);
        if (resolved?.id) tags.push(resolved);
      }

      const urls = parseUrlsInput(draft.urlsText);
      const ratingNumber = parseRatingInput(draft.rating);

      if (item.type === "performers") {
        const patch = {
          name: String(draft.name || draft.title || "").trim() || item.name || "Unnamed performer",
          disambiguation: String(draft.disambiguation || "").trim(),
          birthdate: String(draft.birthdate || "").trim() || null,
          country: String(draft.country || "").trim(),
          details: String(draft.details || "").trim(),
          rating100: ratingNumber,
          urls,
          tag_ids: Array.from(new Set(tags.map((tag) => String(tag.id)))),
        };
        const imageValue = getDraftImageValue(draft);
        if (imageValue) patch.image = imageValue;
        addScrapedStashIdPatch(patch, item, draft.remoteSiteId, endpoint);
        setStatus("Saving performer metadata...");
        await updatePerformerMetadata(item.id, patch);
        state.completedCount += 1;
        state.completedIds.add(item.id);
        state.skippedIds.delete(item.id);
        setStatus(`Saved edits for ${patch.name}.`);
        advanceQueue(savedIndex + 1);
        return;
      }

      if (item.type === "studios") {
        const patch = {
          name: String(draft.name || draft.title || "").trim() || item.name || "Unnamed studio",
          details: String(draft.details || "").trim(),
          rating100: ratingNumber,
          urls,
          tag_ids: Array.from(new Set(tags.map((tag) => String(tag.id)))),
        };
        const imageValue = getDraftImageValue(draft);
        if (imageValue) patch.image = imageValue;
        addScrapedStashIdPatch(patch, item, draft.remoteSiteId, endpoint);
        setStatus("Saving studio metadata...");
        await updateStudioMetadata(item.id, patch);
        state.completedCount += 1;
        state.completedIds.add(item.id);
        state.skippedIds.delete(item.id);
        setStatus(`Saved edits for ${patch.name}.`);
        advanceQueue(savedIndex + 1);
        return;
      }

      const studio = draft.studio ? (draft.studio.id ? draft.studio : await resolveEntity("studio", draft.studio, endpoint)) : null;
      const performers = [];
      for (const performer of draft.performers || []) {
        const resolved = performer.id ? performer : await resolveEntity("performer", performer, endpoint);
        if (resolved?.id) performers.push(resolved);
      }
      const oCounter = Math.max(0, Math.round(Number(draft.oCounter) || 0));
      if (item.type === "images") {
        const patch = {
          date: String(draft.date || "").trim() || null,
          details: String(draft.details || "").trim(),
          rating100: ratingNumber,
          organized: !!draft.organized,
          urls,
          studio_id: studio?.id ? String(studio.id) : null,
          performer_ids: Array.from(new Set(performers.map((item) => String(item.id)))),
          tag_ids: Array.from(new Set(tags.map((item) => String(item.id)))),
        };
        setStatus("Saving image metadata...");
        await updateImageMetadata(item.id, patch);
        state.completedCount += 1;
        state.completedIds.add(item.id);
        state.skippedIds.delete(item.id);
        setStatus(`Saved edits for ${item.title}.`);
        advanceQueue(savedIndex + 1);
        return;
      }

      const patch = {
        title: String(draft.title || "").trim() || item.title || "Untitled",
        code: String(draft.code || "").trim(),
        date: String(draft.date || "").trim() || null,
        details: String(draft.details || "").trim(),
        rating100: ratingNumber,
        organized: !!draft.organized,
        o_counter: oCounter,
        urls,
        studio_id: studio?.id ? String(studio.id) : null,
        performer_ids: Array.from(new Set(performers.map((item) => String(item.id)))),
        tag_ids: Array.from(new Set(tags.map((item) => String(item.id)))),
      };
      if (item.type === "scenes") {
        patch.director = String(draft.director || "").trim();
        const imageValue = getDraftImageValue(draft);
        if (imageValue) patch.cover_image = imageValue;
      }
      addScrapedStashIdPatch(patch, item, draft.remoteSiteId, endpoint);

      setStatus("Saving edited metadata...");
      await updateSceneMetadata(item.id, patch);
      state.completedCount += 1;
      state.completedIds.add(item.id);
      state.skippedIds.delete(item.id);
      setStatus(`Saved edits for ${patch.title || item.title}.`);
      advanceQueue(savedIndex + 1);
    } catch (err) {
      console.error("[CleanUpQueue] Save edited metadata failed", err);
      setStatus(err?.message || "Could not save edited metadata.", true);
    } finally {
      state.saving = false;
      renderPanel();
    }
  }

  function getCurrentItem() {
    return state.queue[state.currentIndex] || null;
  }

  function getRemainingCount() {
    return state.queue
      .slice(Math.max(0, state.currentIndex))
      .filter((item) => !item?.id || !state.completedIds.has(item.id))
      .length;
  }

  function advanceQueue(startIndex = state.currentIndex + 1) {
    const missingOption = getActiveMissingFieldOption();
    invalidateSearches();
    state.currentIndex = findNextUncompletedIndex(startIndex);
    state.draft = null;
    state.draftItemKey = "";
    state.scrapeResults = [];
    state.selectedScrapeIndex = -1;
    state.scrapeError = "";
    state.focusTarget = getCurrentItem() ? missingOption.focus : "";
    renderPanel();
  }

  function findNextUncompletedIndex(startIndex) {
    for (let index = Math.max(0, startIndex); index < state.queue.length; index += 1) {
      const item = state.queue[index];
      if (!item?.id || !state.completedIds.has(item.id)) return index;
    }
    return state.queue.length;
  }

  function findPreviousUncompletedIndex(startIndex) {
    for (let index = Math.min(startIndex, state.queue.length - 1); index >= 0; index -= 1) {
      const item = state.queue[index];
      if (!item?.id || !state.completedIds.has(item.id)) return index;
    }
    return -1;
  }

  function goBackInQueue() {
    if (isWorkflowBusy() || !state.queue.length) return;
    const previousIndex = findPreviousUncompletedIndex(state.currentIndex - 1);
    if (previousIndex < 0) {
      setStatus("No previous unresolved item in this queue.");
      renderPanel();
      return;
    }
    const missingOption = getActiveMissingFieldOption();
    invalidateSearches();
    state.currentIndex = previousIndex;
    state.draft = null;
    state.draftItemKey = "";
    state.scrapeResults = [];
    state.selectedScrapeIndex = -1;
    state.scrapeError = "";
    state.focusTarget = getCurrentItem() ? missingOption.focus : "";
    setStatus("Moved back to the previous unresolved item.");
    renderPanel();
  }

  function skipCurrentItem() {
    if (isWorkflowBusy()) {
      setStatus("Finish the current operation before skipping.", true);
      renderPanel();
      return;
    }
    const item = getCurrentItem();
    if (item?.id) state.skippedIds.add(item.id);
    advanceQueue();
  }

  function setStatus(message, isError = false) {
    state.statusMessage = message || "";
    state.statusError = !!isError;
    const panel = document.getElementById(PANEL_ID);
    const status = panel?.querySelector(".cleanup-queue__status");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  function getStatusText(hasQueue, position, total) {
    if (state.statusMessage) return state.statusMessage;
    if (hasQueue) return `${position} of ${total} loaded ${state.contentType}`;
    return "Load a queue to begin.";
  }

  function ensureCleanUpQueueNav() {
    if (state.navButton?.isConnected) {
      updateFallbackLauncher();
      return true;
    }

    const existing = document.querySelector(`.${BUTTON_CLASS}`);
    if (existing instanceof HTMLElement) {
      state.navButton = existing;
      existing.addEventListener("click", openPanelFromNav);
      updateFallbackLauncher();
      return true;
    }

    const navHost = findNavHost();
    if (!(navHost instanceof HTMLElement)) {
      updateFallbackLauncher();
      return false;
    }

    const nav = document.createElement("a");
    nav.className = `nav-link ${BUTTON_CLASS}`;
    nav.href = "#";
    nav.innerHTML = `<span class="cleanup-queue-nav-icon" aria-hidden="true"></span><span>Cleanup</span>`;
    nav.addEventListener("click", openPanelFromNav);

    if (navHost.classList.contains("navbar-nav")) {
      const item = document.createElement("li");
      item.className = `nav-item ${BUTTON_ITEM_CLASS}`;
      item.appendChild(nav);
      navHost.appendChild(item);
    } else {
      nav.classList.add("nav-utility", "btn", "minimal");
      navHost.appendChild(nav);
    }

    state.navButton = nav;
    updateFallbackLauncher();
    return true;
  }

  function findNavHost() {
    return (
      document.querySelector(".navbar-nav") ||
      document.querySelector(".navbar .navbar-nav") ||
      document.querySelector(".navbar-collapse .navbar-nav") ||
      document.querySelector("header .navbar-nav") ||
      document.querySelector('[class*="navbar-nav"]') ||
      document.querySelector(".navbar-buttons") ||
      document.querySelector(".navbar .container-fluid") ||
      document.querySelector(".navbar .container") ||
      document.querySelector(".navbar") ||
      document.querySelector("header nav") ||
      document.querySelector("nav")
    );
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function updateFallbackLauncher() {
    window.clearTimeout(state.fallbackTimer);
    state.fallbackTimer = window.setTimeout(() => {
      const shouldShowFallback = !isElementVisible(state.navButton);
      if (!shouldShowFallback) {
        state.fallbackButton?.remove();
        state.fallbackButton = null;
        return;
      }
      if (state.fallbackButton?.isConnected) return;
      const existing = document.querySelector(`.${FALLBACK_BUTTON_CLASS}`);
      if (existing instanceof HTMLButtonElement) {
        state.fallbackButton = existing;
        existing.onclick = openPanel;
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = FALLBACK_BUTTON_CLASS;
      button.textContent = "Cleanup";
      button.title = "Open Clean Up Queue";
      button.onclick = openPanel;
      document.body.appendChild(button);
      state.fallbackButton = button;
    }, 900);
  }

  function openPanelFromNav(event) {
    event.preventDefault();
    openPanel();
  }

  function enhanceCurrentPage() {
    ensureCleanUpQueueNav();
  }

  function scheduleRefresh(delay = 120) {
    window.clearTimeout(state.routeTimer);
    state.routeTimer = window.setTimeout(() => enhanceCurrentPage(), delay);
  }

  function openPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.className = "cleanup-queue";
      document.body.appendChild(panel);
    }
    if (getCurrentItem()) state.focusTarget = getActiveMissingFieldOption().focus;
    renderPanel();
    if (!state.scrapeSourcesLoaded) {
      loadScrapeSources().catch((err) => console.warn("[CleanUpQueue] Scrape source refresh failed", err));
    }
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function isPanelOpen() {
    return !!document.getElementById(PANEL_ID);
  }

  function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const item = getCurrentItem();
    const hasQueue = state.queue.length > 0;
    const completed = state.completedCount;
    const skipped = state.skippedIds.size;
    const position = hasQueue ? Math.min(state.currentIndex + 1, state.queue.length) : 0;
    const remaining = getRemainingCount();
    const controlsDisabled = isWorkflowBusy();

    panel.innerHTML = `
      <div class="cleanup-queue__backdrop" data-cleanup-action="close"></div>
      <section class="cleanup-queue__dialog" role="dialog" aria-modal="true" aria-label="Cleanup Queue">
        <header class="cleanup-queue__header">
          <div>
            <h2>Cleanup Queue</h2>
            <span>${escapeHtml(getQueueTitle())}</span>
          </div>
          <button type="button" class="cleanup-queue__close" data-cleanup-action="close" aria-label="Close">x</button>
        </header>

        <div class="cleanup-queue__controls">
          <label>
            <span>Content</span>
            <select class="cleanup-queue__content-type" ${controlsDisabled ? "disabled" : ""}>
              ${CONTENT_TYPES.map((type) => `<option value="${escapeHtml(type.value)}" ${type.value === state.contentType ? "selected" : ""}>${escapeHtml(type.label)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Missing field</span>
            <select class="cleanup-queue__missing-field" ${controlsDisabled ? "disabled" : ""}>
              ${getMissingFieldOptions().map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === state.missingField ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <button type="button" class="cleanup-queue__primary" data-cleanup-action="load" ${controlsDisabled ? "disabled" : ""}>
            ${state.loading ? "Loading..." : "Load queue"}
          </button>
          <div class="cleanup-queue__queue-summary">
            <div class="cleanup-queue__status ${state.statusError ? "is-error" : ""}">${escapeHtml(getStatusText(hasQueue, position, state.queue.length))}</div>
            <div class="cleanup-queue__progress">
              <span>Done ${completed}</span>
              <span>Skipped ${skipped}</span>
              <span>Remaining ${remaining}</span>
            </div>
          </div>
        </div>

        ${renderScopeFilters()}

        ${renderContentWorkflow(item)}
        ${renderQueueFooter(item)}
      </section>
    `;

    attachPanelEvents(panel);
    focusPreferredField(panel);
  }

  function renderQueueFooter(item) {
    if (!item || state.loading) return "";
    const canSave = !isWorkflowBusy();
    return `
      <footer class="cleanup-queue__footer">
        <div class="cleanup-queue__footer-hints">
          <span>${renderShortcutKbd(state.config.saveNextShortcut)} save and next</span>
          <span>${renderShortcutKbd(state.config.skipShortcut)} skip</span>
          <span>${renderShortcutKbd("ArrowLeft")} previous unresolved</span>
        </div>
        <div class="cleanup-queue__footer-actions">
          <button type="button" class="cleanup-queue__secondary" data-cleanup-action="skip" ${isWorkflowBusy() ? "disabled" : ""}>Skip</button>
          <button type="button" class="cleanup-queue__primary" data-cleanup-action="save-draft" ${canSave ? "" : "disabled"}>
            ${state.saving ? "Saving..." : state.matchingTags ? "Matching tags..." : "Save edits and next"}
          </button>
        </div>
      </footer>
    `;
  }

  function renderScopeFilters() {
    if (state.contentType !== "scenes" && state.contentType !== "images") return "";
    return `
      <div class="cleanup-queue__scope">
        <div class="cleanup-queue__scope-head">
          <span>Scope filters</span>
          <strong>${getScopeCount() ? `${getScopeCount()} active` : `All ${state.contentType}`}</strong>
          ${getScopeCount() ? `<button type="button" data-cleanup-action="clear-scope-filters">Clear</button>` : ""}
        </div>
        <div class="cleanup-queue__scope-grid">
          ${renderScopeFilterGroup("studios", "Filter by studio", "Search studios...")}
          ${renderScopeFilterGroup("performers", "Filter by performer", "Search performers...")}
          ${renderScopeFilterGroup("tags", "Filter by tag", "Search tags...")}
        </div>
      </div>
    `;
  }

  function renderScopeFilterGroup(kind, label, placeholder) {
    const selected = state.scopeFilters[kind] || [];
    return `
      <div class="cleanup-queue__scope-group" data-scope-kind="${escapeHtml(kind)}">
        <label>
          <span>${escapeHtml(label)}</span>
          <input type="search" class="cleanup-queue__scope-search" data-scope-kind="${escapeHtml(kind)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false">
        </label>
        <div class="cleanup-queue__scope-chips">
          ${
            selected.length
              ? selected
                  .map(
                    (item) => {
                      const mode = item.mode === "exclude" ? "exclude" : "include";
                      const symbol = mode === "exclude" ? "-" : "+";
                      const label = mode === "exclude" ? "Exclude" : "Include";
                      return `
                      <span class="cleanup-queue__scope-chip cleanup-queue__scope-chip--${escapeHtml(mode)}">
                        <button type="button" class="cleanup-queue__scope-mode" data-cleanup-action="toggle-scope-mode" data-scope-kind="${escapeHtml(kind)}" data-scope-id="${escapeHtml(item.id)}" aria-label="Toggle ${escapeHtml(item.name)} scope mode">${escapeHtml(symbol)}</button>
                        <em>${escapeHtml(label)}</em>
                        ${escapeHtml(item.name)}
                        <button type="button" class="cleanup-queue__scope-remove" data-cleanup-action="remove-scope-filter" data-scope-kind="${escapeHtml(kind)}" data-scope-id="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}">x</button>
                      </span>
                    `;
                    }
                  )
                  .join("")
              : `<span class="cleanup-queue__muted">No filter</span>`
          }
        </div>
        <div class="cleanup-queue__scope-results" data-scope-results="${escapeHtml(kind)}"></div>
      </div>
    `;
  }

  function renderContentWorkflow(item) {
    if (item?.type === "performers" || item?.type === "studios") {
      return renderRecordWorkflow(item);
    }
    return renderSceneWorkflow(item);
  }

  function renderSceneWorkflow(scene) {
    if (state.loading) {
      return `<div class="cleanup-queue__empty">Building cleanup queue...</div>`;
    }

    if (!state.queue.length) {
      return `
        <div class="cleanup-queue__empty">
          <strong>No active queue</strong>
          <span>Choose a cleanup target, then load the queue to start a focused pass.</span>
        </div>
      `;
    }

    if (!scene) {
      return `
        <div class="cleanup-queue__empty">
          <strong>Queue complete</strong>
          <span>${state.completedCount} completed, ${state.skippedIds.size} skipped.</span>
          <button type="button" data-cleanup-action="load" ${isWorkflowBusy() ? "disabled" : ""}>Reload queue</button>
        </div>
      `;
    }

    const draft = ensureDraftForContent(scene);

    return `
      <div class="cleanup-queue__workflow">
        <div class="cleanup-queue__preview-column">
          <div class="cleanup-queue__preview">
            ${renderContentPreview(scene, draft)}
          </div>
          <div class="cleanup-queue__actions">
            <a href="${escapeHtml(getContentUrl(scene))}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(getContentSingularLabel(scene.type))}</a>
            ${scene.type === "scenes" ? `<a href="${escapeHtml(getNativeTaggerUrl(scene))}" target="_blank" rel="noopener noreferrer">Open tagger</a>` : `<a href="${escapeHtml(getContentUrl(scene))}" target="_blank" rel="noopener noreferrer">Open editor</a>`}
            <button type="button" data-cleanup-action="skip" ${isWorkflowBusy() ? "disabled" : ""}>Skip</button>
          </div>
          ${scene.type === "scenes" ? renderScrapePanel() : ""}
        </div>

        ${renderEditableMetadata(scene, draft)}

        <aside class="cleanup-queue__studio-panel">
          ${renderLocalSearchPanel()}
        </aside>
      </div>
    `;
  }

  function renderRecordWorkflow(item) {
    if (state.loading) {
      return `<div class="cleanup-queue__empty">Building cleanup queue...</div>`;
    }

    if (!state.queue.length) {
      return `
        <div class="cleanup-queue__empty">
          <strong>No active queue</strong>
          <span>Choose a cleanup target, then load the queue to start a focused pass.</span>
        </div>
      `;
    }

    if (!item) {
      return `
        <div class="cleanup-queue__empty">
          <strong>Queue complete</strong>
          <span>${state.completedCount} completed, ${state.skippedIds.size} skipped.</span>
          <button type="button" data-cleanup-action="load" ${isWorkflowBusy() ? "disabled" : ""}>Reload queue</button>
        </div>
      `;
    }

    const draft = ensureDraftForContent(item);

    return `
      <div class="cleanup-queue__workflow cleanup-queue__workflow--record">
        <div class="cleanup-queue__preview-column">
          <div class="cleanup-queue__preview">
            ${renderContentPreview(item, draft)}
          </div>
          <div class="cleanup-queue__actions">
            <a href="${escapeHtml(getContentUrl(item))}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(getContentSingularLabel(item.type))}</a>
            <button type="button" data-cleanup-action="save-draft" ${isWorkflowBusy() ? "disabled" : ""}>Save edits</button>
            <button type="button" data-cleanup-action="skip" ${isWorkflowBusy() ? "disabled" : ""}>Skip</button>
          </div>
          ${renderScrapePanel()}
        </div>
        ${renderEditableRecordMetadata(item, draft)}
        <aside class="cleanup-queue__studio-panel">
          ${renderTagSearchPanel()}
        </aside>
      </div>
    `;
  }

  function getContentSingularLabel(type) {
    if (type === "images") return "image";
    if (type === "performers") return "performer";
    if (type === "studios") return "studio";
    return "scene";
  }

  function getContentUrl(item) {
    if (!item?.id) return "#";
    if (item.type === "images") return `/images/${encodeURIComponent(item.id)}`;
    if (item.type === "performers") return `/performers/${encodeURIComponent(item.id)}`;
    if (item.type === "studios") return `/studios/${encodeURIComponent(item.id)}`;
    return `/scenes/${encodeURIComponent(item.id)}`;
  }

  function formatCount(value) {
    return Number.isFinite(Number(value)) ? String(Number(value)) : "0";
  }

  function renderContentPreview(item, draft) {
    const stagedImage = getDraftImageValue(draft);
    const title = item?.title || item?.name || "preview";
    if (stagedImage) {
      return `<img class="cleanup-queue__preview-staged" src="${escapeHtml(stagedImage)}" alt="${escapeHtml(title)}">`;
    }
    if (item?.type === "performers" || item?.type === "studios") {
      return item.imagePath
        ? `<img src="${escapeHtml(item.imagePath)}" alt="${escapeHtml(title)}">`
        : `<div class="cleanup-queue__no-preview">No image</div>`;
    }
    if (item?.preview) {
      return `<video src="${escapeHtml(item.preview)}" poster="${escapeHtml(item.screenshot)}" muted loop controls playsinline preload="metadata"></video>`;
    }
    if (item?.screenshot) {
      return `<img src="${escapeHtml(item.screenshot)}" alt="${escapeHtml(title)}">`;
    }
    return `<div class="cleanup-queue__no-preview">No preview</div>`;
  }

  function renderImageEditor(label, draft, placeholder) {
    const hasImage = Boolean(getDraftImageValue(draft));
    return `
      <div class="cleanup-queue__image-edit">
        <label class="cleanup-queue__field">
          <span>${escapeHtml(label)}</span>
          <input type="text" data-draft-field="imageUrl" value="${escapeHtml(draft?.imageUrl || "")}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
        </label>
        <div class="cleanup-queue__image-file-row">
          <label class="cleanup-queue__file-button">
            <input type="file" data-image-file accept="image/*">
            <span>Choose local image</span>
          </label>
          <span class="cleanup-queue__image-file-name">${escapeHtml(draft?.imageFileName || "No local image selected")}</span>
          <button type="button" data-cleanup-action="clear-draft-image" ${hasImage ? "" : "disabled"}>Clear image</button>
        </div>
      </div>
    `;
  }

  function renderEditableRecordMetadata(item, draft) {
    const isPerformer = item?.type === "performers";
    const isStudio = item?.type === "studios";
    return `
      <div class="cleanup-queue__details cleanup-queue__editor">
        <h3>Edit ${escapeHtml(getContentSingularLabel(item?.type))}</h3>
        <label class="cleanup-queue__field">
          <span>Name</span>
          <input type="text" data-draft-field="name" value="${escapeHtml(draft?.name || draft?.title || "")}" autocomplete="off">
        </label>
        ${renderImageEditor(isStudio ? "Studio image" : "Performer image", draft, "Paste an image URL, choose a local image, or apply a scrape match")}
        ${
          isPerformer
            ? `
              <label class="cleanup-queue__field">
                <span>Disambiguation</span>
                <input type="text" data-draft-field="disambiguation" value="${escapeHtml(draft?.disambiguation || "")}" autocomplete="off">
              </label>
            `
            : ""
        }
        <div class="cleanup-queue__field-grid cleanup-queue__field-grid--record">
          ${
            isPerformer
              ? `
                <label class="cleanup-queue__field">
                  <span>Birthdate</span>
                  <input type="date" data-draft-field="birthdate" value="${escapeHtml(draft?.birthdate || "")}">
                </label>
                <label class="cleanup-queue__field">
                  <span>Country</span>
                  <input type="text" data-draft-field="country" value="${escapeHtml(draft?.country || "")}" placeholder="US, CA, JP..." autocomplete="off">
                </label>
              `
              : ""
          }
          <label class="cleanup-queue__field">
            <span>Rating</span>
            <input type="number" min="0" max="10" step="0.1" data-draft-field="rating" value="${escapeHtml(draft?.rating || "")}" placeholder="0-10">
          </label>
        </div>

        <div class="cleanup-queue__edit-group">
          <div class="cleanup-queue__edit-label">Tags</div>
          <div class="cleanup-queue__chip-list">
            ${renderEditableEntityChips("tag", draft?.tags || [], "No tags selected")}
          </div>
        </div>

        <div class="cleanup-queue__record-stats">
          <span>Scenes <strong>${escapeHtml(formatCount(item?.sceneCount))}</strong></span>
          <span>Images <strong>${escapeHtml(formatCount(item?.imageCount))}</strong></span>
          <span>Galleries <strong>${escapeHtml(formatCount(item?.galleryCount))}</strong></span>
          ${isStudio && item?.parentStudio?.name ? `<span>Parent <strong>${escapeHtml(item.parentStudio.name)}</strong></span>` : ""}
        </div>

        <label class="cleanup-queue__field">
          <span>Details</span>
          <textarea data-draft-field="details" rows="7">${escapeHtml(draft?.details || "")}</textarea>
        </label>
        <label class="cleanup-queue__field">
          <span>URLs</span>
          <textarea data-draft-field="urlsText" rows="4" placeholder="One URL per line">${escapeHtml(draft?.urlsText || "")}</textarea>
        </label>

        <div class="cleanup-queue__editor-actions">
          <button type="button" data-cleanup-action="reset-draft" ${state.saving ? "disabled" : ""}>Reset edits</button>
        </div>
      </div>
    `;
  }

  function renderEditableMetadata(scene, draft) {
    const studio = draft?.studio;
    const isScene = scene?.type !== "images";
    return `
      <div class="cleanup-queue__details cleanup-queue__editor">
        <h3>Edit metadata</h3>
        ${
          isScene
            ? `
              <label class="cleanup-queue__field">
                <span>Title</span>
                <input type="text" data-draft-field="title" value="${escapeHtml(draft?.title || "")}" autocomplete="off">
              </label>
            `
            : ""
        }
        <div class="cleanup-queue__field-grid">
          <label class="cleanup-queue__field">
            <span>Date</span>
            <input type="date" data-draft-field="date" value="${escapeHtml(draft?.date || "")}">
          </label>
          <label class="cleanup-queue__field">
            <span>Rating</span>
            <input type="number" min="0" max="10" step="0.1" data-draft-field="rating" value="${escapeHtml(draft?.rating || "")}" placeholder="0-10">
          </label>
          ${isScene ? `
            <label class="cleanup-queue__field">
              <span>O Count</span>
              <input type="number" min="0" step="1" data-draft-field="oCounter" value="${escapeHtml(draft?.oCounter || "0")}">
            </label>
          ` : ""}
          <label class="cleanup-queue__check-field">
            <input type="checkbox" data-draft-checkbox="organized" ${draft?.organized ? "checked" : ""}>
            <span>Organized</span>
          </label>
        </div>
        <div class="cleanup-queue__edit-group">
          <div class="cleanup-queue__edit-label">Studio</div>
          <div class="cleanup-queue__selected cleanup-queue__draft-studio">
            ${
              studio
                ? `<span><strong>${escapeHtml(studio.name)}</strong>${studio.id ? "" : ` <em>will resolve on save</em>`}</span><button type="button" data-cleanup-action="clear-draft-studio">Clear</button>`
                : `<span>No studio selected</span>`
            }
          </div>
        </div>

        <div class="cleanup-queue__edit-group">
          <div class="cleanup-queue__edit-label">Performers</div>
          <div class="cleanup-queue__chip-list">
            ${renderEditableEntityChips("performer", draft?.performers || [], "No performers selected")}
          </div>
        </div>

        <div class="cleanup-queue__edit-group">
          <div class="cleanup-queue__edit-label">Tags</div>
          <div class="cleanup-queue__chip-list">
            ${renderEditableEntityChips("tag", draft?.tags || [], "No tags selected")}
          </div>
        </div>

        ${renderMissingScrapedTags(draft)}

        ${
          isScene
            ? renderImageEditor("Cover image", draft, "Paste a cover image URL, choose a local image, or apply a scrape match")
            : ""
        }

        <div class="cleanup-queue__source-note">
          <span>Current file</span>
          <strong>${escapeHtml(scene.filePath || "No path available")}</strong>
        </div>

        <div class="cleanup-queue__secondary-fields">
          <div class="cleanup-queue__field-grid cleanup-queue__field-grid--two">
            ${isScene ? `
              <label class="cleanup-queue__field">
                <span>Code</span>
                <input type="text" data-draft-field="code" value="${escapeHtml(draft?.code || "")}" autocomplete="off">
              </label>
            ` : ""}
            ${isScene ? `
              <label class="cleanup-queue__field">
                <span>Director</span>
                <input type="text" data-draft-field="director" value="${escapeHtml(draft?.director || "")}" autocomplete="off">
              </label>
            ` : ""}
          </div>
          <label class="cleanup-queue__field">
            <span>Details</span>
            <textarea data-draft-field="details" rows="5">${escapeHtml(draft?.details || "")}</textarea>
          </label>
          <label class="cleanup-queue__field">
            <span>URLs</span>
            <textarea data-draft-field="urlsText" rows="3" placeholder="One URL per line">${escapeHtml(draft?.urlsText || "")}</textarea>
          </label>
        </div>

        <div class="cleanup-queue__editor-actions">
          <button type="button" data-cleanup-action="reset-draft" ${state.saving ? "disabled" : ""}>Reset edits</button>
        </div>
      </div>
    `;
  }

  function renderEditableEntityChips(kind, items, emptyText) {
    if (!items.length) return `<span class="cleanup-queue__muted">${escapeHtml(emptyText)}</span>`;
    return items
      .map(
        (item, index) => `
          <span class="cleanup-queue__pill cleanup-queue__edit-chip">
            ${escapeHtml(item.name)}${item.id ? "" : ` <em>new</em>`}
            <button type="button" data-cleanup-action="remove-draft-entity" data-entity-kind="${escapeHtml(kind)}" data-entity-index="${index}" aria-label="Remove ${escapeHtml(item.name)}">x</button>
          </span>
        `
      )
      .join("");
  }

  function renderMissingScrapedTags(draft) {
    const missing = draft?.missingTags || [];
    if (!missing.length && !state.matchingTags) return "";
    return `
      <div class="cleanup-queue__edit-group cleanup-queue__missing-tags">
        <div class="cleanup-queue__missing-tags-head">
          <div>
            <div class="cleanup-queue__edit-label">Unmatched scraped tags</div>
            <p>These did not match local tags. Search for a local match, create them, or ignore them.</p>
          </div>
          ${
            missing.length
              ? `<button type="button" data-cleanup-action="create-all-missing-tags">Create all</button>`
              : ""
          }
        </div>
        <div class="cleanup-queue__missing-tag-list">
          ${
            state.matchingTags
              ? `<span class="cleanup-queue__muted">Matching scraped tags...</span>`
              : missing
                  .map(
                    (tag, index) => `
                      <div class="cleanup-queue__missing-tag">
                        <span>${escapeHtml(tag.name)}</span>
                        <button type="button" data-cleanup-action="search-missing-tag" data-missing-tag-index="${index}">Search</button>
                        <button type="button" data-cleanup-action="create-missing-tag" data-missing-tag-index="${index}">Create</button>
                        <button type="button" data-cleanup-action="remove-missing-tag" data-missing-tag-index="${index}">Ignore</button>
                      </div>
                    `
                  )
                  .join("")
          }
        </div>
      </div>
    `;
  }

  function renderLocalSearchPanel() {
    return `
      <div class="cleanup-queue__local-search">
        <div class="cleanup-queue__scrape-title">Local metadata</div>
        <label>
          <span>Studio</span>
          <input type="search" class="cleanup-queue__studio-search" placeholder="Search studios..." autocomplete="off" spellcheck="false">
        </label>
        <div class="cleanup-queue__studio-results cleanup-queue__entity-results">
          <div class="cleanup-queue__hint">Search and select a studio.</div>
        </div>
        <label>
          <span>Performers</span>
          <input type="search" class="cleanup-queue__performer-search" placeholder="Search performers..." autocomplete="off" spellcheck="false">
        </label>
        <div class="cleanup-queue__performer-results cleanup-queue__entity-results">
          <div class="cleanup-queue__hint">Search to add performers.</div>
        </div>
        <label>
          <span>Tags</span>
          <input type="search" class="cleanup-queue__tag-search" placeholder="Search tags..." autocomplete="off" spellcheck="false">
        </label>
        <div class="cleanup-queue__tag-results cleanup-queue__entity-results">
          <div class="cleanup-queue__hint">Search to add tags.</div>
        </div>
      </div>
    `;
  }

  function renderTagSearchPanel() {
    return `
      <div class="cleanup-queue__local-search cleanup-queue__local-search--tags-only">
        <div class="cleanup-queue__scrape-title">Local tags</div>
        <label>
          <span>Tags</span>
          <input type="search" class="cleanup-queue__tag-search" placeholder="Search tags..." autocomplete="off" spellcheck="false">
        </label>
        <div class="cleanup-queue__tag-results cleanup-queue__entity-results">
          <div class="cleanup-queue__hint">Search to add tags.</div>
        </div>
      </div>
    `;
  }

  function renderScrapePanel() {
    const sourceOptions = state.scrapeSources.length
      ? state.scrapeSources
          .map(
            (source) =>
              `<option value="${escapeHtml(source.key)}" ${source.key === state.selectedScrapeSourceKey ? "selected" : ""}>${escapeHtml(source.label)}</option>`
          )
          .join("")
      : `<option value="">${state.scrapeSourcesLoaded ? "No stash-box sources" : "Loading sources..."}</option>`;

    const canScrape = Boolean(getCurrentItem()) && Boolean(getSelectedScrapeSource()) && !isWorkflowBusy();
    const canApply = state.selectedScrapeIndex >= 0 && state.scrapeResults[state.selectedScrapeIndex] && !isWorkflowBusy();

    return `
      <div class="cleanup-queue__scrape">
        <div class="cleanup-queue__scrape-title">Stash scrape/search</div>
        <div class="cleanup-queue__scrape-controls">
          <select class="cleanup-queue__scrape-source" ${state.scrapeLoading ? "disabled" : ""}>
            ${sourceOptions}
            <option value="scraper" ${state.selectedScrapeSourceKey === "scraper" ? "selected" : ""}>Installed scraper ID...</option>
          </select>
          ${
            state.selectedScrapeSourceKey === "scraper"
              ? `<input type="text" class="cleanup-queue__scraper-id" placeholder="scraper id" value="${escapeHtml(state.scraperId)}" ${state.scrapeLoading ? "disabled" : ""}>`
              : ""
          }
          <button type="button" data-cleanup-action="scrape" ${canScrape ? "" : "disabled"}>
            ${state.scrapeLoading ? "Scraping..." : "Scrape matches"}
          </button>
        </div>
        ${renderScrapeResults()}
        <button type="button" class="cleanup-queue__apply-match" data-cleanup-action="apply-scrape-match" ${canApply ? "" : "disabled"}>
          Use selected match in editor
        </button>
      </div>
    `;
  }

  function renderScrapeResults() {
    if (state.scrapeLoading) return `<div class="cleanup-queue__hint">Asking Stash metadata sources...</div>`;
    if (state.scrapeError) return `<div class="cleanup-queue__error">${escapeHtml(state.scrapeError)}</div>`;
    if (!state.scrapeResults.length) return `<div class="cleanup-queue__hint">Search Stash metadata sources, then load a match into the editable fields before saving.</div>`;

    return `
      <div class="cleanup-queue__scrape-results">
        ${state.scrapeResults
          .slice(0, 6)
          .map(
            (match, index) => {
              const remoteUrl = getRemoteMatchUrl(match);
              const isSelected = index === state.selectedScrapeIndex;
              return `
              <div role="button" tabindex="0" class="cleanup-queue__scrape-result ${isSelected ? "is-selected" : ""}" data-cleanup-action="select-scrape-match" data-scrape-index="${index}">
                <div class="cleanup-queue__scrape-thumb">
                  ${match.image ? `<img src="${escapeHtml(match.image)}" alt="">` : `<span>No image</span>`}
                </div>
                <div class="cleanup-queue__scrape-result-body">
                  <div class="cleanup-queue__scrape-result-title">${escapeHtml(match.title || `Match ${index + 1}`)}</div>
                  <div class="cleanup-queue__scrape-meta">
                    ${match.date ? `<span>${escapeHtml(match.date)}</span>` : ""}
                    ${match.birthdate ? `<span>${escapeHtml(match.birthdate)}</span>` : ""}
                    ${match.country ? `<span>${escapeHtml(match.country)}</span>` : ""}
                    ${match.remoteSiteId ? `<span>${escapeHtml(match.remoteSiteId)}</span>` : ""}
                    ${remoteUrl ? `<a href="${escapeHtml(remoteUrl)}" target="_blank" rel="noopener noreferrer">Remote</a>` : ""}
                  </div>
                  ${
                    match.type === "scenes"
                      ? `<div class="cleanup-queue__scrape-studio"><span>${match.studio?.name ? `Studio: ${escapeHtml(match.studio.name)}` : "No studio in match"}</span></div>`
                      : match.parentStudio?.name
                        ? `<div class="cleanup-queue__scrape-studio"><span>Parent: ${escapeHtml(match.parentStudio.name)}</span></div>`
                        : ""
                  }
                  ${match.performers?.length ? `<div class="cleanup-queue__scrape-small">Performers: ${escapeHtml(match.performers.slice(0, 6).map((performer) => performer.name).join(", "))}</div>` : ""}
                  ${match.tags?.length ? `<div class="cleanup-queue__scrape-small">Tags: ${escapeHtml(match.tags.slice(0, 8).map((tag) => tag.name).join(", "))}</div>` : ""}
                </div>
              </div>
            `;
            }
          )
          .join("")}
      </div>
    `;
  }

  function attachPanelEvents(panel) {
    panel.querySelectorAll("[data-cleanup-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const action = event.currentTarget.getAttribute("data-cleanup-action");
        const blockedWhileBusy = new Set([
          "load",
          "skip",
          "save-draft",
          "clear-scope-filters",
          "remove-scope-filter",
          "toggle-scope-mode",
          "reset-draft",
          "clear-draft-image",
          "clear-draft-studio",
          "remove-draft-entity",
          "create-missing-tag",
          "create-all-missing-tags",
          "remove-missing-tag",
          "search-missing-tag",
          "scrape",
          "select-scrape-match",
          "apply-scrape-match",
        ]);
        if (isWorkflowBusy() && blockedWhileBusy.has(action)) {
          event.preventDefault();
          event.stopPropagation();
          setStatus("Finish the current operation before changing the queue.", true);
          renderPanel();
          return;
        }
        if (action === "close") closePanel();
        if (action === "load") loadQueue();
        if (action === "skip") skipCurrentItem();
        if (action === "save-draft") saveDraftAndNext();
        if (action === "clear-scope-filters") clearScopeFilters();
        if (action === "remove-scope-filter") {
          removeScopeFilter(
            event.currentTarget.getAttribute("data-scope-kind"),
            event.currentTarget.getAttribute("data-scope-id")
          );
        }
        if (action === "toggle-scope-mode") {
          toggleScopeFilterMode(
            event.currentTarget.getAttribute("data-scope-kind"),
            event.currentTarget.getAttribute("data-scope-id")
          );
        }
        if (action === "reset-draft") {
          const item = getCurrentItem();
          state.draft = createDraftFromContent(item);
          renderPanel();
        }
        if (action === "clear-draft-image") {
          clearDraftImage(state.draft);
          renderPanel();
        }
        if (action === "clear-draft-studio") {
          if (state.draft) state.draft.studio = null;
          renderPanel();
        }
        if (action === "remove-draft-entity") {
          const kind = event.currentTarget.getAttribute("data-entity-kind");
          const index = Number(event.currentTarget.getAttribute("data-entity-index"));
          const key = kind === "performer" ? "performers" : kind === "tag" ? "tags" : "";
          if (key && state.draft?.[key]) state.draft[key].splice(index, 1);
          renderPanel();
        }
        if (action === "create-missing-tag") {
          const index = Number(event.currentTarget.getAttribute("data-missing-tag-index"));
          const tag = state.draft?.missingTags?.[index];
          if (tag && state.draft) {
            state.draft.tags = dedupeEntities([...(state.draft.tags || []), { ...tag, createOnSave: true }]);
            state.draft.missingTags.splice(index, 1);
          }
          renderPanel();
        }
        if (action === "create-all-missing-tags") {
          if (state.draft?.missingTags?.length) {
            state.draft.tags = dedupeEntities([
              ...(state.draft.tags || []),
              ...state.draft.missingTags.map((tag) => ({ ...tag, createOnSave: true })),
            ]);
            state.draft.missingTags = [];
          }
          renderPanel();
        }
        if (action === "remove-missing-tag") {
          const index = Number(event.currentTarget.getAttribute("data-missing-tag-index"));
          if (state.draft?.missingTags) state.draft.missingTags.splice(index, 1);
          renderPanel();
        }
        if (action === "search-missing-tag") {
          const index = Number(event.currentTarget.getAttribute("data-missing-tag-index"));
          const tag = state.draft?.missingTags?.[index];
          const search = panel.querySelector(".cleanup-queue__tag-search");
          if (tag?.name && search instanceof HTMLInputElement) {
            search.value = tag.name;
            runEntitySearch("tag", tag.name);
          }
        }
        if (action === "scrape") scrapeCurrentItemMatches();
        if (action === "select-scrape-match") {
          populateDraftFromScrapedMatch(Number(event.currentTarget.getAttribute("data-scrape-index")));
        }
        if (action === "apply-scrape-match") populateDraftFromScrapedMatch(state.selectedScrapeIndex);
      });
      if (button.getAttribute("role") === "button") {
        button.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
      }
    });

    const contentType = panel.querySelector(".cleanup-queue__content-type");
    if (contentType instanceof HTMLSelectElement) {
      contentType.addEventListener("change", () => {
        state.contentType = contentType.value || "scenes";
        const options = getMissingFieldOptions(state.contentType);
        if (!options.some((option) => option.value === state.missingField)) {
          state.missingField = options[0]?.value || "studio";
        }
        clearQueueForSelectionChange();
        renderPanel();
      });
    }

    const missingField = panel.querySelector(".cleanup-queue__missing-field");
    if (missingField instanceof HTMLSelectElement) {
      missingField.addEventListener("change", () => {
        state.missingField = missingField.value || "studio";
        clearQueueForSelectionChange();
        renderPanel();
      });
    }

    panel.querySelectorAll(".cleanup-queue__scope-search").forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      input.addEventListener("input", () => {
        const kind = input.getAttribute("data-scope-kind");
        if (!kind || !state.scopeFilters[kind]) return;
        if (!state.scopeSearchTimers[kind]) state.scopeSearchTimers[kind] = 0;
        window.clearTimeout(state.scopeSearchTimers[kind]);
        state.scopeSearchTimers[kind] = window.setTimeout(() => runScopeSearch(kind, input.value), 180);
      });
      const kind = input.getAttribute("data-scope-kind");
      if (kind && state.scopeFilters[kind]) attachSearchInputKeyboard(input, `[data-scope-results="${kind}"]`);
    });

    const source = panel.querySelector(".cleanup-queue__scrape-source");
    if (source instanceof HTMLSelectElement) {
      source.addEventListener("change", () => {
        state.selectedScrapeSourceKey = source.value;
        state.scrapeError = "";
        state.scrapeResults = [];
        state.selectedScrapeIndex = -1;
        renderPanel();
      });
    }

    const scraperId = panel.querySelector(".cleanup-queue__scraper-id");
    if (scraperId instanceof HTMLInputElement) {
      scraperId.addEventListener("input", () => {
        state.scraperId = scraperId.value;
        const scrapeButton = panel.querySelector('[data-cleanup-action="scrape"]');
        if (scrapeButton instanceof HTMLButtonElement) {
          scrapeButton.disabled = !getSelectedScrapeSource() || state.scrapeLoading;
        }
      });
    }

    panel.querySelectorAll("[data-draft-field]").forEach((field) => {
      field.addEventListener("input", () => {
        if (!state.draft) return;
        const key = field.getAttribute("data-draft-field");
        if (!key) return;
        state.draft[key] = field.value;
        if (key === "imageUrl") {
          clearDraftImageFile(state.draft);
          updatePreviewImageFromDraft();
        }
      });
    });

    panel.querySelectorAll("[data-image-file]").forEach((field) => {
      if (!(field instanceof HTMLInputElement)) return;
      field.addEventListener("change", () => handleImageFileSelection(field));
    });

    panel.querySelectorAll("[data-draft-checkbox]").forEach((field) => {
      field.addEventListener("change", () => {
        if (!state.draft || !(field instanceof HTMLInputElement)) return;
        const key = field.getAttribute("data-draft-checkbox");
        if (!key) return;
        state.draft[key] = field.checked;
      });
    });

    const search = panel.querySelector(".cleanup-queue__studio-search");
    if (search instanceof HTMLInputElement) {
      search.addEventListener("input", () => {
        window.clearTimeout(state.studioSearchTimer);
        state.studioSearchTimer = window.setTimeout(() => runStudioSearch(search.value), 180);
      });
      attachSearchInputKeyboard(search, ".cleanup-queue__studio-results");
    }

    const performerSearch = panel.querySelector(".cleanup-queue__performer-search");
    if (performerSearch instanceof HTMLInputElement) {
      performerSearch.addEventListener("input", () => {
        window.clearTimeout(state.performerSearchTimer);
        state.performerSearchTimer = window.setTimeout(() => runEntitySearch("performer", performerSearch.value), 180);
      });
      attachSearchInputKeyboard(performerSearch, ".cleanup-queue__performer-results");
    }

    const tagSearch = panel.querySelector(".cleanup-queue__tag-search");
    if (tagSearch instanceof HTMLInputElement) {
      tagSearch.addEventListener("input", () => {
        window.clearTimeout(state.tagSearchTimer);
        state.tagSearchTimer = window.setTimeout(() => runEntitySearch("tag", tagSearch.value), 180);
      });
      attachSearchInputKeyboard(tagSearch, ".cleanup-queue__tag-results");
    }

    panel.onkeydown = handlePanelHotkey;
  }

  function getResultFocusables(results) {
    if (!results) return [];
    return [...results.querySelectorAll("button, [role='button'], a")]
      .filter((item) => !item.disabled && item.tabIndex !== -1 && item.offsetParent !== null);
  }

  function focusSearchResult(results, direction = 1) {
    const focusables = getResultFocusables(results);
    if (!focusables.length) return false;
    const currentIndex = focusables.indexOf(document.activeElement);
    const nextIndex =
      currentIndex < 0
        ? direction < 0
          ? focusables.length - 1
          : 0
        : (currentIndex + direction + focusables.length) % focusables.length;
    focusables[nextIndex].focus({ preventScroll: true });
    focusables[nextIndex].scrollIntoView({ block: "nearest" });
    return true;
  }

  function attachSearchInputKeyboard(input, resultsSelector) {
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const key = event.key;
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Tab") return;
      if (key === "Tab" && event.shiftKey) return;
      const panel = document.getElementById(PANEL_ID);
      const results = panel?.querySelector(resultsSelector);
      const direction = key === "ArrowUp" ? -1 : 1;
      if (!focusSearchResult(results, direction)) return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function attachSearchResultKeyboard(results) {
    if (!results || results.dataset.keyboardNavigation === "true") return;
    results.dataset.keyboardNavigation = "true";
    results.addEventListener("keydown", (event) => {
      if (event.isComposing || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
      if (!focusSearchResult(results, event.key === "ArrowUp" ? -1 : 1)) return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function handleImageFileSelection(input) {
    const file = input.files?.[0];
    const draft = state.draft;
    if (!file || !draft) return;
    if (!String(file.type || "").startsWith("image/")) {
      input.value = "";
      setStatus("Choose an image file.", true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      draft.imageFileData = String(reader.result || "");
      draft.imageFileName = file.name || "local image";
      draft.imageUrl = "";
      setStatus(`Loaded local image: ${draft.imageFileName}. Save edits to apply it.`);
      renderPanel();
    };
    reader.onerror = () => {
      input.value = "";
      setStatus("Could not read the selected image file.", true);
    };
    reader.readAsDataURL(file);
  }

  function updatePreviewImageFromDraft() {
    const panel = document.getElementById(PANEL_ID);
    const preview = panel?.querySelector(".cleanup-queue__preview");
    const item = getCurrentItem();
    const imageValue = getDraftImageValue(state.draft);
    if (!preview || !item || !imageValue) return;
    preview.textContent = "";
    const img = document.createElement("img");
    img.className = "cleanup-queue__preview-staged";
    img.src = imageValue;
    img.alt = item.title || item.name || "preview";
    preview.appendChild(img);
  }

  function isEditableShortcutTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return !!target.closest("input, textarea, select, [contenteditable='true']");
  }

  function shouldAllowBareArrowShortcut(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return true;
    if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return false;
    if (target instanceof HTMLInputElement) {
      const type = String(target.type || "text").toLowerCase();
      if (type === "checkbox" || type === "radio" || type === "button" || type === "submit") return true;
      return String(target.value || "").trim() === "";
    }
    return !isEditableShortcutTarget(target);
  }

  function isBareArrowKey(event, key) {
    return (
      event.key === key &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey
    );
  }

  function handlePanelHotkey(event) {
    if (!isPanelOpen() || event.isComposing) return;
    const leftRequested = isBareArrowKey(event, "ArrowLeft");
    const skipRequested = shortcutMatchesEvent(state.config.skipShortcut, event);
    const bareArrowRequested = leftRequested || isBareArrowKey(event, "ArrowRight");
    if (bareArrowRequested && !shouldAllowBareArrowShortcut(event)) return;

    const saveRequested = shortcutMatchesEvent(state.config.saveNextShortcut, event);
    if (!saveRequested && !skipRequested && !leftRequested) return;
    const item = getCurrentItem();
    if (!item && !leftRequested) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (leftRequested) {
      goBackInQueue();
      return;
    }
    if (skipRequested) {
      if (!state.saving) skipCurrentItem();
      return;
    }
    if (saveRequested && !state.saving && !state.matchingTags) saveDraftAndNext();
  }

  function focusPreferredField(panel) {
    const target = state.focusTarget;
    if (!target) return;
    state.focusTarget = "";
    window.setTimeout(() => {
      if (!document.getElementById(PANEL_ID)) return;
      const selectorMap = {
        studio: ".cleanup-queue__studio-search",
        performer: ".cleanup-queue__performer-search",
        tag: ".cleanup-queue__tag-search",
        date: '[data-draft-field="date"]',
        rating: '[data-draft-field="rating"]',
        details: '[data-draft-field="details"]',
        urls: '[data-draft-field="urlsText"]',
        country: '[data-draft-field="country"]',
        birthdate: '[data-draft-field="birthdate"]',
        image: '[data-draft-field="imageUrl"]',
      };
      const field = panel.querySelector(selectorMap[target] || "");
      if (!(field instanceof HTMLElement)) return;
      field.focus({ preventScroll: true });
      if (typeof field.select === "function") field.select();
    }, 0);
  }

  async function runStudioSearch(query) {
    const panel = document.getElementById(PANEL_ID);
    const results = panel?.querySelector(".cleanup-queue__studio-results");
    if (!results) return;

    const trimmed = String(query || "").trim();
    const token = ++state.searchTokens.studio;
    if (trimmed.length < 2) {
      results.innerHTML = `<div class="cleanup-queue__hint">Type at least 2 characters.</div>`;
      return;
    }

    results.innerHTML = `<div class="cleanup-queue__hint">Searching...</div>`;
    try {
      const studios = await searchStudios(trimmed);
      if (token !== state.searchTokens.studio) return;
      renderStudioResults(studios);
    } catch (err) {
      if (token !== state.searchTokens.studio) return;
      console.error("[CleanUpQueue] Studio search failed", err);
      results.innerHTML = `<div class="cleanup-queue__error">Search failed.</div>`;
    }
  }

  async function runScopeSearch(kind, query) {
    if (!state.scopeFilters[kind]) return;
    const panel = document.getElementById(PANEL_ID);
    const results = panel?.querySelector(`[data-scope-results="${kind}"]`);
    if (!results) return;

    const trimmed = String(query || "").trim();
    const token = ++state.searchTokens.scope[kind];
    if (trimmed.length < 2) {
      results.innerHTML = "";
      return;
    }

    results.innerHTML = `<div class="cleanup-queue__hint">Searching...</div>`;
    try {
      const items =
        kind === "studios"
          ? await searchStudios(trimmed)
          : kind === "performers"
            ? await searchPerformers(trimmed)
            : kind === "tags"
              ? await searchTags(trimmed)
            : [];
      if (token !== state.searchTokens.scope[kind]) return;
      renderScopeResults(kind, items);
    } catch (err) {
      if (token !== state.searchTokens.scope[kind]) return;
      console.error("[CleanUpQueue] Scope search failed", kind, err);
      results.innerHTML = `<div class="cleanup-queue__error">Search failed.</div>`;
    }
  }

  function renderScopeResults(kind, items) {
    if (!state.scopeFilters[kind]) return;
    const panel = document.getElementById(PANEL_ID);
    const results = panel?.querySelector(`[data-scope-results="${kind}"]`);
    if (!results) return;
    attachSearchResultKeyboard(results);

    if (!items.length) {
      results.innerHTML = `<div class="cleanup-queue__hint">No matches.</div>`;
      return;
    }

    const selectedModes = new Map(
      (state.scopeFilters[kind] || []).map((item) => [String(item.id), item.mode === "exclude" ? "exclude" : "include"])
    );
    results.innerHTML = items
      .slice(0, 8)
      .map(
        (item) => {
          const selectedMode = selectedModes.get(String(item.id)) || "";
          return `
          <div class="cleanup-queue__scope-result ${selectedMode ? "is-selected" : ""}" data-scope-id="${escapeHtml(item.id)}">
            <span>${escapeHtml(item.name)}</span>
            <button type="button" class="${selectedMode === "include" ? "is-active" : ""}" data-scope-mode="include" aria-label="Include ${escapeHtml(item.name)}">+</button>
            <button type="button" class="${selectedMode === "exclude" ? "is-active" : ""}" data-scope-mode="exclude" aria-label="Exclude ${escapeHtml(item.name)}">-</button>
          </div>
        `;
        }
      )
      .join("");

    results.querySelectorAll(".cleanup-queue__scope-result button").forEach((button) => {
      button.addEventListener("click", () => {
        const row = button.closest(".cleanup-queue__scope-result");
        const item = items.find((candidate) => String(candidate.id) === String(row?.getAttribute("data-scope-id")));
        const mode = button.getAttribute("data-scope-mode") === "exclude" ? "exclude" : "include";
        if (item) addScopeFilter(kind, item, mode);
      });
    });
  }

  function renderStudioResults(studios) {
    const panel = document.getElementById(PANEL_ID);
    const results = panel?.querySelector(".cleanup-queue__studio-results");
    if (!results) return;
    attachSearchResultKeyboard(results);

    if (!studios.length) {
      results.innerHTML = `<div class="cleanup-queue__hint">No studios found.</div>`;
      return;
    }

    results.innerHTML = studios
      .map(
        (studio) => `
          <button type="button" class="cleanup-queue__studio-result" data-studio-id="${escapeHtml(studio.id)}">
            ${studio.imagePath ? `<img src="${escapeHtml(studio.imagePath)}" alt="">` : `<span class="cleanup-queue__studio-fallback"></span>`}
            <span>${escapeHtml(studio.name)}</span>
          </button>
        `
      )
      .join("");

    results.querySelectorAll(".cleanup-queue__studio-result").forEach((button) => {
      button.addEventListener("click", () => {
        const studio = studios.find((item) => item.id === button.getAttribute("data-studio-id"));
        ensureDraftForContent(getCurrentItem());
        if (state.draft) state.draft.studio = studio || null;
        results.querySelectorAll(".cleanup-queue__studio-result").forEach((resultButton) => {
          resultButton.classList.toggle("is-selected", resultButton === button);
        });
        renderPanel();
      });
    });
  }

  async function runEntitySearch(kind, query) {
    const panel = document.getElementById(PANEL_ID);
    const results = panel?.querySelector(kind === "performer" ? ".cleanup-queue__performer-results" : ".cleanup-queue__tag-results");
    if (!results) return;

    const trimmed = String(query || "").trim();
    const token = ++state.searchTokens[kind];
    if (trimmed.length < 2) {
      results.innerHTML = `<div class="cleanup-queue__hint">Type at least 2 characters.</div>`;
      return;
    }

    results.innerHTML = `<div class="cleanup-queue__hint">Searching...</div>`;
    try {
      const items = kind === "performer" ? await searchPerformers(trimmed) : await searchTags(trimmed);
      if (token !== state.searchTokens[kind]) return;
      renderEntityResults(kind, items);
    } catch (err) {
      if (token !== state.searchTokens[kind]) return;
      console.error(`[CleanUpQueue] ${kind} search failed`, err);
      results.innerHTML = `<div class="cleanup-queue__error">Search failed.</div>`;
    }
  }

  function renderEntityResults(kind, items) {
    const panel = document.getElementById(PANEL_ID);
    const results = panel?.querySelector(kind === "performer" ? ".cleanup-queue__performer-results" : ".cleanup-queue__tag-results");
    if (!results) return;
    attachSearchResultKeyboard(results);

    if (!items.length) {
      results.innerHTML = `<div class="cleanup-queue__hint">No ${kind}s found.</div>`;
      return;
    }

    const draftKey = kind === "performer" ? "performers" : "tags";
    const selectedIds = new Set((state.draft?.[draftKey] || []).map((item) => String(item.id)));
    results.innerHTML = items
      .map(
        (item) => `
          <button type="button" class="cleanup-queue__studio-result ${selectedIds.has(String(item.id)) ? "is-selected" : ""}" data-entity-id="${escapeHtml(item.id)}">
            ${item.imagePath ? `<img src="${escapeHtml(item.imagePath)}" alt="">` : `<span class="cleanup-queue__studio-fallback"></span>`}
            <span>${escapeHtml(item.name)}</span>
          </button>
        `
      )
      .join("");

    results.querySelectorAll(".cleanup-queue__studio-result").forEach((button) => {
      button.addEventListener("click", () => {
        const item = items.find((candidate) => candidate.id === button.getAttribute("data-entity-id"));
        ensureDraftForContent(getCurrentItem());
        if (item && state.draft) {
          state.draft[draftKey] = dedupeEntities([...(state.draft[draftKey] || []), item]);
          if (kind === "tag") removeMissingTagByName(item.name);
        }
        renderPanel();
      });
    });
  }

  function installRouteHooks() {
    const hooks = window.__cleanUpQueueNavigationHooks || {};
    window.__cleanUpQueueNavigationHooks = hooks;
    window.__cleanUpQueueRouteHandler = () => scheduleRefresh();
    if (window.__cleanUpQueueRouteEventListener) {
      window.removeEventListener(ROUTE_EVENT, window.__cleanUpQueueRouteEventListener);
      window.__cleanUpQueueRouteEventListener = null;
    }
    if (hooks.routeEventListener) {
      window.removeEventListener(ROUTE_EVENT, hooks.routeEventListener);
    }
    hooks.routeEventListener = () => {
      if (typeof window.__cleanUpQueueRouteHandler === "function") {
        window.__cleanUpQueueRouteHandler();
      }
    };
    window.addEventListener(ROUTE_EVENT, hooks.routeEventListener);

    if (!hooks.historyWrapped) {
      hooks.originalPushState = history.pushState;
      hooks.originalReplaceState = history.replaceState;
      hooks.patchedPushState = function patchedCleanUpQueuePushState(...args) {
        const result = hooks.originalPushState.apply(this, args);
        window.dispatchEvent(new Event(ROUTE_EVENT));
        return result;
      };
      hooks.patchedReplaceState = function patchedCleanUpQueueReplaceState(...args) {
        const result = hooks.originalReplaceState.apply(this, args);
        window.dispatchEvent(new Event(ROUTE_EVENT));
        return result;
      };
      history.pushState = hooks.patchedPushState;
      history.replaceState = hooks.patchedReplaceState;
      hooks.historyWrapped = true;
    }

    if (hooks.popstateListener) {
      window.removeEventListener("popstate", hooks.popstateListener);
    }
    hooks.popstateListener = () => window.dispatchEvent(new Event(ROUTE_EVENT));
    window.addEventListener("popstate", hooks.popstateListener);
  }

  function cleanup() {
    const button = state.navButton || document.querySelector(`.${BUTTON_CLASS}`);
    const item = button?.closest?.(`.${BUTTON_ITEM_CLASS}`);
    if (item instanceof HTMLElement) item.remove();
    else button?.remove?.();
    state.navButton = null;
    state.fallbackButton?.remove();
    state.fallbackButton = null;
    closePanel();
    if (state.observer) state.observer.disconnect();
    window.clearTimeout(state.studioSearchTimer);
    window.clearTimeout(state.performerSearchTimer);
    window.clearTimeout(state.tagSearchTimer);
    Object.values(state.scopeSearchTimers || {}).forEach((timer) => window.clearTimeout(timer));
    window.clearTimeout(state.routeTimer);
    window.clearTimeout(state.fallbackTimer);
    document.removeEventListener("keydown", handlePanelHotkey, true);
    const hooks = window.__cleanUpQueueNavigationHooks;
    if (hooks) {
      if (hooks.routeEventListener) window.removeEventListener(ROUTE_EVENT, hooks.routeEventListener);
      if (hooks.popstateListener) window.removeEventListener("popstate", hooks.popstateListener);
      if (hooks.historyWrapped && history.pushState === hooks.patchedPushState) {
        history.pushState = hooks.originalPushState;
      }
      if (hooks.historyWrapped && history.replaceState === hooks.patchedReplaceState) {
        history.replaceState = hooks.originalReplaceState;
      }
      window.__cleanUpQueueNavigationHooks = null;
    }
    window.__cleanUpQueueRouteEventListener = null;
    window.__cleanUpQueueRouteHooksInstalled = false;
    if (window.__cleanUpQueueCleanup === cleanup) window.__cleanUpQueueCleanup = null;
  }

  function init() {
    if (typeof window.__cleanUpQueueCleanup === "function") {
      window.__cleanUpQueueCleanup();
    }
    window.__cleanUpQueueCleanup = cleanup;
    installRouteHooks();
    document.removeEventListener("keydown", handlePanelHotkey, true);
    document.addEventListener("keydown", handlePanelHotkey, true);
    loadConfig().catch((err) => console.warn("[CleanUpQueue] Config refresh failed", err));
    scheduleRefresh(0);
    state.observer = new MutationObserver(() => scheduleRefresh());
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
