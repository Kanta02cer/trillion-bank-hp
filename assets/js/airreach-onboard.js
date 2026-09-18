/**
 * AirReach onboarding survey — frosted gate + route by answers.
 * Stores User Input in localStorage; never claims Official data.
 */
(function () {
  'use strict';

  var KEY = 'airreach_onboard_survey_v1';
  var HISTORY_KEY = 'airreach_onboard_history_v1';

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function loadSurvey() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  }

  function saveSurvey(survey) {
    survey = survey || {};
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
        goal: survey.goal
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

    var hash = '#result';
    if (mode === 'branded_search') hash = '#result';

    function enc(v) { try { return encodeURIComponent(String(v || '')); } catch (e) { return ''; } }
    var q = [
      'industry=' + enc(industryId),
      'mode=' + enc(mode),
      'onboard=1'
    ];
    if (survey.url) q.push('url=' + enc(survey.url));
    if (survey.keyword) q.push('keyword=' + enc(survey.keyword));
    if (survey.mediaUrl) q.push('media=' + enc(survey.mediaUrl));

    return {
      industryId: industryId,
      mode: mode,
      goal: goal,
      url: survey.url || '',
      keyword: survey.keyword || '',
      mediaUrl: survey.mediaUrl || '',
      path: '/airreach/?' + q.join('&') + hash,
      salesFocus: industryId === 'media' ? 'media_visibility' : (mode === 'branded_search' ? 'brand_visibility' : 'acquisition'),
      copy: industryId === 'media'
        ? 'AIは、御社をどの記事から理解しているか。'
        : '検索から、あと何件お客様を増やせそうか。'
    };
  }

  function isComplete(survey) {
    if (!survey) return false;
    return !!(survey.industryId && survey.url && survey.keyword && survey.goal);
  }

  window.AirReachOnboard = {
    KEY: KEY,
    loadSurvey: loadSurvey,
    saveSurvey: saveSurvey,
    clearSurvey: clearSurvey,
    routeFromSurvey: routeFromSurvey,
    isComplete: isComplete
  };
})();
