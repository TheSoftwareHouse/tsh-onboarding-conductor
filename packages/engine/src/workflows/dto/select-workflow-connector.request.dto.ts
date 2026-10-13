import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { CONNECTOR_ID_PATTERN } from '../../connectors/ports/connector-execution.port';

/** `PUT` body: the registered adapter the step's connector slot should run from now on. */
export class SelectWorkflowConnectorRequestDto {
  @ApiProperty({
    description:
      "The id of a registered connector adapter that can serve the step's connector slot.",
    example: 'veriff_kyc',
    maxLength: 64,
  })
  @IsString()
  @MaxLength(64)
  @Matches(CONNECTOR_ID_PATTERN)
  connectorId!: string;
}
