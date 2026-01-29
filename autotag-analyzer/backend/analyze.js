import { chromium } from "playwright";

/* =========================
   Constants
========================= */
const IGNORED_EVENTS = ['scroll', 'user_engagement', 'first_visit'];
const ECOMMERCE_PARAMS = new Set([
  'ep.currency', 'ep.transaction_id', 'ep.coupon',
  'epn.value', 'epn.tax', 'epn.shipping',
  'ep.payment_info', 'ep.shipping_tier',
  'ep.item_list_id', 'ep.item_list_name'
]);

/* =========================
   queryString -> object (Safe)
========================= */
function queryStringToObject(str) {
  if (!str || typeof str !== "string") return {};

  const obj = {};
  str.split("&").forEach(pair => {
    if (!pair) return;
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) return;

    const k = pair.substring(0, eqIndex);
    const v = pair.substring(eqIndex + 1);

    if (!k) return;

    try {
      obj[decodeURIComponent(k)] = decodeURIComponent(v || "");
    } catch {
      obj[k] = v || "";
    }
  });
  return obj;
}

/* =========================
   Product String Parser
========================= */
function parseProductString(productString) {
  const convertItem = {
    id: "item_id", nm: "item_name", lp: "index", br: "item_brand",
    ca: "item_category", c2: "item_category2", c3: "item_category3",
    c4: "item_category4", c5: "item_category5", pr: "price",
    qt: "quantity", va: "item_variant", cp: "coupon", ds: "discount",
    li: "item_list_id", ln: "item_list_name", af: "affiliation", lo: "location_id"
  };

  const parts = productString.split("~");
  const result = [];
  let lastKey = "";

  parts.forEach((part) => {
    let key = part.substring(0, 2);
    let value = part.substring(2);

    if (key.startsWith("k")) {
      lastKey = value;
    } else if (key.startsWith("v") && lastKey) {
      result.push({ key: convertItem[lastKey] || lastKey, value });
      lastKey = "";
    } else if (["lp", "qt", "pr", "ds"].includes(key)) {
      result.push({ key: convertItem[key] || key, value: Number(value) });
    } else {
      result.push({ key: convertItem[key] || key, value });
    }
  });

  return result;
}

/* =========================
   GA4 Parameters Extractor (Improved)
========================= */
function extractGA4Parameters(params) {
  const result = {
    en: params.en || params.event_name || '',
    ep: [],
    epn: [],
    up: [],
    upn: [],
    eco: [],
    products: [],
    meta: {}
  };

  const processedKeys = new Set();

  for (const [key, value] of Object.entries(params)) {
    if (processedKeys.has(key)) continue;
    processedKeys.add(key);

    // Meta info
    if (['tid', 'cid', 'sid', '_p', 'dl', 'dr', 'dt', 'ul', 'sr', 'en', 'event_name'].includes(key)) {
      if (!['en', 'event_name'].includes(key)) {
        result.meta[key] = value;
      }
      continue;
    }

    // Product info (pr1, pr2, ...)
    if (/^pr\d*$/.test(key)) {
      try {
        result.products.push(parseProductString(value));
      } catch {}
      continue;
    }

    // Ecommerce params
    if (ECOMMERCE_PARAMS.has(key)) {
      const paramKey = key.split('.').slice(1).join('.') || key;
      const paramValue = key.startsWith('epn.') ? Number(value) : value;
      result.eco.push({ key: paramKey, value: paramValue });
      continue;
    }

    // Event params (ep.)
    if (key.startsWith('ep.')) {
      result.ep.push({ key: key.substring(3), value });
      continue;
    }

    // Numeric event params (epn.)
    if (key.startsWith('epn.')) {
      result.epn.push({ key: key.substring(4), value: Number(value) });
      continue;
    }

    // User properties (up.)
    if (key.startsWith('up.')) {
      result.up.push({ key: key.substring(3), value });
      continue;
    }

    // Numeric user properties (upn.)
    if (key.startsWith('upn.')) {
      result.upn.push({ key: key.substring(4), value: Number(value) });
      continue;
    }
  }

  // Currency
  if (params.cu) {
    result.eco.push({ key: 'currency', value: params.cu });
  }

  // Clean empty arrays
  if (result.epn.length === 0) delete result.epn;
  if (result.up.length === 0) delete result.up;
  if (result.upn.length === 0) delete result.upn;
  if (result.eco.length === 0) delete result.eco;
  if (result.products.length === 0) delete result.products;

  return result;
}

/* =========================
   GA4 Event Collector Class
========================= */
class GA4EventCollector {
  constructor() {
    this.collectedEvents = [];
    this.seenEventHashes = new Set();
    this.eventSequenceCounter = 0; // 이벤트 순차 번호 (같은 시간에 발생한 이벤트 구분용)
  }

  isGA4Request(url) {
    const ga4Patterns = [
      /google-analytics\.com\/g\/collect/,
      /analytics\.google\.com\/g\/collect/,
      /www\.google-analytics\.com\/g\/collect/
    ];

    const excludePatterns = [
      /stats\.g\.doubleclick\.net/,
      /google-analytics\.com\/j\//,
      /google-analytics\.com\/collect\?(?!.*v=2)/
    ];

    const isGA4 = ga4Patterns.some(p => p.test(url));
    const shouldExclude = excludePatterns.some(p => p.test(url));

    return isGA4 && !shouldExclude;
  }

  parseGA4Request(req, urlParams) {
    const events = [];
    const postData = req.postData();

    if (req.method() === 'POST' && postData) {
      events.push(...this.parsePostBody(postData, urlParams));
    } else if (urlParams.en) {
      events.push(extractGA4Parameters(urlParams));
    }

    return events;
  }

  parsePostBody(postData, urlParams) {
    const events = [];

    // Chrome Extension 방식: en= 기준으로 split 후 첫 번째 제외
    const eventParts = postData.split('en=').slice(1);

    if (eventParts.length === 0) {
      // en=이 없는 경우 전체를 하나의 이벤트로 처리
      const allParams = queryStringToObject(postData);
      if (urlParams.en || allParams.en) {
        events.push(extractGA4Parameters({ ...allParams, ...urlParams }));
      }
    } else {
      // 각 이벤트 파싱
      eventParts.forEach(eventStr => {
        const eventParams = queryStringToObject('en=' + eventStr);
        events.push(extractGA4Parameters({ ...urlParams, ...eventParams }));
      });
    }

    return events;
  }

  generateEventHash(event, timestamp, sequenceNumber = 0) {
    // 타임스탬프를 밀리초 단위로 사용하고, 순차 번호를 추가하여 더 정확하게 구분
    // 같은 클릭에서 여러 번 전송된 경우만 중복으로 처리
    const epStr = event.ep?.map(p => `${p.key}=${p.value}`).sort().join(',') || '';
    // 이벤트명, 파라미터, 타임스탬프, 순차 번호로 해시 생성
    return `${event.en}|${epStr}|${timestamp}|${sequenceNumber}`;
  }

  isDuplicateInWindow(event, timestamp, sequenceNumber) {
    // 순차 번호를 포함하여 같은 이벤트도 구분
    // 서로 다른 요소에서 발생한 이벤트는 순차 번호가 다르므로 모두 저장됨
    const epStr = event.ep?.map(p => `${p.key}=${p.value}`).sort().join(',') || '';
    // 순차 번호를 포함하여 해시 생성 (같은 시간, 같은 파라미터여도 순차 번호가 다르면 다른 이벤트)
    const hash = `${event.en}|${epStr}|${timestamp}|${sequenceNumber}`;
    
    // 같은 해시가 이미 있으면 중복으로 간주 (거의 불가능하지만 안전장치)
    if (this.seenEventHashes.has(hash)) {
      return true;
    }
    
    // 해시 저장 (타임스탬프 + 순차 번호 단위로 저장)
    this.seenEventHashes.add(hash);
    
    // 100ms 후 해시 제거 (메모리 관리, 매우 짧은 시간만 유지)
    setTimeout(() => {
      this.seenEventHashes.delete(hash);
    }, 100);
    
    return false;
  }

