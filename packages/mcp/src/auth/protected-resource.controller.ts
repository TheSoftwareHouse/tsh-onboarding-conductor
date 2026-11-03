import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getProtectedResourceMetadata, type ProtectedResourceMetadata } from './protected-resource';

@Controller('.well-known')
export class ProtectedResourceController {
  constructor(private readonly config: ConfigService) {}

  /** Both the bare and the `/mcp`-suffixed form, because clients try either. */
  @Get(['oauth-protected-resource', 'oauth-protected-resource/mcp'])
  getMetadata(): ProtectedResourceMetadata {
    if (!this.config.getOrThrow<boolean>('MCP_AUTH_ENABLED')) {
      // With authentication off there is no authorization server to point a client at.
      throw new NotFoundException();
    }

    return getProtectedResourceMetadata(this.config);
  }
}
