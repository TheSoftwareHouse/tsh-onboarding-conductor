import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoute } from '../auth/admin-route.decorator';
import { resolveOperatorId, type AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import { ApiErrorResponses, VALIDATION_ERROR } from '../openapi/api-error-responses.decorator';
import { API_TAGS } from '../openapi/openapi.constants';
import { EncryptionAdminService } from './encryption-admin.service';
import {
  EncryptionKeyIdResponseDto,
  toEncryptionKeyIdResponse,
} from './dto/encryption-key.response.dto';
import {
  EncryptionStateResponseDto,
  toEncryptionStateResponse,
} from './dto/encryption-state.response.dto';
import { SetEncryptionEnabledRequestDto } from './dto/set-encryption-enabled.request.dto';
import { EncryptionDisabledException } from './errors/encryption-disabled.exception';
import { EncryptionKeyNotConfiguredException } from './errors/encryption-key-not-configured.exception';
import { EncryptionKeyRingConflictException } from './errors/encryption-key-ring-conflict.exception';

/**
 * Admin surface for the encryption of `onboardings.context`: whether it is on, the key history
 * with derived sweep progress, the switch that turns it on or off, and the one write that rotates
 * the key. Turning encryption on or off, or adding a key, is the only trigger for the background
 * sweep — there is no separate "start" endpoint — so these are the most consequential writes this
 * surface has, guarded like every other admin route.
 */
@ApiTags(API_TAGS.adminEncryption.name)
@Controller('v1/admin/encryption')
export class EncryptionController {
  constructor(private readonly encryptionAdminService: EncryptionAdminService) {}

  @Get()
  @AdminRoute()
  @ApiOperation({
    operationId: 'getEncryptionState',
    summary: 'Read the encryption state and key history',
    description:
      'Whether encryption is turned on, whether this process holds the key-encryption key, every ' +
      'key that has ever protected `onboardings.context` (most recent first, retired ones ' +
      'included — retiring never destroys material), and how many onboardings the background ' +
      'sweep still has to move toward the chosen state. `progress` is derived from the rows ' +
      'themselves, never a stored counter.',
  })
  @ApiOkResponse({
    type: EncryptionStateResponseDto,
    description: 'The chosen state, the key history and the sweep progress toward that state.',
  })
  async getState(): Promise<EncryptionStateResponseDto> {
    return toEncryptionStateResponse(await this.encryptionAdminService.getState());
  }

  @Patch()
  @AdminRoute()
  @ApiOperation({
    operationId: 'setEncryptionEnabled',
    summary: 'Turn encryption on or off',
    description:
      'Turning it on generates a data key, wraps it under the key-encryption key and stores it; ' +
      'turning it off retires the active key. Neither takes effect instantly: for ' +
      '`ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` the previous state keeps governing new writes so ' +
      'every engine process learns of the change first. From the change onward the background ' +
      'sweep moves every stored onboarding toward the chosen state — encrypting plain JSON rows ' +
      'and rows on older keys, or decrypting every row back to plain JSON — with no further ' +
      'operator action. Idempotent: asking for the state that already holds changes nothing. ' +
      'Returns the resulting state, as `GET` would.',
  })
  @ApiOkResponse({
    type: EncryptionStateResponseDto,
    description: 'The state after the change.',
  })
  @ApiErrorResponses(
    VALIDATION_ERROR,
    EncryptionKeyNotConfiguredException,
    EncryptionKeyRingConflictException,
  )
  async setEnabled(
    @Body() body: SetEncryptionEnabledRequestDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<EncryptionStateResponseDto> {
    const view = await this.encryptionAdminService.setEnabled(
      body.enabled,
      resolveOperatorId(request.adminTokenClaims),
    );

    return toEncryptionStateResponse(view);
  }

  @Post('keys')
  @AdminRoute()
  @ApiOperation({
    operationId: 'addEncryptionKey',
    summary: 'Rotate the encryption key',
    description:
      'Generates a new key, wraps it under the key-encryption key, retires the active key and ' +
      'inserts the new one in one transaction, then reloads the local key ring. The new key does ' +
      'not become active immediately: for up to `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` it is ' +
      'reported as `pendingActivation` while the previous key keeps protecting new writes, so ' +
      'every engine process has a chance to learn of it first. Every onboarding still on an older ' +
      "key is re-encrypted onto this one in the background. Returns only the new key's id — " +
      'never its material.',
  })
  @ApiCreatedResponse({
    type: EncryptionKeyIdResponseDto,
    description: 'The newly added key, pending activation.',
  })
  @ApiErrorResponses(
    EncryptionDisabledException,
    EncryptionKeyNotConfiguredException,
    EncryptionKeyRingConflictException,
  )
  async addKey(@Req() request: AdminAuthenticatedRequest): Promise<EncryptionKeyIdResponseDto> {
    const { id } = await this.encryptionAdminService.addKey(
      resolveOperatorId(request.adminTokenClaims),
    );

    return toEncryptionKeyIdResponse(id);
  }
}