  addEvent(pageUrl, eventData) {
    const now = Date.now();
    this.eventSequenceCounter++; // 순차 번호 증가

    // 순차 번호를 포함하여 중복 체크
    // 같은 시간, 같은 파라미터여도 순차 번호가 다르면 다른 이벤트로 처리
    // 서로 다른 요소에서 발생한 동일 이벤트는 순차 번호로 구분하여 모두 저장
    const isDuplicate = this.isDuplicateInWindow(eventData, now, this.eventSequenceCounter);
    
    if (isDuplicate) {
      console.log(`  🔄 중복 이벤트 감지 (순차번호: ${this.eventSequenceCounter}): ${eventData.en}`);
      console.log(`     이벤트 파라미터: ${JSON.stringify(eventData.ep?.map(p => `${p.key}=${p.value}`) || [])}`);
      return false;
    }

    // 이벤트 저장
    this.collectedEvents.push({
      time: now,
      url: pageUrl,
      eventName: eventData.en,
      eventData,
      sequenceNumber: this.eventSequenceCounter // 순차 번호도 저장
    });
    
    // 디버깅: 같은 파라미터를 가진 이벤트가 여러 개인 경우 로그 출력
    const sameParamEvents = this.collectedEvents.filter(e => {
      if (e.eventName !== eventData.en) return false;
      const currentEpStr = eventData.ep?.map(p => `${p.key}=${p.value}`).sort().join(',') || '';
      const eventEpStr = e.eventData?.ep?.map(p => `${p.key}=${p.value}`).sort().join(',') || '';
      return currentEpStr === eventEpStr && currentEpStr.length > 0;
    });
    
    if (sameParamEvents.length > 1) {
      console.log(`  📊 같은 파라미터를 가진 ${eventData.en} 이벤트: ${sameParamEvents.length}개 (순차번호: ${sameParamEvents.map(e => e.sequenceNumber).join(', ')})`);
    }
    
    return true;
  }

  getEvents() {
    return this.collectedEvents;
  }

  getEventsSince(startIndex) {
    return this.collectedEvents.slice(startIndex);
  }

  reset() {
    this.collectedEvents = [];
    this.seenEventHashes.clear();
  }
}

/* =========================
   Screenshot Manager Class (Overlay-based)
========================= */
class ScreenshotManager {
  constructor(page) {
    this.page = page;
    this.overlayId = '__ga4_highlight_overlay__';
  }

  async captureWithHighlight(element, selector) {
    try {
      // Validate element
      const isValid = await element.evaluate(el => !!el && el.isConnected).catch(() => false);
      if (!isValid) {
        console.log(`  ⚠ 요소가 유효하지 않음: ${selector}`);
        return null;
      }

      // Scroll to element
      await this.scrollToElement(element);

      // Get bounding box
      const boundingBox = await element.boundingBox();
      if (!boundingBox) {
        console.log(`  ⚠ boundingBox 없음: ${selector}`);
        return await this.takeScreenshotOnly();
      }

      // Create highlight overlay (no style modification)
      await this.createHighlightOverlay(boundingBox);

      // Wait for render
      await this.page.evaluate(() => {
        return new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
      await this.page.waitForTimeout(200);

      // Take screenshot
      const screenshotBuffer = await this.page.screenshot({
        type: 'png',
        fullPage: true
      });

      // Remove overlay
      await this.removeHighlightOverlay();

      if (screenshotBuffer && screenshotBuffer.length > 0) {
        console.log(`  📸 스크린샷 촬영 성공 (${Math.round(screenshotBuffer.length / 1024)}KB)`);
        return screenshotBuffer.toString('base64');
      }
      return null;

    } catch (e) {
      console.log(`  ⚠ 스크린샷 실패: ${e.message}`);
      await this.removeHighlightOverlay().catch(() => {});
      return null;
    }
  }

  async scrollToElement(element) {
    try {
      await element.scrollIntoViewIfNeeded({ timeout: 3000 });
      await this.page.waitForTimeout(200);

      const viewport = this.page.viewportSize();
      const box = await element.boundingBox();

      if (box && viewport) {
        const targetY = Math.max(0, box.y - (viewport.height / 2) + (box.height / 2));
        await this.page.evaluate((y) => {
          window.scrollTo({ top: y, behavior: 'instant' });
        }, targetY);
        await this.page.waitForTimeout(100);
      }
    } catch {}
  }

  async createHighlightOverlay(box) {
    await this.page.evaluate(({ box, id }) => {
      const existing = document.getElementById(id);
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = id;
      overlay.style.cssText = `
        position: absolute;
        left: ${box.x + window.scrollX}px;
        top: ${box.y + window.scrollY}px;
        width: ${box.width}px;
        height: ${box.height}px;
        border: 4px solid #ff0000;
        box-shadow: 0 0 0 4px rgba(255, 0, 0, 0.3), 0 0 20px rgba(255, 0, 0, 0.5);
        background: rgba(255, 0, 0, 0.1);
        pointer-events: none;
        z-index: 2147483647;
        box-sizing: border-box;
      `;

      document.body.appendChild(overlay);
    }, { box, id: this.overlayId });
  }

  async removeHighlightOverlay() {
    await this.page.evaluate((id) => {
      const overlay = document.getElementById(id);
      if (overlay) overlay.remove();
    }, this.overlayId);
  }

  async takeScreenshotOnly() {
    try {
      const buffer = await this.page.screenshot({ type: 'png', fullPage: true });
      return buffer ? buffer.toString('base64') : null;
    } catch {
      return null;
    }
  }
}

/* =========================
   SPA Navigation Manager Class
========================= */
class SPANavigationManager {
  constructor(page) {
    this.page = page;
    this.originalUrl = null;
    this.domSnapshot = null;
  }

  async initialize() {
    this.originalUrl = this.page.url();
    this.domSnapshot = await this.takeDOMSnapshot();

    // Monitor History API (don't block, just track)
    await this.page.evaluate(() => {
      window.__spaNavHistory = [];

      const originalPushState = history.pushState.bind(history);
      const originalReplaceState = history.replaceState.bind(history);

      history.pushState = function(...args) {
        window.__spaNavHistory.push({ type: 'pushState', url: args[2], time: Date.now() });
        return originalPushState(...args);
      };

      history.replaceState = function(...args) {
        window.__spaNavHistory.push({ type: 'replaceState', url: args[2], time: Date.now() });
        return originalReplaceState(...args);
      };

      window.addEventListener('popstate', () => {
        window.__spaNavHistory.push({ type: 'popstate', time: Date.now() });
      });
    });
  }

  async takeDOMSnapshot() {
    return await this.page.evaluate(() => {
      const body = document.body;
      const text = body.innerText || '';
      return {
        textLength: text.length,
        textSample: text.substring(0, 500),
        childCount: body.children.length,
        visibleChildCount: Array.from(body.children).filter(c => {
          const style = window.getComputedStyle(c);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }).length,
        hash: window.location.hash,
        pathname: window.location.pathname
      };
    }).catch(() => null);
  }

  async detectSignificantChange() {
    const current = await this.takeDOMSnapshot();
    if (!current || !this.domSnapshot) return false;

    const significantChange = (
      Math.abs(current.textLength - this.domSnapshot.textLength) > 200 ||
      Math.abs(current.childCount - this.domSnapshot.childCount) > 5 ||
      current.hash !== this.domSnapshot.hash ||
      current.pathname !== this.domSnapshot.pathname
    );

    if (significantChange) {
      this.domSnapshot = current;
    }

    return significantChange;
  }

  async waitForStableDOM(options = {}) {
    const { maxWait = 5000, checkInterval = 200, stableThreshold = 3 } = options;

    let stableCount = 0;
    let lastSnapshot = await this.takeDOMSnapshot();
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await this.page.waitForTimeout(checkInterval);

      const currentSnapshot = await this.takeDOMSnapshot();
      if (!currentSnapshot || !lastSnapshot) break;

      const isStable = (
        currentSnapshot.textLength === lastSnapshot.textLength &&
        currentSnapshot.childCount === lastSnapshot.childCount
      );

      if (isStable) {
        stableCount++;
        if (stableCount >= stableThreshold) {
          console.log(`  ✓ DOM 안정화 완료 (${Date.now() - startTime}ms)`);
          return true;
        }
      } else {
        stableCount = 0;
        lastSnapshot = currentSnapshot;
      }
    }

    console.log(`  ⚠ DOM 안정화 타임아웃 (${maxWait}ms)`);
    return false;
  }

  getCurrentUrl() {
    return this.page.url();
  }

  hasUrlChanged() {
    return this.page.url() !== this.originalUrl;
  }
}

/* =========================
   Selector Generator (Improved)
========================= */
function generateRobustSelector(el) {
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();

  const isUnique = (sel) => {
    try {
      const matches = doc.querySelectorAll(sel);
      return matches.length === 1;
    } catch {
      return false;
    }
  };

  const isValidId = (id) => {
    return id && !id.match(/^\d/) && !id.includes(' ') && id.length < 100;
  };

  const filterDynamicClasses = (classList) => {
    const dynamicPatterns = [
      /^[a-z]{1,3}[_-][a-f0-9]{4,}$/i,
      /^(is-|has-|js-|v-|ng-|_)/,
      /^(active|hover|focus|selected|open|closed|show|hide|loading|visible|hidden)$/i,
      /^\d+$/
    ];
    return [...classList].filter(cls =>
      cls.length > 1 && !dynamicPatterns.some(p => p.test(cls))
    );
  };

  // Strategy 1: ID only
  if (el.id && isValidId(el.id)) {
    const idSelector = `#${CSS.escape(el.id)}`;
    if (isUnique(idSelector)) return { selector: idSelector, type: 'id' };
  }

  // Strategy 2: Tag + classes
  if (el.classList.length > 0) {
    const classes = filterDynamicClasses(el.classList);
    if (classes.length > 0) {
      const classSelector = `${tag}${classes.map(c => `.${CSS.escape(c)}`).join('')}`;
      if (isUnique(classSelector)) return { selector: classSelector, type: 'class' };
    }
  }

  // Strategy 3: Full path with nth-of-type
  const path = [];
  let current = el;

  while (current && current !== doc.body && current !== doc.documentElement && path.length < 10) {
    let part = current.tagName.toLowerCase();

    if (current.id && isValidId(current.id)) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // nth-of-type calculation
    let nthOfType = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) nthOfType++;
      sibling = sibling.previousElementSibling;
    }
    part += `:nth-of-type(${nthOfType})`;

