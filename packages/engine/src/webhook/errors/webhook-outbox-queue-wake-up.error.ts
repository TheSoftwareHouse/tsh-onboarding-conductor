export class WebhookOutboxQueueWakeUpError extends Error {
  constructor(
    readonly outboxId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'WebhookOutboxQueueWakeUpError';

    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
