(function () {
  "use strict";

  const PLUGIN_ID = "StudioDashboard";
  const LEGACY_PLUGIN_ID = "StudioBadges";
  const ROUTE_EVENT = "studio-dashboard:navigation";
  const TOP_PERFORMER_MAX = 6;
  const TOP_TAG_MAX = 10;
  const TOP_TAG_CATEGORY_MAX = 12;
  const STATS_PAGE_SIZE = 250;
  const GRAPHQL_TIMEOUT_MS = 60000;
  const STUDIO_DASHBOARD_TAB_KEY = "studio-dashboard-tab";
  const DISPLAY_PROFILES = new Set(["compact", "standard", "rich"]);
  const TOP_TAG_LAYOUTS = new Set(["rows", "columns", "flow"]);
  const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  function getDashboardTopTagLimit() {
    return Math.round(getConfigNumber(getSetting("c03TopTagsPerCategory", "topTagsPerCategory"), 10, 1, TOP_TAG_MAX));
  }

  function getDashboardTopTagLayout() {
    const layout = getConfigString(getSetting("c02TopTagCategoryLayout", "topTagCategoryLayout"), "rows").toLowerCase();
    return TOP_TAG_LAYOUTS.has(layout) ? layout : "rows";
  }

  function getDisplayProfile() {
    const profile = getConfigString(getSetting("a03DisplayProfile", "displayProfile"), "standard").toLowerCase();
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
    const nextConfig = plugins[PLUGIN_ID] || plugins[LEGACY_PLUGIN_ID] || {};
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

  function performerMetricCard(performer, metricKey, metricTitle) {
    if (!performer) return null;
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
      metricTitle,
    };
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
        showTimeline: getConfigBoolean(getSetting("b05ShowReleaseTimeline", "showReleaseTimeline"), true),
      };
    }
    return {
      performers: 3,
      tags: 5,
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
    const data = await gql(
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
              performers { id name image_path rating100 }
              tags { id name image_path }
              paths { screenshot preview }
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

    const scenes = data?.findScenes?.scenes || [];
    const sceneCount = Number(data?.findScenes?.count || 0);
    if (onProgress && sceneCount > scenes.length) {
      onProgress(`Loading studio scenes ${scenes.length} / ${sceneCount}...`);
    }
    for (let page = 2; scenes.length < sceneCount; page += 1) {
      const pageData = await gql(
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
                performers { id name image_path rating100 }
                tags { id name image_path }
                paths { screenshot preview }
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
      const pageScenes = pageData?.findScenes?.scenes || [];
      if (!pageScenes.length) break;
      scenes.push(...pageScenes);
      if (onProgress) {
        onProgress(`Loading studio scenes ${Math.min(scenes.length, sceneCount)} / ${sceneCount}...`);
      }
    }

    const tagFilters = getConfigBoolean(getSetting("b04ShowTopTags", "showTopTags"), true)
      ? await buildTopTagFilters()
      : { blacklist: new Set(), whitelist: null };
    const topTagCategories = getConfigBoolean(getSetting("b04ShowTopTags", "showTopTags"), true)
      ? await getConfiguredTopTagCategories()
      : [];
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
    const topOCountScene = scenes
      .slice()
      .filter((scene) => Number(scene?.o_counter || 0) > 0)
      .sort((left, right) => {
        const oDiff = Number(right?.o_counter || 0) - Number(left?.o_counter || 0);
        if (oDiff) return oDiff;
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      })[0];

    const stats = {
      studio,
      counts: {
        scenes: sceneCount,
        images: Number(data?.findImages?.count || 0),
        galleries: Number(data?.findGalleries?.count || 0),
        performers: performerCounts.size,
        oCount,
      },
      topPerformers,
      performerHighlights,
      topTags: buildTopTags(scenes, tagFilters),
      topTagGroups: buildTopTagGroups(scenes, tagFilters, topTagCategories),
      timeline: buildReleaseTimeline(scenes),
      topScene: normalizeSceneSummary(topScene),
      recentScene: normalizeSceneSummary(recentScene),
      topOCountScene: normalizeSceneSummary(topOCountScene),
    };
    return stats;
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

    if (!getConfigBoolean(getSetting("b01ShowHoverPopout", "showHoverPopout"), true)) return;
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

    if (getConfigBoolean(getSetting("b02ShowCountStats", "showCountStats"), true)) {
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
    }

    if (getConfigBoolean(getSetting("b03ShowTopPerformers", "showTopPerformers"), true)) {
      const section = createSection(container);
      const performerHighlights = getPerformerHighlightsForProfile(stats, profile);

      if (!performerHighlights.length) {
        const empty = document.createElement("div");
        empty.className = "studio-dashboard__status";
        empty.textContent = "No performer data found.";
        section.appendChild(empty);
      } else {
        renderPerformerCards(section, performerHighlights.slice(0, limits.performers));
      }
    }

    if (getConfigBoolean(getSetting("b04ShowTopTags", "showTopTags"), true)) {
      const section = createSection(container);
      const title = document.createElement("div");
      title.className = "studio-dashboard__section-title";
      title.textContent = "TOP TAGS";
      section.appendChild(title);

      if (!stats.topTags.length) {
        const empty = document.createElement("div");
        empty.className = "studio-dashboard__status";
        empty.textContent = "No tag data found.";
        section.appendChild(empty);
      } else {
        renderTagCards(section, stats.studio, stats.topTags.slice(0, limits.tags));
      }
    }

    if (limits.showTimeline) {
      renderReleaseTimeline(container, stats.studio, stats.timeline);
    }

    const sceneHighlights = getSceneHighlights(stats);
    if (profile === "rich") {
      renderSceneHighlightGrid(container, sceneHighlights);
    } else {
      sceneHighlights.forEach((highlight) => renderSceneHighlight(container, highlight));
    }
  }

  function renderStudioPageDashboard(container, stats) {
    if (!(container instanceof HTMLElement) || !stats) return;
    container.innerHTML = "";
    container.className = "tab-pane fade studio-dashboard__page-dashboard active show";
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

    const performerHighlights = Array.isArray(stats.performerHighlights) ? stats.performerHighlights : [];
    if (getConfigBoolean(getSetting("b03ShowTopPerformers", "showTopPerformers"), true) && performerHighlights.length) {
      const section = createPageSection(body, "PERFORMER HIGHLIGHTS");
      renderPerformerCards(section, performerHighlights.slice(0, 8));
    }

    if (getConfigBoolean(getSetting("b04ShowTopTags", "showTopTags"), true) && stats.topTags.length) {
      const section = createPageSection(body, "TOP TAGS");
      renderDashboardTopTags(section, stats);
    }

    if (getConfigBoolean(getSetting("b05ShowReleaseTimeline", "showReleaseTimeline"), true)) {
      renderReleaseTimeline(body, stats.studio, stats.timeline);
    }

    renderSceneHighlightGrid(body, getSceneHighlights(stats));
  }

  function createPageSection(container, titleText) {
    const section = document.createElement("div");
    section.className = "studio-dashboard__page-section";
    if (titleText) {
      const title = document.createElement("h5");
      title.className = "studio-dashboard__page-section-title";
      title.textContent = titleText;
      section.appendChild(title);
    }
    container.appendChild(section);
    return section;
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

  function getSceneHighlights(stats) {
    return [
      {
        enabled: getConfigBoolean(getSetting("b06ShowTopScene", "showTopScene"), true),
        title: "Top rated scene",
        scene: stats.topScene,
        meta: stats.topScene ? formatRating(stats.topScene.rating100) : "",
      },
      {
        enabled: getConfigBoolean(getSetting("b07ShowRecentRelease", "showRecentRelease"), true),
        title: "Most recent release",
        scene: stats.recentScene,
        meta: stats.recentScene ? formatDate(stats.recentScene.date) : "",
      },
      {
        enabled: getConfigBoolean(getSetting("b08ShowTopOCountScene", "showTopOCountScene"), true),
        title: "Most O's",
        scene: stats.topOCountScene,
        meta: stats.topOCountScene ? `${stats.topOCountScene.oCounter} O's` : "",
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

  function renderSceneHighlightGrid(container, highlights) {
    const visible = highlights.filter((highlight) => highlight.enabled && highlight.scene);
    if (!visible.length) return;
    const section = createSection(container);
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
            <td><span class="studio-dashboard__meta-icon" title="Studio scenes">🎬</span><strong>${escapeHtml(studioScenes)}</strong></td>
            <td><span class="studio-dashboard__meta-icon" title="All scenes">🎬</span><strong>${escapeHtml(allScenes)}</strong></td>
          </tr>
          <tr>
            <td><span class="studio-dashboard__meta-icon" title="Studio O's">💧</span><strong>${escapeHtml(studioOCount)}</strong></td>
            <td><span class="studio-dashboard__meta-icon" title="All O's">💧</span><strong>${escapeHtml(allOCount)}</strong></td>
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
    return `<a class="studio-dashboard__meta-link" href="${escapeHtml(makePerformerRatedScenesUrl(performer, scope))}"><strong>${escapeHtml(label)}</strong></a>`;
  }

  function makePerformerRatedScenesUrl(performer, scope) {
    const params = new URLSearchParams();
    params.set("sortby", "rating");
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

  function buildTagCriterion(tag) {
    return {
      type: "tags",
      value: {
        items: [{ id: String(tag?.id || ""), label: String(tag?.name || "Tag") }],
        excluded: [],
        depth: -1,
      },
      modifier: "INCLUDES",
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

  function makeStudioScenesUrl(studio, criteria = []) {
    const params = new URLSearchParams();
    criteria.filter(Boolean).forEach((criterion) => params.append("c", JSON.stringify(criterion)));
    const query = params.toString();
    return `/studios/${encodeURIComponent(studio?.id || "")}/scenes${query ? `?${query}` : ""}`;
  }

  function renderReleaseTimeline(container, studio, timeline) {
    const items = getTimelineItems(timeline);
    if (!items.length) return;

    const section = createSection(container);
    const title = document.createElement("div");
    title.className = "studio-dashboard__section-title";
    title.textContent = "Release timeline";
    section.appendChild(title);

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
      return `<span class="studio-dashboard__meta-icon" title="O's">💧</span><strong>${escapeHtml(value)}</strong>`;
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
    if (!getConfigBoolean(getSetting("b01ShowHoverPopout", "showHoverPopout"), true)) return;
    if (
      anchor.dataset.studioDashboardSource === "browser" &&
      !getConfigBoolean(getSetting("a02ShowOnBrowserPages", "showOnBrowserPages"), false)
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
    if (!studioId || !getConfigBoolean(getSetting("a01ShowOnStudioPages", "showOnStudioPages"), true)) {
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
      getConfigBoolean(getSetting("a02ShowOnBrowserPages", "showOnBrowserPages"), false)
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
