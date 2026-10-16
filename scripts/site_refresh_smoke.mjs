import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4000';
const baseOrigin = new URL(baseURL).origin;
const outputDir = path.resolve(process.env.REFRESH_SMOKE_OUTPUT || 'artifacts/site-refresh-smoke');
const requestedModes = new Set(
  (process.env.REFRESH_SMOKE_MODES || '').split(',').map((value) => value.trim()).filter(Boolean),
);
const availableModes = new Set([
  'normal',
  'mobile-keyboard-navigation',
  'breakpoint-focus',
  'reduced',
  'no-js',
  'missing-assets',
  'pause-persistence',
  'rotation',
  'protected-scope',
]);
const unknownModes = [...requestedModes].filter((mode) => !availableModes.has(mode));
if (unknownModes.length > 0) {
  throw new Error(`Unknown REFRESH_SMOKE_MODES: ${unknownModes.join(', ')}`);
}
const shouldRunMode = (mode) => requestedModes.size === 0 || requestedModes.has(mode);

const targetRoutes = [
  { name: 'home', url: '/' },
  { name: 'mission', url: '/trillionbank/mission/' },
  { name: 'insights', url: '/trillionbank/insights/' },
  { name: 'company', url: '/trillionbank/company/' },
  { name: 'media', url: '/trillionbank/media/' },
  { name: 'contact', url: '/trillionbank/contact/' },
  { name: 'business', url: '/trillionbank/business/' },
  { name: 'consulting', url: '/trillionbank/business/hack2/' },
  { name: 'pay-per-crawl', url: '/trillionbank/business/pay-per-crawl/' },
  { name: 'pay-per-citation', url: '/trillionbank/business/pay-per-citation/' },
];

const protectedRoutes = [
  { name: 'airreach-free', url: '/airreach/' },
  { name: 'airreach-platform', url: '/airreach/platform/' },
  { name: 'airreach-studio', url: '/airreach/studio/' },
  { name: 'airreach-app', url: '/airreach/app/' },
  { name: 'airreach-report', url: '/airreach/app/report/' },
  { name: 'site-analyze', url: '/trillionbank/tools/site-analyze/' },
];

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'short-desktop-1024', width: 1024, height: 600 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-360x800', width: 360, height: 800 },
  { name: 'small-320', width: 320, height: 568 },
  { name: 'landscape-844', width: 844, height: 390 },
];

const refreshCSSPath = '/trillionbank/assets/css/tb-refresh.css';
const refreshJSPath = '/trillionbank/assets/js/toriuru-scroll.js';
const navigationJSPath = '/trillionbank/assets/js/tb-refresh-navigation.js';
const toriuruImagePrefix = '/trillionbank/assets/images/toriuru/toriuru-';
const pauseStorageKey = 'tb:toriuru-motion-paused';

const issues = [];
const results = [];
const internalLinkResults = new Map();

function addIssue({ mode, viewport, route, type, detail }) {
  issues.push({ mode, viewport: viewport.name, route: route.url, type, detail });
}

function check(condition, context, type, detail) {
  if (!condition) addIssue({ ...context, type, detail });
}

function isToriuruAsset(rawURL) {
  try {
    const url = new URL(rawURL);
    return url.origin === baseOrigin
      && url.pathname.startsWith(toriuruImagePrefix)
      && url.pathname.endsWith('.webp');
  } catch {
    return false;
  }
}

function isIgnorableConsoleError(text) {
  return [
    'googletagmanager',
    'google-analytics',
    'ERR_BLOCKED_BY_CLIENT',
    'Failed to load resource',
  ].some((value) => text.includes(value));
}

function nearlyEqual(a, b, tolerance = 1) {
  return Math.abs(a - b) <= tolerance;
}

function sameMotionState(a, b, tolerance = 1) {
  return nearlyEqual(a.left, b.left, tolerance)
    && nearlyEqual(a.top, b.top, tolerance)
    && nearlyEqual(a.width, b.width, tolerance)
    && nearlyEqual(a.height, b.height, tolerance)
    && a.transform === b.transform;
}

async function newContext(browser, {
  viewport,
  reducedMotion = 'no-preference',
  javaScriptEnabled = true,
  missingAssets = false,
}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: 'light',
    reducedMotion,
    javaScriptEnabled,
  });

  context.__failedToriuruRequests = 0;
  await context.route('**/*', async (route) => {
    const rawURL = route.request().url();
    let url;
    try {
      url = new URL(rawURL);
    } catch {
      await route.continue();
      return;
    }

    if (missingAssets && isToriuruAsset(rawURL)) {
      context.__failedToriuruRequests += 1;
      await route.abort('failed');
      return;
    }

    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === baseOrigin) {
      await route.continue();
      return;
    }

    // Keep the run deterministic and avoid analytics, font, or authenticated API traffic.
    await route.abort('blockedbyclient');
  });

  return context;
}

function observePage(page, context, { allowMissingToriuru = false } = {}) {
  page.on('pageerror', (error) => {
    addIssue({ ...context, type: 'pageerror', detail: error.message });
  });

  page.on('console', (message) => {
    if (message.type() === 'error' && !isIgnorableConsoleError(message.text())) {
      addIssue({ ...context, type: 'console', detail: message.text() });
    }
  });

  page.on('response', (response) => {
    const responseURL = new URL(response.url());
    if (responseURL.origin === baseOrigin && response.status() >= 400) {
      addIssue({
        ...context,
        type: 'http',
        detail: `${response.status()} ${response.url()}`,
      });
    }
  });

  page.on('requestfailed', (request) => {
    let requestURL;
    try {
      requestURL = new URL(request.url());
    } catch {
      return;
    }
    if (requestURL.origin !== baseOrigin) return;
    if (allowMissingToriuru && isToriuruAsset(request.url())) return;
    addIssue({
      ...context,
      type: 'requestfailed',
      detail: `${request.url()} - ${request.failure()?.errorText || 'unknown error'}`,
    });
  });
}

async function goto(page, route, context) {
  const response = await page.goto(new URL(route.url, baseURL).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  check(response?.ok(), context, 'navigation', `Unexpected status ${response?.status() ?? 'no response'}`);
  await page.waitForTimeout(100);
  return response;
}

async function motionState(page) {
  return page.locator('[data-toriuru]').first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      transform: getComputedStyle(element).transform,
    };
  });
}

async function scrollToProgress(page, progress) {
  const target = await page.evaluate((value) => {
    const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    // Existing shared CSS enables smooth scrolling. Force deterministic, immediate
    // positioning so the test observes the scroll-driven state, not an in-flight
    // browser scroll animation.
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    const top = Math.round(maximum * value);
    scrollTo({ top, left: 0, behavior: 'instant' });
    return top;
  }, progress);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
  return target;
}

async function scrollToY(page, target) {
  await page.evaluate((top) => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    scrollTo({ top, left: 0, behavior: 'instant' });
  }, target);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
}

