/**
 * Compact live panel for Jev / LLM judgment status in Studio.
 */
(function (root) {
  'use strict';

  var el = null;
  var listEl = null;
  var titleEl = null;
  var modelEl = null;
  var logEl = null;
  var items = {};
  var pulseTimer = null;
  var pulseKeys = [];
  var pulseIdx = 0;

  function ensure() {
    if (el) return el;
    el = document.createElement('aside');
    el.id = 'ars-think';
    el.className = 'ars-think';
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="ars-think-head">' +
      '<div><strong id="ars-think-title">判断待機</strong>' +
      '<span id="ars-think-model" class="ars-think-model"></span></div>' +
      '<button type="button" class="ars-think-close" id="ars-think-close" aria-label="閉じる">×</button>' +
      '</div>' +
      '<ul id="ars-think-list" class="ars-think-list"></ul>' +
      '<div id="ars-think-log" class="ars-think-log"></div>';
    document.body.appendChild(el);
    listEl = el.querySelector('#ars-think-list');
    titleEl = el.querySelector('#ars-think-title');
    modelEl = el.querySelector('#ars-think-model');
    logEl = el.querySelector('#ars-think-log');
    el.querySelector('#ars-think-close').onclick = function () {
      stopPulse();
      el.classList.remove('is-open', 'is-busy');
    };
    return el;
  }

  function open() {
    ensure();
    el.classList.add('is-open');
  }

  function stopPulse() {
    if (pulseTimer) {
      clearInterval(pulseTimer);
      pulseTimer = null;
    }
    pulseKeys = [];
    pulseIdx = 0;
  }

  function startPulse() {
    stopPulse();
    pulseKeys = Object.keys(items);
    if (!pulseKeys.length) return;
    pulseIdx = 0;
    pulseTimer = setInterval(function () {
      if (!pulseKeys.length) return;
      var key = pulseKeys[pulseIdx % pulseKeys.length];
      var li = items[key];
      if (li && (li.classList.contains('is-pending') || li.classList.contains('is-run'))) {
        Object.keys(items).forEach(function (k) {
          if (items[k].classList.contains('is-run')) items[k].classList.remove('is-run');
          if (items[k].classList.contains('is-pending') && k === key) items[k].classList.add('is-run');
        });
        if (li.classList.contains('is-pending')) li.classList.add('is-run');
      }
      pulseIdx += 1;
    }, 900);
  }

  function begin(opts) {
    opts = opts || {};
    ensure();
    open();
    el.classList.add('is-busy');
    items = {};
    titleEl.textContent = opts.title || 'AI判断中';
    modelEl.textContent = opts.model ? (' · ' + opts.model) : '';
    listEl.innerHTML = '';
    logEl.textContent = '';
    (opts.judgments || []).forEach(function (j) {
      add(j.id || j.label, j.label || j.id, j.thinking || '判定しています');
    });
    if (opts.log) log(opts.log);
    startPulse();
  }

  function add(id, label, thinking) {
    ensure();
    open();
    var key = String(id || label);
    var li = document.createElement('li');
    li.dataset.id = key;
    li.className = 'is-pending';
    li.innerHTML =
      '<span class="ars-think-dot" aria-hidden="true"></span>' +
      '<div><b></b><small></small></div>';
    li.querySelector('b').textContent = label || key;
    li.querySelector('small').textContent = thinking || '待機';
    listEl.appendChild(li);
    items[key] = li;
    return li;
  }

  function set(id, status, detail) {
    ensure();
    open();
    var key = String(id);
    var li = items[key];
    if (!li) li = add(key, key, detail || '');
    li.className = 'is-' + (status || 'pending');
    if (detail) li.querySelector('small').textContent = detail;
  }

  function log(msg) {
    ensure();
    open();
    var line = document.createElement('div');
    line.textContent = msg;
    logEl.appendChild(line);
    while (logEl.children.length > 5) logEl.removeChild(logEl.firstChild);
  }

  function end(summary) {
    ensure();
    stopPulse();
    el.classList.remove('is-busy');
    Object.keys(items).forEach(function (k) {
      var li = items[k];
      if (li.classList.contains('is-pending') || li.classList.contains('is-run')) {
        li.className = 'is-done';
      }
    });
    if (summary) {
      titleEl.textContent = summary;
      log(summary);
    } else {
      titleEl.textContent = '判断完了';
    }
  }

  function fail(msg) {
    ensure();
    stopPulse();
    el.classList.remove('is-busy');
    titleEl.textContent = '判断エラー';
    log(String(msg || '失敗'));
  }

  root.AirReachThink = {
    begin: begin,
    add: add,
    set: set,
    log: log,
    end: end,
    fail: fail,
    open: open
  };
})(typeof window !== 'undefined' ? window : globalThis);
