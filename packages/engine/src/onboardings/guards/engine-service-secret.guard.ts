import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class EngineServiceSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const expectedSecret = this.configService.get<string>('ENGINE_SERVICE_SECRET');
    const providedSecret = request.headers['x-engine-service-secret'];

    if (!expectedSecret || !providedSecret) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' });
    }

    const expectedBuffer = Buffer.from(expectedSecret);
    const providedBuffer = Buffer.from(
      Array.isArray(providedSecret) ? providedSecret[0] : providedSecret,
    );

    if (expectedBuffer.length !== providedBuffer.length) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' });
    }

    if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' });
    }

    return true;
  }
}