async function contentSnapshot(page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(
      'main h1, main h2, main h3, main p, main a.btn, main [data-cta]',
    )).slice(0, 18);

    const visibleThroughAncestors = (element) => {
      let current = element;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };

    return {
      text: document.querySelector('main')?.innerText || '',
      elements: candidates.map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          index,
          tag: element.tagName,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          x: rect.left + scrollX,
          y: rect.top + scrollY,
          width: rect.width,
          height: rect.height,
          visible: visibleThroughAncestors(element),
        };
      }),
    };
  });
}

function compareContentSnapshots(before, after, context) {
  check(before.text === after.text, context, 'static-content', 'Main text changed while scrolling');
  check(before.elements.length > 0, context, 'static-content', 'No content samples were found');
  check(before.elements.length === after.elements.length, context, 'static-content', 'Content sample count changed');

  before.elements.forEach((item, index) => {
    const next = after.elements[index];
    if (!next) return;
    const stable = item.tag === next.tag
      && item.text === next.text
      && nearlyEqual(item.x, next.x, 1)
      && nearlyEqual(item.y, next.y, 1)
      && nearlyEqual(item.width, next.width, 1)
      && nearlyEqual(item.height, next.height, 1);
    check(stable, context, 'static-content', `Content moved or resized: ${item.tag} "${item.text}"`);
    check(item.visible && next.visible, context, 'static-content', `Content is visually hidden: ${item.tag} "${item.text}"`);
  });
}

async function assertCompactPresentation(page, context) {
  // A page-level async wait can be torn down when Chromium runs with JavaScript
  // disabled. The no-JS matrix only needs the already-rendered CSS fallback.
  if (context.mode !== 'no-js') {
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }
  const state = await page.evaluate(() => {
    const stage = document.querySelector('.toriuru-guide__stage');
    const staticMascot = document.querySelector('.toriuru-guide__static');
    const toggle = document.querySelector('[data-toriuru-toggle]');
    const header = document.querySelector('header.tbh');
    const h1 = document.querySelector('main h1');
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > .01
        && rect.width > 0
        && rect.height > 0;
    };
    const firstCTA = [...document.querySelectorAll(
      'main a.btn, main [data-cta], main a[href*="/contact/"], main a[href*="/meeting/"]',
    )].find(isVisible);
    const rectFor = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const overlaps = (first, second) => Boolean(first && second)
      && first.right > second.left
      && first.left < second.right
      && first.bottom > second.top
      && first.top < second.bottom;
    const staticRect = rectFor(staticMascot);
    const headerRect = rectFor(header);
    const h1Rect = rectFor(h1);
    const ctaRect = rectFor(firstCTA);

    return {
      width: innerWidth,
      height: innerHeight,
      shortLandscape: matchMedia(
        '(max-height: 620px) and (min-width: 521px) and (max-width: 1100px)',
      ).matches,
      stageVisible: isVisible(stage),
      staticVisible: isVisible(staticMascot),
      toggleVisible: isVisible(toggle),
      staticDisplay: staticMascot ? getComputedStyle(staticMascot).display : 'missing',
      staticBackground: staticMascot ? getComputedStyle(staticMascot).backgroundImage : 'missing',
      staticRect,
      overlapsHeader: overlaps(staticRect, headerRect),
      overlapsH1: overlaps(staticRect, h1Rect),
      overlapsCTA: overlaps(staticRect, ctaRect),
    };
  });

  check(!state.stageVisible, context, 'compact-mascot', 'Animated mascot stage must be hidden at widths up to 900px');
  check(!state.toggleVisible, context, 'compact-mascot', 'Motion toggle must be hidden at widths up to 900px');
  check(
    state.staticBackground.includes('toriuru-neutral.webp'),
    context,
    'compact-mascot',
    `Static mascot background is missing: ${state.staticBackground}`,
  );
  check(
    state.staticVisible || state.shortLandscape,
    context,
    'compact-mascot',
    `Static mascot is hidden (display=${state.staticDisplay}) outside the short-landscape exception`,
  );

  if (state.staticVisible && state.staticRect) {
    const rect = state.staticRect;
    check(
      rect.left >= -1 && rect.top >= -1 && rect.right <= state.width + 1 && rect.bottom <= state.height + 1,
      context,
      'compact-mascot',
      `Static mascot is outside the viewport: ${JSON.stringify(rect)} in ${state.width}x${state.height}`,
    );
    check(!state.overlapsHeader, context, 'compact-mascot', 'Static mascot overlaps the header');
    check(!state.overlapsH1, context, 'compact-mascot', 'Static mascot overlaps the main h1');
    check(!state.overlapsCTA, context, 'compact-mascot', 'Static mascot overlaps the first main CTA');
  }
}

async function staticMascotDocumentRect(page) {
  return page.locator('.toriuru-guide__static').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left + scrollX,
      top: rect.top + scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function assertViewportOverflow(page, context, label) {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }));
  check(
    layout.scrollWidth <= layout.innerWidth + 2,
    context,
    'overflow',
    `${label}: scrollWidth=${layout.scrollWidth}, innerWidth=${layout.innerWidth}`,
  );
}

async function assertMetadata(page, route, context) {
  const canonical = page.locator('link[rel="canonical"]');
  const canonicalCount = await canonical.count();
  check(canonicalCount === 1, context, 'canonical', `Expected one canonical, found ${canonicalCount}`);
  if (canonicalCount === 1) {
    const actual = await canonical.getAttribute('href');
    check(
      actual === `https://trillion-bank.jp${route.url}`,
      context,
      'canonical',
      `Unexpected canonical: ${actual}`,
    );
  }

  const robots = await page.locator('meta[name="robots"]').getAttribute('content');
  check(Boolean(robots), context, 'robots', 'Robots meta is missing');
  check(!robots?.toLowerCase().includes('noindex'), context, 'robots', `Unexpected robots directive: ${robots}`);

  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  check(blocks.length > 0, context, 'json-ld', 'No JSON-LD block was found');
  blocks.forEach((block, index) => {
    try {
      JSON.parse(block);
    } catch (error) {
      addIssue({ ...context, type: 'json-ld', detail: `Block ${index + 1}: ${error.message}` });
    }
  });
}

async function assertInternalLinks(page, context) {
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
  for (const rawURL of [...new Set(links)]) {
    let url;
    try {
      url = new URL(rawURL);
    } catch {
      continue;
    }
    if (url.origin !== baseOrigin || !['http:', 'https:'].includes(url.protocol)) continue;

    if (url.pathname === new URL(page.url()).pathname && url.hash) {
      const fragment = decodeURIComponent(url.hash.slice(1));
      const exists = await page.evaluate((id) => Boolean(document.getElementById(id)), fragment);
      check(exists, context, 'broken-fragment', `Missing fragment target: ${url.pathname}${url.hash}`);
      continue;
    }

    const cacheKey = `${url.pathname}${url.search}`;
    if (!internalLinkResults.has(cacheKey)) {
      try {
        const response = await page.request.get(new URL(cacheKey, baseURL).toString(), {
          failOnStatusCode: false,
          maxRedirects: 5,
          timeout: 15_000,
        });
        internalLinkResults.set(cacheKey, response.status());
      } catch (error) {
        internalLinkResults.set(cacheKey, `request failed: ${error.message}`);
      }
    }
    const status = internalLinkResults.get(cacheKey);
    check(typeof status === 'number' && status < 400, context, 'broken-link', `${cacheKey} -> ${status}`);
  }
}

