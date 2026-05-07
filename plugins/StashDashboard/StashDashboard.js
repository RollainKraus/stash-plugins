(function () {
  "use strict";

  const PLUGIN_ID = "StashDashboard";
  const ROUTE_EVENT = "stash-dashboard:navigation";
  const DASHBOARD_PATH = "/stash-dashboard";
  const NO_STUDIO_ID = "__stash_dashboard_no_studio__";
  const DASHBOARD_CACHE_DB = "StashDashboardCache";
  const DASHBOARD_CACHE_STORE = "studioScopes";
  const DASHBOARD_CACHE_VERSION = "v3";
  const DASHBOARD_COLLAPSED_SECTIONS_KEY = "StashDashboard.collapsedSections";
  const DASHBOARD_STUDIO_GROUPING_KEY = "StashDashboard.studioListGrouping";
  const DASHBOARD_INCLUDE_SUB_STUDIOS_KEY = "StashDashboard.includeSubStudios";
  const DASHBOARD_HIDE_UNKNOWN_PERFORMER_CHARTS_KEY = "StashDashboard.hideUnknownPerformerCharts";
  const DASHBOARD_HIDE_UNKNOWN_SCENE_CHARTS_KEY = "StashDashboard.hideUnknownSceneCharts";
  const DASHBOARD_COMPARISON_LEFT_KEY = "StashDashboard.comparisonLeft";
  const DASHBOARD_COMPARISON_RIGHT_KEY = "StashDashboard.comparisonRight";
  const DASHBOARD_FILTER_PRESETS_KEY = "StashDashboard.filterPresets";
  const DASHBOARD_SHOW_CACHED_ONLY_KEY = "StashDashboard.showCachedStudiosOnly";
  const DASHBOARD_FIND_SELECTOR = [
    ".studio-dashboard__page-section-header",
    ".studio-dashboard__card",
    ".studio-dashboard__tag-card",
    ".studio-dashboard__scene",
    ".studio-dashboard__demographic-chart",
    ".studio-dashboard__timeline-bar",
    ".studio-dashboard__tag-group",
    ".studio-dashboard__comparison-metric",
    ".studio-dashboard__comparison-highlight",
    ".studio-dashboard__attention-card",
    ".studio-dashboard__attention-item",
  ].join(",");
  const TOP_PERFORMER_MAX = 6;
  const TOP_TAG_MAX = 10;
  const TOP_TAG_CATEGORY_MAX = 12;
  const DEMOGRAPHIC_PIE_TOP_COUNTRIES = 10;
  const DEMOGRAPHIC_AGE_GROUP_MAX = 10;
  const DASHBOARD_ROW_CARD_LIMIT = 8;
  const DASHBOARD_SCENE_ROW_LIMIT = 5;
  const NEEDS_ATTENTION_ITEM_LIMIT = 8;
  const DEFAULT_STATS_PAGE_SIZE = 150;
  const DEFAULT_IMAGE_STATS_PAGE_SIZE = 250;
  const GRAPHQL_TIMEOUT_MS = 60000;
  const DEFAULT_DASHBOARD_SECTION_ORDER = [
    "insights",
    "studioComparison",
    "performerHighlights",
    "topTags",
    "releaseTimeline",
    "sceneHighlights",
    "performerDemographics",
    "sceneCharts",
    "needsAttention",
  ];
  const DASHBOARD_SECTION_ALIASES = {
    insight: "insights",
    insights: "insights",
    overview: "insights",
    summary: "insights",
    studiocomparison: "studioComparison",
    comparison: "studioComparison",
    compare: "studioComparison",
    performers: "performerHighlights",
    performer: "performerHighlights",
    performerhighlights: "performerHighlights",
    topperformers: "performerHighlights",
    performersmostscenes: "performersMostScenes",
    mostscenesperformers: "performersMostScenes",
    performersmostos: "performersMostOs",
    mostosperformers: "performersMostOs",
    performershighestrating: "performersHighestRating",
    highestratingperformers: "performersHighestRating",
    performershighestratedscenes: "performersHighestRatedScenes",
    performerswithhighestratedscenes: "performersHighestRatedScenes",
    tags: "topTags",
    toptags: "topTags",
    timeline: "releaseTimeline",
    releasetimeline: "releaseTimeline",
    scenes: "sceneHighlights",
    scenehighlights: "sceneHighlights",
    topratedscenes: "topRatedScenes",
    recentreleases: "recentReleases",
    scenesmostos: "scenesMostOs",
    sceneswithmostos: "scenesMostOs",
    demographics: "performerDemographics",
    performerdemographics: "performerDemographics",
    scenecharts: "sceneCharts",
    charts: "sceneCharts",
    needsattention: "needsAttention",
    needattention: "needsAttention",
    attention: "needsAttention",
    cleanup: "needsAttention",
  };
  const DISPLAY_PROFILES = new Set(["compact", "standard", "rich"]);
  const TOP_TAG_LAYOUTS = new Set(["rows", "columns", "flow"]);
  const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DEMOGRAPHIC_COLORS = ["#8ec5ff", "#ffd680", "#9af0c8", "#ff9eb3", "#d4a8ff", "#f5a267", "#8fe1e7", "#c7e86b", "#f08ee6", "#8d98a8"];
  const O_COUNT_ICON = "\u{1F4A6}";
  const AGE_BUCKETS = [
    { label: "18-20", min: 18, max: 20 },
    { label: "21-24", min: 21, max: 24 },
    { label: "25-29", min: 25, max: 29 },
    { label: "30-34", min: 30, max: 34 },
    { label: "35-39", min: 35, max: 39 },
    { label: "40-44", min: 40, max: 44 },
    { label: "45+", min: 45, max: 120 },
  ];
  const RATING_BUCKETS = [
    { label: "0.0-0.9", min: 0, max: 0.9 },
    { label: "1.0-1.9", min: 1, max: 1.9 },
    { label: "2.0-2.9", min: 2, max: 2.9 },
    { label: "3.0-3.9", min: 3, max: 3.9 },
    { label: "4.0-4.9", min: 4, max: 4.9 },
    { label: "5.0-5.9", min: 5, max: 5.9 },
    { label: "6.0-6.9", min: 6, max: 6.9 },
    { label: "7.0-7.9", min: 7, max: 7.9 },
    { label: "8.0-8.9", min: 8, max: 8.9 },
    { label: "9.0-9.9", min: 9, max: 9.9 },
    { label: "10.0", min: 10, max: 10 },
  ];
  const RESOLUTION_BUCKETS = [
    { label: "144p", enumValue: "VERY_LOW", max: 144 },
    { label: "240p", enumValue: "LOW", max: 240 },
    { label: "360p", enumValue: "R360P", max: 360 },
    { label: "480p", enumValue: "STANDARD", max: 480 },
    { label: "540p", enumValue: "WEB_HD", max: 540 },
    { label: "720p", enumValue: "STANDARD_HD", max: 720 },
    { label: "1080p", enumValue: "FULL_HD", max: 1080 },
    { label: "1440p", enumValue: "QUAD_HD", max: 1440 },
    { label: "4K", enumValue: "FOUR_K", max: 2160 },
    { label: "5K", enumValue: "FIVE_K", max: 2880 },
    { label: "6K", enumValue: "SIX_K", max: 3240 },
    { label: "7K", enumValue: "SEVEN_K", max: 3780 },
    { label: "8K", enumValue: "EIGHT_K", max: 4320 },
    { label: "8K+", enumValue: "HUGE", max: null },
  ];
  const DURATION_BUCKETS = [
    { label: "<5m", min: null, max: 5 },
    { label: "5-15m", min: 5, max: 15 },
    { label: "15-30m", min: 15, max: 30 },
    { label: "30-45m", min: 30, max: 45 },
    { label: "45-60m", min: 45, max: 60 },
    { label: "60-90m", min: 60, max: 90 },
    { label: "90-120m", min: 90, max: 120 },
    { label: "120m+", min: 120, max: null },
  ];
  const COUNTRY_NAMES = {
    AD: "Andorra", AE: "United Arab Emirates", AF: "Afghanistan", AG: "Antigua and Barbuda", AI: "Anguilla",
    AL: "Albania", AM: "Armenia", AO: "Angola", AR: "Argentina", AT: "Austria", AU: "Australia",
    BA: "Bosnia and Herzegovina", BB: "Barbados", BD: "Bangladesh", BE: "Belgium", BF: "Burkina Faso",
    BG: "Bulgaria", BH: "Bahrain", BI: "Burundi", BJ: "Benin", BM: "Bermuda", BN: "Brunei", BO: "Bolivia",
    BR: "Brazil", BS: "Bahamas", BT: "Bhutan", BW: "Botswana", BY: "Belarus", BZ: "Belize", CA: "Canada",
    CD: "Democratic Republic of the Congo", CF: "Central African Republic", CG: "Republic of the Congo",
    CH: "Switzerland", CI: "Cote d'Ivoire", CL: "Chile", CM: "Cameroon", CN: "China", CO: "Colombia",
    CR: "Costa Rica", CU: "Cuba", CV: "Cape Verde", CY: "Cyprus", CZ: "Czech Republic", DE: "Germany",
    DJ: "Djibouti", DK: "Denmark", DM: "Dominica", DO: "Dominican Republic", DZ: "Algeria", EC: "Ecuador",
    EE: "Estonia", EG: "Egypt", ES: "Spain", ET: "Ethiopia", FI: "Finland", FJ: "Fiji", FR: "France",
    GB: "United Kingdom", GD: "Grenada", GE: "Georgia", GH: "Ghana", GM: "Gambia", GN: "Guinea",
    GR: "Greece", GT: "Guatemala", GY: "Guyana", HK: "Hong Kong", HN: "Honduras", HR: "Croatia",
    HT: "Haiti", HU: "Hungary", ID: "Indonesia", IE: "Ireland", IL: "Israel", IN: "India", IQ: "Iraq",
    IR: "Iran", IS: "Iceland", IT: "Italy", JM: "Jamaica", JO: "Jordan", JP: "Japan", KE: "Kenya",
    KG: "Kyrgyzstan", KH: "Cambodia", KR: "South Korea", KW: "Kuwait", KZ: "Kazakhstan", LA: "Laos",
    LB: "Lebanon", LC: "Saint Lucia", LK: "Sri Lanka", LR: "Liberia", LS: "Lesotho", LT: "Lithuania",
    LU: "Luxembourg", LV: "Latvia", LY: "Libya", MA: "Morocco", MC: "Monaco", MD: "Moldova",
    ME: "Montenegro", MG: "Madagascar", MK: "North Macedonia", ML: "Mali", MM: "Myanmar", MN: "Mongolia",
    MO: "Macau", MR: "Mauritania", MT: "Malta", MU: "Mauritius", MV: "Maldives", MW: "Malawi",
    MX: "Mexico", MY: "Malaysia", MZ: "Mozambique", NA: "Namibia", NE: "Niger", NG: "Nigeria",
    NI: "Nicaragua", NL: "Netherlands", NO: "Norway", NP: "Nepal", NZ: "New Zealand", OM: "Oman",
    PA: "Panama", PE: "Peru", PG: "Papua New Guinea", PH: "Philippines", PK: "Pakistan", PL: "Poland",
    PR: "Puerto Rico", PS: "Palestine", PT: "Portugal", PY: "Paraguay", QA: "Qatar", RO: "Romania",
    RS: "Serbia", RU: "Russia", RW: "Rwanda", SA: "Saudi Arabia", SC: "Seychelles", SD: "Sudan",
    SE: "Sweden", SG: "Singapore", SI: "Slovenia", SK: "Slovakia", SN: "Senegal", SO: "Somalia",
    SR: "Suriname", SV: "El Salvador", SY: "Syria", TD: "Chad", TH: "Thailand", TJ: "Tajikistan",
    TN: "Tunisia", TR: "Turkey", TT: "Trinidad and Tobago", TW: "Taiwan", TZ: "Tanzania", UA: "Ukraine",
    UG: "Uganda", US: "United States", UY: "Uruguay", UZ: "Uzbekistan", VE: "Venezuela", VN: "Vietnam",
    ZA: "South Africa", ZM: "Zambia", ZW: "Zimbabwe",
  };

  const state = {
    config: {},
    configKey: "",
    currentStudio: null,
    lastPath: "",
    routeTimer: 0,
    observer: null,
    tooltip: null,
    tooltipAnchor: null,
    tooltipCloseTimer: 0,
    statsCache: new Map(),
    allTags: null,
    studioPageNav: null,
    studioPageHost: null,
    studioPageId: "",
    studioPageRenderToken: 0,
    dashboardHost: null,
    dashboardNav: null,
    dashboardRenderToken: 0,
    dashboardStudios: [],
    dashboardLoadedStudioIds: new Set(),
    dashboardFailedStudioNames: [],
    dashboardStudioSceneCounts: new Map(),
    dashboardStudioUpdatedAt: new Map(),
    dashboardStudioPerformerUpdatedAt: new Map(),
    dashboardTagUpdatedAt: "",
    imageSizeUnavailable: false,
    sceneFileSizeUnavailable: false,
    routeToken: 0,
  };

  function gql(query, variables = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), GRAPHQL_TIMEOUT_MS);
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
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
      })
      .finally(() => window.clearTimeout(timer));
  }

  function openDashboardCacheDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve) => {
      const request = window.indexedDB.open(DASHBOARD_CACHE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DASHBOARD_CACHE_STORE)) {
          db.createObjectStore(DASHBOARD_CACHE_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn("[StashDashboard] Persistent cache open failed", request.error);
        resolve(null);
      };
    });
  }

  async function withDashboardCacheStore(mode, callback) {
    const db = await openDashboardCacheDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(DASHBOARD_CACHE_STORE, mode);
      const store = tx.objectStore(DASHBOARD_CACHE_STORE);
      let result = null;
      try {
        result = callback(store);
      } catch (err) {
        console.warn("[StashDashboard] Persistent cache operation failed", err);
      }
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        console.warn("[StashDashboard] Persistent cache transaction failed", tx.error);
        db.close();
        resolve(null);
      };
    });
  }

  async function getPersistentDashboardScope(key) {
    return withDashboardCacheStore("readonly", (store) => new Promise((resolve) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    }));
  }

  async function setPersistentDashboardScope(key, studio, scope) {
    await withDashboardCacheStore("readwrite", (store) => {
      store.put({
        key,
        configKey: state.configKey || "default",
        studio: {
          id: studio.id,
          name: studio.name,
          imagePath: studio.imagePath || "",
          synthetic: Boolean(studio.synthetic),
        },
        scope,
        savedAt: new Date().toISOString(),
      });
    });
  }

  async function deletePersistentDashboardScope(key) {
    await withDashboardCacheStore("readwrite", (store) => {
      store.delete(key);
    });
  }

  async function clearPersistentDashboardCache() {
    await withDashboardCacheStore("readwrite", (store) => {
      store.clear();
    });
  }

  function getConfigBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return fallback;
  }

  function getConfigString(value, fallback) {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function getConfigNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function delay(ms) {
    const duration = Number(ms || 0);
    return duration > 0 ? new Promise((resolve) => window.setTimeout(resolve, duration)) : Promise.resolve();
  }

  function getSetting(...keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(state.config || {}, key)) {
        return state.config[key];
      }
    }
    return undefined;
  }

  function getDashboardHeaderFontSize() {
    return getConfigNumber(getSetting("z01DashboardHeaderFontSize", "dashboardHeaderFontSize"), 26, 12, 48);
  }

  function getDashboardSubheaderFontSize() {
    return getConfigNumber(getSetting("z02DashboardSubheaderFontSize", "dashboardSubheaderFontSize"), 18, 10, 36);
  }

  function getDashboardContentFontSize() {
    return getConfigNumber(
      getSetting("z03DashboardContentFontSize", "dashboardContentFontSize", "dashboardFontSize"),
      15,
      9,
      28
    );
  }

  function getDashboardTagWidth() {
    return Math.max(
      100,
      Math.round(Number(getSetting("z04DashboardTagWidth", "dashboardTagWidth", "dashboardTagMinWidth") ?? 200) || 200)
    );
  }

  function getDashboardSurfaceColor() {
    return getConfigString(getSetting("z05DashboardSurfaceBackgroundColor", "dashboardSurfaceBackgroundColor"), "#000000");
  }

  function getDashboardSurfaceOpacity() {
    return getConfigNumber(getSetting("z06DashboardSurfaceOpacity", "dashboardSurfaceOpacity"), 0.15, 0, 1);
  }

  function getDashboardSceneLoadLimit() {
    return 1500;
  }

  function getDashboardPageSize() {
    return DEFAULT_STATS_PAGE_SIZE;
  }

  function getDashboardPageDelayMs() {
    return 50;
  }

  function normalizeDashboardSectionKey(value) {
    const key = String(value || "").trim().replace(/[\s_-]+/g, "").toLowerCase();
    if (!key) return "";
    return DASHBOARD_SECTION_ALIASES[key] || "";
  }

  function getDashboardSectionOrder() {
    const raw = String(getSetting("a01DashboardSectionOrder", "dashboardSectionOrder") ?? "").trim();
    if (!raw) return DEFAULT_DASHBOARD_SECTION_ORDER.slice();
    if (/^(none|off|disabled)$/i.test(raw)) return [];
    const seen = new Set();
    const order = raw
      .split(",")
      .map(normalizeDashboardSectionKey)
      .filter((key) => {
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return order.length ? order : DEFAULT_DASHBOARD_SECTION_ORDER.slice();
  }

  function getDashboardSectionDefaultState() {
    const value = getConfigString(
      getSetting("a02DashboardSectionDefaultState", "dashboardSectionDefaultState"),
      "expanded"
    ).toLowerCase();
    if (["collapsed", "collapse", "closed"].includes(value)) return "collapsed";
    if (["remember", "saved", "local"].includes(value)) return "remember";
    return "expanded";
  }

  function getDashboardStudioListGrouping() {
    const stored = getLocalStorageValue(DASHBOARD_STUDIO_GROUPING_KEY);
    const value = getConfigString(stored ?? getSetting("a03StudioListGrouping", "studioListGrouping"), "alphabetical").toLowerCase();
    if (["parent", "parents", "parentstudio", "parent-studio", "hierarchy"].includes(value)) return "parent";
    return "alphabetical";
  }

  function getDashboardIncludeSubStudios() {
    const stored = getLocalStorageValue(DASHBOARD_INCLUDE_SUB_STUDIOS_KEY);
    return getConfigBoolean(stored ?? getSetting("a04IncludeSubStudios", "includeSubStudios"), false);
  }

  function getDashboardShowCachedStudiosOnly() {
    return getConfigBoolean(getLocalStorageValue(DASHBOARD_SHOW_CACHED_ONLY_KEY), false);
  }

  function setDashboardShowCachedStudiosOnly(value) {
    setLocalStorageValue(DASHBOARD_SHOW_CACHED_ONLY_KEY, value ? "true" : "false");
  }

  function getLocalStorageValue(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_err) {
      return null;
    }
  }

  function setLocalStorageValue(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (_err) {
      // Dashboard picker preferences are conveniences; storage failures are safe to ignore.
    }
  }

  function getDashboardFilterPresets() {
    try {
      const parsed = JSON.parse(getLocalStorageValue(DASHBOARD_FILTER_PRESETS_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((preset) => ({
          id: String(preset?.id || `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          name: String(preset?.name || "").trim(),
          studioIds: uniqueValues(preset?.studioIds || preset?.studios || []).map(String).filter(Boolean),
        }))
        .filter((preset) => preset.name && preset.studioIds.length)
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (_err) {
      return [];
    }
  }

  function setDashboardFilterPresets(presets) {
    const normalized = (Array.isArray(presets) ? presets : [])
      .map((preset) => ({
        id: String(preset?.id || `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        name: String(preset?.name || "").trim(),
        studioIds: uniqueValues(preset?.studioIds || preset?.studios || []).map(String).filter(Boolean),
      }))
      .filter((preset) => preset.name && preset.studioIds.length)
      .sort((left, right) => left.name.localeCompare(right.name));
    setLocalStorageValue(DASHBOARD_FILTER_PRESETS_KEY, JSON.stringify(normalized));
  }

  function addDashboardFilterPreset(name, studioIds) {
    const trimmed = String(name || "").trim();
    const ids = uniqueValues(studioIds || []).map(String).filter(Boolean);
    if (!trimmed || !ids.length) return null;
    const presets = getDashboardFilterPresets().filter((preset) => preset.name.toLowerCase() !== trimmed.toLowerCase());
    const preset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmed,
      studioIds: ids,
    };
    setDashboardFilterPresets([...presets, preset]);
    return preset;
  }

  function deleteDashboardFilterPreset(id) {
    setDashboardFilterPresets(getDashboardFilterPresets().filter((preset) => preset.id !== id));
  }

  function minimizeDashboardStudioSelection(ids, studios = state.dashboardStudios || []) {
    const selected = new Set(Array.from(ids || []).map(String).filter(Boolean));
    if (!selected.size) return selected;
    const { byId } = getDashboardStudioMaps(studios);
    return new Set(Array.from(selected).filter((id) => {
      let parentId = byId.get(id)?.parentId || "";
      while (parentId) {
        if (selected.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentId || "";
      }
      return true;
    }));
  }

  function getDashboardTopTagLimit() {
    return Math.round(getConfigNumber(getSetting("c03TopTagsPerCategory", "topTagsPerCategory"), 10, 1, TOP_TAG_MAX));
  }

  function getDashboardTopTagLayout() {
    const layout = getConfigString(getSetting("c02TopTagCategoryLayout", "topTagCategoryLayout"), "rows").toLowerCase();
    return TOP_TAG_LAYOUTS.has(layout) ? layout : "rows";
  }

  function getPieSliceMax() {
    const value = Number(getSetting("c06PieChartSliceMax", "pieChartSliceMax") ?? 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.round(value));
  }

  function getIncludeSubtagsInPieCharts() {
    return getConfigBoolean(getSetting("c07IncludeSubtagsInPieCharts", "includeSubtagsInPieCharts"), false);
  }

  function getHideUnknownChartSlices(kind) {
    const key = kind === "scene" ? DASHBOARD_HIDE_UNKNOWN_SCENE_CHARTS_KEY : DASHBOARD_HIDE_UNKNOWN_PERFORMER_CHARTS_KEY;
    return getConfigBoolean(getLocalStorageValue(key), false);
  }

  function setHideUnknownChartSlices(kind, value) {
    const key = kind === "scene" ? DASHBOARD_HIDE_UNKNOWN_SCENE_CHARTS_KEY : DASHBOARD_HIDE_UNKNOWN_PERFORMER_CHARTS_KEY;
    setLocalStorageValue(key, value ? "true" : "false");
  }

  function getDemographicTooltipImageHeight() {
    const value = getSetting("d02DemographicTooltipImageHeight", "d02ShowDemographicTooltipImages", "showDemographicTooltipImages");
    if (typeof value === "boolean") return value ? 78 : 0;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 78;
    return Math.max(0, Math.min(240, Math.round(numeric)));
  }

  function getAgeBuckets() {
    const configured = getConfigString(getSetting("d03AgeGroups", "ageGroups"), "");
    const buckets = parseAgeBuckets(configured);
    return (buckets.length ? buckets : AGE_BUCKETS).slice(0, DEMOGRAPHIC_AGE_GROUP_MAX);
  }

  function getRatingBuckets() {
    const configured = getConfigString(getSetting("d04RatingGroups", "ratingGroups"), "");
    const buckets = parseRatingBuckets(configured);
    return buckets.length ? buckets : RATING_BUCKETS;
  }

  function getSceneRatingBuckets() {
    const configured = getConfigString(getSetting("e01SceneRatingGroups", "sceneRatingGroups"), "");
    const buckets = parseRatingBuckets(configured);
    return buckets.length ? buckets : RATING_BUCKETS;
  }

  function getRatingDisplayScale(buckets) {
    const values = (buckets || [])
      .flatMap((bucket) => [bucket?.min, bucket?.max])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return 10;
    return Math.max(...values) <= 5 ? 5 : 10;
  }

  function getResolutionBuckets() {
    return RESOLUTION_BUCKETS;
  }

  function getDurationBuckets() {
    const configured = getConfigString(getSetting("e02SceneDurationGroups", "sceneDurationGroups"), "");
    const buckets = parseMetricBuckets(configured, { unit: "m" });
    return buckets.length ? buckets : DURATION_BUCKETS;
  }

  function getPerformerPieChartTagRef(index) {
    const keyNumber = { 1: "d05", 2: "d07", 3: "d09" }[index] || "d05";
    return getConfigString(getSetting(`${keyNumber}PerformerPieChart${index}Tag`), "");
  }

  function getPerformerPieChartLabel(index) {
    const keyNumber = { 1: "d06", 2: "d08", 3: "d10" }[index] || "d06";
    return getConfigString(getSetting(`${keyNumber}PerformerPieChart${index}Label`), `Performer pie ${index}`);
  }

  function getScenePieChartTagRef(index) {
    const keyNumber = { 1: "e03", 2: "e05", 3: "e07" }[index] || "e03";
    return getConfigString(getSetting(`${keyNumber}ScenePieChart${index}Tag`, `scenePieChart${index}Tag`), "");
  }

  function getScenePieChartLabel(index) {
    const keyNumber = { 1: "e04", 2: "e06", 3: "e08" }[index] || "e04";
    return getConfigString(getSetting(`${keyNumber}ScenePieChart${index}Label`, `scenePieChart${index}Label`), `Scene pie ${index}`);
  }

  function getDisplayProfile() {
    const value = getSetting("a02DisplayProfile", "displayProfile");
    if (value == null) return "standard";
    const profile = String(value).trim().toLowerCase();
    if (!profile) return "";
    return DISPLAY_PROFILES.has(profile) ? profile : "standard";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function openLinkInNewTab(link) {
    if (!(link instanceof HTMLAnchorElement)) return link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  async function loadConfig() {
    const data = await gql(`
      query StashDashboardConfig {
        configuration {
          plugins
        }
      }
    `);
    const plugins = data?.configuration?.plugins || {};
    const nextConfig = plugins[PLUGIN_ID] || {};
    const nextKey = JSON.stringify(nextConfig);
    if (state.configKey && state.configKey !== nextKey) {
      state.statsCache.clear();
    }
    state.config = nextConfig;
    state.configKey = nextKey;
  }

  async function saveConfig(nextConfig) {
    const config = nextConfig && typeof nextConfig === "object" && !Array.isArray(nextConfig) ? nextConfig : {};
    await gql(
      `mutation ConfigureStashDashboard($pluginId: ID!, $input: Map!) {
        configurePlugin(plugin_id: $pluginId, input: $input)
      }`,
      { pluginId: PLUGIN_ID, input: config }
    );
    state.config = config;
    state.configKey = JSON.stringify(config);
    state.statsCache.clear();
  }

  function clonePlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.parse(JSON.stringify(value));
  }

  function exportDashboardSettings() {
    const payload = {
      plugin: PLUGIN_ID,
      exportedAt: new Date().toISOString(),
      settings: clonePlainObject(state.config),
      dashboardPreferences: {
        studioListGrouping: getDashboardStudioListGrouping(),
        includeSubStudios: getDashboardIncludeSubStudios(),
        showCachedStudiosOnly: getDashboardShowCachedStudiosOnly(),
        filterPresets: getDashboardFilterPresets(),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `stash-dashboard-settings-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function normalizeImportedDashboardSettings(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (payload.plugin && payload.plugin !== PLUGIN_ID) return null;
    const settings = payload.settings || payload.config || payload;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
    return clonePlainObject(settings);
  }

  function importDashboardPreferences(payload) {
    const preferences = payload?.dashboardPreferences || payload?.dashboard || {};
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return;
    if (Object.prototype.hasOwnProperty.call(preferences, "studioListGrouping")) {
      setLocalStorageValue(
        DASHBOARD_STUDIO_GROUPING_KEY,
        String(preferences.studioListGrouping).toLowerCase() === "parent" ? "parent" : "alphabetical"
      );
    }
    if (Object.prototype.hasOwnProperty.call(preferences, "includeSubStudios")) {
      setLocalStorageValue(
        DASHBOARD_INCLUDE_SUB_STUDIOS_KEY,
        getConfigBoolean(preferences.includeSubStudios, false) ? "true" : "false"
      );
    }
    if (Object.prototype.hasOwnProperty.call(preferences, "showCachedStudiosOnly")) {
      setDashboardShowCachedStudiosOnly(getConfigBoolean(preferences.showCachedStudiosOnly, false));
    }
    if (Object.prototype.hasOwnProperty.call(preferences, "filterPresets")) {
      setDashboardFilterPresets(preferences.filterPresets);
    }
  }

  function getPageEntity() {
    const path = window.location.pathname;
    const scene = path.match(/^\/scenes\/(\d+)/);
    if (scene) return { type: "scene", id: scene[1] };
    const image = path.match(/^\/images\/(\d+)/);
    if (image) return { type: "image", id: image[1] };
    const gallery = path.match(/^\/galleries\/(\d+)/);
    if (gallery) return { type: "gallery", id: gallery[1] };
    return null;
  }

  function isContentBrowserPage() {
    return /^\/(?:scenes|images|galleries)\/?$/.test(window.location.pathname);
  }

  function getStudioPageId() {
    const match = window.location.pathname.match(/^\/studios\/(\d+)(?:\/|$)/);
    return match ? match[1] : "";
  }

  async function fetchCurrentStudio(entity) {
    if (!entity) return null;

    const queryByType = {
      scene: `
        query StashDashboardSceneStudio($id: ID!) {
          findScene(id: $id) {
            id
            studio { id name image_path }
          }
        }
      `,
      image: `
        query StashDashboardImageStudio($id: ID!) {
          findImage(id: $id) {
            id
            studio { id name image_path }
          }
        }
      `,
      gallery: `
        query StashDashboardGalleryStudio($id: ID!) {
          findGallery(id: $id) {
            id
            studio { id name image_path }
          }
        }
      `,
    };
    const data = await gql(queryByType[entity.type], { id: entity.id });
    return normalizeStudio(
      data?.findScene?.studio || data?.findImage?.studio || data?.findGallery?.studio
    );
  }

  async function fetchStudioById(id) {
    if (!id) return null;
    const data = await gql(`
      query StashDashboardStudio($id: ID!) {
        findStudio(id: $id) {
          id
          name
          image_path
        }
      }
    `, { id });
    return normalizeStudio(data?.findStudio);
  }

  function normalizeStudio(studio) {
    if (!studio?.id) return null;
    return {
      id: String(studio.id),
      name: String(studio.name || "Studio"),
      imagePath: String(studio.image_path || "").trim(),
    };
  }

  function studioFilter(studioId) {
    if (String(studioId || "") === NO_STUDIO_ID) {
      return {
        studios: {
          value: [],
          modifier: "IS_NULL",
        },
      };
    }
    if (!studioId) return {};
    return {
      studios: {
        value: [String(studioId)],
        modifier: "INCLUDES",
      },
    };
  }

  async function fetchAllTags() {
    if (state.allTags) return state.allTags;
    const data = await gql(`
      query StashDashboardAllTags {
        findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
          tags {
            id
            name
            image_path
            children { id }
          }
        }
      }
    `);
    state.allTags = (data?.findTags?.tags || []).map((tag) => ({
      id: String(tag?.id || ""),
      name: String(tag?.name || ""),
      imagePath: String(tag?.image_path || ""),
      childIds: (tag?.children || []).map((child) => String(child?.id || "")).filter(Boolean),
    })).filter((tag) => tag.id && tag.name);
    return state.allTags;
  }

  function parseList(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  function normalizeRef(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isTagRefMatch(tag, ref) {
    const normalized = normalizeRef(ref);
    if (!normalized || !tag) return false;
    return String(tag.id || "").toLowerCase() === normalized ||
      String(tag.name || "").trim().toLowerCase() === normalized;
  }

  function addTagAndDescendants(tag, tagMap, targetSet) {
    if (!tag?.id || targetSet.has(`id:${tag.id.toLowerCase()}`)) return;
    targetSet.add(`id:${tag.id.toLowerCase()}`);
    targetSet.add(`name:${tag.name.toLowerCase()}`);
    tag.childIds.forEach((childId) => addTagAndDescendants(tagMap.get(childId), tagMap, targetSet));
  }

  function collectDescendantTagIds(tag, tagMap, targetSet = new Set()) {
    if (!tag?.id) return targetSet;
    tag.childIds.forEach((childId) => {
      if (targetSet.has(childId)) return;
      targetSet.add(childId);
      collectDescendantTagIds(tagMap.get(childId), tagMap, targetSet);
    });
    return targetSet;
  }

  async function getConfiguredTopTagCategories() {
    const refs = parseList(getSetting("c01TopTagCategories", "topTagCategories"));
    if (!refs.length) return [];

    try {
      const allTags = await fetchAllTags();
      const tagMap = new Map(allTags.map((tag) => [tag.id, tag]));
      const categories = refs
        .map((ref) => allTags.find((tag) => isTagRefMatch(tag, ref)))
        .filter(Boolean)
        .filter((tag, index, tags) => tags.findIndex((item) => item.id === tag.id) === index)
        .slice(0, TOP_TAG_CATEGORY_MAX)
        .map((tag) => {
          const descendantIds = collectDescendantTagIds(tag, tagMap);
          return {
            id: tag.id,
            name: tag.name,
            tagIds: descendantIds.size ? descendantIds : new Set([tag.id]),
          };
        });
      categories.forEach((category) => {
        categories.forEach((candidate) => {
          if (category.id === candidate.id || !category.tagIds.has(candidate.id)) return;
          candidate.tagIds.forEach((tagId) => category.tagIds.delete(tagId));
          category.tagIds.delete(candidate.id);
        });
      });
      return categories;
    } catch (err) {
      console.warn("[StashDashboard] Top tag categories failed", err);
      return [];
    }
  }

  async function buildTopTagFilters() {
    const blacklist = parseList(getSetting("c05TopTagBlacklist", "topTagBlacklist"));
    const whitelist = parseList(getSetting("c04TopTagWhitelist", "topTagWhitelist"));
    if (!blacklist.length && !whitelist.length) return { blacklist: new Set(), whitelist: null };

    try {
      const allTags = await fetchAllTags();
      const tagMap = new Map(allTags.map((tag) => [tag.id, tag]));
      const expand = (items) => {
        const set = new Set();
        items.forEach((item) => {
          allTags
            .filter((tag) => tag.id.toLowerCase() === item || tag.name.toLowerCase() === item)
            .forEach((tag) => addTagAndDescendants(tag, tagMap, set));
        });
        return set;
      };
      return {
        blacklist: expand(blacklist),
        whitelist: whitelist.length ? expand(whitelist) : null,
      };
    } catch (err) {
      console.warn("[StashDashboard] Tag filter hierarchy failed", err);
      return {
        blacklist: new Set(blacklist.flatMap((item) => [`id:${item}`, `name:${item}`])),
        whitelist: whitelist.length
          ? new Set(whitelist.flatMap((item) => [`id:${item}`, `name:${item}`]))
          : null,
      };
    }
  }

  function isTagAllowed(tag, filters) {
    const keys = [`id:${String(tag?.id || "").toLowerCase()}`, `name:${String(tag?.name || "").toLowerCase()}`];
    if (filters.whitelist && !keys.some((key) => filters.whitelist.has(key))) return false;
    return !keys.some((key) => filters.blacklist.has(key));
  }

  async function buildDashboardExcludeTagSet() {
    const refs = [];
    if (!refs.length) return new Set();
    try {
      const allTags = await fetchAllTags();
      const tagMap = new Map(allTags.map((tag) => [tag.id, tag]));
      const set = new Set();
      refs.forEach((ref) => {
        allTags
          .filter((tag) => tag.id.toLowerCase() === ref || tag.name.toLowerCase() === ref)
          .forEach((tag) => addTagAndDescendants(tag, tagMap, set));
      });
      return set;
    } catch (err) {
      console.warn("[StashDashboard] Exclude tag hierarchy failed", err);
      return new Set(refs.flatMap((item) => [`id:${item}`, `name:${item}`]));
    }
  }

  function sceneHasExcludedTag(scene, excludedTags) {
    if (!excludedTags?.size) return false;
    return (scene?.tags || []).some((tag) => {
      const keys = [`id:${String(tag?.id || "").toLowerCase()}`, `name:${String(tag?.name || "").toLowerCase()}`];
      return keys.some((key) => excludedTags.has(key));
    });
  }

  function sceneMatchesPathFilters(scene) {
    const includePaths = [];
    const excludePaths = parseList(getSetting("a05ExcludePaths", "a04ExcludePaths", "excludePaths"));
    if (!includePaths.length && !excludePaths.length) return true;
    const paths = (scene?.files || []).map((file) => String(file?.path || "").toLowerCase()).filter(Boolean);
    const includeOk = !includePaths.length || paths.some((path) => includePaths.some((fragment) => path.includes(fragment)));
    const excludeOk = !excludePaths.length || !paths.some((path) => excludePaths.some((fragment) => path.includes(fragment)));
    return includeOk && excludeOk;
  }

  function sceneMatchesStudioFilters(scene) {
    const includeStudios = [];
    const excludeStudios = parseList(getSetting("a06ExcludeStudios", "excludeStudios"));
    if (!includeStudios.length && !excludeStudios.length) return true;
    const studio = scene?.studio || {};
    const keys = [String(studio?.id || "").toLowerCase(), String(studio?.name || "").toLowerCase()].filter(Boolean);
    const includeOk = !includeStudios.length || includeStudios.some((ref) => keys.includes(ref));
    const excludeOk = !excludeStudios.length || !excludeStudios.some((ref) => keys.includes(ref));
    return includeOk && excludeOk;
  }

  async function filterDashboardScenes(scenes) {
    const excludedTags = await buildDashboardExcludeTagSet();
    return (scenes || []).filter((scene) =>
      !sceneHasExcludedTag(scene, excludedTags) &&
      sceneMatchesPathFilters(scene) &&
      sceneMatchesStudioFilters(scene)
    );
  }

  function buildTopTags(scenes, filters) {
    const counts = new Map();
    scenes.forEach((scene) => {
      const seen = new Set();
      (scene?.tags || []).forEach((tag) => {
        const id = String(tag?.id || "");
        const name = String(tag?.name || "").trim();
        if (!id || !name || seen.has(id) || !isTagAllowed(tag, filters)) return;
        seen.add(id);
        const existing = counts.get(id) || {
          id,
          name,
          imagePath: String(tag?.image_path || ""),
          count: 0,
        };
        existing.count += 1;
        counts.set(id, existing);
      });
    });
    return Array.from(counts.values())
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.name.localeCompare(right.name);
      })
      .slice(0, TOP_TAG_MAX);
  }

  function buildTopTagGroups(scenes, filters, categories) {
    if (!categories?.length) return [];
    return categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        tags: buildTopTags(
          scenes.map((scene) => ({
            ...scene,
            tags: (scene?.tags || []).filter((tag) => category.tagIds.has(String(tag?.id || ""))),
          })),
          filters
        ),
      }))
      .filter((group) => group.tags.length);
  }

  function pickPerformer(performers, sorter, filter = () => true) {
    return performers
      .filter(filter)
      .slice()
      .sort(sorter)[0] || null;
  }

  function pickPerformers(performers, sorter, filter = () => true, limit = DASHBOARD_ROW_CARD_LIMIT) {
    return performers
      .filter(filter)
      .slice()
      .sort(sorter)
      .slice(0, limit);
  }

  function performerMetricValue(performer, metricKey) {
    if (metricKey === "mostScenes" || metricKey === "leastScenes") return String(Number(performer?.count || 0));
    if (metricKey === "mostOCount" || metricKey === "leastOCount") return String(Number(performer?.oCount || 0));
    if (metricKey === "highestRating" || metricKey === "lowestRating") return formatRating(performer?.performerRating);
    if (metricKey === "highestStudioContentRating" || metricKey === "lowestStudioContentRating") return formatContentRating(performer?.studioTopRating);
    return "";
  }

  function performerMetricCard(performer, metricKey, metricTitle, options = {}) {
    if (!performer) return null;
    const title = options.useMetricValue ? performerMetricValue(performer, metricKey) : metricTitle;
    return {
      id: performer.id,
      name: performer.name,
      imagePath: performer.imagePath,
      count: performer.count,
      oCount: performer.oCount,
      allOCount: performer.allOCount,
      allSceneCount: performer.allSceneCount,
      allTopRating: performer.allTopRating,
      performerRating: performer.performerRating,
      studioTopRating: performer.studioTopRating,
      metricKey,
      metricTitle: title,
    };
  }

  function performerMetricCards(performers, metricKey, metricTitle, options = {}) {
    return (performers || [])
      .map((performer) => performerMetricCard(performer, metricKey, metricTitle, options))
      .filter(Boolean);
  }

  function buildPerformerHighlights(performers) {
    const byMostScenes = (left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.name.localeCompare(right.name);
    };
    const byLeastScenes = (left, right) => {
      if (left.count !== right.count) return left.count - right.count;
      return left.name.localeCompare(right.name);
    };
    const byHighestRating = (left, right) => {
      if (right.performerRating !== left.performerRating) return right.performerRating - left.performerRating;
      return byMostScenes(left, right);
    };
    const byLowestRating = (left, right) => {
      if (left.performerRating !== right.performerRating) return left.performerRating - right.performerRating;
      return byMostScenes(left, right);
    };
    const byMostOCount = (left, right) => {
      if (right.oCount !== left.oCount) return right.oCount - left.oCount;
      return byMostScenes(left, right);
    };
    const byLeastOCount = (left, right) => {
      if (left.oCount !== right.oCount) return left.oCount - right.oCount;
      return byMostScenes(left, right);
    };
    const byHighestStudioContentRating = (left, right) => {
      if (right.studioTopRating !== left.studioTopRating) return right.studioTopRating - left.studioTopRating;
      return byMostScenes(left, right);
    };
    const byLowestStudioContentRating = (left, right) => {
      if (left.studioTopRating !== right.studioTopRating) return left.studioTopRating - right.studioTopRating;
      return byMostScenes(left, right);
    };
    const hasRating = (performer) => performer.performerRating > 0;
    const hasStudioContentRating = (performer) => performer.studioTopRating > 0;

    return [
      performerMetricCard(
        pickPerformer(performers, byMostScenes),
        "mostScenes",
        "Most scenes"
      ),
      performerMetricCard(
        pickPerformer(performers, byLeastScenes),
        "leastScenes",
        "Least scenes"
      ),
      performerMetricCard(
        pickPerformer(performers, byHighestRating, hasRating),
        "highestRating",
        "Highest rating"
      ),
      performerMetricCard(
        pickPerformer(performers, byLowestRating, hasRating),
        "lowestRating",
        "Lowest rating"
      ),
      performerMetricCard(
        pickPerformer(performers, byMostOCount),
        "mostOCount",
        "Most O's"
      ),
      performerMetricCard(
        pickPerformer(performers, byLeastOCount),
        "leastOCount",
        "Least O's"
      ),
      performerMetricCard(
        pickPerformer(performers, byHighestStudioContentRating, hasStudioContentRating),
        "highestStudioContentRating",
        "Top rated scene"
      ),
      performerMetricCard(
        pickPerformer(performers, byLowestStudioContentRating, hasStudioContentRating),
        "lowestStudioContentRating",
        "Lowest rated scene"
      ),
    ].filter(Boolean);
  }

  function buildPerformerHighlightRows(performers) {
    const byMostScenes = (left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.name.localeCompare(right.name);
    };
    const byMostOCount = (left, right) => {
      if (right.oCount !== left.oCount) return right.oCount - left.oCount;
      return byMostScenes(left, right);
    };
    const byHighestRating = (left, right) => {
      if (right.performerRating !== left.performerRating) return right.performerRating - left.performerRating;
      return byMostScenes(left, right);
    };
    const byHighestStudioContentRating = (left, right) => {
      if (right.studioTopRating !== left.studioTopRating) return right.studioTopRating - left.studioTopRating;
      return byMostScenes(left, right);
    };
    return {
      performersMostScenes: performerMetricCards(
        pickPerformers(performers, byMostScenes),
        "mostScenes",
        "Most scenes",
        { useMetricValue: true }
      ),
      performersMostOs: performerMetricCards(
        pickPerformers(performers, byMostOCount, (performer) => Number(performer.oCount || 0) > 0),
        "mostOCount",
        "Most O's",
        { useMetricValue: true }
      ),
      performersHighestRating: performerMetricCards(
        pickPerformers(performers, byHighestRating, (performer) => Number(performer.performerRating || 0) > 0),
        "highestRating",
        "Highest rating",
        { useMetricValue: true }
      ),
      performersHighestRatedScenes: performerMetricCards(
        pickPerformers(performers, byHighestStudioContentRating, (performer) => Number(performer.studioTopRating || 0) > 0),
        "highestStudioContentRating",
        "Top rated scene",
        { useMetricValue: true }
      ),
    };
  }

  function attachStudioToPerformers(performers, studio) {
    (performers || []).forEach((performer) => {
      performer.studioId = studio?.id || "";
      performer.studioName = studio?.name || "";
    });
  }

  function getPerformerHighlightsForProfile(stats, profile) {
    const highlights = Array.isArray(stats?.performerHighlights) ? stats.performerHighlights : [];
    if (profile === "rich") return highlights.slice(0, 6);
    const keys = new Set(["mostScenes", "highestRating", "mostOCount"]);
    return highlights.filter((performer) => keys.has(performer.metricKey)).slice(0, 3);
  }

  async function hydratePerformerGlobalStats(performers) {
    const unique = Array.from(new Map((performers || []).map((performer) => [performer.id, performer])).values());
    await Promise.all(unique.map(async (performer) => {
      try {
        const data = await gql(
          `
            query StashDashboardPerformerGlobalStats($sceneFilter: SceneFilterType) {
              findScenes(scene_filter: $sceneFilter, filter: { per_page: -1 }) {
                count
                scenes {
                  rating100
                  o_counter
                }
              }
            }
          `,
          {
            sceneFilter: {
              performers: {
                value: [String(performer.id)],
                modifier: "INCLUDES_ALL",
              },
            },
          }
        );
        const scenes = data?.findScenes?.scenes || [];
        const globalStats = {
          allSceneCount: Number(data?.findScenes?.count || scenes.length || 0),
          allOCount: scenes.reduce((total, scene) => total + Number(scene?.o_counter || 0), 0),
          allTopRating: scenes.reduce((top, scene) => Math.max(top, Number(scene?.rating100 || 0)), 0),
        };
        performers
          .filter((item) => item.id === performer.id)
          .forEach((item) => Object.assign(item, globalStats));
      } catch (err) {
        console.warn("[StashDashboard] Performer global stats failed", performer.id, err);
      }
    }));
  }

  function addMonths(year, month, amount) {
    const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
    };
  }

  function formatMonthLabel(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  function formatDateLabel(year, month = 1, day = 1) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function formatDateFromUtc(date) {
    return formatDateLabel(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  function getDateBeforeMonth(year, month) {
    const date = new Date(Date.UTC(year, month - 1, 1));
    date.setUTCDate(date.getUTCDate() - 1);
    return formatDateFromUtc(date);
  }

  function getDateAfterMonth(year, month) {
    const date = new Date(Date.UTC(year, month, 1));
    return formatDateFromUtc(date);
  }

  function buildReleaseTimeline(scenes) {
    const monthCounts = new Map();
    const yearCounts = new Map();
    scenes.forEach((scene) => {
      const date = String(scene?.date || "").trim();
      const match = date.match(/^(\d{4})-(\d{2})/);
      if (!match) return;
      const year = match[1];
      const month = `${match[1]}-${match[2]}`;
      monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    });

    const yearKeys = Array.from(yearCounts.keys()).sort((left, right) => left.localeCompare(right));
    const years = [];
    if (yearKeys.length) {
      for (let year = Number(yearKeys[0]); year <= Number(yearKeys[yearKeys.length - 1]); year += 1) {
        const label = String(year);
        years.push({ label, count: yearCounts.get(label) || 0 });
      }
    }

    const monthKeys = Array.from(monthCounts.keys()).sort((left, right) => left.localeCompare(right));
    const months = [];
    if (monthKeys.length) {
      let [year, month] = monthKeys[0].split("-").map(Number);
      const [endYear, endMonth] = monthKeys[monthKeys.length - 1].split("-").map(Number);
      while (year < endYear || (year === endYear && month <= endMonth)) {
        const label = `${year}-${String(month).padStart(2, "0")}`;
        months.push({ label, count: monthCounts.get(label) || 0 });
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }

    return {
      years,
      months,
      startMonth: monthKeys[0] || "",
      endMonth: monthKeys[monthKeys.length - 1] || "",
      maxYear: Math.max(1, ...years.map((item) => item.count)),
      maxMonth: Math.max(1, ...months.map((item) => item.count)),
    };
  }

  function getProfileLimits(profile) {
    if (profile === "rich") {
      return {
        performers: 6,
        tags: 10,
        scenes: 5,
        showTimeline: true,
      };
    }
    return {
      performers: 3,
      tags: 5,
      scenes: 3,
      showTimeline: false,
    };
  }

  function getTimelineItems(timeline) {
    if (!timeline?.months?.length || !timeline.startMonth || !timeline.endMonth) return [];
    const [startYear, startMonth] = timeline.startMonth.split("-").map(Number);
    const [endYear, endMonth] = timeline.endMonth.split("-").map(Number);
    const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    const bucketSize = totalMonths <= 36 ? 1 : totalMonths <= 96 ? 3 : 12;
    const monthCounts = new Map(timeline.months.map((item) => [item.label, item.count]));
    const buckets = [];
    const first = bucketSize === 12
      ? { year: startYear, month: 1 }
      : bucketSize === 3
        ? { year: startYear, month: Math.floor((startMonth - 1) / 3) * 3 + 1 }
        : { year: startYear, month: startMonth };

    for (
      let start = first;
      start.year < endYear || (start.year === endYear && start.month <= endMonth);
      start = addMonths(start.year, start.month, bucketSize)
    ) {
      const monthsInBucket = bucketSize;
      const end = addMonths(start.year, start.month, monthsInBucket - 1);
      let count = 0;
      for (let inner = 0; inner < monthsInBucket; inner += 1) {
        const current = addMonths(start.year, start.month, inner);
        count += monthCounts.get(formatMonthLabel(current.year, current.month)) || 0;
      }

      const label = monthsInBucket === 1
        ? MONTH_ABBREVIATIONS[start.month - 1]
        : bucketSize === 3
          ? `Q${Math.floor((start.month - 1) / 3) + 1}`
          : String(start.year);
      buckets.push({
        label,
        year: String(start.year),
        count,
        startDate: formatDateLabel(start.year, start.month, 1),
        endDate: formatDateLabel(end.year, end.month, lastDayOfMonth(end.year, end.month)),
        filterStartDate: getDateBeforeMonth(start.year, start.month),
        filterEndDate: getDateAfterMonth(end.year, end.month),
      });
    }

    const max = Math.max(1, ...buckets.map((item) => item.count));
    return buckets.map((item) => ({ ...item, max }));
  }

  function getTimelineYearGroups(items) {
    const groups = [];
    items.forEach((item) => {
      const last = groups[groups.length - 1];
      if (last && last.year === item.year) {
        last.span += 1;
      } else {
        groups.push({ year: item.year, span: 1 });
      }
    });
    return groups;
  }

  async function buildPerformerDemographics(performers, scenes) {
    const countryGroups = new Map();
    (performers || []).forEach((performer) => {
      const key = normalizeCountryKey(performer?.country);
      const group = countryGroups.get(key) || {
        key,
        raw: String(performer?.country || ""),
        performerIds: [],
        performers: [],
        count: 0,
      };
      group.count += 1;
      group.performerIds.push(String(performer?.id || ""));
      group.performers.push(normalizeDemographicPerformer(performer));
      countryGroups.set(key, group);
    });

    const ageBuckets = getAgeBuckets();
    const ageCounts = new Map(ageBuckets.map((bucket) => [bucket.label, 0]));
    const agePerformers = new Map(ageBuckets.map((bucket) => [bucket.label, new Map()]));
    let otherAgeCount = 0;
    const otherAgePerformers = new Map();
    let unknownAgeCount = 0;
    const unknownAgePerformers = new Map();
    (scenes || []).forEach((scene) => {
      const sceneDate = String(scene?.date || "");
      (scene?.performers || []).forEach((performer) => {
        const age = calculateAgeAtDate(performer?.birthdate, sceneDate);
        if (age == null) {
          unknownAgeCount += 1;
          const id = String(performer?.id || "");
          if (id) unknownAgePerformers.set(id, normalizeDemographicPerformer(performer));
          return;
        }
        const bucket = ageBuckets.find((item) => ageMatchesBucket(age, item));
        if (bucket) {
          ageCounts.set(bucket.label, (ageCounts.get(bucket.label) || 0) + 1);
          addDemographicPerformer(agePerformers.get(bucket.label), performer);
        } else {
          otherAgeCount += 1;
          const id = String(performer?.id || "");
          if (id) otherAgePerformers.set(id, normalizeDemographicPerformer(performer));
        }
      });
    });
    const knownAgeTotal = Array.from(ageCounts.values()).reduce((total, count) => total + count, 0) + otherAgeCount;
    const ratingDistribution = buildRatingDistribution(performers, {
      getRating: (performer) => Number(performer?.performerRating || 0),
      getEntity: normalizeDemographicPerformer,
      entityKey: "performers",
    });
    const customDistributions = await buildCustomPerformerPieDistributions(performers);

    return {
      countries: buildCountryDistributionItems(countryGroups, Infinity, Math.max(0, performers?.length || 0)),
      ages: buildAgeDistributionItems(
        ageBuckets,
        ageCounts,
        agePerformers,
        knownAgeTotal + unknownAgeCount,
        otherAgeCount,
        otherAgePerformers,
        unknownAgeCount,
        unknownAgePerformers
      ),
      ratings: ratingDistribution.items,
      customPies: customDistributions,
      ageUnknown: unknownAgeCount,
      countryTotal: Math.max(0, performers?.length || 0),
      ageTotal: knownAgeTotal + unknownAgeCount,
      ratingTotal: ratingDistribution.total,
    };
  }

  function buildCountryDistributionItems(groups, limit = Infinity, totalOverride = null) {
    const entries = Array.from(groups.values())
      .filter((group) => Number(group.count || 0) > 0)
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return getCountryDisplayName(left.key).localeCompare(getCountryDisplayName(right.key));
      })
      .slice(0, limit);
    const total = Number(totalOverride || 0) || entries.reduce((sum, group) => sum + Number(group.count || 0), 0);
    return entries.map((group) => ({
      key: group.key,
      label: formatCountryLabel(group.key),
      filterLabel: getCountryDisplayName(group.key),
      countryValue: group.key,
      countryValues: group.key === "Unknown" ? [] : [group.key],
      count: Number(group.count || 0),
      percent: formatPercent(Number(group.count || 0), total),
      performerIds: uniqueValues(group.performerIds).filter(Boolean),
      performers: group.performers || [],
      filterable: group.key !== "Unknown" || uniqueValues(group.performerIds).filter(Boolean).length > 0,
    }));
  }

  function buildAgeDistributionItems(
    buckets,
    counts,
    performerGroups = new Map(),
    totalOverride = null,
    otherCount = 0,
    otherPerformers = new Map(),
    unknownCount = 0,
    unknownPerformers = new Map()
  ) {
    const entries = buckets.map((bucket) => [bucket, Number(counts.get(bucket.label) || 0)])
      .filter(([, count]) => count > 0);
    const total = Number(totalOverride || 0) || entries.reduce((sum, [, count]) => sum + count, 0);
    const items = entries.map(([bucket, count]) => ({
      ...bucket,
      count,
      percent: formatPercent(count, total),
      performers: Array.from(performerGroups.get(bucket.label)?.values() || []),
      performerIds: Array.from(performerGroups.get(bucket.label)?.keys() || []),
    }));
    if (otherCount > 0) {
      items.push({
        label: "Other",
        count: Number(otherCount || 0),
        percent: formatPercent(Number(otherCount || 0), total),
        otherAge: true,
        performers: Array.from(otherPerformers.values()),
        performerIds: Array.from(otherPerformers.keys()),
      });
    }
    if (unknownCount > 0) {
      items.push({
        label: "Unknown",
        count: Number(unknownCount || 0),
        percent: formatPercent(Number(unknownCount || 0), total),
        unknownAge: true,
        performers: Array.from(unknownPerformers.values()),
        performerIds: Array.from(unknownPerformers.keys()),
      });
    }
    return items;
  }

  function buildRatingDistribution(items, options = {}) {
    const buckets = options.buckets || getRatingBuckets();
    const ratingScale = Number(options.ratingScale || getRatingDisplayScale(buckets) || 10);
    const divisor = 100 / Math.max(1, ratingScale);
    const counts = new Map(buckets.map((bucket) => [bucket.label, 0]));
    const entityGroups = new Map(buckets.map((bucket) => [bucket.label, []]));
    const otherEntities = [];
    const unknownEntities = [];
    (items || []).forEach((item) => {
      const rating100 = Number(options.getRating ? options.getRating(item) : item?.rating100 || 0);
      if (!Number.isFinite(rating100) || rating100 <= 0) {
        unknownEntities.push(options.getEntity ? options.getEntity(item) : item);
        return;
      }
      const rating = rating100 / divisor;
      const bucket = buckets.find((candidate) => ratingMatchesBucket(rating, candidate));
      if (bucket) {
        counts.set(bucket.label, (counts.get(bucket.label) || 0) + 1);
        entityGroups.get(bucket.label)?.push(options.getEntity ? options.getEntity(item) : item);
      } else {
        otherEntities.push(options.getEntity ? options.getEntity(item) : item);
      }
    });
    const knownTotal = Array.from(counts.values()).reduce((total, count) => total + count, 0) + otherEntities.length;
    const total = knownTotal + unknownEntities.length;
    const itemsOut = buckets
      .map((bucket) => {
        const count = Number(counts.get(bucket.label) || 0);
        return {
          ...bucket,
          count,
          percent: formatPercent(count, total),
          [options.entityKey || "entities"]: (entityGroups.get(bucket.label) || []).filter(Boolean),
        };
      })
      .filter((item) => item.count > 0);
    if (otherEntities.length) {
      itemsOut.push({
        label: "Other",
        count: otherEntities.length,
        percent: formatPercent(otherEntities.length, total),
        otherRating: true,
        filterable: options.entityKey !== "scenes",
        [options.entityKey || "entities"]: otherEntities.filter(Boolean),
      });
    }
    if (unknownEntities.length) {
      itemsOut.push({
        label: "Unknown",
        count: unknownEntities.length,
        percent: formatPercent(unknownEntities.length, total),
        unknownRating: true,
        [options.entityKey || "entities"]: unknownEntities.filter(Boolean),
      });
    }
    return { total, items: itemsOut };
  }

  function buildMetricDistribution(items, buckets, options = {}) {
    const counts = new Map(buckets.map((bucket) => [bucket.label, 0]));
    const entityGroups = new Map(buckets.map((bucket) => [bucket.label, []]));
    const otherEntities = [];
    const unknownEntities = [];
    (items || []).forEach((item) => {
      const metric = Number(options.getMetric ? options.getMetric(item) : NaN);
      const entity = options.getEntity ? options.getEntity(item) : item;
      if (!Number.isFinite(metric) || metric <= 0) {
        unknownEntities.push(entity);
        return;
      }
      const bucket = buckets.find((candidate) => metricMatchesBucket(metric, candidate));
      if (bucket) {
        counts.set(bucket.label, (counts.get(bucket.label) || 0) + 1);
        entityGroups.get(bucket.label)?.push(entity);
      } else {
        otherEntities.push(entity);
      }
    });
    const knownTotal = Array.from(counts.values()).reduce((total, count) => total + count, 0) + otherEntities.length;
    const total = knownTotal + unknownEntities.length;
    const entityKey = options.entityKey || "entities";
    const itemsOut = buckets
      .map((bucket) => {
        const count = Number(counts.get(bucket.label) || 0);
        return {
          ...bucket,
          count,
          percent: formatPercent(count, total),
          filterable: options.metricType !== "resolution" || Boolean(bucket.enumValue),
          metricType: options.metricType || "",
          [entityKey]: (entityGroups.get(bucket.label) || []).filter(Boolean),
        };
      })
      .filter((item) => item.count > 0);
    if (otherEntities.length) {
      itemsOut.push({
        label: "Other",
        count: otherEntities.length,
        percent: formatPercent(otherEntities.length, total),
        filterable: false,
        metricType: options.metricType || "",
        metricOther: true,
        [entityKey]: otherEntities.filter(Boolean),
      });
    }
    if (unknownEntities.length) {
      itemsOut.push({
        label: "Unknown",
        count: unknownEntities.length,
        percent: formatPercent(unknownEntities.length, total),
        filterable: false,
        metricType: options.metricType || "",
        metricUnknown: true,
        [entityKey]: unknownEntities.filter(Boolean),
      });
    }
    return { total, items: itemsOut };
  }

  async function buildCustomPerformerPieDistributions(performers) {
    const charts = [];
    for (let index = 1; index <= 3; index += 1) {
      const tagRef = getPerformerPieChartTagRef(index);
      if (!tagRef) continue;
      const distribution = await buildCustomTagPieDistribution(performers, tagRef);
      const hasItems = distribution.items.length || distribution.subcharts?.some((subchart) => subchart.items?.length);
      if (!hasItems) continue;
      charts.push({
        ...distribution,
        title: getPerformerPieChartLabel(index),
      });
    }
    return charts;
  }

  async function buildCustomScenePieDistributions(scenes) {
    const charts = [];
    for (let index = 1; index <= 3; index += 1) {
      const tagRef = getScenePieChartTagRef(index);
      if (!tagRef) continue;
      const distribution = await buildCustomSceneTagPieDistribution(scenes, tagRef);
      const hasItems = distribution.items.length || distribution.subcharts?.some((subchart) => subchart.items?.length);
      if (!hasItems) continue;
      charts.push({
        ...distribution,
        title: getScenePieChartLabel(index),
      });
    }
    return charts;
  }

  async function buildCustomTagPieDistribution(performers, tagRef) {
    try {
      const allTags = await fetchAllTags();
      const customGroups = parseCustomPieGroups(tagRef).slice(0, 4);
      if (customGroups.length > 1) {
        const subcharts = customGroups
          .map((group, index) => buildCustomTagPieSubchart(performers, allTags, group, index + 1))
          .filter((subchart) => subchart.items.length);
        return {
          total: Math.max(0, performers?.length || 0),
          items: [],
          subcharts,
        };
      }
      const subchart = buildCustomTagPieSubchart(performers, allTags, customGroups[0] || tagRef, 1);
      return {
        total: subchart.total,
        items: subchart.items,
      };
    } catch (err) {
      console.warn("[StashDashboard] Custom tag pie failed", err);
      return { total: 0, items: [] };
    }
  }

  function buildCustomTagPieSubchart(performers, allTags, tagRef, index) {
    const group = normalizeCustomPieGroup(tagRef, index);
    const selectedTags = resolveCustomPieSliceTags(allTags, group.value);
    const sliceTags = selectedTags.sort((left, right) => left.name.localeCompare(right.name));
    if (!sliceTags.length) return { title: `Group ${index}`, total: 0, items: [] };
    const tagMap = new Map((allTags || []).map((tag) => [tag.id, tag]));
    const matchIdsByTagId = new Map(sliceTags.map((tag) => [tag.id, getCustomPieTagMatchIds(tag, tagMap)]));
    const groups = new Map(sliceTags.map((tag) => [tag.id, {
      key: tag.id,
      label: tag.name,
      filterLabel: tag.name,
      count: 0,
      performers: new Map(),
      performerIds: [],
      tag,
    }]));
    const unknownPerformers = new Map();
    (performers || []).forEach((performer) => {
      const performerTagIds = new Set((performer?.tags || []).map((performerTag) => String(performerTag?.id || "")).filter(Boolean));
      const matchingTags = sliceTags.filter((tag) => {
        const matchIds = matchIdsByTagId.get(tag.id) || new Set([tag.id]);
        return Array.from(matchIds).some((id) => performerTagIds.has(id));
      });
      if (!matchingTags.length) {
        addDemographicPerformer(unknownPerformers, performer);
        return;
      }
      matchingTags.forEach((tag) => {
        const group = groups.get(tag.id);
        if (!group) return;
        group.count += 1;
        addDemographicPerformer(group.performers, performer);
        if (performer?.id) group.performerIds.push(String(performer.id));
      });
    });
    const total = Math.max(0, performers?.length || 0);
    const items = Array.from(groups.values())
      .filter((group) => group.count > 0)
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((group) => ({
        key: group.key,
        label: group.label,
        filterLabel: group.filterLabel,
        count: group.count,
        percent: formatPercent(group.count, total),
        performers: Array.from(group.performers.values()),
        performerIds: uniqueValues(group.performerIds),
        customTag: group.tag,
      }));
    if (unknownPerformers.size > 0) {
      items.push({
        key: "Unknown",
        label: "Unknown",
        filterLabel: "Unknown",
        count: unknownPerformers.size,
        percent: formatPercent(unknownPerformers.size, total),
        performers: Array.from(unknownPerformers.values()),
        performerIds: Array.from(unknownPerformers.keys()),
        customTagUnknown: true,
      });
    }
    return {
      title: group.title || getCustomPieGroupTitle(allTags, group.value, index),
      total,
      items,
    };
  }

  async function buildCustomSceneTagPieDistribution(scenes, tagRef) {
    try {
      const allTags = await fetchAllTags();
      const customGroups = parseCustomPieGroups(tagRef).slice(0, 4);
      if (customGroups.length > 1) {
        const subcharts = customGroups
          .map((group, index) => buildCustomSceneTagPieSubchart(scenes, allTags, group, index + 1))
          .filter((subchart) => subchart.items.length);
        return {
          total: Math.max(0, scenes?.length || 0),
          items: [],
          subcharts,
        };
      }
      const subchart = buildCustomSceneTagPieSubchart(scenes, allTags, customGroups[0] || tagRef, 1);
      return {
        total: subchart.total,
        items: subchart.items,
      };
    } catch (err) {
      console.warn("[StashDashboard] Custom scene tag pie failed", err);
      return { total: 0, items: [] };
    }
  }

  function buildCustomSceneTagPieSubchart(scenes, allTags, tagRef, index) {
    const group = normalizeCustomPieGroup(tagRef, index);
    const selectedTags = resolveCustomPieSliceTags(allTags, group.value);
    const sliceTags = selectedTags.sort((left, right) => left.name.localeCompare(right.name));
    if (!sliceTags.length) return { title: `Group ${index}`, total: 0, items: [] };
    const tagMap = new Map((allTags || []).map((tag) => [tag.id, tag]));
    const matchIdsByTagId = new Map(sliceTags.map((tag) => [tag.id, getCustomPieTagMatchIds(tag, tagMap)]));
    const groups = new Map(sliceTags.map((tag) => [tag.id, {
      key: tag.id,
      label: tag.name,
      filterLabel: tag.name,
      count: 0,
      sceneIds: [],
      tag,
    }]));
    let unknownSceneCount = 0;
    (scenes || []).forEach((scene) => {
      const sceneTagIds = new Set((scene?.tags || []).map((sceneTag) => String(sceneTag?.id || "")).filter(Boolean));
      const matchingTags = sliceTags.filter((tag) => {
        const matchIds = matchIdsByTagId.get(tag.id) || new Set([tag.id]);
        return Array.from(matchIds).some((id) => sceneTagIds.has(id));
      });
      if (!matchingTags.length) {
        unknownSceneCount += 1;
        return;
      }
      matchingTags.forEach((tag) => {
        const group = groups.get(tag.id);
        if (!group) return;
        group.count += 1;
        if (scene?.id) group.sceneIds.push(String(scene.id));
      });
    });
    const total = Math.max(0, scenes?.length || 0);
    const items = Array.from(groups.values())
      .filter((group) => group.count > 0)
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((group) => ({
        key: group.key,
        label: group.label,
        filterLabel: group.filterLabel,
        count: group.count,
        percent: formatPercent(group.count, total),
        sceneIds: uniqueValues(group.sceneIds),
        customTag: group.tag,
      }));
    if (unknownSceneCount > 0) {
      items.push({
        key: "Unknown",
        label: "Unknown",
        filterLabel: "Unknown",
        count: unknownSceneCount,
        percent: formatPercent(unknownSceneCount, total),
        customExcludeTags: sliceTags,
        customTagUnknown: true,
        filterable: true,
      });
    }
    return {
      title: group.title || getCustomPieGroupTitle(allTags, group.value, index),
      total,
      items,
    };
  }

  function parseCustomPieGroups(value) {
    const text = String(value || "").trim();
    const groups = Array.from(text.matchAll(/([^(),]*)\(([^()]+)\)/g))
      .map((match) => {
        const label = String(match[1] || "").trim().replace(/^,+|,+$/g, "").trim();
        const group = String(match[2] || "").trim();
        return group ? { title: label, value: group } : null;
      })
      .filter(Boolean);
    return groups.length ? groups : [text].filter(Boolean);
  }

  function normalizeCustomPieGroup(group, index) {
    if (typeof group === "string") return { title: "", value: group, index };
    return {
      title: String(group?.title || "").trim(),
      value: String(group?.value || "").trim(),
      index,
    };
  }

  function resolveCustomPieSliceTags(allTags, tagRef) {
    const refs = parseList(tagRef);
    if (refs.length > 1) {
      return refs
        .map((ref) => allTags.find((tag) => isTagRefMatch(tag, ref)))
        .filter(Boolean)
        .filter((tag, index, tags) => tags.findIndex((item) => item.id === tag.id) === index);
    }
    return getCustomPieChildTags(allTags, tagRef);
  }

  function getCustomPieGroupTitle(allTags, tagRef, index) {
    const refs = parseList(tagRef);
    if (refs.length === 1) {
      const parent = allTags.find((tag) => isTagRefMatch(tag, tagRef));
      if (parent) return parent.name;
    }
    return `Group ${index}`;
  }

  function getCustomPieChildTags(allTags, tagRef) {
    const parent = allTags.find((tag) => isTagRefMatch(tag, tagRef));
    if (!parent) return [];
    return (parent.childIds || [])
      .map((id) => allTags.find((tag) => tag.id === id))
      .filter(Boolean);
  }

  function getCustomPieTagMatchIds(tag, tagMap) {
    const ids = new Set([tag?.id].filter(Boolean));
    if (getIncludeSubtagsInPieCharts()) {
      collectDescendantTagIds(tag, tagMap, ids);
    }
    return ids;
  }

  function addDemographicPerformer(map, performer) {
    if (!(map instanceof Map)) return;
    const normalized = normalizeDemographicPerformer(performer);
    if (!normalized.id) return;
    const existing = map.get(normalized.id);
    if (!existing || normalized.performerRating > Number(existing.performerRating || 0)) {
      map.set(normalized.id, normalized);
    }
  }

  function normalizeDemographicPerformer(performer) {
    return {
      id: String(performer?.id || ""),
      name: String(performer?.name || "Performer"),
      imagePath: String(performer?.imagePath || performer?.image_path || ""),
      performerRating: Number(performer?.performerRating || performer?.rating100 || 0),
    };
  }

  function mergePerformerTags(existingTags = [], nextTags = []) {
    const map = new Map();
    [...existingTags, ...nextTags].forEach((tag) => {
      const id = String(tag?.id || "");
      if (!id || map.has(id)) return;
      map.set(id, {
        id,
        name: String(tag?.name || "Tag"),
        imagePath: String(tag?.imagePath || tag?.image_path || ""),
      });
    });
    return Array.from(map.values());
  }

  function formatPercent(count, total) {
    const numericTotal = Number(total || 0);
    if (!numericTotal) return "";
    const value = (Number(count || 0) / numericTotal) * 100;
    if (value > 0 && value < 0.1) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    if (value > 0 && value < 1) return value.toFixed(1);
    if (value < 10 && !Number.isInteger(value)) return value.toFixed(1);
    return String(Math.round(value));
  }

  function formatInsightPercent(count, total) {
    const value = formatPercent(count, total);
    return value ? `${value}%` : "0%";
  }

  function formatNumber(value) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric.toLocaleString() : "0";
  }

  function formatDurationMinutes(minutes) {
    const totalMinutes = Math.max(0, Math.round(Number(minutes || 0)));
    if (!totalMinutes) return "0m";
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function formatDurationLong(minutes) {
    const totalMinutes = Math.max(0, Math.round(Number(minutes || 0)));
    if (!totalMinutes) return "0 minutes";
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;
    const parts = [];
    if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (mins || !parts.length) parts.push(`${mins} minute${mins === 1 ? "" : "s"}`);
    return parts.join(" ");
  }

  function formatBytes(bytes) {
    const numeric = Math.max(0, Number(bytes || 0));
    if (!Number.isFinite(numeric) || !numeric) return "0 MiB";
    const units = ["MiB", "GiB", "TiB"];
    let value = numeric / 1024 / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const decimals = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")} ${units[unitIndex]}`;
  }

  function formatInsightDateRange(timeline) {
    if (!timeline?.startMonth || !timeline?.endMonth) return "";
    if (timeline.startMonth === timeline.endMonth) return timeline.startMonth;
    return `${timeline.startMonth} - ${timeline.endMonth}`;
  }

  function normalizeCountryKey(country) {
    const value = String(country || "").trim();
    if (!value) return "Unknown";
    if (/^[a-z]{2,3}$/i.test(value)) return value.toUpperCase();
    return value
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function getCountryDisplayName(countryKey) {
    const key = String(countryKey || "").trim();
    if (!key || key === "Unknown") return "Unknown";
    return COUNTRY_NAMES[key.toUpperCase()] || key;
  }

  function formatCountryLabel(countryKey) {
    const key = String(countryKey || "").trim();
    const flag = getCountryFlag(key);
    const name = getCountryDisplayName(key);
    return `${flag ? `${flag} ` : ""}${name}`;
  }

  function getCountryFlag(countryKey) {
    const key = String(countryKey || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(key)) return "";
    return String.fromCodePoint(...Array.from(key).map((char) => 127397 + char.charCodeAt(0)));
  }

  function parseAgeBuckets(value) {
    return String(value || "")
      .split(",")
      .map((item) => parseAgeBucket(item.trim()))
      .filter(Boolean);
  }

  function parseRatingBuckets(value) {
    return String(value || "")
      .split(",")
      .map((item) => parseRatingBucket(item.trim()))
      .filter(Boolean);
  }

  function parseMetricBuckets(value, options = {}) {
    return String(value || "")
      .split(",")
      .map((item) => parseMetricBucket(item.trim(), options))
      .filter(Boolean);
  }

  function parseMetricBucket(value, options = {}) {
    if (!value) return null;
    const unit = String(options.unit || "").trim();
    const normalized = value.replace(/\s+/g, "").toLowerCase().replace(/minutes?|mins?/g, "m");
    if (unit === "p") {
      const nativeResolution = RESOLUTION_BUCKETS.find((bucket) => {
        return normalized === bucket.label.toLowerCase() ||
          normalized === bucket.enumValue.toLowerCase() ||
          normalized === bucket.label.toLowerCase().replace("k", "k");
      });
      if (nativeResolution) return { ...nativeResolution };
    }
    let match = normalized.match(/^<(\d+(?:\.\d+)?)(?:[pmk])?$/);
    if (match) {
      const max = normalizeMetricValue(match[1], normalized, unit);
      return { label: `<${formatBucketNumber(max)}${unit}`, min: null, max };
    }
    match = normalized.match(/^<=?(\d+(?:\.\d+)?)(?:[pmk])?$/);
    if (match) {
      const max = normalizeMetricValue(match[1], normalized, unit);
      return { label: `<=${formatBucketNumber(max)}${unit}`, min: null, max };
    }
    match = normalized.match(/^(\d+(?:\.\d+)?)(?:[pmk])?-(\d+(?:\.\d+)?)(?:[pmk])?$/);
    if (match) {
      const min = normalizeMetricValue(match[1], normalized, unit);
      const max = normalizeMetricValue(match[2], normalized, unit);
      if (min < max) return { label: `${formatBucketNumber(min)}-${formatBucketNumber(max)}${unit}`, min, max };
    }
    match = normalized.match(/^(\d+(?:\.\d+)?)(?:[pmk])?\+$/);
    if (match) {
      const min = normalizeMetricValue(match[1], normalized, unit);
      return { label: `${formatBucketNumber(min)}${unit}+`, min, max: null };
    }
    match = normalized.match(/^>=?(\d+(?:\.\d+)?)(?:[pmk])?$/);
    if (match) {
      const min = normalizeMetricValue(match[1], normalized, unit);
      return { label: `${formatBucketNumber(min)}${unit}+`, min, max: null };
    }
    match = normalized.match(/^(\d+(?:\.\d+)?)(?:[pmk])?$/);
    if (match) {
      const exact = normalizeMetricValue(match[1], normalized, unit);
      return { label: `${formatBucketNumber(exact)}${unit}`, min: exact, max: exact, exact: true };
    }
    return null;
  }

  function normalizeMetricValue(value, source, unit) {
    const numeric = Number(value);
    if (unit === "p" && /k/.test(source)) return numeric * 540;
    return numeric;
  }

  function getResolutionEnumForHeight(height) {
    const value = Number(height);
    if (!Number.isFinite(value) || value <= 0) return "";
    const bucket = RESOLUTION_BUCKETS.find((item) => item.max == null || value <= item.max);
    return bucket?.enumValue || "";
  }

  function parseRatingBucket(value) {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, "");
    let match = normalized.match(/^(\d{1,2}(?:\.\d+)?)-(\d{1,2}(?:\.\d+)?)$/);
    if (match) {
      const min = Number(match[1]);
      const max = Number(match[2]);
      if (min <= max) return { label: `${formatRatingBucketNumber(min)}-${formatRatingBucketNumber(max)}`, min, max, modifier: "BETWEEN" };
    }
    match = normalized.match(/^(\d{1,2}(?:\.\d+)?)\+$/);
    if (match) return { label: `${formatRatingBucketNumber(Number(match[1]))}+`, min: Number(match[1]), max: null, modifier: "GREATER_THAN" };
    match = normalized.match(/^>=?(\d{1,2}(?:\.\d+)?)$/);
    if (match) return { label: `${formatRatingBucketNumber(Number(match[1]))}+`, min: Number(match[1]), max: null, modifier: "GREATER_THAN" };
    match = normalized.match(/^<=?(\d{1,2}(?:\.\d+)?)$/);
    if (match) return { label: `<=${formatRatingBucketNumber(Number(match[1]))}`, min: null, max: Number(match[1]), modifier: "LESS_THAN" };
    match = normalized.match(/^=?(\d{1,2}(?:\.\d+)?)$/);
    if (match) {
      const exact = Number(match[1]);
      return { label: formatRatingBucketNumber(exact), min: exact, max: exact, modifier: "EQUALS" };
    }
    return null;
  }

  function formatBucketNumber(value) {
    return String(Number(value));
  }

  function formatRatingBucketNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value || "");
    return Number.isInteger(numeric) ? numeric.toFixed(1) : String(numeric);
  }

  function parseAgeBucket(value) {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, "");
    let match = normalized.match(/^(\d{1,3})-(\d{1,3})$/);
    if (match) {
      const min = Number(match[1]);
      const max = Number(match[2]);
      if (min <= max) return { label: `${min}-${max}`, min, max, modifier: "BETWEEN" };
    }
    match = normalized.match(/^(\d{1,3})\+$/);
    if (match) return { label: `${Number(match[1])}+`, min: Number(match[1]), max: null, modifier: "GREATER_THAN" };
    match = normalized.match(/^>=?(\d{1,3})$/);
    if (match) return { label: `${Number(match[1])}+`, min: Number(match[1]), max: null, modifier: "GREATER_THAN" };
    match = normalized.match(/^<=?(\d{1,3})$/);
    if (match) return { label: `<=${Number(match[1])}`, min: null, max: Number(match[1]), modifier: "LESS_THAN" };
    match = normalized.match(/^=(\d{1,3})$/);
    if (match) return { label: `${Number(match[1])}`, min: Number(match[1]), max: Number(match[1]), modifier: "EQUALS" };
    return null;
  }

  function ageMatchesBucket(age, bucket) {
    const value = Number(age);
    if (!Number.isFinite(value)) return false;
    if (bucket.min != null && value < bucket.min) return false;
    if (bucket.max != null && value > bucket.max) return false;
    return true;
  }

  function ratingMatchesBucket(rating, bucket) {
    const value = Number(rating);
    if (!Number.isFinite(value)) return false;
    if (bucket.min != null && value < bucket.min) return false;
    if (bucket.max != null && value > bucket.max) return false;
    return true;
  }

  function metricMatchesBucket(metric, bucket) {
    const value = Number(metric);
    if (!Number.isFinite(value)) return false;
    if (bucket.exact) return value === Number(bucket.min);
    if (bucket.min != null && value < bucket.min) return false;
    if (bucket.max != null && value >= bucket.max) return false;
    return true;
  }

  function uniqueValues(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function calculateAgeAtDate(birthdate, date) {
    const birth = parseDateValue(birthdate);
    const sceneDate = parseDateValue(date);
    if (!birth || !sceneDate || sceneDate < birth) return null;
    let age = sceneDate.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = sceneDate.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && sceneDate.getUTCDate() < birth.getUTCDate())) age -= 1;
    return age >= 18 && age <= 120 ? age : null;
  }

  function getSceneResolutionHeight(scene) {
    const heights = (scene?.files || [])
      .map((file) => Number(file?.height || 0))
      .filter((height) => Number.isFinite(height) && height > 0);
    return heights.length ? Math.max(...heights) : 0;
  }

  function getSceneDurationMinutes(scene) {
    const fileDurations = (scene?.files || [])
      .map((file) => Number(file?.duration || 0))
      .filter((duration) => Number.isFinite(duration) && duration > 0);
    if (fileDurations.length) {
      return fileDurations.reduce((total, duration) => total + duration, 0) / 60;
    }
    const duration = Number(scene?.duration || 0);
    return Number.isFinite(duration) && duration > 0 ? duration / 60 : 0;
  }

  function getFileSizeBytes(files) {
    return (files || [])
      .map((file) => parseFileSizeBytes(file?.size ?? file?.sizeBytes ?? file?.size_bytes ?? file?.fileSize ?? file?.file_size ?? file?.bytes))
      .filter((size) => Number.isFinite(size) && size > 0)
      .reduce((total, size) => total + size, 0);
  }

  function parseFileSizeBytes(value) {
    if (typeof value === "number") return value;
    const normalized = String(value ?? "").replace(/,/g, "").trim();
    if (!normalized) return 0;
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([kmgt]?i?b?)?$/i);
    if (!match) return Number(normalized) || 0;
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) return 0;
    const unit = String(match[2] || "b").toLowerCase();
    if (unit.startsWith("t")) return numeric * 1024 * 1024 * 1024 * 1024;
    if (unit.startsWith("g")) return numeric * 1024 * 1024 * 1024;
    if (unit.startsWith("m")) return numeric * 1024 * 1024;
    if (unit.startsWith("k")) return numeric * 1024;
    return numeric;
  }

  function getSceneSizeBytes(scene) {
    return getFileSizeBytes(scene?.files || []);
  }

  function buildResolutionDistribution(scenes) {
    const buckets = getResolutionBuckets();
    const usesNativeBuckets = buckets.every((bucket) => bucket.enumValue);
    if (usesNativeBuckets) {
      return buildResolutionEnumDistribution(scenes, buckets);
    }
    return buildMetricDistribution(scenes, buckets, {
      getMetric: getSceneResolutionHeight,
      getEntity: normalizeSceneSummary,
      entityKey: "scenes",
      metricType: "resolution",
    });
  }

  function buildResolutionEnumDistribution(scenes, buckets) {
    const counts = new Map(buckets.map((bucket) => [bucket.enumValue, 0]));
    const sceneGroups = new Map(buckets.map((bucket) => [bucket.enumValue, []]));
    const unknownScenes = [];
    (scenes || []).forEach((scene) => {
      const enumValue = getResolutionEnumForHeight(getSceneResolutionHeight(scene));
      const summary = normalizeSceneSummary(scene);
      if (!enumValue || !counts.has(enumValue)) {
        unknownScenes.push(summary);
        return;
      }
      counts.set(enumValue, (counts.get(enumValue) || 0) + 1);
      if (summary) sceneGroups.get(enumValue)?.push(summary);
    });
    const knownTotal = Array.from(counts.values()).reduce((total, count) => total + count, 0);
    const total = knownTotal + unknownScenes.filter(Boolean).length;
    const items = buckets
      .map((bucket) => {
        const count = Number(counts.get(bucket.enumValue) || 0);
        return {
          ...bucket,
          key: bucket.enumValue,
          count,
          percent: formatPercent(count, total),
          filterable: true,
          metricType: "resolution",
          scenes: (sceneGroups.get(bucket.enumValue) || []).filter(Boolean),
        };
      })
      .filter((item) => item.count > 0);
    if (unknownScenes.filter(Boolean).length) {
      items.push({
        label: "Unknown",
        key: "Unknown",
        count: unknownScenes.filter(Boolean).length,
        percent: formatPercent(unknownScenes.filter(Boolean).length, total),
        metricType: "resolution",
        metricUnknown: true,
        filterable: false,
        scenes: unknownScenes.filter(Boolean),
      });
    }
    return { total, items };
  }

  function buildDurationDistribution(scenes) {
    return buildMetricDistribution(scenes, getDurationBuckets(), {
      getMetric: getSceneDurationMinutes,
      getEntity: normalizeSceneSummary,
      entityKey: "scenes",
      metricType: "duration",
    });
  }

  function parseDateValue(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async function fetchStudioStats(studio, options = {}) {
    const studioId = String(studio?.id || "");
    if (!studioId) return null;
    if (state.statsCache.has(studioId)) return state.statsCache.get(studioId);
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

    const statsPromise = fetchStudioStatsUncached(studio, onProgress)
      .then((stats) => {
        state.statsCache.set(studioId, stats);
        return stats;
      })
      .catch((err) => {
        if (state.statsCache.get(studioId) === statsPromise) {
          state.statsCache.delete(studioId);
        }
        throw err;
      });
    state.statsCache.set(studioId, statsPromise);
    return statsPromise;
  }

  async function fetchStashStats(options = {}) {
    const cacheKey = `global:${DASHBOARD_CACHE_VERSION}:${state.configKey || "default"}`;
    if (state.statsCache.has(cacheKey)) return state.statsCache.get(cacheKey);
    const statsPromise = fetchStashStatsByStudio(options.onProgress)
      .then((stats) => {
        state.statsCache.set(cacheKey, stats);
        return stats;
      })
      .catch((err) => {
        if (state.statsCache.get(cacheKey) === statsPromise) {
          state.statsCache.delete(cacheKey);
        }
        throw err;
      });
    state.statsCache.set(cacheKey, statsPromise);
    return statsPromise;
  }

  async function fetchAllStudiosForDashboard() {
    const normalize = (studios) => (studios || [])
      .map((studio) => ({
        id: String(studio?.id || ""),
        name: String(studio?.name || "Studio"),
        imagePath: String(studio?.image_path || ""),
        parentId: String(studio?.parent_studio?.id || ""),
        parentName: String(studio?.parent_studio?.name || ""),
      }))
      .filter((studio) => studio.id);
    const data = await gql(`
      query StashDashboardStudios {
        findStudios(filter: { per_page: -1, sort: "name", direction: ASC }) {
          studios { id name image_path parent_studio { id name } }
        }
      }
    `);
    const studios = normalize(data?.findStudios?.studios);
    if (studios.length) return [
      { id: NO_STUDIO_ID, name: "_NoStudio", imagePath: "", synthetic: true },
      ...studios,
    ];

    const sceneData = await gql(`
      query StashDashboardStudiosFromScenes {
        findScenes(filter: { per_page: 1000, sort: "date", direction: DESC }) {
          scenes {
            studio { id name image_path parent_studio { id name } }
          }
        }
      }
    `);
    const map = new Map();
    (sceneData?.findScenes?.scenes || []).forEach((scene) => {
      const studio = scene?.studio;
      if (studio?.id && !map.has(String(studio.id))) map.set(String(studio.id), studio);
    });
    return [
      { id: NO_STUDIO_ID, name: "_NoStudio", imagePath: "", synthetic: true },
      ...normalize(Array.from(map.values())).sort((left, right) => left.name.localeCompare(right.name)),
    ];
  }

  function sceneStatsFields(includeFiles = true) {
    return `
      id
      title
      studio { id name }
      date
      organized
      updated_at
      rating100
      o_counter
      stash_ids { endpoint stash_id }
      performers { id name image_path rating100 country birthdate updated_at tags { id name image_path updated_at } }
      tags { id name image_path updated_at }
      paths { screenshot preview }
      ${includeFiles ? `files { path width height duration ${state.sceneFileSizeUnavailable ? "" : "size"} }` : ""}
    `;
  }

  async function fetchStatsCounts(studioId) {
    const scopedStudioId = String(studioId || "");
    const data = await gql(
      `
        query StashDashboardCounts(
          $sceneFilter: SceneFilterType
          $imageFilter: ImageFilterType
          $galleryFilter: GalleryFilterType
        ) {
          findScenes(scene_filter: $sceneFilter, filter: { per_page: 1 }) { count }
          findImages(image_filter: $imageFilter, filter: { per_page: 1 }) { count }
          findGalleries(gallery_filter: $galleryFilter, filter: { per_page: 1 }) { count }
        }
      `,
      {
        sceneFilter: studioFilter(scopedStudioId),
        imageFilter: studioFilter(scopedStudioId),
        galleryFilter: studioFilter(scopedStudioId),
      }
    );
    const imageCount = Number(data?.findImages?.count || 0);
    const imageSizeBytes = await fetchImageSizeBytes(scopedStudioId, imageCount);
    return {
      scenes: Number(data?.findScenes?.count || 0),
      images: imageCount,
      galleries: Number(data?.findGalleries?.count || 0),
      imageSizeBytes,
    };
  }

  async function fetchImageSizeBytes(studioId, imageCount) {
    if (!imageCount || state.imageSizeUnavailable) return 0;
    let total = 0;
    for (let offset = 0; offset < imageCount; offset += DEFAULT_IMAGE_STATS_PAGE_SIZE) {
      const page = Math.floor(offset / DEFAULT_IMAGE_STATS_PAGE_SIZE) + 1;
      try {
        const data = await gql(
          `
            query StashDashboardImageSizes($imageFilter: ImageFilterType, $page: Int!, $perPage: Int!) {
              findImages(image_filter: $imageFilter, filter: { page: $page, per_page: $perPage }) {
                images {
                  files { size }
                }
              }
            }
          `,
          {
            imageFilter: studioFilter(studioId),
            page,
            perPage: DEFAULT_IMAGE_STATS_PAGE_SIZE,
          }
        );
        const images = data?.findImages?.images || [];
        total += images.reduce((sum, image) => sum + getFileSizeBytes(image?.files || []), 0);
        if (!images.length) break;
      } catch (err) {
        state.imageSizeUnavailable = true;
        console.warn("[StashDashboard] Image size stats unavailable", err);
        return 0;
      }
    }
    return total;
  }

  async function fetchSceneStatsPage(studioId, page, perPage, includeFiles = true) {
    const data = await gql(
      `
        query StashDashboardSceneStatsPage(
          $sceneFilter: SceneFilterType
          $page: Int!
          $perPage: Int!
        ) {
          findScenes(scene_filter: $sceneFilter, filter: { page: $page, per_page: $perPage, sort: "date", direction: DESC }) {
            scenes {
              ${sceneStatsFields(includeFiles)}
            }
          }
        }
      `,
      {
        sceneFilter: studioFilter(studioId),
        page,
        perPage,
      }
    );
    return data?.findScenes?.scenes || [];
  }

  async function fetchSceneStatsPageSafe(studioId, page, perPage, maxItems, onProgress) {
    try {
      const scenes = await fetchSceneStatsPage(studioId, page, perPage, true);
      return { scenes: scenes.slice(0, maxItems), skipped: 0 };
    } catch (err) {
      if (!state.sceneFileSizeUnavailable && /\bsize\b/i.test(String(err?.message || err))) {
        state.sceneFileSizeUnavailable = true;
        console.warn("[StashDashboard] Scene file size stats unavailable; retrying scene files without size", err);
        const scenes = await fetchSceneStatsPage(studioId, page, perPage, true);
        return { scenes: scenes.slice(0, maxItems), skipped: 0 };
      }
      console.warn("[StashDashboard] Scene page failed, trying single-scene fallback", { page, perPage, err });
      if (onProgress) onProgress(`A scene page failed; isolating problem scenes on page ${page}...`);
    }

    const scenes = [];
    let skipped = 0;
    const startOffset = (page - 1) * perPage;
    for (let index = 0; index < maxItems; index += 1) {
      const singlePage = startOffset + index + 1;
      try {
        const full = await fetchSceneStatsPage(studioId, singlePage, 1, true);
        if (full[0]) scenes.push(full[0]);
      } catch (fullErr) {
        try {
          const minimal = await fetchSceneStatsPage(studioId, singlePage, 1, false);
          if (minimal[0]) scenes.push(minimal[0]);
        } catch (minimalErr) {
          skipped += 1;
          console.warn("[StashDashboard] Skipping scene that failed dashboard stats fetch", { offset: startOffset + index, fullErr, minimalErr });
        }
      }
    }
    return { scenes, skipped };
  }

  function getLatestSceneUpdatedAt(scenes) {
    return (scenes || []).reduce((latest, scene) => {
      const value = String(scene?.updated_at || scene?.updatedAt || "").trim();
      return value && value > latest ? value : latest;
    }, "");
  }

  function getLatestPerformerUpdatedAt(scenes) {
    return (scenes || []).reduce((latest, scene) => {
      (scene?.performers || []).forEach((performer) => {
        const value = String(performer?.updated_at || performer?.updatedAt || "").trim();
        if (value && value > latest) latest = value;
      });
      return latest;
    }, "");
  }

  function getLatestTagUpdatedAtFromScenes(scenes) {
    return (scenes || []).reduce((latest, scene) => {
      (scene?.tags || []).forEach((tag) => {
        const value = String(tag?.updated_at || tag?.updatedAt || "").trim();
        if (value && value > latest) latest = value;
      });
      (scene?.performers || []).forEach((performer) => {
        (performer?.tags || []).forEach((tag) => {
          const value = String(tag?.updated_at || tag?.updatedAt || "").trim();
          if (value && value > latest) latest = value;
        });
      });
      return latest;
    }, "");
  }

  async function fetchDashboardSceneScope(studio, onProgress, options = {}) {
    const studioId = String(studio?.id || "");
    const sceneLoadLimit = options.sceneLoadLimit == null ? getDashboardSceneLoadLimit() : Number(options.sceneLoadLimit || 0);
    const pageSize = getDashboardPageSize();
    const pageDelayMs = getDashboardPageDelayMs();
    const counts = await fetchStatsCounts(studioId);
    const scenes = [];
    let skippedScenes = 0;
    const sceneCount = counts.scenes;
    const targetSceneCount = sceneLoadLimit > 0 ? Math.min(sceneCount, sceneLoadLimit) : sceneCount;
    if (onProgress && targetSceneCount > 0) {
      const limitSuffix = sceneLoadLimit > 0 && sceneCount > sceneLoadLimit ? ` (limited from ${sceneCount})` : "";
      onProgress(`Loading studio scenes 0 / ${targetSceneCount}${limitSuffix}...`);
    }
    for (let offset = 0; offset < targetSceneCount; offset += pageSize) {
      if (offset > 0) await delay(pageDelayMs);
      const page = Math.floor(offset / pageSize) + 1;
      const maxItems = Math.min(pageSize, targetSceneCount - offset);
      const pageResult = await fetchSceneStatsPageSafe(studioId, page, pageSize, maxItems, onProgress);
      if (!pageResult.scenes.length && !pageResult.skipped) break;
      scenes.push(...pageResult.scenes);
      skippedScenes += pageResult.skipped;
      if (onProgress) {
        const limitSuffix = sceneLoadLimit > 0 && sceneCount > sceneLoadLimit ? ` (limited from ${sceneCount})` : "";
        const skippedSuffix = skippedScenes ? `, skipped ${skippedScenes}` : "";
        onProgress(`Loading studio scenes ${Math.min(offset + pageSize, targetSceneCount)} / ${targetSceneCount}${limitSuffix}${skippedSuffix}...`);
      }
    }

    const filteredScenes = await filterDashboardScenes(scenes);
    scenes.length = 0;
    scenes.push(...filteredScenes);
    return {
      studio,
      scenes,
      counts,
      sceneCount,
      targetSceneCount,
      skippedScenes,
      limited: sceneLoadLimit > 0 && sceneCount > sceneLoadLimit,
      latestUpdatedAt: getLatestSceneUpdatedAt(scenes),
      latestPerformerUpdatedAt: getLatestPerformerUpdatedAt(scenes),
      latestTagUpdatedAt: getLatestTagUpdatedAtFromScenes(scenes),
    };
  }

  async function buildStatsFromScenes(studio, scenes, counts, loadSummary) {

    const tagFilters = await buildTopTagFilters();
    const topTagCategories = await getConfiguredTopTagCategories();
    const performerCounts = new Map();
    let oCount = 0;
    scenes.forEach((scene) => {
      const sceneOCount = Number(scene?.o_counter || 0);
      const sceneRating = Number(scene?.rating100 || 0);
      oCount += sceneOCount;
      (scene?.performers || []).forEach((performer) => {
        const id = String(performer?.id || "");
        const name = String(performer?.name || "").trim();
        const performerRating = Number(performer?.rating100 || 0);
        if (!id || !name) return;
        const existing = performerCounts.get(id) || {
          id,
          name,
          imagePath: String(performer?.image_path || ""),
          country: String(performer?.country || ""),
          birthdate: String(performer?.birthdate || ""),
          tags: [],
          count: 0,
          oCount: 0,
          performerRating,
          studioTopRating: 0,
          allSceneCount: 0,
          allOCount: 0,
          allTopRating: 0,
        };
        existing.count += 1;
        existing.oCount += sceneOCount;
        existing.country = existing.country || String(performer?.country || "");
        existing.birthdate = existing.birthdate || String(performer?.birthdate || "");
        existing.tags = mergePerformerTags(existing.tags, performer?.tags || []);
        existing.performerRating = Math.max(existing.performerRating || 0, performerRating);
        existing.studioTopRating = Math.max(existing.studioTopRating || 0, sceneRating);
        performerCounts.set(id, existing);
      });
    });

    const performers = Array.from(performerCounts.values());
    const topPerformers = performers
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.name.localeCompare(right.name);
      })
      .slice(0, TOP_PERFORMER_MAX);
    const performerHighlights = buildPerformerHighlights(performers);
    attachStudioToPerformers(performerHighlights, studio);
    await hydratePerformerGlobalStats(performerHighlights);
    const performerHighlightRows = buildPerformerHighlightRows(performers);
    Object.values(performerHighlightRows).forEach((row) => attachStudioToPerformers(row, studio));
    await hydratePerformerGlobalStats(Object.values(performerHighlightRows).flat());

    const topScene = scenes
      .slice()
      .filter((scene) => Number(scene?.rating100 || 0) > 0)
      .sort((left, right) => {
        const ratingDiff = Number(right?.rating100 || 0) - Number(left?.rating100 || 0);
        if (ratingDiff) return ratingDiff;
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      })[0];
    const recentScene = scenes
      .slice()
      .filter((scene) => String(scene?.date || "").trim())
      .sort((left, right) => String(right?.date || "").localeCompare(String(left?.date || "")))[0];
    const lowestRatedScene = scenes
      .slice()
      .filter((scene) => Number(scene?.rating100 || 0) > 0)
      .sort((left, right) => {
        const ratingDiff = Number(left?.rating100 || 0) - Number(right?.rating100 || 0);
        if (ratingDiff) return ratingDiff;
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      })[0];
    const topOCountScene = scenes
      .slice()
      .filter((scene) => Number(scene?.o_counter || 0) > 0)
      .sort((left, right) => {
        const oDiff = Number(right?.o_counter || 0) - Number(left?.o_counter || 0);
        if (oDiff) return oDiff;
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      })[0];
    const leastOCountScene = scenes
      .slice()
      .filter((scene) => Number(scene?.o_counter || 0) > 0)
      .sort((left, right) => {
        const oDiff = Number(left?.o_counter || 0) - Number(right?.o_counter || 0);
        if (oDiff) return oDiff;
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      })[0];
    const sceneRatingBuckets = getSceneRatingBuckets();
    const totalDurationMinutes = scenes.reduce((total, scene) => total + getSceneDurationMinutes(scene), 0);
    const totalSceneSizeBytes = scenes.reduce((total, scene) => total + getSceneSizeBytes(scene), 0);
    const durationEntries = scenes
      .map((scene) => ({ scene, value: getSceneDurationMinutes(scene) }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
    const sceneSizeEntries = scenes
      .map((scene) => ({ scene, value: getSceneSizeBytes(scene) }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
    const longestDurationScene = durationEntries
      .slice()
      .sort((left, right) => right.value - left.value || String(left.scene?.title || "").localeCompare(String(right.scene?.title || "")))[0];
    const shortestDurationScene = durationEntries
      .slice()
      .sort((left, right) => left.value - right.value || String(left.scene?.title || "").localeCompare(String(right.scene?.title || "")))[0];
    const largestSceneSize = sceneSizeEntries
      .slice()
      .sort((left, right) => right.value - left.value || String(left.scene?.title || "").localeCompare(String(right.scene?.title || "")))[0];
    const smallestSceneSize = sceneSizeEntries
      .slice()
      .sort((left, right) => left.value - right.value || String(left.scene?.title || "").localeCompare(String(right.scene?.title || "")))[0];
    const ratedScenes = scenes.filter((scene) => Number(scene?.rating100 || 0) > 0);
    const averageRating100 = ratedScenes.length
      ? ratedScenes.reduce((total, scene) => total + Number(scene?.rating100 || 0), 0) / ratedScenes.length
      : 0;
    const sceneRatingDistribution = buildRatingDistribution(scenes, {
      getRating: (scene) => Number(scene?.rating100 || 0),
      getEntity: normalizeSceneSummary,
      entityKey: "scenes",
      buckets: sceneRatingBuckets,
      ratingScale: getRatingDisplayScale(sceneRatingBuckets),
    });
    const sceneResolutionDistribution = buildResolutionDistribution(scenes);
    const sceneDurationDistribution = buildDurationDistribution(scenes);
    const needsAttention = buildNeedsAttention(scenes, performers);

    const stats = {
      studio,
      counts: {
        scenes: scenes.length,
        images: Number(counts?.images || 0),
        galleries: Number(counts?.galleries || 0),
        performers: performerCounts.size,
        oCount,
        oSceneCount: scenes.filter((scene) => Number(scene?.o_counter || 0) > 0).length,
        totalDurationMinutes,
        totalSceneSizeBytes,
        imageSizeBytes: Number(counts?.imageSizeBytes || 0),
        averageRating100,
        ratedScenes: ratedScenes.length,
        unratedScenes: Math.max(0, scenes.length - ratedScenes.length),
      },
      loadSummary,
      topPerformers,
      performerHighlights,
      performerHighlightRows,
      topTags: buildTopTags(scenes, tagFilters),
      topTagGroups: buildTopTagGroups(scenes, tagFilters, topTagCategories),
      performerDemographics: await buildPerformerDemographics(performers, scenes),
      sceneRatings: sceneRatingDistribution,
      sceneResolutions: sceneResolutionDistribution,
      sceneDurations: sceneDurationDistribution,
      sceneCharts: await buildCustomScenePieDistributions(scenes),
      needsAttention,
      timeline: buildReleaseTimeline(scenes),
      topScene: normalizeSceneSummary(topScene),
      longestDurationScene: normalizeSceneSummary(longestDurationScene?.scene),
      longestDurationMinutes: Number(longestDurationScene?.value || 0),
      shortestDurationScene: normalizeSceneSummary(shortestDurationScene?.scene),
      shortestDurationMinutes: Number(shortestDurationScene?.value || 0),
      largestSceneSize: normalizeSceneSummary(largestSceneSize?.scene),
      largestSceneSizeBytes: Number(largestSceneSize?.value || 0),
      smallestSceneSize: normalizeSceneSummary(smallestSceneSize?.scene),
      smallestSceneSizeBytes: Number(smallestSceneSize?.value || 0),
      topRatedScenes: normalizeSceneSummaries(
        scenes
          .filter((scene) => Number(scene?.rating100 || 0) > 0)
          .sort((left, right) => {
            const ratingDiff = Number(right?.rating100 || 0) - Number(left?.rating100 || 0);
            if (ratingDiff) return ratingDiff;
            return String(left?.title || "").localeCompare(String(right?.title || ""));
          })
      ),
      recentScene: normalizeSceneSummary(recentScene),
      recentReleases: normalizeSceneSummaries(
        scenes
          .filter((scene) => String(scene?.date || "").trim())
          .sort((left, right) => String(right?.date || "").localeCompare(String(left?.date || "")))
      ),
      lowestRatedScene: normalizeSceneSummary(lowestRatedScene),
      topOCountScene: normalizeSceneSummary(topOCountScene),
      scenesMostOs: normalizeSceneSummaries(
        scenes
          .filter((scene) => Number(scene?.o_counter || 0) > 0)
          .sort((left, right) => {
            const oDiff = Number(right?.o_counter || 0) - Number(left?.o_counter || 0);
            if (oDiff) return oDiff;
            return String(left?.title || "").localeCompare(String(right?.title || ""));
          })
      ),
      leastOCountScene: normalizeSceneSummary(leastOCountScene),
    };
    return stats;
  }

  function buildNeedsAttention(scenes, performers) {
    const sceneList = Array.isArray(scenes) ? scenes : [];
    const performerList = Array.isArray(performers) ? performers : [];
    const sceneBuckets = [
      {
        key: "notOrganized",
        label: "Not organized",
        target: "scenes",
        criteria: [buildAttentionCriterion("organized")],
        items: sceneList.filter((scene) => scene?.organized !== true).map(normalizeSceneSummary).filter(Boolean),
      },
      {
        key: "missingStashIds",
        label: "Missing Stash IDs",
        target: "scenes",
        criteria: [buildAttentionCriterion("stashId")],
        items: sceneList.filter((scene) => !hasSceneStashIds(scene)).map(normalizeSceneSummary).filter(Boolean),
      },
      {
        key: "missingDates",
        label: "Missing dates",
        target: "scenes",
        criteria: [buildAttentionCriterion("date")],
        items: sceneList.filter((scene) => !String(scene?.date || "").trim()).map(normalizeSceneSummary).filter(Boolean),
      },
      {
        key: "unrated",
        label: "Unrated",
        target: "scenes",
        criteria: [buildRatingNullCriterion()],
        items: sceneList.filter((scene) => Number(scene?.rating100 || 0) <= 0).map(normalizeSceneSummary).filter(Boolean),
      },
      {
        key: "noStudios",
        label: "No studios",
        target: "scenes",
        criteria: [buildAttentionCriterion("studios")],
        items: sceneList.filter((scene) => !scene?.studio?.id).map(normalizeSceneSummary).filter(Boolean),
      },
    ];
    const performerBuckets = [
      {
        key: "missingCountry",
        label: "Missing nationality",
        target: "performers",
        criteria: [buildAttentionCriterion("country")],
        items: performerList.filter((performer) => !String(performer?.country || "").trim()).map(normalizeAttentionPerformer).filter(Boolean),
      },
      {
        key: "missingBirthdate",
        label: "Missing birthdate",
        target: "performers",
        criteria: [buildAttentionCriterion("birthdate")],
        items: performerList.filter((performer) => !String(performer?.birthdate || "").trim()).map(normalizeAttentionPerformer).filter(Boolean),
      },
      {
        key: "unrated",
        label: "Unrated",
        target: "performers",
        criteria: [buildRatingNullCriterion()],
        items: performerList.filter((performer) => Number(performer?.performerRating || 0) <= 0).map(normalizeAttentionPerformer).filter(Boolean),
      },
      {
        key: "missingImage",
        label: "Missing image",
        target: "performers",
        criteria: [buildAttentionCriterion("image")],
        items: performerList.filter((performer) => !String(performer?.imagePath || "").trim()).map(normalizeAttentionPerformer).filter(Boolean),
      },
      {
        key: "noScenes",
        label: "No scenes",
        target: "performers",
        criteria: [buildAttentionCriterion("scenes")],
        items: performerList.filter((performer) => Number(performer?.count || 0) <= 0).map(normalizeAttentionPerformer).filter(Boolean),
      },
    ];
    return {
      scenes: sceneBuckets.filter((bucket) => bucket.items.length),
      performers: performerBuckets.filter((bucket) => bucket.items.length),
    };
  }

  function hasSceneStashIds(scene) {
    const stashIds = scene?.stash_ids || scene?.stashIds || [];
    return Array.isArray(stashIds) && stashIds.some((item) => String(item?.stash_id || item?.stashId || "").trim());
  }

  function normalizeAttentionPerformer(performer) {
    if (!performer?.id) return null;
    return {
      id: String(performer.id || ""),
      name: String(performer.name || "Unknown performer"),
      count: Number(performer.count || 0),
      performerRating: Number(performer.performerRating || 0),
    };
  }

  async function fetchStudioStatsUncached(studio, onProgress) {
    const scope = await fetchDashboardSceneScope(studio, onProgress);
    return buildStatsFromScenes(studio, scope.scenes, scope.counts, {
      totalScenes: scope.sceneCount,
      targetScenes: scope.targetSceneCount,
      loadedScenes: scope.scenes.length,
      skippedScenes: scope.skippedScenes,
      limited: scope.limited,
    });
  }

  function studioMatchesDashboardFilters(studio) {
    const includeStudios = [];
    const excludeStudios = parseList(getSetting("a06ExcludeStudios", "excludeStudios"));
    if (!includeStudios.length && !excludeStudios.length) return true;
    const keys = [String(studio?.id || "").toLowerCase(), String(studio?.name || "").toLowerCase()].filter(Boolean);
    const includeOk = !includeStudios.length || includeStudios.some((ref) => keys.includes(ref));
    const excludeOk = !excludeStudios.length || !excludeStudios.some((ref) => keys.includes(ref));
    return includeOk && excludeOk;
  }

  async function fetchStashStatsByStudio(onProgress) {
    const dashboard = { id: "", name: "All Stash", imagePath: "" };
    const allStudios = await fetchAllStudiosForDashboard();
    const studios = allStudios.filter(studioMatchesDashboardFilters);
    const globalSceneLoadLimit = getDashboardSceneLoadLimit();
    const scenes = [];
    const counts = { scenes: 0, images: 0, galleries: 0, imageSizeBytes: 0 };
    const failedStudios = [];
    let skippedScenes = 0;
    let targetScenes = 0;
    let limited = false;

    if (onProgress) {
      onProgress(`Loading stash dashboard by studio 0 / ${studios.length}...`);
    }

    for (let index = 0; index < studios.length; index += 1) {
      const studio = studios[index];
      if (index > 0) await delay(getDashboardPageDelayMs());
      if (onProgress) {
        onProgress(`Loading ${studio.name} (${index + 1} / ${studios.length})...`);
      }
      try {
        const remainingBudget = globalSceneLoadLimit > 0 ? Math.max(0, globalSceneLoadLimit - scenes.length) : 0;
        if (globalSceneLoadLimit > 0 && remainingBudget <= 0) {
          limited = true;
          break;
        }
        const scope = await fetchDashboardSceneScope(studio, (message) => {
          if (onProgress) onProgress(`${studio.name}: ${message.replace(/studio/i, "studio")}`);
        }, { sceneLoadLimit: remainingBudget });
        scenes.push(...scope.scenes);
        counts.scenes += scope.scenes.length;
        counts.images += Number(scope.counts?.images || 0);
        counts.galleries += Number(scope.counts?.galleries || 0);
        counts.imageSizeBytes += Number(scope.counts?.imageSizeBytes || 0);
        targetScenes += scope.targetSceneCount;
        skippedScenes += scope.skippedScenes;
        limited = limited || scope.limited;
      } catch (err) {
        failedStudios.push(studio.name);
        console.warn("[StashDashboard] Studio dashboard chunk failed", studio, err);
      }
      if (onProgress) {
        const failedSuffix = failedStudios.length ? `, failed ${failedStudios.length}` : "";
        onProgress(`Loaded studios ${index + 1} / ${studios.length}${failedSuffix}...`);
      }
    }

    return buildStatsFromScenes(dashboard, scenes, counts, {
      totalScenes: targetScenes,
      targetScenes,
      loadedScenes: scenes.length,
      skippedScenes,
      failedStudios,
      limited,
      selectedStudios: studios.map((studio) => ({
        id: studio.id,
        name: studio.name,
        synthetic: Boolean(studio.synthetic),
      })),
    });
  }

  function getDashboardStudioScopeCacheKey(studio) {
    return `scope:${DASHBOARD_CACHE_VERSION}:${studio.id}:${state.configKey || "default"}`;
  }

  function rememberDashboardScope(studio, scope) {
    const key = getDashboardStudioScopeCacheKey(studio);
    state.statsCache.set(key, scope);
    state.dashboardLoadedStudioIds.add(studio.id);
    state.dashboardStudioSceneCounts.set(studio.id, Number(scope.sceneCount || 0));
    state.dashboardStudioUpdatedAt.set(studio.id, scope.latestUpdatedAt || "");
    state.dashboardStudioPerformerUpdatedAt.set(studio.id, scope.latestPerformerUpdatedAt || "");
    if (scope.latestTagUpdatedAt && scope.latestTagUpdatedAt > state.dashboardTagUpdatedAt) {
      state.dashboardTagUpdatedAt = scope.latestTagUpdatedAt;
    }
  }

  async function hydratePersistentDashboardCacheForStudios(studios) {
    let hydrated = 0;
    for (const studio of studios || []) {
      const key = getDashboardStudioScopeCacheKey(studio);
      if (state.statsCache.has(key)) continue;
      const record = await getPersistentDashboardScope(key);
      if (!record?.scope) continue;
      rememberDashboardScope(studio, record.scope);
      hydrated += 1;
    }
    return hydrated;
  }

  async function fetchDashboardStudioScopeCached(studio, onProgress) {
    const key = getDashboardStudioScopeCacheKey(studio);
    if (state.statsCache.has(key)) return state.statsCache.get(key);
    const promise = fetchDashboardSceneScope(studio, onProgress)
      .then((scope) => {
        rememberDashboardScope(studio, scope);
        setPersistentDashboardScope(key, studio, scope).catch((err) => console.warn("[StashDashboard] Persistent cache write failed", err));
        return scope;
      })
      .catch((err) => {
        if (state.statsCache.get(key) === promise) state.statsCache.delete(key);
        throw err;
      });
    state.statsCache.set(key, promise);
    return promise;
  }

  async function fetchStashStatsForStudios(studios, onProgress) {
    const dashboard = { id: "", name: "All Stash", imagePath: "" };
    const scenes = [];
    const counts = { scenes: 0, images: 0, galleries: 0, imageSizeBytes: 0 };
    const failedStudios = [];
    let skippedScenes = 0;
    let targetScenes = 0;
    let limited = false;

    for (let index = 0; index < studios.length; index += 1) {
      const studio = studios[index];
      if (index > 0) await delay(getDashboardPageDelayMs());
      if (onProgress) onProgress(`Loading ${studio.name} (${index + 1} / ${studios.length})...`);
      try {
        const scope = await fetchDashboardStudioScopeCached(studio, (message) => {
          if (onProgress) onProgress(`${studio.name}: ${message}`);
        });
        rememberDashboardScope(studio, scope);
        scenes.push(...scope.scenes);
        counts.scenes += scope.scenes.length;
        counts.images += Number(scope.counts?.images || 0);
        counts.galleries += Number(scope.counts?.galleries || 0);
        counts.imageSizeBytes += Number(scope.counts?.imageSizeBytes || 0);
        targetScenes += scope.targetSceneCount;
        skippedScenes += scope.skippedScenes;
        limited = limited || scope.limited;
      } catch (err) {
        failedStudios.push(studio.name);
        state.dashboardFailedStudioNames = Array.from(new Set([...(state.dashboardFailedStudioNames || []), studio.name]));
        console.warn("[StashDashboard] Selected studio chunk failed", studio, err);
      }
    }

    return buildStatsFromScenes(dashboard, scenes, counts, {
      totalScenes: targetScenes,
      targetScenes,
      loadedScenes: scenes.length,
      skippedScenes,
      failedStudios,
      limited,
      selectedStudios: studios.map((studio) => ({
        id: studio.id,
        name: studio.name,
        synthetic: Boolean(studio.synthetic),
      })),
    });
  }

  async function buildStashStatsFromCachedStudios(studios) {
    const dashboard = { id: "", name: "All Stash", imagePath: "" };
    const scenes = [];
    const counts = { scenes: 0, images: 0, galleries: 0, imageSizeBytes: 0 };
    let skippedScenes = 0;
    let targetScenes = 0;
    let limited = false;
    const loadedStudios = [];

    for (const studio of studios || []) {
      const key = getDashboardStudioScopeCacheKey(studio);
      if (!state.statsCache.has(key)) continue;
      const scope = await state.statsCache.get(key);
      if (!scope) continue;
      loadedStudios.push(studio);
      scenes.push(...(scope.scenes || []));
      counts.scenes += Number(scope.scenes?.length || 0);
      counts.images += Number(scope.counts?.images || 0);
      counts.galleries += Number(scope.counts?.galleries || 0);
      counts.imageSizeBytes += Number(scope.counts?.imageSizeBytes || 0);
      targetScenes += Number(scope.targetSceneCount || 0);
      skippedScenes += Number(scope.skippedScenes || 0);
      limited = limited || Boolean(scope.limited);
    }

    return buildStatsFromScenes(dashboard, scenes, counts, {
      totalScenes: targetScenes,
      targetScenes,
      loadedScenes: scenes.length,
      loadedStudios: loadedStudios.length,
      selectedStudios: loadedStudios.map((studio) => ({
        id: studio.id,
        name: studio.name,
        synthetic: Boolean(studio.synthetic),
      })),
      skippedScenes,
      failedStudios: state.dashboardFailedStudioNames || [],
      limited,
    });
  }

  async function fetchStudioLatestSceneUpdatedAt(studio) {
    const data = await gql(
      `
        query StashDashboardStudioLatestUpdate($sceneFilter: SceneFilterType) {
          findScenes(scene_filter: $sceneFilter, filter: { page: 1, per_page: 1, sort: "updated_at", direction: DESC }) {
            scenes { id updated_at }
          }
        }
      `,
      { sceneFilter: studioFilter(studio?.id) }
    );
    return String(data?.findScenes?.scenes?.[0]?.updated_at || "");
  }

  async function fetchStudioLatestPerformerUpdatedAt(studio) {
    const data = await gql(
      `
        query StashDashboardStudioLatestPerformerUpdate($sceneFilter: SceneFilterType) {
          findScenes(scene_filter: $sceneFilter, filter: { per_page: -1 }) {
            scenes {
              performers { id updated_at }
            }
          }
        }
      `,
      { sceneFilter: studioFilter(studio?.id) }
    );
    const seen = new Set();
    return (data?.findScenes?.scenes || []).reduce((latest, scene) => {
      (scene?.performers || []).forEach((performer) => {
        const id = String(performer?.id || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        const value = String(performer?.updated_at || "").trim();
        if (value && value > latest) latest = value;
      });
      return latest;
    }, "");
  }

  async function fetchLatestTagUpdatedAt() {
    const data = await gql(`
      query StashDashboardLatestTagUpdate {
        findTags(filter: { page: 1, per_page: 1, sort: "updated_at", direction: DESC }) {
          tags { id updated_at }
        }
      }
    `);
    return String(data?.findTags?.tags?.[0]?.updated_at || "");
  }

  async function findChangedCachedStudios(onProgress) {
    const cachedStudios = getCachedDashboardStudios();
    const changed = [];
    const latestTagUpdatedAt = await fetchLatestTagUpdatedAt();
    const tagsChanged = latestTagUpdatedAt && latestTagUpdatedAt !== state.dashboardTagUpdatedAt;
    if (tagsChanged) {
      if (onProgress) onProgress("Tag changes detected; refreshing cached studios...");
      state.dashboardTagUpdatedAt = latestTagUpdatedAt;
      return cachedStudios;
    }
    for (let index = 0; index < cachedStudios.length; index += 1) {
      const studio = cachedStudios[index];
      if (index > 0) await delay(getDashboardPageDelayMs());
      if (onProgress) onProgress(`Checking ${studio.name} (${index + 1} / ${cachedStudios.length})...`);
      const [latestScene, latestPerformer] = await Promise.all([
        fetchStudioLatestSceneUpdatedAt(studio),
        fetchStudioLatestPerformerUpdatedAt(studio),
      ]);
      const counts = await fetchStatsCounts(studio.id);
      const cachedScene = state.dashboardStudioUpdatedAt.get(studio.id) || "";
      const cachedPerformer = state.dashboardStudioPerformerUpdatedAt.get(studio.id) || "";
      const cachedSceneCount = state.dashboardStudioSceneCounts.get(studio.id);
      const countChanged = Number.isFinite(cachedSceneCount) && Number(counts.scenes || 0) !== cachedSceneCount;
      if (countChanged || (latestScene && latestScene !== cachedScene) || (latestPerformer && latestPerformer !== cachedPerformer)) {
        changed.push(studio);
      }
    }
    return changed;
  }

  function normalizeSceneSummary(scene) {
    if (!scene?.id) return null;
    return {
      id: String(scene.id || ""),
      title: String(scene.title || "Untitled scene"),
      date: String(scene.date || ""),
      rating100: Number(scene.rating100 || 0),
      oCounter: Number(scene.o_counter || 0),
      screenshot: String(scene.paths?.screenshot || ""),
      preview: String(scene.paths?.preview || ""),
    };
  }

  function normalizeSceneSummaries(scenes, limit = DASHBOARD_SCENE_ROW_LIMIT) {
    return (scenes || [])
      .slice(0, limit)
      .map(normalizeSceneSummary)
      .filter(Boolean);
  }

  function getStudioLinks(studioId) {
    if (!studioId) return [];
    const escaped = CSS.escape(String(studioId));
    return Array.from(
      document.querySelectorAll(`a[href="/studios/${escaped}"], a[href*="/studios/${escaped}"]`)
    ).filter((link) => link instanceof HTMLElement && !link.closest(".studio-dashboard__hover"));
  }

  function getAllStudioLinks() {
    return Array.from(document.querySelectorAll('a[href*="/studios/"]')).filter(
      (link) => link instanceof HTMLElement && !link.closest(".studio-dashboard__hover")
    );
  }

  function studioFromLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return null;
    const match = link.pathname.match(/^\/studios\/([^/?#]+)/);
    if (!match?.[1]) return null;
    const image = link.querySelector("img");
    const name =
      link.getAttribute("title") ||
      link.getAttribute("aria-label") ||
      image?.getAttribute("alt") ||
      image?.getAttribute("title") ||
      link.textContent ||
      "Studio";
    return normalizeStudio({
      id: decodeURIComponent(match[1]),
      name: String(name).trim() || "Studio",
    });
  }

  function enhanceStudioLink(link, studio, source = "detail") {
    if (!(link instanceof HTMLElement) || !studio?.id) return;
    link.classList.add("studio-dashboard__badge");
    link.setAttribute("data-studio-dashboard-id", studio.id);
    link.setAttribute("data-studio-dashboard-name", studio.name);
    link.setAttribute("data-studio-dashboard-source", source);

    if (!getDisplayProfile()) return;
    if (link.dataset.studioDashboardHoverBound === "true") return;
    link.dataset.studioDashboardHoverBound = "true";
    link.addEventListener("mouseenter", handleHoverEnter);
    link.addEventListener("focus", handleHoverEnter);
    link.addEventListener("mouseleave", handleHoverLeave);
    link.addEventListener("blur", handleHoverLeave);
  }

  function createTooltip(anchor, studio) {
    closeTooltip();
    const tooltip = document.createElement("div");
    tooltip.className = `studio-dashboard__hover studio-dashboard__hover--${getDisplayProfile()}`;
    tooltip.innerHTML = `
      <a class="studio-dashboard__hover-title" href="/studios/${encodeURIComponent(studio?.id || "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(studio?.name || "Studio")}</a>
      <div class="studio-dashboard__status">Loading studio stats...</div>
    `;
    document.body.appendChild(tooltip);
    state.tooltip = tooltip;
    state.tooltipAnchor = anchor;
    tooltip.addEventListener("mouseenter", cancelTooltipClose);
    tooltip.addEventListener("mouseleave", scheduleTooltipClose);
    positionTooltip(anchor, tooltip);
    return tooltip;
  }

  function positionTooltip(anchor, tooltip) {
    if (!(anchor instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) return;
    const rect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const pad = 8;
    const preferRight = rect.right + pad + tooltipRect.width <= window.innerWidth;
    const left = preferRight
      ? rect.right + pad
      : Math.max(pad, Math.min(window.innerWidth - tooltipRect.width - pad, rect.left));
    const top = Math.max(
      pad,
      Math.min(window.innerHeight - tooltipRect.height - pad, rect.top)
    );
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function renderStatsInto(container, stats) {
    if (!(container instanceof HTMLElement) || !stats) return;
    container.innerHTML = "";
    const profile = getDisplayProfile();
    const limits = getProfileLimits(profile);

    const section = createSection(container);
    const counts = document.createElement("div");
    counts.className = "studio-dashboard__counts";
    const countItems = [
      ["Scenes", stats.counts.scenes],
      ["Images", stats.counts.images],
      ["Galleries", stats.counts.galleries],
      ["Performers", stats.counts.performers],
      ["O's", stats.counts.oCount],
    ];
    counts.style.gridTemplateColumns = `repeat(${countItems.length}, minmax(0, 1fr))`;
    countItems.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "studio-dashboard__count";
      item.innerHTML = `
        <span class="studio-dashboard__count-value">${escapeHtml(value)}</span>
        <span class="studio-dashboard__count-label">${escapeHtml(label)}</span>
      `;
      counts.appendChild(item);
    });
    section.appendChild(counts);

    const performerHighlights = getPerformerHighlightsForProfile(stats, profile);
    if (performerHighlights.length) {
      const section = createSection(container);
      renderPerformerCards(section, performerHighlights.slice(0, limits.performers));
    }

    if (stats.topTags.length) {
      const section = createSection(container);
      const title = document.createElement("div");
      title.className = "studio-dashboard__section-title";
      title.textContent = "TOP TAGS";
      section.appendChild(title);
      renderTagCards(section, stats.studio, stats.topTags.slice(0, limits.tags));
    }

    if (limits.showTimeline) {
      renderReleaseTimeline(container, stats.studio, stats.timeline);
    }

    const sceneHighlights = getSceneHighlights(stats).slice(0, limits.scenes);
    if (profile === "rich") {
      renderSceneHighlightGrid(container, sceneHighlights);
    } else {
      sceneHighlights.forEach((highlight) => renderSceneHighlight(container, highlight));
    }
  }

  function renderStudioPageDashboard(container, stats) {
    if (!(container instanceof HTMLElement) || !stats) return;
    const isStashDashboardPage = Boolean(container.closest(".stash-dashboard__shell"));
    container.innerHTML = "";
    container.className = `${isStashDashboardPage ? "stash-dashboard__content " : ""}tab-pane fade studio-dashboard__page-dashboard active show`;
    container.studioDashboardStats = stats;
    container.dataset.studioDashboardStudioId = stats.studio.id;
    container.style.setProperty("--studio-dashboard-header-font-size", `${getDashboardHeaderFontSize()}px`);
    container.style.setProperty("--studio-dashboard-subheader-font-size", `${getDashboardSubheaderFontSize()}px`);
    container.style.setProperty("--studio-dashboard-content-font-size", `${getDashboardContentFontSize()}px`);
    container.style.setProperty("--studio-dashboard-tag-width", `${getDashboardTagWidth()}px`);
    container.style.setProperty("--studio-dashboard-surface-color", getDashboardSurfaceColor());
    container.style.setProperty("--studio-dashboard-surface-opacity", String(getDashboardSurfaceOpacity()));

    const body = document.createElement("div");
    body.className = "studio-dashboard__page-body";
    container.appendChild(body);

    const renderers = {
      insights: () => {
        renderDashboardInsights(body, stats);
      },
      studioComparison: () => {
        renderStudioComparison(body);
      },
      performerHighlights: () => {
        const performerHighlights = Array.isArray(stats.performerHighlights) ? stats.performerHighlights : [];
        if (!performerHighlights.length) return;
        const section = createPageSection(body, "PERFORMER HIGHLIGHTS");
        renderPerformerCards(section, performerHighlights.slice(0, 8));
      },
      performersMostScenes: () => renderPerformerRowSection(body, "PERFORMERS WITH MOST SCENES", stats.performerHighlightRows?.performersMostScenes),
      performersMostOs: () => renderPerformerRowSection(body, "PERFORMERS WITH MOST O'S", stats.performerHighlightRows?.performersMostOs),
      performersHighestRating: () => renderPerformerRowSection(body, "PERFORMERS WITH HIGHEST RATING", stats.performerHighlightRows?.performersHighestRating),
      performersHighestRatedScenes: () => renderPerformerRowSection(body, "PERFORMERS WITH HIGHEST RATED SCENES", stats.performerHighlightRows?.performersHighestRatedScenes),
      topTags: () => {
        if (!stats.topTags.length) return;
        const section = createPageSection(body, "TOP TAGS");
        renderDashboardTopTags(section, stats);
      },
      releaseTimeline: () => {
        renderReleaseTimeline(body, stats.studio, stats.timeline);
      },
      sceneHighlights: () => {
        renderSceneHighlightGrid(body, getSceneHighlights(stats), { title: "SCENE HIGHLIGHTS" });
      },
      topRatedScenes: () => renderSceneRowSection(body, "TOP RATED SCENES", stats.topRatedScenes, (scene) => formatRating(scene.rating100)),
      recentReleases: () => renderSceneRowSection(body, "RECENT RELEASES", stats.recentReleases, (scene) => formatDate(scene.date)),
      scenesMostOs: () => renderSceneRowSection(body, "SCENES WITH MOST O'S", stats.scenesMostOs, (scene) => `${scene.oCounter} O's`),
      performerDemographics: () => {
        renderPerformerDemographics(body, stats);
      },
      sceneCharts: () => {
        renderSceneCharts(body, stats);
      },
      needsAttention: () => {
        renderNeedsAttention(body, stats);
      },
    };
    getDashboardSectionOrder().forEach((key) => renderers[key]?.());
  }

  function renderDashboardInsights(container, stats) {
    const items = buildDashboardInsights(stats);
    if (!items.length) return;
    const section = createPageSection(container, "INSIGHTS");
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__insights";
    items.forEach((item) => {
      const tile = document.createElement("div");
      tile.className = "studio-dashboard__insight";
      tile.innerHTML = `
        <div class="studio-dashboard__insight-label">${escapeHtml(item.label)}</div>
        <div class="studio-dashboard__insight-value">${item.valueHtml || escapeHtml(item.value)}</div>
        ${item.detailHtml || item.detail ? `<div class="studio-dashboard__insight-detail">${item.detailHtml || escapeHtml(item.detail)}</div>` : ""}
      `;
      grid.appendChild(tile);
    });
    section.appendChild(grid);
  }

  function buildDashboardInsights(stats) {
    const counts = stats?.counts || {};
    const topResolution = getTopResolutionInsight(stats);
    const topPerformer = stats?.topPerformers?.[0];
    const topPerformerDetail = topPerformer
      ? `${topPerformer.name}: ${formatNumber(topPerformer.count)}, ${formatInsightPercent(topPerformer.count, counts.scenes)}`
      : "";
    const topOCount = Number(stats?.topOCountScene?.oCounter || 0);
    const oCountDetailHtml = [
      formatInsightLink(
        makeDashboardScenesUrl(stats, [buildOCountCriterion()]),
        `${formatNumber(counts.oSceneCount)} scenes, ${formatInsightPercent(counts.oSceneCount, counts.scenes)}`
      ),
      topOCount ? `top scene: ${formatInsightLink(makeSceneUrl(stats.topOCountScene), formatNumber(topOCount))}` : "",
    ].filter(Boolean).join("; ");
    const averageRating = Number(counts.averageRating100 || 0);
    const ratedDetailHtml = [
      formatInsightLink(makeDashboardScenesUrl(stats, [buildRatingNotNullCriterion()]), `${formatNumber(counts.ratedScenes)} rated`),
      formatInsightLink(makeDashboardScenesUrl(stats, [buildRatingNullCriterion()]), `${formatNumber(counts.unratedScenes)} unrated`),
    ].join(", ");
    const items = [
      { label: "Scenes", value: formatNumber(counts.scenes), detail: `${formatDurationMinutes(counts.totalDurationMinutes)}; ${formatBytes(counts.totalSceneSizeBytes)}` },
      { label: "Images", value: formatNumber(counts.images), detail: `${formatNumber(counts.galleries)} galleries; ${formatBytes(counts.imageSizeBytes)}` },
      { label: "Performers", value: formatNumber(counts.performers), detail: topPerformerDetail },
      { label: "O Count", value: formatNumber(counts.oCount), detailHtml: oCountDetailHtml },
      { label: "Average scene rating", value: averageRating ? formatRating(averageRating) : "N/A", detailHtml: ratedDetailHtml },
      stats?.largestSceneSize ? {
        label: "Largest scene size",
        valueHtml: formatInsightLink(makeSceneUrl(stats.largestSceneSize), formatBytes(stats.largestSceneSizeBytes)),
        detailHtml: `Smallest: ${formatInsightLink(makeSceneUrl(stats.smallestSceneSize), formatBytes(stats.smallestSceneSizeBytes))}`,
      } : null,
      stats?.longestDurationScene ? {
        label: "Longest Scene",
        valueHtml: formatInsightLink(makeSceneUrl(stats.longestDurationScene), formatDurationLong(stats.longestDurationMinutes)),
        detailHtml: `Shortest: ${formatInsightLink(makeSceneUrl(stats.shortestDurationScene), formatDurationLong(stats.shortestDurationMinutes))}`,
      } : null,
      topResolution ? { label: "Top resolution", value: topResolution.label, detail: `${formatNumber(topResolution.count)} scene${Number(topResolution.count) === 1 ? "" : "s"}${topResolution.percent ? `, ${topResolution.percent}%` : ""}` } : null,
      stats?.timeline?.startMonth ? { label: "Release span", value: formatInsightDateRange(stats.timeline), detail: `${formatNumber(stats.timeline.months?.length || 0)} covered month${Number(stats.timeline.months?.length || 0) === 1 ? "" : "s"}` } : null,
    ];
    return items.filter(Boolean);
  }

  function getTopResolutionInsight(stats) {
    return (stats?.sceneResolutions?.items || [])
      .filter((item) => item && !item.metricUnknown && !item.metricOther)
      .slice()
      .sort((left, right) => {
        const countDelta = Number(right.count || 0) - Number(left.count || 0);
        if (countDelta) return countDelta;
        return String(left.label || "").localeCompare(String(right.label || ""));
      })[0] || null;
  }

  function renderStudioComparison(container) {
    const cachedStudios = getCachedDashboardStudios();
    if (cachedStudios.length < 2) return;
    const options = getStudioComparisonOptions(cachedStudios);
    if (options.filter((option) => option.type === "studio").length < 2) return;
    const selections = getStudioComparisonSelections(cachedStudios, options);
    const section = createPageSection(container, "STUDIO COMPARISON");
    const shell = document.createElement("div");
    shell.className = "studio-dashboard__comparison";
    section.appendChild(shell);
    const leftStats = buildStudioComparisonStats("Left side", selections.leftRefs, cachedStudios, options);
    const rightStats = buildStudioComparisonStats("Right side", selections.rightRefs, cachedStudios, options);
    const maxes = getStudioComparisonMetricMaxes([leftStats, rightStats]);
    renderStudioComparisonSide(shell, "left", "Left side", selections.leftRefs, selections.rightIds, cachedStudios, options, leftStats);
    renderStudioComparisonMetricComparison(shell, leftStats, rightStats, maxes);
    renderStudioComparisonSide(shell, "right", "Right side", selections.rightRefs, selections.leftIds, cachedStudios, options, rightStats);
  }

  function renderStudioComparisonSide(container, side, title, selectedRefs, disabledIds, cachedStudios, options, stats) {
    const card = document.createElement("div");
    card.className = `studio-dashboard__comparison-side studio-dashboard__comparison-side--${side}`;
    card.studioDashboardComparisonStats = stats;
    card.innerHTML = `
      <div class="studio-dashboard__comparison-header">
        <div class="studio-dashboard__comparison-heading">
          <div class="studio-dashboard__comparison-title">${escapeHtml(title)}</div>
          <button type="button" class="studio-dashboard__comparison-clear">Clear selection</button>
        </div>
        <input class="studio-dashboard__comparison-search" type="search" placeholder="Search cached studios..." aria-label="${escapeHtml(title)} studio search">
      </div>
    `;
    const chooser = document.createElement("div");
    chooser.className = "studio-dashboard__comparison-chooser";
    const selectedList = document.createElement("div");
    selectedList.className = "studio-dashboard__comparison-selected";
    const picker = document.createElement("div");
    picker.className = "studio-dashboard__comparison-picker";
    chooser.append(selectedList, picker);
    card.appendChild(chooser);
    renderStudioComparisonSelectedList(selectedList, side, selectedRefs, options);
    renderStudioComparisonPicker(picker, side, selectedRefs, disabledIds, options);
    const search = card.querySelector(".studio-dashboard__comparison-search");
    if (search instanceof HTMLInputElement) {
      search.addEventListener("input", () => {
        renderStudioComparisonPicker(picker, side, selectedRefs, disabledIds, options, search.value);
      });
    }
    card.querySelector(".studio-dashboard__comparison-clear")?.addEventListener("click", () => {
      setStudioComparisonSelectionRefs(side, []);
      const dashboard = card.closest(".studio-dashboard__page-dashboard");
      if (dashboard instanceof HTMLElement) renderStudioPageDashboard(dashboard, dashboard.studioDashboardStats);
    });
    renderStudioComparisonHighlights(card, stats);
    container.appendChild(card);
  }

  function renderStudioComparisonSelectedList(container, side, selectedRefs, options) {
    const selectedOptions = (selectedRefs || [])
      .map((ref) => (options || []).find((option) => option.value === ref))
      .filter(Boolean);
    container.innerHTML = `
      <div class="studio-dashboard__comparison-list-title">Selected studios</div>
      <div class="studio-dashboard__comparison-selected-list">
        ${selectedOptions.map((option) => `
          <button type="button" class="studio-dashboard__comparison-selected-item" value="${escapeHtml(option.value)}" title="Remove ${escapeHtml(option.label)}">
            ${escapeHtml(option.label)}
          </button>
        `).join("") || `<div class="studio-dashboard__comparison-empty">None selected.</div>`}
      </div>
    `;
    container.querySelectorAll(".studio-dashboard__comparison-selected-item").forEach((button) => {
      button.addEventListener("click", () => {
        setStudioComparisonSelectionRefs(side, selectedRefs.filter((ref) => ref !== button.value));
        const dashboard = container.closest(".studio-dashboard__page-dashboard");
        if (dashboard instanceof HTMLElement) renderStudioPageDashboard(dashboard, dashboard.studioDashboardStats);
      });
    });
  }

  function renderStudioComparisonPicker(container, side, selectedRefs, disabledIds, options, query = "") {
    const text = String(query || "").trim().toLowerCase();
    const visible = (options || []).filter((option) => {
      return !text || option.label.toLowerCase().includes(text);
    });
    container.innerHTML = `
      <div class="studio-dashboard__comparison-list-title">Cached studios</div>
      <div class="studio-dashboard__comparison-picker-list">
        ${visible.map((option) => {
          const selected = selectedRefs.includes(option.value);
          const disabled = !selected && option.ids.some((id) => disabledIds.has(id));
          return `
            <label class="studio-dashboard__comparison-option ${disabled ? "is-disabled" : ""}">
              <input type="checkbox" value="${escapeHtml(option.value)}"${selected ? " checked" : ""}${disabled ? " disabled" : ""}>
              <span>${escapeHtml(option.label)}</span>
            </label>
          `;
        }).join("") || `<div class="studio-dashboard__comparison-empty">No cached studios match.</div>`}
      </div>
    `;
    container.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.addEventListener("change", () => {
        const refs = new Set(selectedRefs);
        if (input.checked) refs.add(input.value);
        else refs.delete(input.value);
        setStudioComparisonSelectionRefs(side, Array.from(refs));
        const dashboard = container.closest(".studio-dashboard__page-dashboard");
        if (dashboard instanceof HTMLElement) renderStudioPageDashboard(dashboard, dashboard.studioDashboardStats);
      });
    });
  }

  function getStudioComparisonOptions(cachedStudios) {
    const cachedIds = new Set((cachedStudios || []).map((studio) => studio.id));
    const options = [];
    const allStudios = state.dashboardStudios || [];
    allStudios.forEach((studio) => {
      if (!studio?.id || studio.synthetic) return;
      const descendantIds = Array.from(getDashboardStudioDescendantIds(studio.id, allStudios)).filter((id) => cachedIds.has(id));
      const ids = uniqueValues([
        cachedIds.has(studio.id) ? studio.id : "",
        ...descendantIds,
      ]).filter(Boolean);
      if (ids.length <= 1) return;
      options.push({
        type: "group",
        value: `group:${studio.id}`,
        label: `[Group] ${studio.name}`,
        ids,
      });
    });
    (cachedStudios || []).forEach((studio) => {
      options.push({
        type: "studio",
        value: `studio:${studio.id}`,
        label: studio.name || "Studio",
        ids: [studio.id],
      });
    });
    return options.sort((left, right) => {
      if (left.type !== right.type) return left.type === "group" ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
  }

  function getStudioComparisonSelections(cachedStudios, options) {
    let leftRefs = normalizeStudioComparisonRefs(getStudioComparisonSelectionRefs("left"), options);
    let rightRefs = normalizeStudioComparisonRefs(getStudioComparisonSelectionRefs("right"), options);
    let leftIds = resolveStudioComparisonIds(leftRefs, options);
    rightRefs = rightRefs.filter((ref) => {
      const option = options.find((item) => item.value === ref);
      return option && !option.ids.some((id) => leftIds.has(id));
    });
    const rightIds = resolveStudioComparisonIds(rightRefs, options);
    leftRefs = leftRefs.filter((ref) => {
      const option = options.find((item) => item.value === ref);
      return option && !option.ids.some((id) => rightIds.has(id));
    });
    leftIds = resolveStudioComparisonIds(leftRefs, options);
    return { leftRefs, rightRefs, leftIds, rightIds };
  }

  function getStudioComparisonSelectionRefs(side) {
    const key = side === "right" ? DASHBOARD_COMPARISON_RIGHT_KEY : DASHBOARD_COMPARISON_LEFT_KEY;
    try {
      const parsed = JSON.parse(getLocalStorageValue(key) || "[]");
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch (_err) {
      return [];
    }
  }

  function setStudioComparisonSelectionRefs(side, refs) {
    const key = side === "right" ? DASHBOARD_COMPARISON_RIGHT_KEY : DASHBOARD_COMPARISON_LEFT_KEY;
    setLocalStorageValue(key, JSON.stringify(uniqueValues(refs || [])));
  }

  function normalizeStudioComparisonRefs(refs, options) {
    const valid = new Set((options || []).map((option) => option.value));
    return uniqueValues(refs || []).filter((ref) => valid.has(ref));
  }

  function resolveStudioComparisonIds(refs, options) {
    const ids = new Set();
    (refs || []).forEach((ref) => {
      const option = (options || []).find((item) => item.value === ref);
      (option?.ids || []).forEach((id) => ids.add(id));
    });
    return ids;
  }

  function buildStudioComparisonStats(title, refs, cachedStudios, options) {
    const selectedIds = resolveStudioComparisonIds(refs, options);
    const selectedStudios = (cachedStudios || []).filter((studio) => selectedIds.has(studio.id));
    const scenes = [];
    const counts = { images: 0, galleries: 0, imageSizeBytes: 0 };
    selectedStudios.forEach((studio) => {
      const scope = getCachedDashboardScope(studio);
      if (!scope) return;
      scenes.push(...(scope.scenes || []));
      counts.images += Number(scope.counts?.images || 0);
      counts.galleries += Number(scope.counts?.galleries || 0);
      counts.imageSizeBytes += Number(scope.counts?.imageSizeBytes || 0);
    });
    const performers = buildComparisonPerformerSummaries(scenes);
    const ratedScenes = scenes.filter((scene) => Number(scene?.rating100 || 0) > 0);
    const sceneOCount = scenes.reduce((total, scene) => total + Number(scene?.o_counter || 0), 0);
    const totalDurationMinutes = scenes.reduce((total, scene) => total + getSceneDurationMinutes(scene), 0);
    const totalSceneSizeBytes = scenes.reduce((total, scene) => total + getSceneSizeBytes(scene), 0);
    const longestSceneMinutes = scenes.reduce((max, scene) => Math.max(max, getSceneDurationMinutes(scene)), 0);
    const largestSceneSizeBytes = scenes.reduce((max, scene) => Math.max(max, getSceneSizeBytes(scene)), 0);
    return {
      title,
      refs,
      studios: selectedStudios,
      scenes,
      performers,
      counts: {
        scenes: scenes.length,
        duration: totalDurationMinutes,
        size: totalSceneSizeBytes,
        longestScene: longestSceneMinutes,
        largestFile: largestSceneSizeBytes,
        averageRating100: ratedScenes.length ? ratedScenes.reduce((total, scene) => total + Number(scene?.rating100 || 0), 0) / ratedScenes.length : 0,
        oCount: sceneOCount,
        performers: performers.length,
        images: counts.images,
        galleries: counts.galleries,
        imageSizeBytes: counts.imageSizeBytes,
      },
      topPerformer: performers.slice().filter((performer) => Number(performer?.performerRating || 0) > 0).sort(byPerformerRatingThenName)[0] || null,
      performerMostScenes: performers.slice().sort(byPerformerSceneCountThenName)[0] || null,
      performerMostOs: performers.slice().filter((performer) => Number(performer?.oCount || 0) > 0).sort(byPerformerOCountThenName)[0] || null,
      topRatedScene: scenes.slice().filter((scene) => Number(scene?.rating100 || 0) > 0).sort(bySceneRatingThenTitle)[0] || null,
      sceneMostOs: scenes.slice().filter((scene) => Number(scene?.o_counter || 0) > 0).sort(bySceneOCountThenTitle)[0] || null,
      resolutionDistribution: buildResolutionDistribution(scenes),
    };
  }

  function getCachedDashboardScope(studio) {
    const value = state.statsCache.get(getDashboardStudioScopeCacheKey(studio));
    if (!value || typeof value.then === "function" || !Array.isArray(value.scenes)) return null;
    return value;
  }

  function buildComparisonPerformerSummaries(scenes) {
    const performers = new Map();
    (scenes || []).forEach((scene) => {
      const sceneOCount = Number(scene?.o_counter || 0);
      (scene?.performers || []).forEach((performer) => {
        const id = String(performer?.id || "");
        const name = String(performer?.name || "").trim();
        if (!id || !name) return;
        const existing = performers.get(id) || {
          id,
          name,
          imagePath: String(performer?.image_path || ""),
          count: 0,
          oCount: 0,
          performerRating: Number(performer?.rating100 || 0),
        };
        existing.count += 1;
        existing.oCount += sceneOCount;
        existing.imagePath = existing.imagePath || String(performer?.image_path || "");
        existing.performerRating = Math.max(existing.performerRating || 0, Number(performer?.rating100 || 0));
        performers.set(id, existing);
      });
    });
    return Array.from(performers.values());
  }

  function renderStudioComparisonMetrics(container, stats, maxValues = {}) {
    const metrics = getStudioComparisonMetrics(stats);
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__comparison-metrics";
    metrics.forEach((metric) => {
      const max = Math.max(1, Number(maxValues[metric.key] || metric.raw || 0));
      const tile = document.createElement("div");
      tile.className = "studio-dashboard__comparison-metric";
      tile.style.setProperty("--studio-dashboard-comparison-value", String(Math.max(0.02, Number(metric.raw || 0) / max)));
      tile.innerHTML = `
        <div class="studio-dashboard__comparison-metric-label">${escapeHtml(metric.label)}</div>
        <div class="studio-dashboard__comparison-metric-value">${escapeHtml(metric.value)}</div>
        <div class="studio-dashboard__comparison-bar"><span></span></div>
      `;
      grid.appendChild(tile);
    });
    container.appendChild(grid);
  }

  function renderStudioComparisonMetricComparison(container, leftStats, rightStats, maxValues = {}) {
    const panel = document.createElement("div");
    panel.className = "studio-dashboard__comparison-center";
    panel.innerHTML = `
      <div class="studio-dashboard__comparison-center-title">Comparison</div>
      <div class="studio-dashboard__comparison-legend">
        <span><i class="is-left"></i>Left</span>
        <span><i class="is-right"></i>Right</span>
      </div>
    `;
    const graph = document.createElement("div");
    graph.className = "studio-dashboard__comparison-graph";
    const leftMetrics = getStudioComparisonMetrics(leftStats);
    const rightMetrics = getStudioComparisonMetrics(rightStats);
    leftMetrics.forEach((leftMetric, index) => {
      const rightMetric = rightMetrics[index] || {};
      const max = Math.max(1, Number(maxValues[leftMetric.key] || leftMetric.raw || rightMetric.raw || 0));
      const row = document.createElement("div");
      row.className = "studio-dashboard__comparison-graph-row";
      const leftRaw = Number(leftMetric.raw || 0);
      const rightRaw = Number(rightMetric.raw || 0);
      row.style.setProperty("--studio-dashboard-comparison-left", String(leftRaw > 0 ? Math.max(0.02, leftRaw / max) : 0));
      row.style.setProperty("--studio-dashboard-comparison-right", String(rightRaw > 0 ? Math.max(0.02, rightRaw / max) : 0));
      row.innerHTML = `
        <div class="studio-dashboard__comparison-graph-label">${escapeHtml(leftMetric.label)}</div>
        <div class="studio-dashboard__comparison-graph-bars">
          <span class="is-left"><i></i><b>${escapeHtml(leftMetric.value)}</b></span>
          <span class="is-right"><i></i><b>${escapeHtml(rightMetric.value || "N/A")}</b></span>
        </div>
      `;
      graph.appendChild(row);
    });
    panel.appendChild(graph);
    renderStudioComparisonResolutionBreakdown(panel, leftStats, rightStats);
    container.appendChild(panel);
  }

  function getStudioComparisonMetrics(stats) {
    const counts = stats?.counts || {};
    return [
      { key: "scenes", label: "Scenes", value: formatNumber(counts.scenes), raw: Number(counts.scenes || 0) },
      { key: "images", label: "Images", value: formatNumber(counts.images), raw: Number(counts.images || 0) },
      { key: "duration", label: "Duration", value: formatDurationMinutes(counts.duration), raw: Number(counts.duration || 0) },
      { key: "size", label: "File size", value: formatBytes(counts.size), raw: Number(counts.size || 0) },
      { key: "longest", label: "Longest scene", value: formatDurationMinutes(counts.longestScene), raw: Number(counts.longestScene || 0) },
      { key: "largest", label: "Largest file", value: formatBytes(counts.largestFile), raw: Number(counts.largestFile || 0) },
      { key: "rating", label: "Avg rating", value: counts.averageRating100 ? formatRating(counts.averageRating100) : "N/A", raw: Number(counts.averageRating100 || 0) },
      { key: "ocount", label: "O count", value: formatNumber(counts.oCount), raw: Number(counts.oCount || 0) },
      { key: "performers", label: "Performers", value: formatNumber(counts.performers), raw: Number(counts.performers || 0) },
    ];
  }

  function renderStudioComparisonResolutionBreakdown(container, leftStats, rightStats) {
    const items = getStudioComparisonResolutionItems(leftStats, rightStats);
    if (!items.length) return;
    const leftTotal = Math.max(0, Number(leftStats?.resolutionDistribution?.total || 0));
    const rightTotal = Math.max(0, Number(rightStats?.resolutionDistribution?.total || 0));
    const panel = document.createElement("div");
    panel.className = "studio-dashboard__comparison-resolution";
    panel.innerHTML = `
      <div class="studio-dashboard__comparison-resolution-title">Video resolution</div>
      ${renderStudioComparisonResolutionBar("Left", items, leftTotal, "left")}
      ${renderStudioComparisonResolutionBar("Right", items, rightTotal, "right")}
      <div class="studio-dashboard__comparison-resolution-legend">
        ${items.map((item, index) => {
          const color = DEMOGRAPHIC_COLORS[index % DEMOGRAPHIC_COLORS.length];
          const tip = `${item.label}: Left ${formatNumber(item.leftCount)} (${formatInsightPercent(item.leftCount, leftTotal)}), Right ${formatNumber(item.rightCount)} (${formatInsightPercent(item.rightCount, rightTotal)})`;
          return `
            <span style="--studio-dashboard-comparison-resolution-color: ${escapeHtml(color)}" data-comparison-tooltip="${escapeHtml(tip)}">
              <i></i>${escapeHtml(item.label)}
            </span>
          `;
        }).join("")}
      </div>
    `;
    container.appendChild(panel);
  }

  function getStudioComparisonResolutionItems(leftStats, rightStats) {
    const byLabel = new Map();
    const absorb = (stats, side) => {
      (stats?.resolutionDistribution?.items || []).forEach((item) => {
        if (!item || item.metricUnknown || item.metricOther) return;
        const label = String(item.label || "").trim();
        if (!label) return;
        const existing = byLabel.get(label) || { label, leftCount: 0, rightCount: 0 };
        existing[side === "right" ? "rightCount" : "leftCount"] = Number(item.count || 0);
        byLabel.set(label, existing);
      });
    };
    absorb(leftStats, "left");
    absorb(rightStats, "right");
    const order = new Map(RESOLUTION_BUCKETS.map((bucket, index) => [bucket.label, index]));
    return Array.from(byLabel.values()).sort((left, right) => {
      const leftOrder = order.has(left.label) ? order.get(left.label) : Number.MAX_SAFE_INTEGER;
      const rightOrder = order.has(right.label) ? order.get(right.label) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.label.localeCompare(right.label);
    });
  }

  function renderStudioComparisonResolutionBar(label, items, total, side) {
    const safeTotal = Math.max(0, Number(total || 0));
    const segments = safeTotal > 0
      ? items.map((item, index) => {
        const count = Number(side === "right" ? item.rightCount || 0 : item.leftCount || 0);
        if (count <= 0) return "";
        const color = DEMOGRAPHIC_COLORS[index % DEMOGRAPHIC_COLORS.length];
        const percent = formatInsightPercent(count, safeTotal);
        return `
          <span style="--studio-dashboard-comparison-resolution-color: ${escapeHtml(color)}; --studio-dashboard-comparison-resolution-size: ${(count / safeTotal) * 100}%" data-comparison-tooltip="${escapeHtml(`${label} ${item.label}: ${formatNumber(count)} (${percent})`)}"></span>
        `;
      }).join("")
      : "";
    return `
      <div class="studio-dashboard__comparison-resolution-row">
        <b>${escapeHtml(label)}</b>
        <div class="studio-dashboard__comparison-resolution-bar">
          ${segments || `<em>No scenes</em>`}
        </div>
      </div>
    `;
  }

  function getStudioComparisonMetricMaxes(sideStats) {
    const maxes = {};
    (sideStats || []).forEach((stats) => {
      getStudioComparisonMetrics(stats).forEach((metric) => {
        maxes[metric.key] = Math.max(Number(maxes[metric.key] || 0), Number(metric.raw || 0));
      });
    });
    return maxes;
  }

  function renderStudioComparisonHighlights(container, stats) {
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__comparison-highlights";
    const performers = document.createElement("div");
    performers.className = "studio-dashboard__comparison-performers";
    [
      { label: "Top performer", item: stats.topPerformer, value: stats.topPerformer ? formatRating(stats.topPerformer.performerRating) : "", empty: "No rated performers from selection" },
      { label: "Most scenes", item: stats.performerMostScenes, value: stats.performerMostScenes ? formatNumber(stats.performerMostScenes.count) : "" },
      { label: "Most O's", item: stats.performerMostOs, value: stats.performerMostOs ? formatNumber(stats.performerMostOs.oCount) : "", empty: "No performers with O's from selection" },
    ].forEach((highlight) => renderComparisonPerformerHighlight(performers, highlight));
    const scenes = document.createElement("div");
    scenes.className = "studio-dashboard__comparison-scenes";
    [
      { label: "Top rated scene", scene: normalizeSceneSummary(stats.topRatedScene), value: stats.topRatedScene ? formatRating(stats.topRatedScene.rating100) : "", empty: "No rated scenes from selection" },
      { label: "Scene with most O's", scene: normalizeSceneSummary(stats.sceneMostOs), value: stats.sceneMostOs ? formatNumber(stats.sceneMostOs.o_counter) : "", empty: "No scenes with O's from selection" },
    ].forEach((highlight) => renderComparisonSceneHighlight(scenes, highlight));
    grid.append(performers, scenes);
    container.appendChild(grid);
  }

  function renderComparisonPerformerHighlight(container, highlight) {
    const performer = highlight.item;
    const card = document.createElement(performer?.id ? "a" : "div");
    card.className = "studio-dashboard__comparison-performer";
    if (performer?.id) {
      card.href = makePerformerUrl(performer);
      openLinkInNewTab(card);
    }
    card.innerHTML = `
      <span class="studio-dashboard__comparison-highlight-label">${escapeHtml(highlight.label)}</span>
      <span class="studio-dashboard__comparison-performer-image">
        ${performer?.imagePath ? `<img src="${escapeHtml(performer.imagePath)}" alt="${escapeHtml(performer.name)}">` : ""}
      </span>
      <strong>${performer ? formatComparisonPerformerName(performer) : escapeHtml(highlight.empty || "No performer from selection")}</strong>
      ${highlight.value ? `<small>${escapeHtml(highlight.value)}</small>` : ""}
      ${performer ? `<div class="studio-dashboard__comparison-performer-meta">${formatComparisonPerformerMeta(performer)}</div>` : ""}
    `;
    container.appendChild(card);
  }

  function formatComparisonPerformerName(performer) {
    if (!performer) return "N/A";
    const rating = Number(performer.performerRating || 0);
    return `${escapeHtml(performer.name)}${rating > 0 ? ` <span class="studio-dashboard__comparison-rating">★ ${escapeHtml(formatRating(rating))}</span>` : ""}`;
  }

  function formatComparisonPerformerMeta(performer) {
    return `
      <table class="studio-dashboard__performer-meta-table studio-dashboard__comparison-meta-table">
        <tbody>
          <tr>
            <td><span class="studio-dashboard__meta-icon" title="Scenes">🎬</span><strong>${escapeHtml(formatNumber(performer.count))}</strong></td>
            <td><span class="studio-dashboard__meta-icon" title="O's">${O_COUNT_ICON}</span><strong>${escapeHtml(formatNumber(performer.oCount))}</strong></td>
          </tr>
        </tbody>
      </table>
    `;
  }

  function renderComparisonSceneHighlight(container, highlight) {
    const scene = highlight.scene;
    const card = document.createElement(scene?.id ? "a" : "div");
    card.className = "studio-dashboard__comparison-scene";
    if (scene?.id) {
      card.href = makeSceneUrl(scene);
      openLinkInNewTab(card);
    }
    card.innerHTML = `
      <span class="studio-dashboard__comparison-highlight-label">${escapeHtml(highlight.label)}</span>
      <span class="studio-dashboard__scene-media">
        ${scene?.screenshot ? `<img src="${escapeHtml(scene.screenshot)}" alt="${escapeHtml(scene.title)}">` : ""}
        ${scene?.preview ? `<video src="${escapeHtml(scene.preview)}" muted loop playsinline preload="none"></video>` : ""}
      </span>
      <strong>${escapeHtml(scene?.title || highlight.empty || "No scene from selection")}</strong>
      ${highlight.value ? `<small>${escapeHtml(highlight.value)}</small>` : ""}
    `;
    const video = card.querySelector("video");
    if (video instanceof HTMLVideoElement) {
      card.addEventListener("mouseenter", () => {
        video.currentTime = 0;
        video.play().catch(() => {});
      });
      card.addEventListener("mouseleave", () => {
        video.pause();
        video.currentTime = 0;
      });
    }
    container.appendChild(card);
  }

  function byPerformerRatingThenName(left, right) {
    const ratingDiff = Number(right.performerRating || 0) - Number(left.performerRating || 0);
    if (ratingDiff) return ratingDiff;
    return String(left.name || "").localeCompare(String(right.name || ""));
  }

  function byPerformerSceneCountThenName(left, right) {
    const countDiff = Number(right.count || 0) - Number(left.count || 0);
    if (countDiff) return countDiff;
    return String(left.name || "").localeCompare(String(right.name || ""));
  }

  function byPerformerOCountThenName(left, right) {
    const countDiff = Number(right.oCount || 0) - Number(left.oCount || 0);
    if (countDiff) return countDiff;
    return String(left.name || "").localeCompare(String(right.name || ""));
  }

  function bySceneRatingThenTitle(left, right) {
    const ratingDiff = Number(right?.rating100 || 0) - Number(left?.rating100 || 0);
    if (ratingDiff) return ratingDiff;
    return String(left?.title || "").localeCompare(String(right?.title || ""));
  }

  function bySceneOCountThenTitle(left, right) {
    const oDiff = Number(right?.o_counter || 0) - Number(left?.o_counter || 0);
    if (oDiff) return oDiff;
    return String(left?.title || "").localeCompare(String(right?.title || ""));
  }

  function renderNeedsAttention(container, stats) {
    const sceneBuckets = Array.isArray(stats?.needsAttention?.scenes) ? stats.needsAttention.scenes : [];
    const performerBuckets = Array.isArray(stats?.needsAttention?.performers) ? stats.needsAttention.performers : [];
    if (!sceneBuckets.length && !performerBuckets.length) return;

    const section = createPageSection(container, "NEEDS ATTENTION");
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__attention-grid";
    sceneBuckets.forEach((bucket) => renderAttentionBucket(grid, "Scenes", bucket, makeSceneUrl, stats));
    performerBuckets.forEach((bucket) => renderAttentionBucket(grid, "Performers", bucket, makePerformerUrl, stats));
    section.appendChild(grid);
  }

  function renderAttentionBucket(container, entityLabel, bucket, hrefBuilder, stats) {
    const items = Array.isArray(bucket?.items) ? bucket.items.filter(Boolean) : [];
    if (!items.length) return;
    const card = document.createElement("div");
    card.className = "studio-dashboard__attention-card";
    const visible = items.slice(0, NEEDS_ATTENTION_ITEM_LIMIT);
    const hiddenCount = Math.max(0, items.length - visible.length);
    const bucketUrl = makeAttentionBucketUrl(bucket, stats);
    const headingText = `
      <span>${escapeHtml(bucket.label)}</span>
      <strong>${escapeHtml(formatNumber(items.length))}</strong>
    `;
    card.innerHTML = `
      ${bucketUrl
        ? `<a class="studio-dashboard__attention-heading" href="${escapeHtml(bucketUrl)}" target="_blank" rel="noopener noreferrer">${headingText}</a>`
        : `<div class="studio-dashboard__attention-heading">${headingText}</div>`}
      <div class="studio-dashboard__attention-type">${escapeHtml(entityLabel)}</div>
      <div class="studio-dashboard__attention-list">
        ${visible.map((item) => {
          const href = typeof hrefBuilder === "function" ? hrefBuilder(item) : "";
          const meta = getAttentionItemMeta(item);
          return `
            <a class="studio-dashboard__attention-item" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
              <span>${escapeHtml(item.title || item.name || "Untitled")}</span>
              ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
            </a>
          `;
        }).join("")}
        ${hiddenCount ? `<div class="studio-dashboard__attention-more">+${escapeHtml(formatNumber(hiddenCount))} more</div>` : ""}
      </div>
    `;
    container.appendChild(card);
  }

  function makeAttentionBucketUrl(bucket, stats) {
    const criteria = (bucket?.criteria || []).filter(Boolean);
    if (!criteria.length) return "";
    if (bucket?.target === "performers") return makePerformersUrl(criteria);
    return makeDashboardScenesUrl(stats, criteria);
  }

  function getAttentionItemMeta(item) {
    if (item?.date) return formatDate(item.date);
    if (Number(item?.count || 0) > 0) return `${formatNumber(item.count)} scene${Number(item.count) === 1 ? "" : "s"}`;
    if (Number(item?.rating100 || 0) > 0) return formatRating(item.rating100);
    if (Number(item?.performerRating || 0) > 0) return formatRating(item.performerRating);
    return "";
  }

  function formatInsightLink(href, label) {
    const text = String(label ?? "").trim();
    if (!href || !text) return escapeHtml(text);
    return `<a class="studio-dashboard__meta-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  }

  function makeSceneUrl(scene) {
    return scene?.id ? `/scenes/${encodeURIComponent(scene.id)}` : "";
  }

  function makePerformerUrl(performer) {
    return performer?.id ? `/performers/${encodeURIComponent(performer.id)}` : "";
  }

  function createPageSection(container, titleText, options = {}) {
    const section = document.createElement("div");
    section.className = "studio-dashboard__page-section";
    const body = document.createElement("div");
    body.className = "studio-dashboard__page-section-body";
    if (titleText) {
      const collapsedKey = getDashboardSectionCollapseKey(titleText);
      const defaultState = getDashboardSectionDefaultState();
      const isCollapsed = defaultState === "collapsed" ||
        defaultState === "remember" && getCollapsedDashboardSections().has(collapsedKey);
      const header = document.createElement("div");
      header.className = "studio-dashboard__page-section-header";
      const main = document.createElement("button");
      main.type = "button";
      main.className = "studio-dashboard__page-section-header-main";
      main.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      const caret = document.createElement("span");
      caret.className = "studio-dashboard__page-section-caret";
      caret.textContent = ">";
      const title = document.createElement("span");
      title.className = "studio-dashboard__page-section-title";
      title.textContent = titleText;
      const toggle = document.createElement("span");
      toggle.className = "studio-dashboard__page-section-toggle";
      toggle.textContent = isCollapsed ? "Expand" : "Collapse";
      main.append(caret, title, toggle);
      header.appendChild(main);
      const actions = document.createElement("span");
      actions.className = "studio-dashboard__page-section-actions";
      (options.actions || []).filter(Boolean).forEach((action) => actions.appendChild(action));
      if (actions.children.length) header.appendChild(actions);
      section.appendChild(header);
      if (isCollapsed) section.classList.add("is-collapsed");
      main.addEventListener("click", () => {
        const nextCollapsed = !section.classList.contains("is-collapsed");
        section.classList.toggle("is-collapsed", nextCollapsed);
        main.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
        toggle.textContent = nextCollapsed ? "Expand" : "Collapse";
        if (defaultState === "remember") setDashboardSectionCollapsed(collapsedKey, nextCollapsed);
      });
    }
    section.appendChild(body);
    container.appendChild(section);
    return body;
  }

  function getDashboardSectionCollapseKey(titleText) {
    return String(titleText || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function getCollapsedDashboardSections() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(DASHBOARD_COLLAPSED_SECTIONS_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : []);
    } catch (_err) {
      return new Set();
    }
  }

  function setDashboardSectionCollapsed(key, isCollapsed) {
    if (!key) return;
    const collapsed = getCollapsedDashboardSections();
    if (isCollapsed) collapsed.add(key);
    else collapsed.delete(key);
    try {
      window.localStorage.setItem(DASHBOARD_COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsed]));
    } catch (_err) {
      // Collapsed state is only a convenience, so storage failures are harmless.
    }
  }

  function renderDashboardTopTags(container, stats) {
    const groups = Array.isArray(stats.topTagGroups) ? stats.topTagGroups : [];
    const limit = getDashboardTopTagLimit();
    if (!groups.length) {
      renderTagCards(container, stats.studio, stats.topTags.slice(0, limit));
      return;
    }

    const grouped = document.createElement("div");
    grouped.className = `studio-dashboard__tag-groups studio-dashboard__tag-groups--${getDashboardTopTagLayout()}`;
    groups.forEach((group) => {
      const row = document.createElement("div");
      row.className = "studio-dashboard__tag-group";
      row.style.setProperty("--studio-dashboard-tag-count", String(Math.max(1, Math.min(limit, group.tags.length))));
      const title = document.createElement("div");
      title.className = "studio-dashboard__tag-group-title";
      title.textContent = group.name;
      row.appendChild(title);
      renderTagCards(row, stats.studio, group.tags.slice(0, limit));
      grouped.appendChild(row);
    });
    container.appendChild(grouped);
  }

  function renderPerformerRowSection(container, title, performers) {
    const visible = Array.isArray(performers) ? performers.filter(Boolean) : [];
    if (!visible.length) return;
    const section = createPageSection(container, title);
    renderPerformerCards(section, visible.slice(0, DASHBOARD_ROW_CARD_LIMIT));
  }

  function renderSceneRowSection(container, title, scenes, metaFormatter) {
    const visible = Array.isArray(scenes) ? scenes.filter(Boolean) : [];
    if (!visible.length) return;
    const section = createPageSection(container, title);
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__scene-grid";
    visible.slice(0, DASHBOARD_SCENE_ROW_LIMIT).forEach((scene) => {
      const item = document.createElement("div");
      item.className = "studio-dashboard__scene-grid-item";
      renderSceneCard(item, scene, typeof metaFormatter === "function" ? metaFormatter(scene) : "");
      grid.appendChild(item);
    });
    section.appendChild(grid);
  }

  function getSceneHighlights(stats) {
    return [
      {
        enabled: true,
        title: "Most recent release",
        scene: stats.recentScene,
        meta: stats.recentScene ? formatDate(stats.recentScene.date) : "",
      },
      {
        enabled: true,
        title: "Top rated scene",
        scene: stats.topScene,
        meta: stats.topScene ? formatRating(stats.topScene.rating100) : "",
      },
      {
        enabled: true,
        title: "Lowest rated scene",
        scene: stats.lowestRatedScene,
        meta: stats.lowestRatedScene ? formatRating(stats.lowestRatedScene.rating100) : "",
      },
      {
        enabled: true,
        title: "Most O's",
        scene: stats.topOCountScene,
        meta: stats.topOCountScene ? `${stats.topOCountScene.oCounter} O's` : "",
      },
      {
        enabled: true,
        title: "Least O's",
        scene: stats.leastOCountScene,
        meta: stats.leastOCountScene ? `${stats.leastOCountScene.oCounter} O's` : "",
      },
    ];
  }

  function createSection(container) {
    const section = document.createElement("div");
    section.className = "studio-dashboard__section";
    container.appendChild(section);
    return section;
  }

  function renderSceneHighlight(container, { enabled, title, scene, meta }) {
    if (!enabled || !scene) return;
    const section = createSection(container);
    const sectionTitle = document.createElement("div");
    sectionTitle.className = "studio-dashboard__section-title";
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);
    renderSceneCard(section, scene, meta);
  }

  function renderSceneHighlightGrid(container, highlights, options = {}) {
    const visible = highlights.filter((highlight) => highlight.enabled && highlight.scene);
    if (!visible.length) return;
    const section = options.title ? createPageSection(container, options.title) : createSection(container);
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__scene-grid";
    visible.forEach((highlight) => {
      const item = document.createElement("div");
      item.className = "studio-dashboard__scene-grid-item";
      const title = document.createElement("div");
      title.className = "studio-dashboard__section-title";
      title.textContent = highlight.title;
      item.appendChild(title);
      renderSceneCard(item, highlight.scene, highlight.meta);
      grid.appendChild(item);
    });
    section.appendChild(grid);
  }

  function createHideUnknownChartsToggle(kind, onChange) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "studio-dashboard__section-action";
    button.textContent = "Hide Unknown";
    button.classList.toggle("is-active", getHideUnknownChartSlices(kind));
    button.setAttribute("aria-pressed", getHideUnknownChartSlices(kind) ? "true" : "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = !getHideUnknownChartSlices(kind);
      setHideUnknownChartSlices(kind, next);
      button.classList.toggle("is-active", next);
      button.setAttribute("aria-pressed", next ? "true" : "false");
      if (typeof onChange === "function") onChange(next);
    });
    return button;
  }

  function renderPerformerDemographics(container, stats) {
    const demographics = stats?.performerDemographics;
    const hasCountries = Array.isArray(demographics?.countries) && demographics.countries.length;
    const hasAges = Array.isArray(demographics?.ages) && demographics.ages.length;
    const hasRatings = Array.isArray(demographics?.ratings) && demographics.ratings.length;
    const customPies = Array.isArray(demographics?.customPies) ? demographics.customPies : [];
    const hasCustomPie = customPies.some((chart) => {
      return Array.isArray(chart?.items) && chart.items.length ||
        Array.isArray(chart?.subcharts) && chart.subcharts.some((subchart) => subchart.items?.length);
    });
    if (!hasCountries && !hasAges && !hasRatings && !hasCustomPie && !demographics?.ageUnknown) return;

    const section = createPageSection(container, "PERFORMER CHARTS", {
      actions: [createHideUnknownChartsToggle("performer", () => {
        const dashboard = container.closest(".studio-dashboard__page-dashboard");
        if (dashboard instanceof HTMLElement) renderStudioPageDashboard(dashboard, stats);
      })],
    });
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__demographics";
    section.appendChild(grid);
    const hideUnknown = getHideUnknownChartSlices("performer");

    renderDemographicChart(grid, {
      title: "Nationality",
      subtitle: `${demographics.countryTotal || 0} unique performer${demographics.countryTotal === 1 ? "" : "s"}`,
      items: demographics.countries || [],
      unit: "performers",
      type: "country",
      studio: stats.studio,
      hideUnknown,
    });

    renderDemographicChart(grid, {
      title: "Age at release / Age",
      subtitle: `${demographics.ageTotal || 0} performer appearance${demographics.ageTotal === 1 ? "" : "s"}`,
      items: demographics.ages || [],
      unit: "appearances",
      type: "age",
      studio: stats.studio,
      hideUnknown,
    });

    renderDemographicChart(grid, {
      title: "Performer rating",
      subtitle: `${demographics.ratingTotal || 0} unique performer${demographics.ratingTotal === 1 ? "" : "s"}`,
      items: demographics.ratings || [],
      unit: "performers",
      type: "performer-rating",
      studio: stats.studio,
      hideUnknown,
    });

    customPies.forEach((chart, index) => {
      renderDemographicChart(grid, {
        title: chart.title || `Performer pie ${index + 1}`,
        subtitle: `${chart.total || 0} unique performer${chart.total === 1 ? "" : "s"}`,
        items: chart.items || [],
        subcharts: chart.subcharts || [],
        unit: "performers",
        type: "custom-performer",
        studio: stats.studio,
        hideUnknown,
      });
    });
  }

  function renderSceneCharts(container, stats) {
    const sceneCharts = Array.isArray(stats?.sceneCharts) ? stats.sceneCharts : [];
    const sceneRatings = stats?.sceneRatings || {};
    const sceneResolutions = stats?.sceneResolutions || {};
    const sceneDurations = stats?.sceneDurations || {};
    const visibleCharts = sceneCharts.filter((chart) => {
      return Array.isArray(chart?.items) && chart.items.length ||
        Array.isArray(chart?.subcharts) && chart.subcharts.some((subchart) => subchart.items?.length);
    });
    const hasSceneRatings = Array.isArray(sceneRatings.items) && sceneRatings.items.length;
    const hasSceneResolutions = Array.isArray(sceneResolutions.items) && sceneResolutions.items.length;
    const hasSceneDurations = Array.isArray(sceneDurations.items) && sceneDurations.items.length;
    if (!visibleCharts.length && !hasSceneRatings && !hasSceneResolutions && !hasSceneDurations) return;

    const section = createPageSection(container, "SCENE CHARTS", {
      actions: [createHideUnknownChartsToggle("scene", () => {
        const dashboard = container.closest(".studio-dashboard__page-dashboard");
        if (dashboard instanceof HTMLElement) renderStudioPageDashboard(dashboard, stats);
      })],
    });
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__demographics";
    section.appendChild(grid);
    const hideUnknown = getHideUnknownChartSlices("scene");

    if (hasSceneRatings) {
      renderDemographicChart(grid, {
        title: "Scene rating",
        subtitle: `${sceneRatings.total || 0} scene${sceneRatings.total === 1 ? "" : "s"}`,
        items: sceneRatings.items || [],
        unit: "scenes",
        type: "scene-rating",
        studio: stats.studio,
        hideUnknown,
      });
    }

    if (hasSceneResolutions) {
      renderDemographicChart(grid, {
        title: "Video resolution",
        subtitle: `${sceneResolutions.total || 0} scene${sceneResolutions.total === 1 ? "" : "s"}`,
        items: sceneResolutions.items || [],
        unit: "scenes",
        type: "scene-resolution",
        studio: stats.studio,
        footer: "Stash supports filtering by one resolution at a time.",
        hideUnknown,
      });
    }

    if (hasSceneDurations) {
      renderDemographicChart(grid, {
        title: "Video duration",
        subtitle: `${sceneDurations.total || 0} scene${sceneDurations.total === 1 ? "" : "s"}`,
        items: sceneDurations.items || [],
        unit: "scenes",
        type: "scene-duration",
        studio: stats.studio,
        hideUnknown,
      });
    }

    visibleCharts.forEach((chart, index) => {
      renderDemographicChart(grid, {
        title: chart.title || `Scene pie ${index + 1}`,
        subtitle: `${chart.total || 0} scene${chart.total === 1 ? "" : "s"}`,
        items: chart.items || [],
        subcharts: chart.subcharts || [],
        unit: "scenes",
        type: "custom-scene",
        studio: stats.studio,
        hideUnknown,
      });
    });
  }

  function renderDemographicChart(container, { title, subtitle, items, subcharts, unit, type, studio, footer, hideUnknown = false }) {
    const hasSubcharts = Array.isArray(subcharts) && subcharts.length;
    let nextItemIndex = 0;
    const displayItems = hasSubcharts
      ? []
      : prepareDemographicItemsForDisplay(getDemographicDisplayItems(items || [], type), hideUnknown)
        .map((item) => ({ ...item, sourceIndex: nextItemIndex++ }));
    const displaySubcharts = hasSubcharts
      ? subcharts.map((subchart) => ({
        ...subchart,
        items: prepareDemographicItemsForDisplay(subchart.items || [], hideUnknown)
          .map((item) => ({ ...item, sourceIndex: nextItemIndex++ })),
      }))
      : [];
    const allDisplayItems = hasSubcharts ? displaySubcharts.flatMap((subchart) => subchart.items || []) : displayItems;
    const chart = document.createElement("div");
    chart.className = "studio-dashboard__demographic-chart studio-dashboard__demographic-chart--pie";
    chart.studioDashboardItems = displayItems;
    chart.studioDashboardSubcharts = displaySubcharts;
    chart.studioDashboardUnit = unit;
    chart.studioDashboardType = type;
    chart.studioDashboardTagMatchMode = "any";
    chart.innerHTML = `
      <div class="studio-dashboard__demographic-heading">
        <span>${escapeHtml(title)}</span>
        <small>${escapeHtml(subtitle || "")}</small>
      </div>
    `;
    const body = document.createElement("div");
    body.className = "studio-dashboard__demographic-body";
    if (hasSubcharts) {
      body.classList.add("studio-dashboard__demographic-body--multi");
      renderDemographicSubcharts(body, displaySubcharts, unit, type);
    } else {
    const list = document.createElement("div");
    list.className = "studio-dashboard__demographic-list";
    if (type !== "scene-resolution" && type !== "scene-rating" && displayItems.some((item) => item.filterable !== false)) {
      const toolbar = document.createElement("div");
      toolbar.className = "studio-dashboard__demographic-select-all";
      toolbar.innerHTML = `
        <span class="studio-dashboard__demographic-actions">
          <button type="button" data-demo-action="include-all" title="Include all">+</button>
          <button type="button" data-demo-action="clear" title="Deselect all">-</button>
        </span>
        <span></span>
        <span></span>
      `;
      toolbar.querySelector("[data-demo-action='include-all']")?.addEventListener("click", () => {
        list.querySelectorAll(".studio-dashboard__demographic-row[data-filterable='true']").forEach((row) => setDemographicSelection(row, "include"));
      });
      toolbar.querySelector("[data-demo-action='clear']")?.addEventListener("click", () => {
        list.querySelectorAll(".studio-dashboard__demographic-row").forEach((row) => setDemographicSelection(row, ""));
      });
      list.appendChild(toolbar);
    }
    displayItems.forEach((item, index) => {
      const filterable = item.filterable !== false;
      const row = document.createElement("div");
      row.className = "studio-dashboard__demographic-row";
      row.dataset.itemIndex = String(index);
      row.dataset.filterable = filterable ? "true" : "false";
      row.style.setProperty("--studio-dashboard-demo-color", DEMOGRAPHIC_COLORS[index % DEMOGRAPHIC_COLORS.length]);
      row.innerHTML = `
        <span class="studio-dashboard__demographic-actions">
          ${filterable ? `
            <button type="button" data-filter-mode="include" title="Include ${escapeHtml(item.filterLabel || item.label)}">+</button>
            <button type="button" data-filter-mode="exclude" title="Exclude ${escapeHtml(item.filterLabel || item.label)}">-</button>
          ` : ""}
        </span>
        <span class="studio-dashboard__demographic-label"><span class="studio-dashboard__demographic-swatch"></span>${escapeHtml(item.label)}</span>
        <span class="studio-dashboard__demographic-value">
          <strong>${escapeHtml(item.count)}</strong>
          ${item.percent ? `<small>${escapeHtml(item.percent)}%</small>` : ""}
        </span>
      `;
      row.querySelectorAll("[data-filter-mode]").forEach((button) => {
        button.addEventListener("click", () => toggleDemographicSelection(row, button.dataset.filterMode));
      });
      row.querySelector(".studio-dashboard__demographic-label")?.addEventListener("click", () => {
        if (row.dataset.filterable === "false") return;
        toggleDemographicSelection(row, "include");
      });
      row.addEventListener("mouseenter", () => setDemographicHoverState(row, true, item, unit, type));
      row.addEventListener("mouseleave", () => setDemographicHoverState(row, false, item, unit, type));
      list.appendChild(row);
    });
    if (!list.children.length) {
      const empty = document.createElement("div");
      empty.className = "studio-dashboard__status";
      empty.textContent = "No data found.";
      list.appendChild(empty);
    }
    body.appendChild(list);
    if (items?.length) {
      renderDemographicPie(body, displayItems, unit, type);
    }
    }
    chart.appendChild(body);
    if (footer) {
      const note = document.createElement("div");
      note.className = "studio-dashboard__demographic-note";
      note.textContent = footer;
      chart.appendChild(note);
    }
    if (allDisplayItems.some((item) => item.filterable !== false)) {
      const controls = document.createElement("div");
      controls.className = "studio-dashboard__demographic-controls";
      controls.innerHTML = `
        <button type="button" data-demo-action="go" disabled>Go to scenes</button>
        ${isPerformerDemographicType(type) ? `<button type="button" data-demo-action="performers" disabled>Go to performers</button>` : ""}
        ${isCustomTagChartType(type) ? `
          <button type="button" data-tag-match-mode="any" class="is-active">Any</button>
          <button type="button" data-tag-match-mode="all">All</button>
        ` : ""}
        <button type="button" data-demo-action="update" disabled>Update chart</button>
        <button type="button" data-demo-action="reset">Reset</button>
      `;
      controls.querySelectorAll("[data-tag-match-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          setTagMatchMode(chart, button.dataset.tagMatchMode === "all" ? "all" : "any");
        });
      });
      controls.querySelector("[data-demo-action='go']")?.addEventListener("click", () => {
        openDemographicScenes(studio, type, allDisplayItems, Array.from(chart.querySelectorAll(".studio-dashboard__demographic-row")));
      });
      controls.querySelector("[data-demo-action='performers']")?.addEventListener("click", () => {
        openDemographicPerformers(type, allDisplayItems, Array.from(chart.querySelectorAll(".studio-dashboard__demographic-row")));
      });
      controls.querySelector("[data-demo-action='update']")?.addEventListener("click", () => {
        updateDemographicChartView(chart);
      });
      controls.querySelector("[data-demo-action='reset']")?.addEventListener("click", () => {
        resetDemographicChartView(chart);
      });
      chart.appendChild(controls);
      updateDemographicGoState(chart);
    }
    if (type === "scene-rating") updateSceneRatingRangeControls(chart);
    container.appendChild(chart);
  }

  function renderDemographicSubcharts(container, subcharts, unit, type) {
    const layout = document.createElement("div");
    layout.className = "studio-dashboard__demographic-multi";
    const list = document.createElement("div");
    list.className = "studio-dashboard__demographic-list studio-dashboard__demographic-list--shared";
    const pies = document.createElement("div");
    pies.className = `studio-dashboard__demographic-pies studio-dashboard__demographic-pies--${Math.min(4, subcharts.length)}`;
    subcharts.forEach((subchart) => {
      const group = document.createElement("div");
      group.className = "studio-dashboard__demographic-legend-group";
      group.innerHTML = `<div class="studio-dashboard__demographic-subtitle">${escapeHtml(subchart.title || "Group")}</div>`;
      (subchart.items || []).forEach((item) => {
        const filterable = item.filterable !== false;
        const row = document.createElement("div");
        row.className = "studio-dashboard__demographic-row";
        row.dataset.itemIndex = String(item.sourceIndex);
        row.dataset.filterable = filterable ? "true" : "false";
        row.style.setProperty("--studio-dashboard-demo-color", DEMOGRAPHIC_COLORS[item.sourceIndex % DEMOGRAPHIC_COLORS.length]);
        row.innerHTML = `
          <span class="studio-dashboard__demographic-actions">
            ${filterable ? `
              <button type="button" data-filter-mode="include" title="Include ${escapeHtml(item.filterLabel || item.label)}">+</button>
              <button type="button" data-filter-mode="exclude" title="Exclude ${escapeHtml(item.filterLabel || item.label)}">-</button>
            ` : ""}
          </span>
          <span class="studio-dashboard__demographic-label"><span class="studio-dashboard__demographic-swatch"></span>${escapeHtml(item.label)}</span>
          <span class="studio-dashboard__demographic-value">
            <strong>${escapeHtml(item.count)}</strong>
            ${item.percent ? `<small>${escapeHtml(item.percent)}%</small>` : ""}
          </span>
        `;
        row.querySelectorAll("[data-filter-mode]").forEach((button) => {
          button.addEventListener("click", () => toggleDemographicSelection(row, button.dataset.filterMode));
        });
        row.querySelector(".studio-dashboard__demographic-label")?.addEventListener("click", () => {
          if (row.dataset.filterable === "false") return;
          toggleDemographicSelection(row, "include");
        });
        row.addEventListener("mouseenter", () => setDemographicHoverState(row, true, item, unit, type));
        row.addEventListener("mouseleave", () => setDemographicHoverState(row, false, item, unit, type));
        group.appendChild(row);
      });
      list.appendChild(group);
      const pieWrap = document.createElement("div");
      pieWrap.className = "studio-dashboard__demographic-pie-wrap";
      pieWrap.innerHTML = `<div class="studio-dashboard__demographic-subtitle">${escapeHtml(subchart.title || "Group")}</div>`;
      renderDemographicPie(pieWrap, subchart.items || [], unit, type);
      pies.appendChild(pieWrap);
    });
    layout.appendChild(list);
    layout.appendChild(pies);
    container.appendChild(layout);
  }

  function getDemographicDisplayItems(items, type) {
    if (type !== "country") return items;
    return getPieItems(items);
  }

  function prepareDemographicItemsForDisplay(items, hideUnknown = false) {
    const visible = (items || []).filter((item) => !hideUnknown || !isUnknownDemographicItem(item));
    const total = visible.reduce((sum, item) => sum + Number(item.count || 0), 0);
    return visible.map((item) => ({
      ...item,
      percent: formatPercent(Number(item.count || 0), total),
    }));
  }

  function renderDemographicPie(container, items, unit, type) {
    const pieItems = getPieChartItems(items, type);
    if (!pieItems.length || (pieItems.length === 1 && isUnknownDemographicItem(pieItems[0]))) {
      const empty = document.createElement("div");
      empty.className = "studio-dashboard__demographic-pie studio-dashboard__demographic-pie--empty";
      empty.textContent = "N/A";
      container.appendChild(empty);
      return;
    }
    const totalCount = pieItems.reduce((sum, item) => sum + Number(item.count || 0), 0);
    const total = Math.max(1, totalCount);
    let cursor = 0;
    const pie = document.createElement("div");
    pie.className = "studio-dashboard__demographic-pie";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${type === "country" ? "Nationality" : "Age"} distribution`);
    pieItems.forEach((item, index) => {
      const displayItem = {
        ...item,
        percent: formatPercent(Number(item.count || 0), totalCount),
      };
      const start = cursor;
      cursor += (Number(displayItem.count || 0) / total) * 360;
      const end = cursor;
      const colorIndex = Number(displayItem.sourceIndex ?? index);
      const slice = end - start >= 359.99
        ? document.createElementNS("http://www.w3.org/2000/svg", "circle")
        : document.createElementNS("http://www.w3.org/2000/svg", "path");
      if (slice.tagName.toLowerCase() === "circle") {
        slice.setAttribute("cx", "50");
        slice.setAttribute("cy", "50");
        slice.setAttribute("r", "47");
      } else {
        slice.setAttribute("d", describePieSlice(50, 50, 47, start, end));
      }
      slice.setAttribute("fill", DEMOGRAPHIC_COLORS[colorIndex % DEMOGRAPHIC_COLORS.length]);
      slice.setAttribute("transform-origin", "50 50");
      slice.dataset.itemIndex = String(displayItem.sourceIndex ?? index);
      slice.studioDashboardItem = displayItem;
      slice.classList.add("studio-dashboard__demographic-slice");
      slice.setAttribute("aria-label", `${displayItem.filterLabel || displayItem.label}: ${displayItem.count} ${unit}${displayItem.percent ? `, ${displayItem.percent}%` : ""}`);
      slice.addEventListener("click", () => togglePieSliceSelection(pie, displayItem));
      slice.addEventListener("mouseenter", (event) => {
        setPieHoverState(pie, displayItem, true);
        showPieTooltip(pie, displayItem, unit, type, event);
      });
      slice.addEventListener("mousemove", (event) => positionPieTooltip(pie, event));
      slice.addEventListener("mouseleave", () => {
        setPieHoverState(pie, displayItem, false);
        hidePieTooltip(pie);
      });
      svg.appendChild(slice);
    });
    const tooltip = document.createElement("div");
    tooltip.className = "studio-dashboard__demographic-tooltip";
    pie.appendChild(svg);
    pie.appendChild(tooltip);
    container.appendChild(pie);
  }

  function getPieChartItems(items, type) {
    const sorted = (items || [])
      .map((item, index) => ({ ...item, sourceIndex: item.sourceIndex ?? index }))
      .sort((left, right) => {
        if (right.count !== left.count) return Number(right.count || 0) - Number(left.count || 0);
        return Number(left.sourceIndex) - Number(right.sourceIndex);
      });
    if (type === "country") return sorted;
    return applyPieSliceLimit(sorted);
  }

  function applyPieSliceLimit(items) {
    const max = getPieSliceMax();
    if (!max || items.length <= max) return items;
    const knownItems = items.filter((item) => !isUnknownDemographicItem(item));
    const unknownItems = items.filter(isUnknownDemographicItem);
    if (knownItems.length <= max) return items;
    const visible = knownItems.slice(0, max);
    const overflow = knownItems.slice(max);
    const otherCount = overflow.reduce((total, item) => total + Number(item.count || 0), 0);
    const firstOverflowIndex = Math.min(...overflow.map((item) => Number(item.sourceIndex ?? max)));
    const other = {
      key: "Other",
      label: "Other",
      filterLabel: "Other",
      count: otherCount,
      sourceIndex: Number.isFinite(firstOverflowIndex) ? firstOverflowIndex : max,
      performers: overflow.flatMap((item) => item.performers || []),
      performerIds: uniqueValues(overflow.flatMap((item) => item.performerIds || [])),
      filterable: false,
    };
    return [...visible, other, ...unknownItems].filter((item) => Number(item.count || 0) > 0);
  }

  function isUnknownDemographicItem(item) {
    return item?.key === "Unknown" ||
      item?.countryValue === "Unknown" ||
      item?.unknownAge ||
      item?.unknownRange ||
      item?.unknownRating ||
      item?.metricUnknown ||
      item?.customTagUnknown;
  }

  function setPieHoverState(pie, item, active) {
    const chart = pie.closest(".studio-dashboard__demographic-chart");
    const index = String(item.sourceIndex ?? "");
    chart?.querySelectorAll(`[data-item-index="${escapeSelectorValue(index)}"]`).forEach((element) => {
      element.classList.toggle("is-hovered", active);
    });
  }

  function showPieTooltip(pie, item, unit, type, event) {
    const tooltip = pie.querySelector(".studio-dashboard__demographic-tooltip");
    if (!(tooltip instanceof HTMLElement)) return;
    const colorIndex = Number(item.sourceIndex ?? 0);
    const performer = getRepresentativePerformer(item);
    const imageHeight = getDemographicTooltipImageHeight();
    const showImage = imageHeight > 0 && performer?.imagePath;
    tooltip.style.setProperty("--studio-dashboard-demo-color", DEMOGRAPHIC_COLORS[colorIndex % DEMOGRAPHIC_COLORS.length]);
    tooltip.style.setProperty("--studio-dashboard-tooltip-image-height", `${imageHeight}px`);
    tooltip.innerHTML = `
      ${showImage ? `
        <span class="studio-dashboard__demographic-tooltip-image">
          <img src="${escapeHtml(performer.imagePath)}" alt="${escapeHtml(performer.name)}">
        </span>
      ` : ""}
      <span class="studio-dashboard__demographic-tooltip-copy">
        <strong>${escapeHtml(getPieTooltipLabel(item, type))}</strong>
        <span>${escapeHtml(item.count)}${item.percent ? `, ${escapeHtml(item.percent)}%` : ""}</span>
        ${showImage ? `<em>${escapeHtml(performer.name)}</em>` : ""}
      </span>
    `;
    tooltip.classList.add("is-visible");
    positionPieTooltip(pie, event);
  }

  function getRepresentativePerformer(item) {
    return (item?.performers || [])
      .filter((performer) => performer?.imagePath)
      .slice()
      .sort((left, right) => {
        const ratingDiff = Number(right.performerRating || 0) - Number(left.performerRating || 0);
        if (ratingDiff) return ratingDiff;
        return String(left.name || "").localeCompare(String(right.name || ""));
      })[0] || null;
  }

  function positionPieTooltip(pie, event) {
    const tooltip = pie.querySelector(".studio-dashboard__demographic-tooltip");
    if (!(tooltip instanceof HTMLElement) || !event) return;
    const rect = pie.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 180;
    const tooltipHeight = tooltip.offsetHeight || 56;
    const pad = 8;
    let x = event.clientX + 14;
    let y = event.clientY - tooltipHeight / 2;
    if (x + tooltipWidth > window.innerWidth - pad) x = event.clientX - tooltipWidth - 14;
    x = Math.max(pad, Math.min(window.innerWidth - tooltipWidth - pad, x));
    y = Math.max(pad, Math.min(window.innerHeight - tooltipHeight - pad, y));
    tooltip.style.setProperty("--studio-dashboard-tooltip-x", `${x - rect.left}px`);
    tooltip.style.setProperty("--studio-dashboard-tooltip-y", `${y - rect.top}px`);
  }

  function getElementCenterEvent(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
  }

  function hidePieTooltip(pie) {
    const tooltip = pie.querySelector(".studio-dashboard__demographic-tooltip");
    if (tooltip instanceof HTMLElement) tooltip.classList.remove("is-visible");
  }

  function getPieTooltipLabel(item, type) {
    if (type !== "country") return String(item.label || "");
    if (item.key === "Other") return "Other";
    if (item.key === "Unknown" || item.countryValue === "Unknown") return "Unknown";
    return formatCountryLabel(item.countryValue || item.key || item.label);
  }

  function setDemographicHoverState(row, active, item = null, unit = "", type = "") {
    const chart = row.closest(".studio-dashboard__demographic-chart");
    const index = row.dataset.itemIndex || "";
    const slices = chart?.querySelectorAll(`.studio-dashboard__demographic-slice[data-item-index="${escapeSelectorValue(index)}"]`) || [];
    slices.forEach((element) => {
      element.classList.toggle("is-hovered", active);
      const pie = element.closest(".studio-dashboard__demographic-pie");
      if (!(pie instanceof HTMLElement) || !item) return;
      if (active) {
        showPieTooltip(pie, element.studioDashboardItem || item, unit, type, getElementCenterEvent(element));
      } else {
        hidePieTooltip(pie);
      }
    });
  }

  function togglePieSliceSelection(pie, item) {
    const chart = pie.closest(".studio-dashboard__demographic-chart");
    const row = chart?.querySelector(`.studio-dashboard__demographic-row[data-item-index="${escapeSelectorValue(item.sourceIndex)}"]`);
    if (row instanceof HTMLElement) toggleDemographicSelection(row, "include");
  }

  function escapeSelectorValue(value) {
    const stringValue = String(value ?? "");
    return window.CSS?.escape ? CSS.escape(stringValue) : stringValue.replace(/["\\]/g, "\\$&");
  }

  function describePieSlice(cx, cy, radius, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, radius, endAngle);
    const end = polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
      "Z",
    ].join(" ");
  }

  function polarToCartesian(cx, cy, radius, angle) {
    const radians = ((angle - 90) * Math.PI) / 180;
    return {
      x: Math.round((cx + radius * Math.cos(radians)) * 1000) / 1000,
      y: Math.round((cy + radius * Math.sin(radians)) * 1000) / 1000,
    };
  }

  function getPieItems(items) {
    if (!items.length) return items;
    const knownItems = items.filter((item) => item.countryValue !== "Unknown" && item.key !== "Unknown");
    const unknownItems = items.filter((item) => item.countryValue === "Unknown" || item.key === "Unknown");
    if (knownItems.length <= DEMOGRAPHIC_PIE_TOP_COUNTRIES && !unknownItems.length) return items;
    const visible = knownItems.slice(0, DEMOGRAPHIC_PIE_TOP_COUNTRIES);
    const otherItems = knownItems.slice(DEMOGRAPHIC_PIE_TOP_COUNTRIES);
    const otherCount = otherItems.reduce((total, item) => total + Number(item.count || 0), 0);
    const total = items.reduce((sum, item) => sum + Number(item.count || 0), 0);
    const pieItems = [...visible];
    if (otherCount > 0) {
      pieItems.push({
        key: "Other",
        label: "Other",
        filterLabel: "Other",
        countryValues: uniqueValues(otherItems.flatMap((item) => item.countryValues || item.countryValue || item.key || []))
          .filter((value) => value && value !== "Unknown"),
        performers: otherItems.flatMap((item) => item.performers || []),
        performerIds: uniqueValues(otherItems.flatMap((item) => item.performerIds || [])),
        count: otherCount,
        percent: formatPercent(otherCount, total),
        filterable: otherItems.length > 0,
      });
    }
    const unknownCount = unknownItems.reduce((sum, item) => sum + Number(item.count || 0), 0);
    if (unknownCount > 0) {
      pieItems.push({
        key: "Unknown",
        label: "Unknown",
        filterLabel: "Unknown",
        countryValue: "Unknown",
        performers: unknownItems.flatMap((item) => item.performers || []),
        performerIds: uniqueValues(unknownItems.flatMap((item) => item.performerIds || [])),
        count: unknownCount,
        percent: formatPercent(unknownCount, total),
        filterable: true,
      });
    }
    return pieItems.filter((item) => Number(item.count || 0) > 0);
  }

  function toggleDemographicSelection(row, mode) {
    const chart = row.closest(".studio-dashboard__demographic-chart");
    if (chart?.studioDashboardType === "scene-rating") {
      toggleSceneRatingSelection(row, mode, chart);
      return;
    }
    const current = row.dataset.filterMode || "";
    setDemographicSelection(row, current === mode ? "" : mode);
  }

  function setDemographicSelection(row, mode) {
    if (row?.dataset?.filterable === "false") return;
    const chart = row.closest(".studio-dashboard__demographic-chart");
    if (chart?.studioDashboardType === "scene-resolution" && mode) {
      chart.querySelectorAll(".studio-dashboard__demographic-row").forEach((otherRow) => {
        if (otherRow !== row) setDemographicSelection(otherRow, "");
      });
    }
    row.dataset.filterMode = mode || "";
    row.classList.toggle("is-include", mode === "include");
    row.classList.toggle("is-exclude", mode === "exclude");
    row.querySelectorAll("[data-filter-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filterMode === mode);
    });
    syncDemographicSliceSelection(chart, row.dataset.itemIndex || "", mode);
    updateDemographicGoState(chart);
    if (chart?.studioDashboardType === "scene-rating") updateSceneRatingRangeControls(chart);
  }

  function toggleSceneRatingSelection(row, mode, chart) {
    if (!(chart instanceof HTMLElement) || row?.dataset?.filterable === "false") return;
    const button = row.querySelector(`[data-filter-mode="${escapeSelectorValue(mode)}"]`);
    if (button instanceof HTMLButtonElement && button.disabled) return;
    const current = row.dataset.filterMode || "";
    if (current === mode) {
      setDemographicSelection(row, "");
      return;
    }
    const selectedMode = getSceneRatingSelectionMode(chart);
    if (selectedMode && selectedMode !== mode) {
      chart.querySelectorAll(".studio-dashboard__demographic-row").forEach((otherRow) => setDemographicSelection(otherRow, ""));
    }
    setDemographicSelection(row, mode);
  }

  function getSceneRatingSelectionMode(chart) {
    const selected = Array.from(chart?.querySelectorAll?.(".studio-dashboard__demographic-row") || [])
      .find((row) => row.dataset.filterMode === "include" || row.dataset.filterMode === "exclude");
    return selected?.dataset?.filterMode || "";
  }

  function getSceneRatingRangeRows(chart) {
    const items = chart?.studioDashboardItems || [];
    return Array.from(chart?.querySelectorAll?.(".studio-dashboard__demographic-row") || [])
      .filter((row) => {
        const item = items[Number(row.dataset.itemIndex)];
        return isRatingRangeItem(item);
      });
  }

  function isRatingRangeItem(item) {
    return Boolean(item && !item.unknownRating && !item.otherRating && Number.isFinite(Number(item.min)) && Number.isFinite(Number(item.max)));
  }

  function updateSceneRatingRangeControls(chart) {
    if (!(chart instanceof HTMLElement)) return;
    const rows = Array.from(chart.querySelectorAll(".studio-dashboard__demographic-row"));
    const items = chart.studioDashboardItems || [];
    const selectedRows = rows.filter((row) => row.dataset.filterMode === "include" || row.dataset.filterMode === "exclude");
    const selectedMode = selectedRows[0]?.dataset?.filterMode || "";
    const rangeRows = getSceneRatingRangeRows(chart);
    const selectedRangeRows = selectedRows.filter((row) => rangeRows.includes(row));
    const selectedRangePositions = selectedRangeRows
      .map((row) => rangeRows.indexOf(row))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right);
    const minPosition = selectedRangePositions[0] ?? -1;
    const maxPosition = selectedRangePositions[selectedRangePositions.length - 1] ?? -1;
    const selectedHasSpecial = selectedRows.some((row) => {
      const item = items[Number(row.dataset.itemIndex)];
      return item?.unknownRating || item?.otherRating;
    });

    rows.forEach((row) => {
      const item = items[Number(row.dataset.itemIndex)];
      const currentMode = row.dataset.filterMode || "";
      const rangePosition = rangeRows.indexOf(row);
      const isRange = rangePosition >= 0;
      const isSelected = currentMode === "include" || currentMode === "exclude";
      const canClearSelected = !isRange ||
        selectedRangeRows.length <= 2 ||
        rangePosition === minPosition ||
        rangePosition === maxPosition;
      const canExtendRange = isRange &&
        selectedMode &&
        !selectedHasSpecial &&
        !isSelected &&
        (rangePosition === minPosition - 1 || rangePosition === maxPosition + 1);
      const noSelection = !selectedRows.length;
      row.classList.toggle("is-range-locked", isSelected && !canClearSelected);
      row.querySelectorAll("[data-filter-mode]").forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) return;
        const buttonMode = button.dataset.filterMode || "";
        let disabled = false;
        if (noSelection) {
          disabled = false;
        } else if (isSelected) {
          disabled = buttonMode !== currentMode || !canClearSelected;
        } else if (canExtendRange) {
          disabled = buttonMode !== selectedMode;
        } else {
          disabled = true;
        }
        if (item?.otherRating) disabled = true;
        button.disabled = disabled;
      });
    });
  }

  function syncDemographicSliceSelection(chart, itemIndex, mode) {
    if (!(chart instanceof HTMLElement)) return;
    chart.querySelectorAll(`.studio-dashboard__demographic-slice[data-item-index="${escapeSelectorValue(itemIndex)}"]`).forEach((slice) => {
      slice.classList.toggle("is-include", mode === "include");
      slice.classList.toggle("is-exclude", mode === "exclude");
    });
  }

  function updateDemographicGoState(chart) {
    if (!(chart instanceof HTMLElement)) return;
    const hasSelection = Array.from(chart.querySelectorAll(".studio-dashboard__demographic-row")).some((row) => {
      return row.dataset.filterMode === "include" || row.dataset.filterMode === "exclude";
    });
    chart.querySelectorAll("[data-demo-action='go'], [data-demo-action='performers'], [data-demo-action='update']").forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = !hasSelection;
      button.classList.toggle("is-ready", hasSelection);
    });
  }

  function getDemographicSelectionSets(chart) {
    const include = new Set();
    const exclude = new Set();
    chart?.querySelectorAll(".studio-dashboard__demographic-row").forEach((row) => {
      const index = row.dataset.itemIndex || "";
      if (!index) return;
      if (row.dataset.filterMode === "include") include.add(index);
      if (row.dataset.filterMode === "exclude") exclude.add(index);
    });
    return { include, exclude };
  }

  function getUpdatedDemographicItems(items, selections) {
    const include = selections?.include || new Set();
    const exclude = selections?.exclude || new Set();
    return (items || []).filter((item) => {
      const index = String(item.sourceIndex ?? "");
      if (exclude.has(index)) return false;
      return include.size ? include.has(index) : true;
    });
  }

  function updateDemographicChartView(chart) {
    if (!(chart instanceof HTMLElement)) return;
    const selections = getDemographicSelectionSets(chart);
    const unit = chart.studioDashboardUnit || "";
    const type = chart.studioDashboardType || "";
    const subcharts = Array.isArray(chart.studioDashboardSubcharts) ? chart.studioDashboardSubcharts : [];

    if (subcharts.length) {
      const wraps = Array.from(chart.querySelectorAll(".studio-dashboard__demographic-pie-wrap"));
      subcharts.forEach((subchart, index) => {
        const wrap = wraps[index];
        if (!(wrap instanceof HTMLElement)) return;
        wrap.querySelectorAll(".studio-dashboard__demographic-pie").forEach((pie) => pie.remove());
        renderDemographicPie(wrap, getUpdatedDemographicItems(subchart.items || [], selections), unit, type);
      });
    } else {
      const body = chart.querySelector(".studio-dashboard__demographic-body");
      if (body instanceof HTMLElement) {
        body.querySelectorAll(":scope > .studio-dashboard__demographic-pie").forEach((pie) => pie.remove());
        renderDemographicPie(
          body,
          getUpdatedDemographicItems(chart.studioDashboardItems || [], selections),
          unit,
          type
        );
      }
    }

    chart.querySelectorAll(".studio-dashboard__demographic-row").forEach((row) => {
      syncDemographicSliceSelection(chart, row.dataset.itemIndex || "", row.dataset.filterMode || "");
    });
  }

  function resetDemographicChartView(chart) {
    if (!(chart instanceof HTMLElement)) return;
    chart.querySelectorAll(".studio-dashboard__demographic-row").forEach((row) => setDemographicSelection(row, ""));
    updateDemographicChartView(chart);
    if (chart.studioDashboardType === "scene-rating") updateSceneRatingRangeControls(chart);
  }

  function openDemographicScenes(studio, type, items, rows) {
    const chart = rows[0]?.closest?.(".studio-dashboard__demographic-chart");
    const tagMatchMode = getTagMatchMode(chart);
    const includeItems = [];
    const excludeItems = [];
    rows.forEach((row, index) => {
      const mode = row.dataset.filterMode || "";
      if (mode === "include") includeItems.push(items[index]);
      if (mode === "exclude") excludeItems.push(items[index]);
    });
    let criteria;
    if (type === "country") {
      criteria = buildCountryFilterCriteria(includeItems, excludeItems);
    } else if (type === "custom-scene") {
      criteria = buildSceneTagFilterCriteria(includeItems, excludeItems, tagMatchMode);
    } else if (type === "scene-rating") {
      criteria = buildSceneRatingFilterCriteria(includeItems, excludeItems);
    } else if (type === "scene-resolution") {
      criteria = buildSceneMetricFilterCriteria("resolution", includeItems, excludeItems);
    } else if (type === "scene-duration") {
      criteria = buildSceneMetricFilterCriteria("duration", includeItems, excludeItems);
    } else if (type === "custom-performer" || type === "performer-rating") {
      criteria = buildPerformerGroupFilterCriteria(includeItems, excludeItems);
    } else {
      criteria = buildAgeFilterCriteria(includeItems, excludeItems);
    }
    openDashboardTarget(makeStudioScenesUrl(studio, criteria));
  }

  function openDemographicPerformers(type, items, rows) {
    const chart = rows[0]?.closest?.(".studio-dashboard__demographic-chart");
    const tagMatchMode = getTagMatchMode(chart);
    const includeItems = [];
    const excludeItems = [];
    rows.forEach((row, index) => {
      const mode = row.dataset.filterMode || "";
      if (mode === "include") includeItems.push(items[index]);
      if (mode === "exclude") excludeItems.push(items[index]);
    });
    const criteria = buildPerformerBrowserCriteria(type, includeItems, excludeItems, tagMatchMode);
    openDashboardTarget(makePerformersUrl(criteria));
  }

  function isPerformerDemographicType(type) {
    return type === "country" || type === "age" || type === "performer-rating" || type === "custom-performer";
  }

  function isCustomTagChartType(type) {
    return type === "custom-performer" || type === "custom-scene";
  }

  function openDashboardTarget(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function getTagMatchMode(chart) {
    return chart?.studioDashboardTagMatchMode === "all" ? "all" : "any";
  }

  function setTagMatchMode(chart, mode) {
    if (!(chart instanceof HTMLElement)) return;
    const normalized = mode === "all" ? "all" : "any";
    chart.studioDashboardTagMatchMode = normalized;
    chart.querySelectorAll("[data-tag-match-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tagMatchMode === normalized);
    });
  }

  function formatPerformerMeta(performer) {
    const studioScenes = Number(performer?.count || 0);
    const allScenes = Number(performer?.allSceneCount || 0);
    const studioTopRating = Number(performer?.studioTopRating || 0);
    const allTopRating = Number(performer?.allTopRating || 0);
    const studioOCount = Number(performer?.oCount || 0);
    const allOCount = Number(performer?.allOCount || 0);
    return `
      <table class="studio-dashboard__performer-meta-table">
        <thead>
          <tr>
            <th>Studio</th>
            <th>All</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="studio-dashboard__meta-icon" title="Studio scenes">🎬</span>${formatPerformerMetricLink(performer, "studio", studioScenes, "date")}</td>
            <td><span class="studio-dashboard__meta-icon" title="All scenes">🎬</span>${formatPerformerMetricLink(performer, "all", allScenes, "date")}</td>
          </tr>
          <tr>
            <td><span class="studio-dashboard__meta-icon" title="Studio O's">${O_COUNT_ICON}</span>${formatPerformerMetricLink(performer, "studio", studioOCount, "o_counter")}</td>
            <td><span class="studio-dashboard__meta-icon" title="All O's">${O_COUNT_ICON}</span>${formatPerformerMetricLink(performer, "all", allOCount, "o_counter")}</td>
          </tr>
          <tr>
            <td><span class="studio-dashboard__meta-icon" title="Top rated studio scene">★</span>${formatRatingLink(performer, "studio", studioTopRating)}</td>
            <td><span class="studio-dashboard__meta-icon" title="Top rated scene">★</span>${formatRatingLink(performer, "all", allTopRating)}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  function formatRatingLink(performer, scope, rating) {
    const label = formatContentRating(rating);
    if (Number(rating || 0) <= 0) return `<strong>${escapeHtml(label)}</strong>`;
    return `<a class="studio-dashboard__meta-link" href="${escapeHtml(makePerformerScenesUrl(performer, scope, "rating"))}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(label)}</strong></a>`;
  }

  function formatPerformerMetricLink(performer, scope, value, sortBy) {
    const count = Number(value || 0);
    if (count <= 0) return `<strong>${escapeHtml(count)}</strong>`;
    return `<a class="studio-dashboard__meta-link" href="${escapeHtml(makePerformerScenesUrl(performer, scope, sortBy))}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(count)}</strong></a>`;
  }

  function makePerformerScenesUrl(performer, scope, sortBy) {
    const params = new URLSearchParams();
    params.set("sortby", sortBy || "date");
    params.set("sortdir", "desc");
    if (scope === "studio" && performer?.studioId) {
      params.append("c", JSON.stringify({
        type: "studios",
        value: {
          items: [{ id: String(performer.studioId), label: String(performer.studioName || "Studio") }],
          excluded: [],
          depth: -1,
        },
        modifier: "INCLUDES",
      }));
    }
    const query = params.toString();
    return `/performers/${encodeURIComponent(performer?.id || "")}/scenes${query ? `?${query}` : ""}`;
  }

  function formatPerformerName(performer) {
    const performerRating = Number(performer?.performerRating || 0);
    return `
      <span class="studio-dashboard__performer-name">${escapeHtml(performer.name)}</span>
      <span class="studio-dashboard__performer-rating">
        <span class="studio-dashboard__meta-icon" title="Performer rating">★</span><strong>${escapeHtml(formatRating(performerRating))}</strong>
      </span>
    `;
  }

  function renderPerformerCards(container, performers, options = {}) {
    const showMeta = options.showMeta !== false;
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__cards";
    performers.forEach((performer) => {
      const card = document.createElement("a");
      card.className = "studio-dashboard__card";
      card.href = `/performers/${encodeURIComponent(performer.id)}`;
      openLinkInNewTab(card);
      card.innerHTML = `
        ${performer.metricTitle ? `<div class="studio-dashboard__card-kicker">${escapeHtml(performer.metricTitle)}</div>` : ""}
        <div class="studio-dashboard__card-name studio-dashboard__performer-title">${formatPerformerName(performer)}</div>
        ${performer.imagePath ? `<img src="${escapeHtml(performer.imagePath)}" alt="${escapeHtml(performer.name)}">` : ""}
        ${showMeta ? `<div class="studio-dashboard__muted studio-dashboard__performer-meta">${formatPerformerMeta(performer)}</div>` : ""}
      `;
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  function renderTagCards(container, studio, tags) {
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__tag-cards";
    tags.forEach((tag) => {
      const card = document.createElement("a");
      card.className = "studio-dashboard__tag-card";
      card.href = makeStudioTagUrl(studio, tag);
      openLinkInNewTab(card);
      card.innerHTML = `
        <span class="studio-dashboard__tag-image">
          ${tag.imagePath ? `<img src="${escapeHtml(tag.imagePath)}" alt="${escapeHtml(tag.name)}">` : ""}
        </span>
        <span class="studio-dashboard__card-name">${escapeHtml(tag.name)}</span>
        <span class="studio-dashboard__muted studio-dashboard__tag-meta">
          <span class="studio-dashboard__meta-icon" title="Scenes">🎬</span><strong>${escapeHtml(tag.count)}</strong>
        </span>
      `;
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  function makeStudioTagUrl(studio, tag) {
    return makeStudioScenesUrl(studio, [buildTagCriterion(tag)]);
  }

  function buildTagCriterion(tag, modifier = "INCLUDES") {
    return buildTagListCriterion([tag], modifier);
  }

  function buildTagListCriterion(tags, modifier = "INCLUDES") {
    const items = (tags || [])
      .filter((tag) => tag?.id)
      .map((tag) => ({ id: String(tag.id), label: String(tag.name || "Tag") }));
    if (!items.length) return null;
    return {
      type: "tags",
      value: {
        items,
        excluded: [],
        depth: -1,
      },
      modifier,
    };
  }

  function buildCountryFilterCriteria(includeItems, excludeItems) {
    const criteria = [];
    const included = normalizePerformerFilterItems(includeItems);
    const excluded = normalizePerformerFilterItems(excludeItems);
    if (included.length) {
      criteria.push(buildPerformerCriterion(included, "INCLUDES"));
    }
    if (excluded.length) {
      criteria.push(buildPerformerCriterion(excluded, "EXCLUDES"));
    }
    return criteria;
  }

  function buildPerformerGroupFilterCriteria(includeItems, excludeItems) {
    const criteria = [];
    const included = normalizePerformerFilterItems(includeItems);
    const excluded = normalizePerformerFilterItems(excludeItems);
    if (included.length) criteria.push(buildPerformerCriterion(included, "INCLUDES"));
    if (excluded.length) criteria.push(buildPerformerCriterion(excluded, "EXCLUDES"));
    return criteria;
  }

  function buildPerformerBrowserCriteria(type, includeItems, excludeItems, tagMatchMode = "any") {
    if (type === "country") return buildPerformerCountryCriteria(includeItems, excludeItems);
    if (type === "age") return buildPerformerBrowserAgeCriteria(includeItems, excludeItems);
    if (type === "performer-rating") return buildPerformerRatingCriteria(includeItems, excludeItems);
    if (type === "custom-performer") return buildPerformerTagFilterCriteria(includeItems, excludeItems, tagMatchMode);
    return [];
  }

  function buildPerformerCountryCriteria(includeItems, excludeItems) {
    return [
      ...includeItems.map((item) => buildCountryCriterion(item, false)),
      ...excludeItems.map((item) => buildCountryCriterion(item, true)),
    ].filter(Boolean);
  }

  function buildCountryCriterion(item, exclude = false) {
    const values = uniqueValues([
      ...(item?.countryValues || []),
      item?.countryValue,
    ]).filter((value) => value && value !== "Unknown");
    if (item?.countryValue === "Unknown" || item?.label === "Unknown") {
      return {
        type: "country",
        modifier: exclude ? "NOT_NULL" : "IS_NULL",
      };
    }
    if (!values.length) return null;
    return {
      type: "country",
      value: values.length === 1 ? values[0] : values,
      modifier: exclude ? "NOT_EQUALS" : "EQUALS",
    };
  }

  function buildPerformerBrowserAgeCriteria(includeItems, excludeItems) {
    return [
      ...includeItems.map((item) => buildPerformerBrowserAgeCriterion(item, false)),
      ...excludeItems.map((item) => buildPerformerBrowserAgeCriterion(item, true)),
    ].filter(Boolean);
  }

  function buildPerformerBrowserAgeCriterion(item, exclude = false) {
    if (item?.unknownAge) {
      return {
        type: "age",
        modifier: exclude ? "NOT_NULL" : "IS_NULL",
      };
    }
    return buildGenericNumberCriterion("age", item, exclude);
  }

  function buildPerformerRatingCriteria(includeItems, excludeItems) {
    return [
      buildGenericRatingRangeCriterion("rating100", includeItems, false),
      buildGenericRatingRangeCriterion("rating100", excludeItems, true),
    ].filter(Boolean);
  }

  function buildPerformerTagFilterCriteria(includeItems, excludeItems, tagMatchMode = "any") {
    const includeTags = includeItems.map((item) => item?.customTag).filter(Boolean);
    const includeExclusions = includeItems.flatMap((item) => item?.customExcludeTags || []);
    const excludeTags = excludeItems.map((item) => item?.customTag).filter(Boolean);
    const excludeExclusions = excludeItems.flatMap((item) => item?.customExcludeTags || []);
    return [
      includeTags.length ? buildTagListCriterion(includeTags, tagMatchMode === "all" ? "INCLUDES_ALL" : "INCLUDES") : null,
      includeExclusions.length ? buildTagListCriterion(includeExclusions, "EXCLUDES") : null,
      excludeTags.length ? buildTagListCriterion(excludeTags, "EXCLUDES") : null,
      excludeExclusions.length ? buildTagListCriterion(excludeExclusions, "INCLUDES") : null,
    ].filter(Boolean);
  }

  function buildSceneTagFilterCriteria(includeItems, excludeItems, tagMatchMode = "any") {
    const includeTags = includeItems.map((item) => item?.customTag).filter(Boolean);
    const includeExclusions = includeItems.flatMap((item) => item?.customExcludeTags || []);
    const excludeTags = excludeItems.map((item) => item?.customTag).filter(Boolean);
    const excludeExclusions = excludeItems.flatMap((item) => item?.customExcludeTags || []);
    return [
      includeTags.length ? buildTagListCriterion(includeTags, tagMatchMode === "all" ? "INCLUDES_ALL" : "INCLUDES") : null,
      includeExclusions.length ? buildTagListCriterion(includeExclusions, "EXCLUDES") : null,
      excludeTags.length ? buildTagListCriterion(excludeTags, "EXCLUDES") : null,
      excludeExclusions.length ? buildTagListCriterion(excludeExclusions, "INCLUDES") : null,
    ].filter(Boolean);
  }

  function buildSceneRatingFilterCriteria(includeItems, excludeItems) {
    return [
      buildGenericRatingRangeCriterion("rating100", includeItems, false),
      buildGenericRatingRangeCriterion("rating100", excludeItems, true),
    ].filter(Boolean);
  }

  function buildSceneMetricFilterCriteria(metricType, includeItems, excludeItems) {
    return [
      ...includeItems.map((item) => buildMetricCriterion(metricType, item, false)),
      ...excludeItems.map((item) => buildMetricCriterion(metricType, item, true)),
    ].filter(Boolean);
  }

  function buildAgeFilterCriteria(includeItems, excludeItems) {
    return [
      ...includeItems.map((item) => item?.unknownAge || item?.otherAge
        ? buildPerformerCriterion(normalizePerformerFilterItems([item]), "INCLUDES")
        : buildPerformerAgeCriterion(item, false)),
      ...excludeItems.map((item) => item?.unknownAge || item?.otherAge
        ? buildPerformerCriterion(normalizePerformerFilterItems([item]), "EXCLUDES")
        : buildPerformerAgeCriterion(item, true)),
    ].filter(Boolean);
  }

  function normalizePerformerFilterItems(items) {
    const performers = [];
    (items || []).forEach((item) => {
      if (Array.isArray(item?.performers) && item.performers.length) {
        item.performers.forEach((performer) => {
          if (performer?.id) performers.push({ id: String(performer.id), label: String(performer.name || "Performer") });
        });
        return;
      }
      (item?.performerIds || []).forEach((id) => performers.push({ id: String(id), label: String(item?.filterLabel || item?.label || "Performer") }));
    });
    const seen = new Set();
    return performers.filter((performer) => {
      if (!performer.id || seen.has(performer.id)) return false;
      seen.add(performer.id);
      return true;
    });
  }

  function buildPerformerCriterion(items, modifier) {
    if (!items.length) return null;
    return {
      type: "performers",
      value: {
        items: items.map((item) => ({ id: String(item.id), label: String(item.label || "Performer") })),
        excluded: [],
      },
      modifier,
    };
  }

  function buildPerformerAgeCriterion(item, exclude = false) {
    return buildGenericNumberCriterion("performer_age", item, exclude);
  }

  function buildGenericNumberCriterion(type, item, exclude = false) {
    if (!item) return null;
    const min = item.min == null ? null : Number(item.min);
    const max = item.max == null ? null : Number(item.max);
    if (min != null && max != null && min === max) {
      return {
        type,
        value: { value: min },
        modifier: exclude ? "NOT_EQUALS" : "EQUALS",
      };
    }
    if (min != null && max != null) {
      return {
        type,
        value: { value: min, value2: max },
        modifier: exclude ? "NOT_BETWEEN" : "BETWEEN",
      };
    }
    if (min != null) {
      return {
        type,
        value: { value: exclude ? min : Math.max(0, min - 1) },
        modifier: exclude ? "LESS_THAN" : "GREATER_THAN",
      };
    }
    if (max != null) {
      return {
        type,
        value: { value: exclude ? max : max + 1 },
        modifier: exclude ? "GREATER_THAN" : "LESS_THAN",
      };
    }
    return null;
  }

  function buildRatingCriterion(type, item, exclude = false) {
    if (!item || item.otherRating) return null;
    if (item.unknownRating) {
      return {
        type,
        modifier: exclude ? "NOT_NULL" : "IS_NULL",
      };
    }
    const min = item.min == null ? null : Number(item.min);
    const max = item.max == null ? null : Number(item.max);
    if (min != null && max != null && min === max) {
      return {
        type,
        value: { value: getRatingFilterRating100(min) },
        modifier: exclude ? "NOT_EQUALS" : "EQUALS",
      };
    }
    if (min != null && max != null) {
      return {
        type,
        value: {
          value: getRatingFilterRating100(min),
          value2: getRatingFilterRating100(max),
        },
        modifier: exclude ? "NOT_BETWEEN" : "BETWEEN",
      };
    }
    if (min != null) {
      return {
        type,
        value: { value: getRatingFilterRating100(exclude ? min : Math.max(0, min - 0.1)) },
        modifier: exclude ? "LESS_THAN" : "GREATER_THAN",
      };
    }
    if (max != null) {
      return {
        type,
        value: { value: getRatingFilterRating100(exclude ? max : max + 0.1) },
        modifier: exclude ? "GREATER_THAN" : "LESS_THAN",
      };
    }
    return null;
  }

  function buildGenericRatingRangeCriterion(type, items, exclude = false) {
    const selected = (items || []).filter(Boolean);
    const unknown = selected.find((item) => item.unknownRating);
    const rangeItems = selected.filter(isRatingRangeItem);
    if (unknown && !rangeItems.length) return buildRatingCriterion(type, unknown, exclude);
    if (!rangeItems.length) return null;
    const min = Math.min(...rangeItems.map((item) => Number(item.min)));
    const max = Math.max(...rangeItems.map((item) => Number(item.max)));
    return buildRatingCriterion(type, { min, max }, exclude);
  }

  function getRatingFilterRating100(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(Math.max(0, numeric) * 10);
  }

  function buildMetricCriterion(metricType, item, exclude = false) {
    if (!item || item.metricOther || item.metricUnknown) return null;
    if (metricType === "resolution") return buildResolutionCriterion(item, exclude);
    const type = metricType === "duration" ? "duration" : "resolution";
    const multiplier = metricType === "duration" ? 60 : 1;
    const min = item.min == null ? null : Math.round(Number(item.min) * multiplier);
    const max = item.max == null ? null : Math.round(Number(item.max) * multiplier);
    if (min != null && max != null && (min === max || item.exact)) {
      return {
        type,
        value: min,
        modifier: exclude ? "NOT_EQUALS" : "EQUALS",
      };
    }
    if (min != null && max != null) {
      return {
        type,
        value: min,
        value2: Math.max(min, max - 1),
        modifier: exclude ? "NOT_BETWEEN" : "BETWEEN",
      };
    }
    if (min != null) {
      return {
        type,
        value: exclude ? min : Math.max(0, min - 1),
        modifier: exclude ? "LESS_THAN" : "GREATER_THAN",
      };
    }
    if (max != null) {
      return {
        type,
        value: exclude ? Math.max(0, max - 1) : max,
        modifier: exclude ? "GREATER_THAN" : "LESS_THAN",
      };
    }
    return null;
  }

  function buildResolutionCriterion(item, exclude = false) {
    if (!item?.enumValue) return null;
    return {
      type: "resolution",
      value: item.label || item.enumValue,
      modifier: exclude ? "NOT_EQUALS" : "EQUALS",
    };
  }

  function buildDateCriterion(item) {
    return {
      type: "date",
      value: {
        value: item.filterStartDate || item.startDate,
        value2: item.filterEndDate || item.endDate,
      },
      modifier: "BETWEEN",
    };
  }

  function buildOCountCriterion() {
    return {
      type: "o_counter",
      value: 0,
      modifier: "GREATER_THAN",
    };
  }

  function buildRatingNullCriterion() {
    return {
      type: "rating100",
      modifier: "IS_NULL",
    };
  }

  function buildRatingNotNullCriterion() {
    return {
      type: "rating100",
      modifier: "NOT_NULL",
    };
  }

  function buildAttentionCriterion(type) {
    const filterTypes = {
      organized: "organized",
      stashId: "stash_id",
      date: "date",
      performers: "performers",
      studios: "studios",
      country: "country",
      birthdate: "birthdate",
      image: "image",
      scenes: "scenes",
    };
    const filterType = filterTypes[type] || type;
    if (!filterType) return null;
    return {
      type: filterType,
      modifier: "IS_NULL",
    };
  }

  function buildStudioSelectionCriterion(studios) {
    const items = (studios || [])
      .filter((studio) => studio?.id && studio.id !== NO_STUDIO_ID)
      .map((studio) => ({ id: String(studio.id), label: String(studio.name || "Studio") }));
    if (!items.length) return null;
    return {
      type: "studios",
      value: {
        items,
        excluded: [],
        depth: -1,
      },
      modifier: "INCLUDES",
    };
  }

  function makeDashboardScenesUrl(stats, criteria = []) {
    const studio = stats?.studio || {};
    if (studio.id) return makeStudioScenesUrl(studio, criteria);
    const selectedStudios = stats?.loadSummary?.selectedStudios || [];
    const allStudios = state.dashboardStudios || [];
    const shouldScopeToSelection = selectedStudios.length > 0 && selectedStudios.length < allStudios.length;
    return makeStudioScenesUrl(null, [
      ...(shouldScopeToSelection ? [buildStudioSelectionCriterion(selectedStudios)] : []),
      ...criteria,
    ]);
  }

  function makeStudioScenesUrl(studio, criteria = []) {
    const params = new URLSearchParams();
    criteria.filter(Boolean).forEach((criterion) => params.append("c", JSON.stringify(criterion)));
    const query = params.toString();
    if (!studio?.id) return `/scenes${query ? `?${query}` : ""}`;
    return `/studios/${encodeURIComponent(studio.id)}/scenes${query ? `?${query}` : ""}`;
  }

  function makePerformersUrl(criteria = []) {
    const params = new URLSearchParams();
    criteria.filter(Boolean).forEach((criterion) => params.append("c", JSON.stringify(criterion)));
    const query = params.toString();
    return `/performers${query ? `?${query}` : ""}`;
  }

  function renderReleaseTimeline(container, studio, timeline) {
    const items = getTimelineItems(timeline);
    if (!items.length) return;

    const isDashboard = Boolean(container?.closest?.(".studio-dashboard__page-dashboard"));
    const section = isDashboard ? createPageSection(container, "RELEASE TIMELINE") : createSection(container);
    if (!isDashboard) {
      const title = document.createElement("div");
      title.className = "studio-dashboard__section-title";
      title.textContent = "Release timeline";
      section.appendChild(title);
    }

    const chart = document.createElement("div");
    chart.className = "studio-dashboard__timeline";
    chart.style.setProperty("--studio-dashboard-timeline-count", String(items.length));
    const yearGroups = getTimelineYearGroups(items);
    const yearGroupMap = new Map(yearGroups.map((group, index) => [group.year, index]));
    const yearRow = document.createElement("div");
    yearRow.className = "studio-dashboard__timeline-years";
    yearGroups.forEach((group, index) => {
      const year = document.createElement("span");
      year.className = `studio-dashboard__timeline-year ${index % 2 ? "is-alt" : "is-base"}`;
      year.style.gridColumn = `span ${group.span}`;
      year.textContent = group.year;
      yearRow.appendChild(year);
    });
    chart.appendChild(yearRow);

    const barRow = document.createElement("div");
    barRow.className = "studio-dashboard__timeline-bars";
    barRow.style.setProperty("--studio-dashboard-timeline-count", String(items.length));
    items.forEach((item) => {
      const bar = document.createElement("a");
      const groupIndex = yearGroupMap.get(item.year) || 0;
      bar.className = `studio-dashboard__timeline-bar ${groupIndex % 2 ? "is-alt" : "is-base"}`;
      bar.href = makeStudioScenesUrl(studio, [buildDateCriterion(item)]);
      openLinkInNewTab(bar);
      if (!item.count) bar.classList.add("is-empty");
      bar.style.setProperty("--studio-dashboard-bar-value", String(item.count / item.max));
      bar.title = `${item.label}: ${item.count} scene${item.count === 1 ? "" : "s"}`;
      bar.innerHTML = `
        <span class="studio-dashboard__timeline-fill"></span>
        <span class="studio-dashboard__timeline-count">${escapeHtml(item.count)}</span>
        <span class="studio-dashboard__timeline-label">${escapeHtml(item.label)}</span>
      `;
      barRow.appendChild(bar);
    });
    chart.appendChild(barRow);
    section.appendChild(chart);

    const range = document.createElement("div");
    range.className = "studio-dashboard__timeline-range";
    range.textContent = `${items[0].label} - ${items[items.length - 1].label}`;
    section.appendChild(range);
  }

  function renderSceneCard(container, scene, meta) {
    const card = document.createElement("a");
    card.className = "studio-dashboard__scene";
    card.href = `/scenes/${encodeURIComponent(scene.id)}`;
    openLinkInNewTab(card);
    card.innerHTML = `
      <span class="studio-dashboard__scene-media">
        ${scene.screenshot ? `<img src="${escapeHtml(scene.screenshot)}" alt="${escapeHtml(scene.title)}">` : ""}
        ${scene.preview ? `<video src="${escapeHtml(scene.preview)}" muted loop playsinline preload="none"></video>` : ""}
      </span>
      <div class="studio-dashboard__scene-title">${escapeHtml(scene.title)}</div>
      <div class="studio-dashboard__muted studio-dashboard__scene-meta">${formatSceneMeta(meta)}</div>
    `;
    const video = card.querySelector("video");
    if (video instanceof HTMLVideoElement) {
      card.addEventListener("mouseenter", () => {
        video.currentTime = 0;
        video.play().catch(() => {});
      });
      card.addEventListener("mouseleave", () => {
        video.pause();
        video.currentTime = 0;
      });
    }
    container.appendChild(card);
  }

  function formatRating(rating100) {
    const value = Number(rating100 || 0);
    if (!value) return "Unrated";
    return (value / 10).toFixed(1);
  }

  function formatContentRating(rating100) {
    const value = Number(rating100 || 0);
    return value > 0 ? formatRating(value) : "N/A";
  }

  function formatSceneMeta(meta) {
    const text = String(meta || "").trim();
    if (!text) return "";
    if (/^\d+(?:\.\d+)?$/.test(text) || text === "Unrated") {
      return `<span class="studio-dashboard__meta-icon" title="Rating">★</span><strong>${escapeHtml(text)}</strong>`;
    }
    if (/O(?:'s|-count)?$/i.test(text)) {
      const value = text.replace(/\s*O(?:'s|-count)?$/i, "");
      return `<span class="studio-dashboard__meta-icon" title="O's">${O_COUNT_ICON}</span><strong>${escapeHtml(value)}</strong>`;
    }
    return escapeHtml(text);
  }

  function formatDate(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text;
  }

  async function handleHoverEnter(event) {
    const anchor = event.currentTarget;
    if (!(anchor instanceof HTMLElement)) return;
    if (!getDisplayProfile()) return;
    if (
      anchor.dataset.studioDashboardSource === "browser" &&
      !getConfigBoolean(getSetting("a01ShowOnBrowserPages", "showOnBrowserPages"), false)
    ) {
      return;
    }
    const studio = {
      id: anchor.getAttribute("data-studio-dashboard-id"),
      name: anchor.getAttribute("data-studio-dashboard-name"),
    };
    const tooltip = createTooltip(anchor, studio);
    try {
      const stats = await fetchStudioStats(studio);
      if (state.tooltip === tooltip) {
        tooltip.innerHTML = `
          <a class="studio-dashboard__hover-title" href="/studios/${encodeURIComponent(stats.studio.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(stats.studio.name)}</a>
          <div class="studio-dashboard__hover-body"></div>
        `;
        renderStatsInto(tooltip.querySelector(".studio-dashboard__hover-body"), stats);
        positionTooltip(anchor, tooltip);
      }
    } catch (err) {
      console.warn("[StashDashboard] Stats failed", err);
      if (state.tooltip === tooltip) {
        tooltip.innerHTML = `
          <a class="studio-dashboard__hover-title" href="/studios/${encodeURIComponent(studio.id || "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(studio.name || "Studio")}</a>
          <div class="studio-dashboard__status">Could not load studio stats.</div>
        `;
      }
    }
  }

  function handleHoverLeave(event) {
    if (event.relatedTarget instanceof Node && state.tooltip?.contains(event.relatedTarget)) {
      return;
    }
    if (event.currentTarget === state.tooltipAnchor) scheduleTooltipClose();
  }

  function cancelTooltipClose() {
    window.clearTimeout(state.tooltipCloseTimer);
    state.tooltipCloseTimer = 0;
  }

  function scheduleTooltipClose() {
    cancelTooltipClose();
    state.tooltipCloseTimer = window.setTimeout(closeTooltip, 140);
  }

  function closeTooltip() {
    cancelTooltipClose();
    state.tooltip?.remove();
    state.tooltip = null;
    state.tooltipAnchor = null;
  }

  function removeStudioPageDashboard() {
    state.studioPageNav?.remove();
    state.studioPageHost?.remove();
    state.studioPageNav = null;
    state.studioPageHost = null;
    state.studioPageId = "";
  }

  function findStudioPageDashboardMount(studioId) {
    const directRoot = document.querySelector(".studio-tabs");
    const roots = [];
    if (directRoot instanceof HTMLElement) roots.push(directRoot);

    document.querySelectorAll(".nav-tabs").forEach((tabs) => {
      if (!(tabs instanceof HTMLElement)) return;
      const hasStudioLink = Array.from(tabs.querySelectorAll("a[href]")).some((link) => {
        if (!(link instanceof HTMLAnchorElement)) return false;
        return link.pathname.startsWith(`/studios/${studioId}/`) || link.pathname === `/studios/${studioId}`;
      });
      if (!hasStudioLink) return;
      const root = tabs.closest(".studio-tabs") || tabs.parentElement;
      if (root instanceof HTMLElement && !roots.includes(root)) roots.push(root);
    });

    for (const root of roots) {
      const navTabs = root.querySelector(".nav-tabs");
      const tabContent = root.querySelector(".tab-content");
      if (navTabs instanceof HTMLElement && tabContent instanceof HTMLElement) {
        return { navTabs, tabContent };
      }
    }

    return null;
  }

  function setStudioDashboardStatus(panel, message) {
    if (panel instanceof HTMLElement) {
      panel.innerHTML = `<div class="studio-dashboard__status">${escapeHtml(message)}</div>`;
    }
  }

  function activateStudioDashboardTab(nav, panel, mount) {
    mount.navTabs.querySelectorAll(".nav-link").forEach((link) => link.classList.remove("active"));
    mount.tabContent.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.remove("active", "show"));
    nav.classList.add("active");
    panel.classList.add("active", "show");
  }

  function loadStudioPageDashboard(studioId, panel) {
    if (!(panel instanceof HTMLElement) || panel.dataset.studioDashboardLoaded === "true") return;
    const token = ++state.studioPageRenderToken;
    panel.dataset.studioDashboardLoading = "true";
    setStudioDashboardStatus(panel, "Loading studio dashboard...");

    fetchStudioById(studioId)
      .then((studio) => {
        if (!studio?.id) throw new Error("Studio not found");
        return fetchStudioStats(studio, {
          onProgress: (message) => {
            if (state.studioPageHost === panel) setStudioDashboardStatus(panel, message);
          },
        });
      })
      .then((stats) => {
        if (
          token !== state.studioPageRenderToken ||
          state.studioPageId !== studioId ||
          state.studioPageHost !== panel
        ) {
          return;
        }
        panel.dataset.studioDashboardLoaded = "true";
        panel.dataset.studioDashboardLoading = "false";
        renderStudioPageDashboard(panel, stats);
      })
      .catch((err) => {
        console.warn("[StashDashboard] Studio page dashboard failed", err);
        if (state.studioPageHost === panel) {
          panel.dataset.studioDashboardLoading = "false";
          setStudioDashboardStatus(panel, "Could not load studio dashboard.");
        }
      });
  }

  function ensureStudioPageDashboard() {
    const studioId = getStudioPageId();
    if (!studioId) {
      removeStudioPageDashboard();
      return;
    }

    if (
      state.studioPageHost?.isConnected &&
      state.studioPageNav?.isConnected &&
      state.studioPageId === studioId
    ) {
      return;
    }

    const mount = findStudioPageDashboardMount(studioId);
    if (!mount?.navTabs || !mount?.tabContent) return;

    removeStudioPageDashboard();
    const nav = document.createElement("a");
    nav.className = "nav-item nav-link studio-dashboard__dashboard-tab-link";
    nav.href = "#";
    nav.textContent = "Dashboard";
    nav.dataset.rbEventKey = STUDIO_DASHBOARD_TAB_KEY;

    const host = document.createElement("div");
    host.className = "tab-pane fade studio-dashboard__page-dashboard";
    host.dataset.rbEventKey = STUDIO_DASHBOARD_TAB_KEY;
    host.dataset.studioDashboardStudioId = studioId;
    host.innerHTML = `<div class="studio-dashboard__status">Select Dashboard to load studio stats.</div>`;
    mount.navTabs.appendChild(nav);
    mount.tabContent.appendChild(host);
    nav.addEventListener("click", (event) => {
      event.preventDefault();
      activateStudioDashboardTab(nav, host, mount);
      loadStudioPageDashboard(studioId, host);
    });
    mount.navTabs.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest(".nav-link") : null;
      if (!link || link === nav) return;
      nav.classList.remove("active");
      host.classList.remove("active", "show");
    });
    state.studioPageNav = nav;
    state.studioPageHost = host;
    state.studioPageId = studioId;
  }

  function isStashDashboardRoute() {
    return window.location.pathname === DASHBOARD_PATH;
  }

  function ensureStashDashboardNav() {
    if (state.dashboardNav?.isConnected) return;
    const navHost =
      document.querySelector(".navbar-nav") ||
      document.querySelector(".navbar-buttons") ||
      document.querySelector(".navbar");
    if (!(navHost instanceof HTMLElement)) return;

    const nav = document.createElement("a");
    nav.className = "nav-link stash-dashboard__nav-link";
    nav.href = DASHBOARD_PATH;
    nav.target = "_blank";
    nav.rel = "noopener noreferrer";
    nav.innerHTML = `<span class="stash-dashboard__nav-icon" aria-hidden="true"></span><span>Dashboard</span>`;
    nav.addEventListener("click", (event) => {
      event.preventDefault();
      window.open(DASHBOARD_PATH, "_blank", "noopener,noreferrer");
    });
    if (navHost.classList.contains("navbar-nav")) {
      const item = document.createElement("li");
      item.className = "nav-item stash-dashboard__nav-item";
      item.appendChild(nav);
      navHost.appendChild(item);
    } else {
      navHost.appendChild(nav);
    }
    state.dashboardNav = nav;
  }

  function removeStashDashboardRoute() {
    state.dashboardHost?.remove();
    state.dashboardHost = null;
  }

  function setStashDashboardStatus(host, message) {
    if (host instanceof HTMLElement) {
      host.innerHTML = `<div class="studio-dashboard__status">${escapeHtml(message)}</div>`;
    }
  }

  function ensureStashDashboardRoute() {
    if (!isStashDashboardRoute()) {
      removeStashDashboardRoute();
      return;
    }
    if (!state.dashboardHost?.isConnected) {
      const host = document.createElement("main");
      host.className = "stash-dashboard__route";
      document.body.appendChild(host);
      state.dashboardHost = host;
    }
    loadStashDashboardRoute(false);
  }

  function getSelectedDashboardStudios(host) {
    const ids = getSelectedDashboardStudioIds(host);
    return (state.dashboardStudios || []).filter((studio) => ids.has(studio.id));
  }

  function getDirectSelectedDashboardStudioIds(host) {
    return new Set(
      Array.from(host.querySelectorAll(".stash-dashboard__studio-check:checked"))
        .map((input) => String(input.value || ""))
        .filter(Boolean)
    );
  }

  function getSelectedDashboardStudioIds(host) {
    const selectedIds = getDirectSelectedDashboardStudioIds(host);
    return getDashboardIncludeSubStudios() ? expandDashboardStudioIds(selectedIds) : selectedIds;
  }

  function getDashboardStudioMaps(studios = state.dashboardStudios || []) {
    const byId = new Map();
    const childrenByParent = new Map();
    (studios || []).forEach((studio) => {
      if (!studio?.id) return;
      byId.set(studio.id, studio);
      if (!studio.synthetic && studio.parentId) {
        if (!childrenByParent.has(studio.parentId)) childrenByParent.set(studio.parentId, []);
        childrenByParent.get(studio.parentId).push(studio);
      }
    });
    return { byId, childrenByParent };
  }

  function expandDashboardStudioIds(ids, studios = state.dashboardStudios || []) {
    const expanded = new Set(ids || []);
    const { childrenByParent } = getDashboardStudioMaps(studios);
    const queue = Array.from(expanded);
    while (queue.length) {
      const parentId = queue.shift();
      (childrenByParent.get(parentId) || []).forEach((child) => {
        if (expanded.has(child.id)) return;
        expanded.add(child.id);
        queue.push(child.id);
      });
    }
    return expanded;
  }

  function getDashboardStudioDescendantIds(parentId, studios = state.dashboardStudios || []) {
    const descendants = new Set();
    if (!parentId) return descendants;
    const { childrenByParent } = getDashboardStudioMaps(studios);
    const queue = (childrenByParent.get(parentId) || []).slice();
    while (queue.length) {
      const studio = queue.shift();
      if (!studio?.id || descendants.has(studio.id)) continue;
      descendants.add(studio.id);
      queue.push(...(childrenByParent.get(studio.id) || []));
    }
    return descendants;
  }

  function setDashboardStudioCheckboxes(host, ids) {
    host.querySelectorAll(".stash-dashboard__studio-check").forEach((input) => {
      if (input instanceof HTMLInputElement) input.checked = ids.has(String(input.value || ""));
    });
  }

  function getCachedDashboardStudioIdSet() {
    return new Set(Array.from(state.dashboardLoadedStudioIds || []).map(String).filter(Boolean));
  }

  function getPresetTargetStudioIds(studioIds, cachedIds = getCachedDashboardStudioIdSet()) {
    const directIds = new Set((studioIds || []).map(String).filter((id) => cachedIds.has(id)));
    if (!getDashboardIncludeSubStudios()) return directIds;
    return new Set(Array.from(expandDashboardStudioIds(directIds)).filter((id) => cachedIds.has(id)));
  }

  function setDashboardDescendantCheckboxes(host, studioId, checked) {
    const descendantIds = getDashboardStudioDescendantIds(studioId);
    host.querySelectorAll(".stash-dashboard__studio-check").forEach((input) => {
      if (input instanceof HTMLInputElement && descendantIds.has(String(input.value || ""))) {
        input.checked = checked;
      }
    });
  }

  function syncDashboardSubStudioCheckboxes(host) {
    if (!getDashboardIncludeSubStudios()) return;
    setDashboardStudioCheckboxes(host, expandDashboardStudioIds(getDirectSelectedDashboardStudioIds(host)));
  }

  function getStudioGroupKey(name) {
    const first = String(name || "").trim().charAt(0).toUpperCase();
    if (!first) return "#";
    if (/^[A-Z]$/.test(first)) return first;
    if (/^[0-9]$/.test(first)) return "#";
    return "#";
  }

  function studioMatchesDashboardSearch(studio, query) {
    if (!query) return true;
    return [studio?.name, studio?.parentName]
      .map((value) => String(value || "").toLowerCase())
      .some((value) => value.includes(query));
  }

  function createDashboardStudioGroups(studios, query) {
    const sourceStudios = getDashboardShowCachedStudiosOnly()
      ? (studios || []).filter((studio) => state.dashboardLoadedStudioIds.has(studio.id))
      : studios;
    return getDashboardStudioListGrouping() === "parent"
      ? createDashboardParentStudioGroups(sourceStudios, query)
      : createDashboardAlphabeticalStudioGroups(sourceStudios, query);
  }

  function createDashboardAlphabeticalStudioGroups(studios, query) {
    const groups = new Map();
    (studios || []).filter((studio) => studioMatchesDashboardSearch(studio, query)).forEach((studio) => {
      const key = getStudioGroupKey(studio.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(studio);
    });
    const sortedKeys = Array.from(groups.keys()).sort((left, right) => {
      if (left === "#") return -1;
      if (right === "#") return 1;
      return left.localeCompare(right);
    });
    return sortedKeys.map((key) => ({ key, title: key, studios: sortDashboardStudios(groups.get(key)) }));
  }

  function createDashboardParentStudioGroups(studios, query) {
    const { byId, childrenByParent } = getDashboardStudioMaps(studios);
    const parentIds = new Set(childrenByParent.keys());
    const namedGroups = new Map();
    const noParent = [];
    (studios || []).forEach((studio) => {
      if (!studio?.id) return;
      const hasChildren = parentIds.has(studio.id);
      const parentStudio = studio.parentId ? byId.get(studio.parentId) : null;
      const includeBySearch = studioMatchesDashboardSearch(studio, query);
      const children = childrenByParent.get(studio.id) || [];
      const matchingChildren = children.filter((child) => studioMatchesDashboardSearch(child, query));
      if (hasChildren) {
        const childRows = !query || includeBySearch ? children : matchingChildren;
        const rows = [studio, ...childRows.filter((child) => child.id !== studio.id)];
        if (!query || includeBySearch || matchingChildren.length) {
          namedGroups.set(studio.id, {
            key: studio.id,
            title: studio.name,
            studios: sortDashboardStudios(rows, studio.id),
          });
        }
      } else if (parentStudio) {
        if (includeBySearch || studioMatchesDashboardSearch(parentStudio, query)) {
          if (!namedGroups.has(parentStudio.id)) {
            namedGroups.set(parentStudio.id, {
              key: parentStudio.id,
              title: parentStudio.name,
              studios: parentIds.has(parentStudio.id) ? [parentStudio] : [],
            });
          }
          const group = namedGroups.get(parentStudio.id);
          if (!group.studios.some((item) => item.id === studio.id)) group.studios.push(studio);
        }
      } else if (studio.parentId) {
        const parentKey = `missing:${studio.parentId}`;
        if (!namedGroups.has(parentKey)) {
          namedGroups.set(parentKey, {
            key: parentKey,
            title: studio.parentName || "Unknown parent studio",
            studios: [],
          });
        }
        namedGroups.get(parentKey).studios.push(studio);
      } else if (includeBySearch) {
        noParent.push(studio);
      }
    });
    const parentGroups = Array.from(namedGroups.values())
      .map((group) => ({
        ...group,
        studios: sortDashboardStudios(group.studios, group.key),
      }))
      .filter((group) => group.studios.length)
      .sort((left, right) => left.title.localeCompare(right.title));
    const groups = [];
    if (noParent.length) {
      groups.push({ key: "__no_parent__", title: "No parent studio", studios: sortDashboardStudios(noParent) });
    }
    groups.push(...parentGroups);
    return groups;
  }

  function sortDashboardStudios(studios, parentId = "") {
    return (studios || []).slice().sort((left, right) => {
      if (parentId && left.id === parentId) return -1;
      if (parentId && right.id === parentId) return 1;
      if (left.synthetic && !right.synthetic) return -1;
      if (!left.synthetic && right.synthetic) return 1;
      return String(left.name || "").localeCompare(String(right.name || ""));
    });
  }

  function renderDashboardStudioList(host, studios) {
    const list = host.querySelector(".stash-dashboard__studio-list");
    const loadButton = host.querySelector(".stash-dashboard__load-selected");
    if (!(list instanceof HTMLElement)) return;
    const directSelectedIds = getDirectSelectedDashboardStudioIds(host);
    const includeSubs = getDashboardIncludeSubStudios();
    const selectedIds = includeSubs ? expandDashboardStudioIds(directSelectedIds, studios) : directSelectedIds;
    const searchInput = host.querySelector(".stash-dashboard__studio-search");
    const query = searchInput instanceof HTMLInputElement ? searchInput.value.trim().toLowerCase() : "";
    const groups = createDashboardStudioGroups(studios, query);
    if (!studios.length) {
      list.innerHTML = `<div class="studio-dashboard__status">No studios found.</div>`;
      if (loadButton instanceof HTMLButtonElement) loadButton.disabled = true;
      return;
    }
    if (!groups.length) {
      list.innerHTML = `<div class="studio-dashboard__status">${getDashboardShowCachedStudiosOnly() ? "No cached studios match." : "No studios match the search."}</div>`;
      if (loadButton instanceof HTMLButtonElement) loadButton.disabled = true;
      return;
    }
    const { childrenByParent } = getDashboardStudioMaps(studios);
    list.innerHTML = groups.map((group, index) => `
      <section class="stash-dashboard__studio-group ${index % 2 ? "is-alt" : "is-base"}">
        <div class="stash-dashboard__studio-group-title">${escapeHtml(group.title)}</div>
        <div class="stash-dashboard__studio-group-grid">
          ${group.studios.map((studio) => {
            const descendantCount = countDashboardStudioDescendants(studio.id, childrenByParent);
            return `
            <label class="stash-dashboard__studio-row ${state.dashboardLoadedStudioIds.has(studio.id) ? "is-cached" : ""}">
              <input class="stash-dashboard__studio-check" type="checkbox" value="${escapeHtml(studio.id)}"${selectedIds.has(studio.id) ? " checked" : ""}>
              <span>${escapeHtml(studio.name)}</span>
              ${includeSubs && descendantCount ? `<small>+${descendantCount}</small>` : ""}
            </label>
          `;
          }).join("")}
        </div>
      </section>
    `).join("");
    if (loadButton instanceof HTMLButtonElement) loadButton.disabled = false;
  }

  function refreshDashboardPicker(host) {
    renderDashboardStudioList(host, state.dashboardStudios || []);
    renderDashboardPresetList(host);
  }

  function renderDashboardPresetList(host) {
    const list = host.querySelector(".stash-dashboard__preset-list");
    if (!(list instanceof HTMLElement)) return;
    const presets = getDashboardFilterPresets();
    if (!presets.length) {
      list.innerHTML = `<div class="stash-dashboard__preset-empty">No presets yet.</div>`;
      return;
    }
    const cachedIds = getCachedDashboardStudioIdSet();
    const selectedIds = getDirectSelectedDashboardStudioIds(host);
    list.innerHTML = presets.map((preset) => {
      const availablePresetIds = preset.studioIds.filter((id) => cachedIds.has(id));
      const availableCount = availablePresetIds.length;
      const targetIds = getPresetTargetStudioIds(availablePresetIds, cachedIds);
      const isActive = availableCount > 0 && Array.from(targetIds).every((id) => selectedIds.has(id));
      return `
        <div class="stash-dashboard__preset-row ${isActive ? "is-active" : ""}" data-preset-id="${escapeHtml(preset.id)}">
          <button type="button" class="stash-dashboard__preset-apply" title="${isActive ? "Remove preset studios" : "Apply preset"}">
            <span>${escapeHtml(preset.name)}</span>
            <small>${escapeHtml(availableCount)} / ${escapeHtml(preset.studioIds.length)} available${isActive ? " - selected" : ""}</small>
          </button>
          <button type="button" class="stash-dashboard__preset-delete" title="Delete preset" aria-label="Delete ${escapeHtml(preset.name)}">x</button>
        </div>
      `;
    }).join("");
  }

  function applyDashboardFilterPreset(host, preset, content) {
    if (!preset) return;
    const searchInput = host.querySelector(".stash-dashboard__studio-search");
    if (searchInput instanceof HTMLInputElement && searchInput.value) {
      searchInput.value = "";
      refreshDashboardPicker(host);
    }
    const cachedIds = getCachedDashboardStudioIdSet();
    const presetIds = new Set(preset.studioIds.filter((id) => cachedIds.has(id)));
    const targetIds = getPresetTargetStudioIds(presetIds, cachedIds);
    const currentIds = getDirectSelectedDashboardStudioIds(host);
    const isApplied = presetIds.size > 0 && Array.from(targetIds).every((id) => currentIds.has(id));
    if (isApplied) {
      targetIds.forEach((id) => currentIds.delete(id));
    } else {
      targetIds.forEach((id) => currentIds.add(id));
    }
    setDashboardStudioCheckboxes(host, currentIds);
    if (getDashboardIncludeSubStudios()) syncDashboardSubStudioCheckboxes(host);
    renderDashboardPresetList(host);
    const skipped = preset.studioIds.length - presetIds.size;
    const prefix = skipped > 0
      ? `${isApplied ? "Removed" : "Applied"} preset "${preset.name}" (${skipped} unavailable skipped). `
      : `${isApplied ? "Removed" : "Applied"} preset "${preset.name}". `;
    renderCachedDashboardView(host, content, prefix).catch((err) => console.warn("[StashDashboard] Preset filter failed", err));
  }

  function countDashboardStudioDescendants(parentId, childrenByParent) {
    if (!parentId) return 0;
    let count = 0;
    const seen = new Set([parentId]);
    const queue = (childrenByParent.get(parentId) || []).slice();
    while (queue.length) {
      const studio = queue.shift();
      if (!studio?.id || seen.has(studio.id)) continue;
      seen.add(studio.id);
      count += 1;
      queue.push(...(childrenByParent.get(studio.id) || []));
    }
    return count;
  }

  function renderDashboardLoadNote(content, stats) {
    const summary = stats?.loadSummary || {};
    if (!(summary.limited || summary.skippedScenes || summary.failedStudios?.length)) return;
    const note = document.createElement("div");
    note.className = "stash-dashboard__load-note";
    const parts = [];
    if (summary.limited) {
      parts.push(`Loaded ${summary.loadedScenes} of ${summary.totalScenes} scenes for this dashboard scope. Load smaller studio selections if you need more complete detail for very large libraries.`);
    }
    if (summary.skippedScenes) {
      parts.push(`Skipped ${summary.skippedScenes} scene${summary.skippedScenes === 1 ? "" : "s"} that failed dashboard loading.`);
    }
    if (summary.failedStudios?.length) {
      parts.push(`Failed studio chunks: ${summary.failedStudios.slice(0, 5).join(", ")}${summary.failedStudios.length > 5 ? "..." : ""}.`);
    }
    note.textContent = parts.join(" ");
    content.prepend(note);
  }

  function getCachedDashboardStudios() {
    return (state.dashboardStudios || []).filter((studio) => state.dashboardLoadedStudioIds.has(studio.id));
  }

  function getDashboardFilterStudios(host) {
    const selected = getSelectedDashboardStudios(host).filter((studio) => state.dashboardLoadedStudioIds.has(studio.id));
    return selected.length ? selected : getCachedDashboardStudios();
  }

  function getDashboardSearchQuery(host) {
    const input = host?.querySelector?.(".stash-dashboard__dashboard-search");
    return input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : "";
  }

  function applyDashboardSearch(host) {
    const content = host?.querySelector?.(".stash-dashboard__content, .studio-dashboard__page-dashboard");
    if (!(content instanceof HTMLElement)) return;
    const query = getDashboardSearchQuery(host);
    const dashboard = content.matches(".studio-dashboard__page-dashboard")
      ? content
      : content.querySelector(".studio-dashboard__page-dashboard");
    if (!(dashboard instanceof HTMLElement)) return;
    const matches = query
      ? Array.from(dashboard.querySelectorAll(DASHBOARD_FIND_SELECTOR))
        .filter((item) => item instanceof HTMLElement && item.textContent.toLowerCase().includes(query))
      : [];
    host.stashDashboardFindMatches = matches;
    const activeIndex = matches.length ? Math.min(Math.max(Number(host.stashDashboardFindIndex || 0), 0), matches.length - 1) : -1;
    host.stashDashboardFindIndex = activeIndex;
    updateDashboardFindUi(host);
    setDashboardFindActive(host, activeIndex, { scroll: Boolean(query && matches.length) });
  }

  function updateDashboardFindUi(host) {
    const matches = Array.isArray(host?.stashDashboardFindMatches) ? host.stashDashboardFindMatches : [];
    const index = Number(host?.stashDashboardFindIndex ?? -1);
    const count = host?.querySelector?.(".stash-dashboard__dashboard-search-count");
    if (count instanceof HTMLElement) {
      count.textContent = matches.length ? `${index + 1} / ${matches.length}` : "0 results";
    }
    host?.querySelector?.(".stash-dashboard__header")?.classList.toggle("is-searching", Boolean(getDashboardSearchQuery(host)));
    host?.querySelectorAll?.(".stash-dashboard__dashboard-search-nav").forEach((button) => {
      if (button instanceof HTMLButtonElement) button.disabled = !matches.length;
    });
  }

  function setDashboardFindActive(host, index, options = {}) {
    host?.querySelectorAll?.(".stash-dashboard__find-active").forEach((item) => item.classList.remove("stash-dashboard__find-active"));
    const matches = Array.isArray(host?.stashDashboardFindMatches) ? host.stashDashboardFindMatches : [];
    const active = matches[index];
    if (!(active instanceof HTMLElement)) return;
    active.classList.add("stash-dashboard__find-active");
    const section = active.closest(".studio-dashboard__page-section.is-collapsed");
    if (section instanceof HTMLElement) {
      section.classList.remove("is-collapsed");
      section.querySelector(".studio-dashboard__page-section-header")?.setAttribute("aria-expanded", "true");
      const toggle = section.querySelector(".studio-dashboard__page-section-toggle");
      if (toggle instanceof HTMLElement) toggle.textContent = "Collapse";
    }
    if (options.scroll) {
      active.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }

  function stepDashboardFind(host, direction) {
    const matches = Array.isArray(host?.stashDashboardFindMatches) ? host.stashDashboardFindMatches : [];
    if (!matches.length) return;
    const current = Number(host.stashDashboardFindIndex ?? 0);
    const next = (current + direction + matches.length) % matches.length;
    host.stashDashboardFindIndex = next;
    updateDashboardFindUi(host);
    setDashboardFindActive(host, next, { scroll: true });
  }

  async function renderCachedDashboardView(host, content, messagePrefix = "") {
    const studios = getDashboardFilterStudios(host);
    if (!studios.length) {
      setStashDashboardStatus(content, "No cached studios loaded yet.");
      return;
    }
    const stats = await buildStashStatsFromCachedStudios(studios);
    if (!isStashDashboardRoute()) return;
    renderStudioPageDashboard(content, stats);
    renderDashboardLoadNote(content, stats);
    const summary = document.createElement("div");
    summary.className = "stash-dashboard__filter-note";
    const selectedCount = getSelectedDashboardStudios(host).filter((studio) => state.dashboardLoadedStudioIds.has(studio.id)).length;
    summary.textContent = `${messagePrefix}${selectedCount ? `Filtered to ${selectedCount}` : "Showing all"} cached studio${studios.length === 1 ? "" : "s"} (${studios.length} loaded).`;
    content.prepend(summary);
    applyDashboardSearch(host);
  }

  function loadStashDashboardRoute(forceRefresh = false) {
    const host = state.dashboardHost;
    if (!(host instanceof HTMLElement)) return;
    if (!forceRefresh && host.dataset.stashDashboardShell === "true") return;
    state.dashboardRenderToken += 1;
    if (forceRefresh) {
      state.statsCache.clear();
    }
    host.dataset.stashDashboardLoaded = "false";
    host.dataset.stashDashboardShell = "true";
    host.innerHTML = `
      <section class="stash-dashboard__shell">
        <header class="stash-dashboard__header">
          <div class="stash-dashboard__header-main">
            <h2>Stash Dashboard</h2>
            <div class="stash-dashboard__dashboard-search-wrap">
              <input class="form-control stash-dashboard__dashboard-search" type="search" placeholder="Find in dashboard..." aria-label="Find in dashboard">
              <span class="stash-dashboard__dashboard-search-count">0 results</span>
              <button type="button" class="btn btn-secondary stash-dashboard__dashboard-search-nav" data-dashboard-find-step="-1" disabled aria-label="Previous result">‹</button>
              <button type="button" class="btn btn-secondary stash-dashboard__dashboard-search-nav" data-dashboard-find-step="1" disabled aria-label="Next result">›</button>
            </div>
          </div>
          <div class="stash-dashboard__header-actions">
            <button type="button" class="btn btn-primary stash-dashboard__check-changes">Check changes</button>
            <button type="button" class="btn btn-secondary stash-dashboard__refresh">Clear cache</button>
            <button type="button" class="btn btn-secondary stash-dashboard__export-settings">Export settings</button>
            <button type="button" class="btn btn-secondary stash-dashboard__import-settings">Import settings</button>
            <input class="stash-dashboard__import-settings-input" type="file" accept="application/json,.json" hidden>
          </div>
        </header>
        <details class="stash-dashboard__controls" open>
          <summary class="stash-dashboard__controls-summary">
            <span>Studio Cache & Filters</span>
            <span class="stash-dashboard__controls-hint">collapse</span>
          </summary>
          <div class="stash-dashboard__controls-body">
            <div class="stash-dashboard__picker-options">
              <label class="stash-dashboard__picker-option">
                <span>Group studios</span>
                <select class="form-control stash-dashboard__studio-grouping">
                  <option value="alphabetical">Alphabetical</option>
                  <option value="parent">Parent studio</option>
                </select>
              </label>
              <label class="stash-dashboard__picker-option stash-dashboard__picker-option--check">
                <input class="stash-dashboard__include-sub-studios" type="checkbox">
                <span>Include sub-studios</span>
              </label>
            </div>
            <div class="stash-dashboard__control-actions">
              <button type="button" class="btn btn-secondary stash-dashboard__select-all" disabled>Select all</button>
              <button type="button" class="btn btn-secondary stash-dashboard__select-none" disabled>Clear selection</button>
              <button type="button" class="btn btn-secondary stash-dashboard__select-cached" disabled>Select cached</button>
              <button type="button" class="btn btn-secondary stash-dashboard__show-cached-only" disabled>Cached only</button>
              <input class="form-control stash-dashboard__studio-search" type="search" placeholder="Search studios..." disabled>
              <span class="stash-dashboard__control-spacer"></span>
              <button type="button" class="btn btn-primary stash-dashboard__load-studios">Load studio list</button>
              <button type="button" class="btn btn-success stash-dashboard__load-selected" disabled>Load selected studios</button>
            </div>
            <div class="stash-dashboard__picker-layout">
              <div class="stash-dashboard__studio-list">
                <div class="studio-dashboard__status">No data loaded. Load the studio list, choose studios, then build the dashboard.</div>
              </div>
              <aside class="stash-dashboard__preset-panel">
                <div class="stash-dashboard__preset-header">
                  <span>Presets</span>
                  <button type="button" class="btn btn-secondary stash-dashboard__create-preset">Create</button>
                </div>
                <div class="stash-dashboard__preset-list"></div>
              </aside>
            </div>
          </div>
        </details>
        <div class="stash-dashboard__content">
          <div class="studio-dashboard__status">Dashboard output will appear here after loading selected studios.</div>
        </div>
      </section>
    `;
    const content = host.querySelector(".stash-dashboard__content");
    const loadStudiosButton = host.querySelector(".stash-dashboard__load-studios");
    const selectAllButton = host.querySelector(".stash-dashboard__select-all");
    const selectNoneButton = host.querySelector(".stash-dashboard__select-none");
    const selectCachedButton = host.querySelector(".stash-dashboard__select-cached");
    const showCachedOnlyButton = host.querySelector(".stash-dashboard__show-cached-only");
    const loadSelectedButton = host.querySelector(".stash-dashboard__load-selected");
    const checkChangesButton = host.querySelector(".stash-dashboard__check-changes");
    const studioSearchInput = host.querySelector(".stash-dashboard__studio-search");
    const dashboardSearchInput = host.querySelector(".stash-dashboard__dashboard-search");
    const importSettingsInput = host.querySelector(".stash-dashboard__import-settings-input");
    const studioGroupingSelect = host.querySelector(".stash-dashboard__studio-grouping");
    const includeSubStudiosInput = host.querySelector(".stash-dashboard__include-sub-studios");
    const createPresetButton = host.querySelector(".stash-dashboard__create-preset");
    if (studioGroupingSelect instanceof HTMLSelectElement) {
      studioGroupingSelect.value = getDashboardStudioListGrouping();
    }
    if (includeSubStudiosInput instanceof HTMLInputElement) {
      includeSubStudiosInput.checked = getDashboardIncludeSubStudios();
    }
    if (showCachedOnlyButton instanceof HTMLElement) {
      showCachedOnlyButton.classList.toggle("is-active", getDashboardShowCachedStudiosOnly());
    }
    renderDashboardPresetList(host);
    const loadStudioList = async () => {
      loadStudiosButton.disabled = true;
      setStashDashboardStatus(content, "Loading studio list...");
      try {
        state.dashboardStudios = (await fetchAllStudiosForDashboard()).filter(studioMatchesDashboardFilters);
        const hydrated = await hydratePersistentDashboardCacheForStudios(state.dashboardStudios);
        refreshDashboardPicker(host);
        selectAllButton.disabled = false;
        selectNoneButton.disabled = false;
        if (selectCachedButton instanceof HTMLButtonElement) selectCachedButton.disabled = false;
        if (showCachedOnlyButton instanceof HTMLButtonElement) showCachedOnlyButton.disabled = false;
        if (studioSearchInput instanceof HTMLInputElement) studioSearchInput.disabled = false;
        setStashDashboardStatus(
          content,
          hydrated
            ? `Choose studios to filter the dashboard. Restored ${hydrated} cached studio${hydrated === 1 ? "" : "s"}.`
            : "Choose studios to filter the dashboard. Loading selected studios adds them to the dashboard cache."
        );
        if (hydrated) {
          await renderCachedDashboardView(host, content, "Restored cache. ");
        }
        return state.dashboardStudios;
      } catch (err) {
        console.warn("[StashDashboard] Studio list failed", err);
        setStashDashboardStatus(content, `Could not load studio list: ${err?.message || err}`);
        return [];
      } finally {
        loadStudiosButton.disabled = false;
      }
    };
    const loadStudiosToCache = async (studios) => {
      if (!studios.length) {
        setStashDashboardStatus(content, "Select at least one studio first.");
        return;
      }
      loadSelectedButton.disabled = true;
      const loadToken = ++state.dashboardRenderToken;
      try {
        await fetchStashStatsForStudios(studios, (message) => setStashDashboardStatus(content, message));
        if (loadToken !== state.dashboardRenderToken || !isStashDashboardRoute()) return;
        host.dataset.stashDashboardLoaded = "true";
        refreshDashboardPicker(host);
        await renderCachedDashboardView(host, content, "Cache refreshed. ");
      } catch (err) {
        console.warn("[StashDashboard] Selected dashboard load failed", err);
        setStashDashboardStatus(content, "Could not load selected studios.");
      } finally {
        loadSelectedButton.disabled = false;
      }
    };
    host.querySelector(".stash-dashboard__refresh")?.addEventListener("click", () => {
      state.statsCache.clear();
      state.dashboardLoadedStudioIds.clear();
      state.dashboardFailedStudioNames = [];
      state.dashboardStudioSceneCounts.clear();
      state.dashboardStudioUpdatedAt.clear();
      state.dashboardStudioPerformerUpdatedAt.clear();
      state.dashboardTagUpdatedAt = "";
      clearPersistentDashboardCache().catch((err) => console.warn("[StashDashboard] Persistent cache clear failed", err));
      refreshDashboardPicker(host);
      setStashDashboardStatus(content, "Dashboard cache cleared.");
    });
    host.querySelector(".stash-dashboard__export-settings")?.addEventListener("click", () => {
      exportDashboardSettings();
    });
    host.querySelector(".stash-dashboard__import-settings")?.addEventListener("click", () => {
      if (importSettingsInput instanceof HTMLInputElement) importSettingsInput.click();
    });
    importSettingsInput?.addEventListener("change", async () => {
      if (!(importSettingsInput instanceof HTMLInputElement)) return;
      const file = importSettingsInput.files?.[0];
      importSettingsInput.value = "";
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        const settings = normalizeImportedDashboardSettings(payload);
        if (!settings) throw new Error("The selected file does not look like Stash Dashboard settings.");
        await saveConfig(settings);
        importDashboardPreferences(payload);
        if (studioGroupingSelect instanceof HTMLSelectElement) studioGroupingSelect.value = getDashboardStudioListGrouping();
        if (includeSubStudiosInput instanceof HTMLInputElement) includeSubStudiosInput.checked = getDashboardIncludeSubStudios();
        if (showCachedOnlyButton instanceof HTMLElement) showCachedOnlyButton.classList.toggle("is-active", getDashboardShowCachedStudiosOnly());
        refreshDashboardPicker(host);
        setStashDashboardStatus(content, "Settings imported. Re-open plugin settings if you want to inspect the imported values.");
        await renderCachedDashboardView(host, content, "Settings imported. ");
      } catch (err) {
        console.warn("[StashDashboard] Settings import failed", err);
        setStashDashboardStatus(content, `Could not import settings: ${err?.message || err}`);
      }
    });
    checkChangesButton?.addEventListener("click", async () => {
      const cachedStudios = getCachedDashboardStudios();
      if (!cachedStudios.length) {
        setStashDashboardStatus(content, "No cached studios to check yet.");
        return;
      }
      checkChangesButton.disabled = true;
      try {
        const changedStudios = await findChangedCachedStudios((message) => setStashDashboardStatus(content, message));
        if (!changedStudios.length) {
          await renderCachedDashboardView(host, content, "No changed cached studios found. ");
          return;
        }
        changedStudios.forEach((studio) => {
          state.statsCache.delete(getDashboardStudioScopeCacheKey(studio));
          deletePersistentDashboardScope(getDashboardStudioScopeCacheKey(studio)).catch((err) => console.warn("[StashDashboard] Persistent cache delete failed", err));
          state.dashboardLoadedStudioIds.delete(studio.id);
          state.dashboardStudioSceneCounts.delete(studio.id);
          state.dashboardStudioUpdatedAt.delete(studio.id);
          state.dashboardStudioPerformerUpdatedAt.delete(studio.id);
        });
        await loadStudiosToCache(changedStudios);
      } catch (err) {
        console.warn("[StashDashboard] Change check failed", err);
        setStashDashboardStatus(content, `Could not check changed content: ${err?.message || err}`);
      } finally {
        checkChangesButton.disabled = false;
      }
    });
    loadStudiosButton?.addEventListener("click", async () => {
      await loadStudioList();
    });
    selectAllButton?.addEventListener("click", () => {
      host.querySelectorAll(".stash-dashboard__studio-check").forEach((input) => { input.checked = true; });
      renderDashboardPresetList(host);
      renderCachedDashboardView(host, content).catch((err) => console.warn("[StashDashboard] Cached all filter failed", err));
    });
    selectNoneButton?.addEventListener("click", () => {
      host.querySelectorAll(".stash-dashboard__studio-check").forEach((input) => { input.checked = false; });
      renderDashboardPresetList(host);
      renderCachedDashboardView(host, content).catch((err) => console.warn("[StashDashboard] Cached clear filter failed", err));
    });
    selectCachedButton?.addEventListener("click", () => {
      const cachedIds = new Set(state.dashboardLoadedStudioIds || []);
      if (!cachedIds.size) {
        setStashDashboardStatus(content, "No cached studios loaded yet.");
        return;
      }
      if (studioSearchInput instanceof HTMLInputElement && studioSearchInput.value) {
        studioSearchInput.value = "";
        refreshDashboardPicker(host);
      }
      setDashboardStudioCheckboxes(host, cachedIds);
      renderDashboardPresetList(host);
      setStashDashboardStatus(content, `Selected ${cachedIds.size} cached studio${cachedIds.size === 1 ? "" : "s"}.`);
      renderCachedDashboardView(host, content).catch((err) => console.warn("[StashDashboard] Cached studio selection failed", err));
    });
    showCachedOnlyButton?.addEventListener("click", () => {
      const nextValue = !getDashboardShowCachedStudiosOnly();
      setDashboardShowCachedStudiosOnly(nextValue);
      if (showCachedOnlyButton instanceof HTMLElement) showCachedOnlyButton.classList.toggle("is-active", nextValue);
      refreshDashboardPicker(host);
      setStashDashboardStatus(content, nextValue ? "Showing cached studios only." : "Showing all studios.");
    });
    studioGroupingSelect?.addEventListener("change", () => {
      if (!(studioGroupingSelect instanceof HTMLSelectElement)) return;
      setLocalStorageValue(DASHBOARD_STUDIO_GROUPING_KEY, studioGroupingSelect.value === "parent" ? "parent" : "alphabetical");
      refreshDashboardPicker(host);
      renderCachedDashboardView(host, content).catch((err) => console.warn("[StashDashboard] Studio grouping refresh failed", err));
    });
    includeSubStudiosInput?.addEventListener("change", () => {
      if (!(includeSubStudiosInput instanceof HTMLInputElement)) return;
      setLocalStorageValue(DASHBOARD_INCLUDE_SUB_STUDIOS_KEY, includeSubStudiosInput.checked ? "true" : "false");
      syncDashboardSubStudioCheckboxes(host);
      refreshDashboardPicker(host);
      renderCachedDashboardView(host, content).catch((err) => console.warn("[StashDashboard] Sub-studio refresh failed", err));
    });
    host.addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLInputElement) || !event.target.classList.contains("stash-dashboard__studio-check")) return;
      if (getDashboardIncludeSubStudios()) {
        if (!event.target.checked) setDashboardDescendantCheckboxes(host, event.target.value, false);
        syncDashboardSubStudioCheckboxes(host);
      }
      renderDashboardPresetList(host);
      renderCachedDashboardView(host, content).catch((err) => console.warn("[StashDashboard] Cached filter failed", err));
    });
    studioSearchInput?.addEventListener("input", () => {
      refreshDashboardPicker(host);
    });
    createPresetButton?.addEventListener("click", () => {
      const selectedIds = Array.from(minimizeDashboardStudioSelection(getDirectSelectedDashboardStudioIds(host)));
      if (!selectedIds.length) {
        setStashDashboardStatus(content, "Select at least one studio before creating a preset.");
        return;
      }
      const name = window.prompt("Name this dashboard preset:");
      if (!name) return;
      const preset = addDashboardFilterPreset(name, selectedIds);
      if (!preset) {
        setStashDashboardStatus(content, "Could not create preset.");
        return;
      }
      renderDashboardPresetList(host);
      setStashDashboardStatus(content, `Preset "${preset.name}" saved with ${preset.studioIds.length} studio${preset.studioIds.length === 1 ? "" : "s"}.`);
    });
    host.addEventListener("click", (event) => {
      const deleteButton = event.target instanceof Element ? event.target.closest(".stash-dashboard__preset-delete") : null;
      if (deleteButton) {
        const row = deleteButton.closest(".stash-dashboard__preset-row");
        const presetId = row?.getAttribute("data-preset-id") || "";
        deleteDashboardFilterPreset(presetId);
        renderDashboardPresetList(host);
        setStashDashboardStatus(content, "Preset deleted.");
        return;
      }
      const applyButton = event.target instanceof Element ? event.target.closest(".stash-dashboard__preset-apply") : null;
      if (applyButton) {
        const row = applyButton.closest(".stash-dashboard__preset-row");
        const presetId = row?.getAttribute("data-preset-id") || "";
        const preset = getDashboardFilterPresets().find((item) => item.id === presetId);
        applyDashboardFilterPreset(host, preset, content);
      }
    });
    dashboardSearchInput?.addEventListener("input", () => {
      applyDashboardSearch(host);
    });
    dashboardSearchInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      stepDashboardFind(host, event.shiftKey ? -1 : 1);
    });
    host.querySelectorAll("[data-dashboard-find-step]").forEach((button) => {
      button.addEventListener("click", () => {
        stepDashboardFind(host, Number(button.dataset.dashboardFindStep || 1));
      });
    });
    loadSelectedButton?.addEventListener("click", async () => {
      await loadStudiosToCache(getSelectedDashboardStudios(host));
    });
    let autoLoadStarted = false;
    [50, 250, 750].forEach((delay) => {
      window.setTimeout(async () => {
        if (autoLoadStarted || !isStashDashboardRoute() || !host.isConnected || host.dataset.stashDashboardShell !== "true") return;
        if (loadStudiosButton instanceof HTMLButtonElement && loadStudiosButton.disabled) return;
        autoLoadStarted = true;
        try {
          const studios = await loadStudioList();
          if (!studios.length) autoLoadStarted = false;
        } catch (err) {
          autoLoadStarted = false;
          console.warn("[StashDashboard] Delayed studio list load failed", err);
        }
      }, delay);
    });
  }

  function enhanceCurrentPage() {
    ensureStashDashboardNav();
    ensureStashDashboardRoute();
  }

  async function refreshPage() {
    const token = ++state.routeToken;
    state.studioPageRenderToken += 1;
    state.dashboardRenderToken += 1;
    closeTooltip();
    await loadConfig();
    if (token !== state.routeToken) return;
    enhanceCurrentPage();
  }

  function scheduleRefresh(delay = 120) {
    window.clearTimeout(state.routeTimer);
    state.routeTimer = window.setTimeout(() => {
      refreshPage().catch((err) => console.warn("[StashDashboard] refresh failed", err));
    }, delay);
  }

  function handleNavigation() {
    if (window.location.pathname === state.lastPath) return;
    state.lastPath = window.location.pathname;
    if (isStashDashboardRoute()) ensureStashDashboardRoute();
    scheduleRefresh();
  }

  function installNavigationHooks() {
    if (window.__stashDashboardHistoryWrapped) return;
    window.__stashDashboardHistoryWrapped = true;
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function () {
      const result = originalPushState.apply(this, arguments);
      window.dispatchEvent(new Event(ROUTE_EVENT));
      return result;
    };
    history.replaceState = function () {
      const result = originalReplaceState.apply(this, arguments);
      window.dispatchEvent(new Event(ROUTE_EVENT));
      return result;
    };
    window.addEventListener("popstate", () => window.dispatchEvent(new Event(ROUTE_EVENT)));
    window.addEventListener(ROUTE_EVENT, handleNavigation);
  }

  function installObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver(() => enhanceCurrentPage());
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    installNavigationHooks();
    installObserver();
    state.lastPath = window.location.pathname;
    scheduleRefresh(0);
    window.addEventListener(
      "scroll",
      () => {
        if (state.tooltip && state.tooltipAnchor) positionTooltip(state.tooltipAnchor, state.tooltip);
      },
      { passive: true }
    );
    window.addEventListener("resize", () => {
      closeTooltip();
      enhanceCurrentPage();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
