#!/usr/bin/env node
// Frame-accurate renderer for cm.html.
//   node render.mjs                      full render -> out/trillion-bank-cm-30s.mp4
//   node render.mjs --stills 1,4.5,9     PNG stills -> out/stills/
//   node render.mjs --from 4 --to 8 --sub 1 --out out/test.mp4
// Options: --fps 30  --sub 4 (motion-blur subframes, 180° shutter; 4x more inside FAST windows)  --workers 3  --crf 16
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const FPS = +(args.fps || 30), SUB = +(args.sub || 4), SHUTTER = 0.5;
const FROM = +(args.from || 0), TO = +(args.to || 30);
const WORKERS = +(args.workers || 3), CRF = +(args.crf || 16);
const OUT = path.resolve(HERE, args.out || 'out/trillion-bank-cm-30s.mp4');
const AUDIO = path.resolve(HERE, args.audio || 'out/score.wav');
const EXEC = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
// fast moves (whips, wipes, shutters, zooms, verb slams) get 4x the subframes so the blur is a smear, not copies
const FAST = [[3.7, 4.06], [6.58, 7.16], [9.98, 10.6], [12.38, 12.9], [14.26, 15.06], [19.74, 20.24], [20.98, 21.2], [21.98, 22.2], [22.98, 23.2], [23.7, 24.06], [25.88, 26.5]];
const subAt = t => SUB <= 1 ? 1 : FAST.some(([a, b]) => t >= a && t < b) ? SUB * 4 : SUB;
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/ops/cm-30s/cm.html?render`;

const browser = await chromium.launch({ executablePath: EXEC, args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const cdp = await page.context().newCDPSession(page);
  const shot = async t => {
    await page.evaluate(tt => window.renderAt(tt), t);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    return Buffer.from(data, 'base64');
  };
  return { page, shot };
}

if (args.cues) {
  const { page } = await openPage();
  const cues = await page.evaluate(() => window.__cues());
  fs.writeFileSync(path.resolve(HERE, 'out/cues.json'), JSON.stringify(cues, null, 1));
  console.log('wrote out/cues.json', Object.keys(cues).map(k => `${k}:${cues[k].length}`).join(' '));
  await browser.close(); server.close();
  process.exit(0);
}

if (args.stills) {
  const dir = path.resolve(HERE, 'out/stills');
  fs.mkdirSync(dir, { recursive: true });
  const { shot } = await openPage();
  for (const t of String(args.stills).split(',').map(Number)) {
    fs.writeFileSync(path.join(dir, `t${t.toFixed(2).padStart(5, '0')}.png`), await shot(t));
    process.stdout.write(`still ${t}\n`);
  }
  await browser.close(); server.close();
  process.exit(0);
}

const frames = Math.round((TO - FROM) * FPS);
const per = Math.ceil(frames / WORKERS);
const chunkFiles = [];
const t0 = Date.now();
let done = 0;
async function worker(w) {
  const f0 = w * per, f1 = Math.min(frames, f0 + per);
  if (f0 >= f1) return;
  const file = OUT.replace(/\.mp4$/, `.part${w}.mp4`);
  chunkFiles[w] = file;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1920x1080', '-framerate', String(FPS), '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF), '-x264-params', 'keyint=60:min-keyint=1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const { shot } = await openPage();
  const PX = 1920 * 1080;
  const acc = new Uint32Array(PX * 3), frame = Buffer.alloc(PX * 3);
  for (let f = f0; f < f1; f++) {
    const tf = FROM + f / FPS, S = subAt(tf);
    acc.fill(0);
    for (let s = 0; s < S; s++) {
      const off = S > 1 ? ((s + 0.5) / S - 0.5) * SHUTTER / FPS : 0;
      const { data } = PNG.sync.read(await shot(tf + off));
      for (let i = 0, j = 0; i < PX; i++, j += 4) { const k = i * 3; acc[k] += data[j]; acc[k + 1] += data[j + 1]; acc[k + 2] += data[j + 2]; }
    }
    const half = S >> 1;
    for (let k = 0; k < acc.length; k++) frame[k] = Math.min(255, ((acc[k] + half) / S) | 0);
    if (!ff.stdin.write(frame)) await new Promise(r => ff.stdin.once('drain', r));
    done++;
    if (done % 30 === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`frames ${done}/${frames}  ${(done / el).toFixed(2)} fps  eta ${((frames - done) / (done / el)).toFixed(0)}s\n`);
    }
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
}
await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));
await browser.close(); server.close();

const list = OUT.replace(/\.mp4$/, '.txt');
fs.writeFileSync(list, chunkFiles.filter(Boolean).map(f => `file '${f}'`).join('\n'));
const hasAudio = fs.existsSync(AUDIO) && !args.noaudio;
const mux = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
if (hasAudio) mux.push('-ss', String(FROM), '-t', String(TO - FROM), '-i', AUDIO);
mux.push('-c:v', 'copy');
if (hasAudio) mux.push('-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
mux.push('-movflags', '+faststart', OUT);
await new Promise((res, rej) => spawn('ffmpeg', mux, { stdio: 'inherit' }).on('close', c => c === 0 ? res() : rej(new Error('mux ' + c))));
chunkFiles.filter(Boolean).forEach(f => fs.unlinkSync(f)); fs.unlinkSync(list);
console.log(`wrote ${path.relative(HERE, OUT)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