async function assertCrawlerLabPositioning(page, route, context) {
  if (!['home', 'business', 'contact', 'pay-per-crawl'].includes(route.name)) return;

  const mainText = await page.locator('main').innerText();
  for (const term of ['日本初', '成果保証', '本番稼働']) {
    check(!mainText.includes(term), context, 'lab-claim', `Unapproved claim is visible: ${term}`);
  }

  const headerLabEntry = page.locator('#mega-biz a[href="/#ai-crawler-lab"]');
  check(await headerLabEntry.count() === 1, context, 'lab-navigation', 'AI Crawler Lab header entry is missing');

  if (route.name === 'home') {
    const lab = page.locator('#ai-crawler-lab[data-ai-crawler-lab]');
    check(await lab.count() === 1, context, 'lab-content', 'Expected one AI Crawler Lab section');
    check(await lab.isVisible(), context, 'lab-content', 'AI Crawler Lab section is not visible');
    check(
      await page.locator('a[data-lab-entry="diagnosis"][href="/airreach/"]').count() > 0,
      context,
      'lab-cta',
      'Site diagnosis entry is missing',
    );
    check(
      await page.locator('a[data-lab-entry="collaboration"][href*="/trillionbank/contact/"]').count() > 0,
      context,
      'lab-cta',
      'Research collaboration entry is missing',
    );
    check(
      await page.locator('[data-lab-role="airreach"] [data-lab-status="measure-improve"]').count() === 1,
      context,
      'lab-role',
      'AirReach measurement/improvement role is missing',
    );
    check(
      await page.locator('[data-lab-role="adctor"] [data-lab-status="research-poc"]').count() === 1,
      context,
      'lab-role',
      'Adctor research/PoC role is missing',
    );

    const labSchema = await page.locator('script[type="application/ld+json"]').evaluateAll((blocks) => {
      const nodes = [];
      blocks.forEach((block) => {
        try {
          const parsed = JSON.parse(block.textContent || '');
          const values = Array.isArray(parsed) ? parsed : [parsed];
          values.forEach((value) => nodes.push(...(Array.isArray(value?.['@graph']) ? value['@graph'] : [value])));
        } catch {
          // JSON validity is reported separately by assertMetadata().
        }
      });
      return nodes.some((node) => node?.['@type'] === 'ResearchProject' && node?.name === 'AI Crawler Lab');
    });
    check(labSchema, context, 'lab-schema', 'AI Crawler Lab ResearchProject schema is missing');

    const visibleLabFAQ = await page.locator('.home-faq details').first().evaluate((details) => ({
      question: (details.querySelector('summary')?.textContent || '').trim(),
      answer: (details.querySelector('.faq-a')?.textContent || '').trim(),
    }));
    const schemaLabFAQ = await page.locator('script[type="application/ld+json"]').evaluateAll((blocks) => {
      for (const block of blocks) {
        try {
          const parsed = JSON.parse(block.textContent || '');
          const nodes = Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [];
          const faq = nodes.find((node) => node?.['@type'] === 'FAQPage');
          const entry = faq?.mainEntity?.find((item) => item?.name === 'AI Crawler Labとは何ですか？');
          if (entry) return {
            question: entry.name,
            answer: entry.acceptedAnswer?.text || '',
          };
        } catch {
          // JSON validity is reported separately by assertMetadata().
        }
      }
      return null;
    });
    check(
      Boolean(schemaLabFAQ)
        && visibleLabFAQ.question === schemaLabFAQ.question
        && visibleLabFAQ.answer === schemaLabFAQ.answer,
      context,
      'lab-faq-parity',
      'Visible AI Crawler Lab FAQ does not match JSON-LD',
    );
  }

  if (route.name === 'business') {
    check(
      await page.locator('[data-lab-role="airreach"][data-lab-status="measure-improve"]').count() === 1,
      context,
      'lab-role',
      'Business page AirReach role/status is missing',
    );
    check(
      await page.locator('[data-lab-role="adctor"][data-lab-status="research-poc"]').count() === 1,
      context,
      'lab-role',
      'Business page Adctor role/status is missing',
    );
    check(
      await page.locator('a[href="/trillionbank/meeting/?type=company"][data-service="airreach"]').count() === 1,
      context,
      'lab-cta',
      'Business page measurement/improvement consultation entry is missing',
    );
  }

  if (route.name === 'contact') {
    check(
      await page.locator('a[data-lab-entry="diagnosis"][href="/airreach/"]').count() === 1,
      context,
      'lab-cta',
      'Contact page site diagnosis entry is missing',
    );
    check(
      await page.locator('a[data-lab-entry="collaboration"][href="#form"]').count() === 1,
      context,
      'lab-cta',
      'Contact page research collaboration entry is missing',
    );
    check(
      await page.locator('a[href="/trillionbank/meeting/?type=company"][data-service="airreach"]').count() === 1,
      context,
      'lab-cta',
      'Contact page measurement/improvement consultation entry is missing',
    );
  }

  if (route.name === 'pay-per-crawl') {
    const adctorSchemaType = await page.locator('script[type="application/ld+json"]').evaluateAll((blocks) => {
      for (const block of blocks) {
        try {
          const parsed = JSON.parse(block.textContent || '');
          const values = Array.isArray(parsed) ? parsed : [parsed];
          const entry = values.find((value) => value?.['@id']?.endsWith('/#adctor'));
          if (entry) return entry['@type'];
        } catch {
          // JSON validity is reported separately by assertMetadata().
        }
      }
      return '';
    });
    check(adctorSchemaType === 'ResearchProject', context, 'lab-schema', `Adctor schema type is ${adctorSchemaType || 'missing'}`);
    check(
      await page.locator('a[data-lab-entry="collaboration"][href="/trillionbank/contact/#form"][data-inquiry="adctor-poc"]').count() === 2,
      context,
      'lab-cta',
      'Pay per Crawl collaboration entries are missing or use the wrong URL',
    );
  }
}

