import { IsIn } from 'class-validator';

export type ManualReviewAction = 'approve' | 'reject' | 'return';

export class ManualReviewDto {
  @IsIn(['approve', 'reject', 'return'])
  action!: ManualReviewAction;
}
