(function () {
    'use strict';

    const PLUGIN_ID = 'BackgroundImagesSlideshow';
    const BACKGROUND_CONTAINER_ID = 'background-images-slideshow-background';
    const NAVIGATION_EVENT = 'background-images-slideshow:navigation';
    const GLOBAL_HOOK_KEY = '__backgroundImagesSlideshowHooks';
    const DISPLAY_MODE_STORAGE_KEY = 'BackgroundImagesSlideshow.displayMode';
    const BACKGROUND_MODE_ENABLED = 'enabled';
    const BACKGROUND_MODE_VIEWING = 'viewing';
    const BACKGROUND_MODE_DISABLED = 'disabled';
    const SCENE_MODE_DISABLED = 'disable';
    const SCENE_MODE_THUMBNAIL = 'thumbnail';
    const SCENE_MODE_PREVIEW = 'preview';
    const DEFAULT_BACKGROUND_OPACITY = 0.3;
    const DEFAULT_BACKGROUND_BRIGHTNESS = 1;
    const DEFAULT_BACKGROUND_SATURATION = 1;
    const DEFAULT_BACKGROUND_BLUR = 0;
    const MAX_BACKGROUND_BLUR_PX = 16;
    const DEFAULT_SLIDESHOW_DURATION_SECONDS = 0;
    const DEFAULT_TRANSITION_DURATION_MS = 2000;
    const DEFAULT_COLUMN_COUNT = 1;
    const DEFAULT_COLUMN_BLEND_WIDTH = 160;
    const COLUMN_WIDTH_MODE_EQUAL = 'equal';
    const COLUMN_WIDTH_MODE_FIXED = 'fixed';
    const COLUMN_WIDTH_MODE_AUTO = 'auto';
    const AUTO_COLUMN_MIN_WIDTH = 20;
    const AUTO_COLUMN_MAX_WIDTH = 60;
    const SLIDESHOW_IMAGE_LIMIT = 50;

    const state = {
        root: null,
        entityId: null,
        galleryMode: false,
        sceneBackgroundMode: SCENE_MODE_DISABLED,
        uniquePerformerPage: false,
        performerGalleryMode: false,
        performerEntityId: null,
        slideshowDurationMs: DEFAULT_SLIDESHOW_DURATION_SECONDS * 1000,
        transitionDurationMs: DEFAULT_TRANSITION_DURATION_MS,
        columnCount: DEFAULT_COLUMN_COUNT,
        columnWidthMode: COLUMN_WIDTH_MODE_EQUAL,
        columnWidths: [],
        columnBlendWidth: DEFAULT_COLUMN_BLEND_WIDTH,
        backgroundOpacity: DEFAULT_BACKGROUND_OPACITY,
        backgroundBrightness: DEFAULT_BACKGROUND_BRIGHTNESS,
        backgroundSaturation: DEFAULT_BACKGROUND_SATURATION,
        backgroundBlur: DEFAULT_BACKGROUND_BLUR,
        forceTransparentMainBackground: false,
        showViewBackgroundButton: true,
        imageAspectRatios: new Map(),
        globalBackgroundImages: [],
        activeImages: [],
        activeImageIndex: 0,
        activeSourceKey: '',
        currentBackgroundImages: [],
        backgroundContainer: null,
        baseLayer: null,
        nextLayer: null,
        transitionToken: 0,
        slideshowTimer: 0,
        transitionTimer: 0,
        navigationToken: 0,
        backgroundDisplayMode: BACKGROUND_MODE_ENABLED,
        scenePreviewUrl: '',
        scenePreviewFailed: false,
        sceneVideo: null,
        sceneVideoReady: false,
        scenePlayPending: false,
        scenePlayAttempt: 0,
        reducedMotionQuery: null,
        lastRouteKey: '',
    };

    const validBackgroundModes = new Set([
        BACKGROUND_MODE_ENABLED,
        BACKGROUND_MODE_VIEWING,
        BACKGROUND_MODE_DISABLED,
    ]);

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const waitForElement = async (selector, timeoutMs = 5000) => {
        const deadline = Date.now() + timeoutMs;
        let element = document.querySelector(selector);
        while (!element && Date.now() < deadline) {
            await sleep(100);
            element = document.querySelector(selector);
        }
        return element;
    };

    const getConfigBoolean = (value, fallback = false) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
        }
        return fallback;
    };

    const getSceneBackgroundMode = (value) => {
        if (value === true) return SCENE_MODE_THUMBNAIL;
        if (value === false) return SCENE_MODE_DISABLED;
        const normalized = String(value ?? '').trim().toLowerCase();
        if (normalized === SCENE_MODE_PREVIEW) return SCENE_MODE_PREVIEW;
        if (normalized === SCENE_MODE_THUMBNAIL || normalized === 'true') {
            return SCENE_MODE_THUMBNAIL;
        }
        return SCENE_MODE_DISABLED;
    };

    const getConfigNumber = (value, fallback, min, max) => {
        const parsed = Number.parseFloat(String(value ?? '').trim());
        if (!Number.isFinite(parsed)) return fallback;
        if (Number.isFinite(min) && parsed < min) return fallback;
        if (Number.isFinite(max) && parsed > max) return fallback;
        return parsed;
    };

    const clampNumber = (value, fallback, min, max) => {
        const parsed = Number.parseFloat(String(value ?? '').trim());
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    };

    const parseBackgroundAdjustments = (value) => {
        const values = String(value ?? '')
            .split(',')
            .map((part) => part.trim());
        return {
            opacity: clampNumber(values[0], DEFAULT_BACKGROUND_OPACITY, 0, 1),
            brightness: clampNumber(values[1], DEFAULT_BACKGROUND_BRIGHTNESS, 0, 1),
            saturation: clampNumber(values[2], DEFAULT_BACKGROUND_SATURATION, 0, 1),
            blur: clampNumber(values[3], DEFAULT_BACKGROUND_BLUR, 0, 1),
        };
    };

    const loadBackgroundDisplayMode = () => {
        try {
            const storedMode = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
            return validBackgroundModes.has(storedMode) ? storedMode : BACKGROUND_MODE_ENABLED;
        } catch (err) {
            return BACKGROUND_MODE_ENABLED;
        }
    };

    const saveBackgroundDisplayMode = (mode) => {
        try {
            localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
        } catch (err) {
            // Storage can be unavailable in hardened/private browser contexts.
        }
    };

    const getEqualColumnWidths = (count) => {
        const width = 100 / Math.max(1, count);
        return Array.from({ length: Math.max(1, count) }, () => width);
    };

    const getColumnWidthConfig = (value, count) => {
        const normalized = String(value ?? '').trim().toLowerCase();
        if (normalized === COLUMN_WIDTH_MODE_AUTO) {
            return { mode: COLUMN_WIDTH_MODE_AUTO, widths: getEqualColumnWidths(count) };
        }

        const equalWidths = getEqualColumnWidths(count);
        const widths = String(value ?? '')
            .split(',')
            .map((part) => Number.parseFloat(part.trim()))
            .filter((width) => Number.isFinite(width) && width > 0)
            .slice(0, count);

        if (widths.length !== count) {
            return { mode: COLUMN_WIDTH_MODE_EQUAL, widths: equalWidths };
        }

        const total = widths.reduce((sum, width) => sum + width, 0);
        if (!Number.isFinite(total) || total <= 0) {
            return { mode: COLUMN_WIDTH_MODE_EQUAL, widths: equalWidths };
        }

        return {
            mode: COLUMN_WIDTH_MODE_FIXED,
            widths: widths.map((width) => (width / total) * 100),
        };
    };

    const main = async () => {
        state.root = await waitForElement('#root', 10000);
        if (!state.root) {
            console.error('Could not find #root for Background Images Slideshow plugin.');
            return;
        }

        const plugins = await makeRequest(configRequest);
        const config = plugins?.data?.configuration?.plugins?.[PLUGIN_ID] || {};

        state.entityId = config.id;
        state.galleryMode = getConfigBoolean(config.mode, false);
        state.sceneBackgroundMode = getSceneBackgroundMode(config.scenePage);
        state.uniquePerformerPage = getConfigBoolean(config.performerPage, false);
        state.performerGalleryMode = getConfigBoolean(config.performerPageEntity, false);
        state.performerEntityId = config.performerPageId ?? null;
        const slideshowDurationSeconds = getConfigNumber(
            config.slideshowDuration,
            DEFAULT_SLIDESHOW_DURATION_SECONDS,
            0,
            3600
        );
        state.slideshowDurationMs =
            (slideshowDurationSeconds > 0 && slideshowDurationSeconds < 1
                ? 1
                : slideshowDurationSeconds) * 1000;
        state.transitionDurationMs = getConfigNumber(
            config.slideshowTransitionDuration,
            DEFAULT_TRANSITION_DURATION_MS,
            0,
            60000
        );
        if (state.slideshowDurationMs > 0) {
            state.transitionDurationMs = Math.min(
                state.transitionDurationMs,
                Math.max(0, state.slideshowDurationMs - 500)
            );
        }
        state.columnCount = Math.round(
            getConfigNumber(config.backgroundColumns, DEFAULT_COLUMN_COUNT, 1, 3)
        );
        const columnWidthConfig = getColumnWidthConfig(
            config.backgroundColumnWidths,
            state.columnCount
        );
        state.columnWidthMode = columnWidthConfig.mode;
        state.columnWidths = columnWidthConfig.widths;
        state.columnBlendWidth = getConfigNumber(
            config.backgroundColumnBlendWidth,
            DEFAULT_COLUMN_BLEND_WIDTH,
            0,
            800
        );
        const backgroundAdjustments = parseBackgroundAdjustments(config.backgroundAdjustments);
        state.backgroundOpacity = backgroundAdjustments.opacity;
        state.backgroundBrightness = backgroundAdjustments.brightness;
        state.backgroundSaturation = backgroundAdjustments.saturation;
        state.backgroundBlur = backgroundAdjustments.blur;
        state.forceTransparentMainBackground = getConfigBoolean(
            config.forceTransparentMainBackground,
            false
        );
        state.showViewBackgroundButton = getConfigBoolean(config.showViewBackgroundButton, true);
        state.backgroundDisplayMode = state.showViewBackgroundButton
            ? loadBackgroundDisplayMode()
            : BACKGROUND_MODE_ENABLED;
        state.reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;

        state.root.style.setProperty(
            '--background-images-slideshow-transition-duration',
            `${Math.max(0, state.transitionDurationMs) / 1000}s`
        );
        state.root.style.setProperty(
            '--background-images-slideshow-column-blend-width',
            `${Math.max(0, state.columnBlendWidth)}px`
        );
        applyThemeCompatibilityStyles();
        ensureBackgroundContainer();
        setupViewBackgroundButton();
        installHeaderObserver();
        installSceneVideoHandlers();
        applyBackgroundDisplayMode();

        if (state.entityId) {
            try {
                state.globalBackgroundImages = await getBackgroundImages();
            } catch (err) {
                console.warn('Could not load global background images.', err);
            }
        }

        installNavigationHooks();
        state.lastRouteKey = getRouteKey();

        if (state.sceneBackgroundMode !== SCENE_MODE_DISABLED || state.uniquePerformerPage) {
            await onPageNavigation();
        } else {
            setActiveBackgrounds(state.globalBackgroundImages, 'global');
        }

        setupViewBackgroundButton();
        applyBackgroundDisplayMode();
    };

    const getCurrentPerformerId = () => {
        const match = location.pathname.match(/^\/performers\/(\d+)(?:\/|$)/);
        return match ? match[1] : '';
    };

    const getCurrentSceneId = () => {
        const match = location.pathname.match(/^\/scenes\/(\d+)(?:\/|$)/);
        return match ? match[1] : '';
    };

    const getRouteKey = () => `${getCurrentSceneId()}|${getCurrentPerformerId()}`;

    const ensureBackgroundContainer = () => {
        if (state.backgroundContainer) return state.backgroundContainer;

        const existing = document.getElementById(BACKGROUND_CONTAINER_ID);
        const container = existing || document.createElement('div');
        container.id = BACKGROUND_CONTAINER_ID;
        container.setAttribute('aria-hidden', 'true');

        if (!existing) {
            state.root.prepend(container);
        }

        state.backgroundContainer = container;
        state.baseLayer = createBackgroundLayer('background-images-slideshow__layer--base');
        state.nextLayer = createBackgroundLayer('background-images-slideshow__layer--next');
        container.replaceChildren(state.baseLayer, state.nextLayer);
        return container;
    };

    const applyThemeCompatibilityStyles = () => {
        const blurPx = Math.max(0, state.backgroundBlur * MAX_BACKGROUND_BLUR_PX);
        const blurInset = Math.ceil(blurPx * 2);
        const filterValue = [
            `brightness(${state.backgroundBrightness})`,
            `saturate(${state.backgroundSaturation})`,
            `blur(${blurPx}px)`,
        ].join(' ');

        state.root.style.setProperty('--background-images-slideshow-filter', filterValue);
        state.root.style.setProperty('--background-images-slideshow-blur-inset', `${blurInset}px`);
        const shouldForceTransparentMain =
            state.forceTransparentMainBackground &&
            state.backgroundDisplayMode !== BACKGROUND_MODE_DISABLED;

        document.documentElement.classList.toggle(
            'background-images-slideshow--transparent-main',
            shouldForceTransparentMain
        );
        state.root.classList.toggle(
            'background-images-slideshow--transparent-main',
            shouldForceTransparentMain
        );
        if (state.backgroundContainer) {
            state.backgroundContainer.classList.toggle(
                'background-images-slideshow__background--backdrop',
                shouldForceTransparentMain
            );
        }
    };

    const createBackgroundLayer = (modifierClass) => {
        const layer = document.createElement('div');
        layer.className = `background-images-slideshow__layer ${modifierClass}`;
        return layer;
    };

    /** Select the scene, performer, or global source after navigation. */
    const onPageNavigation = async () => {
        const token = ++state.navigationToken;
        resetSceneVideo();
        applyBackgroundDisplayMode();
        const sceneId = state.sceneBackgroundMode !== SCENE_MODE_DISABLED ? getCurrentSceneId() : '';
        if (sceneId) {
            let paths = {};
            try {
                paths = await getSceneBackgroundPaths(sceneId);
            } catch (err) {
                console.warn('Could not load scene background media.', err);
            }
            if (token !== state.navigationToken || getCurrentSceneId() !== sceneId) return;

            let screenshot = '';
            if (paths.screenshot) {
                try {
                    await preloadImage(paths.screenshot);
                    screenshot = paths.screenshot;
                } catch (err) {
                    console.warn('Scene screenshot is unavailable; using global backgrounds.', err);
                }
            }
            if (token !== state.navigationToken || getCurrentSceneId() !== sceneId) return;

            setActiveBackgrounds(
                screenshot ? [screenshot] : state.globalBackgroundImages,
                screenshot ? `scene:${sceneId}` : 'global'
            );
            if (state.sceneBackgroundMode === SCENE_MODE_PREVIEW) {
                state.scenePreviewUrl = paths.preview || '';
            }
            applyBackgroundDisplayMode();
            return;
        }

        const performerId = getCurrentPerformerId();

        if (performerId && state.uniquePerformerPage) {
            const images = await getBackgroundImages(performerId);
            if (token !== state.navigationToken || getCurrentPerformerId() !== performerId) return;

            setActiveBackgrounds(
                images.length ? images : state.globalBackgroundImages,
                images.length ? `performer:${performerId}` : 'global'
            );
            applyBackgroundDisplayMode();
            return;
        }

        setActiveBackgrounds(state.globalBackgroundImages, 'global');
        applyBackgroundDisplayMode();
    };

    const onAppNavigation = () => {
        setupViewBackgroundButton();

        if (state.sceneBackgroundMode !== SCENE_MODE_DISABLED || state.uniquePerformerPage) {
            const routeKey = getRouteKey();
            if (routeKey !== state.lastRouteKey) {
                state.lastRouteKey = routeKey;
                void onPageNavigation();
            } else {
                applyBackgroundDisplayMode();
            }
        } else {
            applyBackgroundDisplayMode();
        }

        window.setTimeout(applyBackgroundDisplayMode, 150);
    };

    const installNavigationHooks = () => {
        const hooks = window[GLOBAL_HOOK_KEY] || {};
        window[GLOBAL_HOOK_KEY] = hooks;

        if (hooks.titleObserver) {
            hooks.titleObserver.disconnect();
        }
        if (hooks.navigationListener) {
            window.removeEventListener(NAVIGATION_EVENT, hooks.navigationListener);
        }

        const title = document.querySelector('title');
        if (title) {
            hooks.titleObserver = new MutationObserver(onAppNavigation);
            hooks.titleObserver.observe(title, {
                subtree: true,
                characterData: true,
                childList: true,
            });
        }

        if (!hooks.historyWrapped) {
            hooks.originalPushState = history.pushState;
            hooks.originalReplaceState = history.replaceState;

            history.pushState = function () {
                const result = hooks.originalPushState.apply(this, arguments);
                window.dispatchEvent(new Event(NAVIGATION_EVENT));
                return result;
            };

            history.replaceState = function () {
                const result = hooks.originalReplaceState.apply(this, arguments);
                window.dispatchEvent(new Event(NAVIGATION_EVENT));
                return result;
            };

            hooks.popstateListener = () => window.dispatchEvent(new Event(NAVIGATION_EVENT));
            window.addEventListener('popstate', hooks.popstateListener);
            hooks.historyWrapped = true;
        }

        hooks.navigationListener = onAppNavigation;
        window.addEventListener(NAVIGATION_EVENT, hooks.navigationListener);
    };

    const installHeaderObserver = () => {
        const hooks = window[GLOBAL_HOOK_KEY] || {};
        window[GLOBAL_HOOK_KEY] = hooks;
        hooks.headerObserver?.disconnect();
        hooks.headerObserver = new MutationObserver(() => {
            if (!state.showViewBackgroundButton) return;
            const parent = document.querySelector('.navbar-buttons');
            if (parent && !parent.querySelector('.background-images-slideshow__view')) {
                setupViewBackgroundButton();
            }
        });
        hooks.headerObserver.observe(state.root, { childList: true, subtree: true });
    };

    const installSceneVideoHandlers = () => {
        const hooks = window[GLOBAL_HOOK_KEY] || {};
        window[GLOBAL_HOOK_KEY] = hooks;
        hooks.sceneVideoCleanup?.();
        const onMotionChange = () => {
            if (state.reducedMotionQuery.matches) releaseSceneVideo();
            applyBackgroundDisplayMode();
        };
        document.addEventListener('visibilitychange', syncSceneVideoPlayback);
        state.reducedMotionQuery?.addEventListener?.('change', onMotionChange);
        hooks.sceneVideoCleanup = () => {
            document.removeEventListener('visibilitychange', syncSceneVideoPlayback);
            state.reducedMotionQuery?.removeEventListener?.('change', onMotionChange);
            releaseSceneVideo();
        };
    };

    const releaseSceneVideo = () => {
        const video = state.sceneVideo;
        state.sceneVideo = null;
        state.sceneVideoReady = false;
        state.scenePlayPending = false;
        state.scenePlayAttempt += 1;
        if (!video) return;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
    };

    const resetSceneVideo = () => {
        state.scenePreviewUrl = '';
        state.scenePreviewFailed = false;
        releaseSceneVideo();
    };

    const hasBackgroundSource = () =>
        state.activeImages.length > 0 ||
        (Boolean(state.scenePreviewUrl) && !state.scenePreviewFailed && !state.reducedMotionQuery?.matches);

    const syncSceneVideoPlayback = () => {
        const shouldPlay = Boolean(state.scenePreviewUrl) &&
            !state.scenePreviewFailed &&
            !state.reducedMotionQuery?.matches &&
            state.backgroundDisplayMode !== BACKGROUND_MODE_DISABLED &&
            document.visibilityState !== 'hidden';
        if (!shouldPlay) {
            if (state.sceneVideo && (!state.sceneVideo.paused || state.scenePlayPending)) {
                state.scenePlayAttempt += 1;
                state.scenePlayPending = false;
                state.sceneVideo.pause();
            }
            return;
        }

        if (!state.sceneVideo) {
            const video = document.createElement('video');
            video.className = 'background-images-slideshow__video';
            video.muted = true;
            video.defaultMuted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.setAttribute('playsinline', '');
            video.setAttribute('aria-hidden', 'true');
            const source = state.scenePreviewUrl;
            video.addEventListener('playing', () => {
                if (state.sceneVideo !== video || state.scenePreviewUrl !== source) return;
                state.sceneVideoReady = true;
                applyBackgroundDisplayMode();
            });
            video.addEventListener('error', () => {
                if (state.sceneVideo !== video) return;
                state.scenePreviewFailed = true;
                releaseSceneVideo();
                applyBackgroundDisplayMode();
            });
            state.sceneVideo = video;
            ensureBackgroundContainer().append(video);
            video.src = source;
        }

        const video = state.sceneVideo;
        if (!video.paused || state.scenePlayPending) return;
        state.scenePlayPending = true;
        const attempt = ++state.scenePlayAttempt;
        try {
            const playback = video.play();
            Promise.resolve(playback).then(() => {
                if (state.sceneVideo !== video || attempt !== state.scenePlayAttempt) return;
                state.scenePlayPending = false;
                if (video.paused) syncSceneVideoPlayback();
            }).catch(() => {
                if (state.sceneVideo !== video || attempt !== state.scenePlayAttempt) return;
                state.scenePlayPending = false;
                if (document.visibilityState === 'hidden') return;
                if (state.backgroundDisplayMode === BACKGROUND_MODE_DISABLED) return;
                state.scenePreviewFailed = true;
                releaseSceneVideo();
                applyBackgroundDisplayMode();
            });
        } catch (err) {
            state.scenePlayPending = false;
            state.scenePreviewFailed = true;
            releaseSceneVideo();
            applyBackgroundDisplayMode();
        }
    };

    const setActiveBackgrounds = (images, sourceKey) => {
        clearSlideshowTimer();
        state.activeImages = Array.isArray(images) ? images.filter(Boolean) : [];
        state.activeImageIndex = 0;
        state.activeSourceKey = sourceKey;
        updateBackgroundControlButton();

        setBackground(getColumnImages(state.activeImageIndex), true);

        if (state.slideshowDurationMs > 0 && state.activeImages.length > 1) {
            scheduleNextSlide();
        }
    };

    const scheduleNextSlide = () => {
        clearSlideshowTimer();
        state.slideshowTimer = window.setTimeout(showNextSlide, state.slideshowDurationMs);
    };

    const clearSlideshowTimer = () => {
        if (!state.slideshowTimer) return;
        window.clearTimeout(state.slideshowTimer);
        state.slideshowTimer = 0;
    };

    const showNextSlide = () => {
        if (state.slideshowDurationMs <= 0 || state.activeImages.length <= 1) return;

        const sourceKey = state.activeSourceKey;
        state.activeImageIndex = (state.activeImageIndex + state.columnCount) % state.activeImages.length;
        setBackground(getColumnImages(state.activeImageIndex)).finally(() => {
            if (sourceKey === state.activeSourceKey) scheduleNextSlide();
        });
    };

    const getColumnImages = (startIndex) => {
        if (!state.activeImages.length) return [];

        return Array.from({ length: state.columnCount }, (_, index) => {
            const imageIndex = (startIndex + index) % state.activeImages.length;
            return state.activeImages[imageIndex] || null;
        });
    };

    const preloadImage = (url) =>
        new Promise((resolve, reject) => {
            if (!url) {
                resolve(null);
                return;
            }

            const image = new Image();
            image.onload = async () => {
                try {
                    if (image.decode) await image.decode();
                } catch (err) {
                    // Decode failures can happen for cached/cross-origin images; loaded is enough.
                }
                const ratio =
                    image.naturalWidth && image.naturalHeight
                        ? image.naturalWidth / image.naturalHeight
                        : 1;
                state.imageAspectRatios.set(url, ratio);
                resolve(ratio);
            };
            image.onerror = reject;
            image.src = url;
        });

    const preloadImages = (images) =>
        Promise.all((images || []).filter(Boolean).map(preloadImage));

    const normalizeBackgroundImages = (images) => {
        const values = Array.isArray(images) ? images : [images];
        const filtered = values.filter(Boolean);
        if (!filtered.length) return [];

        return Array.from({ length: state.columnCount }, (_, index) => {
            return filtered[index % filtered.length];
        });
    };

    const getBackgroundImageValue = (image) => `url(${image || ''})`;

    const sameBackgroundImages = (a, b) => {
        if (a.length !== b.length) return false;
        return a.every((image, index) => image === b[index]);
    };

    const getTargetOpacity = () => {
        if (state.backgroundDisplayMode === BACKGROUND_MODE_VIEWING) return 1;
        if (state.backgroundDisplayMode === BACKGROUND_MODE_DISABLED) return 0;
        return state.backgroundOpacity;
    };

    const getImageTargetOpacity = () => state.sceneVideoReady ? 0 : getTargetOpacity();

    const normalizeWidths = (widths) => {
        const total = widths.reduce((sum, width) => sum + width, 0);
        if (!Number.isFinite(total) || total <= 0) {
            return getEqualColumnWidths(widths.length || state.columnCount);
        }
        return widths.map((width) => (width / total) * 100);
    };

    const getAutoColumnWidths = (images) => {
        const weights = (images || []).map((image) => {
            const ratio = state.imageAspectRatios.get(image) || 1;
            return Math.min(AUTO_COLUMN_MAX_WIDTH, Math.max(AUTO_COLUMN_MIN_WIDTH, ratio * 35));
        });

        return normalizeWidths(weights.length ? weights : getEqualColumnWidths(state.columnCount));
    };

    const getRenderColumnWidths = (images) => {
        if (state.columnWidthMode === COLUMN_WIDTH_MODE_AUTO) {
            return getAutoColumnWidths(images);
        }
        return state.columnWidths.length === state.columnCount
            ? state.columnWidths
            : getEqualColumnWidths(state.columnCount);
    };

    const renderLayer = (layer, images) => {
        if (!layer) return;

        const count = Math.max(1, state.columnCount);
        const widths = getRenderColumnWidths(images);
        const columns = [];

        for (let index = count - 1; index >= 0; index -= 1) {
            const column = document.createElement('div');
            column.className = 'background-images-slideshow__column';
            if (index < count - 1 && state.columnBlendWidth > 0) {
                column.classList.add('background-images-slideshow__column--fade-right');
            }

            const columnLeft = widths.slice(0, index).reduce((sum, width) => sum + width, 0);
            const widthPercent = widths[index];
            column.style.left =
                index === 0
                    ? '0'
                    : `calc(${columnLeft}% - ${state.columnBlendWidth}px)`;
            column.style.width =
                index === 0 || state.columnBlendWidth <= 0
                    ? `${widthPercent}%`
                    : `calc(${widthPercent}% + ${state.columnBlendWidth}px)`;
            column.style.backgroundImage = getBackgroundImageValue(images[index]);
            columns.push(column);
        }

        layer.replaceChildren(...columns);
    };

    /**
     * Set the background image columns by crossfading CSS background layers.
     * @param {string[]|string|null} images
     * @param {boolean} skipTransition
     */
    const setBackground = async (images, skipTransition = false) => {
        if (!state.root) return;
        ensureBackgroundContainer();

        const transitionToken = ++state.transitionToken;
        if (skipTransition && state.transitionTimer) {
            window.clearTimeout(state.transitionTimer);
            state.transitionTimer = 0;
        }
        const nextImages = normalizeBackgroundImages(images);
        const currentImages = state.currentBackgroundImages.length
            ? state.currentBackgroundImages
            : nextImages;

        if (state.columnWidthMode === COLUMN_WIDTH_MODE_AUTO) {
            try {
                await preloadImages(nextImages);
            } catch (err) {
                return;
            }
            if (transitionToken !== state.transitionToken) return;
        }

        if (
            skipTransition ||
            !state.transitionDurationMs ||
            !currentImages.length ||
            sameBackgroundImages(currentImages, nextImages)
        ) {
            renderLayer(state.baseLayer, nextImages);
            renderLayer(state.nextLayer, nextImages);
            state.baseLayer.style.opacity = getImageTargetOpacity();
            state.nextLayer.style.opacity = 0;
            state.currentBackgroundImages = nextImages;
            return;
        }

        if (state.columnWidthMode !== COLUMN_WIDTH_MODE_AUTO) {
            try {
                await preloadImages(nextImages);
            } catch (err) {
                return;
            }
            if (transitionToken !== state.transitionToken) return;
        }

        if (state.transitionTimer) {
            window.clearTimeout(state.transitionTimer);
            state.transitionTimer = 0;
        }

        renderLayer(state.baseLayer, currentImages);
        renderLayer(state.nextLayer, nextImages);
        state.baseLayer.style.opacity = getImageTargetOpacity();
        state.nextLayer.style.opacity = 0;

        requestAnimationFrame(() => {
            if (transitionToken !== state.transitionToken) return;
            requestAnimationFrame(() => {
                if (transitionToken !== state.transitionToken) return;
                state.baseLayer.style.opacity = 0;
                state.nextLayer.style.opacity = getImageTargetOpacity();
            });
        });

        state.transitionTimer = window.setTimeout(() => {
            if (transitionToken !== state.transitionToken) return;
            renderLayer(state.baseLayer, nextImages);
            renderLayer(state.nextLayer, nextImages);
            state.baseLayer.style.opacity = getImageTargetOpacity();
            state.nextLayer.style.opacity = 0;
            state.currentBackgroundImages = nextImages;
            state.transitionTimer = 0;
        }, state.transitionDurationMs);
    };

    /** Keep the control attached when Stash replaces the header during navigation. */
    const setupViewBackgroundButton = () => {
        if (!state.showViewBackgroundButton) {
            setBackgroundDisplayMode(BACKGROUND_MODE_ENABLED, { persist: true });
            document.querySelector('.background-images-slideshow__view')?.remove();
            return;
        }

        const parentNode = document.querySelector('.navbar-buttons');
        if (!parentNode) return;
        let node = document.querySelector('.background-images-slideshow__view');
        if (!node) {
            node = document.createElement('button');
            node.type = 'button';
            node.className = 'nav-utility btn minimal background-images-slideshow__view';
            node.addEventListener('click', cycleBackgroundDisplayMode);
        }
        if (node.parentElement !== parentNode) parentNode.append(node);
        updateBackgroundControlButton(node);
    };

    const getBackgroundControlMeta = () => {
        if (state.backgroundDisplayMode === BACKGROUND_MODE_VIEWING) {
            return {
                icon: '<i class="fa-solid fa-arrows-to-eye"></i>',
                title: 'Showing background only. Click to disable the background.',
            };
        }

        if (state.backgroundDisplayMode === BACKGROUND_MODE_DISABLED) {
            return {
                icon: '<i class="fa-regular fa-eye-slash"></i>',
                title: 'Background disabled. Click to enable the background.',
            };
        }

        return {
            icon: '<i class="fa-regular fa-eye"></i>',
            title: 'Background enabled. Click to show only the background.',
        };
    };

    const updateBackgroundControlButton = (node = document.querySelector('.background-images-slideshow__view')) => {
        if (!node) return;
        const meta = getBackgroundControlMeta();
        node.innerHTML = meta.icon;
        const title = hasBackgroundSource() ? meta.title : 'No background is available on this page.';
        node.title = title;
        node.setAttribute('aria-label', title);
        node.dataset.backgroundMode = state.backgroundDisplayMode;
        node.disabled = !hasBackgroundSource();
    };

    const cycleBackgroundDisplayMode = () => {
        if (!hasBackgroundSource()) return;
        if (state.backgroundDisplayMode === BACKGROUND_MODE_ENABLED) {
            setBackgroundDisplayMode(BACKGROUND_MODE_VIEWING, { persist: true });
            return;
        }

        if (state.backgroundDisplayMode === BACKGROUND_MODE_VIEWING) {
            setBackgroundDisplayMode(BACKGROUND_MODE_DISABLED, { persist: true });
            return;
        }

        setBackgroundDisplayMode(BACKGROUND_MODE_ENABLED, { persist: true });
    };

    const setBackgroundDisplayMode = (mode, options = {}) => {
        if (!validBackgroundModes.has(mode)) return;
        state.backgroundDisplayMode = mode;
        if (options.persist) saveBackgroundDisplayMode(mode);
        applyBackgroundDisplayMode();
    };

    const applyBackgroundDisplayMode = () => {
        const targetOpacity = getTargetOpacity();
        const imageOpacity = getImageTargetOpacity();

        applyThemeCompatibilityStyles();

        if (state.backgroundDisplayMode === BACKGROUND_MODE_VIEWING &&
            (state.activeImages.length || state.sceneVideoReady)) {
            document.documentElement.classList.add('background-images-slideshow--viewing');
            document.addEventListener('keydown', escapeListener);
        } else {
            document.documentElement.classList.remove('background-images-slideshow--viewing');
            document.removeEventListener('keydown', escapeListener);
        }

        if (state.baseLayer) state.baseLayer.style.opacity = imageOpacity;
        if (state.nextLayer && state.transitionTimer) state.nextLayer.style.opacity = imageOpacity;
        if (state.sceneVideo) state.sceneVideo.style.opacity = state.sceneVideoReady ? targetOpacity : 0;
        syncSceneVideoPlayback();
        updateBackgroundControlButton();
    };

    const escapeListener = (e) => {
        if (e.key === 'Escape') {
            setBackgroundDisplayMode(BACKGROUND_MODE_ENABLED, { persist: true });
        }
    };

    const makeRequest = async (request) => {
        const response = await fetch(`${window.location.origin}/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            redirect: 'follow',
            body: JSON.stringify(request)
        });

        return response.json();
    };

    const getBackgroundImages = async (performerId) => {
        const sourceId = performerId ? state.performerEntityId ?? state.entityId : state.entityId;
        if (!sourceId) return [];
        const images = await makeRequest(
            imageRequest(
                performerId,
                state.slideshowDurationMs > 0 ? SLIDESHOW_IMAGE_LIMIT : state.columnCount
            )
        );
        return (images?.data?.findImages?.images || [])
            .map((image) => image?.paths?.image)
            .filter(Boolean);
    };

    const getSceneBackgroundPaths = async (sceneId) => {
        const result = await makeRequest({
            operationName: 'BackgroundScenePaths',
            query: `query BackgroundScenePaths($id: ID!) {
                findScene(id: $id) { paths { screenshot preview } }
            }`,
            variables: { id: sceneId },
        });
        return result?.data?.findScene?.paths || {};
    };

    const configRequest = {
        operationName: 'Configuration',
        variables: {},
        query: `
        query Configuration {
          configuration {
            plugins
          }
        }`,
    };

    const imageRequest = (performerId, perPage = 1) => {
        const query = `
        query FindImages($filter: FindFilterType, $image_filter: ImageFilterType) {
          findImages(filter: $filter, image_filter: $image_filter) {
            images {
              id
              paths {
                thumbnail
                image
              }
            }
          }
        }
      `;

        let isGalleryMode = state.galleryMode;
        let entityId = state.entityId;

        // If performerId is given, tailor the query to use performer mode options.
        if (performerId) {
            isGalleryMode = state.performerGalleryMode;
            entityId = state.performerEntityId ?? state.entityId;
        }

        const request = {
            operationName: 'FindImages',
            query,
            variables: {
                filter: {
                    direction: 'ASC',
                    page: 1,
                    per_page: perPage,
                    sort: 'random'
                },
                image_filter: {
                    [isGalleryMode ? 'galleries' : 'tags']: {
                        value: [entityId],
                        modifier: 'INCLUDES_ALL',
                    }
                }
            }
        };

        if (performerId) {
            request.variables.image_filter.performers = {
                value: [performerId],
                excludes: [],
                modifier: 'INCLUDES_ALL'
            };
        }

        return request;
    };

    main();
})();