async function assertTargetShell(page, route, context) {
  const bodyMatches = await page.locator('body.tb-refresh[data-site-refresh]').count();
  check(bodyMatches === 1, context, 'scope', 'Missing body.tb-refresh[data-site-refresh]');

  const cssCount = await page.locator(`link[rel="stylesheet"][href*="${refreshCSSPath}"]`).count();
  const jsCount = await page.locator(`script[src*="${refreshJSPath}"]`).count();
  const navigationJSCount = await page.locator(`script[src*="${navigationJSPath}"]`).count();
  check(cssCount === 1, context, 'scope', `Expected refresh CSS once, found ${cssCount}`);
  check(jsCount === 1, context, 'scope', `Expected Toriuru JS once, found ${jsCount}`);
  check(navigationJSCount === 1, context, 'scope', `Expected navigation JS once, found ${navigationJSCount}`);

  const root = page.locator('[data-toriuru-root]');
  const staticMascot = page.locator('.toriuru-guide__static');
  const stage = page.locator('.toriuru-guide__stage');
  const orbit = page.locator('[data-toriuru]');
  const toggle = page.locator('[data-toriuru-toggle]');
  const scenes = page.locator('[data-toriuru-scene]');
  check(await root.count() === 1, context, 'mascot', 'Expected one [data-toriuru-root]');
  check(await staticMascot.count() === 1, context, 'mascot', 'Expected one .toriuru-guide__static');
  check(await stage.count() === 1, context, 'mascot', 'Expected one .toriuru-guide__stage');
  check(await orbit.count() === 1, context, 'mascot', 'Expected one [data-toriuru]');
  check(await toggle.count() === 1, context, 'mascot', 'Expected one [data-toriuru-toggle]');
  check(await scenes.count() > 0, context, 'mascot', 'No [data-toriuru-scene] sections were found');

  if (await orbit.count() === 1) {
    const tabIndex = await orbit.getAttribute('tabindex');
    const inHiddenStage = await orbit.evaluate((element) => Boolean(
      element.closest('.toriuru-guide__stage[aria-hidden="true"]'),
    ));
    check(tabIndex !== '0', context, 'accessibility', 'Mascot orbit must not be keyboard-focusable');
    check(inHiddenStage, context, 'accessibility', 'Mascot orbit must be inside .toriuru-guide__stage[aria-hidden="true"]');
  }
  if (await toggle.count() === 1) {
    const tag = await toggle.evaluate((element) => element.tagName);
    const pressed = await toggle.getAttribute('aria-pressed');
    const hiddenFromAT = await toggle.evaluate((element) => Boolean(element.closest('[aria-hidden="true"]')));
    check(tag === 'BUTTON', context, 'accessibility', `Pause control must be BUTTON, got ${tag}`);
    check(pressed === 'true' || pressed === 'false', context, 'accessibility', `Invalid aria-pressed: ${pressed}`);
    check(!hiddenFromAT, context, 'accessibility', 'Pause control must not be inside an aria-hidden subtree');

    const coveredHeaderControl = await page.evaluate(() => {
      const control = document.querySelector('[data-toriuru-toggle]');
      if (!control) return '';
      const style = getComputedStyle(control);
      const controlRect = control.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || controlRect.width === 0 || controlRect.height === 0) {
        return '';
      }
      const overlaps = (rect) => controlRect.left < rect.right
        && controlRect.right > rect.left
        && controlRect.top < rect.bottom
        && controlRect.bottom > rect.top;
      const covered = [...document.querySelectorAll('header.tbh a, header.tbh button')].find((element) => {
        const elementStyle = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return elementStyle.display !== 'none'
          && elementStyle.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
          && overlaps(rect);
      });
      return covered ? (covered.textContent || covered.getAttribute('aria-label') || covered.tagName).trim() : '';
    });
    check(!coveredHeaderControl, context, 'accessibility', `Pause control covers header control: ${coveredHeaderControl}`);
  }

  const h1 = page.locator('main h1').first();
  check(await h1.count() === 1 && await h1.isVisible(), context, 'content', 'A visible main h1 was not found');
  const cta = page.locator('main a.btn, main [data-cta], main a[href*="/contact/"], main a[href*="/meeting/"]').first();
  check(await cta.count() > 0 && await cta.isVisible(), context, 'content', 'A visible main CTA was not found');

  // Missing-asset mode intentionally hides the decorative mascot and validates
  // that unavailable state in assertMissingAssetFallback().
  if ((page.viewportSize()?.width || 0) <= 900 && context.mode !== 'missing-assets') {
    await assertCompactPresentation(page, context);
  }

  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    duplicateIds: Array.from(document.querySelectorAll('[id]'))
      .map((element) => element.id)
      .filter((id, index, all) => id && all.indexOf(id) !== index),
  }));
  check(layout.scrollWidth <= layout.innerWidth + 2, context, 'overflow', `scrollWidth=${layout.scrollWidth}, innerWidth=${layout.innerWidth}`);
  check(layout.duplicateIds.length === 0, context, 'duplicate-id', `Duplicate IDs: ${[...new Set(layout.duplicateIds)].join(', ')}`);

  const invalidToriuruDimensions = await page.locator(`img[src*="${toriuruImagePrefix}"]`).evaluateAll((images) => images
    .filter((image) => Number(image.getAttribute('width')) <= 0 || Number(image.getAttribute('height')) <= 0)
    .map((image) => image.getAttribute('src')));
  check(
    invalidToriuruDimensions.length === 0,
    context,
    'image-dimensions',
    `Toriuru images lack width/height: ${invalidToriuruDimensions.join(', ')}`,
  );

  const navigation = await page.locator('header.tbh nav.links > a').evaluateAll((links) => links.map((link) => ({
    label: (link.textContent || '').trim().replace(/\s+/g, ' '),
    pathname: new URL(link.href).pathname,
  })));
  const navigationMap = new Map(navigation.map(({ label, pathname }) => [label, pathname]));
  check(navigationMap.get('企業理念') === '/trillionbank/mission/', context, 'navigation', '企業理念 must link to the preserved mission route');
  check(navigationMap.get('企業概要') === '/trillionbank/company/', context, 'navigation', '企業概要 must link to the company route');
  check(navigationMap.get('コラム') === '/trillionbank/insights/', context, 'navigation', 'コラム must link to the preserved insights route');
  check(
    !navigation.some(({ label }) => ['MISSION', 'INSIGHTS', 'COMPANY', 'MEDIA / NEWS'].includes(label)),
    context,
    'navigation',
    'Legacy English navigation labels are still visible',
  );

  const footerNavigation = await page.locator('footer.tbf .fcol a').evaluateAll((links) => links.map((link) => ({
    label: (link.textContent || '').trim().replace(/\s+/g, ' '),
    pathname: new URL(link.href).pathname,
  })));
  const footerNavigationMap = new Map(footerNavigation.map(({ label, pathname }) => [label, pathname]));
  check(footerNavigationMap.get('企業理念') === '/trillionbank/mission/', context, 'navigation', 'Footer 企業理念 must link to the preserved mission route');
  check(footerNavigationMap.get('企業概要') === '/trillionbank/company/', context, 'navigation', 'Footer 企業概要 must link to the company route');
  check(footerNavigationMap.get('コラム') === '/trillionbank/insights/', context, 'navigation', 'Footer コラム must link to the preserved insights route');
  check(
    !footerNavigation.some(({ label }) => ['Mission', 'Insights', 'Media / News', '会社概要'].includes(label)),
    context,
    'navigation',
    'Legacy footer navigation labels are still visible',
  );

  await assertCrawlerLabPositioning(page, route, context);
  await assertMetadata(page, route, context);
}

