// Servidor local das rotas /api (mesmos arquivos que a Vercel executa), para desenvolver sem deploy.
// Uso: npm run dev:api  (em outro terminal: npm run dev — o Vite encaminha /api para cá).
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORTA = Number(process.env.API_PORT) || 3001;
const RAIZ = path.resolve(import.meta.dirname, '..', 'api');

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const nome = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+$/i.test(nome)) { res.statusCode = 404; return res.end('{"error":"Rota não encontrada."}'); }

  let corpo = '';
  for await (const parte of req) corpo += parte;
  req.query = Object.fromEntries(url.searchParams);
  try { req.body = corpo ? JSON.parse(corpo) : {}; } catch { req.body = {}; }

  // Mesma interface (status/json/setHeader) que a Vercel entrega aos handlers.
  res.status = (codigo) => { res.statusCode = codigo; return res; };
  res.json = (dados) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(dados)); };

  try {
    const { default: handler } = await import(pathToFileURL(path.join(RAIZ, `${nome}.js`)).href);
    await handler(req, res);
  } catch (erro) {
    console.error(`[${nome}]`, erro.message);
    if (!res.headersSent) res.status(erro.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500).json({ error: erro.message });
  }
});

servidor.listen(PORTA, () => console.log(`API local em http://localhost:${PORTA}/api/…`));
