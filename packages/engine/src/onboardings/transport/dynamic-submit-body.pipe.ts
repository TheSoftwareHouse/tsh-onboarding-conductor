import { Injectable, PipeTransform } from '@nestjs/common';
import { DynamicSubmitBody } from '../dto/submit-onboarding.dto';

@Injectable()
export class DynamicSubmitBodyPipe implements PipeTransform<unknown, DynamicSubmitBody> {
  // Runtime workflow evaluation owns validation/classification for all JSON value shapes.
  transform(value: unknown): DynamicSubmitBody {
    return value;
  }
}