async function assertNormalMotion(page, context) {
  const initialContent = await contentSnapshot(page);
  const maximum = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
  check(maximum >= 300, context, 'motion', `Page is too short for scroll animation: ${maximum}px`);

  const firstScrollY = await scrollToProgress(page, 0.25);
  const first = await motionState(page);
  await scrollToProgress(page, 0.65);
  const second = await motionState(page);
  check(!sameMotionState(first, second, 2), context, 'motion', 'Mascot did not move with forward scrolling');

  await scrollToY(page, firstScrollY);
  const reversed = await motionState(page);
  check(sameMotionState(first, reversed, 2), context, 'reverse-scroll', 'Mascot did not return to its earlier position after reverse scrolling');

  await scrollToProgress(page, 0.50);
  await page.waitForTimeout(180);
  const stoppedA = await motionState(page);
  await page.waitForTimeout(500);
  const stoppedB = await motionState(page);
  check(sameMotionState(stoppedA, stoppedB, 1), context, 'scroll-stop', 'Mascot kept drifting after scrolling stopped');

  const afterContent = await contentSnapshot(page);
  compareContentSnapshots(initialContent, afterContent, context);
  await scrollToProgress(page, 0);
}

async function assertReducedMotion(page, context) {
  await scrollToProgress(page, 0.20);
  const first = await motionState(page);
  await scrollToProgress(page, 0.75);
  const second = await motionState(page);
  // In reduced mode the mascot must remain fixed in place and no animation may
  // be running while the document scrolls.
  check(sameMotionState(first, second, 1), context, 'reduced-motion', 'Mascot moved despite prefers-reduced-motion: reduce');

  const running = await page.locator('[data-toriuru-root]').evaluate((root) => root
    .getAnimations({ subtree: true })
    .filter((animation) => animation.playState === 'running').length);
  check(running === 0, context, 'reduced-motion', `${running} mascot animation(s) are still running`);
}

async function assertMissingAssetFallback(page, context, failedRequestCount) {
  check(failedRequestCount > 0, context, 'missing-assets', 'No Toriuru image request was intercepted');
  const visiblyBroken = await page.locator(`img[src*="${toriuruImagePrefix}"]`).evaluateAll((images) => images
    .filter((image) => {
      if (!image.complete || image.naturalWidth !== 0) return false;
      let current = image;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        current = current.parentElement;
      }
      return true;
    })
    .map((image) => image.getAttribute('src')));
  check(visiblyBroken.length === 0, context, 'missing-assets', `Visible broken mascot images: ${visiblyBroken.join(', ')}`);
  const fallbackState = await page.locator('[data-toriuru-root]').evaluate((root) => ({
    unavailable: root.classList.contains('is-unavailable'),
    display: getComputedStyle(root).display,
    toggleHidden: root.querySelector('[data-toriuru-toggle]')?.hidden,
  }));
  check(fallbackState.unavailable, context, 'missing-assets', 'Failed neutral asset did not mark the mascot unavailable');
  check(fallbackState.display === 'none', context, 'missing-assets', 'Failed mascot still leaves an empty visible stage');
  check(fallbackState.toggleHidden, context, 'missing-assets', 'Failed mascot leaves its pause control exposed');
}

async function mobileNavigationState(page) {
  return page.evaluate(() => {
    const header = document.querySelector('header.tbh');
    const burger = document.querySelector('#tbBurger');
    const nav = document.querySelector('header.tbh nav.links');
    const business = nav?.querySelector('.mega-t');
    const businessPanel = document.getElementById(business?.getAttribute('aria-controls') || '');
    const isVisible = (element) => {
      if (!element) return false;
      let current = element;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < .01) {
          return false;
        }
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return {
      burgerControls: burger?.getAttribute('aria-controls') || '',
      burgerExpanded: burger?.getAttribute('aria-expanded'),
      navId: nav?.id || '',
      navAriaHidden: nav?.getAttribute('aria-hidden'),
      navInert: Boolean(nav?.inert),
      navHasInertAttribute: Boolean(nav?.hasAttribute('inert')),
      headerOpen: Boolean(header?.classList.contains('open')),
      businessExpanded: business?.getAttribute('aria-expanded'),
      businessControls: business?.getAttribute('aria-controls') || '',
      businessPanelId: businessPanel?.id || '',
      businessPanelAriaHidden: businessPanel?.getAttribute('aria-hidden'),
      businessPanelVisible: isVisible(businessPanel),
      burgerFocused: document.activeElement === burger,
      businessFocused: document.activeElement === business,
      firstBusinessLinkFocused: document.activeElement === businessPanel?.querySelector('a'),
      firstNavigationControlFocused: document.activeElement === nav?.querySelector(':scope > .mega > .mega-t, :scope > a[href]'),
      focusInsideNav: Boolean(nav?.contains(document.activeElement)),
    };
  });
}

function assertClosedMobileNavigation(state, context, detailPrefix, { expectBurgerFocus = false } = {}) {
  check(state.burgerExpanded === 'false', context, 'mobile-navigation', `${detailPrefix}: burger aria-expanded must be false`);
  check(!state.headerOpen, context, 'mobile-navigation', `${detailPrefix}: header still has the open state`);
  check(state.navAriaHidden === 'true', context, 'mobile-navigation', `${detailPrefix}: closed nav must have aria-hidden=true`);
  check(state.navInert, context, 'mobile-navigation', `${detailPrefix}: closed nav must be inert`);
  check(state.navHasInertAttribute, context, 'mobile-navigation', `${detailPrefix}: closed nav must retain the inert attribute`);
  if (expectBurgerFocus) {
    check(state.burgerFocused, context, 'mobile-navigation', `${detailPrefix}: focus was not restored to the burger`);
  }
}

async function assertHeaderOnscreen(page, context, detail) {
  const state = await page.locator('header.tbh').evaluate((header) => {
    const rect = header.getBoundingClientRect();
    return {
      className: header.className,
      top: rect.top,
      bottom: rect.bottom,
    };
  });
  check(
    !state.className.split(/\s+/).includes('hide') && state.top >= -1 && state.bottom > 0,
    context,
    'header-interaction',
    `${detail}: interactive header is offscreen (${JSON.stringify(state)})`,
  );
}

async function assertDesktopHeaderInteraction(page, context) {
  const business = page.locator('header.tbh .mega-t').first();
  await scrollToY(page, Math.min(700, await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)));
  await business.focus();
  await page.waitForTimeout(50);
  await assertHeaderOnscreen(page, context, 'Focused desktop disclosure');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(100);
  await assertHeaderOnscreen(page, context, 'Expanded desktop disclosure after downward scroll');
  await page.keyboard.press('Escape');
}

