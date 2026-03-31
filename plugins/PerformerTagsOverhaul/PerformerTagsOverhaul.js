(function () {
  "use strict";

  const PLUGIN_ID = "PerformerTagsOverhaul";
  const PANEL_ID = "kmv-performer-tags-overhaul";
  const FALLBACK_GROUP_ID = "kmv-performer-tags-overhaul-host";
  const LAYOUT_CHANGED_EVENT = "performer-page-layout-changed";
  const ROUTE_RETRY_DELAYS = [0, 150, 400, 900, 1600];

  const state = {
    currentPerformer: null,
    selectedTagIds: new Set(),
    allTags: null,
    config: null,
    searchIndex: null,
    currentSearchQuery: "",
    currentMode: null,
    isSaving: false,
    isInjecting: false,
    injectToken: 0,
    scheduledRouteToken: 0,
    injectedForKey: null,
    loadedSelectionKey: null,
    lastPath: "",
    observer: null,
    observerTimer: null,
    lastMiddleClickTagId: null,
    lastMiddleClickAt: 0,
    uiState: {
      entityKey: null,
      mode: null,
      groupStates: new Map(),
      subgroupStates: new Map(),
    },
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

  function notifyLayoutChanged() {
    window.dispatchEvent(
      new CustomEvent(LAYOUT_CHANGED_EVENT, {
        detail: { source: PLUGIN_ID },
      })
    );
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

  function normalizeDisplayMode(value, fallback) {
    const normalized = String(value || fallback || "").trim();
    if (normalized === "image") return "image";
    if (normalized === "imageAndText") return "imageAndText";
    return "text";
  }

  function getDisplayMode(cfg, modeOverride) {
    const mode = modeOverride || state.currentMode || "display";
    if (mode === "edit") {
      return normalizeDisplayMode(cfg.c_displayModeEdit, "text");
    }

    if (mode === "display") {
      return normalizeDisplayMode(cfg.b_displayModeDisplay, "imageAndText");
    }

    return "text";
  }

  function getDefaultMode(cfg) {
    const value = String(cfg.a_defaultMode ?? cfg.defaultMode ?? "display")
      .trim()
      .toLowerCase();
    return value === "edit" ? "edit" : "display";
  }

  function getImageSize(cfg, modeOverride) {
    const mode = modeOverride || state.currentMode || "display";
    if (mode === "edit") {
      return getConfigNumber(cfg.c_imageSizeEdit, 56, 24, 256);
    }
    return getConfigNumber(cfg.b_imageSizeDisplay, 72, 24, 256);
  }

  function getImageColumns(cfg, modeOverride) {
    const mode = modeOverride || state.currentMode || "display";
    if (mode === "edit") {
      return getConfigNumber(cfg.c_imageColumnsEdit, 3, 1, 24);
    }
    return getConfigNumber(cfg.b_imageColumnsDisplay, 3, 1, 24);
  }

  function getSelectedBorderColor(cfg) {
    const value = String(cfg.d_selectedBorderColor || "").trim();
    return value || "#ffffff";
  }

  function getPanelOpacity(cfg) {
    const parsed = parseFloat(String(cfg.d_panelOpacity || "").trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return String(parsed);
    }
    return "0.1";
  }

  function getFontColor(cfg) {
    const value = String(cfg.d_fontColor || "").trim();
    return value || "#ffffff";
  }

  function getBackgroundColor(cfg) {
    const value = String(cfg.d_backgroundColor || "").trim();
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

  function getFontSizeValue(value, fallback) {
    const normalized = String(value || "").trim();
    if (!normalized) return fallback;
    if (/^\d+(\.\d+)?$/.test(normalized)) {
      return `${normalized}px`;
    }
    return normalized;
  }

  function getParentFontSize(cfg, modeOverride) {
    const mode = modeOverride || state.currentMode || "display";
    if (mode === "edit") {
      return getFontSizeValue(cfg.c_parentFontSizeEdit, "0.95rem");
    }
    return getFontSizeValue(cfg.b_parentFontSizeDisplay, "1rem");
  }

  function getSubgroupFontSize(cfg, modeOverride) {
    const mode = modeOverride || state.currentMode || "display";
    if (mode === "edit") {
      return getFontSizeValue(cfg.c_subgroupFontSizeEdit, "0.88rem");
    }
    return getFontSizeValue(cfg.b_subgroupFontSizeDisplay, "0.92rem");
  }

  function getTagFontSize(cfg, modeOverride) {
    const mode = modeOverride || state.currentMode || "display";
    if (mode === "edit") {
      return getFontSizeValue(cfg.c_tagFontSizeEdit, "0.78rem");
    }
    return getFontSizeValue(cfg.b_tagFontSizeDisplay, "0.82rem");
  }

  function shouldLinkGroupHeaders(cfg) {
    return getConfigBoolean(cfg.d_linkGroupHeaders, true);
  }

  function shouldShowCollapseButtons(cfg) {
    return getConfigBoolean(cfg.d_showCollapseButtons, true);
  }

  function shouldOptimizeFormatting(cfg) {
    return getConfigBoolean(cfg.a_optimizeFormatting, true);
  }

  function getBlacklistedParentNames(cfg) {
    return new Set(
      String(cfg.a_parentTagBlacklist || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  function getBlacklistedSubgroupNames(cfg) {
    return new Set(
      String(cfg.a_subgroupTagBlacklist || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  function isBlacklistedParent(parent, blacklist) {
    const name = String(parent?.name || "").trim().toLowerCase();
    return !!name && blacklist.has(name);
  }

  function isBlacklistedSubgroup(parent, blacklist) {
    const name = String(parent?.name || "").trim().toLowerCase();
    return !!name && blacklist.has(name);
  }

  function getTagPerformersHref(tagId) {
    return `/tags/${tagId}/performers`;
  }

  function applyPanelVariables(panel, cfg) {
    const mode = state.currentMode || "display";
    const imageSize = getImageSize(cfg, mode);
    const imageOnlySize = Math.max(24, Math.round(imageSize * 1.1));
    panel.style.setProperty("--pto-image-size", `${imageSize}px`);
    panel.style.setProperty("--pto-image-only-size", `${imageOnlySize}px`);
    panel.style.setProperty("--pto-image-columns", `${getImageColumns(cfg, mode)}`);
    panel.style.setProperty(
      "--pto-selected-border-color",
      getSelectedBorderColor(cfg)
    );
    const panelOpacity = getPanelOpacity(cfg);
    const backgroundColor = getBackgroundColor(cfg);
    panel.style.setProperty("--pto-panel-opacity", panelOpacity);
    panel.style.setProperty("--pto-font-color", getFontColor(cfg));
    panel.style.setProperty("--pto-panel-bg-color", backgroundColor);
    panel.style.setProperty(
      "--pto-panel-surface-025",
      makeSurfaceColor(backgroundColor, panelOpacity, 0.82)
    );
    panel.style.setProperty(
      "--pto-panel-surface-03",
      makeSurfaceColor(backgroundColor, panelOpacity, 0.88)
    );
    panel.style.setProperty(
      "--pto-panel-surface-04",
      makeSurfaceColor(backgroundColor, panelOpacity, 0.92)
    );
    panel.style.setProperty(
      "--pto-panel-surface-05",
      makeSurfaceColor(backgroundColor, panelOpacity, 0.96)
    );
    panel.style.setProperty(
      "--pto-panel-surface-06",
      makeSurfaceColor(backgroundColor, panelOpacity, 1)
    );
    panel.style.setProperty(
      "--pto-parent-font-size",
      getParentFontSize(cfg, mode)
    );
    panel.style.setProperty(
      "--pto-subgroup-font-size",
      getSubgroupFontSize(cfg, mode)
    );
    panel.style.setProperty(
      "--pto-tag-font-size",
      getTagFontSize(cfg, mode)
    );
  }

  async function loadConfig(forceReload = false) {
    if (state.config && !forceReload) return state.config;

    try {
      const data = await gqlRequest(`
        query PerformerTagsOverhaulConfig {
          configuration {
            plugins
          }
        }
      `);
      state.config = data?.configuration?.plugins?.[PLUGIN_ID] || {};
    } catch (err) {
      console.error("[PerformerTagsOverhaul] config load failed", err);
      state.config = {};
    }

    const uiState = getCurrentUiState();
    if (uiState && !uiState.mode) {
      uiState.mode = getDefaultMode(state.config);
    }
    if (!state.currentMode) {
      state.currentMode = uiState?.mode || getDefaultMode(state.config);
    }

    return state.config;
  }

  async function fetchAllTags() {
    if (state.allTags) return state.allTags;

    const data = await gqlRequest(`
      query PerformerTagsOverhaulAllTags {
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
    `);

    state.allTags = data?.findTags?.tags || [];
    return state.allTags;
  }

  function getPerformerFromPath(pathname) {
    const match = pathname.match(/^\/performers\/(\d+)/);
    if (!match) return null;
    return { id: match[1], type: "performer" };
  }

  function isSupportedPage() {
    return !!getPerformerFromPath(window.location.pathname);
  }

  function getCurrentKey(performer) {
    return performer ? `${performer.type}:${performer.id}` : null;
  }

  function getCurrentUiState() {
    const entityKey = getCurrentKey(state.currentPerformer);
    if (!entityKey) return null;
    if (state.uiState.entityKey !== entityKey) {
      state.uiState = {
        entityKey,
        mode: null,
        groupStates: new Map(),
        subgroupStates: new Map(),
      };
    }
    return state.uiState;
  }

  function isSectionRememberedOpen(kind, id) {
    const uiState = getCurrentUiState();
    if (!uiState) return null;
    const collection =
      kind === "group" ? uiState.groupStates : uiState.subgroupStates;
    const normalizedId = String(id);
    if (!collection.has(normalizedId)) return null;
    return collection.get(normalizedId);
  }

  function rememberSectionState(kind, id, isOpen) {
    const uiState = getCurrentUiState();
    if (!uiState) return;
    const collection =
      kind === "group" ? uiState.groupStates : uiState.subgroupStates;
    const normalizedId = String(id);
    collection.set(normalizedId, !!isOpen);
  }

  function rememberMode(mode) {
    const uiState = getCurrentUiState();
    if (uiState) uiState.mode = mode;
    state.currentMode = mode;
  }

  function openTagFromMiddleClick(tagId) {
    if (!tagId) return;
    state.lastMiddleClickTagId = String(tagId);
    state.lastMiddleClickAt = Date.now();
    window.open(getTagPerformersHref(tagId), "_blank", "noopener");
  }

  function shouldSuppressAuxMiddleClick(tagId) {
    const normalizedId = String(tagId || "");
    if (!normalizedId || !state.lastMiddleClickTagId) return false;
    return (
      state.lastMiddleClickTagId === normalizedId &&
      Date.now() - state.lastMiddleClickAt < 750
    );
  }

  function getTagsDetailItem() {
    const detailHeader = document.querySelector(".detail-header");
    if (!detailHeader) return null;

    const detailGroups = Array.from(detailHeader.querySelectorAll(".detail-group"));
    for (const group of detailGroups) {
      const tagItem = group.querySelector(".detail-item.tags");
      if (tagItem) return tagItem;
    }

    return detailHeader.querySelector(".detail-item.tags");
  }

  function getDetailRoot() {
    return (
      document.querySelector(".detail-container") ||
      document.querySelector(".detail-header")
    );
  }

  function getDetailHeader() {
    return document.querySelector(".detail-header") || getDetailRoot();
  }

  function ensureFallbackHostGroup() {
    const detailRoot = getDetailRoot();
    if (!detailRoot) return null;

    let hostGroup = document.getElementById(FALLBACK_GROUP_ID);
    if (hostGroup) return hostGroup;

    hostGroup = document.createElement("div");
    hostGroup.id = FALLBACK_GROUP_ID;
    hostGroup.className = "detail-group performer-tags-overhaul__fallback-group";
    const detailGroups = Array.from(detailRoot.querySelectorAll(".detail-group"));
    const lastDetailGroup = detailGroups.length ? detailGroups[detailGroups.length - 1] : null;

    if (lastDetailGroup && lastDetailGroup.parentNode === detailRoot) {
      detailRoot.insertBefore(hostGroup, lastDetailGroup.nextSibling);
    } else {
      detailRoot.appendChild(hostGroup);
    }
    return hostGroup;
  }

  function getInjectionAnchor() {
    return ensureFallbackHostGroup();
  }

  function hideOriginalTagItem() {
    const tagsItem = getTagsDetailItem();
    if (tagsItem) {
      tagsItem.classList.add("performer-tags-overhaul__original-hidden");
    }
  }

  function showOriginalTagItem() {
    document
      .querySelectorAll(".performer-tags-overhaul__original-hidden")
      .forEach((el) => el.classList.remove("performer-tags-overhaul__original-hidden"));
  }

  function cleanupPanel() {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(FALLBACK_GROUP_ID)?.remove();
    state.injectedForKey = null;
    showOriginalTagItem();
    if (state.observerTimer) {
      clearTimeout(state.observerTimer);
      state.observerTimer = null;
    }
  }

  async function fetchPerformerTagIds(performerId) {
    const data = await gqlRequest(
      `
        query FindPerformerForTagsOverhaul($id: ID!) {
          findPerformer(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      { id: performerId }
    );

    return new Set((data?.findPerformer?.tags || []).map((tag) => String(tag.id)));
  }

  async function savePerformerTagIds(performerId, tagIds) {
    const data = await gqlRequest(
      `
        mutation UpdatePerformerTags($input: PerformerUpdateInput!) {
          performerUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: performerId,
          tag_ids: tagIds,
        },
      }
    );

    return data?.performerUpdate?.id;
  }

  async function ensureSelectedTagIds(performer) {
    const key = getCurrentKey(performer);
    if (state.loadedSelectionKey === key) return state.selectedTagIds;

    state.selectedTagIds = await fetchPerformerTagIds(performer.id);
    state.loadedSelectionKey = key;
    return state.selectedTagIds;
  }

  function sortItemsBySortNameThenName(items) {
    items.sort((a, b) => {
      const aKey = (a.sort_name || a.name || "").toLowerCase();
      const bKey = (b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
  }

  function createTagMap(tags) {
    const tagMap = new Map();

    tags.forEach((tag) => {
      tagMap.set(String(tag.id), {
        id: String(tag.id),
        name: tag.name,
        sort_name: tag.sort_name || tag.name || "",
        image_path: tag.image_path || "",
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

    return tagMap;
  }

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
    };
  }

  function getParentPaths(tagRecord, tagMap, duplicateMultiParentTags) {
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

  function buildNestedGroups(tags, cfg, options = {}) {
    const duplicateMultiParentTags = getConfigBoolean(
      cfg.a_duplicateMultiParentTags,
      false
    );
    const blacklistedParents = getBlacklistedParentNames(cfg);
    const blacklistedSubgroups = getBlacklistedSubgroupNames(cfg);
    const selectedOnly = !!options.selectedOnly;
    const showParentTagsAsLeaves = !!options.showParentTagsAsLeaves;
    const selectedTagIds = options.selectedTagIds || new Set();
    const tagMap = createTagMap(tags);

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
      if (selectedOnly && !selectedTagIds.has(tagId)) continue;

      const tagRecord = tagMap.get(tagId);
      if (!tagRecord) continue;

      const parentTag = isParentTag(tagRecord);
      const paths = getParentPaths(tagRecord, tagMap, duplicateMultiParentTags);

      for (const path of paths) {
        if (
          (path.type === "group" && isBlacklistedParent(path.topParent, blacklistedParents)) ||
          (path.type === "subgroup" &&
            (isBlacklistedParent(path.topParent, blacklistedParents) ||
              isBlacklistedSubgroup(path.subgroupParent, blacklistedSubgroups)))
        ) {
          continue;
        }

        if (path.type === "ungrouped") {
          if (parentTag && !showParentTagsAsLeaves) continue;
          const already = ungrouped.items.some((item) => item.id === tagRecord.id);
          if (!already) ungrouped.items.push(createLeaf(tagRecord));
          continue;
        }

        if (path.type === "subgroup") {
          const topGroup = ensureTopGroup(path.topParent);
          const subgroup = ensureSubgroup(topGroup, path.subgroupParent);
          if (!parentTag || showParentTagsAsLeaves) {
            addLeafToSubgroup(subgroup, tagRecord);
          }
          continue;
        }

        if (path.type === "group") {
          const topGroup = ensureTopGroup(path.topParent);
          if (!parentTag || showParentTagsAsLeaves) {
            addLeafToGroup(topGroup, tagRecord);
          }
        }
      }
    }

    const prunedGroups = orderedTopGroups
      .map((group) => {
        group.items = group.items.filter((item) => {
          if (item.type === "leaf") return true;
          if (item.type === "subgroup") return item.children && item.children.length > 0;
          return false;
        });
        return group;
      })
      .filter((group) => group.items.length > 0);

    prunedGroups.sort((a, b) => {
      const aKey = (a.parent.sort_name || a.parent.name || "").toLowerCase();
      const bKey = (b.parent.sort_name || b.parent.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    for (const group of prunedGroups) {
      sortItemsBySortNameThenName(group.items);
      for (const item of group.items) {
        if (item.type === "subgroup" && Array.isArray(item.children)) {
          sortItemsBySortNameThenName(item.children);
        }
      }
    }

    sortItemsBySortNameThenName(ungrouped.items);
    if (ungrouped.items.length) prunedGroups.push(ungrouped);

    return prunedGroups.map((group) => {
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
      cfg.a_duplicateMultiParentTags,
      false
    );
    const blacklistedParents = getBlacklistedParentNames(cfg);
    const blacklistedSubgroups = getBlacklistedSubgroupNames(cfg);
    const tagMap = createTagMap(tags);
    const results = [];

    for (const tag of tags) {
      const tagRecord = tagMap.get(String(tag.id));
      if (!tagRecord) continue;

      const parentTag = isParentTag(tagRecord);
      const paths = getParentPaths(tagRecord, tagMap, duplicateMultiParentTags);

      for (const path of paths) {
        if (
          (path.type === "group" && isBlacklistedParent(path.topParent, blacklistedParents)) ||
          (path.type === "subgroup" &&
            (isBlacklistedParent(path.topParent, blacklistedParents) ||
              isBlacklistedSubgroup(path.subgroupParent, blacklistedSubgroups)))
        ) {
          continue;
        }

        let breadcrumb = "Ungrouped";
        let targetKind = parentTag ? "header" : "leaf";
        let targetId = tagRecord.id;
        let groupId = "__ungrouped__";
        let subgroupId = "";

        if (path.type === "group") {
          breadcrumb = path.topParent.name;
          groupId = String(path.topParent.id);
          if (parentTag) targetId = String(path.topParent.id);
        } else if (path.type === "subgroup") {
          breadcrumb = `${path.topParent.name} > ${path.subgroupParent.name}`;
          groupId = String(path.topParent.id);
          subgroupId = String(path.subgroupParent.id);
          if (parentTag) targetId = String(path.subgroupParent.id);
        }

        results.push({
          id: tagRecord.id,
          name: tagRecord.name,
          sort_name: tagRecord.sort_name || tagRecord.name || "",
          image_path: tagRecord.image_path || "",
          breadcrumb,
          targetKind,
          targetId,
          groupId,
          subgroupId,
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

  function getSearchResults(query, limit = 24) {
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

  function getGroupLeafTotal(group) {
    let total = 0;
    group.items.forEach((item) => {
      if (item.type === "leaf") total += 1;
      if (item.type === "subgroup") total += item.children.length;
    });
    return total;
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

  function shouldSectionStartOpen(cfg, containsSelection) {
    if (getConfigBoolean(cfg.a_defaultExpanded ?? cfg.defaultExpanded, true)) {
      return true;
    }
    if (getConfigBoolean(cfg.a_autoExpandIfSelected ?? cfg.autoExpandIfSelected, true)) {
      return containsSelection;
    }
    return false;
  }

  function getInitialSectionOpenState(kind, id, cfg, containsSelection) {
    const remembered = isSectionRememberedOpen(kind, id);
    if (remembered !== null) return remembered;
    const startsOpen = shouldSectionStartOpen(cfg, containsSelection);
    rememberSectionState(kind, id, startsOpen);
    return startsOpen;
  }

  function createHeaderTitle(name, tagId, cfg, className, linkClass) {
    if (tagId && shouldLinkGroupHeaders(cfg)) {
      const link = document.createElement("a");
      link.className = linkClass;
      link.href = getTagPerformersHref(tagId);
      link.textContent = name;
      link.title = name;
      return link;
    }

    const span = document.createElement("span");
    span.className = className;
    span.textContent = name;
    return span;
  }

  function createCollapseButton(section, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", "Toggle section");
    button.setAttribute("data-pto-toggle-section", "1");
    button.setAttribute("data-pto-toggle-target", section.classList.contains("performer-tags-overhaul__subgroup") ? "subgroup" : "group");
    button.textContent = "▾";

    return button;
  }

  function updateSelectableState(element, selected) {
    element.classList.toggle("is-selected", selected);
    element.setAttribute("aria-pressed", selected ? "true" : "false");
  }

  function updateParentToggleState(element, selected) {
    updateSelectableState(element, selected);
    element.textContent = selected ? "✓" : "+";
    element.title = selected ? "Remove parent tag" : "Add parent tag";
    element.setAttribute(
      "aria-label",
      selected ? "Remove parent tag" : "Add parent tag"
    );
  }

  function createParentToggleButton(tagId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "performer-tags-overhaul__parent-toggle";
    button.setAttribute("data-pto-parent-toggle-id", tagId);
    updateParentToggleState(button, state.selectedTagIds.has(tagId));
    return button;
  }

  function renderTagInner(element, displayMode, hasImage, tag) {
    if (displayMode === "image" && hasImage) {
      element.classList.add("performer-tags-overhaul__tag--image-only");
      const img = document.createElement("img");
      img.className = "performer-tags-overhaul__tag-image";
      img.src = tag.image_path;
      img.alt = tag.name;
      element.appendChild(img);
      return;
    }

    if (displayMode === "imageAndText" && hasImage) {
      element.classList.add("performer-tags-overhaul__tag--image-and-text");
      const img = document.createElement("img");
      img.className = "performer-tags-overhaul__tag-image";
      img.src = tag.image_path;
      img.alt = tag.name;
      element.appendChild(img);

      const label = document.createElement("span");
      label.className = "performer-tags-overhaul__tag-label";
      label.textContent = tag.name;
      element.appendChild(label);
      return;
    }

    element.classList.add("performer-tags-overhaul__tag--text");
    const label = document.createElement("span");
    label.className = "performer-tags-overhaul__tag-label";
    label.textContent = tag.name;
    element.appendChild(label);
  }

  function createTagDisplay(tag, cfg, mode) {
    const displayMode = getDisplayMode(cfg, mode);
    const hasImage = !!tag.image_path;

    if (mode === "display") {
      const link = document.createElement("a");
      link.className = "performer-tags-overhaul__tag";
      link.href = getTagPerformersHref(tag.id);
      link.title = tag.name;
      link.setAttribute("data-pto-tag-id", tag.id);
      link.setAttribute("data-pto-link-tag-id", tag.id);
      renderTagInner(link, displayMode, hasImage, tag);
      return link;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "performer-tags-overhaul__tag";
    button.title = tag.name;
    button.setAttribute("data-pto-tag-id", tag.id);
    renderTagInner(button, displayMode, hasImage, tag);
    updateSelectableState(button, state.selectedTagIds.has(tag.id));
    return button;
  }

  function createLeafWrap(cfg, mode) {
    const wrap = document.createElement("div");
    wrap.className = "performer-tags-overhaul__leaf-wrap";
    const displayMode = getDisplayMode(cfg, mode);
    wrap.setAttribute("data-display-mode", displayMode);
    return wrap;
  }

  function getEffectiveLeafColumns(cfg, mode, leafCount) {
    const configured = Math.max(1, getImageColumns(cfg, mode));
    const count = Math.max(0, Number(leafCount) || 0);
    if (count <= 1) return 1;
    if (!shouldOptimizeFormatting(cfg)) {
      return Math.min(configured, count);
    }
    if (count < configured) return 1;
    return Math.min(configured, count);
  }

  function isStrictLeafLayout(cfg, mode) {
    return !shouldOptimizeFormatting(cfg);
  }

  function applyLeafWrapLayout(wrap, cfg, mode, leafCount) {
    const displayMode = getDisplayMode(cfg, mode);
    const columns = getEffectiveLeafColumns(cfg, mode, leafCount);

    if (displayMode === "text") {
      wrap.style.setProperty("--pto-effective-image-columns", `${columns}`);
      if (columns <= 1) {
        wrap.style.removeProperty("grid-template-columns");
        wrap.style.removeProperty("width");
        wrap.style.removeProperty("max-width");
        return;
      }
      wrap.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      if (isStrictLeafLayout(cfg, mode)) {
        wrap.style.width = "100%";
        wrap.style.maxWidth = "100%";
      } else {
        wrap.style.removeProperty("width");
        wrap.style.removeProperty("max-width");
      }
      return;
    }
    const imageSize = getImageSize(cfg, mode);
    const imageOnlySize = Math.max(24, Math.round(imageSize * 1.1));
    const trackSize = displayMode === "image" ? imageOnlySize : imageSize;

    wrap.style.setProperty("--pto-effective-image-columns", `${columns}`);
    wrap.style.gridTemplateColumns = `repeat(${columns}, ${trackSize}px)`;
    if (isStrictLeafLayout(cfg, mode)) {
      wrap.style.width = "max-content";
      wrap.style.maxWidth = "none";
    } else {
      wrap.style.removeProperty("width");
      wrap.style.removeProperty("max-width");
    }
  }

  function createSubgroupSection(subgroup, cfg, mode) {
    const section = document.createElement("section");
    section.className = "performer-tags-overhaul__subgroup";
    section.setAttribute("data-pto-subgroup-id", subgroup.id);
    section.setAttribute("data-pto-header-tag-id", subgroup.id);
    if (isStrictLeafLayout(cfg, mode)) {
      section.classList.add("performer-tags-overhaul__subgroup--strict");
    }

    const header = document.createElement("div");
    header.className = "performer-tags-overhaul__subgroup-header";

    const left = document.createElement("div");
    left.className = "performer-tags-overhaul__subgroup-header-main";

    const title = createHeaderTitle(
      subgroup.name,
      subgroup.id,
      cfg,
      "performer-tags-overhaul__subgroup-title",
      "performer-tags-overhaul__subgroup-title-link"
    );

    const meta = document.createElement("span");
    meta.className = "performer-tags-overhaul__subgroup-meta";

    const totalCount = document.createElement("span");
    totalCount.className = "performer-tags-overhaul__subgroup-total";
    totalCount.textContent =
      mode === "edit"
        ? `${subgroup.children.length + 1}`
        : `${subgroup.children.length}`;
    meta.appendChild(totalCount);

    if (mode === "edit") {
      const selectedCount = document.createElement("span");
      selectedCount.className = "performer-tags-overhaul__subgroup-selected";
      meta.appendChild(selectedCount);
    }

    left.appendChild(title);
    left.appendChild(meta);
    header.appendChild(left);

    if (mode === "edit") {
      const actions = document.createElement("div");
      actions.className = "performer-tags-overhaul__subgroup-actions";
      actions.appendChild(createParentToggleButton(subgroup.id));
      if (shouldShowCollapseButtons(cfg)) {
        actions.appendChild(
          createCollapseButton(section, "performer-tags-overhaul__subgroup-toggle")
        );
      }
      header.appendChild(actions);
    } else if (shouldShowCollapseButtons(cfg)) {
      header.appendChild(
        createCollapseButton(section, "performer-tags-overhaul__subgroup-toggle")
      );
    }

    const body = document.createElement("div");
    body.className = "performer-tags-overhaul__subgroup-body";

    const leafWrap = createLeafWrap(cfg, mode);
    applyLeafWrapLayout(leafWrap, cfg, mode, subgroup.children.length);
    subgroup.children.forEach((child) => {
      leafWrap.appendChild(createTagDisplay(child, cfg, mode));
    });
    body.appendChild(leafWrap);

    const startsOpen = getInitialSectionOpenState(
      "subgroup",
      subgroup.id,
      cfg,
      subgroupHasSelectedTags(subgroup)
    );
    section.classList.toggle("is-open", startsOpen);

    header.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      if (shouldLinkGroupHeaders(cfg) && event.target.closest("a")) return;
      if (shouldShowCollapseButtons(cfg)) {
        section.classList.toggle("is-open");
        rememberSectionState(
          "subgroup",
          subgroup.id,
          section.classList.contains("is-open")
        );
      }
    });

    if (shouldShowCollapseButtons(cfg)) {
      left.style.cursor = "pointer";
    }

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function createGroupSection(group, cfg, mode) {
    const section = document.createElement("section");
    section.className = "performer-tags-overhaul__group";
    section.setAttribute("data-pto-group-id", group.parent.id);
    section.setAttribute("data-pto-header-tag-id", group.parent.id);

    const header = document.createElement("div");
    header.className = "performer-tags-overhaul__group-header";

    const left = document.createElement("div");
    left.className = "performer-tags-overhaul__group-header-main";

    const title = createHeaderTitle(
      group.parent.name,
      group.parent.id === "__ungrouped__" ? null : group.parent.id,
      cfg,
      "performer-tags-overhaul__group-title",
      "performer-tags-overhaul__group-title-link"
    );

    const meta = document.createElement("span");
    meta.className = "performer-tags-overhaul__group-meta";

    const totalCount = document.createElement("span");
    totalCount.className = "performer-tags-overhaul__group-total";
    totalCount.textContent = `${getGroupLeafTotal(group)}`;
    meta.appendChild(totalCount);

    if (mode === "edit") {
      const selectedCount = document.createElement("span");
      selectedCount.className = "performer-tags-overhaul__group-selected";
      meta.appendChild(selectedCount);
    }

    left.appendChild(title);
    left.appendChild(meta);
    header.appendChild(left);

    if (mode === "edit" && group.parent.id !== "__ungrouped__") {
      const actions = document.createElement("div");
      actions.className = "performer-tags-overhaul__group-actions";
      actions.appendChild(createParentToggleButton(group.parent.id));
      if (shouldShowCollapseButtons(cfg)) {
        actions.appendChild(
          createCollapseButton(section, "performer-tags-overhaul__group-toggle")
        );
      }
      header.appendChild(actions);
    } else if (shouldShowCollapseButtons(cfg)) {
      header.appendChild(
        createCollapseButton(section, "performer-tags-overhaul__group-toggle")
      );
    }

    const body = document.createElement("div");
    body.className = "performer-tags-overhaul__group-body";

    const subgroupGrid = document.createElement("div");
    subgroupGrid.className = "performer-tags-overhaul__subgroup-grid";

    const rootLeafItems = group.items.filter((item) => item.type === "leaf");
    if (rootLeafItems.length) {
      const rootCard = document.createElement("section");
      rootCard.className =
        "performer-tags-overhaul__subgroup performer-tags-overhaul__subgroup--root";
      rootCard.classList.add("is-open");
      if (isStrictLeafLayout(cfg, mode)) {
        rootCard.classList.add("performer-tags-overhaul__subgroup--strict");
      }

      const rootHeader = document.createElement("div");
      rootHeader.className =
        "performer-tags-overhaul__subgroup-header performer-tags-overhaul__subgroup-header--static";

      const rootTitle = document.createElement("span");
      rootTitle.className = "performer-tags-overhaul__subgroup-title";
      rootTitle.textContent = group.parent.id === "__ungrouped__" ? "Tags" : "General";
      rootHeader.appendChild(rootTitle);

      const rootBody = document.createElement("div");
      rootBody.className = "performer-tags-overhaul__subgroup-body";

      const rootLeafWrap = createLeafWrap(cfg, mode);
      applyLeafWrapLayout(rootLeafWrap, cfg, mode, rootLeafItems.length);

      rootLeafItems.forEach((child) => {
        rootLeafWrap.appendChild(createTagDisplay(child, cfg, mode));
      });

      rootBody.appendChild(rootLeafWrap);
      rootCard.appendChild(rootHeader);
      rootCard.appendChild(rootBody);
      subgroupGrid.appendChild(rootCard);
    }

    group.items.forEach((item) => {
      if (item.type === "subgroup") {
        subgroupGrid.appendChild(createSubgroupSection(item, cfg, mode));
      }
    });

    body.appendChild(subgroupGrid);
    section.appendChild(header);
    section.appendChild(body);

    const startsOpen = getInitialSectionOpenState(
      "group",
      group.parent.id,
      cfg,
      groupHasSelectedTags(group)
    );
    section.classList.toggle("is-open", startsOpen);

    header.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      if (shouldLinkGroupHeaders(cfg) && event.target.closest("a")) return;
      if (shouldShowCollapseButtons(cfg)) {
        section.classList.toggle("is-open");
        rememberSectionState(
          "group",
          group.parent.id,
          section.classList.contains("is-open")
        );
      }
    });

    if (shouldShowCollapseButtons(cfg)) {
      left.style.cursor = "pointer";
    }

    return section;
  }

  function createModeToggle() {
    const wrap = document.createElement("div");
    wrap.className = "performer-tags-overhaul__mode-toggle";

    const displayButton = document.createElement("button");
    displayButton.type = "button";
    displayButton.className = "performer-tags-overhaul__mode-button";
    displayButton.textContent = "Display";
    displayButton.setAttribute("data-pto-mode", "display");

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "performer-tags-overhaul__mode-button";
    editButton.textContent = "Edit";
    editButton.setAttribute("data-pto-mode", "edit");

    if (state.currentMode === "display") displayButton.classList.add("is-active");
    if (state.currentMode === "edit") editButton.classList.add("is-active");

    wrap.appendChild(displayButton);
    wrap.appendChild(editButton);
    return wrap;
  }

  function createSearchControls() {
    const wrap = document.createElement("div");
    wrap.className = "performer-tags-overhaul__search";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "performer-tags-overhaul__search-input";
    input.placeholder = "Search tags to reveal or toggle";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = state.currentSearchQuery || "";

    const results = document.createElement("div");
    results.className = "performer-tags-overhaul__search-results";

    const empty = document.createElement("div");
    empty.className = "performer-tags-overhaul__search-empty";
    empty.textContent = "No matching tags";
    empty.hidden = true;

    input.addEventListener("input", () => {
      state.currentSearchQuery = input.value || "";
      renderSearchResults(wrap.closest(`#${PANEL_ID}`));
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        input.value = "";
        state.currentSearchQuery = "";
        renderSearchResults(wrap.closest(`#${PANEL_ID}`));
        return;
      }

      if (event.key === "Enter") {
        const first = wrap.querySelector("[data-pto-search-jump-id]");
        if (first) {
          event.preventDefault();
          first.click();
        }
      }
    });

    wrap.appendChild(input);
    wrap.appendChild(results);
    wrap.appendChild(empty);
    return wrap;
  }

  function flashSearchTarget(target) {
    if (!target) return;
    target.classList.remove("performer-tags-overhaul__flash");
    void target.offsetWidth;
    target.classList.add("performer-tags-overhaul__flash");
    setTimeout(() => {
      target.classList.remove("performer-tags-overhaul__flash");
    }, 1600);
  }

  function revealSearchResult(result) {
    if (!result) return;

    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const group = panel.querySelector(
      `[data-pto-group-id="${CSS.escape(result.groupId)}"]`
    );
    if (group) group.classList.add("is-open");

    let target = null;

    if (result.subgroupId) {
      const subgroup = panel.querySelector(
        `[data-pto-subgroup-id="${CSS.escape(result.subgroupId)}"]`
      );
      if (subgroup) subgroup.classList.add("is-open");

      if (result.targetKind === "header") target = subgroup || group;
      else {
        target = subgroup?.querySelector(
          `[data-pto-tag-id="${CSS.escape(result.targetId)}"]`
        );
      }
    } else if (result.targetKind === "header") {
      target = group;
    } else {
      target = group?.querySelector(
        `[data-pto-tag-id="${CSS.escape(result.targetId)}"]`
      );
    }

    if (!target && result.targetKind === "header") {
      target = panel.querySelector(
        `[data-pto-header-tag-id="${CSS.escape(result.targetId)}"]`
      );
    }

    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    flashSearchTarget(target);
  }

  function renderSearchResults(panel) {
    const resultsWrap = panel?.querySelector(".performer-tags-overhaul__search-results");
    const emptyEl = panel?.querySelector(".performer-tags-overhaul__search-empty");
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
      row.className = "performer-tags-overhaul__search-result";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "performer-tags-overhaul__search-result-main";
      main.setAttribute("data-pto-search-jump-id", result.id);
      main.setAttribute("data-pto-search-target-id", result.targetId);
      main.setAttribute("data-pto-search-target-kind", result.targetKind);
      main.setAttribute("data-pto-search-group-id", result.groupId);
      if (result.subgroupId) {
        main.setAttribute("data-pto-search-subgroup-id", result.subgroupId);
      }

      if (result.image_path) {
        const img = document.createElement("img");
        img.className = "performer-tags-overhaul__search-result-image";
        img.src = result.image_path;
        img.alt = result.name;
        main.appendChild(img);
      }

      const textWrap = document.createElement("span");
      textWrap.className = "performer-tags-overhaul__search-result-text";

      const nameEl = document.createElement("span");
      nameEl.className = "performer-tags-overhaul__search-result-name";
      nameEl.textContent = result.name;

      const pathEl = document.createElement("span");
      pathEl.className = "performer-tags-overhaul__search-result-path";
      pathEl.textContent = result.breadcrumb;

      textWrap.appendChild(nameEl);
      textWrap.appendChild(pathEl);
      main.appendChild(textWrap);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "performer-tags-overhaul__search-result-toggle";
      toggle.setAttribute("data-pto-search-toggle-id", result.id);
      toggle.textContent = state.selectedTagIds.has(result.id) ? "✓" : "+";
      toggle.classList.toggle("is-selected", state.selectedTagIds.has(result.id));

      row.appendChild(main);
      row.appendChild(toggle);
      resultsWrap.appendChild(row);
    });
  }

  function syncRenderedSelectionStates() {
    document.querySelectorAll("[data-pto-tag-id]").forEach((element) => {
      if (element.matches("a")) return;
      const id = element.getAttribute("data-pto-tag-id");
      updateSelectableState(element, state.selectedTagIds.has(id));
    });

    document.querySelectorAll("[data-pto-parent-toggle-id]").forEach((element) => {
      const id = element.getAttribute("data-pto-parent-toggle-id");
      updateParentToggleState(element, state.selectedTagIds.has(id));
    });

    document.querySelectorAll("[data-pto-group-id]").forEach((section) => {
      const counter = section.querySelector(".performer-tags-overhaul__group-selected");
      if (!counter) return;

      let selectedCount = 0;
      const leafButtons = section.querySelectorAll(
        ".performer-tags-overhaul__tag[data-pto-tag-id]:not(a)"
      );
      leafButtons.forEach((button) => {
        if (button.classList.contains("is-selected")) selectedCount += 1;
      });

      const parentToggle = section.querySelector("[data-pto-parent-toggle-id]");
      if (parentToggle && parentToggle.classList.contains("is-selected")) {
        selectedCount += 1;
      }

      counter.textContent = selectedCount > 0 ? `${selectedCount} selected` : "";
    });

    document.querySelectorAll("[data-pto-subgroup-id]").forEach((section) => {
      const counter = section.querySelector(".performer-tags-overhaul__subgroup-selected");
      if (!counter) return;

      let selectedCount = 0;
      const leafButtons = section.querySelectorAll(
        ".performer-tags-overhaul__tag[data-pto-tag-id]:not(a)"
      );
      leafButtons.forEach((button) => {
        if (button.classList.contains("is-selected")) selectedCount += 1;
      });

      const parentToggle = section.querySelector("[data-pto-parent-toggle-id]");
      if (parentToggle && parentToggle.classList.contains("is-selected")) {
        selectedCount += 1;
      }

      counter.textContent = selectedCount > 0 ? `${selectedCount} selected` : "";
    });

    document.querySelectorAll("[data-pto-search-toggle-id]").forEach((element) => {
      const id = element.getAttribute("data-pto-search-toggle-id");
      const selected = state.selectedTagIds.has(id);
      element.classList.toggle("is-selected", selected);
      element.textContent = selected ? "✓" : "+";
      element.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  async function onTagToggle(tagId) {
    if (!state.currentPerformer || state.isSaving) return;

    const wasSelected = state.selectedTagIds.has(tagId);
    if (wasSelected) state.selectedTagIds.delete(tagId);
    else state.selectedTagIds.add(tagId);

    syncRenderedSelectionStates();

    state.isSaving = true;
    document.body.classList.add("performer-tags-overhaul--saving");

    try {
      await savePerformerTagIds(
        state.currentPerformer.id,
        Array.from(state.selectedTagIds)
      );
      state.loadedSelectionKey = getCurrentKey(state.currentPerformer);
    } catch (err) {
      console.error("[PerformerTagsOverhaul] tag save failed", err);
      if (wasSelected) state.selectedTagIds.add(tagId);
      else state.selectedTagIds.delete(tagId);
      syncRenderedSelectionStates();
    } finally {
      state.isSaving = false;
      document.body.classList.remove("performer-tags-overhaul--saving");
    }
  }

  function rerenderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !state.config || !state.allTags) return;

    const groups =
      state.currentMode === "display"
        ? buildNestedGroups(state.allTags, state.config, {
            selectedOnly: true,
            selectedTagIds: state.selectedTagIds,
            showParentTagsAsLeaves: false,
          })
        : buildNestedGroups(state.allTags, state.config, {
            selectedOnly: false,
            selectedTagIds: state.selectedTagIds,
            showParentTagsAsLeaves: false,
          });

    const nextPanel = createPanel(groups, state.config);
    panel.replaceWith(nextPanel);
    syncRenderedSelectionStates();
    notifyLayoutChanged();
  }

  function attachPanelEventDelegation(panel) {
    panel.addEventListener("click", (event) => {
      const toggleButton = event.target.closest("[data-pto-toggle-section]");
      if (toggleButton) {
        event.preventDefault();
        event.stopPropagation();
        const section = toggleButton.closest(
          ".performer-tags-overhaul__subgroup, .performer-tags-overhaul__group"
        );
        if (section) {
          section.classList.toggle("is-open");
          const kind = section.classList.contains("performer-tags-overhaul__subgroup")
            ? "subgroup"
            : "group";
          const id =
            kind === "subgroup"
              ? section.getAttribute("data-pto-subgroup-id")
              : section.getAttribute("data-pto-group-id");
          if (id) {
            rememberSectionState(kind, id, section.classList.contains("is-open"));
          }
          notifyLayoutChanged();
        }
        return;
      }

      const modeButton = event.target.closest("[data-pto-mode]");
      if (modeButton) {
        event.preventDefault();
        const nextMode = modeButton.getAttribute("data-pto-mode");
        if (nextMode && nextMode !== state.currentMode) {
          rememberMode(nextMode);
          rerenderPanel();
        }
        return;
      }

      const searchJump = event.target.closest("[data-pto-search-jump-id]");
      if (searchJump) {
        event.preventDefault();
        revealSearchResult({
          id: searchJump.getAttribute("data-pto-search-jump-id"),
          targetId: searchJump.getAttribute("data-pto-search-target-id"),
          targetKind: searchJump.getAttribute("data-pto-search-target-kind"),
          groupId: searchJump.getAttribute("data-pto-search-group-id"),
          subgroupId: searchJump.getAttribute("data-pto-search-subgroup-id") || "",
        });
        return;
      }

      const searchToggle = event.target.closest("[data-pto-search-toggle-id]");
      if (searchToggle) {
        event.preventDefault();
        onTagToggle(searchToggle.getAttribute("data-pto-search-toggle-id"));
        return;
      }

      if (state.currentMode !== "edit") return;

      const parentToggle = event.target.closest("[data-pto-parent-toggle-id]");
      if (parentToggle) {
        event.preventDefault();
        onTagToggle(parentToggle.getAttribute("data-pto-parent-toggle-id"));
        return;
      }

      const tagButton = event.target.closest(
        "button.performer-tags-overhaul__tag[data-pto-tag-id]"
      );
      if (tagButton) {
        event.preventDefault();
        onTagToggle(tagButton.getAttribute("data-pto-tag-id"));
      }
    });

    panel.addEventListener("transitionend", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        !target.matches(".performer-tags-overhaul__group-body") &&
        !target.matches(".performer-tags-overhaul__subgroup-body")
      ) {
        return;
      }

      notifyLayoutChanged();
    });

    panel.addEventListener("auxclick", (event) => {
      if (state.currentMode !== "edit" || event.button !== 1) return;
      const tagButton = event.target.closest("[data-pto-tag-id]");
      if (!tagButton) return;
      event.preventDefault();
      const tagId = tagButton.getAttribute("data-pto-tag-id");
      if (shouldSuppressAuxMiddleClick(tagId)) {
        state.lastMiddleClickTagId = null;
        state.lastMiddleClickAt = 0;
        return;
      }
      if (tagId) openTagFromMiddleClick(tagId);
    });

    panel.addEventListener("mousedown", (event) => {
      if (state.currentMode !== "edit" || event.button !== 1) return;
      const tagButton = event.target.closest("[data-pto-tag-id]");
      if (!tagButton) return;
      event.preventDefault();
      const tagId = tagButton.getAttribute("data-pto-tag-id");
      if (tagId) openTagFromMiddleClick(tagId);
    });
  }

  function createPanel(groups, cfg) {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "performer-tags-overhaul";
    panel.setAttribute("data-mode", state.currentMode);

    applyPanelVariables(panel, cfg);

    const header = document.createElement("div");
    header.className = "performer-tags-overhaul__panel-header";

    const titleBlock = document.createElement("div");
    titleBlock.className = "performer-tags-overhaul__panel-title-wrap";

    const heading = document.createElement("h6");
    heading.className = "performer-tags-overhaul__panel-title";
    heading.textContent = "Tags";

    const summary = document.createElement("div");
    summary.className = "performer-tags-overhaul__panel-summary";
    summary.textContent = `${groups.length} groups`;

    titleBlock.appendChild(heading);
    titleBlock.appendChild(summary);
    header.appendChild(titleBlock);
    header.appendChild(createModeToggle());
    panel.appendChild(header);

    if (state.currentMode === "edit") {
      panel.appendChild(createSearchControls());
    }

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "performer-tags-overhaul__groups";

    if (!groups.length) {
      const empty = document.createElement("div");
      empty.className = "performer-tags-overhaul__empty";
      empty.textContent =
        state.currentMode === "display"
          ? "No performer tags to display"
          : "No tag hierarchy available";
      groupsWrap.appendChild(empty);
    } else {
      groups.forEach((group) => {
        groupsWrap.appendChild(createGroupSection(group, cfg, state.currentMode));
      });
    }

    panel.appendChild(groupsWrap);
    attachPanelEventDelegation(panel);
    if (state.currentMode === "edit") renderSearchResults(panel);
    return panel;
  }

  async function injectPanelIfPossible() {
    if (state.isInjecting) return false;
    if (!isSupportedPage()) return false;

    const performer = getPerformerFromPath(window.location.pathname);
    if (!performer) return false;

    const initialAnchor = getInjectionAnchor();
    if (!initialAnchor) return false;

    const key = getCurrentKey(performer);
    if (state.injectedForKey === key && document.getElementById(PANEL_ID)) {
      return true;
    }

    state.isInjecting = true;
    const token = ++state.injectToken;

    try {
      state.currentPerformer = performer;

      const [cfg, allTags] = await Promise.all([loadConfig(true), fetchAllTags()]);
      const uiState = getCurrentUiState();
      state.currentMode = uiState?.mode || getDefaultMode(cfg);
      await ensureSelectedTagIds(performer);

      if (token !== state.injectToken) return false;

      const latestPerformer = getPerformerFromPath(window.location.pathname);
      if (!latestPerformer || getCurrentKey(latestPerformer) !== key) return false;

      cleanupPanel();
      state.currentPerformer = latestPerformer;
      state.searchIndex = buildSearchIndex(allTags, cfg);

      const groups =
        state.currentMode === "display"
          ? buildNestedGroups(allTags, cfg, {
              selectedOnly: true,
              selectedTagIds: state.selectedTagIds,
              showParentTagsAsLeaves: false,
            })
          : buildNestedGroups(allTags, cfg, {
              selectedOnly: false,
              selectedTagIds: state.selectedTagIds,
              showParentTagsAsLeaves: false,
            });

      const anchor = getInjectionAnchor();
      if (!anchor) return false;

      const panel = createPanel(groups, cfg);
      anchor.appendChild(panel);
      hideOriginalTagItem();
      syncRenderedSelectionStates();
      notifyLayoutChanged();

      state.injectedForKey = key;
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
          console.error("[PerformerTagsOverhaul] injection failed", err);
        });
      }, delay);
    }
  }

  function scheduleDelayedInject(delay = 150) {
    const routeToken = ++state.scheduledRouteToken;

    setTimeout(() => {
      if (routeToken !== state.scheduledRouteToken) return;
      injectPanelIfPossible().catch((err) => {
        console.error("[PerformerTagsOverhaul] delayed injection failed", err);
      });
    }, delay);
  }

  function handleRouteChange() {
    const path = window.location.pathname + window.location.search;
    if (path === state.lastPath) return;
    state.lastPath = path;

    if (!isSupportedPage()) {
      cleanupPanel();
      state.currentPerformer = null;
      state.selectedTagIds = new Set();
      state.loadedSelectionKey = null;
      state.searchIndex = null;
      state.currentSearchQuery = "";
      return;
    }

    const performer = getPerformerFromPath(window.location.pathname);
    if (getCurrentKey(performer) !== state.loadedSelectionKey) {
      state.selectedTagIds = new Set();
    }

    cleanupPanel();
  }

  function installHistoryHooks() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(() => {
        handleRouteChange();
        scheduleRouteInjects();
      }, 0);
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(() => {
        handleRouteChange();
        scheduleRouteInjects();
      }, 0);
      return result;
    };

    window.addEventListener("popstate", () => {
      setTimeout(() => {
        handleRouteChange();
        scheduleRouteInjects();
      }, 0);
    });
  }

  function installPageClickHook() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("a, button, [role='tab']");
      if (!target) return;

      const text = (target.textContent || "").trim().toLowerCase();
      const href = target.getAttribute("href") || "";
      const likelyPerformerNav =
        href.includes("/performers/") ||
        text === "details" ||
        text.includes("details") ||
        target.getAttribute("data-rb-event-key") === "details";

      if (!likelyPerformerNav) return;

      scheduleDelayedInject(120);
      scheduleDelayedInject(400);
      scheduleDelayedInject(900);
    });
  }

  function installObserver() {
    if (state.observer) return;

    state.observer = new MutationObserver(() => {
      if (!isSupportedPage()) return;
      if (document.getElementById(PANEL_ID)) return;

      clearTimeout(state.observerTimer);
      state.observerTimer = setTimeout(() => {
        if (!isSupportedPage() || document.getElementById(PANEL_ID)) return;
        injectPanelIfPossible().catch((err) => {
          console.error("[PerformerTagsOverhaul] observer injection failed", err);
        });
      }, 250);
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    installHistoryHooks();
    installPageClickHook();
    installObserver();
    handleRouteChange();
    scheduleRouteInjects();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
