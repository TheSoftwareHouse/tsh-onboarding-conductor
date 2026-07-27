import { IsIn } from 'class-validator';

export type ManualReviewAction = 'approve' | 'reject' | 'invalid';

export class ManualReviewDto {
  @IsIn(['approve', 'reject', 'invalid'])
  action!: ManualReviewAction;
}
