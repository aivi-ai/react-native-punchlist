#!/usr/bin/env node
/**
 * Baseline reference receiver: Node `node:http`, ZERO server runtime
 * dependencies (only node: builtins).
 *
 * Run:
 *   node server/node/index.mjs
 *   PUNCHLIST_PORT=8787 PUNCHLIST_PUBLIC_BASE_URL=http://127.0.0.1:8787 \
 *     node server/node/index.mjs
 *
 * Binds 127.0.0.1 by default. To test from a physical device on your LAN set
 * PUNCHLIST_HOST=0.0.0.0 and PUNCHLIST_PUBLIC_BASE_URL=http://<your-lan-ip>:<port>
 * — only do that on a trusted network; there is no authentication here.
 *
 * LIMITATION: state is an in-memory Map. Restarting the process loses every
 * note, idempotency key and rate-limit counter.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { MemoryBackend } from './store.mjs';
import { createRequestListener } from './handler.mjs';
import { normalizePublicBaseUrl } from '../shared/validate.mjs';

const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Build (but do not start) the receiver.
 *
 * @param {object} [options]
 * @param {() => number} [options.clock]
 * @param {Map<string,string>} [options.env]
 */
export function createReceiver(options = {}) {
  const env = options.env || process.env;
  const clock = options.clock || (() => Date.now());
  const host = env.PUNCHLIST_HOST || '127.0.0.1';
  const port = Number.parseInt(env.PUNCHLIST_PORT || '8787', 10);
  const receiverId = env.PUNCHLIST_RECEIVER_ID || 'punchlist-node-reference';
  const corsOrigin = env.PUNCHLIST_CORS_ORIGIN || '*';

  const backend = new MemoryBackend({ clock });

  /** @type {{publicBaseUrl:string, receiverId:string, corsOrigin:string}} */
  const config = {
    /* Resolved once the port is known; see start(). */
    publicBaseUrl: env.PUNCHLIST_PUBLIC_BASE_URL || '',
    receiverId,
    corsOrigin,
  };

  const server = http.createServer(createRequestListener({ backend, config, clock }));

  /**
   * @returns {Promise<{url:string, host:string, port:number, config:object, backend:MemoryBackend, server:http.Server, close:() => Promise<void>}>}
   */
  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    if (!config.publicBaseUrl) {
      /* Derived from configuration, never from the request Host header. */
      config.publicBaseUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${boundPort}`;
    }
    /* Fail fast on a bad base URL rather than per-request. */
    config.publicBaseUrl = normalizePublicBaseUrl(config.publicBaseUrl);

    const sweepTimer = setInterval(() => backend.sweep(clock()), SWEEP_INTERVAL_MS);
    sweepTimer.unref();

    return {
      url: config.publicBaseUrl,
      host,
      port: boundPort,
      config,
      backend,
      server,
      close: () =>
        new Promise((resolve) => {
          clearInterval(sweepTimer);
          server.close(() => resolve());
        }),
    };
  }

  return { server, backend, config, start };
}

async function main() {
  const receiver = createReceiver();
  const running = await receiver.start();
  /* Only the listening URL is logged: never note bodies, ids or auth headers. */
  // eslint-disable-next-line no-console
  console.log(`punchlist node receiver listening on ${running.url}`);
  console.log(`  POST ${running.url}/v1/notes`);
  console.log('  in-memory store: restarting loses all notes');
}

/* Run only when executed directly, not when imported by tests. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('punchlist node receiver failed to start:', err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}
