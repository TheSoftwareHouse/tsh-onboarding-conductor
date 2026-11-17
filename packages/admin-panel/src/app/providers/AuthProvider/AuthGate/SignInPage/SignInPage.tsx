import type { ReactElement } from 'react';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { authClient } from '@/services/auth/auth-client';
import {
  isMicrosoftSignInEnabled,
  isSuperadminTwoFactorRequired,
} from '@/services/auth/auth-config';
import { isSuperadmin } from '@/api/platform/platform';
import { Button } from '@/components/ui/Button/Button';
import { SecretFormField } from '@/components/ui/form/SecretFormField/SecretFormField';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { ArrowForward } from '@/components/ui/icons';
import { showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { Typography } from '@/components/ui/Typography/Typography';
import { AuthShell } from '../AuthShell/AuthShell';
import { RESET_PASSWORD_PATH } from '../ResetPassword/ResetPassword';

export interface SignInPageProps {
  /** Failure reported for an earlier attempt. */
  error?: string | null;
  /** The password was right and a second factor is required. */
  onTwoFactorRequired?: () => void;
  /** A credential sign-in finished without a second factor, so the account still has to enroll. */
  onTwoFactorSetupRequired?: () => void;
  /** A superadmin signed in without a second factor while the deployment makes it optional. */
  onTwoFactorSetupOffered?: () => void;
}

const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
const forgotSchema = z.object({ email: signInSchema.shape.email });

type SignInValues = z.infer<typeof signInSchema>;
type ForgotValues = z.infer<typeof forgotSchema>;

function SignInForm({
  onForgot,
  onTwoFactorRequired,
  onTwoFactorSetupRequired,
  onTwoFactorSetupOffered,
  onFailure,
}: {
  onForgot: () => void;
  onTwoFactorRequired?: () => void;
  onTwoFactorSetupRequired?: () => void;
  onTwoFactorSetupOffered?: () => void;
  onFailure: (message: string | null) => void;
}): ReactElement {
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SignInValues>({
    defaultValues: { email: '', password: '' },
    resolver: zodResolver(signInSchema),
  });

  const submit = handleSubmit(async (values) => {
    onFailure(null);
    const { data, error } = await authClient.signIn.email(values);
    if (error) {
      onFailure(error.message ?? 'Sign-in failed.');
      return;
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      onTwoFactorRequired?.();
      return;
    }
    // An email sign-in is always a credential account, which must carry 2FA unless the
    // deployment made it optional for superadmins.
    if (!data?.user.twoFactorEnabled) {
      if (isSuperadmin(data.user) && !isSuperadminTwoFactorRequired()) {
        onTwoFactorSetupOffered?.();
      } else {
        onTwoFactorSetupRequired?.();
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextFormField
        control={control}
        name="email"
        controlId="sign-in-email"
        label="Email"
        autoComplete="username"
        isRequired
      />
      <SecretFormField
        autoComplete="current-password"
        control={control}
        name="password"
        controlId="sign-in-password"
        label="Password"
        revealLabel="password"
        isRequired
      />
      <Button type="submit" variant="primary" size="xl" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <Button variant="quiet" onClick={onForgot}>
        Forgot password
      </Button>
    </form>
  );
}

function ForgotPasswordForm({
  onBack,
  onFailure,
}: {
  onBack: () => void;
  onFailure: (message: string | null) => void;
}): ReactElement {
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ForgotValues>({
    defaultValues: { email: '' },
    resolver: zodResolver(forgotSchema),
  });

  const submit = handleSubmit(async ({ email }) => {
    onFailure(null);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
    });
    if (error) {
      onFailure(error.message ?? 'The reset link could not be requested.');
      return;
    }
    showSuccessToast('If the address has an account, a reset link is on its way');
    onBack();
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextFormField
        control={control}
        name="email"
        controlId="forgot-password-email"
        label="Email"
        autoComplete="username"
        isRequired
      />
      <Button type="submit" variant="primary" size="xl" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send reset link'}
      </Button>
      <Button variant="quiet" onClick={onBack}>
        Back to sign in
      </Button>
    </form>
  );
}

/** Sign-in screen shown in place of the panel until a session is present. */
export function SignInPage({
  error = null,
  onTwoFactorRequired,
  onTwoFactorSetupRequired,
  onTwoFactorSetupOffered,
}: SignInPageProps): ReactElement {
  const [isForgotten, setIsForgotten] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const visibleError = failure ?? error;

  const handleMicrosoftSignIn = (): void => {
    setFailure(null);

    authClient.signIn
      .social({ provider: 'microsoft', callbackURL: window.location.href })
      .catch((cause: unknown) => {
        setFailure(cause instanceof Error ? cause.message : 'Sign-in could not be started.');
      });
  };

  const toggleForgotten = (): void => {
    setFailure(null);
    setIsForgotten((previous) => !previous);
  };

  return (
    <AuthShell>
      <div className="flex w-full max-w-110 flex-col gap-8 border border-border-hair bg-bg-page p-10">
        <div className="flex flex-col gap-3">
          <Typography variant="h5" as="h1">
            Admin onboardings
          </Typography>
          <Typography variant="body-md" className="text-fg-3">
            {isForgotten
              ? 'Enter your email and we will send you a link to choose a new password.'
              : 'Sign in to continue.'}
          </Typography>
        </div>
        {isForgotten ? (
          <ForgotPasswordForm onBack={toggleForgotten} onFailure={setFailure} />
        ) : (
          <SignInForm
            onForgot={toggleForgotten}
            onTwoFactorRequired={onTwoFactorRequired}
            onTwoFactorSetupRequired={onTwoFactorSetupRequired}
            onTwoFactorSetupOffered={onTwoFactorSetupOffered}
            onFailure={setFailure}
          />
        )}
        {!isForgotten && isMicrosoftSignInEnabled() ? (
          <Button
            variant="outline"
            size="xl"
            className="w-full justify-between"
            onClick={handleMicrosoftSignIn}
          >
            Sign in with Microsoft
            <ArrowForward aria-hidden className="size-5" />
          </Button>
        ) : null}
        {visibleError ? (
          <Typography variant="body-sm" className="text-tsh-red" role="alert">
            {visibleError}
          </Typography>
        ) : null}
      </div>
    </AuthShell>
  );
}
