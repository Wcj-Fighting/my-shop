# Image Preview Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tap-to-fullscreen image preview and long-press download confirmation to the product display page.

**Architecture:** Keep the implementation inside the existing static `index.html`, following the page's current inline CSS and JavaScript structure. Add a small Node test file that evaluates the inline script inside a fake DOM so the behavior can be checked without adding dependencies.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in `node:test`, local file/browser verification.

---

## File Structure

- Modify: `index.html`
  - Add preview overlay and download confirmation dialog markup.
  - Add CSS for full-screen preview, styled confirmation prompt, and modal scroll locking.
  - Add JavaScript helpers for image context extraction, long-press detection, preview opening, dialog opening, download triggering, and filename sanitizing.
- Create: `tests/image-interactions.test.js`
  - Provide a minimal fake DOM.
  - Load and evaluate the inline script from `index.html`.
  - Verify the image interaction behaviors.

## Task 1: Add Failing Behavior Tests

**Files:**
- Create: `tests/image-interactions.test.js`

- [ ] **Step 1: Write the failing test file**

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.classes = new Set();
    }

    add(...names) {
        names.forEach((name) => this.classes.add(name));
    }

    remove(...names) {
        names.forEach((name) => this.classes.delete(name));
    }

    contains(name) {
        return this.classes.has(name);
    }

    toggle(name, force) {
        if (force === true) {
            this.add(name);
            return true;
        }
        if (force === false) {
            this.remove(name);
            return false;
        }
        if (this.contains(name)) {
            this.remove(name);
            return false;
        }
        this.add(name);
        return true;
    }
}

class FakeElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.style = {};
        this.attributes = {};
        this.eventListeners = {};
        this.classList = new FakeClassList(this);
        this.hidden = false;
        this.innerHTML = '';
        this.textContent = '';
        this.src = '';
        this.alt = '';
        this.href = '';
        this.download = '';
        this.target = '';
        this.rel = '';
        this.clicked = false;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
    }

    addEventListener(type, handler) {
        this.eventListeners[type] ||= [];
        this.eventListeners[type].push(handler);
    }

    dispatchEvent(event) {
        event.target ||= this;
        for (const handler of this.eventListeners[event.type] || []) {
            handler(event);
        }
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === 'hidden') this.hidden = true;
        if (name === 'src') this.src = String(value);
        if (name === 'alt') this.alt = String(value);
    }

    removeAttribute(name) {
        delete this.attributes[name];
        if (name === 'hidden') this.hidden = false;
    }

    click() {
        this.clicked = true;
    }

    closest(selector) {
        if (selector.startsWith('.')) {
            const className = selector.slice(1);
            let current = this;
            while (current) {
                if (current.classList.contains(className)) return current;
                current = current.parentElement;
            }
        }
        return null;
    }

    querySelector(selector) {
        if (!selector.startsWith('.')) return null;
        const className = selector.slice(1);
        const stack = [...this.children];
        while (stack.length > 0) {
            const current = stack.shift();
            if (current.classList.contains(className)) return current;
            stack.push(...current.children);
        }
        return null;
    }
}

function createEvent(type, target, extra = {}) {
    return {
        type,
        target,
        clientX: 20,
        clientY: 20,
        pointerType: 'touch',
        button: 0,
        defaultPrevented: false,
        propagationStopped: false,
        immediateStopped: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {
            this.propagationStopped = true;
        },
        stopImmediatePropagation() {
            this.immediateStopped = true;
        },
        ...extra,
    };
}

