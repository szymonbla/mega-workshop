import { createReadStream, statSync } from 'node:fs';

// Single byte ranges let native audio controls seek without downloading a whole clip.
export function serveAudio(req, res, file) {
  const size = statSync(file).size;
  const headers = {'Content-Type':'audio/mpeg', 'Accept-Ranges':'bytes',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'};
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
    } else start = size;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.writeHead(416, {...headers, 'Content-Range':`bytes */${size}`});
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, {...headers, 'Content-Length':end - start + 1});
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, {start, end});
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
