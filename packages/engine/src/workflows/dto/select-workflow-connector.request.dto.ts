import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, Validate } from 'class-validator';
import { CONNECTOR_ID_PATTERN } from '../../connectors/ports/connector-execution.port';
import {
  CONNECTOR_SELECTION_SCOPES,
  type ConnectorSelectionScope,
} from '../domain/connector-selection';
import { ConnectorSelectionVersionConstraint } from './clear-workflow-connector.query.dto';
import { MAX_WORKFLOW_VERSION } from './workflow-version.params.dto';

/** `PUT` body: the registered adapter the step's connector slot should run on the chosen versions. */
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

  @ApiProperty({
    enum: CONNECTOR_SELECTION_SCOPES,
    description:
      '`version` binds the one published version named by `version`; `all` binds every ' +
      'non-retired published version that declares the step with a single connector.',
    example: 'version',
  })
  @IsIn(CONNECTOR_SELECTION_SCOPES)
  scope!: ConnectorSelectionScope;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_WORKFLOW_VERSION,
    description:
      'The published version to bind. Required when `scope` is `version`, rejected otherwise.',
    example: 1,
  })
  @Validate(ConnectorSelectionVersionConstraint)
  version?: number;
}
