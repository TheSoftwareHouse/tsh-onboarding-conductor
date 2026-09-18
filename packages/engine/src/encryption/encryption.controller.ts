import { Controller, Get, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AdminRoute } from '../auth/admin-route.decorator';
import { readOperatorIdentity } from '../auth/azure-jwt.guard';
import { ApiErrorResponses } from '../openapi/api-error-responses.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { EncryptionAdminService } from './encryption-admin.service';
import {
  EncryptionKeyIdResponseDto,
  toEncryptionKeyIdResponse,
} from './dto/encryption-key.response.dto';
import {
  EncryptionKeysResponseDto,
  toEncryptionKeysResponse,
} from './dto/encryption-keys.response.dto';
import { EncryptionDisabledException } from './errors/encryption-disabled.exception';
import { EncryptionKeyRotationConflictException } from './errors/encryption-key-rotation-conflict.exception';

/** The one property `AzureJwtGuard` adds to the request once a token is accepted. */
type AdminAuthenticatedRequest = Request & { adminTokenClaims?: JWTPayload };

/**
 * Admin surface for the encryption key that protects `onboardings.context`: the full key
 * history plus derived re-encryption progress, and the one write that rotates it. Adding a key
 * is the only trigger for re-encryption — there is no separate "start" endpoint — so it is the
 * most consequential write this surface has, guarded like every other admin route.
 */
@ApiTags(API_TAGS.adminEncryption.name)
@Controller('v1/admin/encryption/keys')
export class EncryptionController {
  constructor(private readonly encryptionAdminService: EncryptionAdminService) {}

  @Get()
  @AdminRoute()
  @ApiOperation({
    operationId: 'listEncryptionKeys',
    summary: 'List the encryption key history',
    description:
      'Every key that has ever protected `onboardings.context`, most recent first, including ' +
      'soft-deleted ones — deletion never destroys material, only marks a key superseded. ' +
      '`reEncryption` is derived from the rows themselves, never a stored counter. Reports no ' +
      'keys and no progress when `ENCRYPTION_ENABLED=false`.',
  })
  @ApiOkResponse({
    type: EncryptionKeysResponseDto,
    description: 'The key history and re-encryption progress toward the active key.',
  })
  async list(): Promise<EncryptionKeysResponseDto> {
    const view = await this.encryptionAdminService.listKeys();

    return toEncryptionKeysResponse(view);
  }

  @Post()
  @AdminRoute()
  @ApiOperation({
    operationId: 'addEncryptionKey',
    summary: 'Rotate the encryption key',
    description:
      'Generates a new key, wraps it under the configured key-encryption key, soft-deletes the ' +
      'previous active key and inserts the new one in one transaction, then reloads the local ' +
      'key ring. The new key does not become active immediately: for up to ' +
      '`ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` it is reported as `pendingActivation` while the ' +
      'previous key keeps protecting new writes, so every replica has a chance to learn of it ' +
      'first. Every onboarding context still on an older key is re-encrypted onto this one in ' +
      "the background, with no further operator action. Returns only the new key's id — " +
      'never its material.',
  })
  @ApiCreatedResponse({
    type: EncryptionKeyIdResponseDto,
    description: 'The newly added key, now the active one.',
  })
  @ApiErrorResponses(EncryptionDisabledException, EncryptionKeyRotationConflictException)
  async add(@Req() request: AdminAuthenticatedRequest): Promise<EncryptionKeyIdResponseDto> {
    const { id } = await this.encryptionAdminService.addKey(this.resolveOperator(request));

    return toEncryptionKeyIdResponse(id);
  }

  /**
   * `oid` is Entra's immutable per-directory user id; the UPN is the fallback for a directory
   * that omits it. With `ADMIN_AUTH_ENABLED=false` the guard never runs and sets no claims at
   * all, which is exactly the existing unknown-actor case `readOperatorIdentity` was never meant
   * to answer.
   */
  private resolveOperator(request: AdminAuthenticatedRequest): string {
    const { adminTokenClaims } = request;

    if (adminTokenClaims === undefined) {
      return ADMIN_ACCESS_UNKNOWN_ACTOR;
    }

    const operator = readOperatorIdentity(adminTokenClaims);

    return operator.objectId ?? operator.userPrincipalName ?? ADMIN_ACCESS_UNKNOWN_ACTOR;
  }
}
