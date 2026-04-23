(function () {
  "use strict";

  const STASHFACE_URL = "https://cc1234-stashface.hf.space/";
  const STASHFACE_ORIGIN = "https://cc1234-stashface.hf.space";
  const THRESHOLD = 0.5;
  const MAX_RESULTS = 5;
  const GRADIO_CLIENT_URL = "https://cdn.jsdelivr.net/npm/@gradio/client@1.15.3/dist/index.js";

  let activeSession = null;
  let lastCropBlob = null;
  let lastCropPngBlob = null;
  let lastCropDataUrl = null;
  let lastCropPngDataUrl = null;
  let gradioClientModule = null;
  let gradioClient = null;

  function getScenario() {
    const match = document.URL.match(/(scenes|images)\/(\d+)/);
    return match ? { type: match[1], id: match[2] } : null;
  }

  function getCaptureTarget() {
    const scenario = getScenario();
    if (!scenario) return null;

    if (scenario.type === "scenes") {
      return (
        document.querySelector("#VideoJsPlayer video") ||
        document.querySelector(".video-js video") ||
        document.querySelector("video")
      );
    }

    return (
      document.querySelector(".image-image img") ||
      document.querySelector("img.image-image") ||
      document.querySelector(".image-image")
    );
  }

  function canCapture(target) {
    if (!target) return false;
    if (target instanceof HTMLVideoElement) return target.videoWidth && target.videoHeight;
    if (target instanceof HTMLImageElement) return target.complete && target.naturalWidth && target.naturalHeight;
    return false;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function makeButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className || "btn btn-secondary";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "visage-marquee-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  function getCsLib() {
    if (typeof csLib !== "undefined") return csLib;
    if (window.csLib) return window.csLib;
    throw new Error("CommunityScriptsUILibrary is not available.");
  }

  function gqlString(value) {
    return JSON.stringify(String(value || ""));
  }

  function gqlData(response) {
    return response?.data || response;
  }

  async function callGQL(query, variables) {
    return gqlData(await getCsLib().callGQL({ query, variables }));
  }

  async function getConfiguredStashboxEndpoint() {
    const query = `{
      configuration {
        general {
          stashBoxes {
            endpoint
          }
        }
      }
    }`;
    const data = await callGQL(query);
    return data?.configuration?.general?.stashBoxes?.[0]?.endpoint || "";
  }

  async function findLocalPerformer(stashId) {
    const endpoint = await getConfiguredStashboxEndpoint();
    const endpoints = ["", endpoint].filter((value, index, values) => values.indexOf(value) === index);

    for (const candidateEndpoint of endpoints) {
      const query = `{
        findPerformers(performer_filter: {stash_id_endpoint: {endpoint: ${gqlString(candidateEndpoint)}, stash_id: ${gqlString(stashId)}, modifier: EQUALS}}) {
          performers {
            id
            name
          }
        }
      }`;
      const data = await callGQL(query);
      const performer = data?.findPerformers?.performers?.[0];
      if (performer) return performer;
    }

    return null;
  }

  async function scrapePerformer(stashId) {
    const variables = {
      source: { stash_box_index: 0 },
      input: { query: stashId },
    };
    const query = `query ScrapeSinglePerformer($source: ScraperSourceInput!, $input: ScrapeSinglePerformerInput!) {
      scrapeSinglePerformer(source: $source, input: $input) {
        name
        disambiguation
        gender
        url
        twitter
        instagram
        birthdate
        ethnicity
        country
        eye_color
        height
        measurements
        fake_tits
        career_length
        tattoos
        piercings
        aliases
        images
        details
        death_date
        hair_color
        weight
        remote_site_id
      }
    }`;
    const data = await callGQL(query, variables);
    return data?.scrapeSinglePerformer?.find((performer) => performer.remote_site_id === stashId);
  }

  function normalizeScrapedPerformer(performer, stashId, endpoint) {
    const input = { ...performer };
    if (input.images?.length) input.image = input.images[0];
    delete input.images;
    delete input.remote_site_id;

    if (input.height) {
      input.height_cm = input.height;
      delete input.height;
    }

    if (input.aliases) {
      input.alias_list = input.aliases;
      delete input.aliases;
    }

    Object.keys(input).forEach((key) => {
      if (input[key] === null) delete input[key];
    });

    input.stash_ids = [{ endpoint, stash_id: stashId }];
    return input;
  }

  async function createLocalPerformer(stashId) {
    const endpoint = await getConfiguredStashboxEndpoint();
    const scraped = await scrapePerformer(stashId);
    if (!scraped) {
      throw new Error("Could not retrieve performer data from StashDB.");
    }

    const variables = {
      input: normalizeScrapedPerformer(scraped, stashId, endpoint),
    };
    const query = `mutation performerCreate($input: PerformerCreateInput!) {
      performerCreate(input: $input) {
        id
      }
    }`;
    const response = await getCsLib().callGQL({ query, variables });
    const data = gqlData(response);
    const performerId = data?.performerCreate?.id;
    if (!performerId) {
      const message = response?.errors?.[0]?.message || "Performer creation failed.";
      throw new Error(message);
    }
    return { id: performerId, name: scraped.name };
  }

  async function resolveLocalPerformer(stashId) {
    const local = await findLocalPerformer(stashId);
    if (local) return local;
    return await createLocalPerformer(stashId);
  }

  async function getCurrentPerformerIds(scenario) {
    const query =
      scenario.type === "scenes"
        ? `{
            findScene(id: ${gqlString(scenario.id)}) {
              performers {
                id
              }
            }
          }`
        : `{
            findImage(id: ${gqlString(scenario.id)}) {
              performers {
                id
              }
            }
          }`;
    const data = await callGQL(query);
    const item = scenario.type === "scenes" ? data?.findScene : data?.findImage;
    return item?.performers?.map((performer) => performer.id) || [];
  }

  async function updateCurrentPerformers(scenario, performerIds) {
    const variables = { input: { id: scenario.id, performer_ids: performerIds } };
    const query =
      scenario.type === "scenes"
        ? `mutation sceneUpdate($input: SceneUpdateInput!) {
            sceneUpdate(input: $input) {
              id
            }
          }`
        : `mutation imageUpdate($input: ImageUpdateInput!) {
            imageUpdate(input: $input) {
              id
            }
          }`;
    return await getCsLib().callGQL({ query, variables });
  }

  async function assignPerformer(candidate) {
    const scenario = getScenario();
    if (!scenario) throw new Error("Could not determine the current Stash item.");

    const localPerformer = await resolveLocalPerformer(candidate.id);
    const performerIds = await getCurrentPerformerIds(scenario);
    if (performerIds.includes(localPerformer.id)) {
      return { assigned: false, message: `${candidate.name} is already assigned.` };
    }

    await updateCurrentPerformers(scenario, [...performerIds, localPerformer.id]);
    return { assigned: true, message: `Assigned ${candidate.name}.` };
  }

  function closeOverlay() {
    if (activeSession?.overlay) activeSession.overlay.remove();
    activeSession = null;
  }

  function closeModal() {
    document.querySelector(".visage-marquee-modal-backdrop")?.remove();
  }

  function sourceDimensions(target) {
    if (target instanceof HTMLVideoElement) {
      return { width: target.videoWidth, height: target.videoHeight };
    }
    return { width: target.naturalWidth, height: target.naturalHeight };
  }

  function drawSourceToCanvas(target, canvas) {
    const { width, height } = sourceDimensions(target);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(target, 0, 0, width, height);
  }

  async function cropSelection(target, selectionRect, targetRect) {
    const sourceCanvas = document.createElement("canvas");
    drawSourceToCanvas(target, sourceCanvas);

    const scaleX = sourceCanvas.width / targetRect.width;
    const scaleY = sourceCanvas.height / targetRect.height;
    const sx = clamp((selectionRect.left - targetRect.left) * scaleX, 0, sourceCanvas.width);
    const sy = clamp((selectionRect.top - targetRect.top) * scaleY, 0, sourceCanvas.height);
    const sw = clamp(selectionRect.width * scaleX, 1, sourceCanvas.width - sx);
    const sh = clamp(selectionRect.height * scaleY, 1, sourceCanvas.height - sy);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.round(sw);
    cropCanvas.height = Math.round(sh);
    cropCanvas.getContext("2d").drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);

    lastCropDataUrl = cropCanvas.toDataURL("image/jpeg", 0.92);
    lastCropPngDataUrl = cropCanvas.toDataURL("image/png");
    lastCropBlob = await new Promise((resolve) => cropCanvas.toBlob(resolve, "image/jpeg", 0.92));
    lastCropPngBlob = await new Promise((resolve) => cropCanvas.toBlob(resolve, "image/png"));
    return lastCropDataUrl;
  }

  async function copyCropToClipboard() {
    if (!lastCropPngBlob) return;

    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": lastCropPngBlob,
        }),
      ]);
      showToast("Face crop copied to clipboard.");
      return;
    }

    if (navigator.clipboard && lastCropPngDataUrl) {
      await navigator.clipboard.writeText(lastCropPngDataUrl);
      showToast("Image data URL copied. If paste does not work, use Download Crop.");
      return;
    }

    showToast("Image clipboard is not supported by this browser. Use Download Crop.");
  }

  function downloadCrop() {
    if (!lastCropBlob) return;
    const url = URL.createObjectURL(lastCropBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "visage-face-crop.jpg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function callOfficialGradioClient() {
    if (!lastCropPngBlob) {
      throw new Error("No face crop is available.");
    }

    if (!gradioClientModule) {
      gradioClientModule = await import(GRADIO_CLIENT_URL);
    }

    if (!gradioClient) {
      gradioClient = await gradioClientModule.Client.connect(STASHFACE_ORIGIN);
    }

    const file = new File([lastCropPngBlob], "visage-face-crop.png", {
      type: "image/png",
    });
    const fileHandle = gradioClientModule.handle_file(file);
    return await gradioClient.predict("/multiple_image_search", [
      fileHandle,
      THRESHOLD,
      MAX_RESULTS,
    ]);
  }

  function imageSource(value) {
    if (!value) return "";
    if (/^(https?:|data:)/.test(value)) return value;
    return `data:image/jpeg;base64,${value}`;
  }

  function extractCandidates(result) {
    const faces = Array.isArray(result?.data?.[0]) ? result.data[0] : [];
    return faces
      .flatMap((face) => face.performers || [])
      .sort((a, b) => (Number(b.confidence) || -1) - (Number(a.confidence) || -1));
  }

  function renderMatches(resultBox, candidates) {
    resultBox.innerHTML = "";

    if (!candidates.length) {
      resultBox.textContent = "No performer matches returned for this crop.";
      return;
    }

    const intro = document.createElement("div");
    intro.className = "visage-marquee-match-intro";
    intro.textContent = `Found ${candidates.length} possible performer ${candidates.length === 1 ? "match" : "matches"}.`;

    const grid = document.createElement("div");
    grid.className = "visage-marquee-match-grid";

    candidates.forEach((candidate) => {
      const card = document.createElement("div");
      card.className = "visage-marquee-card";

      const imageFrame = document.createElement("div");
      imageFrame.className = "visage-marquee-performer-frame";

      const performerImage = document.createElement("img");
      performerImage.className = "visage-marquee-performer-img";
      performerImage.src = imageSource(candidate.image);
      performerImage.alt = candidate.name || "Performer";

      imageFrame.appendChild(performerImage);

      const title = document.createElement("strong");
      title.textContent = candidate.name || "Unknown performer";

      const meta = document.createElement("div");
      meta.className = "visage-marquee-card-meta";
      meta.textContent = [
        candidate.country ? `Country: ${candidate.country}` : null,
        Number.isFinite(candidate.confidence) ? `Match: ${candidate.confidence}%` : null,
        Number.isFinite(candidate.hits) ? `Hits: ${candidate.hits}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      const actions = document.createElement("div");
      actions.className = "visage-marquee-card-actions";

      const assignButton = makeButton("Assign", "btn btn-primary", async () => {
        assignButton.disabled = true;
        assignButton.textContent = "Assigning...";
        try {
          const result = await assignPerformer(candidate);
          card.classList.toggle("visage-marquee-card-assigned", result.assigned);
          assignButton.textContent = result.assigned ? "Assigned" : "Already Assigned";
          showToast(result.message);
          if (result.assigned) {
            window.setTimeout(() => window.location.reload(), 900);
          }
        } catch (error) {
          assignButton.disabled = false;
          assignButton.textContent = "Assign";
          showToast(error.message);
        }
      });

      actions.append(assignButton);
      if (candidate.performer_url) {
        const link = document.createElement("a");
        link.className = "btn btn-secondary";
        link.href = candidate.performer_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "StashDB";
        actions.append(link);
      }

      card.append(imageFrame, title, meta, actions);
      grid.appendChild(card);
    });

    resultBox.append(intro, grid);
  }

  async function findMatches(resultBox) {
    if (!lastCropDataUrl) return;

    resultBox.textContent = "Finding performer matches...";

    try {
      const result = await callOfficialGradioClient();
      const candidates = extractCandidates(result);
      renderMatches(resultBox, candidates);
    } catch (error) {
      resultBox.textContent = `StashFace lookup failed: ${error.message}`;
    }
  }

  function pauseVideoFrame(target) {
    if (!(target instanceof HTMLVideoElement) || target.paused) return;
    target.pause();
    showToast("Video paused for face crop.");
  }

  function showCropModal(dataUrl) {
    closeModal();

    const backdrop = document.createElement("div");
    backdrop.className = "visage-marquee-modal-backdrop";

    const modal = document.createElement("div");
    modal.className = "visage-marquee-modal";

    const title = document.createElement("h3");
    title.textContent = "Visage Face Crop";

    const note = document.createElement("p");
    note.className = "visage-marquee-note";
    note.textContent =
      "Find matches sends only this cropped face image to the StashFace backend, then lets you assign a match to the current image or scene.";

    const image = document.createElement("img");
    image.className = "visage-marquee-preview";
    image.src = dataUrl;

    const actions = document.createElement("div");
    actions.className = "visage-marquee-actions";

    const resultBox = document.createElement("div");
    resultBox.className = "visage-marquee-result";
    resultBox.textContent = "Performer matches will appear here.";

    const openButton = makeButton("Open StashFace", "btn btn-primary", () => window.open(STASHFACE_URL, "_blank", "noopener,noreferrer"));
    const findButton = makeButton("Find Matches", "btn btn-info", async () => {
      findButton.disabled = true;
      try {
        await findMatches(resultBox);
      } finally {
        findButton.disabled = false;
      }
    });
    const downloadButton = makeButton("Download Crop", "btn btn-secondary", downloadCrop);
    const copyButton = makeButton("Copy Crop", "btn btn-secondary", () => copyCropToClipboard().catch((error) => showToast(error.message)));
    const closeButton = makeButton("Close", "btn btn-danger", closeModal);

    actions.append(openButton, findButton, downloadButton, copyButton, closeButton);

    modal.append(title, note, image, actions, resultBox);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal();
    });
    document.body.appendChild(backdrop);
  }

  function startMarquee() {
    const target = getCaptureTarget();
    if (!canCapture(target)) {
      alert("Visage could not find a loaded image or video frame to crop.");
      return;
    }

    closeOverlay();
    pauseVideoFrame(target);

    const targetRect = target.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "visage-marquee-overlay";
    overlay.style.left = `${targetRect.left}px`;
    overlay.style.top = `${targetRect.top}px`;
    overlay.style.width = `${targetRect.width}px`;
    overlay.style.height = `${targetRect.height}px`;

    const hint = document.createElement("div");
    hint.className = "visage-marquee-hint";
    hint.textContent = "Drag over the performer's face. Press Esc to cancel.";

    const selection = document.createElement("div");
    selection.className = "visage-marquee-selection";

    overlay.append(hint, selection);
    document.body.appendChild(overlay);

    activeSession = { overlay, target, targetRect, startX: 0, startY: 0, dragging: false };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        document.removeEventListener("keydown", onKeyDown);
        closeOverlay();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    overlay.addEventListener("mousedown", (event) => {
      event.preventDefault();
      activeSession.dragging = true;
      activeSession.startX = event.clientX;
      activeSession.startY = event.clientY;
      selection.style.display = "block";
      selection.style.left = "0px";
      selection.style.top = "0px";
      selection.style.width = "0px";
      selection.style.height = "0px";
    });

    overlay.addEventListener("mousemove", (event) => {
      if (!activeSession?.dragging) return;

      const left = clamp(Math.min(activeSession.startX, event.clientX) - targetRect.left, 0, targetRect.width);
      const top = clamp(Math.min(activeSession.startY, event.clientY) - targetRect.top, 0, targetRect.height);
      const right = clamp(Math.max(activeSession.startX, event.clientX) - targetRect.left, 0, targetRect.width);
      const bottom = clamp(Math.max(activeSession.startY, event.clientY) - targetRect.top, 0, targetRect.height);

      selection.style.left = `${left}px`;
      selection.style.top = `${top}px`;
      selection.style.width = `${right - left}px`;
      selection.style.height = `${bottom - top}px`;
    });

    overlay.addEventListener("mouseup", async () => {
      if (!activeSession?.dragging) return;
      activeSession.dragging = false;

      const rect = selection.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 12) {
        showToast("Selection was too small. Drag a larger face crop.");
        return;
      }

      document.removeEventListener("keydown", onKeyDown);
      closeOverlay();

      try {
        const dataUrl = await cropSelection(target, rect, targetRect);
        showCropModal(dataUrl);
      } catch (error) {
        alert(`Could not create face crop: ${error.message}`);
      }
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.("#visage");
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      startMarquee();
    },
    true
  );
})();
