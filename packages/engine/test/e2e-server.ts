import type { INestApplication } from '@nestjs/common';

/**
 * Boots `app` and leaves it listening on a loopback port for the lifetime of the suite. Use this
 * in place of `app.init()`, which it performs itself.
 *
 * Supertest resolves its target address when the request object is constructed, not when it is
 * sent: handed a server that is not already listening, it binds a fresh ephemeral port for that
 * one request and closes it again once the response arrives. A full e2e run builds thousands of
 * those, drawing on the same ephemeral range the suites' own outbound calls — webhook receivers,
 * object storage, connector stubs — draw from, and CI runs the other packages' e2e suites
 * alongside this one. A port that comes back round while a pooled keep-alive socket still points
 * at the server that used to own it delivers the request nowhere, which surfaces as a stray
 * `Parse Error: Expected HTTP/` or as a response from the wrong application. Listening once per
 * suite gives supertest one stable address to reuse; `app.close()` releases it.
 */
export async function startE2eServer(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}
