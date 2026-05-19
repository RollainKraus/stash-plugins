(function () {
  "use strict";

  const PLUGIN_ID = "StashMiniGUI";
  const STORAGE_PREFIX = "StashMiniGUI:";
  const POSITION_KEY = `${STORAGE_PREFIX}position:v1`;
  const OPEN_KEY = `${STORAGE_PREFIX}open:v1`;
  const ACTIVE_APP_KEY = `${STORAGE_PREFIX}active-app:v1`;
  const TABS_KEY = `${STORAGE_PREFIX}tabs:v1`;
  const HISTORY_KEY = `${STORAGE_PREFIX}history:v1`;
  const PANEL_SIZE_KEY = `${STORAGE_PREFIX}panel-size:v1`;
  const RESULT_LIMIT_KEY = `${STORAGE_PREFIX}result-limit:v1`;
  const APP_SETTINGS_KEY = `${STORAGE_PREFIX}app-settings:v1`;
  const OHISTORY_SCENE_CACHE_KEY = `${STORAGE_PREFIX}ohistory-scenes:v1`;
  const RECENT_CACHE_KEY = `${STORAGE_PREFIX}recent-cache:v1`;
  const REFRESH_DELAYS = [0, 150, 500, 1200];
  const OHISTORY_CACHE_TTL_MS = 10 * 60 * 1000;
  const RECENT_CACHE_TTL_MS = 2 * 60 * 1000;
  const MAX_TABS = 30;
  const MAX_HISTORY = 40;
  const MIN_RESULT_LIMIT = 3;
  const MAX_RESULT_LIMIT = 60;
  const DEFAULT_RESULT_LIMIT = 8;
  const DEFAULT_PANEL_SIZE = "390,680";
  const RECENT_TYPES = new Set(["all", "scene", "performer", "image", "studio", "tag"]);
  const OHISTORY_TYPES = new Set(["all", "scene", "performer", "studio"]);
  const DEFAULT_APP_ORDER = "ohistory,performers,scenes,images,studios,tags,search,recent,pinned,history";
  const APP_CATALOG = {
    ohistory: { label: "O History", note: "Recent O activity calendar", icon: "fa-solid fa-calendar-days", app: "ohistory" },
    performers: { label: "Performers", note: "Browse performers", icon: "fa-solid fa-user", type: "performer" },
    scenes: { label: "Scenes", note: "Browse scenes", icon: "fa-solid fa-play", type: "scene" },
    images: { label: "Images", note: "Browse images", icon: "fa-solid fa-image", type: "image" },
    studios: { label: "Studios", note: "Studio profiles", icon: "fa-solid fa-video", type: "studio" },
    tags: { label: "Tags", note: "Browse tag galleries", icon: "fa-solid fa-tags", app: "tags" },
    search: { label: "Finder", note: "Open in app", icon: "fa-solid fa-magnifying-glass", app: "search" },
    recent: { label: "Recent", note: "Browse in app", icon: "fa-solid fa-clock-rotate-left", app: "recent" },
    pinned: { label: "Pinned", note: "Saved shortcuts", icon: "fa-solid fa-thumbtack", app: "pinned" },
    history: { label: "History", note: "Recently touched", icon: "fa-solid fa-clock", app: "history" },
  };
  const RECENT_SORTS = {
    alphabetical: { label: "Name / Title", scene: "title", performer: "name", image: "title", studio: "name" },
    created_at: { label: "Created at", scene: "created_at", performer: "created_at", image: "created_at", studio: "created_at" },
    updated_at: { label: "Updated at", scene: "updated_at", performer: "updated_at", image: "updated_at", studio: "updated_at" },
    last_played_at: { label: "Last played at", scene: "last_played_at", performer: "updated_at", image: "updated_at", studio: "updated_at" },
    last_o_at: { label: "Last O at", scene: "last_o_at", performer: "last_o_at", image: "last_o_at", studio: "updated_at", fallback: "updated_at" },
    o_counter: { label: "O Count", scene: "o_counter", performer: "o_counter", image: "o_counter", studio: "updated_at", fallback: "updated_at" },
    rating: { label: "Rating", scene: "rating", performer: "rating", image: "rating", studio: "updated_at" },
    date: { label: "Release Date", scene: "date", performer: "updated_at", image: "date", studio: "updated_at", fallback: "updated_at" },
    scene_count: { label: "Scene Count", scene: "updated_at", performer: "scene_count", image: "updated_at", studio: "scene_count", fallback: "updated_at" },
    image_count: { label: "Image Count", scene: "updated_at", performer: "image_count", image: "updated_at", studio: "image_count", fallback: "updated_at" },
  };
  const APP_SETTING_DEFAULTS = {
    performerCardSize: "small",
    theme: "aqua",
    backgroundImage: "",
    backgroundOpacity: 0.18,
    appButtonStyle: "cards",
    appLayout: "comfortable",
    appOrder: DEFAULT_APP_ORDER,
    appButtonImages: {},
    performerColumns: 2,
    panelScale: "",
    panelOpacity: 0.46,
    dimWhenIdle: false,
    minimizeOnIdle: false,
    hoverToOpen: false,
    customTagApps: [],
    customPresetApps: [],
    customLinkApps: [],
    hiddenApps: [],
    oHistoryView: "month",
    slideshowEnabled: false,
    slideshowContentType: "scene",
    slideshowTag: "",
    slideshowSort: "updated_at",
    slideshowRatedOnly: false,
    slideshowOFilter: "any",
    slideshowMaxContent: 18,
    slideshowDuration: 5000,
    slideshowProgressBar: false,
  };

  const CONFIG_DEFAULTS = {
    initialPosition: "22,22",
    launcherPosition: "96,92",
    keyboardShortcut: "ctrl+shift+m",
  };

  const SEARCH_QUERY = `
    query StashMiniSearch($q: String!, $limit: Int!, $page: Int!) {
      scenes: findScenes(filter: { q: $q, per_page: $limit, page: $page, sort: "created_at", direction: DESC }) {
        count
        scenes { id title date o_counter rating100 studio { name } performers { id name } paths { screenshot preview } }
      }
      performers: findPerformers(filter: { q: $q, per_page: $limit, page: $page, sort: "rating", direction: DESC }) {
        count
        performers { id name disambiguation alias_list image_path rating100 o_counter }
      }
      studios: findStudios(filter: { q: $q, per_page: $limit, page: $page, sort: "name", direction: ASC }) {
        count
        studios { id name image_path rating100 parent_studio { id name image_path } }
      }
    }
  `;

  const IMAGE_SEARCH_QUERY = `
    query StashMiniImageSearch($q: String!, $limit: Int!, $page: Int!) {
      images: findImages(filter: { q: $q, per_page: $limit, page: $page, sort: "created_at", direction: DESC }) {
        count
        images { id title o_counter rating100 paths { thumbnail preview image } performers { name } }
      }
    }
  `;

  const SAVED_SCENE_QUERY = `
    query StashMiniSavedScene($id: ID!) {
      findScene(id: $id) {
        id
        title
        date
        o_counter
        rating100
        studio { id name image_path }
        performers { id name }
        paths { screenshot preview }
      }
    }
  `;

  const SAVED_PERFORMER_QUERY = `
    query StashMiniSavedPerformer($id: ID!) {
      findPerformer(id: $id) {
        id
        name
        disambiguation
        alias_list
        image_path
        rating100
        o_counter
        scene_count
        image_count
      }
    }
  `;

  const SAVED_IMAGE_QUERY = `
    query StashMiniSavedImage($id: ID!) {
      findImage(id: $id) {
        id
        title
        o_counter
        rating100
        paths { thumbnail preview image }
        performers { id name }
      }
    }
  `;

  const SAVED_STUDIO_QUERY = `
    query StashMiniSavedStudio($id: ID!) {
      findStudio(id: $id) {
        id
        name
        image_path
        rating100
        parent_studio { id name image_path }
      }
    }
  `;

  const TAG_SORTS = {
    name: { label: "Name", sort: "name" },
    scene_count: { label: "Scene Count", sort: "scene_count" },
    image_count: { label: "Image Count", sort: "image_count" },
  };

  const TAG_IMAGE_QUERY = `
    query StashMiniTagImage($id: ID!) {
      findTag(id: $id) {
        id
        name
        image_path
      }
    }
  `;

  const SCENE_DETAIL_QUERY = `
    query StashMiniSceneDetail($id: ID!) {
      findScene(id: $id) {
        id
        title
        date
        details
        o_counter
        rating100
        organized
        studio { id name image_path }
        tags { id name }
        performers {
          id
          name
          disambiguation
          image_path
          rating100
          o_counter
          scene_count
          image_count
          tags { id name }
        }
        paths { screenshot preview }
      }
    }
  `;

  const IMAGE_DETAIL_QUERY = `
    query StashMiniImageDetail($id: ID!) {
      findImage(id: $id) {
        id
        title
        code
        date
        details
        o_counter
        rating100
        studio { id name image_path }
        performers { id name disambiguation image_path rating100 o_counter scene_count image_count }
        tags { id name }
        galleries { id title }
        paths { thumbnail preview image }
      }
    }
  `;

  const STUDIO_DETAIL_QUERY = `
    query StashMiniStudioDetail($id: ID!) {
      findStudio(id: $id) {
        id
        name
        image_path
        parent_studio { id name image_path }
        child_studios { id name image_path rating100 scene_count image_count parent_studio { id name image_path } }
        details
        url
        rating100
        scene_count
        image_count
        gallery_count
      }
    }
  `;

  const STUDIO_SCENES_QUERY = `
    query StashMiniStudioScenes($id: ID!) {
      scenes: findScenes(scene_filter: { studios: { value: [$id], modifier: INCLUDES_ALL } }, filter: { per_page: 6, sort: "date", direction: DESC }) {
        scenes { id title date o_counter rating100 studio { id name image_path } performers { id name } paths { screenshot preview } }
      }
    }
  `;

  const STUDIO_BASIC_QUERY = `
    query StashMiniStudioBasic($id: ID!) {
      findStudio(id: $id) {
        id
        name
        image_path
        parent_studio { id name image_path }
      }
    }
  `;

  const PERFORMER_DETAIL_QUERY = `
    query StashMiniPerformerDetail($id: ID!, $sceneLimit: Int!, $imageLimit: Int!) {
      findPerformer(id: $id) {
        id
        name
        disambiguation
        alias_list
        image_path
        birthdate
        death_date
        country
        gender
        ethnicity
        hair_color
        eye_color
        height_cm
        weight
        measurements
        fake_tits
        penis_length
        circumcised
        tattoos
        piercings
        career_length
        details
        rating100
        o_counter
        scene_count
        image_count
        gallery_count
        tags { id name }
      }
      scenes: findScenes(scene_filter: { performers: { value: [$id], modifier: INCLUDES_ALL } }, filter: { per_page: $sceneLimit, sort: "date", direction: DESC }) {
        scenes { id title date studio { name } paths { screenshot preview } }
      }
      images: findImages(image_filter: { performers: { value: [$id], excludes: [], modifier: INCLUDES_ALL } }, filter: { per_page: $imageLimit, sort: "created_at", direction: DESC }) {
        images { id title paths { thumbnail preview image } }
      }
    }
  `;

  const BACKGROUND_GALLERY_QUERY = `
    query StashMiniBackgroundGallery($id: [ID!]!, $limit: Int!) {
      findImages(image_filter: { galleries: { value: $id, modifier: INCLUDES_ALL } }, filter: { per_page: $limit, sort: "created_at", direction: DESC }) {
        images { paths { image preview thumbnail } }
      }
    }
  `;

  const BACKGROUND_TAG_QUERY = `
    query StashMiniBackgroundTag($id: [ID!]!, $limit: Int!) {
      findImages(image_filter: { tags: { value: $id, modifier: INCLUDES_ALL } }, filter: { per_page: $limit, sort: "created_at", direction: DESC }) {
        images { paths { image preview thumbnail } }
      }
    }
  `;

  const state = {
    config: { ...CONFIG_DEFAULTS },
    root: null,
    panel: null,
    screen: null,
    tabsNode: null,
    resizeHandle: null,
    launcher: null,
    app: "home",
    appPayload: null,
    navStack: [],
    tabs: [],
    history: [],
    appSettings: { ...APP_SETTING_DEFAULTS },
    isOpen: false,
    searchTimer: 0,
    recentCache: null,
    oHistorySceneCache: null,
    oHistorySceneRequest: null,
    clockTimer: 0,
    shortcutHandler: null,
    resizeHandler: null,
    routeRefreshTimer: 0,
    fullscreenHandler: null,
    backgroundLayers: [],
    backgroundImages: [],
    backgroundSourceKey: "",
    backgroundTimer: 0,
    backgroundLayerIndex: 0,
    slideshowTimer: 0,
    idleMinimizeTimer: 0,
  };

  function registerRuntime() {
    const previous = window.__stashMiniGuiRuntime;
    if (previous?.destroy) previous.destroy();
    window.__stashMiniGuiRuntime = {
      destroy,
      state,
    };
  }

  function destroy() {
    window.clearTimeout(state.searchTimer);
    window.clearTimeout(state.routeRefreshTimer);
    window.clearTimeout(state.idleMinimizeTimer);
    window.clearInterval(state.clockTimer);
    window.clearInterval(state.backgroundTimer);
    if (state.shortcutHandler) document.removeEventListener("keydown", state.shortcutHandler, true);
    if (state.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
    if (state.fullscreenHandler) document.removeEventListener("fullscreenchange", state.fullscreenHandler, true);
    state.shortcutHandler = null;
    state.resizeHandler = null;
    state.fullscreenHandler = null;
    state.root?.remove();
    state.root = null;
    state.panel = null;
    state.screen = null;
    state.tabsNode = null;
    state.resizeHandle = null;
    state.launcher = null;
    state.backgroundLayers = [];
    state.backgroundImages = [];
    state.backgroundSourceKey = "";
    state.backgroundTimer = 0;
    state.backgroundLayerIndex = 0;
    window.clearTimeout(state.slideshowTimer);
    state.slideshowTimer = 0;
    state.idleMinimizeTimer = 0;
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
        if (json.errors?.length) throw new Error(json.errors.map((err) => err.message).join("; "));
        return json.data || {};
      });
  }

  function getConfigNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function getConfigString(value, fallback) {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function parsePair(value, fallbackA, fallbackB, minA, maxA, minB, maxB) {
    const parts = String(value ?? "").split(",").map((part) => Number(part.trim()));
    const a = Number.isFinite(parts[0]) ? Math.max(minA, Math.min(maxA, parts[0])) : fallbackA;
    const b = Number.isFinite(parts[1]) ? Math.max(minB, Math.min(maxB, parts[1])) : fallbackB;
    return [a, b];
  }

  function parseAppOrder(value) {
    const seen = new Set();
    const ordered = [];
    const customKeys = getAllCustomApps().map((app) => app.key);
    String(value || DEFAULT_APP_ORDER)
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .concat(DEFAULT_APP_ORDER.split(","), customKeys)
      .forEach((key) => {
        if ((!APP_CATALOG[key] && !getCustomAppByKey(key)) || seen.has(key)) return;
        seen.add(key);
        ordered.push(key);
      });
    return ordered;
  }

  function getAllCustomApps() {
    return [...getCustomTagApps(), ...getCustomPresetApps(), ...getCustomLinkApps()];
  }

  function getCustomTagApps() {
    const rawApps = Array.isArray(state.appSettings?.customTagApps) ? state.appSettings.customTagApps : [];
    return rawApps
      .map((app) => normalizeCustomTagApp(app))
      .filter(Boolean);
  }

  function getCustomPresetApps() {
    const rawApps = Array.isArray(state.appSettings?.customPresetApps) ? state.appSettings.customPresetApps : [];
    return rawApps
      .map((app) => normalizeCustomPresetApp(app))
      .filter(Boolean);
  }

  function getCustomLinkApps() {
    const rawApps = Array.isArray(state.appSettings?.customLinkApps) ? state.appSettings.customLinkApps : [];
    return rawApps
      .map((app) => normalizeCustomLinkApp(app))
      .filter(Boolean);
  }

  function normalizeCustomTagApp(app) {
    if (!app || typeof app !== "object") return null;
    const tagId = parseTagId(app.tagId || app.tag || app.id || "");
    if (!tagId) return null;
    const contentType = RECENT_TYPES.has(app.contentType) && app.contentType !== "all" && app.contentType !== "tag" ? app.contentType : "scene";
    const label = String(app.label || app.name || `Tag ${tagId}`).trim().slice(0, 48);
    const safeId = String(app.key || `tag-${contentType}-${tagId}-${label}`)
      .replace(/^tag:/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return {
      key: `tag:${safeId || `${contentType}-${tagId}`}`,
      label,
      tagId,
      contentType,
      sort: RECENT_SORTS[app.sort] ? app.sort : "updated_at",
      direction: normalizeDirection(app.direction || "DESC"),
      useTagImage: Boolean(app.useTagImage),
    };
  }

  function normalizeCustomPresetApp(app) {
    if (!app || typeof app !== "object") return null;
    const contentType = RECENT_TYPES.has(app.contentType) && app.contentType !== "all" ? app.contentType : "scene";
    const sort = RECENT_SORTS[app.sort] ? app.sort : "updated_at";
    const direction = normalizeDirection(app.direction || "DESC");
    const label = String(app.label || `${RECENT_SORTS[sort].label} ${contentType}`).trim().slice(0, 48);
    const image = normalizeBackgroundImage(app.image || app.imageUrl || "");
    const safeId = String(app.key || `preset-${contentType}-${sort}-${direction}-${label}`)
      .replace(/^preset:/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return { key: `preset:${safeId || `${contentType}-${sort}`}`, label, contentType, sort, direction, image };
  }

  function normalizeCustomLinkApp(app) {
    if (!app || typeof app !== "object") return null;
    const url = String(app.url || app.href || "").trim();
    if (!url) return null;
    const label = String(app.label || app.name || url).trim().slice(0, 48);
    const icon = String(app.icon || "fa-solid fa-up-right-from-square").trim();
    const image = normalizeBackgroundImage(app.image || app.imageUrl || "");
    const safeId = String(app.key || `link-${label}-${url}`)
      .replace(/^link:/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return { key: `link:${safeId || label.toLowerCase()}`, label, url, icon, image };
  }

  function parseTagId(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/(?:^tag:|\/tags\/)([^/?#,\s]+)/i);
    return match?.[1] || raw;
  }

  function getCustomAppByKey(key) {
    return getAllCustomApps().find((app) => app.key === key);
  }

  function getAppEntry(key) {
    const custom = getCustomAppByKey(key);
    if (custom) {
      if (custom.key.startsWith("preset:")) {
        return {
          key,
          customPreset: custom,
          label: custom.label,
          note: `${custom.contentType} ${RECENT_SORTS[custom.sort]?.label || custom.sort}`,
          icon: "fa-solid fa-filter",
          image: custom.image,
        };
      }
      if (custom.key.startsWith("link:")) {
        return {
          key,
          customLink: custom,
          label: custom.label,
          note: custom.url,
          icon: custom.icon,
          image: custom.image,
        };
      }
      return {
        key,
        customTag: custom,
        label: custom.label,
        note: `${custom.contentType} tag queue`,
        icon: "fa-solid fa-tag",
      };
    }
    const app = APP_CATALOG[key];
    return app ? { key, ...app } : null;
  }

  function getOrderedAppEntries() {
    return parseAppOrder(state.appSettings.appOrder || DEFAULT_APP_ORDER)
      .map((key) => getAppEntry(key))
      .filter(Boolean);
  }

  function getHiddenAppKeys() {
    return new Set(Array.isArray(state.appSettings?.hiddenApps) ? state.appSettings.hiddenApps : []);
  }

  function isAppHidden(key) {
    return getHiddenAppKeys().has(key);
  }

  function toggleHiddenApp(key) {
    const hidden = getHiddenAppKeys();
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    updateAppSetting("hiddenApps", Array.from(hidden));
  }

  async function loadConfig() {
    try {
      const data = await gql(`
        query StashMiniGuiConfig {
          configuration { plugins }
        }
      `);
      const plugins = data?.configuration?.plugins || {};
      const raw = plugins[PLUGIN_ID] || {};
      state.config = {
        initialPosition: getConfigString(raw.initialPosition, CONFIG_DEFAULTS.initialPosition),
        launcherPosition: getConfigString(raw.launcherPosition, CONFIG_DEFAULTS.launcherPosition),
        keyboardShortcut: getConfigString(raw.keyboardShortcut, CONFIG_DEFAULTS.keyboardShortcut),
      };
    } catch (err) {
      console.warn("[StashMiniGUI] Config load failed", err);
      state.config = { ...CONFIG_DEFAULTS };
    }
  }

  function clampResultLimit(value, fallback = DEFAULT_RESULT_LIMIT) {
    const parsed = Math.round(Number(value));
    const safeFallback = Math.round(Number(fallback)) || DEFAULT_RESULT_LIMIT;
    return Math.max(MIN_RESULT_LIMIT, Math.min(MAX_RESULT_LIMIT, Number.isFinite(parsed) ? parsed : safeFallback));
  }

  function getStoredResultLimit() {
    try {
      return clampResultLimit(window.localStorage?.getItem(RESULT_LIMIT_KEY), DEFAULT_RESULT_LIMIT);
    } catch (_err) {
      return clampResultLimit(DEFAULT_RESULT_LIMIT);
    }
  }

  function loadAppSettings() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(APP_SETTINGS_KEY) || "{}");
      state.appSettings = {
        ...APP_SETTING_DEFAULTS,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
      };
      state.appSettings.customTagApps = (Array.isArray(state.appSettings.customTagApps) ? state.appSettings.customTagApps : [])
        .map((app) => normalizeCustomTagApp(app))
        .filter(Boolean);
      state.appSettings.customPresetApps = (Array.isArray(state.appSettings.customPresetApps) ? state.appSettings.customPresetApps : [])
        .map((app) => normalizeCustomPresetApp(app))
        .filter(Boolean);
      state.appSettings.customLinkApps = (Array.isArray(state.appSettings.customLinkApps) ? state.appSettings.customLinkApps : [])
        .map((app) => normalizeCustomLinkApp(app))
        .filter(Boolean);
      state.appSettings.appButtonImages = state.appSettings.appButtonImages && typeof state.appSettings.appButtonImages === "object" && !Array.isArray(state.appSettings.appButtonImages)
        ? state.appSettings.appButtonImages
        : {};
    } catch (_err) {
      state.appSettings = { ...APP_SETTING_DEFAULTS };
    }
  }

  function saveAppSettings() {
    try {
      window.localStorage?.setItem(APP_SETTINGS_KEY, JSON.stringify(state.appSettings));
    } catch (_err) {
      // localStorage is optional.
    }
    applyAppSettings();
  }

  function updateAppSetting(key, value) {
    state.appSettings = { ...state.appSettings, [key]: value };
    saveAppSettings();
  }

  function applyAppSettings() {
    if (!state.root) return;
    state.root.dataset.stashMiniTheme = String(state.appSettings.theme || APP_SETTING_DEFAULTS.theme);
    state.root.dataset.stashMiniPerformerSize = String(state.appSettings.performerCardSize || APP_SETTING_DEFAULTS.performerCardSize);
    state.root.dataset.stashMiniAppButtons = String(state.appSettings.appButtonStyle || APP_SETTING_DEFAULTS.appButtonStyle);
    state.root.dataset.stashMiniAppLayout = String(state.appSettings.appLayout || APP_SETTING_DEFAULTS.appLayout);
    state.root.classList.toggle("is-idle-dim-enabled", Boolean(state.appSettings.dimWhenIdle));
    state.root.classList.toggle("is-idle-minimize-enabled", Boolean(state.appSettings.minimizeOnIdle));
    state.root.classList.toggle("is-hover-open-enabled", Boolean(state.appSettings.hoverToOpen));
    const bgOpacity = getConfigNumber(state.appSettings.backgroundOpacity, APP_SETTING_DEFAULTS.backgroundOpacity, 0, 0.8);
    const panelScale = getConfigNumber(state.appSettings.panelScale || 1, 1, 0.65, 1.6);
    const idleOpacityRaw = state.appSettings.panelOpacity === "" ? APP_SETTING_DEFAULTS.panelOpacity : state.appSettings.panelOpacity;
    const idleOpacity = getConfigNumber(idleOpacityRaw, APP_SETTING_DEFAULTS.panelOpacity, 0, 1);
    const [launcherX, launcherY] = parsePair(state.config.launcherPosition, 96, 92, 0, 100, 0, 100);
    state.root.style.setProperty("--stash-mini-custom-bg", "none");
    state.root.style.setProperty("--stash-mini-bg-opacity", String(bgOpacity));
    state.root.style.setProperty("--stash-mini-bg-dim", String(1 - bgOpacity));
    state.root.style.setProperty("--stash-mini-scale", "1");
    state.root.style.setProperty("--stash-mini-content-zoom", String(panelScale));
    state.root.style.setProperty("--stash-mini-idle-opacity", String(idleOpacity));
    state.root.style.setProperty("--stash-mini-launcher-x", String(launcherX));
    state.root.style.setProperty("--stash-mini-launcher-y", String(launcherY));
    configureBackgroundSource(state.appSettings.backgroundImage);
  }

  function normalizeBackgroundImage(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/\/images\/([^/?#]+)/i);
    if (match?.[1]) return `/image/${match[1]}/image`;
    return raw;
  }

  function parseBackgroundSource(value) {
    const raw = String(value || "").trim();
    if (!raw) return { type: "none", key: "" };
    const gallery = raw.match(/(?:^gallery:|\/galleries\/)([^/?#,\s]+)/i);
    if (gallery?.[1]) return { type: "gallery", id: gallery[1], key: `gallery:${gallery[1]}` };
    const tag = raw.match(/(?:^tag:|\/tags\/)([^/?#,\s]+)/i);
    if (tag?.[1]) return { type: "tag", id: tag[1], key: `tag:${tag[1]}` };
    return { type: "url", url: normalizeBackgroundImage(raw), key: `url:${raw}` };
  }

  function configureBackgroundSource(value) {
    const source = parseBackgroundSource(value);
    if (source.key === state.backgroundSourceKey) return;
    state.backgroundSourceKey = source.key;
    window.clearInterval(state.backgroundTimer);
    state.backgroundTimer = 0;
    if (source.type === "none") {
      setBackgroundPool([]);
      return;
    }
    if (source.type === "url") {
      setBackgroundPool(source.url ? [source.url] : []);
      return;
    }
    loadBackgroundPool(source);
  }

  async function loadBackgroundPool(source) {
    try {
      const query = source.type === "gallery" ? BACKGROUND_GALLERY_QUERY : BACKGROUND_TAG_QUERY;
      const data = await gql(query, { id: [String(source.id)], limit: 30 });
      if (state.backgroundSourceKey !== source.key) return;
      const images = (data?.findImages?.images || [])
        .map((image) => image?.paths?.image || image?.paths?.preview || image?.paths?.thumbnail || "")
        .filter(Boolean);
      setBackgroundPool(images);
    } catch (err) {
      if (state.backgroundSourceKey === source.key) setBackgroundPool([]);
    }
  }

  function setBackgroundPool(images) {
    state.backgroundImages = Array.from(new Set(images.filter(Boolean)));
    state.backgroundLayerIndex = 0;
    state.backgroundLayers.forEach((layer) => {
      layer.style.backgroundImage = "none";
      layer.classList.remove("is-active");
    });
    if (!state.backgroundImages.length) return;
    showBackgroundImage(state.backgroundImages[0]);
    if (state.backgroundImages.length > 1) {
      state.backgroundTimer = window.setInterval(() => {
        state.backgroundLayerIndex = (state.backgroundLayerIndex + 1) % state.backgroundImages.length;
        showBackgroundImage(state.backgroundImages[state.backgroundLayerIndex]);
      }, 4000);
    }
  }

  function showBackgroundImage(url) {
    if (!url || state.backgroundLayers.length < 2) return;
    const nextLayer = state.backgroundLayers.find((layer) => !layer.classList.contains("is-active")) || state.backgroundLayers[0];
    state.backgroundLayers.forEach((layer) => layer.classList.remove("is-active"));
    nextLayer.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    nextLayer.classList.add("is-active");
  }

  function saveResultLimit(value) {
    try {
      window.localStorage?.setItem(RESULT_LIMIT_KEY, String(clampResultLimit(value, DEFAULT_RESULT_LIMIT)));
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function normalizeDirection(value) {
    return String(value || "").toUpperCase() === "ASC" ? "ASC" : "DESC";
  }

  function readTimedCache(key, ttlMs) {
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.data === undefined) return null;
      if (Date.now() - Number(parsed.savedAt || 0) > ttlMs) return null;
      return parsed.data;
    } catch (_err) {
      return null;
    }
  }

  function writeTimedCache(key, data) {
    try {
      window.localStorage?.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function clearOHistoryCache() {
    state.oHistorySceneCache = null;
    state.oHistorySceneRequest = null;
    try {
      window.localStorage?.removeItem(OHISTORY_SCENE_CACHE_KEY);
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function createElement(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function createIcon(className, fallback = "") {
    if (!className) return createElement("span", "", fallback);
    if (!/\s/.test(className) && !className.startsWith("fa-")) return createElement("span", "", className);
    const icon = document.createElement("i");
    icon.className = className;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function getStoredOpenState() {
    try {
      const stored = window.localStorage?.getItem(OPEN_KEY);
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch (_err) {
      // localStorage is optional.
    }
    return false;
  }

  function setStoredOpenState(open) {
    try {
      window.localStorage?.setItem(OPEN_KEY, open ? "true" : "false");
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function getInitialPosition() {
    try {
      const raw = JSON.parse(window.localStorage?.getItem(POSITION_KEY) || "null");
      if (raw && Number.isFinite(raw.left) && Number.isFinite(raw.top)) return raw;
    } catch (_err) {
      // Ignore malformed position state.
    }
    const [right, bottom] = parsePair(state.config.initialPosition, 22, 22, 0, 500, 0, 500);
    const [width, height] = getPanelDimensions();
    return {
      left: Math.max(8, window.innerWidth - width - right),
      top: Math.max(8, window.innerHeight - height - bottom),
    };
  }

  function getPanelDimensions() {
    const fallbackWidth = 390;
    const fallbackHeight = 680;
    const storedSize = getStoredPanelSize();
    if (storedSize) return storedSize;
    const rawSize = DEFAULT_PANEL_SIZE;
    return parsePair(rawSize, fallbackWidth, fallbackHeight, 280, 1100, 420, 920);
  }

  function getResponsiveLayout(width, height) {
    const panelWidth = Number(width);
    if (panelWidth >= 500) return "standard";
    return "compact";
  }

  function updateResponsiveLayout(width, height) {
    const layout = getResponsiveLayout(width, height);
    if (state.root) state.root.dataset.stashMiniLayout = layout;
  }

  function getStoredPanelSize() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(PANEL_SIZE_KEY) || "{}");
      if (Array.isArray(parsed) && Number.isFinite(parsed[0]) && Number.isFinite(parsed[1])) {
        return [
          Math.max(280, Math.min(1100, parsed[0])),
          Math.max(420, Math.min(920, parsed[1])),
        ];
      }
    } catch (_err) {
      // Ignore malformed local panel size.
    }
    return null;
  }

  function savePanelSize(width, height) {
    try {
      window.localStorage?.setItem(PANEL_SIZE_KEY, JSON.stringify([
        Math.max(280, Math.min(1100, Math.round(width))),
        Math.max(420, Math.min(920, Math.round(height))),
      ]));
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function applyPanelDimensions(width, height) {
    updateResponsiveLayout(width, height);
    state.root?.style.setProperty("--stash-mini-panel-width", `${width}px`);
    state.root?.style.setProperty("--stash-mini-panel-height", `${height}px`);
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    const next = clampPanelToViewport(rect.left, rect.top);
    state.panel.style.left = `${next.left}px`;
    state.panel.style.top = `${next.top}px`;
    savePosition(next.left, next.top);
  }

  function savePosition(left, top) {
    try {
      window.localStorage?.setItem(POSITION_KEY, JSON.stringify({ left, top }));
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function clampPanelToViewport(left, top) {
    const rect = state.panel?.getBoundingClientRect();
    const width = rect?.width || 390;
    const height = rect?.height || 680;
    return {
      left: Math.max(8, Math.min(window.innerWidth - Math.min(80, width), left)),
      top: Math.max(8, Math.min(window.innerHeight - Math.min(80, height), top)),
    };
  }

  function openMiniGui() {
    cancelIdleMinimize();
    state.isOpen = true;
    state.root?.classList.add("is-open");
    setStoredOpenState(true);
    renderActiveApp();
  }

  function closeMiniGui() {
    window.clearTimeout(state.idleMinimizeTimer);
    state.isOpen = false;
    state.root?.classList.remove("is-open");
    setStoredOpenState(false);
  }

  function scheduleIdleMinimize() {
    window.clearTimeout(state.idleMinimizeTimer);
    if (!state.appSettings.minimizeOnIdle || !state.isOpen) return;
    state.idleMinimizeTimer = window.setTimeout(() => {
      if (!state.appSettings.minimizeOnIdle || !state.isOpen) return;
      if (state.panel?.matches(":hover, :focus-within")) return;
      closeMiniGui();
    }, 1400);
  }

  function cancelIdleMinimize() {
    window.clearTimeout(state.idleMinimizeTimer);
  }

  function loadTabs() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(TABS_KEY) || "[]");
      state.tabs = Array.isArray(parsed) ? parsed.filter((tab) => tab?.id && tab?.app).slice(0, MAX_TABS) : [];
    } catch (_err) {
      state.tabs = [];
    }
  }

  function loadHistory() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(HISTORY_KEY) || "[]");
      state.history = Array.isArray(parsed) ? parsed.filter((tab) => tab?.id && tab?.app).slice(0, MAX_HISTORY) : [];
    } catch (_err) {
      state.history = [];
    }
  }

  function saveHistory() {
    try {
      window.localStorage?.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, MAX_HISTORY)));
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function saveTabs() {
    try {
      window.localStorage?.setItem(TABS_KEY, JSON.stringify(state.tabs.slice(0, MAX_TABS)));
    } catch (_err) {
      // localStorage is optional.
    }
  }

  function addMiniTab(tab) {
    if (!tab?.id || !tab?.app) return;
    state.tabs = [tab, ...state.tabs.filter((item) => item.id !== tab.id)].slice(0, MAX_TABS);
    saveTabs();
    renderBottomNav();
  }

  function addHistoryItem(tab) {
    if (!tab?.id || !tab?.app) return;
    state.history = [{ ...tab, touchedAt: Date.now() }, ...state.history.filter((item) => item.id !== tab.id)].slice(0, MAX_HISTORY);
    saveHistory();
  }

  function createTabPayload(type, item) {
    if (!item?.id) return null;
    const app = type === "scene" ? "sceneDetail" : type;
    if (!["performer", "sceneDetail", "image", "studio"].includes(app)) return null;
    const typeLabel = type === "scene" ? "Scene" : type.charAt(0).toUpperCase() + type.slice(1);
    return {
      id: `${app}:${item.id}`,
      app,
      payload: { id: String(item.id), fallback: item },
      label: getTitleForResult(type, item),
      type: typeLabel,
      image: getImageForResult(type, item),
    };
  }

  function toggleMiniGui() {
    if (state.isOpen) closeMiniGui();
    else openMiniGui();
  }

  function setApp(app, payload = null, options = {}) {
    const previous = { app: state.app, payload: state.appPayload };
    const changed = previous.app !== app || JSON.stringify(previous.payload || {}) !== JSON.stringify(payload || {});
    if (!options.skipHistory && changed && previous.app) {
      state.navStack.push(previous);
      state.navStack = state.navStack.slice(-30);
    }
    state.app = app;
    state.appPayload = payload;
    try {
      window.localStorage?.setItem(ACTIVE_APP_KEY, app);
    } catch (_err) {
      // localStorage is optional.
    }
    renderActiveApp();
  }

  function goBack() {
    const previous = state.navStack.pop();
    if (!previous) {
      setApp("home", null, { skipHistory: true });
      return;
    }
    setApp(previous.app, previous.payload || null, { skipHistory: true });
  }

  function getActiveApp() {
    try {
      const stored = String(window.localStorage?.getItem(ACTIVE_APP_KEY) || "").trim();
      const allowed = new Set(["home", "scene", "sceneDetail", "image", "performer", "studio", "tags", "search", "recent", "ohistory", "ohistoryDay", "tagApp", "presetApp", "settings", "pinned", "history"]);
      if (allowed.has(stored)) return stored;
    } catch (_err) {
      // localStorage is optional.
    }
    return "home";
  }

  function openPath(path, options = {}) {
    const url = String(path || "/").trim() || "/";
    if (options.newTab) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.assign(url);
  }

  function openPerformerInApp(id, fallback = {}) {
    if (!id) return;
    addHistoryItem(createTabPayload("performer", { ...fallback, id }));
    setApp("performer", { id: String(id), fallback });
    if (!state.isOpen) openMiniGui();
  }

  function openSceneInApp(id, fallback = {}) {
    if (!id) return;
    addHistoryItem(createTabPayload("scene", { ...fallback, id }));
    setApp("sceneDetail", { id: String(id), fallback });
    if (!state.isOpen) openMiniGui();
  }

  function openImageInApp(id, fallback = {}) {
    if (!id) return;
    addHistoryItem(createTabPayload("image", { ...fallback, id }));
    setApp("image", { id: String(id), fallback });
    if (!state.isOpen) openMiniGui();
  }

  function openStudioInApp(id, fallback = {}) {
    if (!id) return;
    addHistoryItem(createTabPayload("studio", { ...fallback, id }));
    setApp("studio", { id: String(id), fallback });
    if (!state.isOpen) openMiniGui();
  }

  function openCurrentSceneInApp() {
    const sceneId = getCurrentSceneId();
    if (sceneId) openSceneInApp(sceneId);
    else setApp("home");
    if (!state.isOpen) openMiniGui();
  }

  function makeActionButton(label, onClick, className = "") {
    const button = createElement("button", `stash-mini-gui-button ${className}`.trim(), label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function isPinnedContent(type, item) {
    const tab = createTabPayload(type, item);
    return Boolean(tab && state.tabs.some((existing) => existing.id === tab.id));
  }

  function togglePinnedContent(type, item) {
    const tab = createTabPayload(type, item);
    if (!tab) return;
    if (state.tabs.some((existing) => existing.id === tab.id)) {
      state.tabs = state.tabs.filter((existing) => existing.id !== tab.id);
      saveTabs();
      renderBottomNav();
      renderActiveApp();
      return;
    }
    addMiniTab(tab);
    renderActiveApp();
  }

  function createPinButton(type, item, className = "is-pin") {
    const button = makeIconActionButton("fa-solid fa-thumbtack", isPinnedContent(type, item) ? "Unpin" : "Pin", () => togglePinnedContent(type, item), className);
    button.classList.toggle("is-active", isPinnedContent(type, item));
    return button;
  }

  function createOpenStashButton(path) {
    return makeIconActionButton("fa-solid fa-box", "Open in new Stash tab", () => openPath(path, { newTab: true }), "is-subtle");
  }

  function createNewTabButton(path, label = "Open in new tab") {
    return makeIconActionButton("fa-solid fa-box", label, () => openPath(path, { newTab: true }), "is-subtle");
  }

  function createCopyLinkButton(path) {
    const button = makeIconActionButton("fa-solid fa-link", "Copy Stash link", async () => {
      const url = new URL(path, window.location.origin).toString();
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(url);
      } catch (_err) {
        const input = document.createElement("input");
        input.value = url;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      showCopyFeedback(button);
    }, "is-subtle");
    return button;
  }

  function showCopyFeedback(button) {
    if (!button) return;
    window.clearTimeout(button.__stashMiniCopyTimer);
    button.classList.add("is-copied");
    button.title = "Link copied";
    button.setAttribute("aria-label", "Link copied");
    button.__stashMiniCopyTimer = window.setTimeout(() => {
      button.classList.remove("is-copied");
      button.title = "Copy Stash link";
      button.setAttribute("aria-label", "Copy Stash link");
    }, 1100);
  }

  function makeIconActionButton(iconClass, label, onClick, className = "") {
    const button = makeActionButton("", onClick, `is-icon ${className}`.trim());
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(createIcon(iconClass, label.slice(0, 1)));
    return button;
  }

  function getCurrentSceneId() {
    const path = window.location.pathname || "";
    const match = path.match(/\/scenes\/([^/?#]+)/i);
    return match?.[1] || "";
  }

  function formatRating(rating100) {
    const value = Number(rating100);
    if (!Number.isFinite(value) || value <= 0) return "";
    const rating = value <= 10 ? value : value / 10;
    return String(Math.round(rating * 10) / 10);
  }

  function formatCount(value, label) {
    const count = Number(value) || 0;
    return `${count} ${label}${count === 1 ? "" : "s"}`;
  }

  function getContentPath(type, item) {
    if (!item?.id) return "/";
    if (type === "scene") return `/scenes/${item.id}`;
    if (type === "performer") return `/performers/${item.id}`;
    if (type === "studio") return `/studios/${item.id}`;
    if (type === "tag") return `/tags/${item.id}`;
    if (type === "gallery") return `/galleries/${item.id}`;
    if (type === "image") return `/images/${item.id}`;
    return "/";
  }

  function getImageForResult(type, item) {
    if (type === "scene") return item?.paths?.screenshot || item?.paths?.preview || "";
    if (type === "gallery") return item?.paths?.cover || item?.paths?.preview || "";
    if (type === "image") return item?.paths?.thumbnail || item?.paths?.preview || item?.paths?.image || "";
    return item?.image_path || "";
  }

  function getTitleForResult(type, item) {
    if (type === "scene") return item?.title || `Scene ${item?.id || ""}`;
    if (type === "gallery") return item?.title || `Gallery ${item?.id || ""}`;
    if (type === "image") return item?.title || `Image ${item?.id || ""}`;
    return item?.name || `${type} ${item?.id || ""}`;
  }

  function getMetaForResult(type, item) {
    const rating = formatRating(item?.rating100);
    const oCount = Number(item?.o_counter) > 0 ? formatCount(item?.o_counter, "O") : "";
    if (type === "scene") return [rating, oCount, item?.studio?.name, item?.date].filter(Boolean).join(" - ");
    if (type === "performer") return [formatRating(item?.rating100), formatCount(item?.o_counter, "O"), item?.disambiguation, Array.isArray(item?.alias_list) ? item.alias_list.slice(0, 2).join(", ") : ""].filter(Boolean).join(" - ");
    if (type === "image") return [rating, oCount, Array.isArray(item?.performers) ? item.performers.map((performer) => performer.name).slice(0, 2).join(", ") : ""].filter(Boolean).join(" - ");
    if (type === "gallery") return item?.date || "";
    if (type === "studio") return [rating, oCount, item?.parent_studio?.name].filter(Boolean).join(" - ");
    if (type === "tag") return [
      formatCount(item?.scene_count, "scene"),
      formatCount(item?.image_count, "image"),
    ].filter(Boolean).join(" - ");
    return "";
  }

  function getPerformerNamesForScene(item, limit = 4) {
    return Array.isArray(item?.performers)
      ? item.performers.map((performer) => performer?.name).filter(Boolean).slice(0, limit)
      : [];
  }

  function createResultCard(type, item) {
    const card = createElement("article", `stash-mini-gui-result stash-mini-gui-result--${type}`);
    const path = getContentPath(type, item);
    const image = getImageForResult(type, item);
    const titleText = getTitleForResult(type, item);
    const primaryAction = getAppOpenAction(type, item, path);
    if ((type === "studio" || type === "scene") && image) {
      card.style.setProperty("--stash-mini-result-bg", `url("${image.replace(/"/g, "%22")}")`);
    }

    const media = createElement("button", "stash-mini-gui-result__media");
    media.type = "button";
    media.setAttribute("aria-label", `Open ${titleText}`);
    media.addEventListener("click", primaryAction);
    if (image) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = image;
      media.appendChild(img);
    } else {
      media.textContent = type.slice(0, 2).toUpperCase();
    }

    const body = createElement("div", "stash-mini-gui-result__body");
    const title = createElement("button", "stash-mini-gui-result__title", titleText);
    title.type = "button";
    title.addEventListener("click", primaryAction);
    const metaText = getMetaForResult(type, item);
    const meta = createElement("div", "stash-mini-gui-result__meta", metaText || (type === "performer" ? type : ""));
    const scenePerformers = type === "scene" ? getPerformerNamesForScene(item) : [];
    if (!metaText && type !== "performer") meta.hidden = true;
    const actions = createElement("div", "stash-mini-gui-result__actions");
    if (type === "performer") {
      actions.append(
        createPinButton(type, item, "is-pin"),
        createCopyLinkButton(path),
        createOpenStashButton(path),
      );
    } else if (type === "scene") {
      actions.append(
        createPinButton(type, item, "is-pin"),
        createCopyLinkButton(path),
        createOpenStashButton(path),
      );
    } else if (type === "image") {
      actions.append(
        createPinButton(type, item, "is-pin"),
        createCopyLinkButton(path),
        createOpenStashButton(path),
      );
    } else if (type === "studio") {
      actions.append(
        createPinButton(type, item, "is-pin"),
        createCopyLinkButton(path),
        createOpenStashButton(path),
      );
    } else {
      actions.append(
        createCopyLinkButton(path),
        createOpenStashButton(path),
      );
    }
    body.append(title, meta);
    if (scenePerformers.length) body.appendChild(createElement("div", "stash-mini-gui-result__people", scenePerformers.join(" - ")));
    body.appendChild(actions);
    card.append(media, body);
    return card;
  }

  function getAppOpenAction(type, item, path) {
    if (type === "performer") return () => openPerformerInApp(item.id, item);
    if (type === "scene") return () => openSceneInApp(item.id, item);
    if (type === "image") return () => openImageInApp(item.id, item);
    if (type === "studio") return () => openStudioInApp(item.id, item);
    if (type === "tag") return () => setApp("tagApp", { label: item.name, tagId: item.id, contentType: "scene", sort: "updated_at", direction: "DESC" });
    return () => openPath(path);
  }

  function renderHome() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    const currentSceneId = getCurrentSceneId();

    const widget = createHomeWidget(currentSceneId);
    if (widget) screen.appendChild(widget);
    const slideshow = createSlideshowWidget();
    if (slideshow) screen.appendChild(slideshow);

    const grid = createElement("div", "stash-mini-gui-app-grid");
    const visibleApps = getOrderedAppEntries().filter((app) => !isAppHidden(app.key));
    visibleApps.forEach((app) => {
      const button = createElement("button", "stash-mini-gui-app");
      button.type = "button";
      button.addEventListener("click", () => {
        if (app.customTag) setApp("tagApp", app.customTag);
        else if (app.customPreset) setApp("presetApp", app.customPreset);
        else if (app.customLink) openPath(app.customLink.url, { newTab: true });
        else if (app.type) setApp("recent", { type: app.type });
        else setApp(app.app || app.key);
      });
      button.append(
        createAppIcon(app.icon, app.label.slice(0, 1)),
        createElement("span", "stash-mini-gui-app__label", app.label),
        createElement("span", "stash-mini-gui-app__note", app.note),
      );
      const badgeCount = getHomeAppBadgeCount(app.key);
      if (badgeCount > 0) button.appendChild(createElement("span", "stash-mini-gui-app__badge", String(badgeCount)));
      if (!applyCustomAppImageToButton(button, app.key, app.image) && app.customTag?.useTagImage) applyTagImageToAppButton(button, app.customTag);
      grid.appendChild(button);
    });
    if (!visibleApps.length) {
      grid.appendChild(createElement("div", "stash-mini-gui-empty", "All home apps are hidden. Open Settings to show apps again."));
    }
    screen.appendChild(grid);

    return screen;
  }

  function applyTagImageToAppButton(button, app) {
    if (!button || !app?.tagId) return;
    gql(TAG_IMAGE_QUERY, { id: String(app.tagId) })
      .then((data) => {
        const image = data?.findTag?.image_path || "";
        if (!image || !button.isConnected) return;
        button.classList.add("is-tag-image");
        button.style.setProperty("--stash-mini-app-bg", `url("${image.replace(/"/g, "%22")}")`);
      })
      .catch(() => {});
  }

  function getAppButtonImages() {
    return state.appSettings.appButtonImages && typeof state.appSettings.appButtonImages === "object" && !Array.isArray(state.appSettings.appButtonImages)
      ? state.appSettings.appButtonImages
      : {};
  }

  function getAppButtonImage(key, fallback = "") {
    return String(getAppButtonImages()[key] || fallback || "").trim();
  }

  function updateAppButtonImage(key, value) {
    const images = { ...getAppButtonImages() };
    const normalized = normalizeBackgroundImage(value);
    if (normalized) images[key] = normalized;
    else delete images[key];
    updateAppSetting("appButtonImages", images);
  }

  function getHomeAppBadgeCount(key) {
    if (key === "pinned") return state.tabs.length;
    if (key === "history") return state.history.length;
    return 0;
  }

  function applyCustomAppImageToButton(button, key, fallback = "") {
    const image = getAppButtonImage(key, fallback);
    if (!button || !image) return false;
    button.classList.add("is-custom-image");
    button.style.setProperty("--stash-mini-app-bg", `url("${image.replace(/"/g, "%22")}")`);
    return true;
  }

  function createAppIcon(iconClass, fallback) {
    const wrap = createElement("span", "stash-mini-gui-app__icon");
    wrap.appendChild(createIcon(iconClass, fallback));
    return wrap;
  }

  function createHomeWidget(currentSceneId) {
    const section = createElement("section", "stash-mini-gui-section stash-mini-gui-home-widget");
    if (currentSceneId) {
      section.classList.add("is-widget-card");
      section.appendChild(createElement("div", "stash-mini-gui-loading", "Loading scene widget..."));
      loadSceneWidget(currentSceneId, section);
      return section;
    }
    section.classList.add("is-widget-card");
    section.appendChild(createElement("div", "stash-mini-gui-empty stash-mini-gui-empty-widget", "No active scene. Open a scene in Stash and this widget becomes your Stash Mini Gui scene view."));
    return section;
  }

  async function loadSceneWidget(sceneId, section) {
    try {
      const data = await gql(SCENE_DETAIL_QUERY, { id: sceneId });
      const scene = data?.findScene;
      if (!scene || !section?.isConnected) return;
      section.replaceChildren();
      const card = createElement("article", "stash-mini-gui-scene-widget");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, a")) return;
        openCurrentSceneInApp();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openCurrentSceneInApp();
      });
      const image = scene.paths?.screenshot || scene.paths?.preview || "";
      if (image) card.style.setProperty("--stash-mini-widget-bg", `url("${image.replace(/"/g, "%22")}")`);
      const kicker = createElement("span", "stash-mini-gui-scene-widget__kicker");
      kicker.append(createIcon("fa-solid fa-play", "Play"), document.createTextNode(" Current Scene"));
      const rating = formatRating(scene.rating100);
      if (rating) card.appendChild(createElement("span", "stash-mini-gui-scene-widget__rating", rating));
      const stats = createElement("span", "stash-mini-gui-scene-widget__stats");
      const organized = scene.organized === true ? "Organized" : scene.organized === false ? "Unorganized" : "";
      stats.textContent = [scene.date, formatCount(scene.o_counter, "O"), organized].filter(Boolean).join(" - ");
      const sceneTitle = createElement("strong", "", scene.title || "Current scene");
      const people = createElement("small", "stash-mini-gui-scene-widget__people");
      if (scene.studio?.id) {
        people.appendChild(makeActionButton(scene.studio.name || "Studio", () => openStudioInApp(scene.studio.id, scene.studio), "is-subtle is-compact"));
      } else if (scene.studio?.name) {
        people.appendChild(createElement("span", "", scene.studio.name));
      }
      const performerNames = (scene.performers || []).map((performer) => performer.name).filter(Boolean).slice(0, 4).join(" - ");
      if (performerNames) people.appendChild(createElement("span", "", performerNames));
      card.append(
        kicker,
        sceneTitle,
        people,
        stats,
      );
      section.appendChild(card);
    } catch (_err) {
      section.replaceChildren(createElement("div", "stash-mini-gui-empty", "Scene widget unavailable."));
    }
  }

  function createSlideshowWidget() {
    if (!state.appSettings.slideshowEnabled) return null;
    const section = createElement("section", "stash-mini-gui-section stash-mini-gui-home-widget stash-mini-gui-slideshow-section");
    section.classList.add("is-widget-card");
    section.appendChild(createElement("div", "stash-mini-gui-loading", "Loading slideshow widget..."));
    loadSlideshowWidget(section);
    return section;
  }

  async function loadSlideshowWidget(section) {
    const contentType = RECENT_TYPES.has(state.appSettings.slideshowContentType) && state.appSettings.slideshowContentType !== "all"
      ? state.appSettings.slideshowContentType
      : "scene";
    const sortKey = RECENT_SORTS[state.appSettings.slideshowSort] ? state.appSettings.slideshowSort : "updated_at";
    const tagId = parseTagId(state.appSettings.slideshowTag || "");
    const direction = sortKey === "alphabetical" ? "ASC" : "DESC";
    const filters = {
      ratedOnly: Boolean(state.appSettings.slideshowRatedOnly),
      oFilter: ["any", "has", "none"].includes(state.appSettings.slideshowOFilter) ? state.appSettings.slideshowOFilter : "any",
    };
    const limit = getConfigNumber(state.appSettings.slideshowMaxContent, APP_SETTING_DEFAULTS.slideshowMaxContent, 1, MAX_RESULT_LIMIT);
    const useTagFilter = Boolean(tagId && contentType !== "tag");
    const variables = useTagFilter ? { tagId, limit, page: 1 } : { limit, page: 1 };
    try {
      let data;
      try {
        data = await gql(useTagFilter ? buildTagAppQuery(contentType, sortKey, direction) : buildContentQuery(contentType, sortKey, direction), variables);
      } catch (err) {
        const fallbackSort = RECENT_SORTS[sortKey]?.fallback || "updated_at";
        if (!/invalid sort/i.test(String(err?.message || "")) || fallbackSort === getRecentSort(contentType, sortKey)) throw err;
        data = await gql(useTagFilter ? buildTagAppQuery(contentType, fallbackSort, direction) : buildContentQuery(contentType, fallbackSort, direction), variables);
      }
      const items = filterFinderItems(data?.items?.nodes || [], filters);
      if (!section?.isConnected) return;
      if (!items.length) {
        section.replaceChildren(createElement("div", "stash-mini-gui-empty", "Slideshow has no matching content. Click Settings to change the widget rules."));
        return;
      }
      renderSlideshowCard(section, contentType, sortKey, items, 0);
    } catch (err) {
      if (section?.isConnected) section.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Slideshow unavailable: ${err.message}`));
    }
  }

  function renderSlideshowCard(section, type, sortKey, items, index) {
    window.clearTimeout(state.slideshowTimer);
    if (!section?.isConnected || state.app !== "home") return;
    const safeItems = items.filter(Boolean);
    if (!safeItems.length) return;
    if (type === "performer") {
      renderSlideshowPerformerPair(section, sortKey, safeItems, index);
      return;
    }
    const item = safeItems[index % safeItems.length];
    const image = getImageForResult(type, item);
    const title = getTitleForResult(type, item);
    const path = getContentPath(type, item);
    const primaryAction = getAppOpenAction(type, item, path);
    const duration = getConfigNumber(state.appSettings.slideshowDuration, APP_SETTING_DEFAULTS.slideshowDuration, 1500, 30000);
    const card = createElement("article", "stash-mini-gui-scene-widget stash-mini-gui-slideshow-widget");
    card.classList.add(`stash-mini-gui-slideshow-widget--${type}`);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.title = `Open ${title} in Stash Mini Gui`;
    if (image) card.style.setProperty("--stash-mini-widget-bg", `url("${image.replace(/"/g, "%22")}")`);
    const openContent = (event) => {
      if (event.target.closest("button, a")) return;
      primaryAction();
    };
    card.addEventListener("click", openContent);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      primaryAction();
    });

    card.appendChild(createElement("span", "stash-mini-gui-slideshow-header", getSlideshowHeader(type, sortKey)));
    const meta = getSlideshowMeta(type, item);
    const performers = type === "scene" ? getPerformerNamesForScene(item, 5) : [];
    card.append(
      createElement("strong", "", title),
      createElement("small", "", meta || "Slideshow pick"),
    );
    if (performers.length) card.appendChild(createElement("div", "stash-mini-gui-result__people stash-mini-gui-slideshow-people", performers.join(" - ")));
    if (state.appSettings.slideshowProgressBar) {
      const progress = createElement("div", "stash-mini-gui-slideshow-progress");
      progress.style.setProperty("--stash-mini-slideshow-duration", `${duration}ms`);
      card.appendChild(progress);
    }
    section.replaceChildren(card);

    if (safeItems.length > 1) {
      state.slideshowTimer = window.setTimeout(() => renderSlideshowCard(section, type, sortKey, safeItems, index + 1), duration);
    }
  }

  function renderSlideshowPerformerPair(section, sortKey, items, index) {
    const duration = getConfigNumber(state.appSettings.slideshowDuration, APP_SETTING_DEFAULTS.slideshowDuration, 1500, 30000);
    const pair = [items[index % items.length]];
    if (items.length > 1) pair.push(items[(index + 1) % items.length]);
    const card = createElement("article", "stash-mini-gui-scene-widget stash-mini-gui-slideshow-widget stash-mini-gui-slideshow-widget--performer-pair");
    card.appendChild(createElement("span", "stash-mini-gui-slideshow-header", getSlideshowHeader("performer", sortKey)));
    const grid = createElement("div", "stash-mini-gui-slideshow-performers");
    pair.forEach((performer) => grid.appendChild(createSlideshowPerformerTile(performer)));
    card.appendChild(grid);
    if (state.appSettings.slideshowProgressBar) {
      const progress = createElement("div", "stash-mini-gui-slideshow-progress");
      progress.style.setProperty("--stash-mini-slideshow-duration", `${duration}ms`);
      card.appendChild(progress);
    }
    section.replaceChildren(card);
    if (items.length > 1) {
      state.slideshowTimer = window.setTimeout(() => renderSlideshowCard(section, "performer", sortKey, items, index + 2), duration);
    }
  }

  function createSlideshowPerformerTile(performer) {
    const tile = createElement("button", "stash-mini-gui-slideshow-performer");
    tile.type = "button";
    tile.title = `Open ${getTitleForResult("performer", performer)} in Stash Mini Gui`;
    tile.addEventListener("click", () => openPerformerInApp(performer.id, performer));
    const image = getImageForResult("performer", performer);
    const media = createElement("span", "stash-mini-gui-slideshow-performer__media");
    if (image) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = image;
      media.appendChild(img);
    }
    const label = createElement("span", "stash-mini-gui-slideshow-performer__label");
    label.append(
      createElement("strong", "", getTitleForResult("performer", performer)),
      createElement("small", "", getSlideshowMeta("performer", performer)),
    );
    tile.append(media, label);
    return tile;
  }

  function getSlideshowHeader(type, sortKey) {
    const typeLabels = { scene: "Scenes", performer: "Performers", image: "Images", studio: "Studios", tag: "Tags" };
    const sortLabel = RECENT_SORTS[sortKey]?.label || RECENT_SORTS.updated_at.label;
    return `${typeLabels[type] || "Content"} by ${sortLabel.toLowerCase()}`;
  }

  function getSlideshowMeta(type, item) {
    if (type === "performer") {
      return [formatRating(item?.rating100), Number(item?.o_counter) > 0 ? formatCount(item?.o_counter, "O") : ""].filter(Boolean).join(" - ");
    }
    return getMetaForResult(type, item);
  }

  function renderSearch() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader("Finder"));

    const controls = createElement("div", "stash-mini-gui-control-row stash-mini-gui-control-row--compact");
    const typeFilter = createSelect("stash-mini-gui-type-filter", [
      ["all", "All"],
      ["performer", "Performers"],
      ["scene", "Scenes"],
      ["image", "Images"],
      ["studio", "Studios"],
      ["tag", "Tags"],
    ]);
    const sortFilter = createSelect("stash-mini-gui-search-sort", Object.entries(RECENT_SORTS).map(([key, value]) => [key, value.label]), "updated_at");
    const directionFilter = createSelect("stash-mini-gui-search-direction", [
      ["DESC", "Descending"],
      ["ASC", "Ascending"],
    ], "DESC");
    const ratedOnly = createFinderToggle("Rated only");
    const oFilter = createSelect("stash-mini-gui-search-o-filter", [
      ["any", "Any O"],
      ["has", "Has O"],
      ["none", "No O"],
    ], "any");
    let page = 1;
    let limit = getStoredResultLimit();
    const limitControl = createResultLimitControl(limit, (value) => {
      limit = value;
      page = 1;
      scheduleSearch();
    });
    controls.append(typeFilter, sortFilter, directionFilter, limitControl, ratedOnly, oFilter);

    const input = document.createElement("input");
    input.className = "stash-mini-gui-input";
    input.type = "search";
    input.placeholder = "Type at least 2 characters...";
    input.autocomplete = "off";

    const results = createElement("div", "stash-mini-gui-results");
    const hint = createElement("div", "stash-mini-gui-empty", "Start typing to search your Stash.");
    results.appendChild(hint);
    const pager = createPager(() => page, (nextPage) => {
      page = nextPage;
      scheduleSearch(0);
    });

    const scheduleSearch = (delay = 220) => {
      window.clearTimeout(state.searchTimer);
      const q = input.value.trim();
      const type = typeFilter.value;
      state.searchTimer = window.setTimeout(() => {
        updatePager(pager, page);
        runMiniSearch(q, results, type, { limit, page, sort: sortFilter.value, direction: directionFilter.value, ratedOnly: Boolean(ratedOnly.querySelector("input")?.checked), oFilter: oFilter.value });
      }, delay);
    };

    input.addEventListener("input", () => {
      page = 1;
      scheduleSearch();
    });
    typeFilter.addEventListener("change", () => {
      page = 1;
      scheduleSearch();
    });
    [sortFilter, directionFilter, ratedOnly, oFilter].forEach((control) => {
      control.addEventListener("change", () => {
        page = 1;
        scheduleSearch(0);
      });
    });

    updatePager(pager, page);
    screen.append(input, controls, pager, results);
    setTimeout(() => input.focus(), 50);
    return screen;
  }

  function createFinderToggle(labelText) {
    const label = createElement("label", "stash-mini-gui-limit stash-mini-gui-finder-toggle");
    const input = document.createElement("input");
    input.type = "checkbox";
    label.append(createElement("span", "", labelText), input);
    return label;
  }

  function renderTags() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader("Tags"));
    const controls = createElement("div", "stash-mini-gui-control-row stash-mini-gui-control-row--compact");
    const sortFilter = createSelect("stash-mini-gui-tag-browser-sort", Object.entries(TAG_SORTS).map(([key, value]) => [key, value.label]), "name");
    const directionFilter = createSelect("stash-mini-gui-tag-browser-direction", [
      ["ASC", "Ascending"],
      ["DESC", "Descending"],
    ], "ASC");
    let page = 1;
    let limit = getStoredResultLimit();
    const limitControl = createResultLimitControl(limit, (value) => {
      limit = value;
      page = 1;
      reload();
    });
    controls.append(sortFilter, directionFilter, limitControl);
    const input = document.createElement("input");
    input.className = "stash-mini-gui-input";
    input.type = "search";
    input.placeholder = "Search tags...";
    input.autocomplete = "off";
    const body = createElement("div", "stash-mini-gui-results");
    const pager = createPager(() => page, (nextPage) => {
      page = nextPage;
      reload();
    });
    const reload = () => {
      updatePager(pager, page);
      loadTags(body, input.value.trim(), limit, page, sortFilter.value, directionFilter.value);
    };
    let timer = 0;
    input.addEventListener("input", () => {
      window.clearTimeout(timer);
      page = 1;
      timer = window.setTimeout(reload, 180);
    });
    [sortFilter, directionFilter].forEach((control) => {
      control.addEventListener("change", () => {
        page = 1;
        reload();
      });
    });
    screen.append(input, controls, pager, body);
    reload();
    return screen;
  }

  async function loadTags(body, q, limit, page, sortKey = "name", direction = "ASC") {
    body.replaceChildren(createElement("div", "stash-mini-gui-loading", "Loading tags..."));
    try {
      const variables = { q: String(q || ""), limit: clampResultLimit(limit, DEFAULT_RESULT_LIMIT), page: Math.max(1, Math.round(Number(page)) || 1) };
      let data;
      try {
        data = await gql(buildTagBrowserQuery(sortKey, direction, true), variables);
      } catch (err) {
        const isSchemaFallback = /image_path|scene_count|image_count|invalid sort/i.test(String(err?.message || ""));
        if (!isSchemaFallback) throw err;
        data = await gql(buildTagBrowserQuery("name", "ASC", false), variables);
      }
      const tags = data?.findTags?.tags || [];
      body.replaceChildren();
      if (!tags.length) {
        body.appendChild(createElement("div", "stash-mini-gui-empty", "No tags found."));
        return;
      }
      const section = createElement("section", "stash-mini-gui-section stash-mini-gui-section--tag");
      section.appendChild(createElement("h4", "", "Tags"));
      const list = createElement("div", "stash-mini-gui-result-list stash-mini-gui-result-list--tag");
      tags.forEach((tag) => list.appendChild(createResultCard("tag", tag)));
      section.appendChild(list);
      body.appendChild(section);
    } catch (err) {
      console.warn("[StashMiniGUI] Tags failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Tags failed: ${err.message}`));
    }
  }

  function buildTagBrowserQuery(sortKey = "name", direction = "ASC", includeCounts = true) {
    const sort = TAG_SORTS[sortKey]?.sort || "name";
    const safeDirection = normalizeDirection(direction);
    const fields = includeCounts ? "id name image_path scene_count image_count" : "id name";
    return `query StashMiniTags($q: String!, $limit: Int!, $page: Int!) { findTags(filter: { q: $q, per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { tags { ${fields} } } }`;
  }

  function createSelect(className, entries, selected = "") {
    const select = document.createElement("select");
    select.className = `stash-mini-gui-select ${className || ""}`.trim();
    entries.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === selected;
      select.appendChild(option);
    });
    return select;
  }

  function createResultLimitControl(value, onChange) {
    const label = createElement("label", "stash-mini-gui-limit");
    label.appendChild(createElement("span", "", "Results"));
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(MIN_RESULT_LIMIT);
    input.max = String(MAX_RESULT_LIMIT);
    input.step = "1";
    input.value = String(clampResultLimit(value, DEFAULT_RESULT_LIMIT));
    input.addEventListener("change", () => {
      const next = clampResultLimit(input.value, DEFAULT_RESULT_LIMIT);
      input.value = String(next);
      saveResultLimit(next);
      onChange(next);
    });
    label.appendChild(input);
    return label;
  }

  function createPerformerColumnControl(value, onChange) {
    const label = createElement("label", "stash-mini-gui-limit stash-mini-gui-column-slider");
    const text = createElement("span", "", "Columns");
    const output = createElement("strong", "", String(value));
    const input = document.createElement("input");
    input.type = "range";
    input.min = "1";
    input.max = "5";
    input.step = "1";
    input.value = String(value);
    input.addEventListener("input", () => {
      const next = Math.max(1, Math.min(5, Math.round(Number(input.value) || 2)));
      output.textContent = String(next);
      onChange(next);
    });
    label.append(text, input, output);
    return label;
  }

  function createPager(getPage, onPageChange) {
    const pager = createElement("div", "stash-mini-gui-pager");
    const prev = makeActionButton("Prev", () => onPageChange(Math.max(1, getPage() - 1)), "is-subtle is-compact");
    const label = createElement("span", "stash-mini-gui-page-label", "");
    const next = makeActionButton("Next", () => onPageChange(getPage() + 1), "is-subtle is-compact");
    pager.append(prev, label, next);
    updatePager(pager, getPage());
    return pager;
  }

  function updatePager(pager, page) {
    const safePage = Math.max(1, Math.round(Number(page)) || 1);
    const prev = pager?.querySelector("button:first-child");
    const label = pager?.querySelector(".stash-mini-gui-page-label");
    if (prev) prev.disabled = safePage <= 1;
    if (label) label.textContent = `Page ${safePage}`;
  }

  async function runMiniSearch(q, resultsNode, typeFilter = "all", options = {}) {
    resultsNode.replaceChildren();
    if (q.length < 2) {
      resultsNode.appendChild(createElement("div", "stash-mini-gui-empty", "Type at least 2 characters."));
      return;
    }
    resultsNode.appendChild(createElement("div", "stash-mini-gui-loading", "Searching..."));
    try {
      const limit = clampResultLimit(options.limit, DEFAULT_RESULT_LIMIT);
      const page = Math.max(1, Math.round(Number(options.page)) || 1);
      const searchDirection = normalizeDirection(options.direction);
      const searchSort = RECENT_SORTS[options.sort] ? options.sort : "updated_at";
      const searchFilters = { ratedOnly: Boolean(options.ratedOnly), oFilter: ["any", "has", "none"].includes(options.oFilter) ? options.oFilter : "any" };
      if (typeFilter === "tag") {
        const tagSort = TAG_SORTS[searchSort] ? searchSort : "name";
        const data = await gql(buildTagBrowserQuery(tagSort, searchDirection, true), { q, limit, page });
        const items = data?.findTags?.tags || [];
        resultsNode.replaceChildren();
        if (!items.length) {
          resultsNode.appendChild(createElement("div", "stash-mini-gui-empty", "No tags found."));
          return;
        }
        const section = createElement("section", "stash-mini-gui-section stash-mini-gui-section--tag");
        section.appendChild(createElement("h4", "", "Tags"));
        const list = createElement("div", "stash-mini-gui-result-list stash-mini-gui-result-list--tag");
        items.forEach((item) => list.appendChild(createResultCard("tag", item)));
        section.appendChild(list);
        resultsNode.appendChild(section);
        return;
      }
      if (typeFilter !== "all") {
        const data = await gql(buildContentQuery(typeFilter, searchSort, searchDirection, "", true), { limit, page, q });
        const items = filterFinderItems(data?.items?.nodes || [], searchFilters);
        resultsNode.replaceChildren();
        if (!items.length) {
          resultsNode.appendChild(createElement("div", "stash-mini-gui-empty", "No results."));
          return;
        }
        const labels = { scene: "Scenes", performer: "Performers", image: "Images", studio: "Studios" };
        const section = createElement("section", `stash-mini-gui-section stash-mini-gui-section--${typeFilter}`);
        section.appendChild(createElement("h4", "", labels[typeFilter] || "Results"));
        const list = createElement("div", `stash-mini-gui-result-list stash-mini-gui-result-list--${typeFilter}`);
        if (typeFilter === "performer") list.style.setProperty("--stash-mini-performer-columns", String(options.performerColumns || state.appSettings.performerColumns || 2));
        items.forEach((item) => list.appendChild(createResultCard(typeFilter, item)));
        section.appendChild(list);
        resultsNode.appendChild(section);
        return;
      }
      const data = await gql(SEARCH_QUERY, { q, limit, page });
      let imageItems = [];
      try {
        const imageData = await gql(IMAGE_SEARCH_QUERY, { q, limit, page });
        imageItems = imageData?.images?.images || [];
      } catch (_err) {
        // Image search is optional in the unified finder.
      }
      let tagItems = [];
      try {
        const tagData = await gql(buildTagBrowserQuery("name", "ASC", true), { q, limit, page });
        tagItems = tagData?.findTags?.tags || [];
      } catch (_err) {
        // Tag search is optional in the unified finder.
      }

      const groups = [
        ["scene", "Scenes", data?.scenes?.scenes || []],
        ["performer", "Performers", data?.performers?.performers || []],
        ["studio", "Studios", data?.studios?.studios || []],
        ["image", "Images", imageItems],
        ["tag", "Tags", tagItems],
      ].map(([type, label, items]) => [type, label, filterFinderItems(items, searchFilters)])
        .filter(([type, , items]) => items.length && (typeFilter === "all" || typeFilter === type));

      resultsNode.replaceChildren();
      if (!groups.length) {
        resultsNode.appendChild(createElement("div", "stash-mini-gui-empty", "No results."));
        return;
      }
      groups.forEach(([type, label, items]) => {
        const section = createElement("section", `stash-mini-gui-section stash-mini-gui-section--${type}`);
        section.appendChild(createElement("h4", "", label));
        const list = createElement("div", `stash-mini-gui-result-list stash-mini-gui-result-list--${type}`);
        if (type === "performer") list.style.setProperty("--stash-mini-performer-columns", String(options.performerColumns || 2));
        items.forEach((item) => list.appendChild(createResultCard(type, item)));
        section.appendChild(list);
        resultsNode.appendChild(section);
      });
    } catch (err) {
      console.warn("[StashMiniGUI] Search failed", err);
      resultsNode.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Search failed: ${err.message}`));
    }
  }

  function filterFinderItems(items, filters = {}) {
    return (items || []).filter((item) => {
      if (filters.ratedOnly && !(Number(item?.rating100) > 0)) return false;
      const oCount = Number(item?.o_counter) || 0;
      if (filters.oFilter === "has" && oCount <= 0) return false;
      if (filters.oFilter === "none" && oCount > 0) return false;
      return true;
    });
  }

  function createBackHeader(title) {
    const header = createElement("div", "stash-mini-gui-app-header");
    const back = makeActionButton("Back", goBack, "is-subtle");
    const text = createElement("div", "stash-mini-gui-app-header__text");
    text.append(createElement("h3", "", title));
    header.append(back, text);
    return header;
  }

  function renderRecent() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    const initialType = RECENT_TYPES.has(state.appPayload?.type) ? state.appPayload.type : "all";
    const typeLabels = { all: "Recent", scene: "Scenes", performer: "Performers", image: "Images", studio: "Studios", tag: "Tags" };
    screen.appendChild(createBackHeader(typeLabels[initialType] || "Recent"));
    const isLockedType = initialType !== "all";
    const controls = createElement("div", isLockedType ? "stash-mini-gui-control-row stash-mini-gui-control-row--compact" : "stash-mini-gui-control-row");
    const typeFilter = isLockedType
      ? { value: initialType, addEventListener: () => {} }
      : createSelect("stash-mini-gui-recent-type", [
        ["all", "All"],
        ["performer", "Performers"],
        ["scene", "Scenes"],
        ["image", "Images"],
        ["studio", "Studios"],
        ["tag", "Tags"],
      ], initialType);
    const sortFilter = createSelect("stash-mini-gui-recent-sort", Object.entries(RECENT_SORTS).map(([key, value]) => [key, value.label]), "updated_at");
    const directionFilter = createSelect("stash-mini-gui-recent-direction", [
      ["DESC", "Descending"],
      ["ASC", "Ascending"],
    ], "DESC");
    let page = 1;
    let limit = getStoredResultLimit();
    const appSearch = document.createElement("input");
    appSearch.className = "stash-mini-gui-input";
    appSearch.type = "search";
    appSearch.placeholder = `Search ${typeLabels[initialType] || "content"}...`;
    appSearch.autocomplete = "off";
    let performerColumns = Math.max(1, Math.min(5, Math.round(Number(state.appSettings.performerColumns) || APP_SETTING_DEFAULTS.performerColumns)));
    const performerColumnsControl = createPerformerColumnControl(performerColumns, (value) => {
      performerColumns = value;
      updateAppSetting("performerColumns", value);
      reload();
    });
    const limitControl = createResultLimitControl(limit, (value) => {
      limit = value;
      page = 1;
      reload();
    });
    if (isLockedType) controls.append(sortFilter, directionFilter, limitControl);
    else controls.append(typeFilter, sortFilter, directionFilter, limitControl);
    const body = createElement("div", "stash-mini-gui-results");
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading recent items..."));
    const pager = createPager(() => page, (nextPage) => {
      page = nextPage;
      reload();
    });
    const reload = () => {
      updatePager(pager, page);
      const query = appSearch.value.trim();
      if (query.length >= 2 && typeFilter.value !== "all") {
        runMiniSearch(query, body, typeFilter.value, { limit, page, performerColumns });
      } else {
        loadRecent(body, { type: typeFilter.value, sort: sortFilter.value, direction: directionFilter.value, limit, page, performerColumns });
      }
    };
    let searchTimer = 0;
    appSearch.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      page = 1;
      searchTimer = window.setTimeout(reload, 180);
    });
    [typeFilter, sortFilter, directionFilter].forEach((control) => {
      control.addEventListener("change", () => {
        page = 1;
        performerColumnsControl.hidden = typeFilter.value !== "performer";
        reload();
      });
    });
    performerColumnsControl.hidden = initialType !== "performer";
    screen.append(appSearch, controls, performerColumnsControl, pager, body);
    reload();
    return screen;
  }

  function getRecentSort(type, sortKey) {
    if (type === "tag") {
      if (sortKey === "scene_count" || sortKey === "image_count") return TAG_SORTS[sortKey].sort;
      return "name";
    }
    const rule = RECENT_SORTS[sortKey] || RECENT_SORTS.updated_at;
    return rule[type] || "updated_at";
  }

  function buildRecentQuery(type, sortKey, direction, sortOverride = "") {
    return buildContentQuery(type, sortKey, direction, sortOverride, false);
  }

  function buildContentQuery(type, sortKey, direction, sortOverride = "", withQuery = false) {
    const safeType = RECENT_TYPES.has(type) && type !== "all" ? type : "scene";
    const safeDirection = normalizeDirection(direction);
    const sort = sortOverride || getRecentSort(safeType, sortKey);
    const qPart = withQuery ? "q: $q, " : "";
    const parts = [];
    if (safeType === "scene") parts.push(`items: findScenes(filter: { ${qPart}per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: scenes { id title date o_counter rating100 studio { id name image_path } performers { id name } paths { screenshot preview } } }`);
    if (safeType === "performer") parts.push(`items: findPerformers(filter: { ${qPart}per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: performers { id name disambiguation alias_list image_path rating100 o_counter scene_count image_count } }`);
    if (safeType === "image") parts.push(`items: findImages(filter: { ${qPart}per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: images { id title o_counter rating100 paths { thumbnail preview image } performers { name } } }`);
    if (safeType === "studio") parts.push(`items: findStudios(filter: { ${qPart}per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: studios { id name image_path rating100 parent_studio { id name image_path } } }`);
    if (safeType === "tag") parts.push(`items: findTags(filter: { ${qPart}per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: tags { id name image_path scene_count image_count } }`);
    return `query StashMiniContent($limit: Int!, $page: Int!${withQuery ? ", $q: String!" : ""}) { ${parts.join("\n")} }`;
  }

  async function loadRecentType(type, sortKey, direction, limit, page) {
    const cacheKey = `${type}|${sortKey}|${direction}|${limit}|${page}`;
    if (!state.recentCache) state.recentCache = readTimedCache(RECENT_CACHE_KEY, RECENT_CACHE_TTL_MS) || {};
    const cached = state.recentCache[cacheKey];
    if (cached && Date.now() - Number(cached.savedAt || 0) <= RECENT_CACHE_TTL_MS) {
      return cached.value;
    }
    const nativeSort = getRecentSort(type, sortKey);
    try {
      const data = await gql(buildRecentQuery(type, sortKey, direction), { limit, page });
      const value = { type, items: data?.items?.nodes || [] };
      state.recentCache[cacheKey] = { savedAt: Date.now(), value };
      writeTimedCache(RECENT_CACHE_KEY, state.recentCache);
      return value;
    } catch (err) {
      const fallbackSort = RECENT_SORTS[sortKey]?.fallback || "updated_at";
      if (!/invalid sort/i.test(String(err?.message || "")) || nativeSort === fallbackSort) throw err;
      const data = await gql(buildRecentQuery(type, sortKey, direction, fallbackSort), { limit, page });
      const value = { type, items: data?.items?.nodes || [], fallbackSort };
      state.recentCache[cacheKey] = { savedAt: Date.now(), value };
      writeTimedCache(RECENT_CACHE_KEY, state.recentCache);
      return value;
    }
  }

  async function loadRecent(body, options = {}) {
    try {
      body.replaceChildren(createElement("div", "stash-mini-gui-loading", "Loading recent items..."));
      const type = RECENT_TYPES.has(options.type) ? options.type : "all";
      const sort = RECENT_SORTS[options.sort] ? options.sort : "updated_at";
      const direction = normalizeDirection(options.direction);
      const limit = clampResultLimit(options.limit, DEFAULT_RESULT_LIMIT);
      const page = Math.max(1, Math.round(Number(options.page)) || 1);
      const types = type === "all" ? ["scene", "performer", "image", "studio"] : [type];
      const loaded = await Promise.all(types.map((itemType) => loadRecentType(itemType, sort, direction, limit, page)));
      body.replaceChildren();
      const labels = { scene: "Scenes", performer: "Performers", image: "Images", studio: "Studios", tag: "Tags" };
      loaded.forEach(({ type, items, fallbackSort }) => {
        if (!items.length) return;
        const section = createElement("section", `stash-mini-gui-section stash-mini-gui-section--${type}`);
        section.appendChild(createElement("h4", "", fallbackSort ? `${labels[type]} (${fallbackSort})` : labels[type]));
        const list = createElement("div", `stash-mini-gui-result-list stash-mini-gui-result-list--${type}`);
        if (type === "performer") list.style.setProperty("--stash-mini-performer-columns", String(options.performerColumns || 2));
        items.forEach((item) => list.appendChild(createResultCard(type, item)));
        section.appendChild(list);
        body.appendChild(section);
      });
      if (!body.childNodes.length) body.appendChild(createElement("div", "stash-mini-gui-empty", "No recent items found."));
    } catch (err) {
      console.warn("[StashMiniGUI] Recent load failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Recent load failed: ${err.message}`));
    }
  }

  function renderTagApp() {
    const app = normalizeCustomTagApp(state.appPayload || {});
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    if (!app) {
      screen.appendChild(createBackHeader("Tag App"));
      screen.appendChild(createElement("div", "stash-mini-gui-empty", "Open Settings to create or repair this tag app."));
      return screen;
    }
    screen.appendChild(createBackHeader(app.label));
    const controls = createElement("div", "stash-mini-gui-control-row stash-mini-gui-control-row--compact");
    const typeFilter = createSelect("stash-mini-gui-tag-type", [
      ["scene", "Scenes"],
      ["performer", "Performers"],
      ["image", "Images"],
      ["studio", "Studios"],
    ], app.contentType);
    const sortFilter = createSelect("stash-mini-gui-tag-sort", Object.entries(RECENT_SORTS).map(([key, value]) => [key, value.label]), app.sort);
    const directionFilter = createSelect("stash-mini-gui-tag-direction", [
      ["DESC", "Descending"],
      ["ASC", "Ascending"],
    ], app.direction);
    const ratedOnly = createFinderToggle("Rated only");
    const oFilter = createSelect("stash-mini-gui-tag-o-filter", [
      ["any", "Any O"],
      ["has", "Has O"],
      ["none", "No O"],
    ], "any");
    let page = 1;
    let limit = getStoredResultLimit();
    const limitControl = createResultLimitControl(limit, (value) => {
      limit = value;
      page = 1;
      reload();
    });
    controls.append(typeFilter, sortFilter, directionFilter, limitControl, ratedOnly, oFilter);
    const body = createElement("div", "stash-mini-gui-results");
    const pager = createPager(() => page, (nextPage) => {
      page = nextPage;
      reload();
    });
    const reload = () => {
      updatePager(pager, page);
      loadTagAppItems(body, {
        ...app,
        contentType: typeFilter.value,
        sort: sortFilter.value,
        direction: directionFilter.value,
        ratedOnly: Boolean(ratedOnly.querySelector("input")?.checked),
        oFilter: oFilter.value,
      }, limit, page);
    };
    [typeFilter, sortFilter, directionFilter, ratedOnly, oFilter].forEach((control) => {
      control.addEventListener("change", () => {
        page = 1;
        reload();
      });
    });
    screen.append(controls, pager, body);
    reload();
    return screen;
  }

  function renderPresetApp() {
    const app = normalizeCustomPresetApp(state.appPayload || {});
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    if (!app) {
      screen.appendChild(createBackHeader("Preset App"));
      screen.appendChild(createElement("div", "stash-mini-gui-empty", "Open Settings to create or repair this preset app."));
      return screen;
    }
    screen.appendChild(createBackHeader(app.label));
    let page = 1;
    let limit = getStoredResultLimit();
    const controls = createElement("div", "stash-mini-gui-control-row stash-mini-gui-control-row--compact");
    const limitControl = createResultLimitControl(limit, (value) => {
      limit = value;
      page = 1;
      reload();
    });
    controls.appendChild(limitControl);
    const body = createElement("div", "stash-mini-gui-results");
    const pager = createPager(() => page, (nextPage) => {
      page = nextPage;
      reload();
    });
    const reload = () => {
      updatePager(pager, page);
      loadRecent(body, { type: app.contentType, sort: app.sort, direction: app.direction, limit, page, performerColumns: state.appSettings.performerColumns });
    };
    screen.append(controls, pager, body);
    reload();
    return screen;
  }

  function renderOHistory() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    const selectedType = OHISTORY_TYPES.has(state.appPayload?.type) ? state.appPayload.type : "all";
    const selectedView = ["month", "column"].includes(state.appSettings.oHistoryView) ? state.appSettings.oHistoryView : APP_SETTING_DEFAULTS.oHistoryView;
    screen.appendChild(createBackHeader("O History"));
    const controls = createElement("div", "stash-mini-gui-ohistory-controls");
    const typeSelect = createSelect("", [
      ["all", "All"],
      ["scene", "Scenes"],
      ["performer", "Performers"],
      ["studio", "Studios"],
    ], selectedType);
    const viewSelect = createSelect("", [
      ["month", "Month"],
      ["column", "Column"],
    ], selectedView);
    const refresh = makeActionButton("Refresh", () => {
      clearOHistoryCache();
      loadOHistory(body, typeSelect.value, viewSelect.value, { forceRefresh: true });
    }, "is-subtle is-compact");
    const body = createElement("div", "stash-mini-gui-results");
    typeSelect.addEventListener("change", () => {
      state.appPayload = { type: typeSelect.value };
      loadOHistory(body, typeSelect.value, viewSelect.value);
    });
    viewSelect.addEventListener("change", () => {
      updateAppSetting("oHistoryView", viewSelect.value);
      loadOHistory(body, typeSelect.value, viewSelect.value);
    });
    controls.append(createElement("span", "stash-mini-gui-setting-help", "Content"), typeSelect, viewSelect, refresh);
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading O history..."));
    screen.append(controls, body);
    loadOHistory(body, selectedType, selectedView);
    return screen;
  }

  function renderOHistoryDay() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    const day = String(state.appPayload?.day || "").slice(0, 10);
    const selectedType = OHISTORY_TYPES.has(state.appPayload?.type) ? state.appPayload.type : "all";
    screen.appendChild(createBackHeader(day || "O History Day"));
    const body = createElement("div", "stash-mini-gui-results");
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading day details..."));
    screen.appendChild(body);
    loadOHistoryDay(body, day, selectedType);
    return screen;
  }

  async function loadOHistory(body, selectedType = "all", selectedView = "month", options = {}) {
    try {
      body.replaceChildren(createElement("div", "stash-mini-gui-loading", "Loading O history..."));
      const requestedTypes = selectedType === "all" ? ["scene"] : [selectedType];
      const results = await Promise.allSettled(requestedTypes.map((type) => loadOHistoryType(type, options)));
      const events = results
        .flatMap((result) => (result.status === "fulfilled" ? result.value || [] : []))
        .filter((event) => Number(event.item?.o_counter || 0) > 0)
        .sort(sortOHistoryEvents);
      body.replaceChildren();
      if (!events.length) {
        const failed = results.filter((result) => result.status === "rejected").length;
        const emptyText = failed
          ? "O history was unavailable for this Stash schema."
          : "No O history found for this content type.";
        body.appendChild(createElement("div", "stash-mini-gui-empty", emptyText));
        return;
      }
      renderOHistoryCalendar(body, events, selectedType, selectedView);
    } catch (err) {
      console.warn("[StashMiniGUI] O history failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `O history failed: ${err.message}`));
    }
  }

  async function loadOHistoryDay(body, day, selectedType = "all") {
    try {
      if (!day) {
        body.replaceChildren(createElement("div", "stash-mini-gui-empty", "No O history date selected."));
        return;
      }
      const detailTypes = selectedType === "all" ? ["scene", "performer", "studio"] : [selectedType];
      const results = await Promise.allSettled(detailTypes.map((type) => loadOHistoryType(type)));
      const events = results
        .flatMap((result) => (result.status === "fulfilled" ? result.value || [] : []))
        .filter((event) => String(event.item?._stashMiniODate || "").slice(0, 10) === day)
        .filter((event) => Number(event.item?.o_counter || 0) > 0)
        .sort(sortOHistoryEvents);
      body.replaceChildren();
      if (!events.length) {
        body.appendChild(createElement("div", "stash-mini-gui-empty", "No detailed O history found for this day."));
        return;
      }
      const primaryEvents = selectedType === "all" ? events.filter((event) => event.type === "scene") : events;
      const total = primaryEvents.reduce((sum, event) => sum + (Number(event.item.o_counter) || 0), 0);
      const summary = createElement("div", "stash-mini-gui-ohistory-day-summary");
      summary.append(
        createElement("strong", "", formatCount(total, "O")),
        createElement("span", "", `${events.length} grouped ${events.length === 1 ? "entry" : "entries"}`),
      );
      body.appendChild(summary);
      detailTypes.forEach((type) => {
        const typedEvents = events.filter((event) => event.type === type);
        if (!typedEvents.length) return;
        appendOHistoryDaySection(body, type, typedEvents);
      });
    } catch (err) {
      console.warn("[StashMiniGUI] O history day failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Day history failed: ${err.message}`));
    }
  }

  function appendOHistoryDaySection(body, type, events) {
    const labels = { scene: "Scenes", performer: "Performers", studio: "Studios" };
    const section = createElement("section", `stash-mini-gui-section stash-mini-gui-section--${type}`);
    const total = events.reduce((sum, event) => sum + (Number(event.item.o_counter) || 0), 0);
    section.appendChild(createElement("h4", "", `${labels[type] || type} - ${formatCount(total, "O")}`));
    const list = createElement("div", `stash-mini-gui-result-list stash-mini-gui-result-list--${type}`);
    if (type === "performer") list.style.setProperty("--stash-mini-performer-columns", String(state.appSettings.performerColumns || 2));
    events.forEach(({ item }) => list.appendChild(createResultCard(type, item)));
    section.appendChild(list);
    body.appendChild(section);
  }

  function sortOHistoryEvents(a, b) {
    const byDate = String(b.item._stashMiniODate || "").localeCompare(String(a.item._stashMiniODate || ""));
    if (byDate) return byDate;
    return Number(b.item.o_counter || 0) - Number(a.item.o_counter || 0);
  }

  function renderOHistoryCalendar(body, events, selectedType, selectedView = "month") {
    const dated = events.filter((event) => parseOHistoryDate(event.item._stashMiniODate));
    const undated = events.filter((event) => !parseOHistoryDate(event.item._stashMiniODate));
    body.appendChild(createOHistoryStatsBar(dated));
    if (selectedView === "column") {
      renderOHistoryColumn(body, dated, undated);
      return;
    }
    const months = new Map();
    dated.forEach((event) => {
      const date = parseOHistoryDate(event.item._stashMiniODate);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(event);
    });
    months.forEach((monthEvents, key) => body.appendChild(createOHistoryMonth(key, monthEvents, selectedType)));
    if (undated.length) renderOHistoryUndated(body, undated);
  }

  function createOHistoryStatsBar(events) {
    const stats = getOHistoryStats(events);
    const bar = createElement("div", "stash-mini-gui-ohistory-stats");
    bar.append(
      createOHistoryStat("Total O's", String(stats.total)),
      createOHistoryStat("Longest Streak", formatDayCount(stats.longestStreak)),
    );
    return bar;
  }

  function createOHistoryStat(label, value) {
    const item = createElement("div", "stash-mini-gui-ohistory-stat");
    item.append(createElement("span", "", label), createElement("strong", "", value));
    return item;
  }

  function getOHistoryStats(events) {
    const dayTotals = new Map();
    events.forEach((event) => {
      const day = String(event.item?._stashMiniODate || "").slice(0, 10);
      if (!day) return;
      dayTotals.set(day, (dayTotals.get(day) || 0) + (Number(event.item.o_counter) || 0));
    });
    const days = Array.from(dayTotals.keys()).sort();
    let longestStreak = 0;
    let currentStreak = 0;
    let previousTime = 0;
    days.forEach((day) => {
      const time = parseOHistoryDate(`${day}T00:00:00`)?.getTime() || 0;
      currentStreak = previousTime && time - previousTime === 86400000 ? currentStreak + 1 : 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      previousTime = time;
    });
    return {
      total: Array.from(dayTotals.values()).reduce((sum, count) => sum + count, 0),
      longestStreak,
    };
  }

  function formatDayCount(value) {
    const count = Number(value) || 0;
    return count === 1 ? "1 day" : `${count} days`;
  }

  function renderOHistoryColumn(body, dated, undated) {
    const days = new Map();
    dated.forEach((event) => {
      const key = String(event.item._stashMiniODate || "").slice(0, 10);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(event);
    });
    days.forEach((dayEvents, day) => {
      const section = createElement("section", "stash-mini-gui-ohistory-column-day");
      const total = dayEvents.reduce((sum, event) => sum + (Number(event.item.o_counter) || 0), 0);
      section.appendChild(createElement("h4", "", `${day} - ${formatCount(total, "O")}`));
      const list = createElement("div", "stash-mini-gui-result-list");
      dayEvents.forEach(({ type, item }) => list.appendChild(createResultCard(type, item)));
      section.appendChild(list);
      body.appendChild(section);
    });
    if (undated.length) renderOHistoryUndated(body, undated);
  }

  function renderOHistoryUndated(body, undated) {
    const section = createElement("section", "stash-mini-gui-ohistory-undated");
    section.appendChild(createElement("h4", "", "O Count"));
    const list = createElement("div", "stash-mini-gui-ohistory-undated-list");
    undated.forEach((event) => list.appendChild(createOHistoryPill(event)));
    section.appendChild(list);
    body.appendChild(section);
  }

  function createOHistoryMonth(monthKey, events, selectedType = "all") {
    const [year, month] = monthKey.split("-").map(Number);
    const monthDate = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = monthDate.getDay();
    const section = createElement("section", "stash-mini-gui-ohistory-month");
    const stats = getOHistoryStats(events);
    const header = createElement("h4", "stash-mini-gui-ohistory-month-header");
    header.append(
      createElement("span", "", monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })),
      createElement("small", "", `${stats.total} O's - ${formatDayCount(stats.longestStreak)} streak`),
    );
    section.appendChild(header);
    const grid = createElement("div", "stash-mini-gui-ohistory-calendar");
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) => grid.appendChild(createElement("div", "stash-mini-gui-ohistory-weekday", day)));
    for (let i = 0; i < firstDay; i += 1) grid.appendChild(createElement("div", "stash-mini-gui-ohistory-cell is-empty"));
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
      const dayEvents = events.filter((event) => String(event.item._stashMiniODate || "").slice(0, 10) === dateKey);
      const cell = createElement("div", `stash-mini-gui-ohistory-cell${dayEvents.length ? " has-events" : ""}`);
      cell.appendChild(createElement("span", "stash-mini-gui-ohistory-date", String(day)));
      if (dayEvents.length) {
        const count = dayEvents.reduce((total, event) => total + (Number(event.item.o_counter) || 0), 0);
        const button = createElement("button", "stash-mini-gui-ohistory-day-button");
        button.type = "button";
        button.title = `Open O history for ${dateKey}`;
        button.append(
          createElement("strong", "", String(count || dayEvents.length)),
          createElement("span", "", count ? "O's" : "items"),
        );
        button.addEventListener("click", () => setApp("ohistoryDay", { day: dateKey, type: selectedType }));
        cell.appendChild(button);
      }
      grid.appendChild(cell);
    }
    section.appendChild(grid);
    return section;
  }

  function createOHistoryPill(event) {
    const { type, item } = event;
    const button = createElement("button", `stash-mini-gui-ohistory-pill is-${type}`);
    button.type = "button";
    button.title = `${getTitleForResult(type, item)} - ${formatCount(item.o_counter, "O")}`;
    button.addEventListener("click", getAppOpenAction(type, item, getContentPath(type, item)));
    const icon = type === "scene" ? "fa-solid fa-play" : type === "performer" ? "fa-solid fa-user" : type === "image" ? "fa-solid fa-image" : "fa-solid fa-video";
    const image = getImageForResult(type, item);
    if (image) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = image;
      button.appendChild(img);
    } else {
      button.appendChild(createIcon(icon, type.slice(0, 1).toUpperCase()));
    }
    button.append(
      createElement("span", "", getTitleForResult(type, item)),
      createElement("b", "", String(Number(item.o_counter) || 0)),
    );
    return button;
  }

  function parseOHistoryDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async function loadOHistoryType(type, options = {}) {
    const scenes = await loadSceneOHistorySource(options);
    if (type === "scene") return aggregateOHistoryByScene(scenes);
    if (type === "performer") return aggregateSceneOHistoryByRelation(scenes, "performer");
    if (type === "studio") return aggregateSceneOHistoryByRelation(scenes, "studio");
    return [];
  }

  async function loadSceneOHistorySource(options = {}) {
    if (!options.forceRefresh && state.oHistorySceneCache) return state.oHistorySceneCache;
    if (!options.forceRefresh) {
      const cached = readTimedCache(OHISTORY_SCENE_CACHE_KEY, OHISTORY_CACHE_TTL_MS);
      if (cached) {
        state.oHistorySceneCache = cached;
        return cached;
      }
    }
    if (state.oHistorySceneRequest && !options.forceRefresh) return state.oHistorySceneRequest;
    state.oHistorySceneRequest = gql(`query StashMiniOHistoryScenes {
      findScenes(scene_filter: {}, filter: { per_page: -1 }) {
        scenes {
          id
          title
          o_counter
          o_history
          studio { id name image_path }
          performers { id name disambiguation image_path rating100 o_counter scene_count image_count }
          paths { screenshot preview }
        }
      }
    }`)
      .then((data) => {
        const scenes = data?.findScenes?.scenes || [];
        state.oHistorySceneCache = scenes;
        writeTimedCache(OHISTORY_SCENE_CACHE_KEY, scenes);
        return scenes;
      })
      .finally(() => {
        state.oHistorySceneRequest = null;
      });
    return state.oHistorySceneRequest;
  }

  function aggregateOHistoryByScene(scenes) {
    return aggregateNativeOHistory(scenes, "scene");
  }

  function aggregateNativeOHistory(items, type) {
    const grouped = new Map();
    items.forEach((item) => {
      if (!Array.isArray(item.o_history)) return;
      item.o_history.forEach((timestamp) => {
        const day = getOHistoryDayString(timestamp);
        if (!day) return;
        const key = `${type}:${item.id}:${day}`;
        const existing = grouped.get(key) || {
          ...item,
          o_counter: 0,
          _stashMiniODate: day,
          _stashMiniODateLabel: "O History",
          _stashMiniTimestamps: [],
        };
        existing.o_counter += 1;
        existing._stashMiniTimestamps.push(timestamp);
        grouped.set(key, existing);
      });
    });
    return Array.from(grouped.values())
      .map((item) => ({ type, item }))
      .sort(sortOHistoryEvents);
  }

  function aggregateSceneOHistoryByRelation(scenes, relationType) {
    const grouped = new Map();
    scenes.forEach((scene) => {
      if (!Array.isArray(scene.o_history) || !scene.o_history.length) return;
      const relations = relationType === "studio" ? [scene.studio].filter(Boolean) : scene.performers || [];
      relations.forEach((relation) => {
        if (!relation?.id) return;
        scene.o_history.forEach((timestamp) => {
          const day = getOHistoryDayString(timestamp);
          if (!day) return;
          const key = `${relationType}:${relation.id}:${day}`;
          const existing = grouped.get(key) || {
            ...relation,
            o_counter: 0,
            _stashMiniODate: day,
            _stashMiniODateLabel: "Scene O History",
            _stashMiniTimestamps: [],
          };
          existing.o_counter += 1;
          existing._stashMiniTimestamps.push(timestamp);
          grouped.set(key, existing);
        });
      });
    });
    return Array.from(grouped.values())
      .map((item) => ({ type: relationType, item }))
      .sort(sortOHistoryEvents);
  }

  function getOHistoryDayString(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function loadTagAppItems(body, app, limit, page) {
    body.replaceChildren(createElement("div", "stash-mini-gui-loading", `Loading ${app.label}...`));
    try {
      const data = await gql(buildTagAppQuery(app.contentType, app.sort, app.direction), { tagId: app.tagId, limit, page });
      const items = filterFinderItems(data?.items?.nodes || [], { ratedOnly: app.ratedOnly, oFilter: app.oFilter });
      body.replaceChildren();
      if (!items.length) {
        body.appendChild(createElement("div", "stash-mini-gui-empty", "No tagged content found. Check the tag ID, content type, and whether this tag is attached to matching content."));
        return;
      }
      appendResultSection(body, app.label, app.contentType, items);
    } catch (err) {
      console.warn("[StashMiniGUI] Tag app failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Tag app failed: ${err.message}`));
    }
  }

  function buildTagAppQuery(type, sortKey, direction) {
    const safeType = RECENT_TYPES.has(type) && type !== "all" && type !== "tag" ? type : "scene";
    const safeDirection = normalizeDirection(direction);
    const sort = getRecentSort(safeType, sortKey);
    if (safeType === "scene") return `query StashMiniTagApp($tagId: ID!, $limit: Int!, $page: Int!) { items: findScenes(scene_filter: { tags: { value: [$tagId], modifier: INCLUDES_ALL } }, filter: { per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: scenes { id title date o_counter rating100 studio { id name image_path } performers { id name } paths { screenshot preview } } } }`;
    if (safeType === "performer") return `query StashMiniTagApp($tagId: ID!, $limit: Int!, $page: Int!) { items: findPerformers(performer_filter: { tags: { value: [$tagId], modifier: INCLUDES_ALL } }, filter: { per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: performers { id name disambiguation alias_list image_path rating100 o_counter scene_count image_count } } }`;
    if (safeType === "image") return `query StashMiniTagApp($tagId: ID!, $limit: Int!, $page: Int!) { items: findImages(image_filter: { tags: { value: [$tagId], modifier: INCLUDES_ALL } }, filter: { per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: images { id title o_counter rating100 paths { thumbnail preview image } performers { name } } } }`;
    return `query StashMiniTagApp($tagId: ID!, $limit: Int!, $page: Int!) { items: findStudios(studio_filter: { tags: { value: [$tagId], modifier: INCLUDES_ALL } }, filter: { per_page: $limit, page: $page, sort: "${sort}", direction: ${safeDirection} }) { nodes: studios { id name image_path rating100 parent_studio { id name image_path } } } }`;
  }

  function appendResultSection(parent, title, type, items) {
    const section = createElement("section", `stash-mini-gui-section stash-mini-gui-section--${type}`);
    section.appendChild(createElement("h4", "", title));
    const list = createElement("div", `stash-mini-gui-result-list stash-mini-gui-result-list--${type}`);
    if (type === "performer") list.style.setProperty("--stash-mini-performer-columns", String(state.appSettings.performerColumns || 2));
    items.forEach((item) => list.appendChild(createResultCard(type, item)));
    section.appendChild(list);
    parent.appendChild(section);
  }

  function renderSettings() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader("Settings"));

    const form = createElement("section", "stash-mini-gui-settings-panel");
    form.appendChild(createElement("h4", "", "Cards"));
    form.appendChild(createSettingSelect("Performer card size", "performerCardSize", [
      ["small", "Small"],
      ["medium", "Medium"],
      ["large", "Large"],
    ]));
    form.appendChild(createSettingSelect("App button style", "appButtonStyle", [
      ["cards", "Cards"],
      ["icons", "App icons"],
      ["grid", "Grid"],
    ]));
    form.appendChild(createSettingSelect("App layout", "appLayout", [
      ["comfortable", "Comfortable"],
      ["compact", "Compact"],
    ]));
    form.appendChild(createElement("h4", "", "Home Widget"));
    form.appendChild(createBooleanSetting("Show slideshow widget", "slideshowEnabled"));
    form.appendChild(createSettingSelect("Slideshow content", "slideshowContentType", [
      ["scene", "Scenes"],
      ["performer", "Performers"],
      ["image", "Images"],
      ["studio", "Studios"],
      ["tag", "Tags"],
    ]));
    form.appendChild(createTextSetting("Slideshow tag", "slideshowTag", "Optional tag ID or /tags/..."));
    form.appendChild(createSettingSelect("Slideshow sort", "slideshowSort", [
      ["updated_at", "Recently Updated"],
      ["created_at", "Recently Added"],
      ["rating", "Rating"],
      ["o_counter", "O Count"],
      ["date", "Release Date"],
      ["alphabetical", "Name / Title"],
    ]));
    form.appendChild(createBooleanSetting("Slideshow rated only", "slideshowRatedOnly"));
    form.appendChild(createSettingSelect("Slideshow O filter", "slideshowOFilter", [
      ["any", "Any O"],
      ["has", "Has O"],
      ["none", "No O"],
    ]));
    form.appendChild(createNumberSetting("Slideshow max content count", "slideshowMaxContent", 1, MAX_RESULT_LIMIT, 1));
    form.appendChild(createNumberSetting("Slideshow duration", "slideshowDuration", 1500, 30000, 500));
    form.appendChild(createBooleanSetting("Show slideshow timer bar", "slideshowProgressBar"));
    form.appendChild(createElement("h4", "", "Apps"));
    form.appendChild(createAppOrderEditor());
    form.appendChild(createElement("h4", "", "Custom Preset Apps"));
    form.appendChild(createCustomPresetAppEditor());
    form.appendChild(createElement("h4", "", "Custom Tag Content Apps"));
    form.appendChild(createCustomTagAppEditor());
    form.appendChild(createElement("h4", "", "Custom URL Shortcut Apps"));
    form.appendChild(createCustomLinkAppEditor());

    form.appendChild(createElement("h4", "", "Theme"));
    form.appendChild(createSettingSelect("Accent theme", "theme", [
      ["aqua", "Aqua"],
      ["mint", "Mint"],
      ["rose", "Rose"],
      ["amber", "Amber"],
    ]));

    form.appendChild(createTextSetting("Background image URL, gallery, or tag", "backgroundImage", "URL, gallery:<id>, tag:<id>, or pasted gallery/tag URL"));
    form.appendChild(createNumberSetting("Background opacity", "backgroundOpacity", 0, 0.8, 0.05));

    form.appendChild(createElement("h4", "", "Panel"));
    form.appendChild(createNumberSetting("Panel scale", "panelScale", 0.65, 1.6, 0.05));
    form.appendChild(createNumberSetting("Idle opacity", "panelOpacity", 0, 1, 0.05));
    form.appendChild(createBooleanSetting("Dim when idle", "dimWhenIdle"));
    form.appendChild(createBooleanSetting("Minimize on idle", "minimizeOnIdle"));
    form.appendChild(createBooleanSetting("Hover to open", "hoverToOpen"));

    const resetRow = createElement("div", "stash-mini-gui-action-row");
    resetRow.appendChild(makeActionButton("Reset Stash Mini Gui settings", () => {
      const confirmed = window.confirm("Reset Stash Mini Gui settings saved in this browser?");
      if (!confirmed) return;
      try {
        window.localStorage?.removeItem(APP_SETTINGS_KEY);
        window.localStorage?.removeItem(RESULT_LIMIT_KEY);
      } catch (_err) {
        // localStorage is optional.
      }
      state.appSettings = { ...APP_SETTING_DEFAULTS };
      applyAppSettings();
      renderActiveApp();
    }, "is-danger"));
    form.appendChild(resetRow);

    const note = createElement("div", "stash-mini-gui-empty", "These settings are saved in this browser. Drag apps to reorder the home screen. Custom app images accept direct image URLs or pasted Stash /images/... links. If an image does not appear, check that the URL is reachable from this browser.");
    screen.append(form, note);
    return screen;
  }

  function createAppOrderEditor() {
    const wrap = createElement("div", "stash-mini-gui-order-editor");
    wrap.appendChild(createElement("span", "stash-mini-gui-setting-help", "Drag to reorder home apps."));
    const list = createElement("div", "stash-mini-gui-order-list");
    let dragKey = "";
    const renderList = () => {
      list.replaceChildren();
      getOrderedAppEntries().forEach((entry) => {
        const item = createElement("div", "stash-mini-gui-order-item");
        const hidden = isAppHidden(entry.key);
        item.classList.toggle("is-hidden-app", hidden);
        item.draggable = true;
        item.dataset.key = entry.key;
        item.addEventListener("dragstart", () => {
          dragKey = entry.key;
          item.classList.add("is-dragging");
        });
        item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
        item.addEventListener("dragover", (event) => event.preventDefault());
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          if (!dragKey || dragKey === entry.key) return;
          const keys = getOrderedAppEntries().map((app) => app.key);
          const from = keys.indexOf(dragKey);
          const to = keys.indexOf(entry.key);
          if (from < 0 || to < 0) return;
          keys.splice(to, 0, keys.splice(from, 1)[0]);
          updateAppSetting("appOrder", keys.join(","));
          renderList();
        });
        const imageInput = document.createElement("input");
        imageInput.className = "stash-mini-gui-input stash-mini-gui-order-image";
        imageInput.type = "text";
        imageInput.placeholder = "Optional app image URL or pasted /images/... link";
        imageInput.value = getAppButtonImage(entry.key);
        imageInput.addEventListener("pointerdown", (event) => event.stopPropagation());
        imageInput.addEventListener("change", () => {
          updateAppButtonImage(entry.key, imageInput.value.trim());
          renderList();
          renderActiveApp();
        });
        item.append(
          createIcon(entry.icon, entry.label.slice(0, 1)),
          createElement("strong", "", entry.label),
          createElement("small", "", entry.note || ""),
          makeActionButton(hidden ? "Show" : "Hide", () => {
            toggleHiddenApp(entry.key);
            renderList();
          }, "is-subtle is-compact"),
          createIcon("fa-solid fa-grip-lines", "="),
          imageInput,
        );
        list.appendChild(item);
      });
    };
    renderList();
    const reset = makeActionButton("Reset app order", () => {
      updateAppSetting("appOrder", DEFAULT_APP_ORDER);
      renderList();
      renderActiveApp();
    }, "is-subtle");
    wrap.append(list, reset);
    return wrap;
  }

  function createCustomPresetAppEditor() {
    const wrap = createElement("div", "stash-mini-gui-tag-app-editor");
    wrap.appendChild(createElement("span", "stash-mini-gui-setting-help", "Create filter/sort preset apps, like Top Rated Performers or Most O'd Scenes."));
    const row = createElement("div", "stash-mini-gui-tag-app-form");
    const label = document.createElement("input");
    label.className = "stash-mini-gui-input";
    label.type = "text";
    label.placeholder = "App label";
    const image = document.createElement("input");
    image.className = "stash-mini-gui-input";
    image.type = "text";
    image.placeholder = "Optional app image URL or pasted /images/... link";
    const type = createSelect("", [
      ["performer", "Performers"],
      ["scene", "Scenes"],
      ["image", "Images"],
      ["studio", "Studios"],
      ["tag", "Tags"],
    ], "performer");
    const sort = createSelect("", Object.entries(RECENT_SORTS).map(([key, value]) => [key, value.label]), "rating");
    const direction = createSelect("", [
      ["DESC", "Descending"],
      ["ASC", "Ascending"],
    ], "DESC");
    const add = makeActionButton("Add preset app", () => {
      const next = normalizeCustomPresetApp({
        label: label.value || `${RECENT_SORTS[sort.value]?.label || sort.value} ${type.value}`,
        contentType: type.value,
        sort: sort.value,
        direction: direction.value,
        image: image.value,
      });
      if (!next) return;
      const apps = getCustomPresetApps().filter((app) => app.key !== next.key);
      apps.push(next);
      const keys = [...parseAppOrder(state.appSettings.appOrder || DEFAULT_APP_ORDER), next.key].filter((value, index, all) => all.indexOf(value) === index);
      state.appSettings = { ...state.appSettings, customPresetApps: apps, appOrder: keys.join(",") };
      saveAppSettings();
      renderActiveApp();
    }, "is-subtle");
    row.append(label, image, type, sort, direction, add);
    wrap.appendChild(row);
    wrap.appendChild(createCustomAppList(getCustomPresetApps(), "preset"));
    return wrap;
  }

  function createCustomTagAppEditor() {
    const wrap = createElement("div", "stash-mini-gui-tag-app-editor");
    wrap.appendChild(createElement("span", "stash-mini-gui-setting-help", "Create home-screen apps backed by a tag, like Watch Later or Favorites."));
    const row = createElement("div", "stash-mini-gui-tag-app-form");
    const label = document.createElement("input");
    label.className = "stash-mini-gui-input";
    label.type = "text";
    label.placeholder = "App label";
    const tag = document.createElement("input");
    tag.className = "stash-mini-gui-input";
    tag.type = "text";
    tag.placeholder = "Tag ID or /tags/...";
    const type = createSelect("", [
      ["scene", "Scenes"],
      ["image", "Images"],
      ["performer", "Performers"],
      ["studio", "Studios"],
    ], "scene");
    const useTagImage = createElement("label", "stash-mini-gui-inline-check");
    const useTagImageInput = document.createElement("input");
    useTagImageInput.type = "checkbox";
    useTagImage.append(useTagImageInput, createElement("span", "", "Use local Stash tag image"));
    const add = makeActionButton("Add tag app", () => {
      const tagId = parseTagId(tag.value);
      if (!tagId) return;
      const next = normalizeCustomTagApp({
        label: label.value || `Tag ${tagId}`,
        tagId,
        contentType: type.value,
        sort: "updated_at",
        direction: "DESC",
        useTagImage: useTagImageInput.checked,
      });
      if (!next) return;
      const apps = getCustomTagApps().filter((app) => app.key !== next.key);
      apps.push(next);
      const keys = [...parseAppOrder(state.appSettings.appOrder || DEFAULT_APP_ORDER), next.key].filter((value, index, all) => all.indexOf(value) === index);
      state.appSettings = { ...state.appSettings, customTagApps: apps, appOrder: keys.join(",") };
      saveAppSettings();
      renderActiveApp();
    }, "is-subtle");
    row.append(label, tag, type, useTagImage, add);
    wrap.appendChild(row);
    const list = createElement("div", "stash-mini-gui-tag-app-list");
    const apps = getCustomTagApps();
    if (!apps.length) {
      list.appendChild(createElement("div", "stash-mini-gui-empty", "No custom tag apps yet."));
    } else {
      apps.forEach((app) => {
        const item = createElement("div", "stash-mini-gui-tag-app-item");
        const details = createElement("span", "");
        details.append(createElement("strong", "", app.label), createElement("small", "", `${app.contentType} - tag ${app.tagId}${app.useTagImage ? " - tag image" : ""}`));
        item.append(
          createIcon("fa-solid fa-tag", "T"),
          details,
          makeActionButton("Delete", () => {
            const remaining = getCustomTagApps().filter((candidate) => candidate.key !== app.key);
            const keys = parseAppOrder(state.appSettings.appOrder || DEFAULT_APP_ORDER).filter((key) => key !== app.key);
            state.appSettings = { ...state.appSettings, customTagApps: remaining, appOrder: keys.join(",") };
            saveAppSettings();
            renderActiveApp();
          }, "is-subtle is-danger"),
        );
        list.appendChild(item);
      });
    }
    wrap.appendChild(list);
    return wrap;
  }

  function createCustomLinkAppEditor() {
    const wrap = createElement("div", "stash-mini-gui-tag-app-editor");
    wrap.appendChild(createElement("span", "stash-mini-gui-setting-help", "Create shortcut apps that open links in a new tab. Icons can be Font Awesome classes or a single emoji."));
    const row = createElement("div", "stash-mini-gui-tag-app-form");
    const label = document.createElement("input");
    label.className = "stash-mini-gui-input";
    label.type = "text";
    label.placeholder = "App label";
    const url = document.createElement("input");
    url.className = "stash-mini-gui-input";
    url.type = "text";
    url.placeholder = "https://...";
    const icon = document.createElement("input");
    icon.className = "stash-mini-gui-input";
    icon.type = "text";
    icon.placeholder = "fa-brands fa-reddit or link";
    const image = document.createElement("input");
    image.className = "stash-mini-gui-input";
    image.type = "text";
    image.placeholder = "Optional app image URL or pasted /images/... link";
    const add = makeActionButton("Add link app", () => {
      const next = normalizeCustomLinkApp({
        label: label.value || url.value,
        url: url.value,
        icon: icon.value || "fa-solid fa-up-right-from-square",
        image: image.value,
      });
      if (!next) return;
      const apps = getCustomLinkApps().filter((app) => app.key !== next.key);
      apps.push(next);
      const keys = [...parseAppOrder(state.appSettings.appOrder || DEFAULT_APP_ORDER), next.key].filter((value, index, all) => all.indexOf(value) === index);
      state.appSettings = { ...state.appSettings, customLinkApps: apps, appOrder: keys.join(",") };
      saveAppSettings();
      renderActiveApp();
    }, "is-subtle");
    row.append(label, url, icon, image, add);
    wrap.appendChild(row);
    wrap.appendChild(createCustomAppList(getCustomLinkApps(), "link"));
    return wrap;
  }

  function createCustomAppList(apps, kind) {
    const list = createElement("div", "stash-mini-gui-tag-app-list");
    if (!apps.length) {
      list.appendChild(createElement("div", "stash-mini-gui-empty", `No custom ${kind} apps yet.`));
      return list;
    }
    apps.forEach((app) => {
      const item = createElement("div", "stash-mini-gui-tag-app-item");
      const details = createElement("span", "");
      const detailText = kind === "link"
        ? `${app.url}${app.image ? " - image" : ""}`
        : `${app.contentType} - ${RECENT_SORTS[app.sort]?.label || app.sort} - ${app.direction}${app.image ? " - image" : ""}`;
      details.append(createElement("strong", "", app.label), createElement("small", "", detailText));
      item.append(
        createIcon(kind === "link" ? app.icon : "fa-solid fa-filter", kind === "link" ? "L" : "F"),
        details,
        makeActionButton("Delete", () => {
          const settingKey = kind === "link" ? "customLinkApps" : "customPresetApps";
          const remaining = (kind === "link" ? getCustomLinkApps() : getCustomPresetApps()).filter((candidate) => candidate.key !== app.key);
          const keys = parseAppOrder(state.appSettings.appOrder || DEFAULT_APP_ORDER).filter((key) => key !== app.key);
          state.appSettings = { ...state.appSettings, [settingKey]: remaining, appOrder: keys.join(",") };
          saveAppSettings();
          renderActiveApp();
        }, "is-subtle is-danger"),
      );
      list.appendChild(item);
    });
    return list;
  }

  function renderPinned() {
    return renderSavedContentApp("Pinned", "Content you explicitly pinned.", state.tabs, "No pinned content yet. Use Pin on scene, performer, image, and studio cards.", "Clear pins", clearPins);
  }

  function renderHistory() {
    return renderSavedContentApp("History", "Recently opened inside Stash Mini Gui.", state.history, "No Stash Mini Gui history yet. Open content in the app and it will appear here.", "Clear history", clearHistory);
  }

  function renderSavedContentApp(title, subtitle, items, emptyText, clearLabel, clearAction) {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader(title));
    if (items.length && clearLabel && typeof clearAction === "function") {
      const actions = createElement("div", "stash-mini-gui-action-row");
      actions.appendChild(makeActionButton(clearLabel, clearAction, "is-subtle"));
      screen.appendChild(actions);
    }
    const list = createElement("div", "stash-mini-gui-result-list stash-mini-gui-saved-list");
    if (!items.length) {
      list.appendChild(createElement("div", "stash-mini-gui-empty", emptyText));
    } else {
      list.appendChild(createElement("div", "stash-mini-gui-loading", "Refreshing saved cards..."));
      hydrateSavedContentList(list, items);
    }
    screen.appendChild(list);
    return screen;
  }

  async function hydrateSavedContentList(list, tabs) {
    try {
      const cards = await Promise.all((tabs || []).map((tab) => hydrateSavedTab(tab)));
      if (!list?.isConnected) return;
      list.replaceChildren();
      cards.filter(Boolean).forEach(({ type, item }) => list.appendChild(createResultCard(type, item)));
      if (!list.childNodes.length) list.appendChild(createElement("div", "stash-mini-gui-empty", "No saved content found."));
    } catch (err) {
      console.warn("[StashMiniGUI] Saved content refresh failed", err);
      if (list?.isConnected) {
        list.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Saved cards failed: ${err.message}`));
      }
    }
  }

  async function hydrateSavedTab(tab) {
    const type = getSavedTabType(tab);
    const id = String(tab?.payload?.id || "").trim();
    if (!type || !id) return null;
    const fallback = getSavedFallbackItem(tab, type);
    try {
      const data = await gql(getSavedCardQuery(type), { id });
      const item = getSavedCardData(data, type) || fallback;
      return { type, item: { ...fallback, ...item, id } };
    } catch (_err) {
      return { type, item: fallback };
    }
  }

  function getSavedTabType(tab) {
    const app = String(tab?.app || "");
    if (app === "sceneDetail") return "scene";
    if (["performer", "image", "studio"].includes(app)) return app;
    return "";
  }

  function getSavedFallbackItem(tab, type) {
    const id = String(tab?.payload?.id || "");
    const fallback = tab?.payload?.fallback && typeof tab.payload.fallback === "object" ? tab.payload.fallback : {};
    const image = tab?.image || getImageForResult(type, fallback) || "";
    return {
      ...fallback,
      id,
      name: fallback.name || tab?.label || "",
      title: fallback.title || tab?.label || "",
      image_path: fallback.image_path || image,
      paths: {
        ...(fallback.paths || {}),
        thumbnail: fallback.paths?.thumbnail || image,
        preview: fallback.paths?.preview || image,
        screenshot: fallback.paths?.screenshot || image,
      },
    };
  }

  function getSavedCardQuery(type) {
    if (type === "scene") return SAVED_SCENE_QUERY;
    if (type === "performer") return SAVED_PERFORMER_QUERY;
    if (type === "image") return SAVED_IMAGE_QUERY;
    if (type === "studio") return SAVED_STUDIO_QUERY;
    return SAVED_SCENE_QUERY;
  }

  function getSavedCardData(data, type) {
    if (type === "scene") return data?.findScene;
    if (type === "performer") return data?.findPerformer;
    if (type === "image") return data?.findImage;
    if (type === "studio") return data?.findStudio;
    return null;
  }

  function clearPins() {
    state.tabs = [];
    saveTabs();
    renderBottomNav();
    renderActiveApp();
  }

  function clearHistory() {
    state.history = [];
    saveHistory();
    renderBottomNav();
    renderActiveApp();
  }

  function createSettingSelect(labelText, key, entries) {
    const row = createElement("label", "stash-mini-gui-setting-row");
    const text = createElement("span", "", labelText);
    const select = createSelect("", entries, state.appSettings[key] || APP_SETTING_DEFAULTS[key]);
    select.addEventListener("change", () => {
      updateAppSetting(key, select.value);
    });
    row.append(text, select);
    return row;
  }

  function createTextSetting(labelText, key, placeholder = "") {
    const row = createElement("label", "stash-mini-gui-setting-row");
    const text = createElement("span", "", labelText);
    const input = document.createElement("input");
    input.className = "stash-mini-gui-input";
    input.type = "text";
    input.placeholder = placeholder;
    input.value = state.appSettings[key] || "";
    input.addEventListener("change", () => updateAppSetting(key, input.value.trim()));
    row.append(text, input);
    return row;
  }

  function createNumberSetting(labelText, key, min, max, step) {
    const row = createElement("label", "stash-mini-gui-setting-row");
    const text = createElement("span", "", labelText);
    const input = document.createElement("input");
    input.className = "stash-mini-gui-input";
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const hasValue = state.appSettings[key] !== undefined && state.appSettings[key] !== null && state.appSettings[key] !== "";
    input.value = String(hasValue ? state.appSettings[key] : APP_SETTING_DEFAULTS[key] ?? "");
    input.addEventListener("change", () => updateAppSetting(key, getConfigNumber(input.value, APP_SETTING_DEFAULTS[key], min, max)));
    row.append(text, input);
    return row;
  }

  function createBooleanSetting(labelText, key) {
    const row = createElement("label", "stash-mini-gui-setting-row");
    const text = createElement("span", "", labelText);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(state.appSettings[key]);
    input.addEventListener("change", () => updateAppSetting(key, input.checked));
    row.append(text, input);
    return row;
  }

  function createRefreshRow(label, onRefresh) {
    const row = createElement("div", "stash-mini-gui-action-row");
    row.appendChild(makeIconActionButton("fa-solid fa-rotate-right", label, onRefresh, "is-subtle"));
    return row;
  }

  function renderCurrentScene() {
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader("Current Scene"));
    const body = createElement("div", "stash-mini-gui-results");
    const sceneId = getCurrentSceneId();
    if (!sceneId) {
      body.appendChild(createElement("div", "stash-mini-gui-empty", "Open a scene in the main Stash window, then come back here to browse its performers without leaving playback."));
      screen.appendChild(body);
      return screen;
    }
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading scene view..."));
    screen.appendChild(createRefreshRow("Refresh current scene", () => {
      body.replaceChildren(createElement("div", "stash-mini-gui-loading", "Refreshing scene..."));
      loadCurrentScene(sceneId, body);
    }));
    screen.appendChild(body);
    loadCurrentScene(sceneId, body);
    return screen;
  }

  function renderSceneDetail() {
    const payload = state.appPayload || {};
    const fallback = payload.fallback || {};
    const title = fallback.title ? fallback.title : "Scene";
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader(title));
    const body = createElement("div", "stash-mini-gui-results");
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading scene..."));
    screen.appendChild(createRefreshRow("Refresh scene", () => {
      body.replaceChildren(createElement("div", "stash-mini-gui-loading", "Refreshing scene..."));
      loadSceneDetail(payload.id, fallback, body);
    }));
    screen.appendChild(body);
    loadSceneDetail(payload.id, fallback, body);
    return screen;
  }

  async function loadSceneDetail(id, fallback, body) {
    if (!id) {
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", "No scene selected."));
      return;
    }
    try {
      const data = await gql(SCENE_DETAIL_QUERY, { id });
      const scene = data?.findScene || fallback || {};
      body.replaceChildren();
      body.appendChild(createSceneSummary(scene));

      const performers = Array.isArray(scene.performers) ? scene.performers : [];
      if (performers.length) {
        const section = createElement("section", "stash-mini-gui-section");
        section.appendChild(createElement("h4", "", "Performers"));
        const grid = createElement("div", "stash-mini-gui-mini-card-grid is-performers");
        performers.forEach((performer) => grid.appendChild(createMiniPerformerCard(performer)));
        section.appendChild(grid);
        body.appendChild(section);
      }

      if (scene.details) {
        const details = createElement("section", "stash-mini-gui-section");
        details.append(createElement("h4", "", "Details"), createElement("p", "stash-mini-gui-profile__details", scene.details));
        body.appendChild(details);
      }

      if (Array.isArray(scene.tags) && scene.tags.length) {
        const tagSection = createElement("section", "stash-mini-gui-section");
        tagSection.appendChild(createElement("h4", "", "Tags"));
        tagSection.appendChild(createChipList(scene.tags.slice(0, 30)));
        body.appendChild(tagSection);
      }
    } catch (err) {
      console.warn("[StashMiniGUI] Scene detail failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Scene load failed: ${err.message}`));
    }
  }

  async function loadCurrentScene(sceneId, body) {
    try {
      const data = await gql(SCENE_DETAIL_QUERY, { id: sceneId });
      const scene = data?.findScene;
      body.replaceChildren();
      if (!scene) {
        body.appendChild(createElement("div", "stash-mini-gui-empty", "Scene not found."));
        return;
      }
      body.appendChild(createSceneSummary(scene));
      const performers = Array.isArray(scene.performers) ? scene.performers : [];
      if (performers.length) {
        const section = createElement("section", "stash-mini-gui-section");
        section.appendChild(createElement("h4", "", "Performers"));
        const grid = createElement("div", "stash-mini-gui-mini-card-grid is-performers");
        performers.forEach((performer) => grid.appendChild(createMiniPerformerCard(performer)));
        section.appendChild(grid);
        body.appendChild(section);
      } else {
        body.appendChild(createElement("div", "stash-mini-gui-empty", "No performers attached to this scene."));
      }
      if (Array.isArray(scene.tags) && scene.tags.length) {
        const tagSection = createElement("section", "stash-mini-gui-section");
        tagSection.appendChild(createElement("h4", "", "Tags"));
        tagSection.appendChild(createChipList(scene.tags.slice(0, 24)));
        body.appendChild(tagSection);
      }
    } catch (err) {
      console.warn("[StashMiniGUI] Current scene load failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Scene load failed: ${err.message}`));
    }
  }

  function createSceneSummary(scene) {
    const card = createElement("section", "stash-mini-gui-feature-card");
    const image = scene?.paths?.screenshot || scene?.paths?.preview || "";
    if (image) {
      const img = document.createElement("img");
      img.className = "stash-mini-gui-feature-card__image";
      img.loading = "lazy";
      img.alt = "";
      img.src = image;
      card.appendChild(img);
    }
    const body = createElement("div", "stash-mini-gui-feature-card__body");
    body.appendChild(createElement("h3", "", scene.title || "Untitled scene"));
    const meta = [scene.studio?.name, scene.date, formatRating(scene.rating100), formatCount(scene.o_counter, "O")].filter(Boolean).join(" - ");
    if (meta) body.appendChild(createElement("p", "", meta));
    const actions = createElement("div", "stash-mini-gui-action-row");
    actions.append(
      createPinButton("scene", scene, "is-pin"),
      createCopyLinkButton(`/scenes/${scene.id}`),
      createNewTabButton(`/scenes/${scene.id}`, "Open scene in new tab"),
    );
    if (scene.studio?.id) {
      actions.appendChild(makeActionButton(`Studio: ${scene.studio.name || "Open"}`, () => openStudioInApp(scene.studio.id, scene.studio), "is-subtle"));
    }
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function renderImageDetail() {
    const payload = state.appPayload || {};
    const fallback = payload.fallback || {};
    const title = fallback.title ? fallback.title : "Image";
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader(title));
    const body = createElement("div", "stash-mini-gui-results");
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading image..."));
    screen.appendChild(body);
    loadImageDetail(payload.id, fallback, body);
    return screen;
  }

  async function loadImageDetail(id, fallback, body) {
    if (!id) {
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", "No image selected."));
      return;
    }
    try {
      const data = await gql(IMAGE_DETAIL_QUERY, { id });
      const image = data?.findImage || fallback || {};
      body.replaceChildren();
      body.appendChild(createImageViewer(image));

      const performers = Array.isArray(image.performers) ? image.performers : [];
      if (performers.length) {
        const section = createElement("section", "stash-mini-gui-section");
        section.appendChild(createElement("h4", "", "Performers"));
        const grid = createElement("div", "stash-mini-gui-mini-card-grid is-performers");
        performers.forEach((performer) => grid.appendChild(createMiniPerformerCard(performer)));
        section.appendChild(grid);
        body.appendChild(section);
      }

      if (Array.isArray(image.tags) && image.tags.length) {
        const tagSection = createElement("section", "stash-mini-gui-section");
        tagSection.appendChild(createElement("h4", "", "Tags"));
        tagSection.appendChild(createChipList(image.tags.slice(0, 30)));
        body.appendChild(tagSection);
      }
    } catch (err) {
      console.warn("[StashMiniGUI] Image detail failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Image load failed: ${err.message}`));
    }
  }

  function createImageViewer(image) {
    const card = createElement("section", "stash-mini-gui-feature-card stash-mini-gui-image-viewer");
    const src = image?.paths?.image || image?.paths?.preview || image?.paths?.thumbnail || "";
    if (src) {
      const img = document.createElement("img");
      img.className = "stash-mini-gui-image-viewer__image";
      img.loading = "lazy";
      img.alt = "";
      img.src = src;
      card.appendChild(img);
    }
    const body = createElement("div", "stash-mini-gui-feature-card__body");
    body.appendChild(createElement("h3", "", image.title || image.code || "Untitled image"));
    const meta = [image.studio?.name, image.date, formatRating(image.rating100), formatCount(image.o_counter, "O")].filter(Boolean).join(" - ");
    if (meta) body.appendChild(createElement("p", "", meta));
    const actions = createElement("div", "stash-mini-gui-action-row");
    actions.append(
      createPinButton("image", image, "is-pin"),
      createCopyLinkButton(`/images/${image.id}`),
      createNewTabButton(`/images/${image.id}`, "Open image in new tab"),
    );
    if (image.studio?.id) actions.appendChild(makeActionButton(`Studio: ${image.studio.name || "Open"}`, () => openStudioInApp(image.studio.id, image.studio), "is-subtle"));
    body.appendChild(actions);
    if (image.details) body.appendChild(createElement("p", "stash-mini-gui-profile__details", image.details));
    card.appendChild(body);
    return card;
  }

  function createMiniPerformerCard(performer) {
    const card = createElement("article", "stash-mini-gui-mini-card");
    if (performer.image_path) {
      const media = createElement("button", "stash-mini-gui-mini-card__media");
      media.type = "button";
      media.addEventListener("click", () => openPerformerInApp(performer.id, performer));
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = performer.image_path;
      media.appendChild(img);
      card.appendChild(media);
    }
    const label = createElement("button", "stash-mini-gui-mini-card__label", performer.name || "Unknown");
    label.type = "button";
    label.addEventListener("click", () => openPerformerInApp(performer.id, performer));
    const meta = createElement("span", "stash-mini-gui-mini-card__meta", [formatRating(performer.rating100), formatCount(performer.o_counter, "O")].filter(Boolean).join(" - "));
    const actions = createElement("div", "stash-mini-gui-mini-card__actions");
    actions.append(
      createPinButton("performer", performer, "is-pin is-compact"),
      createNewTabButton(`/performers/${performer.id}`, "Open performer in new tab"),
    );
    card.append(label, meta, actions);
    return card;
  }

  function createChipList(values) {
    const chips = createElement("div", "stash-mini-gui-chip-list");
    values.filter(Boolean).forEach((value) => {
      const tagId = typeof value === "object" ? value.id : "";
      const label = typeof value === "object" ? value.name : value;
      if (tagId) {
        const button = createElement("button", "stash-mini-gui-chip", label);
        button.type = "button";
        button.addEventListener("click", () => setApp("tagApp", { label, tagId, contentType: "scene", sort: "updated_at", direction: "DESC" }));
        chips.appendChild(button);
      } else {
        chips.appendChild(createElement("span", "stash-mini-gui-chip", label));
      }
    });
    return chips;
  }

  function renderPerformerDetail() {
    const payload = state.appPayload || {};
    const fallback = payload.fallback || {};
    const title = fallback.name ? fallback.name : "Performer";
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader(title));
    const body = createElement("div", "stash-mini-gui-results");
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading performer..."));
    screen.appendChild(body);
    loadPerformerDetail(payload.id, fallback, body);
    return screen;
  }

  async function loadPerformerDetail(id, fallback, body) {
    if (!id) {
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", "No performer selected."));
      return;
    }
    try {
      const data = await gql(PERFORMER_DETAIL_QUERY, {
        id,
        sceneLimit: Math.max(3, Math.min(10, DEFAULT_RESULT_LIMIT)),
        imageLimit: Math.max(4, Math.min(12, DEFAULT_RESULT_LIMIT)),
      });
      const performer = data?.findPerformer || fallback || {};
      body.replaceChildren();
      body.appendChild(createPerformerProfile(performer));

      const recentScenes = data?.scenes?.scenes || [];
      if (recentScenes.length) {
        const scenes = createElement("section", "stash-mini-gui-section");
        scenes.appendChild(createElement("h4", "", "Recent scenes"));
        const list = createElement("div", "stash-mini-gui-result-list");
        recentScenes.forEach((scene) => list.appendChild(createResultCard("scene", scene)));
        scenes.appendChild(list);
        body.appendChild(scenes);
      }

      const images = data?.images?.images || [];
      if (images.length) {
        const imageSection = createElement("section", "stash-mini-gui-section");
        imageSection.appendChild(createElement("h4", "", "Images"));
        const grid = createElement("div", "stash-mini-gui-image-grid");
        images.forEach((image) => {
          const button = createElement("button", "stash-mini-gui-image-tile");
          button.type = "button";
          button.addEventListener("click", () => openImageInApp(image.id, image));
          const img = document.createElement("img");
          img.loading = "lazy";
          img.alt = "";
          img.src = image.paths?.thumbnail || image.paths?.preview || image.paths?.image || "";
          button.appendChild(img);
          grid.appendChild(button);
        });
        imageSection.appendChild(grid);
        body.appendChild(imageSection);
      }
    } catch (err) {
      console.warn("[StashMiniGUI] Performer detail failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Performer load failed: ${err.message}`));
    }
  }

  function renderStudioDetail() {
    const payload = state.appPayload || {};
    const fallback = payload.fallback || {};
    const title = fallback.name || "Studio";
    const screen = createElement("div", "stash-mini-gui-screen-stack");
    screen.appendChild(createBackHeader(title));
    const body = createElement("div", "stash-mini-gui-results");
    body.appendChild(createElement("div", "stash-mini-gui-loading", "Loading studio..."));
    screen.appendChild(body);
    loadStudioDetail(payload.id, fallback, body);
    return screen;
  }

  async function loadStudioDetail(id, fallback, body) {
    if (!id) {
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", "No studio selected."));
      return;
    }
    try {
      let data;
      try {
        data = await gql(STUDIO_DETAIL_QUERY, { id });
      } catch (_err) {
        data = await gql(STUDIO_BASIC_QUERY, { id });
      }
      const studio = data?.findStudio || fallback || {};
      body.replaceChildren(createStudioProfile(studio));
      const children = Array.isArray(studio.child_studios) ? studio.child_studios : [];
      if (children.length) {
        const section = createElement("section", "stash-mini-gui-section");
        section.appendChild(createElement("h4", "", "Sub studios"));
        const list = createElement("div", "stash-mini-gui-result-list");
        children.forEach((child) => list.appendChild(createResultCard("studio", child)));
        section.appendChild(list);
        body.appendChild(section);
      }
      let scenes = [];
      try {
        const sceneData = await gql(STUDIO_SCENES_QUERY, { id });
        scenes = sceneData?.scenes?.scenes || [];
      } catch (_err) {
        scenes = [];
      }
      if (scenes.length) {
        const section = createElement("section", "stash-mini-gui-section");
        section.appendChild(createElement("h4", "", "From this studio"));
        const list = createElement("div", "stash-mini-gui-result-list");
        scenes.forEach((scene) => list.appendChild(createResultCard("scene", scene)));
        section.appendChild(list);
        body.appendChild(section);
      }
    } catch (err) {
      console.warn("[StashMiniGUI] Studio detail failed", err);
      body.replaceChildren(createElement("div", "stash-mini-gui-empty is-error", `Studio load failed: ${err.message}`));
    }
  }

  function createStudioProfile(studio) {
    const card = createElement("section", "stash-mini-gui-profile stash-mini-gui-profile--studio");
    const image = studio.image_path || "";
    if (image) {
      card.style.setProperty("--stash-mini-studio-bg", `url("${image.replace(/"/g, "%22")}")`);
    }
    const panel = createElement("div", "stash-mini-gui-studio-panel");
    const header = createElement("div", "stash-mini-gui-studio-panel__header");
    header.appendChild(createElement("h3", "", studio.name || "Studio"));
    const meta = [formatRating(studio.rating100), studio.url].filter(Boolean).join(" - ");
    if (meta) header.appendChild(createElement("p", "", meta));
    panel.appendChild(header);

    const stats = createElement("div", "stash-mini-gui-stat-grid");
    [
      [Number(studio.scene_count) || 0, "Scenes"],
      [Number(studio.image_count) || 0, "Images"],
      [Number(studio.gallery_count) || 0, "Galleries"],
      [formatRating(studio.rating100) || "-", "Rating"],
    ].forEach(([value, label]) => stats.appendChild(createStat(value, label)));
    panel.appendChild(stats);

    const actions = createElement("div", "stash-mini-gui-action-row");
    actions.append(
      createPinButton("studio", studio, "is-pin"),
      createCopyLinkButton(`/studios/${studio.id}`),
      createNewTabButton(`/studios/${studio.id}`, "Open studio in new tab"),
    );
    if (studio.parent_studio?.id) {
      actions.appendChild(makeActionButton(`Parent: ${studio.parent_studio.name || "Studio"}`, () => openStudioInApp(studio.parent_studio.id, studio.parent_studio), "is-subtle"));
    }
    panel.appendChild(actions);
    if (studio.details) panel.appendChild(createElement("p", "stash-mini-gui-profile__details", studio.details));
    card.appendChild(panel);
    return card;
  }

  function createStat(value, label) {
    const stat = createElement("div", "stash-mini-gui-stat");
    stat.append(createElement("strong", "", String(value)), createElement("span", "", label));
    return stat;
  }

  function createPerformerProfile(performer) {
    const profile = createElement("section", "stash-mini-gui-profile");
    const hero = createElement("div", "stash-mini-gui-profile__hero");
    if (performer.image_path) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = performer.image_path;
      hero.appendChild(img);
    }
    const overlay = createElement("div", "stash-mini-gui-profile__overlay");
    overlay.append(
      createElement("h3", "", performer.name || "Unknown performer"),
      createElement("p", "", [performer.disambiguation, performer.country, performer.gender].filter(Boolean).join(" - ")),
    );
    hero.appendChild(overlay);
    profile.appendChild(hero);

    const stats = createElement("div", "stash-mini-gui-stat-grid");
    [
      [formatRating(performer.rating100) || "-", "rating"],
      [Number(performer.o_counter) || 0, "O count"],
      [Number(performer.scene_count) || 0, "scenes"],
      [Number(performer.image_count) || 0, "images"],
    ].forEach(([value, label]) => stats.appendChild(createStat(value, label)));
    profile.appendChild(stats);

    const metadata = createPerformerMetadata(performer);
    if (metadata) profile.appendChild(metadata);

    const actions = createElement("div", "stash-mini-gui-action-row");
    actions.append(
      createPinButton("performer", performer, "is-pin"),
      createCopyLinkButton(`/performers/${performer.id}`),
      createNewTabButton(`/performers/${performer.id}`, "Open performer in new tab"),
    );
    profile.appendChild(actions);

    if (Array.isArray(performer.alias_list) && performer.alias_list.length) {
      const aliases = createElement("section", "stash-mini-gui-section");
      aliases.append(createElement("h4", "", "Aliases"), createChipList(performer.alias_list.slice(0, 18)));
      profile.appendChild(aliases);
    }
    if (Array.isArray(performer.tags) && performer.tags.length) {
      const tags = createElement("section", "stash-mini-gui-section");
      tags.append(createElement("h4", "", "Tags"), createChipList(performer.tags.slice(0, 24)));
      profile.appendChild(tags);
    }
    if (performer.details) {
      const details = createElement("p", "stash-mini-gui-profile__details", performer.details);
      profile.appendChild(details);
    }
    return profile;
  }

  function createPerformerMetadata(performer) {
    const rows = [
      ["Birthdate", performer.birthdate],
      ["Death date", performer.death_date],
      ["Country", performer.country],
      ["Gender", performer.gender],
      ["Ethnicity", performer.ethnicity],
      ["Height", formatHeight(performer.height_cm)],
      ["Weight", formatWeight(performer.weight)],
      ["Measurements", performer.measurements],
      ["Hair", performer.hair_color],
      ["Eyes", performer.eye_color],
      ["Fake tits", performer.fake_tits],
      ["Penis", formatLength(performer.penis_length)],
      ["Circumcised", performer.circumcised],
      ["Tattoos", performer.tattoos],
      ["Piercings", performer.piercings],
      ["Career", performer.career_length],
    ].filter(([, value]) => hasDisplayValue(value));

    if (!rows.length) return null;
    const section = createElement("section", "stash-mini-gui-section stash-mini-gui-metadata");
    section.appendChild(createElement("h4", "", "Metadata"));
    const grid = createElement("div", "stash-mini-gui-metadata-grid");
    rows.forEach(([label, value]) => {
      const item = createElement("div", "stash-mini-gui-metadata-item");
      item.append(createElement("span", "", label), createElement("strong", "", formatMetadataValue(value)));
      grid.appendChild(item);
    });
    section.appendChild(grid);
    return section;
  }

  function hasDisplayValue(value) {
    if (value === false) return true;
    if (value === null || value === undefined) return false;
    return String(value).trim() !== "";
  }

  function formatMetadataValue(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return String(value);
  }

  function formatHeight(value) {
    const cm = Number(value);
    if (!Number.isFinite(cm) || cm <= 0) return "";
    const inches = Math.round(cm / 2.54);
    return `${cm} cm / ${Math.floor(inches / 12)}'${inches % 12}"`;
  }

  function formatWeight(value) {
    const kg = Number(value);
    if (!Number.isFinite(kg) || kg <= 0) return "";
    return `${kg} kg / ${Math.round(kg * 2.20462)} lb`;
  }

  function formatLength(value) {
    const cm = Number(value);
    if (!Number.isFinite(cm) || cm <= 0) return "";
    return `${cm} cm`;
  }

  function renderActiveApp() {
    if (!state.screen) return;
    window.clearTimeout(state.slideshowTimer);
    state.slideshowTimer = 0;
    let content;
    if (state.app === "scene") content = renderCurrentScene();
    else if (state.app === "sceneDetail") content = renderSceneDetail();
    else if (state.app === "image") content = renderImageDetail();
    else if (state.app === "performer") content = renderPerformerDetail();
    else if (state.app === "studio") content = renderStudioDetail();
    else if (state.app === "tags") content = renderTags();
    else if (state.app === "search") content = renderSearch();
    else if (state.app === "recent") content = renderRecent();
    else if (state.app === "ohistory") content = renderOHistory();
    else if (state.app === "ohistoryDay") content = renderOHistoryDay();
    else if (state.app === "tagApp") content = renderTagApp();
    else if (state.app === "presetApp") content = renderPresetApp();
    else if (state.app === "settings") content = renderSettings();
    else if (state.app === "pinned") content = renderPinned();
    else if (state.app === "history") content = renderHistory();
    else content = renderHome();
    state.screen.replaceChildren(content);
    updateNavState();
  }

  function updateNavState() {
    renderBottomNav();
  }

  function refreshCurrentApp() {
    renderActiveApp();
  }

  function renderBottomNav() {
    if (!state.tabsNode) return;
    state.tabsNode.replaceChildren();
    const refresh = createElement("button", "stash-mini-gui-corner-button stash-mini-gui-corner-button--refresh", "");
    refresh.type = "button";
    refresh.title = "Refresh";
    refresh.appendChild(createIcon("fa-solid fa-rotate-right", "R"));
    refresh.addEventListener("click", refreshCurrentApp);
    const nav = createElement("div", "stash-mini-gui-mini-nav");
    const back = createElement("button", "stash-mini-gui-mini-nav__button", "");
    back.type = "button";
    back.title = "Back";
    back.appendChild(createIcon("fa-solid fa-chevron-left", "<"));
    back.addEventListener("click", goBack);
    const settings = createElement("button", "stash-mini-gui-mini-nav__button", "");
    settings.type = "button";
    settings.title = "Settings";
    settings.appendChild(createIcon("fa-solid fa-gear", "S"));
    settings.addEventListener("click", () => setApp("settings", null));
    const home = createElement("button", "stash-mini-gui-mini-nav__button", "");
    home.type = "button";
    home.title = "Home";
    home.appendChild(createIcon("fa-solid fa-house", "H"));
    home.addEventListener("click", () => setApp("home", null));
    const pinned = createElement("button", "stash-mini-gui-mini-nav__button", "");
    pinned.type = "button";
    pinned.title = "Pinned";
    pinned.appendChild(createIcon("fa-solid fa-thumbtack", "P"));
    pinned.addEventListener("click", () => toggleQuickAccessOverlay("pinned"));
    const history = createElement("button", "stash-mini-gui-mini-nav__button", "");
    history.type = "button";
    history.title = "History";
    history.appendChild(createIcon("fa-solid fa-clock", "H"));
    history.addEventListener("click", () => toggleQuickAccessOverlay("history"));
    const close = createElement("button", "stash-mini-gui-mini-nav__button", "");
    close.className = "stash-mini-gui-corner-button stash-mini-gui-corner-button--close";
    close.type = "button";
    close.title = "Close";
    close.appendChild(createIcon("fa-solid fa-xmark", "X"));
    close.addEventListener("click", closeMiniGui);
    nav.append(back, settings, home, pinned, history);
    state.tabsNode.append(refresh, nav, close);
  }

  function toggleQuickAccessOverlay(type) {
    const existing = state.tabsNode?.querySelector(".stash-mini-gui-quick-overlay");
    if (existing?.dataset.type === type) {
      existing.remove();
      return;
    }
    existing?.remove();
    const overlay = createElement("div", "stash-mini-gui-quick-overlay");
    const items = type === "pinned" ? state.tabs : state.history;
    overlay.dataset.type = type;
    overlay.appendChild(createElement("h4", "", type === "pinned" ? "Pinned" : "History"));
    if (!items.length) {
      overlay.appendChild(createElement("div", "stash-mini-gui-empty", type === "pinned" ? "Nothing pinned yet." : "No recent Stash Mini Gui activity yet."));
    } else {
      items.slice(0, 8).forEach((tab) => overlay.appendChild(createQuickAccessItem(tab)));
    }
    state.tabsNode.prepend(overlay);
  }

  function createQuickAccessItem(tab) {
    const type = tab.app === "sceneDetail" ? "scene" : tab.app;
    const item = {
      id: tab.payload?.id,
      name: tab.label,
      title: tab.label,
      image_path: tab.image,
      paths: { thumbnail: tab.image, preview: tab.image, screenshot: tab.image },
    };
    const card = createResultCard(type, item);
    card.classList.add("stash-mini-gui-quick-card");
    card.addEventListener("click", () => state.tabsNode?.querySelector(".stash-mini-gui-quick-overlay")?.remove(), true);
    return card;
  }

  function buildShell() {
    destroy();
    loadTabs();
    loadHistory();
    loadAppSettings();
    const [width, height] = getPanelDimensions();
    updateResponsiveLayout(width, height);
    const position = getInitialPosition();

    const root = createElement("div", "stash-mini-gui");
    root.dataset.stashMiniLayout = getResponsiveLayout(width, height);
    root.style.setProperty("--stash-mini-panel-width", `${width}px`);
    root.style.setProperty("--stash-mini-panel-height", `${height}px`);
    root.style.setProperty("--stash-mini-scale", "1");
    root.style.setProperty("--stash-mini-opacity", "0.98");

    const launcher = createElement("button", "stash-mini-gui-launcher");
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Toggle Stash Mini Gui");
    launcher.appendChild(createIcon("fa-solid fa-box", "Stash Mini Gui"));
    launcher.addEventListener("click", toggleMiniGui);
    launcher.addEventListener("pointerenter", () => {
      if (state.appSettings.hoverToOpen && !state.isOpen) openMiniGui();
    });

    const panel = createElement("aside", "stash-mini-gui-panel");
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.setAttribute("aria-label", "Stash Mini Gui");
    const bgA = createElement("div", "stash-mini-gui-bg-layer");
    const bgB = createElement("div", "stash-mini-gui-bg-layer");

    const chrome = createElement("div", "stash-mini-gui-chrome");
    const drag = createElement("div", "stash-mini-gui-drag");
    const title = createElement("div", "stash-mini-gui-title");
    title.append(
      createIcon("fa-solid fa-box", "Stash Mini Gui"),
      createElement("span", "stash-mini-gui-clock", ""),
    );
    drag.append(title);
    chrome.appendChild(drag);

    const screen = createElement("div", "stash-mini-gui-screen");
    const tabs = createElement("nav", "stash-mini-gui-tabs");
    const resizeHandle = createElement("div", "stash-mini-gui-resize-handle");
    resizeHandle.setAttribute("aria-hidden", "true");

    panel.append(bgA, bgB, chrome, screen, tabs, resizeHandle);
    root.append(launcher, panel);
    document.body.appendChild(root);

    state.root = root;
    state.panel = panel;
    state.screen = screen;
    state.tabsNode = tabs;
    state.resizeHandle = resizeHandle;
    state.launcher = launcher;
    state.backgroundLayers = [bgA, bgB];

    attachDrag(drag);
    attachResize(resizeHandle);
    panel.addEventListener("pointerenter", cancelIdleMinimize);
    panel.addEventListener("focusin", cancelIdleMinimize);
    panel.addEventListener("pointerleave", scheduleIdleMinimize);
    panel.addEventListener("focusout", scheduleIdleMinimize);
    attachShortcut();
    attachFullscreenHost();
    applyAppSettings();
    startClock();

    state.app = getActiveApp();
    state.isOpen = getStoredOpenState();
    if (state.isOpen) openMiniGui();
    else renderActiveApp();
  }

  function attachFullscreenHost() {
    state.fullscreenHandler = () => syncFullscreenHost();
    document.addEventListener("fullscreenchange", state.fullscreenHandler, true);
    syncFullscreenHost();
  }

  function syncFullscreenHost() {
    if (!state.root) return;
    const host = document.fullscreenElement || document.body;
    if (host && state.root.parentElement !== host) host.appendChild(state.root);
  }

  function attachDrag(handle) {
    let dragState = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, select, textarea, a")) return;
      const rect = state.panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
      };
      handle.setPointerCapture(event.pointerId);
      state.panel.classList.add("is-dragging");
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const next = clampPanelToViewport(
        dragState.left + event.clientX - dragState.startX,
        dragState.top + event.clientY - dragState.startY,
      );
      state.panel.style.left = `${next.left}px`;
      state.panel.style.top = `${next.top}px`;
    });

    const endDrag = (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const rect = state.panel.getBoundingClientRect();
      const next = clampPanelToViewport(rect.left, rect.top);
      state.panel.style.left = `${next.left}px`;
      state.panel.style.top = `${next.top}px`;
      savePosition(next.left, next.top);
      dragState = null;
      state.panel.classList.remove("is-dragging");
    };

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    state.resizeHandler = () => {
      if (!state.panel) return;
      const rect = state.panel.getBoundingClientRect();
      const next = clampPanelToViewport(rect.left, rect.top);
      state.panel.style.left = `${next.left}px`;
      state.panel.style.top = `${next.top}px`;
      savePosition(next.left, next.top);
    };
    window.addEventListener("resize", state.resizeHandler);
  }

  function attachResize(handle) {
    let resizeState = null;
    handle.addEventListener("pointerdown", (event) => {
      if (!state.panel || !state.root) return;
      event.preventDefault();
      event.stopPropagation();
      const width = Number.parseFloat(state.root.style.getPropertyValue("--stash-mini-panel-width")) || state.panel.offsetWidth || getPanelDimensions()[0];
      const height = Number.parseFloat(state.root.style.getPropertyValue("--stash-mini-panel-height")) || state.panel.offsetHeight || getPanelDimensions()[1];
      resizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width,
        height,
      };
      handle.setPointerCapture(event.pointerId);
      state.panel.classList.add("is-resizing");
    });

    handle.addEventListener("pointermove", (event) => {
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      const nextWidth = Math.max(280, Math.min(1100, resizeState.width + event.clientX - resizeState.startX));
      const nextHeight = Math.max(420, Math.min(920, resizeState.height + event.clientY - resizeState.startY));
      applyPanelDimensions(nextWidth, nextHeight);
    });

    const endResize = (event) => {
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      const width = Number.parseFloat(state.root?.style.getPropertyValue("--stash-mini-panel-width")) || resizeState.width;
      const height = Number.parseFloat(state.root?.style.getPropertyValue("--stash-mini-panel-height")) || resizeState.height;
      updateResponsiveLayout(width, height);
      savePanelSize(width, height);
      resizeState = null;
      state.panel?.classList.remove("is-resizing");
    };

    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
  }

  function attachShortcut() {
    const shortcut = parseShortcut(state.config.keyboardShortcut);
    if (!shortcut) return;
    state.shortcutHandler = (event) => {
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      if (shortcut.key !== key) return;
      if (shortcut.ctrl !== event.ctrlKey) return;
      if (shortcut.shift !== event.shiftKey) return;
      if (shortcut.alt !== event.altKey) return;
      event.preventDefault();
      toggleMiniGui();
    };
    document.addEventListener("keydown", state.shortcutHandler, true);
  }

  function startClock() {
    const update = () => {
      const node = state.root?.querySelector(".stash-mini-gui-clock");
      if (!node) return;
      node.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    update();
    state.clockTimer = window.setInterval(update, 15000);
  }

  function parseShortcut(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw || raw === "disabled" || raw === "off") return null;
    const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
    const key = parts[parts.length - 1];
    if (!key) return null;
    return {
      key,
      ctrl: parts.includes("ctrl") || parts.includes("control"),
      shift: parts.includes("shift"),
      alt: parts.includes("alt") || parts.includes("option"),
    };
  }

  function scheduleRefreshes() {
    REFRESH_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        if (!document.body.contains(state.root)) buildShell();
      }, delay);
    });
  }

  function prewarmOHistory() {
    loadSceneOHistorySource().catch(() => {});
  }

  async function init() {
    registerRuntime();
    await loadConfig();
    buildShell();
    window.setTimeout(prewarmOHistory, 1500);
    scheduleRefreshes();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