    path.unshift(part);
    current = current.parentElement;
  }

  return { selector: path.join(' > '), type: 'path' };
}

/* =========================
   Clickable Element Detector (Improved)
========================= */
function isClickableElement(el) {
  // Stage 1: Definite interactive elements (high confidence)
  const interactiveTags = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'];

  if (interactiveTags.includes(el.tagName)) {
    // A tag filtering
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      // Include: hash links, javascript links, or has onclick
      if (!href || href === '#' || href.startsWith('javascript:') ||
          href.startsWith('#') || el.onclick || el.hasAttribute('onclick')) {
        return { clickable: true, confidence: 'high', reason: 'interactive-link' };
      }
      // Also include navigation links (may have GA4 events)
      return { clickable: true, confidence: 'medium', reason: 'navigation-link' };
    }

    // Hidden input exclusion
    if (el.tagName === 'INPUT' && el.type === 'hidden') {
      return { clickable: false, reason: 'hidden-input' };
    }

    return { clickable: true, confidence: 'high', reason: 'interactive-element' };
  }

  // Stage 2: GA4 attributes (high confidence)
  if (el.getAttribute('event_name') || el.hasAttribute('event_name')) {
    return { clickable: true, confidence: 'high', reason: 'ga4-event-name' };
  }

  const hasGA4Params = Array.from(el.attributes).some(attr =>
    attr.name.startsWith('ep_') || attr.name.startsWith('ep.')
  );
  if (hasGA4Params) {
    return { clickable: true, confidence: 'high', reason: 'ga4-params' };
  }

  // Stage 3: ARIA roles (high confidence)
  const role = el.getAttribute('role');
  if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') {
    return { clickable: true, confidence: 'high', reason: 'aria-role' };
  }

  if (el.getAttribute('tabindex') === '0') {
    return { clickable: true, confidence: 'medium', reason: 'tabindex' };
  }

  // Stage 4: onclick handler (medium confidence)
  if (el.onclick || el.getAttribute('onclick') || el.getAttribute('data-onclick')) {
    return { clickable: true, confidence: 'medium', reason: 'onclick-handler' };
  }

  // Stage 5: data-action or similar attributes
  const actionAttrs = ['data-action', 'data-click', 'data-toggle', 'data-target'];
  if (actionAttrs.some(attr => el.hasAttribute(attr))) {
    return { clickable: true, confidence: 'medium', reason: 'data-action' };
  }

  // Stage 6: cursor:pointer with additional conditions (low confidence)
  const style = window.getComputedStyle(el);
  if (style.cursor === 'pointer') {
    const hasMinSize = el.offsetWidth >= 20 && el.offsetHeight >= 20;
    const isContainer = ['DIV', 'SPAN', 'P', 'LABEL', 'LI', 'UL', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV'].includes(el.tagName);
    const hasClickableParent = el.closest('button, a, [role="button"]');
    const hasInteractiveChild = el.querySelector('button, a, input, select, textarea, [role="button"]');

    // Skip if parent is already clickable
    if (hasClickableParent && hasClickableParent !== el) {
      return { clickable: false, reason: 'parent-is-clickable' };
    }

    // Skip if has interactive child
    if (hasInteractiveChild) {
      return { clickable: false, reason: 'has-interactive-child' };
    }

    // Only include non-container elements with minimum size
    if (hasMinSize && !isContainer) {
      return { clickable: true, confidence: 'low', reason: 'cursor-pointer' };
    }
  }

  return { clickable: false, reason: 'not-clickable' };
}

/* =========================
   Element Deduplicator Class
========================= */
class ElementDeduplicator {
  constructor() {
    this.selectorSet = new Set();
    this.processedCount = 0;
  }

  isDuplicate(selector) {
    if (this.selectorSet.has(selector)) {
      return true;
    }
    return false;
  }

  add(selector) {
    this.selectorSet.add(selector);
    this.processedCount++;
  }

  has(selector) {
    return this.selectorSet.has(selector);
  }

  getCount() {
    return this.processedCount;
  }
}

