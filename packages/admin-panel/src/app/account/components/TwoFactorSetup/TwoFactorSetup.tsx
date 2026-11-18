import type { ReactElement } from 'react';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { QRCodeSVG } from 'qrcode.react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button/Button';
import { SecretFormField } from '@/components/ui/form/SecretFormField/SecretFormField';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { Typography } from '@/components/ui/Typography/Typography';
import { authClient } from '@/services/auth/auth-client';

export interface TwoFactorSetupProps {
  /** Called after the operator has seen the backup codes and continued. */
  onDone: () => void;
  /** Abandons the setup before it is verified; two-factor stays off. */
  onCancel: () => void;
}

interface Enrollment {
  totpURI: string;
  backupCodes: string[];
}

const passwordSchema = z.object({ password: z.string().min(1, 'Enter your password.') });
const codeSchema = z.object({ code: z.string().trim().min(1, 'Enter the code.') });

type PasswordValues = z.infer<typeof passwordSchema>;
type CodeValues = z.infer<typeof codeSchema>;

function readSecret(totpURI: string): string {
  return new URL(totpURI).searchParams.get('secret') ?? '';
}

function PasswordStep({
  onEnrolled,
}: {
  onEnrolled: (enrollment: Enrollment) => void;
}): ReactElement {
  const [failure, setFailure] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<PasswordValues>({
    defaultValues: { password: '' },
    resolver: zodResolver(passwordSchema),
  });

  const submit = handleSubmit(async ({ password }) => {
    setFailure(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data || !('totpURI' in data)) {
      setFailure(error?.message ?? 'Two-factor setup could not be started.');
      return;
    }
    onEnrolled(data);
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <SecretFormField
        autoComplete="current-password"
        control={control}
        name="password"
        controlId="two-factor-setup-password"
        label="Password"
        revealLabel="password"
        isRequired
      />
      {failure ? (
        <Typography variant="body-sm" className="text-tsh-red" role="alert">
          {failure}
        </Typography>
      ) : null}
      <Button type="submit" variant="primary" size="xl" disabled={isSubmitting}>
        {isSubmitting ? 'Continuing…' : 'Continue'}
      </Button>
    </form>
  );
}

function VerifyStep({
  totpURI,
  onVerified,
}: {
  totpURI: string;
  onVerified: () => void;
}): ReactElement {
  const [failure, setFailure] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CodeValues>({ defaultValues: { code: '' }, resolver: zodResolver(codeSchema) });

  const submit = handleSubmit(async ({ code }) => {
    setFailure(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setFailure(error.message ?? 'The code was not accepted.');
      return;
    }
    onVerified();
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        <QRCodeSVG value={totpURI} size={176} title="Authenticator setup QR code" />
        <Typography variant="meta" className="text-fg-3">
          Can&#8217;t scan it? Enter this secret in your app:
        </Typography>
        <Typography variant="mono" as="code" className="break-all text-fg-1">
          {readSecret(totpURI)}
        </Typography>
      </div>
      <TextFormField
        control={control}
        name="code"
        controlId="two-factor-setup-code"
        label="Code from your app"
        autoComplete="one-time-code"
        font="mono"
        isRequired
      />
      {failure ? (
        <Typography variant="body-sm" className="text-tsh-red" role="alert">
          {failure}
        </Typography>
      ) : null}
      <Button type="submit" variant="primary" size="xl" disabled={isSubmitting}>
        {isSubmitting ? 'Verifying…' : 'Verify and enable'}
      </Button>
    </form>
  );
}

/**
 * Enrolls the signed-in operator in TOTP: password, QR code, first code, then the backup codes,
 * which are shown once and never again.
 */
export function TwoFactorSetup({ onDone, onCancel }: TwoFactorSetupProps): ReactElement {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [isVerified, setIsVerified] = useState(false);

  const description = !enrollment
    ? 'Confirm your password to start.'
    : isVerified
      ? 'Save these backup codes now. Each works once, and they are not shown again.'
      : 'Scan the QR code with an authenticator app, then enter the code it shows.';

  return (
    <div className="flex max-w-110 flex-col gap-6">
      <Typography variant="body-md" className="text-fg-3">
        {description}
      </Typography>
      {!enrollment ? <PasswordStep onEnrolled={setEnrollment} /> : null}
      {enrollment && !isVerified ? (
        <VerifyStep
          totpURI={enrollment.totpURI}
          onVerified={() => {
            showSuccessToast('Two-factor authentication enabled');
            setIsVerified(true);
          }}
        />
      ) : null}
      {enrollment && isVerified ? (
        <div className="flex flex-col gap-4">
          <ul className="grid grid-cols-2 gap-2" aria-label="Backup codes">
            {enrollment.backupCodes.map((code) => (
              <Typography key={code} as="li" variant="mono" className="text-fg-1">
                {code}
              </Typography>
            ))}
          </ul>
          <Button variant="primary" size="xl" onClick={onDone}>
            I have saved my backup codes
          </Button>
        </div>
      ) : null}
      {!isVerified ? (
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
