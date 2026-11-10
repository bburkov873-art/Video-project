// Renders the film frame by frame in headless Chrome (software WebGL) and encodes it with ffmpeg.
//   node render.mjs                         full 1080x1920 render -> out/lofi-space.mp4
//   node render.mjs --audio track.mp3       same, with the track muxed in (video is trimmed/faded to fit)
//   node render.mjs --stills 0,5,10 --w 360 --h 640    quick preview stills + contact sheet
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : (argv[i + 1] ?? true); };
const W = +arg('w', 1080), H = +arg('h', 1920), FPS = +arg('fps', 30);
const WORKERS = +arg('workers', 4), TEXQ = arg('texq', 1), SAMPLES = arg('samples', 4);
const OUT = path.resolve(ROOT, arg('out', 'out'));
const stills = arg('stills', null), audio = arg('audio', null);
const encodeOnly = argv.includes('--encode-only');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/src/index.html?w=${W}&h=${H}&texq=${TEXQ}&samples=${SAMPLES}`;

async function open() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: true, protocolTimeout: 900000,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.error('[page]', m.text().slice(0, 600)); });
  await page.goto(url, { timeout: 0 }); // texture baking runs during load and is slow with several workers
  await page.waitForFunction('window.ready === true', { timeout: 900000 });
  return { browser, page };
}
const save = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] }); if (r.status !== 0) throw new Error(`${cmd} failed`); };

if (stills) {
  const dir = path.join(OUT, 'stills'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const times = stills === true ? Array.from({ length: 33 }, (_, i) => i * 2) : String(stills).split(',').map(Number);
  const t0 = Date.now(); const { browser, page } = await open();
  console.log(`init ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const [i, t] of times.entries()) {
    const s = Date.now();
    save(path.join(dir, `${String(i).padStart(3, '0')}.jpg`), await page.evaluate((t) => window.renderFrame(t), t));
    console.log(`t=${t} ${(Date.now() - s)}ms`, JSON.stringify(await page.evaluate((t) => window.debugAt(t), t)));
  }
  await browser.close();
  const cols = +arg('cols', Math.min(times.length, 6));
  run('ffmpeg', ['-y', '-v', 'error', '-framerate', '1', '-i', path.join(dir, '%03d.jpg'), '-vf', `tile=${cols}x${Math.ceil(times.length / cols)}`, '-frames:v', '1', '-q:v', '3', path.join(OUT, 'sheet.jpg')]);
} else {
  const dir = path.join(OUT, 'frames'); fs.mkdirSync(dir, { recursive: true });
  const duration = +arg('duration', 65), total = Math.round(duration * FPS);
  const from = Math.round(+arg('from', 0) * FPS), to = Math.min(total, Math.round(+arg('to', duration) * FPS));
  const frame = (i) => path.join(dir, `${String(i).padStart(5, '0')}.jpg`);
  if (!encodeOnly) {
    let done = 0; const start = Date.now();
    // existing frames are skipped, so an interrupted render resumes where it stopped
    await Promise.all(Array.from({ length: WORKERS }, async (_, k) => {
      const { browser, page } = await open();
      for (let i = from + k; i < to; i += WORKERS) {
        if (!fs.existsSync(frame(i))) save(frame(i), await page.evaluate((t) => window.renderFrame(t), i / FPS));
        if (++done % 50 === 0) console.log(`${done}/${to - from} frames, ${((Date.now() - start) / 1000).toFixed(0)}s`);
      }
      await browser.close();
    }));
  }
  const mp4 = path.join(OUT, arg('name', 'lofi-space.mp4'));
  const a = ['-y', '-v', 'error', '-framerate', String(FPS), '-start_number', String(from), '-i', frame(0).replace('00000', '%05d')];
  if (audio) a.push('-i', path.resolve(audio), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-af', `afade=t=in:d=1.5,afade=t=out:st=${(to - from) / FPS - 3}:d=3`, '-shortest');
  a.push('-frames:v', String(to - from), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  run('ffmpeg', a);
  console.log('wrote', mp4);
}
server.close();
