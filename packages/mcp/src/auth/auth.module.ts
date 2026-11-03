import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthMiddleware } from './auth.middleware';
import {
  AUTHORIZATION_SERVER_RELAY,
  createAuthorizationServerRelay,
} from './authorization-server/authorization-server-relay';
import { AuthorizationServerController } from './authorization-server/authorization-server.controller';
import { OnBehalfOfExchanger } from './on-behalf-of';
import { ProtectedResourceController } from './protected-resource.controller';
import { REQUEST_AUTHENTICATOR, RequestAuthenticator } from './request-authenticator';
import { TokenVerifier } from './token-verifier';

/**
 * Self-contained: importing it anywhere in the app attaches {@link AuthMiddleware} to `POST /mcp`
 * and serves the protected-resource metadata and the authorization-server relay it points at. The
 * authenticator and the relay are `null` when `MCP_AUTH_ENABLED=false`, which makes the middleware
 * a pass-through and the relay's routes answer 404.
 */
@Module({
  controllers: [ProtectedResourceController, AuthorizationServerController],
  providers: [
    {
      provide: AUTHORIZATION_SERVER_RELAY,
      inject: [ConfigService],
      useFactory: createAuthorizationServerRelay,
    },
    {
      provide: REQUEST_AUTHENTICATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RequestAuthenticator | null => {
        if (!config.getOrThrow<boolean>('MCP_AUTH_ENABLED')) {
          return null;
        }

        const tenantId = config.getOrThrow<string>('MCP_AZURE_TENANT_ID');
        const clientId = config.getOrThrow<string>('MCP_AZURE_CLIENT_ID');

        return new RequestAuthenticator(
          new TokenVerifier({
            tenantId,
            audience: clientId,
            requiredScope: config.getOrThrow<string>('MCP_REQUIRED_SCOPE'),
          }),
          new OnBehalfOfExchanger({
            tenantId,
            clientId,
            clientSecret: config.getOrThrow<string>('MCP_AZURE_CLIENT_SECRET'),
            engineScope: config.getOrThrow<string>('MCP_ENGINE_SCOPE'),
          }),
        );
      },
    },
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes({ path: 'mcp', method: RequestMethod.POST });
  }
}