function createSandbox() {
    const elements = new Map();
    const documentListeners = {};
    const createdAnchors = [];
    const body = new FakeElement('body', 'body');

    const ids = [
        'productsGrid',
        'pullRefreshIndicator',
        'imagePreviewOverlay',
        'imagePreviewImage',
        'imagePreviewClose',
        'downloadConfirmOverlay',
        'downloadCancelButton',
        'downloadConfirmButton',
    ];

    for (const id of ids) {
        elements.set(id, new FakeElement(id === 'imagePreviewImage' ? 'img' : 'div', id));
    }

    elements.get('imagePreviewOverlay').hidden = true;
    elements.get('downloadConfirmOverlay').hidden = true;

    elements.get('pullRefreshIndicator').querySelector = () => new FakeElement('svg');

    const document = {
        body,
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement(tagName) {
            const element = new FakeElement(tagName);
            if (tagName === 'a') createdAnchors.push(element);
            return element;
        },
        addEventListener(type, handler) {
            documentListeners[type] ||= [];
            documentListeners[type].push(handler);
        },
        dispatchEvent(event) {
            for (const handler of documentListeners[event.type] || []) {
                handler(event);
                if (event.immediateStopped) break;
            }
        },
    };

    const sandbox = {
        console: { error() {}, log() {} },
        document,
        window: {
            location: { href: 'https://example.test/shop/', origin: 'https://example.test' },
            openCalls: [],
            open(url, target, features) {
                this.openCalls.push({ url, target, features });
            },
            scrollY: 0,
        },
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (callback) => callback(),
        Math,
        Date,
        URL,
        fetch: async () => ({ ok: true, json: async () => ({ products: [] }) }),
        createdAnchors,
        elements,
    };

    vm.createContext(sandbox);
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    vm.runInContext(script, sandbox);
    return sandbox;
}

function makeProductImage(name = '测试商品', src = 'https://cdn.example.test/product.jpg') {
    const card = new FakeElement('div');
    card.classList.add('product-card');

    const title = new FakeElement('div');
    title.classList.add('product-name');
    title.textContent = name;

    const image = new FakeElement('img');
    image.classList.add('product-image');
    image.src = src;
    image.alt = name;
    image.dataset.original = src;
    image.dataset.productName = name;

    card.appendChild(image);
    card.appendChild(title);
    return image;
}

test('renderProducts includes image interaction metadata', () => {
    const sandbox = createSandbox();

    sandbox.renderProducts([{ id: 1, name: '金色 钱包', price: '599', image: 'images/wallet.jpg' }]);

    const html = sandbox.elements.get('productsGrid').innerHTML;
    assert.match(html, /class="product-image"/);
    assert.match(html, /data-original="images\/wallet\.jpg"/);
    assert.match(html, /data-product-name="金色 钱包"/);
});

test('clicking a product image opens the full-screen preview', () => {
    const sandbox = createSandbox();
    sandbox.initImageInteractions();
    const image = makeProductImage();

    sandbox.document.dispatchEvent(createEvent('click', image, { pointerType: 'mouse' }));

    const overlay = sandbox.elements.get('imagePreviewOverlay');
    const previewImage = sandbox.elements.get('imagePreviewImage');
    assert.equal(overlay.hidden, false);
    assert.equal(overlay.classList.contains('active'), true);
    assert.equal(previewImage.src, image.src);
});

test('long-press opens the download confirmation instead of preview', async () => {
    const sandbox = createSandbox();
    sandbox.initImageInteractions();
    const image = makeProductImage();

    sandbox.document.dispatchEvent(createEvent('pointerdown', image));
    await new Promise((resolve) => setTimeout(resolve, 650));
    sandbox.document.dispatchEvent(createEvent('pointerup', image));
    sandbox.document.dispatchEvent(createEvent('click', image));

    assert.equal(sandbox.elements.get('downloadConfirmOverlay').hidden, false);
    assert.equal(sandbox.elements.get('downloadConfirmOverlay').classList.contains('active'), true);
    assert.equal(sandbox.elements.get('imagePreviewOverlay').hidden, true);
});

