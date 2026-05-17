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
    const windowListeners = {};
    const createdAnchors = [];
    const shareCalls = [];
    const body = new FakeElement('body', 'body');
    const documentElement = new FakeElement('html', 'html');
    documentElement.scrollTop = 0;

    class FakeFile {
        constructor(parts, name, options = {}) {
            this.parts = parts;
            this.name = name;
            this.type = options.type || '';
            this.size = parts.reduce((total, part) => total + (part.size || String(part).length), 0);
        }
    }

    const ids = [
        'productsGrid',
        'backToTopButton',
        'pullRefreshIndicator',
        'imagePreviewOverlay',
        'imagePreviewImage',
        'imagePreviewClose',
        'downloadConfirmOverlay',
        'downloadConfirmCopy',
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
        documentElement,
        scrollingElement: documentElement,
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
            isSecureContext: true,
            openCalls: [],
            scrollToCalls: [],
            open(url, target, features) {
                this.openCalls.push({ url, target, features });
            },
            scrollTo(options) {
                this.scrollToCalls.push(options);
                this.scrollY = 0;
            },
            addEventListener(type, handler) {
                windowListeners[type] ||= [];
                windowListeners[type].push(handler);
            },
            dispatchEvent(event) {
                for (const handler of windowListeners[event.type] || []) {
                    handler(event);
                }
            },
            scrollY: 0,
        },
        navigator: {
            canShare: () => true,
            async share(payload) {
                shareCalls.push(payload);
            },
        },
        File: FakeFile,
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (callback) => callback(),
        Math,
        Date,
        URL,
        fetch: async (url) => {
            if (String(url).includes('products.json')) {
                return { ok: true, json: async () => ({ products: [] }) };
            }
            return {
                ok: true,
                blob: async () => ({ size: 12, type: 'image/jpeg' }),
            };
        },
        createdAnchors,
        shareCalls,
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
    assert.match(html, /draggable="false"/);
});

test('product images disable the native mobile image callout', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    assert.match(html, /\.product-image\s*\{[\s\S]*-webkit-touch-callout:\s*none;/);
    assert.match(html, /\.product-image\s*\{[\s\S]*-webkit-user-select:\s*none;/);
    assert.match(html, /\.product-image\s*\{[\s\S]*user-select:\s*none;/);
    assert.match(html, /\.product-image\s*\{[\s\S]*-webkit-user-drag:\s*none;/);
});

test('filterProducts matches product names by single character or text', () => {
    const sandbox = createSandbox();
    const products = [
        { id: 1, name: '皮质钱包', price: '599', image: 'images/wallet.jpg' },
        { id: 2, name: '水杯', price: '20', image: 'images/cup.jpg' },
        { id: 3, name: '火锅', price: '123', image: 'images/hotpot.jpg' },
    ];

    assert.deepEqual(sandbox.filterProducts(products, '钱').map((product) => product.name), ['皮质钱包']);
    assert.deepEqual(sandbox.filterProducts(products, '水杯').map((product) => product.name), ['水杯']);
    assert.deepEqual(sandbox.filterProducts(products, ' ').map((product) => product.name), ['皮质钱包', '水杯', '火锅']);
});

test('back-to-top button appears after scrolling and returns to the top', () => {
    const sandbox = createSandbox();
    const button = sandbox.elements.get('backToTopButton');

    sandbox.initBackToTop();
    assert.equal(button.hidden, true);

    sandbox.window.scrollY = 180;
    sandbox.window.dispatchEvent({ type: 'scroll' });
    assert.equal(button.hidden, false);
    assert.equal(button.classList.contains('visible'), true);

    button.dispatchEvent(createEvent('click', button));
    assert.equal(sandbox.window.scrollToCalls[0].top, 0);
    assert.equal(sandbox.window.scrollToCalls[0].behavior, 'smooth');

    sandbox.window.dispatchEvent({ type: 'scroll' });
    assert.equal(button.hidden, true);
    assert.equal(button.classList.contains('visible'), false);
});

test('back-to-top falls back when smooth scroll API is unavailable', () => {
    const sandbox = createSandbox();
    const button = sandbox.elements.get('backToTopButton');
    sandbox.window.scrollTo = undefined;

    sandbox.initBackToTop();
    sandbox.window.scrollY = 180;
    sandbox.document.scrollingElement.scrollTop = 180;
    sandbox.window.dispatchEvent({ type: 'scroll' });
    button.dispatchEvent(createEvent('click', button));

    assert.equal(sandbox.document.scrollingElement.scrollTop, 0);
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

test('confirming share opens the system share sheet with an image file', async () => {
    const sandbox = createSandbox();
    sandbox.initImageInteractions();
    const image = makeProductImage('火锅 套餐', 'https://cdn.example.test/hotpot.jpg');

    sandbox.openDownloadConfirmFromImage(image);
    sandbox.elements.get('downloadConfirmButton').dispatchEvent(createEvent('click', sandbox.elements.get('downloadConfirmButton')));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(sandbox.createdAnchors.length, 0);
    assert.equal(sandbox.shareCalls.length, 1);
    assert.equal(sandbox.shareCalls[0].files[0].name, '火锅 套餐.jpg');
    assert.equal(sandbox.shareCalls[0].files[0].type, 'image/jpeg');
    assert.equal(sandbox.elements.get('downloadConfirmOverlay').hidden, true);
});

test('share failure keeps the user in the page instead of opening the image url', async () => {
    const sandbox = createSandbox();
    sandbox.navigator.share = undefined;
    sandbox.initImageInteractions();
    const image = makeProductImage('头像', 'https://cdn.jsdelivr.net/avatar.jpg');

    sandbox.openDownloadConfirmFromImage(image);
    sandbox.elements.get('downloadConfirmButton').dispatchEvent(createEvent('click', sandbox.elements.get('downloadConfirmButton')));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(sandbox.createdAnchors.length, 0);
    assert.equal(sandbox.window.openCalls.length, 0);
    assert.equal(sandbox.elements.get('downloadConfirmOverlay').hidden, false);
    assert.match(sandbox.elements.get('downloadConfirmCopy').textContent, /当前浏览器/);
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
