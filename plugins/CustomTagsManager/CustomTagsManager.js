(() => {
  "use strict";

  if (window.__customTagsManagerPluginLoaded) return;
  window.__customTagsManagerPluginLoaded = true;

  const PLUGIN_ID = "CustomTagsManager";
  const PLUGIN_ROUTE = "/plugin/CustomTagsManager";
  const LAUNCH_QUERY_PARAM = "customTagsManagerOpen";
  const HOST_ID = "tag-manager-host";
  const TOOLBAR_ID = "tag-manager-toolbar";
  const ROOT_DROP_ID = "__root__";
  const EXPANDED_STORAGE_KEY = "custom-tags-manager-expanded-v1";
  const HOVER_PREVIEW_ID = "custom-tags-manager-hover-preview";
  const TAG_DETAIL_PANEL_ID = "custom-tags-manager-tag-detail-panel";
  const DEFAULT_CONFIG = {
    treeExpansionBehavior: "remember",
  };
  const RETRY_DELAYS = [0, 180, 420, 900];
  const SEARCH_LIMIT = 50;
  const SUPPLEMENTAL_IMAGE_FIELDS = [
    {
      key: "ctm_supplemental_image_1",
      draftKey: "supplemental_image_1_id",
      label: "Supplemental Image 1",
    },
    {
      key: "ctm_supplemental_image_2",
      draftKey: "supplemental_image_2_id",
      label: "Supplemental Image 2",
    },
  ];
  const CONTENT_FILTER_PATHS = {
    scenes: "/scenes",
    images: "/images",
    galleries: "/galleries",
    performers: "/performers",
  };

  const cache =
    window.__customTagsManagerCache ||
    (window.__customTagsManagerCache = {
      config: DEFAULT_CONFIG,
      configPromise: null,
      tags: null,
      tagsPromise: null,
      tagLookupMap: null,
      supplementalImages: new Map(),
      supplementalImagePromises: new Map(),
    });

  const state = {
    initialized: false,
    refreshGeneration: 0,
    refreshTimeoutIds: [],
    expandedIds: loadSet(EXPANDED_STORAGE_KEY),
    groups: [],
    ungroupedLeaves: [],
    rootIds: [],
    tagMap: new Map(),
    searchIndex: [],
    selectedTagId: null,
    batchSelectedTagIds: [],
    draft: null,
    splitMode: false,
    splitOriginalDraft: null,
    splitNewDraft: null,
    splitOriginalAliasInput: "",
    splitNewAliasInput: "",
    searchText: "",
    utilityFilter: "all",
    parentCreateName: "",
    childCreateName: "",
    siblingCreateName: "",
    reparentQuery: "",
    reparentTargetId: "",
    batchReparentQuery: "",
    batchReparentTargetId: "",
    attachChildQuery: "",
    attachChildTargetIds: [],
    attachSiblingQuery: "",
    attachSiblingTargetId: "",
    aliasInput: "",
    aliasesExpanded: true,
    mergeQuery: "",
    mergeSourceId: "",
    mergeDestinationId: "",
    imagePickerOpen: false,
    imagePickerMode: "",
    imagePickerTarget: "main",
    imageUrlDraft: "",
    pendingDeleteConfirm: false,
    mergePanelOpen: false,
    status: { type: "", text: "" },
    isSaving: false,
    treeScrollTop: 0,
    draggingTagId: "",
    dragOverTagId: "",
    dragOverMode: "",
    hoverTagId: "",
    hoverAnchorRect: null,
  };

  function loadSet(key) {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch (err) {
      return new Set();
    }
  }

  function saveSet(key, setValue) {
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.from(setValue || []).map(String)));
    } catch (err) {
      void err;
    }
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
          throw new Error(json.errors.map((item) => item.message).join("; "));
        }
        return json.data;
      });
  }

  function getFontAwesomeLibrary(style = "solid") {
    if (style === "regular") return window.PluginApi?.libraries?.FontAwesomeRegular || null;
    return window.PluginApi?.libraries?.FontAwesomeSolid || null;
  }

  function getFontAwesomeDefinition(iconExportName, style = "solid") {
    const library = getFontAwesomeLibrary(style);
    return library?.[iconExportName]?.icon || null;
  }

  function renderFontAwesomeIconMarkup(icon, options = {}) {
    const { style = "solid", className = "", title = "" } = options;
    const definition = getFontAwesomeDefinition(icon, style);
    if (!definition) return "";

    const width = definition[0];
    const height = definition[1];
    const pathData = definition[4];
    const paths = Array.isArray(pathData) ? pathData : [pathData];

    return `
      <svg class="tag-manager__fa-icon ${escapeHtml(className)}" viewBox="0 0 ${width} ${height}" role="img" ${
        title ? "" : 'aria-hidden="true"'
      }>
        ${title ? `<title>${escapeHtml(title)}</title>` : ""}
        ${paths
          .map(
            (path, index) =>
              `<path d="${escapeHtml(path)}" fill="currentColor"${
                paths.length > 1 && index === 0 ? ' opacity="0.4"' : ""
              }></path>`
          )
          .join("")}
      </svg>
    `;
  }

  function normalizeConfig(raw) {
    const treeExpansionBehavior = String(
      raw?.c_treeExpansionBehavior || raw?.treeExpansionBehavior || DEFAULT_CONFIG.treeExpansionBehavior
    )
      .trim()
      .toLowerCase();

    return {
      treeExpansionBehavior:
        treeExpansionBehavior === "expand_all" ||
        treeExpansionBehavior === "collapse_all" ||
        treeExpansionBehavior === "remember"
          ? treeExpansionBehavior
          : DEFAULT_CONFIG.treeExpansionBehavior,
    };
  }

  function loadConfig() {
    if (cache.configPromise) return cache.configPromise;
    cache.configPromise = gqlRequest(`
      query CustomTagsManagerConfig {
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
        console.error("[CustomTagsManager] config load failed", err);
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
      query CustomTagsManagerAllTags {
        findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
          tags {
            id
            name
            aliases
            sort_name
            description
            custom_fields
            image_path
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
            }
          }
        }
      }
    `)
      .then((data) => {
        cache.tags = data?.findTags?.tags || [];
        cache.tagLookupMap = createTagMap(cache.tags);
        return cache.tags;
      })
      .catch((err) => {
        console.error("[CustomTagsManager] tag load failed", err);
        cache.tags = [];
        cache.tagLookupMap = new Map();
        return cache.tags;
      })
      .finally(() => {
        cache.tagsPromise = null;
      });
    return cache.tagsPromise;
  }

  function invalidateTags() {
    cache.tags = null;
    cache.tagsPromise = null;
    cache.tagLookupMap = null;
  }

  function getAvailableTagLookupMap() {
    if (state.tagMap instanceof Map && state.tagMap.size) return state.tagMap;
    if (cache.tagLookupMap instanceof Map) return cache.tagLookupMap;
    if (Array.isArray(cache.tags)) {
      cache.tagLookupMap = createTagMap(cache.tags);
      return cache.tagLookupMap;
    }
    return new Map();
  }

  function normalizeSupplementalImageId(value) {
    return String(value ?? "")
      .trim()
      .replace(/[^\d]/g, "");
  }

  function getSupplementalImageValue(customFields, key) {
    return normalizeSupplementalImageId(customFields?.[key]);
  }

  function getSupplementalImagePath(imageRecord) {
    return String(imageRecord?.paths?.thumbnail || imageRecord?.paths?.image || "").trim();
  }

  function getSupplementalImageIdsFromDraft(draft) {
    if (!draft) return [];
    return SUPPLEMENTAL_IMAGE_FIELDS.map((field) => normalizeSupplementalImageId(draft?.[field.draftKey]))
      .filter(Boolean);
  }

  function getVisibleSupplementalImageIds() {
    return Array.from(
      new Set(
        [
          ...getSupplementalImageIdsFromDraft(state.draft),
          ...getSupplementalImageIdsFromDraft(state.splitOriginalDraft),
          ...getSupplementalImageIdsFromDraft(state.splitNewDraft),
        ].filter(Boolean)
      )
    );
  }

  function buildSupplementalFieldsPartial(draft, currentRecord = null) {
    const partial = {};
    let changed = false;
    SUPPLEMENTAL_IMAGE_FIELDS.forEach((field) => {
      const nextValue = normalizeSupplementalImageId(draft?.[field.draftKey]);
      const currentValue = normalizeSupplementalImageId(currentRecord?.[field.draftKey]);
      if (nextValue !== currentValue) {
        partial[field.key] = nextValue;
        changed = true;
      }
    });
    return changed ? partial : null;
  }

  function ensureSupplementalImagesLoaded(imageIds = []) {
    const normalizedIds = Array.from(
      new Set(
        Array.from(imageIds || [])
          .map(normalizeSupplementalImageId)
          .filter(Boolean)
      )
    );
    const missingIds = normalizedIds.filter(
      (imageId) => !cache.supplementalImages.has(imageId)
    );
    if (!missingIds.length) return Promise.resolve(false);

    const requestKey = missingIds.slice().sort().join(",");
    if (cache.supplementalImagePromises.has(requestKey)) {
      return cache.supplementalImagePromises.get(requestKey);
    }

    const request = gqlRequest(
      `
        query CustomTagsManagerSupplementalImages($image_ids: [Int!]) {
          findImages(filter: { per_page: -1 }, image_ids: $image_ids) {
            images {
              id
              paths {
                thumbnail
                image
              }
            }
          }
        }
      `,
      {
        image_ids: missingIds
          .map((imageId) => Number.parseInt(imageId, 10))
          .filter((value) => Number.isFinite(value)),
      }
    )
      .then((data) => {
        const foundMap = new Map(
          Array.from(data?.findImages?.images || []).map((image) => [String(image.id), image])
        );
        missingIds.forEach((imageId) => {
          cache.supplementalImages.set(imageId, foundMap.get(imageId) || null);
        });
        return true;
      })
      .catch((err) => {
        console.error("[CustomTagsManager] supplemental image lookup failed", err);
        missingIds.forEach((imageId) => {
          cache.supplementalImages.set(imageId, null);
        });
        return true;
      })
      .finally(() => {
        cache.supplementalImagePromises.delete(requestKey);
      });

    cache.supplementalImagePromises.set(requestKey, request);
    return request;
  }

  function syncSupplementalImagePreviews() {
    const imageIds = getVisibleSupplementalImageIds();
    if (!imageIds.length) return;
    ensureSupplementalImagesLoaded(imageIds).then((didLoad) => {
      if (didLoad) render();
    });
  }

  function getHoverPreviewHost() {
    let host = document.getElementById(HOVER_PREVIEW_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOVER_PREVIEW_ID;
    host.className = "tag-manager-hover-preview";
    host.setAttribute("aria-hidden", "true");
    document.body.appendChild(host);
    return host;
  }

  function extractDescriptionPreview(text) {
    return String(text || "").trim().replace(/\s+/g, " ");
  }

  function getHoverPreviewImages(record) {
    const seen = new Set();
    const images = [];
    const pushImage = (src, label) => {
      const value = String(src || "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      images.push({ src: value, label: String(label || "Tag image") });
    };

    pushImage(record?.image_path, record?.name || "Primary image");
    SUPPLEMENTAL_IMAGE_FIELDS.forEach((field, index) => {
      const imageId = normalizeSupplementalImageId(record?.[field.draftKey]);
      if (!imageId) return;
      const preview = getSupplementalImagePath(cache.supplementalImages.get(imageId));
      pushImage(preview, field.label || `Supplemental image ${index + 1}`);
    });

    return images;
  }

  function renderHoverPreview(record) {
    const images = getHoverPreviewImages(record);
    const description = extractDescriptionPreview(record?.description || "");

    return `
      <div class="tag-manager-hover-preview__card">
        <div class="tag-manager-hover-preview__title">${escapeHtml(record?.name || "Tag")}</div>
        <div class="tag-manager-hover-preview__image-row">
          ${
            images.length
              ? images
                  .map(
                    (image) => `
                      <div class="tag-manager-hover-preview__image-frame">
                        <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.label)}" />
                      </div>
                    `
                  )
                  .join("")
              : `<div class="tag-manager-hover-preview__image-empty">No tag image</div>`
          }
        </div>
        ${
          description
            ? `<div class="tag-manager-hover-preview__description">${escapeHtml(description)}</div>`
            : ""
        }
      </div>
    `;
  }

  function renderNativeTagDetailSupplementalPanel(record) {
    const images = getHoverPreviewImages(record).slice(1, 3);
    if (!images.length) return "";

    return `
      <aside id="${TAG_DETAIL_PANEL_ID}" class="custom-tags-manager-tag-detail-panel">
        <div class="custom-tags-manager-tag-detail-panel__header">Supplemental Images</div>
        <div class="custom-tags-manager-tag-detail-panel__grid">
          ${images
            .map(
              (image, index) => `
                <div class="custom-tags-manager-tag-detail-panel__slot">
                  <img src="${escapeHtml(image.src)}" alt="${escapeHtml(
                    image.label || `Supplemental image ${index + 1}`
                  )}" />
                </div>
              `
            )
            .join("")}
        </div>
      </aside>
    `;
  }

  function removeNativeTagDetailSupplementalPanel() {
    document
      .querySelectorAll(".custom-tags-manager-tag-detail-layout")
      .forEach((element) => element.classList.remove("custom-tags-manager-tag-detail-layout"));
    const panel = getTagDetailPanel();
    if (panel) panel.remove();
  }

  async function syncNativeTagDetailSupplementalPanel() {
    if (!isTagDetailPage()) {
      removeNativeTagDetailSupplementalPanel();
      return true;
    }

    const detailHeader =
      document.querySelector("div.detail-header") ||
      document.querySelector(".tag-details .detail-header") ||
      document.querySelector(".detail-header");
    if (!(detailHeader instanceof HTMLElement)) {
      removeNativeTagDetailSupplementalPanel();
      return false;
    }

    const tagId = getTagDetailIdFromPath();
    if (!tagId) {
      removeNativeTagDetailSupplementalPanel();
      return true;
    }

    const record = await ensureHoverTagRecord(tagId);
    const markup = renderNativeTagDetailSupplementalPanel(record);
    if (!markup) {
      removeNativeTagDetailSupplementalPanel();
      return true;
    }

    detailHeader.classList.add("custom-tags-manager-tag-detail-layout");

    let panel = getTagDetailPanel();
    if (!panel) {
      detailHeader.insertAdjacentHTML("beforeend", markup);
      panel = getTagDetailPanel();
    } else if (panel.parentElement !== detailHeader) {
      panel.remove();
      detailHeader.insertAdjacentHTML("beforeend", markup);
      panel = getTagDetailPanel();
    } else {
      panel.outerHTML = markup;
      panel = getTagDetailPanel();
    }

    return !!panel;
  }

  function positionHoverPreview(anchorRect) {
    const host = getHoverPreviewHost();
    if (!(host instanceof HTMLElement) || !anchorRect) return;
    const previewWidth = Math.min(540, Math.max(320, Math.floor(window.innerWidth * 0.32)));
    host.style.maxWidth = `${previewWidth}px`;

    const margin = 14;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = host.getBoundingClientRect();
    let left = anchorRect.right + 12;
    let top = anchorRect.top;

    if (left + rect.width + margin > viewportWidth) {
      left = Math.max(margin, anchorRect.left - rect.width - 12);
    }
    if (top + rect.height + margin > viewportHeight) {
      top = Math.max(margin, viewportHeight - rect.height - margin);
    }
    if (top < margin) top = margin;

    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  function hideHoverPreview() {
    const host = document.getElementById(HOVER_PREVIEW_ID);
    if (host) {
      host.classList.remove("is-visible", "is-loading");
      host.setAttribute("aria-hidden", "true");
      host.innerHTML = "";
    }
    state.hoverTagId = "";
    state.hoverAnchorRect = null;
  }

  function showHoverPreviewLoading(anchorRect) {
    const host = getHoverPreviewHost();
    host.innerHTML = `<div class="tag-manager-hover-preview__card tag-manager-hover-preview__card--loading">Loading tag preview...</div>`;
    host.classList.add("is-visible", "is-loading");
    host.setAttribute("aria-hidden", "false");
    positionHoverPreview(anchorRect);
  }

  function getTagRecordById(tagId) {
    return getAvailableTagLookupMap().get(String(tagId)) || null;
  }

  async function ensureHoverTagRecord(tagId) {
    let record = getTagRecordById(tagId);
    if (!record) {
      await loadTags();
      record = getTagRecordById(tagId);
    }
    if (!record) return null;
    const imageIds = getSupplementalImageIdsFromDraft(record);
    if (imageIds.length) {
      await ensureSupplementalImagesLoaded(imageIds);
    }
    return getTagRecordById(tagId) || record;
  }

  function parseTagIdFromHref(href) {
    try {
      const url = new URL(String(href || ""), window.location.origin);
      const match = String(url.pathname || "").match(/^\/tags\/([^/?#]+)/);
      return match?.[1] ? String(match[1]) : "";
    } catch (err) {
      return "";
    }
  }

  function findHoverTagTarget(start) {
    if (!(start instanceof Element)) return null;
    const anchor = start.closest('a[href*="/tags/"]');
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    const tagId = parseTagIdFromHref(anchor.href);
    if (!tagId) return null;
    return { anchor, tagId };
  }

  function handleGlobalTagHover(event) {
    const targetInfo = findHoverTagTarget(event.target);
    if (!targetInfo) return;
    const { anchor, tagId } = targetInfo;
    if (state.hoverTagId === tagId) return;

    const anchorRect = anchor.getBoundingClientRect();
    state.hoverTagId = tagId;
    state.hoverAnchorRect = anchorRect;
    showHoverPreviewLoading(anchorRect);

    ensureHoverTagRecord(tagId).then((record) => {
      if (!record || state.hoverTagId !== tagId) return;
      const host = getHoverPreviewHost();
      host.innerHTML = renderHoverPreview(record);
      host.classList.add("is-visible");
      host.classList.remove("is-loading");
      host.setAttribute("aria-hidden", "false");
      positionHoverPreview(state.hoverAnchorRect || anchorRect);
    });
  }

  function handleGlobalTagHoverOut(event) {
    const activeTagId = String(state.hoverTagId || "");
    if (!activeTagId) return;
    const currentTarget = findHoverTagTarget(event.target);
    if (!currentTarget || currentTarget.tagId !== activeTagId) return;
    const related = event.relatedTarget;
    if (related instanceof Element && currentTarget.anchor.contains(related)) return;
    hideHoverPreview();
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
        name: tag.name || "",
        sort_name: tag.sort_name || "",
        sort_key: tag.sort_name || tag.name || "",
        aliases: normalizeAliasList(tag.aliases || []),
        description: tag.description || "",
        custom_fields: tag.custom_fields || {},
        image_path: tag.image_path || "",
        supplemental_image_1_id: getSupplementalImageValue(
          tag.custom_fields || {},
          SUPPLEMENTAL_IMAGE_FIELDS[0].key
        ),
        supplemental_image_2_id: getSupplementalImageValue(
          tag.custom_fields || {},
          SUPPLEMENTAL_IMAGE_FIELDS[1].key
        ),
        scene_count: getCountValue(tag, "scene_count"),
        studio_count: getCountValue(tag, "studio_count"),
        image_count: getCountValue(tag, "image_count"),
        gallery_count: getCountValue(tag, "gallery_count"),
        performer_count: getCountValue(tag, "performer_count"),
        total_count: getTotalCount(tag),
        childIds: (tag.children || []).map((child) => String(child.id)),
        parentIds: (tag.parents || []).map((parent) => String(parent.id)),
        parents: (tag.parents || []).map((parent) => ({
          id: String(parent.id),
          name: parent.name || "",
          sort_name: parent.sort_name || "",
        })),
      });
    });
    return map;
  }

  function sortIdsByName(ids, tagMap) {
    return Array.from(ids || [])
      .map(String)
      .filter((id) => tagMap.has(id))
      .sort((a, b) =>
        String(tagMap.get(a)?.sort_key || tagMap.get(a)?.name || "").localeCompare(
          String(tagMap.get(b)?.sort_key || tagMap.get(b)?.name || ""),
          undefined,
          { sensitivity: "base" }
        )
      );
  }

  function sortItemsBySortNameThenName(items) {
    items.sort((a, b) => {
      const aKey = String(a.sort_name || a.name || "").toLowerCase();
      const bKey = String(b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
  }

  function normalizeAliasList(values) {
    const seen = new Set();
    return Array.from(values || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function getUtilityFilterMatcher(filterId) {
    switch (String(filterId || "all")) {
      case "no-parent":
        return (record) => Array.isArray(record?.parentIds) && record.parentIds.length === 0;
      case "no-image":
        return (record) => {
          const imagePath = String(record?.image_path || "").trim();
          return !imagePath || imagePath.includes("default=true");
        };
      case "no-sort-name":
        return (record) => !String(record?.sort_name || "").trim();
      case "multiple-parents":
        return (record) => Array.isArray(record?.parentIds) && record.parentIds.length > 1;
      default:
        return () => true;
    }
  }

  function recordMatchesUtilityFilter(record, filterId = state.utilityFilter) {
    return getUtilityFilterMatcher(filterId)(record);
  }

  function isParentTag(record) {
    return Array.isArray(record?.childIds) && record.childIds.length > 0;
  }

  function createLeaf(record) {
    return {
      type: "leaf",
      id: record.id,
      name: record.name,
      sort_name: record.sort_name || record.name || "",
    };
  }

  function getPrimaryAncestorPath(id, tagMap) {
    const path = [];
    let current = tagMap.get(String(id));
    const visited = new Set();
    while (current?.parentIds?.length) {
      const parentId = String(current.parentIds[0]);
      if (!parentId || visited.has(parentId) || !tagMap.has(parentId)) break;
      visited.add(parentId);
      path.unshift(parentId);
      current = tagMap.get(parentId);
    }
    return path;
  }

  function getHierarchyPaths(tagRecord, tagMap) {
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
    const searchIndex = [];

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
      const subgroupId = String(parentRecord.id);
      if (!topGroup.subgroupMap.has(subgroupId)) {
        const subgroup = {
          type: "subgroup",
          id: subgroupId,
          name: parentRecord.name,
          sort_name: parentRecord.sort_name || parentRecord.name || "",
          children: [],
          childIds: new Set(),
        };
        topGroup.subgroupMap.set(subgroupId, subgroup);
        topGroup.items.push(subgroup);
      }
      return topGroup.subgroupMap.get(subgroupId);
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

    const ungroupedLeaves = [];
    const ungroupedLeafIds = new Set();

    for (const tag of tags) {
      const tagRecord = tagMap.get(String(tag.id));
      if (!tagRecord) continue;

      const parentTag = isParentTag(tagRecord);
      const paths = getHierarchyPaths(tagRecord, tagMap);

      for (const path of paths) {
        if (path.type === "ungrouped") {
          if (parentTag || ungroupedLeafIds.has(tagRecord.id)) continue;
          ungroupedLeaves.push(createLeaf(tagRecord));
          ungroupedLeafIds.add(tagRecord.id);
          searchIndex.push({
            id: tagRecord.id,
            name: tagRecord.name,
            sort_key: tagRecord.sort_key,
            breadcrumb: "",
            ancestorIds: [],
          });
          continue;
        }

        if (path.type === "subgroup") {
          const topGroup = ensureTopGroup(path.topParent);
          const subgroup = ensureSubgroup(topGroup, path.subgroupParent);
          if (!parentTag) {
            addLeafToSubgroup(subgroup, tagRecord);
            searchIndex.push({
              id: tagRecord.id,
              name: tagRecord.name,
              sort_key: tagRecord.sort_key,
              breadcrumb: `${path.topParent.name} > ${path.subgroupParent.name}`,
              ancestorIds: [String(path.topParent.id), String(path.subgroupParent.id)],
            });
          }
          continue;
        }

        if (path.type === "group") {
          const topGroup = ensureTopGroup(path.topParent);
          if (!parentTag) {
            addLeafToGroup(topGroup, tagRecord);
            searchIndex.push({
              id: tagRecord.id,
              name: tagRecord.name,
              sort_key: tagRecord.sort_key,
              breadcrumb: path.topParent.name,
              ancestorIds: [String(path.topParent.id)],
            });
          }
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
        sortItemsBySortNameThenName(group.items);
        group.items.forEach((item) => {
          if (item.type === "subgroup") sortItemsBySortNameThenName(item.children);
        });
        return group;
      })
      .filter((group) => group.items.length > 0)
      .sort((a, b) => {
        const aKey = String(a.parent.sort_name || a.parent.name || "").toLowerCase();
        const bKey = String(b.parent.sort_name || b.parent.name || "").toLowerCase();
        return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
      });

    sortItemsBySortNameThenName(ungroupedLeaves);
    searchIndex.sort((a, b) =>
      String(a.sort_key || a.name || "").localeCompare(String(b.sort_key || b.name || ""), undefined, {
        sensitivity: "base",
      })
    );

    const rootIds = sortIdsByName(
      Array.from(tagMap.values())
        .filter((record) => !record.parentIds.length)
        .map((record) => record.id),
      tagMap
    );

    return { groups, ungroupedLeaves, rootIds, tagMap, searchIndex };
  }

  function formatCount(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isManagerRoute() {
    return String(window.location.pathname || "").replace(/\/+$/, "") === PLUGIN_ROUTE;
  }

  function isTagsPage() {
    return String(window.location.pathname || "").replace(/\/+$/, "") === "/tags";
  }

  function getTagDetailIdFromPath(pathname = window.location.pathname) {
    const match = String(pathname || "").match(/^\/tags\/([^/?#]+)/);
    return match?.[1] ? String(match[1]) : "";
  }

  function isTagDetailPage() {
    return !!getTagDetailIdFromPath();
  }

  function getTagsToolbar() {
    return document.querySelector(".filtered-list-toolbar");
  }

  function getPageRoot() {
    return document.querySelector(".main > div") || document.querySelector(".main") || null;
  }

  function getHost() {
    return document.getElementById(HOST_ID);
  }

  function getToolbarMount() {
    return document.getElementById(TOOLBAR_ID);
  }

  function getTagDetailPanel() {
    return document.getElementById(TAG_DETAIL_PANEL_ID);
  }

  function shouldAutoOpenManagerFromQuery() {
    try {
      const url = new URL(window.location.href);
      return isTagsPage() && url.searchParams.get(LAUNCH_QUERY_PARAM) === "1";
    } catch (err) {
      return false;
    }
  }

  function getManagerLaunchHref() {
    const url = new URL("/tags", window.location.origin);
    url.searchParams.set(LAUNCH_QUERY_PARAM, "1");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function createRetryableRefreshError(message) {
    const error = new Error(message || "Retryable refresh");
    error.customTagsManagerRetry = true;
    return error;
  }

  function ensureLaunchButton() {
    if (!isTagsPage()) {
      const mount = getToolbarMount();
      if (mount) mount.remove();
      return true;
    }

    const toolbar = getTagsToolbar();
    if (!toolbar) return false;

    let mount = getToolbarMount();
    if (!mount) {
      mount = document.createElement("div");
      mount.id = TOOLBAR_ID;
      mount.className = "tag-manager-toolbar";
      toolbar.appendChild(mount);
    } else if (mount.parentElement !== toolbar) {
      toolbar.appendChild(mount);
    }

    const href = getManagerLaunchHref();
    let link = mount.querySelector(".tag-manager-toolbar__button");
    if (!(link instanceof HTMLAnchorElement)) {
      mount.innerHTML = "";
      link = document.createElement("a");
      link.className = "btn btn-secondary tag-manager-toolbar__button";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Custom Tags Manager";
      mount.appendChild(link);
    }
    if (link.getAttribute("href") !== href) {
      link.setAttribute("href", href);
    }
    return true;
  }

  function setStatus(type, text) {
    state.status = { type: type || "", text: text || "" };
  }

  function resetRelationshipPickers() {
    state.reparentQuery = "";
    state.reparentTargetId = "";
    state.attachChildQuery = "";
    state.attachChildTargetIds = [];
    state.attachSiblingQuery = "";
    state.attachSiblingTargetId = "";
  }

  function clearBatchSelection() {
    state.batchSelectedTagIds = [];
    state.batchReparentQuery = "";
    state.batchReparentTargetId = "";
  }

  function resetSplitState() {
    state.splitMode = false;
    state.splitOriginalDraft = null;
    state.splitNewDraft = null;
    state.splitOriginalAliasInput = "";
    state.splitNewAliasInput = "";
  }

  function expandAncestors(ids) {
    let changed = false;
    (ids || []).map(String).forEach((id) => {
      if (!state.expandedIds.has(id)) {
        state.expandedIds.add(id);
        changed = true;
      }
    });
    if (changed) saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
  }

  function setSelectedTag(tagId, options = {}) {
    const treePanel = getHost()?.querySelector(".tag-manager__tree-panel-scroll");
    if (treePanel instanceof HTMLElement) {
      state.treeScrollTop = treePanel.scrollTop;
    }
    const id = tagId ? String(tagId) : null;
    clearBatchSelection();
    resetSplitState();
    state.selectedTagId = id && state.tagMap.has(id) ? id : null;
    const record = state.selectedTagId ? state.tagMap.get(state.selectedTagId) : null;
    state.draft = createDraftFromRecord(record);
    state.parentCreateName = "";
    state.childCreateName = "";
    state.siblingCreateName = "";
    state.aliasInput = "";
    state.mergeQuery = "";
    state.mergeSourceId = "";
    state.mergeDestinationId = "";
    state.mergePanelOpen = false;
    state.imagePickerOpen = false;
    state.imagePickerMode = "";
    state.imagePickerTarget = "main";
    state.imageUrlDraft = "";
    state.pendingDeleteConfirm = false;
    setStatus("", "");
    if (state.selectedTagId) {
      expandAncestors(getPrimaryAncestorPath(state.selectedTagId, state.tagMap));
    }
    if (!options.skipRender) render();
  }

  function startNewTagDraft(options = {}) {
    const treePanel = getHost()?.querySelector(".tag-manager__tree-panel-scroll");
    if (treePanel instanceof HTMLElement) {
      state.treeScrollTop = treePanel.scrollTop;
    }
    state.selectedTagId = null;
    clearBatchSelection();
    resetSplitState();
    state.draft = createBlankDraft();
    state.parentCreateName = "";
    state.childCreateName = "";
    state.siblingCreateName = "";
    resetRelationshipPickers();
    state.aliasInput = "";
    state.mergeQuery = "";
    state.mergeSourceId = "";
    state.mergeDestinationId = "";
    state.imagePickerOpen = false;
    state.imagePickerMode = "";
    state.imagePickerTarget = "main";
    state.imageUrlDraft = "";
    state.pendingDeleteConfirm = false;
    state.mergePanelOpen = false;
    setStatus("", "");
    if (!options.skipRender) render();
  }

  function toggleExpanded(tagId) {
    const id = String(tagId || "");
    if (!id) return;
    if (state.expandedIds.has(id)) state.expandedIds.delete(id);
    else state.expandedIds.add(id);
    saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
    render();
  }

  function ensureTreeExpansionBehavior() {
    if (cache.config.treeExpansionBehavior === "remember") return;
    if (cache.config.treeExpansionBehavior === "collapse_all") {
      state.expandedIds = new Set();
      saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
      return;
    }
    const expanded = new Set();
    state.groups.forEach((group) => {
      expanded.add(String(group.parent.id));
      (group.items || []).forEach((item) => {
        if (item.type === "subgroup") expanded.add(String(item.id));
      });
    });
    state.expandedIds = expanded;
    saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
  }

  function getSearchResults() {
    const query = String(state.searchText || "").trim().toLowerCase();
    if (!query) return [];
    return state.searchIndex
      .filter((item) => {
        const record = state.tagMap.get(String(item.id));
        if (!recordMatchesUtilityFilter(record)) return false;
        return (
          String(item.name || "").toLowerCase().includes(query) ||
          String(item.breadcrumb || "").toLowerCase().includes(query)
        );
      })
      .slice(0, SEARCH_LIMIT);
  }

  function getFilteredHierarchy() {
    if (state.utilityFilter === "all") {
      return {
        groups: state.groups,
        ungroupedLeaves: state.ungroupedLeaves,
      };
    }

    if (state.utilityFilter === "no-parent") {
      return {
        groups: [],
        ungroupedLeaves: state.ungroupedLeaves.filter((leaf) =>
          recordMatchesUtilityFilter(state.tagMap.get(String(leaf.id)))
        ),
      };
    }

    const groups = state.groups
      .map((group) => {
        const groupRecord = state.tagMap.get(String(group.parent.id));
        const groupMatches = recordMatchesUtilityFilter(groupRecord);
        const items = (group.items || [])
          .map((item) => {
            if (item.type === "subgroup") {
              const subgroupRecord = state.tagMap.get(String(item.id));
              const subgroupMatches = recordMatchesUtilityFilter(subgroupRecord);
              const children = (item.children || []).filter((child) =>
                recordMatchesUtilityFilter(state.tagMap.get(String(child.id)))
              );
              if (!subgroupMatches && !children.length) return null;
              return {
                ...item,
                children,
              };
            }
            return recordMatchesUtilityFilter(state.tagMap.get(String(item.id))) ? item : null;
          })
          .filter(Boolean);

        if (!groupMatches && !items.length) return null;
        return {
          ...group,
          items,
        };
      })
      .filter(Boolean);

    const ungroupedLeaves = state.ungroupedLeaves.filter((leaf) =>
      recordMatchesUtilityFilter(state.tagMap.get(String(leaf.id)))
    );

    return { groups, ungroupedLeaves };
  }

  function getSummary() {
    let noSortName = 0;
    state.tagMap.forEach((record) => {
      if (!String(record.sort_name || "").trim()) noSortName += 1;
    });
    return {
      total: state.tagMap.size,
      roots: state.rootIds.length,
      noSortName,
    };
  }

  function getParentPaths(tagId, tagMap, visited = new Set()) {
    const id = String(tagId || "");
    const record = tagMap.get(id);
    if (!record || !record.parentIds.length || visited.has(id)) return [];

    const nextVisited = new Set(visited);
    nextVisited.add(id);

    const results = [];
    record.parentIds.forEach((parentId) => {
      const parent = tagMap.get(String(parentId));
      if (!parent) return;
      const parentPaths = getParentPaths(parent.id, tagMap, nextVisited);
      if (!parentPaths.length) {
        results.push([parent.id]);
        return;
      }
      parentPaths.forEach((path) => {
        results.push([...path, parent.id]);
      });
    });
    return results;
  }

  function getMaxParentDepth(tagId, tagMap = state.tagMap) {
    const paths = getParentPaths(tagId, tagMap);
    if (!paths.length) return 0;
    return paths.reduce((maxDepth, path) => Math.max(maxDepth, path.length), 0);
  }

  function getMaxChildDepth(tagId, tagMap = state.tagMap, visited = new Set()) {
    const id = String(tagId || "");
    if (!id || visited.has(id)) return 0;
    const record = tagMap.get(id);
    if (!record || !record.childIds.length) return 0;
    const nextVisited = new Set(visited);
    nextVisited.add(id);
    return record.childIds.reduce((maxDepth, childId) => {
      return Math.max(maxDepth, 1 + getMaxChildDepth(childId, tagMap, nextVisited));
    }, 0);
  }

  function canTagHaveChildren(tagId, tagMap = state.tagMap) {
    return getMaxParentDepth(tagId, tagMap) < 2;
  }

  function getBatchSelectionType(tagOrId, tagMap = state.tagMap) {
    const record =
      typeof tagOrId === "object" && tagOrId ? tagOrId : tagMap.get(String(tagOrId || ""));
    if (!record || (record.childIds || []).length) return "";
    return `depth-${getMaxParentDepth(record.id, tagMap)}`;
  }

  function isBatchSelectionEligible(tagId, anchorId = "", tagMap = state.tagMap) {
    const record = tagMap.get(String(tagId || ""));
    if (!record || (record.childIds || []).length) return false;
    const candidateType = getBatchSelectionType(record, tagMap);
    if (!candidateType) return false;
    if (!anchorId) return true;
    return candidateType === getBatchSelectionType(String(anchorId || ""), tagMap);
  }

  function getBatchSelectionSummaryLabel(tagIds = state.batchSelectedTagIds, tagMap = state.tagMap) {
    const selectedIds = (tagIds || []).map(String).filter(Boolean);
    const anchorId = selectedIds[0] || "";
    const depth = anchorId ? getMaxParentDepth(anchorId, tagMap) : -1;
    if (depth <= 0) return "Unparented tags";
    if (depth === 1) return "Leaf tags under a parent group";
    return "Leaf tags under a subgroup";
  }

  function hasBatchSelection() {
    return Array.isArray(state.batchSelectedTagIds) && state.batchSelectedTagIds.length > 0;
  }

  function shouldShowBatchToggle(tagId) {
    const id = String(tagId || "");
    if (!id || state.isSaving) return false;
    const selectedIds = (state.batchSelectedTagIds || []).map(String);
    if (selectedIds.includes(id)) return true;
    return isBatchSelectionEligible(id, selectedIds[0] || "");
  }

  function renderBatchToggle(tagId, label) {
    if (!shouldShowBatchToggle(tagId)) return "";
    const checked = (state.batchSelectedTagIds || []).map(String).includes(String(tagId));
    const icon =
      renderFontAwesomeIconMarkup(checked ? "faSquareCheck" : "faSquare", {
        className: "tag-manager__batch-toggle-icon",
        title: checked ? `Deselect ${label || "tag"}` : `Select ${label || "tag"}`,
      }) || `<span class="tag-manager__batch-toggle-fallback">${checked ? "☑" : "☐"}</span>`;
    return `
      <button
        type="button"
        class="tag-manager__batch-toggle ${checked ? "is-checked" : ""}"
        data-action="toggle-batch-select"
        data-tag-id="${escapeHtml(tagId)}"
        aria-pressed="${checked ? "true" : "false"}"
        title="${checked ? "Remove from batch selection" : "Add to batch selection"}"
      >${icon}</button>
    `;
  }

  function canTagGainInsertedParent(tagId, tagMap = state.tagMap) {
    return getMaxParentDepth(tagId, tagMap) + getMaxChildDepth(tagId, tagMap) < 2;
  }

  function canTagHaveSiblings(tagId, tagMap = state.tagMap) {
    return getMaxParentDepth(tagId, tagMap) >= 1;
  }

  function canAttachTagToParent(childTagId, parentTagId, tagMap = state.tagMap) {
    if (!childTagId || !parentTagId) return false;
    return (
      canTagHaveChildren(parentTagId, tagMap) &&
      getMaxParentDepth(parentTagId, tagMap) + 1 + getMaxChildDepth(childTagId, tagMap) <= 2
    );
  }

  function getParentRelationshipBlockReason(sourceTagId, parentTagId, mode = "add-parent", tagMap = state.tagMap) {
    const sourceId = String(sourceTagId || "");
    const targetId = String(parentTagId || "");
    if (!sourceId || !targetId) return "";

    const sourceRecord = tagMap.get(sourceId);
    const targetRecord = tagMap.get(targetId);
    if (!sourceRecord || !targetRecord) return "Selected tag could not be found.";
    if (sourceId === targetId) return "Select a different tag.";
    if (mode === "add-parent" && (sourceRecord.parentIds || []).includes(targetId)) {
      return "Current tag already has that parent.";
    }
    if (isDescendantTag(sourceId, targetId)) {
      return "You cannot reparent a tag beneath one of its descendants.";
    }
    if (!canAttachTagToParent(sourceId, targetId, tagMap)) {
      return "That parent relationship would exceed the 3-level hierarchy limit.";
    }
    return "";
  }

  function getAttachChildBlockReason(sourceTagId, childTagId, tagMap = state.tagMap) {
    const sourceId = String(sourceTagId || "");
    const targetId = String(childTagId || "");
    if (!sourceId || !targetId) return "";

    const sourceRecord = tagMap.get(sourceId);
    const targetRecord = tagMap.get(targetId);
    if (!sourceRecord || !targetRecord) return "Selected tag could not be found.";
    if (!canTagHaveChildren(sourceId, tagMap)) return "Current tag is already under 2 tag groups.";
    if (sourceId === targetId) return "Select a different tag.";
    if ((targetRecord.parentIds || []).includes(sourceId)) return "Selected tag is already a child of the current tag.";
    if (isDescendantTag(targetId, sourceId)) {
      return "You cannot attach an ancestor beneath its descendant.";
    }
    if (!canAttachTagToParent(targetId, sourceId, tagMap)) {
      return "That parent relationship would exceed the 3-level hierarchy limit.";
    }
    return "";
  }

  function getAttachSiblingBlockReason(sourceTagId, siblingTagId, tagMap = state.tagMap) {
    const sourceId = String(sourceTagId || "");
    const targetId = String(siblingTagId || "");
    if (!sourceId || !targetId) return "";

    const sourceRecord = tagMap.get(sourceId);
    const targetRecord = tagMap.get(targetId);
    if (!sourceRecord || !targetRecord) return "Selected tag could not be found.";
    if (!canTagHaveSiblings(sourceId, tagMap)) {
      return "Only available for subgroup and leaf tags under an existing parent group.";
    }
    if (sourceId === targetId) return "Select a different tag.";

    const sourceParents = (sourceRecord.parentIds || []).map(String);
    if (!sourceParents.length) {
      return "Only available for subgroup and leaf tags under an existing parent group.";
    }
    if (sourceParents.every((parentId) => (targetRecord.parentIds || []).map(String).includes(parentId))) {
      return "Selected tag already shares those parents.";
    }
    if (sourceParents.some((parentId) => parentId === targetId || isDescendantTag(targetId, parentId))) {
      return "That sibling relationship would create an invalid hierarchy.";
    }
    if (sourceParents.some((parentId) => !canAttachTagToParent(targetId, parentId, tagMap))) {
      return "That sibling relationship would exceed the 3-level hierarchy limit.";
    }
    return "";
  }

  function getTagHierarchyRole(tagOrId, tagMap = state.tagMap) {
    const record =
      typeof tagOrId === "object" && tagOrId
        ? tagOrId
        : tagMap.get(String(tagOrId || ""));
    if (!record) return "";
    const hasChildren = Array.isArray(record.childIds) && record.childIds.length > 0;
    if (!hasChildren) return "leaf";
    return getMaxParentDepth(record.id, tagMap) >= 1 ? "subgroup" : "parentgroup";
  }

  function getTagHierarchyRoleLabel(role) {
    if (role === "parentgroup") return "parent groups";
    if (role === "subgroup") return "subgroups";
    return "leaf tags";
  }

  function getMergeBlockReason(destinationTagId, sourceTagId, tagMap = state.tagMap) {
    const destinationId = String(destinationTagId || "");
    const sourceId = String(sourceTagId || "");
    if (!destinationId || !sourceId) return "";
    if (destinationId === sourceId) return "Select a different source tag.";

    const destinationRecord = tagMap.get(destinationId);
    const sourceRecord = tagMap.get(sourceId);
    if (!destinationRecord || !sourceRecord) return "Selected tag could not be found.";

    const destinationRole = getTagHierarchyRole(destinationRecord, tagMap);
    const sourceRole = getTagHierarchyRole(sourceRecord, tagMap);
    if (destinationRole !== sourceRole) {
      return `Only ${getTagHierarchyRoleLabel(destinationRole)} can be merged into this tag.`;
    }
    if (isDescendantTag(destinationId, sourceId) || isDescendantTag(sourceId, destinationId)) {
      return "You cannot merge ancestor and descendant tags.";
    }
    return "";
  }

  function renderParentPaths(record) {
    const paths = getParentPaths(record?.id, state.tagMap);
    if (!paths.length) {
      return `<span class="tag-manager__meta-empty">Root tag</span>`;
    }
    return paths
      .map((path) => {
        const segments = path
          .map((id) => {
            const node = state.tagMap.get(String(id));
            if (!node) return "";
            return `<button type="button" class="tag-manager__chip" data-action="select-tag" data-tag-id="${escapeHtml(
              id
            )}">${escapeHtml(node.name)}</button>`;
          })
          .filter(Boolean)
          .join('<span class="tag-manager__path-separator">&rsaquo;</span>');
        return `<div class="tag-manager__path-row">${segments}</div>`;
      })
      .join("");
  }

  function renderDeleteSummary(record) {
    if (!record) return "";
    const warnings = [];
    const childCount = Number(record.childIds?.length || 0);
    const contentCount = Number(record.total_count || 0);

    if (childCount > 0) {
      warnings.push(
        `${formatCount(childCount)} child tag${childCount === 1 ? "" : "s"} will become orphaned.`
      );
    }
    if (contentCount > 0) {
      warnings.push(
        `${formatCount(contentCount)} attached content relationship${contentCount === 1 ? "" : "s"} will be removed.`
      );
    }
    if (!warnings.length) {
      warnings.push("This tag will be permanently deleted.");
    }

    return warnings
      .map((warning) => `<div class="tag-manager__danger-line">${escapeHtml(warning)}</div>`)
      .join("");
  }

  function renderImagePicker(target = "main") {
    if (!state.imagePickerOpen) return "";
    if (String(state.imagePickerTarget || "main") !== String(target || "main")) return "";

    const currentImage = String(getDraftImageByTarget(target) || "").trim();
    return `
      <div class="tag-manager__image-picker">
        <div class="tag-manager__image-picker-row">
          <button type="button" class="btn btn-secondary tag-manager__picker-button" data-action="open-image-url-picker" data-image-target="${escapeHtml(target)}">From URL</button>
          <button type="button" class="btn btn-secondary tag-manager__picker-button" data-action="open-image-file-picker" data-image-target="${escapeHtml(target)}">From File</button>
          <button type="button" class="btn btn-secondary tag-manager__picker-button" data-action="read-image-clipboard" data-image-target="${escapeHtml(target)}">From Clipboard</button>
          <button type="button" class="btn btn-secondary tag-manager__picker-button" data-action="close-image-picker" data-image-target="${escapeHtml(target)}">Close</button>
        </div>
        ${
          state.imagePickerMode === "url"
            ? `<div class="tag-manager__image-picker-url">
                <input class="tag-manager__input" type="url" data-field="image-url-draft" value="${escapeHtml(
                  state.imageUrlDraft || currentImage
                )}" placeholder="Paste an image URL" />
                <div class="tag-manager__button-row">
                  <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="apply-image-url" data-image-target="${escapeHtml(target)}" ${
                    String(state.imageUrlDraft || "").trim() && !state.isSaving ? "" : "disabled"
                  }>Use URL</button>
                  <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="cancel-image-url" data-image-target="${escapeHtml(target)}">Cancel</button>
                </div>
              </div>`
            : ""
        }
      </div>
    `;
  }

  function renderChildrenList(record) {
    const childIds = sortIdsByName(record?.childIds || [], state.tagMap);
    if (!childIds.length) {
      return `<span class="tag-manager__meta-empty">No child tags</span>`;
    }
    return childIds
      .map((id) => {
        const child = state.tagMap.get(String(id));
        if (!child) return "";
        const branchMarker = child.childIds.length
          ? '<span class="tag-manager__child-branch" title="Has child tags">+</span>'
          : "";
        return `<button type="button" class="tag-manager__child-chip" data-action="select-tag" data-tag-id="${escapeHtml(
          id
        )}">${branchMarker}<span>${escapeHtml(child.name)}</span></button>`;
      })
      .join("");
  }

  function buildSingleTagCriterion(tagId) {
    const id = String(tagId || "").trim();
    if (!id) return null;
    return {
      type: "tags",
      value: {
        items: [
          {
            id,
            label: state.tagMap.get(id)?.name || id,
          },
        ],
        excluded: [],
        depth: 0,
      },
      modifier: "INCLUDES",
    };
  }

  function buildTagFilteredPageHref(pathname, tagId) {
    const criterion = buildSingleTagCriterion(tagId);
    const url = new URL(String(pathname || "/"), window.location.origin);
    url.searchParams.delete("c");
    if (criterion) {
      url.searchParams.append("c", JSON.stringify(criterion));
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function renderUsageLinkBadge(options) {
    const { record, count, title, path, icon, extraClass = "" } = options;
    return `<a class="tag-manager__usage-badge tag-manager__usage-badge--link ${escapeHtml(
      extraClass
    )}" href="${escapeHtml(buildTagFilteredPageHref(path, record?.id))}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(
      title
    )} filtered to this tag">
      <span class="tag-manager__usage-badge-icon">${renderFontAwesomeIconMarkup(icon, {
        className: "tag-manager__usage-icon",
        title,
      })}</span>
      <strong>${formatCount(count)}</strong>
    </a>`;
  }

  function renderUsageBadges(record) {
    return `
      <div class="tag-manager__usage-badges">
        ${renderUsageLinkBadge({
          record,
          count: record.scene_count,
          title: "Scenes",
          path: CONTENT_FILTER_PATHS.scenes,
          icon: "faFilm",
        })}
        ${renderUsageLinkBadge({
          record,
          count: record.image_count,
          title: "Images",
          path: CONTENT_FILTER_PATHS.images,
          icon: "faImage",
        })}
        ${renderUsageLinkBadge({
          record,
          count: record.gallery_count,
          title: "Galleries",
          path: CONTENT_FILTER_PATHS.galleries,
          icon: "faImages",
        })}
        ${renderUsageLinkBadge({
          record,
          count: record.performer_count,
          title: "Performers",
          path: CONTENT_FILTER_PATHS.performers,
          icon: "faImagePortrait",
        })}
        <span class="tag-manager__usage-badge tag-manager__usage-badge--total" title="Total">
          <span class="tag-manager__usage-badge-icon">${renderFontAwesomeIconMarkup("faHashtag", {
            className: "tag-manager__usage-icon",
            title: "Total",
          })}</span>
          <strong>${formatCount(record.total_count)}</strong>
        </span>
      </div>
    `;
  }

  function getAliasAddBlockReason() {
    const alias = String(state.aliasInput || "").trim();
    if (!alias) return "Enter an alias.";
    if (!state.draft) return "Select a tag first.";
    if (alias.toLowerCase() === String(state.draft.name || "").trim().toLowerCase()) {
      return "Alias already matches the tag name.";
    }
    if ((state.draft.aliases || []).some((entry) => String(entry || "").trim().toLowerCase() === alias.toLowerCase())) {
      return "Alias already exists.";
    }
    return "";
  }

  function renderAliasesPanel() {
    if (!state.draft) return "";
    const aliases = normalizeAliasList(state.draft.aliases || []);
    const addReason = getAliasAddBlockReason();
    return `
      <div class="tag-manager__meta-card tag-manager__meta-card--aliases">
        <div class="tag-manager__meta-header">
          <div class="tag-manager__meta-label">Aliases</div>
          <div class="tag-manager__meta-header-actions">
            <div class="tag-manager__meta-value">${formatCount(aliases.length)}</div>
            <button type="button" class="btn btn-secondary tag-manager__collapse-button" data-action="toggle-aliases-expanded" ${
              state.isSaving ? "disabled" : ""
            }>${state.aliasesExpanded ? "Collapse" : "Expand"}</button>
          </div>
        </div>
        ${
          state.aliasesExpanded
            ? `<div class="tag-manager__alias-editor">
                <div class="tag-manager__alias-input-row">
                  <input class="tag-manager__input" type="text" data-field="alias-input" value="${escapeHtml(
                    state.aliasInput
                  )}" placeholder="Add an alias" ${state.isSaving ? "disabled" : ""} />
                  <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="add-alias" ${
                    !addReason && !state.isSaving ? "" : "disabled"
                  }>Add Alias</button>
                </div>
                ${
                  state.aliasInput && addReason
                    ? `<div class="tag-manager__field-note">${escapeHtml(addReason)}</div>`
                    : ""
                }
                <div class="tag-manager__alias-panel-scroll">
                  <div class="tag-manager__alias-list">
                    ${
                      aliases.length
                        ? aliases
                            .map(
                              (alias, index) => `<div class="tag-manager__alias-chip">
                                <span class="tag-manager__alias-chip-text">${escapeHtml(alias)}</span>
                                <button type="button" class="tag-manager__alias-remove" data-action="remove-alias" data-alias-index="${index}" ${
                                  state.isSaving ? "disabled" : ""
                                } aria-label="Remove alias ${escapeHtml(alias)}">&times;</button>
                              </div>`
                            )
                            .join("")
                        : `<span class="tag-manager__meta-empty">No aliases</span>`
                    }
                  </div>
                </div>
              </div>`
            : ""
        }
      </div>
    `;
  }

  function renderReadonlyAliasesCard(title, aliases) {
    const normalized = normalizeAliasList(aliases || []);
    return `
      <div class="tag-manager__meta-card tag-manager__split-meta-card">
        <div class="tag-manager__meta-header">
          <div class="tag-manager__meta-label">${escapeHtml(title)}</div>
          <div class="tag-manager__meta-value">${formatCount(normalized.length)}</div>
        </div>
        <div class="tag-manager__alias-panel-scroll">
          <div class="tag-manager__alias-list">
            ${
              normalized.length
                ? normalized
                    .map(
                      (alias) => `<div class="tag-manager__alias-chip">
                        <span class="tag-manager__alias-chip-text">${escapeHtml(alias)}</span>
                      </div>`
                    )
                    .join("")
                : `<span class="tag-manager__meta-empty">No aliases</span>`
            }
          </div>
        </div>
      </div>
    `;
  }

  function renderPreviewTagCard(title, draftLikeRecord, options = {}) {
    const record = draftLikeRecord || {};
    const previewImagePath = String(record.image_path || "").trim();
    const showSearch = !!options.showSearch;
    const searchOptions = options.searchOptions || [];
    const searchValue = String(options.searchValue || "");
    const selectedId = String(options.selectedId || "");
    const searchActionName = String(options.searchActionName || "merge");
    const emptyTitle = String(options.emptyTitle || "No source selected");
    const emptyText = String(options.emptyText || "Search for a tag to preview it here.");
    const idChipLabel = options.idLabel || (record.id ? `ID ${record.id}` : "");

    return `
      <div class="tag-manager__editor-card tag-manager__split-card">
        <div class="tag-manager__meta-header">
          <div class="tag-manager__section-title">${escapeHtml(title)}</div>
          ${idChipLabel ? `<span class="tag-manager__id-chip">${escapeHtml(idChipLabel)}</span>` : ""}
        </div>
        ${
          showSearch
            ? `<div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-merge-query">Source Tag To Merge</label>
                <input id="tag-manager-merge-query" class="tag-manager__input" type="search" data-field="merge-query" value="${escapeHtml(
                  searchValue
                )}" placeholder="Search for a source tag" ${state.isSaving ? "disabled" : ""} />
                ${renderAttachPicker(searchValue, selectedId, searchOptions, searchActionName)}
              </div>`
            : ""
        }
        ${
          record.id
            ? `${
                previewImagePath
                  ? `<div class="tag-manager__image-preview">
                      <img src="${escapeHtml(previewImagePath)}" alt="${escapeHtml(record.name || title)}" />
                    </div>`
                  : `<div class="tag-manager__split-image-empty">No image set</div>`
              }
              <div class="tag-manager__field-grid">
                <div class="tag-manager__field-group">
                  <label class="tag-manager__field-label">Name</label>
                  <div class="tag-manager__input tag-manager__input--readonly">${escapeHtml(record.name || "")}</div>
                </div>
                <div class="tag-manager__field-group">
                  <label class="tag-manager__field-label">Sort Name</label>
                  <div class="tag-manager__input tag-manager__input--readonly">${escapeHtml(record.sort_name || "")}</div>
                </div>
              </div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label">Description</label>
                <div class="tag-manager__textarea tag-manager__textarea--readonly">${escapeHtml(record.description || "")}</div>
              </div>`
            : `<div class="tag-manager__empty-state tag-manager__merge-empty">
                <h3 class="tag-manager__inspector-title">${escapeHtml(emptyTitle)}</h3>
                <p class="tag-manager__helper">${escapeHtml(emptyText)}</p>
              </div>`
        }
      </div>
    `;
  }

  function renderSupplementalImageField(field, draft) {
    const imageId = normalizeSupplementalImageId(draft?.[field.draftKey]);
    const imageRecord = imageId ? cache.supplementalImages.get(imageId) : null;
    const previewPath = getSupplementalImagePath(imageRecord);
    const isMissing = !!imageId && cache.supplementalImages.has(imageId) && !imageRecord;

    return `
      <div class="tag-manager__supplemental-slot" data-preview-slot="${escapeHtml(field.draftKey)}">
        <div class="tag-manager__supplemental-preview">
          ${
            previewPath
              ? `<img src="${escapeHtml(previewPath)}" alt="${escapeHtml(field.label)}" />`
              : `<div class="tag-manager__supplemental-empty">${
                  isMissing ? "Image not found" : "No supplemental image"
                }</div>`
          }
        </div>
        <div class="tag-manager__field-group">
          <label class="tag-manager__field-label" for="tag-manager-${escapeHtml(field.draftKey)}">${escapeHtml(
            field.label
          )}</label>
          <div class="tag-manager__supplemental-input-row">
            <input
              id="tag-manager-${escapeHtml(field.draftKey)}"
              class="tag-manager__input"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              data-field="draft-${escapeHtml(field.draftKey)}"
              value="${escapeHtml(imageId)}"
              placeholder="Stash image ID"
              ${state.isSaving ? "disabled" : ""}
            />
            <button
              type="button"
              class="btn btn-secondary tag-manager__supplemental-clear"
              data-action="clear-supplemental-image"
              data-supplemental-slot="${escapeHtml(field.draftKey)}"
              ${imageId && !state.isSaving ? "" : "disabled"}
            >Clear</button>
          </div>
          ${
            isMissing
              ? `<div class="tag-manager__field-note">This image id could not be resolved. Save is still allowed.</div>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderMergeInspector() {
    const destinationRecord = state.mergeDestinationId
      ? state.tagMap.get(String(state.mergeDestinationId))
      : state.selectedTagId
      ? state.tagMap.get(String(state.selectedTagId))
      : null;
    const sourceRecord = state.mergeSourceId ? state.tagMap.get(String(state.mergeSourceId)) : null;
    const mergeOptions = getTagPickerOptions(state.mergeQuery, [destinationRecord?.id]);
    const mergeReason = isDraftDirty()
      ? "Save or reset current changes before merging tags."
      : destinationRecord && state.mergeSourceId
      ? getMergeBlockReason(destinationRecord.id, state.mergeSourceId)
      : "";
    const destinationRole = destinationRecord ? getTagHierarchyRole(destinationRecord) : "";
    const roleLabel = getTagHierarchyRoleLabel(destinationRole);
    const status =
      state.status.text &&
      `<div class="tag-manager__status tag-manager__status--${escapeHtml(
        state.status.type || "info"
      )}">${escapeHtml(state.status.text)}</div>`;

    return `
      ${status || ""}
      <div class="tag-manager__split-workspace">
        <div class="tag-manager__split-header">
          <div>
            <h3 class="tag-manager__inspector-title">Merge Tags</h3>
            <p class="tag-manager__helper">Current tag is the destination. Only ${escapeHtml(
              roleLabel
            )} can be merged here.</p>
          </div>
          <div class="tag-manager__button-row">
            <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="flip-merge-direction" ${
              state.mergeSourceId && !state.isSaving ? "" : "disabled"
            }>Flip</button>
            <button type="button" class="btn btn-danger tag-manager__action-button" data-action="confirm-merge-tag" ${
              state.mergeSourceId && !mergeReason && !state.isSaving ? "" : "disabled"
            }>Confirm Merge</button>
            <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="cancel-merge-tag" ${
              state.isSaving ? "disabled" : ""
            }>Cancel</button>
          </div>
        </div>
        ${
          mergeReason
            ? `<div class="tag-manager__field-note">${escapeHtml(mergeReason)}</div>`
            : sourceRecord
            ? `<div class="tag-manager__field-note">Source tag <strong>${escapeHtml(
                sourceRecord.name
              )}</strong> will be merged into <strong>${escapeHtml(
                destinationRecord?.name || ""
              )}</strong>. Stash will handle aliases, descriptions, image cleanup, and relationship reassignment natively.</div>`
            : ""
        }
        <div class="tag-manager__split-grid">
          ${renderPreviewTagCard("Source Tag", sourceRecord, {
            showSearch: true,
            searchOptions: mergeOptions,
            searchValue: state.mergeQuery,
            selectedId: state.mergeSourceId,
            searchActionName: "merge",
            emptyTitle: "No source selected",
            emptyText: "Search for a source tag to preview it here before merging.",
          })}
          ${renderPreviewTagCard("Destination Tag", destinationRecord, {
            idLabel: destinationRecord ? `ID ${destinationRecord.id}` : "",
          })}
          ${renderReadonlyAliasesCard("Source Aliases", sourceRecord?.aliases || [])}
          ${renderReadonlyAliasesCard("Destination Aliases", destinationRecord?.aliases || [])}
        </div>
      </div>
    `;
  }

  function renderUtilityFilters() {
    const filters = [
      { id: "all", label: "All" },
      { id: "no-parent", label: "No Parent" },
      { id: "no-image", label: "No Image" },
      { id: "no-sort-name", label: "No Sort Name" },
      { id: "multiple-parents", label: "Multi Parent" },
    ];
    return `
      <div class="tag-manager__filter-row">
        ${filters
          .map(
            (filter) => `
          <button
            type="button"
            class="tag-manager__filter-chip ${state.utilityFilter === filter.id ? "is-active" : ""}"
            data-action="set-utility-filter"
            data-filter-id="${escapeHtml(filter.id)}"
            >${escapeHtml(filter.label)}</button>
        `
          )
          .join("")}
        <button type="button" class="tag-manager__filter-chip tag-manager__filter-chip--new" data-action="start-new-tag">New Tag</button>
      </div>
    `;
  }

  function getTagPickerOptions(query, excludeIds = []) {
    const q = String(query || "").trim().toLowerCase();
    const excluded = new Set((excludeIds || []).map(String));
    return Array.from(state.tagMap.values())
      .filter((record) => !excluded.has(String(record.id)))
      .filter((record) => {
        if (!q) return true;
        return (
          String(record.name || "").toLowerCase().includes(q) ||
          String(record.sort_name || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        String(a.sort_key || a.name || "").localeCompare(String(b.sort_key || b.name || ""), undefined, {
          sensitivity: "base",
        })
      )
      .slice(0, 40);
  }

  function createDraftFromRecord(record) {
    return record
      ? {
          id: record.id,
          name: record.name || "",
          aliases: normalizeAliasList(record.aliases || []),
          sort_name: record.sort_name || "",
          description: record.description || "",
          image_path: record.image_path || "",
          supplemental_image_1_id: normalizeSupplementalImageId(record.supplemental_image_1_id),
          supplemental_image_2_id: normalizeSupplementalImageId(record.supplemental_image_2_id),
        }
      : null;
  }

  function createBlankDraft() {
    return {
      id: null,
      name: "",
      aliases: [],
      sort_name: "",
      description: "",
      image_path: "",
      supplemental_image_1_id: "",
      supplemental_image_2_id: "",
    };
  }

  function getDraftImageByTarget(target = "main") {
    if (target === "split-new") return String(state.splitNewDraft?.image_path || "");
    if (target === "split-original") return String(state.splitOriginalDraft?.image_path || "");
    return String(state.draft?.image_path || "");
  }

  function setDraftImageByTarget(target = "main", value = "") {
    if (target === "split-new" && state.splitNewDraft) {
      state.splitNewDraft.image_path = String(value || "");
      return;
    }
    if (target === "split-original" && state.splitOriginalDraft) {
      state.splitOriginalDraft.image_path = String(value || "");
      return;
    }
    if (state.draft) {
      state.draft.image_path = String(value || "");
    }
  }

  function getSplitOccupiedIdentityMap(excludeOriginalId = state.selectedTagId) {
    const occupied = new Map();
    state.tagMap.forEach((record) => {
      if (String(record.id) === String(excludeOriginalId || "")) return;
      const terms = [String(record.name || "").trim(), ...normalizeAliasList(record.aliases || [])];
      terms.forEach((term) => {
        const normalized = String(term || "").trim().toLowerCase();
        if (!normalized || occupied.has(normalized)) return;
        occupied.set(normalized, record.name || record.id);
      });
    });
    return occupied;
  }

  function getSplitValidationMessage() {
    if (!state.splitMode) return "";
    const original = state.splitOriginalDraft;
    const nextDraft = state.splitNewDraft;
    if (!original || !nextDraft) return "Split mode is not ready.";

    const originalName = String(original.name || "").trim();
    const nextName = String(nextDraft.name || "").trim();
    if (!originalName) return "Original tag name is required.";
    if (!nextName) return "New tag name is required.";

    const occupied = getSplitOccupiedIdentityMap(state.selectedTagId);
    const seen = new Map();
    const entries = [
      { side: "original", type: "name", value: originalName },
      { side: "new", type: "name", value: nextName },
      ...normalizeAliasList(original.aliases || []).map((value) => ({ side: "original", type: "alias", value })),
      ...normalizeAliasList(nextDraft.aliases || []).map((value) => ({ side: "new", type: "alias", value })),
    ];

    for (const entry of entries) {
      const normalized = String(entry.value || "").trim().toLowerCase();
      if (!normalized) continue;
      if (seen.has(normalized)) {
        return "Split names and aliases must all be unique.";
      }
      seen.set(normalized, entry);
      if (occupied.has(normalized)) {
        return `“${entry.value}” already exists on another tag or alias.`;
      }
    }

    return "";
  }

  function getSplitAliasAddReason(side) {
    if (!state.splitMode) return "Split mode is not active.";
    const targetSide = side === "new" ? "new" : "original";
    const inputValue = String(
      targetSide === "new" ? state.splitNewAliasInput : state.splitOriginalAliasInput
    ).trim();
    if (!inputValue) return "Enter an alias.";

    const original = state.splitOriginalDraft || createBlankDraft();
    const nextDraft = state.splitNewDraft || createBlankDraft();
    const currentName = String(
      targetSide === "new" ? nextDraft.name || "" : original.name || ""
    ).trim();
    if (inputValue.toLowerCase() === currentName.toLowerCase()) {
      return "Alias cannot match the tag name.";
    }

    const occupied = getSplitOccupiedIdentityMap(state.selectedTagId);
    const compareTerms = [
      String(original.name || "").trim(),
      String(nextDraft.name || "").trim(),
      ...normalizeAliasList(original.aliases || []),
      ...normalizeAliasList(nextDraft.aliases || []),
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    if (compareTerms.includes(inputValue.toLowerCase())) {
      return "Alias already exists in this split.";
    }
    if (occupied.has(inputValue.toLowerCase())) {
      return "Alias already exists on another tag.";
    }
    return "";
  }

  function renderSplitAliasList(side, aliases) {
    const targetSide = side === "new" ? "new" : "original";
    const moveAction = targetSide === "new" ? "move-split-alias-to-original" : "move-split-alias-to-new";
    const moveLabel = targetSide === "new" ? "Move to original tag" : "Move to new tag";
    if (!aliases.length) {
      return `<span class="tag-manager__meta-empty">No aliases</span>`;
    }
    return aliases
      .map(
        (alias, index) => `<div class="tag-manager__split-alias-row">
          <span class="tag-manager__split-alias-text">${escapeHtml(alias)}</span>
          <div class="tag-manager__split-alias-actions">
            <button type="button" class="btn btn-secondary tag-manager__split-alias-button" data-action="${moveAction}" data-alias-index="${index}" ${
              state.isSaving ? "disabled" : ""
            }>${targetSide === "new" ? "&larr;" : "&rarr;"}</button>
            <button type="button" class="btn btn-secondary tag-manager__split-alias-button" data-action="remove-split-alias" data-split-side="${escapeHtml(
              targetSide
            )}" data-alias-index="${index}" ${state.isSaving ? "disabled" : ""}>Remove</button>
          </div>
        </div>`
      )
      .join("");
  }

  function renderSplitAliasesCard(side, draft) {
    const targetSide = side === "new" ? "new" : "original";
    const aliases = normalizeAliasList(draft?.aliases || []);
    const aliasInput = targetSide === "new" ? state.splitNewAliasInput : state.splitOriginalAliasInput;
    const addReason = getSplitAliasAddReason(targetSide);
    return `
      <div class="tag-manager__meta-card tag-manager__split-meta-card">
        <div class="tag-manager__meta-header">
          <div class="tag-manager__meta-label">Aliases</div>
          <div class="tag-manager__meta-value">${formatCount(aliases.length)}</div>
        </div>
        <div class="tag-manager__alias-editor">
          <div class="tag-manager__alias-input-row">
            <input class="tag-manager__input" type="text" data-field="split-${targetSide}-alias-input" value="${escapeHtml(
              aliasInput
            )}" placeholder="Add an alias" ${state.isSaving ? "disabled" : ""} />
            <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="add-split-alias" data-split-side="${escapeHtml(
              targetSide
            )}" ${!addReason && !state.isSaving ? "" : "disabled"}>Add Alias</button>
          </div>
          ${aliasInput && addReason ? `<div class="tag-manager__field-note">${escapeHtml(addReason)}</div>` : ""}
          <div class="tag-manager__alias-panel-scroll">
            <div class="tag-manager__split-alias-list">
              ${renderSplitAliasList(targetSide, aliases)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderAttachPicker(query, selectedId, options, actionName) {
    const selected = selectedId ? state.tagMap.get(String(selectedId)) : null;
    const showResults =
      String(query || "").trim() &&
      (!selected || String(selected.name || "").toLowerCase() !== String(query || "").trim().toLowerCase());

    return `
      ${
        selected
          ? `<div class="tag-manager__attach-picked">
              <span class="tag-manager__attach-picked-label">Selected</span>
              <button type="button" class="tag-manager__chip" data-action="select-tag" data-tag-id="${escapeHtml(
                selected.id
              )}">${escapeHtml(selected.name)}</button>
              <button type="button" class="tag-manager__attach-clear" data-action="clear-picked-target" data-target-slot="${escapeHtml(
                actionName
              )}">Clear</button>
            </div>`
          : ""
      }
      ${
        showResults
          ? `<div class="tag-manager__attach-results">
              ${options
                .map((record) => {
                  const parentPaths = getParentPaths(record.id, state.tagMap);
                  const breadcrumb = parentPaths.length
                    ? parentPaths[0]
                        .map((id) => state.tagMap.get(String(id))?.name || "")
                        .filter(Boolean)
                        .join(" > ")
                    : "Root";
                  return `<button type="button" class="tag-manager__attach-result" data-action="pick-target-tag" data-target-slot="${escapeHtml(
                    actionName
                  )}" data-tag-id="${escapeHtml(record.id)}">
                    <span class="tag-manager__attach-result-name">${escapeHtml(record.name)}</span>
                    <span class="tag-manager__attach-result-meta">${escapeHtml(breadcrumb)}</span>
                  </button>`;
                })
                .join("")}
            </div>`
          : ""
      }
    `;
  }

  function renderAttachPickerMulti(query, selectedIds, options, actionName) {
    const selectedRecords = (selectedIds || [])
      .map((id) => state.tagMap.get(String(id)))
      .filter(Boolean);
    const selectedLower = new Set(
      selectedRecords.map((record) => String(record.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const showResults =
      String(query || "").trim() && !selectedLower.has(String(query || "").trim().toLowerCase());

    return `
      ${
        selectedRecords.length
          ? `<div class="tag-manager__attach-picked">
              <span class="tag-manager__attach-picked-label">Selected ${formatCount(selectedRecords.length)}</span>
              ${selectedRecords
                .map(
                  (record) => `<button type="button" class="tag-manager__chip" data-action="select-tag" data-tag-id="${escapeHtml(
                    record.id
                  )}">${escapeHtml(record.name)}</button>
                  <button type="button" class="tag-manager__attach-clear" data-action="clear-picked-target" data-target-slot="${escapeHtml(
                    actionName
                  )}" data-tag-id="${escapeHtml(record.id)}">Remove</button>`
                )
                .join("")}
              <button type="button" class="tag-manager__attach-clear" data-action="clear-picked-target" data-target-slot="${escapeHtml(
                actionName
              )}">Clear All</button>
            </div>`
          : ""
      }
      ${
        showResults
          ? `<div class="tag-manager__attach-results">
              ${options
                .map((record) => {
                  const parentPaths = getParentPaths(record.id, state.tagMap);
                  const breadcrumb = parentPaths.length
                    ? parentPaths[0]
                        .map((id) => state.tagMap.get(String(id))?.name || "")
                        .filter(Boolean)
                        .join(" > ")
                    : "Root";
                  return `<button type="button" class="tag-manager__attach-result" data-action="pick-target-tag" data-target-slot="${escapeHtml(
                    actionName
                  )}" data-tag-id="${escapeHtml(record.id)}">
                    <span class="tag-manager__attach-result-name">${escapeHtml(record.name)}</span>
                    <span class="tag-manager__attach-result-meta">${escapeHtml(breadcrumb)}</span>
                  </button>`;
                })
                .join("")}
            </div>`
          : ""
      }
    `;
  }

  function renderTreeDragHandle(tagId, label) {
    const icon =
      renderFontAwesomeIconMarkup("faGripLinesVertical", {
        className: "tag-manager__drag-icon",
        title: `Drag ${label || "tag"}`,
      }) || '<span class="tag-manager__drag-fallback">::</span>';
    return `
      <button
        type="button"
        class="tag-manager__drag-handle ${state.isSaving ? "is-disabled" : ""}"
        data-action="drag-handle"
        data-drag-tag-id="${escapeHtml(tagId)}"
        draggable="${state.isSaving ? "false" : "true"}"
        aria-label="Drag ${escapeHtml(label || "tag")}"
        title="Drag to move"
        ${state.isSaving ? "disabled" : ""}
      >${icon}</button>
    `;
  }

  function getTreeRowDropAttributes(tagId) {
    const id = String(tagId || "");
    if (!id) return `data-tree-row-id=""`;
    const canDropHere = canTagHaveChildren(id);
    return `${canDropHere ? `data-drop-tag-id="${escapeHtml(id)}"` : ""} data-tree-row-id="${escapeHtml(id)}"`;
  }
  function renderTreeLeaf(node, extraClass = "") {
    const selected = state.selectedTagId === String(node.id);
    const batchSelected = (state.batchSelectedTagIds || []).map(String).includes(String(node.id));
    return `
      <div class="tag-manager__tree-item ${selected ? "is-selected" : ""} ${batchSelected ? "is-batch-selected" : ""} ${extraClass}" ${getTreeRowDropAttributes(
        node.id
      )} data-action="select-tag" data-tag-id="${escapeHtml(node.id)}" role="button" tabindex="0">
        <div class="tag-manager__row-left">
          <span class="tag-manager__indent"></span>
          <span class="tag-manager__tree-item-main">
            <span class="tag-manager__tree-item-name">${escapeHtml(node.name)}</span>
          </span>
        </div>
        <div class="tag-manager__row-actions ${batchSelected ? "is-batch-selected" : ""}">
          ${renderBatchToggle(node.id, node.name || "tag")}
          ${renderTreeDragHandle(node.id, node.name || "tag")}
        </div>
      </div>
    `;
  }

  function renderTreeSubgroup(node) {
    const expanded = state.expandedIds.has(String(node.id));
    const selected = state.selectedTagId === String(node.id);
    return `
      <div class="tag-manager__subgroup ${expanded ? "is-expanded" : ""}" data-tag-id="${escapeHtml(node.id)}">
        <div class="tag-manager__subgroup-header ${selected ? "is-selected" : ""}" ${getTreeRowDropAttributes(
          node.id
        )} data-action="select-toggle-group" data-tag-id="${escapeHtml(node.id)}" role="button" tabindex="0">
          <div class="tag-manager__row-left">
            <button type="button" class="tag-manager__tree-toggle" data-action="toggle-expanded" data-tag-id="${escapeHtml(
              node.id
            )}" aria-label="${expanded ? "Collapse subgroup" : "Expand subgroup"}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "&#9662;" : "&#9656;"}</button>
            <span class="tag-manager__subgroup-main">
              <span class="tag-manager__tree-item-name">${escapeHtml(node.name || "")}</span>
            </span>
          </div>
          <div class="tag-manager__row-actions">
            ${renderTreeDragHandle(node.id, node.name || "tag")}
          </div>
        </div>
        ${
          expanded
            ? `<div class="tag-manager__subgroup-children">${node.children
                .map((child) => renderTreeLeaf(child, "tag-manager__tree-item--nested"))
                .join("")}</div>`
            : ""
        }
      </div>
    `;
  }

  function renderTreeGroup(group) {
    const groupId = String(group.parent.id);
    const expanded = state.expandedIds.has(groupId);
    const selected = state.selectedTagId === groupId;
    return `
      <div class="tag-manager__group ${expanded ? "is-expanded" : ""}" data-tag-id="${escapeHtml(groupId)}">
        <div class="tag-manager__group-header ${selected ? "is-selected" : ""}" ${getTreeRowDropAttributes(
          groupId
        )} data-action="select-toggle-group" data-tag-id="${escapeHtml(groupId)}" role="button" tabindex="0">
          <div class="tag-manager__row-left">
            <button type="button" class="tag-manager__tree-toggle" data-action="toggle-expanded" data-tag-id="${escapeHtml(
              groupId
            )}" aria-label="${expanded ? "Collapse group" : "Expand group"}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "&#9662;" : "&#9656;"}</button>
            <span class="tag-manager__group-main">
              <span class="tag-manager__tree-item-name">${escapeHtml(group.parent.name || "")}</span>
            </span>
          </div>
          <div class="tag-manager__row-actions">
            ${renderTreeDragHandle(groupId, group.parent.name || "tag")}
          </div>
        </div>
        ${
          expanded
            ? `<div class="tag-manager__group-body">${group.items
                .map((item) =>
                  item.type === "subgroup" ? renderTreeSubgroup(item) : renderTreeLeaf(item)
                )
                .join("")}</div>`
            : ""
        }
      </div>
    `;
  }

  function renderRootSection(groups, leaves) {
    const groupList = Array.isArray(groups) ? groups : [];
    const leafList = Array.isArray(leaves) ? leaves : [];
    const hasItems = groupList.length > 0 || leafList.length > 0;
    return `
      <div class="tag-manager__root-section">
        <div class="tag-manager__root-header" data-drop-root="true" data-tree-row-id="${ROOT_DROP_ID}">
          <div class="tag-manager__row-left">
            <span class="tag-manager__root-badge">ROOT</span>
            <span class="tag-manager__root-title">Unparented Tags</span>
          </div>
          <div class="tag-manager__root-meta">Drop here to remove all parents</div>
        </div>
        <div class="tag-manager__root-body">
          ${
            hasItems
              ? `${groupList.map((group) => renderTreeGroup(group)).join("")}${leafList
                  .map((leaf) => renderTreeLeaf(leaf))
                  .join("")}`
              : `<div class="tag-manager__root-empty">No unparented tags</div>`
          }
        </div>
      </div>
    `;
  }

  function renderTree() {
    const filtered = getFilteredHierarchy();
    if (!state.groups.length && !state.ungroupedLeaves.length) {
      return `<div class="tag-manager__empty">No tags available.</div>`;
    }
    if (!filtered.groups.length && !filtered.ungroupedLeaves.length) {
      return `<div class="tag-manager__empty">No tags match this filter.</div>`;
    }
    return `
      ${renderRootSection(filtered.groups, filtered.ungroupedLeaves)}
    `;
  }

  function renderSearchResults() {
    const results = getSearchResults();
    if (!state.searchText.trim()) return "";
    if (!results.length) {
      return `<div class="tag-manager__empty">No matching tags.</div>`;
    }
    return `
      <div class="tag-manager__search-results">
        ${results
          .map(
            (item) => `
          <button type="button" class="tag-manager__search-result" data-action="pick-search-result" data-tag-id="${escapeHtml(
            item.id
          )}" data-ancestor-ids="${escapeHtml(getPrimaryAncestorPath(item.id, state.tagMap).join(","))}">
            <span class="tag-manager__search-name">${escapeHtml(item.name)}</span>
            <span class="tag-manager__search-meta">${escapeHtml(item.breadcrumb || "Root tag")}</span>
          </button>
        `
          )
          .join("")}
      </div>
    `;
  }

  function isNewDraftMode() {
    return !!state.draft && !state.selectedTagId;
  }

  function getBatchReparentBlockReason(targetTagId, sourceIds = state.batchSelectedTagIds, tagMap = state.tagMap) {
    const selectedIds = (sourceIds || []).map(String).filter(Boolean);
    if (!selectedIds.length) return "Select one or more tags first.";
    const records = selectedIds.map((id) => tagMap.get(id)).filter(Boolean);
    if (records.length !== selectedIds.length) return "Selected tag could not be found.";
    if (records.some((record) => (record.childIds || []).length)) {
      return "Only tags without child tags can be batch reparented.";
    }
    const typeSet = new Set(records.map((record) => getBatchSelectionType(record, tagMap)).filter(Boolean));
    if (typeSet.size > 1) {
      return "Batch selection requires tags from the same hierarchy level.";
    }
    if (!String(targetTagId || "").trim()) return "";
    return selectedIds.map((id) => getParentRelationshipBlockReason(id, targetTagId, "reparent", tagMap)).find(Boolean) || "";
  }

  function renderBatchInspector() {
    const selectedIds = (state.batchSelectedTagIds || []).map(String).filter((id) => state.tagMap.has(String(id)));
    const selectedRecords = selectedIds.map((id) => state.tagMap.get(String(id))).filter(Boolean);
    const batchOptions = getTagPickerOptions(state.batchReparentQuery, selectedIds);
    const batchReason = state.batchReparentTargetId
      ? getBatchReparentBlockReason(state.batchReparentTargetId, selectedIds)
      : "";
    const targetRecord = state.batchReparentTargetId
      ? state.tagMap.get(String(state.batchReparentTargetId))
      : null;
    const status =
      state.status.text &&
      `<div class="tag-manager__status tag-manager__status--${escapeHtml(
        state.status.type || "info"
      )}">${escapeHtml(state.status.text)}</div>`;

    return `
      ${status || ""}
      <div class="tag-manager__batch-card">
        <div class="tag-manager__batch-card-header">
          <div>
            <h3 class="tag-manager__inspector-title">${formatCount(selectedRecords.length)} tags selected</h3>
            <p class="tag-manager__helper">Batch reparent is limited to tags without child tags. All selected tags will move under the same parent.</p>
          </div>
          <button type="button" class="btn btn-secondary" data-action="clear-batch-selection" ${
            state.isSaving ? "disabled" : ""
          }>Clear Selection</button>
        </div>
        <div class="tag-manager__meta-card">
          <div class="tag-manager__meta-header">
            <div class="tag-manager__meta-label">Selected Tags</div>
            <div class="tag-manager__meta-value">${escapeHtml(getBatchSelectionSummaryLabel(selectedIds))}</div>
          </div>
          <div class="tag-manager__attach-picked">
            <span class="tag-manager__attach-picked-label">Queued ${formatCount(selectedRecords.length)}</span>
            ${selectedRecords
              .map(
                (record) => `<button type="button" class="tag-manager__chip" data-action="select-tag" data-tag-id="${escapeHtml(
                  record.id
                )}">${escapeHtml(record.name)}</button>
                <button type="button" class="tag-manager__attach-clear" data-action="remove-batch-selected-tag" data-tag-id="${escapeHtml(
                  record.id
                )}">Remove</button>`
              )
              .join("")}
          </div>
        </div>
        <div class="tag-manager__editor-card">
          <div class="tag-manager__section-title">Reparent Selected Tags</div>
          <div class="tag-manager__field-group">
            <label class="tag-manager__field-label" for="tag-manager-batch-reparent-query">New Parent Tag</label>
            <input id="tag-manager-batch-reparent-query" class="tag-manager__input" type="search" data-field="batch-reparent-query" value="${escapeHtml(
              state.batchReparentQuery
            )}" placeholder="Search for the new parent tag" ${state.isSaving ? "disabled" : ""} />
            ${renderAttachPicker(state.batchReparentQuery, state.batchReparentTargetId, batchOptions, "batch-reparent")}
            ${
              targetRecord && !batchReason
                ? `<div class="tag-manager__field-note">Selected parent: ${escapeHtml(targetRecord.name)}</div>`
                : batchReason
                ? `<div class="tag-manager__field-note">${escapeHtml(batchReason)}</div>`
                : ""
            }
            <button type="button" class="btn btn-primary tag-manager__action-button" data-action="reparent-selected-tags" ${
              selectedRecords.length && state.batchReparentTargetId && !batchReason && !state.isSaving ? "" : "disabled"
            }>Reparent Selected Tags</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSplitEditorColumn(side, title, draft, options = {}) {
    const targetSide = side === "new" ? "new" : "original";
    const canEditImage = !!options.canEditImage;
    const previewImagePath = String(draft?.image_path || "").trim();
    return `
      <div class="tag-manager__editor-card tag-manager__split-card">
        <div class="tag-manager__meta-header">
          <div class="tag-manager__section-title">${escapeHtml(title)}</div>
          ${
            targetSide === "original" && state.selectedTagId
              ? `<span class="tag-manager__id-chip">ID ${escapeHtml(state.selectedTagId)}</span>`
              : targetSide === "new"
              ? `<span class="tag-manager__id-chip">New Root Tag</span>`
              : ""
          }
        </div>
        ${
          previewImagePath
            ? `<div class="tag-manager__image-preview">
                <img src="${escapeHtml(previewImagePath)}" alt="${escapeHtml(draft?.name || title)}" />
              </div>`
            : canEditImage
            ? `<div class="tag-manager__split-image-empty">No image selected</div>`
            : ""
        }
        ${
          canEditImage
            ? `<input class="tag-manager__file-input" id="tag-manager-image-file-${escapeHtml(targetSide)}" type="file" accept="image/*" data-field="image-file" data-image-target="split-${escapeHtml(
                targetSide
              )}" />
              <div class="tag-manager__button-row">
                <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="toggle-image-picker" data-image-target="split-${escapeHtml(
                  targetSide
                )}" ${state.isSaving ? "disabled" : ""}>Set Image</button>
                <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="clear-image" data-image-target="split-${escapeHtml(
                  targetSide
                )}" ${previewImagePath && !state.isSaving ? "" : "disabled"}>Clear Image</button>
              </div>
              ${renderImagePicker(`split-${targetSide}`)}`
            : `<div class="tag-manager__field-note">Original tag keeps its current image.</div>`
        }
        <div class="tag-manager__field-grid">
          <div class="tag-manager__field-group">
            <label class="tag-manager__field-label" for="tag-manager-split-${escapeHtml(targetSide)}-name">Name</label>
            <input id="tag-manager-split-${escapeHtml(targetSide)}-name" class="tag-manager__input" type="text" data-field="split-${escapeHtml(
              targetSide
            )}-name" value="${escapeHtml(draft?.name || "")}" ${state.isSaving ? "disabled" : ""} />
          </div>
          <div class="tag-manager__field-group">
            <label class="tag-manager__field-label" for="tag-manager-split-${escapeHtml(targetSide)}-sort-name">Sort Name</label>
            <input id="tag-manager-split-${escapeHtml(targetSide)}-sort-name" class="tag-manager__input" type="text" data-field="split-${escapeHtml(
              targetSide
            )}-sort_name" value="${escapeHtml(draft?.sort_name || "")}" placeholder="Falls back to name when empty" ${
              state.isSaving ? "disabled" : ""
            } />
          </div>
        </div>
        <div class="tag-manager__field-group">
          <label class="tag-manager__field-label" for="tag-manager-split-${escapeHtml(targetSide)}-description">Description</label>
          <textarea id="tag-manager-split-${escapeHtml(targetSide)}-description" class="tag-manager__textarea" data-field="split-${escapeHtml(
            targetSide
          )}-description" rows="6" ${state.isSaving ? "disabled" : ""}>${escapeHtml(draft?.description || "")}</textarea>
        </div>
      </div>
    `;
  }

  function renderSplitInspector() {
    const originalDraft = state.splitOriginalDraft;
    const newDraft = state.splitNewDraft;
    const splitMessage = getSplitValidationMessage();
    const status =
      state.status.text &&
      `<div class="tag-manager__status tag-manager__status--${escapeHtml(
        state.status.type || "info"
      )}">${escapeHtml(state.status.text)}</div>`;
    if (!originalDraft || !newDraft) {
      return `
        ${status || ""}
        <div class="tag-manager__empty-state">
          <h3 class="tag-manager__inspector-title">Split Tag</h3>
          <p class="tag-manager__helper">Split mode is not ready.</p>
        </div>
      `;
    }
    return `
      ${status || ""}
      <div class="tag-manager__split-workspace">
        <div class="tag-manager__split-header">
          <div>
            <h3 class="tag-manager__inspector-title">Split Tag</h3>
            <p class="tag-manager__helper">Create a new root tag from this existing one. Aliases can be redistributed between both sides before saving.</p>
          </div>
          <div class="tag-manager__button-row">
            <button type="button" class="btn btn-primary tag-manager__action-button" data-action="confirm-split-tag" ${
              !splitMessage && !state.isSaving ? "" : "disabled"
            }>Create Split Tag</button>
            <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="cancel-split-tag" ${
              state.isSaving ? "disabled" : ""
            }>Cancel Split</button>
          </div>
        </div>
        ${splitMessage ? `<div class="tag-manager__field-note">${escapeHtml(splitMessage)}</div>` : ""}
        <div class="tag-manager__split-grid">
          ${renderSplitEditorColumn("original", "Original Tag", originalDraft, { canEditImage: false })}
          ${renderSplitEditorColumn("new", "New Split Tag", newDraft, { canEditImage: true })}
          ${renderSplitAliasesCard("original", originalDraft)}
          ${renderSplitAliasesCard("new", newDraft)}
        </div>
      </div>
    `;
  }

  function isDraftDirty() {
    if (isNewDraftMode()) {
      return (
        !!String(state.draft?.name || "").trim() ||
        !!normalizeAliasList(state.draft?.aliases || []).length ||
        !!String(state.draft?.sort_name || "").trim() ||
        !!String(state.draft?.description || "").trim() ||
        !!String(state.draft?.image_path || "").trim() ||
        !!normalizeSupplementalImageId(state.draft?.supplemental_image_1_id) ||
        !!normalizeSupplementalImageId(state.draft?.supplemental_image_2_id)
      );
    }
    if (!state.draft?.id || !state.selectedTagId) return false;
    const record = state.tagMap.get(state.selectedTagId);
    if (!record) return false;
    return (
      String(state.draft.name || "") !== String(record.name || "") ||
      normalizeAliasList(state.draft.aliases || []).join("\n") !==
        normalizeAliasList(record.aliases || []).join("\n") ||
      String(state.draft.sort_name || "") !== String(record.sort_name || "") ||
      String(state.draft.description || "") !== String(record.description || "") ||
      String(state.draft.image_path || "") !== String(record.image_path || "") ||
      normalizeSupplementalImageId(state.draft.supplemental_image_1_id) !==
        normalizeSupplementalImageId(record.supplemental_image_1_id) ||
      normalizeSupplementalImageId(state.draft.supplemental_image_2_id) !==
        normalizeSupplementalImageId(record.supplemental_image_2_id)
    );
  }

  function renderInspector() {
    if (hasBatchSelection()) {
      return renderBatchInspector();
    }
    if (state.splitMode) {
      return renderSplitInspector();
    }

    const record = state.selectedTagId ? state.tagMap.get(state.selectedTagId) : null;
    if (state.mergePanelOpen && (record || state.mergeDestinationId)) {
      return renderMergeInspector();
    }
    const creatingNew = isNewDraftMode();
    const dirty = isDraftDirty();
    const childCount = Number(record?.childIds?.length || 0);
    const childActionsAllowed = record ? canTagHaveChildren(record.id) : false;
    const createParentAllowed = record ? canTagGainInsertedParent(record.id) : false;
    const addParentAllowed = createParentAllowed;
    const reparentActionsAllowed = !!record;
    const siblingActionsAllowed = record ? canTagHaveSiblings(record.id) : false;
    const reparentOptions = getTagPickerOptions(state.reparentQuery, [record?.id]);
    const attachChildOptions = getTagPickerOptions(state.attachChildQuery, [
      record?.id,
      ...(state.attachChildTargetIds || []),
    ]);
    const attachSiblingOptions = getTagPickerOptions(state.attachSiblingQuery, [record?.id]);
    const parentDisabledMessage = "Current tag already occupies a full 3-level hierarchy.";
    const childDisabledMessage = "Current tag is already under 2 tag groups.";
    const siblingDisabledMessage = "Only available for subgroup and leaf tags under an existing parent group.";
    const reparentReason =
      reparentActionsAllowed && record && state.reparentTargetId
        ? getParentRelationshipBlockReason(record.id, state.reparentTargetId, "reparent")
        : "";
    const addParentReason =
      addParentAllowed && record && state.reparentTargetId
        ? getParentRelationshipBlockReason(record.id, state.reparentTargetId, "add-parent")
        : "";
    const attachChildReasons =
      childActionsAllowed && record
        ? state.attachChildTargetIds
            .map((targetId) => getAttachChildBlockReason(record.id, targetId))
            .filter(Boolean)
        : [];
    const attachChildReason = attachChildReasons[0] || "";
    const attachSiblingReason =
      siblingActionsAllowed && record && state.attachSiblingTargetId
        ? getAttachSiblingBlockReason(record.id, state.attachSiblingTargetId)
        : "";
    const previewImagePath = String(state.draft?.image_path || "").trim();
    const status =
      state.status.text &&
      `<div class="tag-manager__status tag-manager__status--${escapeHtml(
        state.status.type || "info"
      )}">${escapeHtml(state.status.text)}</div>`;

    if (!state.draft) {
      return `
        <div class="tag-manager__empty-state">
          <h3 class="tag-manager__inspector-title">Select a tag</h3>
          <p class="tag-manager__helper">Pick any tag from the hierarchy to edit it or create parent, child, and sibling tags around it.</p>
          ${status || ""}
        </div>
      `;
    }

    return `
      ${status || ""}
      <div class="tag-manager__inspector-grid">
        <div class="tag-manager__inspector-main">
          <div class="tag-manager__editor-card tag-manager__editor-card--primary">
            <div class="tag-manager__image-preview-grid">
              ${renderSupplementalImageField(SUPPLEMENTAL_IMAGE_FIELDS[0], state.draft)}
              <div class="tag-manager__image-preview tag-manager__image-preview--main">
                ${
                  previewImagePath
                    ? `<img src="${escapeHtml(previewImagePath)}" alt="${escapeHtml(
                        state.draft.name || "Tag preview"
                      )}" />`
                    : `<div class="tag-manager__supplemental-empty tag-manager__supplemental-empty--main">No main tag image</div>`
                }
              </div>
              ${renderSupplementalImageField(SUPPLEMENTAL_IMAGE_FIELDS[1], state.draft)}
            </div>
            <input class="tag-manager__file-input" id="tag-manager-image-file" type="file" accept="image/*" data-field="image-file" />
            <div class="tag-manager__field-grid">
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-name">Name</label>
                <input id="tag-manager-name" class="tag-manager__input" type="text" data-field="draft-name" value="${escapeHtml(
                  state.draft.name
                )}" />
              </div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-sort-name">Sort Name</label>
                <input id="tag-manager-sort-name" class="tag-manager__input" type="text" data-field="draft-sort_name" value="${escapeHtml(
                  state.draft.sort_name
                )}" placeholder="Falls back to name when empty" />
              </div>
            </div>
            <div class="tag-manager__field-group">
              <label class="tag-manager__field-label" for="tag-manager-description">Description</label>
              <textarea id="tag-manager-description" class="tag-manager__textarea" data-field="draft-description" rows="6">${escapeHtml(
                state.draft.description
              )}</textarea>
            </div>
            <div class="tag-manager__actions">
              <button type="button" class="btn btn-primary" data-action="${creatingNew ? "create-tag" : "save-tag"}" ${
                dirty && (!creatingNew || String(state.draft.name || "").trim()) && !state.isSaving ? "" : "disabled"
              }>${creatingNew ? "Create Tag" : "Save Changes"}</button>
              <button type="button" class="btn btn-secondary" data-action="reset-draft" ${
                dirty ? "" : "disabled"
              }>Reset</button>
              <button type="button" class="btn btn-secondary" data-action="toggle-image-picker" ${
                state.isSaving ? "disabled" : ""
              }>Set Image</button>
              <button type="button" class="btn btn-secondary" data-action="clear-image" ${
                previewImagePath && !state.isSaving ? "" : "disabled"
              }>Clear Image</button>
              ${
                creatingNew
                  ? ""
                  : `<button type="button" class="btn btn-secondary" data-action="start-split-tag" ${
                      state.isSaving || dirty ? "disabled" : ""
                    }>Split Tag</button>`
              }
              ${
                creatingNew
                  ? ""
                  : `<button type="button" class="btn btn-secondary" data-action="remove-all-parents" ${
                      record.parentIds?.length && !state.isSaving ? "" : "disabled"
                    }>Remove All Parents</button>`
              }
              ${
                creatingNew
                  ? ""
                  : `<button type="button" class="btn btn-secondary" data-action="toggle-merge-panel" ${
                      state.isSaving || dirty ? "disabled" : ""
                    }>${state.mergePanelOpen ? "Close Merge" : "Merge Tag"}</button>`
              }
              ${
                creatingNew
                  ? ""
                  : state.pendingDeleteConfirm
                  ? `<button type="button" class="btn btn-danger" data-action="confirm-delete-tag" ${
                      state.isSaving ? "disabled" : ""
                    }>Confirm Delete</button>
                    <button type="button" class="btn btn-secondary" data-action="cancel-delete-tag" ${
                      state.isSaving ? "disabled" : ""
                    }>Cancel</button>`
                  : `<button type="button" class="btn btn-secondary tag-manager__delete-button" data-action="prompt-delete-tag" ${
                      state.isSaving ? "disabled" : ""
                    }>Delete Tag</button>`
              }
              ${creatingNew ? "" : `<span class="tag-manager__id-chip">ID ${escapeHtml(record.id)}</span>`}
            </div>
            ${renderImagePicker()}
            ${
              !creatingNew && state.pendingDeleteConfirm
                ? `<div class="tag-manager__danger-note">
                    <div class="tag-manager__danger-title">Delete confirmation</div>
                    ${renderDeleteSummary(record)}
                  </div>`
                : creatingNew
                ? `<div class="tag-manager__field-note">Create the tag first, then add parent, child, sibling, and merge relationships.</div>`
                : ""
            }
          </div>

          ${
            creatingNew
              ? ""
              : `<div class="tag-manager__editor-split">
            <div class="tag-manager__editor-card">
              <div class="tag-manager__section-title">Create Related Tags</div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-parent-create">New Parent Tag</label>
                <input id="tag-manager-parent-create" class="tag-manager__input" type="text" data-field="parent-create-name" value="${escapeHtml(
                  createParentAllowed ? state.parentCreateName : parentDisabledMessage
                )}" placeholder="${createParentAllowed ? `Create above ${escapeHtml(record.name)}` : ""}" ${
                  createParentAllowed ? "" : "disabled"
                } />
                <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="create-parent" ${
                  createParentAllowed && state.parentCreateName.trim() && !state.isSaving ? "" : "disabled"
                }>Create Parent</button>
              </div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-child-create">New Child Tag</label>
                <input id="tag-manager-child-create" class="tag-manager__input" type="text" data-field="child-create-name" value="${escapeHtml(
                  childActionsAllowed ? state.childCreateName : childDisabledMessage
                )}" placeholder="${childActionsAllowed ? `Create under ${escapeHtml(record.name)}` : ""}" ${
                  childActionsAllowed ? "" : "disabled"
                } />
                <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="create-child" ${
                  childActionsAllowed && state.childCreateName.trim() && !state.isSaving ? "" : "disabled"
                }>Create Child</button>
              </div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-sibling-create">New Sibling Tag</label>
                <input id="tag-manager-sibling-create" class="tag-manager__input" type="text" data-field="sibling-create-name" value="${escapeHtml(
                  siblingActionsAllowed ? state.siblingCreateName : siblingDisabledMessage
                )}" placeholder="${siblingActionsAllowed ? `Create next to ${escapeHtml(record.name)}` : ""}" ${
                  siblingActionsAllowed ? "" : "disabled"
                } />
                <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="create-sibling" ${
                  siblingActionsAllowed && state.siblingCreateName.trim() && !state.isSaving ? "" : "disabled"
                }>Create Sibling</button>
              </div>
            </div>

            <div class="tag-manager__editor-card">
              <div class="tag-manager__section-title">Move / Attach Existing Tags</div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-reparent-query">Reparent Current Tag</label>
                <input id="tag-manager-reparent-query" class="tag-manager__input" type="search" data-field="reparent-query" value="${escapeHtml(
                  reparentActionsAllowed ? state.reparentQuery : parentDisabledMessage
                )}" placeholder="${reparentActionsAllowed ? "Search for the new parent tag" : ""}" ${
                  reparentActionsAllowed ? "" : "disabled"
                } />
                ${reparentActionsAllowed ? renderAttachPicker(state.reparentQuery, state.reparentTargetId, reparentOptions, "reparent") : ""}
                <div class="tag-manager__button-row">
                  <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="reparent-current" ${
                    reparentActionsAllowed && state.reparentTargetId && !reparentReason && !state.isSaving ? "" : "disabled"
                  }>Reparent</button>
                  <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="add-additional-parent" ${
                    addParentAllowed && state.reparentTargetId && !addParentReason && !state.isSaving ? "" : "disabled"
                  }>Add Parent</button>
                </div>
                ${reparentActionsAllowed && (reparentReason || (addParentAllowed && addParentReason)) ? `<div class="tag-manager__field-note">${escapeHtml(reparentReason || addParentReason)}</div>` : ""}
              </div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-attach-child-query">Attach Existing Child</label>
                <input id="tag-manager-attach-child-query" class="tag-manager__input" type="search" data-field="attach-child-query" value="${escapeHtml(
                  childActionsAllowed ? state.attachChildQuery : childDisabledMessage
                )}" placeholder="${childActionsAllowed ? `Search for a tag to attach under ${escapeHtml(record.name)}` : ""}" ${
                  childActionsAllowed ? "" : "disabled"
                } />
                ${childActionsAllowed ? renderAttachPickerMulti(
                  state.attachChildQuery,
                  state.attachChildTargetIds,
                  attachChildOptions,
                  "attach-child"
                ) : ""}
                <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="attach-existing-child" ${
                  childActionsAllowed && state.attachChildTargetIds.length && !attachChildReason && !state.isSaving ? "" : "disabled"
                }>Attach Child</button>
                ${childActionsAllowed && attachChildReason ? `<div class="tag-manager__field-note">${escapeHtml(attachChildReason)}</div>` : ""}
              </div>
              <div class="tag-manager__field-group">
                <label class="tag-manager__field-label" for="tag-manager-attach-sibling-query">Add Existing Sibling</label>
                <input id="tag-manager-attach-sibling-query" class="tag-manager__input" type="search" data-field="attach-sibling-query" value="${escapeHtml(
                  siblingActionsAllowed ? state.attachSiblingQuery : siblingDisabledMessage
                )}" placeholder="${siblingActionsAllowed ? `Search for a tag to share ${escapeHtml(record.name)}'s parents` : ""}" ${
                  siblingActionsAllowed ? "" : "disabled"
                } />
                ${siblingActionsAllowed ? renderAttachPicker(
                  state.attachSiblingQuery,
                  state.attachSiblingTargetId,
                  attachSiblingOptions,
                  "attach-sibling"
                ) : ""}
                <button type="button" class="btn btn-secondary tag-manager__action-button" data-action="attach-existing-sibling" ${
                  siblingActionsAllowed && state.attachSiblingTargetId && !attachSiblingReason && !state.isSaving ? "" : "disabled"
                }>Add Sibling</button>
                ${siblingActionsAllowed && attachSiblingReason ? `<div class="tag-manager__field-note">${escapeHtml(attachSiblingReason)}</div>` : ""}
              </div>
            </div>
          </div>`
          }
        </div>

        <div class="tag-manager__inspector-side ${creatingNew ? "is-creating" : ""}">
          ${
            creatingNew
              ? ""
              : `<div class="tag-manager__meta-card tag-manager__meta-card--usage">
                  ${renderUsageBadges(record)}
                </div>`
          }
          ${renderAliasesPanel()}
          ${
            creatingNew
              ? ""
              : `<div class="tag-manager__meta-card tag-manager__meta-card--parents">
                  <div class="tag-manager__meta-label">Parents</div>
                  <div class="tag-manager__path-list">${renderParentPaths(record)}</div>
                </div>
                <div class="tag-manager__meta-card tag-manager__meta-card--children">
                  <div class="tag-manager__meta-header">
                    <div class="tag-manager__meta-label">Children</div>
                    <div class="tag-manager__meta-value">${formatCount(childCount)}</div>
                  </div>
                  <div class="tag-manager__child-panel-scroll">
                    <div class="tag-manager__child-list tag-manager__child-list--column">${renderChildrenList(record)}</div>
                  </div>
                </div>`
          }
        </div>
      </div>
    `;
  }

  function syncControlStates() {
    const host = getHost();
    if (!host) return;
    const batchReason = state.batchReparentTargetId
      ? getBatchReparentBlockReason(state.batchReparentTargetId)
      : "";
    const splitReason = state.splitMode ? getSplitValidationMessage() : "";
    const selectedRecord = state.selectedTagId ? state.tagMap.get(String(state.selectedTagId)) : null;
    const mergeDestinationRecord = state.mergeDestinationId
      ? state.tagMap.get(String(state.mergeDestinationId))
      : selectedRecord;
    const childActionsAllowed = selectedRecord ? canTagHaveChildren(selectedRecord.id) : false;
    const createParentAllowed = selectedRecord ? canTagGainInsertedParent(selectedRecord.id) : false;
    const addParentAllowed = createParentAllowed;
    const reparentActionsAllowed = !!selectedRecord;
    const siblingActionsAllowed = selectedRecord ? canTagHaveSiblings(selectedRecord.id) : false;
    const mergeReason =
      mergeDestinationRecord && state.mergeSourceId
        ? getMergeBlockReason(mergeDestinationRecord.id, state.mergeSourceId)
        : "";
    const reparentReason =
      reparentActionsAllowed && selectedRecord && state.reparentTargetId
        ? getParentRelationshipBlockReason(selectedRecord.id, state.reparentTargetId, "reparent")
        : "";
    const addParentReason =
      addParentAllowed && selectedRecord && state.reparentTargetId
        ? getParentRelationshipBlockReason(selectedRecord.id, state.reparentTargetId, "add-parent")
        : "";
    const attachChildReasons = selectedRecord
      ? state.attachChildTargetIds
          .map((targetId) => getAttachChildBlockReason(selectedRecord.id, targetId))
          .filter(Boolean)
      : [];
    const attachChildReason = attachChildReasons[0] || "";
    const attachSiblingReason =
      selectedRecord && state.attachSiblingTargetId
        ? getAttachSiblingBlockReason(selectedRecord.id, state.attachSiblingTargetId)
        : "";
    host.querySelectorAll('[data-action="save-tag"]').forEach((button) => {
      button.disabled = !isDraftDirty() || state.isSaving;
    });
    host.querySelectorAll('[data-action="create-tag"]').forEach((button) => {
      button.disabled = !isDraftDirty() || !String(state.draft?.name || "").trim() || state.isSaving;
    });
    host.querySelectorAll('[data-action="reset-draft"]').forEach((button) => {
      button.disabled = !isDraftDirty();
    });
    host.querySelectorAll('[data-action="toggle-image-picker"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="clear-image"]').forEach((button) => {
      const target = String(button.getAttribute("data-image-target") || "main");
      button.disabled = !String(getDraftImageByTarget(target) || "").trim() || state.isSaving;
    });
    host.querySelectorAll('[data-action="remove-all-parents"]').forEach((button) => {
      button.disabled = !(selectedRecord?.parentIds || []).length || state.isSaving;
    });
    host.querySelectorAll('[data-action="apply-image-url"]').forEach((button) => {
      button.disabled = !String(state.imageUrlDraft || "").trim() || state.isSaving;
    });
    host.querySelectorAll('[data-action="open-image-url-picker"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="open-image-file-picker"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="read-image-clipboard"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="close-image-picker"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="cancel-image-url"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="prompt-delete-tag"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="confirm-delete-tag"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="cancel-delete-tag"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="create-parent"]').forEach((button) => {
      button.disabled = !createParentAllowed || !state.parentCreateName.trim() || state.isSaving;
    });
    host.querySelectorAll('[data-action="create-child"]').forEach((button) => {
      button.disabled = !childActionsAllowed || !state.childCreateName.trim() || state.isSaving;
    });
    host.querySelectorAll('[data-action="create-sibling"]').forEach((button) => {
      button.disabled = !siblingActionsAllowed || !state.siblingCreateName.trim() || state.isSaving;
    });
    host.querySelectorAll('[data-action="reparent-current"]').forEach((button) => {
      button.disabled = !reparentActionsAllowed || !state.reparentTargetId || !!reparentReason || state.isSaving;
    });
    host.querySelectorAll('[data-action="add-additional-parent"]').forEach((button) => {
      button.disabled = !addParentAllowed || !state.reparentTargetId || !!addParentReason || state.isSaving;
    });
    host.querySelectorAll('[data-action="attach-existing-child"]').forEach((button) => {
      button.disabled =
        !childActionsAllowed || !state.attachChildTargetIds.length || !!attachChildReason || state.isSaving;
    });
    host.querySelectorAll('[data-action="attach-existing-sibling"]').forEach((button) => {
      button.disabled =
        !siblingActionsAllowed || !state.attachSiblingTargetId || !!attachSiblingReason || state.isSaving;
    });
    host.querySelectorAll('[data-action="toggle-merge-panel"]').forEach((button) => {
      button.disabled = state.isSaving || isDraftDirty();
    });
    host.querySelectorAll('[data-action="flip-merge-direction"]').forEach((button) => {
      button.disabled = !state.mergeSourceId || state.isSaving;
    });
    host.querySelectorAll('[data-action="start-split-tag"]').forEach((button) => {
      button.disabled = state.isSaving || isDraftDirty() || !selectedRecord || hasBatchSelection();
    });
    host.querySelectorAll('[data-action="cancel-split-tag"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="confirm-split-tag"]').forEach((button) => {
      button.disabled = !state.splitMode || !!splitReason || state.isSaving;
    });
    host.querySelectorAll('[data-action="confirm-merge-tag"]').forEach((button) => {
      button.disabled =
        !mergeDestinationRecord || !state.mergeSourceId || !!mergeReason || state.isSaving || isDraftDirty();
    });
    host.querySelectorAll('[data-action="clear-batch-selection"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="reparent-selected-tags"]').forEach((button) => {
      button.disabled =
        !hasBatchSelection() || !state.batchReparentTargetId || !!batchReason || state.isSaving;
    });
    host.querySelectorAll('[data-action="cancel-merge-tag"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="toggle-aliases-expanded"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="add-alias"]').forEach((button) => {
      button.disabled = !!getAliasAddBlockReason() || state.isSaving;
    });
    host.querySelectorAll('[data-action="remove-alias"]').forEach((button) => {
      button.disabled = state.isSaving;
    });
    host.querySelectorAll('[data-action="add-split-alias"]').forEach((button) => {
      const side = String(button.getAttribute("data-split-side") || "original");
      button.disabled = !!getSplitAliasAddReason(side) || state.isSaving;
    });
  }

  function getElementOuterHeight(element) {
    if (!(element instanceof HTMLElement)) return 0;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.height +
      parseFloat(style.marginTop || "0") +
      parseFloat(style.marginBottom || "0")
    );
  }

  function syncMeasuredPanelHeights() {
    const host = getHost();
    if (!host) return;
    const sidebar = host.querySelector(".tag-manager__sidebar");
    const treeWrap = host.querySelector(".tag-manager__tree-wrap");
    const treePanel = host.querySelector(".tag-manager__tree-panel-scroll");
    const inspectorMain = host.querySelector(".tag-manager__inspector-main");
    const inspectorSide = host.querySelector(".tag-manager__inspector-side");
    const usageCard = host.querySelector(".tag-manager__meta-card--usage");
    const parentsCard = host.querySelector(".tag-manager__meta-card--parents");
    const childrenCard = host.querySelector(".tag-manager__meta-card--children");
      const childPanel = host.querySelector(".tag-manager__child-panel-scroll");
      if (
        !(sidebar instanceof HTMLElement) ||
        !(treeWrap instanceof HTMLElement) ||
        !(treePanel instanceof HTMLElement)
      ) {
        return;
      }

    const sidebarGap = parseFloat(window.getComputedStyle(sidebar).gap || "0");
    treeWrap.style.maxHeight = "";
    treePanel.style.maxHeight = "";
    const sidebarChildren = Array.from(sidebar.children).filter((child) => child !== treeWrap);
    const sidebarOtherHeight =
      sidebarChildren.reduce((sum, child) => sum + getElementOuterHeight(child), 0) +
      Math.max(0, sidebarChildren.length) * sidebarGap;
      const fallbackTreeHeight = Math.max(
        240,
        Math.floor(window.innerHeight * 0.7 - sidebarOtherHeight)
      );
      const targetTreeHeight =
        inspectorMain instanceof HTMLElement
          ? Math.max(
              240,
              Math.floor(inspectorMain.getBoundingClientRect().height - sidebarOtherHeight)
            )
          : fallbackTreeHeight;
    treeWrap.style.maxHeight = `${targetTreeHeight}px`;
    const treeWrapStyle = window.getComputedStyle(treeWrap);
    const treeInnerHeight = Math.max(
      160,
      targetTreeHeight -
        parseFloat(treeWrapStyle.paddingTop || "0") -
        parseFloat(treeWrapStyle.paddingBottom || "0")
    );
    treePanel.style.maxHeight = `${treeInnerHeight}px`;

      if (
        !(inspectorMain instanceof HTMLElement) ||
        !(inspectorSide instanceof HTMLElement) ||
        !(usageCard instanceof HTMLElement) ||
        !(parentsCard instanceof HTMLElement) ||
        !(childrenCard instanceof HTMLElement) ||
      !(childPanel instanceof HTMLElement)
    ) {
      return;
    }

    const sideGap = parseFloat(window.getComputedStyle(inspectorSide).gap || "0");
    const childrenStaticHeight = Array.from(childrenCard.children)
      .filter((child) => child !== childPanel)
      .reduce((sum, child) => sum + getElementOuterHeight(child), 0);
    const targetChildrenHeight = Math.max(
      220,
      Math.floor(
        inspectorMain.getBoundingClientRect().height -
          getElementOuterHeight(usageCard) -
          getElementOuterHeight(parentsCard) -
          sideGap * 2 -
          childrenStaticHeight -
          parseFloat(window.getComputedStyle(childrenCard).paddingTop || "0") -
          parseFloat(window.getComputedStyle(childrenCard).paddingBottom || "0")
      )
    );
    childPanel.style.maxHeight = `${targetChildrenHeight}px`;
  }

  function classifyPreviewAspect(width, height) {
    const safeWidth = Number(width) || 0;
    const safeHeight = Number(height) || 0;
    if (!(safeWidth > 0) || !(safeHeight > 0)) return "";
    const ratio = safeWidth / safeHeight;
    if (ratio >= 1.85) return "wide";
    if (ratio >= 1.18) return "landscape";
    if (ratio <= 0.56) return "tall";
    if (ratio <= 0.84) return "portrait";
    return "square";
  }

  function syncEditorImagePreviewLayout() {
    const host = getHost();
    if (!(host instanceof HTMLElement)) return;
    const grids = Array.from(host.querySelectorAll(".tag-manager__image-preview-grid"));
    let didChange = false;

    grids.forEach((grid) => {
      if (!(grid instanceof HTMLElement)) return;
      const mainImage = grid.querySelector(".tag-manager__image-preview--main img");
      const nextMainAspect =
        mainImage instanceof HTMLImageElement && mainImage.complete && mainImage.naturalWidth && mainImage.naturalHeight
          ? classifyPreviewAspect(mainImage.naturalWidth, mainImage.naturalHeight)
          : "";
      if ((grid.dataset.mainAspect || "") !== nextMainAspect) {
        grid.dataset.mainAspect = nextMainAspect;
        didChange = true;
      }

      if (mainImage instanceof HTMLImageElement && !mainImage.complete) {
        mainImage.addEventListener(
          "load",
          () => {
            syncEditorImagePreviewLayout();
          },
          { once: true }
        );
      }

      grid.querySelectorAll(".tag-manager__supplemental-slot").forEach((slot) => {
        if (!(slot instanceof HTMLElement)) return;
        const slotImage = slot.querySelector(".tag-manager__supplemental-preview img");
        const nextSlotAspect =
          slotImage instanceof HTMLImageElement &&
          slotImage.complete &&
          slotImage.naturalWidth &&
          slotImage.naturalHeight
            ? classifyPreviewAspect(slotImage.naturalWidth, slotImage.naturalHeight)
            : "";
        if ((slot.dataset.imageAspect || "") !== nextSlotAspect) {
          slot.dataset.imageAspect = nextSlotAspect;
          didChange = true;
        }
        if (slotImage instanceof HTMLImageElement && !slotImage.complete) {
          slotImage.addEventListener(
            "load",
            () => {
              syncEditorImagePreviewLayout();
            },
            { once: true }
          );
        }
      });
    });

    if (didChange) {
      window.requestAnimationFrame(() => {
        syncMeasuredPanelHeights();
      });
    }
  }

  function render() {
    if (!isManagerRoute()) {
      const host = getHost();
      if (host) host.remove();
      return;
    }

    const root = getPageRoot();
    if (!root) return;

    let host = getHost();
    const previousTree = host?.querySelector(".tag-manager__tree-panel-scroll");
    if (previousTree) {
      state.treeScrollTop = previousTree.scrollTop;
    }
    if (!host) {
      host = document.createElement("section");
      host.id = HOST_ID;
      host.className = "tag-manager";
      host.addEventListener("click", onHostClick);
      host.addEventListener("input", onHostInput);
      host.addEventListener("change", onHostChange);
      host.addEventListener("dragstart", onHostDragStart);
      host.addEventListener("dragover", onHostDragOver);
      host.addEventListener("drop", onHostDrop);
      host.addEventListener("dragend", onHostDragEnd);
    }

    root.innerHTML = "";
    root.appendChild(host);

    const summary = getSummary();
    host.innerHTML = `
      <div class="tag-manager__layout">
        <aside class="tag-manager__sidebar">
          <div class="tag-manager__search">
            <input type="search" class="tag-manager__input" data-field="search-text" placeholder="Search tags, sort names, paths" value="${escapeHtml(
              state.searchText
            )}" />
          </div>
          ${renderUtilityFilters()}
          ${renderSearchResults()}
          <div class="tag-manager__tree-wrap">
            <div class="tag-manager__tree-panel-scroll">${renderTree()}</div>
          </div>
          <div class="tag-manager__summary tag-manager__summary--sidebar">
            <span>${formatCount(summary.total)} tags</span>
            <span>${formatCount(summary.roots)} roots</span>
            <span>${formatCount(summary.noSortName)} missing sort name</span>
          </div>
        </aside>
        <section class="tag-manager__inspector">${renderInspector()}</section>
      </div>
    `;

    syncControlStates();
    syncMeasuredPanelHeights();
    const nextTree = host.querySelector(".tag-manager__tree-panel-scroll");
    if (nextTree) {
      const restoreTreeScroll = () => {
        nextTree.scrollTop = state.treeScrollTop || 0;
      };
      restoreTreeScroll();
      window.requestAnimationFrame(restoreTreeScroll);
      nextTree.addEventListener("scroll", () => {
        state.treeScrollTop = nextTree.scrollTop;
      });
    }
    applyTreeDragIndicators();
    syncEditorImagePreviewLayout();
    syncSupplementalImagePreviews();
  }

  function clearTreeDragIndicators(host = getHost()) {
    if (!(host instanceof HTMLElement)) return;
    host
      .querySelectorAll(
        ".tag-manager__group-header.is-drag-source, .tag-manager__subgroup-header.is-drag-source, .tag-manager__tree-item.is-drag-source, .tag-manager__group-header.is-drop-target, .tag-manager__subgroup-header.is-drop-target, .tag-manager__tree-item.is-drop-target, .tag-manager__root-header.is-drop-target, .tag-manager__group-header.is-drop-invalid, .tag-manager__subgroup-header.is-drop-invalid, .tag-manager__tree-item.is-drop-invalid, .tag-manager__root-header.is-drop-invalid"
      )
      .forEach((element) => {
        element.classList.remove("is-drag-source", "is-drop-target", "is-drop-invalid");
      });
  }

  function findTreeRowElement(tagId, host = getHost()) {
    if (!(host instanceof HTMLElement) || !tagId) return null;
    const safeId =
      window.CSS && typeof window.CSS.escape === "function"
        ? window.CSS.escape(String(tagId))
        : String(tagId).replace(/"/g, '\\"');
    return host.querySelector(`[data-tree-row-id="${safeId}"]`);
  }

  function applyTreeDragIndicators() {
    const host = getHost();
    if (!(host instanceof HTMLElement)) return;
    clearTreeDragIndicators(host);

    if (state.draggingTagId) {
      const sourceRow = findTreeRowElement(state.draggingTagId, host);
      if (sourceRow) sourceRow.classList.add("is-drag-source");
    }

    if (state.dragOverTagId) {
      const targetRow = findTreeRowElement(state.dragOverTagId, host);
      if (targetRow) {
        targetRow.classList.add(
          state.dragOverMode === "invalid" ? "is-drop-invalid" : "is-drop-target"
        );
      }
    }
  }

  function resetTreeDragState() {
    state.draggingTagId = "";
    state.dragOverTagId = "";
    state.dragOverMode = "";
    clearTreeDragIndicators();
  }

  function setTreeDragTarget(tagId, mode) {
    const nextTagId = String(tagId || "");
    const nextMode = nextTagId ? String(mode || "") : "";
    if (state.dragOverTagId === nextTagId && state.dragOverMode === nextMode) return;
    state.dragOverTagId = nextTagId;
    state.dragOverMode = nextMode;
    applyTreeDragIndicators();
  }

  function getDragDropBlockReason(sourceTagId, targetTagId) {
    const sourceId = String(sourceTagId || "");
    const targetId = String(targetTagId || "");
    if (!sourceId || !targetId) return "Select a different tag.";
    if (targetId === ROOT_DROP_ID) {
      const sourceRecord = state.tagMap.get(sourceId);
      if (!sourceRecord) return "Selected tag could not be found.";
      if (!(sourceRecord.parentIds || []).length) return "Current tag already has no parents.";
      return "";
    }
    return getParentRelationshipBlockReason(sourceId, targetId, "reparent");
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image data."));
      reader.readAsDataURL(blob);
    });
  }

  function onHostInput(event) {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
    )
      return;
    const field = target.getAttribute("data-field") || "";

    if (field === "search-text") {
      state.searchText = target.value || "";
      render();
      const nextInput = getHost()?.querySelector('[data-field="search-text"]');
      if (nextInput instanceof HTMLInputElement) {
        nextInput.focus();
        nextInput.setSelectionRange(state.searchText.length, state.searchText.length);
      }
      return;
    }
    if (
      field === "reparent-query" ||
      field === "batch-reparent-query" ||
      field === "attach-child-query" ||
      field === "attach-sibling-query" ||
      field === "merge-query"
    ) {
      if (field === "reparent-query") {
        state.reparentQuery = target.value || "";
        state.reparentTargetId = "";
      }
      if (field === "batch-reparent-query") {
        state.batchReparentQuery = target.value || "";
        state.batchReparentTargetId = "";
      }
      if (field === "attach-child-query") {
        state.attachChildQuery = target.value || "";
      }
      if (field === "attach-sibling-query") {
        state.attachSiblingQuery = target.value || "";
        state.attachSiblingTargetId = "";
      }
      if (field === "merge-query") {
        state.mergeQuery = target.value || "";
        state.mergeSourceId = "";
      }
      render();
      const selector = `[data-field="${field}"]`;
      const nextInput = getHost()?.querySelector(selector);
      if (nextInput instanceof HTMLInputElement) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
      return;
    }
    if (field === "image-url-draft") {
      state.imageUrlDraft = target.value || "";
      syncControlStates();
      return;
    }
    if (field === "split-original-alias-input") {
      state.splitOriginalAliasInput = target.value || "";
      syncControlStates();
      return;
    }
    if (field === "split-new-alias-input") {
      state.splitNewAliasInput = target.value || "";
      syncControlStates();
      return;
    }
    if (field === "alias-input") {
      state.aliasInput = target.value || "";
      syncControlStates();
      return;
    }
    if (
      (field === "draft-supplemental_image_1_id" || field === "draft-supplemental_image_2_id") &&
      state.draft
    ) {
      const nextValue = normalizeSupplementalImageId(target.value);
      state.draft[field.replace(/^draft-/, "")] = nextValue;
      render();
      const nextInput = getHost()?.querySelector(`[data-field="${field}"]`);
      if (nextInput instanceof HTMLInputElement) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
      syncSupplementalImagePreviews();
      return;
    }
    if (field === "split-original-name" && state.splitOriginalDraft) state.splitOriginalDraft.name = target.value;
    if (field === "split-original-sort_name" && state.splitOriginalDraft) state.splitOriginalDraft.sort_name = target.value;
    if (field === "split-original-description" && state.splitOriginalDraft) state.splitOriginalDraft.description = target.value;
    if (field === "split-new-name" && state.splitNewDraft) state.splitNewDraft.name = target.value;
    if (field === "split-new-sort_name" && state.splitNewDraft) state.splitNewDraft.sort_name = target.value;
    if (field === "split-new-description" && state.splitNewDraft) state.splitNewDraft.description = target.value;
    if (field === "draft-name" && state.draft) state.draft.name = target.value;
    if (field === "draft-sort_name" && state.draft) state.draft.sort_name = target.value;
    if (field === "draft-description" && state.draft) state.draft.description = target.value;
    if (field === "parent-create-name") state.parentCreateName = target.value;
    if (field === "child-create-name") state.childCreateName = target.value;
    if (field === "sibling-create-name") state.siblingCreateName = target.value;
    syncControlStates();
  }

  function onHostDragStart(event) {
    const handle = event.target instanceof Element ? event.target.closest("[data-drag-tag-id]") : null;
    if (!(handle instanceof HTMLElement) || state.isSaving) return;
    const sourceId = String(handle.getAttribute("data-drag-tag-id") || "");
    if (!sourceId) return;
    state.draggingTagId = sourceId;
    state.dragOverTagId = "";
    state.dragOverMode = "";
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", sourceId);
    }
    applyTreeDragIndicators();
  }

  function onHostDragOver(event) {
    if (!state.draggingTagId) return;
    const row = event.target instanceof Element ? event.target.closest("[data-drop-tag-id], [data-drop-root]") : null;
    if (!(row instanceof HTMLElement)) {
      setTreeDragTarget("", "");
      return;
    }
    const targetId = row.hasAttribute("data-drop-root")
      ? ROOT_DROP_ID
      : String(row.getAttribute("data-drop-tag-id") || "");
    if (!targetId) {
      setTreeDragTarget("", "");
      return;
    }
    const blockReason = getDragDropBlockReason(state.draggingTagId, targetId);
    if (!blockReason) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setTreeDragTarget(targetId, "valid");
      return;
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    setTreeDragTarget(targetId, "invalid");
  }

  function onHostDragEnd() {
    resetTreeDragState();
  }

  async function moveTagByDrag(sourceTagId, targetTagId) {
    const sourceId = String(sourceTagId || "");
    const targetId = String(targetTagId || "");
    if (!sourceId || !targetId || state.isSaving) return;

    const sourceRecord = state.tagMap.get(sourceId);
    const targetRecord = targetId === ROOT_DROP_ID ? null : state.tagMap.get(targetId);
    if (!sourceRecord || (targetId !== ROOT_DROP_ID && !targetRecord)) {
      setStatus("error", "Selected tag could not be found.");
      render();
      return;
    }

    const relationError = getDragDropBlockReason(sourceId, targetId);
    if (relationError) {
      setStatus("error", relationError);
      render();
      return;
    }

    state.isSaving = true;
    setStatus("info", "Moving tag...");
    render();

    try {
      const newParentIds = targetId === ROOT_DROP_ID ? [] : [targetRecord.id];
      await assignTagParents(sourceRecord.id, newParentIds);

      invalidateTags();
      await refreshDataWithRetry(() => {
        const updatedSource = state.tagMap.get(String(sourceRecord.id));
        return updatedSource?.parentIds?.join("|") === newParentIds.join("|");
      });

      setSelectedTag(sourceRecord.id);
      setStatus("success", targetId === ROOT_DROP_ID ? "All parents removed." : "Tag moved.");
    } catch (err) {
      console.error("[CustomTagsManager] drag move failed", err);
      setStatus("error", err?.message || "Failed to move tag.");
      render();
    } finally {
      state.isSaving = false;
      resetTreeDragState();
      syncControlStates();
    }
  }

  async function removeAllParentsFromSelectedTag() {
    if (state.isSaving || !state.selectedTagId) return;
    const sourceRecord = state.tagMap.get(String(state.selectedTagId));
    if (!sourceRecord) return;
    if (!(sourceRecord.parentIds || []).length) {
      setStatus("error", "Current tag already has no parents.");
      render();
      return;
    }

    state.isSaving = true;
    setStatus("info", "Removing all parents...");
    render();

    try {
      await assignTagParents(sourceRecord.id, []);

      invalidateTags();
      await refreshDataWithRetry(() => {
        const updatedSource = state.tagMap.get(String(sourceRecord.id));
        return !updatedSource?.parentIds?.length;
      });

      setSelectedTag(sourceRecord.id);
      setStatus("success", "All parents removed.");
    } catch (err) {
      console.error("[CustomTagsManager] remove parents failed", err);
      setStatus("error", err?.message || "Failed to remove parents.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  function onHostDrop(event) {
    if (!state.draggingTagId) return;
    const sourceId = state.draggingTagId;
    const row = event.target instanceof Element ? event.target.closest("[data-drop-tag-id], [data-drop-root]") : null;
    const targetId =
      row instanceof HTMLElement
        ? row.hasAttribute("data-drop-root")
          ? ROOT_DROP_ID
          : String(row.getAttribute("data-drop-tag-id") || "")
        : "";
    event.preventDefault();
    resetTreeDragState();
    if (!targetId) return;
    moveTagByDrag(sourceId, targetId);
  }

  async function onHostChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const field = target.getAttribute("data-field") || "";
    if (field !== "image-file") return;
    const imageTarget = String(target.getAttribute("data-image-target") || state.imagePickerTarget || "main");
    if (imageTarget === "main" && !state.draft) return;
    if (imageTarget === "split-new" && !state.splitNewDraft) return;
    if (imageTarget === "split-original" && !state.splitOriginalDraft) return;

    const file = target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await blobToDataUrl(file);
      setDraftImageByTarget(imageTarget, dataUrl);
      state.imagePickerOpen = false;
      state.imagePickerMode = "";
      state.imagePickerTarget = "main";
      state.imageUrlDraft = "";
      setStatus("info", "Image loaded from file. Save Changes to persist.");
      render();
    } catch (err) {
      console.error("[CustomTagsManager] image file load failed", err);
      setStatus("error", err?.message || "Failed to load image from file.");
      render();
    } finally {
      target.value = "";
    }
  }

  async function readImageFromClipboard(target = "main") {
    if (state.isSaving) return;
    if (target === "main" && !state.draft) return;
    if (target === "split-new" && !state.splitNewDraft) return;
    if (target === "split-original" && !state.splitOriginalDraft) return;
    if (!navigator.clipboard?.read) {
      setStatus("error", "Clipboard image reading is not available in this browser.");
      render();
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const dataUrl = await blobToDataUrl(blob);
        setDraftImageByTarget(target, dataUrl);
        state.imagePickerOpen = false;
        state.imagePickerMode = "";
        state.imagePickerTarget = "main";
        state.imageUrlDraft = "";
        setStatus("info", "Image loaded from clipboard. Save Changes to persist.");
        render();
        return;
      }

      setStatus("error", "No image was found in the clipboard.");
      render();
    } catch (err) {
      console.error("[CustomTagsManager] clipboard image read failed", err);
      setStatus("error", err?.message || "Failed to read image from clipboard.");
      render();
    }
  }

  function onHostClick(event) {
    const trigger = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!trigger) return;
    const action = trigger.getAttribute("data-action");
    const tagId = trigger.getAttribute("data-tag-id");
    const imageTarget = String(trigger.getAttribute("data-image-target") || "main");

    if (action === "drag-handle") {
      event.preventDefault();
      return;
    }

    if (action === "toggle-batch-select" && tagId) {
      event.preventDefault();
      if (state.isSaving) return;
      if (isDraftDirty() && !hasBatchSelection()) {
        setStatus("error", "Save or reset current changes before batch reparenting.");
        render();
        return;
      }
      const treePanel = getHost()?.querySelector(".tag-manager__tree-panel-scroll");
      if (treePanel instanceof HTMLElement) {
        state.treeScrollTop = treePanel.scrollTop;
      }
      const targetId = String(tagId);
      const selectedIds = new Set((state.batchSelectedTagIds || []).map(String));
      if (selectedIds.has(targetId)) {
        selectedIds.delete(targetId);
      } else {
        const anchorId = Array.from(selectedIds)[0] || "";
        if (!isBatchSelectionEligible(targetId, anchorId)) {
          return;
        }
        selectedIds.add(targetId);
      }
      state.batchSelectedTagIds = Array.from(selectedIds);
      if (!state.batchSelectedTagIds.length) {
        state.batchReparentQuery = "";
        state.batchReparentTargetId = "";
      } else if (
        state.batchReparentTargetId &&
        getBatchReparentBlockReason(state.batchReparentTargetId, state.batchSelectedTagIds)
      ) {
        state.batchReparentQuery = "";
        state.batchReparentTargetId = "";
      }
      render();
      return;
    }

    if (action === "toggle-expanded" && tagId) {
      event.preventDefault();
      toggleExpanded(tagId);
      return;
    }
    if (action === "select-toggle-group" && tagId) {
      event.preventDefault();
      setSelectedTag(tagId, { skipRender: true });
      const id = String(tagId);
      if (state.expandedIds.has(id)) state.expandedIds.delete(id);
      else state.expandedIds.add(id);
      saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
      render();
      return;
    }
    if (action === "select-tag" && tagId) {
      event.preventDefault();
      setSelectedTag(tagId);
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
      setSelectedTag(tagId);
      return;
    }
    if (action === "pick-target-tag" && tagId) {
      event.preventDefault();
      const slot = String(trigger.getAttribute("data-target-slot") || "");
      const targetRecord = state.tagMap.get(String(tagId));
      if (!targetRecord) return;
      if (slot === "reparent") {
        state.reparentTargetId = String(tagId);
        state.reparentQuery = targetRecord.name || "";
      }
      if (slot === "batch-reparent") {
        state.batchReparentTargetId = String(tagId);
        state.batchReparentQuery = targetRecord.name || "";
      }
      if (slot === "attach-child") {
        const nextIds = Array.from(
          new Set([...(state.attachChildTargetIds || []).map(String), String(tagId)])
        );
        state.attachChildTargetIds = nextIds;
        state.attachChildQuery = "";
      }
      if (slot === "attach-sibling") {
        state.attachSiblingTargetId = String(tagId);
        state.attachSiblingQuery = targetRecord.name || "";
      }
      if (slot === "merge") {
        state.mergeSourceId = String(tagId);
        state.mergeQuery = targetRecord.name || "";
      }
      render();
      if (slot === "attach-child") {
        const nextInput = getHost()?.querySelector('[data-field="attach-child-query"]');
        if (nextInput instanceof HTMLInputElement) nextInput.focus();
      }
      return;
    }
    if (action === "clear-picked-target") {
      event.preventDefault();
      const slot = String(trigger.getAttribute("data-target-slot") || "");
      if (slot === "reparent") {
        state.reparentTargetId = "";
        state.reparentQuery = "";
      }
      if (slot === "batch-reparent") {
        state.batchReparentTargetId = "";
        state.batchReparentQuery = "";
      }
      if (slot === "attach-child") {
        const removeId = String(trigger.getAttribute("data-tag-id") || "");
        state.attachChildTargetIds = removeId
          ? (state.attachChildTargetIds || []).filter((id) => String(id) !== removeId)
          : [];
        if (!removeId) state.attachChildQuery = "";
      }
      if (slot === "attach-sibling") {
        state.attachSiblingTargetId = "";
        state.attachSiblingQuery = "";
      }
      if (slot === "merge") {
        state.mergeSourceId = "";
        state.mergeQuery = "";
      }
      render();
      return;
    }
    if (action === "set-utility-filter") {
      event.preventDefault();
      const treePanel = getHost()?.querySelector(".tag-manager__tree-panel-scroll");
      if (treePanel instanceof HTMLElement) {
        state.treeScrollTop = treePanel.scrollTop;
      }
      state.utilityFilter = String(trigger.getAttribute("data-filter-id") || "all");
      render();
      return;
    }
    if (action === "start-new-tag") {
      event.preventDefault();
      startNewTagDraft();
      return;
    }
    if (action === "start-split-tag") {
      event.preventDefault();
      if (!state.selectedTagId || !state.draft || state.isSaving) return;
      if (isDraftDirty()) {
        setStatus("error", "Save or reset current changes before splitting this tag.");
        render();
        return;
      }
      const currentRecord = state.tagMap.get(String(state.selectedTagId));
      if (!currentRecord) return;
      state.splitMode = true;
      state.splitOriginalDraft = createDraftFromRecord(currentRecord);
      state.splitNewDraft = createBlankDraft();
      state.splitOriginalAliasInput = "";
      state.splitNewAliasInput = "";
      state.imagePickerOpen = false;
      state.imagePickerMode = "";
      state.imagePickerTarget = "main";
      state.imageUrlDraft = "";
      state.pendingDeleteConfirm = false;
      state.mergePanelOpen = false;
      setStatus("", "");
      render();
      return;
    }
    if (action === "cancel-split-tag") {
      event.preventDefault();
      resetSplitState();
      setStatus("", "");
      render();
      return;
    }
    if (action === "clear-batch-selection") {
      event.preventDefault();
      clearBatchSelection();
      render();
      return;
    }
    if (action === "remove-batch-selected-tag" && tagId) {
      event.preventDefault();
      state.batchSelectedTagIds = (state.batchSelectedTagIds || []).filter((id) => String(id) !== String(tagId));
      if (!state.batchSelectedTagIds.length) {
        state.batchReparentQuery = "";
        state.batchReparentTargetId = "";
      } else if (
        state.batchReparentTargetId &&
        getBatchReparentBlockReason(state.batchReparentTargetId, state.batchSelectedTagIds)
      ) {
        state.batchReparentQuery = "";
        state.batchReparentTargetId = "";
      }
      render();
      return;
    }
    if (action === "reset-draft") {
      event.preventDefault();
      if (isNewDraftMode()) startNewTagDraft();
      else setSelectedTag(state.selectedTagId);
      return;
    }
    if (action === "toggle-image-picker") {
      event.preventDefault();
      state.imagePickerOpen = !state.imagePickerOpen;
      state.imagePickerMode = "";
      state.imagePickerTarget = imageTarget;
      state.imageUrlDraft = "";
      render();
      return;
    }
    if (action === "close-image-picker" || action === "cancel-image-url") {
      event.preventDefault();
      state.imagePickerOpen = false;
      state.imagePickerMode = "";
      state.imagePickerTarget = "main";
      state.imageUrlDraft = "";
      render();
      return;
    }
    if (action === "open-image-url-picker") {
      event.preventDefault();
      state.imagePickerOpen = true;
      state.imagePickerMode = "url";
      state.imagePickerTarget = imageTarget;
      state.imageUrlDraft = String(getDraftImageByTarget(imageTarget) || "");
      render();
      const nextInput = getHost()?.querySelector('[data-field="image-url-draft"]');
      if (nextInput instanceof HTMLInputElement) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
      return;
    }
    if (action === "open-image-file-picker") {
      event.preventDefault();
      const fileInput = Array.from(getHost()?.querySelectorAll('[data-field="image-file"]') || []).find(
        (input) => input instanceof HTMLInputElement && String(input.getAttribute("data-image-target") || "main") === imageTarget
      );
      if (fileInput instanceof HTMLInputElement) fileInput.click();
      return;
    }
    if (action === "apply-image-url") {
      event.preventDefault();
      setDraftImageByTarget(imageTarget, String(state.imageUrlDraft || "").trim());
      state.imagePickerOpen = false;
      state.imagePickerMode = "";
      state.imagePickerTarget = "main";
      state.imageUrlDraft = "";
      setStatus("info", "Image URL applied. Save Changes to persist.");
      render();
      return;
    }
    if (action === "clear-image") {
      event.preventDefault();
      setDraftImageByTarget(imageTarget, "");
      state.imagePickerOpen = false;
      state.imagePickerMode = "";
      state.imagePickerTarget = "main";
      state.imageUrlDraft = "";
      setStatus("info", "Image cleared. Save Changes to persist.");
      render();
      return;
    }
    if (action === "clear-supplemental-image") {
      event.preventDefault();
      if (!state.draft) return;
      const slot = String(trigger.getAttribute("data-supplemental-slot") || "");
      if (!slot) return;
      state.draft[slot] = "";
      setStatus("info", "Supplemental image cleared. Save Changes to persist.");
      render();
      return;
    }
    if (action === "remove-all-parents") {
      event.preventDefault();
      removeAllParentsFromSelectedTag();
      return;
    }
    if (action === "read-image-clipboard") {
      event.preventDefault();
      readImageFromClipboard(imageTarget);
      return;
    }
    if (action === "prompt-delete-tag") {
      event.preventDefault();
      state.pendingDeleteConfirm = true;
      state.mergePanelOpen = false;
      render();
      return;
    }
    if (action === "cancel-delete-tag") {
      event.preventDefault();
      state.pendingDeleteConfirm = false;
      render();
      return;
    }
    if (action === "confirm-delete-tag") {
      event.preventDefault();
      deleteSelectedTag();
      return;
    }
    if (action === "toggle-merge-panel") {
      event.preventDefault();
      state.mergePanelOpen = !state.mergePanelOpen;
      if (state.mergePanelOpen) {
        state.pendingDeleteConfirm = false;
        state.mergeDestinationId = String(state.selectedTagId || "");
      } else {
        state.mergeQuery = "";
        state.mergeSourceId = "";
        state.mergeDestinationId = "";
      }
      render();
      if (state.mergePanelOpen) {
        const nextInput = getHost()?.querySelector('[data-field="merge-query"]');
        if (nextInput instanceof HTMLInputElement) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      }
      return;
    }
    if (action === "cancel-merge-tag") {
      event.preventDefault();
      state.mergePanelOpen = false;
      state.mergeQuery = "";
      state.mergeSourceId = "";
      state.mergeDestinationId = "";
      render();
      return;
    }
    if (action === "flip-merge-direction") {
      event.preventDefault();
      const currentDestinationId = String(state.mergeDestinationId || state.selectedTagId || "");
      const currentSourceId = String(state.mergeSourceId || "");
      if (!currentDestinationId || !currentSourceId) return;
      state.mergeDestinationId = currentSourceId;
      state.mergeSourceId = currentDestinationId;
      const nextSourceRecord = state.tagMap.get(currentDestinationId);
      state.mergeQuery = nextSourceRecord?.name || "";
      render();
      return;
    }
    if (action === "toggle-aliases-expanded") {
      event.preventDefault();
      state.aliasesExpanded = !state.aliasesExpanded;
      render();
      return;
    }
    if (action === "add-alias") {
      event.preventDefault();
      if (!state.draft) return;
      const reason = getAliasAddBlockReason();
      if (reason) {
        setStatus("error", reason);
        render();
        return;
      }
      state.draft.aliases = normalizeAliasList([...(state.draft.aliases || []), String(state.aliasInput || "").trim()]);
      state.aliasInput = "";
      setStatus("info", "Alias added. Save Changes to persist.");
      render();
      const nextInput = getHost()?.querySelector('[data-field="alias-input"]');
      if (nextInput instanceof HTMLInputElement) nextInput.focus();
      return;
    }
    if (action === "add-split-alias") {
      event.preventDefault();
      const side = String(trigger.getAttribute("data-split-side") || "original");
      const reason = getSplitAliasAddReason(side);
      if (reason) {
        setStatus("error", reason);
        render();
        return;
      }
      const value = String(side === "new" ? state.splitNewAliasInput : state.splitOriginalAliasInput).trim();
      if (side === "new" && state.splitNewDraft) {
        state.splitNewDraft.aliases = normalizeAliasList([...(state.splitNewDraft.aliases || []), value]);
        state.splitNewAliasInput = "";
      } else if (state.splitOriginalDraft) {
        state.splitOriginalDraft.aliases = normalizeAliasList([...(state.splitOriginalDraft.aliases || []), value]);
        state.splitOriginalAliasInput = "";
      }
      setStatus("info", "Alias added to split draft.");
      render();
      return;
    }
    if (action === "remove-split-alias") {
      event.preventDefault();
      const side = String(trigger.getAttribute("data-split-side") || "original");
      const aliasIndex = Number(trigger.getAttribute("data-alias-index"));
      if (!Number.isInteger(aliasIndex) || aliasIndex < 0) return;
      if (side === "new" && state.splitNewDraft) {
        const aliases = normalizeAliasList(state.splitNewDraft.aliases || []);
        aliases.splice(aliasIndex, 1);
        state.splitNewDraft.aliases = aliases;
      } else if (state.splitOriginalDraft) {
        const aliases = normalizeAliasList(state.splitOriginalDraft.aliases || []);
        aliases.splice(aliasIndex, 1);
        state.splitOriginalDraft.aliases = aliases;
      }
      setStatus("info", "Alias removed from split draft.");
      render();
      return;
    }
    if (action === "move-split-alias-to-new" || action === "move-split-alias-to-original") {
      event.preventDefault();
      const aliasIndex = Number(trigger.getAttribute("data-alias-index"));
      if (!Number.isInteger(aliasIndex) || aliasIndex < 0 || !state.splitOriginalDraft || !state.splitNewDraft) return;
      const sourceSide = action === "move-split-alias-to-new" ? "original" : "new";
      const sourceDraft = sourceSide === "new" ? state.splitNewDraft : state.splitOriginalDraft;
      const targetDraft = sourceSide === "new" ? state.splitOriginalDraft : state.splitNewDraft;
      const aliases = normalizeAliasList(sourceDraft.aliases || []);
      const [movedAlias] = aliases.splice(aliasIndex, 1);
      if (!movedAlias) return;
      const compareTerms = [
        String(targetDraft.name || "").trim(),
        ...normalizeAliasList(targetDraft.aliases || []),
      ]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      if (compareTerms.includes(String(movedAlias || "").trim().toLowerCase())) {
        setStatus("error", "That alias already exists on the destination side.");
        render();
        return;
      }
      sourceDraft.aliases = aliases;
      targetDraft.aliases = normalizeAliasList([...(targetDraft.aliases || []), movedAlias]);
      setStatus("info", "Alias moved.");
      render();
      return;
    }
    if (action === "remove-alias") {
      event.preventDefault();
      if (!state.draft) return;
      const aliasIndex = Number(trigger.getAttribute("data-alias-index"));
      if (!Number.isInteger(aliasIndex) || aliasIndex < 0) return;
      const aliases = normalizeAliasList(state.draft.aliases || []);
      aliases.splice(aliasIndex, 1);
      state.draft.aliases = aliases;
      setStatus("info", "Alias removed. Save Changes to persist.");
      render();
      return;
    }
    if (action === "confirm-merge-tag") {
      event.preventDefault();
      mergeSelectedTag();
      return;
    }
    if (action === "confirm-split-tag") {
      event.preventDefault();
      confirmSplitTag();
      return;
    }
    if (action === "reparent-selected-tags") {
      event.preventDefault();
      reparentBatchSelectedTags();
      return;
    }
    if (action === "save-tag") {
      event.preventDefault();
      saveSelectedTag();
      return;
    }
    if (action === "create-tag") {
      event.preventDefault();
      createStandaloneTag();
      return;
    }
    if (action === "create-parent") {
      event.preventDefault();
      createRelatedTag("parent");
      return;
    }
    if (action === "create-child") {
      event.preventDefault();
      createRelatedTag("child");
      return;
    }
    if (action === "create-sibling") {
      event.preventDefault();
      createRelatedTag("sibling");
      return;
    }
    if (action === "reparent-current") {
      event.preventDefault();
      attachExistingTag("reparent");
      return;
    }
    if (action === "add-additional-parent") {
      event.preventDefault();
      attachExistingTag("add-parent");
      return;
    }
    if (action === "attach-existing-child") {
      event.preventDefault();
      attachExistingTag("child");
      return;
    }
    if (action === "attach-existing-sibling") {
      event.preventDefault();
      attachExistingTag("sibling");
    }
  }

  function updateSelectedDraftFromRecord(record) {
    state.selectedTagId = record?.id || null;
    resetSplitState();
    state.draft = createDraftFromRecord(record);
    resetRelationshipPickers();
    state.aliasInput = "";
    state.mergeQuery = "";
    state.mergeSourceId = "";
    state.mergeDestinationId = "";
    state.imagePickerOpen = false;
    state.imagePickerMode = "";
    state.imagePickerTarget = "main";
    state.imageUrlDraft = "";
    state.pendingDeleteConfirm = false;
    state.mergePanelOpen = false;
  }

  function buildTagUpdateInput(id, draft, currentRecord = null) {
    const nextImage = String(draft?.image_path || "").trim();
    const currentImage = String(currentRecord?.image_path || "").trim();
    const input = {
      id: String(id),
      name: String(draft?.name || "").trim(),
      aliases: normalizeAliasList(draft?.aliases || []),
      sort_name: String(draft?.sort_name || "").trim(),
      description: String(draft?.description || "").trim(),
    };
    if (nextImage !== currentImage) {
      input.image = nextImage;
    }
    return input;
  }

  function buildTagCreateInput(draft) {
    const input = {
      name: String(draft?.name || "").trim(),
      aliases: normalizeAliasList(draft?.aliases || []),
      sort_name: String(draft?.sort_name || "").trim(),
      description: String(draft?.description || "").trim(),
    };
    const createImage = String(draft?.image_path || "").trim();
    if (createImage) {
      input.image = createImage;
    }
    return input;
  }

  async function saveSupplementalImageFields(tagId, draft, currentRecord = null) {
    const partial = buildSupplementalFieldsPartial(draft, currentRecord);
    if (!partial) return;
    await gqlRequest(
      `
        mutation CustomTagsManagerSaveSupplementalImages($id: ID!, $fields: Map) {
          tagUpdate(input: { id: $id, custom_fields: { partial: $fields } }) {
            id
          }
        }
      `,
      {
        id: String(tagId),
        fields: partial,
      }
    );
  }

  async function reparentBatchSelectedTags() {
    if (state.isSaving) return;
    const selectedIds = (state.batchSelectedTagIds || []).map(String).filter(Boolean);
    const targetId = String(state.batchReparentTargetId || "").trim();
    if (!selectedIds.length || !targetId) return;

    const relationError = getBatchReparentBlockReason(targetId, selectedIds);
    if (relationError) {
      setStatus("error", relationError);
      render();
      return;
    }

    const targetRecord = state.tagMap.get(targetId);
    const sourceRecords = selectedIds.map((id) => state.tagMap.get(id)).filter(Boolean);
    if (!targetRecord || sourceRecords.length !== selectedIds.length) {
      setStatus("error", "Selected tag could not be found.");
      render();
      return;
    }

    state.isSaving = true;
    setStatus(
      "info",
      `Reparenting ${formatCount(sourceRecords.length)} selected tag${sourceRecords.length === 1 ? "" : "s"}...`
    );
    render();

    try {
      for (const sourceRecord of sourceRecords) {
        await assignTagParents(sourceRecord.id, [targetRecord.id]);
      }

      state.expandedIds.add(String(targetRecord.id));
      saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);

      invalidateTags();
      await refreshDataWithRetry(() => {
        return sourceRecords.every((sourceRecord) => {
          const updatedSource = state.tagMap.get(String(sourceRecord.id));
          return updatedSource?.parentIds?.join("|") === String(targetRecord.id);
        });
      });

      clearBatchSelection();
      setSelectedTag(targetRecord.id);
      setStatus(
        "success",
        `${formatCount(sourceRecords.length)} tag${sourceRecords.length === 1 ? "" : "s"} reparented.`
      );
    } catch (err) {
      console.error("[CustomTagsManager] batch reparent failed", err);
      setStatus("error", err?.message || "Failed to reparent selected tags.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  async function saveSelectedTag() {
    if (!state.selectedTagId || !state.draft || state.isSaving) return;
    state.isSaving = true;
    setStatus("info", "Saving tag...");
    render();

    try {
      const currentRecord = state.tagMap.get(String(state.selectedTagId));
      const input = buildTagUpdateInput(state.selectedTagId, state.draft, currentRecord);
      let supplementalSaveError = null;

      await gqlRequest(
        `
          mutation CustomTagsManagerSaveTag($input: TagUpdateInput!) {
            tagUpdate(input: $input) {
              id
            }
          }
        `,
        { input }
      );

      try {
        await saveSupplementalImageFields(state.selectedTagId, state.draft, currentRecord);
      } catch (err) {
        supplementalSaveError = err;
      }

      invalidateTags();
      await refreshData();
      updateSelectedDraftFromRecord(state.tagMap.get(String(state.selectedTagId)) || null);
      setStatus(
        supplementalSaveError ? "info" : "success",
        supplementalSaveError
          ? "Tag updated, but supplemental images could not be saved."
          : "Tag updated."
      );
      render();
    } catch (err) {
      console.error("[CustomTagsManager] save failed", err);
      setStatus("error", err?.message || "Failed to save tag.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  async function createStandaloneTag() {
    if (!state.draft || state.isSaving) return;
    const name = String(state.draft.name || "").trim();
    if (!name) return;

    state.isSaving = true;
    setStatus("info", "Creating tag...");
    render();

    try {
      const createInput = buildTagCreateInput(state.draft);
      let supplementalSaveError = null;
      const data = await gqlRequest(
        `
          mutation CustomTagsManagerCreateStandaloneTag($input: TagCreateInput!) {
            tagCreate(input: $input) {
              id
            }
          }
        `,
        { input: createInput }
      );

      const newId = String(data?.tagCreate?.id || "");
      if (!newId) throw new Error("Tag was created without an id.");

      try {
        await saveSupplementalImageFields(newId, state.draft, null);
      } catch (err) {
        supplementalSaveError = err;
      }

      invalidateTags();
      await refreshData();
      setSelectedTag(newId);
      setStatus(
        supplementalSaveError ? "info" : "success",
        supplementalSaveError
          ? "Tag created, but supplemental images could not be saved."
          : "Tag created."
      );
      render();
    } catch (err) {
      console.error("[CustomTagsManager] create standalone failed", err);
      setStatus("error", err?.message || "Failed to create tag.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  async function confirmSplitTag() {
    if (state.isSaving || !state.selectedTagId || !state.splitMode) return;
    const originalDraft = state.splitOriginalDraft;
    const nextDraft = state.splitNewDraft;
    if (!originalDraft || !nextDraft) return;

    const validationMessage = getSplitValidationMessage();
    if (validationMessage) {
      setStatus("error", validationMessage);
      render();
      return;
    }

    state.isSaving = true;
    setStatus("info", "Splitting tag...");
    render();

    try {
      const currentRecord = state.tagMap.get(String(state.selectedTagId));
      if (!currentRecord) throw new Error("Selected tag could not be found.");
      let supplementalSaveError = null;

      await gqlRequest(
        `
          mutation CustomTagsManagerSaveSplitOriginal($input: TagUpdateInput!) {
            tagUpdate(input: $input) {
              id
            }
          }
        `,
        { input: buildTagUpdateInput(state.selectedTagId, originalDraft, currentRecord) }
      );

      try {
        await saveSupplementalImageFields(state.selectedTagId, originalDraft, currentRecord);
      } catch (err) {
        supplementalSaveError = err;
      }

      const createData = await gqlRequest(
        `
          mutation CustomTagsManagerCreateSplitTag($input: TagCreateInput!) {
            tagCreate(input: $input) {
              id
            }
          }
        `,
        { input: buildTagCreateInput(nextDraft) }
      );

      const newId = String(createData?.tagCreate?.id || "");
      if (!newId) throw new Error("Split tag was created without an id.");

      try {
        await saveSupplementalImageFields(newId, nextDraft, null);
      } catch (err) {
        supplementalSaveError = supplementalSaveError || err;
      }

      invalidateTags();
      await refreshDataWithRetry(() => {
        const originalRecord = state.tagMap.get(String(state.selectedTagId));
        const newRecord = state.tagMap.get(String(newId));
        return !!originalRecord && !!newRecord;
      });

      resetSplitState();
      setSelectedTag(newId);
      setStatus(
        supplementalSaveError ? "info" : "success",
        supplementalSaveError
          ? "Tag split, but supplemental images could not be saved."
          : "Tag split. New tag created as a root tag."
      );
    } catch (err) {
      console.error("[CustomTagsManager] split failed", err);
      setStatus("error", err?.message || "Failed to split tag.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  async function deleteSelectedTag() {
    if (!state.selectedTagId || state.isSaving) return;
    const deletingId = String(state.selectedTagId);
    state.isSaving = true;
    setStatus("info", "Deleting tag...");
    render();

    try {
      await gqlRequest(
        `
          mutation CustomTagsManagerDeleteTag($input: TagDestroyInput!) {
            tagDestroy(input: $input)
          }
        `,
        {
          input: {
            id: deletingId,
          },
        }
      );

      invalidateTags();
      await refreshData();
      updateSelectedDraftFromRecord(null);
      state.pendingDeleteConfirm = false;
      setStatus("success", "Tag deleted.");
      render();
    } catch (err) {
      console.error("[CustomTagsManager] delete failed", err);
      setStatus("error", err?.message || "Failed to delete tag.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  async function mergeSelectedTag() {
    if (state.isSaving) return;
    const destinationId = String(state.mergeDestinationId || state.selectedTagId || "");
    const destinationRecord = destinationId ? state.tagMap.get(destinationId) : null;
    const sourceId = String(state.mergeSourceId || "");
    if (!destinationRecord || !sourceId) return;
    if (isDraftDirty()) {
      setStatus("error", "Save or reset current changes before merging tags.");
      render();
      return;
    }

    const mergeError = getMergeBlockReason(destinationRecord.id, sourceId);
    if (mergeError) {
      setStatus("error", mergeError);
      render();
      return;
    }

    const sourceRecord = state.tagMap.get(sourceId);
    if (!sourceRecord) {
      setStatus("error", "Selected tag could not be found.");
      render();
      return;
    }

    state.isSaving = true;
    setStatus("info", `Merging ${sourceRecord.name || "source tag"} into ${destinationRecord.name || "destination tag"}...`);
    render();

    try {
      await gqlRequest(
        `
          mutation CustomTagsManagerMergeTags($input: TagsMergeInput!) {
            tagsMerge(input: $input) {
              id
            }
          }
        `,
        {
          input: {
            source: [sourceId],
            destination: String(destinationRecord.id),
          },
        }
      );

      state.mergeQuery = "";
      state.mergeSourceId = "";
      state.mergeDestinationId = "";
      state.mergePanelOpen = false;

      invalidateTags();
      await refreshDataWithRetry(() => {
        const destination = state.tagMap.get(String(destinationRecord.id));
        const source = state.tagMap.get(String(sourceId));
        return !!destination && !source;
      });
      setSelectedTag(destinationRecord.id);
      setStatus("success", "Tags merged.");
    } catch (err) {
      console.error("[CustomTagsManager] merge failed", err);
      setStatus("error", err?.message || "Failed to merge tags.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  async function createTagBase(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("Name is required.");
    const data = await gqlRequest(
      `
        mutation CustomTagsManagerCreateTag($input: TagCreateInput!) {
          tagCreate(input: $input) {
            id
          }
        }
      `,
      { input: { name: trimmed } }
    );
    return data?.tagCreate?.id ? String(data.tagCreate.id) : null;
  }

  async function assignTagParents(tagId, parentIds) {
    await gqlRequest(
      `
        mutation CustomTagsManagerAssignParents($input: TagUpdateInput!) {
          tagUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(tagId),
          parent_ids: (parentIds || []).map(String),
        },
      }
    );
  }

  async function createRelatedTag(mode) {
    if (state.isSaving || !state.selectedTagId) return;
    const sourceRecord = state.tagMap.get(state.selectedTagId);
    if (!sourceRecord) return;
    if (mode === "parent" && !canTagGainInsertedParent(sourceRecord.id)) {
      setStatus("error", "Current tag already occupies a full 3-level hierarchy.");
      render();
      return;
    }
    if (mode === "child" && !canTagHaveChildren(sourceRecord.id)) {
      setStatus("error", "Current tag is already under 2 tag groups.");
      render();
      return;
    }
    if (mode === "sibling" && !canTagHaveSiblings(sourceRecord.id)) {
      setStatus("error", "Only available for subgroup and leaf tags under an existing parent group.");
      render();
      return;
    }

    const isParent = mode === "parent";
    const isChild = mode === "child";
    const name = (isParent
      ? state.parentCreateName
      : isChild
      ? state.childCreateName
      : state.siblingCreateName
    ).trim();
    if (!name) return;

    state.isSaving = true;
    setStatus(
      "info",
      isParent ? "Creating parent tag..." : isChild ? "Creating child tag..." : "Creating sibling tag..."
    );
    render();

    try {
      const newId = await createTagBase(name);
      if (!newId) throw new Error("Tag was created without an id.");

      const parentIds = isParent ? sourceRecord.parentIds : isChild ? [sourceRecord.id] : sourceRecord.parentIds;
      if (parentIds.length) {
        await assignTagParents(newId, parentIds);
      }

      if (isParent) {
        await assignTagParents(sourceRecord.id, [newId]);
      }

      if (isParent) {
        state.parentCreateName = "";
      } else if (isChild) {
        state.childCreateName = "";
        state.expandedIds.add(sourceRecord.id);
        saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
      } else {
        state.siblingCreateName = "";
      }

      invalidateTags();
      await refreshDataWithRetry(() => {
        const created = state.tagMap.get(String(newId));
        if (!created) return false;
        if (isParent) {
          const updatedSource = state.tagMap.get(String(sourceRecord.id));
          return (
            created.parentIds.join("|") === sourceRecord.parentIds.join("|") &&
            updatedSource?.parentIds?.join("|") === String(newId)
          );
        }
        return created.parentIds.join("|") === parentIds.map(String).join("|");
      });
      setSelectedTag(newId);
      setStatus(
        "success",
        isParent ? "Parent tag created." : isChild ? "Child tag created." : "Sibling tag created."
      );
    } catch (err) {
      console.error("[CustomTagsManager] related create failed", err);
      setStatus("error", err?.message || "Failed to create tag.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  function isDescendantTag(ancestorId, possibleDescendantId, visited = new Set()) {
    const ancestor = state.tagMap.get(String(ancestorId));
    if (!ancestor || visited.has(String(ancestorId))) return false;
    const nextVisited = new Set(visited);
    nextVisited.add(String(ancestorId));
    return (ancestor.childIds || []).some((childId) => {
      const child = String(childId);
      if (child === String(possibleDescendantId)) return true;
      return isDescendantTag(child, possibleDescendantId, nextVisited);
    });
  }

  async function attachExistingTag(mode) {
    if (state.isSaving || !state.selectedTagId) return;
    const sourceRecord = state.tagMap.get(String(state.selectedTagId));
    if (!sourceRecord) return;
    if (mode === "add-parent" && !canTagGainInsertedParent(sourceRecord.id)) {
      setStatus("error", "Current tag already occupies a full 3-level hierarchy.");
      render();
      return;
    }
    if (mode === "child" && !canTagHaveChildren(sourceRecord.id)) {
      setStatus("error", "Current tag is already under 2 tag groups.");
      render();
      return;
    }
    if (mode === "sibling" && !canTagHaveSiblings(sourceRecord.id)) {
      setStatus("error", "Only available for subgroup and leaf tags under an existing parent group.");
      render();
      return;
    }

    const targetIds =
      mode === "reparent"
        ? [String(state.reparentTargetId || "")]
        : mode === "child"
        ? (state.attachChildTargetIds || []).map(String)
        : [String(state.attachSiblingTargetId || "")];
    const filteredTargetIds = targetIds.filter(Boolean);
    if (!filteredTargetIds.length) return;

    const relationError =
      mode === "reparent" || mode === "add-parent"
        ? getParentRelationshipBlockReason(sourceRecord.id, filteredTargetIds[0], mode)
        : mode === "child"
        ? filteredTargetIds.map((targetId) => getAttachChildBlockReason(sourceRecord.id, targetId)).find(Boolean) || ""
        : getAttachSiblingBlockReason(sourceRecord.id, filteredTargetIds[0]);
    if (relationError) {
      setStatus("error", relationError);
      render();
      return;
    }

    const targetRecords = filteredTargetIds
      .map((targetId) => state.tagMap.get(targetId))
      .filter(Boolean);
    if (targetRecords.length !== filteredTargetIds.length) {
      setStatus("error", "Selected tag could not be found.");
      render();
      return;
    }
    const targetRecord = targetRecords[0];

    state.isSaving = true;
    setStatus(
      "info",
      mode === "reparent"
        ? "Reparenting current tag..."
        : mode === "add-parent"
        ? "Adding additional parent..."
        : mode === "child"
        ? `Attaching ${formatCount(targetRecords.length)} existing child tag${targetRecords.length === 1 ? "" : "s"}...`
        : "Adding existing sibling..."
    );
    render();

    try {
      let newParentIds = [];
      if (mode === "reparent") {
        newParentIds = [targetRecord.id];
        await assignTagParents(sourceRecord.id, newParentIds);
      } else if (mode === "add-parent") {
        newParentIds = Array.from(new Set([...(sourceRecord.parentIds || []), targetRecord.id])).map(String);
        await assignTagParents(sourceRecord.id, newParentIds);
      } else if (mode === "child") {
        for (const childRecord of targetRecords) {
          newParentIds = Array.from(new Set([...(childRecord.parentIds || []), sourceRecord.id])).map(String);
          await assignTagParents(childRecord.id, newParentIds);
        }
        state.expandedIds.add(String(sourceRecord.id));
        saveSet(EXPANDED_STORAGE_KEY, state.expandedIds);
      } else {
        newParentIds = Array.from(
          new Set([...(targetRecord.parentIds || []), ...(sourceRecord.parentIds || [])])
        ).map(String);
        const invalidSiblingParent = newParentIds.find(
          (parentId) => !canAttachTagToParent(targetRecord.id, parentId)
        );
        if (invalidSiblingParent) {
          throw new Error("That sibling relationship would exceed the 3-level hierarchy limit.");
        }
        await assignTagParents(targetRecord.id, newParentIds);
      }

      resetRelationshipPickers();

      invalidateTags();
      await refreshDataWithRetry(() => {
        if (mode === "reparent" || mode === "add-parent") {
          const updatedSource = state.tagMap.get(String(sourceRecord.id));
          return updatedSource?.parentIds?.join("|") === newParentIds.join("|");
        }
        if (mode === "child") {
          return targetRecords.every((childRecord) => {
            const updatedTarget = state.tagMap.get(String(childRecord.id));
            const expectedParentIds = Array.from(
              new Set([...(childRecord.parentIds || []), sourceRecord.id])
            )
              .map(String)
              .sort();
            const updatedParentIds = (updatedTarget?.parentIds || []).map(String).sort();
            return updatedParentIds.join("|") === expectedParentIds.join("|");
          });
        }
        const updatedTarget = state.tagMap.get(String(targetRecord.id));
        return updatedTarget?.parentIds?.join("|") === newParentIds.join("|");
      });

      if (mode === "reparent" || mode === "add-parent") {
        setSelectedTag(sourceRecord.id);
        setStatus("success", mode === "reparent" ? "Current tag reparented." : "Additional parent added.");
      } else {
        setSelectedTag(mode === "child" ? sourceRecord.id : targetRecord.id);
        setStatus(
          "success",
          mode === "child"
            ? `${formatCount(targetRecords.length)} existing child tag${targetRecords.length === 1 ? "" : "s"} attached.`
            : "Existing sibling added."
        );
      }
    } catch (err) {
      console.error("[CustomTagsManager] attach existing failed", err);
      setStatus("error", err?.message || "Failed to update hierarchy.");
      render();
    } finally {
      state.isSaving = false;
      syncControlStates();
    }
  }

  function refreshData() {
    return Promise.all([loadConfig(), loadTags()]).then(([config, tags]) => {
      cache.config = config;
      const hierarchy = buildHierarchy(tags);
      cache.tagLookupMap = hierarchy.tagMap;
      state.groups = hierarchy.groups;
      state.ungroupedLeaves = hierarchy.ungroupedLeaves;
      state.rootIds = hierarchy.rootIds;
      state.tagMap = hierarchy.tagMap;
      state.searchIndex = hierarchy.searchIndex;
      state.batchSelectedTagIds = (state.batchSelectedTagIds || [])
        .map(String)
        .filter((id) => state.tagMap.has(id));
      if (state.batchSelectedTagIds.length) {
        const anchorId = state.batchSelectedTagIds[0];
        state.batchSelectedTagIds = state.batchSelectedTagIds.filter((id) =>
          isBatchSelectionEligible(id, anchorId, state.tagMap)
        );
      }
      if (!state.batchSelectedTagIds.length) {
        state.batchReparentQuery = "";
        state.batchReparentTargetId = "";
      } else if (
        state.batchReparentTargetId &&
        (!state.tagMap.has(String(state.batchReparentTargetId)) ||
          getBatchReparentBlockReason(state.batchReparentTargetId, state.batchSelectedTagIds, state.tagMap))
      ) {
        state.batchReparentQuery = "";
        state.batchReparentTargetId = "";
      }
      if (config.treeExpansionBehavior !== "remember") {
        ensureTreeExpansionBehavior();
      }

      if (state.selectedTagId && !state.tagMap.has(String(state.selectedTagId))) {
        updateSelectedDraftFromRecord(null);
      } else if (state.selectedTagId) {
        updateSelectedDraftFromRecord(state.tagMap.get(String(state.selectedTagId)));
      }

      return hierarchy;
    });
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function refreshDataWithRetry(predicate, delays = [0, 120, 260]) {
    for (const delay of delays) {
      if (delay > 0) {
        await wait(delay);
      }
      await refreshData();
      if (!predicate || predicate()) {
        return true;
      }
      invalidateTags();
    }
    return false;
  }

  function refreshManager() {
    if (shouldAutoOpenManagerFromQuery()) {
      window.history.replaceState({}, "", PLUGIN_ROUTE);
    }
    const launchReady = ensureLaunchButton();
    if (isTagsPage() && !launchReady) {
      return Promise.reject(createRetryableRefreshError("Tags toolbar not ready"));
    }
    if (!isManagerRoute()) {
      const host = getHost();
      if (host) host.remove();
      if (!isTagDetailPage()) {
        removeNativeTagDetailSupplementalPanel();
        return Promise.resolve();
      }
      return syncNativeTagDetailSupplementalPanel().then((ready) => {
        if (!ready) {
          throw createRetryableRefreshError("Tag detail header not ready");
        }
      });
    }
    removeNativeTagDetailSupplementalPanel();
    return refreshData().then(() => {
      render();
    });
  }

  function clearRefreshTimeouts() {
    state.refreshTimeoutIds.forEach((id) => window.clearTimeout(id));
    state.refreshTimeoutIds = [];
  }

  function queueRefreshAttempt(generation, index) {
    const delay = index === 0 ? RETRY_DELAYS[0] : RETRY_DELAYS[index] - RETRY_DELAYS[index - 1];
    const timeoutId = window.setTimeout(() => {
      state.refreshTimeoutIds = state.refreshTimeoutIds.filter((id) => id !== timeoutId);
      if (generation !== state.refreshGeneration) return;
      refreshManager().catch((err) => {
        if (!err?.customTagsManagerRetry) {
          console.error("[CustomTagsManager] refresh failed", err);
        }
        if (generation !== state.refreshGeneration) return;
        if (index < RETRY_DELAYS.length - 1) queueRefreshAttempt(generation, index + 1);
      });
    }, Math.max(0, delay));
    state.refreshTimeoutIds.push(timeoutId);
  }

  function scheduleRefresh() {
    state.refreshGeneration += 1;
    hideHoverPreview();
    clearRefreshTimeouts();
    queueRefreshAttempt(state.refreshGeneration, 0);
  }

  function installRouteHooks() {
    if (window.__customTagsManagerRouteHooksInstalled) return;
    window.__customTagsManagerRouteHooksInstalled = true;
    const eventApi = window.PluginApi?.Event;
    if (eventApi?.addEventListener) {
      eventApi.addEventListener("stash:location", scheduleRefresh);
    }
    window.addEventListener("popstate", scheduleRefresh);
    document.addEventListener("mouseover", handleGlobalTagHover, true);
    document.addEventListener("mouseout", handleGlobalTagHoverOut, true);
    window.addEventListener("resize", () => {
      hideHoverPreview();
      if (isManagerRoute()) syncMeasuredPanelHeights();
    });
    window.addEventListener(
      "scroll",
      () => {
        hideHoverPreview();
      },
      true
    );
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


