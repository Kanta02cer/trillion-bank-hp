import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4000';
const baseOrigin = new URL(baseURL).origin;
const outputDir = path.resolve('artifacts/site-smoke');

const routes = [
  { name: 'home', url: '/', text: 'Trillion Bank' },
  { name: 'business', url: '/trillionbank/business/', text: '事業' },
  { name: 'hack2', url: '/trillionbank/business/hack2/', text: 'HackⅡ' },
  { name: 'adctor', url: '/trillionbank/business/pay-per-crawl/', text: 'Adctor' },
  { name: 'insights', url: '/trillionbank/insights/', text: 'Insights' },
  { name: 'company', url: '/trillionbank/company/', text: '株式会社Trillion Bank' },
  { name: 'contact', url: '/trillionbank/contact/', text: 'お問い合わせフォーム' },
  { name: 'meeting', url: '/trillionbank/meeting/', text: '商談のご予約' },
  { name: 'privacy', url: '/trillionbank/privacy/', text: '株式会社Trillion Bank', formalLegalName: true },
  { name: 'terms', url: '/trillionbank/terms/', text: '株式会社Trillion Bank', formalLegalName: true },
  { name: 'security', url: '/trillionbank/security/', text: '株式会社Trillion Bank', formalLegalName: true },
  { name: 'article', url: '/trillionbank/news/seo-aeo-geo-aio-llmo-difference/', text: 'SEO' },
  { name: 'studio', url: '/airreach/studio/', text: 'サイト全体を分析する', expectedNoindex: true },
];

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
];

const issues = [];
const results = [];

function addIssue(viewport, route, type, detail) {
  issues.push({ viewport: viewport.name, route: route.url, type, detail });
}

