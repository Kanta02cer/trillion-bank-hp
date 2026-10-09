import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4000';
const baseOrigin = new URL(baseURL).origin;
const outputDir = path.resolve(process.env.REFRESH_SMOKE_OUTPUT || 'artifacts/site-refresh-smoke');

const targetRoutes = [
  { name: 'home', url: '/' },
  { name: 'mission', url: '/trillionbank/mission/' },
  { name: 'insights', url: '/trillionbank/insights/' },
  { name: 'company', url: '/trillionbank/company/' },
  { name: 'media', url: '/trillionbank/media/' },
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
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'small-320', width: 320, height: 568 },
  { name: 'landscape-844', width: 844, height: 390 },
];

const refreshCSSPath = '/trillionbank/assets/css/tb-refresh.css';
const refreshJSPath = '/trillionbank/assets/js/toriuru-scroll.js';
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

async function assertTargetShell(page, route, context) {
  const bodyMatches = await page.locator('body.tb-refresh[data-site-refresh]').count();
  check(bodyMatches === 1, context, 'scope', 'Missing body.tb-refresh[data-site-refresh]');

  const cssCount = await page.locator(`link[rel="stylesheet"][href*="${refreshCSSPath}"]`).count();
  const jsCount = await page.locator(`script[src*="${refreshJSPath}"]`).count();
  check(cssCount === 1, context, 'scope', `Expected refresh CSS once, found ${cssCount}`);
  check(jsCount === 1, context, 'scope', `Expected Toriuru JS once, found ${jsCount}`);

  const root = page.locator('[data-toriuru-root]');
  const orbit = page.locator('[data-toriuru]');
  const toggle = page.locator('[data-toriuru-toggle]');
  const scenes = page.locator('[data-toriuru-scene]');
  check(await root.count() === 1, context, 'mascot', 'Expected one [data-toriuru-root]');
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

    if (context.viewport.width <= 900 && await toggle.isVisible()) {
      const placement = await toggle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const header = document.querySelector('header.tbh')?.getBoundingClientRect();
        const brand = document.querySelector('header.tbh .brand')?.getBoundingClientRect();
        const burger = document.querySelector('header.tbh .burger')?.getBoundingClientRect();
        const overlaps = (first, second) => Boolean(second)
          && first.right > second.left
          && first.left < second.right
          && first.bottom > second.top
          && first.top < second.bottom;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          insideHeader: Boolean(header) && rect.top >= header.top - 1 && rect.bottom <= header.bottom + 1,
          clearsHeaderControls: !overlaps(rect, brand) && !overlaps(rect, burger),
          receivesPointer: Boolean(hit) && element.contains(hit),
        };
      });
      check(placement.insideHeader, context, 'control-placement', 'Pause control must stay inside the mobile header');
      check(placement.clearsHeaderControls, context, 'control-placement', 'Pause control overlaps the brand or menu button');
      check(placement.receivesPointer, context, 'control-placement', 'Pause control is obscured by another element');
    }
  }

  const h1 = page.locator('main h1').first();
  check(await h1.count() === 1 && await h1.isVisible(), context, 'content', 'A visible main h1 was not found');
  const cta = page.locator('main a.btn, main [data-cta], main a[href*="/contact/"], main a[href*="/meeting/"]').first();
  check(await cta.count() > 0 && await cta.isVisible(), context, 'content', 'A visible main CTA was not found');

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

