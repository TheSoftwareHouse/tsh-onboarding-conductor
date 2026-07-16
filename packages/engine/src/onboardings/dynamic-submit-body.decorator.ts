import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Extract the parsed body before fixed-class DTO validation can whitelist configured keys.
export const DynamicSubmitBody = createParamDecorator(
  (_data: unknown, context: ExecutionContext): unknown => {
    const request = context.switchToHttp().getRequest<{ body: unknown }>();
    return request.body;
  },
);
