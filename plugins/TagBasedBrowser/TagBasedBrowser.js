(function () {
  "use strict";

  const PLUGIN_ID = "TagBasedBrowser";
  const PLUGIN_NAME = "Tag Browser";
  const ROUTE_PATH = "/plugin/TagBasedBrowser";
  const NAV_BUTTON_ID = "tag-based-browser-nav-button";
  const EXPANDED_STORAGE_KEY = "tag-based-browser-expanded-v1";
  const COLUMN_COUNT_STORAGE_KEY = "tag-based-browser-column-count-v1";
  const SORT_STATE_STORAGE_KEY = "tag-based-browser-sort-state-v1";
  const SELECTION_UI_STORAGE_KEY = "tag-based-browser-selection-ui-v1";
  const DEFAULT_TAB = "scenes";
  const PAGE_SIZE = 24;
  const COLUMN_COUNT_LIMITS = {
    scenes: { min: 2, max: 8, defaultValue: 5 },
    studios: { min: 2, max: 8, defaultValue: 5 },
    images: { min: 2, max: 8, defaultValue: 5 },
    galleries: { min: 2, max: 8, defaultValue: 5 },
    performers: { min: 2, max: 6, defaultValue: 4 },
  };
  const CARD_GRID_GAP = {
    scenes: "0.9rem",
    studios: "0.9rem",
    images: "0.9rem",
    galleries: "0.9rem",
    performers: "1.15rem",
  };
  const JUSTIFIED_ROW_GAP_PX = 14;
  const SORT_OPTIONS = {
    scenes: [
      { value: "date", label: "Date" },
      { value: "created_at", label: "Created At" },
      { value: "updated_at", label: "Updated At" },
      { value: "title", label: "Title" },
      { value: "rating", label: "Rating" },
      { value: "bit_rate", label: "Bit Rate" },
      { value: "duration", label: "Duration" },
      { value: "file_size", label: "File Size" },
      { value: "last_played_at", label: "Last Played" },
      { value: "path", label: "Path" },
      { value: "play_count", label: "Play Count" },
      { value: "organized", label: "Organized" },
    ],
    studios: [
      { value: "name", label: "Name" },
      { value: "created_at", label: "Created At" },
      { value: "updated_at", label: "Updated At" },
      { value: "rating", label: "Rating" },
      { value: "scene_count", label: "Scene Count" },
      { value: "image_count", label: "Image Count" },
      { value: "gallery_count", label: "Gallery Count" },
    ],
    images: [
      { value: "date", label: "Date" },
      { value: "created_at", label: "Created At" },
      { value: "updated_at", label: "Updated At" },
      { value: "title", label: "Title" },
      { value: "rating", label: "Rating" },
      { value: "file_size", label: "File Size" },
      { value: "path", label: "Path" },
      { value: "organized", label: "Organized" },
    ],
    galleries: [
      { value: "date", label: "Date" },
      { value: "created_at", label: "Created At" },
      { value: "updated_at", label: "Updated At" },
      { value: "title", label: "Title" },
      { value: "rating", label: "Rating" },
      { value: "image_count", label: "Image Count" },
      { value: "path", label: "Path" },
      { value: "organized", label: "Organized" },
    ],
    performers: [
      { value: "birthdate", label: "Birthdate" },
      { value: "created_at", label: "Created At" },
      { value: "updated_at", label: "Updated At" },
      { value: "name", label: "Name" },
      { value: "rating", label: "Rating" },
      { value: "scene_count", label: "Scene Count" },
    ],
  };
  const DEFAULT_SORT_STATE = {
    scenes: { sort: "date", direction: "DESC" },
    studios: { sort: "name", direction: "ASC" },
    images: { sort: "created_at", direction: "DESC" },
    galleries: { sort: "date", direction: "DESC" },
    performers: { sort: "name", direction: "ASC" },
  };
  const DEFAULT_SELECTION_UI_STATE = {
    mode: "single",
    matchMode: "any",
    subTagContent: "include",
  };
  const DEFAULT_CONFIG = {
    showDetailedTreeCounts: false,
    treeExpansionBehavior: "remember",
  };
  const tagBrowserCache =
    window.__tagBasedBrowserCache ||
    (window.__tagBasedBrowserCache = {
      tagDataPromise: null,
      tagData: null,
      configPromise: null,
      config: null,
      contentPages: new Map(),
    });
  const TAB_DEFS = [
    { key: "scenes", label: "Scenes", countKey: "scene_count" },
    { key: "studios", label: "Studios", countKey: "studio_count" },
    { key: "images", label: "Images", countKey: "image_count" },
    { key: "galleries", label: "Galleries", countKey: "gallery_count" },
    { key: "performers", label: "Performers", countKey: "performer_count" },
  ];
  function getReactApi() {
    return window.__tagBasedBrowserPluginApi?.React || window.PluginApi?.React || null;
  }

  function h() {
    const React = getReactApi();
    if (!React?.createElement) {
      throw new Error("[TagBasedBrowser] React is unavailable");
    }
    return React.createElement.apply(React, arguments);
  }

  function useCallback() {
    const React = getReactApi();
    return React.useCallback.apply(React, arguments);
  }

  function useEffect() {
    const React = getReactApi();
    return React.useEffect.apply(React, arguments);
  }

  function useMemo() {
    const React = getReactApi();
    return React.useMemo.apply(React, arguments);
  }

  function useRef() {
    const React = getReactApi();
    return React.useRef.apply(React, arguments);
  }

  function useState() {
    const React = getReactApi();
    return React.useState.apply(React, arguments);
  }

  function getFragment() {
    const React = getReactApi();
    return React.Fragment;
  }

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

  function normalizeConfig(rawConfig) {
    const rawDetailedValue =
      typeof rawConfig?.a_showDetailedTreeCounts === "boolean"
        ? rawConfig.a_showDetailedTreeCounts
        : rawConfig?.showDetailedTreeCounts;
    const rawTreeExpansionBehavior =
      typeof rawConfig?.b_treeExpansionBehavior === "string"
        ? rawConfig.b_treeExpansionBehavior
        : rawConfig?.treeExpansionBehavior;
    const treeExpansionBehavior =
      String(rawTreeExpansionBehavior || "").toLowerCase() === "expand_all"
        ? "expand_all"
        : String(rawTreeExpansionBehavior || "").toLowerCase() === "collapse_all"
        ? "collapse_all"
        : DEFAULT_CONFIG.treeExpansionBehavior;
    return {
      showDetailedTreeCounts:
        typeof rawDetailedValue === "boolean"
          ? rawDetailedValue
          : DEFAULT_CONFIG.showDetailedTreeCounts,
      treeExpansionBehavior,
    };
  }

  async function loadConfig() {
    if (tagBrowserCache.config) return tagBrowserCache.config;
    if (tagBrowserCache.configPromise) return tagBrowserCache.configPromise;

    tagBrowserCache.configPromise = gqlRequest(`
      query TagBasedBrowserConfig {
        configuration {
          plugins
        }
      }
    `)
      .then((data) => {
        tagBrowserCache.config = normalizeConfig(
          data?.configuration?.plugins?.[PLUGIN_ID] || {}
        );
        return tagBrowserCache.config;
      })
      .catch((err) => {
        console.error("[TagBasedBrowser] config load failed", err);
        tagBrowserCache.config = normalizeConfig({});
        return tagBrowserCache.config;
      })
      .finally(() => {
        tagBrowserCache.configPromise = null;
      });

    return tagBrowserCache.configPromise;
  }

  function classNames() {
    return Array.from(arguments).filter(Boolean).join(" ");
  }

  function getFontAwesomeLibrary(style = "solid") {
    if (style === "regular") return window.PluginApi?.libraries?.FontAwesomeRegular || null;
    return window.PluginApi?.libraries?.FontAwesomeSolid || null;
  }

  function getFontAwesomeDefinition(iconExportName, style = "solid") {
    const library = getFontAwesomeLibrary(style);
    return library?.[iconExportName]?.icon || null;
  }

  function FontAwesomeSvgIcon(props) {
    const { icon, style = "solid", className = "", title = "" } = props;
    const definition = getFontAwesomeDefinition(icon, style);
    if (!definition) return null;

    const width = definition[0];
    const height = definition[1];
    const pathData = definition[4];
    const paths = Array.isArray(pathData) ? pathData : [pathData];

    return h(
      "svg",
      {
        className: classNames("tag-browser__fa-icon", className),
        viewBox: `0 0 ${width} ${height}`,
        "aria-hidden": title ? null : "true",
        role: "img",
      },
      title ? h("title", null, title) : null,
      paths.map((path, index) =>
        h("path", {
          key: `${icon}:${index}`,
          d: path,
          fill: "currentColor",
          opacity: paths.length > 1 && index === 0 ? "0.4" : null,
        })
      )
    );
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function sortItemsBySortNameThenName(items) {
    items.sort((a, b) => {
      const aKey = String(a.sort_name || a.name || "").toLowerCase();
      const bKey = String(b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
  }

  function getCountValue(record, key) {
    const value = Number(record?.[key]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function getTotalCount(record) {
    return TAB_DEFS.reduce((sum, tab) => sum + getCountValue(record, tab.countKey), 0);
  }

  async function fetchAllTags() {
    if (tagBrowserCache.tagData) return tagBrowserCache.tagData;
    if (tagBrowserCache.tagDataPromise) return tagBrowserCache.tagDataPromise;

    const queryWithCounts = `
      query TagBasedBrowserAllTagsWithCounts {
        findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
          tags {
            id
            name
            sort_name
            image_path
            scene_count
            studio_count
            image_count
            gallery_count
            performer_count
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
    `;

    const fallbackQuery = `
      query TagBasedBrowserAllTagsFallback {
        findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
          tags {
            id
            name
            sort_name
            image_path
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
    `;

    tagBrowserCache.tagDataPromise = (async () => {
      try {
        const data = await gqlRequest(queryWithCounts);
        tagBrowserCache.tagData = data?.findTags?.tags || [];
        return tagBrowserCache.tagData;
      } catch (err) {
        console.warn("[TagBasedBrowser] count fields unavailable, retrying without counts", err);
        const data = await gqlRequest(fallbackQuery);
        tagBrowserCache.tagData = (data?.findTags?.tags || []).map((tag) => ({
          ...tag,
          scene_count: 0,
          studio_count: 0,
          image_count: 0,
          gallery_count: 0,
          performer_count: 0,
        }));
        return tagBrowserCache.tagData;
      } finally {
        tagBrowserCache.tagDataPromise = null;
      }
    })();

    return tagBrowserCache.tagDataPromise;
  }

  function createTagMap(tags) {
    const map = new Map();

    tags.forEach((tag) => {
      map.set(String(tag.id), {
        id: String(tag.id),
        name: tag.name,
        sort_name: tag.sort_name || tag.name || "",
        image_path: tag.image_path || "",
        scene_count: getCountValue(tag, "scene_count"),
        studio_count: getCountValue(tag, "studio_count"),
        image_count: getCountValue(tag, "image_count"),
        gallery_count: getCountValue(tag, "gallery_count"),
        performer_count: getCountValue(tag, "performer_count"),
        parents: (tag.parents || []).map((parent) => ({
          id: String(parent.id),
          name: parent.name,
          sort_name: parent.sort_name || parent.name || "",
          parents: (parent.parents || []).map((grandparent) => ({
            id: String(grandparent.id),
            name: grandparent.name,
            sort_name: grandparent.sort_name || grandparent.name || "",
          })),
        })),
        childIds: (tag.children || []).map((child) => String(child.id)),
      });
    });

    map.forEach((record) => {
      record.total_count = getTotalCount(record);
    });

    return map;
  }

  function isParentTag(tagRecord) {
    return !!(tagRecord && Array.isArray(tagRecord.childIds) && tagRecord.childIds.length);
  }

  function createLeaf(tagRecord) {
    return {
      type: "leaf",
      id: tagRecord.id,
      name: tagRecord.name,
      sort_name: tagRecord.sort_name || tagRecord.name || "",
      image_path: tagRecord.image_path || "",
      scene_count: tagRecord.scene_count || 0,
      studio_count: tagRecord.studio_count || 0,
      image_count: tagRecord.image_count || 0,
      gallery_count: tagRecord.gallery_count || 0,
      performer_count: tagRecord.performer_count || 0,
      total_count: tagRecord.total_count || 0,
    };
  }

  function createEmptyCountTotals() {
    return {
      scene_count: 0,
      studio_count: 0,
      image_count: 0,
      gallery_count: 0,
      performer_count: 0,
      total_count: 0,
    };
  }

  function addCountTotals(target, source) {
    if (!target || !source) return target;
    target.scene_count += Number(source.scene_count) || 0;
    target.studio_count += Number(source.studio_count) || 0;
    target.image_count += Number(source.image_count) || 0;
    target.gallery_count += Number(source.gallery_count) || 0;
    target.performer_count += Number(source.performer_count) || 0;
    target.total_count += Number(source.total_count) || 0;
    return target;
  }

  function applyApproximateTotals(target, items) {
    const totals = createEmptyCountTotals();
    (items || []).forEach((item) => addCountTotals(totals, item));
    target.scene_count = totals.scene_count;
    target.studio_count = totals.studio_count;
    target.image_count = totals.image_count;
    target.gallery_count = totals.gallery_count;
    target.performer_count = totals.performer_count;
    target.total_count = totals.total_count;
    target.approximate_count = true;
    return target;
  }

  function getParentPaths(tagRecord, tagMap) {
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
        }
      } else {
        paths.push({
          type: "group",
          topParent: immediateParent,
        });
      }
    }

    return paths;
  }

  function buildHierarchy(tags) {
    const tagMap = createTagMap(tags);
    const topGroupsById = new Map();
    const orderedTopGroups = [];

    const ungrouped = {
      type: "group",
      parent: {
        id: "__ungrouped__",
        name: "Ungrouped",
        sort_name: "Ungrouped",
        image_path: "",
        scene_count: 0,
        studio_count: 0,
        image_count: 0,
        gallery_count: 0,
        performer_count: 0,
        total_count: 0,
      },
      items: [],
      subgroupMap: new Map(),
      leafIds: new Set(),
    };

    function ensureTopGroup(parent) {
      const parentId = String(parent.id);
      if (!topGroupsById.has(parentId)) {
        const parentRecord = tagMap.get(parentId) || parent;
        const group = {
          type: "group",
          parent: {
            id: parentId,
            name: parentRecord.name,
            sort_name: parentRecord.sort_name || parentRecord.name || "",
            image_path: parentRecord.image_path || "",
            scene_count: parentRecord.scene_count || 0,
            studio_count: parentRecord.studio_count || 0,
            image_count: parentRecord.image_count || 0,
            gallery_count: parentRecord.gallery_count || 0,
            performer_count: parentRecord.performer_count || 0,
            total_count: parentRecord.total_count || 0,
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
          scene_count: parentRecord.scene_count || 0,
          studio_count: parentRecord.studio_count || 0,
          image_count: parentRecord.image_count || 0,
          gallery_count: parentRecord.gallery_count || 0,
          performer_count: parentRecord.performer_count || 0,
          total_count: parentRecord.total_count || 0,
          children: [],
          childIds: new Set(),
        };
        topGroup.subgroupMap.set(parentRecord.id, subgroup);
        topGroup.items.push(subgroup);
      }
      return topGroup.subgroupMap.get(parentRecord.id);
    }

    function addLeafToGroup(topGroup, tagRecord) {
      if (topGroup.leafIds.has(tagRecord.id)) return;
      topGroup.items.push(createLeaf(tagRecord));
      topGroup.leafIds.add(tagRecord.id);
    }

    function addLeafToSubgroup(subgroup, tagRecord) {
      if (subgroup.childIds.has(tagRecord.id)) return;
      subgroup.children.push(createLeaf(tagRecord));
      subgroup.childIds.add(tagRecord.id);
    }

    for (const tag of tags) {
      const tagId = String(tag.id);
      const tagRecord = tagMap.get(tagId);
      if (!tagRecord) continue;

      const parentTag = isParentTag(tagRecord);
      const paths = getParentPaths(tagRecord, tagMap);

      for (const path of paths) {
        if (path.type === "ungrouped") {
          if (parentTag) continue;
          const already = ungrouped.items.some((item) => item.id === tagRecord.id);
          if (!already) {
            ungrouped.items.push(createLeaf(tagRecord));
            ungrouped.parent.total_count += tagRecord.total_count || 0;
          }
          continue;
        }

        if (path.type === "subgroup") {
          const topGroup = ensureTopGroup(path.topParent);
          const subgroup = ensureSubgroup(topGroup, path.subgroupParent);
          if (!parentTag) addLeafToSubgroup(subgroup, tagRecord);
          continue;
        }

        if (path.type === "group") {
          const topGroup = ensureTopGroup(path.topParent);
          if (!parentTag) addLeafToGroup(topGroup, tagRecord);
        }
      }
    }

    const groups = orderedTopGroups
      .map((group) => {
        group.items = group.items.filter((item) => {
          if (item.type === "leaf") return true;
          if (item.type === "subgroup") return item.children && item.children.length > 0;
          return false;
        });
        group.items.forEach((item) => {
          if (item.type === "subgroup") applyApproximateTotals(item, item.children);
        });
        applyApproximateTotals(group.parent, group.items);
        return group;
      })
      .filter((group) => group.items.length > 0);

    groups.sort((a, b) => {
      const aKey = (a.parent.sort_name || a.parent.name || "").toLowerCase();
      const bKey = (b.parent.sort_name || b.parent.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    groups.forEach((group) => {
      sortItemsBySortNameThenName(group.items);
      group.items.forEach((item) => {
        if (item.type === "subgroup") sortItemsBySortNameThenName(item.children);
      });
    });

    sortItemsBySortNameThenName(ungrouped.items);
    if (ungrouped.items.length) {
      applyApproximateTotals(ungrouped.parent, ungrouped.items);
      groups.push(ungrouped);
    }

    return {
      groups: groups.map((group) => {
        delete group.subgroupMap;
        delete group.leafIds;
        return group;
      }),
      tagMap,
    };
  }

  function buildSearchIndex(tags, tagMap) {
    const results = [];

    tags.forEach((tag) => {
      const tagRecord = tagMap.get(String(tag.id));
      if (!tagRecord) return;

      const paths = getParentPaths(tagRecord, tagMap);
      paths.forEach((path) => {
        let breadcrumb = "Ungrouped";
        let ancestorIds = [];

        if (path.type === "group") {
          breadcrumb = path.topParent.name;
          ancestorIds = [String(path.topParent.id)];
        } else if (path.type === "subgroup") {
          breadcrumb = `${path.topParent.name} > ${path.subgroupParent.name}`;
          ancestorIds = [String(path.topParent.id), String(path.subgroupParent.id)];
        }

        results.push({
          id: tagRecord.id,
          name: tagRecord.name,
          image_path: tagRecord.image_path || "",
          total_count: tagRecord.total_count || 0,
          breadcrumb,
          ancestorIds,
          normalizedName: normalizeSearchText(tagRecord.name),
          normalizedBreadcrumb: normalizeSearchText(breadcrumb),
        });
      });
    });

    results.sort((a, b) => {
      if (a.name === b.name) {
        return a.breadcrumb.localeCompare(b.breadcrumb, undefined, {
          sensitivity: "base",
        });
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return results;
  }

  function loadExpandedState() {
    try {
      const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return new Set(parsed.map(String));
    } catch (err) {
      return null;
    }
  }

  function saveExpandedState(expandedIds) {
    try {
      window.localStorage.setItem(
        EXPANDED_STORAGE_KEY,
        JSON.stringify(Array.from(expandedIds))
      );
    } catch (err) {
      void err;
    }
  }

  function getInitialExpandedIds(groups, behavior) {
    if (behavior === "expand_all") {
      return new Set((groups || []).map((group) => String(group.parent.id)));
    }
    if (behavior === "collapse_all") {
      return new Set();
    }
    return loadExpandedState() || new Set();
  }

  function clampColumnCount(tabKey, value) {
    const limits = COLUMN_COUNT_LIMITS[tabKey] || COLUMN_COUNT_LIMITS.scenes;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return limits.defaultValue;
    return Math.min(limits.max, Math.max(limits.min, Math.round(parsed)));
  }

  function getDefaultColumnCountState() {
    return TAB_DEFS.reduce((acc, tab) => {
      acc[tab.key] = COLUMN_COUNT_LIMITS[tab.key]?.defaultValue || 4;
      return acc;
    }, {});
  }

  function normalizeColumnCountState(rawState) {
    const defaults = getDefaultColumnCountState();
    TAB_DEFS.forEach((tab) => {
      defaults[tab.key] = clampColumnCount(tab.key, rawState?.[tab.key]);
    });
    return defaults;
  }

  function loadColumnCountState() {
    try {
      const raw = window.localStorage.getItem(COLUMN_COUNT_STORAGE_KEY);
      if (!raw) return getDefaultColumnCountState();
      return normalizeColumnCountState(JSON.parse(raw));
    } catch (err) {
      return getDefaultColumnCountState();
    }
  }

  function saveColumnCountState(columnState) {
    try {
      window.localStorage.setItem(
        COLUMN_COUNT_STORAGE_KEY,
        JSON.stringify(normalizeColumnCountState(columnState))
      );
    } catch (err) {
      void err;
    }
  }

  function getSortOptions(tabKey) {
    return SORT_OPTIONS[tabKey] || SORT_OPTIONS.scenes;
  }

  function normalizeSortDirection(value, fallback = "DESC") {
    return String(value || "").toUpperCase() === "ASC" ? "ASC" : fallback === "ASC" ? "ASC" : "DESC";
  }

  function normalizeSortConfig(tabKey, rawConfig) {
    const fallback = DEFAULT_SORT_STATE[tabKey] || DEFAULT_SORT_STATE.scenes;
    const allowedValues = new Set(getSortOptions(tabKey).map((option) => option.value));
    const sort =
      rawConfig?.sort === "random"
        ? "random"
        : allowedValues.has(rawConfig?.sort)
        ? rawConfig.sort
        : fallback.sort;
    const direction = normalizeSortDirection(rawConfig?.direction, fallback.direction);
    return { sort, direction };
  }

  function getDefaultSortState() {
    return TAB_DEFS.reduce((acc, tab) => {
      acc[tab.key] = normalizeSortConfig(tab.key, DEFAULT_SORT_STATE[tab.key]);
      return acc;
    }, {});
  }

  function normalizeSortState(rawState) {
    const defaults = getDefaultSortState();
    TAB_DEFS.forEach((tab) => {
      defaults[tab.key] = normalizeSortConfig(tab.key, rawState?.[tab.key]);
    });
    return defaults;
  }

  function loadSortState() {
    try {
      const raw = window.localStorage.getItem(SORT_STATE_STORAGE_KEY);
      if (!raw) return getDefaultSortState();
      return normalizeSortState(JSON.parse(raw));
    } catch (err) {
      return getDefaultSortState();
    }
  }

  function saveSortState(sortState) {
    try {
      window.localStorage.setItem(
        SORT_STATE_STORAGE_KEY,
        JSON.stringify(normalizeSortState(sortState))
      );
    } catch (err) {
      void err;
    }
  }

  function normalizeSelectionMode(value) {
    return String(value || "").toLowerCase() === "multi" ? "multi" : "single";
  }

  function normalizeMatchMode(value) {
    return String(value || "").toLowerCase() === "all" ? "all" : "any";
  }

  function normalizeSubTagContent(value) {
    return String(value || "").toLowerCase() === "exclude" ? "exclude" : "include";
  }

  function normalizeSelectionUiState(rawState) {
    return {
      mode: normalizeSelectionMode(rawState?.mode || DEFAULT_SELECTION_UI_STATE.mode),
      matchMode: normalizeMatchMode(rawState?.matchMode || DEFAULT_SELECTION_UI_STATE.matchMode),
      subTagContent: normalizeSubTagContent(
        rawState?.subTagContent || DEFAULT_SELECTION_UI_STATE.subTagContent
      ),
    };
  }

  function loadSelectionUiState() {
    try {
      const raw = window.localStorage.getItem(SELECTION_UI_STORAGE_KEY);
      if (!raw) return normalizeSelectionUiState(DEFAULT_SELECTION_UI_STATE);
      return normalizeSelectionUiState(JSON.parse(raw));
    } catch (err) {
      return normalizeSelectionUiState(DEFAULT_SELECTION_UI_STATE);
    }
  }

  function saveSelectionUiState(state) {
    try {
      window.localStorage.setItem(
        SELECTION_UI_STORAGE_KEY,
        JSON.stringify(normalizeSelectionUiState(state))
      );
    } catch (err) {
      void err;
    }
  }

  function parseRouteState() {
    const url = new URL(window.location.href);
    const tagId = String(url.searchParams.get("tag") || "").trim();
    const tab = String(url.searchParams.get("tab") || DEFAULT_TAB).trim().toLowerCase();
    const page = parseInt(String(url.searchParams.get("page") || "1"), 10);

    return {
      tagId,
      tab: TAB_DEFS.some((item) => item.key === tab) ? tab : DEFAULT_TAB,
      page: Number.isFinite(page) && page > 0 ? page : 1,
    };
  }

  function writeRouteState(tagId, tab, page) {
    if (window.location.pathname !== ROUTE_PATH) return;
    const url = new URL(window.location.href);
    if (tagId) url.searchParams.set("tag", String(tagId));
    else url.searchParams.delete("tag");
    if (tab && tab !== DEFAULT_TAB) url.searchParams.set("tab", tab);
    else url.searchParams.delete("tab");
    if (page > 1) url.searchParams.set("page", String(page));
    else url.searchParams.delete("page");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function openNativeTagPage(tagId) {
    if (!tagId) return;
    window.open(`/tags/${tagId}`, "_blank", "noopener");
  }

  function navigateInternalPath(path) {
    if (!path) return;
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function handleInternalLinkClick(event, path) {
    if (!path) return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigateInternalPath(path);
  }

  function handleTagClick(event, tagId, onSelect) {
    if (!tagId) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      openNativeTagPage(tagId);
      return;
    }
    event.preventDefault();
    onSelect(tagId);
  }

  function handleTagAuxClick(event, tagId) {
    if (event.button !== 1 || !tagId) return;
    event.preventDefault();
    openNativeTagPage(tagId);
  }

  function getTagMatchModifier(matchMode) {
    return String(matchMode).toLowerCase() === "all" ? "INCLUDES_ALL" : "INCLUDES";
  }

  function getDisplayTagNames(tagIds, tagMap, limit = 3) {
    const names = (tagIds || [])
      .map((id) => tagMap.get(String(id))?.name || "")
      .filter(Boolean);
    if (!names.length) return "";
    if (names.length <= limit) return names.join(", ");
    const visible = names.slice(0, limit).join(", ");
    return `${visible}, +${names.length - limit} more`;
  }

  function getApproxTabCount(tagIds, tagMap, countKey) {
    return (tagIds || []).reduce(
      (sum, id) => sum + getCountValue(tagMap.get(String(id)), countKey),
      0
    );
  }

  function getTagAndDescendantIds(tagId, tagMap) {
    const rootId = String(tagId || "");
    if (!rootId) return [];
    const ids = [];
    const visited = new Set();
    const stack = [rootId];

    while (stack.length) {
      const currentId = String(stack.pop());
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);
      ids.push(currentId);

      const record = tagMap.get(currentId);
      const childIds = Array.isArray(record?.childIds) ? record.childIds : [];
      childIds.forEach((childId) => {
        const normalized = String(childId);
        if (!visited.has(normalized)) stack.push(normalized);
      });
    }

    return ids;
  }

  async function fetchContentPage(tagIds, tab, page, sortConfig, matchMode) {
    const normalizedTagIds = Array.from(
      new Set((Array.isArray(tagIds) ? tagIds : [tagIds]).map(String).filter(Boolean))
    );
    if (!normalizedTagIds.length) {
      return { count: 0, items: [] };
    }

    const normalizedSort = normalizeSortConfig(tab, sortConfig);
    const tagModifier = getTagMatchModifier(matchMode);
    const filter = {
      per_page: PAGE_SIZE,
      page,
      sort: normalizedSort.sort,
    };
    if (normalizedSort.sort !== "random") {
      filter.direction = normalizedSort.direction;
    }
    const variables = {
      tagIds: normalizedTagIds,
      filter,
    };

    switch (tab) {
      case "studios": {
        try {
          const data = await gqlRequest(
            `
              query TagBasedBrowserStudios($tagIds: [ID!]!, $filter: FindFilterType) {
                findStudios(
                  studio_filter: { tags: { value: $tagIds, modifier: ${tagModifier} } }
                  filter: $filter
                ) {
                  count
                  studios {
                    id
                    name
                    image_path
                    rating100
                    scene_count
                    image_count
                    gallery_count
                    performers {
                      id
                      name
                    }
                  }
                }
              }
            `,
            variables
          );
          return {
            count: data?.findStudios?.count || 0,
            items: data?.findStudios?.studios || [],
          };
        } catch (err) {
          const data = await gqlRequest(
            `
              query TagBasedBrowserStudiosFallback($tagIds: [ID!]!, $filter: FindFilterType) {
                findStudios(
                  studio_filter: { tags: { value: $tagIds, modifier: ${tagModifier} } }
                  filter: $filter
                ) {
                  count
                  studios {
                    id
                    name
                    image_path
                    rating100
                    scene_count
                    image_count
                    gallery_count
                  }
                }
              }
            `,
            variables
          );
          return {
            count: data?.findStudios?.count || 0,
            items: (data?.findStudios?.studios || []).map((studio) => ({
              ...studio,
              performers: [],
            })),
          };
        }
      }

      case "images": {
        const data = await gqlRequest(
          `
            query TagBasedBrowserImages($tagIds: [ID!]!, $filter: FindFilterType) {
              findImages(
                image_filter: { tags: { value: $tagIds, modifier: ${tagModifier} } }
                filter: $filter
              ) {
                count
                images {
                  id
                  title
                  rating100
                  galleries {
                    id
                    title
                  }
                  performers {
                    id
                    name
                  }
                  paths {
                    thumbnail
                    image
                  }
                }
              }
            }
          `,
          variables
        );
        return {
          count: data?.findImages?.count || 0,
          items: data?.findImages?.images || [],
        };
      }

      case "galleries": {
        const data = await gqlRequest(
          `
            query TagBasedBrowserGalleries($tagIds: [ID!]!, $filter: FindFilterType) {
              findGalleries(
                gallery_filter: { tags: { value: $tagIds, modifier: ${tagModifier} } }
                filter: $filter
              ) {
                count
                galleries {
                  id
                  title
                  date
                  rating100
                  image_count
                  files {
                    basename
                    path
                  }
                  performers {
                    id
                    name
                  }
                  paths {
                    cover
                  }
                }
              }
            }
          `,
          variables
        );
        return {
          count: data?.findGalleries?.count || 0,
          items: data?.findGalleries?.galleries || [],
        };
      }

      case "performers": {
        const data = await gqlRequest(
          `
            query TagBasedBrowserPerformers($tagIds: [ID!]!, $filter: FindFilterType) {
              findPerformers(
                performer_filter: { tags: { value: $tagIds, modifier: ${tagModifier} } }
                filter: $filter
              ) {
                count
                performers {
                  id
                  name
                  disambiguation
                  birthdate
                  gender
                  image_path
                  rating100
                  scene_count
                  image_count
                  gallery_count
                }
              }
            }
          `,
          variables
        );
        return {
          count: data?.findPerformers?.count || 0,
          items: data?.findPerformers?.performers || [],
        };
      }

      case "scenes":
      default: {
        const data = await gqlRequest(
          `
            query TagBasedBrowserScenes($tagIds: [ID!]!, $filter: FindFilterType) {
              findScenes(
                scene_filter: { tags: { value: $tagIds, modifier: ${tagModifier} } }
                filter: $filter
              ) {
                count
                scenes {
                  id
                  title
                  date
                  rating100
                  performers {
                    id
                    name
                  }
                  paths {
                    screenshot
                    preview
                  }
                  studio {
                    id
                    name
                  }
                }
              }
            }
          `,
          variables
        );
        return {
          count: data?.findScenes?.count || 0,
          items: data?.findScenes?.scenes || [],
        };
      }
    }
  }

  function formatCount(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

  function formatImageCountLabel(value) {
    const count = Number(value) || 0;
    return `${formatCount(count)} ${count === 1 ? "image" : "images"}`;
  }

  function formatDate(value) {
    if (!value) return "";
    return String(value).split("-").join("/");
  }

  function formatRating(value) {
    const rating = Number(value);
    return Number.isFinite(rating) && rating > 0 ? `${rating}/100` : "Unrated";
  }

  function formatGender(value) {
    if (!value) return "";
    return String(value)
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function getGenderGlyph(value) {
    switch (String(value || "").toUpperCase()) {
      case "MALE":
      case "TRANSGENDER_MALE":
        return "♂️";
      case "FEMALE":
      case "TRANSGENDER_FEMALE":
        return "♀️";
      case "INTERSEX":
      case "NON_BINARY":
        return "⚧️";
      default:
        return "";
    }
  }

  function getAgeFromBirthdate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    const monthDiff = now.getMonth() - date.getMonth();
    const beforeBirthday =
      monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate());
    if (beforeBirthday) age -= 1;
    return age >= 0 ? age : null;
  }

  function getBasenameFromPath(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const normalized = text.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  }

  function getGalleryDisplayTitle(item) {
    if (item?.title) return item.title;
    const firstFile = Array.isArray(item?.files) ? item.files[0] : null;
    return firstFile?.basename || getBasenameFromPath(firstFile?.path) || `Gallery ${item?.id}`;
  }

  function renderCountBadge(count, approximate = false) {
    return h(
      "span",
      {
        className: "tag-browser__count-badge",
        title: approximate ? "Approximate summed content count" : null,
      },
      formatCount(count)
    );
  }

  function renderTypeCountBadge(icon, count, label, approximate = false) {
    return h(
      "span",
      {
        className: "tag-browser__count-detail",
        title: `${approximate ? "Approximate " : ""}${formatCount(count)} ${label}`,
      },
      h(FontAwesomeSvgIcon, {
        icon,
        className: "tag-browser__count-detail-icon",
        title: null,
      }),
      h("span", null, formatCount(count))
    );
  }

  function renderTreeCountMeta(node, approximate = false, showDetailed = true) {
    return h(
      getFragment(),
      null,
      showDetailed
        ? h(
            getFragment(),
            null,
            renderTypeCountBadge("faFilm", node.scene_count || 0, "scenes", approximate),
            renderTypeCountBadge("faImage", node.image_count || 0, "images", approximate),
            renderTypeCountBadge("faImages", node.gallery_count || 0, "galleries", approximate),
            renderTypeCountBadge("faImagePortrait", node.performer_count || 0, "performers", approximate)
          )
        : null,
      renderCountBadge(node.total_count, approximate)
    );
  }

  function SelectionModeControl(props) {
    const { value, onChange } = props;
    return h(
      "div",
      { className: "tag-browser__selection-control" },
      h("span", { className: "tag-browser__selection-label" }, "Selection"),
      h(
        "div",
        { className: "tag-browser__selection-toggle-group" },
        ["single", "multi"].map((mode) =>
          h(
            "button",
            {
              key: mode,
              type: "button",
              className: classNames(
                "tag-browser__selection-toggle",
                value === mode && "is-active"
              ),
              onClick: () => onChange(mode),
            },
            mode === "single" ? "Single" : "Multi"
          )
        )
      )
    );
  }

  function MatchModeControl(props) {
    const { value, disabled, onChange } = props;
    return h(
      "div",
      { className: "tag-browser__selection-control" },
      h("span", { className: "tag-browser__selection-label" }, "Match Rule"),
      h(
        "div",
        { className: "tag-browser__selection-toggle-group" },
        ["any", "all"].map((mode) =>
          h(
            "button",
            {
              key: mode,
              type: "button",
              disabled,
              className: classNames(
                "tag-browser__selection-toggle",
                value === mode && "is-active",
                disabled && "is-disabled"
              ),
              onClick: () => onChange(mode),
              title: disabled ? "Match rule is used in multi-select mode" : null,
            },
            mode.toUpperCase()
          )
        )
      )
    );
  }

  function SubTagContentControl(props) {
    const { value, disabled, onChange } = props;
    return h(
      "div",
      { className: "tag-browser__selection-control" },
      h("span", { className: "tag-browser__selection-label" }, "Sub Tag Content"),
      h(
        "div",
        { className: "tag-browser__selection-toggle-group" },
        ["include", "exclude"].map((mode) =>
          h(
            "button",
            {
              key: mode,
              type: "button",
              disabled,
              className: classNames(
                "tag-browser__selection-toggle",
                value === mode && "is-active",
                disabled && "is-disabled"
              ),
              onClick: () => onChange(mode),
              title: disabled
                ? "Sub tag content is only applied in single mode or multi ANY mode"
                : null,
            },
            mode === "include" ? "Include" : "Exclude"
          )
        )
      )
    );
  }

  function renderTagSelectButton(nodeId, isIncluded, enabled, onToggle) {
    if (!enabled) return null;
    return h(
      "button",
      {
        type: "button",
        className: classNames(
          "tag-browser__tree-select-button",
          isIncluded && "is-active"
        ),
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle(nodeId);
        },
        title: isIncluded ? "Remove tag from selection" : "Add tag to selection",
      },
      isIncluded ? "−" : "+"
    );
  }

  function SelectedTagsStrip(props) {
    const { ids, tagMap, onRemove } = props;
    if (!ids.length) return null;
    return h(
      "div",
      { className: "tag-browser__selected-tags" },
      ids.map((id) => {
        const tag = tagMap.get(String(id));
        if (!tag) return null;
        return h(
          "button",
          {
            key: id,
            type: "button",
            className: "tag-browser__selected-tag-chip",
            onClick: () => onRemove(id),
            title: `Remove ${tag.name} from multi-selection`,
          },
          h("span", null, tag.name),
          h("span", { className: "tag-browser__selected-tag-chip-remove", "aria-hidden": "true" }, "×")
        );
      })
    );
  }

  function TreeLeaf(props) {
    const {
      node,
      selectedTagId,
      selectedTagIds,
      multiSelectEnabled,
      onToggleTagSelect,
      onSelect,
      registerRef,
      showDetailedTreeCounts,
    } = props;
    const isSelected = String(selectedTagId) === String(node.id);
    const isIncluded = selectedTagIds.has(String(node.id));

    return h(
      "div",
      {
        ref: (el) => registerRef(node.id, el),
        className: classNames(
          "tag-browser__tree-item",
          "tag-browser__tree-item--leaf",
          isSelected && "is-selected",
          isIncluded && "is-included"
        ),
        role: "button",
        tabIndex: 0,
        onClick: (event) => handleTagClick(event, node.id, onSelect),
        onAuxClick: (event) => handleTagAuxClick(event, node.id),
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect(node.id);
        },
        title: node.name,
      },
      h(
        "div",
        { className: "tag-browser__tree-row-left" },
        renderTagSelectButton(node.id, isIncluded, true, onToggleTagSelect),
        h("span", { className: "tag-browser__tree-item-main" }, h("span", { className: "tag-browser__tree-item-name" }, node.name))
      ),
      h(
        "div",
        { className: "tag-browser__tree-item-actions" },
        renderTreeCountMeta(node, false, showDetailedTreeCounts)
      )
    );
  }
  function TreeSubgroup(props) {
    const {
      node,
      expandedIds,
      selectedTagId,
      selectedTagIds,
      multiSelectEnabled,
      onToggleTagSelect,
      onToggle,
      onSelect,
      registerRef,
      showDetailedTreeCounts,
    } = props;
    const expanded = expandedIds.has(String(node.id));
    const isSelected = String(selectedTagId) === String(node.id);
    const isIncluded = selectedTagIds.has(String(node.id));

    return h(
      "div",
      {
        className: classNames(
          "tag-browser__subgroup",
          expanded && "is-expanded"
        ),
      },
      h(
        "div",
        {
          ref: (el) => registerRef(node.id, el),
          className: classNames(
            "tag-browser__subgroup-header",
            isSelected && "is-selected",
            isIncluded && "is-included"
          ),
          onClick: () => onToggle(node.id),
          onAuxClick: (event) => handleTagAuxClick(event, node.id),
        },
        h(
          "div",
          { className: "tag-browser__tree-row-left" },
          h(
            "button",
            {
              type: "button",
              className: "tag-browser__tree-toggle",
              onClick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggle(node.id);
              },
              "aria-expanded": expanded ? "true" : "false",
              title: expanded ? "Collapse subgroup" : "Expand subgroup",
            },
            expanded ? "▾" : "▸"
          ),
          renderTagSelectButton(node.id, isIncluded, true, onToggleTagSelect),
          h(
            "button",
            {
              type: "button",
              className: "tag-browser__subgroup-main",
              onClick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggle(node.id);
              },
              onAuxClick: (event) => handleTagAuxClick(event, node.id),
              title: node.name,
            },
            h("span", { className: "tag-browser__tree-item-name" }, node.name)
          )
        ),
        h(
          "div",
          { className: "tag-browser__tree-item-actions" },
          renderTreeCountMeta(node, !!node.approximate_count, showDetailedTreeCounts)
        )
      ),
      expanded &&
        h(
          "div",
          { className: "tag-browser__subgroup-children" },
          node.children.map((child) =>
            h(TreeLeaf, {
              key: child.id,
              node: child,
              selectedTagId,
              selectedTagIds,
              multiSelectEnabled,
              onToggleTagSelect,
              onSelect,
              registerRef,
              showDetailedTreeCounts,
            })
          )
        )
    );
  }
  function TreeGroup(props) {
    const {
      group,
      expandedIds,
      selectedTagId,
      selectedTagIds,
      multiSelectEnabled,
      onToggleTagSelect,
      onToggle,
      onSelect,
      registerRef,
      showDetailedTreeCounts,
    } = props;
    const expanded = expandedIds.has(String(group.parent.id));
    const isSelected = String(selectedTagId) === String(group.parent.id);
    const isIncluded = selectedTagIds.has(String(group.parent.id));

    return h(
      "section",
      {
        className: classNames(
          "tag-browser__group",
          expanded && "is-expanded"
        ),
      },
      h(
        "div",
        {
          ref: (el) => registerRef(group.parent.id, el),
          className: classNames(
            "tag-browser__group-header",
            isSelected && "is-selected",
            isIncluded && "is-included"
          ),
          onClick: () => onToggle(group.parent.id),
          onAuxClick: (event) => handleTagAuxClick(event, group.parent.id),
        },
        h(
          "div",
          { className: "tag-browser__tree-row-left" },
          h(
            "button",
            {
              type: "button",
              className: "tag-browser__tree-toggle",
              onClick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggle(group.parent.id);
              },
              "aria-expanded": expanded ? "true" : "false",
              title: expanded ? "Collapse group" : "Expand group",
            },
            expanded ? "▾" : "▸"
          ),
          renderTagSelectButton(group.parent.id, isIncluded, true, onToggleTagSelect),
          h(
            "button",
            {
              type: "button",
              className: "tag-browser__group-main",
              onClick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggle(group.parent.id);
              },
              onAuxClick: (event) => handleTagAuxClick(event, group.parent.id),
              title: group.parent.name,
            },
            h("span", { className: "tag-browser__tree-item-name" }, group.parent.name)
          )
        ),
        h(
          "div",
          { className: "tag-browser__tree-item-actions" },
          renderTreeCountMeta(
            group.parent,
            !!group.parent.approximate_count,
            showDetailedTreeCounts
          )
        )
      ),
      expanded &&
        h(
          "div",
          { className: "tag-browser__group-body" },
          group.items.map((item) =>
            item.type === "subgroup"
              ? h(TreeSubgroup, {
                  key: item.id,
                  node: item,
                  expandedIds,
                  selectedTagId,
                  selectedTagIds,
                  multiSelectEnabled,
                  onToggleTagSelect,
                  onToggle,
                  onSelect,
                  registerRef,
                  showDetailedTreeCounts,
                })
              : h(TreeLeaf, {
                  key: item.id,
                  node: item,
                  selectedTagId,
                  selectedTagIds,
                  multiSelectEnabled,
                  onToggleTagSelect,
                  onSelect,
                  registerRef,
                  showDetailedTreeCounts,
                })
          )
        )
    );
  }
  function SearchResults(props) {
    const { results, onSelectResult } = props;
    if (!results.length) {
      return h(
        "div",
        { className: "tag-browser__search-empty" },
        "No matching tags found."
      );
    }

    return h(
      "div",
      { className: "tag-browser__search-results" },
      results.map((result) =>
        h(
          "button",
          {
            key: `${result.id}:${result.breadcrumb}`,
            type: "button",
            className: "tag-browser__search-result",
            onClick: () => onSelectResult(result),
            onAuxClick: (event) => handleTagAuxClick(event, result.id),
            title: `${result.name} • ${result.breadcrumb}`,
          },
          h(
            "span",
            { className: "tag-browser__search-result-main" },
            h("span", { className: "tag-browser__search-result-name" }, result.name),
            h(
              "span",
              { className: "tag-browser__search-result-path" },
              result.breadcrumb
            )
          ),
          renderCountBadge(result.total_count)
        )
      )
    );
  }

  function TabButton(props) {
    const { tab, activeTab, count, approximate, onChange } = props;
    return h(
      "button",
      {
        type: "button",
        className: classNames(
          "tag-browser__tab",
          activeTab === tab.key && "is-active"
        ),
        onClick: () => onChange(tab.key),
      },
      h(
        "span",
        { className: "tag-browser__tab-label" },
        h("span", null, tab.label)
      ),
      h(
        "span",
        {
          className: "tag-browser__tab-count",
          title: approximate ? "Approximate summed content count" : null,
        },
        formatCount(count)
      )
    );
  }

  function SceneCard({ item }) {
    const href = `/scenes/${item.id}`;
    const performers = Array.isArray(item.performers)
      ? item.performers.filter((performer) => performer?.name)
      : [];
    const performerNames = performers.map((performer) => performer.name).join(", ");
    return h(
      "a",
      {
        className: "tag-browser__card tag-browser__card--media tag-browser__card--scene",
        href,
        onClick: (event) => handleInternalLinkClick(event, href),
      },
      h(
        "div",
        { className: "tag-browser__card-image-wrap" },
        item?.paths?.screenshot
          ? h("img", {
              className: "tag-browser__card-image",
              src: item.paths.screenshot,
              alt: item.title || `Scene ${item.id}`,
              loading: "lazy",
            })
          : h("div", { className: "tag-browser__card-placeholder" }, "Scene"),
        item?.paths?.preview ? h("span", { className: "tag-browser__card-chip" }, "Preview") : null
      ),
      h(
        "div",
        { className: "tag-browser__card-body" },
        h("div", { className: "tag-browser__card-title" }, item.title || `Scene ${item.id}`),
        h(
          "div",
          { className: "tag-browser__scene-meta-row" },
          h(
            "span",
            { className: "tag-browser__card-meta" },
            item?.studio?.name || "Scene"
          ),
          h(
            "span",
            { className: "tag-browser__card-meta" },
            formatDate(item.date) || ""
          )
        ),
        performers.length
          ? h(
              "div",
              { className: "tag-browser__gallery-meta" },
              h(
                "span",
                {
                  className: "tag-browser__gallery-meta-item",
                  title: performerNames,
                },
                h(FontAwesomeSvgIcon, {
                  icon: "faImagePortrait",
                  className: "tag-browser__gallery-meta-icon",
                  title: null,
                }),
                h("span", null, formatCount(performers.length))
              )
            )
          : null
      )
    );
  }

  function StudioCard({ item }) {
    const href = `/studios/${item.id}`;
    const performers = Array.isArray(item.performers)
      ? item.performers.filter((performer) => performer?.name)
      : [];
    const performerNames = performers.map((performer) => performer.name).join(", ");
    return h(
      "a",
      {
        className: "tag-browser__card tag-browser__card--media tag-browser__card--studio",
        href,
        onClick: (event) => handleInternalLinkClick(event, href),
      },
      h(
        "div",
        { className: "tag-browser__card-image-wrap" },
        item?.image_path
          ? h("img", {
              className: "tag-browser__card-image",
              src: item.image_path,
              alt: item.name || `Studio ${item.id}`,
              loading: "lazy",
            })
          : h("div", { className: "tag-browser__card-placeholder" }, "Studio")
      ),
      h(
        "div",
        { className: "tag-browser__card-body" },
        h("div", { className: "tag-browser__card-title" }, item.name || `Studio ${item.id}`),
        h(
          "div",
          { className: "tag-browser__gallery-meta" },
          h(
            "span",
            {
              className: "tag-browser__gallery-meta-item",
              title: "Scenes",
            },
            h(FontAwesomeSvgIcon, {
              icon: "faFilm",
              className: "tag-browser__gallery-meta-icon",
              title: null,
            }),
            h("span", null, formatCount(item.scene_count))
          ),
          h(
            "span",
            {
              className: "tag-browser__gallery-meta-item",
              title: "Galleries",
            },
            h(FontAwesomeSvgIcon, {
              icon: "faImages",
              className: "tag-browser__gallery-meta-icon",
              title: null,
            }),
            h("span", null, formatCount(item.gallery_count))
          ),
          h(
            "span",
            {
              className: "tag-browser__gallery-meta-item",
              title: "Images",
            },
            h(FontAwesomeSvgIcon, {
              icon: "faImage",
              className: "tag-browser__gallery-meta-icon",
              title: null,
            }),
            h("span", null, formatCount(item.image_count))
          ),
          h(
            "span",
            {
              className: "tag-browser__gallery-meta-item",
              title: performerNames || "Performers",
            },
            h(FontAwesomeSvgIcon, {
              icon: "faImagePortrait",
              className: "tag-browser__gallery-meta-icon",
              title: null,
            }),
            h("span", null, formatCount(performers.length))
          )
        )
      )
    );
  }

  function ImageCard(props) {
    const { item, onRatioReady, style } = props;
    const href = `/images/${item.id}`;
    const performers = Array.isArray(item.performers)
      ? item.performers.filter((performer) => performer?.name)
      : [];
    const performerNames = performers.map((performer) => performer.name).join(", ");
    const galleries = Array.isArray(item.galleries) ? item.galleries : [];
    return h(
      "a",
      {
        className: "tag-browser__card tag-browser__card--media tag-browser__card--image",
        href,
        style: style || null,
        onClick: (event) => handleInternalLinkClick(event, href),
      },
      h(
        "div",
        { className: "tag-browser__card-image-wrap" },
        item?.paths?.thumbnail || item?.paths?.image
          ? h("img", {
              className: "tag-browser__card-image",
              src: item.paths.thumbnail || item.paths.image,
              alt: item.title || `Image ${item.id}`,
              loading: "lazy",
              onLoad: (event) => {
                const width = event?.currentTarget?.naturalWidth || 0;
                const height = event?.currentTarget?.naturalHeight || 0;
                if (width > 0 && height > 0 && typeof onRatioReady === "function") {
                  onRatioReady(String(item.id), width / height);
                }
              },
            })
          : h("div", { className: "tag-browser__card-placeholder" }, "Image")
      ),
      h(
        "div",
        { className: "tag-browser__card-footer" },
        h("div", { className: "tag-browser__card-title" }, item.title || `Image ${item.id}`),
        h(
          "div",
          { className: "tag-browser__gallery-meta" },
          galleries.length
            ? h(
                "span",
                {
                  className: "tag-browser__gallery-meta-item",
                  title: galleries.map((gallery) => gallery.title || `Gallery ${gallery.id}`).join(", "),
                },
                h(FontAwesomeSvgIcon, {
                  icon: "faImages",
                  className: "tag-browser__gallery-meta-icon",
                  title: null,
                }),
                h("span", null, formatCount(galleries.length))
              )
            : null,
          performers.length
            ? h(
                "span",
                {
                  className: "tag-browser__gallery-meta-item",
                  title: performerNames,
                },
                h(FontAwesomeSvgIcon, {
                  icon: "faImagePortrait",
                  className: "tag-browser__gallery-meta-icon",
                  title: null,
                }),
                h("span", null, formatCount(performers.length))
              )
            : null
        )
      )
    );
  }

  function GalleryCard(props) {
    const { item, onRatioReady, style } = props;
    const href = `/galleries/${item.id}`;
    const performers = Array.isArray(item.performers)
      ? item.performers.filter((performer) => performer?.name)
      : [];
    const title = getGalleryDisplayTitle(item);
    const performerNames = performers.map((performer) => performer.name).join(", ");
    return h(
      "a",
      {
        className: "tag-browser__card tag-browser__card--media tag-browser__card--gallery",
        href,
        style: style || null,
        onClick: (event) => handleInternalLinkClick(event, href),
      },
      h(
        "div",
        { className: "tag-browser__card-image-wrap" },
        item?.paths?.cover
          ? h("img", {
              className: "tag-browser__card-image",
              src: item.paths.cover,
              alt: title,
              loading: "lazy",
              onLoad: (event) => {
                const width = event?.currentTarget?.naturalWidth || 0;
                const height = event?.currentTarget?.naturalHeight || 0;
                if (width > 0 && height > 0 && typeof onRatioReady === "function") {
                  onRatioReady(String(item.id), width / height);
                }
              },
            })
          : h("div", { className: "tag-browser__card-placeholder" }, "Gallery")
      ),
      h(
        "div",
        { className: "tag-browser__card-footer" },
        h("div", { className: "tag-browser__card-title" }, title),
        h(
          "div",
          { className: "tag-browser__gallery-meta" },
          h(
            "span",
            {
              className: "tag-browser__gallery-meta-item",
              title: formatImageCountLabel(item.image_count),
            },
            h(FontAwesomeSvgIcon, {
              icon: "faImage",
              className: "tag-browser__gallery-meta-icon",
              title: null,
            }),
            h("span", null, formatCount(item.image_count))
          ),
          performers.length
            ? h(
                "span",
                {
                  className: "tag-browser__gallery-meta-item",
                  title: performerNames,
                },
                h(FontAwesomeSvgIcon, {
                  icon: "faImagePortrait",
                  className: "tag-browser__gallery-meta-icon",
                  title: null,
                }),
                h("span", null, formatCount(performers.length))
              )
            : null
        )
      )
    );
  }

  function PerformerCard({ item }) {
    const title = item.disambiguation ? `${item.name} (${item.disambiguation})` : item.name;
    const href = `/performers/${item.id}`;
    const genderGlyph = getGenderGlyph(item.gender);
    const age = getAgeFromBirthdate(item.birthdate);
    const countsContent = h(
      getFragment(),
      null,
      h(
        "span",
        { className: "tag-browser__performer-count-item", title: "Scenes" },
        h(FontAwesomeSvgIcon, {
          icon: "faFilm",
          className: "tag-browser__performer-count-icon",
          title: "Scenes",
        }),
        h("span", null, formatCount(item.scene_count))
      ),
      h("span", { className: "tag-browser__performer-count-separator", "aria-hidden": "true" }, "•"),
      h(
        "span",
        { className: "tag-browser__performer-count-item", title: "Images" },
        h(FontAwesomeSvgIcon, {
          icon: "faImage",
          className: "tag-browser__performer-count-icon",
          title: "Images",
        }),
        h("span", null, formatCount(item.image_count))
      ),
      h("span", { className: "tag-browser__performer-count-separator", "aria-hidden": "true" }, "•"),
      h(
        "span",
        { className: "tag-browser__performer-count-item", title: "Galleries" },
        h(FontAwesomeSvgIcon, {
          icon: "faImages",
          className: "tag-browser__performer-count-icon",
          title: "Galleries",
        }),
        h("span", null, formatCount(item.gallery_count))
      )
    );
    return h(
      "a",
      {
        className:
          "tag-browser__card tag-browser__card--media tag-browser__card--performer performer-card card",
        href,
        onClick: (event) => handleInternalLinkClick(event, href),
      },
      h(
        "div",
        { className: "tag-browser__card-image-wrap thumbnail-section" },
        item.image_path
          ? h("img", {
              className: "tag-browser__card-image performer-card-image",
              src: item.image_path,
              alt: item.name,
              loading: "lazy",
            })
          : h("div", { className: "tag-browser__card-placeholder" }, "Performer"),
        h("div", { className: "tag-browser__performer-rating" }, formatRating(item.rating100))
      ),
      h(
        "div",
        { className: "tag-browser__card-body tag-browser__card-body--performer card-section" },
        h(
          "div",
          { className: "card-section-title tag-browser__performer-title-row" },
          h(
            "div",
            { className: "tag-browser__performer-title-main" },
            genderGlyph
              ? h("span", { className: "gender-icon tag-browser__performer-glyph", title: formatGender(item.gender) }, genderGlyph)
              : null,
            h("div", { className: "performer-name tag-browser__card-title" }, title)
          ),
          age !== null
            ? h("span", { className: "performer-card__age tag-browser__performer-age" }, String(age))
            : null
        ),
        h(
          "div",
          { className: "tag-browser__performer-native-counts" },
          countsContent
        )
      )
    );
  }

  function CardSizeControl(props) {
    const { tab, value, onChange } = props;
    const tabLabel = TAB_DEFS.find((item) => item.key === tab)?.label || "Content";
    const limits = COLUMN_COUNT_LIMITS[tab] || COLUMN_COUNT_LIMITS.scenes;

    return h(
      "label",
      { className: "tag-browser__card-size-control" },
      h("span", { className: "tag-browser__card-size-label" }, `${tabLabel} columns`),
      h("input", {
        className: "tag-browser__card-size-slider",
        type: "range",
        min: String(limits.min),
        max: String(limits.max),
        step: "1",
        value: String(clampColumnCount(tab, value)),
        onChange: (event) => onChange(clampColumnCount(tab, event.target.value)),
      }),
      h("span", { className: "tag-browser__card-size-value" }, String(clampColumnCount(tab, value)))
    );
  }

  function SortControl(props) {
    const { tab, value, onChange } = props;
    const normalized = normalizeSortConfig(tab, value);
    const options = getSortOptions(tab);
    const isRandom = normalized.sort === "random";

    return h(
      "div",
      { className: "tag-browser__sort-control" },
      h("span", { className: "tag-browser__sort-label" }, "Sort"),
      h(
        "select",
        {
          className: "tag-browser__sort-select",
          value: normalized.sort,
          onChange: (event) =>
            onChange({
              ...normalized,
              sort: event.target.value,
            }),
        },
        options.map((option) =>
          h(
            "option",
            {
              key: option.value,
              value: option.value,
            },
            option.label
          )
        )
      ),
      h(
        "button",
        {
          type: "button",
          className: classNames(
            "tag-browser__sort-button",
            isRandom && "is-disabled"
          ),
          disabled: isRandom,
          title: isRandom
            ? "Direction is disabled while random sort is active"
            : normalized.direction === "ASC"
            ? "Ascending"
            : "Descending",
          onClick: () =>
            onChange({
              ...normalized,
              direction: normalized.direction === "ASC" ? "DESC" : "ASC",
            }),
        },
        normalized.direction === "ASC" ? "Asc" : "Desc"
      ),
      h(
        "button",
        {
          type: "button",
          className: classNames(
            "tag-browser__sort-button",
            isRandom && "is-active"
          ),
          title: "Random order",
          onClick: () =>
            onChange({
              ...normalized,
              sort: isRandom ? (DEFAULT_SORT_STATE[tab] || DEFAULT_SORT_STATE.scenes).sort : "random",
              direction: (DEFAULT_SORT_STATE[tab] || DEFAULT_SORT_STATE.scenes).direction,
            }),
        },
        "Random"
      )
    );
  }

  function chunkItems(items, size) {
    const result = [];
    for (let index = 0; index < items.length; index += size) {
      result.push(items.slice(index, index + size));
    }
    return result;
  }

  function JustifiedMediaGrid(props) {
    const { items, columns, CardComponent } = props;
    const containerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [ratioMap, setRatioMap] = useState({});

    useEffect(() => {
      const element = containerRef.current;
      if (!element) return undefined;

      const measure = () => {
        const nextWidth = Math.floor(element.clientWidth || 0);
        setContainerWidth((previous) => (previous === nextWidth ? previous : nextWidth));
      };

      measure();

      let resizeObserver = null;
      if (typeof window.ResizeObserver === "function") {
        resizeObserver = new window.ResizeObserver(measure);
        resizeObserver.observe(element);
      }

      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
        if (resizeObserver) resizeObserver.disconnect();
      };
    }, []);

    const handleRatioReady = useCallback((id, ratio) => {
      if (!(ratio > 0)) return;
      setRatioMap((previous) => {
        if (previous[id] === ratio) return previous;
        return {
          ...previous,
          [id]: ratio,
        };
      });
    }, []);

    const rows = useMemo(() => {
      const safeColumns = Math.max(1, Number(columns) || 1);
      const groups = chunkItems(items, safeColumns);
      return groups.map((rowItems, rowIndex) => {
        const ratios = rowItems.map((item) => ratioMap[String(item.id)] || 1);
        const gapCount = Math.max(rowItems.length - 1, 0);
        const availableWidth = Math.max(containerWidth - gapCount * JUSTIFIED_ROW_GAP_PX, 240);
        const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio, 0) || rowItems.length || 1;
        const rowHeight = availableWidth / ratioTotal;
        return {
          key: `row:${rowIndex}`,
          rowHeight,
          items: rowItems.map((item, itemIndex) => ({
            item,
            width: rowHeight * ratios[itemIndex],
          })),
        };
      });
    }, [columns, containerWidth, items, ratioMap]);

    return h(
      "div",
      {
        className: "tag-browser__justified-grid",
        ref: containerRef,
      },
      rows.map((row) =>
        h(
          "div",
          {
            key: row.key,
            className: "tag-browser__justified-row",
            style: {
              gap: `${JUSTIFIED_ROW_GAP_PX}px`,
            },
          },
          row.items.map(({ item, width }) =>
            h(CardComponent, {
              key: item.id,
              item,
              onRatioReady: handleRatioReady,
              style: {
                width: `${Math.max(width, 120)}px`,
              },
            })
          )
        )
      )
    );
  }

  function ContentGrid(props) {
    const { tab, items, columns } = props;
    if (!items.length) {
      return h(
        "div",
        { className: "tag-browser__empty-state" },
        "No content found for this tag in the selected tab."
      );
    }

    const CardComponent =
      tab === "studios"
        ? StudioCard
        : tab === "images"
        ? ImageCard
        : tab === "galleries"
        ? GalleryCard
        : tab === "performers"
        ? PerformerCard
        : SceneCard;
    const columnCount = clampColumnCount(tab, columns);

    if (tab === "galleries" || tab === "images") {
      return h(JustifiedMediaGrid, {
        items,
        columns: columnCount,
        CardComponent,
      });
    }

    return h(
      "div",
      {
        className: "tag-browser__content-grid",
        style: {
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          gap: CARD_GRID_GAP[tab] || CARD_GRID_GAP.scenes,
        },
      },
      items.map((item) => h(CardComponent, { key: item.id, item }))
    );
  }

  function Pager(props) {
    const { page, totalCount, onChange } = props;
    const totalPages = Math.max(1, Math.ceil((Number(totalCount) || 0) / PAGE_SIZE));
    if (totalPages <= 1) return null;

    return h(
      "div",
      { className: "tag-browser__pager" },
      h(
        "button",
        {
          type: "button",
          className: "tag-browser__pager-button",
          disabled: page <= 1,
          onClick: () => onChange(page - 1),
        },
        "Previous"
      ),
      h("div", { className: "tag-browser__pager-label" }, `Page ${page} of ${totalPages}`),
      h(
        "button",
        {
          type: "button",
          className: "tag-browser__pager-button",
          disabled: page >= totalPages,
          onClick: () => onChange(page + 1),
        },
        "Next"
      )
    );
  }

  function TagBasedBrowserApp() {
    const routeState = useMemo(() => parseRouteState(), []);
    const [treeState, setTreeState] = useState({
      loading: true,
      error: "",
      tags: [],
      groups: [],
      tagMap: new Map(),
      searchIndex: [],
    });
    const [expandedIds, setExpandedIds] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTagId, setSelectedTagId] = useState(routeState.tagId);
    const [selectionUiState, setSelectionUiState] = useState(() => loadSelectionUiState());
    const [configState, setConfigState] = useState(() => tagBrowserCache.config || DEFAULT_CONFIG);
    const [configLoaded, setConfigLoaded] = useState(() => !!tagBrowserCache.config);
    const [selectedTagIds, setSelectedTagIds] = useState(() =>
      routeState.tagId ? [String(routeState.tagId)] : []
    );
    const [selectedTab, setSelectedTab] = useState(routeState.tab);
    const [page, setPage] = useState(routeState.page);
    const [columnCountState, setColumnCountState] = useState(() => loadColumnCountState());
    const [sortState, setSortState] = useState(() => loadSortState());
    const [contentState, setContentState] = useState({
      loading: false,
      error: "",
      count: 0,
      items: [],
    });
    const itemRefs = useRef(new Map());
    const contentCache = useRef(tagBrowserCache.contentPages);

    useEffect(() => {
      let active = true;
      loadConfig().then((cfg) => {
        if (!active) return;
        setConfigState(cfg);
        setConfigLoaded(true);
      });
      return () => {
        active = false;
      };
    }, []);

    useEffect(() => {
      let active = true;

      if (tagBrowserCache.builtTree) {
        setTreeState({
          loading: false,
          error: "",
          tags: tagBrowserCache.builtTree.tags,
          groups: tagBrowserCache.builtTree.groups,
          tagMap: tagBrowserCache.builtTree.tagMap,
          searchIndex: tagBrowserCache.builtTree.searchIndex,
        });
        return () => {
          active = false;
        };
      }

      fetchAllTags()
        .then((tags) => {
          if (!active) return;
          const built = buildHierarchy(tags);
          const searchIndex = buildSearchIndex(tags, built.tagMap);
          tagBrowserCache.builtTree = {
            tags,
            groups: built.groups,
            tagMap: built.tagMap,
            searchIndex,
          };
          setTreeState({
            loading: false,
            error: "",
            tags,
            groups: built.groups,
            tagMap: built.tagMap,
            searchIndex,
          });
        })
        .catch((err) => {
          console.error("[TagBasedBrowser] failed to load tags", err);
          if (!active) return;
          setTreeState({
            loading: false,
            error: err?.message || "Failed to load tags.",
            tags: [],
            groups: [],
            tagMap: new Map(),
            searchIndex: [],
          });
        });

      return () => {
        active = false;
      };
    }, []);

    useEffect(() => {
      const handler = () => {
        if (window.location.pathname !== ROUTE_PATH) return;
        const next = parseRouteState();
        setSelectedTagId(next.tagId);
        setSelectedTab(next.tab);
        setPage(next.page);
      };

      window.addEventListener("popstate", handler);
      return () => window.removeEventListener("popstate", handler);
    }, []);

    useEffect(() => {
      if (expandedIds instanceof Set) return;
      if (!configLoaded) return;
      if (treeState.loading) return;
      setExpandedIds(
        getInitialExpandedIds(treeState.groups, configState.treeExpansionBehavior)
      );
    }, [expandedIds, configLoaded, treeState.loading, treeState.groups, configState.treeExpansionBehavior]);

    useEffect(() => {
      if (expandedIds instanceof Set) saveExpandedState(expandedIds);
    }, [expandedIds]);

    useEffect(() => {
      saveColumnCountState(columnCountState);
    }, [columnCountState]);

    useEffect(() => {
      saveSortState(sortState);
    }, [sortState]);

    useEffect(() => {
      saveSelectionUiState(selectionUiState);
    }, [selectionUiState]);

    useEffect(() => {
      if (selectionUiState.mode === "single") {
        if (!selectedTagId) return;
        setSelectedTagIds((prev) =>
          prev.length === 1 && String(prev[0]) === String(selectedTagId)
            ? prev
            : [String(selectedTagId)]
        );
        return;
      }
      if (selectionUiState.mode === "multi" && selectedTagId && !selectedTagIds.length) {
        setSelectedTagIds([String(selectedTagId)]);
      }
    }, [selectionUiState.mode, selectedTagId, selectedTagIds.length]);

    useEffect(() => {
      if (treeState.loading || !treeState.groups.length) return;
      if (!selectedTagId) return;
      if (treeState.tagMap.has(String(selectedTagId))) return;

      const firstGroup = treeState.groups[0];
      const fallbackId = firstGroup?.parent?.id || firstGroup?.items?.[0]?.id || "";
      if (fallbackId) {
        setSelectedTagId(String(fallbackId));
        setSelectedTagIds((prev) => (prev.length ? prev : [String(fallbackId)]));
        setPage(1);
      }
    }, [treeState, selectedTagId]);

    useEffect(() => {
      writeRouteState(selectedTagId, selectedTab, page);
    }, [selectedTagId, selectedTab, page]);

    useEffect(() => {
      if (!selectedTagId) return;
      const element = itemRefs.current.get(String(selectedTagId));
      if (element && typeof element.scrollIntoView === "function") {
        window.setTimeout(() => {
          element.scrollIntoView({ block: "nearest", inline: "nearest" });
        }, 40);
      }
    }, [selectedTagId]);

    const selectedTagIdSet = useMemo(
      () => new Set((selectedTagIds || []).map(String)),
      [selectedTagIds]
    );
    const multiSelectEnabled = selectionUiState.mode === "multi";
    const subTagContentDisabled = multiSelectEnabled && selectionUiState.matchMode === "all";
    const includeSubTagContent =
      selectionUiState.subTagContent === "include" && !subTagContentDisabled;
    const activeFilterTagIds = useMemo(() => {
      const baseIds = multiSelectEnabled
        ? Array.from(selectedTagIdSet)
        : selectedTagId
        ? [String(selectedTagId)]
        : [];
      if (!includeSubTagContent) return baseIds;

      const expandedIds = new Set();
      baseIds.forEach((tagId) => {
        getTagAndDescendantIds(tagId, treeState.tagMap).forEach((id) => expandedIds.add(id));
      });
      return Array.from(expandedIds);
    }, [
      includeSubTagContent,
      multiSelectEnabled,
      selectedTagIdSet,
      selectedTagId,
      treeState.tagMap,
    ]);
    const primaryTagId = useMemo(() => {
      if (selectedTagId) return String(selectedTagId);
      return activeFilterTagIds[0] || "";
    }, [selectedTagId, activeFilterTagIds]);

    useEffect(() => {
      if (!activeFilterTagIds.length) {
        setContentState({
          loading: false,
          error: "",
          count: 0,
          items: [],
        });
        return;
      }

      const activeSort = normalizeSortConfig(selectedTab, sortState?.[selectedTab]);
      const filterKey = activeFilterTagIds.join(",");
      const cacheKey = `${selectionUiState.mode}:${selectionUiState.matchMode}:${filterKey}:${selectedTab}:${page}:${activeSort.sort}:${activeSort.direction}`;
      if (contentCache.current.has(cacheKey)) {
        setContentState(contentCache.current.get(cacheKey));
        return;
      }

      let active = true;
      setContentState((prev) => ({ ...prev, loading: true, error: "" }));

      fetchContentPage(
        activeFilterTagIds,
        selectedTab,
        page,
        activeSort,
        selectionUiState.matchMode
      )
        .then((result) => {
          if (!active) return;
          const nextState = {
            loading: false,
            error: "",
            count: result.count || 0,
            items: result.items || [],
          };
          contentCache.current.set(cacheKey, nextState);
          setContentState(nextState);
        })
        .catch((err) => {
          if (!active) return;
          console.error("[TagBasedBrowser] failed to load content", err);
          setContentState({
            loading: false,
            error: err?.message || "Failed to load content.",
            count: 0,
            items: [],
          });
        });

      return () => {
        active = false;
      };
    }, [
      activeFilterTagIds,
      selectedTab,
      page,
      sortState,
      selectionUiState.mode,
      selectionUiState.matchMode,
    ]);

    const selectedTag = useMemo(() => {
      return treeState.tagMap.get(String(primaryTagId)) || null;
    }, [treeState.tagMap, primaryTagId]);

    const searchResults = useMemo(() => {
      const needle = normalizeSearchText(searchQuery);
      if (!needle) return [];

      return treeState.searchIndex
        .filter(
          (entry) =>
            entry.normalizedName.includes(needle) ||
            entry.normalizedBreadcrumb.includes(needle)
        )
        .sort((a, b) => {
          const aStarts = a.normalizedName.startsWith(needle) ? 0 : 1;
          const bStarts = b.normalizedName.startsWith(needle) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          if (a.name !== b.name) {
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          }
          return a.breadcrumb.localeCompare(b.breadcrumb, undefined, {
            sensitivity: "base",
          });
        })
        .slice(0, 18);
    }, [searchQuery, treeState.searchIndex]);

    const onToggle = useCallback((id) => {
      setExpandedIds((prev) => {
        const next = new Set(prev instanceof Set ? prev : []);
        const key = String(id);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }, []);

    const onSelectTag = useCallback((tagId) => {
      const nextId = String(tagId);
      setSelectedTagId((prev) => {
        return String(prev || "") === nextId ? "" : nextId;
      });
      setSelectedTagIds((prev) => {
        const current = (prev || []).map(String);
        if (selectionUiState.mode === "single") {
          if (current.length === 1 && current[0] === nextId) return [];
          return [nextId];
        }
        if (current.includes(nextId)) {
          return current.filter((id) => id !== nextId);
        }
        return current.concat(nextId);
      });
      setPage(1);
    }, [selectionUiState.mode]);

    const onToggleTagSelect = useCallback((tagId) => {
      const nextId = String(tagId);
      if (selectionUiState.mode === "single") {
        setSelectedTagIds((prev) => {
          const current = (prev || []).map(String);
          if (current.length === 1 && current[0] === nextId) return [];
          return [nextId];
        });
        setSelectedTagId((prev) => (String(prev || "") === nextId ? "" : nextId));
        setPage(1);
        return;
      }

      let removedCurrent = false;
      setSelectedTagIds((prev) => {
        const existing = new Set((prev || []).map(String));
        if (existing.has(nextId)) {
          existing.delete(nextId);
          removedCurrent = true;
        } else {
          existing.add(nextId);
        }
        return Array.from(existing);
      });
      setSelectedTagId((prev) => {
        if (String(prev || "") !== nextId) return prev;
        return removedCurrent ? "" : prev;
      });
      setPage(1);
    }, [selectionUiState.mode]);

    const onRemoveSelectedTag = useCallback((tagId) => {
      const nextId = String(tagId);
      setSelectedTagIds((prev) => prev.filter((id) => String(id) !== nextId));
      setSelectedTagId((prev) => (String(prev || "") === nextId ? "" : prev));
    }, []);

    const onSelectSearchResult = useCallback((result) => {
      setExpandedIds((prev) => {
        const next = new Set(prev instanceof Set ? prev : []);
        result.ancestorIds.forEach((id) => next.add(String(id)));
        return next;
      });
      setSelectedTagId(String(result.id));
      setSelectedTab(DEFAULT_TAB);
      setPage(1);
      setSearchQuery("");
    }, []);

    const registerRef = useCallback((id, el) => {
      const key = String(id);
      if (el) itemRefs.current.set(key, el);
      else itemRefs.current.delete(key);
    }, []);

    const activeColumnCount = clampColumnCount(selectedTab, columnCountState?.[selectedTab]);
    const activeSort = normalizeSortConfig(selectedTab, sortState?.[selectedTab]);
    const contentHasSelection = activeFilterTagIds.length > 0;
    const multiSelectionActive = multiSelectEnabled && activeFilterTagIds.length > 1;
    const contentTitle = multiSelectEnabled && selectedTagIds.length
      ? `${selectionUiState.matchMode.toUpperCase()}: ${getDisplayTagNames(
          selectedTagIds,
          treeState.tagMap
        )}`
      : selectedTag?.name || "";
    const openNativeHref = selectedTag ? `/tags/${selectedTag.id}` : "";

    if (treeState.loading) {
      return h(
        "div",
        { className: "tag-browser-page" },
        h("div", { className: "tag-browser-page__loading" }, "Loading tag browser...")
      );
    }

    if (treeState.error) {
      return h(
        "div",
        { className: "tag-browser-page" },
        h("div", { className: "tag-browser-page__error" }, treeState.error)
      );
    }

    return h(
      "div",
      { className: "tag-browser-page" },
      h(
        "div",
        { className: "tag-browser__layout" },
        h(
          "aside",
          { className: "tag-browser__sidebar" },
          h(
            "div",
            { className: "tag-browser__sidebar-header" },
            h(
              "div",
              { className: "tag-browser__sidebar-header-row" },
              h(
                "div",
                { className: "tag-browser__sidebar-header-actions" },
                h(SelectionModeControl, {
                  value: selectionUiState.mode,
                  onChange: (mode) =>
                    setSelectionUiState((prev) => {
                      const next = normalizeSelectionUiState({
                        ...prev,
                        mode,
                      });
                      if (next.mode === "single" && selectedTagId) {
                        setSelectedTagIds([String(selectedTagId)]);
                      } else if (next.mode === "multi" && selectedTagId && !selectedTagIdSet.size) {
                        setSelectedTagIds([String(selectedTagId)]);
                      }
                      return next;
                    }),
                }),
                h(SubTagContentControl, {
                  value: selectionUiState.subTagContent,
                  disabled: subTagContentDisabled,
                  onChange: (subTagContent) =>
                    setSelectionUiState((prev) =>
                      normalizeSelectionUiState({
                        ...prev,
                        subTagContent,
                      })
                    ),
                }),
                h(MatchModeControl, {
                  value: selectionUiState.matchMode,
                  disabled: !multiSelectEnabled,
                  onChange: (matchMode) =>
                    setSelectionUiState((prev) =>
                      normalizeSelectionUiState({
                        ...prev,
                        matchMode,
                      })
                    ),
                })
              )
            )
          ),
          h(
            "div",
            { className: "tag-browser__search-panel" },
            h("input", {
              className: "tag-browser__search-input",
              type: "search",
              value: searchQuery,
              onChange: (event) => setSearchQuery(event.target.value),
              placeholder: "Search tags and reveal them in the hierarchy",
            }),
            multiSelectEnabled
              ? h(SelectedTagsStrip, {
                  ids: selectedTagIds,
                  tagMap: treeState.tagMap,
                  onRemove: onRemoveSelectedTag,
                })
              : null,
            searchQuery
              ? h(SearchResults, { results: searchResults, onSelectResult: onSelectSearchResult })
              : null
          ),
          h(
            "div",
            { className: "tag-browser__tree" },
            treeState.groups.map((group) =>
              h(TreeGroup, {
                key: group.parent.id,
                group,
                expandedIds: expandedIds instanceof Set ? expandedIds : new Set(),
                selectedTagId,
                selectedTagIds: selectedTagIdSet,
                multiSelectEnabled,
                onToggleTagSelect,
                onToggle,
                onSelect: onSelectTag,
                registerRef,
                showDetailedTreeCounts: configState.showDetailedTreeCounts,
              })
            )
          )
        ),
        h(
          "main",
          { className: "tag-browser__content" },
          contentHasSelection
            ? h(
                getFragment(),
                null,
                h(
                  "div",
                  { className: "tag-browser__content-header" },
                  h(
                    "div",
                    { className: "tag-browser__content-header-main" },
                    h("h2", { className: "tag-browser__content-title" }, contentTitle)
                  ),
                  h(
                    "div",
                    { className: "tag-browser__tabs tag-browser__tabs--header" },
                    TAB_DEFS.map((tab) =>
                      h(TabButton, {
                        key: tab.key,
                        tab,
                        activeTab: selectedTab,
                        count:
                          multiSelectionActive
                            ? getApproxTabCount(activeFilterTagIds, treeState.tagMap, tab.countKey)
                            : getCountValue(selectedTag, tab.countKey),
                        approximate: multiSelectionActive,
                        onChange: (nextTab) => {
                          setSelectedTab(nextTab);
                          setPage(1);
                        },
                      })
                    )
                  ),
                  h(
                    "a",
                    {
                      className: "tag-browser__open-native",
                      href: openNativeHref || "#",
                      target: "_blank",
                      rel: "noreferrer noopener",
                      onClick: (event) => {
                        if (!openNativeHref) event.preventDefault();
                      },
                    },
                    "Go to Tag"
                  )
                ),
                h(
                  "div",
                  { className: "tag-browser__content-toolbar" },
                  h(
                    "div",
                    { className: "tag-browser__content-toolbar-meta" },
                    `${formatCount(contentState.count)} ${TAB_DEFS.find((tab) => tab.key === selectedTab)?.label || "items"}`
                  ),
                  h(SortControl, {
                    tab: selectedTab,
                    value: activeSort,
                    onChange: (nextValue) => {
                      setSortState((prev) => ({
                        ...normalizeSortState(prev),
                        [selectedTab]: normalizeSortConfig(selectedTab, nextValue),
                      }));
                      setPage(1);
                    },
                  }),
                  h(CardSizeControl, {
                    tab: selectedTab,
                    value: activeColumnCount,
                    onChange: (nextValue) =>
                      setColumnCountState((prev) => ({
                        ...normalizeColumnCountState(prev),
                        [selectedTab]: clampColumnCount(selectedTab, nextValue),
                      })),
                  })
                ),
                h(
                  "div",
                  { className: "tag-browser__content-body" },
                  contentState.loading
                    ? h("div", { className: "tag-browser__empty-state" }, "Loading content...")
                    : contentState.error
                    ? h("div", { className: "tag-browser__empty-state" }, contentState.error)
                    : h(ContentGrid, {
                        tab: selectedTab,
                        items: contentState.items,
                        columns: activeColumnCount,
                      }),
                  h(Pager, { page, totalCount: contentState.count, onChange: setPage })
                )
              )
            : h(
                "div",
                {
                  className:
                    "tag-browser__empty-state tag-browser__empty-state--center",
                },
                multiSelectEnabled
                  ? "Choose tags from the hierarchy to browse matching content."
                  : "Choose a tag from the hierarchy to browse its content."
              )
        )
      )
    );
  }

  function ensureNavButton() {
    if (document.getElementById(NAV_BUTTON_ID)) return true;
    const navbarButtons = document.querySelector(".navbar-buttons");
    if (!navbarButtons) return false;

    const button = document.createElement("button");
    button.id = NAV_BUTTON_ID;
    button.type = "button";
    button.className = "btn nav-link d-flex align-items-center gap-1";
    button.title = `Open ${PLUGIN_NAME}`;
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" style="flex-shrink: 0;">
        <path d="M2 2.75A1.75 1.75 0 0 1 3.75 1h8.5A1.75 1.75 0 0 1 14 2.75v10.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25zm1.75-.25a.25.25 0 0 0-.25.25v2h9v-2a.25.25 0 0 0-.25-.25zm8.75 3.75h-9v7a.25.25 0 0 0 .25.25h8.5a.25.25 0 0 0 .25-.25z"/>
        <path d="M5 8.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.25m0 2.5A.75.75 0 0 1 5.75 10h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75"/>
      </svg>
      <span>Tag Browser</span>
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openTagBasedBrowserRoute();
    });
    navbarButtons.insertBefore(button, navbarButtons.firstChild);
    return true;
  }

  function navigateToTagBasedBrowserRoute() {
    if (window.location.pathname !== ROUTE_PATH) {
      window.history.pushState({}, "", ROUTE_PATH);
    }
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function openTagBasedBrowserRoute() {
    if (init() && window.__tagBasedBrowserRouteReady) {
      navigateToTagBasedBrowserRoute();
      return;
    }

    startBootstrapWatch();

    if (window.__tagBasedBrowserOpenRouteWaitId) {
      window.clearInterval(window.__tagBasedBrowserOpenRouteWaitId);
      window.__tagBasedBrowserOpenRouteWaitId = null;
    }

    let attempts = 0;
    window.__tagBasedBrowserOpenRouteWaitId = window.setInterval(() => {
      attempts += 1;
      if (init() && window.__tagBasedBrowserRouteReady) {
        window.clearInterval(window.__tagBasedBrowserOpenRouteWaitId);
        window.__tagBasedBrowserOpenRouteWaitId = null;
        navigateToTagBasedBrowserRoute();
      } else if (attempts >= 50) {
        window.clearInterval(window.__tagBasedBrowserOpenRouteWaitId);
        window.__tagBasedBrowserOpenRouteWaitId = null;
      }
    }, 100);
  }

  function installNavButton(PluginApi) {
    if (ensureNavButton()) return;

    const retryDelays = [0, 150, 500, 1200, 2500];
    retryDelays.forEach((delay) => {
      window.setTimeout(() => {
        ensureNavButton();
      }, delay);
    });

    if (PluginApi?.Event?.addEventListener) {
      if (!window.__tagBasedBrowserLocationListenerInstalled) {
        window.__tagBasedBrowserLocationListenerInstalled = true;
        PluginApi.Event.addEventListener("stash:location", () => {
          init();
          ensureNavButton();
        });
      }
    }
  }

  function init() {
    const PluginApi = window.PluginApi;
    if (window.__tagBasedBrowserInitialized) return true;
    if (!PluginApi?.React || !PluginApi?.register?.route) return false;

    const React = PluginApi.React;
    window.__tagBasedBrowserPluginApi = { PluginApi, React };

    try {
      PluginApi.register.route(ROUTE_PATH, () => h(TagBasedBrowserApp));
      window.__tagBasedBrowserInitialized = true;
      window.__tagBasedBrowserRouteReady = true;
      installNavButton(PluginApi);

      if (window.location.pathname === ROUTE_PATH) {
        window.setTimeout(() => {
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, 50);
      }
      return true;
    } catch (err) {
      console.error("[TagBasedBrowser] initialization failed", err);
      return false;
    }
  }

  function startBootstrapWatch() {
    if (window.__tagBasedBrowserBootstrapWatchStarted) return;
    window.__tagBasedBrowserBootstrapWatchStarted = true;

    const tick = () => {
      init();
      ensureNavButton();
      if (window.__tagBasedBrowserInitialized && document.getElementById(NAV_BUTTON_ID)) {
        if (window.__tagBasedBrowserBootstrapWatchId) {
          window.clearInterval(window.__tagBasedBrowserBootstrapWatchId);
          window.__tagBasedBrowserBootstrapWatchId = null;
        }
      }
    };

    tick();
    window.__tagBasedBrowserBootstrapWatchId = window.setInterval(tick, 1000);
  }

  const retryDelays = [0, 150, 500, 1200, 2500];
  retryDelays.forEach((delay) => {
    window.setTimeout(() => {
      init();
      ensureNavButton();
    }, delay);
  });

  if (window.PluginApi?.Event?.addEventListener) {
    if (!window.__tagBasedBrowserInitLocationListenerInstalled) {
      window.__tagBasedBrowserInitLocationListenerInstalled = true;
      window.PluginApi.Event.addEventListener("stash:location", () => {
        init();
        ensureNavButton();
      });
    }
  }

  startBootstrapWatch();
})();



