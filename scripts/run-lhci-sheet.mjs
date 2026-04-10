import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_KEY = process.env.APPS_SCRIPT_KEY;
const PSI_API_KEY = process.env.PSI_API_KEY;

if (!APPS_SCRIPT_URL || !APPS_SCRIPT_KEY || !PSI_API_KEY) {
  throw new Error('Missing required environment variables.');
}

function runNpx(args) {
  execFileSync('npx', args, {
    stdio: 'inherit',
    env: process.env,
  });
}

function fetchJsonCurl(url) {
  const output = execFileSync('curl', ['-L', '--silent', '--show-error', url], {
    encoding: 'utf8',
    env: process.env,
  });
  return JSON.parse(output);
}

function scoreTo100(score) {
  return score == null ? '' : Math.round(score * 100);
}

function round(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '';
  return Number(value.toFixed(digits));
}

//const urlWithKey = `${APPS_SCRIPT_URL}?key=${encodeURIComponent(APPS_SCRIPT_KEY)}`;
const urlObj = new URL(APPS_SCRIPT_URL);
urlObj.searchParams.set('key', APPS_SCRIPT_KEY);
const urlWithKey = urlObj.toString();
const targetPayload = fetchJsonCurl(urlWithKey);

if (!targetPayload.ok) {
  throw new Error(targetPayload.error || 'Failed to load targets.');
}

const targets = Array.isArray(targetPayload.targets) ? targetPayload.targets : [];
const results = [];

for (const target of targets) {
  console.log(`::add-mask::${target.url}`);

  fs.rmSync('.lighthouseci', { recursive: true, force: true });
  fs.rmSync('lhci-out', { recursive: true, force: true });

  runNpx([
    '-y',
    '@lhci/cli@latest',
    'collect',
    '--method=psi',
    `--psiApiKey=${PSI_API_KEY}`,
    '--psiStrategy=mobile',
    '--numberOfRuns=3',
    `--url=${target.url}`,
  ]);

  runNpx([
    '-y',
    '@lhci/cli@latest',
    'upload',
    '--target=filesystem',
    '--outputDir=./lhci-out',
  ]);

  const manifest = JSON.parse(
    fs.readFileSync(path.resolve('lhci-out/manifest.json'), 'utf8')
  );

  const representative = manifest.find(item => item.isRepresentativeRun) || manifest[0];
  const report = JSON.parse(fs.readFileSync(representative.jsonPath, 'utf8'));

  results.push({
    timestamp: new Date().toISOString(),
    label: target.label || '',
    url: target.url,
    strategy: 'mobile',
    performance: scoreTo100(report.categories.performance?.score),
    accessibility: scoreTo100(report.categories.accessibility?.score),
    bestPractices: scoreTo100(report.categories['best-practices']?.score),
    seo: scoreTo100(report.categories.seo?.score),
    fcpMs: round(report.audits['first-contentful-paint']?.numericValue),
    lcpMs: round(report.audits['largest-contentful-paint']?.numericValue),
    tbtMs: round(report.audits['total-blocking-time']?.numericValue),
    cls: round(report.audits['cumulative-layout-shift']?.numericValue, 3),
    source: 'github-lhci-psi',
  });
}

let rowsSaved = 0;

for (const result of results) {
  const saveUrl = new URL(APPS_SCRIPT_URL);
  saveUrl.searchParams.set('key', APPS_SCRIPT_KEY);
  saveUrl.searchParams.set('action', 'save');
  saveUrl.searchParams.set('timestamp', result.timestamp || '');
  saveUrl.searchParams.set('label', result.label || '');
  saveUrl.searchParams.set('url', result.url || '');
  saveUrl.searchParams.set('strategy', result.strategy || '');
  saveUrl.searchParams.set('performance', String(result.performance ?? ''));
  saveUrl.searchParams.set('accessibility', String(result.accessibility ?? ''));
  saveUrl.searchParams.set('bestPractices', String(result.bestPractices ?? ''));
  saveUrl.searchParams.set('seo', String(result.seo ?? ''));
  saveUrl.searchParams.set('fcpMs', String(result.fcpMs ?? ''));
  saveUrl.searchParams.set('lcpMs', String(result.lcpMs ?? ''));
  saveUrl.searchParams.set('tbtMs', String(result.tbtMs ?? ''));
  saveUrl.searchParams.set('cls', String(result.cls ?? ''));
  saveUrl.searchParams.set('source', result.source || 'github-lhci-psi');

  const saveResponse = fetchJsonCurl(saveUrl.toString());

  if (!saveResponse.ok) {
    throw new Error(saveResponse.error || 'Failed to save one result row.');
  }

  rowsSaved += 1;
}

console.log(`Saved ${rowsSaved} rows.`);

