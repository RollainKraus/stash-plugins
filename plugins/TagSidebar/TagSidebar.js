(function () {
  "use strict";

  if (window.__tagSidebarPluginLoaded) return;
  window.__tagSidebarPluginLoaded = true;

  const PLUGIN_ID = "TagSidebar";
  const HOST_ID = "tag-sidebar-host";
  const OPEN_STORAGE_KEY = "tag-sidebar-open-v1";
  const EXPANDED_STORAGE_KEY = "tag-sidebar-expanded-v1";
  const UI_STORAGE_KEY = "tag-sidebar-ui-v1";
  const STICKY_STORAGE_KEY = "tag-sidebar-sticky-v1";
  const DEFAULT_CONFIG = { stickyTagFilters: false, sidebarWidth: 360 };
  const DEFAULT_UI = { matchMode: "any" };
  const ROUTE_RETRY_DELAYS = [0, 160, 420, 900];
  const SEARCH_LIMIT = 40;
  const SUPPORTED_PAGES = new Map([
    ["/scenes", "Scenes"],
    ["/scenes/markers", "Markers"],
    ["/groups", "Groups"],
    ["/images", "Images"],
    ["/galleries", "Galleries"],
    ["/performers", "Performers"],
    ["/studios", "Studios"],
  ]);

  const cache =
    window.__tagSidebarCache ||
    (window.__tagSidebarCache = {
      config: DEFAULT_CONFIG,
      configPromise: null,
      tags: null,
      tagsPromise: null,
    });

  const state = {
    open: loadBoolean(OPEN_STORAGE_KEY, false),
    expandedIds: loadSet(EXPANDED_STORAGE_KEY),
    ui: loadUiState(),
    includedTagIds: [],
    excludedTagIds: [],
    groups: [],
    tagMap: new Map(),
    searchIndex: [],
    searchText: "",
    routePath: "",
    initialized: false,
    refreshGeneration: 0,
    refreshTimeoutIds: [],
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
          throw new Error(json.errors.map((item) => item.message).join("; "));
        }
        return json.data;
      });
  }

  function loadBoolean(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : raw === "true";
    } catch (err) {
      return fallback;
    }
  }

  function saveBoolean(key, value) {
    try {
      window.localStorage.setItem(key, String(!!value));
    } catch (err) {
      void err;
    }
  }

  function loadSet(key) {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch (err) {
      return new Set();
    }
  }

  function saveSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.from(value || []).map(String)));
    } catch (err) {
      void err;
    }
  }

  function normalizeUiState(raw) {
    return {
      matchMode: String(raw?.matchMode || "").toLowerCase() === "all" ? "all" : "any",
    };
  }

  function loadUiState() {
    try {
      const raw = window.localStorage.getItem(UI_STORAGE_KEY);
      return normalizeUiState(raw ? JSON.parse(raw) : DEFAULT_UI);
    } catch (err) {
      return normalizeUiState(DEFAULT_UI);
    }
  }

  function saveUiState(value) {
    try {
      window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(normalizeUiState(value)));
    } catch (err) {
      void err;
    }
  }

  function loadStickySelection() {
    try {
      const raw = window.localStorage.getItem(STICKY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const includedTagIds = Array.isArray(parsed?.includedTagIds)
        ? parsed.includedTagIds.map(String)
        : Array.isArray(parsed?.selectedTagIds)
        ? parsed.selectedTagIds.map(String)
        : [];
      const excludedTagIds = Array.isArray(parsed?.excludedTagIds)
        ? parsed.excludedTagIds.map(String)
        : [];
      return { includedTagIds, excludedTagIds };
    } catch (err) {
      return { includedTagIds: [], excludedTagIds: [] };
    }
  }

  function saveStickySelection(includedIds, excludedIds) {
    try {
      window.localStorage.setItem(
        STICKY_STORAGE_KEY,
        JSON.stringify({
          includedTagIds: (includedIds || []).map(String),
          excludedTagIds: (excludedIds || []).map(String),
        })
      );
    } catch (err) {
      void err;
    }
  }

  function normalizeConfig(raw) {
    const sticky =
      typeof raw?.a_stickyTagFilters === "boolean"
        ? raw.a_stickyTagFilters
        : raw?.stickyTagFilters;
    const sidebarWidthRaw =
      raw?.b_sidebarWidth != null ? raw.b_sidebarWidth : raw?.sidebarWidth;
    const sidebarWidth = Number.parseInt(String(sidebarWidthRaw ?? DEFAULT_CONFIG.sidebarWidth), 10);
    return {
      stickyTagFilters:
        typeof sticky === "boolean" ? sticky : DEFAULT_CONFIG.stickyTagFilters,
      sidebarWidth:
        Number.isFinite(sidebarWidth) && sidebarWidth >= 240 ? sidebarWidth : DEFAULT_CONFIG.sidebarWidth,
    };
  }

  function loadConfig() {
    if (cache.configPromise) return cache.configPromise;
    cache.configPromise = gqlRequest(`
      query TagSidebarConfig {
        configuration {
          plugins
        }
      }
    `)
      .then((data) => {
        cache.config = normalizeConfig(data?.configuration?.plugins?.[PLUGIN_ID] || {});
        return cache.config;
      })
      .catch((err) => {
        console.error("[TagSidebar] config load failed", err);
        cache.config = normalizeConfig({});
        return cache.config;
      })
      .finally(() => {
        cache.configPromise = null;
      });
    return cache.configPromise;
  }

  function loadTags() {
    if (cache.tags) return Promise.resolve(cache.tags);
    if (cache.tagsPromise) return cache.tagsPromise;
    cache.tagsPromise = gqlRequest(`
      query TagSidebarAllTags {
        findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
          tags {
            id
            name
            sort_name
            scene_count
            studio_count
            image_count
            gallery_count
            performer_count
            children { id }
            parents {
              id
              name
              sort_name
              parents { id name sort_name }
            }
          }
        }
      }
    `)
      .then((data) => {
        cache.tags = data?.findTags?.tags || [];
        return cache.tags;
      })
      .catch((err) => {
        console.error("[TagSidebar] tag load failed", err);
        cache.tags = [];
        return cache.tags;
      })
      .finally(() => {
        cache.tagsPromise = null;
      });
    return cache.tagsPromise;
  }

  function getCountValue(record, key) {
    const value = Number(record?.[key]);
    return Number.isFinite(value) ? value : 0;
  }

  function getTotalCount(record) {
    return (
      getCountValue(record, "scene_count") +
      getCountValue(record, "studio_count") +
      getCountValue(record, "image_count") +
      getCountValue(record, "gallery_count") +
      getCountValue(record, "performer_count")
    );
  }

  function createTagMap(tags) {
    const map = new Map();
    tags.forEach((tag) => {
      map.set(String(tag.id), {
        id: String(tag.id),
        name: tag.name,
        sort_name: tag.sort_name || tag.name || "",
        scene_count: getCountValue(tag, "scene_count"),
        studio_count: getCountValue(tag, "studio_count"),
        image_count: getCountValue(tag, "image_count"),
        gallery_count: getCountValue(tag, "gallery_count"),
        performer_count: getCountValue(tag, "performer_count"),
        total_count: getTotalCount(tag),
        childIds: (tag.children || []).map((child) => String(child.id)),
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
      });
    });
    return map;
  }

  function sortByName(items) {
    items.sort((a, b) =>
      String(a.sort_name || a.name || "").localeCompare(
        String(b.sort_name || b.name || ""),
        undefined,
        { sensitivity: "base" }
      )
    );
  }

  function buildHierarchy(tags) {
    const tagMap = createTagMap(tags);
    const groupMap = new Map();
    const groups = [];
    const ungrouped = {
      id: "__ungrouped__",
      name: "Ungrouped",
      sort_name: "Ungrouped",
      total_count: 0,
      items: [],
      subgroupMap: new Map(),
      leafIds: new Set(),
    };

    function ensureGroup(parent) {
      const id = String(parent.id);
      if (!groupMap.has(id)) {
        const record = tagMap.get(id) || parent;
        const group = {
          id,
          name: record.name,
          sort_name: record.sort_name || record.name || "",
          total_count: record.total_count || 0,
          items: [],
          subgroupMap: new Map(),
          leafIds: new Set(),
        };
        groupMap.set(id, group);
        groups.push(group);
      }
      return groupMap.get(id);
    }

    function ensureSubgroup(group, parent) {
      const id = String(parent.id);
      if (!group.subgroupMap.has(id)) {
        group.subgroupMap.set(id, {
          type: "subgroup",
          id,
          name: parent.name,
          sort_name: parent.sort_name || parent.name || "",
          total_count: 0,
          children: [],
          childIds: new Set(),
        });
        group.items.push(group.subgroupMap.get(id));
      }
      return group.subgroupMap.get(id);
    }

    tags.forEach((tag) => {
      const record = tagMap.get(String(tag.id));
      if (!record || record.childIds.length) return;

      if (!record.parents.length) {
        if (!ungrouped.leafIds.has(record.id)) {
          ungrouped.items.push({
            type: "leaf",
            id: record.id,
            name: record.name,
            sort_name: record.sort_name,
            total_count: record.total_count,
          });
          ungrouped.leafIds.add(record.id);
          ungrouped.total_count += record.total_count;
        }
        return;
      }

      record.parents.forEach((parent) => {
        const parentRecord = tagMap.get(String(parent.id));
        if (parentRecord && parentRecord.parents?.length) {
          parentRecord.parents.forEach((topParent) => {
            const group = ensureGroup(topParent);
            const subgroup = ensureSubgroup(group, parentRecord);
            if (!subgroup.childIds.has(record.id)) {
              subgroup.children.push({
                type: "leaf",
                id: record.id,
                name: record.name,
                sort_name: record.sort_name,
                total_count: record.total_count,
              });
              subgroup.childIds.add(record.id);
            }
          });
        } else {
          const group = ensureGroup(parent);
          if (!group.leafIds.has(record.id)) {
            group.items.push({
              type: "leaf",
              id: record.id,
              name: record.name,
              sort_name: record.sort_name,
              total_count: record.total_count,
            });
            group.leafIds.add(record.id);
          }
        }
      });
    });

    groups.forEach((group) => {
      group.items = group.items.filter((item) =>
        item.type === "leaf" ? true : item.children.length > 0
      );
      group.items.forEach((item) => {
        if (item.type === "subgroup") {
          sortByName(item.children);
          item.total_count = item.children.reduce((sum, child) => sum + (child.total_count || 0), 0);
        }
      });
      sortByName(group.items);
      group.total_count = group.items.reduce((sum, item) => sum + (item.total_count || 0), 0);
    });

    sortByName(groups);
    if (ungrouped.items.length) {
      sortByName(ungrouped.items);
      groups.push(ungrouped);
    }

    const searchIndex = [];
    tags.forEach((tag) => {
      const record = tagMap.get(String(tag.id));
      if (!record) return;
      if (!record.parents.length) {
        searchIndex.push({
          id: record.id,
          name: record.name,
          total_count: record.total_count,
          breadcrumb: "Ungrouped",
          ancestorIds: [],
        });
        return;
      }
      record.parents.forEach((parent) => {
        const parentRecord = tagMap.get(String(parent.id));
        if (parentRecord && parentRecord.parents?.length) {
          parentRecord.parents.forEach((topParent) => {
            searchIndex.push({
              id: record.id,
              name: record.name,
              total_count: record.total_count,
              breadcrumb: `${topParent.name} > ${parentRecord.name}`,
              ancestorIds: [String(topParent.id), String(parentRecord.id)],
            });
          });
        } else {
          searchIndex.push({
            id: record.id,
            name: record.name,
            total_count: record.total_count,
            breadcrumb: parent.name,
            ancestorIds: [String(parent.id)],
          });
        }
      });
    });

    return { groups, tagMap, searchIndex };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatCount(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

  function getCurrentPath() {
    return String(window.location.pathname || "").replace(/\/+$/, "") || "/";
  }

  function getCurrentPageLabel() {
    return SUPPORTED_PAGES.get(getCurrentPath()) || "";
  }

  function isSupportedPage() {
    return SUPPORTED_PAGES.has(getCurrentPath());
  }

  function parseUrlFilterCriteria() {
    try {
      const params = new URLSearchParams(window.location.search);
      const entries = params.getAll("c");
      const parsed = [];
      entries.forEach((entry) => {
        const decoded = decodeURIComponent(entry);
        try {
          const value = JSON.parse(decoded);
          parsed.push(...(Array.isArray(value) ? value : [value]));
          return;
        } catch (err) {
          void err;
        }
        let normalized = decoded.trim().replace(/\(/g, "{").replace(/\)/g, "}");
        try {
          const value = JSON.parse(normalized);
          parsed.push(...(Array.isArray(value) ? value : [value]));
          return;
        } catch (err) {
          void err;
        }
        normalized
          .replace(/\}\s*,?\s*\{/g, "}|||SPLIT|||{")
          .split("|||SPLIT|||")
          .forEach((piece) => {
            try {
              const value = JSON.parse(piece.trim());
              if (value?.type) parsed.push(value);
            } catch (err) {
              void err;
            }
          });
      });
      return parsed;
    } catch (err) {
      return [];
    }
  }

  function getTagCriterion(criteria) {
    return (criteria || []).find((criterion) => criterion?.type === "tags") || null;
  }

  function getCriterionIds(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => String(item?.id || item || "")).filter(Boolean);
  }

  function getCriterionIncludedTagIds(criterion) {
    return getCriterionIds(criterion?.value?.items);
  }

  function getCriterionExcludedTagIds(criterion) {
    return getCriterionIds(criterion?.value?.excluded);
  }

  function getCriterionUi(criterion) {
    return normalizeUiState({
      matchMode: criterion?.modifier === "INCLUDES_ALL" ? "all" : "any",
    });
  }

  function getTagAndDescendantIds(tagId) {
    const rootId = String(tagId || "");
    if (!rootId) return [];
    const results = [];
    const visited = new Set();
    const stack = [rootId];
    while (stack.length) {
      const currentId = String(stack.pop());
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);
      results.push(currentId);
      const record = state.tagMap.get(currentId);
      (record?.childIds || []).forEach((childId) => stack.push(String(childId)));
    }
    return results;
  }

  function expandTagIdsWithDescendants(tagIds) {
    const expanded = new Set();
    Array.from(new Set((tagIds || []).map(String).filter(Boolean))).forEach((tagId) => {
      getTagAndDescendantIds(tagId).forEach((id) => expanded.add(id));
    });
    return Array.from(expanded);
  }

  function buildTagCriterion(includedIds, excludedIds) {
    const items = expandTagIdsWithDescendants(includedIds);
    const excluded = expandTagIdsWithDescendants(excludedIds);
    if (!items.length && !excluded.length) return null;
    return {
      type: "tags",
      value: {
        items: items.map((id) => ({
          id,
          label: state.tagMap.get(id)?.name || id,
        })),
        excluded: excluded.map((id) => ({
          id,
          label: state.tagMap.get(id)?.name || id,
        })),
        depth: -1,
      },
      modifier: state.ui.matchMode === "all" ? "INCLUDES_ALL" : "INCLUDES",
    };
  }

  function applyUrlFilters() {
    if (!isSupportedPage()) return;
    const criteria = parseUrlFilterCriteria().filter((criterion) => criterion?.type !== "tags");
    const tagCriterion = buildTagCriterion(state.includedTagIds, state.excludedTagIds);
    if (tagCriterion) criteria.push(tagCriterion);

    const url = new URL(window.location.href);
    url.searchParams.delete("c");
    criteria.forEach((criterion) => url.searchParams.append("c", JSON.stringify(criterion)));
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;
    window.history.replaceState({}, "", nextUrl);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function getHost() {
    return document.getElementById(HOST_ID) || null;
  }

  function ensureHost() {
    let host = getHost();
    if (host) return host;
    host = document.createElement("aside");
    host.id = HOST_ID;
    host.className = "tag-sidebar tag-sidebar--closed";
    host.innerHTML = `
      <button type="button" class="tag-sidebar__toggle" data-action="toggle-open" aria-expanded="false" title="Toggle tag sidebar">
        Tags
      </button>
      <div class="tag-sidebar__panel">
        <div class="tag-sidebar__inner"></div>
      </div>
    `;
    document.body.appendChild(host);
    host.addEventListener("click", onHostClick);
    host.addEventListener("input", onHostInput);
    return host;
  }

  function removeHost() {
    const host = getHost();
    if (host) host.remove();
    clearPushedContent();
  }

  function getReservedWidthPx() {
    const host = getHost();
    if (!host) return 0;
    const panel = host.querySelector(".tag-sidebar__panel");
    const toggle = host.querySelector(".tag-sidebar__toggle");
    if (panel instanceof HTMLElement) {
      const panelRect = panel.getBoundingClientRect();
      const toggleRect = toggle instanceof HTMLElement ? toggle.getBoundingClientRect() : null;
      if (panelRect.width > 0) {
        return Math.max(0, panelRect.width - ((toggleRect?.width || 0) / 2));
      }
    }
    const styles = window.getComputedStyle(host);
    const fallbackWidth = parseFloat(styles.getPropertyValue("--tag-sidebar-base-width")) || 0;
    const fallbackToggleWidth = toggle instanceof HTMLElement ? toggle.getBoundingClientRect().width || 0 : 0;
    return Math.max(0, fallbackWidth - fallbackToggleWidth / 2);
  }

  function clearPushedContent() {
    document.querySelectorAll("[data-tag-sidebar-pushed='true']").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.style.removeProperty("margin-left");
      element.style.removeProperty("width");
      element.style.removeProperty("max-width");
      element.style.removeProperty("box-sizing");
      delete element.dataset.tagSidebarPushed;
    });
    document.querySelectorAll("[data-tag-sidebar-toolbar-reset='true']").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.style.removeProperty("margin-left");
      element.style.removeProperty("width");
      element.style.removeProperty("max-width");
      delete element.dataset.tagSidebarToolbarReset;
    });
  }

  function pushElement(element, reservedWidth) {
    if (!(element instanceof HTMLElement)) return false;
    element.dataset.tagSidebarPushed = "true";
    element.style.boxSizing = "border-box";
    element.style.marginLeft = `${reservedWidth}px`;
    element.style.width = `calc(100% - ${reservedWidth}px)`;
    element.style.maxWidth = `calc(100% - ${reservedWidth}px)`;
    return true;
  }

  function findWholeWrapperPushTarget() {
    const container = document.querySelector(".filtered-list-container");
    if (container instanceof HTMLElement) return { container, toolbar: null };

    const mainRoot = document.querySelector(".main > div");
    if (!(mainRoot instanceof HTMLElement)) return null;

    let bestChild = null;
    let bestScore = 0;
    Array.from(mainRoot.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      if (child.closest("#tag-sidebar-host")) return;
      const rect = child.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 120) return;
      const score = rect.width * rect.height;
      if (score > bestScore) {
        bestScore = score;
        bestChild = child;
      }
    });

    if (bestChild instanceof HTMLElement) {
      return { container: bestChild, toolbar: null };
    }

    return null;
  }

  function findResultsContainers() {
    const cardSelectors = [
      ".scene-card",
      ".marker-card",
      ".scene-marker-card",
      ".group-card",
      ".image-card",
      ".gallery-card",
      ".performer-card",
      ".studio-card",
    ];
    const allCardSelector = cardSelectors.join(", ");
    const results = new Set();

    cardSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        let container =
          node.closest(".wall") ||
          node.closest(".list") ||
          node.closest(".filtered-list") ||
          null;
        if (!container) {
          let current = node.parentElement;
          while (current && current !== document.body) {
            if (current.closest("#tag-sidebar-host")) break;
            const cardCount = current.querySelectorAll(allCardSelector).length;
            const hasToolbar = !!current.querySelector(".filtered-list-toolbar");
            if (cardCount > 1 && !hasToolbar) {
              container = current;
              break;
            }
            current = current.parentElement;
          }
        }
        if (!(container instanceof HTMLElement)) return;
        if (container.closest("#tag-sidebar-host")) return;
        results.add(container);
      });
    });

    if (!results.size) {
      document
        .querySelectorAll(
          ".filtered-list-container .filtered-list, .filtered-list-container .wall, .filtered-list-container .list, .filtered-list-container .table"
        )
        .forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList.contains("filtered-list-toolbar")) return;
          if (node.closest("#tag-sidebar-host")) return;
          results.add(node);
        });
    }

    return Array.from(results);
  }

  function applyPushedContent() {
    clearPushedContent();
    if (!state.open || !isSupportedPage()) return;
    const reservedWidth = getReservedWidthPx();
    if (!reservedWidth) return;
    let pushedCount = 0;

    if (getCurrentPath() === "/scenes/markers" || getCurrentPath() === "/groups") {
      const wrapperTarget = findWholeWrapperPushTarget();
      const container = wrapperTarget?.container || null;
      const toolbar = wrapperTarget?.toolbar || null;
      if (container instanceof HTMLElement) {
        pushedCount += pushElement(container, reservedWidth) ? 1 : 0;
      }
      if (toolbar instanceof HTMLElement) {
        toolbar.dataset.tagSidebarToolbarReset = "true";
        toolbar.style.marginLeft = `-${reservedWidth}px`;
        toolbar.style.width = `calc(100% + ${reservedWidth}px)`;
        toolbar.style.maxWidth = `calc(100% + ${reservedWidth}px)`;
        pushedCount += 1;
      }
      return pushedCount;
    }

    findResultsContainers().forEach((container) => {
      pushedCount += pushElement(container, reservedWidth) ? 1 : 0;
    });
    return pushedCount;
  }

  function persistSelection() {
    saveStickySelection(state.includedTagIds, state.excludedTagIds);
  }

  function syncSelectionFromUrlOrSticky(pathChanged, hasPreviousPath) {
    const criterion = getTagCriterion(parseUrlFilterCriteria());
    const sticky = cache.config.stickyTagFilters ? loadStickySelection() : { includedTagIds: [], excludedTagIds: [] };
    const hasStickySelection =
      sticky.includedTagIds.length > 0 || sticky.excludedTagIds.length > 0;

    if (cache.config.stickyTagFilters && pathChanged && hasStickySelection) {
      state.includedTagIds = sticky.includedTagIds;
      state.excludedTagIds = sticky.excludedTagIds;
      return { fromUrl: false, shouldApply: true };
    }

    if (criterion) {
      state.includedTagIds = getCriterionIncludedTagIds(criterion);
      state.excludedTagIds = getCriterionExcludedTagIds(criterion);
      state.ui = { ...state.ui, ...getCriterionUi(criterion) };
      saveUiState(state.ui);
      persistSelection();
      return { fromUrl: true, shouldApply: false };
    }

    if (cache.config.stickyTagFilters && hasPreviousPath && !pathChanged) {
      state.includedTagIds = [];
      state.excludedTagIds = [];
      persistSelection();
      return { fromUrl: true, shouldApply: false };
    }

    if (cache.config.stickyTagFilters) {
      state.includedTagIds = sticky.includedTagIds;
      state.excludedTagIds = sticky.excludedTagIds;
      return {
        fromUrl: false,
        shouldApply: sticky.includedTagIds.length > 0 || sticky.excludedTagIds.length > 0,
      };
    }

    state.includedTagIds = [];
    state.excludedTagIds = [];
    return { fromUrl: false, shouldApply: false };
  }

  function isIncluded(tagId) {
    return state.includedTagIds.includes(String(tagId));
  }

  function isExcluded(tagId) {
    return state.excludedTagIds.includes(String(tagId));
  }

  function setOpen(nextOpen) {
    state.open = !!nextOpen;
    saveBoolean(OPEN_STORAGE_KEY, state.open);
    render();
  }

  function setUiState(nextUi, applyFilters = true) {
    state.ui = normalizeUiState(nextUi);
    saveUiState(state.ui);
    render();
    if (applyFilters) {
      persistSelection();
      applyUrlFilters();
    }
  }

  function setFilterTagIds(nextIncludedIds, nextExcludedIds, applyFilters = true) {
    state.includedTagIds = Array.from(new Set((nextIncludedIds || []).map(String).filter(Boolean)));
    state.excludedTagIds = Array.from(new Set((nextExcludedIds || []).map(String).filter(Boolean)));
    persistSelection();
    render();
    if (applyFilters) applyUrlFilters();
  }

  function setTagFilterState(tagId, mode) {
    const id = String(tagId || "");
    if (!id) return;

    const included = state.includedTagIds.filter((existingId) => existingId !== id);
    const excluded = state.excludedTagIds.filter((existingId) => existingId !== id);

    if (mode === "include") {
      if (isIncluded(id)) {
        setFilterTagIds(included, excluded);
        return;
      }
      setFilterTagIds([...included, id], excluded);
      return;
    }

    if (mode === "exclude") {
      if (isExcluded(id)) {
        setFilterTagIds(included, excluded);
        return;
      }
      setFilterTagIds(included, [...excluded, id]);
      return;
    }

    setFilterTagIds(included, excluded);
  }

  function toggleExpanded(tagId) {
    const id = String(tagId);
    if (state.expandedIds.has(id)) state.expandedIds.delete(id);
    else state.expandedIds.add(id);
    saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
    render();
  }

  function expandAncestors(ids) {
    let changed = false;
    (ids || []).forEach((id) => {
      const normalizedId = String(id);
      if (!state.expandedIds.has(normalizedId)) {
        state.expandedIds.add(normalizedId);
        changed = true;
      }
    });
    if (changed) saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
  }

  function getSearchResults() {
    const query = state.searchText.trim().toLowerCase();
    if (!query) return [];
    return state.searchIndex
      .filter((entry) => {
        const haystack = `${entry.name} ${entry.breadcrumb}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          sensitivity: "base",
        });
      })
      .slice(0, SEARCH_LIMIT);
  }

  function renderSelectedTags() {
    const chips = [
      ...state.includedTagIds.map((tagId) => ({ tagId, mode: "include" })),
      ...state.excludedTagIds.map((tagId) => ({ tagId, mode: "exclude" })),
    ];
    if (!chips.length) {
      return `<div class="tag-sidebar__empty">No tags selected</div>`;
    }
    return `
      <div class="tag-sidebar__selected-list">
        ${chips
          .map(({ tagId, mode }) => {
            const label = state.tagMap.get(tagId)?.name || tagId;
            const symbol = mode === "exclude" ? "-" : "+";
            return `
              <button type="button" class="tag-sidebar__chip tag-sidebar__chip--${escapeHtml(
                mode
              )}" data-action="remove-filter" data-tag-id="${escapeHtml(tagId)}">
                <span class="tag-sidebar__chip-prefix">${symbol}</span>
                <span class="tag-sidebar__chip-label">${escapeHtml(label)}</span>
                <span class="tag-sidebar__chip-close">x</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderSearchResults() {
    const results = getSearchResults();
    if (!state.searchText.trim()) return "";
    if (!results.length) {
      return `<div class="tag-sidebar__search-results"><div class="tag-sidebar__empty">No matching tags</div></div>`;
    }
    return `
      <div class="tag-sidebar__search-results">
        ${results
          .map(
            (entry) => `
              <button type="button" class="tag-sidebar__search-result" data-action="pick-search-result" data-tag-id="${escapeHtml(entry.id)}" data-ancestor-ids="${escapeHtml(entry.ancestorIds.join(","))}">
                <span class="tag-sidebar__search-name">${escapeHtml(entry.name)}</span>
                <span class="tag-sidebar__search-meta">${escapeHtml(entry.breadcrumb)} &middot; ${formatCount(entry.total_count)}</span>
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderLeaf(item, depth) {
    const included = isIncluded(item.id);
    const excluded = isExcluded(item.id);
    return `
      <div class="tag-sidebar__row tag-sidebar__row--leaf ${included ? "is-included" : ""} ${excluded ? "is-excluded" : ""}" style="--tag-sidebar-depth:${depth}">
        <span class="tag-sidebar__indent"></span>
        <button type="button" class="tag-sidebar__action tag-sidebar__action--include ${included ? "is-active" : ""}" data-action="set-tag-filter" data-filter-mode="include" data-tag-id="${escapeHtml(item.id)}" title="${included ? "Remove included tag" : "Include tag"}">
          +
        </button>
        <button type="button" class="tag-sidebar__action tag-sidebar__action--exclude ${excluded ? "is-active" : ""}" data-action="set-tag-filter" data-filter-mode="exclude" data-tag-id="${escapeHtml(item.id)}" title="${excluded ? "Remove excluded tag" : "Exclude tag"}">
          -
        </button>
        <button type="button" class="tag-sidebar__label" data-action="set-tag-filter" data-filter-mode="include" data-tag-id="${escapeHtml(item.id)}">
          ${escapeHtml(item.name)}
        </button>
        <span class="tag-sidebar__count">${formatCount(item.total_count)}</span>
      </div>
    `;
  }

  function renderSubgroup(item, depth) {
    const included = isIncluded(item.id);
    const excluded = isExcluded(item.id);
    const expanded = state.expandedIds.has(item.id);
    return `
      <div class="tag-sidebar__branch">
        <div class="tag-sidebar__row tag-sidebar__row--subgroup ${included ? "is-included" : ""} ${excluded ? "is-excluded" : ""}" style="--tag-sidebar-depth:${depth}">
          <button type="button" class="tag-sidebar__action tag-sidebar__action--expand" data-action="toggle-expanded" data-tag-id="${escapeHtml(item.id)}" title="${expanded ? "Collapse" : "Expand"}">
            ${expanded ? "▾" : "▸"}
          </button>
          <button type="button" class="tag-sidebar__action tag-sidebar__action--include ${included ? "is-active" : ""}" data-action="set-tag-filter" data-filter-mode="include" data-tag-id="${escapeHtml(item.id)}" title="${included ? "Remove included tag" : "Include tag"}">
            +
          </button>
          <button type="button" class="tag-sidebar__action tag-sidebar__action--exclude ${excluded ? "is-active" : ""}" data-action="set-tag-filter" data-filter-mode="exclude" data-tag-id="${escapeHtml(item.id)}" title="${excluded ? "Remove excluded tag" : "Exclude tag"}">
            -
          </button>
          <button type="button" class="tag-sidebar__label" data-action="toggle-expanded" data-tag-id="${escapeHtml(item.id)}">
            ${escapeHtml(item.name)}
          </button>
          <span class="tag-sidebar__count">${formatCount(item.total_count)}</span>
        </div>
        ${
          expanded
            ? `<div class="tag-sidebar__children">${item.children
                .map((child) => renderLeaf(child, depth + 1))
                .join("")}</div>`
            : ""
        }
      </div>
    `;
  }

  function renderGroup(group) {
    const included = isIncluded(group.id);
    const excluded = isExcluded(group.id);
    const expanded = state.expandedIds.has(group.id);
    return `
      <div class="tag-sidebar__branch">
        <div class="tag-sidebar__row tag-sidebar__row--group ${included ? "is-included" : ""} ${excluded ? "is-excluded" : ""}" style="--tag-sidebar-depth:0">
          <button type="button" class="tag-sidebar__action tag-sidebar__action--expand" data-action="toggle-expanded" data-tag-id="${escapeHtml(group.id)}" title="${expanded ? "Collapse" : "Expand"}">
            ${expanded ? "▾" : "▸"}
          </button>
          <button type="button" class="tag-sidebar__action tag-sidebar__action--include ${included ? "is-active" : ""}" data-action="set-tag-filter" data-filter-mode="include" data-tag-id="${escapeHtml(group.id)}" title="${included ? "Remove included tag" : "Include tag"}">
            +
          </button>
          <button type="button" class="tag-sidebar__action tag-sidebar__action--exclude ${excluded ? "is-active" : ""}" data-action="set-tag-filter" data-filter-mode="exclude" data-tag-id="${escapeHtml(group.id)}" title="${excluded ? "Remove excluded tag" : "Exclude tag"}">
            -
          </button>
          <button type="button" class="tag-sidebar__label" data-action="toggle-expanded" data-tag-id="${escapeHtml(group.id)}">
            ${escapeHtml(group.name)}
          </button>
          <span class="tag-sidebar__count">${formatCount(group.total_count)}</span>
        </div>
        ${
          expanded
            ? `<div class="tag-sidebar__children">${group.items
                .map((item) => (item.type === "subgroup" ? renderSubgroup(item, 1) : renderLeaf(item, 1)))
                .join("")}</div>`
            : ""
        }
      </div>
    `;
  }

  function renderTree() {
    if (!state.groups.length) {
      return `<div class="tag-sidebar__empty">No tags available</div>`;
    }
    return state.groups.map((group) => renderGroup(group)).join("");
  }

  function renderControls() {
    return `
      <div class="tag-sidebar__toolbar tag-sidebar__toolbar--compact">
        <div class="tag-sidebar__segmented tag-sidebar__segmented--inline" title="Match Mode">
          <div class="tag-sidebar__segmented-label">Match</div>
          <div class="tag-sidebar__segmented-buttons">
            <button type="button" class="tag-sidebar__segmented-button ${state.ui.matchMode === "any" ? "is-active" : ""}" data-action="set-match-mode" data-value="any">ANY</button>
            <button type="button" class="tag-sidebar__segmented-button ${state.ui.matchMode === "all" ? "is-active" : ""}" data-action="set-match-mode" data-value="all">ALL</button>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    if (!isSupportedPage()) {
      removeHost();
      return 0;
    }

    const host = ensureHost();
    host.style.setProperty("--tag-sidebar-base-width", `${cache.config.sidebarWidth}px`);
    host.classList.toggle("tag-sidebar--open", state.open);
    host.classList.toggle("tag-sidebar--closed", !state.open);
    const toggle = host.querySelector(".tag-sidebar__toggle");
    if (toggle) toggle.setAttribute("aria-expanded", state.open ? "true" : "false");

    const inner = host.querySelector(".tag-sidebar__inner");
    if (!inner) return;

    inner.innerHTML = `
      <div class="tag-sidebar__header">
        <div class="tag-sidebar__eyebrow">${escapeHtml(getCurrentPageLabel())} Tag Filters</div>
        <button type="button" class="tag-sidebar__clear" data-action="clear-selection" ${state.includedTagIds.length || state.excludedTagIds.length ? "" : "disabled"}>Clear</button>
      </div>
      <div class="tag-sidebar__controls">${renderControls()}</div>
      <div class="tag-sidebar__search">
        <input type="search" class="tag-sidebar__search-input" data-action="search" placeholder="Search tags" value="${escapeHtml(state.searchText)}" />
      </div>
      ${renderSearchResults()}
      <div class="tag-sidebar__section">
        <div class="tag-sidebar__section-label">Selected Tags</div>
        ${renderSelectedTags()}
      </div>
      <div class="tag-sidebar__section tag-sidebar__section--tree">
        <div class="tag-sidebar__section-label">Tag Tree</div>
        <div class="tag-sidebar__tree">${renderTree()}</div>
      </div>
    `;
    return applyPushedContent() || 0;
  }

  function onHostInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.getAttribute("data-action") !== "search") return;
    const nextValue = target.value || "";
    state.searchText = nextValue;
    render();
    const nextInput = getHost()?.querySelector(".tag-sidebar__search-input");
    if (nextInput instanceof HTMLInputElement) {
      nextInput.focus();
      nextInput.setSelectionRange(nextValue.length, nextValue.length);
    }
  }

  function onHostClick(event) {
    const trigger = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!trigger) return;
    const action = trigger.getAttribute("data-action");
    const tagId = trigger.getAttribute("data-tag-id");

    if (action === "toggle-open") {
      event.preventDefault();
      setOpen(!state.open);
      return;
    }
    if (action === "toggle-expanded" && tagId) {
      event.preventDefault();
      toggleExpanded(tagId);
      return;
    }
    if (action === "set-tag-filter" && tagId) {
      event.preventDefault();
      setTagFilterState(tagId, trigger.getAttribute("data-filter-mode") || "include");
      return;
    }
    if (action === "clear-selection") {
      event.preventDefault();
      setFilterTagIds([], []);
      return;
    }
    if (action === "remove-filter" && tagId) {
      event.preventDefault();
      setTagFilterState(tagId, "clear");
      return;
    }
    if (action === "set-match-mode") {
      event.preventDefault();
      setUiState({ ...state.ui, matchMode: trigger.getAttribute("data-value") || "any" });
      return;
    }
    if (action === "pick-search-result" && tagId) {
      event.preventDefault();
      const ancestorIds = String(trigger.getAttribute("data-ancestor-ids") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      expandAncestors(ancestorIds);
      state.searchText = "";
      setTagFilterState(tagId, "include");
    }
  }

  function refreshData() {
    return Promise.all([loadConfig(), loadTags()]).then(([config, tags]) => {
      cache.config = config;
      const hierarchy = buildHierarchy(tags);
      state.groups = hierarchy.groups;
      state.tagMap = hierarchy.tagMap;
      state.searchIndex = hierarchy.searchIndex;
      return hierarchy;
    });
  }

  function refreshSidebar() {
    const previousPath = state.routePath;
    state.routePath = getCurrentPath();
    const hasPreviousPath = !!previousPath;
    const pathChanged = !!previousPath && previousPath !== state.routePath;

    if (!isSupportedPage()) {
      removeHost();
      return Promise.resolve({ needsRetry: false });
    }

    return refreshData().then(() => {
      const sync = syncSelectionFromUrlOrSticky(pathChanged, hasPreviousPath);
      const pushedCount = render();
      if (sync.shouldApply && !sync.fromUrl) {
        applyUrlFilters();
      }
      return {
        needsRetry: !!state.open && pushedCount < 1,
      };
    });
  }

  function clearRefreshTimeouts() {
    state.refreshTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    state.refreshTimeoutIds = [];
  }

  function queueRefreshAttempt(generation, index) {
    const delay = index === 0 ? ROUTE_RETRY_DELAYS[0] : ROUTE_RETRY_DELAYS[index] - ROUTE_RETRY_DELAYS[index - 1];
    const timeoutId = window.setTimeout(() => {
      state.refreshTimeoutIds = state.refreshTimeoutIds.filter((id) => id !== timeoutId);
      if (generation !== state.refreshGeneration) return;
      refreshSidebar()
        .then((result) => {
          if (generation !== state.refreshGeneration) return;
          if (result?.needsRetry && index < ROUTE_RETRY_DELAYS.length - 1) {
            queueRefreshAttempt(generation, index + 1);
          }
        })
        .catch((err) => {
          console.error("[TagSidebar] refresh failed", err);
          if (generation !== state.refreshGeneration) return;
          if (index < ROUTE_RETRY_DELAYS.length - 1) {
            queueRefreshAttempt(generation, index + 1);
          }
        });
    }, Math.max(0, delay));
    state.refreshTimeoutIds.push(timeoutId);
  }

  function scheduleRefresh() {
    state.refreshGeneration += 1;
    clearRefreshTimeouts();
    queueRefreshAttempt(state.refreshGeneration, 0);
  }

  function installRouteHooks() {
    if (window.__tagSidebarRouteHooksInstalled) return;
    window.__tagSidebarRouteHooksInstalled = true;

    const eventApi = window.PluginApi?.Event;
    if (eventApi?.addEventListener) {
      eventApi.addEventListener("stash:location", scheduleRefresh);
    }
    window.addEventListener("popstate", scheduleRefresh);
  }

  function init() {
    if (state.initialized) {
      scheduleRefresh();
      return;
    }
    state.initialized = true;
    installRouteHooks();
    scheduleRefresh();
  }

  init();
})();
