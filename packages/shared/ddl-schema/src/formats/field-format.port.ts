export type WorkflowFieldFormatProvider = 'ajv-formats' | 'custom';

export interface WorkflowFieldFormatDefinition<TName extends string = string> {
  readonly name: TName;
  readonly provider: WorkflowFieldFormatProvider;
  validate?(value: string): boolean;
}
