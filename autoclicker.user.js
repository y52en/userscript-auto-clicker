// ==UserScript==
// @name         Auto Clicker
// @name:ja      オートクリッカー
// @namespace    https://github.com/y52en/userscript-auto-clicker
// @version      0.7.0
// @description  Movable, minimizable multi-point auto clicker with a configurable cycle interval.
// @description:ja 移動・最小化できる、複数位置対応のオートクリッカーです。一周間隔を設定できます。
// @author       y52en
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @license      MIT
// @homepageURL  https://github.com/y52en/userscript-auto-clicker
// @supportURL   https://github.com/y52en/userscript-auto-clicker/issues
// ==/UserScript==

(() => {
    'use strict';

    if (window.top !== window.self) return;
    if (document.getElementById('usc-autoclicker-panel')) return;

    const STORAGE_KEY = 'ios-web-unity-autoclicker-v6';
    const LEGACY_STORAGE_KEYS = [
        'ios-web-unity-autoclicker-v5',
        'ios-web-unity-autoclicker-v4',
        'ios-web-unity-autoclicker-v3',
        'ios-web-autoclicker-v2',
    ];
    const LANGUAGE_KEY = 'language';
    const MIN_INTERVAL = 50;
    const PRESS_DURATION = 6;
    const MIN_POINT_SLOT = 16;

    const MESSAGES = {
        en: {
            title: 'Auto Clicker',
            add: 'Add position',
            start: 'Start',
            stop: 'Stop',
            deleteLast: 'Delete last position',
            clear: 'Clear all positions',
            intervalLabel: min => `Cycle interval per point (${min} ms or more)`,
            minimize: 'Minimize',
            restore: 'Restore',
            stopped: 'Stopped',
            selecting: 'Selecting position',
            running: 'Running',
            invalidIntervalShort: min => `Enter ${min} or more`,
            effective: (cycle, slot) => `${cycle} ms (approx. ${slot} ms between points)`,
            status: ({ mode, count, configured, effective }) =>
                `Status: ${mode}\n` +
                `Positions: ${count}\n` +
                `Configured cycle: ${configured}\n` +
                `Actual cycle: ${effective}`,
            selectionMessage: 'Tap the position to add',
            noPoints: 'Add at least one click position.',
            invalidInterval: min => `Enter an interval of ${min} ms or more.`,
            loadFailed: key => `[AutoClicker] Failed to load settings from ${key}.`,
            saveFailed: '[AutoClicker] Failed to save settings.',
        },
        ja: {
            title: 'オートクリッカー',
            add: '位置を追加',
            start: '開始',
            stop: '停止',
            deleteLast: '最後の位置を削除',
            clear: '位置を全削除',
            intervalLabel: min => `各地点の一周間隔（${min}ms以上）`,
            minimize: '最小化',
            restore: '復元',
            stopped: '停止中',
            selecting: '位置選択中',
            running: '実行中',
            invalidIntervalShort: min => `${min}以上を入力`,
            effective: (cycle, slot) => `${cycle}ms（地点間 約${slot}ms）`,
            status: ({ mode, count, configured, effective }) =>
                `状態: ${mode}\n` +
                `登録位置: ${count}\n` +
                `設定した一周間隔: ${configured}\n` +
                `実際の一周周期: ${effective}`,
            selectionMessage: '登録したい位置をタップ',
            noPoints: 'クリック位置を1つ以上登録してください。',
            invalidInterval: min => `間隔を${min}以上で入力してください。`,
            loadFailed: key => `[AutoClicker] ${key}の読み込みに失敗しました。`,
            saveFailed: '[AutoClicker] 設定の保存に失敗しました。',
        },
    };

    function detectDefaultLanguage() {
        const locale = navigator.languages?.[0] || navigator.language || '';
        return /^ja(?:-|$)/i.test(locale) ? 'ja' : 'en';
    }

    let language = GM_getValue(LANGUAGE_KEY, detectDefaultLanguage());
    if (language !== 'ja' && language !== 'en') language = detectDefaultLanguage();

    function t(key, ...args) {
        const value = MESSAGES[language][key];
        return typeof value === 'function' ? value(...args) : value;
    }

    function setLanguage(nextLanguage) {
        if (nextLanguage !== 'ja' && nextLanguage !== 'en') return;
        language = nextLanguage;
        GM_setValue(LANGUAGE_KEY, language);
        updateUI();
    }

    GM_registerMenuCommand('Language: English', () => setLanguage('en'));
    GM_registerMenuCommand('言語: 日本語', () => setLanguage('ja'));

    const saved = loadSavedState();
    const state = {
        points: normalizeSavedPoints(saved.points),
        running: false,
        selecting: false,
        minimized: Boolean(saved.minimized),
        interval: parseValidInterval(saved.interval) ?? 500,
        queueTimer: null,
        queueIndex: 0,
        nextQueueRunAt: 0,
        releaseTimers: new Set(),
        panelX: Number.isFinite(saved.panelX) ? saved.panelX : null,
        panelY: Number.isFinite(saved.panelY) ? saved.panelY : null,
        nextPointerId: 1000000,
        selectionLayer: null,
        runningShield: null,
        blockCompatibilityClickUntil: 0,
    };

    function loadSavedState() {
        for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
            try {
                const text = localStorage.getItem(key);
                if (!text) continue;
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (error) {
                console.warn(t('loadFailed', key), error);
            }
        }
        return {};
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                points: state.points,
                interval: state.interval,
                minimized: state.minimized,
                panelX: state.panelX,
                panelY: state.panelY,
            }));
        } catch (error) {
            console.warn(t('saveFailed'), error);
        }
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function parseValidInterval(value) {
        const text = String(value ?? '').trim();
        if (!/^\d+$/.test(text)) return null;
        const parsed = Number(text);
        if (!Number.isSafeInteger(parsed) || parsed < MIN_INTERVAL) return null;
        return parsed;
    }

    function normalizeSavedPoints(points) {
        if (!Array.isArray(points)) return [];
        return points.map(point => {
            if (!point || typeof point !== 'object') return null;
            if (
                point.kind === 'canvas' &&
                Number.isFinite(point.normalizedX) &&
                Number.isFinite(point.normalizedY)
            ) {
                return {
                    kind: 'canvas',
                    canvasIndex: Number.isInteger(point.canvasIndex) ? point.canvasIndex : 0,
                    canvasId: typeof point.canvasId === 'string' ? point.canvasId : '',
                    normalizedX: clamp(point.normalizedX, 0, 1),
                    normalizedY: clamp(point.normalizedY, 0, 1),
                    fallbackX: Number.isFinite(point.fallbackX) ? point.fallbackX : 0,
                    fallbackY: Number.isFinite(point.fallbackY) ? point.fallbackY : 0,
                };
            }
            if (
                (point.kind === 'screen' || point.kind === undefined) &&
                Number.isFinite(point.x) &&
                Number.isFinite(point.y)
            ) {
                return { kind: 'screen', x: point.x, y: point.y };
            }
            return null;
        }).filter(Boolean);
    }

    const style = document.createElement('style');
    style.textContent = `
        #usc-autoclicker-panel,
        #usc-autoclicker-panel *,
        #usc-autoclicker-markers,
        #usc-autoclicker-markers *,
        #usc-autoclicker-selection-layer,
        #usc-autoclicker-selection-layer *,
        #usc-autoclicker-running-shield { box-sizing: border-box; }

        #usc-autoclicker-panel {
            position: fixed;
            z-index: 2147483647;
            width: 225px;
            max-width: calc(100vw - 16px);
            border: 1px solid rgba(255,255,255,.16);
            border-radius: 14px;
            overflow: hidden;
            background: rgba(24,24,27,.94);
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
            font-size: 13px;
            line-height: 1.4;
            box-shadow: 0 10px 35px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.3);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        #usc-autoclicker-panel.is-minimized { width: 160px; }
        #usc-autoclicker-header {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 42px;
            padding: 6px 7px 6px 12px;
            background: rgba(255,255,255,.08);
            cursor: grab;
            touch-action: none;
        }
        #usc-autoclicker-header.is-dragging { cursor: grabbing; }
        #usc-autoclicker-title {
            flex: 1;
            min-width: 0;
            font-weight: 700;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            pointer-events: none;
        }
        #usc-autoclicker-minimize {
            flex: 0 0 30px;
            width: 30px;
            height: 30px;
            padding: 0;
            border: 0;
            border-radius: 8px;
            appearance: none;
            -webkit-appearance: none;
            background: rgba(255,255,255,.14);
            color: #fff;
            font-size: 20px;
            line-height: 30px;
            touch-action: manipulation;
        }
        #usc-autoclicker-minimize:active { background: rgba(255,255,255,.28); }
        #usc-autoclicker-body { padding: 10px; }
        #usc-autoclicker-panel.is-minimized #usc-autoclicker-body { display: none; }
        #usc-autoclicker-panel .usc-action-button {
            display: block;
            width: 100%;
            min-height: 39px;
            margin: 5px 0;
            padding: 8px 10px;
            border: 0;
            border-radius: 9px;
            appearance: none;
            -webkit-appearance: none;
            background: #f2f2f2;
            color: #111;
            font: inherit;
            font-weight: 650;
            touch-action: manipulation;
        }
        #usc-autoclicker-panel .usc-action-button:active { transform: scale(.98); }
        #usc-autoclicker-panel .usc-start-button { background: #59d77d; }
        #usc-autoclicker-panel .usc-stop-button { background: #ffca57; }
        #usc-autoclicker-panel .usc-delete-button { background: #ff9a5b; }
        #usc-autoclicker-panel .usc-clear-button { background: #ff7474; }
        #usc-autoclicker-interval-label {
            display: block;
            margin-top: 10px;
            margin-bottom: 4px;
            color: rgba(255,255,255,.84);
        }
        #usc-autoclicker-interval {
            display: block;
            width: 100%;
            height: 39px;
            padding: 7px 9px;
            border: 1px solid rgba(255,255,255,.28);
            border-radius: 8px;
            appearance: none;
            -webkit-appearance: none;
            background: rgba(255,255,255,.12);
            color: #fff;
            font-size: 16px;
            user-select: text;
            -webkit-user-select: text;
            touch-action: manipulation;
        }
        #usc-autoclicker-interval.is-invalid {
            border-color: #ff7373;
            background: rgba(255,70,70,.18);
        }
        #usc-autoclicker-status {
            margin-top: 9px;
            padding: 7px 8px;
            border-radius: 8px;
            background: rgba(255,255,255,.08);
            color: rgba(255,255,255,.9);
            font-size: 12px;
            white-space: pre-line;
        }
        #usc-autoclicker-markers {
            position: fixed;
            inset: 0;
            z-index: 2147483645;
            pointer-events: none;
        }
        .usc-autoclicker-marker {
            position: fixed;
            width: 34px;
            height: 34px;
            margin-left: -17px;
            margin-top: -17px;
            border: 2px solid #ff3b30;
            border-radius: 50%;
            background: rgba(255,59,48,.22);
            color: #fff;
            font: bold 12px/30px -apple-system, BlinkMacSystemFont, sans-serif;
            text-align: center;
            text-shadow: 0 1px 2px #000, 0 0 3px #000;
            pointer-events: none;
        }
        .usc-autoclicker-marker::before,
        .usc-autoclicker-marker::after {
            content: "";
            position: absolute;
            left: 50%;
            top: 50%;
            background: #ff3b30;
            transform: translate(-50%,-50%);
        }
        .usc-autoclicker-marker::before { width: 10px; height: 1px; }
        .usc-autoclicker-marker::after { width: 1px; height: 10px; }
        #usc-autoclicker-selection-layer {
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            background: rgba(0,0,0,.08);
            cursor: crosshair;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        #usc-autoclicker-selection-message {
            position: fixed;
            left: 50%;
            top: max(18px, env(safe-area-inset-top));
            transform: translateX(-50%);
            padding: 9px 14px;
            border-radius: 999px;
            background: rgba(0,0,0,.82);
            color: #fff;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
        }
        #usc-autoclicker-running-shield {
            position: fixed;
            inset: 0;
            z-index: 2147483644;
            background: transparent;
            pointer-events: auto;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
    `;
    document.documentElement.appendChild(style);

    const markerLayer = document.createElement('div');
    markerLayer.id = 'usc-autoclicker-markers';
    document.documentElement.appendChild(markerLayer);

    const panel = document.createElement('div');
    panel.id = 'usc-autoclicker-panel';
    panel.innerHTML = `
        <div id="usc-autoclicker-header">
            <div id="usc-autoclicker-title"></div>
            <button id="usc-autoclicker-minimize" type="button">−</button>
        </div>
        <div id="usc-autoclicker-body">
            <button class="usc-action-button" type="button" data-action="add"></button>
            <button class="usc-action-button usc-start-button" type="button" data-action="start"></button>
            <button class="usc-action-button usc-stop-button" type="button" data-action="stop"></button>
            <button class="usc-action-button usc-delete-button" type="button" data-action="delete-last"></button>
            <button class="usc-action-button usc-clear-button" type="button" data-action="clear"></button>
            <label id="usc-autoclicker-interval-label" for="usc-autoclicker-interval"></label>
            <input
                id="usc-autoclicker-interval"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                enterkeyhint="done"
                value="${String(state.interval)}"
            >
            <div id="usc-autoclicker-status"></div>
        </div>
    `;
    document.documentElement.appendChild(panel);

    const header = panel.querySelector('#usc-autoclicker-header');
    const titleElement = panel.querySelector('#usc-autoclicker-title');
    const minimizeButton = panel.querySelector('#usc-autoclicker-minimize');
    const intervalLabel = panel.querySelector('#usc-autoclicker-interval-label');
    const intervalInput = panel.querySelector('#usc-autoclicker-interval');
    const statusElement = panel.querySelector('#usc-autoclicker-status');
    const addButton = panel.querySelector('[data-action="add"]');
    const startButton = panel.querySelector('[data-action="start"]');
    const stopButton = panel.querySelector('[data-action="stop"]');
    const deleteButton = panel.querySelector('[data-action="delete-last"]');
    const clearButton = panel.querySelector('[data-action="clear"]');

    function initializePanelPosition() {
        const defaultX = Math.max(8, window.innerWidth - panel.offsetWidth - 12);
        setPanelPosition(state.panelX ?? defaultX, state.panelY ?? 12);
    }

    function setPanelPosition(x, y) {
        const width = panel.offsetWidth || 225;
        const height = panel.offsetHeight || 42;
        state.panelX = clamp(x, 0, Math.max(0, window.innerWidth - width));
        state.panelY = clamp(y, 0, Math.max(0, window.innerHeight - height));
        panel.style.left = `${state.panelX}px`;
        panel.style.top = `${state.panelY}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    function getPointSlotInterval() {
        const pointCount = Math.max(1, state.points.length);
        return Math.max(MIN_POINT_SLOT, state.interval / pointCount);
    }

    function getEffectiveCycleInterval() {
        return getPointSlotInterval() * Math.max(1, state.points.length);
    }

    function updateTranslations() {
        titleElement.textContent = t('title');
        addButton.textContent = t('add');
        startButton.textContent = t('start');
        stopButton.textContent = t('stop');
        deleteButton.textContent = t('deleteLast');
        clearButton.textContent = t('clear');
        intervalLabel.textContent = t('intervalLabel', MIN_INTERVAL);
        minimizeButton.setAttribute('aria-label', state.minimized ? t('restore') : t('minimize'));
        const selectionMessage = state.selectionLayer?.querySelector('#usc-autoclicker-selection-message');
        if (selectionMessage) selectionMessage.textContent = t('selectionMessage');
    }

    function updateStatus() {
        const enteredInterval = parseValidInterval(intervalInput.value);
        intervalInput.classList.toggle('is-invalid', enteredInterval === null);

        let mode = t('stopped');
        if (state.selecting) mode = t('selecting');
        else if (state.running) mode = t('running');

        const configured = enteredInterval === null
            ? t('invalidIntervalShort', MIN_INTERVAL)
            : `${enteredInterval}ms`;

        let effective = '-';
        if (enteredInterval !== null && state.points.length > 0) {
            const originalInterval = state.interval;
            state.interval = enteredInterval;
            effective = t(
                'effective',
                Math.round(getEffectiveCycleInterval()),
                Math.round(getPointSlotInterval())
            );
            state.interval = originalInterval;
        }

        statusElement.textContent = t('status', {
            mode,
            count: state.points.length,
            configured,
            effective,
        });
    }

    function updateUI() {
        panel.classList.toggle('is-minimized', state.minimized);
        minimizeButton.textContent = state.minimized ? '＋' : '−';
        updateTranslations();
        renderMarkers();
        updateStatus();
    }

    function renderMarkers() {
        markerLayer.replaceChildren();
        state.points.forEach((point, index) => {
            const resolved = resolveRegisteredPoint(point);
            if (!resolved) return;
            const marker = document.createElement('div');
            marker.className = 'usc-autoclicker-marker';
            marker.style.left = `${resolved.x}px`;
            marker.style.top = `${resolved.y}px`;
            marker.textContent = String(index + 1);
            markerLayer.appendChild(marker);
        });
    }

    let dragState = null;
    header.addEventListener('pointerdown', event => {
        if (event.target.closest('button, input')) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = panel.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
        };
        header.classList.add('is-dragging');
        try { header.setPointerCapture(event.pointerId); } catch {}
    });

    header.addEventListener('pointermove', event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        setPanelPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
    });

    function finishPanelDrag(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        header.classList.remove('is-dragging');
        try { header.releasePointerCapture(event.pointerId); } catch {}
        dragState = null;
        saveState();
    }
    header.addEventListener('pointerup', finishPanelDrag);
    header.addEventListener('pointercancel', finishPanelDrag);

    minimizeButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        state.minimized = !state.minimized;
        updateUI();
        requestAnimationFrame(() => {
            setPanelPosition(state.panelX, state.panelY);
            saveState();
        });
    });

    intervalInput.addEventListener('pointerdown', event => event.stopPropagation());
    intervalInput.addEventListener('click', event => event.stopPropagation());
    intervalInput.addEventListener('input', () => {
        const originalValue = intervalInput.value;
        const selectionStart = intervalInput.selectionStart;
        const cleanedValue = originalValue.replace(/[^\d]/g, '');
        if (cleanedValue !== originalValue) {
            intervalInput.value = cleanedValue;
            if (selectionStart !== null) {
                const removedBeforeCursor = originalValue
                    .slice(0, selectionStart)
                    .replace(/\d/g, '')
                    .length;
                const nextCursor = Math.max(0, selectionStart - removedBeforeCursor);
                intervalInput.setSelectionRange(nextCursor, nextCursor);
            }
        }
        const validInterval = parseValidInterval(intervalInput.value);
        if (validInterval !== null) {
            state.interval = validInterval;
            saveState();
            if (state.running) restartQueue();
        }
        updateStatus();
    });

    intervalInput.addEventListener('blur', () => {
        const validInterval = parseValidInterval(intervalInput.value);
        if (validInterval === null) {
            intervalInput.value = String(state.interval);
        } else {
            state.interval = validInterval;
            saveState();
            if (state.running) restartQueue();
        }
        updateStatus();
    });

    intervalInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') intervalInput.blur();
    });

    function getRealElementAtPoint(x, y) {
        const hiddenElements = [
            panel,
            markerLayer,
            state.selectionLayer,
            state.runningShield,
        ].filter(Boolean);
        const previousStates = hiddenElements.map(element => ({
            element,
            visibility: element.style.visibility,
        }));
        for (const item of previousStates) item.element.style.visibility = 'hidden';
        const target = document.elementFromPoint(x, y);
        for (const item of previousStates) item.element.style.visibility = item.visibility;
        return target;
    }

    function createRegisteredPoint(x, y) {
        const target = getRealElementAtPoint(x, y);
        const canvas = target instanceof HTMLCanvasElement
            ? target
            : target instanceof Element
                ? target.closest('canvas')
                : null;

        if (canvas instanceof HTMLCanvasElement) {
            const rect = canvas.getBoundingClientRect();
            const canvases = Array.from(document.querySelectorAll('canvas'));
            return {
                kind: 'canvas',
                canvasIndex: canvases.indexOf(canvas),
                canvasId: canvas.id || '',
                normalizedX: rect.width > 0 ? clamp((x - rect.left) / rect.width, 0, 1) : 0,
                normalizedY: rect.height > 0 ? clamp((y - rect.top) / rect.height, 0, 1) : 0,
                fallbackX: x,
                fallbackY: y,
            };
        }
        return { kind: 'screen', x, y };
    }

    function findRegisteredCanvas(point) {
        if (point.canvasId) {
            const canvas = document.getElementById(point.canvasId);
            if (canvas instanceof HTMLCanvasElement) return canvas;
        }
        const canvases = document.querySelectorAll('canvas');
        const indexedCanvas = canvases[point.canvasIndex];
        if (indexedCanvas instanceof HTMLCanvasElement) return indexedCanvas;
        if (canvases.length === 1 && canvases[0] instanceof HTMLCanvasElement) return canvases[0];
        return null;
    }

    function resolveRegisteredPoint(point) {
        if (!point) return null;
        if (point.kind === 'canvas') {
            const canvas = findRegisteredCanvas(point);
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                return {
                    target: canvas,
                    x: rect.left + rect.width * point.normalizedX,
                    y: rect.top + rect.height * point.normalizedY,
                };
            }
            return {
                target: getRealElementAtPoint(point.fallbackX, point.fallbackY),
                x: point.fallbackX,
                y: point.fallbackY,
            };
        }
        if (point.kind === 'screen') {
            return {
                target: getRealElementAtPoint(point.x, point.y),
                x: point.x,
                y: point.y,
            };
        }
        return null;
    }

    function beginSelection() {
        stop();
        if (state.selecting) return;
        state.selecting = true;

        const layer = document.createElement('div');
        layer.id = 'usc-autoclicker-selection-layer';
        const message = document.createElement('div');
        message.id = 'usc-autoclicker-selection-message';
        message.textContent = t('selectionMessage');
        layer.appendChild(message);
        document.documentElement.appendChild(layer);
        state.selectionLayer = layer;

        let selected = null;
        let selectedPointerId = null;
        const block = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };

        layer.addEventListener('pointerdown', event => {
            block(event);
            selectedPointerId = event.pointerId;
            selected = { x: event.clientX, y: event.clientY };
            try { layer.setPointerCapture(event.pointerId); } catch {}
        }, true);
        layer.addEventListener('pointermove', block, true);
        layer.addEventListener('pointerup', event => {
            block(event);
            if (selectedPointerId !== null && event.pointerId !== selectedPointerId) return;
            const point = selected || { x: event.clientX, y: event.clientY };
            layer.style.visibility = 'hidden';
            state.points.push(createRegisteredPoint(point.x, point.y));
            layer.remove();
            state.selectionLayer = null;
            state.selecting = false;
            state.blockCompatibilityClickUntil = performance.now() + 500;
            saveState();
            updateUI();
        }, true);
        layer.addEventListener('pointercancel', event => {
            block(event);
            layer.remove();
            state.selectionLayer = null;
            state.selecting = false;
            updateUI();
        }, true);

        for (const eventName of [
            'touchstart', 'touchmove', 'touchend', 'touchcancel',
            'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu',
        ]) {
            layer.addEventListener(eventName, block, { capture: true, passive: false });
        }
        updateStatus();
    }

    document.addEventListener('click', event => {
        if (performance.now() >= state.blockCompatibilityClickUntil) return;
        if (panel.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }, true);

    function createRunningShield() {
        removeRunningShield();
        const shield = document.createElement('div');
        shield.id = 'usc-autoclicker-running-shield';
        const block = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };
        for (const eventName of [
            'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
            'touchstart', 'touchmove', 'touchend', 'touchcancel',
            'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu',
        ]) {
            shield.addEventListener(eventName, block, { capture: true, passive: false });
        }
        document.documentElement.appendChild(shield);
        state.runningShield = shield;
    }

    function removeRunningShield() {
        if (!state.runningShield) return;
        state.runningShield.remove();
        state.runningShield = null;
    }

    function prepareRegisteredCanvases() {
        let firstCanvas = null;
        for (const point of state.points) {
            if (point.kind !== 'canvas') continue;
            const canvas = findRegisteredCanvas(point);
            if (!canvas) continue;
            if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
            if (!firstCanvas) firstCanvas = canvas;
        }
        if (firstCanvas) {
            try { firstCanvas.focus({ preventScroll: true }); }
            catch {
                try { firstCanvas.focus(); } catch {}
            }
        }
    }

    function dispatchPointer(target, type, x, y, pointerId, pressed) {
        if (typeof PointerEvent !== 'function') return;
        target.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: type === 'pointermove' ? -1 : 0,
            buttons: pressed ? 1 : 0,
            pressure: pressed ? 0.5 : 0,
            width: 1,
            height: 1,
        }));
    }

    function dispatchMouse(target, type, x, y, pressed) {
        target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: pressed ? 1 : 0,
            detail: type === 'click' ? 1 : 0,
        }));
    }

    function emulateTap(point) {
        const resolved = resolveRegisteredPoint(point);
        if (!resolved || !(resolved.target instanceof Element)) return;
        const { target, x, y } = resolved;
        const pointerId = state.nextPointerId++;
        if (state.nextPointerId > 2000000000) state.nextPointerId = 1000000;

        dispatchPointer(target, 'pointerover', x, y, pointerId, false);
        dispatchPointer(target, 'pointerenter', x, y, pointerId, false);
        dispatchPointer(target, 'pointermove', x, y, pointerId, false);
        dispatchMouse(target, 'mouseover', x, y, false);
        dispatchMouse(target, 'mouseenter', x, y, false);
        dispatchMouse(target, 'mousemove', x, y, false);
        dispatchPointer(target, 'pointerdown', x, y, pointerId, true);
        dispatchMouse(target, 'mousedown', x, y, true);

        const releaseTimer = window.setTimeout(() => {
            state.releaseTimers.delete(releaseTimer);
            dispatchPointer(target, 'pointerup', x, y, pointerId, false);
            dispatchMouse(target, 'mouseup', x, y, false);
            dispatchMouse(target, 'click', x, y, false);
            dispatchPointer(target, 'pointerout', x, y, pointerId, false);
            dispatchPointer(target, 'pointerleave', x, y, pointerId, false);
        }, PRESS_DURATION);
        state.releaseTimers.add(releaseTimer);
    }

    function clearQueueTimer() {
        if (state.queueTimer === null) return;
        window.clearTimeout(state.queueTimer);
        state.queueTimer = null;
    }

    function clearReleaseTimers() {
        for (const timer of state.releaseTimers) window.clearTimeout(timer);
        state.releaseTimers.clear();
    }

    function clearAllTimers() {
        clearQueueTimer();
        clearReleaseTimers();
        state.queueIndex = 0;
        state.nextQueueRunAt = 0;
    }

    function scheduleNextQueuedPoint() {
        if (!state.running || state.points.length === 0) return;
        clearQueueTimer();
        const now = performance.now();
        const slotInterval = getPointSlotInterval();
        if (state.nextQueueRunAt < now - slotInterval) state.nextQueueRunAt = now;
        const delay = Math.max(0, state.nextQueueRunAt - now);

        state.queueTimer = window.setTimeout(() => {
            state.queueTimer = null;
            if (!state.running || state.points.length === 0) return;
            if (state.queueIndex >= state.points.length) state.queueIndex = 0;
            const point = state.points[state.queueIndex];
            state.queueIndex = (state.queueIndex + 1) % state.points.length;
            emulateTap(point);
            state.nextQueueRunAt += getPointSlotInterval();
            scheduleNextQueuedPoint();
        }, delay);
    }

    function startQueue() {
        clearAllTimers();
        if (!state.running || state.points.length === 0) return;
        state.queueIndex = 0;
        state.nextQueueRunAt = performance.now();
        scheduleNextQueuedPoint();
    }

    function restartQueue() {
        if (!state.running) return;
        startQueue();
        updateStatus();
    }

    function start() {
        if (state.points.length === 0) {
            alert(t('noPoints'));
            return;
        }
        const validInterval = parseValidInterval(intervalInput.value);
        if (validInterval === null) {
            alert(t('invalidInterval', MIN_INTERVAL));
            intervalInput.focus();
            return;
        }
        stop();
        state.interval = validInterval;
        prepareRegisteredCanvases();
        state.running = true;
        createRunningShield();
        saveState();
        updateStatus();
        startQueue();
    }

    function stop() {
        state.running = false;
        clearAllTimers();
        removeRunningShield();
        updateStatus();
    }

    panel.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        switch (button.dataset.action) {
            case 'add':
                beginSelection();
                break;
            case 'start':
                start();
                break;
            case 'stop':
                stop();
                break;
            case 'delete-last':
                stop();
                state.points.pop();
                saveState();
                updateUI();
                break;
            case 'clear':
                stop();
                state.points = [];
                saveState();
                updateUI();
                break;
        }
    });

    for (const eventName of [
        'touchstart', 'touchmove', 'touchend', 'touchcancel',
        'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu',
    ]) {
        panel.addEventListener(eventName, event => event.stopPropagation(), { passive: false });
    }

    function handleViewportChange() {
        requestAnimationFrame(() => {
            setPanelPosition(state.panelX, state.panelY);
            renderMarkers();
            saveState();
        });
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', () => {
        window.setTimeout(handleViewportChange, 250);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportChange);
        window.visualViewport.addEventListener('scroll', renderMarkers);
    }
    window.addEventListener('pagehide', () => {
        state.running = false;
        clearAllTimers();
    });

    updateUI();
    requestAnimationFrame(() => {
        initializePanelPosition();
        updateUI();
    });
})();
