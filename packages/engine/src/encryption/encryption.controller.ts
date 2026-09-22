import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
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
import { SetEncryptionRotationRequestDto } from './dto/set-encryption-rotation.request.dto';
import { EncryptionDisabledException } from './errors/encryption-disabled.exception';
import { EncryptionKeyNotConfiguredException } from './errors/encryption-key-not-configured.exception';
import { EncryptionKeyRingConflictException } from './errors/encryption-key-ring-conflict.exception';

/**
 * Admin surface for the encryption of `onboardings.context`: whether it is on, the key history
 * with derived sweep progress, the switch that turns it on or off, how often the engine rotates
 * the key on its own, and the one write that rotates it now. Turning encryption on or off, or adding a key, is the only trigger for the background
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
      'included — retiring never destroys material), how often the key rotates on its own and ' +
      'when it next does, and how many onboardings the background sweep still has to move toward ' +
      'the chosen state. `progress` and `rotation.nextRotationAt` are both derived from the rows ' +
      'themselves, never stored counters.',
  })
  @ApiOkResponse({
    type: EncryptionStateResponseDto,
    description:
      'The chosen state, the key history, the rotation schedule and the sweep progress toward ' +
      'that state.',
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
      'sweep moves every stored onboarding toward the chosen state — encrypting plain JSON rows, ' +
      'or decrypting every row back to plain JSON — with no further ' +
      'operator action. Idempotent: asking for the state that already holds changes nothing. ' +
      'Returns the resulting state, as `GET` would.',
  })
  @ApiOkResponse({
    type: EncryptionStateResponseDto,
    description: 'The state after the change.',
  })
  @ApiErrorResponses(VALIDATION_ERROR, EncryptionKeyNotConfiguredException)
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

  @Patch('rotation')
  @AdminRoute()
  @ApiOperation({
    operationId: 'setEncryptionKeyRotation',
    summary: 'Choose how often the key rotates on its own',
    description:
      'Stores the automatic-rotation schedule on the active key, or clears it with `null`. The ' +
      "next rotation is always the active key's creation plus this interval, never this " +
      "request's own instant, so choosing an interval shorter than the active key's age makes " +
      'it due immediately and the engine rotates on its next check ' +
      '(`ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS`). A rotation — scheduled or asked for with ' +
      '`POST /keys` — creates a key that carries the same schedule forward and restarts the ' +
      'countdown from its own creation. Turning encryption on schedules no rotation at all. ' +
      'Idempotent: choosing the interval already in force changes nothing. Returns the resulting ' +
      'state, as `GET` would.',
  })
  @ApiOkResponse({
    type: EncryptionStateResponseDto,
    description: 'The state after the change, including the new `rotation.nextRotationAt`.',
  })
  @ApiErrorResponses(VALIDATION_ERROR, EncryptionDisabledException)
  async setRotation(
    @Body() body: SetEncryptionRotationRequestDto,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<EncryptionStateResponseDto> {
    const view = await this.encryptionAdminService.setRotationInterval(
      body.interval,
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
      'every engine process has a chance to learn of it first. Stored onboardings are not ' +
      'rewritten: rotation is lazy, so a row keeps naming the key it was written under and moves ' +
      'onto this one only the next time it is written. The new key carries the automatic-' +
      'rotation schedule the superseded one had, and the countdown to the next scheduled rotation ' +
      "restarts from this key's creation. Returns only the new key's id — never its material.",
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

  @Post('reencryption')
  @AdminRoute()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'requestEncryptionReencryption',
    summary: 'Re-encrypt every stored onboarding onto the active key',
    description:
      'Records a standing request for the background sweep to move every stored onboarding onto ' +
      'the active key, including rows still naming a superseded one. Rotation alone does not do ' +
      'this: it changes which key new writes use and leaves stored rows where they are until ' +
      'something rewrites them. This is the answer to a data key whose material leaked, where ' +
      'those rows must stop naming it without waiting. The work is a batch per sweep tick, each ' +
      'row decrypted and re-encrypted inside one transaction, so no row is ever stored as plain ' +
      'JSON on the way across — unlike turning encryption off and on again, which writes every ' +
      'onboarding to disk unencrypted in between. `progress.pending` counts rows not yet on the ' +
      'active key for as long as the request stands, and the sweep clears it once none are left. ' +
      'Idempotent: asking again while one stands re-stamps it and changes nothing else.',
  })
  @ApiOkResponse({
    type: EncryptionStateResponseDto,
    description: 'The state with the request recorded.',
  })
  @ApiErrorResponses(EncryptionDisabledException, EncryptionKeyNotConfiguredException)
  async requestReencryption(
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<EncryptionStateResponseDto> {
    const view = await this.encryptionAdminService.requestReencryption(
      resolveOperatorId(request.adminTokenClaims),
    );

    return toEncryptionStateResponse(view);
  }
}