async function assertShortLandscapeDirection(page, context) {
  const rightPointingScene = page.locator('[data-toriuru-scene][data-pose="point-right"]').first();
  if (await rightPointingScene.count() === 0) return;

  const targetY = await rightPointingScene.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return scrollY + rect.top + rect.height / 2 - innerHeight / 2;
  });
  await scrollToY(page, targetY);
  await page.waitForFunction(() => Boolean(
    document.querySelector('.toriuru-guide__pose[data-pose="point-left"].is-active'),
  ), null, { timeout: 3_000 }).catch(() => {});
  const activePose = await page.locator('.toriuru-guide__pose.is-active').first().getAttribute('data-pose');
  check(
    activePose === 'point-left',
    context,
    'short-landscape-direction',
    `Expected inward point-left pose in a short landscape viewport, got ${activePose || 'none'}`,
  );
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
          if (viewport.name === 'mobile-390') {
            await assertNormalMotion(page, context);
            await assertInternalLinks(page, context);
          }
          if (viewport.name === 'landscape-844') {
            await assertShortLandscapeDirection(page, context);
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
      const portraitScrollY = await scrollToProgress(page, 0.45);
      const portraitBefore = await motionState(page);

      await page.setViewportSize({ width: landscape.width, height: landscape.height });
      await page.waitForTimeout(120);
      await scrollToY(page, portraitScrollY);
      const landscapeLayout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
      }));
      check(
        landscapeLayout.scrollWidth <= landscapeLayout.innerWidth + 2,
        context,
        'rotation',
        `Landscape overflow: scrollWidth=${landscapeLayout.scrollWidth}, innerWidth=${landscapeLayout.innerWidth}`,
      );

      await page.setViewportSize({ width: portrait.width, height: portrait.height });
      await page.waitForTimeout(120);
      await scrollToY(page, portraitScrollY);
      const portraitAfter = await motionState(page);
      check(sameMotionState(portraitBefore, portraitAfter, 2), context, 'rotation', 'Mascot position did not recover after portrait-landscape-portrait rotation');
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
  const viewport = viewports.find((item) => item.name === 'mobile-390');
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

async function runNoJSMatrix(browser) {
  const viewport = viewports.find((item) => item.name === 'mobile-390');
  const browserContext = await newContext(browser, { viewport, javaScriptEnabled: false });
  try {
    for (const route of targetRoutes) {
      const context = { mode: 'no-js', viewport, route };
      const page = await browserContext.newPage();
      observePage(page, context);
      try {
        await goto(page, route, context);
        await assertTargetShell(page, route, context);
        const snapshot = await contentSnapshot(page);
        check(snapshot.elements.every((item) => item.visible), context, 'no-js', 'Main copy or CTA is hidden without JavaScript');
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
  const viewport = viewports.find((item) => item.name === 'mobile-390');
  const route = targetRoutes[0];
  const context = { mode: 'pause-persistence', viewport, route };
  const browserContext = await newContext(browser, { viewport });
  const page = await browserContext.newPage();
  observePage(page, context);
  try {
    await goto(page, route, context);
    await assertTargetShell(page, route, context);
    const toggle = page.locator('[data-toriuru-toggle]');
    check(await toggle.getAttribute('aria-pressed') === 'false', context, 'pause', 'Pause control must start unpressed in a fresh context');

    await toggle.focus();
    await page.keyboard.press('Enter');
    check(await toggle.getAttribute('aria-pressed') === 'true', context, 'pause', 'Enter did not pause motion or set aria-pressed=true');
    const stored = await page.evaluate((key) => localStorage.getItem(key), pauseStorageKey);
    check(stored !== null, context, 'pause', `Pause state was not stored in ${pauseStorageKey}`);

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
          if (pathname === refreshCSSPath || pathname === refreshJSPath) refreshRequests.push(request.url());
        });
        observePage(page, context);
        try {
          await goto(page, route, context);
          const bodyMatches = await page.locator('body.tb-refresh[data-site-refresh]').count();
          const cssCount = await page.locator(`link[href*="${refreshCSSPath}"]`).count();
          const jsCount = await page.locator(`script[src*="${refreshJSPath}"]`).count();
          const mascotCount = await page.locator('[data-toriuru-root], [data-toriuru], [data-toriuru-toggle]').count();
          check(bodyMatches === 0, context, 'protected-scope', 'Protected page received refresh body scope');
          check(cssCount === 0, context, 'protected-scope', 'Protected page loads tb-refresh.css');
          check(jsCount === 0, context, 'protected-scope', 'Protected page loads toriuru-scroll.js');
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
  await runNormalMatrix(browser);
  await runReducedMatrix(browser);
  await runNoJSMatrix(browser);
  await runMissingAssetMatrix(browser);
  await runPausePersistence(browser);
  await runRotation(browser);
  await runProtectedScopeMatrix(browser);
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  targetRoutes,
  protectedRoutes,
  viewports,
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
