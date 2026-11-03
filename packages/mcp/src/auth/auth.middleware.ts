import {
  Inject,
  Injectable,
  Logger,
  NestMiddleware,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Response } from 'express';
import type { McpRequest } from '../request-context/request-context';
import { AuthUnavailableError, TokenRejectedError } from './auth.errors';
import { getMetadataUrl } from './protected-resource';
import { REQUEST_AUTHENTICATOR, type RequestAuthenticator } from './request-authenticator';

const BEARER_PREFIX = 'bearer ';

function readBearerToken(header: string | undefined): string | null {
  if (!header?.toLowerCase().startsWith(BEARER_PREFIX)) {
    return null;
  }

  return header.slice(BEARER_PREFIX.length).trim() || null;
}

/**
 * Identifies the caller of `POST /mcp` before the transport runs. With authentication off the
 * request passes untouched and the transport serves it as `local`. With it on, the request either
 * leaves here carrying the verified analyst and their engine token, or is answered 401 with the
 * RFC 9728 challenge, or 503 when Entra cannot be reached — never a 401 over an outage.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REQUEST_AUTHENTICATOR) private readonly authenticator: RequestAuthenticator | null,
  ) {}

  async use(request: McpRequest, response: Response, next: NextFunction): Promise<void> {
    if (!this.authenticator) {
      next();

      return;
    }

    const token = readBearerToken(request.headers.authorization);

    if (!token) {
      throw this.challenge(response);
    }

    try {
      request.mcpContext = await this.authenticator.authenticate(token);
    } catch (error) {
      if (error instanceof TokenRejectedError) {
        this.logger.warn(`AUTH_TOKEN_REJECTED reason=${JSON.stringify(error.message)}`);
        throw this.challenge(response);
      }

      if (error instanceof AuthUnavailableError) {
        this.logger.error(`AUTH_UNAVAILABLE reason=${JSON.stringify(error.message)}`);
        throw new ServiceUnavailableException('Access token could not be verified right now');
      }

      throw error;
    }

    next();
  }

  private challenge(response: Response): UnauthorizedException {
    response.set('WWW-Authenticate', `Bearer resource_metadata="${getMetadataUrl(this.config)}"`);

    return new UnauthorizedException('Missing or invalid access token');
  }
}
