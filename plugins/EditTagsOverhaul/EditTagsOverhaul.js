(function () {
  "use strict";

  const PLUGIN_ID = "EditTagsOverhaul";
  const PANEL_ID = "kmv-edit-tags-overhaul";
  const STYLE_HIDE_ID = "kmv-edit-tags-overhaul-hide-original";
  const HOVER_PREVIEW_ID = "edit-tags-overhaul-hover-preview";
  const TAG_CLIPBOARD_STORAGE_KEY = "EditTagsOverhaul.tagClipboard";
  const FULLSCREEN_LAYOUT_STORAGE_KEY = "EditTagsOverhaul.fullscreenQuickTagLayout";
  const FULLSCREEN_MINI_PANELS_STORAGE_KEY = "EditTagsOverhaul.fullscreenMiniPanels";
  const ROUTE_EVENT = "edit-tags-overhaul:navigation";
  const ROUTE_HOOK_STATE_KEY = "__editTagsOverhaulRouteHooks";
  const CLEANUP_KEY = "__editTagsOverhaulCleanup";
  const ROUTE_RETRY_DELAYS = [0, 200, 600, 1200, 2000, 3500];
  const FULLSCREEN_SCALE_STEPS = [0.75, 0.85, 1, 1.15, 1.3];
  const DEFAULT_FULLSCREEN_PANEL_LAYOUT = {
    width: 420,
    height: 520,
    scale: 1,
    minimized: false,
  };
  const DEFAULT_FULLSCREEN_MINI_PANEL_LAYOUT = {
    width: 320,
    height: 400,
  };
  const SUPPLEMENTAL_IMAGE_KEYS = [
    "ctm_supplemental_image_1",
    "ctm_supplemental_image_2",
  ];

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
    tagMap: new Map(),
    supplementalImages: new Map(),
    supplementalImagePromises: new Map(),
    hoverTagId: "",
    hoverAnchorRect: null,
    routeEventListener: null,
    tabClickListener: null,
    scrollListener: null,
    resizeListener: null,
    fullscreenChangeListener: null,
    fullscreen: {
      root: null,
      launcher: null,
      panel: null,
      resizeObserver: null,
      miniPanels: new Map(),
      miniResizeObservers: new Map(),
      groups: [],
      groupMap: new Map(),
      entityKey: "",
      isBuilding: false,
      dragState: null,
    },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeSupplementalImageId(value) {
    const digits = String(value ?? "").trim().replace(/[^\d]/g, "");
    return digits || "";
  }

  function getSupplementalImageValue(customFields, key) {
    return normalizeSupplementalImageId(customFields?.[key]);
  }

  function getSupplementalImageIdsForTag(tag) {
    return SUPPLEMENTAL_IMAGE_KEYS.map((key) => getSupplementalImageValue(tag?.custom_fields || {}, key)).filter(Boolean);
  }

  function getSupplementalImagePath(imageRecord) {
    return String(imageRecord?.paths?.thumbnail || imageRecord?.paths?.image || imageRecord?.thumbnail || imageRecord?.image_path || "").trim();
  }

  function extractDescriptionPreview(text) {
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(0, 3).join("\n");
  }

  function readTagClipboard() {
    try {
      const raw = window.localStorage.getItem(TAG_CLIPBOARD_STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      const tagIds = Array.isArray(parsed?.tagIds)
        ? parsed.tagIds.map((id) => String(id)).filter(Boolean)
        : [];
      const tags = Array.isArray(parsed?.tags)
        ? parsed.tags
            .map((tag) => ({
              id: String(tag?.id || "").trim(),
              name: String(tag?.name || "").trim(),
            }))
            .filter((tag) => tag.id && tag.name)
        : [];

      if (!tagIds.length || !tags.length) return null;

      return {
        tagIds: Array.from(new Set(tagIds)),
        tags,
        copiedAt: String(parsed?.copiedAt || ""),
      };
    } catch (err) {
      console.error("[EditTagsOverhaul] clipboard read failed", err);
      return null;
    }
  }

  function writeTagClipboard(clipboard) {
    try {
      window.localStorage.setItem(
        TAG_CLIPBOARD_STORAGE_KEY,
        JSON.stringify(clipboard)
      );
    } catch (err) {
      console.error("[EditTagsOverhaul] clipboard write failed", err);
    }
  }

  function getSortedClipboardTags(tagIds) {
    const tags = Array.from(tagIds)
      .map((tagId) => {
        const tag = state.tagMap.get(String(tagId));
        if (!tag) return null;
        return {
          id: String(tag.id),
          name: String(tag.name || ""),
          sort_name: String(tag.sort_name || tag.name || ""),
        };
      })
      .filter(Boolean);

    tags.sort((a, b) => {
      const aKey = (a.sort_name || a.name || "").toLowerCase();
      const bKey = (b.sort_name || b.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    return tags.map(({ id, name }) => ({ id, name }));
  }

  function buildClipboardPayloadFromSelection() {
    const tags = getSortedClipboardTags(state.selectedTagIds);
    if (!tags.length) return null;

    return {
      tagIds: tags.map((tag) => tag.id),
      tags,
      copiedAt: new Date().toISOString(),
    };
  }

  function getAvailableClipboardTagIds(clipboard) {
    if (!clipboard || !Array.isArray(clipboard.tagIds)) return [];
    return clipboard.tagIds.filter((tagId) => state.tagMap.has(String(tagId)));
  }

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

  function isFullscreenQuickTagPanelEnabled(cfg) {
    return getConfigBoolean(cfg?.enableFullscreenQuickTagPanel, true);
  }

  function shouldAutoOpenFullscreenQuickTagPanel(cfg) {
    return getConfigBoolean(cfg?.autoOpenFullscreenQuickTagPanel, false);
  }

  function getFullscreenButtonPosition(cfg) {
    const normalized = String(cfg?.fullscreenQuickTagButtonPosition || "bottomright")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    return ["topright", "topleft", "bottomleft", "bottomright"].includes(normalized)
      ? normalized
      : "bottomright";
  }

  function getFullscreenIdleOpacity(cfg) {
    const parsed = Number(cfg?.fullscreenQuickTagIdleOpacity);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0.1;
    return Math.min(1, Math.max(0.02, parsed));
  }

  function shouldRefreshSceneUIAfterSave(cfg) {
    return getConfigBoolean(cfg?.refreshSceneUIAfterSave, false);
  }

  function shouldUseFullscreenSharedHover(cfg) {
    return getConfigBoolean(cfg?.fullscreenQuickTagSharedHover, false);
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
            description
            image_path
            custom_fields
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
    state.tagMap = new Map(
      state.allTags.map((tag) => [
        String(tag.id),
        {
          ...tag,
          id: String(tag.id),
          description: tag.description || "",
          custom_fields: tag.custom_fields || {},
          image_path: tag.image_path || "",
        },
      ])
    );
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
    hideHoverPreview();
    state.injectedForEntityKey = null;
  }

  function getHoverPreviewHost() {
    let host = document.getElementById(HOVER_PREVIEW_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOVER_PREVIEW_ID;
    host.className = "edit-tags-overhaul-hover-preview";
    host.setAttribute("aria-hidden", "true");
    document.body.appendChild(host);
    return host;
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
    host.innerHTML =
      '<div class="edit-tags-overhaul-hover-preview__card edit-tags-overhaul-hover-preview__card--loading">Loading tag preview...</div>';
    host.classList.add("is-visible", "is-loading");
    host.setAttribute("aria-hidden", "false");
    positionHoverPreview(anchorRect);
  }

  async function ensureSupplementalImagesLoaded(imageIds = []) {
    const ids = Array.from(
      new Set(
        (imageIds || [])
          .map(normalizeSupplementalImageId)
          .filter(Boolean)
      )
    );
    if (!ids.length) return false;

    const uncached = ids.filter((imageId) => !state.supplementalImages.has(imageId));
    if (!uncached.length) return false;

    const requestKey = uncached.slice().sort().join(",");
    if (state.supplementalImagePromises.has(requestKey)) {
      return state.supplementalImagePromises.get(requestKey);
    }

    const request = gql(
      `
        query EditTagsOverhaulSupplementalImages($image_ids: [Int!]) {
          findImages(image_ids: $image_ids, filter: { per_page: -1 }) {
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
      { image_ids: uncached.map((id) => Number(id)).filter(Number.isFinite) }
    )
      .then((data) => {
        const foundMap = new Map(
          (data?.findImages?.images || []).map((image) => [String(image.id), image])
        );
        uncached.forEach((imageId) => {
          state.supplementalImages.set(imageId, foundMap.get(imageId) || null);
        });
        return true;
      })
      .catch((err) => {
        console.error("[EditTagsOverhaul] supplemental image lookup failed", err);
        uncached.forEach((imageId) => {
          state.supplementalImages.set(imageId, null);
        });
        return false;
      })
      .finally(() => {
        state.supplementalImagePromises.delete(requestKey);
      });

    state.supplementalImagePromises.set(requestKey, request);
    return request;
  }

  function renderHoverPreview(tagRecord) {
    const supplementalIds = getSupplementalImageIdsForTag(tagRecord);
    const supplemental1Path = supplementalIds[0]
      ? getSupplementalImagePath(state.supplementalImages.get(supplementalIds[0]))
      : "";
    const primaryImage = String(tagRecord?.image_path || "").trim();
    const supplemental2Path = supplementalIds[1]
      ? getSupplementalImagePath(state.supplementalImages.get(supplementalIds[1]))
      : "";

    const images = [
      supplemental1Path
        ? { path: supplemental1Path, label: "Supplemental image 1" }
        : null,
      primaryImage
        ? { path: primaryImage, label: tagRecord?.name || "Tag image" }
        : null,
      supplemental2Path
        ? { path: supplemental2Path, label: "Supplemental image 2" }
        : null,
    ].filter(Boolean);

    const description = extractDescriptionPreview(tagRecord?.description || "");

    return `
      <div class="edit-tags-overhaul-hover-preview__card">
        <div class="edit-tags-overhaul-hover-preview__title">${escapeHtml(tagRecord?.name || "Tag")}</div>
        <div class="edit-tags-overhaul-hover-preview__image-row">
          ${
            images.length
              ? images
                  .map(
                    (image) => `
                      <div class="edit-tags-overhaul-hover-preview__image-frame">
                        <img src="${escapeHtml(image.path)}" alt="${escapeHtml(image.label)}" />
                      </div>
                    `
                  )
                  .join("")
              : '<div class="edit-tags-overhaul-hover-preview__image-empty">No tag image</div>'
          }
        </div>
        ${
          description
            ? `<div class="edit-tags-overhaul-hover-preview__description">${escapeHtml(description)}</div>`
            : ""
        }
      </div>
    `;
  }

  function getTagRecordById(tagId) {
    return state.tagMap.get(String(tagId)) || null;
  }

  async function ensureHoverTagRecord(tagId) {
    let record = getTagRecordById(tagId);
    if (!record) {
      await fetchAllTags();
      record = getTagRecordById(tagId);
    }
    if (!record) return null;
    const imageIds = getSupplementalImageIdsForTag(record);
    if (imageIds.length) {
      await ensureSupplementalImagesLoaded(imageIds);
    }
    return getTagRecordById(tagId) || record;
  }

  function findHoverTagTarget(start) {
    if (!(start instanceof Element)) return null;
    const button = start.closest("[data-eto-tag-id]");
    if (!(button instanceof HTMLElement)) return null;
    const tagId = String(button.getAttribute("data-eto-tag-id") || "");
    if (!tagId) return null;
    return { anchor: button, tagId };
  }

  function handlePanelHoverIn(event) {
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

  function handlePanelHoverOut(event) {
    const activeTagId = String(state.hoverTagId || "");
    if (!activeTagId) return;
    const currentTarget = findHoverTagTarget(event.target);
    if (!currentTarget || currentTarget.tagId !== activeTagId) return;
    const related = event.relatedTarget;
    if (related instanceof Element && currentTarget.anchor.contains(related)) return;
    hideHoverPreview();
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

  function refreshNativeSceneUIAfterSave(entity) {
    if (entity?.type !== "scene") return;

    const expectedPath = `/scenes/${entity.id}`;
    if (!window.location.pathname.startsWith(expectedPath)) return;

    window.setTimeout(() => {
      if (!window.location.pathname.startsWith(expectedPath)) return;

      try {
        const cleanUrl = new URL(window.location.href);
        const refreshUrl = new URL(window.location.href);
        refreshUrl.searchParams.set("_eto_refresh", String(Date.now()));

        history.replaceState(history.state, "", refreshUrl.toString());
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));

        window.setTimeout(() => {
          if (!window.location.pathname.startsWith(expectedPath)) return;
          history.replaceState(history.state, "", cleanUrl.toString());
          window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
        }, 80);
      } catch (err) {
        console.error("[EditTagsOverhaul] scene UI refresh failed", err);
      }
    }, 50);
  }

  async function persistSelectedTagIds(nextSelectedTagIds) {
    if (!state.currentEntity || state.isSaving) return false;

    const previousSelectedTagIds = new Set(state.selectedTagIds);
    state.selectedTagIds = new Set(
      Array.from(nextSelectedTagIds).map((id) => String(id))
    );
    syncRenderedSelectionStates();

    state.isSaving = true;
    document.body.classList.add("edit-tags-overhaul--saving");
    syncClipboardActionState();

    try {
      await saveEntityTagIds(
        state.currentEntity.type,
        state.currentEntity.id,
        Array.from(state.selectedTagIds)
      );
      state.loadedSelectionEntityKey = getCurrentEntityKey(state.currentEntity);
      if (shouldRefreshSceneUIAfterSave(state.config || {})) {
        refreshNativeSceneUIAfterSave(state.currentEntity);
      }
      return true;
    } catch (err) {
      console.error("[EditTagsOverhaul] tag save failed", err);
      state.selectedTagIds = previousSelectedTagIds;
      syncRenderedSelectionStates();
      return false;
    } finally {
      state.isSaving = false;
      document.body.classList.remove("edit-tags-overhaul--saving");
      syncClipboardActionState();
    }
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

  function revealSearchResult(result, panel = document.getElementById(PANEL_ID)) {
    if (!result) return;

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
    if (!panel) return;
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
      } else {
        main.classList.add("edit-tags-overhaul__search-result-main--no-image");
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
      toggle.textContent = state.selectedTagIds.has(result.id) ? "\u2713" : "+";
      toggle.classList.toggle("is-selected", state.selectedTagIds.has(result.id));

      row.appendChild(main);
      row.appendChild(toggle);
      resultsWrap.appendChild(row);
    });
  }

  function createSearchControls() {
    const wrap = document.createElement("div");
    wrap.className = "edit-tags-overhaul__search";

    const inputRow = document.createElement("div");
    inputRow.className = "edit-tags-overhaul__search-input-row";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "edit-tags-overhaul__search-input";
    input.placeholder = "Search tags to reveal or toggle";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = state.currentSearchQuery || "";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "edit-tags-overhaul__search-clear";
    clearBtn.textContent = "x";
    clearBtn.setAttribute("aria-label", "Clear tag search");

    const results = document.createElement("div");
    results.className = "edit-tags-overhaul__search-results";

    const empty = document.createElement("div");
    empty.className = "edit-tags-overhaul__search-empty";
    empty.textContent = "No matching tags";
    empty.hidden = true;

    const updateClearState = () => {
      clearBtn.hidden = !input.value;
    };

    input.addEventListener("input", () => {
      state.currentSearchQuery = input.value || "";
      updateClearState();
      renderSearchResults(wrap.closest(".edit-tags-overhaul"));
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (input.value) {
          input.value = "";
          state.currentSearchQuery = "";
          updateClearState();
          renderSearchResults(wrap.closest(".edit-tags-overhaul"));
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

    clearBtn.addEventListener("click", () => {
      input.value = "";
      state.currentSearchQuery = "";
      updateClearState();
      renderSearchResults(wrap.closest(".edit-tags-overhaul"));
      input.focus();
    });

    updateClearState();
    inputRow.appendChild(input);
    inputRow.appendChild(clearBtn);
    wrap.appendChild(inputRow);
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

  function syncClipboardActionState(panel = document.getElementById(PANEL_ID)) {
    if (!panel) return;

    const copyBtn = panel.querySelector("[data-eto-copy-tags]");
    const pasteBtn = panel.querySelector("[data-eto-paste-tags]");
    const clipboard = readTagClipboard();
    const availableClipboardIds = getAvailableClipboardTagIds(clipboard);

    if (copyBtn) {
      const selectedCount = state.selectedTagIds.size;
      copyBtn.disabled = selectedCount === 0 || state.isSaving;
      copyBtn.textContent =
        selectedCount > 0 ? `Copy Tags (${selectedCount})` : "Copy Tags";
      copyBtn.setAttribute(
        "title",
        selectedCount > 0
          ? `Copy ${selectedCount} selected tags`
          : "Select tags to copy"
      );
    }

    if (pasteBtn) {
      pasteBtn.disabled = availableClipboardIds.length === 0 || state.isSaving;
      pasteBtn.textContent =
        availableClipboardIds.length > 0
          ? `Paste Tags (${availableClipboardIds.length})`
          : "Paste Tags";
      pasteBtn.setAttribute(
        "title",
        availableClipboardIds.length > 0
          ? `Review and paste ${availableClipboardIds.length} copied tags`
          : "No copied tags available"
      );
    }
  }

  function hidePasteModal(panel = document.getElementById(PANEL_ID)) {
    const modal = panel?.querySelector(".edit-tags-overhaul__paste-modal");
    if (modal) modal.remove();
  }

  function renderPasteModal(panel, clipboard) {
    hidePasteModal(panel);
    if (!panel || !clipboard) return;

    const availableIds = getAvailableClipboardTagIds(clipboard);
    if (!availableIds.length) return;

    const tagNameMap = new Map(
      (clipboard.tags || []).map((tag) => [String(tag.id), String(tag.name || "")])
    );
    const availableTags = availableIds
      .map((tagId) => ({
        id: String(tagId),
        name:
          tagNameMap.get(String(tagId)) ||
          String(state.tagMap.get(String(tagId))?.name || tagId),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

    const unavailableCount = Array.isArray(clipboard.tagIds)
      ? clipboard.tagIds.length - availableIds.length
      : 0;

    const overlay = document.createElement("div");
    overlay.className = "edit-tags-overhaul__paste-modal";
    overlay.innerHTML = `
      <div class="edit-tags-overhaul__paste-modal-backdrop" data-eto-paste-cancel="1"></div>
      <div class="edit-tags-overhaul__paste-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-tags-overhaul-paste-title">
        <div class="edit-tags-overhaul__paste-modal-header">
          <div>
            <div class="edit-tags-overhaul__paste-modal-title" id="edit-tags-overhaul-paste-title">Paste Tags</div>
            <div class="edit-tags-overhaul__paste-modal-subtitle">${availableTags.length} copied tags ready to paste</div>
          </div>
          <button type="button" class="edit-tags-overhaul__paste-modal-close" data-eto-paste-cancel="1" aria-label="Close paste dialog">x</button>
        </div>
        ${
          unavailableCount > 0
            ? `<div class="edit-tags-overhaul__paste-modal-note">${unavailableCount} copied tag${unavailableCount === 1 ? "" : "s"} no longer exist and will be skipped.</div>`
            : ""
        }
        <div class="edit-tags-overhaul__paste-modal-list">
          ${availableTags
            .map(
              (tag) =>
                `<div class="edit-tags-overhaul__paste-modal-tag">${escapeHtml(tag.name)}</div>`
            )
            .join("")}
        </div>
        <div class="edit-tags-overhaul__paste-modal-actions">
          <button type="button" class="edit-tags-overhaul__paste-modal-btn" data-eto-paste-cancel="1">Cancel</button>
          <button type="button" class="edit-tags-overhaul__paste-modal-btn edit-tags-overhaul__paste-modal-btn--secondary" data-eto-paste-action="merge">Merge With Tags</button>
          <button type="button" class="edit-tags-overhaul__paste-modal-btn edit-tags-overhaul__paste-modal-btn--primary" data-eto-paste-action="replace">Replace Tags</button>
        </div>
      </div>
    `;

    panel.appendChild(overlay);
  }

  function updateTagButtonState(button, attached) {
    button.classList.toggle("is-selected", attached);
    button.setAttribute("aria-pressed", attached ? "true" : "false");
  }

  function updateParentToggleState(button, attached) {
    button.classList.toggle("is-selected", attached);
    button.setAttribute("aria-pressed", attached ? "true" : "false");
    button.textContent = attached ? "\u2713" : "+";
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
      el.textContent = selected ? "\u2713" : "+";
      el.setAttribute("title", selected ? "Remove tag" : "Add tag");
      el.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    document.querySelectorAll(".edit-tags-overhaul__fullscreen-selected-count").forEach((el) => {
      const selectedCount = state.selectedTagIds.size;
      el.textContent = selectedCount > 0 ? `${selectedCount} selected` : "No tags selected";
    });

    syncClipboardActionState();
  }

  async function onTagToggleClick(tagId) {
    if (!state.currentEntity || state.isSaving) return;

    const wasSelected = state.selectedTagIds.has(tagId);
    const nextSelectedTagIds = new Set(state.selectedTagIds);
    if (wasSelected) nextSelectedTagIds.delete(tagId);
    else nextSelectedTagIds.add(tagId);

    await persistSelectedTagIds(nextSelectedTagIds);
  }

  function handleCopyTagsClick(panel) {
    const clipboard = buildClipboardPayloadFromSelection();
    if (!clipboard) return;
    writeTagClipboard(clipboard);
    hidePasteModal(panel);
    syncClipboardActionState(panel);
  }

  function handlePasteTagsClick(panel) {
    if (state.isSaving) return;
    const clipboard = readTagClipboard();
    if (!clipboard) return;
    renderPasteModal(panel, clipboard);
  }

  async function handlePasteAction(mode, panel) {
    if (state.isSaving) return;

    const clipboard = readTagClipboard();
    const availableIds = getAvailableClipboardTagIds(clipboard);
    if (!availableIds.length) {
      hidePasteModal(panel);
      syncClipboardActionState(panel);
      return;
    }

    const nextSelectedTagIds =
      mode === "replace"
        ? new Set(availableIds)
        : new Set([...state.selectedTagIds, ...availableIds]);

    const saved = await persistSelectedTagIds(nextSelectedTagIds);
    if (saved) hidePasteModal(panel);
  }

  function createParentToggleButton(tagId) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__parent-toggle-btn";
    btn.setAttribute("data-eto-parent-toggle-id", tagId);
    updateParentToggleState(btn, state.selectedTagIds.has(tagId));
    return btn;
  }

  function createFullscreenPopoutButton(groupId, groupName) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-tags-overhaul__fullscreen-popout-btn";
    btn.setAttribute("data-eto-fullscreen-popout-group-id", String(groupId));
    btn.setAttribute("aria-label", `Pop out ${groupName}`);
    btn.setAttribute("title", `Pop out ${groupName}`);
    btn.textContent = "\u21E4";
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
      getConfigBoolean(cfg.subgroupsDefaultExpanded, getConfigBoolean(cfg.defaultExpanded, false)) ||
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

    if (cfg.__fullscreenMainPanel) {
      header.appendChild(createFullscreenPopoutButton(group.parent.id, group.parent.name));
    }

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
    panel.addEventListener("mouseover", handlePanelHoverIn);
    panel.addEventListener("mouseout", handlePanelHoverOut);

    panel.addEventListener("click", (event) => {
      const copyTagsBtn = event.target.closest("[data-eto-copy-tags]");
      if (copyTagsBtn) {
        event.preventDefault();
        event.stopPropagation();
        handleCopyTagsClick(panel);
        return;
      }

      const pasteTagsBtn = event.target.closest("[data-eto-paste-tags]");
      if (pasteTagsBtn) {
        event.preventDefault();
        event.stopPropagation();
        handlePasteTagsClick(panel);
        return;
      }

      const pasteCancelBtn = event.target.closest("[data-eto-paste-cancel]");
      if (pasteCancelBtn) {
        event.preventDefault();
        event.stopPropagation();
        hidePasteModal(panel);
        return;
      }

      const pasteActionBtn = event.target.closest("[data-eto-paste-action]");
      if (pasteActionBtn) {
        event.preventDefault();
        event.stopPropagation();
        handlePasteAction(
          pasteActionBtn.getAttribute("data-eto-paste-action"),
          panel
        );
        return;
      }

      const parentToggleBtn = event.target.closest("[data-eto-parent-toggle-id]");
      if (parentToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = parentToggleBtn.getAttribute("data-eto-parent-toggle-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const tagBtn = event.target.closest("[data-eto-tag-id]");
      if (tagBtn) {
        event.preventDefault();
        const tagId = tagBtn.getAttribute("data-eto-tag-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const searchToggleBtn = event.target.closest("[data-eto-search-toggle-id]");
      if (searchToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = searchToggleBtn.getAttribute("data-eto-search-toggle-id");
        if (tagId) onTagToggleClick(tagId);
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

    const headerInfo = document.createElement("div");
    headerInfo.className = "edit-tags-overhaul__panel-header-info";
    headerInfo.appendChild(heading);
    headerInfo.appendChild(summary);

    const panelActions = document.createElement("div");
    panelActions.className = "edit-tags-overhaul__panel-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "edit-tags-overhaul__panel-btn";
    copyBtn.setAttribute("data-eto-copy-tags", "1");
    copyBtn.textContent = "Copy Tags";

    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.className = "edit-tags-overhaul__panel-btn";
    pasteBtn.setAttribute("data-eto-paste-tags", "1");
    pasteBtn.textContent = "Paste Tags";

    panelActions.appendChild(copyBtn);
    panelActions.appendChild(pasteBtn);

    titleRow.appendChild(headerInfo);
    titleRow.appendChild(panelActions);
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
    syncClipboardActionState(panel);
    return panel;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function readFullscreenLayout() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FULLSCREEN_LAYOUT_STORAGE_KEY) || "{}");
      return {
        x: Number.isFinite(Number(parsed.x)) ? Number(parsed.x) : null,
        y: Number.isFinite(Number(parsed.y)) ? Number(parsed.y) : null,
        width: Number.isFinite(Number(parsed.width)) ? Number(parsed.width) : DEFAULT_FULLSCREEN_PANEL_LAYOUT.width,
        height: Number.isFinite(Number(parsed.height)) ? Number(parsed.height) : DEFAULT_FULLSCREEN_PANEL_LAYOUT.height,
        scale: Number.isFinite(Number(parsed.scale)) ? Number(parsed.scale) : DEFAULT_FULLSCREEN_PANEL_LAYOUT.scale,
        minimized: Boolean(parsed.minimized),
      };
    } catch (err) {
      console.error("[EditTagsOverhaul] fullscreen layout read failed", err);
      return { x: null, y: null, ...DEFAULT_FULLSCREEN_PANEL_LAYOUT };
    }
  }

  function writeFullscreenLayout(layout) {
    try {
      window.localStorage.setItem(FULLSCREEN_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch (err) {
      console.error("[EditTagsOverhaul] fullscreen layout write failed", err);
    }
  }

  function clearFullscreenLayout() {
    try {
      window.localStorage.removeItem(FULLSCREEN_LAYOUT_STORAGE_KEY);
    } catch (err) {
      console.error("[EditTagsOverhaul] fullscreen layout reset failed", err);
    }
  }

  function readFullscreenMiniPanelLayouts() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FULLSCREEN_MINI_PANELS_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      console.error("[EditTagsOverhaul] fullscreen mini panel layout read failed", err);
      return {};
    }
  }

  function writeFullscreenMiniPanelLayouts(layouts) {
    try {
      window.localStorage.setItem(FULLSCREEN_MINI_PANELS_STORAGE_KEY, JSON.stringify(layouts || {}));
    } catch (err) {
      console.error("[EditTagsOverhaul] fullscreen mini panel layout write failed", err);
    }
  }

  function removeFullscreenMiniPanelLayout(groupId) {
    const layouts = readFullscreenMiniPanelLayouts();
    delete layouts[String(groupId)];
    writeFullscreenMiniPanelLayouts(layouts);
  }

  function getFullscreenViewport() {
    const fullscreenElement = document.fullscreenElement;
    const rect = fullscreenElement?.getBoundingClientRect?.();
    return {
      width: Math.max(320, Math.round(rect?.width || window.innerWidth || 1280)),
      height: Math.max(240, Math.round(rect?.height || window.innerHeight || 720)),
    };
  }

  function normalizeFullscreenLayout(layout = readFullscreenLayout()) {
    const viewport = getFullscreenViewport();
    const width = clampNumber(layout.width, 300, Math.max(300, viewport.width - 32));
    const height = clampNumber(layout.height, 240, Math.max(240, viewport.height - 32));
    const defaultX = Math.max(16, viewport.width - width - 24);
    const defaultY = Math.max(16, Math.round(viewport.height * 0.12));
    return {
      x: clampNumber(layout.x ?? defaultX, 8, Math.max(8, viewport.width - width - 8)),
      y: clampNumber(layout.y ?? defaultY, 8, Math.max(8, viewport.height - 48)),
      width,
      height,
      scale: clampNumber(layout.scale, FULLSCREEN_SCALE_STEPS[0], FULLSCREEN_SCALE_STEPS[FULLSCREEN_SCALE_STEPS.length - 1]),
      minimized: Boolean(layout.minimized),
    };
  }

  function getFullscreenPanelLayout() {
    return normalizeFullscreenLayout(readFullscreenLayout());
  }

  function normalizeFullscreenMiniPanelLayout(rawLayout = {}, index = 0) {
    const viewport = getFullscreenViewport();
    const width = clampNumber(
      rawLayout.width ?? DEFAULT_FULLSCREEN_MINI_PANEL_LAYOUT.width,
      240,
      Math.max(240, viewport.width - 32)
    );
    const height = clampNumber(
      rawLayout.height ?? DEFAULT_FULLSCREEN_MINI_PANEL_LAYOUT.height,
      180,
      Math.max(180, viewport.height - 32)
    );
    const defaultX = Math.max(16, 24 + index * 32);
    const defaultY = Math.max(16, 96 + index * 34);
    return {
      x: clampNumber(rawLayout.x ?? defaultX, 8, Math.max(8, viewport.width - width - 8)),
      y: clampNumber(rawLayout.y ?? defaultY, 8, Math.max(8, viewport.height - 48)),
      width,
      height,
    };
  }

  function persistCurrentFullscreenPanelLayout() {
    const panel = state.fullscreen.panel;
    if (!panel) return;
    const current = getFullscreenPanelLayout();
    const rect = panel.getBoundingClientRect();
    const minimized = panel.classList.contains("is-minimized");
    writeFullscreenLayout({
      ...current,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: minimized ? current.width : Math.round(rect.width),
      height: minimized ? current.height : Math.round(rect.height),
      minimized,
    });
  }

  function persistFullscreenMiniPanelLayout(groupId, panel) {
    if (!groupId || !panel) return;
    const layouts = readFullscreenMiniPanelLayouts();
    const rect = panel.getBoundingClientRect();
    layouts[String(groupId)] = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    writeFullscreenMiniPanelLayouts(layouts);
  }

  function applyFullscreenPanelLayout(panel = state.fullscreen.panel) {
    if (!panel) return;
    const layout = getFullscreenPanelLayout();
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
    panel.style.width = `${layout.width}px`;
    panel.style.height = `${layout.height}px`;
    panel.style.setProperty("--eto-fullscreen-scale", String(layout.scale));
    panel.classList.toggle("is-minimized", layout.minimized);
    updateFullscreenMinimizeButton(panel, layout.minimized);
    syncFullscreenMiniPanelScale();
  }

  function applyFullscreenSharedHoverSetting(root = state.fullscreen.root, cfg = state.config || {}) {
    root?.classList.toggle(
      "edit-tags-overhaul__fullscreen-root--shared-hover",
      shouldUseFullscreenSharedHover(cfg)
    );
  }

  function applyFullscreenMiniPanelLayout(panel, layout) {
    if (!panel) return;
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
    panel.style.width = `${layout.width}px`;
    panel.style.height = `${layout.height}px`;
    panel.style.setProperty("--eto-fullscreen-scale", String(getFullscreenPanelLayout().scale));
  }

  function syncFullscreenMiniPanelScale() {
    const scale = String(getFullscreenPanelLayout().scale);
    state.fullscreen.miniPanels.forEach((panel) => {
      panel.style.setProperty("--eto-fullscreen-scale", scale);
    });
  }

  function updateFullscreenMinimizeButton(panel, minimized) {
    const button = panel?.querySelector("[data-eto-fullscreen-minimize]");
    if (!button) return;
    button.textContent = minimized ? "\u25A1" : "\u2212";
    button.setAttribute(
      "aria-label",
      minimized ? "Expand fullscreen tag panel" : "Minimize fullscreen tag panel"
    );
    button.setAttribute("title", minimized ? "Expand" : "Minimize");
  }

  function changeFullscreenPanelScale(delta) {
    const layout = getFullscreenPanelLayout();
    const currentIndex = FULLSCREEN_SCALE_STEPS.reduce((bestIndex, step, index) => {
      return Math.abs(step - layout.scale) < Math.abs(FULLSCREEN_SCALE_STEPS[bestIndex] - layout.scale)
        ? index
        : bestIndex;
    }, 0);
    const nextIndex = clampNumber(currentIndex + delta, 0, FULLSCREEN_SCALE_STEPS.length - 1);
    writeFullscreenLayout({ ...layout, scale: FULLSCREEN_SCALE_STEPS[nextIndex] });
    applyFullscreenPanelLayout();
  }

  function setFullscreenPanelMinimized(minimized) {
    const layout = getFullscreenPanelLayout();
    writeFullscreenLayout({ ...layout, minimized });
    applyFullscreenPanelLayout();
  }

  function resetFullscreenPanelLayout() {
    clearFullscreenLayout();
    applyFullscreenPanelLayout();
  }

  function startFullscreenPanelDrag(event) {
    const panel = event.target.closest(".edit-tags-overhaul--fullscreen-panel");
    if (!panel || event.button !== 0 || event.target.closest("button, input, a")) return;

    const rect = panel.getBoundingClientRect();
    state.fullscreen.dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      panel,
      groupId: panel.getAttribute("data-eto-fullscreen-mini-group-id") || "",
    };

    panel.setPointerCapture?.(event.pointerId);
    panel.classList.add("is-dragging");
    event.preventDefault();
  }

  function handleFullscreenPanelDrag(event) {
    const drag = state.fullscreen.dragState;
    const panel = drag?.panel;
    if (!drag || !panel || event.pointerId !== drag.pointerId) return;

    const viewport = getFullscreenViewport();
    const x = clampNumber(event.clientX - drag.offsetX, 8, Math.max(8, viewport.width - drag.width - 8));
    const y = clampNumber(event.clientY - drag.offsetY, 8, Math.max(8, viewport.height - 48));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  function stopFullscreenPanelDrag(event) {
    const drag = state.fullscreen.dragState;
    const panel = drag?.panel;
    if (!drag || !panel || event.pointerId !== drag.pointerId) return;

    panel.releasePointerCapture?.(event.pointerId);
    panel.classList.remove("is-dragging");
    state.fullscreen.dragState = null;
    if (drag.groupId) persistFullscreenMiniPanelLayout(drag.groupId, panel);
    else persistCurrentFullscreenPanelLayout();
  }

  function attachFullscreenPanelEventDelegation(panel) {
    panel.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-eto-fullscreen-drag]")) startFullscreenPanelDrag(event);
    });
    panel.addEventListener("pointermove", handleFullscreenPanelDrag);
    panel.addEventListener("pointerup", stopFullscreenPanelDrag);
    panel.addEventListener("pointercancel", stopFullscreenPanelDrag);

    panel.addEventListener("click", (event) => {
      const minimizeBtn = event.target.closest("[data-eto-fullscreen-minimize]");
      if (minimizeBtn) {
        event.preventDefault();
        event.stopPropagation();
        setFullscreenPanelMinimized(!panel.classList.contains("is-minimized"));
        minimizeBtn.blur?.();
        return;
      }

      const scaleBtn = event.target.closest("[data-eto-fullscreen-scale]");
      if (scaleBtn) {
        event.preventDefault();
        event.stopPropagation();
        changeFullscreenPanelScale(Number(scaleBtn.getAttribute("data-eto-fullscreen-scale")) || 0);
        scaleBtn.blur?.();
        return;
      }

      const resetBtn = event.target.closest("[data-eto-fullscreen-reset]");
      if (resetBtn) {
        event.preventDefault();
        event.stopPropagation();
        resetFullscreenPanelLayout();
        resetBtn.blur?.();
        return;
      }

      const popoutBtn = event.target.closest("[data-eto-fullscreen-popout-group-id]");
      if (popoutBtn) {
        event.preventDefault();
        event.stopPropagation();
        openFullscreenMiniPanel(popoutBtn.getAttribute("data-eto-fullscreen-popout-group-id"));
        popoutBtn.blur?.();
        return;
      }

      const miniCloseBtn = event.target.closest("[data-eto-fullscreen-mini-close]");
      if (miniCloseBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeFullscreenMiniPanel(miniCloseBtn.getAttribute("data-eto-fullscreen-mini-close"), true);
        miniCloseBtn.blur?.();
        return;
      }

      if (panel.classList.contains("is-minimized") && event.target.closest("[data-eto-fullscreen-drag]")) {
        event.preventDefault();
        setFullscreenPanelMinimized(false);
        return;
      }

      const parentToggleBtn = event.target.closest("[data-eto-parent-toggle-id]");
      if (parentToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = parentToggleBtn.getAttribute("data-eto-parent-toggle-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const tagBtn = event.target.closest("[data-eto-tag-id]");
      if (tagBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = tagBtn.getAttribute("data-eto-tag-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const searchToggleBtn = event.target.closest("[data-eto-search-toggle-id]");
      if (searchToggleBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tagId = searchToggleBtn.getAttribute("data-eto-search-toggle-id");
        if (tagId) onTagToggleClick(tagId);
        return;
      }

      const searchJumpBtn = event.target.closest("[data-eto-search-jump-id]");
      if (searchJumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        revealSearchResult(
          {
            id: searchJumpBtn.getAttribute("data-eto-search-jump-id"),
            targetId: searchJumpBtn.getAttribute("data-eto-search-target-id"),
            targetKind: searchJumpBtn.getAttribute("data-eto-search-target-kind"),
            groupId: searchJumpBtn.getAttribute("data-eto-search-group-id"),
            subgroupId: searchJumpBtn.getAttribute("data-eto-search-subgroup-id") || "",
          },
          panel
        );
        return;
      }

      const toggleHeader = event.target.closest("[data-eto-toggle-section]");
      if (toggleHeader) {
        event.preventDefault();
        event.stopPropagation();
        const section = toggleHeader.closest(".edit-tags-overhaul__group, .edit-tags-overhaul__subgroup");
        if (section) section.classList.toggle("is-open");
      }
    });
  }

  function getFullscreenGroupById(groupId) {
    return state.fullscreen.groupMap.get(String(groupId)) || null;
  }

  function createFullscreenMiniPanel(group, cfg, layout) {
    const groupId = String(group.parent.id);
    const panel = document.createElement("section");
    panel.className = "edit-tags-overhaul edit-tags-overhaul--fullscreen-panel edit-tags-overhaul--fullscreen-mini-panel";
    panel.setAttribute("data-eto-fullscreen-mini-group-id", groupId);
    applyPanelVariables(panel, cfg);
    panel.style.setProperty("--eto-fullscreen-idle-opacity", String(getFullscreenIdleOpacity(cfg)));

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__fullscreen-header";
    header.setAttribute("data-eto-fullscreen-drag", "1");

    const titleWrap = document.createElement("div");
    titleWrap.className = "edit-tags-overhaul__fullscreen-title-wrap";

    const title = document.createElement("div");
    title.className = "edit-tags-overhaul__fullscreen-title";
    title.textContent = group.parent.name;

    titleWrap.appendChild(title);

    const controls = document.createElement("div");
    controls.className = "edit-tags-overhaul__fullscreen-controls";
    controls.innerHTML = `
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-mini-close="${escapeHtml(groupId)}" aria-label="Collapse ${escapeHtml(group.parent.name)} back to main panel" title="Collapse to main panel">−</button>
    `;

    header.appendChild(titleWrap);
    header.appendChild(controls);
    panel.appendChild(header);

    const content = document.createElement("div");
    content.className = "edit-tags-overhaul__fullscreen-content";

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "edit-tags-overhaul__groups edit-tags-overhaul__fullscreen-groups";
    groupsWrap.appendChild(createGroupSection(group, {
      ...cfg,
      defaultExpanded: true,
      subgroupsDefaultExpanded: false,
      autoExpandIfSelected: false,
      __fullscreenMainPanel: false,
    }));
    content.appendChild(groupsWrap);
    panel.appendChild(content);

    attachFullscreenPanelEventDelegation(panel);
    applyFullscreenMiniPanelLayout(panel, layout);
    announceFullscreenPanel(panel);
    return panel;
  }

  function announceFullscreenPanel(panel) {
    panel.classList.add("is-new", "edit-tags-overhaul__search-target-flash");
    window.setTimeout(() => {
      panel.classList.remove("is-new", "edit-tags-overhaul__search-target-flash");
    }, 3000);
  }

  function openFullscreenMiniPanel(groupId, layoutOverride = null, persist = true) {
    const normalizedGroupId = String(groupId || "");
    const group = getFullscreenGroupById(normalizedGroupId);
    if (!group || !state.fullscreen.root) return null;

    const existingPanel = state.fullscreen.miniPanels.get(normalizedGroupId);
    if (existingPanel) {
      announceFullscreenPanel(existingPanel);
      return existingPanel;
    }

    const cfg = {
      ...(state.config || {}),
      displayMode: "text",
      defaultExpanded: true,
      subgroupsDefaultExpanded: false,
      autoExpandIfSelected: false,
    };
    const panelIndex = state.fullscreen.miniPanels.size;
    const layout = normalizeFullscreenMiniPanelLayout(layoutOverride || {}, panelIndex);
    const panel = createFullscreenMiniPanel(group, cfg, layout);

    state.fullscreen.root.appendChild(panel);
    state.fullscreen.miniPanels.set(normalizedGroupId, panel);

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => persistFullscreenMiniPanelLayout(normalizedGroupId, panel));
      observer.observe(panel);
      state.fullscreen.miniResizeObservers.set(normalizedGroupId, observer);
    }

    if (persist) persistFullscreenMiniPanelLayout(normalizedGroupId, panel);
    syncRenderedSelectionStates();
    return panel;
  }

  function closeFullscreenMiniPanel(groupId, forgetLayout = false) {
    const normalizedGroupId = String(groupId || "");
    const observer = state.fullscreen.miniResizeObservers.get(normalizedGroupId);
    observer?.disconnect();
    state.fullscreen.miniResizeObservers.delete(normalizedGroupId);

    state.fullscreen.miniPanels.get(normalizedGroupId)?.remove();
    state.fullscreen.miniPanels.delete(normalizedGroupId);

    if (forgetLayout) removeFullscreenMiniPanelLayout(normalizedGroupId);
  }

  function closeFullscreenMiniPanels() {
    Array.from(state.fullscreen.miniPanels.keys()).forEach((groupId) => {
      closeFullscreenMiniPanel(groupId, false);
    });
  }

  function restoreFullscreenMiniPanels() {
    const cfg = state.config || {};
    if (!shouldAutoOpenFullscreenQuickTagPanel(cfg)) return;

    const layouts = readFullscreenMiniPanelLayouts();
    Object.entries(layouts).forEach(([groupId, layout], index) => {
      openFullscreenMiniPanel(groupId, normalizeFullscreenMiniPanelLayout(layout, index), false);
    });
  }

  function createFullscreenPanel(groups, cfg) {
    const panel = document.createElement("section");
    panel.className = "edit-tags-overhaul edit-tags-overhaul--fullscreen-panel";
    applyPanelVariables(panel, cfg);
    panel.style.setProperty("--eto-fullscreen-idle-opacity", String(getFullscreenIdleOpacity(cfg)));

    const header = document.createElement("div");
    header.className = "edit-tags-overhaul__fullscreen-header";
    header.setAttribute("data-eto-fullscreen-drag", "1");

    const titleWrap = document.createElement("div");
    titleWrap.className = "edit-tags-overhaul__fullscreen-title-wrap";

    const title = document.createElement("div");
    title.className = "edit-tags-overhaul__fullscreen-title";
    title.textContent = "Quick Tags";

    const selectedCount = document.createElement("div");
    selectedCount.className = "edit-tags-overhaul__fullscreen-selected-count";
    selectedCount.textContent = state.selectedTagIds.size > 0 ? `${state.selectedTagIds.size} selected` : "No tags selected";

    titleWrap.appendChild(title);
    titleWrap.appendChild(selectedCount);

    const controls = document.createElement("div");
    controls.className = "edit-tags-overhaul__fullscreen-controls";
    controls.innerHTML = `
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-scale="-1" aria-label="Decrease panel scale">A-</button>
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-scale="1" aria-label="Increase panel scale">A+</button>
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-reset="1" aria-label="Reset fullscreen tag panel layout" title="Reset layout">↺</button>
      <button type="button" class="edit-tags-overhaul__fullscreen-control" data-eto-fullscreen-minimize="1" aria-label="Minimize fullscreen tag panel" title="Minimize">−</button>
    `;

    header.appendChild(titleWrap);
    header.appendChild(controls);
    panel.appendChild(header);

    const content = document.createElement("div");
    content.className = "edit-tags-overhaul__fullscreen-content";
    content.appendChild(createSearchControls());

    const groupsWrap = document.createElement("div");
    groupsWrap.className = "edit-tags-overhaul__groups edit-tags-overhaul__fullscreen-groups";
    groups.forEach((group) => {
      groupsWrap.appendChild(createGroupSection(group, cfg));
    });
    content.appendChild(groupsWrap);
    panel.appendChild(content);

    attachFullscreenPanelEventDelegation(panel);
    renderSearchResults(panel);

    return panel;
  }

  function getFullscreenSceneEntity() {
    if (!document.fullscreenElement) return null;
    const entity = getEntityFromPath(window.location.pathname);
    return entity?.type === "scene" ? entity : null;
  }

  async function buildFullscreenPanel() {
    if (state.fullscreen.isBuilding || !state.fullscreen.root) return;
    const entity = getFullscreenSceneEntity();
    if (!entity) return;

    state.fullscreen.isBuilding = true;
    try {
      const entityKey = getCurrentEntityKey(entity);
      state.currentEntity = entity;
      const [cfg, allTags] = await Promise.all([loadConfig(), fetchAllTags()]);
      await ensureSelectedTagIds(entity);

      if (!state.fullscreen.root || !document.fullscreenElement) return;

      const fullscreenCfg = {
        ...cfg,
        displayMode: "text",
        defaultExpanded: getConfigBoolean(cfg.defaultExpanded, false),
        __fullscreenMainPanel: true,
      };
      const groups = buildNestedGroupsPreservingOrder(allTags, fullscreenCfg);
      state.fullscreen.groups = groups;
      state.fullscreen.groupMap = new Map(groups.map((group) => [String(group.parent.id), group]));
      state.searchIndex = buildSearchIndex(allTags, fullscreenCfg);
      const panel = createFullscreenPanel(groups, fullscreenCfg);

      closeFullscreenMiniPanels();
      state.fullscreen.panel?.remove();
      state.fullscreen.panel = panel;
      state.fullscreen.entityKey = entityKey;
      state.fullscreen.root.appendChild(panel);
      applyFullscreenPanelLayout(panel);
      syncRenderedSelectionStates();
      restoreFullscreenMiniPanels();

      if (window.ResizeObserver) {
        state.fullscreen.resizeObserver?.disconnect();
        state.fullscreen.resizeObserver = new ResizeObserver(() => persistCurrentFullscreenPanelLayout());
        state.fullscreen.resizeObserver.observe(panel);
      }
    } catch (err) {
      console.error("[EditTagsOverhaul] fullscreen quick tag panel failed", err);
    } finally {
      state.fullscreen.isBuilding = false;
    }
  }

  function closeFullscreenPanel() {
    state.fullscreen.resizeObserver?.disconnect();
    state.fullscreen.resizeObserver = null;
    closeFullscreenMiniPanels();
    state.fullscreen.panel?.remove();
    state.fullscreen.panel = null;
    state.fullscreen.entityKey = "";
    state.fullscreen.groups = [];
    state.fullscreen.groupMap = new Map();
  }

  function createFullscreenLauncher() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "edit-tags-overhaul__fullscreen-launcher";
    button.textContent = "Tags";
    button.setAttribute("aria-label", "Open fullscreen quick tag panel");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.fullscreen.panel) closeFullscreenPanel();
      else buildFullscreenPanel();
    });
    return button;
  }

  function cleanupFullscreenOverlay() {
    closeFullscreenPanel();
    state.fullscreen.root?.remove();
    state.fullscreen.root = null;
    state.fullscreen.launcher = null;
    state.fullscreen.dragState = null;
  }

  async function syncFullscreenOverlay() {
    const fullscreenElement = document.fullscreenElement;
    const entity = getFullscreenSceneEntity();
    const cfg = await loadConfig();
    if (!fullscreenElement || !entity || !isFullscreenQuickTagPanelEnabled(cfg)) {
      cleanupFullscreenOverlay();
      return;
    }

    if (state.fullscreen.root?.parentElement !== fullscreenElement) {
      cleanupFullscreenOverlay();
      const root = document.createElement("div");
      root.className = "edit-tags-overhaul__fullscreen-root";
      const launcher = createFullscreenLauncher();
      launcher.classList.add(`edit-tags-overhaul__fullscreen-launcher--${getFullscreenButtonPosition(cfg)}`);
      root.appendChild(launcher);
      fullscreenElement.appendChild(root);
      state.fullscreen.root = root;
      state.fullscreen.launcher = root.querySelector(".edit-tags-overhaul__fullscreen-launcher");
      applyFullscreenSharedHoverSetting(root, cfg);
      if (shouldAutoOpenFullscreenQuickTagPanel(cfg)) {
        await buildFullscreenPanel();
      }
    } else {
      applyFullscreenSharedHoverSetting(state.fullscreen.root, cfg);
    }
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
    hideHoverPreview();

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
    const hookState = window[ROUTE_HOOK_STATE_KEY] || {};
    window[ROUTE_HOOK_STATE_KEY] = hookState;

    if (hookState.installed) return;
    hookState.installed = true;

    const dispatchRouteEvent = () => {
      window.dispatchEvent(new Event(ROUTE_EVENT));
    };

    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function patchedEditTagsOverhaulHistoryMethod(...args) {
        const result = original.apply(this, args);
        setTimeout(dispatchRouteEvent, 0);
        return result;
      };
    });

    hookState.popstateListener = () => {
      setTimeout(dispatchRouteEvent, 0);
    };
    window.addEventListener("popstate", hookState.popstateListener);
  }

  function installTabClickHook() {
    state.tabClickListener = (event) => {
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
    };

    document.addEventListener("click", state.tabClickListener);
  }

  function handleRouteEvent() {
    handleRouteChange();
    scheduleRouteInjects();
    syncFullscreenOverlay().catch((err) => {
      console.error("[EditTagsOverhaul] fullscreen overlay sync failed", err);
    });
  }

  function cleanup() {
    state.scheduledRouteToken += 1;
    state.injectToken += 1;
    hideHoverPreview();
    cleanupPanel();
    cleanupFullscreenOverlay();
    removeHideOriginalStyle();

    if (state.routeEventListener) {
      window.removeEventListener(ROUTE_EVENT, state.routeEventListener);
      state.routeEventListener = null;
    }
    if (state.tabClickListener) {
      document.removeEventListener("click", state.tabClickListener);
      state.tabClickListener = null;
    }
    if (state.scrollListener) {
      window.removeEventListener("scroll", state.scrollListener, true);
      state.scrollListener = null;
    }
    if (state.resizeListener) {
      window.removeEventListener("resize", state.resizeListener);
      state.resizeListener = null;
    }
    if (state.fullscreenChangeListener) {
      document.removeEventListener("fullscreenchange", state.fullscreenChangeListener);
      state.fullscreenChangeListener = null;
    }

    if (window[CLEANUP_KEY] === cleanup) window[CLEANUP_KEY] = null;
  }

  function init() {
    if (typeof window[CLEANUP_KEY] === "function") {
      window[CLEANUP_KEY]();
    }
    window[CLEANUP_KEY] = cleanup;

    installHistoryHooks();
    state.routeEventListener = handleRouteEvent;
    window.addEventListener(ROUTE_EVENT, state.routeEventListener);

    installTabClickHook();
    state.scrollListener = hideHoverPreview;
    state.resizeListener = hideHoverPreview;
    state.fullscreenChangeListener = () => {
      syncFullscreenOverlay().catch((err) => {
        console.error("[EditTagsOverhaul] fullscreen overlay sync failed", err);
      });
    };
    window.addEventListener("scroll", state.scrollListener, true);
    window.addEventListener("resize", state.resizeListener);
    document.addEventListener("fullscreenchange", state.fullscreenChangeListener);
    handleRouteChange();
    scheduleRouteInjects();
    syncFullscreenOverlay().catch((err) => {
      console.error("[EditTagsOverhaul] fullscreen overlay sync failed", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
