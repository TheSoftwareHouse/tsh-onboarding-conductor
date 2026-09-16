import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'], description: 'Always `ok`: the process is up and answering HTTP.' })
  status!: 'ok';
}
