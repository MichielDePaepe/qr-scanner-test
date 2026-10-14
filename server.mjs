import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || (process.env.HTTPS ? 8443 : 8080));
const https = Boolean(process.env.HTTPS);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
};

async function handle(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

let server;
if (https) {
  const [key, cert] = await Promise.all([
    readFile(resolve(root, 'certs/dev-key.pem')),
    readFile(resolve(root, 'certs/dev.pem')),
  ]);
  server = createHttpsServer({ key, cert }, handle);
} else {
  server = createHttpServer(handle);
}

server.listen(port, '0.0.0.0', () => {
  const scheme = https ? 'https' : 'http';
  console.log(`QR Lab running at ${scheme}://0.0.0.0:${port}`);
  if (!https) console.log('Use localhost for local camera access. iPhone camera access needs HTTPS; see README.md.');
});
