(function () {
  "use strict";

  const PLUGIN_ID = "SimpleRightClickTagging";
  const MENU_ID = "simple-right-click-tagging-menu";
  const MODAL_ID = "simple-right-click-tagging-modal";
  const HOVER_PREVIEW_ID = "simple-right-click-tagging-hover-preview";
  const QUICK_TOAST_ID = "simple-right-click-tagging-quick-toast";
  const RECENT_QUICK_ACTIONS_KEY = "SimpleRightClickTagging.recentQuickActions.v1";
  const METADATA_CLIPBOARD_KEY = "SimpleRightClickTagging.metadataClipboard.v1";
  const PREVIOUS_ACTION_KEY = "SimpleRightClickTagging.previousAction.v1";
  const RECENT_QUICK_ACTION_LIMIT = 10;
  const ROUTE_REFRESH_DELAYS = [0, 150, 400, 900];
  const ACCESS_MODE_RIGHT_CLICK = "rightclick";
  const ACCESS_MODE_HOVER_ZONE = "hoverzone";
  const HOVER_ZONE_RIGHT_START = 2 / 3;
  const HOVER_MENU_CLOSE_DELAY_MS = 120;
  const SUPPLEMENTAL_IMAGE_KEYS = [
    "ctm_supplemental_image_1",
    "ctm_supplemental_image_2",
  ];

  const state = {
    config: null,
    allTags: null,
    tagMap: new Map(),
    searchIndex: null,
    currentItemType: "image",
    currentImageId: "",
    currentImageIds: [],
    workingImageIds: new Set(),
    currentMode: "",
    selectedTagIds: new Set(),
    selectedPerformers: [],
    selectedStudio: null,
    selectedStudioMixed: false,
    imagePreviewCache: new Map(),
    imageTagIdsByImageId: new Map(),
    imagePerformersByImageId: new Map(),
    imageStudiosByImageId: new Map(),
    imageMetadataByImageId: new Map(),
    performerCustomFieldsById: new Map(),
    suppressNextQueueClick: false,
    isSaving: false,
    performerSearchTimer: 0,
    studioSearchTimer: 0,
    quickAccessToastTimer: 0,
    quickSearchTimers: new Map(),
    recentQuickActions: null,
    metadataClipboard: null,
    previousAction: null,
    supplementalImages: new Map(),
    supplementalImagePromises: new Map(),
    hoverTagId: "",
    hoverAnchorRect: null,
    hoverMenuCard: null,
    hoverMenuCloseTimer: 0,
    routeToken: 0,
  };

  function gql(query, variables = {}) {
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

  function getConfigBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return fallback;
  }

  function getAccessMode(cfg = state.config) {
    const value = String(cfg?.menuAccessMode || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, "");
    return value === ACCESS_MODE_HOVER_ZONE ? ACCESS_MODE_HOVER_ZONE : ACCESS_MODE_RIGHT_CLICK;
  }

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
    return SUPPLEMENTAL_IMAGE_KEYS.map((key) =>
      getSupplementalImageValue(tag?.custom_fields || {}, key)
    ).filter(Boolean);
  }

  function getSupplementalImagePath(imageRecord) {
    return String(
      imageRecord?.paths?.thumbnail ||
        imageRecord?.paths?.image ||
        imageRecord?.thumbnail ||
        imageRecord?.image_path ||
        ""
    ).trim();
  }

  function extractDescriptionPreview(text) {
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(0, 3).join("\n");
  }

  async function loadConfig() {
    if (state.config) return state.config;

    try {
      const data = await gql(`
        query SimpleRightClickTaggingConfig {
          configuration {
            plugins
          }
        }
      `);
      state.config = data?.configuration?.plugins?.[PLUGIN_ID] || {};
    } catch (err) {
      console.error("[SimpleRightClickTagging] config load failed", err);
      state.config = {};
    }

    return state.config;
  }

  function getSelectedBorderColor(cfg) {
    const value = String(cfg?.selectedBorderColor || "").trim();
    return value || "#ffffff";
  }

  function parseQuickAccessList(value) {
    return Array.from(
      new Set(
        String(value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }

  function parseIdList(value) {
    return parseQuickAccessList(value).map((item) => String(item).replace(/[^\d]/g, "")).filter(Boolean);
  }

  function normalizeSavedRecord(record) {
    if (!record?.id || !record?.name) return null;
    return {
      id: String(record.id),
      name: String(record.name),
      sort_name: String(record.sort_name || record.name || ""),
      image_path: String(record.image_path || ""),
    };
  }

  function getCustomFieldPresetNames(cfg = state.config) {
    return parseQuickAccessList(cfg?.customFieldPresets);
  }

  function getMissingMetadataFlags(itemType, cfg = state.config) {
    const flags = [
      {
        key: "needs-tags",
        label: "Needs tags",
        tagId: String(cfg?.missingTagsTagId || "").replace(/[^\d]/g, ""),
      },
      {
        key: "needs-review",
        label: "Needs review",
        tagId: String(cfg?.needsReviewTagId || "").replace(/[^\d]/g, ""),
      },
    ];
    if (itemType !== "performer") {
      flags.splice(1, 0, {
        key: "needs-performer",
        label: "Needs performer",
        tagId: String(cfg?.missingPerformersTagId || "").replace(/[^\d]/g, ""),
      });
      flags.splice(2, 0, {
        key: "needs-studio",
        label: "Needs studio",
        tagId: String(cfg?.missingStudioTagId || "").replace(/[^\d]/g, ""),
      });
    }
    return flags.filter((flag) => flag.tagId);
  }

  function parsePresetPart(part) {
    const match = String(part || "").match(/^\s*([^:=]+)\s*[:=]\s*(.*?)\s*$/);
    if (!match) return null;
    return {
      key: match[1].trim().toLowerCase().replace(/[\s_-]/g, ""),
      value: match[2].trim(),
    };
  }

  function parseQuickAccessPreset(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const parts = raw
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    const preset = {
      label: "",
      tags: [],
      performers: [],
      studio: "",
    };

    parts.forEach((part, index) => {
      const parsed = parsePresetPart(part);
      if (!parsed) {
        if (index === 0 && !preset.label) preset.label = part;
        return;
      }

      if (parsed.key === "name" || parsed.key === "label") {
        preset.label = parsed.value;
      } else if (parsed.key === "tag" || parsed.key === "tags") {
        preset.tags = parseQuickAccessList(parsed.value);
      } else if (parsed.key === "performer" || parsed.key === "performers") {
        preset.performers = parseQuickAccessList(parsed.value);
      } else if (parsed.key === "studio") {
        preset.studio = parseQuickAccessList(parsed.value)[0] || parsed.value;
      }
    });

    if (!preset.label) preset.label = parts[0] || "Preset";
    if (!preset.tags.length && !preset.performers.length && !preset.studio) return null;
    return preset;
  }

  function getQuickAccessPresets(itemType, cfg = state.config) {
    return [
      parseQuickAccessPreset(cfg?.quickAccessPreset1),
      parseQuickAccessPreset(cfg?.quickAccessPreset2),
      parseQuickAccessPreset(cfg?.quickAccessPreset3),
    ].filter((preset) => {
      if (!preset) return false;
      if (itemType === "performer") return preset.tags.length > 0;
      return true;
    });
  }

  function getQuickAccessItems(itemType, cfg = state.config) {
    const items = [];
    if (itemType !== "performer") {
      parseQuickAccessList(cfg?.quickAccessPerformers).forEach((name) => {
        items.push({ kind: "performer", name, label: `+ Performer: ${name}` });
      });
      parseQuickAccessList(cfg?.quickAccessStudios).forEach((name) => {
        items.push({ kind: "studio", name, label: `Set Studio: ${name}` });
      });
    }
    parseQuickAccessList(cfg?.quickAccessTags).forEach((name) => {
      items.push({ kind: "tag", name, label: `+ Tag: ${name}` });
    });
    return items;
  }

  function getEmptyRecentQuickActions() {
    return { tag: [], performer: [], studio: [] };
  }

  function loadRecentQuickActions() {
    if (state.recentQuickActions) return state.recentQuickActions;
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_QUICK_ACTIONS_KEY) || "{}");
      state.recentQuickActions = {
        ...getEmptyRecentQuickActions(),
        tag: Array.isArray(parsed.tag) ? parsed.tag : [],
        performer: Array.isArray(parsed.performer) ? parsed.performer : [],
        studio: Array.isArray(parsed.studio) ? parsed.studio : [],
      };
    } catch (err) {
      state.recentQuickActions = getEmptyRecentQuickActions();
    }
    return state.recentQuickActions;
  }

  function saveRecentQuickActions() {
    if (!state.recentQuickActions) return;
    try {
      localStorage.setItem(RECENT_QUICK_ACTIONS_KEY, JSON.stringify(state.recentQuickActions));
    } catch (err) {
      console.warn("[SimpleRightClickTagging] recent quick action save failed", err);
    }
  }

  function loadSavedJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn("[SimpleRightClickTagging] saved data load failed", err);
      return null;
    }
  }

  function saveJson(key, value) {
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch (err) {
      console.warn("[SimpleRightClickTagging] saved data write failed", err);
    }
  }

  function loadMetadataClipboard() {
    if (state.metadataClipboard) return state.metadataClipboard;
    state.metadataClipboard = loadSavedJson(METADATA_CLIPBOARD_KEY);
    return state.metadataClipboard;
  }

  function saveMetadataClipboard(clipboard) {
    state.metadataClipboard = clipboard || null;
    saveJson(METADATA_CLIPBOARD_KEY, state.metadataClipboard);
  }

  function loadPreviousAction() {
    if (state.previousAction) return state.previousAction;
    state.previousAction = loadSavedJson(PREVIOUS_ACTION_KEY);
    return state.previousAction;
  }

  function savePreviousAction(action) {
    state.previousAction = action || null;
    saveJson(PREVIOUS_ACTION_KEY, state.previousAction);
  }

  function getClipboardSummary(clipboard = loadMetadataClipboard()) {
    if (!clipboard) return "Empty";
    const parts = [];
    if (clipboard.tags?.length) parts.push(`${clipboard.tags.length} tags`);
    if (clipboard.performers?.length) parts.push(`${clipboard.performers.length} performers`);
    if (clipboard.studio?.name) parts.push(`Studio: ${clipboard.studio.name}`);
    return parts.length ? parts.join(" / ") : "No copied metadata";
  }

  function hasClipboardData(clipboard = loadMetadataClipboard()) {
    return !!(
      clipboard?.tags?.length ||
      clipboard?.performers?.length ||
      clipboard?.studio?.id
    );
  }

  function canPasteClipboardKind(kind, clipboard = loadMetadataClipboard()) {
    if (!clipboard) return false;
    if (kind === "tags") return !!clipboard.tags?.length;
    if (kind === "performers") return !!clipboard.performers?.length;
    if (kind === "studio") return !!clipboard.studio?.id;
    if (kind === "all") return hasClipboardData(clipboard);
    return false;
  }

  function getPreviousActionSummary(action = loadPreviousAction()) {
    if (!action) return "None";
    if (action.type === "quick") {
      return `${action.remove ? "Remove" : action.kind === "studio" ? "Set" : "Add"} ${action.kind}: ${action.record?.name || ""}`;
    }
    if (action.type === "preset") return `Preset: ${action.preset?.label || "Preset"}`;
    if (action.type === "paste") return `Paste ${getMetadataKindLabel(action.pasteKind)}`;
    if (action.type === "clear") return `Clear ${getMetadataKindLabel(action.clearKind)}`;
    if (action.type === "flag") return `Flag: ${action.label || "metadata flag"}`;
    if (action.type === "metadata") return action.label || "Metadata update";
    return "Previous action";
  }

  function getMetadataKindLabel(kind) {
    const labels = {
      all: "all metadata",
      date: "date",
      performers: "performers",
      rating: "rating",
      studio: "studio",
      tags: "tags",
    };
    return labels[kind] || String(kind || "metadata");
  }

  function recordRecentQuickAction(kind, record) {
    if (!["tag", "performer", "studio"].includes(kind) || !record?.id || !record?.name) return;
    const recents = loadRecentQuickActions();
    const nextRecord = {
      id: String(record.id),
      name: String(record.name),
      sort_name: String(record.sort_name || record.name || ""),
      image_path: String(record.image_path || ""),
    };
    recents[kind] = [
      nextRecord,
      ...recents[kind].filter((item) => String(item.id) !== nextRecord.id),
    ].slice(0, RECENT_QUICK_ACTION_LIMIT);
    saveRecentQuickActions();
  }

  function getRecentQuickAccessItems(itemType) {
    const recents = loadRecentQuickActions();
    const items = recents.tag.map((item) => ({ kind: "tag", item }));
    if (itemType !== "performer") {
      recents.performer.forEach((item) => items.push({ kind: "performer", item }));
      recents.studio.forEach((item) => items.push({ kind: "studio", item }));
    }
    return items;
  }

  function applyPanelVariables(panel, cfg) {
    panel.style.setProperty("--srct-selected-border-color", getSelectedBorderColor(cfg));
  }

  function getImageIdFromCard(card) {
    if (!(card instanceof Element)) return "";
    const link = card.querySelector('a[href*="/images/"]');
    const href = String(link?.getAttribute("href") || "");
    const match = href.match(/\/images\/(\d+)/);
    return match ? match[1] : "";
  }

  function getSceneIdFromCard(card) {
    if (!(card instanceof Element)) return "";
    const link = card.querySelector('a[href*="/scenes/"]');
    const href = String(link?.getAttribute("href") || "");
    const match = href.match(/\/scenes\/(\d+)/);
    return match ? match[1] : "";
  }

  function getPerformerIdFromCard(card) {
    if (!(card instanceof Element)) return "";
    const link = card.querySelector('a[href*="/performers/"]');
    const href = String(link?.getAttribute("href") || "");
    const match = href.match(/\/performers\/(\d+)/);
    return match ? match[1] : "";
  }

  function getItemIdFromCard(card, itemType) {
    if (itemType === "scene") return getSceneIdFromCard(card);
    if (itemType === "performer") return getPerformerIdFromCard(card);
    return getImageIdFromCard(card);
  }

  function getCardSelector(itemType) {
    if (itemType === "scene") return ".scene-card";
    if (itemType === "performer") return ".performer-card";
    return ".image-card";
  }

  function getItemLabel(itemType, count = 1) {
    const singular =
      itemType === "scene" ? "scene" : itemType === "performer" ? "performer" : "image";
    return count === 1 ? singular : `${singular}s`;
  }

  function getItemTitleLabel(itemType) {
    if (itemType === "scene") return "Scene";
    if (itemType === "performer") return "Performer";
    return "Image";
  }

  function getImageCardFromEventTarget(target) {
    if (!(target instanceof Element)) return null;
    const card = target.closest(".image-card");
    if (!(card instanceof HTMLElement)) return null;
    return getImageIdFromCard(card) ? card : null;
  }

  function getSceneCardFromEventTarget(target) {
    if (!(target instanceof Element)) return null;
    const card = target.closest(".scene-card");
    if (!(card instanceof HTMLElement)) return null;
    return getSceneIdFromCard(card) ? card : null;
  }

  function getPerformerCardFromEventTarget(target) {
    if (!(target instanceof Element)) return null;
    const card = target.closest(".performer-card");
    if (!(card instanceof HTMLElement)) return null;
    return getPerformerIdFromCard(card) ? card : null;
  }

  function getContextCardFromEventTarget(target) {
    const imageCard = getImageCardFromEventTarget(target);
    if (imageCard) return { itemType: "image", card: imageCard };

    const sceneCard = getSceneCardFromEventTarget(target);
    if (sceneCard) return { itemType: "scene", card: sceneCard };

    const performerCard = getPerformerCardFromEventTarget(target);
    if (performerCard) return { itemType: "performer", card: performerCard };

    return null;
  }

  function normalizeImageIds(imageIds) {
    const values = Array.isArray(imageIds) ? imageIds : [imageIds];
    return Array.from(
      new Set(values.map((id) => String(id || "").trim()).filter(Boolean))
    );
  }

  function isCardSelected(card) {
    if (!(card instanceof Element)) return false;
    if (
      card.matches(
        ".selected, .is-selected, .card-selected, .active, [aria-selected='true'], [data-selected='true']"
      )
    ) {
      return true;
    }
    if (card.querySelector("input[type='checkbox']:checked")) return true;
    if (
      card.querySelector(
        ".selected, .is-selected, .card-selected, [aria-selected='true'], [data-selected='true']"
      )
    ) {
      return true;
    }
    return false;
  }

  function getSelectedItemIds(itemType) {
    const selector = getCardSelector(itemType);
    return normalizeImageIds(
      Array.from(document.querySelectorAll(selector))
        .filter(isCardSelected)
        .map((card) => getItemIdFromCard(card, itemType))
    );
  }

  function getItemIdsForContextCard(card, itemType) {
    const itemId = getItemIdFromCard(card, itemType);
    const selectedItemIds = getSelectedItemIds(itemType);
    if (selectedItemIds.length > 1 && selectedItemIds.includes(itemId)) {
      return selectedItemIds;
    }
    return normalizeImageIds(itemId);
  }

  function clearStashItemSelection(itemType, itemIds) {
    const ids = new Set(normalizeImageIds(itemIds));
    if (ids.size <= 1) return;

    document.querySelectorAll(getCardSelector(itemType)).forEach((card) => {
      const itemId = getItemIdFromCard(card, itemType);
      if (!ids.has(itemId)) return;

      const checkedControls = Array.from(
        card.querySelectorAll("input[type='checkbox']:checked, input[type='radio']:checked")
      );
      checkedControls.forEach((control) => {
        control.click();
      });

      card.classList.remove("selected", "is-selected", "card-selected", "active");
      card.removeAttribute("aria-selected");
      card.removeAttribute("data-selected");
      card
        .querySelectorAll(".selected, .is-selected, .card-selected")
        .forEach((element) => element.classList.remove("selected", "is-selected", "card-selected"));
    });
  }

  function closeContextMenu() {
    document.getElementById(MENU_ID)?.remove();
    state.hoverMenuCard = null;
    state.quickSearchTimers.forEach((timer) => window.clearTimeout(timer));
    state.quickSearchTimers = new Map();
    if (state.hoverMenuCloseTimer) {
      window.clearTimeout(state.hoverMenuCloseTimer);
      state.hoverMenuCloseTimer = 0;
    }
  }

  function showQuickAccessToast(message, isError = false) {
    if (state.quickAccessToastTimer) {
      window.clearTimeout(state.quickAccessToastTimer);
      state.quickAccessToastTimer = 0;
    }

    let toast = document.getElementById(QUICK_TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = QUICK_TOAST_ID;
      toast.className = "simple-right-click-tagging__quick-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message || "";
    toast.classList.toggle("is-error", !!isError);
    toast.classList.add("is-visible");
    state.quickAccessToastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, isError ? 2800 : 1600);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function positionFloatingElement(element, x, y) {
    const pad = 8;
    element.style.left = "0px";
    element.style.top = "0px";
    element.style.visibility = "hidden";
    const rect = element.getBoundingClientRect();
    const left = clamp(x, pad, window.innerWidth - rect.width - pad);
    const top = clamp(y, pad, window.innerHeight - rect.height - pad);
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
    element.style.visibility = "";
  }

  function refreshContextMenuSidePanel() {
    const menu = document.getElementById(MENU_ID);
    if (!menu) return;
    const clipboard = loadMetadataClipboard();
    const previousAction = loadPreviousAction();
    const clipboardSummary = menu.querySelector("[data-srct-clipboard-summary]");
    if (clipboardSummary) clipboardSummary.textContent = getClipboardSummary(clipboard);
    const previousSummary = menu.querySelector("[data-srct-previous-summary]");
    if (previousSummary) previousSummary.textContent = getPreviousActionSummary(previousAction);
    const previousButton = menu.querySelector('[data-srct-action="previous-action"]');
    if (previousButton) previousButton.disabled = !previousAction;
    menu.querySelectorAll('[data-srct-action="paste-metadata"]').forEach((button) => {
      const kind = button.getAttribute("data-srct-metadata-kind") || "";
      button.disabled = !canPasteClipboardKind(kind, clipboard);
    });
  }

  function renderMenuButtonGroup(buttons, className = "") {
    const groupClass = ["simple-right-click-tagging__button-grid", className]
      .filter(Boolean)
      .join(" ");
    return `
      <div class="${escapeHtml(groupClass)}">
        ${buttons
          .filter(Boolean)
          .map(
            (button) => `
              <button type="button" class="${button.className || "simple-right-click-tagging__mini-button"}" data-srct-action="${escapeHtml(button.action)}" ${button.kind ? `data-srct-metadata-kind="${escapeHtml(button.kind)}"` : ""} ${button.disabled ? "disabled" : ""}>${escapeHtml(button.label)}</button>
            `
          )
          .join("")}
      </div>
    `;
  }

  function openContextMenuAt(x, y, itemType, imageIds) {
    closeContextMenu();
    closeModal();

    const normalizedImageIds = normalizeImageIds(imageIds);
    const imageCount = normalizedImageIds.length;
    const itemLabel = getItemLabel(itemType, imageCount);
    const quickAccessItems = getQuickAccessItems(itemType);
    const quickAccessPresets = getQuickAccessPresets(itemType);
    const recentQuickItems = getRecentQuickAccessItems(itemType);
    const clipboard = loadMetadataClipboard();
    const previousAction = loadPreviousAction();
    const flagItems = getMissingMetadataFlags(itemType);
    const showStudioTools = itemType !== "performer";
    const showInlineCustomFields = itemType === "performer";
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.className = "simple-right-click-tagging__menu";
    menu.setAttribute("role", "menu");
    const searchPanelHtml = showStudioTools
      ? `
        <div class="simple-right-click-tagging__menu-section simple-right-click-tagging__menu-section--search">
          <div class="simple-right-click-tagging__menu-section-title">Search and apply</div>
          <div class="simple-right-click-tagging__quick-search-grid">
            <label class="simple-right-click-tagging__quick-search-row">
              <span>Tag</span>
              <input type="search" data-srct-quick-search="tag" placeholder="Search tags" autocomplete="off" spellcheck="false">
              <div class="simple-right-click-tagging__quick-search-results" data-srct-quick-results="tag"></div>
            </label>
            <label class="simple-right-click-tagging__quick-search-row">
              <span>Performer</span>
              <input type="search" data-srct-quick-search="performer" placeholder="Search performers" autocomplete="off" spellcheck="false">
              <div class="simple-right-click-tagging__quick-search-results" data-srct-quick-results="performer"></div>
            </label>
            <label class="simple-right-click-tagging__quick-search-row">
              <span>Studio</span>
              <input type="search" data-srct-quick-search="studio" placeholder="Search studios" autocomplete="off" spellcheck="false">
              <div class="simple-right-click-tagging__quick-search-results" data-srct-quick-results="studio"></div>
            </label>
          </div>
        </div>
      `
      : `
        <div class="simple-right-click-tagging__menu-section simple-right-click-tagging__menu-section--search">
          <div class="simple-right-click-tagging__menu-section-title">Search and apply</div>
          <div class="simple-right-click-tagging__quick-search-grid">
            <label class="simple-right-click-tagging__quick-search-row">
              <span>Tag</span>
              <input type="search" data-srct-quick-search="tag" placeholder="Search tags" autocomplete="off" spellcheck="false">
              <div class="simple-right-click-tagging__quick-search-results" data-srct-quick-results="tag"></div>
            </label>
          </div>
        </div>
      `;
    const metadataPanelHtml = showStudioTools
      ? `
        <div class="simple-right-click-tagging__menu-section simple-right-click-tagging__menu-section--metadata">
          <div class="simple-right-click-tagging__menu-section-title">Quick metadata</div>
          <label class="simple-right-click-tagging__metadata-row">
            <span>Rating</span>
            <input type="range" min="0" max="100" step="1" value="0" data-srct-metadata-rating>
            <output data-srct-rating-output>Unrated</output>
          </label>
          <label class="simple-right-click-tagging__metadata-row">
            <span>Date</span>
            <input type="date" data-srct-metadata-date>
          </label>
          <button type="button" class="simple-right-click-tagging__menu-item simple-right-click-tagging__metadata-toggle" data-srct-action="toggle-organized">Toggle organized</button>
        </div>
      `
      : "";
    const metadataTransferPanelHtml = `
      <div class="simple-right-click-tagging__menu-section">
        <div class="simple-right-click-tagging__menu-section-title">Copy / paste</div>
        ${renderMenuButtonGroup([
          { action: "copy-metadata", kind: "tags", label: "Copy tags" },
          showStudioTools ? { action: "copy-metadata", kind: "performers", label: "Copy performers" } : null,
          showStudioTools ? { action: "copy-metadata", kind: "studio", label: "Copy studio" } : null,
          { action: "copy-metadata", kind: "all", label: "Copy all" },
          { action: "paste-metadata", kind: "tags", label: "Paste tags", disabled: !canPasteClipboardKind("tags", clipboard) },
          showStudioTools ? { action: "paste-metadata", kind: "performers", label: "Paste performers", disabled: !canPasteClipboardKind("performers", clipboard) } : null,
          showStudioTools ? { action: "paste-metadata", kind: "studio", label: "Paste studio", disabled: !canPasteClipboardKind("studio", clipboard) } : null,
          { action: "paste-metadata", kind: "all", label: "Paste all", disabled: !canPasteClipboardKind("all", clipboard) },
        ])}
      </div>
    `;
    const flagsPanelHtml = flagItems.length
      ? `
        <div class="simple-right-click-tagging__menu-section">
          <div class="simple-right-click-tagging__menu-section-title">Flags</div>
          ${renderMenuButtonGroup(
            flagItems.map((flag) => ({
              action: "metadata-flag",
              kind: flag.key,
              label: flag.label,
            }))
          )}
        </div>
      `
      : "";
    const clearPanelHtml = `
      <details class="simple-right-click-tagging__menu-section simple-right-click-tagging__clear-section">
        <summary class="simple-right-click-tagging__menu-section-title">Clear</summary>
        ${renderMenuButtonGroup([
          { action: "clear-metadata", kind: "tags", label: "Clear tags" },
          showStudioTools ? { action: "clear-metadata", kind: "performers", label: "Clear performers" } : null,
          showStudioTools ? { action: "clear-metadata", kind: "studio", label: "Clear studio" } : null,
          showStudioTools ? { action: "clear-metadata", kind: "rating", label: "Clear rating" } : null,
          showStudioTools ? { action: "clear-metadata", kind: "date", label: "Clear date" } : null,
        ])}
      </details>
    `;
    const quickAccessPanelHtml = quickAccessItems.length
      ? `
        <div class="simple-right-click-tagging__menu-section">
          <div class="simple-right-click-tagging__menu-section-title">Quick access <span class="simple-right-click-tagging__menu-hint">Shift-click removes</span></div>
          ${quickAccessItems
            .map(
              (item) => `
                <button type="button" class="simple-right-click-tagging__menu-item simple-right-click-tagging__menu-item--quick" data-srct-action="quick-access" data-srct-quick-kind="${escapeHtml(item.kind)}" data-srct-quick-name="${escapeHtml(item.name)}">${escapeHtml(item.label)}</button>
              `
            )
            .join("")}
        </div>
      `
      : "";
    const presetsPanelHtml = quickAccessPresets.length
      ? `
        <div class="simple-right-click-tagging__menu-section simple-right-click-tagging__menu-section--side-first">
          <div class="simple-right-click-tagging__menu-section-title">Presets</div>
          ${quickAccessPresets
            .map(
              (preset, index) => `
                <button type="button" class="simple-right-click-tagging__menu-item simple-right-click-tagging__menu-item--quick" data-srct-action="quick-preset" data-srct-preset-index="${index}">${escapeHtml(preset.label)}</button>
              `
            )
            .join("")}
        </div>
      `
      : "";
    const recentPanelHtml = recentQuickItems.length
      ? `
        <div class="simple-right-click-tagging__menu-section ${quickAccessPresets.length ? "" : "simple-right-click-tagging__menu-section--side-first"}">
          <div class="simple-right-click-tagging__menu-section-title">Recent <span class="simple-right-click-tagging__menu-hint">Shift-click removes</span></div>
          <div class="simple-right-click-tagging__recent-grid">
            ${recentQuickItems
              .map(
                ({ kind, item }) => `
                  <button type="button" class="simple-right-click-tagging__recent-item" data-srct-action="quick-recent" data-srct-quick-kind="${escapeHtml(kind)}" data-srct-quick-id="${escapeHtml(item.id)}" data-srct-quick-name="${escapeHtml(item.name)}">${escapeHtml(kind[0].toUpperCase())}: ${escapeHtml(item.name)}</button>
                `
              )
              .join("")}
          </div>
        </div>
      `
      : "";
    const clipboardPanelHtml = `
      <div class="simple-right-click-tagging__menu-section ${quickAccessPresets.length || recentQuickItems.length ? "" : "simple-right-click-tagging__menu-section--side-first"}">
        <div class="simple-right-click-tagging__menu-section-title">Clipboard</div>
        <div class="simple-right-click-tagging__side-summary" data-srct-clipboard-summary>${escapeHtml(getClipboardSummary(clipboard))}</div>
      </div>
    `;
    const previousPanelHtml = `
      <div class="simple-right-click-tagging__menu-section">
        <div class="simple-right-click-tagging__menu-section-title">Last action</div>
        <div class="simple-right-click-tagging__side-summary" data-srct-previous-summary>${escapeHtml(getPreviousActionSummary(previousAction))}</div>
        <button type="button" class="simple-right-click-tagging__menu-item simple-right-click-tagging__menu-item--quick" data-srct-action="previous-action" ${previousAction ? "" : "disabled"}>Apply previous action</button>
      </div>
    `;
    const customFieldsPanelHtml = showInlineCustomFields
      ? `
        <div class="simple-right-click-tagging__menu-section ${quickAccessPresets.length || recentQuickItems.length ? "" : "simple-right-click-tagging__menu-section--side-first"}" data-srct-inline-custom-fields>
          <div class="simple-right-click-tagging__menu-section-title">Custom fields</div>
          <div class="simple-right-click-tagging__quick-search-empty">Loading custom fields...</div>
        </div>
      `
      : "";
    const sidePanelHtml = presetsPanelHtml || recentPanelHtml || clipboardPanelHtml || previousPanelHtml || customFieldsPanelHtml
      ? `<div class="simple-right-click-tagging__menu-side">${presetsPanelHtml}${recentPanelHtml}${clipboardPanelHtml}${previousPanelHtml}${customFieldsPanelHtml}</div>`
      : "";
    menu.innerHTML = `
      <div class="simple-right-click-tagging__menu-layout ${sidePanelHtml ? "has-side-panel" : ""}">
        <div class="simple-right-click-tagging__menu-main">
          ${
            imageCount > 1
              ? `<div class="simple-right-click-tagging__menu-meta">${imageCount} ${itemLabel} selected</div>`
              : ""
          }
          ${
            itemType === "performer"
              ? ""
              : '<button type="button" class="simple-right-click-tagging__menu-item" data-srct-action="performers">Edit performers</button>'
          }
          ${
            itemType === "performer"
              ? ""
              : '<button type="button" class="simple-right-click-tagging__menu-item" data-srct-action="studio">Edit studio</button>'
          }
          <button type="button" class="simple-right-click-tagging__menu-item" data-srct-action="tags">Edit tags</button>
          ${searchPanelHtml}
          ${metadataPanelHtml}
          ${metadataTransferPanelHtml}
          ${flagsPanelHtml}
          ${quickAccessPanelHtml}
          ${clearPanelHtml}
        </div>
        ${sidePanelHtml}
      </div>
    `;

    menu.addEventListener("click", (clickEvent) => {
      const button = clickEvent.target.closest("[data-srct-action]");
      if (!button) return;
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      const action = button.getAttribute("data-srct-action");
      const quickKind = button.getAttribute("data-srct-quick-kind") || "";
      const quickName = button.getAttribute("data-srct-quick-name") || "";
      const quickId = button.getAttribute("data-srct-quick-id") || "";
      const metadataKind = button.getAttribute("data-srct-metadata-kind") || "";
      const removeMode = !!clickEvent.shiftKey;
      if (["performers", "studio", "tags"].includes(action)) closeContextMenu();
      if (action === "performers") {
        openPerformerEditor(itemType, normalizedImageIds);
      } else if (action === "studio") {
        openStudioEditor(itemType, normalizedImageIds);
      } else if (action === "tags") {
        openTagEditor(itemType, normalizedImageIds);
      } else if (action === "quick-access") {
        applyQuickAccessItem(itemType, normalizedImageIds, quickKind, quickName, { remove: removeMode });
      } else if (action === "quick-preset") {
        const presetIndex = Number(button.getAttribute("data-srct-preset-index"));
        applyQuickAccessPreset(itemType, normalizedImageIds, quickAccessPresets[presetIndex]);
      } else if (action === "quick-search-result" || action === "quick-recent") {
        applyResolvedQuickItem(itemType, normalizedImageIds, quickKind, {
          id: quickId,
          name: quickName,
          sort_name: quickName,
          image_path: "",
        }, { remove: removeMode });
      } else if (action === "toggle-organized") {
        toggleQuickOrganized(itemType, normalizedImageIds);
      } else if (action === "copy-metadata") {
        copyMetadataToClipboard(itemType, normalizedImageIds, metadataKind);
      } else if (action === "paste-metadata") {
        pasteMetadataFromClipboard(itemType, normalizedImageIds, metadataKind);
      } else if (action === "clear-metadata") {
        clearMetadataSection(itemType, normalizedImageIds, metadataKind);
      } else if (action === "metadata-flag") {
        applyMissingMetadataFlag(itemType, normalizedImageIds, metadataKind);
      } else if (action === "previous-action") {
        repeatPreviousAction(itemType, normalizedImageIds);
      }
    });
    menu.addEventListener("input", (inputEvent) => {
      const search = inputEvent.target.closest("[data-srct-quick-search]");
      if (search) {
        scheduleQuickMenuSearch(menu, search, itemType);
        return;
      }

      const rating = inputEvent.target.closest("[data-srct-metadata-rating]");
      if (rating) updateRatingOutput(menu, Number(rating.value));
    });
    menu.addEventListener("change", (changeEvent) => {
      const rating = changeEvent.target.closest("[data-srct-metadata-rating]");
      if (rating) {
        applyQuickRating(itemType, normalizedImageIds, Number(rating.value));
        return;
      }

      const date = changeEvent.target.closest("[data-srct-metadata-date]");
      if (date) {
        applyQuickDate(itemType, normalizedImageIds, date.value);
        closeContextMenu();
      }
    });
    menu.addEventListener("keydown", (keyEvent) => {
      const search = keyEvent.target.closest("[data-srct-quick-search]");
      if (search) {
        if (keyEvent.key !== "Enter") return;
        const firstResult = menu.querySelector(
          `[data-srct-quick-results="${search.getAttribute("data-srct-quick-search")}"] [data-srct-action="quick-search-result"]`
        );
        if (firstResult) {
          keyEvent.preventDefault();
          firstResult.click();
        }
        return;
      }
      if (keyEvent.metaKey || keyEvent.ctrlKey || keyEvent.altKey) return;
      const shortcut = String(keyEvent.key || "").toLowerCase();
      const shortcutMap = {
        t: "tag",
        p: "performer",
        s: "studio",
      };
      if (shortcutMap[shortcut]) {
        const input = menu.querySelector(`[data-srct-quick-search="${shortcutMap[shortcut]}"]`);
        if (input) {
          keyEvent.preventDefault();
          input.focus();
        }
      } else if (shortcut === "r") {
        const rating = menu.querySelector("[data-srct-metadata-rating]");
        if (rating) {
          keyEvent.preventDefault();
          rating.focus();
        }
      } else if (shortcut === "d") {
        const date = menu.querySelector("[data-srct-metadata-date]");
        if (date) {
          keyEvent.preventDefault();
          date.focus();
        }
      }
    });
    menu.addEventListener("mouseenter", () => {
      if (getAccessMode() === ACCESS_MODE_HOVER_ZONE) cancelHoverMenuClose();
    });
    menu.addEventListener("mouseleave", () => {
      if (getAccessMode() === ACCESS_MODE_HOVER_ZONE) scheduleHoverMenuClose();
    });

    document.body.appendChild(menu);
    menu.tabIndex = -1;
    positionFloatingElement(menu, x, y);
    menu.focus({ preventScroll: true });
    if (showInlineCustomFields) hydrateInlineCustomFieldsPanel(menu, normalizedImageIds, x, y);
    return menu;
  }

  function openContextMenu(event, itemType, imageIds) {
    return openContextMenuAt(event.clientX, event.clientY, itemType, imageIds);
  }

  function closeModal() {
    const imageIdsToClear = state.currentImageIds.slice();
    const itemTypeToClear = state.currentItemType;
    if (state.performerSearchTimer) {
      window.clearTimeout(state.performerSearchTimer);
      state.performerSearchTimer = 0;
    }
    if (state.studioSearchTimer) {
      window.clearTimeout(state.studioSearchTimer);
      state.studioSearchTimer = 0;
    }
    document.getElementById(MODAL_ID)?.remove();
    hideHoverPreview();
    document.getElementById(HOVER_PREVIEW_ID)?.remove();
    clearStashItemSelection(itemTypeToClear, imageIdsToClear);
    state.currentItemType = "image";
    state.currentImageId = "";
    state.currentImageIds = [];
    state.workingImageIds = new Set();
    state.currentMode = "";
    state.selectedTagIds = new Set();
    state.selectedPerformers = [];
    state.selectedStudio = null;
    state.selectedStudioMixed = false;
    state.imagePreviewCache = new Map();
    state.imageTagIdsByImageId = new Map();
    state.imagePerformersByImageId = new Map();
    state.imageStudiosByImageId = new Map();
    state.imageMetadataByImageId = new Map();
    state.performerCustomFieldsById = new Map();
    state.suppressNextQueueClick = false;
    state.isSaving = false;
  }

  function isInHoverMenuZone(event, card) {
    if (!(card instanceof HTMLElement)) return false;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return event.clientX >= rect.left + rect.width * HOVER_ZONE_RIGHT_START;
  }

  function getHoverMenuPosition(card) {
    const rect = card.getBoundingClientRect();
    return {
      x: rect.right - 8,
      y: rect.top + Math.min(rect.height - 8, Math.max(8, rect.height / 2)),
    };
  }

  function scheduleHoverMenuClose() {
    if (!document.getElementById(MENU_ID)) return;
    if (state.hoverMenuCloseTimer) window.clearTimeout(state.hoverMenuCloseTimer);
    state.hoverMenuCloseTimer = window.setTimeout(() => {
      closeContextMenu();
    }, HOVER_MENU_CLOSE_DELAY_MS);
  }

  function cancelHoverMenuClose() {
    if (!state.hoverMenuCloseTimer) return;
    window.clearTimeout(state.hoverMenuCloseTimer);
    state.hoverMenuCloseTimer = 0;
  }

  function createModalShell(title, subtitle = "") {
    closeModal();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "simple-right-click-tagging__modal";
    modal.innerHTML = `
      <div class="simple-right-click-tagging__backdrop" data-srct-close="1"></div>
      <section class="simple-right-click-tagging__dialog" role="dialog" aria-modal="true">
        <header class="simple-right-click-tagging__dialog-header">
          <div class="simple-right-click-tagging__dialog-title-wrap">
            <h3 class="simple-right-click-tagging__dialog-title"></h3>
            <div class="simple-right-click-tagging__dialog-subtitle"></div>
          </div>
          <button type="button" class="simple-right-click-tagging__close" data-srct-close="1" aria-label="Close">x</button>
        </header>
        <div class="simple-right-click-tagging__dialog-body"></div>
      </section>
    `;

    modal.querySelector(".simple-right-click-tagging__dialog-title").textContent = title;
    modal.querySelector(".simple-right-click-tagging__dialog-subtitle").textContent = subtitle;
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-srct-close]")) {
        event.preventDefault();
        closeModal();
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function setModalSubtitle(text) {
    const subtitle = document.querySelector(
      `#${MODAL_ID} .simple-right-click-tagging__dialog-subtitle`
    );
    if (subtitle) subtitle.textContent = text;
  }

  function getImageCountLabel() {
    const count = state.currentImageIds.length;
    const itemLabel = getItemLabel(state.currentItemType, count);
    return count > 1
      ? `${count} ${itemLabel} queued`
      : `${getItemTitleLabel(state.currentItemType)} ${state.currentImageId}`;
  }

  function getActiveImageSubtitle() {
    if (state.currentImageIds.length > 1) {
      return `${state.workingImageIds.size} of ${state.currentImageIds.length} ${getItemLabel(
        state.currentItemType,
        state.currentImageIds.length
      )} selected`;
    }
    return getImageCountLabel();
  }

  async function fetchImageTags(imageId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingImageTags($id: ID!) {
          findImage(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      { id: imageId }
    );

    return new Set(
      (data?.findImage?.tags || [])
        .map((tag) => String(tag?.id || "").trim())
        .filter(Boolean)
    );
  }

  async function fetchImagePreview(imageId, preferThumbnail = false) {
    const data = await gql(
      `
        query SimpleRightClickTaggingImagePreview($id: ID!) {
          findImage(id: $id) {
            id
            title
            paths {
              image
              preview
              thumbnail
            }
          }
        }
      `,
      { id: imageId }
    );

    const image = data?.findImage || null;
    if (!image) return null;
    return {
      id: String(image.id || imageId),
      title: String(image.title || `Image ${imageId}`),
      url: String(
        preferThumbnail
          ? image.paths?.thumbnail ||
              image.paths?.preview ||
              image.paths?.image ||
              ""
          : image.paths?.preview ||
              image.paths?.image ||
              image.paths?.thumbnail ||
              ""
      ),
    };
  }

  async function fetchImagePerformers(imageId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingImagePerformers($id: ID!) {
          findImage(id: $id) {
            id
            performers {
              id
              name
              image_path
            }
          }
        }
      `,
      { id: imageId }
    );

    return (data?.findImage?.performers || [])
      .map((performer) => ({
        id: String(performer?.id || "").trim(),
        name: String(performer?.name || "").trim(),
        image_path: String(performer?.image_path || "").trim(),
      }))
      .filter((performer) => performer.id && performer.name);
  }

  function normalizeStudio(studio) {
    if (!studio?.id) return null;
    const normalized = {
      id: String(studio.id || "").trim(),
      name: String(studio.name || "").trim(),
      image_path: String(studio.image_path || "").trim(),
    };
    return normalized.id && normalized.name ? normalized : null;
  }

  async function fetchImageStudio(imageId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingImageStudio($id: ID!) {
          findImage(id: $id) {
            id
            studio {
              id
              name
              image_path
            }
          }
        }
      `,
      { id: imageId }
    );

    return normalizeStudio(data?.findImage?.studio);
  }

  async function fetchImageMetadata(imageId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingImageMetadata($id: ID!) {
          findImage(id: $id) {
            id
            rating100
            date
            organized
          }
        }
      `,
      { id: imageId }
    );
    const image = data?.findImage || {};
    return {
      rating100: Number.isFinite(Number(image.rating100)) ? Number(image.rating100) : null,
      date: String(image.date || ""),
      organized: !!image.organized,
    };
  }

  async function fetchSceneTags(sceneId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingSceneTags($id: ID!) {
          findScene(id: $id) {
            id
            tags {
              id
            }
          }
        }
      `,
      { id: sceneId }
    );

    return new Set(
      (data?.findScene?.tags || [])
        .map((tag) => String(tag?.id || "").trim())
        .filter(Boolean)
    );
  }

  async function fetchScenePreview(sceneId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingScenePreview($id: ID!) {
          findScene(id: $id) {
            id
            title
            studio {
              name
            }
            paths {
              screenshot
              preview
            }
          }
        }
      `,
      { id: sceneId }
    );

    const scene = data?.findScene || null;
    if (!scene) return null;
    return {
      id: String(scene.id || sceneId),
      title: String(scene.title || `Scene ${sceneId}`),
      studioName: String(scene.studio?.name || "").trim(),
      url: String(scene.paths?.screenshot || ""),
      videoUrl: String(scene.paths?.preview || ""),
      mediaType: "scene",
    };
  }

  async function fetchScenePerformers(sceneId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingScenePerformers($id: ID!) {
          findScene(id: $id) {
            id
            performers {
              id
              name
              image_path
            }
          }
        }
      `,
      { id: sceneId }
    );

    return (data?.findScene?.performers || [])
      .map((performer) => ({
        id: String(performer?.id || "").trim(),
        name: String(performer?.name || "").trim(),
        image_path: String(performer?.image_path || "").trim(),
      }))
      .filter((performer) => performer.id && performer.name);
  }

  async function fetchSceneStudio(sceneId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingSceneStudio($id: ID!) {
          findScene(id: $id) {
            id
            studio {
              id
              name
              image_path
            }
          }
        }
      `,
      { id: sceneId }
    );

    return normalizeStudio(data?.findScene?.studio);
  }

  async function fetchSceneMetadata(sceneId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingSceneMetadata($id: ID!) {
          findScene(id: $id) {
            id
            rating100
            date
            organized
          }
        }
      `,
      { id: sceneId }
    );
    const scene = data?.findScene || {};
    return {
      rating100: Number.isFinite(Number(scene.rating100)) ? Number(scene.rating100) : null,
      date: String(scene.date || ""),
      organized: !!scene.organized,
    };
  }

  async function fetchPerformerTags(performerId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingPerformerTags($id: ID!) {
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

    return new Set(
      (data?.findPerformer?.tags || [])
        .map((tag) => String(tag?.id || "").trim())
        .filter(Boolean)
    );
  }

  async function fetchPerformerPreview(performerId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingPerformerPreview($id: ID!) {
          findPerformer(id: $id) {
            id
            name
            image_path
          }
        }
      `,
      { id: performerId }
    );

    const performer = data?.findPerformer || null;
    if (!performer) return null;
    return {
      id: String(performer.id || performerId),
      title: String(performer.name || `Performer ${performerId}`),
      url: String(performer.image_path || ""),
      mediaType: "performer",
    };
  }

  async function fetchPerformerCustomFields(performerId) {
    const data = await gql(
      `
        query SimpleRightClickTaggingPerformerCustomFields($id: ID!) {
          findPerformer(id: $id) {
            id
            custom_fields
          }
        }
      `,
      { id: performerId }
    );
    return { ...(data?.findPerformer?.custom_fields || {}) };
  }

  function getItemCacheKey(itemType, id) {
    return `${itemType}:${String(id || "").trim()}`;
  }

  async function fetchItemTags(itemType, id) {
    if (itemType === "scene") return fetchSceneTags(id);
    if (itemType === "performer") return fetchPerformerTags(id);
    return fetchImageTags(id);
  }

  async function fetchItemPreview(itemType, id, preferThumbnail = false) {
    if (itemType === "scene") return fetchScenePreview(id);
    if (itemType === "performer") return fetchPerformerPreview(id);
    return fetchImagePreview(id, preferThumbnail);
  }

  async function fetchItemPerformers(itemType, id) {
    return itemType === "scene" ? fetchScenePerformers(id) : fetchImagePerformers(id);
  }

  async function fetchItemStudio(itemType, id) {
    return itemType === "scene" ? fetchSceneStudio(id) : fetchImageStudio(id);
  }

  async function fetchItemMetadata(itemType, id) {
    return itemType === "scene" ? fetchSceneMetadata(id) : fetchImageMetadata(id);
  }

  async function getCachedImagePreview(imageId, preferThumbnail = false) {
    return getCachedItemPreview("image", imageId, preferThumbnail);
  }

  async function getCachedItemPreview(itemType, imageId, preferThumbnail = false) {
    const id = String(imageId || "").trim();
    if (!id) return null;
    const cacheKey = `${preferThumbnail ? "thumb" : "preview"}:${getItemCacheKey(itemType, id)}`;
    if (!state.imagePreviewCache.has(cacheKey)) {
      state.imagePreviewCache.set(cacheKey, await fetchItemPreview(itemType, id, preferThumbnail));
    }
    return state.imagePreviewCache.get(cacheKey);
  }

  async function getCachedItemTags(itemType, imageId) {
    const id = String(imageId || "").trim();
    if (!id) return new Set();
    const cacheKey = getItemCacheKey(itemType, id);
    if (!state.imageTagIdsByImageId.has(cacheKey)) {
      state.imageTagIdsByImageId.set(cacheKey, await fetchItemTags(itemType, id));
    }
    return new Set(state.imageTagIdsByImageId.get(cacheKey));
  }

  async function getCachedItemPerformers(itemType, imageId) {
    const id = String(imageId || "").trim();
    if (!id) return [];
    const cacheKey = getItemCacheKey(itemType, id);
    if (!state.imagePerformersByImageId.has(cacheKey)) {
      state.imagePerformersByImageId.set(cacheKey, await fetchItemPerformers(itemType, id));
    }
    return state.imagePerformersByImageId.get(cacheKey).slice();
  }

  async function getCachedItemStudio(itemType, imageId) {
    const id = String(imageId || "").trim();
    if (!id || itemType === "performer") return null;
    const cacheKey = getItemCacheKey(itemType, id);
    if (!state.imageStudiosByImageId.has(cacheKey)) {
      state.imageStudiosByImageId.set(cacheKey, await fetchItemStudio(itemType, id));
    }
    return state.imageStudiosByImageId.get(cacheKey);
  }

  async function getCachedItemMetadata(itemType, imageId) {
    const id = String(imageId || "").trim();
    if (!id || itemType === "performer") return null;
    const cacheKey = getItemCacheKey(itemType, id);
    if (!state.imageMetadataByImageId.has(cacheKey)) {
      state.imageMetadataByImageId.set(cacheKey, await fetchItemMetadata(itemType, id));
    }
    return { ...state.imageMetadataByImageId.get(cacheKey) };
  }

  async function getCachedPerformerCustomFields(performerId) {
    const id = String(performerId || "").trim();
    if (!id) return {};
    if (!state.performerCustomFieldsById.has(id)) {
      state.performerCustomFieldsById.set(id, await fetchPerformerCustomFields(id));
    }
    return { ...state.performerCustomFieldsById.get(id) };
  }

  function getWorkingImageIds() {
    return state.currentImageIds.filter((imageId) => state.workingImageIds.has(imageId));
  }

  function firstWorkingImageId() {
    return getWorkingImageIds()[0] || state.currentImageIds[0] || "";
  }

  function intersectSets(sets) {
    if (!sets.length) return new Set();
    const intersection = new Set(sets[0]);
    sets.slice(1).forEach((set) => {
      Array.from(intersection).forEach((value) => {
        if (!set.has(value)) intersection.delete(value);
      });
    });
    return intersection;
  }

  function intersectPerformers(performerLists) {
    if (!performerLists.length) return [];
    const commonIds = intersectSets(
      performerLists.map((performers) => new Set(performers.map((performer) => performer.id)))
    );
    return performerLists[0].filter((performer) => commonIds.has(performer.id));
  }

  function getCommonStudio(studios) {
    if (!studios.length) return { studio: null, mixed: false };
    const normalizedStudios = studios.map(normalizeStudio);
    const firstId = normalizedStudios[0]?.id || "";
    const mixed = normalizedStudios.some((studio) => (studio?.id || "") !== firstId);
    return { studio: mixed ? null : normalizedStudios[0], mixed };
  }

  async function updateImageTagIds(imageId, tagIds) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateImageTags($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(imageId),
          tag_ids: Array.from(new Set((tagIds || []).map(String).filter(Boolean))),
        },
      }
    );

    return data?.imageUpdate?.id || null;
  }

  async function updateImagePerformerIds(imageId, performerIds) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateImagePerformers($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(imageId),
          performer_ids: Array.from(new Set((performerIds || []).map(String).filter(Boolean))),
        },
      }
    );

    return data?.imageUpdate?.id || null;
  }

  async function updateImageStudioId(imageId, studioId) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateImageStudio($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(imageId),
          studio_id: studioId ? String(studioId) : null,
        },
      }
    );

    return data?.imageUpdate?.id || null;
  }

  async function updateImageMetadata(imageId, patch) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateImageMetadata($input: ImageUpdateInput!) {
          imageUpdate(input: $input) {
            id
          }
        }
      `,
      { input: { id: String(imageId), ...patch } }
    );

    return data?.imageUpdate?.id || null;
  }

  async function updateSceneTagIds(sceneId, tagIds) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateSceneTags($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(sceneId),
          tag_ids: Array.from(new Set((tagIds || []).map(String).filter(Boolean))),
        },
      }
    );

    return data?.sceneUpdate?.id || null;
  }

  async function updateScenePerformerIds(sceneId, performerIds) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateScenePerformers($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(sceneId),
          performer_ids: Array.from(new Set((performerIds || []).map(String).filter(Boolean))),
        },
      }
    );

    return data?.sceneUpdate?.id || null;
  }

  async function updateSceneStudioId(sceneId, studioId) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateSceneStudio($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(sceneId),
          studio_id: studioId ? String(studioId) : null,
        },
      }
    );

    return data?.sceneUpdate?.id || null;
  }

  async function updateSceneMetadata(sceneId, patch) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdateSceneMetadata($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      { input: { id: String(sceneId), ...patch } }
    );

    return data?.sceneUpdate?.id || null;
  }

  async function updatePerformerTagIds(performerId, tagIds) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdatePerformerTags($input: PerformerUpdateInput!) {
          performerUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: String(performerId),
          tag_ids: Array.from(new Set((tagIds || []).map(String).filter(Boolean))),
        },
      }
    );

    return data?.performerUpdate?.id || null;
  }

  async function updatePerformerCustomFields(performerId, fields) {
    const data = await gql(
      `
        mutation SimpleRightClickTaggingUpdatePerformerCustomFields($id: ID!, $fields: Map!) {
          performerUpdate(input: { id: $id, custom_fields: { partial: $fields } }) {
            id
          }
        }
      `,
      {
        id: String(performerId),
        fields: fields || {},
      }
    );

    return data?.performerUpdate?.id || null;
  }

  async function updateItemTagIds(itemType, id, tagIds) {
    if (itemType === "scene") return updateSceneTagIds(id, tagIds);
    if (itemType === "performer") return updatePerformerTagIds(id, tagIds);
    return updateImageTagIds(id, tagIds);
  }

  async function updateItemPerformerIds(itemType, id, performerIds) {
    return itemType === "scene"
      ? updateScenePerformerIds(id, performerIds)
      : updateImagePerformerIds(id, performerIds);
  }

  async function updateItemStudioId(itemType, id, studioId) {
    return itemType === "scene"
      ? updateSceneStudioId(id, studioId)
      : updateImageStudioId(id, studioId);
  }

  async function updateItemMetadata(itemType, id, patch) {
    return itemType === "scene"
      ? updateSceneMetadata(id, patch)
      : updateImageMetadata(id, patch);
  }

  async function fetchAllTags() {
    if (state.allTags) return state.allTags;

    const data = await gql(`
      query SimpleRightClickTaggingAllTags {
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
          name: String(tag.name || ""),
          sort_name: String(tag.sort_name || tag.name || ""),
          description: String(tag.description || ""),
          image_path: String(tag.image_path || ""),
          custom_fields: tag.custom_fields || {},
          children: tag.children || [],
          parents: tag.parents || [],
        },
      ])
    );

    return state.allTags;
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

  function buildTagMap(tags) {
    const tagMap = new Map();
    (tags || []).forEach((tag) => {
      tagMap.set(String(tag.id), {
        id: String(tag.id),
        name: tag.name,
        sort_name: tag.sort_name || tag.name || "",
        description: tag.description || "",
        image_path: tag.image_path || "",
        custom_fields: tag.custom_fields || {},
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

  function buildNestedGroupsPreservingOrder(tags, cfg) {
    const duplicateMultiParentTags = getConfigBoolean(
      cfg?.duplicateMultiParentTags,
      false
    );
    const tagMap = buildTagMap(tags);
    const topGroupsById = new Map();
    const orderedTopGroups = [];
    const ungrouped = {
      parent: { id: "__ungrouped__", name: "Ungrouped", sort_name: "Ungrouped" },
      items: [],
    };

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

    for (const tag of tags || []) {
      const tagRecord = tagMap.get(String(tag.id));
      if (!tagRecord) continue;
      const paths = getParentPaths(tagRecord, tagMap, duplicateMultiParentTags);

      for (const path of paths) {
        if (path.type === "ungrouped") {
          if (!isParentTag(tagRecord) && !ungrouped.items.some((item) => item.id === tagRecord.id)) {
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

        const topGroup = ensureTopGroup(path.topParent);
        addLeafToGroup(topGroup, tagRecord);
      }
    }

    orderedTopGroups.sort((a, b) => {
      if (a.parent.id === "__ungrouped__") return 1;
      if (b.parent.id === "__ungrouped__") return -1;
      const aKey = String(a.parent.sort_name || a.parent.name || "").toLowerCase();
      const bKey = String(b.parent.sort_name || b.parent.name || "").toLowerCase();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    orderedTopGroups.forEach((group) => {
      sortItemsBySortNameThenName(group.items);
      group.items.forEach((item) => {
        if (item.type === "subgroup") sortItemsBySortNameThenName(item.children);
      });
    });
    sortItemsBySortNameThenName(ungrouped.items);
    if (ungrouped.items.length) orderedTopGroups.push(ungrouped);

    return orderedTopGroups.map((group) => {
      delete group.subgroupMap;
      delete group.leafIds;
      return group;
    });
  }

  function buildSearchIndex(tags, cfg) {
    const duplicateMultiParentTags = getConfigBoolean(
      cfg?.duplicateMultiParentTags,
      false
    );
    const tagMap = buildTagMap(tags);
    const results = [];

    for (const tag of tags || []) {
      const tagRecord = tagMap.get(String(tag.id));
      if (!tagRecord) continue;
      const paths = getParentPaths(tagRecord, tagMap, duplicateMultiParentTags);
      const parentTag = isParentTag(tagRecord);

      for (const path of paths) {
        let breadcrumb = "Ungrouped";
        let targetKind = parentTag ? "header" : "leaf";
        let targetId = tagRecord.id;
        let groupId = "__ungrouped__";
        let subgroupId = "";

        if (path.type === "group") {
          breadcrumb = path.topParent.name;
          groupId = String(path.topParent.id);
          if (parentTag) targetId = groupId;
        } else if (path.type === "subgroup") {
          breadcrumb = `${path.topParent.name} > ${path.subgroupParent.name}`;
          groupId = String(path.topParent.id);
          subgroupId = String(path.subgroupParent.id);
          if (parentTag) targetId = subgroupId;
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

    sortItemsBySortNameThenName(results);
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

  function getHoverPreviewHost() {
    let host = document.getElementById(HOVER_PREVIEW_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOVER_PREVIEW_ID;
    host.className = "simple-right-click-tagging-hover-preview";
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
    clearImageQueueTagIndicators();
    state.hoverTagId = "";
    state.hoverAnchorRect = null;
  }

  function showHoverPreviewLoading(anchorRect) {
    const host = getHoverPreviewHost();
    host.innerHTML =
      '<div class="simple-right-click-tagging-hover-preview__card simple-right-click-tagging-hover-preview__card--loading">Loading tag preview...</div>';
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
        query SimpleRightClickTaggingSupplementalImages($image_ids: [Int!]) {
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
        console.error("[SimpleRightClickTagging] supplemental image lookup failed", err);
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
      <div class="simple-right-click-tagging-hover-preview__card">
        <div class="simple-right-click-tagging-hover-preview__title">${escapeHtml(tagRecord?.name || "Tag")}</div>
        <div class="simple-right-click-tagging-hover-preview__image-row">
          ${
            images.length
              ? images
                  .map(
                    (image) => `
                      <div class="simple-right-click-tagging-hover-preview__image-frame">
                        <img src="${escapeHtml(image.path)}" alt="${escapeHtml(image.label)}" />
                      </div>
                    `
                  )
                  .join("")
              : '<div class="simple-right-click-tagging-hover-preview__image-empty">No tag image</div>'
          }
        </div>
        ${
          description
            ? `<div class="simple-right-click-tagging-hover-preview__description">${escapeHtml(description)}</div>`
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
    const target = start.closest("[data-srct-hover-tag-id]");
    if (!(target instanceof HTMLElement)) return null;
    const tagId = String(target.getAttribute("data-srct-hover-tag-id") || "");
    if (!tagId) return null;
    return { anchor: target, tagId };
  }

  function handleTagPanelHoverIn(event) {
    const targetInfo = findHoverTagTarget(event.target);
    if (!targetInfo) return;
    const { anchor, tagId } = targetInfo;
    if (state.hoverTagId === tagId) return;

    const anchorRect = anchor.getBoundingClientRect();
    state.hoverTagId = tagId;
    state.hoverAnchorRect = anchorRect;
    syncImageQueueTagIndicators(tagId);
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

  function handleTagPanelHoverOut(event) {
    const activeTagId = String(state.hoverTagId || "");
    if (!activeTagId) return;
    const currentTarget = findHoverTagTarget(event.target);
    if (!currentTarget || currentTarget.tagId !== activeTagId) return;
    const related = event.relatedTarget;
    if (related instanceof Element && currentTarget.anchor.contains(related)) return;
    hideHoverPreview();
  }

  function renderTagSearchResults(panel) {
    const resultsWrap = panel.querySelector(".simple-right-click-tagging__search-results");
    const empty = panel.querySelector(".simple-right-click-tagging__search-empty");
    const input = panel.querySelector(".simple-right-click-tagging__search-input");
    if (!resultsWrap || !empty || !input) return;

    resultsWrap.innerHTML = "";
    const query = input.value || "";
    if (!query.trim()) {
      empty.hidden = true;
      return;
    }

    const results = getSearchResults(query, 24);
    empty.hidden = results.length > 0;
    results.forEach((result) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "simple-right-click-tagging__search-result";
      row.setAttribute("data-srct-search-toggle", result.id);
      row.setAttribute("data-srct-hover-tag-id", result.id);
      row.setAttribute("data-srct-tag-title", result.name);
      updateTagButtonState(row, result.id);

      const jump = document.createElement("span");
      jump.className = "simple-right-click-tagging__search-main";
      jump.textContent = result.name;

      const path = document.createElement("span");
      path.className = "simple-right-click-tagging__search-path";
      path.textContent = result.breadcrumb;
      jump.appendChild(path);

      row.appendChild(jump);
      resultsWrap.appendChild(row);
    });
  }

  function getTagSelectionCount(tagId, imageIds = getWorkingImageIds()) {
    const id = String(tagId || "").trim();
    if (!id || !imageIds.length) return 0;
    return imageIds.reduce((count, imageId) => {
      const tagIds = state.imageTagIdsByImageId.get(
        getItemCacheKey(state.currentItemType, imageId)
      );
      return count + (tagIds?.has(id) ? 1 : 0);
    }, 0);
  }

  function getTagState(tagId) {
    const imageIds = getWorkingImageIds();
    const count = getTagSelectionCount(tagId, imageIds);
    return {
      count,
      total: imageIds.length,
      selected: imageIds.length > 0 && count === imageIds.length,
      partial: count > 0 && count < imageIds.length,
    };
  }

  function updateTagButtonState(button, tagId) {
    const tagState = getTagState(tagId);
    button.classList.toggle("is-selected", tagState.selected);
    button.classList.toggle("is-partial", tagState.partial);
    button.setAttribute("aria-pressed", tagState.selected ? "true" : "false");
    if (tagState.partial) {
      button.title = `${tagState.count} of ${tagState.total} selected ${getItemLabel(
        state.currentItemType,
        tagState.total
      )} have this tag`;
    } else {
      button.title = button.getAttribute("data-srct-tag-title") || "";
    }
  }

  function clearImageQueueTagIndicators() {
    document.querySelectorAll("[data-srct-queue-image-id]").forEach((button) => {
      button.classList.remove("has-hover-tag", "missing-hover-tag");
      button.removeAttribute("data-srct-tag-state");
    });
  }

  function syncImageQueueTagIndicators(tagId) {
    const id = String(tagId || "").trim();
    clearImageQueueTagIndicators();
    if (!id || state.currentMode !== "tags") return;
    document.querySelectorAll("[data-srct-queue-image-id]").forEach((button) => {
      const imageId = String(button.getAttribute("data-srct-queue-image-id") || "");
      const hasTag =
        state.imageTagIdsByImageId
          .get(getItemCacheKey(state.currentItemType, imageId))
          ?.has(id) || false;
      button.classList.toggle("has-hover-tag", hasTag);
      button.classList.toggle("missing-hover-tag", !hasTag);
      button.setAttribute("data-srct-tag-state", hasTag ? "Has tag" : "Missing tag");
    });
  }

  function syncTagSelectionStates() {
    document.querySelectorAll("[data-srct-tag-id]").forEach((button) => {
      updateTagButtonState(button, button.getAttribute("data-srct-tag-id"));
    });

    document.querySelectorAll("[data-srct-group-id]").forEach((section) => {
      const count = section.querySelector(".simple-right-click-tagging__selected-count");
      if (!count) return;
      let selectedCount = 0;
      let partialCount = 0;
      section.querySelectorAll("[data-srct-tag-id]").forEach((button) => {
        if (button.classList.contains("is-selected")) selectedCount += 1;
        else if (button.classList.contains("is-partial")) partialCount += 1;
      });
      count.textContent = [
        selectedCount ? `${selectedCount} selected` : "",
        partialCount ? `${partialCount} partial` : "",
      ]
        .filter(Boolean)
        .join(" / ");
    });

    document.querySelectorAll("[data-srct-subgroup-id]").forEach((section) => {
      const count = section.querySelector(".simple-right-click-tagging__subgroup-selected-count");
      if (!count) return;
      let selectedCount = 0;
      let partialCount = 0;
      section.querySelectorAll("[data-srct-tag-id]").forEach((button) => {
        if (button.classList.contains("is-selected")) selectedCount += 1;
        else if (button.classList.contains("is-partial")) partialCount += 1;
      });
      count.textContent = [
        selectedCount ? `${selectedCount} selected` : "",
        partialCount ? `${partialCount} partial` : "",
      ]
        .filter(Boolean)
        .join(" / ");
    });

    const panel = document.querySelector(".simple-right-click-tagging__tag-panel");
    if (panel) renderTagSearchResults(panel);
    if (state.hoverTagId) syncImageQueueTagIndicators(state.hoverTagId);
  }

  function syncImageQueueSelection() {
    const multiSelect = state.currentImageIds.length > 1;
    document
      .querySelectorAll("[data-srct-queue-image-id]")
      .forEach((button) => {
        const selected =
          multiSelect && state.workingImageIds.has(button.getAttribute("data-srct-queue-image-id"));
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
  }

  function createImageQueue(previewsById) {
    const aside = document.createElement("aside");
    aside.className = "simple-right-click-tagging__image-preview simple-right-click-tagging__image-queue";
    aside.classList.toggle(
      "simple-right-click-tagging__image-queue--single",
      state.currentImageIds.length <= 1
    );

    if (state.currentImageIds.length > 1) {
      const header = document.createElement("div");
      header.className = "simple-right-click-tagging__image-queue-header";
      header.textContent = getItemTitleLabel(state.currentItemType) + "s";
      aside.appendChild(header);
    }

    const grid = document.createElement("div");
    grid.className = "simple-right-click-tagging__image-queue-grid";

    state.currentImageIds.forEach((imageId) => {
      const preview = previewsById.get(imageId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "simple-right-click-tagging__image-queue-item";
      button.setAttribute("data-srct-queue-image-id", imageId);
      const selected = state.currentImageIds.length > 1 && state.workingImageIds.has(imageId);
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const itemTitleLabel = getItemTitleLabel(state.currentItemType);
      button.title = preview?.title || `${itemTitleLabel} ${imageId}`;

      if (preview?.mediaType === "scene" && preview?.videoUrl) {
        const video = document.createElement("video");
        video.src = preview.videoUrl;
        video.poster = preview.url || "";
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = state.currentImageIds.length <= 1 ? "metadata" : "none";
        if (state.currentImageIds.length <= 1) video.autoplay = true;
        video.setAttribute("aria-label", preview.title || `${itemTitleLabel} ${imageId}`);
        button.appendChild(video);
      } else if (preview?.url) {
        const img = document.createElement("img");
        img.src = preview.url;
        img.alt = preview.title || `${itemTitleLabel} ${imageId}`;
        img.loading = "lazy";
        img.decoding = "async";
        button.appendChild(img);
      } else {
        const empty = document.createElement("span");
        empty.className = "simple-right-click-tagging__image-preview-empty";
        empty.textContent = "No preview";
        button.appendChild(empty);
      }

      const label = document.createElement("span");
      label.className = "simple-right-click-tagging__image-queue-label";
      const primaryLabel = preview?.title || `${itemTitleLabel} ${imageId}`;
      if (preview?.mediaType === "scene" && preview?.studioName) {
        const title = document.createElement("span");
        title.className = "simple-right-click-tagging__image-queue-title";
        title.textContent = primaryLabel;
        const studio = document.createElement("span");
        studio.className = "simple-right-click-tagging__image-queue-studio";
        studio.textContent = preview.studioName;
        label.appendChild(title);
        label.appendChild(studio);
      } else {
        label.textContent = primaryLabel;
      }
      button.appendChild(label);
      grid.appendChild(button);
    });

    aside.appendChild(grid);
    return aside;
  }

  function attachScenePreviewVideoEvents(queue) {
    queue.querySelectorAll(".simple-right-click-tagging__image-queue-item video").forEach((video) => {
      if (!(video instanceof HTMLVideoElement)) return;
      const item = video.closest(".simple-right-click-tagging__image-queue-item");
      const play = () => video.play().catch(() => {});
      const pause = () => {
        video.pause();
        video.currentTime = 0;
      };

      if (state.currentImageIds.length <= 1) {
        play();
      } else if (item) {
        item.addEventListener("mouseenter", play);
        item.addEventListener("focus", play);
        item.addEventListener("mouseleave", pause);
        item.addEventListener("blur", pause);
      }
    });
  }

  function getRenderedImageRect(img) {
    const rect = img.getBoundingClientRect();
    const naturalWidth = img.naturalWidth || rect.width;
    const naturalHeight = img.naturalHeight || rect.height;
    if (!naturalWidth || !naturalHeight || !rect.width || !rect.height) return rect;

    const imageRatio = naturalWidth / naturalHeight;
    const boxRatio = rect.width / rect.height;
    if (imageRatio > boxRatio) {
      const height = rect.width / imageRatio;
      return new DOMRect(rect.left, rect.top + (rect.height - height) / 2, rect.width, height);
    }

    const width = rect.height * imageRatio;
    return new DOMRect(rect.left + (rect.width - width) / 2, rect.top, width, rect.height);
  }

  function clampRectToTarget(left, top, right, bottom, targetRect) {
    const clampedLeft = clamp(Math.min(left, right), targetRect.left, targetRect.right);
    const clampedTop = clamp(Math.min(top, bottom), targetRect.top, targetRect.bottom);
    const clampedRight = clamp(Math.max(left, right), targetRect.left, targetRect.right);
    const clampedBottom = clamp(Math.max(top, bottom), targetRect.top, targetRect.bottom);
    return new DOMRect(
      clampedLeft,
      clampedTop,
      Math.max(0, clampedRight - clampedLeft),
      Math.max(0, clampedBottom - clampedTop)
    );
  }

  function positionCropSelection(selection, item, selectionRect) {
    const itemRect = item.getBoundingClientRect();
    selection.style.left = `${selectionRect.left - itemRect.left}px`;
    selection.style.top = `${selectionRect.top - itemRect.top}px`;
    selection.style.width = `${selectionRect.width}px`;
    selection.style.height = `${selectionRect.height}px`;
  }

  async function loadImageQueuePreviews(imageIds) {
    const preferThumbnail = imageIds.length > 1;
    const itemType = state.currentItemType;
    const previews = await Promise.all(
      imageIds.map(async (imageId) => [
        imageId,
        await getCachedItemPreview(itemType, imageId, preferThumbnail),
      ])
    );
    return new Map(previews);
  }

  function attachImageQueueEvents(queue, onSelect) {
    queue.addEventListener("click", (event) => {
      if (state.suppressNextQueueClick) {
        state.suppressNextQueueClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const item = event.target.closest("[data-srct-queue-image-id]");
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(item.getAttribute("data-srct-queue-image-id"));
    });
  }

  function toggleWorkingImage(imageId) {
    const nextImageId = String(imageId || "").trim();
    if (!nextImageId || state.isSaving) return false;
    const next = new Set(state.workingImageIds);
    if (next.has(nextImageId)) {
      if (next.size <= 1) return false;
      next.delete(nextImageId);
    } else {
      next.add(nextImageId);
    }
    state.workingImageIds = next;
    state.currentImageId = firstWorkingImageId();
    syncImageQueueSelection();
    setModalSubtitle(getActiveImageSubtitle());
    return true;
  }

  async function refreshSelectedTagsForWorkingSet() {
    const imageIds = getWorkingImageIds();
    const itemType = state.currentItemType;
    const tagSets = await Promise.all(
      imageIds.map((imageId) => getCachedItemTags(itemType, imageId))
    );
    state.selectedTagIds = intersectSets(tagSets);
  }

  async function selectTagEditorImage(imageId) {
    if (state.currentMode !== "tags" || !toggleWorkingImage(imageId)) return;
    try {
      await refreshSelectedTagsForWorkingSet();
      if (state.currentMode !== "tags") return;
      syncTagSelectionStates();
    } catch (err) {
      console.error("[SimpleRightClickTagging] selected item tag load failed", err);
    }
  }

  async function toggleTag(tagId) {
    const imageIds = getWorkingImageIds();
    if (!imageIds.length || state.isSaving || !tagId) return;
    const itemType = state.currentItemType;

    const previous = new Set(state.selectedTagIds);
    const next = new Set(state.selectedTagIds);
    const shouldRemove = next.has(tagId);
    if (shouldRemove) next.delete(tagId);
    else next.add(tagId);

    state.selectedTagIds = next;
    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    syncTagSelectionStates();

    try {
      await Promise.all(
        imageIds.map(async (imageId) => {
          const existing = await getCachedItemTags(itemType, imageId);
          const imageTags = new Set(existing);
          if (shouldRemove) imageTags.delete(tagId);
          else imageTags.add(tagId);
          await updateItemTagIds(itemType, imageId, Array.from(imageTags));
          state.imageTagIdsByImageId.set(
            getItemCacheKey(itemType, imageId),
            imageTags
          );
        })
      );
      await refreshSelectedTagsForWorkingSet();
      syncTagSelectionStates();
    } catch (err) {
      console.error("[SimpleRightClickTagging] tag save failed", err);
      state.selectedTagIds = previous;
      syncTagSelectionStates();
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  function createTagButton(tag, cfg) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "simple-right-click-tagging__tag";
    button.setAttribute("data-srct-tag-id", tag.id);
    button.setAttribute("data-srct-hover-tag-id", tag.id);
    button.setAttribute("data-srct-tag-title", tag.name);
    button.title = tag.name;

    const label = document.createElement("span");
    label.className = "simple-right-click-tagging__tag-label";
    label.textContent = tag.name;
    button.appendChild(label);

    updateTagButtonState(button, tag.id);
    return button;
  }

  function createHeaderTagButton(tagId, name) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "simple-right-click-tagging__header-tag-button";
    button.setAttribute("data-srct-tag-id", tagId);
    button.setAttribute("data-srct-hover-tag-id", tagId);
    button.setAttribute("data-srct-tag-title", name);
    button.title = `Toggle ${name}`;
    button.setAttribute("aria-label", `Toggle ${name}`);
    button.textContent = "+";
    updateTagButtonState(button, tagId);
    return button;
  }

  function groupHasSelectedTags(group) {
    if (!group) return false;
    if (group.parent?.id && state.selectedTagIds.has(String(group.parent.id))) return true;
    return (group.items || []).some((item) => {
      if (item.type === "leaf") return state.selectedTagIds.has(String(item.id));
      if (item.type === "subgroup") {
        return (
          state.selectedTagIds.has(String(item.id)) ||
          (item.children || []).some((child) => state.selectedTagIds.has(String(child.id)))
        );
      }
      return false;
    });
  }

  function createSubgroupSection(subgroup, cfg) {
    const section = document.createElement("section");
    section.className = "simple-right-click-tagging__subgroup";
    section.setAttribute("data-srct-subgroup-id", subgroup.id);

    const header = document.createElement("div");
    header.className = "simple-right-click-tagging__subgroup-header";
    header.setAttribute("data-srct-toggle-section", "1");

    const title = document.createElement("span");
    title.className = "simple-right-click-tagging__subgroup-title";
    title.textContent = subgroup.name;

    const meta = document.createElement("span");
    meta.className = "simple-right-click-tagging__subgroup-meta";
    const selected = document.createElement("span");
    selected.className = "simple-right-click-tagging__subgroup-selected-count";
    const total = document.createElement("span");
    total.textContent = `${subgroup.children.length + 1}`;
    meta.appendChild(selected);
    meta.appendChild(total);

    const left = document.createElement("div");
    left.className = "simple-right-click-tagging__header-main";
    left.appendChild(title);
    left.appendChild(meta);

    header.appendChild(left);
    header.appendChild(createHeaderTagButton(subgroup.id, subgroup.name));

    const body = document.createElement("div");
    body.className = "simple-right-click-tagging__subgroup-body";
    subgroup.children.forEach((child) => body.appendChild(createTagButton(child, cfg)));

    const defaultOpen =
      getConfigBoolean(cfg?.defaultExpanded, false) ||
      (getConfigBoolean(cfg?.autoExpandIfSelected, true) &&
        (state.selectedTagIds.has(String(subgroup.id)) ||
          subgroup.children.some((child) => state.selectedTagIds.has(String(child.id)))));
    section.classList.toggle("is-open", defaultOpen);
    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function createGroupSection(group, cfg) {
    const section = document.createElement("section");
    section.className = "simple-right-click-tagging__group";
    section.setAttribute("data-srct-group-id", group.parent.id);

    const header = document.createElement("div");
    header.className = "simple-right-click-tagging__group-header";
    header.setAttribute("data-srct-toggle-section", "1");

    const title = document.createElement("span");
    title.className = "simple-right-click-tagging__group-title";
    title.textContent = group.parent.name;

    const meta = document.createElement("span");
    meta.className = "simple-right-click-tagging__group-meta";
    const selected = document.createElement("span");
    selected.className = "simple-right-click-tagging__selected-count";
    const total = document.createElement("span");
    let itemCount = group.parent.id === "__ungrouped__" ? 0 : 1;
    group.items.forEach((item) => {
      itemCount += item.type === "subgroup" ? item.children.length + 1 : 1;
    });
    total.textContent = `${itemCount}`;
    meta.appendChild(selected);
    meta.appendChild(total);

    const left = document.createElement("div");
    left.className = "simple-right-click-tagging__header-main";
    left.appendChild(title);
    left.appendChild(meta);

    header.appendChild(left);
    if (group.parent.id !== "__ungrouped__") {
      header.appendChild(createHeaderTagButton(group.parent.id, group.parent.name));
    }

    const body = document.createElement("div");
    body.className = "simple-right-click-tagging__group-body";
    group.items.forEach((item) => {
      if (item.type === "leaf") body.appendChild(createTagButton(item, cfg));
      else if (item.type === "subgroup") body.appendChild(createSubgroupSection(item, cfg));
    });

    section.classList.toggle(
      "is-open",
      getConfigBoolean(cfg?.defaultExpanded, false) ||
        (getConfigBoolean(cfg?.autoExpandIfSelected, true) && groupHasSelectedTags(group))
    );
    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function attachTagPanelEvents(panel) {
    panel.addEventListener("mouseover", handleTagPanelHoverIn);
    panel.addEventListener("mouseout", handleTagPanelHoverOut);

    panel.addEventListener("click", (event) => {
      const tagButton = event.target.closest("[data-srct-tag-id]");
      if (tagButton) {
        event.preventDefault();
        event.stopPropagation();
        toggleTag(tagButton.getAttribute("data-srct-tag-id"));
        return;
      }

      const searchToggle = event.target.closest("[data-srct-search-toggle]");
      if (searchToggle) {
        event.preventDefault();
        event.stopPropagation();
        toggleTag(searchToggle.getAttribute("data-srct-search-toggle"));
        return;
      }

      const toggleHeader = event.target.closest("[data-srct-toggle-section]");
      if (toggleHeader) {
        const section = toggleHeader.closest(
          ".simple-right-click-tagging__group, .simple-right-click-tagging__subgroup"
        );
        section?.classList.toggle("is-open");
      }
    });

    const input = panel.querySelector(".simple-right-click-tagging__search-input");
    input?.addEventListener("input", () => renderTagSearchResults(panel));
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        input.value = "";
        renderTagSearchResults(panel);
        event.stopPropagation();
      }
    });
  }

  async function openTagEditor(itemType, imageIds) {
    const normalizedImageIds = normalizeImageIds(imageIds);
    const imageId = normalizedImageIds[0];
    if (!imageId) return;
    const itemTitleLabel = getItemTitleLabel(itemType);
    const itemLabel = getItemLabel(itemType, normalizedImageIds.length);

    const modal = createModalShell(
      "Edit tags",
      normalizedImageIds.length > 1
        ? `${normalizedImageIds.length} of ${normalizedImageIds.length} ${itemLabel} selected`
        : `${itemTitleLabel} ${imageId}`
    );
    modal.classList.add("simple-right-click-tagging__modal--with-preview");
    state.currentItemType = itemType;
    state.currentImageId = imageId;
    state.currentImageIds = normalizedImageIds;
    state.workingImageIds = new Set(normalizedImageIds);
    state.currentMode = "tags";
    const body = modal.querySelector(".simple-right-click-tagging__dialog-body");
    body.innerHTML = '<div class="simple-right-click-tagging__loading">Loading tags...</div>';

    try {
      const [cfg, allTags, selectedTagIds, imagePreviews] = await Promise.all([
        loadConfig(),
        fetchAllTags(),
        Promise.all(
          normalizedImageIds.map((id) => getCachedItemTags(itemType, id))
        ).then(intersectSets),
        loadImageQueuePreviews(normalizedImageIds),
      ]);
      if (
        state.currentItemType !== itemType ||
        state.currentImageId !== imageId ||
        state.currentMode !== "tags"
      ) {
        return;
      }

      state.selectedTagIds = selectedTagIds;
      const groups = buildNestedGroupsPreservingOrder(allTags, cfg);
      state.searchIndex = buildSearchIndex(allTags, cfg);

      const panel = document.createElement("section");
      panel.className = "simple-right-click-tagging__tag-panel";
      applyPanelVariables(panel, cfg);

      const search = document.createElement("div");
      search.className = "simple-right-click-tagging__search";
      search.innerHTML = `
        <input type="search" class="simple-right-click-tagging__search-input" placeholder="Search tags" autocomplete="off" spellcheck="false">
        <div class="simple-right-click-tagging__search-results"></div>
        <div class="simple-right-click-tagging__search-empty" hidden>No matching tags</div>
      `;
      panel.appendChild(search);

      const groupsWrap = document.createElement("div");
      groupsWrap.className = "simple-right-click-tagging__groups";
      groups.forEach((group) => groupsWrap.appendChild(createGroupSection(group, cfg)));
      panel.appendChild(groupsWrap);

      const layout = document.createElement("div");
      layout.className = "simple-right-click-tagging__editor-layout simple-right-click-tagging__tag-editor-layout";

      const preview = createImageQueue(imagePreviews);

      layout.appendChild(panel);
      layout.appendChild(preview);
      body.innerHTML = "";
      body.appendChild(layout);
      attachTagPanelEvents(panel);
      attachImageQueueEvents(preview, selectTagEditorImage);
      attachScenePreviewVideoEvents(preview);
      syncTagSelectionStates();
      panel.querySelector(".simple-right-click-tagging__search-input")?.focus();
    } catch (err) {
      console.error("[SimpleRightClickTagging] tag editor failed", err);
      body.innerHTML = '<div class="simple-right-click-tagging__error">Could not load tag editor.</div>';
    }
  }

  function renderSelectedPerformers(panel) {
    const wrap = panel.querySelector(".simple-right-click-tagging__selected-performers");
    if (!wrap) return;
    wrap.innerHTML = "";

    if (!state.selectedPerformers.length) {
      const empty = document.createElement("div");
      empty.className = "simple-right-click-tagging__empty";
      empty.textContent = "No performers attached";
      wrap.appendChild(empty);
      return;
    }

    state.selectedPerformers.forEach((performer) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "simple-right-click-tagging__performer-chip";
      chip.setAttribute("data-srct-remove-performer", performer.id);
      chip.title = `Remove ${performer.name}`;
      if (performer.image_path) {
        const img = document.createElement("img");
        img.src = performer.image_path;
        img.alt = performer.name;
        chip.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = performer.name;
      chip.appendChild(label);
      wrap.appendChild(chip);
    });
  }

  function renderPerformerResults(panel, performers) {
    const results = panel.querySelector(".simple-right-click-tagging__performer-results");
    if (!results) return;
    results.innerHTML = "";

    if (!performers.length) {
      const empty = document.createElement("div");
      empty.className = "simple-right-click-tagging__empty";
      empty.textContent = "No performers found";
      results.appendChild(empty);
      return;
    }

    const selectedIds = new Set(state.selectedPerformers.map((performer) => performer.id));
    performers.forEach((performer) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "simple-right-click-tagging__performer-result";
      row.setAttribute("data-srct-toggle-performer", performer.id);
      row.classList.toggle("is-selected", selectedIds.has(performer.id));
      row.__srctPerformer = performer;

      const thumb = document.createElement("span");
      thumb.className = "simple-right-click-tagging__performer-thumb";
      if (performer.image_path) {
        const img = document.createElement("img");
        img.src = performer.image_path;
        img.alt = performer.name;
        thumb.appendChild(img);
      }
      row.appendChild(thumb);

      const name = document.createElement("span");
      name.className = "simple-right-click-tagging__performer-name";
      name.textContent = performer.name;
      row.appendChild(name);
      results.appendChild(row);
    });
  }

  async function searchPerformers(query) {
    const data = await gql(
      `
        query SimpleRightClickTaggingFindPerformers($filter: FindFilterType) {
          findPerformers(filter: $filter) {
            performers {
              id
              name
              image_path
            }
          }
        }
      `,
      {
        filter: {
          q: query,
          per_page: 12,
          sort: "name",
          direction: "ASC",
        },
      }
    );

    return (data?.findPerformers?.performers || [])
      .map((performer) => ({
        id: String(performer?.id || "").trim(),
        name: String(performer?.name || "").trim(),
        image_path: String(performer?.image_path || "").trim(),
      }))
      .filter((performer) => performer.id && performer.name);
  }

  function getVisageBridge() {
    return window.VisageQuickTagging || null;
  }

  function setVisageStatus(panel, message, isError = false) {
    const status = panel.querySelector(".simple-right-click-tagging__visage-status");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  function setVisageCropReady(panel, ready) {
    panel
      .querySelectorAll("[data-srct-visage-needs-crop]")
      .forEach((button) => {
        button.disabled = !ready;
      });
    panel.classList.toggle("has-visage-crop", !!ready);
  }

  function getCandidateImageSource(candidate) {
    const bridge = getVisageBridge();
    const image = candidate?.image || candidate?.image_url || candidate?.image_path || "";
    return bridge?.imageSource ? bridge.imageSource(image) : image;
  }

  function getVisageConfidenceLabel(candidate) {
    if (!Number.isFinite(candidate?.confidence)) return "";
    return `${candidate.confidence}%`;
  }

  function renderVisageCandidates(panel, candidates) {
    const results = panel.querySelector(".simple-right-click-tagging__visage-results");
    if (!results) return;
    results.innerHTML = "";

    if (!candidates.length) {
      results.innerHTML = '<div class="simple-right-click-tagging__empty">No Visage matches found.</div>';
      return;
    }

    candidates.forEach((candidate) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "simple-right-click-tagging__visage-match";
      card.setAttribute("data-srct-visage-search-name", candidate.name || "");
      card.__srctVisageCandidate = candidate;

      const frame = document.createElement("span");
      frame.className = "simple-right-click-tagging__visage-match-frame";
      const imageSrc = getCandidateImageSource(candidate);
      if (imageSrc) {
        const img = document.createElement("img");
        img.src = imageSrc;
        img.alt = candidate.name || "Performer match";
        frame.appendChild(img);
      }
      card.appendChild(frame);

      const name = document.createElement("strong");
      name.className = "simple-right-click-tagging__visage-match-name";
      name.textContent = candidate.name || "Unknown performer";
      card.appendChild(name);

      const confidence = getVisageConfidenceLabel(candidate);
      if (confidence) {
        const badge = document.createElement("span");
        badge.className = "simple-right-click-tagging__visage-match-confidence";
        badge.textContent = confidence;
        card.appendChild(badge);
      }
      results.appendChild(card);
    });
  }

  function loadImageForCrop(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image for Visage crop."));
      img.src = url;
    });
  }

  async function createVisageCropFromSelection(panel, visibleImg, selectionRect, targetRect) {
    const bridge = getVisageBridge();
    if (!bridge?.cropTarget) throw new Error("Visage is not available.");

    const item = visibleImg.closest("[data-srct-queue-image-id]");
    const imageId = item?.getAttribute("data-srct-queue-image-id") || "";
    const preview = imageId ? await getCachedImagePreview(imageId, false) : null;
    const sourceImg = preview?.url ? await loadImageForCrop(preview.url) : visibleImg;
    await bridge.cropTarget(sourceImg, selectionRect, targetRect);

    setVisageCropReady(panel, true);
    setVisageStatus(panel, "Crop ready.");
  }

  function startVisageCropMode(panel) {
    const bridge = getVisageBridge();
    const queue = document.querySelector(`#${MODAL_ID} .simple-right-click-tagging__image-queue`);
    if (!bridge?.cropTarget || !queue) {
      setVisageStatus(panel, "Visage crop tools are not available.", true);
      return;
    }

    queue.classList.add("is-visage-cropping");
    setVisageStatus(panel, "Drag over a face in the preview pane.");

    const stopCropMode = () => {
      queue.classList.remove("is-visage-cropping");
      queue.removeEventListener("mousedown", onMouseDown, true);
    };

    const onMouseDown = (event) => {
      const visibleImg = event.target.closest(".simple-right-click-tagging__image-queue-item img");
      if (!(visibleImg instanceof HTMLImageElement)) return;

      const item = visibleImg.closest(".simple-right-click-tagging__image-queue-item");
      if (!(item instanceof HTMLElement)) return;

      event.preventDefault();
      event.stopPropagation();
      state.suppressNextQueueClick = true;

      const targetRect = getRenderedImageRect(visibleImg);
      const selection = document.createElement("div");
      selection.className = "simple-right-click-tagging__visage-selection";
      item.appendChild(selection);

      let latestRect = new DOMRect(event.clientX, event.clientY, 0, 0);
      const startX = event.clientX;
      const startY = event.clientY;

      const onMouseMove = (moveEvent) => {
        latestRect = clampRectToTarget(startX, startY, moveEvent.clientX, moveEvent.clientY, targetRect);
        positionCropSelection(selection, item, latestRect);
      };

      const onMouseUp = async (upEvent) => {
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("mouseup", onMouseUp, true);
        latestRect = clampRectToTarget(startX, startY, upEvent.clientX, upEvent.clientY, targetRect);
        positionCropSelection(selection, item, latestRect);
        stopCropMode();

        if (latestRect.width < 12 || latestRect.height < 12) {
          selection.remove();
          setVisageStatus(panel, "Selection was too small.", true);
          return;
        }

        try {
          setVisageStatus(panel, "Creating crop...");
          await createVisageCropFromSelection(panel, visibleImg, latestRect, targetRect);
        } catch (err) {
          setVisageStatus(panel, err.message || "Could not create crop.", true);
        } finally {
          window.setTimeout(() => selection.remove(), 700);
        }
      };

      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("mouseup", onMouseUp, true);
    };

    queue.addEventListener("mousedown", onMouseDown, true);
  }

  function renderVisagePanel(panel) {
    if (
      state.currentItemType !== "image" ||
      !getVisageBridge() ||
      panel.querySelector(".simple-right-click-tagging__visage-panel")
    ) {
      return;
    }

    const visagePanel = document.createElement("section");
    visagePanel.className = "simple-right-click-tagging__visage-panel";
    visagePanel.innerHTML = `
      <div class="simple-right-click-tagging__visage-header">
        <div class="simple-right-click-tagging__visage-title">Visage</div>
        <div class="simple-right-click-tagging__visage-actions">
          <button type="button" class="simple-right-click-tagging__visage-button" data-srct-visage-action="crop">Crop face</button>
          <button type="button" class="simple-right-click-tagging__visage-button simple-right-click-tagging__visage-button--open" data-srct-visage-action="open">Open StashFace</button>
          <button type="button" class="simple-right-click-tagging__visage-button simple-right-click-tagging__visage-button--find" data-srct-visage-action="find" data-srct-visage-needs-crop disabled>Find matches</button>
          <button type="button" class="simple-right-click-tagging__visage-button" data-srct-visage-action="copy" data-srct-visage-needs-crop disabled>Copy crop</button>
          <button type="button" class="simple-right-click-tagging__visage-button" data-srct-visage-action="download" data-srct-visage-needs-crop disabled>Download crop</button>
        </div>
      </div>
      <div class="simple-right-click-tagging__visage-status"></div>
      <div class="simple-right-click-tagging__visage-results"></div>
    `;

    const searchInput = panel.querySelector(".simple-right-click-tagging__performer-search");
    panel.insertBefore(visagePanel, searchInput || panel.firstChild);
  }

  function getCurrentPerformerResults(panel) {
    return Array.from(panel.querySelectorAll(".simple-right-click-tagging__performer-result"))
      .map((row) => row.__srctPerformer)
      .filter(Boolean);
  }

  function setPerformerSearchValue(panel, value) {
    const input = panel.querySelector(".simple-right-click-tagging__performer-search");
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function chooseLocalPerformerForCandidate(candidate, performers) {
    const candidateName = normalizeSearchText(candidate?.name || "");
    const exactMatches = performers.filter(
      (performer) => normalizeSearchText(performer.name) === candidateName
    );
    if (exactMatches.length === 1) return exactMatches[0];
    if (!exactMatches.length && performers.length === 1) return performers[0];
    return null;
  }

  async function assignVisageCandidate(panel, candidate) {
    const name = String(candidate?.name || "").trim();
    if (!name || state.isSaving) return;

    setVisageStatus(panel, `Resolving ${name}...`);
    try {
      const performers = await searchPerformers(name);
      const performer = chooseLocalPerformerForCandidate(candidate, performers);
      if (!performer) {
        renderPerformerResults(panel, performers);
        setPerformerSearchValue(panel, name);
        setVisageStatus(
          panel,
          performers.length
            ? "Multiple local matches found. Choose one below."
            : "No clear local performer found. Search filled below.",
          performers.length === 0
        );
        return;
      }

      const alreadySelected = state.selectedPerformers.some((item) => item.id === performer.id);
      if (alreadySelected) {
        setVisageStatus(panel, `${performer.name} is already assigned.`);
        return;
      }

      togglePerformer(performer, panel);
      setVisageStatus(panel, `Assigned ${performer.name}.`);
    } catch (err) {
      setPerformerSearchValue(panel, name);
      setVisageStatus(panel, err.message || "Could not assign Visage match.", true);
    }
  }

  async function refreshSelectedPerformersForWorkingSet() {
    const imageIds = getWorkingImageIds();
    const itemType = state.currentItemType;
    const performerLists = await Promise.all(
      imageIds.map((imageId) => getCachedItemPerformers(itemType, imageId))
    );
    state.selectedPerformers = intersectPerformers(performerLists);
  }

  async function selectPerformerEditorImage(imageId, panel) {
    if (state.currentMode !== "performers" || !toggleWorkingImage(imageId)) return;
    try {
      await refreshSelectedPerformersForWorkingSet();
      if (state.currentMode !== "performers") return;
      renderSelectedPerformers(panel);
      renderPerformerResults(panel, getCurrentPerformerResults(panel));
    } catch (err) {
      console.error("[SimpleRightClickTagging] selected item performer load failed", err);
    }
  }

  async function persistSelectedPerformers(previousPerformers) {
    const imageIds = getWorkingImageIds();
    if (!imageIds.length || state.isSaving) return;
    const itemType = state.currentItemType;
    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");

    try {
      const previousIds = new Set(previousPerformers.map((performer) => performer.id));
      const nextById = new Map(state.selectedPerformers.map((performer) => [performer.id, performer]));
      await Promise.all(
        imageIds.map(async (imageId) => {
          const existing = await getCachedItemPerformers(itemType, imageId);
          const merged = new Map(existing.map((performer) => [performer.id, performer]));
          previousIds.forEach((performerId) => {
            if (!nextById.has(performerId)) merged.delete(performerId);
          });
          nextById.forEach((performer, performerId) => merged.set(performerId, performer));
          const next = Array.from(merged.values());
          await updateItemPerformerIds(
            itemType,
            imageId,
            next.map((performer) => performer.id)
          );
          state.imagePerformersByImageId.set(
            getItemCacheKey(itemType, imageId),
            next
          );
        })
      );
      await refreshSelectedPerformersForWorkingSet();
      const panel = document.querySelector(".simple-right-click-tagging__performer-panel");
      if (panel) {
        renderSelectedPerformers(panel);
        renderPerformerResults(panel, getCurrentPerformerResults(panel));
      }
    } catch (err) {
      console.error("[SimpleRightClickTagging] performer save failed", err);
      state.selectedPerformers = previousPerformers;
      const panel = document.querySelector(".simple-right-click-tagging__performer-panel");
      if (panel) {
        renderSelectedPerformers(panel);
        const rows = Array.from(panel.querySelectorAll(".simple-right-click-tagging__performer-result"))
          .map((row) => row.__srctPerformer)
          .filter(Boolean);
        renderPerformerResults(panel, rows);
      }
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  function togglePerformer(performer, panel) {
    if (!performer?.id || state.isSaving) return;
    const previous = state.selectedPerformers.slice();
    const exists = state.selectedPerformers.some((item) => item.id === performer.id);
    state.selectedPerformers = exists
      ? state.selectedPerformers.filter((item) => item.id !== performer.id)
      : state.selectedPerformers.concat(performer);
    renderSelectedPerformers(panel);
    renderPerformerResults(panel, getCurrentPerformerResults(panel));
    persistSelectedPerformers(previous);
  }

  function attachPerformerPanelEvents(panel) {
    const input = panel.querySelector(".simple-right-click-tagging__performer-search");
    input?.addEventListener("input", () => {
      if (state.performerSearchTimer) window.clearTimeout(state.performerSearchTimer);
      const query = input.value.trim();
      state.performerSearchTimer = window.setTimeout(async () => {
        const results = panel.querySelector(".simple-right-click-tagging__performer-results");
        if (!query) {
          if (results) results.innerHTML = "";
          return;
        }
        if (results) results.innerHTML = '<div class="simple-right-click-tagging__loading">Searching...</div>';
        try {
          renderPerformerResults(panel, await searchPerformers(query));
        } catch (err) {
          console.error("[SimpleRightClickTagging] performer search failed", err);
          if (results) results.innerHTML = '<div class="simple-right-click-tagging__error">Search failed.</div>';
        }
      }, 180);
    });

    panel.addEventListener("click", (event) => {
      const visageAction = event.target.closest("[data-srct-visage-action]");
      if (visageAction) {
        event.preventDefault();
        event.stopPropagation();
        handleVisageAction(panel, visageAction);
        return;
      }

      const visageSearch = event.target.closest("[data-srct-visage-search-name]");
      if (visageSearch) {
        event.preventDefault();
        event.stopPropagation();
        assignVisageCandidate(panel, visageSearch.__srctVisageCandidate);
        return;
      }

      const remove = event.target.closest("[data-srct-remove-performer]");
      if (remove) {
        event.preventDefault();
        const performer = state.selectedPerformers.find(
          (item) => item.id === remove.getAttribute("data-srct-remove-performer")
        );
        togglePerformer(performer, panel);
        return;
      }

      const row = event.target.closest("[data-srct-toggle-performer]");
      if (row) {
        event.preventDefault();
        togglePerformer(row.__srctPerformer, panel);
      }
    });
  }

  function setStudioStatus(panel, message, isError = false) {
    const status = panel.querySelector(".simple-right-click-tagging__studio-status");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  function renderSelectedStudio(panel) {
    const wrap = panel.querySelector(".simple-right-click-tagging__selected-studio");
    if (!wrap) return;
    wrap.innerHTML = "";

    const content = document.createElement("div");
    content.className = "simple-right-click-tagging__selected-studio-content";

    if (state.selectedStudioMixed) {
      const mixed = document.createElement("div");
      mixed.className = "simple-right-click-tagging__empty";
      mixed.textContent = "Mixed studios";
      content.appendChild(mixed);
    } else if (state.selectedStudio) {
      const chip = document.createElement("div");
      chip.className = "simple-right-click-tagging__studio-chip";
      if (state.selectedStudio.image_path) {
        const img = document.createElement("img");
        img.src = state.selectedStudio.image_path;
        img.alt = state.selectedStudio.name;
        chip.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = state.selectedStudio.name;
      chip.appendChild(label);
      content.appendChild(chip);
    } else {
      const empty = document.createElement("div");
      empty.className = "simple-right-click-tagging__empty";
      empty.textContent = "No studio attached";
      content.appendChild(empty);
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "simple-right-click-tagging__studio-clear";
    clear.setAttribute("data-srct-clear-studio", "1");
    clear.textContent = "Clear studio";
    clear.disabled = !state.selectedStudio && !state.selectedStudioMixed;

    wrap.appendChild(content);
    wrap.appendChild(clear);
  }

  function getCurrentStudioResults(panel) {
    return Array.from(panel.querySelectorAll(".simple-right-click-tagging__studio-result"))
      .map((row) => row.__srctStudio)
      .filter(Boolean);
  }

  function renderStudioResults(panel, studios) {
    const results = panel.querySelector(".simple-right-click-tagging__studio-results");
    if (!results) return;
    results.innerHTML = "";

    if (!studios.length) {
      const empty = document.createElement("div");
      empty.className = "simple-right-click-tagging__empty";
      empty.textContent = "No studios found";
      results.appendChild(empty);
      return;
    }

    studios.forEach((studio) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "simple-right-click-tagging__studio-result";
      row.setAttribute("data-srct-assign-studio", studio.id);
      row.classList.toggle("is-selected", state.selectedStudio?.id === studio.id && !state.selectedStudioMixed);
      row.__srctStudio = studio;

      const thumb = document.createElement("span");
      thumb.className = "simple-right-click-tagging__studio-thumb";
      if (studio.image_path) {
        const img = document.createElement("img");
        img.src = studio.image_path;
        img.alt = studio.name;
        thumb.appendChild(img);
      }
      row.appendChild(thumb);

      const name = document.createElement("span");
      name.className = "simple-right-click-tagging__studio-name";
      name.textContent = studio.name;
      row.appendChild(name);
      results.appendChild(row);
    });
  }

  async function searchStudios(query) {
    const data = await gql(
      `
        query SimpleRightClickTaggingFindStudios($filter: FindFilterType) {
          findStudios(filter: $filter) {
            studios {
              id
              name
              image_path
            }
          }
        }
      `,
      {
        filter: {
          q: query,
          per_page: 16,
          sort: "name",
          direction: "ASC",
        },
      }
    );

    return (data?.findStudios?.studios || []).map(normalizeStudio).filter(Boolean);
  }

  function chooseExactNamedItem(name, items) {
    const normalizedName = normalizeSearchText(name);
    const exactMatches = (items || []).filter(
      (item) => normalizeSearchText(item?.name || item?.sort_name || "") === normalizedName
    );
    if (exactMatches.length === 1) return exactMatches[0];
    if (!exactMatches.length && items?.length === 1) return items[0];
    return null;
  }

  async function resolveQuickAccessTag(name) {
    await fetchAllTags();
    const normalizedName = normalizeSearchText(name);
    const matches = Array.from(state.tagMap.values()).filter((tag) => {
      return (
        normalizeSearchText(tag.name) === normalizedName ||
        normalizeSearchText(tag.sort_name) === normalizedName
      );
    });
    return chooseExactNamedItem(name, matches);
  }

  async function resolveQuickAccessPerformer(name) {
    return chooseExactNamedItem(name, await searchPerformers(name));
  }

  async function resolveQuickAccessStudio(name) {
    return chooseExactNamedItem(name, await searchStudios(name));
  }

  async function addQuickAccessTag(itemType, itemIds, tag) {
    await Promise.all(
      itemIds.map(async (itemId) => {
        const existing = await getCachedItemTags(itemType, itemId);
        if (existing.has(tag.id)) return;
        const next = new Set(existing);
        next.add(tag.id);
        await updateItemTagIds(itemType, itemId, Array.from(next));
        state.imageTagIdsByImageId.set(getItemCacheKey(itemType, itemId), next);
      })
    );
  }

  async function removeQuickAccessTag(itemType, itemIds, tag) {
    await Promise.all(
      itemIds.map(async (itemId) => {
        const existing = await getCachedItemTags(itemType, itemId);
        if (!existing.has(tag.id)) return;
        const next = new Set(existing);
        next.delete(tag.id);
        await updateItemTagIds(itemType, itemId, Array.from(next));
        state.imageTagIdsByImageId.set(getItemCacheKey(itemType, itemId), next);
      })
    );
  }

  async function addQuickAccessPerformer(itemType, itemIds, performer) {
    await Promise.all(
      itemIds.map(async (itemId) => {
        const existing = await getCachedItemPerformers(itemType, itemId);
        if (existing.some((item) => item.id === performer.id)) return;
        const next = existing.concat(performer);
        await updateItemPerformerIds(
          itemType,
          itemId,
          next.map((item) => item.id)
        );
        state.imagePerformersByImageId.set(getItemCacheKey(itemType, itemId), next);
      })
    );
  }

  async function removeQuickAccessPerformer(itemType, itemIds, performer) {
    if (itemType === "performer") return;
    await Promise.all(
      itemIds.map(async (itemId) => {
        const existing = await getCachedItemPerformers(itemType, itemId);
        const next = existing.filter((item) => item.id !== performer.id);
        if (next.length === existing.length) return;
        await updateItemPerformerIds(
          itemType,
          itemId,
          next.map((item) => item.id)
        );
        state.imagePerformersByImageId.set(getItemCacheKey(itemType, itemId), next);
      })
    );
  }

  async function setQuickAccessStudio(itemType, itemIds, studio) {
    await Promise.all(
      itemIds.map(async (itemId) => {
        await updateItemStudioId(itemType, itemId, studio.id);
        state.imageStudiosByImageId.set(getItemCacheKey(itemType, itemId), studio);
      })
    );
  }

  async function clearQuickAccessStudio(itemType, itemIds, studio = null) {
    if (itemType === "performer") return;
    await Promise.all(
      itemIds.map(async (itemId) => {
        if (studio?.id) {
          const existing = await getCachedItemStudio(itemType, itemId);
          if (existing?.id !== studio.id) return;
        }
        await updateItemStudioId(itemType, itemId, null);
        state.imageStudiosByImageId.set(getItemCacheKey(itemType, itemId), null);
      })
    );
  }

  async function getTagRecordsByIds(tagIds) {
    const ids = parseIdList(tagIds);
    if (!ids.length) return [];
    await fetchAllTags();
    return ids
      .map((id) => state.tagMap.get(String(id)))
      .filter(Boolean)
      .map((tag) => normalizeSavedRecord(tag))
      .filter(Boolean);
  }

  async function copyMetadataToClipboard(itemType, itemIds, copyKind) {
    const normalizedItemIds = normalizeImageIds(itemIds);
    const sourceId = normalizedItemIds[0];
    if (!sourceId) return;

    showQuickAccessToast("Copying metadata...");
    try {
      const tagIds = copyKind === "performers" || copyKind === "studio"
        ? []
        : Array.from(await getCachedItemTags(itemType, sourceId));
      const [tags, performers, studio] = await Promise.all([
        getTagRecordsByIds(tagIds),
        itemType === "performer" || copyKind === "tags" || copyKind === "studio"
          ? Promise.resolve([])
          : getCachedItemPerformers(itemType, sourceId).then((items) =>
              items.map(normalizeSavedRecord).filter(Boolean)
            ),
        itemType === "performer" || copyKind === "tags" || copyKind === "performers"
          ? Promise.resolve(null)
          : getCachedItemStudio(itemType, sourceId).then(normalizeStudio),
      ]);
      const clipboard = {
        version: 1,
        sourceType: itemType,
        sourceId,
        copyKind,
        tags: copyKind === "tags" || copyKind === "all" ? tags : [],
        performers: copyKind === "performers" || copyKind === "all" ? performers : [],
        studio: copyKind === "studio" || copyKind === "all" ? studio : null,
        timestamp: Date.now(),
      };
      saveMetadataClipboard(clipboard);
      showQuickAccessToast(`Copied ${getClipboardSummary(clipboard)}.`);
      refreshContextMenuSidePanel();
    } catch (err) {
      console.error("[SimpleRightClickTagging] metadata copy failed", err);
      showQuickAccessToast(err.message || "Could not copy metadata.", true);
    }
  }

  async function pasteMetadataFromClipboard(itemType, itemIds, pasteKind, recordPrevious = true) {
    const normalizedItemIds = normalizeImageIds(itemIds);
    const clipboard = loadMetadataClipboard();
    if (!canPasteClipboardKind(pasteKind, clipboard) || !normalizedItemIds.length || state.isSaving) return;
    if (itemType === "performer" && pasteKind !== "tags" && pasteKind !== "all") return;

    const shouldPasteTags = pasteKind === "tags" || pasteKind === "all";
    const shouldPastePerformers = itemType !== "performer" && (pasteKind === "performers" || pasteKind === "all");
    const shouldPasteStudio = itemType !== "performer" && (pasteKind === "studio" || pasteKind === "all");

    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    showQuickAccessToast("Pasting metadata...");
    try {
      for (const tag of clipboard.tags || []) {
        if (shouldPasteTags) await addQuickAccessTag(itemType, normalizedItemIds, tag);
      }
      for (const performer of clipboard.performers || []) {
        if (shouldPastePerformers) await addQuickAccessPerformer(itemType, normalizedItemIds, performer);
      }
      if (shouldPasteStudio && clipboard.studio?.id) {
        await setQuickAccessStudio(itemType, normalizedItemIds, clipboard.studio);
      }
      if (recordPrevious) savePreviousAction({ type: "paste", pasteKind, timestamp: Date.now() });
      showQuickAccessToast(`Pasted ${getMetadataKindLabel(pasteKind)} to ${normalizedItemIds.length} ${getItemLabel(itemType, normalizedItemIds.length)}.`);
      refreshContextMenuSidePanel();
    } catch (err) {
      console.error("[SimpleRightClickTagging] metadata paste failed", err);
      showQuickAccessToast(err.message || "Could not paste metadata.", true);
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  function updateRatingOutput(menu, rating100) {
    const output = menu.querySelector("[data-srct-rating-output]");
    if (!output) return;
    output.textContent = rating100 > 0 ? `${Math.round(rating100)}%` : "Unrated";
  }

  function renderQuickSearchResults(menu, kind, records) {
    const results = menu.querySelector(`[data-srct-quick-results="${kind}"]`);
    if (!results) return;
    results.innerHTML = "";

    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "simple-right-click-tagging__quick-search-empty";
      empty.textContent = "No matches";
      results.appendChild(empty);
      return;
    }

    records.slice(0, 6).forEach((record) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "simple-right-click-tagging__quick-search-result";
      button.setAttribute("data-srct-action", "quick-search-result");
      button.setAttribute("data-srct-quick-kind", kind);
      button.setAttribute("data-srct-quick-id", record.id);
      button.setAttribute("data-srct-quick-name", record.name);
      button.textContent = record.name;
      results.appendChild(button);
    });
  }

  async function getQuickSearchRecords(kind, query) {
    if (kind === "tag") {
      await fetchAllTags();
      if (!state.searchIndex) state.searchIndex = buildSearchIndex(state.allTags, state.config || {});
      return getSearchResults(query, 6).map((item) => ({
        id: item.id,
        name: item.name,
        sort_name: item.sort_name || item.name || "",
        image_path: item.image_path || "",
      }));
    }
    if (kind === "performer") return searchPerformers(query);
    if (kind === "studio") return searchStudios(query);
    return [];
  }

  function scheduleQuickMenuSearch(menu, input) {
    const kind = input.getAttribute("data-srct-quick-search") || "";
    const query = input.value.trim();
    const results = menu.querySelector(`[data-srct-quick-results="${kind}"]`);
    if (state.quickSearchTimers.has(kind)) {
      window.clearTimeout(state.quickSearchTimers.get(kind));
    }
    if (!query) {
      if (results) results.innerHTML = "";
      return;
    }

    if (results) results.innerHTML = '<div class="simple-right-click-tagging__quick-search-empty">Searching...</div>';
    state.quickSearchTimers.set(
      kind,
      window.setTimeout(async () => {
        try {
          renderQuickSearchResults(menu, kind, await getQuickSearchRecords(kind, query));
        } catch (err) {
          console.error("[SimpleRightClickTagging] quick search failed", err);
          if (results) results.innerHTML = '<div class="simple-right-click-tagging__quick-search-empty">Search failed</div>';
        }
      }, 160)
    );
  }

  async function applyResolvedQuickItem(itemType, itemIds, kind, record, options = {}) {
    const normalizedItemIds = normalizeImageIds(itemIds);
    if (!normalizedItemIds.length || state.isSaving) return;
    if ((kind === "performer" || kind === "studio") && itemType === "performer") return;
    const remove = !!options.remove;
    const normalizedRecord =
      kind === "studio" ? normalizeStudio(record) : record?.id && record?.name ? record : null;
    if (!normalizedRecord) {
      showQuickAccessToast("Could not resolve quick action.", true);
      return;
    }

    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    showQuickAccessToast(`${remove ? "Removing" : "Applying"} ${normalizedRecord.name}...`);

    try {
      if (kind === "tag") {
        if (remove) await removeQuickAccessTag(itemType, normalizedItemIds, normalizedRecord);
        else await addQuickAccessTag(itemType, normalizedItemIds, normalizedRecord);
        recordRecentQuickAction("tag", normalizedRecord);
        savePreviousAction({ type: "quick", kind, record: normalizedRecord, remove, timestamp: Date.now() });
        showQuickAccessToast(
          `${remove ? "Removed" : "Added"} tag ${normalizedRecord.name} ${remove ? "from" : "to"} ${normalizedItemIds.length} ${getItemLabel(itemType, normalizedItemIds.length)}.`
        );
        refreshContextMenuSidePanel();
        return;
      }

      if (kind === "performer") {
        if (remove) await removeQuickAccessPerformer(itemType, normalizedItemIds, normalizedRecord);
        else await addQuickAccessPerformer(itemType, normalizedItemIds, normalizedRecord);
        recordRecentQuickAction("performer", normalizedRecord);
        savePreviousAction({ type: "quick", kind, record: normalizedRecord, remove, timestamp: Date.now() });
        showQuickAccessToast(
          `${remove ? "Removed" : "Added"} performer ${normalizedRecord.name} ${remove ? "from" : "to"} ${normalizedItemIds.length} ${getItemLabel(itemType, normalizedItemIds.length)}.`
        );
        refreshContextMenuSidePanel();
        return;
      }

      if (kind === "studio") {
        if (remove) await clearQuickAccessStudio(itemType, normalizedItemIds, normalizedRecord);
        else await setQuickAccessStudio(itemType, normalizedItemIds, normalizedRecord);
        recordRecentQuickAction("studio", normalizedRecord);
        savePreviousAction({ type: "quick", kind, record: normalizedRecord, remove, timestamp: Date.now() });
        showQuickAccessToast(
          `${remove ? "Cleared studio" : `Set studio ${normalizedRecord.name}`} on ${normalizedItemIds.length} ${getItemLabel(itemType, normalizedItemIds.length)}.`
        );
        refreshContextMenuSidePanel();
        return;
      }

      throw new Error("Unknown quick access action.");
    } catch (err) {
      console.error("[SimpleRightClickTagging] quick access failed", err);
      showQuickAccessToast(err.message || "Quick access failed.", true);
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  async function applyQuickAccessItem(itemType, itemIds, kind, name, options = {}) {
    if (!name || state.isSaving) return;
    try {
      showQuickAccessToast(`Resolving ${name}...`);
      let record = null;
      if (kind === "tag") record = await resolveQuickAccessTag(name);
      else if (kind === "performer") record = await resolveQuickAccessPerformer(name);
      else if (kind === "studio") record = await resolveQuickAccessStudio(name);
      if (!record) throw new Error(`Could not resolve ${kind}: ${name}`);
      await applyResolvedQuickItem(itemType, itemIds, kind, record, options);
    } catch (err) {
      console.error("[SimpleRightClickTagging] quick access resolve failed", err);
      showQuickAccessToast(err.message || "Quick access failed.", true);
    }
  }

  async function applyQuickAccessPreset(itemType, itemIds, preset) {
    const normalizedItemIds = normalizeImageIds(itemIds);
    if (!preset || !normalizedItemIds.length || state.isSaving) return;
    if (itemType === "performer" && !preset.tags.length) return;

    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    showQuickAccessToast(`Applying ${preset.label}...`);

    try {
      const tags = await Promise.all(preset.tags.map(resolveQuickAccessTag));
      const performers =
        itemType === "performer"
          ? []
          : await Promise.all(preset.performers.map(resolveQuickAccessPerformer));
      const studio =
        itemType === "performer" || !preset.studio
          ? null
          : await resolveQuickAccessStudio(preset.studio);

      if (tags.some((tag) => !tag)) throw new Error(`Preset ${preset.label} has an unresolved tag.`);
      if (performers.some((performer) => !performer)) {
        throw new Error(`Preset ${preset.label} has an unresolved performer.`);
      }
      if (preset.studio && itemType !== "performer" && !studio) {
        throw new Error(`Preset ${preset.label} has an unresolved studio.`);
      }

      for (const tag of tags) {
        await addQuickAccessTag(itemType, normalizedItemIds, tag);
        recordRecentQuickAction("tag", tag);
      }
      for (const performer of performers) {
        await addQuickAccessPerformer(itemType, normalizedItemIds, performer);
        recordRecentQuickAction("performer", performer);
      }
      if (studio) {
        await setQuickAccessStudio(itemType, normalizedItemIds, studio);
        recordRecentQuickAction("studio", studio);
      }

      showQuickAccessToast(
        `Applied ${preset.label} to ${normalizedItemIds.length} ${getItemLabel(itemType, normalizedItemIds.length)}.`
      );
      savePreviousAction({ type: "preset", preset, timestamp: Date.now() });
      refreshContextMenuSidePanel();
    } catch (err) {
      console.error("[SimpleRightClickTagging] preset failed", err);
      showQuickAccessToast(err.message || "Preset failed.", true);
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  async function updateMetadataForItems(itemType, itemIds, patch, successMessage) {
    const normalizedItemIds = normalizeImageIds(itemIds);
    if (!normalizedItemIds.length || state.isSaving || itemType === "performer") return false;
    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    showQuickAccessToast("Updating metadata...");

    try {
      await Promise.all(
        normalizedItemIds.map(async (itemId) => {
          await updateItemMetadata(itemType, itemId, patch);
          const cacheKey = getItemCacheKey(itemType, itemId);
          const existing = state.imageMetadataByImageId.get(cacheKey) || {};
          state.imageMetadataByImageId.set(cacheKey, { ...existing, ...patch });
        })
      );
      showQuickAccessToast(successMessage);
      refreshContextMenuSidePanel();
      return true;
    } catch (err) {
      console.error("[SimpleRightClickTagging] metadata update failed", err);
      showQuickAccessToast(err.message || "Could not update metadata.", true);
      return false;
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  async function applyQuickRating(itemType, itemIds, rating100) {
    const rating = Math.max(0, Math.min(100, Math.round(Number(rating100) || 0)));
    const saved = await updateMetadataForItems(
      itemType,
      itemIds,
      { rating100: rating > 0 ? rating : null },
      rating > 0 ? `Set rating to ${rating}%.` : "Cleared rating."
    );
    if (!saved) return;
    savePreviousAction({
      type: "metadata",
      patch: { rating100: rating > 0 ? rating : null },
      label: rating > 0 ? `Rating ${rating}%` : "Clear rating",
      timestamp: Date.now(),
    });
    refreshContextMenuSidePanel();
  }

  async function applyQuickDate(itemType, itemIds, date) {
    const saved = await updateMetadataForItems(
      itemType,
      itemIds,
      { date: String(date || "") || null },
      date ? `Set date to ${date}.` : "Cleared date."
    );
    if (!saved) return;
    savePreviousAction({
      type: "metadata",
      patch: { date: String(date || "") || null },
      label: date ? `Date ${date}` : "Clear date",
      timestamp: Date.now(),
    });
    refreshContextMenuSidePanel();
  }

  async function toggleQuickOrganized(itemType, itemIds) {
    const normalizedItemIds = normalizeImageIds(itemIds);
    if (!normalizedItemIds.length || itemType === "performer") return;
    try {
      const firstMetadata = await getCachedItemMetadata(itemType, normalizedItemIds[0]);
      const nextOrganized = !firstMetadata?.organized;
      const saved = await updateMetadataForItems(
        itemType,
        normalizedItemIds,
        { organized: nextOrganized },
        nextOrganized ? "Marked organized." : "Marked unorganized."
      );
      if (!saved) return;
      savePreviousAction({
        type: "metadata",
        patch: { organized: nextOrganized },
        label: nextOrganized ? "Mark organized" : "Mark unorganized",
        timestamp: Date.now(),
      });
      refreshContextMenuSidePanel();
    } catch (err) {
      console.error("[SimpleRightClickTagging] organized toggle failed", err);
      showQuickAccessToast(err.message || "Could not toggle organized.", true);
    }
  }

  async function clearMetadataSection(itemType, itemIds, clearKind, recordPrevious = true) {
    const normalizedItemIds = normalizeImageIds(itemIds);
    if (!normalizedItemIds.length || state.isSaving) return;
    if (itemType === "performer" && clearKind !== "tags") return;

    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    showQuickAccessToast(`Clearing ${getMetadataKindLabel(clearKind)}...`);
    try {
      if (clearKind === "tags") {
        await Promise.all(
          normalizedItemIds.map(async (itemId) => {
            await updateItemTagIds(itemType, itemId, []);
            state.imageTagIdsByImageId.set(getItemCacheKey(itemType, itemId), new Set());
          })
        );
      } else if (clearKind === "performers") {
        await Promise.all(
          normalizedItemIds.map(async (itemId) => {
            await updateItemPerformerIds(itemType, itemId, []);
            state.imagePerformersByImageId.set(getItemCacheKey(itemType, itemId), []);
          })
        );
      } else if (clearKind === "studio") {
        await clearQuickAccessStudio(itemType, normalizedItemIds);
      } else if (clearKind === "rating") {
        await Promise.all(
          normalizedItemIds.map(async (itemId) => {
            await updateItemMetadata(itemType, itemId, { rating100: null });
            const cacheKey = getItemCacheKey(itemType, itemId);
            const existing = state.imageMetadataByImageId.get(cacheKey) || {};
            state.imageMetadataByImageId.set(cacheKey, { ...existing, rating100: null });
          })
        );
      } else if (clearKind === "date") {
        await Promise.all(
          normalizedItemIds.map(async (itemId) => {
            await updateItemMetadata(itemType, itemId, { date: null });
            const cacheKey = getItemCacheKey(itemType, itemId);
            const existing = state.imageMetadataByImageId.get(cacheKey) || {};
            state.imageMetadataByImageId.set(cacheKey, { ...existing, date: null });
          })
        );
      } else {
        throw new Error("Unknown clear action.");
      }
      if (recordPrevious) savePreviousAction({ type: "clear", clearKind, timestamp: Date.now() });
      showQuickAccessToast(`Cleared ${getMetadataKindLabel(clearKind)} from ${normalizedItemIds.length} ${getItemLabel(itemType, normalizedItemIds.length)}.`);
      refreshContextMenuSidePanel();
    } catch (err) {
      console.error("[SimpleRightClickTagging] clear metadata failed", err);
      showQuickAccessToast(err.message || "Could not clear metadata.", true);
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  async function applyMissingMetadataFlag(itemType, itemIds, flagKey, recordPrevious = true) {
    const flag = getMissingMetadataFlags(itemType).find((item) => item.key === flagKey);
    if (!flag) return showQuickAccessToast("Missing metadata flag is not configured.", true);
    const tag = (await getTagRecordsByIds([flag.tagId]))[0] || {
      id: flag.tagId,
      name: flag.label,
      sort_name: flag.label,
      image_path: "",
    };
    await applyResolvedQuickItem(itemType, itemIds, "tag", tag);
    if (recordPrevious) {
      savePreviousAction({
        type: "flag",
        flagKey,
        tagId: flag.tagId,
        label: flag.label,
        timestamp: Date.now(),
      });
      refreshContextMenuSidePanel();
    }
  }

  async function repeatPreviousAction(itemType, itemIds) {
    const action = loadPreviousAction();
    if (!action) return showQuickAccessToast("No previous action yet.", true);
    if (action.type === "quick") {
      await applyResolvedQuickItem(itemType, itemIds, action.kind, action.record, {
        remove: !!action.remove,
      });
    } else if (action.type === "preset") {
      await applyQuickAccessPreset(itemType, itemIds, action.preset);
    } else if (action.type === "paste") {
      await pasteMetadataFromClipboard(itemType, itemIds, action.pasteKind, false);
    } else if (action.type === "clear") {
      await clearMetadataSection(itemType, itemIds, action.clearKind, false);
    } else if (action.type === "flag") {
      await applyMissingMetadataFlag(itemType, itemIds, action.flagKey, false);
    } else if (action.type === "metadata") {
      await updateMetadataForItems(itemType, itemIds, action.patch || {}, "Repeated metadata action.");
    }
  }

  async function refreshSelectedStudioForWorkingSet(panel) {
    const imageIds = getWorkingImageIds();
    const itemType = state.currentItemType;
    const studios = await Promise.all(
      imageIds.map((imageId) => getCachedItemStudio(itemType, imageId))
    );
    const common = getCommonStudio(studios);
    state.selectedStudio = common.studio;
    state.selectedStudioMixed = common.mixed;
    renderSelectedStudio(panel);
    renderStudioResults(panel, getCurrentStudioResults(panel));
  }

  async function selectStudioEditorImage(imageId, panel) {
    if (state.currentMode !== "studio" || !toggleWorkingImage(imageId)) return;
    try {
      await refreshSelectedStudioForWorkingSet(panel);
    } catch (err) {
      console.error("[SimpleRightClickTagging] selected item studio load failed", err);
      setStudioStatus(panel, "Could not load studio for selection.", true);
    }
  }

  async function assignStudioToWorkingSet(studio, panel) {
    const imageIds = getWorkingImageIds();
    if (!imageIds.length || state.isSaving) return;

    const itemType = state.currentItemType;
    const nextStudio = normalizeStudio(studio);
    const previousStudio = state.selectedStudio;
    const previousMixed = state.selectedStudioMixed;
    state.selectedStudio = nextStudio;
    state.selectedStudioMixed = false;
    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    renderSelectedStudio(panel);
    renderStudioResults(panel, getCurrentStudioResults(panel));
    setStudioStatus(panel, nextStudio ? `Applying ${nextStudio.name}...` : "Clearing studio...");

    try {
      await Promise.all(
        imageIds.map((imageId) => updateItemStudioId(itemType, imageId, nextStudio?.id || null))
      );
      imageIds.forEach((imageId) => {
        state.imageStudiosByImageId.set(getItemCacheKey(itemType, imageId), nextStudio);
      });
      setStudioStatus(
        panel,
        nextStudio
          ? `Applied ${nextStudio.name} to ${imageIds.length} ${getItemLabel(itemType, imageIds.length)}.`
          : `Cleared studio from ${imageIds.length} ${getItemLabel(itemType, imageIds.length)}.`
      );
    } catch (err) {
      console.error("[SimpleRightClickTagging] studio save failed", err);
      state.selectedStudio = previousStudio;
      state.selectedStudioMixed = previousMixed;
      renderSelectedStudio(panel);
      renderStudioResults(panel, getCurrentStudioResults(panel));
      setStudioStatus(panel, "Could not update studio.", true);
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  function attachStudioPanelEvents(panel) {
    const input = panel.querySelector(".simple-right-click-tagging__studio-search");
    input?.addEventListener("input", () => {
      if (state.studioSearchTimer) window.clearTimeout(state.studioSearchTimer);
      const query = input.value.trim();
      state.studioSearchTimer = window.setTimeout(async () => {
        const results = panel.querySelector(".simple-right-click-tagging__studio-results");
        if (!query) {
          if (results) results.innerHTML = '<div class="simple-right-click-tagging__empty">Search for a studio.</div>';
          return;
        }
        if (results) results.innerHTML = '<div class="simple-right-click-tagging__loading">Searching...</div>';
        try {
          renderStudioResults(panel, await searchStudios(query));
        } catch (err) {
          console.error("[SimpleRightClickTagging] studio search failed", err);
          if (results) results.innerHTML = '<div class="simple-right-click-tagging__error">Search failed.</div>';
        }
      }, 180);
    });

    panel.addEventListener("click", (event) => {
      const clear = event.target.closest("[data-srct-clear-studio]");
      if (clear) {
        event.preventDefault();
        assignStudioToWorkingSet(null, panel);
        return;
      }

      const row = event.target.closest("[data-srct-assign-studio]");
      if (row) {
        event.preventDefault();
        assignStudioToWorkingSet(row.__srctStudio, panel);
      }
    });
  }

  async function handleVisageAction(panel, button) {
    const bridge = getVisageBridge();
    if (!bridge) {
      setVisageStatus(panel, "Visage is not available.", true);
      return;
    }

    const action = button.getAttribute("data-srct-visage-action");
    try {
      if (action === "open") {
        bridge.openStashFace?.();
        return;
      }

      if (action === "crop") {
        startVisageCropMode(panel);
        return;
      }

      if (action === "copy") {
        await bridge.copyCropToClipboard?.();
        setVisageStatus(panel, "Crop copied.");
        return;
      }

      if (action === "download") {
        bridge.downloadCrop?.();
        setVisageStatus(panel, "Crop downloaded.");
        return;
      }

      if (action === "find") {
        button.disabled = true;
        button.textContent = "Finding...";
        setVisageStatus(panel, "Finding performer matches...");
        const candidates = await bridge.findMatches();
        renderVisageCandidates(panel, candidates || []);
        setVisageStatus(panel, candidates?.length ? "Click a match to assign it." : "No matches found.");
      }
    } catch (err) {
      setVisageStatus(panel, err.message || "Visage action failed.", true);
    } finally {
      if (action === "find") {
        button.disabled = false;
        button.textContent = "Find matches";
      }
    }
  }

  async function openPerformerEditor(itemType, imageIds) {
    const normalizedImageIds = normalizeImageIds(imageIds);
    const imageId = normalizedImageIds[0];
    if (!imageId) return;
    const itemTitleLabel = getItemTitleLabel(itemType);
    const itemLabel = getItemLabel(itemType, normalizedImageIds.length);

    const modal = createModalShell(
      "Edit performers",
      normalizedImageIds.length > 1
        ? `${normalizedImageIds.length} of ${normalizedImageIds.length} ${itemLabel} selected`
        : `${itemTitleLabel} ${imageId}`
    );
    modal.classList.add("simple-right-click-tagging__modal--with-preview");
    state.currentItemType = itemType;
    state.currentImageId = imageId;
    state.currentImageIds = normalizedImageIds;
    state.workingImageIds = new Set(normalizedImageIds);
    state.currentMode = "performers";
    const body = modal.querySelector(".simple-right-click-tagging__dialog-body");
    body.innerHTML = '<div class="simple-right-click-tagging__loading">Loading performers...</div>';

    try {
      const [selectedPerformers, imagePreviews] = await Promise.all([
        Promise.all(
          normalizedImageIds.map((id) => getCachedItemPerformers(itemType, id))
        ).then(intersectPerformers),
        loadImageQueuePreviews(normalizedImageIds),
      ]);
      state.selectedPerformers = selectedPerformers;
      if (
        state.currentItemType !== itemType ||
        state.currentImageId !== imageId ||
        state.currentMode !== "performers"
      ) {
        return;
      }

      const panel = document.createElement("section");
      panel.className = "simple-right-click-tagging__performer-panel";
      panel.innerHTML = `
        <div class="simple-right-click-tagging__selected-performers"></div>
        <input type="search" class="simple-right-click-tagging__performer-search" placeholder="Search performers" autocomplete="off" spellcheck="false">
        <div class="simple-right-click-tagging__performer-results"></div>
      `;

      const layout = document.createElement("div");
      layout.className = "simple-right-click-tagging__editor-layout";
      const preview = createImageQueue(imagePreviews);
      layout.appendChild(panel);
      layout.appendChild(preview);

      body.innerHTML = "";
      body.appendChild(layout);
      renderSelectedPerformers(panel);
      renderVisagePanel(panel);
      attachPerformerPanelEvents(panel);
      attachImageQueueEvents(preview, (nextImageId) => selectPerformerEditorImage(nextImageId, panel));
      attachScenePreviewVideoEvents(preview);
      panel.querySelector(".simple-right-click-tagging__performer-search")?.focus();
    } catch (err) {
      console.error("[SimpleRightClickTagging] performer editor failed", err);
      body.innerHTML = '<div class="simple-right-click-tagging__error">Could not load performer editor.</div>';
    }
  }

  async function openStudioEditor(itemType, imageIds) {
    if (itemType === "performer") return;
    const normalizedImageIds = normalizeImageIds(imageIds);
    const imageId = normalizedImageIds[0];
    if (!imageId) return;
    const itemTitleLabel = getItemTitleLabel(itemType);
    const itemLabel = getItemLabel(itemType, normalizedImageIds.length);

    const modal = createModalShell(
      "Edit studio",
      normalizedImageIds.length > 1
        ? `${normalizedImageIds.length} of ${normalizedImageIds.length} ${itemLabel} selected`
        : `${itemTitleLabel} ${imageId}`
    );
    modal.classList.add("simple-right-click-tagging__modal--with-preview");
    state.currentItemType = itemType;
    state.currentImageId = imageId;
    state.currentImageIds = normalizedImageIds;
    state.workingImageIds = new Set(normalizedImageIds);
    state.currentMode = "studio";
    const body = modal.querySelector(".simple-right-click-tagging__dialog-body");
    body.innerHTML = '<div class="simple-right-click-tagging__loading">Loading studio...</div>';

    try {
      const [commonStudio, imagePreviews] = await Promise.all([
        Promise.all(
          normalizedImageIds.map((id) => getCachedItemStudio(itemType, id))
        ).then(getCommonStudio),
        loadImageQueuePreviews(normalizedImageIds),
      ]);
      state.selectedStudio = commonStudio.studio;
      state.selectedStudioMixed = commonStudio.mixed;
      if (
        state.currentItemType !== itemType ||
        state.currentImageId !== imageId ||
        state.currentMode !== "studio"
      ) {
        return;
      }

      const panel = document.createElement("section");
      panel.className = "simple-right-click-tagging__studio-panel";
      panel.innerHTML = `
        <div class="simple-right-click-tagging__selected-studio"></div>
        <input type="search" class="simple-right-click-tagging__studio-search" placeholder="Search studios" autocomplete="off" spellcheck="false">
        <div class="simple-right-click-tagging__studio-results">
          <div class="simple-right-click-tagging__empty">Search for a studio.</div>
        </div>
        <div class="simple-right-click-tagging__studio-status"></div>
      `;

      const layout = document.createElement("div");
      layout.className = "simple-right-click-tagging__editor-layout";
      const preview = createImageQueue(imagePreviews);
      layout.appendChild(panel);
      layout.appendChild(preview);

      body.innerHTML = "";
      body.appendChild(layout);
      renderSelectedStudio(panel);
      attachStudioPanelEvents(panel);
      attachImageQueueEvents(preview, (nextImageId) => selectStudioEditorImage(nextImageId, panel));
      attachScenePreviewVideoEvents(preview);
      panel.querySelector(".simple-right-click-tagging__studio-search")?.focus();
    } catch (err) {
      console.error("[SimpleRightClickTagging] studio editor failed", err);
      body.innerHTML = '<div class="simple-right-click-tagging__error">Could not load studio editor.</div>';
    }
  }

  function normalizeCustomFieldRows(panel) {
    return Array.from(panel.querySelectorAll("[data-srct-custom-field-row]"))
      .map((row) => {
        const key = row.querySelector("[data-srct-custom-field-key]")?.value.trim() || "";
        const value = row.querySelector("[data-srct-custom-field-value]")?.value || "";
        return { row, key, value };
      })
      .filter((item) => item.key);
  }

  function renderCustomFieldRows(panel, fields, options = {}) {
    const list = panel.querySelector(".simple-right-click-tagging__custom-field-list");
    if (!list) return;
    const existingFields = fields || {};
    const existingKeys = new Set(Object.keys(existingFields).map((key) => key.toLowerCase()));
    const presetEntries = options.includePresets
      ? getCustomFieldPresetNames()
          .filter((key) => !existingKeys.has(key.toLowerCase()))
          .map((key) => [key, "", true])
      : [];
    const entries = Object.entries(existingFields)
      .map(([key, value]) => [key, value, false])
      .concat(presetEntries)
      .sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    if (!entries.length) {
      list.innerHTML = '<div class="simple-right-click-tagging__empty">No custom fields yet.</div>';
      return;
    }

    list.innerHTML = entries
      .map(
        ([key, value, isPreset]) => `
          <div class="simple-right-click-tagging__custom-field-row" data-srct-custom-field-row data-srct-existing-field="${isPreset ? "0" : "1"}" data-srct-preset-field="${isPreset ? "1" : "0"}">
            <input type="text" value="${escapeHtml(key)}" data-srct-custom-field-key aria-label="Custom field name">
            <input type="text" value="${escapeHtml(value)}" data-srct-custom-field-value aria-label="Custom field value" placeholder="${isPreset ? "Preset value" : "Value"}">
            <button type="button" data-srct-remove-custom-field aria-label="Clear custom field">x</button>
          </div>
        `
      )
      .join("");
  }

  function setCustomFieldStatus(panel, message, isError = false) {
    const status = panel.querySelector(".simple-right-click-tagging__custom-field-status");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  function getCustomFieldsPatchFromPanel(panel) {
    const patch = {};
    const seen = new Set();
    for (const { row, key, value } of normalizeCustomFieldRows(panel)) {
      const normalizedKey = key.trim();
      if (!normalizedKey || seen.has(normalizedKey)) continue;
      if (row.getAttribute("data-srct-preset-field") === "1" && !String(value || "").trim()) continue;
      patch[normalizedKey] = value;
      seen.add(normalizedKey);
    }
    return patch;
  }

  async function saveSinglePerformerCustomFields(panel) {
    const performerId = state.currentImageIds[0];
    if (!performerId || state.isSaving) return;
    const patch = getCustomFieldsPatchFromPanel(panel);
    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    setCustomFieldStatus(panel, "Saving...");

    try {
      await updatePerformerCustomFields(performerId, patch);
      const existing = await getCachedPerformerCustomFields(performerId);
      state.performerCustomFieldsById.set(performerId, { ...existing, ...patch });
      setCustomFieldStatus(panel, "Saved custom fields.");
    } catch (err) {
      console.error("[SimpleRightClickTagging] custom field save failed", err);
      setCustomFieldStatus(panel, err.message || "Could not save custom fields.", true);
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  async function applyBulkPerformerCustomField(panel) {
    const performerIds = state.currentImageIds.slice();
    if (!performerIds.length || state.isSaving) return;
    const key = panel.querySelector("[data-srct-bulk-custom-field-key]")?.value.trim() || "";
    const value = panel.querySelector("[data-srct-bulk-custom-field-value]")?.value || "";
    if (!key) {
      setCustomFieldStatus(panel, "Field name is required.", true);
      return;
    }

    state.isSaving = true;
    document.body.classList.add("simple-right-click-tagging--saving");
    setCustomFieldStatus(panel, "Applying...");

    try {
      const patch = { [key]: value };
      await Promise.all(
        performerIds.map(async (performerId) => {
          await updatePerformerCustomFields(performerId, patch);
          const existing = await getCachedPerformerCustomFields(performerId);
          state.performerCustomFieldsById.set(performerId, { ...existing, ...patch });
        })
      );
      setCustomFieldStatus(panel, `Applied ${key} to ${performerIds.length} performers.`);
    } catch (err) {
      console.error("[SimpleRightClickTagging] bulk custom field save failed", err);
      setCustomFieldStatus(panel, err.message || "Could not apply custom field.", true);
    } finally {
      state.isSaving = false;
      document.body.classList.remove("simple-right-click-tagging--saving");
    }
  }

  function attachCustomFieldPanelEvents(panel) {
    panel.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-srct-remove-custom-field]");
      if (remove) {
        event.preventDefault();
        remove.closest("[data-srct-custom-field-row]")?.remove();
        return;
      }

      const add = event.target.closest("[data-srct-add-custom-field]");
      if (add) {
        event.preventDefault();
        const list = panel.querySelector(".simple-right-click-tagging__custom-field-list");
        if (!list) return;
        const empty = list.querySelector(".simple-right-click-tagging__empty");
        if (empty) empty.remove();
        const row = document.createElement("div");
        row.className = "simple-right-click-tagging__custom-field-row";
        row.setAttribute("data-srct-custom-field-row", "1");
        row.innerHTML = `
          <input type="text" data-srct-custom-field-key aria-label="Custom field name" placeholder="Field">
          <input type="text" data-srct-custom-field-value aria-label="Custom field value" placeholder="Value">
          <button type="button" data-srct-remove-custom-field aria-label="Clear custom field">x</button>
        `;
        list.appendChild(row);
        row.querySelector("[data-srct-custom-field-key]")?.focus();
        return;
      }

      const save = event.target.closest("[data-srct-save-custom-fields]");
      if (save) {
        event.preventDefault();
        saveSinglePerformerCustomFields(panel);
        return;
      }

      const bulkApply = event.target.closest("[data-srct-apply-bulk-custom-field]");
      if (bulkApply) {
        event.preventDefault();
        applyBulkPerformerCustomField(panel);
        return;
      }

      const preset = event.target.closest("[data-srct-field-preset]");
      if (preset) {
        event.preventDefault();
        const keyInput = panel.querySelector("[data-srct-bulk-custom-field-key]");
        if (!keyInput) return;
        keyInput.value = preset.getAttribute("data-srct-field-preset") || "";
        panel.querySelector("[data-srct-bulk-custom-field-value]")?.focus();
      }
    });
  }

  async function hydrateInlineCustomFieldsPanel(menu, performerIds, x, y) {
    const normalizedPerformerIds = normalizeImageIds(performerIds);
    const performerId = normalizedPerformerIds[0];
    const panel = menu.querySelector("[data-srct-inline-custom-fields]");
    if (!panel || !performerId) return;

    state.currentItemType = "performer";
    state.currentImageId = performerId;
    state.currentImageIds = normalizedPerformerIds;
    state.workingImageIds = new Set(normalizedPerformerIds);
    state.currentMode = "custom-fields-inline";

    try {
      if (normalizedPerformerIds.length === 1) {
        const fields = await getCachedPerformerCustomFields(performerId);
        if (!document.body.contains(menu)) return;
        panel.innerHTML = `
          <div class="simple-right-click-tagging__menu-section-title">Custom fields</div>
          <div class="simple-right-click-tagging__custom-field-list simple-right-click-tagging__custom-field-list--inline"></div>
          <div class="simple-right-click-tagging__custom-field-actions simple-right-click-tagging__custom-field-actions--inline">
            <button type="button" data-srct-add-custom-field>Add</button>
            <button type="button" data-srct-save-custom-fields>Save</button>
          </div>
          <div class="simple-right-click-tagging__custom-field-status"></div>
        `;
        renderCustomFieldRows(panel, fields, { includePresets: true });
      } else {
        const presetNames = getCustomFieldPresetNames();
        if (!document.body.contains(menu)) return;
        panel.innerHTML = `
          <div class="simple-right-click-tagging__menu-section-title">Custom fields</div>
          <div class="simple-right-click-tagging__custom-field-note">Add or update one field across selected performers.</div>
          ${
            presetNames.length
              ? `<div class="simple-right-click-tagging__field-preset-grid">
                  ${presetNames
                    .map(
                      (name) => `<button type="button" data-srct-field-preset="${escapeHtml(name)}">${escapeHtml(name)}</button>`
                    )
                    .join("")}
                </div>`
              : ""
          }
          <div class="simple-right-click-tagging__custom-field-row simple-right-click-tagging__custom-field-row--bulk simple-right-click-tagging__custom-field-row--inline">
            <input type="text" data-srct-bulk-custom-field-key aria-label="Custom field name" placeholder="Field">
            <input type="text" data-srct-bulk-custom-field-value aria-label="Custom field value" placeholder="Value">
          </div>
          <div class="simple-right-click-tagging__custom-field-actions simple-right-click-tagging__custom-field-actions--inline">
            <button type="button" data-srct-apply-bulk-custom-field>Apply</button>
          </div>
          <div class="simple-right-click-tagging__custom-field-status"></div>
        `;
      }
      attachCustomFieldPanelEvents(panel);
      positionFloatingElement(menu, x, y);
    } catch (err) {
      console.error("[SimpleRightClickTagging] inline custom field load failed", err);
      if (!document.body.contains(menu)) return;
      panel.innerHTML = `
        <div class="simple-right-click-tagging__menu-section-title">Custom fields</div>
        <div class="simple-right-click-tagging__quick-search-empty">Could not load custom fields.</div>
      `;
      positionFloatingElement(menu, x, y);
    }
  }

  async function openCustomFieldsEditor(performerIds) {
    const normalizedPerformerIds = normalizeImageIds(performerIds);
    const performerId = normalizedPerformerIds[0];
    if (!performerId) return;
    const itemLabel = getItemLabel("performer", normalizedPerformerIds.length);
    const modal = createModalShell(
      "Edit custom fields",
      normalizedPerformerIds.length > 1
        ? `${normalizedPerformerIds.length} ${itemLabel} selected`
        : `Performer ${performerId}`
    );
    state.currentItemType = "performer";
    state.currentImageId = performerId;
    state.currentImageIds = normalizedPerformerIds;
    state.workingImageIds = new Set(normalizedPerformerIds);
    state.currentMode = "custom-fields";
    const body = modal.querySelector(".simple-right-click-tagging__dialog-body");
    body.innerHTML = '<div class="simple-right-click-tagging__loading">Loading custom fields...</div>';

    try {
      const fields = normalizedPerformerIds.length === 1
        ? await getCachedPerformerCustomFields(performerId)
        : {};
      if (
        state.currentItemType !== "performer" ||
        state.currentImageId !== performerId ||
        state.currentMode !== "custom-fields"
      ) {
        return;
      }

      const panel = document.createElement("section");
      panel.className = "simple-right-click-tagging__custom-field-panel";
      if (normalizedPerformerIds.length === 1) {
        panel.innerHTML = `
          <div class="simple-right-click-tagging__custom-field-list"></div>
          <div class="simple-right-click-tagging__custom-field-actions">
            <button type="button" data-srct-add-custom-field>Add field</button>
            <button type="button" data-srct-save-custom-fields>Save</button>
          </div>
          <div class="simple-right-click-tagging__custom-field-status"></div>
        `;
        renderCustomFieldRows(panel, fields, { includePresets: true });
      } else {
        panel.innerHTML = `
          <div class="simple-right-click-tagging__custom-field-note">Add or update one text custom field across the selected performers.</div>
          <div class="simple-right-click-tagging__custom-field-row simple-right-click-tagging__custom-field-row--bulk">
            <input type="text" data-srct-bulk-custom-field-key aria-label="Custom field name" placeholder="Field">
            <input type="text" data-srct-bulk-custom-field-value aria-label="Custom field value" placeholder="Value">
          </div>
          <div class="simple-right-click-tagging__custom-field-actions">
            <button type="button" data-srct-apply-bulk-custom-field>Apply to selected</button>
          </div>
          <div class="simple-right-click-tagging__custom-field-status"></div>
        `;
      }

      body.innerHTML = "";
      body.appendChild(panel);
      attachCustomFieldPanelEvents(panel);
      panel.querySelector("input")?.focus();
    } catch (err) {
      console.error("[SimpleRightClickTagging] custom field editor failed", err);
      body.innerHTML = '<div class="simple-right-click-tagging__error">Could not load custom fields.</div>';
    }
  }

  function handleContextMenu(event) {
    if (getAccessMode() !== ACCESS_MODE_RIGHT_CLICK) return;
    if (event.target.closest(`#${MENU_ID}, #${MODAL_ID}`)) return;
    const context = getContextCardFromEventTarget(event.target);
    if (!context) return;

    const imageIds = getItemIdsForContextCard(context.card, context.itemType);
    if (!imageIds.length) return;

    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event, context.itemType, imageIds);
  }

  function handleHoverZoneMove(event) {
    if (getAccessMode() !== ACCESS_MODE_HOVER_ZONE) return;
    if (event.target.closest(`#${MODAL_ID}`)) return;
    if (event.target.closest(`#${MENU_ID}`)) {
      cancelHoverMenuClose();
      return;
    }

    const context = getContextCardFromEventTarget(event.target);
    if (!context || !isInHoverMenuZone(event, context.card)) {
      scheduleHoverMenuClose();
      return;
    }

    cancelHoverMenuClose();
    const existingMenu = document.getElementById(MENU_ID);
    if (existingMenu && state.hoverMenuCard === context.card) return;

    const itemIds = getItemIdsForContextCard(context.card, context.itemType);
    if (!itemIds.length) return;

    const position = getHoverMenuPosition(context.card);
    openContextMenuAt(position.x, position.y, context.itemType, itemIds);
    state.hoverMenuCard = context.card;
  }

  function handleDocumentClick(event) {
    if (event.target.closest(`#${MENU_ID}`)) return;
    closeContextMenu();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closeContextMenu();
      closeModal();
    }
  }

  function handleVisageReady() {
    if (state.currentItemType !== "image" || state.currentMode !== "performers") return;
    const panel = document.querySelector(`#${MODAL_ID} .simple-right-click-tagging__performer-panel`);
    if (panel) renderVisagePanel(panel);
  }

  function scheduleRouteRefresh() {
    const token = ++state.routeToken;
    ROUTE_REFRESH_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        if (token !== state.routeToken) return;
        closeContextMenu();
        closeModal();
      }, delay);
    });
  }

  function installNavigationHooks() {
    if (window.__simpleRightClickTaggingHistoryWrapped) return;
    window.__simpleRightClickTaggingHistoryWrapped = true;
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      const result = originalPushState.apply(this, arguments);
      window.dispatchEvent(new Event("srct:navigation"));
      return result;
    };

    history.replaceState = function () {
      const result = originalReplaceState.apply(this, arguments);
      window.dispatchEvent(new Event("srct:navigation"));
      return result;
    };

    window.addEventListener("popstate", () =>
      window.dispatchEvent(new Event("srct:navigation"))
    );
    window.addEventListener("srct:navigation", scheduleRouteRefresh);
  }

  function init() {
    if (window.__simpleRightClickTaggingInitialized) return;
    window.__simpleRightClickTaggingInitialized = true;
    installNavigationHooks();
    loadConfig();
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("mousemove", handleHoverZoneMove, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("visage:quick-tagging-ready", handleVisageReady);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
