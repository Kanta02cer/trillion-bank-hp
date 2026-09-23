/**
 * AirReach Recruit — Employer Evidence Graph (v0 scaffold).
 * Claim → Evidence[] only. Never claims AI will cite a source.
 */
(function (root) {
  'use strict';

  var KEY = 'airreach_recruit_evidence_graph_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }

  function save(claims) {
    try { localStorage.setItem(KEY, JSON.stringify(claims)); } catch (e) {}
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addClaim(text, evidence) {
    var claims = load();
    claims.unshift({
      id: uid(),
      claim: String(text || '').trim(),
      evidence: (evidence || []).map(function (e) {
        return {
          id: uid(),
          url: e.url || '',
          title: e.title || '',
          kind: e.kind || 'official', // official | job_posting | interview | third_party
          note: e.note || ''
        };
      }),
      createdAt: new Date().toISOString()
    });
    save(claims);
    return claims;
  }

  function removeClaim(id) {
    var claims = load().filter(function (c) { return c.id !== id; });
    save(claims);
    return claims;
  }

  function summarize(claims) {
    claims = claims || load();
    return claims.map(function (c) {
      return {
        id: c.id,
        claim: c.claim,
        evidenceCount: (c.evidence || []).length,
        label: 'この主張について、AIが参照可能な根拠が ' + ((c.evidence || []).length) + ' 件あります'
      };
    });
  }

  root.AirReachEvidenceGraph = {
    KEY: KEY,
    load: load,
    save: save,
    addClaim: addClaim,
    removeClaim: removeClaim,
    summarize: summarize
  };
})(typeof window !== 'undefined' ? window : globalThis);
