#!/usr/bin/env python3
"""Fail if built sitemaps contain noindex pages or miss approved insights."""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SITE = Path('_site')
ORIGIN = 'https://trillion-bank.jp'
NS = {'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9'}


def locs(path: Path) -> list[str]:
    root = ET.fromstring(path.read_text(encoding='utf-8'))
    return [
        (n.text or '').strip()
        for n in root.findall('sm:url/sm:loc', NS)
        if n.text and n.text.strip()
    ]


def robots_meta(html: str) -> str:
    m = re.search(
        r'<meta\s+[^>]*name=["\']robots["\'][^>]*content=["\']([^"\']+)',
        html,
        flags=re.I,
    )
    return (m.group(1) if m else '').lower()


def main() -> int:
    errors: list[str] = []
    insights_map = SITE / 'sitemap-insights.xml'
    corp_map = SITE / 'sitemap.xml'
    index_map = SITE / 'sitemap-index.xml'
    for required in (insights_map, corp_map, index_map):
        if not required.is_file():
            errors.append(f'Missing {required}')
    if errors:
        print('\n'.join(errors))
        return 1

    insight_urls = locs(insights_map)
    corp_urls = locs(corp_map)
    all_urls = insight_urls + corp_urls

    if len(insight_urls) != len(set(insight_urls)):
        errors.append('Duplicate URLs in sitemap-insights.xml')
    if len(corp_urls) != len(set(corp_urls)):
        errors.append('Duplicate URLs in sitemap.xml')

    # Approved insights = insight:true sources
    approved = set()
    for source in Path('_tbnews').glob('*.md'):
        text = source.read_text(encoding='utf-8')
        if re.search(r'(?m)^insight:\s*true\s*$', text):
            slug = source.name
            # Jekyll permalink /trillionbank/news/:slug/ drops date prefix
            m = re.match(r'\d{4}-\d{2}-\d{2}-(.+)\.md$', slug)
            if m:
                approved.add(f'{ORIGIN}/trillionbank/news/{m.group(1)}/')

    if set(insight_urls) != approved:
        unexpected = sorted(set(insight_urls) - approved)
        missing = sorted(approved - set(insight_urls))
        if unexpected:
            errors.append('Unexpected insight sitemap URLs:\n- ' + '\n- '.join(unexpected))
        if missing:
            errors.append('Missing insight sitemap URLs:\n- ' + '\n- '.join(missing))

    # Every sitemap URL must exist and be indexable
    for url in all_urls:
        if not url.startswith(ORIGIN + '/'):
            errors.append(f'Non-origin URL in sitemap: {url}')
            continue
        rel = url[len(ORIGIN):]
        if rel.endswith('/'):
            page = SITE / rel.lstrip('/') / 'index.html'
        else:
            page = SITE / rel.lstrip('/')
        if not page.is_file():
            # tokushoho.html etc.
            page = SITE / rel.lstrip('/')
        if not page.is_file():
            errors.append(f'Sitemap URL missing in build: {url}')
            continue
        if page.suffix.lower() in {'.txt', '.json', '.xml'}:
            # should not be in HTML-oriented sitemaps
            errors.append(f'Non-HTML asset in sitemap: {url}')
            continue
        html = page.read_text(encoding='utf-8', errors='replace')
        robots = robots_meta(html)
        if 'noindex' in robots:
            errors.append(f'Sitemap URL is noindex: {url} ({robots})')
        elif robots and 'index' not in robots:
            errors.append(f'Sitemap URL robots unclear: {url} ({robots})')

    # Must not list tool surfaces
    banned = (
        '/airreach/result/',
        '/airreach/sales/',
        '/airreach/studio/',
        '/airreach/platform/',
        '/airreach/restaurant/',
        '/airreach/clinic/',
        '/airreach/b2b/',
        '/airreach/media/',
        '/airreach/other/',
    )
    for url in all_urls:
        for b in banned:
            if b in url:
                errors.append(f'Banned/tool URL in sitemap: {url}')

    if errors:
        print('Sitemap indexability check FAILED:\n- ' + '\n- '.join(errors))
        return 1
    print(
        f'Sitemap indexability check passed '
        f'({len(corp_urls)} corp, {len(insight_urls)} insights).'
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
