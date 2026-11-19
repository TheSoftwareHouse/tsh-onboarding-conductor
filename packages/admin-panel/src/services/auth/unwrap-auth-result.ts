import { ApiError } from '@/services/api/api-error';

interface AuthResult<T> {
  data: T | null;
  error: { message?: string; status?: number; code?: string } | null;
}

/** better-auth reports a refusal as a value; the panel's data tier reports it as an `ApiError`. */
export async function unwrap<T>(call: Promise<AuthResult<T>>, fallbackMessage: string): Promise<T> {
  const { data, error } = await call;
  if (error || data === null) {
    throw new ApiError(error?.message ?? fallbackMessage, {
      status: error?.status,
      code: error?.code,
    });
  }
  return data;
}
