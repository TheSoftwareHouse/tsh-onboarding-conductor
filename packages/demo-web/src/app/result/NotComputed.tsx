export function NotComputed({ what }: { what?: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid="not-computed">
      Not computed{what ? `: ${what}` : ''}
    </p>
  );
}
