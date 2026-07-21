import { BadRequestException } from '@nestjs/common';
import { OnboardingProblemDocument } from '@tsh/shared';

export class InvalidStepDataProblemException extends BadRequestException {
  constructor(problem: OnboardingProblemDocument) {
    super(problem);
  }
}