/* =========================
   Find All Clickable Elements (Improved)
========================= */
async function findAllClickableElements(page) {
  try {
    // 페이지 끝까지 스크롤하여 모든 요소가 로드되도록 함
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            // 다시 맨 위로 스크롤
            window.scrollTo(0, 0);
            setTimeout(resolve, 300);
          }
        }, 100);
      });
    });

    const elements = await page.$$('*');
    const clickableElements = [];
    const seenSelectors = new Set();

    for (const el of elements) {
      try {
        // Visibility check - 뷰포트 밖도 포함하되, 실제로 렌더링된 요소만
        const isRendered = await el.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          // display: none, visibility: hidden, opacity: 0은 제외
          // 하지만 뷰포트 밖은 포함 (width > 0 && height > 0)
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity) > 0
          );
        }).catch(() => false);
        if (!isRendered) continue;

        // Disabled check
        const isDisabled = await el.evaluate(el => {
          return el.disabled || el.getAttribute('aria-disabled') === 'true';
        }).catch(() => false);
        if (isDisabled) continue;

        // Clickable check
        const clickableResult = await el.evaluate(isClickableElement).catch(() => ({ clickable: false }));
        if (!clickableResult.clickable) continue;

        // Generate selector
        const selectorResult = await el.evaluate(generateRobustSelector).catch(() => null);
        if (!selectorResult || !selectorResult.selector) continue;

        const selector = selectorResult.selector;

        // Uniqueness check
        if (seenSelectors.has(selector)) continue;

        // Verify selector actually matches one element
        const matchCount = await page.$$(selector).then(els => els.length).catch(() => 0);
        if (matchCount !== 1) {
          // Try with more specific selector
          const fullSelector = await el.evaluate((el) => {
            const path = [];
            let current = el;
            while (current && current !== document.body && path.length < 12) {
              let part = current.tagName.toLowerCase();
              if (current.id && !current.id.match(/^\d/)) {
                path.unshift(`#${CSS.escape(current.id)}`);
                break;
              }
              let nth = 1;
              let sib = current.previousElementSibling;
              while (sib) {
                if (sib.tagName === current.tagName) nth++;
                sib = sib.previousElementSibling;
              }
              part += `:nth-of-type(${nth})`;
              path.unshift(part);
              current = current.parentElement;
            }
            return path.join(' > ');
          }).catch(() => null);

          if (fullSelector && !seenSelectors.has(fullSelector)) {
            const fullMatchCount = await page.$$(fullSelector).then(els => els.length).catch(() => 0);
            if (fullMatchCount === 1) {
              seenSelectors.add(fullSelector);
              clickableElements.push({
                element: el,
                selector: fullSelector,
                confidence: clickableResult.confidence,
                reason: clickableResult.reason
              });
            }
          }
          continue;
        }

        seenSelectors.add(selector);
        clickableElements.push({
          element: el,
          selector,
          confidence: clickableResult.confidence,
          reason: clickableResult.reason
        });

      } catch {
        continue;
      }
    }

    // Filter out child elements of interactive parents
    const filteredElements = [];

    for (const elData of clickableElements) {
      const isChildOfInteractive = await elData.element.evaluate((el) => {
        const parent = el.parentElement;
        if (!parent) return false;
        const interactiveTags = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
        return interactiveTags.includes(parent.tagName);
      }).catch(() => false);

      if (!isChildOfInteractive) {
        filteredElements.push(elData);
      }
    }

    console.log(`  📋 클릭 가능 요소: ${filteredElements.length}개 발견`);
    return filteredElements;

  } catch (e) {
    console.error("요소 찾기 오류:", e);
    return [];
  }
}

/* =========================
   Wait for GA4 Events
========================= */
function waitForGA4Events(collector, startIndex, timeout = 4000) {
  return new Promise(resolve => {
    const startTime = Date.now();
    let lastCount = collector.getEvents().length;
    let stableTime = 0;
    const stableThreshold = 1000; // 1000ms 동안 새 이벤트 없으면 완료 (GA4 배치 전송 대응)

    const interval = setInterval(() => {
      const currentCount = collector.getEvents().length;

      if (currentCount > lastCount) {
        // 새 이벤트 감지 - 안정화 시간 리셋
        lastCount = currentCount;
        stableTime = 0;
      } else {
        // 이벤트 없음 - 안정화 시간 증가
        stableTime += 100;
      }

      // 안정화 완료 (새 이벤트 없이 1000ms 경과) 또는 타임아웃
      if (stableTime >= stableThreshold || Date.now() - startTime >= timeout) {
        clearInterval(interval);
        resolve(collector.getEventsSince(startIndex));
      }
    }, 100);
  });
}

/* =========================
   Popup Handler: 팝업 내 모든 버튼 클릭 후 닫기
========================= */
async function handlePopup(page, collector, screenshotManager) {
  try {
    // 모달 팝업 감지 (z-index가 높고, visible한 요소)
    const popupInfo = await page.evaluate(() => {
      // 일반적인 팝업 선택자들
      const popupSelectors = [
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="dialog"]',
        '[class*="overlay"]',
        '[id*="modal"]',
        '[id*="popup"]',
        '[id*="dialog"]',
        '[role="dialog"]',
        '[role="alertdialog"]'
      ];

      for (const selector of popupSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const style = window.getComputedStyle(el);
          const zIndex = parseInt(style.zIndex) || 0;
          
          // z-index가 높고, visible한 요소를 팝업으로 간주
          if (
            (zIndex >= 1000 || style.position === 'fixed' || style.position === 'absolute') &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity) > 0 &&
            el.offsetWidth > 0 &&
            el.offsetHeight > 0
          ) {
            // 팝업 내부의 모든 클릭 가능한 요소 찾기
            const buttons = el.querySelectorAll('button, a, [role="button"], [onclick], [data-action], input[type="button"], input[type="submit"]');
            const clickableButtons = Array.from(buttons).filter(btn => {
              const btnStyle = window.getComputedStyle(btn);
              return (
                btnStyle.display !== 'none' &&
                btnStyle.visibility !== 'hidden' &&
                parseFloat(btnStyle.opacity) > 0 &&
                !btn.disabled &&
                btn.offsetWidth > 0 &&
                btn.offsetHeight > 0
              );
            });

            if (clickableButtons.length > 0) {
              // 팝업 요소의 고유한 selector 생성
              let popupSelector = '';
              if (el.id) {
                popupSelector = `#${el.id}`;
              } else if (el.className) {
                const classes = el.className.split(' ').filter(c => c && !c.match(/^(is-|has-|js-|v-|ng-|_)/)).slice(0, 2).join('.');
                if (classes) {
                  popupSelector = `${el.tagName.toLowerCase()}.${classes}`;
                } else {
                  popupSelector = selector;
                }
              } else {
                popupSelector = selector;
              }

              return {
                found: true,
                selector: popupSelector,
                buttonCount: clickableButtons.length
              };
            }
          }
        }
      }

      return { found: false };
    });

    if (!popupInfo.found) {
      return false; // 팝업 없음
    }

    console.log(`  📢 모달 팝업 감지: ${popupInfo.buttonCount}개 버튼 발견`);

    // 팝업 내 모든 버튼 클릭 (페이지에서 직접 찾기)
    const buttonsClicked = await page.evaluate((popupSelector) => {
      const popup = document.querySelector(popupSelector);
      if (!popup) return { clicked: 0, total: 0 };

      // 팝업 내부의 모든 클릭 가능한 요소 찾기
      const buttons = popup.querySelectorAll('button, a, [role="button"], [onclick], [data-action], input[type="button"], input[type="submit"]');
      const clickableButtons = Array.from(buttons).filter(btn => {
        const btnStyle = window.getComputedStyle(btn);
        return (
          btnStyle.display !== 'none' &&
          btnStyle.visibility !== 'hidden' &&
          parseFloat(btnStyle.opacity) > 0 &&
          !btn.disabled &&
          btn.offsetWidth > 0 &&
          btn.offsetHeight > 0
        );
      });

      let clicked = 0;
      clickableButtons.forEach((btn, idx) => {
        try {
          btn.click();
          clicked++;
        } catch (e) {
          console.log(`팝업 버튼 ${idx + 1} 클릭 실패:`, e);
        }
      });

      return { clicked, total: clickableButtons.length };
    }, popupInfo.selector);

    console.log(`  🖱️ 팝업 버튼 ${buttonsClicked.clicked}/${buttonsClicked.total}개 클릭 완료`);
    
    // GA4 이벤트 대기
    await page.waitForTimeout(1000);

    // 모든 버튼 클릭 후 팝업이 닫혔는지 확인
    await page.waitForTimeout(1000);
    
    // 팝업 닫기 시도 (닫기 버튼이 있으면 클릭, 없으면 ESC 키 또는 배경 클릭)
    const isStillOpen = await page.evaluate(() => {
      const popupSelectors = [
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="dialog"]',
        '[role="dialog"]'
      ];

      for (const selector of popupSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const style = window.getComputedStyle(el);
          if (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity) > 0
          ) {
            return true;
          }
        }
      }
      return false;
    });

    if (isStillOpen) {
      // 팝업이 아직 열려있으면 닫기 시도
      console.log(`  🔄 팝업이 아직 열려있음, 닫기 시도...`);
      
      // ESC 키 누르기
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
      // 배경 클릭 시도
      await page.evaluate(() => {
        const overlays = document.querySelectorAll('[class*="overlay"], [class*="backdrop"]');
        for (const overlay of overlays) {
          const style = window.getComputedStyle(overlay);
          if (style.display !== 'none') {
            overlay.click();
            break;
          }
        }
      });
      
      await page.waitForTimeout(500);
      console.log(`  ✓ 팝업 닫기 완료`);
    } else {
      console.log(`  ✓ 팝업이 자동으로 닫힘`);
    }

    return true; // 팝업 처리 완료
  } catch (e) {
    console.log(`  ⚠ 팝업 처리 오류: ${e.message}`);
    return false;
  }
}

