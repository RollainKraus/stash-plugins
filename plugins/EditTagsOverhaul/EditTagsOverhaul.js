(function () {
  "use strict";

  const PLUGIN_ID = "EditTagsOverhaul";
  const PANEL_ID = "kmv-edit-tags-overhaul";
  const STYLE_HIDE_ID = "kmv-edit-tags-overhaul-hide-original";
  const ROUTE_RETRY_DELAYS = [0, 200, 600, 1200, 2000, 3500];

  const ENTITY_CONFIG = {
    scene: {
      routeRegex: /^\/scenes\/(\d+)/,
      editContainerId: "scene-edit-details",
      findQuery: `
        query FindSceneForEditTagsOverhaul($id: ID!) {
          findScene(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findScene?.tags || [],
      updateMutation: `
        mutation UpdateSceneTags($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      updateMutationKey: "sceneUpdate",
    },

    gallery: {
      routeRegex: /^\/galleries\/(\d+)/,
      editContainerId: "gallery-edit-details",
      findQuery: `
        query FindGalleryForEditTagsOverhaul($id: ID!) {
          findGallery(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findGallery?.tags || [],
      updateMutation: `
        mutation UpdateGalleryTags($input: GalleryUpdateInput!) {
          galleryUpdate(input: $input) {
            id
          }
        }
      `,
      updateMutationKey: "galleryUpdate",
    },

    image: {
      routeRegex: /^\/images\/(\d+)/,
      editContainerId: "image-edit-details",
      findQuery: `
        query FindImageForEditTagsOverhaul($id: ID!) {
          findImage(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      findPath: (data) => data?.findImage?.tags || [],
      updateMutation: `
        mutation UpdateImageTags($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      updateMutationKey: "imageUpdate",
    },
  };

  const state = {
    currentEntity: null,
    selectedTagIds: new Set(),
    allTags: null,
    config: null,
    isSaving: false,
    injectedForEntityKey: null,
    loadedSelectionEntityKey: null,
    lastPath: "",
    isInjecting: false,
    injectToken: 0,
    scheduledRouteToken: 0,
    currentSearchQuery: "",
    searchIndex: null,
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
      console.error("[EditTagsOverhaul] config load failed", err);
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
    const value = String(cfg.displayMode || "text").trim();
    if (value === "image") return "image";
    if (value === "imageAndText") return "imageAndText";
    return "text";
  }

  function getImageSize(cfg) {
    const raw = String(cfg.imageSize || "").trim();
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 24 && parsed <= 256) return parsed;
    return 52;
  }

  function getSelectedBorderColor(cfg) {
    const value = String(cfg.selectedBorderColor || "").trim();
    return value || "#ffffff";
  }

  function applyPanelVariables(panel, cfg) {
    const imageSize = getImageSize(cfg);
    const stackedImageSize = Math.max(24, imageSize);
    const imageOnlySize = Math.max(24, Math.round(imageSize * 1.2));
    const borderColor = getSelectedBorderColor(cfg);

    panel.style.setProperty("--eto-image-size", `${stackedImageSize}px`);
    panel.style.setProperty("--eto-image-only-size", `${imageOnlySize}px`);
    panel.style.setProperty("--eto-selected-border-color", borderColor);
  }

  async function gql(query, variables = {}) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

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
      if (match) return { type, id: match[1] };
    }
    return null;
  }

  function isSupportedEntityPage() {
    return !!getEntityFromPath(window.location.pathname);
  }

  function getCurrentEntityKey(entity) {
    return entity ? `${entity.type}:${entity.id}` : null;
  }

  function getEditContainer(entityType) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return null;
    return document.getElementById(cfg.editContainerId);
  }

  function getOriginalTagSelectFormGroup(entityType) {
    const edit = getEditContainer(entityType);
    if (!edit) return null;

    const tagSelect = edit.querySelector(".tag-select");
    if (!tagSelect) return null;

    return tagSelect.closest(".form-group");
  }

  function injectHideOriginalStyle() {
    if (document.getElementById(STYLE_HIDE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_HIDE_ID;
    style.textContent = `
      #scene-edit-details .form-group:has(.tag-select),
      #gallery-edit-details .form-group:has(.tag-select),
      #image-edit-details .form-group:has(.tag-select) {
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
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    state.injectedForEntityKey = null;
  }

  async function fetchEntityTagIds(entityType, entityId) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return new Set();

    const data = await gql(cfg.findQuery, { id: entityId });
    const tags = cfg.findPath(data);
    return new Set(tags.map((t) => String(t.id)));
  }

  async function saveEntityTagIds(entityType, entityId, tagIds) {
    const cfg = ENTITY_CONFIG[entityType];
    if (!cfg) return null;

    const data = await gql(cfg.updateMutation, {
      input: {
        id: entityId,
        tag_ids: tagIds,
      },
    });

    return data?.[cfg.updateMutationKey]?.id;
  }

  function sortItemsBySortNameThenName(items) {
    items.sort((a, b) => {
      const aKey = (a.sort_name || a.name || "").toLowerCase();
      const bKey = (b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
  }

  function buildNestedGroupsPreservingOrder(tags, cfg) {
    const duplicateMultiParentTags = getConfigBoolean(
      cfg.duplicateMultiParentTags,
      false
    );

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

      if (!isParentTag(tagRecord)) {
        topGroup.items.push(createLeaf(tagRecord));
        topGroup.leafIds.add(tagRecord.id);
      }
    }

    function addLeafToSubgroup(subgroup, tagRecord) {
      if (subgroup.childIds.has(tagRecord.id)) return;

      if (!isParentTag(tagRecord)) {
        subgroup.children.push(createLeaf(tagRecord));
        subgroup.childIds.add(tagRecord.id);
      }
    }

    function getParentPaths(tagRecord) {
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

    for (const tag of tags) {
      const tagId = String(tag.id);
      const tagRecord = tagMap.get(tagId);
      if (!tagRecord) continue;

      const paths = getParentPaths(tagRecord);

      for (const path of paths) {
        if (path.type === "ungrouped") {
          if (!isParentTag(tagRecord)) {
            const already = ungrouped.items.some((item) => item.id === tagRecord.id);
            if (!already) {
              ungrouped.items.push(createLeaf(tagRecord));
            }
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

    orderedTopGroups.sort((a, b) => {
      if (a.parent.id === "__ungrouped__") return 1;
      if (b.parent.id === "__ungrouped__") return -1;

      const aKey = (a.parent.sort_name || a.parent.name || "").toLowerCase();
      const bKey = (b.parent.sort_name || b.parent.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    for (const group of orderedTopGroups) {
      sortItemsBySortNameThenName(group.items);
      for (const item of group.items) {
        if (item.type === "subgroup" && Array.isArray(item.children)) {
          sortItemsBySortNameThenName(item.children);
        }
      }
    }

    sortItemsBySortNameThenName(ungrouped.items);

    if (ungrouped.items.length) {
      const hasUngrouped = orderedTopGroups.some(
        (group) => group.parent.id === "__ungrouped__"
      );
      if (!hasUngrouped) orderedTopGroups.push(ungrouped);
    }

    return orderedTopGroups.map((group) => {
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
      cfg.duplicateMultiParentTags,
      false
    );

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

    function isParentTag(tagRecord) {
      return !!(tagRecord && tagRecord.childIds && tagRecord.childIds.length > 0);
    }

    function getParentPaths(tagRecord) {
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

    const results = [];

    for (const tag of tags) {
      const tagId = String(tag.id);
      const tagRecord = tagMap.get(tagId);
      if (!tagRecord) continue;

      const paths = getParentPaths(tagRecord);
      const parentTag = isParentTag(tagRecord);

      for (const path of paths) {
        let breadcrumb = "Ungrouped";
        let targetKind = parentTag ? "header" : "leaf";
        let targetId = tagRecord.id;
        let groupId = "__ungrouped__";
        let subgroupId = "";

        if (path.type === "group") {
          breadcrumb = path.topParent.name;
          if (parentTag) {
            targetId = String(path.topParent.id);
            groupId = String(path.topParent.id);
          } else {
            groupId = String(path.topParent.id);
          }
        } else if (path.type === "subgroup") {
          breadcrumb = `${path.topParent.name} > ${path.subgroupParent.name}`;
          groupId = String(path.topParent.id);
          subgroupId = String(path.subgroupParent.id);
          if (parentTag) {
            targetId = String(path.subgroupParent.id);
          }
        }

        if (path.type === "ungrouped" && parentTag) {
          targetKind = "header";
        }

        results.push({
          id: tagRecord.id,
          name: tagRecord.name,
          sort_name: tagRecord.sort_name || tagRecord.name || "",
          image_path: tagRecord.image_path || "",
          targetKind,
          targetId,
          groupId,
          subgroupId,
          breadcrumb,
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

  function getSearchResults(query, limit = 30) {
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

  function flashSearchTarget(target) {
    if (!target) return;
    target.classList.remove("edit-tags-overhaul__search-target-flash");
    void target.offsetWidth;
    target.classList.add("edit-tags-overhaul__search-target-flash");
    setTimeout(() => {
      target.classList.remove("edit-tags-overhaul__search-target-flash");
    }, 1600);
  }

  function revealSearchResult(result) {
    if (!result) return;

    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const groupSection = panel.querySelector(
      `.edit-tags-overhaul__group[data-grouped-scene-parent-id="${CSS.escape(result.groupId)}"]`
    );
    if (groupSection) groupSection.classList.add("is-open");

    let target = null;

    if (result.subgroupId) {
      const subgroupSection = panel.querySelector(
        `.edit-tags-overhaul__subgroup[data-grouped-scene-subgroup-id="${CSS.escape(result.subgroupId)}"]`
      );
      if (subgroupSection) subgroupSection.classList.add("is-open");
      if (result.targetKind === "header") {
        target = subgroupSection || groupSection;
      } else {
        target = subgroupSection?.querySelector(
          `[data-eto-tag-id="${CSS.escape(result.targetId)}"]`
        );
      }
    } else if (result.targetKind === "header") {
      target = groupSection;
    } else if (groupSection) {
      target = groupSection.querySelector(
        `[data-eto-tag-id="${CSS.escape(result.targetId)}"]`
      );
    }

    if (!target && result.targetKind === "header") {
      target = panel.querySelector(
        `[data-eto-header-tag-id="${CSS.escape(result.targetId)}"]`
      )?.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
    }

    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    flashSearchTarget(target);
  }

  function renderSearchResults(panel) {
    const resultsWrap = panel.querySelector(".edit-tags-overhaul__search-results");
    const emptyEl = panel.querySelector(".edit-tags-overhaul__search-empty");
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
      row.className = "edit-tags-overhaul__search-result";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "edit-tags-overhaul__search-result-main";
      main.setAttribute("data-eto-search-jump-id", result.id);
      main.setAttribute("data-eto-search-target-id", result.targetId);
      main.setAttribute("data-eto-search-target-kind", result.targetKind);
      main.setAttribute("data-eto-search-group-id", result.groupId);
      if (result.subgroupId) {
        main.setAttribute("data-eto-search-subgroup-id", result.subgroupId);
      }
      main.title = `Reveal ${result.name} in hierarchy`;

      if (result.image_path) {
        const img = document.createElement("img");
        img.className = "edit-tags-overhaul__search-result-image";
        img.src = result.image_path;
        img.alt = result.name;
        main.appendChild(img);
      }

      const textWrap = document.createElement("span");
      textWrap.className = "edit-tags-overhaul__search-result-text";

      const nameEl = document.createElement("span");
      nameEl.className = "edit-tags-overhaul__search-result-name";
      nameEl.textContent = result.name;

      const pathEl = document.createElement("span");
      pathEl.className = "edit-tags-overhaul__search-result-path";
      pathEl.textContent = result.breadcrumb;

      textWrap.appendChild(nameEl);
      textWrap.appendChild(pathEl);
      main.appendChild(textWrap);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "edit-tags-overhaul__search-result-toggle";
      toggle.setAttribute("data-eto-search-toggle-id", result.id);
      toggle.title = state.selectedTagIds.has(result.id) ? "Remove tag" : "Add tag";
      toggle.textContent = state.selectedTagIds.has(result.id) ? "✓" : "+";
      toggle.classList.toggle("is-selected", state.selectedTagIds.has(result.id));

      row.appendChild(main);
      row.appendChild(toggle);
      resultsWrap.appendChild(row);
    });
  }

  function createSearchControls() {
    const wrap = document.createElement("div");
    wrap.className = "edit-tags-overhaul__search";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "edit-tags-overhaul__search-input";
    input.placeholder = "Search tags to reveal or toggle";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = state.currentSearchQuery || "";

    const results = document.createElement("div");
    results.className = "edit-tags-overhaul__search-results";

    const empty = document.createElement("div");
    empty.className = "edit-tags-overhaul__search-empty";
    empty.textContent = "No matching tags";
    empty.hidden = true;

    input.addEventListener("input", () => {
      state.currentSearchQuery = input.value || "";
      renderSearchResults(wrap.closest(`#${PANEL_ID}`));
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (input.value) {
          input.value = "";
          state.currentSearchQuery = "";
          renderSearchResults(wrap.closest(`#${PANEL_ID}`));
        }
        return;
      }

      if (event.key === "Enter") {
        const firstResult = wrap.querySelector("[data-eto-search-jump-id]");
        if (firstResult) {
          event.preventDefault();
          firstResult.click();
        }
      }
    });

    wrap.appendChild(input);
    wrap.appendChild(results);
    wrap.appendChild(empty);
    return wrap;
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

  function updateTagButtonState(button, attached) {
    button.classList.toggle("is-selected", attached);
    button.setAttribute("aria-pressed", attached ? "true" : "false");
  }

  function updateParentToggleState(button, attached) {
    button.classList.toggle("is-selected", attached);
    button.setAttribute("aria-pressed", attached ? "true" : "false");
    button.textContent = attached ? "✓" : "+";
    button.setAttribute("title", attached ? "Remove parent tag" : "Add parent tag");
    button.setAttribute("aria-label", attached ? "Remove parent tag" : "Add parent tag");
  }

  function syncRenderedSelectionStates() {
    document.querySelectorAll("[data-eto-tag-id]").forEach((el) => {
      const id = el.getAttribute("data-eto-tag-id");
      updateTagButtonState(el, state.selectedTagIds.has(id));
    });

    document.querySelectorAll("[data-eto-parent-toggle-id]").forEach((el) => {
      const id = el.getAttribute("data-eto-parent-toggle-id");
      updateParentToggleState(el, state.selectedTagIds.has(id));
    });

    document.querySelectorAll("[data-grouped-scene-parent-id]").forEach((section) => {
      const countEl = section.querySelector(".edit-tags-overhaul__selected-count");
      if (!countEl) return;

      const leafButtons = section.querySelectorAll("[data-eto-tag-id]");
      let selectedCount = 0;
      leafButtons.forEach((btn) => {
        if (btn.classList.contains("is-selected")) selectedCount += 1;
      });

      const parentToggle = section.querySelector("[data-eto-parent-toggle-id]");
      if (parentToggle && parentToggle.classList.contains("is-selected")) {
        selectedCount += 1;
      }

      countEl.textContent = selectedCount > 0 ? `${selectedCount} selected` : "";
    });

    document.querySelectorAll("[data-grouped-scene-subgroup-id]").forEach((section) => {
      const countEl = section.querySelector(".edit-tags-overhaul__subgroup-selected-count");
      if (!countEl) return;

      const leafButtons = section.querySelectorAll("[data-eto-tag-id]");
      let selectedCount = 0;
      leafButtons.forEach((btn) => {
        if (btn.classList.contains("is-selected")) selectedCount += 1;
      });

      const parentToggle = section.querySelector("[data-eto-parent-toggle-id]");
      if (parentToggle && parentToggle.classList.contains("is-selected")) {
        selectedCount += 1;
      }

      countEl.textContent = selectedCount > 0 ? `${selectedCount} selected` : "";
    });

    document.querySelectorAll("[data-eto-search-toggle-id]").forEach((el) => {
      const id = el.getAttribute("data-eto-search-toggle-id");
      const selected = state.selectedTagIds.has(id);
      el.classList.toggle("is-selected", selected);
      el.textContent = selected ? "✓" : "+";
      el.setAttribute("title", selected ? "Remove tag" : "Add tag");
      el.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  async function onTagToggleClick(tagId, buttonEl) {
    if (!state.currentEntity || state.isSaving) return;

    const wasSelected = state.selectedTagIds.has(tagId);
    if (wasSelected) state.selectedTagIds.delete(tagId);
    else state.selectedTagIds.add(tagId);

    if (buttonEl?.hasAttribute("data-eto-parent-toggle-id")) {
      updateParentToggleState(buttonEl, !wasSelected);
    } else if (buttonEl) {
      updateTagButtonState(buttonEl, !wasSelected);
    }

    syncRenderedSelectionStates();

    state.isSaving = true;
    document.body.classList.add("edit-tags-overhaul--saving");

    try {
      await saveEntityTagIds(
        state.currentEntity.type,
        state.currentEntity.id,
        Array.from(state.selectedTagIds)
      );
      state.loadedSelectionEntityKey = getCurrentEntityKey(state.currentEntity);
    } catch (err) {
      console.error("[EditTagsOverhaul] tag save failed", err);

      if (wasSelected) state.selectedTagIds.add(tagId);
      else state.selectedTagIds.delete(tagId);

      if (buttonEl?.hasAttribute("data-eto-parent-toggle-id")) {
        updateParentToggleState(buttonEl, wasSelected);
      } else if (buttonEl) {
        updateTagButtonState(buttonEl, wasSelected);
      }

      syncRenderedSelectionStates();
    } finally {
      state.isSaving = false;
      document.body.classList.remove("edit-tags-overhaul--saving");
    }
  }

  function createParentToggleButton(tagId) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__parent-toggle-btn";
    btn.setAttribute("data-eto-parent-toggle-id", tagId);
    updateParentToggleState(btn, state.selectedTagIds.has(tagId));
    return btn;
  }

  function createTagButton(child, cfg) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__tag";
    btn.setAttribute("data-eto-tag-id", child.id);
    btn.title = child.name;

    const mode = getDisplayMode(cfg);
    const hasImage = !!child.image_path;

    if (mode === "image" && hasImage) {
      btn.classList.add("edit-tags-overhaul__tag--image-only");

      const img = document.createElement("img");
      img.className = "edit-tags-overhaul__tag-image";
      img.src = child.image_path;
      img.alt = child.name;
      btn.appendChild(img);
    } else if (mode === "imageAndText" && hasImage) {
      btn.classList.add("edit-tags-overhaul__tag--image-and-text");

      const img = document.createElement("img");
      img.className = "edit-tags-overhaul__tag-image";
      img.src = child.image_path;
      img.alt = child.name;
      btn.appendChild(img);

      const label = document.createElement("span");
      label.className = "edit-tags-overhaul__tag-label";
      label.textContent = child.name;
      btn.appendChild(label);
    } else {
      btn.classList.add("edit-tags-overhaul__tag--text");

      const label = document.createElement("span");
      label.className = "edit-tags-overhaul__tag-label";
      label.textContent = child.name;
      btn.appendChild(label);
    }

    updateTagButtonState(btn, state.selectedTagIds.has(child.id));
    return btn;
  }

  function createSubgroupSection(subgroup, cfg) {
    const section = document.createElement("section");
    section.className = "edit-tags-overhaul__subgroup";
    section.setAttribute("data-grouped-scene-subgroup-id", subgroup.id);
    section.setAttribute("data-eto-header-tag-id", subgroup.id);

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__subgroup-header";
    header.setAttribute("data-eto-toggle-section", "1");

    const left = document.createElement("div");
    left.className = "edit-tags-overhaul__subgroup-header-main";

    const title = document.createElement("span");
    title.className = "edit-tags-overhaul__subgroup-title";
    title.textContent = subgroup.name;

    const meta = document.createElement("span");
    meta.className = "edit-tags-overhaul__subgroup-meta";

    const selectedCount = document.createElement("span");
    selectedCount.className = "edit-tags-overhaul__subgroup-selected-count";

    const totalCount = document.createElement("span");
    totalCount.className = "edit-tags-overhaul__subgroup-total-count";
    totalCount.textContent = `${subgroup.children.length + 1}`;

    meta.appendChild(selectedCount);
    meta.appendChild(totalCount);

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "edit-tags-overhaul__header-actions";
    actions.appendChild(createParentToggleButton(subgroup.id));

    header.appendChild(left);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "edit-tags-overhaul__subgroup-body";

    subgroup.children.forEach((child) => {
      body.appendChild(createTagButton(child, cfg));
    });

    const defaultExpanded =
      getConfigBoolean(cfg.defaultExpanded, false) ||
      (getConfigBoolean(cfg.autoExpandIfSelected, false) &&
        subgroupHasSelectedTags(subgroup));

    section.classList.toggle("is-open", defaultExpanded);

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function createGroupSection(group, cfg) {
    const section = document.createElement("section");
    section.className = "edit-tags-overhaul__group";
    section.setAttribute("data-grouped-scene-parent-id", group.parent.id);

    if (group.parent.id !== "__ungrouped__") {
      section.setAttribute("data-eto-header-tag-id", group.parent.id);
    }

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__header";
    header.setAttribute("data-eto-toggle-section", "1");

    const left = document.createElement("div");
    left.className = "edit-tags-overhaul__header-main";

    const title = document.createElement("span");
    title.className = "edit-tags-overhaul__title";
    title.textContent = group.parent.name;

    const meta = document.createElement("span");
    meta.className = "edit-tags-overhaul__meta";

    const selectedCount = document.createElement("span");
    selectedCount.className = "edit-tags-overhaul__selected-count";

    let itemCount = 0;
    group.items.forEach((item) => {
      if (item.type === "leaf") itemCount += 1;
      if (item.type === "subgroup") itemCount += item.children.length + 1;
    });
    if (group.parent.id !== "__ungrouped__") itemCount += 1;

    const totalCount = document.createElement("span");
    totalCount.className = "edit-tags-overhaul__total-count";
    totalCount.textContent = `${itemCount}`;

    meta.appendChild(selectedCount);
    meta.appendChild(totalCount);

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "edit-tags-overhaul__header-actions";

    if (group.parent.id !== "__ungrouped__") {
      actions.appendChild(createParentToggleButton(group.parent.id));
    }

    header.appendChild(left);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "edit-tags-overhaul__body";

    group.items.forEach((item) => {
      if (item.type === "leaf") body.appendChild(createTagButton(item, cfg));
      else if (item.type === "subgroup") body.appendChild(createSubgroupSection(item, cfg));
    });

    const defaultExpanded =
      getConfigBoolean(cfg.defaultExpanded, false) ||
      (getConfigBoolean(cfg.autoExpandIfSelected, false) &&
        groupHasSelectedTags(group));

    section.classList.toggle("is-open", defaultExpanded);

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function attachPanelEventDelegation(panel) {
    panel.addEventListener("click", (event) => {
      const parentToggleBtn = event.target.closest("[data-eto-parent-toggle-id]");
      if (parentToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = parentToggleBtn.getAttribute("data-eto-parent-toggle-id");
        if (tagId) onTagToggleClick(tagId, parentToggleBtn);
        return;
      }

      const tagBtn = event.target.closest("[data-eto-tag-id]");
      if (tagBtn) {
        event.preventDefault();
        const tagId = tagBtn.getAttribute("data-eto-tag-id");
        if (tagId) onTagToggleClick(tagId, tagBtn);
        return;
      }

      const searchToggleBtn = event.target.closest("[data-eto-search-toggle-id]");
      if (searchToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = searchToggleBtn.getAttribute("data-eto-search-toggle-id");
        if (tagId) onTagToggleClick(tagId, searchToggleBtn);
        return;
      }

      const searchJumpBtn = event.target.closest("[data-eto-search-jump-id]");
      if (searchJumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        revealSearchResult({
          id: searchJumpBtn.getAttribute("data-eto-search-jump-id"),
          targetId: searchJumpBtn.getAttribute("data-eto-search-target-id"),
          targetKind: searchJumpBtn.getAttribute("data-eto-search-target-kind"),
          groupId: searchJumpBtn.getAttribute("data-eto-search-group-id"),
          subgroupId: searchJumpBtn.getAttribute("data-eto-search-subgroup-id") || "",
        });
        return;
      }

      const toggleHeader = event.target.closest("[data-eto-toggle-section]");
      if (toggleHeader) {
        const section = toggleHeader.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
        if (section) section.classList.toggle("is-open");
      }
    });

    panel.addEventListener("mousedown", (event) => {
      if (event.button !== 1) return;
      const target = event.target.closest(
        "[data-eto-tag-id], [data-eto-toggle-section], [data-eto-search-jump-id]"
      );
      if (target) event.preventDefault();
    });

    panel.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;

      const tagBtn = event.target.closest("[data-eto-tag-id]");
      if (tagBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = tagBtn.getAttribute("data-eto-tag-id");
        if (tagId) window.open(`/tags/${tagId}`, "_blank", "noopener");
        return;
      }

      const searchJumpBtn = event.target.closest("[data-eto-search-jump-id]");
      if (searchJumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = searchJumpBtn.getAttribute("data-eto-search-jump-id");
        if (tagId) window.open(`/tags/${tagId}`, "_blank", "noopener");
        return;
      }

      const toggleHeader = event.target.closest("[data-eto-toggle-section]");
      if (toggleHeader) {
        const section = toggleHeader.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
        const tagId = section?.getAttribute("data-eto-header-tag-id");
        if (!tagId) return;

        event.preventDefault();
        event.stopPropagation();
        window.open(`/tags/${tagId}`, "_blank", "noopener");
      }
    });
  }

  function createPanel(groups, cfg) {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "edit-tags-overhaul";

    applyPanelVariables(panel, cfg);

    const titleRow = document.createElement("div");
    titleRow.className = "edit-tags-overhaul__panel-header";

    const heading = document.createElement("h6");
    heading.className = "edit-tags-overhaul__panel-title";
    heading.textContent = cfg.panelTitle || "Grouped Tags";

    const summary = document.createElement("div");
    summary.className = "edit-tags-overhaul__panel-summary";
    summary.textContent = `${groups.length} groups`;

    titleRow.appendChild(heading);
    titleRow.appendChild(summary);
    panel.appendChild(titleRow);

    const searchControls = createSearchControls();
    panel.appendChild(searchControls);

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "edit-tags-overhaul__groups";

    groups.forEach((group) => {
      groupsWrap.appendChild(createGroupSection(group, cfg));
    });

    panel.appendChild(groupsWrap);
    attachPanelEventDelegation(panel);
    renderSearchResults(panel);
    return panel;
  }

  async function ensureSelectedTagIds(entity) {
    const entityKey = getCurrentEntityKey(entity);
    if (state.loadedSelectionEntityKey === entityKey) return state.selectedTagIds;

    state.selectedTagIds = await fetchEntityTagIds(entity.type, entity.id);
    state.loadedSelectionEntityKey = entityKey;
    return state.selectedTagIds;
  }

  async function injectPanelIfPossible() {
    if (state.isInjecting) return false;
    if (!isSupportedEntityPage()) return false;

    const entity = getEntityFromPath(window.location.pathname);
    if (!entity) return false;

    const formGroup = getOriginalTagSelectFormGroup(entity.type);
    if (!formGroup) return false;

    const entityKey = getCurrentEntityKey(entity);
    const existingPanel = document.getElementById(PANEL_ID);
    if (state.injectedForEntityKey === entityKey && existingPanel) return true;

    state.isInjecting = true;
    const token = ++state.injectToken;

    try {
      state.currentEntity = entity;

      const [cfg, allTags] = await Promise.all([loadConfig(), fetchAllTags()]);
      await ensureSelectedTagIds(entity);

      if (token !== state.injectToken) return false;

      const latestEntity = getEntityFromPath(window.location.pathname);
      const latestEntityKey = getCurrentEntityKey(latestEntity);
      if (!latestEntity || latestEntityKey !== entityKey) return false;

      const currentPanel = document.getElementById(PANEL_ID);
      if (currentPanel) currentPanel.remove();

      state.currentEntity = latestEntity;

      const groups = buildNestedGroupsPreservingOrder(allTags, cfg);
      state.searchIndex = buildSearchIndex(allTags, cfg);
      if (!groups.length) return false;

      const panel = createPanel(groups, cfg);
      formGroup.parentNode.insertBefore(panel, formGroup.nextSibling);

      injectHideOriginalStyle();
      syncRenderedSelectionStates();

      state.injectedForEntityKey = entityKey;
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
          console.error("[EditTagsOverhaul] injection failed", err);
        });
      }, delay);
    }
  }

  function scheduleDelayedInject(delay = 150) {
    const routeToken = ++state.scheduledRouteToken;

    setTimeout(() => {
      if (routeToken !== state.scheduledRouteToken) return;
      injectPanelIfPossible().catch((err) => {
        console.error("[EditTagsOverhaul] delayed injection failed", err);
      });
    }, delay);
  }

  function handleRouteChange() {
    const path = window.location.pathname + window.location.search;
    if (path === state.lastPath) return false;
    state.lastPath = path;

    if (!isSupportedEntityPage()) {
      cleanupPanel();
      removeHideOriginalStyle();
      state.currentEntity = null;
      state.selectedTagIds = new Set();
      state.loadedSelectionEntityKey = null;
      state.currentSearchQuery = "";
      state.searchIndex = null;
      state.scheduledRouteToken += 1;
      return true;
    }

    const entity = getEntityFromPath(window.location.pathname);
    const entityKey = getCurrentEntityKey(entity);

    if (entityKey !== state.loadedSelectionEntityKey) {
      state.selectedTagIds = new Set();
    }

    cleanupPanel();
    return true;
  }

  function installHistoryHooks() {
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = origPushState.apply(this, args);
      setTimeout(() => {
        handleRouteChange();
        scheduleRouteInjects();
      }, 0);
      return result;
    };

    history.replaceState = function (...args) {
      const result = origReplaceState.apply(this, args);
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

  function installTabClickHook() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("a, button, [role='tab']");
      if (!target) return;

      const text = (target.textContent || "").trim().toLowerCase();
      const href = target.getAttribute("href") || "";

      const looksLikeEditTab =
        text === "edit" ||
        text.includes("edit") ||
        href.includes("/edit") ||
        target.getAttribute("data-rb-event-key") === "edit";

      if (!looksLikeEditTab) return;

      scheduleDelayedInject(100);
      scheduleDelayedInject(400);
      scheduleDelayedInject(900);
    });
  }

  function init() {
    installHistoryHooks();
    installTabClickHook();
    handleRouteChange();
    scheduleRouteInjects();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
