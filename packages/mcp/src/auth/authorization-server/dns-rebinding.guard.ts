import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  buildDnsRebindingProtection,
  DnsRebindingProtection,
  findDnsRebindingViolation,
} from '../../transport/dns-rebinding';

/**
 * The `Host`/`Origin` check `POST /mcp` has, for the relay's routes: a page on another site that
 * DNS points at this server is refused. A browser navigation to `/oauth/authorize` sends no
 * `Origin` and passes. With authentication off the routes answer 404 themselves, so it steps aside.
 */
@Injectable()
export class DnsRebindingGuard implements CanActivate {
  private readonly protection: DnsRebindingProtection;

  constructor(private readonly config: ConfigService) {
    this.protection = buildDnsRebindingProtection(
      config.getOrThrow<string>('MCP_PUBLIC_URL'),
      config.getOrThrow<number>('MCP_PORT'),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.getOrThrow<boolean>('MCP_AUTH_ENABLED')) {
      return true;
    }

    const { headers } = context.switchToHttp().getRequest<Request>();
    const violation = findDnsRebindingViolation(headers, this.protection);

    if (violation) {
      throw new ForbiddenException(violation);
    }

    return true;
  }
}
