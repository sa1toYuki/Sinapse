import { Readable } from 'node:stream';
import { defineConfig, type Connect } from 'vite';
import { gradeLocal } from './worker/local-grade';

const localGrade: Connect.NextHandleFunction = async (req, res, next) => {
  if (req.url !== '/api/local/grade' || req.method !== 'POST') return next();
  const body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
  const headers = new Headers();
  if (req.headers['content-type']) headers.set('Content-Type', req.headers['content-type']);
  const init = { method: 'POST', headers, body, duplex: 'half' } as RequestInit;
  const response = await gradeLocal(new Request('http://localhost/api/local/grade', init));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
};

export default defineConfig({
  build: { sourcemap: false },
  plugins: [{
    name: 'sinapse-local-grading',
    configureServer(server) { server.middlewares.use(localGrade); },
    configurePreviewServer(server) { server.middlewares.use(localGrade); },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && Object.keys(output.modules).some(id => id.replaceAll('\\', '/').includes('/worker/'))) {
          this.error('Um módulo do Worker entrou no bundle do navegador.');
        }
      }
    },
  }],
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/worker/**'] } },
});
