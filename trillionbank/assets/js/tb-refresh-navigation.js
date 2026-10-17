(() => {
  'use strict';

  if (!document.body.classList.contains('tb-refresh')) return;

  const header = document.getElementById('tbh');
  const burger = document.getElementById('tbBurger');
  const navigation = document.getElementById('tbNav');
  if (!header || !burger || !navigation) return;

  header.classList.add('tb-nav-enhanced');
  burger.removeAttribute('aria-hidden');
  burger.removeAttribute('tabindex');

  const mobileNavigation = matchMedia('(max-width: 960px)');
  const megaButtons = [...navigation.querySelectorAll('.mega-t[aria-controls]')];
  const desktopNavigationTarget = navigation.querySelector(
    ':scope > .mega > .mega-t, :scope > a[href]',
  );
  let syncedMobileNavigation = mobileNavigation.matches;
  let breakpointFocusOrigin = null;

  function focusWithoutScroll(element) {
    if (!element) return;
    try {
      element.focus({ preventScroll: true });
    } catch (_) {
      element.focus();
    }
  }

  function setMega(button, open, restoreFocus = false) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    button.setAttribute('aria-expanded', String(open));
    panel?.setAttribute('aria-hidden', String(!open));
    if (open) header.classList.remove('hide');
    if (restoreFocus) focusWithoutScroll(button);
  }

  function closeMegaMenus(except = null) {
    megaButtons.forEach((button) => {
      if (button !== except) setMega(button, false);
    });
  }

  function setMenu(open, restoreFocus = false) {
    const expanded = Boolean(open && mobileNavigation.matches);
    const shouldBeInert = mobileNavigation.matches && !expanded;
    header.classList.toggle('open', expanded);
    if (expanded) header.classList.remove('hide');
    burger.setAttribute('aria-expanded', String(expanded));
    burger.setAttribute('aria-label', expanded ? 'メニューを閉じる' : 'メニュー');

    // Keep the HTML attribute in sync as well as the DOM property. The
    // fallback CSS keys off [inert], including in browsers without native
    // inert reflection.
    navigation.toggleAttribute('inert', shouldBeInert);
    navigation.inert = shouldBeInert;

    if (mobileNavigation.matches) {
      navigation.setAttribute('aria-hidden', String(!expanded));
    } else {
      navigation.removeAttribute('aria-hidden');
    }

    if (!expanded) closeMegaMenus();
    if (restoreFocus) focusWithoutScroll(burger);
  }

  function syncViewport() {
    const isMobile = mobileNavigation.matches;
    const activeElement = document.activeElement;
    const focusWasInNavigation = navigation.contains(activeElement)
      || breakpointFocusOrigin === 'navigation';
    const focusWasOnBurger = activeElement === burger
      || breakpointFocusOrigin === 'burger';
    const menuWillRemainOpen = isMobile && header.classList.contains('open');

    // Move focus before its desktop navigation subtree becomes inert.
    if (isMobile && !menuWillRemainOpen && focusWasInNavigation) {
      focusWithoutScroll(burger);
    }

    setMenu(menuWillRemainOpen);

    // The burger is display:none on desktop, so hand focus to the first
    // desktop navigation control after that navigation becomes available.
    if (!isMobile && focusWasOnBurger) {
      focusWithoutScroll(desktopNavigationTarget);
    }

    breakpointFocusOrigin = null;
    syncedMobileNavigation = isMobile;
  }

  megaButtons.forEach((button) => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    setMega(button, false);

    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      closeMegaMenus(button);
      setMega(button, open);
    });

    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        button.click();
        if (button.getAttribute('aria-expanded') === 'true') {
          focusWithoutScroll(panel.querySelector('a'));
        }
      }
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        event.stopPropagation();
        setMega(button, false, true);
      }
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMega(button, false, true);
      }
    });
  });

  burger.addEventListener('click', () => {
    setMenu(!header.classList.contains('open'));
  });

  header.addEventListener('focusin', () => {
    header.classList.remove('hide');
  });

  header.addEventListener('focusout', (event) => {
    // Chromium applies breakpoint CSS before dispatching the matchMedia change
    // callback. Remember a control that has just become display:none so the
    // callback can migrate focus instead of leaving it on the document body.
    if (mobileNavigation.matches === syncedMobileNavigation) return;
    if (mobileNavigation.matches && navigation.contains(event.target)) {
      breakpointFocusOrigin = 'navigation';
    } else if (!mobileNavigation.matches && event.target === burger) {
      breakpointFocusOrigin = 'burger';
    }
  });

  navigation.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (mobileNavigation.matches) setMenu(false, true);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const expandedMega = megaButtons.find((button) => button.getAttribute('aria-expanded') === 'true');
    if (expandedMega) {
      event.preventDefault();
      setMega(expandedMega, false, true);
      return;
    }
    if (mobileNavigation.matches && header.classList.contains('open')) {
      event.preventDefault();
      setMenu(false, true);
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.tbh .mega')) closeMegaMenus();
    if (mobileNavigation.matches && header.classList.contains('open') && !header.contains(event.target)) {
      setMenu(false);
    }
  });

  document.addEventListener('focusin', (event) => {
    if (!mobileNavigation.matches && !event.target.closest('.tbh .mega')) closeMegaMenus();
  });

  if (typeof mobileNavigation.addEventListener === 'function') {
    mobileNavigation.addEventListener('change', syncViewport);
  } else {
    mobileNavigation.addListener(syncViewport);
  }

  syncViewport();
})();
