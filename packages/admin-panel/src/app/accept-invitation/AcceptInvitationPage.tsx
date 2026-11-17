import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import { z } from 'zod';
import { organizationMutations } from '@/api/organization/organization-mutations';
import { AuthShell } from '@/app/providers/AuthProvider/AuthGate/AuthShell/AuthShell';
import { Button } from '@/components/ui/Button/Button';
import { SecretFormField } from '@/components/ui/form/SecretFormField/SecretFormField';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { Typography } from '@/components/ui/Typography/Typography';
import { ADMIN_ROUTES } from '@/constants/routes';
import { authClient } from '@/services/auth/auth-client';

const MIN_PASSWORD_LENGTH = 8;

const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.'),
  email: z.string().trim().email('Enter the email address the invitation was sent to.'),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
});

type SignUpValues = z.infer<typeof signUpSchema>;

/**
 * A full load of the panel, not a client-side navigation: the session now belongs to a new
 * organization, so every cached read is stale. The panel's gate then sends an account without
 * two-factor authentication to enrollment on its first request.
 */
function continueToPanel(): void {
  window.location.assign(ADMIN_ROUTES.organization.root);
}

function SignedInInvitation({ invitationId }: { invitationId: string }): ReactElement {
  const accept = useMutation(organizationMutations.acceptInvitation());

  const handleAccept = (): void => {
    accept.mutate(invitationId, {
      onSuccess: () => {
        showSuccessToast('Invitation accepted');
        continueToPanel();
      },
      onError: (error) => showErrorToast('Invitation not accepted', error.message),
    });
  };

  return (
    <>
      <Typography variant="body-md" className="text-fg-3">
        You are signed in. Accept the invitation to join the organization.
      </Typography>
      <Button variant="primary" size="xl" disabled={accept.isPending} onClick={handleAccept}>
        {accept.isPending ? 'Accepting…' : 'Accept invitation'}
      </Button>
    </>
  );
}

function SignUpInvitation({ invitationId }: { invitationId: string }): ReactElement {
  const signUp = useMutation(organizationMutations.signUpInvitee());
  const accept = useMutation(organizationMutations.acceptInvitation());
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SignUpValues>({
    defaultValues: { name: '', email: '', password: '' },
    resolver: zodResolver(signUpSchema),
  });

  const submit = handleSubmit(async (values) => {
    try {
      await signUp.mutateAsync(values);
      await accept.mutateAsync(invitationId);
    } catch (error) {
      showErrorToast(
        'Invitation not accepted',
        error instanceof Error ? error.message : 'Try again.',
      );
      return;
    }
    showSuccessToast('Account created');
    continueToPanel();
  });

  return (
    <>
      <Typography variant="body-md" className="text-fg-3">
        Create your account to join. Use the email address the invitation was sent to.
      </Typography>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextFormField
          control={control}
          name="name"
          controlId="accept-invitation-name"
          label="Name"
          autoComplete="name"
          isRequired
        />
        <TextFormField
          control={control}
          name="email"
          controlId="accept-invitation-email"
          label="Email"
          autoComplete="username"
          isRequired
        />
        <SecretFormField
          autoComplete="new-password"
          control={control}
          name="password"
          controlId="accept-invitation-password"
          label="Password"
          revealLabel="password"
          isRequired
        />
        <Button type="submit" variant="primary" size="xl" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account and join'}
        </Button>
      </form>
      <Button as="a" href="/" variant="quiet">
        I already have an account
      </Button>
    </>
  );
}

/**
 * The page the invitation email links to. It sits outside the sign-in gate: a signed-in user
 * accepts directly, anyone else creates an account first (the engine only allows that for an
 * invited address) and accepts straight after.
 */
export function AcceptInvitationPage(): ReactElement {
  const { invitationId = '' } = useParams();
  const { data: session, isPending } = authClient.useSession();

  return (
    <AuthShell>
      <div className="flex w-full max-w-110 flex-col gap-8 border border-border-hair bg-bg-page p-10">
        <Typography variant="h5" as="h1">
          Join the organization
        </Typography>
        {isPending ? (
          <Typography variant="body-md" className="text-fg-3" role="status">
            Loading…
          </Typography>
        ) : session ? (
          <SignedInInvitation invitationId={invitationId} />
        ) : (
          <SignUpInvitation invitationId={invitationId} />
        )}
      </div>
    </AuthShell>
  );
}
