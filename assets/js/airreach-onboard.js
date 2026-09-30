/**
 * AirReach Tools onboarding survey — frosted gate + route by answers.
 * Stores User Input in localStorage; never claims Official data.
 */
(function () {
  'use strict';

  var KEY = 'airreach_onboard_survey_v1';
  var HISTORY_KEY = 'airreach_onboard_history_v1';

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  // 調べる言葉: keyword（メイン）と keywords（最大5語）をそろえる。旧データは keyword から keywords を作る
  // 呼び出し元のオブジェクトをそのまま書き換える（従来の saveSurvey と同じ振る舞い）
  function withKeywords(survey) {
    if (!window.AirReachKeywordList || !survey || typeof survey !== 'object') return survey;
    var n = window.AirReachKeywordList.normalize(survey.keyword, survey.keywords);
    survey.keyword = n.keyword;
    survey.keywords = n.keywords;
    return survey;
  }

  function loadSurvey() {
    try { return withKeywords(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (e) { return null; }
  }

  function saveSurvey(survey) {
    survey = withKeywords(survey || {});
    survey.version = 1;
    survey.savedAt = nowIso();
    survey.evidenceClass = 'User Input';
    try { localStorage.setItem(KEY, JSON.stringify(survey)); } catch (e) {}
    try {
      var hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(hist)) hist = [];
      hist.unshift({
        savedAt: survey.savedAt,
        industryId: survey.industryId,
        mode: survey.mode,
        url: survey.url,
        keyword: survey.keyword,
        keywords: survey.keywords,
        goal: survey.goal,
        outcomeGoal: survey.outcomeGoal || '',
        siteTitle: survey.siteTitle || ''
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 30)));
    } catch (e) {}
    return survey;
  }

  function clearSurvey() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  /**
   * Map survey → route for Sales View.
   * media always prefers branded visibility path.
   */
  function routeFromSurvey(survey) {
    survey = survey || {};
    var industryId = survey.industryId || 'other';
    var goal = survey.goal || 'acquisition'; // acquisition | visibility
    var mode = 'generic_search';
    if (goal === 'visibility' || industryId === 'media') mode = 'branded_search';

    var allowed = { restaurant:1, clinic:1, b2b:1, media:1, other:1 };
    if (!allowed[industryId]) industryId = 'other';
    var basePath = '/airreach/' + industryId + '/';
    var hash = '#result';

    function enc(v) { try { return encodeURIComponent(String(v || '')); } catch (e) { return ''; } }
    var q = [
      'mode=' + enc(mode),
      'onboard=1'
    ];
    if (survey.url) q.push('url=' + enc(survey.url));
    if (survey.keyword) q.push('keyword=' + enc(survey.keyword));
    if (survey.mediaUrl) q.push('media=' + enc(survey.mediaUrl));

    var copyMap = {
      restaurant: 'このエリアで探している人に、どれくらい選ばれている？',
      clinic: 'この施術を探している人に、どれくらい選ばれている？',
      b2b: 'この課題を探している人に、どれくらい選ばれている？',
      media: 'AIは、御社をどの記事から理解しているか。',
      other: '検索から、あと何件お客様を増やせそうか。'
    };

    return {
      industryId: industryId,
      mode: mode,
      goal: goal,
      url: survey.url || '',
      keyword: survey.keyword || '',
      mediaUrl: survey.mediaUrl || '',
      basePath: basePath,
      path: basePath + '?' + q.join('&') + hash,
      salesFocus: industryId === 'media' ? 'media_visibility' : (mode === 'branded_search' ? 'brand_visibility' : 'acquisition'),
      copy: copyMap[industryId] || copyMap.other
    };
  }

  function isComplete(survey) {
    if (!survey) return false;
    // keyword may be auto-generated after URL diagnose
    return !!(survey.industryId && survey.url && survey.goal);
  }

    function pathForIndustry(industryId) {
    var allowed = { restaurant:1, clinic:1, b2b:1, media:1, other:1 };
    if (!allowed[industryId]) industryId = 'other';
    return '/airreach/' + industryId + '/';
  }

  window.AirReachOnboard = {
    pathForIndustry: pathForIndustry,
    KEY: KEY,
    loadSurvey: loadSurvey,
    saveSurvey: saveSurvey,
    clearSurvey: clearSurvey,
    routeFromSurvey: routeFromSurvey,
    isComplete: isComplete
  };
})();