function isIgnorableConsoleError(text) {
  return [
    'googletagmanager',
    'google-analytics',
    'ERR_BLOCKED_BY_CLIENT',
    'Failed to load resource',
  ].some((value) => text.includes(value));
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });

    await context.route('**/*', async (route) => {
      const requestURL = new URL(route.request().url());
      if (requestURL.origin !== baseOrigin) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    for (const routeInfo of routes) {
      const page = await context.newPage();
      const routeResult = {
        viewport: viewport.name,
        route: routeInfo.url,
        status: null,
        screenshot: null,
      };

      page.on('pageerror', (error) => {
        addIssue(viewport, routeInfo, 'pageerror', error.message);
      });

      page.on('console', (message) => {
        if (message.type() === 'error' && !isIgnorableConsoleError(message.text())) {
          addIssue(viewport, routeInfo, 'console', message.text());
        }
      });

      page.on('response', (response) => {
        const responseURL = new URL(response.url());
        if (responseURL.origin === baseOrigin && response.status() >= 400) {
          addIssue(viewport, routeInfo, 'http', `${response.status()} ${response.url()}`);
        }
      });

      page.on('requestfailed', (request) => {
        const requestURL = new URL(request.url());
        if (requestURL.origin === baseOrigin) {
          addIssue(viewport, routeInfo, 'requestfailed', `${request.url()} - ${request.failure()?.errorText || 'unknown error'}`);
        }
      });

      try {
        const response = await page.goto(new URL(routeInfo.url, baseURL).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        routeResult.status = response?.status() ?? null;
        if (!response || !response.ok()) {
          addIssue(viewport, routeInfo, 'navigation', `Unexpected status ${response?.status() ?? 'no response'}`);
        }

        await page.waitForTimeout(150);

        const h1 = page.locator('h1').first();
        if ((await h1.count()) === 0 || !(await h1.isVisible())) {
          addIssue(viewport, routeInfo, 'content', 'Visible h1 was not found');
        }

        const bodyText = await page.locator('body').innerText();
        if (!bodyText.includes(routeInfo.text)) {
          addIssue(viewport, routeInfo, 'content', `Expected visible text was not found: ${routeInfo.text}`);
        }
        if (routeInfo.formalLegalName && bodyText.includes('株式会社トリリオンバンク')) {
          addIssue(viewport, routeInfo, 'legal-name', 'Visible legal copy uses the non-legal Japanese alias');
        }

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        if (overflow.scrollWidth > overflow.innerWidth + 2) {
          addIssue(viewport, routeInfo, 'overflow', `scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`);
        }

        const canonicalCount = await page.locator('link[rel="canonical"]').count();
        if (canonicalCount !== 1) {
          addIssue(viewport, routeInfo, 'canonical', `Expected one canonical link, found ${canonicalCount}`);
        } else {
          const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
          if (!canonical?.startsWith('https://trillion-bank.jp/')) {
            addIssue(viewport, routeInfo, 'canonical', `Unexpected canonical: ${canonical}`);
          }
        }

        const robots = await page.locator('meta[name="robots"]').getAttribute('content');
        const isNoindex = Boolean(robots && robots.toLowerCase().includes('noindex'));
        if (routeInfo.expectedNoindex ? !isNoindex : (!robots || isNoindex)) {
          addIssue(viewport, routeInfo, 'robots', `Unexpected robots directive: ${robots}`);
        }

        const jsonLdBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();
        if (jsonLdBlocks.length === 0) {
          addIssue(viewport, routeInfo, 'json-ld', 'No JSON-LD block was found');
        }
        jsonLdBlocks.forEach((block, index) => {
          try {
            JSON.parse(block);
          } catch (error) {
            addIssue(viewport, routeInfo, 'json-ld', `Block ${index + 1} is invalid JSON: ${error.message}`);
          }
        });

        await page.evaluate(async () => {
          const max = document.documentElement.scrollHeight;
          for (let y = 0; y < max; y += 700) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(100);

        const brokenImages = await page.locator('img[src]').evaluateAll((images, origin) => images
          .filter((image) => {
            const src = image.currentSrc || image.src;
            return src.startsWith(origin) && image.complete && image.naturalWidth === 0;
          })
          .map((image) => image.currentSrc || image.src), baseOrigin);
        for (const image of brokenImages) {
          addIssue(viewport, routeInfo, 'image', `Broken same-origin image: ${image}`);
        }

        if (routeInfo.name === 'contact') {
          const embed = page.locator('[data-formrun-form]').first();
          const formId = await embed.getAttribute('data-formrun-form');
          if (!formId?.startsWith('@')) {
            addIssue(viewport, routeInfo, 'contact', 'Formrun form ID is missing');
          }
          if ((await page.locator('a[href*="form.run"]').count()) === 0) {
            addIssue(viewport, routeInfo, 'contact', 'Direct form fallback link is missing');
          }
        }

        if (routeInfo.name === 'meeting') {
          if ((await page.locator('form#meetingForm').count()) !== 1) {
            addIssue(viewport, routeInfo, 'meeting', 'Meeting pre-form is missing');
          }
          if ((await page.locator('a[href*="calendar.app.google"]').count()) === 0) {
            addIssue(viewport, routeInfo, 'meeting', 'Calendar booking link is missing');
          }
        }

        if (routeInfo.name === 'studio') {
          if ((await page.locator('#analysis-form').count()) !== 1) {
            addIssue(viewport, routeInfo, 'studio', 'Overview analysis form is missing');
          }
          const expert = page.locator('#expert-panels');
          if ((await expert.count()) !== 1 || await expert.getAttribute('open') !== null) {
            addIssue(viewport, routeInfo, 'studio', 'Expert View is missing or open by default');
          }
          const prButton = page.locator('#github-pr-button');
          if ((await prButton.count()) !== 1 || !(await prButton.isDisabled())) {
            addIssue(viewport, routeInfo, 'studio', 'GitHub PR control must be present and disabled');
          }
        }

        if (viewport.width <= 390) {
          const burger = page.locator('#tbBurger');
          if ((await burger.count()) === 1 && await burger.isVisible()) {
            await burger.click();
            const expanded = await burger.getAttribute('aria-expanded');
            if (expanded !== 'true') {
              addIssue(viewport, routeInfo, 'navigation', `Mobile menu did not open; aria-expanded=${expanded}`);
            }
            await burger.click();
          }
        }

        const screenshotName = `${viewport.name}__${routeInfo.name}.png`;
        const screenshotPath = path.join(outputDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        routeResult.screenshot = screenshotName;
      } catch (error) {
        addIssue(viewport, routeInfo, 'exception', error.stack || error.message);
      } finally {
        results.push(routeResult);
        await page.close();
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  routes: routes.map(({ name, url }) => ({ name, url })),
  viewports,
  results,
  issueCount: issues.length,
  issues,
};

await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (issues.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`Site smoke tests passed: ${results.length} route/viewport combinations`);
