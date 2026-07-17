import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DynamicSubmitBody } from '../dto/submit-onboarding.dto';

const invalidStepData = (): BadRequestException =>
  new BadRequestException({
    code: 'INVALID_STEP_DATA',
    message: 'INVALID_STEP_DATA',
  });

@Injectable()
export class DynamicSubmitBodyPipe implements PipeTransform<unknown, DynamicSubmitBody> {
  // Transport validation is limited to a plain JSON object; runtime validation owns fields.
  transform(value: unknown): DynamicSubmitBody {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw invalidStepData();
    }

    return value as DynamicSubmitBody;
  }
}
