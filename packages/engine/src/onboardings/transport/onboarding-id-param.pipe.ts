import { Injectable, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { OnboardingNotFoundException } from '../errors/onboarding-not-found.exception';

@Injectable()
export class OnboardingIdParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUUID(value)) {
      throw new OnboardingNotFoundException();
    }

    return value;
  }
}
