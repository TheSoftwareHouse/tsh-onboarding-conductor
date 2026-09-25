import { ApiProperty } from '@nestjs/swagger';
import type { EncryptionKeyView } from '../encryption-admin.service';

/** One row of `encryption_keys`, active or historical — never its wrapped material. */
export class EncryptionKeyResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The id written into every envelope this key produced.',
  })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the row was created.' })
  createdAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The operator who turned encryption on or added this key, as the bearer token identified ' +
      'them, or the unknown-actor marker when admin authentication is off. Null only for a row ' +
      'inserted outside the API; every key the engine creates records who asked for it.',
  })
  createdBy!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'When this key becomes (or became) the active one. May be in the future — see ' +
      '`pendingActivation`.',
  })
  activatedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When this key stops (or stopped) protecting new writes — superseded by a rotation or ' +
      'retired by turning encryption off; null while it has not been. May be in the future: ' +
      'the key stays `active` until then.',
  })
  deletedAt!: string | null;

  @ApiProperty({ description: 'Whether this is the key `encrypt` currently uses.' })
  active!: boolean;

  @ApiProperty({
    description:
      'Whether this key has been added but has not activated yet — `activatedAt` is still in ' +
      'the future, during the grace window that gives every replica a chance to learn of it ' +
      'before anything encrypts with it. The previous key remains `active` until then.',
  })
  pendingActivation!: boolean;
}

/** What `POST` returns: the new key's id, and never its material. */
export class EncryptionKeyIdResponseDto {
  @ApiProperty({
    format: 'uuid',
    description:
      "The newly added key's id. Not active immediately — `GET /v1/admin/encryption` reports it " +
      'as `pendingActivation` until `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` has elapsed.',
  })
  id!: string;
}

/** The service carries dates as `Date`; this is the one place they become ISO text. */
export function toEncryptionKeyResponse(view: EncryptionKeyView): EncryptionKeyResponseDto {
  return {
    id: view.id,
    createdAt: view.createdAt.toISOString(),
    createdBy: view.createdBy,
    activatedAt: view.activatedAt.toISOString(),
    deletedAt: view.deletedAt === null ? null : view.deletedAt.toISOString(),
    active: view.active,
    pendingActivation: view.pendingActivation,
  };
}

export function toEncryptionKeyIdResponse(id: string): EncryptionKeyIdResponseDto {
  return { id };
}
