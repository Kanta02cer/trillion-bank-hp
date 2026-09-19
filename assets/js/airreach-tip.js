/**
 * AirReach tip: short visible label + detail on hover/focus/tap.
 * Markup: <span data-tip="詳細">短い語</span>
 */
(function () {
  'use strict';

  function enhance(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-tip]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('data-tip-ready') === '1') continue;
      var text = String(el.getAttribute('data-tip') || '').trim();
      if (!text) continue;
      el.setAttribute('data-tip-ready', '1');
      el.classList.add('ar-tip');
      if (el.tagName !== 'BUTTON' && el.tagName !== 'A' && !el.hasAttribute('tabindex')) {
        el.tabIndex = 0;
      }
      if (!el.getAttribute('aria-label')) {
        el.setAttribute('aria-label', (el.textContent || '').trim() + '（詳細あり）');
      }
      if (!el.querySelector('.ar-tip-q')) {
        var mark = document.createElement('span');
        mark.className = 'ar-tip-q';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '?';
        el.appendChild(mark);
      }
      var bubble = document.createElement('span');
      bubble.className = 'ar-tip-bubble';
      bubble.setAttribute('role', 'tooltip');
      bubble.textContent = text;
      el.appendChild(bubble);

      function placeBubble() {
        var b = el.querySelector('.ar-tip-bubble');
        if (!b) return;
        b.classList.remove('is-below', 'is-end');
        var rect = el.getBoundingClientRect();
        var spaceAbove = rect.top;
        var spaceBelow = window.innerHeight - rect.bottom;
        if (spaceAbove < 140 && spaceBelow > spaceAbove) b.classList.add('is-below');
        if (rect.left > window.innerWidth * 0.52) b.classList.add('is-end');
      }
      el.addEventListener('mouseenter', placeBubble);
      el.addEventListener('focus', placeBubble);
      el.addEventListener('click', function (e) {
        if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        if (el.hasAttribute('data-industry') || el.hasAttribute('data-goal') || el.tagName === 'A' || el.type === 'submit') {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        var self = e.currentTarget;
        var open = !self.classList.contains('is-on');
        document.querySelectorAll('.ar-tip.is-on').forEach(function (x) { x.classList.remove('is-on'); });
        if (open) {
          placeBubble();
          self.classList.add('is-on');
        }
      });
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.ar-tip')) return;
    document.querySelectorAll('.ar-tip.is-on').forEach(function (x) { x.classList.remove('is-on'); });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.ar-tip.is-on').forEach(function (x) { x.classList.remove('is-on'); });
    }
  });

  window.AirReachTip = { enhance: enhance };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { enhance(document); });
  } else {
    enhance(document);
  }
})();