test('confirming download clicks a temporary download link', async () => {
    const sandbox = createSandbox();
    sandbox.initImageInteractions();
    const image = makeProductImage('火锅 套餐', 'https://cdn.example.test/hotpot.jpg');

    sandbox.openDownloadConfirmFromImage(image);
    sandbox.elements.get('downloadConfirmButton').dispatchEvent(createEvent('click', sandbox.elements.get('downloadConfirmButton')));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(sandbox.createdAnchors.length, 1);
    assert.equal(sandbox.createdAnchors[0].href, image.src);
    assert.equal(sandbox.createdAnchors[0].download, '火锅 套餐.jpg');
    assert.equal(sandbox.createdAnchors[0].clicked, true);
    assert.equal(sandbox.elements.get('downloadConfirmOverlay').hidden, true);
});

test('moving before the long-press threshold cancels the confirmation', async () => {
    const sandbox = createSandbox();
    sandbox.initImageInteractions();
    const image = makeProductImage();

    sandbox.document.dispatchEvent(createEvent('pointerdown', image));
    sandbox.document.dispatchEvent(createEvent('pointermove', image, { clientX: 60, clientY: 60 }));
    await new Promise((resolve) => setTimeout(resolve, 650));

    assert.equal(sandbox.elements.get('downloadConfirmOverlay').hidden, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/image-interactions.test.js`

Expected: FAIL because `data-product-name`, `initImageInteractions`, and `openDownloadConfirmFromImage` are not implemented yet.

## Task 2: Implement Preview And Download Interactions

**Files:**
- Modify: `index.html`
- Test: `tests/image-interactions.test.js`

- [ ] **Step 1: Add modal markup**

Add the preview overlay and confirmation dialog immediately after the pull-refresh indicator in `index.html`:

```html
    <div class="image-preview-overlay" id="imagePreviewOverlay" hidden>
        <button class="image-preview-close" id="imagePreviewClose" type="button" aria-label="关闭预览">×</button>
        <img id="imagePreviewImage" class="image-preview-image" alt="">
    </div>

    <div class="download-confirm-overlay" id="downloadConfirmOverlay" hidden>
        <div class="download-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="downloadConfirmTitle">
            <p class="download-confirm-eyebrow">图片操作</p>
            <h2 id="downloadConfirmTitle">下载图片</h2>
            <p class="download-confirm-copy">是否下载这张图片？</p>
            <div class="download-confirm-actions">
                <button class="download-confirm-cancel" id="downloadCancelButton" type="button">取消</button>
                <button class="download-confirm-primary" id="downloadConfirmButton" type="button">下载图片</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 2: Add modal styles**

Add this CSS block before the loading animation section:

```css
        body.modal-open {
            overflow: hidden;
        }

        .image-preview-overlay,
        .download-confirm-overlay {
            position: fixed;
            inset: 0;
            z-index: 2000;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.88);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }

        .image-preview-overlay.active,
        .download-confirm-overlay.active {
            opacity: 1;
            pointer-events: auto;
        }

        .image-preview-image {
            max-width: min(92vw, 900px);
            max-height: 84vh;
            object-fit: contain;
            border-radius: 8px;
            box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
        }

        .image-preview-close {
            position: absolute;
            top: max(18px, env(safe-area-inset-top));
            right: max(18px, env(safe-area-inset-right));
            width: 44px;
            height: 44px;
            border: 1px solid rgba(212, 175, 55, 0.45);
            border-radius: 50%;
            background: rgba(26, 26, 26, 0.88);
            color: var(--accent-light);
            font-size: 28px;
            line-height: 1;
            cursor: pointer;
        }

        .download-confirm-dialog {
            width: min(88vw, 340px);
            background: rgba(26, 26, 26, 0.96);
            border: 1px solid rgba(212, 175, 55, 0.35);
            border-radius: 10px;
            padding: 22px;
            box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
            text-align: center;
        }

        .download-confirm-eyebrow {
            color: var(--accent-gold);
            font-size: 12px;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }

        .download-confirm-dialog h2 {
            color: var(--accent-light);
            font-size: 22px;
            font-weight: 500;
            margin-bottom: 10px;
        }

        .download-confirm-copy {
            color: var(--text-secondary);
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 20px;
        }

        .download-confirm-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }

        .download-confirm-actions button {
            min-height: 42px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: transform 0.2s ease, background 0.2s ease;
        }

        .download-confirm-actions button:active {
            transform: scale(0.98);
        }

        .download-confirm-cancel {
            background: rgba(255, 255, 255, 0.08);
            color: var(--text-secondary);
            border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .download-confirm-primary {
            background: var(--accent-gold);
            color: var(--primary-bg);
            font-weight: 600;
        }
```

- [ ] **Step 3: Add JavaScript helpers**

Add these helpers before `loadProducts()`:

```javascript
        const LONG_PRESS_DELAY = 600;
        const LONG_PRESS_MOVE_TOLERANCE = 12;

        let longPressTimer = null;
        let longPressStartX = 0;
        let longPressStartY = 0;
        let suppressNextImageClick = false;
        let pendingDownloadImage = null;
        let imageInteractionsReady = false;

        function escapeAttribute(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        function getImageContext(img) {
            if (!img) return null;
            const src = img.dataset.original || img.currentSrc || img.src;
            if (!src || src === PLACEHOLDER_IMAGE || src.startsWith('data:image/svg+xml')) return null;
            const card = img.closest('.product-card');
            const productName = img.dataset.productName || card?.querySelector('.product-name')?.textContent || img.alt || 'product-image';
            return { src, name: productName.trim() || 'product-image' };
        }

        function sanitizeFilename(name) {
            const cleaned = String(name || 'product-image')
                .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            return cleaned || 'product-image';
        }

        function getImageExtension(src) {
            try {
                const url = new URL(src, window.location.href);
                const match = url.pathname.match(/\.(avif|gif|jpe?g|png|webp)$/i);
                return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
            } catch (error) {
                return '.jpg';
            }
        }

        function getDownloadFilename(context) {
            return `${sanitizeFilename(context.name)}${getImageExtension(context.src)}`;
        }
```

- [ ] **Step 4: Update `renderProducts()` image markup**

Add `data-product-name="${escapeAttribute(product.name)}"` to each product image. Use `escapeAttribute()` for the `src`, `alt`, `data-original`, product name, and displayed text values.

- [ ] **Step 5: Add preview, confirmation, and download functions**

Add this function block after `getDownloadFilename()`:

```javascript
        function setModalOpen(open) {
            document.body.classList.toggle('modal-open', open);
        }

        function showOverlay(overlay) {
            if (!overlay) return;
            overlay.hidden = false;
            requestAnimationFrame(() => overlay.classList.add('active'));
        }

        function hideOverlay(overlay) {
            if (!overlay) return;
            overlay.classList.remove('active');
            overlay.hidden = true;
        }

        function openImagePreviewFromImage(img) {
            const context = getImageContext(img);
            if (!context) return;

            const overlay = document.getElementById('imagePreviewOverlay');
            const previewImage = document.getElementById('imagePreviewImage');
            previewImage.src = context.src;
            previewImage.alt = context.name;
            showOverlay(overlay);
            setModalOpen(true);
        }

        function closeImagePreview() {
            const overlay = document.getElementById('imagePreviewOverlay');
            const previewImage = document.getElementById('imagePreviewImage');
            hideOverlay(overlay);
            previewImage.removeAttribute('src');
            setModalOpen(!document.getElementById('downloadConfirmOverlay').hidden);
        }

        function openDownloadConfirmFromImage(img) {
            const context = getImageContext(img);
            if (!context) return;

            pendingDownloadImage = context;
            showOverlay(document.getElementById('downloadConfirmOverlay'));
            setModalOpen(true);
        }

        function closeDownloadConfirm() {
            pendingDownloadImage = null;
            hideOverlay(document.getElementById('downloadConfirmOverlay'));
            setModalOpen(!document.getElementById('imagePreviewOverlay').hidden);
        }

        function triggerImageDownload(context) {
            const link = document.createElement('a');
            link.href = context.src;
            link.download = getDownloadFilename(context);
            link.target = '_blank';
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        async function downloadPendingImage() {
            if (!pendingDownloadImage) return;
            const context = pendingDownloadImage;
            closeDownloadConfirm();

            try {
                triggerImageDownload(context);
            } catch (error) {
                window.open(context.src, '_blank', 'noopener');
            }
        }

        function clearLongPressTimer() {
            if (!longPressTimer) return;
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        function initImageInteractions() {
            if (imageInteractionsReady) return;
            imageInteractionsReady = true;

            const previewOverlay = document.getElementById('imagePreviewOverlay');
            const previewClose = document.getElementById('imagePreviewClose');
            const confirmOverlay = document.getElementById('downloadConfirmOverlay');
            const cancelButton = document.getElementById('downloadCancelButton');
            const confirmButton = document.getElementById('downloadConfirmButton');

            document.addEventListener('pointerdown', (e) => {
                const img = e.target.closest('.product-image');
                if (!img || (e.pointerType === 'mouse' && e.button !== 0)) return;

                clearLongPressTimer();
                longPressStartX = e.clientX;
                longPressStartY = e.clientY;
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    suppressNextImageClick = true;
                    openDownloadConfirmFromImage(img);
                }, LONG_PRESS_DELAY);
            }, { passive: true });

            document.addEventListener('pointermove', (e) => {
                if (!longPressTimer) return;
                const diffX = Math.abs(e.clientX - longPressStartX);
                const diffY = Math.abs(e.clientY - longPressStartY);
                if (diffX > LONG_PRESS_MOVE_TOLERANCE || diffY > LONG_PRESS_MOVE_TOLERANCE) {
                    clearLongPressTimer();
                }
            }, { passive: true });

            document.addEventListener('pointerup', clearLongPressTimer, { passive: true });
            document.addEventListener('pointercancel', clearLongPressTimer, { passive: true });

            document.addEventListener('click', (e) => {
                const img = e.target.closest('.product-image');
                if (!img) return;

                e.preventDefault();
                e.stopImmediatePropagation();

                if (suppressNextImageClick) {
                    suppressNextImageClick = false;
                    return;
                }

                openImagePreviewFromImage(img);
            });

            document.addEventListener('contextmenu', (e) => {
                if (!e.target.closest('.product-image')) return;
                e.preventDefault();
            });

            previewOverlay.addEventListener('click', (e) => {
                if (e.target === previewOverlay) closeImagePreview();
            });
            previewClose.addEventListener('click', closeImagePreview);

            confirmOverlay.addEventListener('click', (e) => {
                if (e.target === confirmOverlay) closeDownloadConfirm();
            });
            cancelButton.addEventListener('click', closeDownloadConfirm);
            confirmButton.addEventListener('click', downloadPendingImage);

            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                closeImagePreview();
                closeDownloadConfirm();
            });
        }
```

- [ ] **Step 6: Initialize interactions after products render**

In the `DOMContentLoaded` callback, call `initImageInteractions()` after `renderProducts(products)` and before `initPullToRefresh()`.

- [ ] **Step 7: Run the focused test to verify it passes**

Run: `node --test tests/image-interactions.test.js`

Expected: PASS.

## Task 3: Browser Verification

**Files:**
- Verify: `index.html`

- [ ] **Step 1: Serve the static page locally**

Run: `python3 -m http.server 8000`

Expected: local server starts at `http://localhost:8000/`.

- [ ] **Step 2: Open the display page in the in-app browser**

Open: `http://localhost:8000/index.html`

Expected: product cards render with the existing black/gold style.

- [ ] **Step 3: Verify image click**

Click a product image.

Expected: full-screen preview opens, image is centered, close button and backdrop close the preview.

- [ ] **Step 4: Verify long-press**

Long-press a product image for more than 600 ms.

Expected: styled download confirmation opens, the full-screen preview does not open, Cancel closes the prompt, and Download triggers the download/open-image path.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/image-interactions.test.js docs/superpowers/plans/2026-05-15-image-preview-download.md
git commit -m "Add product image preview and download prompt"
```
