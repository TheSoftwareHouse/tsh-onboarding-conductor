import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateOnboardingDto {
  @ApiProperty({
    description:
      'Id of a published workflow. The onboarding starts on its latest published revision and ' +
      'stays pinned to that revision for its whole life.',
    example: 'eu-b2c-individual-kyc-eea',
  })
  @IsString()
  @IsNotEmpty()
  workflowId!: string;
}
