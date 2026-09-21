#!/usr/bin/env node
/**
 * Validate a Studio artifact_bundle (files map JSON) against the package blueprint.
 * Usage:
 *   node scripts/validate_studio_package.js path/to/files.json
 *   node scripts/validate_studio_package.js --smoke
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var schemaPath = path.join(__dirname, '..', 'assets', 'js', 'airreach-package-schema.js');
var sandbox = { module: { exports: {} }, globalThis: {}, URL: URL, console: console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(schemaPath, 'utf8'), sandbox);
var Schema = sandbox.AirReachPackageSchema || sandbox.module.exports;

function smokeFiles() {
  var files = {};
  Schema.REQUIRED_FILES.forEach(function (f) {
    if (f === 'MANIFEST.json') {
      files[f] = JSON.stringify({
        generated_at: new Date().toISOString(),
        target_url: 'https://example.com/',
        url: 'https://example.com/',
        evidence: {
          market_demand: 'Estimated',
          acquisition_score: 'Estimated',
          gsc: 'Unavailable',
          hack2: 'Unavailable',
          deployment: 'ZIP only'
        }
      }, null, 2);
    } else if (f === 'schema/organization.jsonld') {
      files[f] = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Example Co',
        url: 'https://example.com/'
      }, null, 2);
    } else if (f === 'schema/service.jsonld') {
      files[f] = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: 'Example Service',
        provider: { '@type': 'Organization', name: 'Example Co', url: 'https://example.com/' }
      }, null, 2);
    } else if (f === 'schema/faq.jsonld') {
      files[f] = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: []
      }, null, 2);
    } else if (f === 'strategy/keywords.csv') {
      files[f] = Schema.KEYWORD_CSV_COLUMNS.join(',') + '\nP0,example,100,Estimated,,,,,,Core,大,ページ改善,Generated\n';
    } else if (f === 'strategy/prompts.csv') {
      files[f] = Schema.PROMPT_CSV_COLUMNS.join(',') + '\n';
    } else if (f === 'strategy/actions.csv') {
      files[f] = Schema.ACTION_CSV_COLUMNS.join(',') + '\n';
    } else {
      files[f] = '# draft\n';
    }
  });
  return files;
}

var arg = process.argv[2];
var files;
if (!arg || arg === '--smoke') {
  files = smokeFiles();
} else {
  files = JSON.parse(fs.readFileSync(arg, 'utf8'));
  if (files.files) files = files.files;
}

var result = Schema.validatePackageFiles(files);
if (!result.ok) {
  console.error('FAIL', JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log('OK package tree (' + Schema.REQUIRED_FILES.length + ' required files)');
process.exit(0);
