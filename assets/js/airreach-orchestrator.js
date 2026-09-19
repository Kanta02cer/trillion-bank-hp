/**
 * AirReach Studio Overview orchestrator.
 *
 * Phase 1 runs entirely in the browser. It coordinates the existing diagnosis
 * and Studio generators, but it does not publish, deploy, or create a GitHub PR.
 */
(function (root) {
  'use strict';

  var STEP_DEFINITIONS = [
    { id: 'site', label: 'サイト確認' },
    { id: 'competitors', label: '競合' },
    { id: 'demand', label: '需要' },
    { id: 'keywords', label: 'KW選定' },
    { id: 'prompts', label: 'AI質問' },
    { id: 'actions', label: '施策' },
    { id: 'artifacts', label: 'ファイル準備' }
  ];
  var ALLOWED_KEYWORD_COUNTS = { 20: true, 50: true, 100: true };
  var STALE_RUN = { stale: true };

  function isArray(value) {
    return Array.isArray(value);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function cloneValue(value, seen, copies) {
    var index;
    var copy;
    var keys;
    var i;

    if (value === null || typeof value !== 'object') return value;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return new Date(value.getTime());
    }
    if (Object.prototype.toString.call(value) === '[object RegExp]') {
      return new RegExp(value.source, value.flags || '');
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob && value.slice) {
      return value.slice(0, value.size, value.type);
    }
    if (value instanceof Error) {
      return {
        name: value.name || 'Error',
        message: value.message || String(value),
        code: value.code || null
      };
    }

    seen = seen || [];
    copies = copies || [];
    index = seen.indexOf(value);
    if (index >= 0) return copies[index];

    copy = isArray(value) ? [] : {};
    seen.push(value);
    copies.push(copy);
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i += 1) {
      copy[keys[i]] = cloneValue(value[keys[i]], seen, copies);
    }
    return copy;
  }

  function clone(value) {
    return cloneValue(value, [], []);
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
  }

  function sanitizePublicUrl(value, allowEmpty) {
    var raw = cleanText(value);
    var UrlConstructor = root.URL || (typeof URL !== 'undefined' ? URL : null);
    var parsed;

    if (!raw && allowEmpty) return '';
    try {
      if (!UrlConstructor) throw new Error('URL is not supported');
      parsed = new UrlConstructor(raw);
      if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname) throw new Error('invalid protocol');
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch (error) {
      if (allowEmpty) return '';
      throw new Error('URLの形式を確認してください。');
    }
  }

  function normalizeKey(value) {
    return cleanText(value).toLowerCase().replace(/\s+/g, ' ');
  }

  function finiteNumber(value) {
    var parsed;
    if (value === null || value === undefined || value === '') return null;
    parsed = Number(String(value).replace(/,/g, ''));
    return isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value) {
    var rounded = Math.round(Number(value) || 0);
    return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function errorMessage(error) {
    if (!error) return '不明なエラーが発生しました。';
    return cleanText(error.message || error) || '不明なエラーが発生しました。';
  }

  function validateInput(input) {
    var normalized;
    var keywordCount;

    if (!isObject(input)) throw new Error('分析条件を入力してください。');
    if (!cleanText(input.url)) throw new Error('対象URLを入力してください。');

    normalized = {
      url: sanitizePublicUrl(input.url, false),
      goal: cleanText(input.goal),
      keywordCount: Number(input.keywordCount),
      region: cleanText(input.region)
    };

    if (!normalized.goal) throw new Error('目標を入力してください。');
    if (!normalized.region) throw new Error('地域を入力してください。');

    keywordCount = normalized.keywordCount;
    if (!ALLOWED_KEYWORD_COUNTS[keywordCount]) {
      throw new Error('KW件数は20・50・100から選んでください。');
    }

    return normalized;
  }

  function createSteps() {
    return STEP_DEFINITIONS.map(function (definition) {
      return {
        id: definition.id,
        label: definition.label,
        status: 'pending',
        started_at: null,
        completed_at: null,
        error: null
      };
    });
  }

  function disconnectedGscStatus() {
    return {
      connected: false,
      status: 'unconnected',
      label: 'GSC未接続'
    };
  }

  function createSummary() {
    return {
      keyword_count: 0,
      estimated_monthly_demand: 0,
      diagnosis_overall: null,
      action_count: 0,
      keywordCount: 0,
      estimatedMonthlyDemand: 0,
      diagnosisOverall: null,
      actionCount: 0
    };
  }

  function createJob(status, runToken, now) {
    var timestamp = now();
    return {
      type: 'analysis_job',
      schema_version: '1.0',
      id: 'analysis_job_' + String(runToken) + '_' + String(Date.now()),
      run_token: runToken,
      status: status || 'idle',
      input: null,
      steps: createSteps(),
      current_step: null,
      progress: 0,
      diagnosis: null,
      gsc_status: disconnectedGscStatus(),
      keyword_candidates: [],
      prompt_candidates: [],
      actions: [],
      artifact_bundle: null,
      summary: createSummary(),
      conclusion: '',
      warnings: [],
      error: null,
      created_at: timestamp,
      started_at: null,
      completed_at: null,
      updated_at: timestamp
    };
  }

  function getCandidateKeys(candidate) {
    var values = [
      candidate && candidate.id,
      candidate && candidate.keyword_id,
      candidate && candidate.target_key,
      candidate && candidate.keyword,
      candidate && candidate.keyword_text,
      candidate && candidate.text
    ];
    var keys = [];
    values.forEach(function (value) {
      var key = normalizeKey(value);
      if (key && keys.indexOf(key) < 0) keys.push(key);
    });
    return keys;
  }

  function getPromptKeys(prompt) {
    var values = [
      prompt && prompt.keyword_candidate_id,
      prompt && prompt.keyword_id,
      prompt && prompt.target_key,
      prompt && prompt.keyword,
      prompt && prompt.keyword_text
    ];
    var keys = [];
    values.forEach(function (value) {
      var key = normalizeKey(value);
      if (key && keys.indexOf(key) < 0) keys.push(key);
    });
    return keys;
  }

  function applyPromptCounts(keywords, prompts) {
    var keyToIndex = {};
    var counts = {};
    var associated = false;

    keywords.forEach(function (candidate, index) {
      getCandidateKeys(candidate).forEach(function (key) {
        if (keyToIndex[key] === undefined) keyToIndex[key] = index;
      });
    });

    prompts.forEach(function (prompt) {
      var keys = getPromptKeys(prompt);
      var matchedIndex = null;
      var i;
      for (i = 0; i < keys.length; i += 1) {
        if (keyToIndex[keys[i]] !== undefined) {
          matchedIndex = keyToIndex[keys[i]];
          break;
        }
      }
      if (matchedIndex !== null) {
        associated = true;
        counts[matchedIndex] = (counts[matchedIndex] || 0) + 1;
      }
    });

    if (!associated) return;
    keywords.forEach(function (candidate, index) {
      candidate.ai_prompt_count = counts[index] || 0;
    });
  }

  function actionKey(action) {
    var target;
    var type;
    var title;
    var fallback;

    if (!isObject(action)) return normalizeKey(action);
    if (action.target_key) return normalizeKey(action.target_key);
    target = normalizeKey(action.target_url || action.page || action.path);
    type = normalizeKey(action.type || action.kind || action.action_type);
    title = normalizeKey(action.title || action.action || action.task || action.description || action.reason);
    if (target || type) return [type, target].join('|');
    if (title) return 'title|' + title;
    if (action.id != null) return 'id|' + normalizeKey(action.id);
    try {
      fallback = JSON.stringify(action, Object.keys(action).sort());
    } catch (e) {
      fallback = String(action);
    }
    return normalizeKey(fallback);
  }

  function countUniqueActions(actions) {
    var seen = {};
    var count = 0;
    actions.forEach(function (action) {
      var key = actionKey(action);
      if (action && (action.status === 'blocked' || action.blocked_reason)) return;
      if (action && action.status && action.status !== 'draft' && action.status !== 'ready') return;
      if (!key) return;
      if (!Object.prototype.hasOwnProperty.call(seen, key)) {
        seen[key] = true;
        count += 1;
      }
    });
    return count;
  }

  function calculateSummary(job) {
    var estimatedDemand = 0;
    var overall = finiteNumber(job.diagnosis && job.diagnosis.overall);
    var summary;

    job.keyword_candidates.forEach(function (candidate) {
      var estimate = finiteNumber(candidate && candidate.estimated_monthly_demand);
      if (estimate !== null && estimate > 0) estimatedDemand += estimate;
    });

    summary = {
      keyword_count: job.keyword_candidates.length,
      estimated_monthly_demand: Math.round(estimatedDemand),
      diagnosis_overall: overall,
      action_count: countUniqueActions(job.actions)
    };

    // Camel-case aliases keep the browser API convenient without changing the
    // canonical snake-case model used by the generated manifest.
    summary.keywordCount = summary.keyword_count;
    summary.estimatedMonthlyDemand = summary.estimated_monthly_demand;
    summary.diagnosisOverall = summary.diagnosis_overall;
    summary.actionCount = summary.action_count;
    return summary;
  }

  function buildConclusion(summary) {
    var lead;
    var demand = summary.estimated_monthly_demand > 0
      ? '推定月間需要合計' + formatNumber(summary.estimated_monthly_demand)
      : '推定需要の内訳';

    if (summary.diagnosis_overall === null) {
      lead = 'サイト取得結果は未確認のため';
    } else if (summary.diagnosis_overall < 50) {
      lead = '公式情報・FAQ・構造化データの基礎整備を優先するため';
    } else if (summary.diagnosis_overall < 75) {
      lead = '不足情報を補う余地があるため';
    } else {
      lead = '公開ページの基礎は比較的整っているため';
    }

    return lead + '、' + demand + 'に基づく優先KW' + summary.keyword_count +
      '件と実装候補' + summary.action_count +
      '件を上から確認してください（検索順位・AI掲載・問い合わせ増を保証するものではありません）。';
  }

  function create(options) {
    options = options || {};

    var listeners = [];
    var runSequence = 0;
    var activeRunToken = 0;
    var lastInput = null;
    var stepDelay = options.stepDelay === undefined ? 120 : options.stepDelay;
    var injected = options.dependencies || {};
    var now = typeof options.now === 'function'
      ? options.now
      : function () { return new Date().toISOString(); };
    var job = createJob('idle', 0, now);

    function notify() {
      listeners.slice().forEach(function (listener) {
        try {
          listener(clone(job));
        } catch (listenerError) {
          // A view listener must never interrupt the analysis job.
        }
      });
    }

    function touch() {
      job.updated_at = now();
    }

    function stepById(stepId) {
      var match = null;
      job.steps.some(function (step) {
        if (step.id === stepId) {
          match = step;
          return true;
        }
        return false;
      });
      return match;
    }

    function completedStepCount() {
      return job.steps.filter(function (step) {
        return step.status === 'completed' || step.status === 'warning';
      }).length;
    }

    function updateProgress() {
      job.progress = Math.round((completedStepCount() / STEP_DEFINITIONS.length) * 100);
    }

    function isCurrent(token) {
      return token === activeRunToken && token === job.run_token;
    }

    function beginStep(stepId, token) {
      var step;
      if (!isCurrent(token)) throw STALE_RUN;
      step = stepById(stepId);
      step.status = 'running';
      step.started_at = now();
      step.completed_at = null;
      step.error = null;
      job.current_step = stepId;
      touch();
      notify();
    }

    function finishStep(stepId, token, status, error) {
      var step;
      if (!isCurrent(token)) throw STALE_RUN;
      step = stepById(stepId);
      step.status = status || 'completed';
      step.completed_at = now();
      step.error = error ? errorMessage(error) : null;
      job.current_step = null;
      updateProgress();
      touch();
      notify();
    }

    function addWarning(stepId, code, error) {
      job.warnings.push({
        step: stepId,
        code: code,
        message: errorMessage(error),
        at: now()
      });
    }

    function failJob(stepId, token, error) {
      var step;
      if (!isCurrent(token)) throw STALE_RUN;
      step = stepById(stepId);
      if (step) {
        step.status = 'failed';
        step.completed_at = now();
        step.error = errorMessage(error);
      }
      job.status = 'failed';
      job.current_step = null;
      job.error = {
        step: stepId,
        code: error && error.code ? error.code : 'STEP_FAILED',
        message: errorMessage(error)
      };
      job.completed_at = now();
      updateProgress();
      touch();
      notify();
    }

    function waitForStep(stepId, token) {
      var delay = stepDelay;
      var resolved;

      if (!isCurrent(token)) return Promise.reject(STALE_RUN);
      try {
        if (typeof delay === 'function') delay = delay(stepId, clone(job));
      } catch (delayError) {
        return Promise.reject(delayError);
      }

      if (delay && typeof delay.then === 'function') {
        resolved = Promise.resolve(delay);
      } else if (Number(delay) > 0) {
        resolved = new Promise(function (resolve) {
          setTimeout(resolve, Number(delay));
        });
      } else {
        resolved = Promise.resolve();
      }

      return resolved.then(function () {
        if (!isCurrent(token)) throw STALE_RUN;
      });
    }

    function resolveDependencies() {
      var airReach = injected.AirReach || injected.airReach || root.AirReach || {};
      var studio = injected.AirReachStudio || injected.airReachStudio || injected.studio || root.AirReachStudio || {};
      return {
        airReach: airReach,
        studio: studio,
        diagnose: injected.diagnose || airReach.diagnose,
        buildKeywordCandidates: injected.buildKeywordCandidates || studio.buildKeywordCandidates,
        buildPromptCandidates: injected.buildPromptCandidates || studio.buildPromptCandidates,
        buildActions: injected.buildActions || studio.buildActions,
        buildArtifactBundle: injected.buildArtifactBundle || studio.buildArtifactBundle,
        getGscStatus: injected.getGscStatus || studio.getGscStatus
      };
    }

    function requireFunction(fn, name) {
      var dependencyError;
      if (typeof fn === 'function') return fn;
      dependencyError = new Error('AirReachStudio.' + name + ' が利用できません。');
      dependencyError.code = 'MISSING_DEPENDENCY';
      throw dependencyError;
    }

    function executeStep(token, stepId, work, onSuccess, recoverable) {
      beginStep(stepId, token);
      return waitForStep(stepId, token).then(function () {
        var result;
        if (!isCurrent(token)) throw STALE_RUN;
        try {
          result = work();
        } catch (workError) {
          return Promise.reject(workError);
        }
        return Promise.resolve(result);
      }).then(function (result) {
        if (!isCurrent(token)) throw STALE_RUN;
        if (onSuccess) onSuccess(result);
        finishStep(stepId, token, 'completed');
        return result;
      }).catch(function (error) {
        var fallback;
        if (error === STALE_RUN || !isCurrent(token)) throw STALE_RUN;
        if (recoverable) {
          fallback = typeof recoverable.fallback === 'function'
            ? recoverable.fallback(error)
            : recoverable.fallback;
          if (recoverable.onFallback) recoverable.onFallback(fallback, error);
          addWarning(stepId, recoverable.code || 'STEP_WARNING', error);
          finishStep(stepId, token, 'warning', error);
          return fallback;
        }
        failJob(stepId, token, error);
        throw error;
      });
    }

    function startRun(input) {
      var validated;
      var token;
      var dependencies;
      var diagnoseOptions;

      try {
        validated = validateInput(input);
      } catch (validationError) {
        activeRunToken = ++runSequence;
        job = createJob('failed', activeRunToken, now);
        job.input = isObject(input) ? {
          url: sanitizePublicUrl(input.url, true),
          goal: cleanText(input.goal),
          keywordCount: Number(input.keywordCount) || null,
          region: cleanText(input.region)
        } : null;
        job.started_at = now();
        job.completed_at = now();
        job.error = {
          step: 'input',
          code: 'INVALID_INPUT',
          message: errorMessage(validationError)
        };
        touch();
        notify();
        return Promise.reject(validationError);
      }

      token = ++runSequence;
      activeRunToken = token;
      lastInput = clone(validated);
      dependencies = resolveDependencies();
      diagnoseOptions = typeof options.diagnoseOptions === 'function'
        ? options.diagnoseOptions(clone(validated))
        : Object.assign({ allowProxy: false, allowThirdPartyProxy: false }, options.diagnoseOptions || {});

      job = createJob('running', token, now);
      job.input = clone(validated);
      job.started_at = now();
      touch();
      notify();

      return executeStep(token, 'site', function () {
        var diagnose = dependencies.diagnose;
        if (typeof diagnose !== 'function') {
          var missing = new Error('AirReach.diagnose が利用できません。');
          missing.code = 'MISSING_DEPENDENCY';
          throw missing;
        }
        return diagnose.call(dependencies.airReach, validated.url, diagnoseOptions);
      }, function (diagnosis) {
        job.diagnosis = diagnosis == null ? null : clone(diagnosis);
      }, {
        code: 'DIAGNOSE_FAILED',
        fallback: null,
        onFallback: function () { job.diagnosis = null; }
      }).then(function () {
        return executeStep(token, 'competitors', function () {
          var planned = new Error('競合SERP・Citationのライブ測定は未接続です。');
          planned.code = 'COMPETITOR_LIVE_UNCONNECTED';
          throw planned;
        }, null, {
          code: 'COMPETITOR_LIVE_UNCONNECTED',
          fallback: null
        });
      }).then(function () {
        return executeStep(token, 'demand', function () {
          if (typeof dependencies.getGscStatus !== 'function') return disconnectedGscStatus();
          return dependencies.getGscStatus.call(dependencies.studio, validated.url);
        }, function (status) {
          job.gsc_status = status ? clone(status) : disconnectedGscStatus();
        }, {
          code: 'GSC_STATUS_FAILED',
          fallback: disconnectedGscStatus,
          onFallback: function (status) { job.gsc_status = clone(status); }
        });
      }).then(function () {
        return executeStep(token, 'keywords', function () {
          var build = requireFunction(dependencies.buildKeywordCandidates, 'buildKeywordCandidates');
          return build.call(dependencies.studio, clone(validated), clone(job.diagnosis));
        }, function (keywords) {
          if (!isArray(keywords)) throw new Error('buildKeywordCandidates は配列を返す必要があります。');
          job.keyword_candidates = clone(keywords);
        });
      }).then(function () {
        return executeStep(token, 'prompts', function () {
          var build = requireFunction(dependencies.buildPromptCandidates, 'buildPromptCandidates');
          return build.call(dependencies.studio, clone(job.keyword_candidates), clone(validated));
        }, function (prompts) {
          if (!isArray(prompts)) throw new Error('buildPromptCandidates は配列を返す必要があります。');
          job.prompt_candidates = clone(prompts);
          applyPromptCounts(job.keyword_candidates, job.prompt_candidates);
        });
      }).then(function () {
        return executeStep(token, 'actions', function () {
          var build = requireFunction(dependencies.buildActions, 'buildActions');
          return build.call(
            dependencies.studio,
            clone(validated),
            clone(job.diagnosis),
            clone(job.keyword_candidates),
            clone(job.prompt_candidates)
          );
        }, function (actions) {
          if (!isArray(actions)) throw new Error('buildActions は配列を返す必要があります。');
          job.actions = clone(actions);
          job.summary = calculateSummary(job);
          job.conclusion = buildConclusion(job.summary);
        });
      }).then(function () {
        return executeStep(token, 'artifacts', function () {
          var build = requireFunction(dependencies.buildArtifactBundle, 'buildArtifactBundle');
          return build.call(dependencies.studio, clone(job));
        }, function (bundle) {
          if (!isObject(bundle)) throw new Error('buildArtifactBundle はバンドルオブジェクトを返す必要があります。');
          job.artifact_bundle = clone(bundle);
        });
      }).then(function () {
        if (!isCurrent(token)) throw STALE_RUN;
        job.summary = calculateSummary(job);
        job.conclusion = buildConclusion(job.summary);
        job.status = 'completed';
        job.current_step = null;
        job.progress = 100;
        job.completed_at = now();
        touch();
        notify();
        return clone(job);
      }).catch(function (error) {
        if (error === STALE_RUN || !isCurrent(token)) throw STALE_RUN;
        throw error;
      });
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listenerは関数で指定してください。');
      listeners.push(listener);
      try {
        listener(clone(job));
      } catch (listenerError) {
        // Subscription remains active; later events must not be interrupted.
      }
      return function unsubscribe() {
        var index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }

    function retry() {
      if (!lastInput) {
        return Promise.reject(new Error('再実行できる分析条件がありません。'));
      }
      return startRun(clone(lastInput));
    }

    function getJob() {
      return clone(job);
    }

    function reset() {
      activeRunToken = ++runSequence;
      lastInput = null;
      job = createJob('idle', activeRunToken, now);
      notify();
      return clone(job);
    }

    return {
      subscribe: subscribe,
      run: startRun,
      retry: retry,
      getJob: getJob,
      reset: reset
    };
  }

  var defaultInstance = create();
  defaultInstance.create = create;
  defaultInstance.default = defaultInstance;
  defaultInstance.defaultInstance = defaultInstance;
  root.AirReachOrchestrator = defaultInstance;
})(typeof window !== 'undefined' ? window : this);
