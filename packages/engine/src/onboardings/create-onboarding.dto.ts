import { IsNotEmpty, IsString } from 'class-validator';

export class CreateOnboardingDto {
  @IsString()
  @IsNotEmpty()
  flowId!: string;
}
