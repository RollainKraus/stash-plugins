(function () {
  "use strict";

  const PLUGIN_ID = "StudioDashboard";
  const DASHBOARD_COLLAPSED_SECTIONS_KEY = "StudioDashboard.collapsedSections";
  const DEFAULT_PERFORMER_CARD_ASPECT_RATIO = "2 / 3";
  const POWER_USER_OPTIONS = {
    // Power-user theme hook: change this value if your performer card art uses a custom ratio.
    // performerCardAspectRatio: "1 / 2",
  };
  const ROUTE_EVENT = "studio-dashboard:navigation";
  const TOP_PERFORMER_MAX = 6;
  const TOP_TAG_MAX = 10;
  const TOP_TAG_CATEGORY_MAX = 12;
  const DEMOGRAPHIC_PIE_TOP_COUNTRIES = 10;
  const DEMOGRAPHIC_AGE_GROUP_MAX = 10;
  const DASHBOARD_ROW_CARD_LIMIT = 8;
  const DASHBOARD_SCENE_ROW_LIMIT = 5;
  const NEEDS_ATTENTION_ITEM_LIMIT = 8;
  const STATS_PAGE_SIZE = 250;
  const GRAPHQL_TIMEOUT_MS = 60000;
  const STUDIO_DASHBOARD_TAB_KEY = "studio-dashboard-tab";
  const DEFAULT_DASHBOARD_SECTION_ORDER = [
    "insights",
    "performerHighlights",
    "performersMostScenes",
    "performersMostOs",
    "performersHighestRating",
    "performersHighestRatedScenes",
    "topTags",
    "releaseTimeline",
    "sceneHighlights",
    "topRatedScenes",
    "recentReleases",
    "scenesMostOs",
    "performerDemographics",
    "sceneCharts",
    "needsAttention",
  ];
  const DASHBOARD_SECTION_ALIASES = {
    insight: "insights",
    insights: "insights",
    overview: "insights",
    summary: "insights",
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
    { label: "0-0.9", min: 0, max: 0.9 },
    { label: "1-1.9", min: 1, max: 1.9 },
    { label: "2-2.9", min: 2, max: 2.9 },
    { label: "3-3.9", min: 3, max: 3.9 },
    { label: "4-4.9", min: 4, max: 4.9 },
    { label: "5-5.9", min: 5, max: 5.9 },
    { label: "6-6.9", min: 6, max: 6.9 },
    { label: "7-7.9", min: 7, max: 7.9 },
    { label: "8-8.9", min: 8, max: 8.9 },
    { label: "9-9.9", min: 9, max: 9.9 },
    { label: "10", min: 10, max: 10 },
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
    sceneFileSizeUnavailable: false,
    studioPageNav: null,
    studioPageHost: null,
    studioPageId: "",
    studioPageRenderToken: 0,
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

  function getDashboardSurfaceColor() {
    return getConfigString(getSetting("z05DashboardSurfaceBackgroundColor", "dashboardSurfaceBackgroundColor"), "#000000");
  }

  function getDashboardSurfaceOpacity() {
    return getConfigNumber(getSetting("z06DashboardSurfaceOpacity", "dashboardSurfaceOpacity"), 0.15, 0, 1);
  }

  function getDashboardSectionDefaultState() {
    const value = String(getSetting("a04DashboardSectionDefaultState") ?? "remember").trim().toLowerCase();
    if (["collapsed", "collapse", "closed"].includes(value)) return "collapsed";
    if (["expanded", "expand", "open"].includes(value)) return "expanded";
    return "remember";
  }

  function sanitizeDashboardCssValue(value, fallback) {
    const normalized = String(value || "").trim();
    if (!normalized || /[;{}]/.test(normalized)) return fallback;
    return normalized;
  }

  function getDashboardPerformerCardAspectRatio() {
    return sanitizeDashboardCssValue(
      POWER_USER_OPTIONS.performerCardAspectRatio,
      DEFAULT_PERFORMER_CARD_ASPECT_RATIO
    );
  }

  function getDashboardMaxTagCardWidth() {
    const value = Number(getSetting("z04DashboardMaxTagCardWidth", "z04DashboardTagWidth", "dashboardTagWidth") ?? 250);
    if (!Number.isFinite(value)) return 250;
    return Math.max(120, Math.round(value));
  }

  function normalizeDashboardSectionKey(value) {
    const key = String(value || "").trim().replace(/[\s_-]+/g, "").toLowerCase();
    if (!key) return "";
    return DASHBOARD_SECTION_ALIASES[key] || "";
  }

  function getDashboardSectionOrder() {
    const raw = String(getSetting("a03DashboardSectionOrder", "dashboardSectionOrder") ?? "").trim();
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

  function getResolutionBuckets() {
    const configured = getConfigString(getSetting("e01SceneResolutionGroups", "sceneResolutionGroups"), "");
    const buckets = parseMetricBuckets(configured, { unit: "p" });
    return buckets.length ? buckets : RESOLUTION_BUCKETS;
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

  async function loadConfig() {
    const data = await gql(`
      query StudioDashboardConfig {
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
        query StudioDashboardSceneStudio($id: ID!) {
          findScene(id: $id) {
            id
            studio { id name image_path }
          }
        }
      `,
      image: `
        query StudioDashboardImageStudio($id: ID!) {
          findImage(id: $id) {
            id
            studio { id name image_path }
          }
        }
      `,
      gallery: `
        query StudioDashboardGalleryStudio($id: ID!) {
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
      query StudioDashboardStudio($id: ID!) {
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
      query StudioDashboardAllTags {
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
      console.warn("[StudioDashboard] Top tag categories failed", err);
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
      console.warn("[StudioDashboard] Tag filter hierarchy failed", err);
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

  function buildTagSceneCounts(scenes, filters) {
    const counts = new Map();
    (scenes || []).forEach((scene) => {
      const seen = new Set();
      (scene?.tags || []).forEach((tag) => {
        const id = String(tag?.id || "");
        const name = String(tag?.name || "").trim();
        if (!id || !name || seen.has(id) || !isTagAllowed(tag, filters)) return;
        seen.add(id);
        const existing = counts.get(id) || 0;
        counts.set(id, existing + 1);
      });
    });
    return counts;
  }

  function buildTopTags(scenes, filters, allScenes = []) {
    const counts = new Map();
    const allCounts = buildTagSceneCounts(allScenes, filters);
    (scenes || []).forEach((scene) => {
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
          allCount: 0,
        };
        existing.count += 1;
        existing.allCount = allCounts.get(id) || existing.count;
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

  function buildTopTagGroups(scenes, filters, categories, allScenes = []) {
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
          filters,
          allScenes
        ),
      }))
      .filter((group) => group.tags.length);
  }

  async function hydrateTopTagAllCounts(tags) {
    const tagList = (tags || []).filter((tag) => tag?.id);
    const uniqueTags = Array.from(new Map(tagList.map((tag) => [String(tag.id), tag])).values());
    if (!uniqueTags.length) return;
    const counts = new Map();
    const chunkSize = 20;
    for (let index = 0; index < uniqueTags.length; index += chunkSize) {
      const chunk = uniqueTags.slice(index, index + chunkSize);
      const fields = chunk.map((tag, chunkIndex) => {
        const id = JSON.stringify(String(tag.id));
        return `tag${chunkIndex}: findScenes(scene_filter: { tags: { value: [${id}], modifier: INCLUDES_ALL } }, filter: { per_page: 1 }) { count }`;
      }).join("\n");
      try {
        const data = await gql(`query StudioDashboardTopTagAllCounts { ${fields} }`);
        chunk.forEach((tag, chunkIndex) => {
          const count = Number(data?.[`tag${chunkIndex}`]?.count || 0);
          counts.set(String(tag.id), count || Number(tag.count || 0));
        });
      } catch (err) {
        console.warn("[StudioDashboard] Could not load all-scene tag counts", err);
        chunk.forEach((tag) => {
          counts.set(String(tag.id), Number(tag.count || 0));
        });
      }
    }
    tagList.forEach((tag) => {
      tag.allCount = counts.get(String(tag.id)) || Number(tag.count || 0);
    });
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
            query StudioDashboardPerformerGlobalStats($sceneFilter: SceneFilterType) {
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
        console.warn("[StudioDashboard] Performer global stats failed", performer.id, err);
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

    for (let offset = 0; offset < totalMonths; offset += bucketSize) {
      const start = addMonths(startYear, startMonth, offset);
      const remaining = totalMonths - offset;
      const monthsInBucket = Math.min(bucketSize, remaining);
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
    const buckets = getRatingBuckets();
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
      const rating = rating100 / 10;
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
      console.warn("[StudioDashboard] Custom tag pie failed", err);
      return { total: 0, items: [] };
    }
  }

  function buildCustomTagPieSubchart(performers, allTags, tagRef, index) {
    const group = normalizeCustomPieGroup(tagRef, index);
    const selectedTags = resolveCustomPieSliceTags(allTags, group.value);
    const sliceTags = selectedTags.sort((left, right) => left.name.localeCompare(right.name));
    if (!sliceTags.length) return { title: `Group ${index}`, total: 0, items: [] };
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
      const performerTags = performer?.tags || [];
      const matchingTags = sliceTags.filter((tag) => performerTags.some((performerTag) => String(performerTag?.id || "") === tag.id));
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
      console.warn("[StudioDashboard] Custom scene tag pie failed", err);
      return { total: 0, items: [] };
    }
  }

  function buildCustomSceneTagPieSubchart(scenes, allTags, tagRef, index) {
    const group = normalizeCustomPieGroup(tagRef, index);
    const selectedTags = resolveCustomPieSliceTags(allTags, group.value);
    const sliceTags = selectedTags.sort((left, right) => left.name.localeCompare(right.name));
    if (!sliceTags.length) return { title: `Group ${index}`, total: 0, items: [] };
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
      const sceneTags = scene?.tags || [];
      const matchingTags = sliceTags.filter((tag) => sceneTags.some((sceneTag) => String(sceneTag?.id || "") === tag.id));
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
    return timeline.startMonth === timeline.endMonth
      ? timeline.startMonth
      : `${timeline.startMonth} - ${timeline.endMonth}`;
  }

  function updateTagGridLayout(grid) {
    if (!(grid instanceof HTMLElement)) return;
    const cardCount = grid.querySelectorAll(".studio-dashboard__tag-card").length;
    if (!cardCount) return;
    const width = grid.getBoundingClientRect().width || grid.clientWidth || 0;
    if (width <= 0) {
      window.requestAnimationFrame(() => updateTagGridLayout(grid));
      return;
    }
    const gap = 12;
    const configuredMaxWidth = Number.parseFloat(getComputedStyle(grid).getPropertyValue("--studio-dashboard-tag-max-width")) || 250;
    const maxWidth = Math.max(120, configuredMaxWidth);
    const targetWidth = Math.min(220, maxWidth);
    const minWidth = 140;
    const maxColumns = Math.max(1, Math.min(cardCount, TOP_TAG_MAX));
    let columns = Math.max(1, Math.min(maxColumns, Math.round((width + gap) / (targetWidth + gap))));
    while (columns > 1 && (width - gap * (columns - 1)) / columns < minWidth) columns -= 1;
    grid.style.setProperty("--studio-dashboard-tag-columns", String(columns));
  }

  function observeTagGridLayout(grid) {
    if (!(grid instanceof HTMLElement)) return;
    updateTagGridLayout(grid);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateTagGridLayout(grid));
      observer.observe(grid);
      grid.studioDashboardResizeObserver = observer;
    } else {
      window.addEventListener("resize", () => updateTagGridLayout(grid));
    }
  }

  function syncTagGridAspectRatio(grid, img) {
    if (!(grid instanceof HTMLElement) || !(img instanceof HTMLImageElement)) return;
    if (grid.dataset.tagAspectRatioLocked === "true") return;
    const width = Number(img.naturalWidth || 0);
    const height = Number(img.naturalHeight || 0);
    if (!width || !height) return;
    grid.dataset.tagAspectRatioLocked = "true";
    grid.style.setProperty("--studio-dashboard-tag-aspect-ratio", `${width} / ${height}`);
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
      if (min <= max) return { label: `${formatBucketNumber(min)}-${formatBucketNumber(max)}`, min, max, modifier: "BETWEEN" };
    }
    match = normalized.match(/^(\d{1,2}(?:\.\d+)?)\+$/);
    if (match) return { label: `${formatBucketNumber(Number(match[1]))}+`, min: Number(match[1]), max: null, modifier: "GREATER_THAN" };
    match = normalized.match(/^>=?(\d{1,2}(?:\.\d+)?)$/);
    if (match) return { label: `${formatBucketNumber(Number(match[1]))}+`, min: Number(match[1]), max: null, modifier: "GREATER_THAN" };
    match = normalized.match(/^<=?(\d{1,2}(?:\.\d+)?)$/);
    if (match) return { label: `<=${formatBucketNumber(Number(match[1]))}`, min: null, max: Number(match[1]), modifier: "LESS_THAN" };
    match = normalized.match(/^=?(\d{1,2}(?:\.\d+)?)$/);
    if (match) {
      const exact = Number(match[1]);
      return { label: formatBucketNumber(exact), min: exact, max: exact, modifier: "EQUALS" };
    }
    return null;
  }

  function formatBucketNumber(value) {
    return String(Number(value));
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

  async function fetchStudioStatsUncached(studio, onProgress) {
    const studioId = String(studio?.id || "");
    const getSceneFilesFields = () => `width height duration ${state.sceneFileSizeUnavailable ? "" : "size"}`;
    const fetchInitialPage = () => gql(
      `
        query StudioDashboardStats(
          $sceneFilter: SceneFilterType
          $imageFilter: ImageFilterType
          $galleryFilter: GalleryFilterType
          $page: Int!
          $perPage: Int!
        ) {
          findScenes(scene_filter: $sceneFilter, filter: { page: $page, per_page: $perPage, sort: "date", direction: DESC }) {
            count
            scenes {
              id
              title
              date
              rating100
              o_counter
              organized
              stash_ids { endpoint stash_id }
              performers { id name image_path rating100 country birthdate tags { id name image_path } }
              tags { id name image_path }
              paths { screenshot preview }
              files { ${getSceneFilesFields()} }
            }
          }
          findImages(image_filter: $imageFilter, filter: { per_page: 1 }) {
            count
          }
          findGalleries(gallery_filter: $galleryFilter, filter: { per_page: 1 }) {
            count
          }
        }
      `,
      {
        sceneFilter: studioFilter(studioId),
        imageFilter: studioFilter(studioId),
        galleryFilter: studioFilter(studioId),
        page: 1,
        perPage: STATS_PAGE_SIZE,
      }
    );
    let data;
    try {
      data = await fetchInitialPage();
    } catch (err) {
      if (!state.sceneFileSizeUnavailable && /\bsize\b/i.test(String(err?.message || err))) {
        state.sceneFileSizeUnavailable = true;
        console.warn("[StudioDashboard] Scene file size stats unavailable; retrying without file size.", err);
        data = await fetchInitialPage();
      } else {
        throw err;
      }
    }

    const scenes = data?.findScenes?.scenes || [];
    const sceneCount = Number(data?.findScenes?.count || 0);
    if (onProgress && sceneCount > scenes.length) {
      onProgress(`Loading studio scenes ${scenes.length} / ${sceneCount}...`);
    }
    for (let page = 2; scenes.length < sceneCount; page += 1) {
      const fetchScenePage = () => gql(
        `
          query StudioDashboardSceneStatsPage(
            $sceneFilter: SceneFilterType
            $page: Int!
            $perPage: Int!
          ) {
            findScenes(scene_filter: $sceneFilter, filter: { page: $page, per_page: $perPage, sort: "date", direction: DESC }) {
              scenes {
                id
                title
                date
                rating100
                o_counter
                organized
                stash_ids { endpoint stash_id }
                performers { id name image_path rating100 country birthdate tags { id name image_path } }
                tags { id name image_path }
                paths { screenshot preview }
                files { ${getSceneFilesFields()} }
              }
            }
          }
        `,
        {
          sceneFilter: studioFilter(studioId),
          page,
          perPage: STATS_PAGE_SIZE,
        }
      );
      let pageData;
      try {
        pageData = await fetchScenePage();
      } catch (err) {
        if (!state.sceneFileSizeUnavailable && /\bsize\b/i.test(String(err?.message || err))) {
          state.sceneFileSizeUnavailable = true;
          console.warn("[StudioDashboard] Scene file size stats unavailable; retrying without file size.", err);
          pageData = await fetchScenePage();
        } else {
          throw err;
        }
      }
      const pageScenes = pageData?.findScenes?.scenes || [];
      if (!pageScenes.length) break;
      scenes.push(...pageScenes);
      if (onProgress) {
        onProgress(`Loading studio scenes ${Math.min(scenes.length, sceneCount)} / ${sceneCount}...`);
      }
    }

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
    const sceneRatingDistribution = buildRatingDistribution(scenes, {
      getRating: (scene) => Number(scene?.rating100 || 0),
      getEntity: normalizeSceneSummary,
      entityKey: "scenes",
    });
    const sceneResolutionDistribution = buildResolutionDistribution(scenes);
    const sceneDurationDistribution = buildDurationDistribution(scenes);
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
    const needsAttention = buildNeedsAttention(scenes, performers);

    const topTags = buildTopTags(scenes, tagFilters);
    const topTagGroups = buildTopTagGroups(scenes, tagFilters, topTagCategories);
    await hydrateTopTagAllCounts([...topTags, ...topTagGroups.flatMap((group) => group.tags || [])]);

    const stats = {
      studio,
      counts: {
        scenes: sceneCount,
        images: Number(data?.findImages?.count || 0),
        galleries: Number(data?.findGalleries?.count || 0),
        performers: performerCounts.size,
        oCount,
        oSceneCount: scenes.filter((scene) => Number(scene?.o_counter || 0) > 0).length,
        totalDurationMinutes,
        totalSceneSizeBytes,
        averageRating100,
        ratedScenes: ratedScenes.length,
        unratedScenes: Math.max(0, scenes.length - ratedScenes.length),
      },
      topPerformers,
      performerHighlights,
      performerHighlightRows,
      topTags,
      topTagGroups,
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
        key: "noPerformers",
        label: "No performers",
        target: "scenes",
        criteria: [buildAttentionCriterion("performers")],
        items: sceneList.filter((scene) => !Array.isArray(scene?.performers) || !scene.performers.length).map(normalizeSceneSummary).filter(Boolean),
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
      <a class="studio-dashboard__hover-title" href="/studios/${encodeURIComponent(studio?.id || "")}">${escapeHtml(studio?.name || "Studio")}</a>
      <div class="studio-dashboard__status">Loading studio stats...</div>
    `;
    document.body.appendChild(tooltip);
    tooltip.style.setProperty("--studio-dashboard-performer-card-aspect-ratio", getDashboardPerformerCardAspectRatio());
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
      renderTagCards(section, stats, stats.topTags.slice(0, limits.tags));
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
        makeStudioScenesUrl(stats.studio, [buildOCountCriterion()]),
        `${formatNumber(counts.oSceneCount)} scenes, ${formatInsightPercent(counts.oSceneCount, counts.scenes)}`
      ),
      topOCount ? `top scene: ${formatInsightLink(makeSceneUrl(stats.topOCountScene), formatNumber(topOCount))}` : "",
    ].filter(Boolean).join("; ");
    const averageRating = Number(counts.averageRating100 || 0);
    const ratedDetailHtml = [
      formatInsightLink(makeStudioScenesUrl(stats.studio, [buildRatingNotNullCriterion()]), `${formatNumber(counts.ratedScenes)} rated`),
      formatInsightLink(makeStudioScenesUrl(stats.studio, [buildRatingNullCriterion()]), `${formatNumber(counts.unratedScenes)} unrated`),
    ].join(", ");
    const items = [
      { label: "Scenes", value: formatNumber(counts.scenes), detail: `${formatDurationMinutes(counts.totalDurationMinutes)}; ${formatBytes(counts.totalSceneSizeBytes)}` },
      { label: "Images", value: formatNumber(counts.images), detail: `${formatNumber(counts.galleries)} galleries` },
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
    if (bucket?.target === "performers") return makeStudioPerformersUrl(stats?.studio, criteria);
    return makeStudioScenesUrl(stats?.studio, criteria);
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

  function renderStudioPageDashboard(container, stats) {
    if (!(container instanceof HTMLElement) || !stats) return;
    container.innerHTML = "";
    container.className = "tab-pane fade studio-dashboard__page-dashboard active show";
    container.dataset.studioDashboardStudioId = stats.studio.id;
    container.style.setProperty("--studio-dashboard-header-font-size", `${getDashboardHeaderFontSize()}px`);
    container.style.setProperty("--studio-dashboard-subheader-font-size", `${getDashboardSubheaderFontSize()}px`);
    container.style.setProperty("--studio-dashboard-content-font-size", `${getDashboardContentFontSize()}px`);
    container.style.setProperty("--studio-dashboard-tag-max-width", `${getDashboardMaxTagCardWidth()}px`);
    container.style.setProperty("--studio-dashboard-surface-color", getDashboardSurfaceColor());
    container.style.setProperty("--studio-dashboard-surface-opacity", String(getDashboardSurfaceOpacity()));
    container.style.setProperty("--studio-dashboard-performer-card-aspect-ratio", getDashboardPerformerCardAspectRatio());

    const body = document.createElement("div");
    body.className = "studio-dashboard__page-body";
    container.appendChild(body);

    const renderers = {
      insights: () => {
        renderDashboardInsights(body, stats);
      },
      performerHighlights: () => {
        const performerHighlights = Array.isArray(stats.performerHighlights) ? stats.performerHighlights : [];
        if (!performerHighlights.length) return;
        const section = createPageSection(body, "PERFORMER HIGHLIGHTS");
        renderPerformerCards(section, performerHighlights.slice(0, 8));
      },
      performersMostScenes: () => renderPerformerRowSection(body, "PERFORMERS WITH MOST SCENES", stats.performerHighlightRows?.performersMostScenes, stats, "scenes_count", "desc"),
      performersMostOs: () => renderPerformerRowSection(body, "PERFORMERS WITH MOST O'S", stats.performerHighlightRows?.performersMostOs, stats, "o_counter", "desc"),
      performersHighestRating: () => renderPerformerRowSection(body, "PERFORMERS WITH HIGHEST RATING", stats.performerHighlightRows?.performersHighestRating, stats, "rating", "desc"),
      performersHighestRatedScenes: () => renderPerformerRowSection(body, "PERFORMERS WITH HIGHEST RATED SCENES", stats.performerHighlightRows?.performersHighestRatedScenes, stats),
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
      topRatedScenes: () => renderSceneRowSection(body, "TOP RATED SCENES", stats.topRatedScenes, (scene) => formatRating(scene.rating100), stats, "rating", "desc", [buildRatingNotNullCriterion()]),
      recentReleases: () => renderSceneRowSection(body, "RECENT RELEASES", stats.recentReleases, (scene) => formatDate(scene.date), stats, "date", "desc"),
      scenesMostOs: () => renderSceneRowSection(body, "SCENES WITH MOST O'S", stats.scenesMostOs, (scene) => `${scene.oCounter} O's`, stats, "o_counter", "desc"),
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
      const main = document.createElement("div");
      main.className = "studio-dashboard__page-section-header-main";
      main.setAttribute("role", "button");
      main.setAttribute("tabindex", "0");
      main.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      const caret = document.createElement("span");
      caret.className = "studio-dashboard__page-section-caret";
      caret.textContent = ">";
      const title = document.createElement("span");
      title.className = "studio-dashboard__page-section-title";
      title.textContent = titleText;
      const actions = document.createElement("span");
      actions.className = "studio-dashboard__page-section-actions";
      (options.actions || []).filter(Boolean).forEach((action) => actions.appendChild(action));
      if (actions.children.length) main.classList.add("has-actions");
      const toggle = document.createElement("span");
      toggle.className = "studio-dashboard__page-section-toggle";
      toggle.textContent = isCollapsed ? "Expand" : "Collapse";
      main.append(caret, title);
      if (actions.children.length) main.appendChild(actions);
      main.appendChild(toggle);
      header.appendChild(main);
      section.appendChild(header);
      if (isCollapsed) section.classList.add("is-collapsed");
      main.addEventListener("click", () => {
        const nextCollapsed = !section.classList.contains("is-collapsed");
        section.classList.toggle("is-collapsed", nextCollapsed);
        main.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
        toggle.textContent = nextCollapsed ? "Expand" : "Collapse";
        if (defaultState === "remember") setDashboardSectionCollapsed(collapsedKey, nextCollapsed);
      });
      main.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        main.click();
      });
    }
    section.appendChild(body);
    container.appendChild(section);
    return body;
  }

  function createShowAllAction(url, label = "Show all") {
    if (!url) return null;
    const link = document.createElement("a");
    link.className = "studio-dashboard__section-action studio-dashboard__section-action-link";
    link.href = url;
    link.textContent = label;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.addEventListener("click", (event) => event.stopPropagation());
    link.addEventListener("keydown", (event) => event.stopPropagation());
    return link;
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
      renderTagCards(container, stats, stats.topTags.slice(0, limit));
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
      renderTagCards(row, stats, group.tags.slice(0, limit));
      grouped.appendChild(row);
    });
    container.appendChild(grouped);
  }

  function renderPerformerRowSection(container, title, performers, stats, sortBy = "", sortDir = "desc") {
    const visible = Array.isArray(performers) ? performers.filter(Boolean) : [];
    if (!visible.length) return;
    const showAllUrl = sortBy ? makeStudioPerformersUrl(stats?.studio, [], { sortBy, sortDir }) : "";
    const section = createPageSection(container, title, {
      actions: showAllUrl ? [createShowAllAction(showAllUrl)] : [],
    });
    renderPerformerCards(section, visible.slice(0, DASHBOARD_ROW_CARD_LIMIT));
  }

  function renderSceneRowSection(container, title, scenes, metaFormatter, stats, sortBy = "", sortDir = "desc", criteria = []) {
    const visible = Array.isArray(scenes) ? scenes.filter(Boolean) : [];
    if (!visible.length) return;
    const showAllUrl = sortBy ? makeStudioScenesUrl(stats?.studio, criteria, { sortBy, sortDir }) : "";
    const section = createPageSection(container, title, {
      actions: showAllUrl ? [createShowAllAction(showAllUrl)] : [],
    });
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
        url: makeStudioScenesUrl(stats.studio, [], { sortBy: "date", sortDir: "desc" }),
      },
      {
        enabled: true,
        title: "Top rated scene",
        scene: stats.topScene,
        meta: stats.topScene ? formatRating(stats.topScene.rating100) : "",
        url: makeStudioScenesUrl(stats.studio, [buildRatingNotNullCriterion()], { sortBy: "rating", sortDir: "desc" }),
      },
      {
        enabled: true,
        title: "Lowest rated scene",
        scene: stats.lowestRatedScene,
        meta: stats.lowestRatedScene ? formatRating(stats.lowestRatedScene.rating100) : "",
        url: makeStudioScenesUrl(stats.studio, [buildRatingNotNullCriterion()], { sortBy: "rating", sortDir: "asc" }),
      },
      {
        enabled: true,
        title: "Most O's",
        scene: stats.topOCountScene,
        meta: stats.topOCountScene ? `${stats.topOCountScene.oCounter} O's` : "",
        url: makeStudioScenesUrl(stats.studio, [], { sortBy: "o_counter", sortDir: "desc" }),
      },
      {
        enabled: true,
        title: "Least O's",
        scene: stats.leastOCountScene,
        meta: stats.leastOCountScene ? `${stats.leastOCountScene.oCounter} O's` : "",
        url: makeStudioScenesUrl(stats.studio, [buildOCountCriterion()], { sortBy: "o_counter", sortDir: "asc" }),
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
      if (highlight.url) {
        const link = document.createElement("a");
        link.className = "studio-dashboard__meta-link";
        link.href = highlight.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = highlight.title;
        title.appendChild(link);
      } else {
        title.textContent = highlight.title;
      }
      item.appendChild(title);
      renderSceneCard(item, highlight.scene, highlight.meta);
      grid.appendChild(item);
    });
    section.appendChild(grid);
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

    const section = createPageSection(container, "PERFORMER DEMOGRAPHICS");
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__demographics";
    section.appendChild(grid);

    renderDemographicChart(grid, {
      title: "Nationality",
      subtitle: `${demographics.countryTotal || 0} unique performer${demographics.countryTotal === 1 ? "" : "s"}`,
      items: demographics.countries || [],
      unit: "performers",
      type: "country",
      studio: stats.studio,
    });

    renderDemographicChart(grid, {
      title: "Age at release",
      subtitle: `${demographics.ageTotal || 0} performer appearance${demographics.ageTotal === 1 ? "" : "s"}`,
      items: demographics.ages || [],
      unit: "appearances",
      type: "age",
      studio: stats.studio,
    });

    renderDemographicChart(grid, {
      title: "Performer rating",
      subtitle: `${demographics.ratingTotal || 0} unique performer${demographics.ratingTotal === 1 ? "" : "s"}`,
      items: demographics.ratings || [],
      unit: "performers",
      type: "performer-rating",
      studio: stats.studio,
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

    const section = createPageSection(container, "SCENE CHARTS");
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__demographics";
    section.appendChild(grid);

    if (hasSceneRatings) {
      renderDemographicChart(grid, {
        title: "Scene rating",
        subtitle: `${sceneRatings.total || 0} scene${sceneRatings.total === 1 ? "" : "s"}`,
        items: sceneRatings.items || [],
        unit: "scenes",
        type: "scene-rating",
        studio: stats.studio,
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
      });
    });
  }

  function renderDemographicChart(container, { title, subtitle, items, subcharts, unit, type, studio, footer }) {
    const hasSubcharts = Array.isArray(subcharts) && subcharts.length;
    let nextItemIndex = 0;
    const displayItems = hasSubcharts
      ? []
      : getDemographicDisplayItems(items || [], type).map((item) => ({ ...item, sourceIndex: nextItemIndex++ }));
    const displaySubcharts = hasSubcharts
      ? subcharts.map((subchart) => ({
        ...subchart,
        items: (subchart.items || []).map((item) => ({ ...item, sourceIndex: nextItemIndex++ })),
      }))
      : [];
    const allDisplayItems = hasSubcharts ? displaySubcharts.flatMap((subchart) => subchart.items || []) : displayItems;
    const chart = document.createElement("div");
    chart.className = "studio-dashboard__demographic-chart studio-dashboard__demographic-chart--pie";
    chart.studioDashboardItems = displayItems;
    chart.studioDashboardSubcharts = displaySubcharts;
    chart.studioDashboardUnit = unit;
    chart.studioDashboardType = type;
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
    if (type !== "scene-resolution" && displayItems.some((item) => item.filterable !== false)) {
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
    if (allDisplayItems.some((item) => item.filterable !== false)) {
      const controls = document.createElement("div");
      controls.className = "studio-dashboard__demographic-controls";
      controls.innerHTML = `
        <button type="button" data-demo-action="go" disabled>Go to scenes</button>
        <button type="button" data-demo-action="update" disabled>Update chart</button>
      `;
      controls.querySelector("[data-demo-action='go']")?.addEventListener("click", () => {
        openDemographicScenes(studio, type, allDisplayItems, Array.from(chart.querySelectorAll(".studio-dashboard__demographic-row")));
      });
      controls.querySelector("[data-demo-action='update']")?.addEventListener("click", () => {
        updateDemographicChartView(chart);
      });
      chart.appendChild(controls);
      updateDemographicGoState(chart);
    }
    if (footer) {
      const note = document.createElement("div");
      note.className = "studio-dashboard__demographic-note";
      note.textContent = footer;
      chart.appendChild(note);
    }
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
    chart.querySelectorAll("[data-demo-action='go'], [data-demo-action='update']").forEach((button) => {
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

  function openDemographicScenes(studio, type, items, rows) {
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
      criteria = buildSceneTagFilterCriteria(includeItems, excludeItems);
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
    window.open(makeStudioScenesUrl(studio, criteria), "_blank", "noopener,noreferrer");
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
    return `<a class="studio-dashboard__meta-link" href="${escapeHtml(makePerformerScenesUrl(performer, scope, "rating"))}"><strong>${escapeHtml(label)}</strong></a>`;
  }

  function formatPerformerMetricLink(performer, scope, value, sortBy) {
    const count = Number(value || 0);
    if (count <= 0) return `<strong>${escapeHtml(count)}</strong>`;
    return `<a class="studio-dashboard__meta-link" href="${escapeHtml(makePerformerScenesUrl(performer, scope, sortBy))}"><strong>${escapeHtml(count)}</strong></a>`;
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
      card.innerHTML = `
        ${performer.metricTitle ? `<div class="studio-dashboard__card-kicker">${escapeHtml(performer.metricTitle)}</div>` : ""}
        <div class="studio-dashboard__card-name studio-dashboard__performer-title">${formatPerformerName(performer)}</div>
        ${performer.imagePath ? `
          <span class="studio-dashboard__performer-image">
            <img src="${escapeHtml(performer.imagePath)}" alt="${escapeHtml(performer.name)}">
          </span>
        ` : ""}
        ${showMeta ? `<div class="studio-dashboard__muted studio-dashboard__performer-meta">${formatPerformerMeta(performer)}</div>` : ""}
      `;
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  function renderTagCards(container, statsOrStudio, tags) {
    const stats = statsOrStudio?.studio ? statsOrStudio : { studio: statsOrStudio };
    const grid = document.createElement("div");
    grid.className = "studio-dashboard__tag-cards";
    tags.forEach((tag) => {
      const scopedUrl = makeStudioTagUrl(stats.studio, tag);
      const allUrl = makeGlobalTagUrl(tag);
      const scopedCount = Number(tag?.count || 0);
      const allCount = Number(tag?.allCount || tag?.count || 0);
      const card = document.createElement("div");
      card.className = "studio-dashboard__tag-card";
      card.innerHTML = `
        <a class="studio-dashboard__tag-main" href="${escapeHtml(scopedUrl)}" target="_blank" rel="noopener noreferrer">
          <span class="studio-dashboard__tag-image">
            ${tag.imagePath ? `<img src="${escapeHtml(tag.imagePath)}" alt="${escapeHtml(tag.name)}">` : ""}
          </span>
          <span class="studio-dashboard__card-name">${escapeHtml(tag.name)}</span>
        </a>
        <table class="studio-dashboard__tag-count-table">
          <thead>
            <tr>
              <th>Studio</th>
              <th>All</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <a class="studio-dashboard__meta-link" href="${escapeHtml(scopedUrl)}" target="_blank" rel="noopener noreferrer">
                  <span class="studio-dashboard__meta-icon" title="Studio scenes">🎬</span><strong>${escapeHtml(scopedCount)}</strong>
                </a>
              </td>
              <td>
                <a class="studio-dashboard__meta-link" href="${escapeHtml(allUrl)}" target="_blank" rel="noopener noreferrer">
                  <span class="studio-dashboard__meta-icon" title="All scenes">🎬</span><strong>${escapeHtml(allCount)}</strong>
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      `;
      grid.appendChild(card);
    });
    grid.querySelectorAll(".studio-dashboard__tag-image img").forEach((img) => {
      if (!(img instanceof HTMLImageElement)) return;
      if (img.complete && img.naturalWidth && img.naturalHeight) {
        syncTagGridAspectRatio(grid, img);
      } else {
        img.addEventListener("load", () => syncTagGridAspectRatio(grid, img), { once: true });
      }
    });
    container.appendChild(grid);
    observeTagGridLayout(grid);
  }

  function makeStudioTagUrl(studio, tag) {
    return makeStudioScenesUrl(studio, [buildTagCriterion(tag)]);
  }

  function makeGlobalTagUrl(tag) {
    return makeStudioScenesUrl(null, [buildTagCriterion(tag)]);
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

  function buildStudioSelectionCriterion(studio) {
    const id = String(studio?.id || "");
    if (!id) return null;
    return {
      type: "studios",
      value: {
        items: [{ id, label: String(studio?.name || "Studio") }],
        excluded: [],
        depth: -1,
      },
      modifier: "INCLUDES",
    };
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

  function buildSceneTagFilterCriteria(includeItems, excludeItems) {
    return [
      ...includeItems.map((item) => item?.customExcludeTags?.length
        ? buildTagListCriterion(item.customExcludeTags, "EXCLUDES")
        : item?.customTag ? buildTagCriterion(item.customTag, "INCLUDES") : null),
      ...excludeItems.map((item) => item?.customExcludeTags?.length
        ? buildTagListCriterion(item.customExcludeTags, "INCLUDES")
        : item?.customTag ? buildTagCriterion(item.customTag, "EXCLUDES") : null),
    ].filter(Boolean);
  }

  function buildSceneRatingFilterCriteria(includeItems, excludeItems) {
    return [
      ...includeItems.map((item) => buildRatingCriterion(item, false)),
      ...excludeItems.map((item) => buildRatingCriterion(item, true)),
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
    if (!item) return null;
    const min = item.min == null ? null : Number(item.min);
    const max = item.max == null ? null : Number(item.max);
    if (min != null && max != null && min === max) {
      return {
        type: "performer_age",
        value: { value: min },
        modifier: exclude ? "NOT_EQUALS" : "EQUALS",
      };
    }
    if (min != null && max != null) {
      return {
        type: "performer_age",
        value: { value: min, value2: max },
        modifier: exclude ? "NOT_BETWEEN" : "BETWEEN",
      };
    }
    if (min != null) {
      return {
        type: "performer_age",
        value: { value: exclude ? min : Math.max(0, min - 1) },
        modifier: exclude ? "LESS_THAN" : "GREATER_THAN",
      };
    }
    if (max != null) {
      return {
        type: "performer_age",
        value: { value: exclude ? max : max + 1 },
        modifier: exclude ? "GREATER_THAN" : "LESS_THAN",
      };
    }
    return null;
  }

  function buildRatingCriterion(item, exclude = false) {
    if (!item || item.otherRating) return null;
    if (item.unknownRating) {
      return {
        type: "rating",
        value: { value: 0 },
        modifier: exclude ? "NOT_EQUALS" : "EQUALS",
      };
    }
    const min = item.min == null ? null : Math.round(Number(item.min) * 10);
    const max = item.max == null ? null : Math.round(Number(item.max) * 10);
    if (min != null && max != null && min === max) {
      return {
        type: "rating",
        value: { value: min },
        modifier: exclude ? "NOT_EQUALS" : "EQUALS",
      };
    }
    if (min != null && max != null) {
      return {
        type: "rating",
        value: { value: min, value2: max },
        modifier: exclude ? "NOT_BETWEEN" : "BETWEEN",
      };
    }
    if (min != null) {
      return {
        type: "rating",
        value: { value: exclude ? min : Math.max(0, min - 1) },
        modifier: exclude ? "LESS_THAN" : "GREATER_THAN",
      };
    }
    if (max != null) {
      return {
        type: "rating",
        value: { value: exclude ? max : max + 1 },
        modifier: exclude ? "GREATER_THAN" : "LESS_THAN",
      };
    }
    return null;
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
        value: { value: min },
        modifier: exclude ? "NOT_EQUALS" : "EQUALS",
      };
    }
    if (min != null && max != null) {
      return {
        type,
        value: { value: min, value2: Math.max(min, max - 1) },
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
        value: { value: exclude ? Math.max(0, max - 1) : max },
        modifier: exclude ? "GREATER_THAN" : "LESS_THAN",
      };
    }
    return null;
  }

  function buildResolutionCriterion(item, exclude = false) {
    if (!item?.enumValue) return null;
    return {
      type: "resolution",
      value: {
        id: item.enumValue,
        value: item.enumValue,
        label: item.label || item.enumValue,
      },
      modifier: exclude ? "NOT_EQUALS" : "EQUALS",
    };
  }

  function buildDateCriterion(item) {
    return {
      type: "date",
      value: {
        value: item.startDate,
        value2: item.endDate,
      },
      modifier: "BETWEEN",
    };
  }

  function addSortParams(params, options = {}) {
    if (!params || !options?.sortBy) return;
    params.set("sortby", String(options.sortBy));
    params.set("sortdir", String(options.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc");
  }

  function makeStudioScenesUrl(studio, criteria = [], options = {}) {
    const params = new URLSearchParams();
    addSortParams(params, options);
    criteria.filter(Boolean).forEach((criterion) => params.append("c", JSON.stringify(criterion)));
    const query = params.toString();
    if (!studio?.id) return `/scenes${query ? `?${query}` : ""}`;
    return `/studios/${encodeURIComponent(studio.id)}/scenes${query ? `?${query}` : ""}`;
  }

  function makeStudioPerformersUrl(studio, criteria = [], options = {}) {
    const params = new URLSearchParams();
    addSortParams(params, options);
    [buildStudioSelectionCriterion(studio), ...criteria].filter(Boolean).forEach((criterion) => {
      params.append("c", JSON.stringify(criterion));
    });
    const query = params.toString();
    return `/performers${query ? `?${query}` : ""}`;
  }

  function makeSceneUrl(scene) {
    return scene?.id ? `/scenes/${encodeURIComponent(scene.id)}` : "";
  }

  function makePerformerUrl(performer) {
    return performer?.id ? `/performers/${encodeURIComponent(performer.id)}` : "";
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
      bar.target = "_blank";
      bar.rel = "noopener noreferrer";
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
          <a class="studio-dashboard__hover-title" href="/studios/${encodeURIComponent(stats.studio.id)}">${escapeHtml(stats.studio.name)}</a>
          <div class="studio-dashboard__hover-body"></div>
        `;
        renderStatsInto(tooltip.querySelector(".studio-dashboard__hover-body"), stats);
        positionTooltip(anchor, tooltip);
      }
    } catch (err) {
      console.warn("[StudioDashboard] Stats failed", err);
      if (state.tooltip === tooltip) {
        tooltip.innerHTML = `
          <a class="studio-dashboard__hover-title" href="/studios/${encodeURIComponent(studio.id || "")}">${escapeHtml(studio.name || "Studio")}</a>
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
        console.warn("[StudioDashboard] Studio page dashboard failed", err);
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

  function enhanceCurrentPage() {
    ensureStudioPageDashboard();

    if (state.currentStudio?.id) {
      getStudioLinks(state.currentStudio.id).forEach((link) =>
        enhanceStudioLink(link, state.currentStudio)
      );
    }

    if (
      isContentBrowserPage() &&
      getConfigBoolean(getSetting("a01ShowOnBrowserPages", "showOnBrowserPages"), false)
    ) {
      getAllStudioLinks().forEach((link) => {
        const studio = studioFromLink(link);
        if (studio?.id) enhanceStudioLink(link, studio, "browser");
      });
    }
  }

  async function refreshPage() {
    const token = ++state.routeToken;
    state.studioPageRenderToken += 1;
    closeTooltip();
    await loadConfig();
    if (token !== state.routeToken) return;
    const entity = getPageEntity();
    if (!entity) {
      state.currentStudio = null;
      enhanceCurrentPage();
      return;
    }
    const studio = await fetchCurrentStudio(entity);
    if (token !== state.routeToken) return;
    state.currentStudio = studio;
    enhanceCurrentPage();
  }

  function scheduleRefresh(delay = 120) {
    window.clearTimeout(state.routeTimer);
    state.routeTimer = window.setTimeout(() => {
      refreshPage().catch((err) => console.warn("[StudioDashboard] refresh failed", err));
    }, delay);
  }

  function handleNavigation() {
    if (window.location.pathname === state.lastPath) return;
    state.lastPath = window.location.pathname;
    scheduleRefresh();
  }

  function installNavigationHooks() {
    if (window.__studioDashboardHistoryWrapped) return;
    window.__studioDashboardHistoryWrapped = true;
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
