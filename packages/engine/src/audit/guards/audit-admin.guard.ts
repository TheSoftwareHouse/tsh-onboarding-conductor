import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { AuditForbiddenScopeException } from '../errors/audit-forbidden-scope.exception';
import { AuditUnauthorizedException } from '../errors/audit-unauthorized.exception';

@Injectable()
export class AuditAdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();
    const authorizationHeader = request.headers.authorization;

    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
      throw new AuditUnauthorizedException();
    }

    const providedToken = authorizationHeader.slice('Bearer '.length).trim();
    if (providedToken === '') {
      throw new AuditUnauthorizedException();
    }

    const adminApiKey = this.configService.get<string>('AUDIT_ADMIN_API_KEY');
    const nonAdminApiKey = this.configService.get<string>('AUDIT_NON_ADMIN_API_KEY');

    if (typeof adminApiKey !== 'string' || typeof nonAdminApiKey !== 'string') {
      throw new AuditUnauthorizedException();
    }

    if (this.isConstantTimeEqual(providedToken, adminApiKey)) {
      return true;
    }

    if (this.isConstantTimeEqual(providedToken, nonAdminApiKey)) {
      throw new AuditForbiddenScopeException();
    }

    throw new AuditUnauthorizedException();
  }

  private isConstantTimeEqual(providedValue: string, expectedValue: string): boolean {
    const providedBuffer = Buffer.from(providedValue, 'utf8');
    const expectedBuffer = Buffer.from(expectedValue, 'utf8');

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    try {
      return timingSafeEqual(providedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }
}