async function assertMobileKeyboardNavigationRoute(browserContext, viewport, route) {
  const context = { mode: 'mobile-keyboard-navigation', viewport, route };
  const page = await browserContext.newPage();
  observePage(page, context);
  try {
    await goto(page, route, context);
    await assertTargetShell(page, route, context);

    const burger = page.locator('#tbBurger');
    const nav = page.locator('header.tbh nav.links');
    const business = nav.locator('.mega-t');
    const directLink = nav.locator(':scope > a').first();
    check(await burger.count() === 1, context, 'mobile-navigation', 'Mobile burger was not found');
    check(await nav.count() === 1, context, 'mobile-navigation', 'Mobile nav was not found');
    check(await business.count() === 1, context, 'mobile-navigation', 'BUSINESS toggle was not found');
    check(await directLink.count() === 1, context, 'mobile-navigation', 'No direct mobile nav link was found');
    if (await burger.count() !== 1 || await nav.count() !== 1 || await business.count() !== 1 || await directLink.count() !== 1) {
      return;
    }

    const initial = await mobileNavigationState(page);
    check(Boolean(initial.navId), context, 'mobile-navigation', 'Mobile nav must have an id');
    check(
      initial.burgerControls === initial.navId,
      context,
      'mobile-navigation',
      `Burger aria-controls=${initial.burgerControls || 'missing'} does not point to nav#${initial.navId || 'missing'}`,
    );
    assertClosedMobileNavigation(initial, context, 'Initial state');

    await burger.focus();
    await page.keyboard.press('Tab');
    check(
      !(await mobileNavigationState(page)).focusInsideNav,
      context,
      'mobile-navigation',
      'Closed inert nav still participates in keyboard focus order',
    );
    await burger.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(30);
    const opened = await mobileNavigationState(page);
    check(opened.burgerExpanded === 'true', context, 'mobile-navigation', 'Enter did not set burger aria-expanded=true');
    check(opened.headerOpen, context, 'mobile-navigation', 'Enter did not open the mobile header');
    check(opened.navAriaHidden !== 'true', context, 'mobile-navigation', 'Open nav is still aria-hidden');
    check(!opened.navInert, context, 'mobile-navigation', 'Open nav is still inert');
    check(!opened.navHasInertAttribute, context, 'mobile-navigation', 'Open nav still has the inert attribute');
    check(!opened.businessPanelVisible, context, 'mobile-navigation', 'Collapsed BUSINESS panel is visible');
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(100);
    await assertHeaderOnscreen(page, context, 'Open mobile navigation after downward scroll');
    await page.keyboard.press('Tab');
    check(
      (await mobileNavigationState(page)).focusInsideNav,
      context,
      'mobile-navigation',
      'Tab from the open burger did not enter the mobile nav',
    );

    await business.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const businessOpened = await mobileNavigationState(page);
    check(businessOpened.businessExpanded === 'true', context, 'mobile-navigation', 'Space did not expand BUSINESS');
    check(businessOpened.businessPanelVisible, context, 'mobile-navigation', 'Expanded BUSINESS panel is not visible');
    check(
      businessOpened.businessControls === businessOpened.businessPanelId,
      context,
      'mobile-navigation',
      'BUSINESS aria-controls does not point to its panel',
    );
    check(
      businessOpened.businessPanelAriaHidden === 'false',
      context,
      'mobile-navigation',
      'Expanded BUSINESS panel remains aria-hidden',
    );
    check(
      businessOpened.firstBusinessLinkFocused,
      context,
      'mobile-navigation',
      'Opening BUSINESS did not focus its first link',
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const businessClosed = await mobileNavigationState(page);
    check(businessClosed.businessExpanded === 'false', context, 'mobile-navigation', 'First Escape did not collapse BUSINESS');
    check(!businessClosed.businessPanelVisible, context, 'mobile-navigation', 'Collapsed BUSINESS panel remains visible');
    check(businessClosed.businessPanelAriaHidden === 'true', context, 'mobile-navigation', 'Collapsed BUSINESS panel is not aria-hidden');
    check(businessClosed.businessFocused, context, 'mobile-navigation', 'First Escape did not restore focus to BUSINESS');
    check(businessClosed.burgerExpanded === 'true', context, 'mobile-navigation', 'First Escape also collapsed the mobile nav');
    check(businessClosed.headerOpen, context, 'mobile-navigation', 'First Escape closed the mobile header');
    check(businessClosed.navAriaHidden !== 'true', context, 'mobile-navigation', 'First Escape hid the mobile nav');
    check(!businessClosed.navInert, context, 'mobile-navigation', 'First Escape made the mobile nav inert');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(30);
    assertClosedMobileNavigation(
      await mobileNavigationState(page),
      context,
      'Second Escape',
      { expectBurgerFocus: true },
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(100);
    await burger.focus();
    await page.keyboard.press('Space');
    await business.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const beforeLink = await mobileNavigationState(page);
    check(beforeLink.burgerExpanded === 'true', context, 'mobile-navigation', 'Link-close setup did not open the mobile nav');
    check(beforeLink.headerOpen, context, 'mobile-navigation', 'Link-close setup did not open the mobile header');
    check(beforeLink.navAriaHidden !== 'true', context, 'mobile-navigation', 'Link-close setup nav is aria-hidden');
    check(!beforeLink.navInert, context, 'mobile-navigation', 'Link-close setup nav is inert');
    check(beforeLink.businessExpanded === 'true', context, 'mobile-navigation', 'Link-close setup did not expand BUSINESS');
    check(beforeLink.businessPanelVisible, context, 'mobile-navigation', 'Link-close setup BUSINESS panel is not visible');
    await directLink.evaluate((link) => {
      link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    });
    await directLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(30);
    const linkClosed = await mobileNavigationState(page);
    assertClosedMobileNavigation(linkClosed, context, 'Link activation');
    check(
      linkClosed.businessExpanded === 'false',
      context,
      'mobile-navigation',
      'Link activation did not reset BUSINESS aria-expanded=false',
    );

    results.push({ mode: 'mobile-keyboard-navigation', viewport: viewport.name, route: route.url });
  } catch (error) {
    addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
  } finally {
    await page.close();
  }
}

async function runMobileKeyboardNavigation(browser) {
  const viewport = viewports.find((item) => item.name === 'mobile-375');
  const routes = [
    targetRoutes[0],
    targetRoutes.find((item) => item.name === 'insights'),
  ];
  const browserContext = await newContext(browser, { viewport });
  try {
    for (const route of routes) {
      await assertMobileKeyboardNavigationRoute(browserContext, viewport, route);
    }
  } finally {
    await browserContext.close();
  }
}

async function runBreakpointFocus(browser) {
  const desktopViewport = { name: 'breakpoint-desktop-1024', width: 1024, height: 768 };
  const mobileViewport = { name: 'breakpoint-mobile-768', width: 768, height: 768 };
  const route = targetRoutes[0];
  const context = { mode: 'breakpoint-focus', viewport: desktopViewport, route };
  const browserContext = await newContext(browser, { viewport: desktopViewport });
  const page = await browserContext.newPage();
  observePage(page, context);

  try {
    await goto(page, route, context);
    await assertTargetShell(page, route, context);
    const business = page.locator('header.tbh .mega-t').first();

    await scrollToY(page, 320);
    await business.evaluate((element) => element.focus({ preventScroll: true }));
    const beforeMobile = await page.evaluate(() => scrollY);

    await page.setViewportSize({ width: mobileViewport.width, height: mobileViewport.height });
    await page.waitForFunction(() => document.activeElement === document.getElementById('tbBurger'));
    const mobileState = await mobileNavigationState(page);
    assertClosedMobileNavigation(
      mobileState,
      { ...context, viewport: mobileViewport },
      'Desktop-to-mobile breakpoint',
      { expectBurgerFocus: true },
    );
    check(
      nearlyEqual(await page.evaluate(() => scrollY), beforeMobile, 1),
      { ...context, viewport: mobileViewport },
      'breakpoint-focus',
      'Moving focus from desktop navigation to the burger changed scroll position',
    );

    const beforeDesktop = await page.evaluate(() => scrollY);
    await page.setViewportSize({ width: desktopViewport.width, height: desktopViewport.height });
    await page.waitForFunction(() => {
      const nav = document.getElementById('tbNav');
      return document.activeElement === nav?.querySelector(':scope > .mega > .mega-t, :scope > a[href]');
    });
    const desktopState = await mobileNavigationState(page);
    check(desktopState.firstNavigationControlFocused, context, 'breakpoint-focus', 'Desktop navigation did not receive focus after the burger became hidden');
    check(desktopState.navAriaHidden === null, context, 'breakpoint-focus', 'Desktop navigation remains aria-hidden after expansion');
    check(!desktopState.navInert, context, 'breakpoint-focus', 'Desktop navigation remains inert after expansion');
    check(!desktopState.navHasInertAttribute, context, 'breakpoint-focus', 'Desktop navigation retains the inert attribute after expansion');
    check(
      nearlyEqual(await page.evaluate(() => scrollY), beforeDesktop, 1),
      context,
      'breakpoint-focus',
      'Moving focus from the burger to desktop navigation changed scroll position',
    );
    await assertHeaderOnscreen(page, context, 'Navigation after breakpoint focus migration');

    results.push({
      mode: 'breakpoint-focus',
      viewport: '1024x768->768x768->1024x768',
      route: route.url,
    });
  } catch (error) {
    addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
  } finally {
    await page.close();
    await browserContext.close();
  }
}

async function runNormalMatrix(browser) {
  for (const viewport of viewports) {
    const browserContext = await newContext(browser, { viewport });
    try {
      for (const route of targetRoutes) {
        const context = { mode: 'normal', viewport, route };
        const page = await browserContext.newPage();
        observePage(page, context);
        try {
          await goto(page, route, context);
          await assertTargetShell(page, route, context);
          if (viewport.name === 'desktop-1440') {
            await assertNormalMotion(page, context);
            if (route.name === 'home') await assertDesktopHeaderInteraction(page, context);
          }
          if (viewport.name === 'mobile-390') {
            await assertInternalLinks(page, context);
          }

          if (viewport.name === 'desktop-1440' || viewport.name === 'mobile-390') {
            // Capture the initial page state, independently of the scroll positions
            // exercised above. Leaving the document first prevents a same-URL reload
            // from restoring its previous scroll position and hidden header state.
            await page.goto('about:blank');
            await goto(page, route, context);
            const screenshot = `${viewport.name}__${route.name}.png`;
            const heroScreenshot = `${viewport.name}__${route.name}__hero.png`;
            await page.screenshot({ path: path.join(outputDir, heroScreenshot), fullPage: false });
            await page.screenshot({ path: path.join(outputDir, screenshot), fullPage: true });
          }
          results.push({ mode: 'normal', viewport: viewport.name, route: route.url });
        } catch (error) {
          addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
        } finally {
          await page.close();
        }
      }
    } finally {
      await browserContext.close();
    }
  }
}

async function runRotation(browser) {
  const portrait = viewports.find((item) => item.name === 'mobile-390');
  const landscape = viewports.find((item) => item.name === 'landscape-844');
  for (const route of [targetRoutes[0], targetRoutes.find((item) => item.name === 'business')]) {
    const context = { mode: 'rotation', viewport: portrait, route };
    const browserContext = await newContext(browser, { viewport: portrait });
    const page = await browserContext.newPage();
    observePage(page, context);
    try {
      await goto(page, route, context);
      await assertTargetShell(page, route, context);
      await assertViewportOverflow(page, context, 'Portrait before rotation');
      const portraitBefore = await staticMascotDocumentRect(page);

      await page.setViewportSize({ width: landscape.width, height: landscape.height });
      await page.waitForTimeout(200);
      await scrollToY(page, 0);
      const landscapeContext = { ...context, viewport: landscape };
      await assertViewportOverflow(page, landscapeContext, 'Landscape after rotation');
      await assertCompactPresentation(page, landscapeContext);

      await page.setViewportSize({ width: portrait.width, height: portrait.height });
      await page.waitForTimeout(200);
      await scrollToY(page, 0);
      await assertViewportOverflow(page, context, 'Portrait after rotation');
      await assertCompactPresentation(page, context);
      const portraitAfter = await staticMascotDocumentRect(page);
      const recovered = ['left', 'top', 'width', 'height'].every((key) => (
        nearlyEqual(portraitBefore[key], portraitAfter[key], 2)
      ));
      check(
        recovered,
        context,
        'rotation',
        `Static mascot layout did not recover: before=${JSON.stringify(portraitBefore)}, after=${JSON.stringify(portraitAfter)}`,
      );
      results.push({ mode: 'rotation', viewport: '390x844->844x390->390x844', route: route.url });
    } catch (error) {
      addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
    } finally {
      await page.close();
      await browserContext.close();
    }
  }
}

async function runReducedMatrix(browser) {
  const viewport = viewports.find((item) => item.name === 'desktop-1440');
  const browserContext = await newContext(browser, { viewport, reducedMotion: 'reduce' });
  try {
    for (const route of targetRoutes) {
      const context = { mode: 'reduced', viewport, route };
      const page = await browserContext.newPage();
      observePage(page, context);
      try {
        await goto(page, route, context);
        await assertTargetShell(page, route, context);
        await assertReducedMotion(page, context);
        results.push({ mode: 'reduced', viewport: viewport.name, route: route.url });
      } catch (error) {
        addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browserContext.close();
  }
}

async function assertNoJSNavigation(page, context) {
  const state = await page.evaluate(() => {
    const fallback = document.querySelector('.tb-refresh-fallback-nav');
    const normalNavigation = document.getElementById('tbNav');
    const burger = document.getElementById('tbBurger');
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > .01
        && rect.width > 0
        && rect.height > 0;
    };
    return {
      fallbackVisible: visible(fallback),
      fallbackLinkCount: fallback?.querySelectorAll('a[href]').length || 0,
      normalNavigationInert: Boolean(normalNavigation?.inert),
      normalNavigationAriaHidden: normalNavigation?.getAttribute('aria-hidden'),
      burgerAriaHidden: burger?.getAttribute('aria-hidden'),
      burgerTabIndex: burger?.getAttribute('tabindex'),
    };
  });
  check(state.fallbackVisible, context, 'no-js-navigation', 'Fallback navigation is not visible');
  check(state.fallbackLinkCount >= 6, context, 'no-js-navigation', `Fallback navigation has only ${state.fallbackLinkCount} links`);
  check(state.normalNavigationInert, context, 'no-js-navigation', 'Enhanced navigation is focusable without JavaScript');
  check(state.normalNavigationAriaHidden === 'true', context, 'no-js-navigation', 'Enhanced navigation is exposed without JavaScript');
  check(state.burgerAriaHidden === 'true', context, 'no-js-navigation', 'Inactive burger is exposed without JavaScript');
  check(state.burgerTabIndex === '-1', context, 'no-js-navigation', 'Inactive burger remains in the tab order without JavaScript');
}

async function runNoJSMatrix(browser) {
  const noJSViewports = [
    viewports.find((item) => item.name === 'desktop-1440'),
    viewports.find((item) => item.name === 'mobile-390'),
  ];
  for (const viewport of noJSViewports) {
    const browserContext = await newContext(browser, { viewport, javaScriptEnabled: false });
    const routes = viewport.name === 'desktop-1440' ? [targetRoutes[0]] : targetRoutes;
    try {
      for (const route of routes) {
        const context = { mode: 'no-js', viewport, route };
        const page = await browserContext.newPage();
        observePage(page, context);
        try {
          await goto(page, route, context);
          await assertTargetShell(page, route, context);
          const snapshot = await contentSnapshot(page);
          check(snapshot.elements.every((item) => item.visible), context, 'no-js', 'Main copy or CTA is hidden without JavaScript');
          await assertNoJSNavigation(page, context);
          results.push({ mode: 'no-js', viewport: viewport.name, route: route.url });
        } catch (error) {
          addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
        } finally {
          await page.close();
        }
      }
    } finally {
      await browserContext.close();
    }
  }
}

async function runMissingAssetMatrix(browser) {
  const viewport = viewports.find((item) => item.name === 'mobile-390');
  for (const route of targetRoutes) {
    const browserContext = await newContext(browser, { viewport, missingAssets: true });
    const context = { mode: 'missing-assets', viewport, route };
    const page = await browserContext.newPage();
    observePage(page, context, { allowMissingToriuru: true });
    try {
      await goto(page, route, context);
      await assertTargetShell(page, route, context);
      await page.waitForTimeout(150);
      await assertMissingAssetFallback(page, context, browserContext.__failedToriuruRequests);
      results.push({ mode: 'missing-assets', viewport: viewport.name, route: route.url });
    } catch (error) {
      addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
    } finally {
      await page.close();
      await browserContext.close();
    }
  }
}

async function runPausePersistence(browser) {
  const viewport = viewports.find((item) => item.name === 'desktop-1440');
  const route = targetRoutes[0];
  const context = { mode: 'pause-persistence', viewport, route };
  const browserContext = await newContext(browser, { viewport });
  const page = await browserContext.newPage();
  observePage(page, context);
  try {
    await goto(page, route, context);
    await assertTargetShell(page, route, context);
    const toggle = page.locator('[data-toriuru-toggle]');
    check(await toggle.isVisible(), context, 'pause', 'Pause control must be visible on desktop');
    check(await toggle.getAttribute('aria-pressed') === 'false', context, 'pause', 'Pause control must start unpressed in a fresh context');

    await toggle.focus();
    await page.keyboard.press('Enter');
    check(await toggle.getAttribute('aria-pressed') === 'true', context, 'pause', 'Enter did not pause motion or set aria-pressed=true');
    const stored = await page.evaluate((key) => localStorage.getItem(key), pauseStorageKey);
    check(stored === 'true', context, 'pause', `Expected ${pauseStorageKey}=true, got ${stored}`);

    await scrollToProgress(page, 0.25);
    const pausedA = await motionState(page);
    await scrollToProgress(page, 0.75);
    const pausedB = await motionState(page);
    check(sameMotionState(pausedA, pausedB, 1), context, 'pause', 'Paused mascot moved during scrolling');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(100);
    const reloadedToggle = page.locator('[data-toriuru-toggle]');
    check(await reloadedToggle.getAttribute('aria-pressed') === 'true', context, 'pause', 'Paused state did not survive reload');

    await reloadedToggle.focus();
    await page.keyboard.press('Space');
    check(await reloadedToggle.getAttribute('aria-pressed') === 'false', context, 'pause', 'Space did not resume motion or set aria-pressed=false');
    results.push({ mode: 'pause-persistence', viewport: viewport.name, route: route.url });
  } catch (error) {
    addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
  } finally {
    await page.close();
    await browserContext.close();
  }
}

async function runProtectedScopeMatrix(browser) {
  const protectedViewports = [
    viewports.find((item) => item.name === 'desktop-1440'),
    viewports.find((item) => item.name === 'mobile-390'),
  ];

  for (const viewport of protectedViewports) {
    // JS is deliberately disabled: this test proves design-asset isolation without
    // invoking authenticated product behavior or backend/API requests.
    const browserContext = await newContext(browser, { viewport, javaScriptEnabled: false });
    try {
      for (const route of protectedRoutes) {
        const context = { mode: 'protected-scope', viewport, route };
        const page = await browserContext.newPage();
        const refreshRequests = [];
        page.on('request', (request) => {
          const pathname = new URL(request.url()).pathname;
          if ([refreshCSSPath, refreshJSPath, navigationJSPath].includes(pathname)) refreshRequests.push(request.url());
        });
        observePage(page, context);
        try {
          await goto(page, route, context);
          const bodyMatches = await page.locator('body.tb-refresh[data-site-refresh]').count();
          const cssCount = await page.locator(`link[href*="${refreshCSSPath}"]`).count();
          const jsCount = await page.locator(`script[src*="${refreshJSPath}"]`).count();
          const navigationJSCount = await page.locator(`script[src*="${navigationJSPath}"]`).count();
          const mascotCount = await page.locator('[data-toriuru-root], [data-toriuru], [data-toriuru-toggle]').count();
          check(bodyMatches === 0, context, 'protected-scope', 'Protected page received refresh body scope');
          check(cssCount === 0, context, 'protected-scope', 'Protected page loads tb-refresh.css');
          check(jsCount === 0, context, 'protected-scope', 'Protected page loads toriuru-scroll.js');
          check(navigationJSCount === 0, context, 'protected-scope', 'Protected page loads tb-refresh-navigation.js');
          check(refreshRequests.length === 0, context, 'protected-scope', `Protected page requested refresh assets: ${refreshRequests.join(', ')}`);
          check(mascotCount === 0, context, 'protected-scope', 'Protected page contains refresh mascot controls');

          results.push({ mode: 'protected-scope', viewport: viewport.name, route: route.url });
        } catch (error) {
          addIssue({ ...context, type: 'exception', detail: error.stack || error.message });
        } finally {
          await page.close();
        }
      }
    } finally {
      await browserContext.close();
    }
  }
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  if (shouldRunMode('normal')) await runNormalMatrix(browser);
  if (shouldRunMode('mobile-keyboard-navigation')) await runMobileKeyboardNavigation(browser);
  if (shouldRunMode('breakpoint-focus')) await runBreakpointFocus(browser);
  if (shouldRunMode('reduced')) await runReducedMatrix(browser);
  if (shouldRunMode('no-js')) await runNoJSMatrix(browser);
  if (shouldRunMode('missing-assets')) await runMissingAssetMatrix(browser);
  if (shouldRunMode('pause-persistence')) await runPausePersistence(browser);
  if (shouldRunMode('rotation')) await runRotation(browser);
  if (shouldRunMode('protected-scope')) await runProtectedScopeMatrix(browser);
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  targetRoutes,
  protectedRoutes,
  viewports,
  requestedModes: [...requestedModes],
  resultCount: results.length,
  results,
  issueCount: issues.length,
  issues,
};

await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (issues.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`Site refresh smoke tests passed: ${results.length} cases`);
