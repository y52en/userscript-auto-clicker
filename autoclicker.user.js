// ==UserScript==
// @name         Auto Clicker
// @namespace    local.web.autoclicker
// @version      0.6.0
// @description  Movable/minimizable auto clicker.
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    /*
     * iframe内でも実行したい場合は、この判定を削除してください。
     */
    if (window.top !== window.self) {
        return;
    }

    /*
     * 二重起動防止
     */
    if (document.getElementById('usc-autoclicker-panel')) {
        return;
    }

    const STORAGE_KEY = 'ios-web-unity-autoclicker-v6';

    /*
     * 過去版の設定も読み込む。
     */
    const LEGACY_STORAGE_KEYS = [
        'ios-web-unity-autoclicker-v5',
        'ios-web-unity-autoclicker-v4',
        'ios-web-unity-autoclicker-v3',
        'ios-web-autoclicker-v2',
    ];

    /*
     * 入力できる最小の一周間隔。
     */
    const MIN_INTERVAL = 50;

    /*
     * pointerdown/mousedownからpointerup/mouseupまでの時間。
     *
     * 短すぎるとUnityに押下として認識されない場合があり、
     * 長すぎると次の地点の入力と重なりやすくなる。
     */
    const PRESS_DURATION = 6;

    /*
     * Unityの入力が重ならないよう、隣り合う地点の間に
     * 最低限確保する時間。
     *
     * 60fpsでは1フレームが約16.7msなので、
     * 16ms程度を下限とする。
     */
    const MIN_POINT_SLOT = 16;

    const saved = loadSavedState();

    const state = {
        points: normalizeSavedPoints(saved.points),

        running: false,
        selecting: false,
        minimized: Boolean(saved.minimized),

        /*
         * intervalは「同じ地点が再クリックされるまでの目標周期」。
         */
        interval:
            parseValidInterval(saved.interval) ??
            500,

        /*
         * Unity向け単一キュー
         */
        queueTimer: null,
        queueIndex: 0,
        nextQueueRunAt: 0,

        /*
         * down後のupタイマー。
         * 停止時にすべて解除する。
         */
        releaseTimers: new Set(),

        panelX:
            Number.isFinite(saved.panelX)
                ? saved.panelX
                : null,

        panelY:
            Number.isFinite(saved.panelY)
                ? saved.panelY
                : null,

        nextPointerId: 1000000,

        selectionLayer: null,
        runningShield: null,

        blockCompatibilityClickUntil: 0,
    };

    /*
     * ============================================================
     * 保存・読み込み
     * ============================================================
     */

    function loadSavedState() {
        const keys = [
            STORAGE_KEY,
            ...LEGACY_STORAGE_KEYS,
        ];

        for (const key of keys) {
            try {
                const text =
                    localStorage.getItem(key);

                if (!text) {
                    continue;
                }

                const parsed =
                    JSON.parse(text);

                if (
                    parsed &&
                    typeof parsed === 'object'
                ) {
                    return parsed;
                }
            } catch (error) {
                console.warn(
                    `[AutoClicker] ${key}の読み込みに失敗しました。`,
                    error
                );
            }
        }

        return {};
    }

    function saveState() {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    points: state.points,
                    interval: state.interval,
                    minimized: state.minimized,
                    panelX: state.panelX,
                    panelY: state.panelY,
                })
            );
        } catch (error) {
            console.warn(
                '[AutoClicker] 設定の保存に失敗しました。',
                error
            );
        }
    }

    function clamp(value, min, max) {
        return Math.min(
            Math.max(value, min),
            max
        );
    }

    /*
     * 50以上の整数だけを有効値として返す。
     *
     * 入力途中の空欄や「5」はnullになるが、
     * 入力欄の表示自体は変更しない。
     */
    function parseValidInterval(value) {
        const text =
            String(value ?? '').trim();

        if (!/^\d+$/.test(text)) {
            return null;
        }

        const parsed = Number(text);

        if (
            !Number.isSafeInteger(parsed) ||
            parsed < MIN_INTERVAL
        ) {
            return null;
        }

        return parsed;
    }

    function normalizeSavedPoints(points) {
        if (!Array.isArray(points)) {
            return [];
        }

        return points
            .map(point => {
                if (
                    !point ||
                    typeof point !== 'object'
                ) {
                    return null;
                }

                /*
                 * canvas相対座標形式
                 */
                if (
                    point.kind === 'canvas' &&
                    Number.isFinite(
                        point.normalizedX
                    ) &&
                    Number.isFinite(
                        point.normalizedY
                    )
                ) {
                    return {
                        kind: 'canvas',

                        canvasIndex:
                            Number.isInteger(
                                point.canvasIndex
                            )
                                ? point.canvasIndex
                                : 0,

                        canvasId:
                            typeof point.canvasId ===
                            'string'
                                ? point.canvasId
                                : '',

                        normalizedX:
                            clamp(
                                point.normalizedX,
                                0,
                                1
                            ),

                        normalizedY:
                            clamp(
                                point.normalizedY,
                                0,
                                1
                            ),

                        fallbackX:
                            Number.isFinite(
                                point.fallbackX
                            )
                                ? point.fallbackX
                                : 0,

                        fallbackY:
                            Number.isFinite(
                                point.fallbackY
                            )
                                ? point.fallbackY
                                : 0,
                    };
                }

                /*
                 * 画面座標形式
                 */
                if (
                    point.kind === 'screen' &&
                    Number.isFinite(point.x) &&
                    Number.isFinite(point.y)
                ) {
                    return {
                        kind: 'screen',
                        x: point.x,
                        y: point.y,
                    };
                }

                /*
                 * さらに古い{x, y}形式
                 */
                if (
                    Number.isFinite(point.x) &&
                    Number.isFinite(point.y)
                ) {
                    return {
                        kind: 'screen',
                        x: point.x,
                        y: point.y,
                    };
                }

                return null;
            })
            .filter(Boolean);
    }

    /*
     * ============================================================
     * UI
     * ============================================================
     */

    const style =
        document.createElement('style');

    style.textContent = `
        #usc-autoclicker-panel,
        #usc-autoclicker-panel *,
        #usc-autoclicker-markers,
        #usc-autoclicker-markers *,
        #usc-autoclicker-selection-layer,
        #usc-autoclicker-selection-layer *,
        #usc-autoclicker-running-shield {
            box-sizing: border-box;
        }

        #usc-autoclicker-panel {
            position: fixed;
            z-index: 2147483647;

            width: 225px;
            max-width: calc(100vw - 16px);

            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 14px;

            overflow: hidden;

            background: rgba(24, 24, 27, 0.94);
            color: #fff;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Helvetica Neue",
                Arial,
                sans-serif;

            font-size: 13px;
            line-height: 1.4;

            box-shadow:
                0 10px 35px rgba(0, 0, 0, 0.45),
                0 2px 8px rgba(0, 0, 0, 0.3);

            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);

            user-select: none;
            -webkit-user-select: none;

            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }

        #usc-autoclicker-panel.is-minimized {
            width: 160px;
        }

        #usc-autoclicker-header {
            display: flex;
            align-items: center;
            gap: 8px;

            min-height: 42px;
            padding: 6px 7px 6px 12px;

            background: rgba(255, 255, 255, 0.08);

            cursor: grab;
            touch-action: none;
        }

        #usc-autoclicker-header.is-dragging {
            cursor: grabbing;
        }

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

            background: rgba(255, 255, 255, 0.14);
            color: #fff;

            font-size: 20px;
            line-height: 30px;

            touch-action: manipulation;
        }

        #usc-autoclicker-minimize:active {
            background: rgba(255, 255, 255, 0.28);
        }

        #usc-autoclicker-body {
            padding: 10px;
        }

        #usc-autoclicker-panel.is-minimized
        #usc-autoclicker-body {
            display: none;
        }

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

        #usc-autoclicker-panel .usc-action-button:active {
            transform: scale(0.98);
        }

        #usc-autoclicker-panel .usc-start-button {
            background: #59d77d;
        }

        #usc-autoclicker-panel .usc-stop-button {
            background: #ffca57;
        }

        #usc-autoclicker-panel .usc-delete-button {
            background: #ff9a5b;
        }

        #usc-autoclicker-panel .usc-clear-button {
            background: #ff7474;
        }

        #usc-autoclicker-interval-label {
            display: block;

            margin-top: 10px;
            margin-bottom: 4px;

            color: rgba(255, 255, 255, 0.84);
        }

        #usc-autoclicker-interval {
            display: block;

            width: 100%;
            height: 39px;

            padding: 7px 9px;

            border: 1px solid rgba(255, 255, 255, 0.28);
            border-radius: 8px;

            appearance: none;
            -webkit-appearance: none;

            background: rgba(255, 255, 255, 0.12);
            color: #fff;

            font-size: 16px;

            user-select: text;
            -webkit-user-select: text;

            touch-action: manipulation;
        }

        #usc-autoclicker-interval.is-invalid {
            border-color: #ff7373;
            background: rgba(255, 70, 70, 0.18);
        }

        #usc-autoclicker-status {
            margin-top: 9px;
            padding: 7px 8px;

            border-radius: 8px;

            background: rgba(255, 255, 255, 0.08);

            color: rgba(255, 255, 255, 0.9);
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

            background: rgba(255, 59, 48, 0.22);
            color: #fff;

            font:
                bold 12px/30px
                -apple-system,
                BlinkMacSystemFont,
                sans-serif;

            text-align: center;

            text-shadow:
                0 1px 2px #000,
                0 0 3px #000;

            pointer-events: none;
        }

        .usc-autoclicker-marker::before,
        .usc-autoclicker-marker::after {
            content: "";

            position: absolute;
            left: 50%;
            top: 50%;

            background: #ff3b30;

            transform: translate(-50%, -50%);
        }

        .usc-autoclicker-marker::before {
            width: 10px;
            height: 1px;
        }

        .usc-autoclicker-marker::after {
            width: 1px;
            height: 10px;
        }

        #usc-autoclicker-selection-layer {
            position: fixed;
            inset: 0;

            z-index: 2147483646;

            background: rgba(0, 0, 0, 0.08);

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

            background: rgba(0, 0, 0, 0.82);
            color: #fff;

            font-weight: 600;

            white-space: nowrap;
            pointer-events: none;
        }

        /*
         * 実行中の本物のタップを遮断する。
         *
         * パネルより下に置くので停止ボタンは操作可能。
         */
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

    document.documentElement.appendChild(
        style
    );

    const markerLayer =
        document.createElement('div');

    markerLayer.id =
        'usc-autoclicker-markers';

    document.documentElement.appendChild(
        markerLayer
    );

    const panel =
        document.createElement('div');

    panel.id =
        'usc-autoclicker-panel';

    panel.innerHTML = `
        <div id="usc-autoclicker-header">
            <div id="usc-autoclicker-title">
                Auto Clicker
            </div>

            <button
                id="usc-autoclicker-minimize"
                type="button"
                aria-label="最小化"
            >−</button>
        </div>

        <div id="usc-autoclicker-body">
            <button
                class="usc-action-button"
                type="button"
                data-action="add"
            >位置を追加</button>

            <button
                class="usc-action-button usc-start-button"
                type="button"
                data-action="start"
            >開始</button>

            <button
                class="usc-action-button usc-stop-button"
                type="button"
                data-action="stop"
            >停止</button>

            <button
                class="usc-action-button usc-delete-button"
                type="button"
                data-action="delete-last"
            >最後の位置を削除</button>

            <button
                class="usc-action-button usc-clear-button"
                type="button"
                data-action="clear"
            >位置を全削除</button>

            <label
                id="usc-autoclicker-interval-label"
                for="usc-autoclicker-interval"
            >
                各地点の一周間隔（${MIN_INTERVAL}ms以上）
            </label>

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

    document.documentElement.appendChild(
        panel
    );

    const header =
        panel.querySelector(
            '#usc-autoclicker-header'
        );

    const minimizeButton =
        panel.querySelector(
            '#usc-autoclicker-minimize'
        );

    const intervalInput =
        panel.querySelector(
            '#usc-autoclicker-interval'
        );

    const statusElement =
        panel.querySelector(
            '#usc-autoclicker-status'
        );

    /*
     * ============================================================
     * パネル位置・表示
     * ============================================================
     */

    function initializePanelPosition() {
        const defaultX = Math.max(
            8,
            window.innerWidth -
            panel.offsetWidth -
            12
        );

        setPanelPosition(
            state.panelX ?? defaultX,
            state.panelY ?? 12
        );
    }

    function setPanelPosition(x, y) {
        const width =
            panel.offsetWidth || 225;

        const height =
            panel.offsetHeight || 42;

        state.panelX = clamp(
            x,
            0,
            Math.max(
                0,
                window.innerWidth - width
            )
        );

        state.panelY = clamp(
            y,
            0,
            Math.max(
                0,
                window.innerHeight - height
            )
        );

        panel.style.left =
            `${state.panelX}px`;

        panel.style.top =
            `${state.panelY}px`;

        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    /*
     * 実際の地点間隔。
     *
     * intervalは同じ地点に戻るまでの周期なので、
     * 地点数で割る。
     *
     * ただしUnityで入力が重ならないよう、
     * 最低MIN_POINT_SLOTミリ秒を確保する。
     */
    function getPointSlotInterval() {
        const pointCount = Math.max(
            1,
            state.points.length
        );

        return Math.max(
            MIN_POINT_SLOT,
            state.interval / pointCount
        );
    }

    /*
     * MIN_POINT_SLOT制限を考慮した、
     * 実際の同一地点の周期。
     */
    function getEffectiveCycleInterval() {
        return (
            getPointSlotInterval() *
            Math.max(1, state.points.length)
        );
    }

    function updateStatus() {
        const enteredInterval =
            parseValidInterval(
                intervalInput.value
            );

        intervalInput.classList.toggle(
            'is-invalid',
            enteredInterval === null
        );

        let mode = '停止中';

        if (state.selecting) {
            mode = '位置選択中';
        } else if (state.running) {
            mode = '実行中';
        }

        let intervalText =
            enteredInterval === null
                ? '50以上を入力'
                : `${enteredInterval}ms`;

        let effectiveText = '-';

        if (
            enteredInterval !== null &&
            state.points.length > 0
        ) {
            const originalInterval =
                state.interval;

            /*
             * 入力中の値を表示計算に使う。
             */
            state.interval =
                enteredInterval;

            const effective =
                getEffectiveCycleInterval();

            const slot =
                getPointSlotInterval();

            state.interval =
                originalInterval;

            effectiveText =
                `${Math.round(effective)}ms` +
                `（地点間 約${Math.round(slot)}ms）`;
        }

        statusElement.textContent =
            `状態: ${mode}\n` +
            `登録位置: ${state.points.length}\n` +
            `設定した一周間隔: ${intervalText}\n` +
            `実際の一周周期: ${effectiveText}`;
    }

    function updateUI() {
        panel.classList.toggle(
            'is-minimized',
            state.minimized
        );

        minimizeButton.textContent =
            state.minimized
                ? '＋'
                : '−';

        minimizeButton.setAttribute(
            'aria-label',
            state.minimized
                ? '復元'
                : '最小化'
        );

        renderMarkers();
        updateStatus();
    }

    function renderMarkers() {
        markerLayer.replaceChildren();

        state.points.forEach(
            (point, index) => {
                const resolved =
                    resolveRegisteredPoint(
                        point
                    );

                if (!resolved) {
                    return;
                }

                const marker =
                    document.createElement(
                        'div'
                    );

                marker.className =
                    'usc-autoclicker-marker';

                marker.style.left =
                    `${resolved.x}px`;

                marker.style.top =
                    `${resolved.y}px`;

                marker.textContent =
                    String(index + 1);

                markerLayer.appendChild(
                    marker
                );
            }
        );
    }

    /*
     * ============================================================
     * パネルドラッグ
     * ============================================================
     */

    let dragState = null;

    header.addEventListener(
        'pointerdown',
        event => {
            if (
                event.target.closest(
                    'button, input'
                )
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const rect =
                panel.getBoundingClientRect();

            dragState = {
                pointerId:
                    event.pointerId,

                offsetX:
                    event.clientX -
                    rect.left,

                offsetY:
                    event.clientY -
                    rect.top,
            };

            header.classList.add(
                'is-dragging'
            );

            try {
                header.setPointerCapture(
                    event.pointerId
                );
            } catch {
                // Safariで失敗しても継続する。
            }
        }
    );

    header.addEventListener(
        'pointermove',
        event => {
            if (
                !dragState ||
                event.pointerId !==
                dragState.pointerId
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            setPanelPosition(
                event.clientX -
                dragState.offsetX,

                event.clientY -
                dragState.offsetY
            );
        }
    );

    function finishPanelDrag(event) {
        if (
            !dragState ||
            event.pointerId !==
            dragState.pointerId
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        header.classList.remove(
            'is-dragging'
        );

        try {
            header.releasePointerCapture(
                event.pointerId
            );
        } catch {
            // 無視
        }

        dragState = null;

        saveState();
    }

    header.addEventListener(
        'pointerup',
        finishPanelDrag
    );

    header.addEventListener(
        'pointercancel',
        finishPanelDrag
    );

    /*
     * ============================================================
     * 最小化
     * ============================================================
     */

    minimizeButton.addEventListener(
        'click',
        event => {
            event.preventDefault();
            event.stopPropagation();

            state.minimized =
                !state.minimized;

            updateUI();

            requestAnimationFrame(() => {
                setPanelPosition(
                    state.panelX,
                    state.panelY
                );

                saveState();
            });
        }
    );

    /*
     * ============================================================
     * 間隔入力
     * ============================================================
     */

    intervalInput.addEventListener(
        'pointerdown',
        event => {
            event.stopPropagation();
        }
    );

    intervalInput.addEventListener(
        'click',
        event => {
            event.stopPropagation();
        }
    );

    /*
     * 500の末尾を削除した場合は、入力欄を50のまま維持する。
     *
     * 通常の削除ではinput.valueを書き戻さない。
     */
    intervalInput.addEventListener(
        'input',
        () => {
            const originalValue =
                intervalInput.value;

            const selectionStart =
                intervalInput.selectionStart;

            /*
             * 数字以外が入った時だけ取り除く。
             */
            const cleanedValue =
                originalValue.replace(
                    /[^\d]/g,
                    ''
                );

            if (
                cleanedValue !==
                originalValue
            ) {
                intervalInput.value =
                    cleanedValue;

                if (
                    selectionStart !== null
                ) {
                    const removedBeforeCursor =
                        originalValue
                            .slice(
                                0,
                                selectionStart
                            )
                            .replace(
                                /\d/g,
                                ''
                            )
                            .length;

                    const nextCursor =
                        Math.max(
                            0,
                            selectionStart -
                            removedBeforeCursor
                        );

                    intervalInput
                        .setSelectionRange(
                            nextCursor,
                            nextCursor
                        );
                }
            }

            const validInterval =
                parseValidInterval(
                    intervalInput.value
                );

            /*
             * 有効値になった時だけ内部設定を更新。
             * 入力欄は書き換えない。
             */
            if (
                validInterval !== null
            ) {
                state.interval =
                    validInterval;

                saveState();

                if (state.running) {
                    restartQueue();
                }
            }

            updateStatus();
        }
    );

    /*
     * 空欄や50未満のまま入力欄から離れた時だけ、
     * 最後の有効値へ戻す。
     */
    intervalInput.addEventListener(
        'blur',
        () => {
            const validInterval =
                parseValidInterval(
                    intervalInput.value
                );

            if (
                validInterval === null
            ) {
                intervalInput.value =
                    String(state.interval);
            } else {
                state.interval =
                    validInterval;

                saveState();

                if (state.running) {
                    restartQueue();
                }
            }

            updateStatus();
        }
    );

    intervalInput.addEventListener(
        'keydown',
        event => {
            if (event.key === 'Enter') {
                intervalInput.blur();
            }
        }
    );

    /*
     * ============================================================
     * 実ページ要素の取得
     * ============================================================
     */

    function getRealElementAtPoint(x, y) {
        const hiddenElements = [
            panel,
            markerLayer,
            state.selectionLayer,
            state.runningShield,
        ].filter(Boolean);

        const previousStates =
            hiddenElements.map(
                element => ({
                    element,

                    visibility:
                        element.style
                            .visibility,
                })
            );

        for (
            const item
            of previousStates
        ) {
            item.element.style.visibility =
                'hidden';
        }

        const target =
            document.elementFromPoint(
                x,
                y
            );

        for (
            const item
            of previousStates
        ) {
            item.element.style.visibility =
                item.visibility;
        }

        return target;
    }

    /*
     * ============================================================
     * 登録位置
     * ============================================================
     */

    function createRegisteredPoint(
        x,
        y
    ) {
        const target =
            getRealElementAtPoint(
                x,
                y
            );

        const canvas =
            target instanceof
            HTMLCanvasElement
                ? target
                : target instanceof Element
                    ? target.closest(
                        'canvas'
                    )
                    : null;

        if (
            canvas instanceof
            HTMLCanvasElement
        ) {
            const rect =
                canvas
                    .getBoundingClientRect();

            const canvases =
                Array.from(
                    document
                        .querySelectorAll(
                            'canvas'
                        )
                );

            return {
                kind: 'canvas',

                canvasIndex:
                    canvases.indexOf(
                        canvas
                    ),

                canvasId:
                    canvas.id || '',

                normalizedX:
                    rect.width > 0
                        ? clamp(
                            (
                                x -
                                rect.left
                            ) /
                            rect.width,
                            0,
                            1
                        )
                        : 0,

                normalizedY:
                    rect.height > 0
                        ? clamp(
                            (
                                y -
                                rect.top
                            ) /
                            rect.height,
                            0,
                            1
                        )
                        : 0,

                fallbackX: x,
                fallbackY: y,
            };
        }

        return {
            kind: 'screen',
            x,
            y,
        };
    }

    function findRegisteredCanvas(
        point
    ) {
        if (point.canvasId) {
            const canvas =
                document.getElementById(
                    point.canvasId
                );

            if (
                canvas instanceof
                HTMLCanvasElement
            ) {
                return canvas;
            }
        }

        const canvases =
            document.querySelectorAll(
                'canvas'
            );

        const indexedCanvas =
            canvases[
                point.canvasIndex
            ];

        if (
            indexedCanvas instanceof
            HTMLCanvasElement
        ) {
            return indexedCanvas;
        }

        /*
         * canvasが1つだけならそれを使う。
         */
        if (
            canvases.length === 1 &&
            canvases[0] instanceof
            HTMLCanvasElement
        ) {
            return canvases[0];
        }

        return null;
    }

    function resolveRegisteredPoint(
        point
    ) {
        if (!point) {
            return null;
        }

        if (
            point.kind === 'canvas'
        ) {
            const canvas =
                findRegisteredCanvas(
                    point
                );

            if (canvas) {
                const rect =
                    canvas
                        .getBoundingClientRect();

                return {
                    target: canvas,

                    x:
                        rect.left +
                        rect.width *
                        point.normalizedX,

                    y:
                        rect.top +
                        rect.height *
                        point.normalizedY,
                };
            }

            return {
                target:
                    getRealElementAtPoint(
                        point.fallbackX,
                        point.fallbackY
                    ),

                x: point.fallbackX,
                y: point.fallbackY,
            };
        }

        if (
            point.kind === 'screen'
        ) {
            return {
                target:
                    getRealElementAtPoint(
                        point.x,
                        point.y
                    ),

                x: point.x,
                y: point.y,
            };
        }

        return null;
    }

    /*
     * ============================================================
     * 位置選択
     * ============================================================
     */

    function beginSelection() {
        stop();

        if (state.selecting) {
            return;
        }

        state.selecting = true;

        const layer =
            document.createElement(
                'div'
            );

        layer.id =
            'usc-autoclicker-selection-layer';

        const message =
            document.createElement(
                'div'
            );

        message.id =
            'usc-autoclicker-selection-message';

        message.textContent =
            '登録したい位置をタップ';

        layer.appendChild(message);

        document.documentElement
            .appendChild(layer);

        state.selectionLayer =
            layer;

        let selected = null;
        let selectedPointerId = null;

        function block(event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }

        layer.addEventListener(
            'pointerdown',
            event => {
                block(event);

                selectedPointerId =
                    event.pointerId;

                selected = {
                    x: event.clientX,
                    y: event.clientY,
                };

                try {
                    layer.setPointerCapture(
                        event.pointerId
                    );
                } catch {
                    // 無視
                }
            },
            true
        );

        layer.addEventListener(
            'pointermove',
            block,
            true
        );

        layer.addEventListener(
            'pointerup',
            event => {
                block(event);

                if (
                    selectedPointerId !==
                    null &&
                    event.pointerId !==
                    selectedPointerId
                ) {
                    return;
                }

                const point =
                    selected || {
                        x: event.clientX,
                        y: event.clientY,
                    };

                /*
                 * 下のcanvasを調べられるように
                 * 選択レイヤーを一時的に隠す。
                 */
                layer.style.visibility =
                    'hidden';

                state.points.push(
                    createRegisteredPoint(
                        point.x,
                        point.y
                    )
                );

                layer.remove();

                state.selectionLayer =
                    null;

                state.selecting =
                    false;

                /*
                 * Safariが後から生成する互換clickを遮断。
                 */
                state.blockCompatibilityClickUntil =
                    performance.now() +
                    500;

                saveState();
                updateUI();
            },
            true
        );

        layer.addEventListener(
            'pointercancel',
            event => {
                block(event);

                layer.remove();

                state.selectionLayer =
                    null;

                state.selecting =
                    false;

                updateUI();
            },
            true
        );

        for (
            const eventName
            of [
                'touchstart',
                'touchmove',
                'touchend',
                'touchcancel',
                'mousedown',
                'mousemove',
                'mouseup',
                'click',
                'dblclick',
                'contextmenu',
            ]
        ) {
            layer.addEventListener(
                eventName,
                block,
                {
                    capture: true,
                    passive: false,
                }
            );
        }

        updateStatus();
    }

    document.addEventListener(
        'click',
        event => {
            if (
                performance.now() >=
                state
                    .blockCompatibilityClickUntil
            ) {
                return;
            }

            if (
                panel.contains(
                    event.target
                )
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        },
        true
    );

    /*
     * ============================================================
     * 実行中の本物のタップを遮断
     * ============================================================
     */

    function createRunningShield() {
        removeRunningShield();

        const shield =
            document.createElement(
                'div'
            );

        shield.id =
            'usc-autoclicker-running-shield';

        function block(event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }

        for (
            const eventName
            of [
                'pointerdown',
                'pointermove',
                'pointerup',
                'pointercancel',
                'touchstart',
                'touchmove',
                'touchend',
                'touchcancel',
                'mousedown',
                'mousemove',
                'mouseup',
                'click',
                'dblclick',
                'contextmenu',
            ]
        ) {
            shield.addEventListener(
                eventName,
                block,
                {
                    capture: true,
                    passive: false,
                }
            );
        }

        document.documentElement
            .appendChild(shield);

        state.runningShield =
            shield;
    }

    function removeRunningShield() {
        if (!state.runningShield) {
            return;
        }

        state.runningShield.remove();
        state.runningShield = null;
    }

    /*
     * ============================================================
     * Unity canvas準備
     * ============================================================
     */

    function prepareRegisteredCanvases() {
        let firstCanvas = null;

        for (
            const point
            of state.points
        ) {
            if (
                point.kind !== 'canvas'
            ) {
                continue;
            }

            const canvas =
                findRegisteredCanvas(
                    point
                );

            if (!canvas) {
                continue;
            }

            if (
                !canvas.hasAttribute(
                    'tabindex'
                )
            ) {
                canvas.setAttribute(
                    'tabindex',
                    '0'
                );
            }

            if (!firstCanvas) {
                firstCanvas = canvas;
            }
        }

        /*
         * Startボタンを押した本物のユーザー操作中に
         * canvasへfocusを与える。
         */
        if (firstCanvas) {
            try {
                firstCanvas.focus({
                    preventScroll: true,
                });
            } catch {
                try {
                    firstCanvas.focus();
                } catch {
                    // 無視
                }
            }
        }
    }

    /*
     * ============================================================
     * 合成入力
     * ============================================================
     */

    function dispatchPointer(
        target,
        type,
        x,
        y,
        pointerId,
        pressed
    ) {
        if (
            typeof PointerEvent !==
            'function'
        ) {
            return;
        }

        target.dispatchEvent(
            new PointerEvent(
                type,
                {
                    bubbles: true,
                    cancelable: true,
                    composed: true,

                    pointerId,

                    /*
                     * Unity WebGLではmouse入力として
                     * 処理させる方が安定しやすい。
                     */
                    pointerType:
                        'mouse',

                    isPrimary: true,

                    clientX: x,
                    clientY: y,

                    screenX: x,
                    screenY: y,

                    button:
                        type ===
                        'pointermove'
                            ? -1
                            : 0,

                    buttons:
                        pressed
                            ? 1
                            : 0,

                    pressure:
                        pressed
                            ? 0.5
                            : 0,

                    width: 1,
                    height: 1,
                }
            )
        );
    }

    function dispatchMouse(
        target,
        type,
        x,
        y,
        pressed
    ) {
        target.dispatchEvent(
            new MouseEvent(
                type,
                {
                    bubbles: true,
                    cancelable: true,
                    composed: true,

                    view: window,

                    clientX: x,
                    clientY: y,

                    screenX: x,
                    screenY: y,

                    button: 0,

                    buttons:
                        pressed
                            ? 1
                            : 0,

                    detail:
                        type ===
                        'click'
                            ? 1
                            : 0,
                }
            )
        );
    }

    /*
     * 1回分のクリックを送信する。
     *
     * 次地点の実行間隔は最低16msあり、
     * 押下時間は6msなのでdown/upが次地点と重なりにくい。
     */
    function emulateTap(point) {
        const resolved =
            resolveRegisteredPoint(
                point
            );

        if (
            !resolved ||
            !(
                resolved.target
                instanceof Element
            )
        ) {
            return;
        }

        const {
            target,
            x,
            y,
        } = resolved;

        const pointerId =
            state.nextPointerId++;

        if (
            state.nextPointerId >
            2000000000
        ) {
            state.nextPointerId =
                1000000;
        }

        /*
         * Unityへ現在座標を確実に更新させる。
         */
        dispatchPointer(
            target,
            'pointerover',
            x,
            y,
            pointerId,
            false
        );

        dispatchPointer(
            target,
            'pointerenter',
            x,
            y,
            pointerId,
            false
        );

        dispatchPointer(
            target,
            'pointermove',
            x,
            y,
            pointerId,
            false
        );

        dispatchMouse(
            target,
            'mouseover',
            x,
            y,
            false
        );

        dispatchMouse(
            target,
            'mouseenter',
            x,
            y,
            false
        );

        dispatchMouse(
            target,
            'mousemove',
            x,
            y,
            false
        );

        /*
         * 押下
         */
        dispatchPointer(
            target,
            'pointerdown',
            x,
            y,
            pointerId,
            true
        );

        dispatchMouse(
            target,
            'mousedown',
            x,
            y,
            true
        );

        const releaseTimer =
            window.setTimeout(
                () => {
                    state.releaseTimers.delete(
                        releaseTimer
                    );

                    /*
                     * 停止済みでもdown状態を残さないため、
                     * upだけは送る。
                     */
                    dispatchPointer(
                        target,
                        'pointerup',
                        x,
                        y,
                        pointerId,
                        false
                    );

                    dispatchMouse(
                        target,
                        'mouseup',
                        x,
                        y,
                        false
                    );

                    dispatchMouse(
                        target,
                        'click',
                        x,
                        y,
                        false
                    );

                    dispatchPointer(
                        target,
                        'pointerout',
                        x,
                        y,
                        pointerId,
                        false
                    );

                    dispatchPointer(
                        target,
                        'pointerleave',
                        x,
                        y,
                        pointerId,
                        false
                    );
                },
                PRESS_DURATION
            );

        state.releaseTimers.add(
            releaseTimer
        );
    }

    /*
     * ============================================================
     * Unity向け単一入力キュー
     * ============================================================
     *
     * 複数地点で独立タイマーを使うと、
     *
     * 地点1 down
     * 地点2 move/down
     * 地点1 up
     *
     * のように座標と押下状態が混ざる。
     *
     * この版では1本のキューで、必ず1地点ずつ処理する。
     * ============================================================
     */

    function clearQueueTimer() {
        if (
            state.queueTimer !== null
        ) {
            window.clearTimeout(
                state.queueTimer
            );

            state.queueTimer = null;
        }
    }

    function clearReleaseTimers() {
        for (
            const timer
            of state.releaseTimers
        ) {
            window.clearTimeout(timer);
        }

        state.releaseTimers.clear();
    }

    function clearAllTimers() {
        clearQueueTimer();
        clearReleaseTimers();

        state.queueIndex = 0;
        state.nextQueueRunAt = 0;
    }

    function scheduleNextQueuedPoint() {
        if (
            !state.running ||
            state.points.length === 0
        ) {
            return;
        }

        clearQueueTimer();

        const now =
            performance.now();

        const slotInterval =
            getPointSlotInterval();

        /*
         * SafariやUnityの処理で大幅に遅れた場合は、
         * 過去分を一気に連打せず現在時刻へ追いつかせる。
         */
        if (
            state.nextQueueRunAt <
            now - slotInterval
        ) {
            state.nextQueueRunAt =
                now;
        }

        const delay =
            Math.max(
                0,
                state.nextQueueRunAt -
                now
            );

        state.queueTimer =
            window.setTimeout(
                () => {
                    state.queueTimer =
                        null;

                    if (
                        !state.running ||
                        state.points.length === 0
                    ) {
                        return;
                    }

                    if (
                        state.queueIndex >=
                        state.points.length
                    ) {
                        state.queueIndex =
                            0;
                    }

                    const point =
                        state.points[
                            state.queueIndex
                        ];

                    state.queueIndex =
                        (
                            state.queueIndex +
                            1
                        ) %
                        state.points.length;

                    emulateTap(point);

                    /*
                     * 次の地点は最低16ms後。
                     *
                     * 同じ地点へ戻る周期は、
                     * slotInterval × 地点数となる。
                     */
                    state.nextQueueRunAt +=
                        getPointSlotInterval();

                    scheduleNextQueuedPoint();
                },
                delay
            );
    }

    function startQueue() {
        clearAllTimers();

        if (
            !state.running ||
            state.points.length === 0
        ) {
            return;
        }

        state.queueIndex = 0;

        /*
         * 最初の地点はすぐ実行する。
         */
        state.nextQueueRunAt =
            performance.now();

        scheduleNextQueuedPoint();
    }

    function restartQueue() {
        if (!state.running) {
            return;
        }

        startQueue();
        updateStatus();
    }

    function start() {
        if (
            state.points.length === 0
        ) {
            alert(
                'クリック位置を1つ以上登録してください。'
            );

            return;
        }

        const validInterval =
            parseValidInterval(
                intervalInput.value
            );

        if (
            validInterval === null
        ) {
            alert(
                `間隔を${MIN_INTERVAL}以上で入力してください。`
            );

            intervalInput.focus();
            return;
        }

        stop();

        state.interval =
            validInterval;

        /*
         * Startボタンを押した実ユーザー操作中に
         * Unity canvasへfocusを与える。
         */
        prepareRegisteredCanvases();

        state.running = true;

        createRunningShield();

        saveState();
        updateStatus();

        /*
         * 初回専用クリックは別に送らない。
         *
         * 初回クリックと定期処理が重複すると、
         * Unityの入力状態が壊れる可能性があるため、
         * キューだけを開始する。
         */
        startQueue();
    }

    function stop() {
        state.running = false;

        clearAllTimers();
        removeRunningShield();

        updateStatus();
    }

    /*
     * ============================================================
     * ボタン
     * ============================================================
     */

    panel.addEventListener(
        'click',
        event => {
            const button =
                event.target.closest(
                    '[data-action]'
                );

            if (!button) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            switch (
                button.dataset.action
            ) {
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
        }
    );

    /*
     * パネルのタップが背後のcanvasへ伝わるのを防ぐ。
     */
    for (
        const eventName
        of [
            'touchstart',
            'touchmove',
            'touchend',
            'touchcancel',
            'mousedown',
            'mousemove',
            'mouseup',
            'click',
            'dblclick',
            'contextmenu',
        ]
    ) {
        panel.addEventListener(
            eventName,
            event => {
                event.stopPropagation();
            },
            {
                passive: false,
            }
        );
    }

    /*
     * ============================================================
     * 画面サイズ変更
     * ============================================================
     */

    function handleViewportChange() {
        requestAnimationFrame(() => {
            setPanelPosition(
                state.panelX,
                state.panelY
            );

            renderMarkers();
            saveState();
        });
    }

    window.addEventListener(
        'resize',
        handleViewportChange
    );

    window.addEventListener(
        'orientationchange',
        () => {
            window.setTimeout(
                handleViewportChange,
                250
            );
        }
    );

    if (window.visualViewport) {
        window.visualViewport
            .addEventListener(
                'resize',
                handleViewportChange
            );

        window.visualViewport
            .addEventListener(
                'scroll',
                renderMarkers
            );
    }

    /*
     * ページを離れる時にタイマーを停止する。
     */
    window.addEventListener(
        'pagehide',
        () => {
            state.running = false;
            clearAllTimers();
        }
    );

    /*
     * ============================================================
     * 初期化
     * ============================================================
     */

    updateUI();

    requestAnimationFrame(() => {
        initializePanelPosition();
        updateUI();
    });
})();
