import type { ReactElement } from 'react';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button/Button';
import { SecretFormField } from '@/components/ui/form/SecretFormField/SecretFormField';
import { showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { Typography } from '@/components/ui/Typography/Typography';
import { authClient } from '@/services/auth/auth-client';
import { AuthShell } from '../AuthShell/AuthShell';

/** The path the mailed reset link lands on; the engine appends `?token=…`. */
export const RESET_PASSWORD_PATH = '/reset-password';

const MIN_PASSWORD_LENGTH = 8;

const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/** Sets a new password from the mailed link. Reachable signed out, so it renders outside the session check. */
export function ResetPassword(): ReactElement {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const linkIsInvalid = token === null || params.has('error');
  const [failure, setFailure] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ResetPasswordValues>({
    defaultValues: { newPassword: '', confirmPassword: '' },
    resolver: zodResolver(resetPasswordSchema),
  });

  const submit = handleSubmit(async ({ newPassword }) => {
    setFailure(null);
    const { error } = await authClient.resetPassword({ newPassword, token: token ?? '' });
    if (error) {
      setFailure(error.message ?? 'The password could not be changed.');
      return;
    }
    showSuccessToast('Password changed');
    setIsDone(true);
  });

  return (
    <AuthShell>
      <div className="flex w-full max-w-110 flex-col gap-8 border border-border-hair bg-bg-page p-10">
        <Typography variant="h5" as="h1">
          Choose a new password
        </Typography>
        {linkIsInvalid ? (
          <Typography variant="body-sm" className="text-tsh-red" role="alert">
            This reset link is invalid or has expired. Request a new one from the sign-in page.
          </Typography>
        ) : isDone ? (
          <Typography variant="body-md" className="text-fg-3">
            Your password is changed. Sign in with it to continue.
          </Typography>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <SecretFormField
              autoComplete="new-password"
              control={control}
              name="newPassword"
              controlId="reset-new-password"
              label="New password"
              revealLabel="new password"
              isRequired
            />
            <SecretFormField
              autoComplete="new-password"
              control={control}
              name="confirmPassword"
              controlId="reset-confirm-password"
              label="Confirm password"
              revealLabel="confirmed password"
              isRequired
            />
            {failure ? (
              <Typography variant="body-sm" className="text-tsh-red" role="alert">
                {failure}
              </Typography>
            ) : null}
            <Button type="submit" variant="primary" size="xl" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        )}
        <Button as="a" href="/" variant="outline">
          Back to sign in
        </Button>
      </div>
    </AuthShell>
  );
}