/* =========================
   Click All Buttons (Improved)
========================= */
async function clickAllButtons(page, collector, results, deduplicator, screenshotManager, spaManager, sendEvent) {
  let hasMoreButtons = true;
  let iteration = 0;
  const maxIterations = 30;
  const allClickedButtons = []; // 모든 반복에서 클릭한 버튼 정보 저장
  let totalButtonsFound = 0;
  let totalButtonsClicked = 0;

  // 분석 시작 알림
  if (sendEvent) {
    sendEvent('status', { 
      message: '분석 시작',
      stage: 'initializing',
      progress: 0 
    });
  }

  while (hasMoreButtons && iteration < maxIterations) {
    iteration++;

    // 진행 상황 업데이트
    if (sendEvent) {
      sendEvent('status', { 
        message: `페이지 스캔 중... (반복 ${iteration}/${maxIterations})`,
        stage: 'scanning',
        progress: Math.min(90, (iteration / maxIterations) * 50),
        iteration,
        maxIterations
      });
    }

    // Wait for page stability
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await spaManager.waitForStableDOM({ maxWait: 3000 });

    // 팝업 체크 및 처리
    const popupHandled = await handlePopup(page, collector, screenshotManager);
    if (popupHandled) {
      // 팝업 처리 후 DOM 안정화 대기
      await page.waitForTimeout(1000);
      await spaManager.waitForStableDOM({ maxWait: 2000 });
    }

    // 페이지를 맨 위로 스크롤하여 모든 요소를 다시 스캔할 수 있도록 함
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(300);

    // Find clickable elements
    if (sendEvent) {
      sendEvent('status', { 
        message: `클릭 가능한 요소 탐색 중...`,
        stage: 'finding',
        progress: Math.min(90, (iteration / maxIterations) * 50 + 10)
      });
    }
    
    const elements = await findAllClickableElements(page);
    totalButtonsFound = Math.max(totalButtonsFound, elements.length);
    console.log(`\n📋 [반복 ${iteration}] 클릭 가능 요소: ${elements.length}개`);
    
    if (sendEvent) {
      sendEvent('status', { 
        message: `${elements.length}개의 클릭 가능한 요소 발견`,
        stage: 'found',
        progress: Math.min(90, (iteration / maxIterations) * 50 + 15),
        elementsFound: elements.length
      });
    }

    // 현재 URL 저장 (이 페이지의 요소인지 확인용)
    const currentPageUrl = page.url();
    const buttonsToClick = [];

    for (const elData of elements) {
      if (deduplicator.has(elData.selector)) continue;

      // 요소가 실제로 렌더링되었는지 확인 (뷰포트 밖도 포함)
      const isRendered = await elData.element.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parseFloat(style.opacity) > 0
        );
      }).catch(() => false);

      if (!isRendered) continue;

      // 현재 페이지 URL과 함께 저장
      buttonsToClick.push({
        ...elData,
        pageUrl: currentPageUrl
      });
      deduplicator.add(elData.selector);
    }

    console.log(`  🔘 클릭할 버튼: ${buttonsToClick.length}개`);
    
    // 진행 상황 업데이트
    if (sendEvent && buttonsToClick.length > 0) {
      sendEvent('status', { 
        message: `${buttonsToClick.length}개의 버튼 클릭 시작...`,
        stage: 'clicking',
        progress: Math.min(90, (iteration / maxIterations) * 50 + 20),
        buttonsToClick: buttonsToClick.length,
        currentButton: 0,
        totalButtons: buttonsToClick.length
      });
    }
    
    // 디버깅: 발견된 버튼들의 selector 출력
    if (buttonsToClick.length > 0) {
      // event-section 관련 버튼 찾기 (정확한 패턴 매칭)
      const eventSectionButtons = buttonsToClick.filter(btn => {
        const selector = btn.selector;
        // home-container와 event-section을 모두 포함하는지 확인
        const hasHomeContainer = selector.includes('home-container');
        const hasEventSection = selector.includes('event-section');
        const hasSection = selector.includes('section');
        
        // button:nth-child(1) 또는 button:nth-of-type(1) 포함
        const isButton1 = (selector.includes('button:nth-child(1)') || 
                         selector.includes('button:nth-of-type(1)')) && 
                         (hasEventSection || (hasHomeContainer && hasSection));
        
        // > a 포함 (button이 아닌 링크)
        const isButton2 = (selector.includes('> a') || selector.match(/\s+a\s*$/)) && 
                         !selector.includes('button') &&
                         (hasEventSection || (hasHomeContainer && hasSection));
        
        return isButton1 || isButton2;
      });
      
      if (eventSectionButtons.length > 0) {
        console.log(`  ⭐⭐ event-section 관련 버튼 ${eventSectionButtons.length}개 발견:`);
        eventSectionButtons.forEach((btn, idx) => {
          const index = buttonsToClick.indexOf(btn) + 1;
          const isButton1 = btn.selector.includes('button:nth-child(1)') || btn.selector.includes('button:nth-of-type(1)');
          const isButton2 = (btn.selector.includes('> a') || btn.selector.match(/\s+a\s*$/)) && !btn.selector.includes('button');
          const label = isButton1 ? '[버튼1]' : (isButton2 ? '[버튼2]' : '');
          console.log(`    [${index}] ⭐⭐ ${label} ${btn.selector}`);
        });
      } else {
        // 디버깅: event-section 관련 버튼이 없는 경우 모든 버튼 selector 확인
        console.log(`  ⚠ event-section 관련 버튼을 찾을 수 없음. 전체 버튼 목록:`);
        buttonsToClick.forEach((btn, idx) => {
          if (btn.selector.includes('section') || btn.selector.includes('home-container')) {
            console.log(`    [${idx + 1}] ${btn.selector}`);
          }
        });
      }
      
      buttonsToClick.forEach((btn, idx) => {
        const selector = btn.selector;
        const isEventSection = selector.includes('event-section');
        const isTargetButton1 = (selector.includes('button:nth-child(1)') || selector.includes('button:nth-of-type(1)')) && isEventSection;
        const isTargetButton2 = selector.includes('> a') && isEventSection && !selector.includes('button');
        
        if (!isTargetButton1 && !isTargetButton2) {
          console.log(`    [${idx + 1}] ${selector.substring(0, 80)}`);
        }
      });
    }

    if (buttonsToClick.length === 0) {
      // 마지막 체크: 정말 모든 버튼을 클릭했는지 확인
      const allElements = await findAllClickableElements(page);
      const unclickedCount = allElements.filter(el => !deduplicator.has(el.selector)).length;
      if (unclickedCount > 0) {
        console.log(`  ⚠ 아직 클릭하지 않은 버튼 ${unclickedCount}개 발견, 계속 진행...`);
        hasMoreButtons = true;
        continue;
      }
      hasMoreButtons = false;
      break;
    }

    // Click each button
    const iterationClickedButtons = []; // 이번 반복에서 클릭한 버튼 정보 저장
    
    for (let btnIndex = 0; btnIndex < buttonsToClick.length; btnIndex++) {
      const elData = buttonsToClick[btnIndex];
      const { selector, pageUrl: buttonPageUrl } = elData;
      
      // 현재 버튼 클릭 진행 상황 업데이트
      if (sendEvent) {
        totalButtonsClicked++;
        sendEvent('status', { 
          message: `버튼 클릭 중... (${btnIndex + 1}/${buttonsToClick.length})`,
          stage: 'clicking',
          progress: Math.min(90, (iteration / maxIterations) * 50 + 20 + ((btnIndex + 1) / buttonsToClick.length) * 20),
          currentButton: btnIndex + 1,
          totalButtons: buttonsToClick.length,
          totalClicked: totalButtonsClicked,
          selector: selector.substring(0, 60) + '...'
        });
      }

      try {
        // 현재 URL 확인 (이전 페이지의 요소인지 확인)
        const currentUrl = page.url();
        
        // URL이 변경되었으면 이 버튼은 이전 페이지의 것이므로 스킵
        if (currentUrl !== buttonPageUrl) {
          console.log(`  ⏭️ ${selector.substring(0, 60)}... - URL 변경으로 스킵 (${buttonPageUrl} → ${currentUrl})`);
          continue;
        }
        
        // Re-find element by selector (DOM may have changed)
        let el = await page.$(selector).catch(() => null);
        if (!el) {
          // 요소를 찾을 수 없는 경우: URL이 변경되어 DOM이 바뀌었을 가능성
          console.log(`  ⚠ ${selector.substring(0, 60)}... - 요소를 찾을 수 없음 (DOM이 변경되었을 수 있음)`);
          continue;
        }

        // 요소를 뷰포트로 스크롤 (화면 밖에 있을 수 있음)
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 });
          await page.waitForTimeout(200);
        } catch (e) {
          // 스크롤 실패해도 계속 진행
          console.log(`  ⚠ ${selector} - 스크롤 실패, 계속 진행`);
        }

        // Take screenshot with highlight
        const screenshotBase64 = await screenshotManager.captureWithHighlight(el, selector);

        // Record URL and event count before click
        const urlBeforeClick = page.url();
        const eventCountBefore = collector.getEvents().length;
        const clickTimestamp = Date.now();

        // Try to click
        let clickMethod = "";

        try {
          await el.click({ timeout: 3000 });
          clickMethod = "normal";
        } catch {
          try {
            await el.evaluate(el => el.click());
            clickMethod = "js";
          } catch {
            try {
              await el.click({ force: true, timeout: 3000 });
              clickMethod = "force";
            } catch {
              console.log(`  ✗ ${selector} - 클릭 실패`);
              continue;
            }
          }
        }

        // 클릭 로그 출력 (특정 패턴의 버튼은 더 명확하게)
        const hasEventSection = selector.includes('event-section') || 
                               (selector.includes('home-container') && selector.includes('section'));
        const isTargetButton1 = (selector.includes('button:nth-child(1)') || 
                                 selector.includes('button:nth-of-type(1)')) && 
                                 hasEventSection;
        const isTargetButton2 = selector.includes('> a') && 
                               hasEventSection && 
                               !selector.includes('button') &&
                               (selector.includes('event-section') || selector.includes('home-container'));
        
        if (isTargetButton1) {
          console.log(`  🖱️ ⭐⭐ [버튼1] ${selector} - 클릭 (${clickMethod})`);
        } else if (isTargetButton2) {
          console.log(`  🖱️ ⭐⭐ [버튼2] ${selector} - 클릭 (${clickMethod})`);
        } else {
          console.log(`  🖱️ ${selector} - 클릭 (${clickMethod})`);
        }

        // 클릭 후 GA4 요청이 전송될 시간 확보
        await page.waitForTimeout(300);

        // Wait for GA4 events (타임아웃 증가: GA4 배치 전송 대응)
        const newEvents = await waitForGA4Events(collector, eventCountBefore, 5000);

        // Check for click_event
        const clickEvents = newEvents.filter(e => e.eventName === 'click_event');

        console.log(`  ✓ GA4 이벤트: ${newEvents.length}개 (click_event: ${clickEvents.length}개)`);

        // Log click_event details
        if (clickEvents.length > 0) {
          clickEvents.forEach((evt, idx) => {
            const ep = evt.eventData?.ep || [];
            // 여러 가능한 키 이름 확인 (click_page, ep_click_page 등)
            const clickPage = ep.find(p => ['click_page', 'ep_click_page'].includes(p.key))?.value;
            const clickArea = ep.find(p => ['click_area', 'ep_click_area'].includes(p.key))?.value;
            const clickLabel = ep.find(p => ['click_label', 'ep_click_label'].includes(p.key))?.value;
            console.log(`    [${idx + 1}] page: ${clickPage || '-'}, area: ${clickArea || '-'}, label: ${clickLabel || '-'}`);
          });
        }

        // 클릭한 버튼 정보 저장 (이벤트가 나중에 도착할 수 있음)
        const buttonInfo = {
          selector,
          url: urlBeforeClick,
          screenshot: screenshotBase64 ? `data:image/png;base64,${screenshotBase64}` : null,
          clickTimestamp,
          eventCountBefore,
          hasEvents: newEvents.length > 0
        };
        iterationClickedButtons.push(buttonInfo);
        allClickedButtons.push(buttonInfo);

        // Save result if GA4 events exist
        if (newEvents.length > 0) {
          const buttonResult = {
            selector,
            url: urlBeforeClick,
            hasClickEvent: clickEvents.length > 0,
            events: newEvents.map(evt => ({
              eventName: evt.eventName,
              eventData: evt.eventData
            })),
            screenshot: screenshotBase64 ? `data:image/png;base64,${screenshotBase64}` : null,
            timestamp: clickTimestamp
          };

          results.push(buttonResult);

          // Send to frontend (streaming) - 스크린샷 제외 (너무 큼)
          if (sendEvent) {
            const buttonResultForStream = {
              ...buttonResult,
              screenshot: buttonResult.screenshot ? '[스크린샷 제외됨]' : null
            };
            sendEvent('button', buttonResultForStream);
          }
        }

        // Check URL change - 페이지 이동이 발생했으면 원래 URL로 복귀
        const urlAfterClick = page.url();
        if (urlAfterClick !== urlBeforeClick) {
          console.log(`  → URL 변경 감지: ${urlBeforeClick} → ${urlAfterClick}`);
          console.log(`  🔄 원래 페이지로 복귀 중...`);
          
          // GA4 이벤트가 전송될 시간 확보
          await page.waitForTimeout(500);
          
          // 원래 URL로 복귀
          try {
            await page.goto(urlBeforeClick, { waitUntil: 'domcontentloaded', timeout: 10000 });
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(1000);
            console.log(`  ✓ 원래 페이지로 복귀 완료`);
          } catch (e) {
            console.log(`  ⚠ 페이지 복귀 실패: ${e.message}`);
            // 복귀 실패 시 history.back() 시도
            try {
              await page.evaluate(() => window.history.back());
              await page.waitForTimeout(1000);
            } catch (e2) {
              console.log(`  ⚠ history.back()도 실패: ${e2.message}`);
            }
          }
        }

        // Short delay before next click
        await page.waitForTimeout(300);

        // 버튼 클릭 후 팝업 체크 및 처리
        const popupHandled = await handlePopup(page, collector, screenshotManager);
        if (popupHandled) {
          // 팝업 처리 후 DOM 안정화 대기
          await page.waitForTimeout(1000);
          await spaManager.waitForStableDOM({ maxWait: 2000 });
        }

      } catch (e) {
        console.log(`  ✗ ${selector} 오류: ${e.message}`);
      }
    }

    // 모든 버튼 클릭 후 최종 GA4 이벤트 대기 (배치 전송 대응)
    console.log(`  ⏳ 최종 GA4 이벤트 대기 중...`);
    const eventsBeforeFinalWait = collector.getEvents().length;
    await page.waitForTimeout(2000);
    const finalEvents = await waitForGA4Events(collector, eventsBeforeFinalWait, 3000);
    if (finalEvents.length > 0) {
      console.log(`  📥 최종 GA4 이벤트 ${finalEvents.length}개 추가 감지`);
      
      // 누락된 버튼의 이벤트를 찾아서 결과에 추가
      const clickEvents = finalEvents.filter(e => e.eventName === 'click_event');
      if (clickEvents.length > 0) {
        const matchedEventTimes = new Set(); // 이미 매칭된 이벤트의 타임스탬프
        
        // 이벤트가 있지만 결과에 없는 버튼 찾기 (최근 클릭한 버튼부터)
        for (let i = allClickedButtons.length - 1; i >= 0; i--) {
          const btnInfo = allClickedButtons[i];
          if (!btnInfo.hasEvents) {
            // 이 버튼 클릭 후 도착한 이벤트 찾기 (아직 매칭되지 않은 이벤트만)
            const buttonEvents = finalEvents.filter(evt => {
              // 클릭 시간 이후의 이벤트이고, 아직 매칭되지 않은 이벤트만
              return evt.time >= btnInfo.clickTimestamp - 1000 && // 1초 여유
                     !matchedEventTimes.has(evt.time);
            });
            
            if (buttonEvents.length > 0) {
              const clickEventsForBtn = buttonEvents.filter(e => e.eventName === 'click_event');
              console.log(`  ✅ ${btnInfo.selector} - 누락된 이벤트 ${buttonEvents.length}개 발견`);
              
              // 매칭된 이벤트의 타임스탬프 기록
              buttonEvents.forEach(evt => matchedEventTimes.add(evt.time));
              
              const buttonResult = {
                selector: btnInfo.selector,
                url: btnInfo.url,
                hasClickEvent: clickEventsForBtn.length > 0,
                events: buttonEvents.map(evt => ({
                  eventName: evt.eventName,
                  eventData: evt.eventData
                })),
                screenshot: btnInfo.screenshot,
                timestamp: btnInfo.clickTimestamp
              };

              results.push(buttonResult);

              // Send to frontend (streaming)
              if (sendEvent) {
                sendEvent('button', buttonResult);
              }
            }
          }
        }
      }
    }

    // Check for new buttons
    await page.waitForTimeout(500);
    const finalElements = await findAllClickableElements(page);
    let hasUnclickedButtons = false;

    for (const elData of finalElements) {
      if (!deduplicator.has(elData.selector)) {
        hasUnclickedButtons = true;
        break;
      }
    }

    if (!hasUnclickedButtons) {
      hasMoreButtons = false;
      console.log(`  ✅ 더 이상 클릭할 버튼 없음`);
    }
  }

  console.log(`\n✅ 버튼 클릭 완료 (총 ${iteration}회 반복)`);
  
  // 분석 완료 알림
  if (sendEvent) {
    sendEvent('status', { 
      message: '분석 완료',
      stage: 'completed',
      progress: 100,
      totalIterations: iteration,
      totalButtonsClicked: totalButtonsClicked,
      totalButtonsFound: totalButtonsFound
    });
  }
}

