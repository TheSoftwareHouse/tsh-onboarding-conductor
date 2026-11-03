import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthorizationServerMetadata } from './authorization-server-metadata';
import {
  AUTHORIZATION_SERVER_RELAY,
  type AuthorizationServerRelay,
} from './authorization-server-relay';
import { AUTHORIZE_PATH, REGISTER_PATH, TOKEN_PATH } from './authorization-server.settings';
import { DnsRebindingGuard } from './dns-rebinding.guard';
import type { ClientRegistration } from './client-registrar';
import { OAuthErrorFilter, OAuthRequestError } from './oauth-error';
import { TOKEN_BODY_LIMIT_BYTES } from './token-relay';

/**
 * The authorization server the protected-resource metadata names. It issues nothing: it rewrites
 * and relays to Entra (see `docs/decisions/0054`), so Entra stays the only token issuer. Every
 * route answers 404 when `MCP_AUTH_ENABLED=false`.
 */
@Controller()
@UseGuards(DnsRebindingGuard)
@UseFilters(OAuthErrorFilter)
export class AuthorizationServerController {
  constructor(
    @Inject(AUTHORIZATION_SERVER_RELAY) private readonly relay: AuthorizationServerRelay | null,
  ) {}

  /** RFC 8414 and OpenID discovery: the SDK client tries both for an issuer without a path. */
  @Get(['.well-known/oauth-authorization-server', '.well-known/openid-configuration'])
  getMetadata(): AuthorizationServerMetadata {
    return this.getRelay().metadata;
  }

  @Get(AUTHORIZE_PATH)
  @Redirect()
  authorize(@Query() query: unknown): { url: string; statusCode: number } {
    return { url: this.getRelay().authorize.buildRedirectUrl(query), statusCode: HttpStatus.FOUND };
  }

  @Post(TOKEN_PATH)
  @HttpCode(HttpStatus.OK)
  async redeemToken(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const relay = this.getRelay();

    if (Number(request.headers['content-length']) > TOKEN_BODY_LIMIT_BYTES) {
      throw new OAuthRequestError(
        'invalid_request',
        'Request body too large',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const upstream = await relay.token.relay(body);
    response.status(upstream.status).set('Cache-Control', 'no-store');

    return upstream.body;
  }

  @Post(REGISTER_PATH)
  @Header('Cache-Control', 'no-store')
  register(@Body() body: unknown): ClientRegistration {
    return this.getRelay().registrar.register(body);
  }

  private getRelay(): AuthorizationServerRelay {
    if (!this.relay) {
      throw new NotFoundException();
    }

    return this.relay;
  }
}
