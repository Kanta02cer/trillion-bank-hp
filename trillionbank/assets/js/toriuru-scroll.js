(() => {
  'use strict';

  const root = document.querySelector('[data-toriuru-root]');
  const orbit = root?.querySelector('[data-toriuru]');
  const toggle = root?.querySelector('[data-toriuru-toggle]');
  const scenes = [...document.querySelectorAll('[data-toriuru-scene]')];
  if (!root || !orbit || !toggle || !scenes.length) return;

  const toggleIcon = toggle.querySelector('.toriuru-guide__toggle-icon');
  const toggleText = toggle.querySelector('.toriuru-guide__toggle-text');
  const neutralLayers = root.querySelector('[data-neutral-layers]');
  const assetsBase = root.dataset.assetsBase || '/trillionbank/assets/images/toriuru';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compactViewport = matchMedia('(max-width: 900px), (max-height: 620px) and (max-width: 1100px)');
  const shortLandscape = matchMedia('(max-height: 620px) and (min-width: 521px) and (max-width: 1100px)');
  const storageKey = 'tb:toriuru-motion-paused';
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const mix = (from, to, progress) => from + (to - from) * progress;
  const number = (value, fallback) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const poseBounds = {
    neutral: { left: 240 / 1254, right: 1029 / 1254, top: 36 / 1254, bottom: 1217 / 1254 },
    'point-left': { left: 147 / 1254, right: 1036 / 1254, top: 34 / 1254, bottom: 1218 / 1254 },
    'point-right': { left: 239 / 1254, right: 1053 / 1254, top: 35 / 1254, bottom: 1218 / 1254 },
    explain: { left: 209 / 1254, right: 1030 / 1254, top: 35 / 1254, bottom: 1218 / 1254 },
  };

  let frame = 0;
  let scenePoints = [];
  let protectedRects = [];
  let protectedScreenRects = [];
  let orbitSize = 0;
  let lastPose = 'neutral';
  let previousPose = 'neutral';
  let crossfadeUntil = 0;
  let requestedPose = 'neutral';
  let lastState = { x: 82, y: 50, scale: .92, tilt: 0, pose: 'neutral', visibility: 1 };
  let pausedByUser = false;
  let resizeTimer = 0;
  let layerLoadScheduled = false;
  const poseAssets = new Map([['neutral', { state: 'ready' }]]);

  try {
    pausedByUser = localStorage.getItem(storageKey) === 'true';
  } catch (_) {}

  function readScene(scene) {
    const rect = scene.getBoundingClientRect();
    return {
      center: scrollY + rect.top + rect.height / 2,
      pose: scene.dataset.pose || 'neutral',
      x: number(scene.dataset.x, 50),
      y: number(scene.dataset.y, 50),
      scale: number(scene.dataset.scale, 1),
      visibility: scene.dataset.toriuruHide === 'true' ? 0 : 1,
    };
  }

  function stateForScroll() {
    if (reducedMotion.matches) {
      if (shortLandscape.matches) return { x: 86.5, y: 53, scale: .64, tilt: 0, pose: 'neutral', visibility: 1 };
      if (compactViewport.matches) return { x: 76, y: 26, scale: .86, tilt: 0, pose: 'neutral', visibility: 1 };
      return { x: 84, y: 50, scale: .92, tilt: 0, pose: 'neutral', visibility: 1 };
    }

    const viewportCenter = scrollY + innerHeight / 2;
    let index = 0;
    while (index < scenePoints.length - 1 && viewportCenter >= scenePoints[index + 1].center) index += 1;
    const current = scenePoints[index];
    const next = scenePoints[Math.min(index + 1, scenePoints.length - 1)];
    const distance = Math.max(1, next.center - current.center);
    const progress = current === next ? 0 : clamp((viewportCenter - current.center) / distance);
    const eased = progress * progress * (3 - 2 * progress);
    let x = mix(current.x, next.x, eased);
    let y = mix(current.y, next.y, eased);
    let scale = mix(current.scale, next.scale, eased);

    if (shortLandscape.matches) {
      x = 86.5 + (x - 50) * .015;
      y = 53 + (y - 50) * .16;
      scale *= .68;
    } else if (compactViewport.matches) {
      x = 50 + (x - 50) * .6;
      y = 26 + (y - 50) * .05;
      scale *= .82;
    }

    return {
      x,
      y,
      scale,
      tilt: Math.sin(eased * Math.PI) * (next.x < current.x ? -1.2 : 1.2),
      pose: progress < .48 ? current.pose : next.pose,
      visibility: mix(current.visibility, next.visibility, eased),
    };
  }

  function ensurePose(name) {
    if (shortLandscape.matches && name === 'point-right') name = 'point-left';
    if (reducedMotion.matches && name !== 'neutral') return;
    if (name === 'neutral' || poseAssets.has(name)) return;
    const record = { state: 'loading', image: null };
    poseAssets.set(name, record);
    const image = new Image(1254, 1254);
    image.className = 'toriuru-guide__pose toriuru-guide__pose-image';
    image.alt = '';
    image.decoding = 'async';
    image.dataset.pose = name;
    image.dataset.assetState = 'loading';
    image.addEventListener('load', () => {
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
      decoded.catch(() => {}).then(() => {
        record.state = 'ready';
        image.dataset.assetState = 'ready';
        if (requestedPose === name) setPose(name);
      });
    }, { once: true });
    image.addEventListener('error', () => {
      record.state = 'error';
      image.dataset.assetState = 'error';
      if (requestedPose === name) setPose('neutral');
    }, { once: true });
    record.image = image;
    orbit.insertBefore(image, orbit.querySelector('.toriuru-guide__ground'));
    image.src = `${assetsBase}/toriuru-${name}.webp`;
  }

  function setPose(name) {
    if (shortLandscape.matches && name === 'point-right') name = 'point-left';
    requestedPose = name;
    ensurePose(name);
    const record = poseAssets.get(name);
    const resolved = name === 'neutral' || record?.state === 'ready' ? name : 'neutral';
    if (resolved === lastPose) return;
    previousPose = lastPose;
    crossfadeUntil = performance.now() + 260;
    setTimeout(schedule, 280);
    root.querySelectorAll('[data-pose]').forEach((pose) => {
      pose.classList.toggle('is-active', pose.dataset.pose === resolved);
    });
    lastPose = resolved;
  }

  function applyState(state) {
    lastState = state;
    root.style.setProperty('--toriuru-x', `${state.x.toFixed(3)}vw`);
    root.style.setProperty('--toriuru-y', `${state.y.toFixed(3)}vh`);
    root.style.setProperty('--toriuru-scale', state.scale.toFixed(3));
    root.style.setProperty('--toriuru-tilt', `${state.tilt.toFixed(2)}deg`);
    root.style.setProperty('--toriuru-opacity', clamp(state.visibility).toFixed(3));
    setPose(state.pose);
  }

  function measureProtectedContent() {
    const selector = [
      'main h1', 'main h2', 'main h3', 'main h4', 'main p', 'main li', 'main a', 'main button',
      'main summary', 'main td', 'main th', 'main img', 'main [data-toriuru-protect]',
      'body > section h2', 'body > section p', 'body > section a', 'body > section summary',
    ].join(',');
    protectedRects = [...document.querySelectorAll(selector)].flatMap((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      return [...element.getClientRects()].filter((rect) => rect.width && rect.height).map((rect) => ({
        left: rect.left + scrollX,
        right: rect.right + scrollX,
        top: rect.top + scrollY,
        bottom: rect.bottom + scrollY,
      }));
    });
    const headerHeight = document.querySelector('header.tbh')?.offsetHeight || 0;
    const control = toggle.getBoundingClientRect();
    protectedScreenRects = [
      { left: 0, right: innerWidth, top: 0, bottom: headerHeight },
      { left: control.left, right: control.right, top: control.top, bottom: control.bottom },
    ];
  }

  function unionBounds() {
    const names = performance.now() < crossfadeUntil ? [lastPose, previousPose] : [lastPose];
    return names.map((name) => poseBounds[name] || poseBounds.neutral).reduce((union, bounds) => ({
      left: Math.min(union.left, bounds.left),
      right: Math.max(union.right, bounds.right),
      top: Math.min(union.top, bounds.top),
      bottom: Math.max(union.bottom, bounds.bottom),
    }), { left: 1, right: 0, top: 1, bottom: 0 });
  }

  function updateCollision() {
    if (!orbitSize || lastState.visibility < .03) {
      root.classList.remove('is-colliding');
      return;
    }
    const bounds = unionBounds();
    const size = orbitSize * lastState.scale;
    const centerX = innerWidth * lastState.x / 100;
    const centerY = innerHeight * lastState.y / 100;
    const left = centerX - size / 2 + size * bounds.left;
    const right = centerX - size / 2 + size * bounds.right;
    const top = centerY - size / 2 + size * bounds.top;
    const bottom = centerY - size / 2 + size * bounds.bottom;
    const padding = 8;
    const docCharacter = { left: left + scrollX, right: right + scrollX, top: top + scrollY, bottom: bottom + scrollY };
    const hitsDocumentContent = protectedRects.some((rect) => (
      docCharacter.right > rect.left - padding &&
      docCharacter.left < rect.right + padding &&
      docCharacter.bottom > rect.top - padding &&
      docCharacter.top < rect.bottom + padding
    ));
    const hitsScreenRect = protectedScreenRects.some((rect) => (
      right > rect.left - padding && left < rect.right + padding && bottom > rect.top - padding && top < rect.bottom + padding
    ));
    root.classList.toggle('is-colliding', hitsDocumentContent || hitsScreenRect);
  }

  function render() {
    frame = 0;
    if (!scenePoints.length) return;
    if (!pausedByUser && !reducedMotion.matches) applyState(stateForScroll());
    updateCollision();
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function measure() {
    scenePoints = scenes.map(readScene);
    orbitSize = number(getComputedStyle(orbit).width, Math.min(innerWidth * .28, 430));
    measureProtectedContent();
    if (reducedMotion.matches || pausedByUser) applyState(stateForScroll());
    schedule();
  }

  function persistPause() {
    try { localStorage.setItem(storageKey, pausedByUser ? 'true' : 'false'); } catch (_) {}
  }

  function renderPauseControl() {
    if (reducedMotion.matches) {
      root.classList.add('is-reduced', 'is-paused');
      toggle.disabled = true;
      toggle.setAttribute('aria-pressed', 'true');
      toggle.setAttribute('aria-label', '端末設定によりトリウルくんの動きは停止中');
      toggleIcon.textContent = '—';
      toggleText.textContent = '動きは停止中';
      return;
    }
    root.classList.remove('is-reduced');
    root.classList.toggle('is-paused', pausedByUser);
    toggle.disabled = false;
    toggle.setAttribute('aria-pressed', String(pausedByUser));
    toggle.setAttribute('aria-label', pausedByUser ? 'トリウルくんの動きを再開' : 'トリウルくんの動きを停止');
    toggleIcon.textContent = pausedByUser ? '▶' : 'Ⅱ';
    toggleText.textContent = pausedByUser ? '動きを再開' : '動きを止める';
  }

  function setPaused(value, persist = true) {
    pausedByUser = value;
    if (persist) persistPause();
    renderPauseControl();
    if (!value) {
      scenePoints = scenes.map(readScene);
      schedule();
    } else updateCollision();
  }

  function syncMotionPreference() {
    renderPauseControl();
    scenePoints = scenes.map(readScene);
    if (reducedMotion.matches) applyState(stateForScroll());
    else {
      ensurePose(stateForScroll().pose);
      scheduleLayerLoad();
    }
    schedule();
  }

  function loadNeutralLayers() {
    if (reducedMotion.matches) {
      layerLoadScheduled = false;
      return;
    }
    if (!neutralLayers || neutralLayers.childElementCount) return;
    const definitions = [
      ['tail', 'toriuru-tail.webp'],
      ['ear-left', 'toriuru-ears.webp'],
      ['ear-right', 'toriuru-ears.webp'],
      ['base', 'toriuru-base.webp'],
    ];
    let settled = 0;
    let failed = false;
    definitions.forEach(([name, file]) => {
      const image = new Image(1254, 1254);
      image.className = `toriuru-guide__layer toriuru-guide__layer--${name}`;
      image.alt = '';
      image.decoding = 'async';
      const finish = (ok) => {
        settled += 1;
        failed ||= !ok;
        if (settled === definitions.length && !failed) root.classList.add('is-layered-ready');
      };
      image.addEventListener('load', () => finish(true), { once: true });
      image.addEventListener('error', () => finish(false), { once: true });
      image.src = `${assetsBase}/${file}`;
      neutralLayers.append(image);
    });
  }

  function scheduleLayerLoad() {
    if (layerLoadScheduled || reducedMotion.matches || neutralLayers?.childElementCount) return;
    layerLoadScheduled = true;
    if ('requestIdleCallback' in window) requestIdleCallback(loadNeutralLayers, { timeout: 3000 });
    else setTimeout(loadNeutralLayers, 1800);
  }

  const sceneObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) ensurePose(entry.target.dataset.pose || 'neutral');
    });
  }, { rootMargin: '120% 0px' }) : null;
  scenes.forEach((scene) => sceneObserver?.observe(scene));

  toggle.addEventListener('click', () => setPaused(!pausedByUser));
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 100);
  }, { passive: true });
  addEventListener('orientationchange', () => setTimeout(measure, 160), { passive: true });
  addEventListener('load', measure, { once: true });
  document.addEventListener('toggle', measure, true);
  document.fonts?.ready.then(measure).catch(() => {});
  reducedMotion.addEventListener?.('change', syncMotionPreference);
  compactViewport.addEventListener?.('change', measure);
  shortLandscape.addEventListener?.('change', measure);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

  root.classList.add('is-enhanced');
  toggle.hidden = false;
  renderPauseControl();
  measure();
  scheduleLayerLoad();
})();
