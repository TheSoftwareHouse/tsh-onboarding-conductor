import type { ReactElement } from 'react';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button/Button';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { Typography } from '@/components/ui/Typography/Typography';
import { authClient } from '@/services/auth/auth-client';
import { AuthShell } from '../AuthShell/AuthShell';

export interface TwoFactorChallengeProps {
  /** Called once the code is accepted; the session then exists. */
  onVerified: () => void;
  /** Abandons the challenge and returns to the sign-in form. */
  onCancel: () => void;
}

const challengeSchema = z.object({
  code: z.string().trim().min(1, 'Enter the code.'),
  trustDevice: z.boolean(),
});

type ChallengeValues = z.infer<typeof challengeSchema>;

/** Second sign-in step: an authenticator code, or a backup code, optionally remembering the device. */
export function TwoFactorChallenge({
  onVerified,
  onCancel,
}: TwoFactorChallengeProps): ReactElement {
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    control,
    register,
    reset,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ChallengeValues>({
    defaultValues: { code: '', trustDevice: false },
    resolver: zodResolver(challengeSchema),
  });

  const submit = handleSubmit(async ({ code, trustDevice }) => {
    setFailure(null);
    const verify = useBackupCode
      ? authClient.twoFactor.verifyBackupCode
      : authClient.twoFactor.verifyTotp;
    const { error } = await verify({ code, trustDevice });
    if (error) {
      setFailure(error.message ?? 'The code was not accepted.');
      return;
    }
    onVerified();
  });

  const toggleMode = (): void => {
    setUseBackupCode((previous) => !previous);
    setFailure(null);
    reset({ code: '', trustDevice: false });
  };

  return (
    <AuthShell>
      <div className="flex w-full max-w-110 flex-col gap-8 border border-border-hair bg-bg-page p-10">
        <div className="flex flex-col gap-3">
          <Typography variant="h5" as="h1">
            Two-factor verification
          </Typography>
          <Typography variant="body-md" className="text-fg-3">
            {useBackupCode
              ? 'Enter one of your backup codes. Each works once.'
              : 'Enter the code from your authenticator app.'}
          </Typography>
        </div>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <TextFormField
            control={control}
            name="code"
            controlId="two-factor-code"
            label={useBackupCode ? 'Backup code' : 'Authenticator code'}
            autoComplete="one-time-code"
            font="mono"
            isRequired
          />
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="size-4 accent-tsh-black"
              {...register('trustDevice')}
            />
            <Typography variant="body-sm" as="span">
              Trust this device
            </Typography>
          </label>
          {failure ? (
            <Typography variant="body-sm" className="text-tsh-red" role="alert">
              {failure}
            </Typography>
          ) : null}
          <Button type="submit" variant="primary" size="xl" disabled={isSubmitting}>
            {isSubmitting ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
        <div className="flex gap-3">
          <Button variant="quiet" onClick={toggleMode}>
            {useBackupCode ? 'Use authenticator code' : 'Use a backup code'}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            Back to sign in
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
