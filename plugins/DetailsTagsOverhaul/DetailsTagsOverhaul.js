(function () {
  "use strict";

  const PLUGIN_ID = "DetailsTagsOverhaul";
  const PANEL_ID = "kmv-details-tags-overhaul";
  const STYLE_HIDE_ID = "kmv-details-tags-overhaul-hide-original";

  const ENTITY_CONFIG = {
    scene: {
      routeRegex: /^\/scenes\/(\d+)/,
      detailClass: "scene-details",
      findQuery: `
        query FindSceneForDetailsTagsOverhaul($id: ID!) {
          findScene(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findScene?.tags || [],
    },

    gallery: {
      routeRegex: /^\/galleries\/(\d+)/,
      detailClass: "gallery-details",
      findQuery: `
        query FindGalleryForDetailsTagsOverhaul($id: ID!) {
          findGallery(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findGallery?.tags || [],
    },

    image: {
      routeRegex: /^\/images\/(\d+)/,
      detailClass: "image-details",
      findQuery: `
        query FindImageForDetailsTagsOverhaul($id: ID!) {
          findImage(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findImage?.tags || [],
    },
  };

  const state = {
    currentEntity: null,
    selectedTagIds: new Set(),
    allTags: null,
    config: null,
    injectedForEntityKey: null,
    observer: null,
    lastPath: "",
    isInjecting: false,
    injectToken: 0,
  };

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
      console.error("[DetailsTagsOverhaul] config load failed", err);
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

  function getDisplayMode(cfg) {
    const value = String(cfg.displayMode || "imageAndText").trim();
    if (value === "image") return "image";
    if (value === "imageAndText") return "imageAndText";
    return "text";
  }

  function getImageSize(cfg) {
    const raw = String(cfg.imageSize || "").trim();
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 24 && parsed <= 256) {
      return parsed;
    }
    return 100;
  }

  function shouldLinkGroupHeaders(cfg) {
    return getConfigBoolean(cfg.linkGroupHeaders, false);
  }

  function shouldShowCollapseButtons(cfg) {
    return getConfigBoolean(cfg.showCollapseButtons, true);
  }

  function shouldDuplicateMultiParentTags(cfg) {
    return getConfigBoolean(cfg.duplicateMultiParentTags, true);
  }

  function shouldShowParentTagsAsSelectable(cfg) {
    return getConfigBoolean(cfg.showParentTagsAsSelectable, true);
  }

  function applyPanelVariables(panel, cfg) {
    const imageSize = getImageSize(cfg);
    const stackedImageSize = Math.max(24, imageSize);
    const imageOnlySize = Math.max(24, Math.round(imageSize * 1.2));

    panel.style.setProperty("--dto-image-size", `${stackedImageSize}px`);
    panel.style.setProperty("--dto-image-only-size", `${imageOnlySize}px`);
  }

  async function gql(query, variables = {}) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`GraphQL HTTP ${res.status}`);
    }

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

  function getEntityFromPath(pathname) {
    for (const [type, cfg] of Object.entries(ENTITY_CONFIG)) {
      const match = pathname.match(cfg.routeRegex);
      if (match) {
        return { type, id: match[1] };
      }
    }
    return null;
  }

  function isSupportedEntityPage() {
    return !!getEntityFromPath(window.location.pathname);
  }

  function getCurrentEntityKey(entity) {
    return entity ? `${entity.type}:${entity.id}` : null;
  }

  function getDetailContainer(entityType) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return null;

    const detailEl = document.querySelector("." + cfg.detailClass);
    if (!detailEl) return null;

    const firstRow = detailEl.closest(".row");
    if (!firstRow) return null;

    const secondRow = firstRow.nextElementSibling;
    if (!secondRow) return null;

    return secondRow.querySelector(".col-12") || secondRow;
  }

  function injectHideOriginalStyle() {
    if (document.getElementById(STYLE_HIDE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_HIDE_ID;
    style.textContent = `
      .row:has(.scene-details) + .row .tag-item.tag-link,
      .row:has(.gallery-details) + .row .tag-item.tag-link,
      .row:has(.image-details) + .row .tag-item.tag-link {
        display: none !important;
      }

      .row:has(.scene-details) + .row h6:has(+ .tag-item.tag-link),
      .row:has(.gallery-details) + .row h6:has(+ .tag-item.tag-link),
      .row:has(.image-details) + .row h6:has(+ .tag-item.tag-link) {
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
    document.querySelectorAll(`#${PANEL_ID}`).forEach((el) => el.remove());
    state.injectedForEntityKey = null;
  }

  async function fetchEntityTagIds(entityType, entityId) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return new Set();

    const data = await gql(cfg.findQuery, { id: entityId });
    const tags = cfg.findPath(data);
    return new Set(tags.map((t) => String(t.id)));
  }

  function sortItemsBySortNameThenName(items) {
    items.sort((a, b) => {
      const aKey = (a.sort_name || a.name || "").toLowerCase();
      const bKey = (b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
  }

  function buildNestedGroupsSelectedOnly(tags, selectedTagIds, cfg) {
    const duplicateMultiParentTags = shouldDuplicateMultiParentTags(cfg);
    const showParentTagsAsSelectable = shouldShowParentTagsAsSelectable(cfg);

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

      topGroup.items.push(createLeaf(tagRecord));
      topGroup.leafIds.add(tagRecord.id);
    }

    function addLeafToSubgroup(subgroup, tagRecord) {
      if (subgroup.childIds.has(tagRecord.id)) return;

      subgroup.children.push(createLeaf(tagRecord));
      subgroup.childIds.add(tagRecord.id);
    }

    function getParentPaths(tagRecord) {
      if (!tagRecord.parents.length) {
        return [{ type: "ungrouped" }];
      }

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
      if (!selectedTagIds.has(tagId)) continue;

      const tagRecord = tagMap.get(tagId);
      if (!tagRecord) continue;

      const hasChildren = isParentTag(tagRecord);
      if (hasChildren && !showParentTagsAsSelectable) continue;

      const paths = getParentPaths(tagRecord);

      for (const path of paths) {
        if (path.type === "ungrouped") {
          const already = ungrouped.items.some((item) => item.id === tagRecord.id);
          if (!already) {
            ungrouped.items.push(createLeaf(tagRecord));
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

    if (ungrouped.items.length) {
      prunedGroups.push(ungrouped);
    }

    return prunedGroups.map((group) => {
      delete group.subgroupMap;
      delete group.leafIds;
      return group;
    });
  }

  function createTagDisplay(child, cfg) {
    const el = document.createElement("a");
    el.className = "details-tags-overhaul__tag";
    el.setAttribute("data-details-tag-id", child.id);
    el.href = `/tags/${child.id}`;
    el.title = child.name;

    const mode = getDisplayMode(cfg);
    const hasImage = !!child.image_path;

    if (mode === "image" && hasImage) {
      el.classList.add("details-tags-overhaul__tag--image-only");

      const img = document.createElement("img");
      img.className = "details-tags-overhaul__tag-image";
      img.src = child.image_path;
      img.alt = child.name;
      el.appendChild(img);
    } else if (mode === "imageAndText" && hasImage) {
      el.classList.add("details-tags-overhaul__tag--image-and-text");

      const img = document.createElement("img");
      img.className = "details-tags-overhaul__tag-image";
      img.src = child.image_path;
      img.alt = child.name;
      el.appendChild(img);

      const label = document.createElement("span");
      label.className = "details-tags-overhaul__tag-label";
      label.textContent = child.name;
      el.appendChild(label);
    } else {
      el.classList.add("details-tags-overhaul__tag--text");

      const label = document.createElement("span");
      label.className = "details-tags-overhaul__tag-label";
      label.textContent = child.name;
      el.appendChild(label);
    }

    return el;
  }

  function createHeaderTitle(name, tagId, cfg, fallbackClass, linkClass) {
    if (tagId && shouldLinkGroupHeaders(cfg)) {
      const link = document.createElement("a");
      link.className = linkClass;
      link.href = `/tags/${tagId}`;
      link.textContent = name;
      link.title = name;
      return link;
    }

    const span = document.createElement("span");
    span.className = fallbackClass;
    span.textContent = name;
    return span;
  }

  function createCollapseButton(section, isSubgroup) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = isSubgroup
      ? "details-tags-overhaul__subgroup-toggle"
      : "details-tags-overhaul__toggle";
    btn.setAttribute("aria-label", "Toggle section");
    btn.textContent = "▾";

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      section.classList.toggle("is-open");
    });

    return btn;
  }

  function createSubgroupSection(subgroup, cfg) {
    const section = document.createElement("section");
    section.className = "details-tags-overhaul__subgroup";
    section.setAttribute("data-details-subgroup-id", subgroup.id);

    const header = document.createElement("div");
    header.className = "details-tags-overhaul__subgroup-header";

    const left = document.createElement("div");
    left.className = "details-tags-overhaul__subgroup-header-main";

    const title = createHeaderTitle(
      subgroup.name,
      subgroup.id,
      cfg,
      "details-tags-overhaul__subgroup-title",
      "details-tags-overhaul__subgroup-title-link"
    );

    const meta = document.createElement("span");
    meta.className = "details-tags-overhaul__subgroup-meta";

    const totalCount = document.createElement("span");
    totalCount.className = "details-tags-overhaul__subgroup-total-count";
    totalCount.textContent = `${subgroup.children.length}`;
    meta.appendChild(totalCount);

    left.appendChild(title);
    left.appendChild(meta);
    header.appendChild(left);

    const body = document.createElement("div");
    body.className = "details-tags-overhaul__subgroup-body";

    subgroup.children.forEach((child) => {
      body.appendChild(createTagDisplay(child, cfg));
    });

    const defaultExpanded = getConfigBoolean(cfg.defaultExpanded, true);
    section.classList.toggle("is-open", defaultExpanded);

    if (shouldShowCollapseButtons(cfg)) {
      header.appendChild(createCollapseButton(section, true));
    } else {
      header.classList.add("details-tags-overhaul__subgroup-header--static");
    }

    if (!shouldLinkGroupHeaders(cfg) && shouldShowCollapseButtons(cfg)) {
      left.style.cursor = "pointer";
      left.addEventListener("click", () => {
        section.classList.toggle("is-open");
      });
    }

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function createGroupSection(group, cfg) {
    const section = document.createElement("section");
    section.className = "details-tags-overhaul__group";
    section.setAttribute("data-details-parent-id", group.parent.id);

    const header = document.createElement("div");
    header.className = "details-tags-overhaul__header";

    const left = document.createElement("div");
    left.className = "details-tags-overhaul__header-main";

    const title = createHeaderTitle(
      group.parent.name,
      group.parent.id === "__ungrouped__" ? null : group.parent.id,
      cfg,
      "details-tags-overhaul__title",
      "details-tags-overhaul__title-link"
    );

    const meta = document.createElement("span");
    meta.className = "details-tags-overhaul__meta";

    let itemCount = 0;
    group.items.forEach((item) => {
      if (item.type === "leaf") itemCount += 1;
      if (item.type === "subgroup") itemCount += item.children.length;
    });

    const totalCount = document.createElement("span");
    totalCount.className = "details-tags-overhaul__total-count";
    totalCount.textContent = `${itemCount}`;
    meta.appendChild(totalCount);

    left.appendChild(title);
    left.appendChild(meta);
    header.appendChild(left);

    const body = document.createElement("div");
    body.className = "details-tags-overhaul__body";

    group.items.forEach((item) => {
      if (item.type === "leaf") {
        body.appendChild(createTagDisplay(item, cfg));
      } else if (item.type === "subgroup") {
        body.appendChild(createSubgroupSection(item, cfg));
      }
    });

    const defaultExpanded = getConfigBoolean(cfg.defaultExpanded, true);
    section.classList.toggle("is-open", defaultExpanded);

    if (shouldShowCollapseButtons(cfg)) {
      header.appendChild(createCollapseButton(section, false));
    } else {
      header.classList.add("details-tags-overhaul__header--static");
    }

    if (!shouldLinkGroupHeaders(cfg) && shouldShowCollapseButtons(cfg)) {
      left.style.cursor = "pointer";
      left.addEventListener("click", () => {
        section.classList.toggle("is-open");
      });
    }

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function createPanel(groups, cfg) {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "details-tags-overhaul";

    applyPanelVariables(panel, cfg);

    const titleRow = document.createElement("div");
    titleRow.className = "details-tags-overhaul__panel-header";

    const heading = document.createElement("h6");
    heading.className = "details-tags-overhaul__panel-title";
    heading.textContent = "Tags";

    const summary = document.createElement("div");
    summary.className = "details-tags-overhaul__panel-summary";
    summary.textContent = `${groups.length} groups`;

    titleRow.appendChild(heading);
    titleRow.appendChild(summary);
    panel.appendChild(titleRow);

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "details-tags-overhaul__groups";

    groups.forEach((group) => {
      groupsWrap.appendChild(createGroupSection(group, cfg));
    });

    panel.appendChild(groupsWrap);
    return panel;
  }

  async function injectPanelIfPossible() {
    if (state.isInjecting) return false;
    if (!isSupportedEntityPage()) return false;

    const entity = getEntityFromPath(window.location.pathname);
    if (!entity) return false;

    const container = getDetailContainer(entity.type);
    if (!container) return false;

    const entityKey = getCurrentEntityKey(entity);
    if (state.injectedForEntityKey === entityKey && document.getElementById(PANEL_ID)) {
      return true;
    }

    state.isInjecting = true;
    const token = ++state.injectToken;

    try {
      cleanupPanel();
      state.currentEntity = entity;

      const [cfg, allTags, selectedTagIds] = await Promise.all([
        loadConfig(),
        fetchAllTags(),
        fetchEntityTagIds(entity.type, entity.id),
      ]);

      if (token !== state.injectToken) return false;

      const latestEntity = getEntityFromPath(window.location.pathname);
      const latestEntityKey = getCurrentEntityKey(latestEntity);
      if (!latestEntity || latestEntityKey !== entityKey) return false;

      cleanupPanel();

      state.currentEntity = latestEntity;
      state.selectedTagIds = selectedTagIds;

      const groups = buildNestedGroupsSelectedOnly(allTags, selectedTagIds, cfg);
      if (!groups.length) return false;

      const panel = createPanel(groups, cfg);
      container.prepend(panel);

      injectHideOriginalStyle();
      state.injectedForEntityKey = entityKey;
      return true;
    } finally {
      if (token === state.injectToken) {
        state.isInjecting = false;
      }
    }
  }

  function handleRouteChange() {
    const path = window.location.pathname + window.location.search;
    if (path === state.lastPath) return;
    state.lastPath = path;

    if (!isSupportedEntityPage()) {
      cleanupPanel();
      removeHideOriginalStyle();
      state.currentEntity = null;
      state.selectedTagIds = new Set();
    }
  }

  function installHistoryHooks() {
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = origPushState.apply(this, args);
      setTimeout(() => {
        handleRouteChange();
        injectPanelIfPossible();
      }, 0);
      return result;
    };

    history.replaceState = function (...args) {
      const result = origReplaceState.apply(this, args);
      setTimeout(() => {
        handleRouteChange();
        injectPanelIfPossible();
      }, 0);
      return result;
    };

    window.addEventListener("popstate", () => {
      setTimeout(() => {
        handleRouteChange();
        injectPanelIfPossible();
      }, 0);
    });
  }

  function installObserver() {
    if (state.observer) return;

    state.observer = new MutationObserver(() => {
      handleRouteChange();

      if (isSupportedEntityPage() && !document.getElementById(PANEL_ID)) {
        injectPanelIfPossible().catch((err) => {
          console.error("[DetailsTagsOverhaul] injection failed", err);
        });
      }
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    installHistoryHooks();
    installObserver();
    handleRouteChange();
    injectPanelIfPossible().catch((err) => {
      console.error("[DetailsTagsOverhaul] initial injection failed", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
