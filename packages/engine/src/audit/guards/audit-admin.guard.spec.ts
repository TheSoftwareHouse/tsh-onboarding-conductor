import { ExecutionContext } from '@nestjs/common';
import { AuditAdminGuard } from './audit-admin.guard';
import { AuditUnauthorizedException } from '../errors/audit-unauthorized.exception';
import { AuditForbiddenScopeException } from '../errors/audit-forbidden-scope.exception';

describe('AuditAdminGuard', () => {
  const createContext = (authorization?: string) => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    } as unknown as ExecutionContext;

    return context;
  };

  it('throws unauthorized for missing authorization header', async () => {
    const guard = new AuditAdminGuard({
      get: (key: string) =>
        ({ AUDIT_ADMIN_API_KEY: 'admin-key', AUDIT_NON_ADMIN_API_KEY: 'non-admin-key' })[key] ??
        null,
    } as never);

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      AuditUnauthorizedException,
    );
  });

  it('throws unauthorized for malformed authorization header', async () => {
    const guard = new AuditAdminGuard({
      get: (key: string) =>
        ({ AUDIT_ADMIN_API_KEY: 'admin-key', AUDIT_NON_ADMIN_API_KEY: 'non-admin-key' })[key] ??
        null,
    } as never);

    await expect(guard.canActivate(createContext('Basic abc'))).rejects.toBeInstanceOf(
      AuditUnauthorizedException,
    );
  });

  it('throws forbidden scope for a valid non-admin credential', async () => {
    const guard = new AuditAdminGuard({
      get: (key: string) =>
        ({ AUDIT_ADMIN_API_KEY: 'admin-key', AUDIT_NON_ADMIN_API_KEY: 'non-admin-key' })[key] ??
        null,
    } as never);

    await expect(guard.canActivate(createContext('Bearer non-admin-key'))).rejects.toBeInstanceOf(
      AuditForbiddenScopeException,
    );
  });

  it('allows the admin credential', async () => {
    const guard = new AuditAdminGuard({
      get: (key: string) =>
        ({ AUDIT_ADMIN_API_KEY: 'admin-key', AUDIT_NON_ADMIN_API_KEY: 'non-admin-key' })[key] ??
        null,
    } as never);

    await expect(guard.canActivate(createContext('Bearer admin-key'))).resolves.toBe(true);
  });
});
