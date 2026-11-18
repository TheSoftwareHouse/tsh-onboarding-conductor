import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { BETTER_AUTH } from './better-auth.tokens';
import { loadBetterAuth, type BetterAuthInstance } from './load-better-auth';

/** Hands `/v1/auth/*` to better-auth. The body must still be unparsed (see the parsers in main.ts). */
@Injectable()
export class BetterAuthMiddleware implements NestMiddleware {
  constructor(@Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { toNodeHandler } = await loadBetterAuth();
      // Nest mounts this middleware under the matched path, so Express splits the URL into
      // `baseUrl` + `url`; better-call rebuilds it from that pair and drops the query string, which
      // silently disabled every filter, search and page of a GET such as `/admin/list-users`.
      req.url = req.originalUrl;
      req.baseUrl = '';
      await toNodeHandler(this.auth)(req, res);
    } catch (error) {
      next(error);
    }
  }
}
