import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** An RFC 6749 §5.2 / RFC 7591 §3.2.2 error the relay answers itself, never one it got from Entra. */
export class OAuthRequestError extends Error {
  constructor(
    readonly error: string,
    description: string,
    readonly status: number = HttpStatus.BAD_REQUEST,
  ) {
    super(description);
    this.name = 'OAuthRequestError';
  }
}

/**
 * Answers an {@link OAuthRequestError} in the OAuth error shape. The log line carries the error
 * code and status only: a description, a request field or an upstream body never reaches a log.
 */
@Catch(OAuthRequestError)
export class OAuthErrorFilter implements ExceptionFilter<OAuthRequestError> {
  private readonly logger = new Logger(OAuthErrorFilter.name);

  catch(exception: OAuthRequestError, host: ArgumentsHost): void {
    this.logger.warn(`OAUTH_RELAY_REFUSED error=${exception.error} status=${exception.status}`);

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.status)
      .set('Cache-Control', 'no-store')
      .json({ error: exception.error, error_description: exception.message });
  }
}
