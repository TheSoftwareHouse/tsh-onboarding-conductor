import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, Validate, ValidatorConstraint, type ValidationArguments } from 'class-validator';
import type { ValidatorConstraintInterface } from 'class-validator';
import {
  ALL_SELECTION_SCOPE,
  CONNECTOR_SELECTION_SCOPES,
  VERSION_SELECTION_SCOPE,
  type ConnectorSelectionScope,
} from '../domain/connector-selection';
import { MAX_WORKFLOW_VERSION } from './workflow-version.params.dto';

/** `version` is a positive integer exactly when `scope` is `version`, and absent otherwise. */
@ValidatorConstraint({ name: 'connectorSelectionVersion', async: false })
export class ConnectorSelectionVersionConstraint implements ValidatorConstraintInterface {
  validate(version: unknown, { object }: ValidationArguments): boolean {
    const { scope } = object as { scope?: unknown };

    if (scope === VERSION_SELECTION_SCOPE) {
      return (
        Number.isInteger(version) &&
        (version as number) >= 1 &&
        (version as number) <= MAX_WORKFLOW_VERSION
      );
    }

    return scope === ALL_SELECTION_SCOPE ? version === undefined : true;
  }

  defaultMessage(): string {
    return '`version` must be a positive integer when `scope` is `version`, and omitted when it is `all`.';
  }
}

/** `DELETE` query: which versions' bindings the step's connector slot is cleared on. */
export class ClearWorkflowConnectorQueryDto {
  @ApiProperty({
    enum: CONNECTOR_SELECTION_SCOPES,
    description:
      '`version` clears the binding on the one published version named by `version`; `all` clears ' +
      'it on every non-retired published version that declares the step.',
    example: 'version',
  })
  @IsIn(CONNECTOR_SELECTION_SCOPES)
  scope!: ConnectorSelectionScope;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_WORKFLOW_VERSION,
    description:
      'The published version to clear. Required when `scope` is `version`, rejected otherwise.',
    example: 1,
  })
  @Type(() => Number)
  @Validate(ConnectorSelectionVersionConstraint)
  version?: number;
}
