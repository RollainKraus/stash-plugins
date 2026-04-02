(function () {
  "use strict";

  const PLUGIN_ID = "SimpleImageCrop";
  const CROP_STORAGE_KEY = "simple-image-crop-v1";
  const SNAP_STORAGE_KEY = "simple-image-crop-snap-v1";
  const ASPECT_MODES = ["tall", "portrait", "square", "landscape", "widescreen"];
  const ROUTE_RETRY_DELAYS = [0, 180, 500, 1000, 1800];
  const DEFAULT_CONFIG = {
    showCropIcon: true,
    cropIconOpacity: 0.5,
  };

  const state = {
    cropStore: loadCropStore(),
    snapEnabled: loadSnapPreference(),
    config: { ...DEFAULT_CONFIG },
    configPromise: null,
    imageCache: new Map(),
    cropEditor: null,
    refreshHandle: 0,
    routeToken: 0,
    observers: [],
    isApplying: false,
  };

  function loadCropStore() {
    try {
      const raw = window.localStorage.getItem(CROP_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      console.error("[SimpleImageCrop] Failed to load crops", err);
      return {};
    }
  }

  function saveCropStore() {
    try {
      window.localStorage.setItem(CROP_STORAGE_KEY, JSON.stringify(state.cropStore));
    } catch (err) {
      console.error("[SimpleImageCrop] Failed to save crops", err);
    }
  }

  function loadSnapPreference() {
    try {
      const raw = window.localStorage.getItem(SNAP_STORAGE_KEY);
      if (raw == null) return true;
      return raw !== "false";
    } catch (err) {
      return true;
    }
  }

  function saveSnapPreference(enabled) {
    state.snapEnabled = !!enabled;
    try {
      window.localStorage.setItem(SNAP_STORAGE_KEY, String(state.snapEnabled));
    } catch (err) {
      void err;
    }
  }

  function normalizeCropRect(rect) {
    if (!rect || typeof rect !== "object") return null;

    const x = Math.max(0, Math.min(1, Number(rect.x) || 0));
    const y = Math.max(0, Math.min(1, Number(rect.y) || 0));
    const width = Math.max(0, Math.min(1, Number(rect.width) || 0));
    const height = Math.max(0, Math.min(1, Number(rect.height) || 0));
    const right = Math.max(x, Math.min(1, x + width));
    const bottom = Math.max(y, Math.min(1, y + height));
    const normalizedWidth = right - x;
    const normalizedHeight = bottom - y;

    if (normalizedWidth < 0.02 || normalizedHeight < 0.02) {
      return null;
    }

    return {
      x,
      y,
      width: normalizedWidth,
      height: normalizedHeight,
    };
  }

  function getSavedCrop(imageId) {
    const crop = state.cropStore[String(imageId)];
    return normalizeCropRect(crop);
  }

  function setSavedCrop(imageId, crop) {
    const key = String(imageId);
    const normalized = normalizeCropRect(crop);
    if (normalized) {
      state.cropStore[key] = normalized;
    } else {
      delete state.cropStore[key];
    }
    saveCropStore();
  }

  function getCurrentImageId(pathname = window.location.pathname) {
    const match = pathname.match(/^\/images\/(\d+)/);
    return match ? match[1] : null;
  }

  async function gql(query, variables = {}) {
    const response = await window.fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors.map((item) => item.message).join("; "));
    }

    return json.data;
  }

  function clampOpacity(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_CONFIG.cropIconOpacity;
    return Math.max(0, Math.min(1, numeric));
  }

  function normalizeConfig(rawConfig) {
    const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    return {
      showCropIcon:
        typeof source.showCropIcon === "boolean"
          ? source.showCropIcon
          : DEFAULT_CONFIG.showCropIcon,
      cropIconOpacity: clampOpacity(source.cropIconOpacity),
    };
  }

  async function loadConfig() {
    if (state.configPromise) return state.configPromise;

    state.configPromise = gql(`
      query SimpleImageCropConfig {
        configuration {
          plugins
        }
      }
    `)
      .then((data) => {
        state.config = normalizeConfig(data?.configuration?.plugins?.[PLUGIN_ID] || {});
        return state.config;
      })
      .catch((err) => {
        console.error("[SimpleImageCrop] Config load failed", err);
        state.config = normalizeConfig({});
        return state.config;
      })
      .finally(() => {
        state.configPromise = null;
      });

    return state.configPromise;
  }

  function getCurrentPageImageCandidate(imageId) {
    if (!imageId) return null;
    const prioritizedSelectors = [
      ".image-tabs img.group",
      ".image-tabs .detail-group img",
      ".image-tabs img",
    ];

    for (const selector of prioritizedSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const candidate = candidates.find(
        (img) =>
          img instanceof HTMLImageElement &&
          !img.closest(".simple-image-crop__page-surface")
      );
      if (candidate instanceof HTMLImageElement) {
        const src = String(candidate.currentSrc || candidate.src || "");
        if (
          src.includes(`/image/${imageId}/`) ||
          src.includes(`/image/${imageId}`) ||
          src.includes(`/images/${imageId}`)
        ) {
          return candidate;
        }
      }
    }

    const patterns = [`/image/${imageId}/`, `/image/${imageId}`, `/images/${imageId}`];
    const images = Array.from(document.querySelectorAll("img"))
      .filter((img) => {
        if (!(img instanceof HTMLImageElement)) return false;
        if (img.closest(".simple-image-crop__dialog")) return false;
        if (img.closest(".simple-image-crop__page-surface")) return false;
        if (img.closest(".image-card")) return false;
        const src = String(img.currentSrc || img.src || "");
        return patterns.some((pattern) => src.includes(pattern));
      })
      .sort((left, right) => {
        const leftArea =
          (left.clientWidth || left.naturalWidth || 0) *
          (left.clientHeight || left.naturalHeight || 0);
        const rightArea =
          (right.clientWidth || right.naturalWidth || 0) *
          (right.clientHeight || right.naturalHeight || 0);
        return rightArea - leftArea;
      });

    return images[0] || null;
  }

  async function fetchImageData(imageId) {
    const key = String(imageId);
    if (state.imageCache.has(key)) {
      return state.imageCache.get(key);
    }

    const fallbackElement = getCurrentPageImageCandidate(imageId);
    const fallback = {
      id: key,
      title: "",
      src: fallbackElement?.currentSrc || fallbackElement?.src || `/image/${key}/image`,
      thumbnail:
        fallbackElement?.currentSrc || fallbackElement?.src || `/image/${key}/thumbnail`,
      dimensions:
        fallbackElement && fallbackElement.naturalWidth > 0 && fallbackElement.naturalHeight > 0
          ? { width: fallbackElement.naturalWidth, height: fallbackElement.naturalHeight }
          : null,
    };

    try {
      const data = await gql(
        `
          query SimpleImageCropFindImage($id: ID!) {
            findImage(id: $id) {
              id
              title
              files {
                width
                height
              }
              paths {
                image
                thumbnail
              }
            }
          }
        `,
        { id: key }
      );

      const image = data?.findImage;
      const dimensions = image?.files?.[0]
        ? {
            width: Number(image.files[0].width) || 0,
            height: Number(image.files[0].height) || 0,
          }
        : fallback.dimensions;

      const resolved = {
        id: key,
        title: image?.title || "",
        src: image?.paths?.image || fallback.src,
        thumbnail: image?.paths?.thumbnail || fallback.thumbnail,
        dimensions:
          dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions : null,
      };

      state.imageCache.set(key, resolved);
      return resolved;
    } catch (err) {
      console.error("[SimpleImageCrop] Failed to fetch image metadata", err);
      state.imageCache.set(key, fallback);
      return fallback;
    }
  }

  function normalizeAspectMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return ASPECT_MODES.includes(normalized) ? normalized : "square";
  }

  function getAspectRatioForMode(mode) {
    switch (normalizeAspectMode(mode)) {
      case "tall":
        return 9 / 16;
      case "portrait":
        return 2 / 3;
      case "widescreen":
        return 16 / 9;
      case "landscape":
        return 4 / 3;
      default:
        return 1;
    }
  }

  function inferAspectModeFromRatio(ratio) {
    const numericRatio = Number(ratio);
    if (!(numericRatio > 0)) return "square";

    let bestMode = "square";
    let bestDistance = Number.POSITIVE_INFINITY;

    ASPECT_MODES.forEach((mode) => {
      const modeRatio = getAspectRatioForMode(mode);
      const distance = Math.abs(Math.log(numericRatio / modeRatio));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMode = mode;
      }
    });

    return bestMode;
  }

  function getAspectDisplayName(mode) {
    switch (normalizeAspectMode(mode)) {
      case "tall":
        return "9:16";
      case "portrait":
        return "2:3";
      case "widescreen":
        return "16:9";
      case "landscape":
        return "4:3";
      default:
        return "1:1";
    }
  }

  function getCropAspectRatio(dimensions, crop) {
    if (!dimensions) return 1;
    if (!crop) return (dimensions.width || 1) / (dimensions.height || 1);
    const width = dimensions.width * crop.width;
    const height = dimensions.height * crop.height;
    return height > 0 ? width / height : 1;
  }

  function getContainedViewportSize(contentAspectRatio, frameWidth, frameHeight) {
    const contentAspect = Number(contentAspectRatio);
    const containerWidth = Number(frameWidth);
    const containerHeight = Number(frameHeight);
    if (!(contentAspect > 0) || !(containerWidth > 0) || !(containerHeight > 0)) {
      return null;
    }

    const frameAspect = containerWidth / containerHeight;
    if (!(frameAspect > 0)) return null;

    if (contentAspect >= frameAspect) {
      return {
        width: containerWidth,
        height: containerWidth / contentAspect,
      };
    }

    return {
      width: containerHeight * contentAspect,
      height: containerHeight,
    };
  }

  function getContainedRect(containerRect, width, height) {
    if (!containerRect || !(width > 0) || !(height > 0)) return null;

    const containerWidth = Math.max(0, containerRect.width);
    const containerHeight = Math.max(0, containerRect.height);
    if (!(containerWidth > 0) || !(containerHeight > 0)) return null;

    const imageRatio = width / height;
    const containerRatio = containerWidth / containerHeight;

    let renderWidth = containerWidth;
    let renderHeight = containerHeight;
    let offsetLeft = 0;
    let offsetTop = 0;

    if (imageRatio > containerRatio) {
      renderHeight = containerWidth / imageRatio;
      offsetTop = (containerHeight - renderHeight) / 2;
    } else {
      renderWidth = containerHeight * imageRatio;
      offsetLeft = (containerWidth - renderWidth) / 2;
    }

    return {
      left: containerRect.left + offsetLeft,
      top: containerRect.top + offsetTop,
      width: renderWidth,
      height: renderHeight,
      right: containerRect.left + offsetLeft + renderWidth,
      bottom: containerRect.top + offsetTop + renderHeight,
    };
  }

  function clampPointToRect(clientX, clientY, rect) {
    if (!rect) return null;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }

    return {
      x: Math.max(rect.left, Math.min(rect.right, clientX)),
      y: Math.max(rect.top, Math.min(rect.bottom, clientY)),
    };
  }

  function selectionFromPoints(start, end) {
    if (!start || !end) return null;
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  function selectionToCrop(selectionRect, imageRect) {
    if (!selectionRect || !imageRect) return null;
    return normalizeCropRect({
      x: (selectionRect.left - imageRect.left) / imageRect.width,
      y: (selectionRect.top - imageRect.top) / imageRect.height,
      width: selectionRect.width / imageRect.width,
      height: selectionRect.height / imageRect.height,
    });
  }

  function cropToSelection(crop, imageRect) {
    const normalized = normalizeCropRect(crop);
    if (!normalized || !imageRect) return null;
    return {
      left: imageRect.left + normalized.x * imageRect.width,
      top: imageRect.top + normalized.y * imageRect.height,
      width: normalized.width * imageRect.width,
      height: normalized.height * imageRect.height,
    };
  }

  function clampSelectionToRect(selectionRect, deltaX, deltaY, imageRect) {
    if (!selectionRect || !imageRect) return null;
    const width = Number(selectionRect.width) || 0;
    const height = Number(selectionRect.height) || 0;
    if (!(width > 0) || !(height > 0)) return null;

    const maxLeft = imageRect.right - width;
    const maxTop = imageRect.bottom - height;

    return {
      left: Math.max(imageRect.left, Math.min(maxLeft, selectionRect.left + deltaX)),
      top: Math.max(imageRect.top, Math.min(maxTop, selectionRect.top + deltaY)),
      width,
      height,
    };
  }

  function snapCropToAspectMode(crop, dimensions, mode) {
    const normalized = normalizeCropRect(crop);
    if (!normalized || !dimensions) return normalized;

    const imageWidth = Number(dimensions.width) || 0;
    const imageHeight = Number(dimensions.height) || 0;
    if (!(imageWidth > 0) || !(imageHeight > 0)) return normalized;

    const targetRatio = getAspectRatioForMode(mode);
    if (!(targetRatio > 0)) return normalized;

    const cropWidth = normalized.width * imageWidth;
    const cropHeight = normalized.height * imageHeight;
    if (!(cropWidth > 0) || !(cropHeight > 0)) return normalized;

    const centerX = (normalized.x + normalized.width / 2) * imageWidth;
    const centerY = (normalized.y + normalized.height / 2) * imageHeight;
    const area = cropWidth * cropHeight;

    let snappedWidth = Math.sqrt(area * targetRatio);
    let snappedHeight = snappedWidth / targetRatio;

    const maxWidth = Math.min(centerX * 2, (imageWidth - centerX) * 2);
    const maxHeight = Math.min(centerY * 2, (imageHeight - centerY) * 2);

    if (snappedWidth > maxWidth) {
      snappedWidth = maxWidth;
      snappedHeight = snappedWidth / targetRatio;
    }

    if (snappedHeight > maxHeight) {
      snappedHeight = maxHeight;
      snappedWidth = snappedHeight * targetRatio;
    }

    if (!(snappedWidth > 0) || !(snappedHeight > 0)) return normalized;

    let left = centerX - snappedWidth / 2;
    let top = centerY - snappedHeight / 2;

    left = Math.max(0, Math.min(imageWidth - snappedWidth, left));
    top = Math.max(0, Math.min(imageHeight - snappedHeight, top));

    return normalizeCropRect({
      x: left / imageWidth,
      y: top / imageHeight,
      width: snappedWidth / imageWidth,
      height: snappedHeight / imageHeight,
    });
  }

  function closeCropEditor() {
    if (!state.cropEditor) return;
    try {
      state.cropEditor.cleanup();
    } catch (err) {
      void err;
    }
    state.cropEditor = null;
  }

  function buildImmediateImageData(imageId) {
    const pageImage = getCurrentPageImageCandidate(imageId);
    return {
      id: String(imageId),
      title: pageImage?.alt || "",
      src: pageImage?.currentSrc || pageImage?.src || `/image/${imageId}/image`,
      thumbnail:
        pageImage?.currentSrc || pageImage?.src || `/image/${imageId}/thumbnail`,
      dimensions:
        pageImage && pageImage.naturalWidth > 0 && pageImage.naturalHeight > 0
          ? { width: pageImage.naturalWidth, height: pageImage.naturalHeight }
          : null,
    };
  }

  function openCropEditorForCurrentImage() {
    const imageId = getCurrentImageId();
    if (!imageId) return;

    const immediate = buildImmediateImageData(imageId);
    openCropEditor(immediate);

    fetchImageData(imageId)
      .then((image) => {
        if (!state.cropEditor || !image?.id || String(image.id) !== String(imageId)) return;
        const stageImage = document.querySelector(".simple-image-crop__stage-image");
        const subtitle = document.querySelector(".simple-image-crop__subtitle");
        if (stageImage instanceof HTMLImageElement && image.src && stageImage.src !== image.src) {
          stageImage.src = image.src;
        }
        if (subtitle && image.title) {
          subtitle.textContent = image.title;
        }
      })
      .catch((err) => {
        console.error("[SimpleImageCrop] Deferred image metadata load failed", err);
      });
  }

  function openCropEditor(image) {
    if (!image?.id) return;

    closeCropEditor();

    let dimensions = image.dimensions || null;
    let savedCrop = getSavedCrop(image.id);
    let snapEnabled = state.snapEnabled;

    const backdrop = document.createElement("div");
    backdrop.className = "simple-image-crop__backdrop";

    const dialog = document.createElement("div");
    dialog.className = "simple-image-crop__dialog";

    const header = document.createElement("div");
    header.className = "simple-image-crop__header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "simple-image-crop__title-wrap";

    const title = document.createElement("h3");
    title.className = "simple-image-crop__title";
    title.textContent = "Crop Image";

    const subtitle = document.createElement("div");
    subtitle.className = "simple-image-crop__subtitle";
    subtitle.textContent = image.title || `Image ${image.id}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const hint = document.createElement("div");
    hint.className = "simple-image-crop__hint";
    hint.textContent =
      "Drag to draw. Use the center handle to reposition. Apply saves display-only crop data.";

    header.appendChild(titleWrap);
    header.appendChild(hint);

    const controls = document.createElement("div");
    controls.className = "simple-image-crop__controls";

    const snapButton = document.createElement("button");
    snapButton.type = "button";
    snapButton.className = "simple-image-crop__toggle";

    controls.appendChild(snapButton);

    const stage = document.createElement("div");
    stage.className = "simple-image-crop__stage";

    const stageImage = document.createElement("img");
    stageImage.className = "simple-image-crop__stage-image";
    stageImage.src = image.src || image.thumbnail || `/image/${image.id}/image`;
    stageImage.alt = image.title || `Image ${image.id}`;
    stage.appendChild(stageImage);

    const selection = document.createElement("div");
    selection.className = "simple-image-crop__selection";
    selection.hidden = true;

    const selectionLabel = document.createElement("div");
    selectionLabel.className = "simple-image-crop__selection-label";
    selection.appendChild(selectionLabel);

    const selectionHandle = document.createElement("button");
    selectionHandle.type = "button";
    selectionHandle.className = "simple-image-crop__selection-handle";
    selectionHandle.setAttribute("aria-label", "Move crop");
    selectionHandle.title = "Move crop";
    selectionHandle.textContent = "+";
    selection.appendChild(selectionHandle);

    stage.appendChild(selection);

    const footer = document.createElement("div");
    footer.className = "simple-image-crop__footer";

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className =
      "simple-image-crop__button simple-image-crop__button--ghost";
    clearButton.textContent = "Clear Crop";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className =
      "simple-image-crop__button simple-image-crop__button--ghost";
    cancelButton.textContent = "Cancel";

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className =
      "simple-image-crop__button simple-image-crop__button--primary";
    applyButton.textContent = "Apply";

    footer.appendChild(clearButton);
    footer.appendChild(cancelButton);
    footer.appendChild(applyButton);

    dialog.appendChild(header);
    dialog.appendChild(controls);
    dialog.appendChild(stage);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let pointerId = null;
    let pointerStart = null;
    let currentSelection = null;
    let pointerMode = "";
    let moveOriginSelection = null;

    function updateSnapButton() {
      snapButton.textContent = `Snap: ${snapEnabled ? "On" : "Off"}`;
      snapButton.setAttribute("aria-pressed", snapEnabled ? "true" : "false");
    }

    function getImageRect() {
      if (!dimensions) return null;
      return getContainedRect(
        stage.getBoundingClientRect(),
        dimensions.width,
        dimensions.height
      );
    }

    function updateButtons() {
      clearButton.disabled = !savedCrop;
      applyButton.disabled = !currentSelection;
    }

    function renderSelection() {
      const stageRect = stage.getBoundingClientRect();
      if (!currentSelection || currentSelection.width < 2 || currentSelection.height < 2) {
        selection.hidden = true;
        updateButtons();
        return;
      }

      selection.hidden = false;
      selection.style.left = `${currentSelection.left - stageRect.left}px`;
      selection.style.top = `${currentSelection.top - stageRect.top}px`;
      selection.style.width = `${currentSelection.width}px`;
      selection.style.height = `${currentSelection.height}px`;
      selectionLabel.textContent = snapEnabled
        ? getAspectDisplayName(
            inferAspectModeFromRatio(currentSelection.width / currentSelection.height)
          )
        : "Freeform";
      updateButtons();
    }

    function syncSelectionFromSaved() {
      const imageRect = getImageRect();
      currentSelection = cropToSelection(savedCrop, imageRect);
      renderSelection();
    }

    function snapCurrentSelectionIfNeeded() {
      if (!snapEnabled || !currentSelection) return;
      const imageRect = getImageRect();
      const crop = selectionToCrop(currentSelection, imageRect);
      if (!crop || !dimensions) return;
      const mode = inferAspectModeFromRatio(currentSelection.width / currentSelection.height);
      const snappedCrop = snapCropToAspectMode(crop, dimensions, mode);
      currentSelection = cropToSelection(snappedCrop, imageRect);
    }

    function handlePointerDown(event) {
      if (event.button !== 0 || !dimensions) return;
      const isMoveHandle =
        event.target instanceof Element &&
        event.target.closest(".simple-image-crop__selection-handle");

      if (isMoveHandle && currentSelection) {
        pointerId = event.pointerId;
        pointerMode = "move";
        pointerStart = { x: event.clientX, y: event.clientY };
        moveOriginSelection = { ...currentSelection };
        stage.setPointerCapture(pointerId);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const imageRect = getImageRect();
      const point = clampPointToRect(event.clientX, event.clientY, imageRect);
      if (!point) return;

      pointerId = event.pointerId;
      pointerMode = "draw";
      pointerStart = point;
      moveOriginSelection = null;
      currentSelection = {
        left: point.x,
        top: point.y,
        width: 0,
        height: 0,
      };
      stage.setPointerCapture(pointerId);
      renderSelection();
      event.preventDefault();
    }

    function handlePointerMove(event) {
      if (pointerId !== event.pointerId || !pointerStart) return;

      if (pointerMode === "move" && moveOriginSelection) {
        const imageRect = getImageRect();
        currentSelection = clampSelectionToRect(
          moveOriginSelection,
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
          imageRect
        );
        renderSelection();
        return;
      }

      const imageRect = getImageRect();
      const point = clampPointToRect(event.clientX, event.clientY, imageRect);
      if (!point) return;
      currentSelection = selectionFromPoints(pointerStart, point);
      renderSelection();
    }

    function handlePointerUp(event) {
      if (pointerId !== event.pointerId) return;

      const finishedMode = pointerMode;
      pointerId = null;
      pointerStart = null;
      pointerMode = "";
      moveOriginSelection = null;

      try {
        stage.releasePointerCapture(event.pointerId);
      } catch (err) {
        void err;
      }

      if (finishedMode === "draw") {
        snapCurrentSelectionIfNeeded();
      } else {
        const imageRect = getImageRect();
        if (!selectionToCrop(currentSelection, imageRect)) {
          currentSelection = cropToSelection(savedCrop, imageRect);
        }
      }

      renderSelection();
    }

    function handleApply() {
      const imageRect = getImageRect();
      const crop = selectionToCrop(currentSelection, imageRect);
      if (!crop) return;

      const finalCrop =
        snapEnabled && dimensions
          ? snapCropToAspectMode(
              crop,
              dimensions,
              inferAspectModeFromRatio(getCropAspectRatio(dimensions, crop))
            )
          : crop;

      setSavedCrop(image.id, finalCrop);
      savedCrop = getSavedCrop(image.id);
      closeCropEditor();
      scheduleRefresh();
    }

    function handleClearCrop() {
      setSavedCrop(image.id, null);
      savedCrop = null;
      closeCropEditor();
      scheduleRefresh();
    }

    function handleCancel() {
      closeCropEditor();
    }

    function handleBackdropClick(event) {
      if (event.target === backdrop) {
        closeCropEditor();
      }
    }

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCropEditor();
      } else if (event.key === "Enter" && !applyButton.disabled) {
        event.preventDefault();
        handleApply();
      }
    }

    function handleResize() {
      syncSelectionFromSaved();
      if (currentSelection && snapEnabled) {
        snapCurrentSelectionIfNeeded();
        renderSelection();
      }
    }

    function handleSnapToggle() {
      snapEnabled = !snapEnabled;
      saveSnapPreference(snapEnabled);
      updateSnapButton();
      if (currentSelection && snapEnabled) {
        snapCurrentSelectionIfNeeded();
      }
      renderSelection();
    }

    function handleImageLoad() {
      if (!dimensions && stageImage.naturalWidth > 0 && stageImage.naturalHeight > 0) {
        dimensions = {
          width: stageImage.naturalWidth,
          height: stageImage.naturalHeight,
        };
      }
      syncSelectionFromSaved();
    }

    stage.addEventListener("pointerdown", handlePointerDown);
    stage.addEventListener("pointermove", handlePointerMove);
    stage.addEventListener("pointerup", handlePointerUp);
    stage.addEventListener("pointercancel", handlePointerUp);
    stageImage.addEventListener("load", handleImageLoad);
    snapButton.addEventListener("click", handleSnapToggle);
    clearButton.addEventListener("click", handleClearCrop);
    cancelButton.addEventListener("click", handleCancel);
    applyButton.addEventListener("click", handleApply);
    backdrop.addEventListener("click", handleBackdropClick);
    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", handleResize);

    updateSnapButton();
    updateButtons();

    window.requestAnimationFrame(() => {
      if (dimensions) {
        syncSelectionFromSaved();
      }
    });

    state.cropEditor = {
      cleanup() {
        stage.removeEventListener("pointerdown", handlePointerDown);
        stage.removeEventListener("pointermove", handlePointerMove);
        stage.removeEventListener("pointerup", handlePointerUp);
        stage.removeEventListener("pointercancel", handlePointerUp);
        stageImage.removeEventListener("load", handleImageLoad);
        snapButton.removeEventListener("click", handleSnapToggle);
        clearButton.removeEventListener("click", handleClearCrop);
        cancelButton.removeEventListener("click", handleCancel);
        applyButton.removeEventListener("click", handleApply);
        backdrop.removeEventListener("click", handleBackdropClick);
        window.removeEventListener("keydown", handleKeydown, true);
        window.removeEventListener("resize", handleResize);
        backdrop.remove();
      },
    };
  }

  function setIndicator(host, title) {
    if (!host) return;
    if (!state.config.showCropIcon) {
      removeIndicator(host);
      return;
    }
    host.classList.add("simple-image-crop__indicator-host");
    let badge = host.querySelector(":scope > .simple-image-crop__badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "simple-image-crop__badge";
      host.appendChild(badge);
    }
    badge.textContent = "\u25A3";
    badge.title = title || "Image has saved crop";
    badge.style.opacity = String(state.config.cropIconOpacity);
  }

  function removeIndicator(host) {
    if (!host) return;
    const badge = host.querySelector(":scope > .simple-image-crop__badge");
    if (badge) badge.remove();
    host.classList.remove("simple-image-crop__indicator-host");
  }

  function unwrapIfNeeded(img) {
    if (!(img instanceof HTMLImageElement)) return;
    img.classList.remove("simple-image-crop__image--cropped");
    img.style.left = "";
    img.style.top = "";
    img.style.width = "";
    img.style.height = "";
    img.style.objectFit = "";
    img.style.objectPosition = "";

    const wrapper = img.parentElement;
    if (wrapper?.classList.contains("simple-image-crop__viewport")) {
      const parent = wrapper.parentNode;
      if (parent) {
        parent.insertBefore(img, wrapper);
        wrapper.remove();
      }
    }
  }

  function applyCardPreviewSection(card) {
    if (!(card instanceof Element)) return;
    const previewSection = card.querySelector(".thumbnail-section");
    if (!(previewSection instanceof HTMLElement)) return;
    previewSection.style.display = "flex";
    previewSection.style.alignItems = "center";
    previewSection.style.justifyContent = "center";
    previewSection.style.position = "relative";
  }

  function restoreCardPreviewSection(card) {
    if (!(card instanceof Element)) return;
    const previewSection = card.querySelector(".thumbnail-section");
    if (!(previewSection instanceof HTMLElement)) return;
    previewSection.style.display = "";
    previewSection.style.alignItems = "";
    previewSection.style.justifyContent = "";
    previewSection.style.position = "";
  }

  function ensureViewport(img) {
    let wrapper = img.parentElement;
    if (!wrapper || !wrapper.classList.contains("simple-image-crop__viewport")) {
      wrapper = document.createElement("div");
      wrapper.className = "simple-image-crop__viewport";
      img.parentNode.insertBefore(wrapper, img);
      wrapper.appendChild(img);
    }

    wrapper.classList.add("simple-image-crop__viewport--contained");
    return wrapper;
  }

  function ensurePageSurface(target, widthPx, aspectRatio, crop) {
    const parent = target.parentElement;
    if (!parent) return null;

    const oldViewports = parent.querySelectorAll(
      ":scope > .simple-image-crop__page-surface"
    );
    const surfaces = Array.from(parent.querySelectorAll(":scope > .simple-image-crop__page-surface"));
    let surface = surfaces[0] || null;
    oldViewports.forEach((node, index) => {
      if (node !== surface || index > 0) node.remove();
    });

    if (!(surface instanceof HTMLDivElement)) {
      surface = document.createElement("div");
      surface.className = "simple-image-crop__page-surface";
      surface.setAttribute("data-sic-for", String(getCurrentImageId() || ""));
      parent.insertBefore(surface, target);
    }

    const normalized = normalizeCropRect(crop);
    const src = String(target.currentSrc || target.src || "");
    const numericWidth = Number(widthPx) || 0;
    const numericRatio = Number(aspectRatio) || 1;
    const surfaceHeight =
      numericWidth > 0 && numericRatio > 0 ? numericWidth / numericRatio : 0;

    surface.style.width = numericWidth > 0 ? `${Math.round(numericWidth)}px` : "";
    surface.style.maxWidth = "100%";
    surface.style.aspectRatio = "";
    surface.style.height = surfaceHeight > 0 ? `${Math.round(surfaceHeight)}px` : "";
    surface.dataset.sicWidth = numericWidth > 0 ? String(numericWidth) : "";
    surface.dataset.sicHeight = surfaceHeight > 0 ? String(surfaceHeight) : "";
    surface.dataset.sicRatio = numericRatio > 0 ? String(numericRatio) : "";
    surface.style.backgroundImage = src ? `url("${src.replace(/"/g, '\\"')}")` : "";
    if (normalized) {
      const bgWidth = numericWidth > 0 ? numericWidth / normalized.width : 0;
      const bgHeight = surfaceHeight > 0 ? surfaceHeight / normalized.height : 0;
      const offsetX = -(normalized.x * bgWidth);
      const offsetY = -(normalized.y * bgHeight);
      surface.style.backgroundSize =
        bgWidth > 0 && bgHeight > 0
          ? `${bgWidth}px ${bgHeight}px`
          : "";
      surface.style.backgroundPosition =
        bgWidth > 0 && bgHeight > 0
          ? `${offsetX}px ${offsetY}px`
          : "";
    } else {
      surface.style.backgroundSize = "";
      surface.style.backgroundPosition = "";
    }
    target.dataset.sicPageHidden = "true";
    target.dataset.sicLastWidth = numericWidth > 0 ? String(numericWidth) : "";
    target.dataset.sicLastHeight = surfaceHeight > 0 ? String(surfaceHeight) : "";
    target.dataset.sicLastRatio = numericRatio > 0 ? String(numericRatio) : "";
    target.style.display = "none";
    return surface;
  }

  function restorePageViewport(target) {
    if (!(target instanceof HTMLImageElement)) return;
    if (target.dataset.sicPageHidden === "true") {
      target.style.display = "";
      delete target.dataset.sicPageHidden;
    }
    const parent = target.parentElement;
    if (!parent) return;
    const wrappers = parent.querySelectorAll(
      ":scope > .simple-image-crop__page-surface"
    );
    wrappers.forEach((wrapper) => wrapper.remove());
  }

  function cleanupAllPageSurfaces() {
    document.querySelectorAll(".simple-image-crop__page-surface").forEach((node) => {
      node.remove();
    });
    document.querySelectorAll('img[data-sic-page-hidden="true"]').forEach((img) => {
      if (img instanceof HTMLImageElement) {
        img.style.display = "";
        delete img.dataset.sicPageHidden;
        delete img.dataset.sicLastWidth;
        delete img.dataset.sicLastHeight;
        delete img.dataset.sicLastRatio;
      }
    });
  }

  function withApplyGuard(callback) {
    state.isApplying = true;
    try {
      return callback();
    } finally {
      window.setTimeout(() => {
        state.isApplying = false;
      }, 0);
    }
  }

  function applyCropStyles(img, crop) {
    const normalized = normalizeCropRect(crop);
    if (!normalized) return;
    img.classList.add("simple-image-crop__image--cropped");
    img.style.left = `${(-normalized.x / normalized.width) * 100}%`;
    img.style.top = `${(-normalized.y / normalized.height) * 100}%`;
    img.style.width = `${100 / normalized.width}%`;
    img.style.height = `${100 / normalized.height}%`;
  }

  function applyCropToImageCard(card) {
    if (!(card instanceof Element)) return;
    const link = card.querySelector('a[href*="/images/"]');
    const img = card.querySelector("img");
    if (!link || !(img instanceof HTMLImageElement)) return;

    const imageId = getCurrentImageId(link.getAttribute("href") || "");
    if (!imageId) return;

    const crop = getSavedCrop(imageId);
    if (!crop) {
      unwrapIfNeeded(img);
      restoreCardPreviewSection(card);
      removeIndicator(card);
      return;
    }

    unwrapIfNeeded(img);
    applyCardPreviewSection(card);

    const cropRatio =
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? getCropAspectRatio(
            { width: img.naturalWidth, height: img.naturalHeight },
            crop
          )
        : crop.width / crop.height;
    const previewSection = card.querySelector(".thumbnail-section");
    const previewRect =
      previewSection instanceof HTMLElement
        ? previewSection.getBoundingClientRect()
        : null;
    const previewWidth = previewRect?.width || 0;
    const previewHeight = previewRect?.height || 0;
    const viewportSize = getContainedViewportSize(cropRatio, previewWidth, previewHeight);
    if (!viewportSize) return;

    const viewport = ensureViewport(img);
    viewport.style.width = `${Math.round(viewportSize.width)}px`;
    viewport.style.height = `${Math.round(viewportSize.height)}px`;
    applyCropStyles(img, crop);
    setIndicator(card, "Image has an active crop");
  }

  function applyCropToCurrentImagePage() {
    const imageId = getCurrentImageId();
    if (!imageId) return;
    const crop = getSavedCrop(imageId);
    const target = getCurrentPageImageCandidate(imageId);
    if (!(target instanceof HTMLImageElement)) return;

    if (!crop) {
      restorePageViewport(target);
      unwrapIfNeeded(target);
      const host = target.closest(".simple-image-crop__indicator-host");
      if (host) removeIndicator(host);
      return;
    }

    const existingSurface = target.parentElement?.querySelector(
      ":scope > .simple-image-crop__page-surface"
    );
    const renderedWidth =
      target.clientWidth ||
      target.getBoundingClientRect().width ||
      Number(target.dataset.sicLastWidth) ||
      (existingSurface instanceof HTMLElement
        ? existingSurface.clientWidth || existingSurface.getBoundingClientRect().width || 0
        : 0);
    const renderedHeight =
      target.clientHeight ||
      target.getBoundingClientRect().height ||
      Number(target.dataset.sicLastHeight) ||
      (existingSurface instanceof HTMLElement
        ? existingSurface.clientHeight || existingSurface.getBoundingClientRect().height || 0
        : 0);
    if (!(renderedWidth > 8) || !(renderedHeight > 8)) {
      if (target.dataset.sicPageHidden !== "true") {
        restorePageViewport(target);
      }
      window.setTimeout(scheduleRefresh, 120);
      return;
    }

    const cropRatio =
      target.naturalWidth > 0 && target.naturalHeight > 0
        ? getCropAspectRatio(
            { width: target.naturalWidth, height: target.naturalHeight },
            crop
          )
        : Number(target.dataset.sicLastRatio) || crop.width / crop.height;

    const surface = ensurePageSurface(target, renderedWidth, cropRatio, crop);
    if (!(surface instanceof Element)) return;
    setIndicator(surface, "Image has an active crop");
  }

  function renderEditActions() {
    const imageId = getCurrentImageId();
    const container = document.querySelector("#image-edit-details");
    if (!imageId || !(container instanceof Element)) return;

    function findActionHost() {
      const roots = [
        container,
        container.closest("form"),
        document.querySelector(".image-tabs"),
      ].filter(Boolean);

      const selectors = [
        ".btn-toolbar",
        ".form-actions",
        ".edit-buttons",
        ".actions",
        ".operation-buttons",
      ];

      for (const root of roots) {
        if (!(root instanceof Element)) continue;
        for (const selector of selectors) {
          const host = root.querySelector(selector);
          if (host instanceof HTMLElement) return host;
        }
      }

      return null;
    }

    const actionHost = findActionHost();
    let actions = container.querySelector(".simple-image-crop__edit-actions");
    if (!(actions instanceof HTMLElement)) {
      actions = document.createElement("div");
      actions.className = "simple-image-crop__edit-actions";
    }
    if (actionHost instanceof HTMLElement) {
      if (actions.parentNode !== actionHost.parentNode) {
        actionHost.insertAdjacentElement("afterend", actions);
      }
    } else if (actions.parentNode !== container) {
      container.prepend(actions);
    }

    const hasCrop = !!getSavedCrop(imageId);

    let controls = actions.querySelector(".simple-image-crop__edit-buttons");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "simple-image-crop__edit-buttons";
      actions.appendChild(controls);
    }

    let cropButton = controls.querySelector('[data-sic-action="open"]');
    if (!cropButton) {
      cropButton = document.createElement("button");
      cropButton.type = "button";
      cropButton.className = "btn btn-secondary simple-image-crop__edit-button";
      cropButton.setAttribute("data-sic-action", "open");
      cropButton.textContent = "\u25A3 Crop";
      cropButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openCropEditorForCurrentImage();
      };
      controls.appendChild(cropButton);
    }

    let clearButton = controls.querySelector('[data-sic-action="clear"]');
    if (!clearButton) {
      clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "btn btn-secondary simple-image-crop__edit-button";
      clearButton.textContent = "Clear";
      clearButton.setAttribute("data-sic-action", "clear");
      clearButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const activeImageId = getCurrentImageId();
        if (!activeImageId) return;
        setSavedCrop(activeImageId, null);
        scheduleRefresh();
      };
      controls.appendChild(clearButton);
    }

    clearButton.disabled = !hasCrop;
    cropButton.title = hasCrop ? "Edit saved crop" : "Crop image";
    clearButton.title = hasCrop ? "Clear saved crop" : "No saved crop";
    cropButton.classList.toggle("is-active", hasCrop);
  }

  function applySavedCrops() {
    withApplyGuard(() => {
      renderEditActions();
      applyCropToCurrentImagePage();
      document.querySelectorAll(".image-card").forEach(applyCropToImageCard);
    });
  }

  function refresh() {
    state.refreshHandle = 0;
    applySavedCrops();
  }

  function scheduleRefresh() {
    if (state.refreshHandle) return;
    state.refreshHandle = window.requestAnimationFrame(refresh);
  }

  function handleRouteChange() {
    state.routeToken += 1;
    cleanupAllPageSurfaces();
    if (!getCurrentImageId()) {
      closeCropEditor();
    }
    state.imageCache.clear();
    scheduleRefresh();
  }

  function scheduleRouteRefreshes() {
    const token = ++state.routeToken;
    ROUTE_RETRY_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        if (token !== state.routeToken) return;
        scheduleRefresh();
      }, delay);
    });
  }

  function disconnectObservers() {
    state.observers.forEach((observer) => observer.disconnect());
    state.observers = [];
  }

  function installObservers() {
    disconnectObservers();

    const hasSavedCrops = Object.keys(state.cropStore).length > 0;
    const shouldObserve = hasSavedCrops || !!getCurrentImageId();
    if (!shouldObserve) return;

    const roots = [
      document.querySelector("#image-edit-details"),
      document.querySelector(".image-tabs"),
      document.querySelector(".filtered-list-container"),
      document.querySelector(".wall"),
      document.querySelector(".list"),
      document.querySelector(".tab-content"),
      document.querySelector(".main"),
    ].filter((root, index, list) => root instanceof Element && list.indexOf(root) === index);

    roots.forEach((root) => {
      const observer = new MutationObserver(() => {
        if (state.isApplying) return;
        scheduleRefresh();
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
      });
      state.observers.push(observer);
    });
  }

  function install() {
    if (window.__simpleImageCropInstalled) return;
    window.__simpleImageCropInstalled = true;

    if (window.PluginApi?.Event?.addEventListener) {
      window.PluginApi.Event.addEventListener("stash:location", () => {
        handleRouteChange();
        installObservers();
        scheduleRouteRefreshes();
      });
    }

    window.addEventListener("resize", scheduleRefresh);
    installObservers();
    handleRouteChange();
    scheduleRouteRefreshes();
    loadConfig().finally(() => {
      scheduleRefresh();
    });
  }

  install();
})();