/* =========================
   Main: analyzePage
========================= */
export async function analyzePage(url, sendEvent = null) {
  // 분석 시작 알림
  if (sendEvent) {
    sendEvent('status', { 
      message: '브라우저 시작 중...',
      stage: 'starting',
      progress: 0
    });
  }

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  });

  const page = await context.newPage();
  
  if (sendEvent) {
    sendEvent('status', { 
      message: '페이지 로딩 중...',
      stage: 'loading',
      progress: 5
    });
  }

  // 팝업 처리: 팝업 내 모든 버튼 클릭 후 닫기
  page.on('dialog', async dialog => {
    console.log(`  📢 팝업 감지: ${dialog.type()} - ${dialog.message()}`);
    
    // 팝업 타입에 따라 처리
    if (dialog.type() === 'alert') {
      // alert는 확인 버튼만 있음
      await dialog.accept();
      console.log(`  ✓ alert 팝업 닫기 완료`);
    } else if (dialog.type() === 'confirm') {
      // confirm은 확인/취소 버튼이 있음 - 확인으로 처리
      await dialog.accept();
      console.log(`  ✓ confirm 팝업 확인 완료`);
    } else if (dialog.type() === 'prompt') {
      // prompt는 입력이 필요함 - 기본값으로 확인
      await dialog.accept('');
      console.log(`  ✓ prompt 팝업 확인 완료`);
    } else {
      await dialog.accept();
      console.log(`  ✓ 팝업 닫기 완료`);
    }
  });

  // Initialize managers
  const collector = new GA4EventCollector();
  const deduplicator = new ElementDeduplicator();
  const screenshotManager = new ScreenshotManager(page);
  const spaManager = new SPANavigationManager(page);
  const results = [];

  // CDP를 사용하여 모든 네트워크 요청 캡처 (sendBeacon 포함)
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Network.enable');

  // 요청 ID별로 POST body를 저장할 맵
  const requestPostDataMap = new Map();

  // requestWillBeSentExtraInfo: POST body를 포함한 추가 정보 (sendBeacon 포함)
  cdpSession.on('Network.requestWillBeSentExtraInfo', (params) => {
    const requestId = params.requestId;
    let postData = null;

    // postDataEntries 배열에서 가져오기 (sendBeacon의 경우)
    if (params.postDataEntries && params.postDataEntries.length > 0) {
      const entry = params.postDataEntries[0];
      if (entry.bytes) {
        // Base64로 인코딩된 경우
        try {
          postData = Buffer.from(entry.bytes, 'base64').toString('utf-8');
        } catch (e) {
          // 이미 문자열인 경우
          postData = entry.bytes;
        }
      } else if (entry.text) {
        postData = entry.text;
      }
    }
    
    // postData 직접 속성에서 가져오기
    if (!postData && params.postData) {
      postData = params.postData;
    }

    if (postData && typeof postData === 'string' && postData.length > 0) {
      requestPostDataMap.set(requestId, postData);
      console.log(`  📥 GA4 POST body 캡처 (requestId: ${requestId}, 길이: ${postData.length})`);
      if (postData.length < 500) {
        console.log(`     POST body: ${postData}`);
      } else {
        console.log(`     POST body 샘플: ${postData.substring(0, 200)}...`);
      }

      // requestWillBeSent에서 URL을 가져올 수 있도록 맵에 저장
      // requestWillBeSent가 아직 발생하지 않았을 수 있으므로, 
      // 나중에 requestWillBeSent에서 처리하도록 함
    }
  });

  // GA4 요청 처리 함수 (공통)
  const processGA4Request = (reqUrl, requestId, postData, method) => {
    // GA4 collect 요청 필터링
    if (!reqUrl.includes('/g/collect')) return;
    if (reqUrl.includes('stats.g.doubleclick.net')) return;

    try {
      const urlQuery = reqUrl.split('?')[1];
      const urlParams = queryStringToObject(urlQuery || '');

      console.log(`  📥 GA4 요청 감지 (CDP): ${method} ${reqUrl.substring(0, 80)}...`);
      if (postData) {
        console.log(`     POST body 길이: ${postData.length}`);
        if (postData.length < 500) {
          console.log(`     POST body: ${postData}`);
        } else {
          console.log(`     POST body 샘플: ${postData.substring(0, 200)}...`);
        }
      }

      // POST body 파싱
      let events = [];
      if (postData) {
        events = collector.parsePostBody(postData, urlParams);
      } else if (urlParams.en) {
        events = [extractGA4Parameters(urlParams)];
      }

      console.log(`     파싱된 이벤트 수: ${events.length}`);

      events.forEach(eventData => {
        const eventName = eventData.en;
        console.log(`     이벤트명: ${eventName}`);

        if (IGNORED_EVENTS.includes(eventName)) {
          console.log(`     (무시됨: ${eventName})`);
          return;
        }

        const added = collector.addEvent(page.url(), eventData);
        if (added) {
          console.log(`📡 GA4 이벤트: ${eventName}`);

          if (eventName === 'click_event') {
            const ep = eventData.ep || [];
            const clickPage = ep.find(p => ['click_page', 'ep_click_page'].includes(p.key))?.value;
            const clickArea = ep.find(p => ['click_area', 'ep_click_area'].includes(p.key))?.value;
            const clickLabel = ep.find(p => ['click_label', 'ep_click_label'].includes(p.key))?.value;
            console.log(`    page: ${clickPage || '-'}, area: ${clickArea || '-'}, label: ${clickLabel || '-'}`);
          }
        }
      });

    } catch (e) {
      console.error('GA4 파싱 오류:', e.message);
      console.error('스택:', e.stack);
    }
  };

  // requestWillBeSent: 요청 기본 정보
  cdpSession.on('Network.requestWillBeSent', (params) => {
    const reqUrl = params.request.url;
    const requestId = params.requestId;
    const method = params.request.method;
    let postData = params.request.postData || '';

    // requestWillBeSentExtraInfo에서 저장한 POST body가 있으면 사용
    if (!postData && requestPostDataMap.has(requestId)) {
      postData = requestPostDataMap.get(requestId);
      requestPostDataMap.delete(requestId); // 사용 후 삭제
    }

    // POST body가 있거나 URL에 이벤트 정보가 있으면 처리
    if (postData || reqUrl.includes('/g/collect')) {
      processGA4Request(reqUrl, requestId, postData, method);
    }
  });

  // 요청 완료 후 맵 정리 (메모리 누수 방지)
  cdpSession.on('Network.loadingFinished', (params) => {
    const requestId = params.requestId;
    if (requestPostDataMap.has(requestId)) {
      requestPostDataMap.delete(requestId);
    }
  });

  // Load page
  console.log(`\n🚀 페이지 분석 시작: ${url}`);

  if (sendEvent) {
    sendEvent('status', { 
      message: `페이지 로딩 중: ${url}`,
      stage: 'loading',
      progress: 10
    });
  }

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  } catch (error) {
    if (error.message.includes('ERR_') || error.message.includes('net::')) {
      console.log(`  ⚠️ 첫 로딩 실패, 재시도...`);
      if (sendEvent) {
        sendEvent('status', { 
          message: '페이지 로딩 재시도 중...',
          stage: 'loading',
          progress: 10
        });
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } else {
      throw error;
    }
  }

  if (sendEvent) {
    sendEvent('status', { 
      message: '페이지 로딩 완료, 초기화 중...',
      stage: 'initializing',
      progress: 15
    });
  }

  await page.waitForTimeout(2000);

  // 페이지 이동 방지: 모든 클릭 가능한 요소에 이벤트 리스너 추가
  await page.evaluate(() => {
    // preventNavigation 플래그
    window.__preventNavigation = true;
    const originalUrl = window.location.href;

    // 모든 링크의 기본 동작 방지 (하지만 클릭 이벤트는 발생)
    const preventNavigation = (e) => {
      // GA4 이벤트는 전송되도록 하되, 페이지 이동만 막음
      const target = e.target;
      const link = target.tagName === 'A' ? target : target.closest('a');
      
      if (link && link.tagName === 'A') {
        const href = link.getAttribute('href');
        
        // 실제 페이지 이동이 있는 경우만 막기
        if (href && href !== '#' && !href.startsWith('javascript:')) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }
      
      // form 제출 방지
      const form = target.tagName === 'FORM' ? target : target.closest('form');
      if (form && form.tagName === 'FORM') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    // 모든 클릭 이벤트에 리스너 추가 (캡처 단계에서, 가장 먼저 실행)
    document.addEventListener('click', preventNavigation, true);

    // History API 가로채기 - pushState/replaceState 호출을 막음
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function(...args) {
      if (window.__preventNavigation) {
        // pushState 호출 자체를 막음
        console.log('🚫 history.pushState 차단됨');
        return;
      }
      return originalPushState.apply(history, args);
    };

    history.replaceState = function(...args) {
      if (window.__preventNavigation) {
        // replaceState 호출 자체를 막음
        console.log('🚫 history.replaceState 차단됨');
        return;
      }
      return originalReplaceState.apply(history, args);
    };

    // beforeunload 이벤트로 페이지 이동 시도 감지
    window.addEventListener('beforeunload', (e) => {
      if (window.__preventNavigation) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });

    // URL 변경 감지 및 복귀
    let lastUrl = window.location.href;
    const checkUrlChange = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl && window.__preventNavigation) {
        console.log(`🚫 URL 변경 감지 및 복귀: ${lastUrl} → ${currentUrl}`);
        // 원래 URL로 복귀
        if (currentUrl !== originalUrl) {
          window.history.replaceState(null, '', originalUrl);
          window.location.replace(originalUrl);
        }
      }
      lastUrl = window.location.href;
    };

    // 주기적으로 URL 변경 확인
    setInterval(checkUrlChange, 100);

    console.log('🔒 페이지 이동 방지 활성화');
  });

  // Initialize SPA manager
  await spaManager.initialize();

  // Start analysis
  console.log('\n==============================');
  console.log('버튼 클릭 GA4 분석 시작');
  console.log('==============================');

  if (sendEvent) {
    sendEvent('status', { 
      message: '버튼 클릭 분석 시작',
      stage: 'analyzing',
      progress: 20
    });
  }

  await clickAllButtons(page, collector, results, deduplicator, screenshotManager, spaManager, sendEvent);

  if (sendEvent) {
    sendEvent('status', { 
      message: '결과 정리 중...',
      stage: 'finalizing',
      progress: 95
    });
  }

  await browser.close();

  // Return results
  const allEvents = collector.getEvents();
  const clickEventsCount = allEvents.filter(e => e.eventName === 'click_event').length;

  console.log(`\n✅ 분석 완료: ${results.length}개 버튼, ${allEvents.length}개 GA4 이벤트 (click_event: ${clickEventsCount}개)`);

  const finalResult = {
    url,
    analyzedAt: new Date().toISOString(),
    buttonCount: results.length,
    totalEvents: allEvents.length,
    totalClickEvents: clickEventsCount,
    buttons: results,
    allEvents: allEvents.map(e => ({
      url: e.url,
      timestamp: e.time,
      eventName: e.eventName,
      ...e.eventData
    }))
  };

  if (sendEvent) {
    // 최종 결과 전송 시 스크린샷 제외 (너무 큼)
    const finalResultForStream = {
      ...finalResult,
      buttons: finalResult.buttons.map(btn => ({
        ...btn,
        screenshot: btn.screenshot ? '[스크린샷 제외됨]' : null
      }))
    };
    sendEvent('status', { 
      message: '분석 완료!',
      stage: 'done',
      progress: 100,
      result: finalResultForStream
    });
  }

  return finalResult;
}
