import { DataSource } from 'typeorm';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  it('delegates the validated audit list request to the audit service with the shared manager', async () => {
    const auditService = {
      list: jest.fn().mockResolvedValue({
        items: [],
        meta: {
          pagination: {
            page: 2,
            limit: 5,
            total: 0,
            totalPages: 0,
          },
        },
      }),
    } as unknown as jest.Mocked<Pick<AuditService, 'list'>>;
    const dataSource = {
      manager: { id: 'manager' },
    } as unknown as DataSource;

    const controller = new AuditController(auditService as unknown as AuditService, dataSource);
    const query = {
      page: 2,
      limit: 5,
      actorType: 'system',
      action: 'onboarding.state_transition',
    } as never;

    await expect(controller.list(query)).resolves.toEqual({
      items: [],
      meta: {
        pagination: {
          page: 2,
          limit: 5,
          total: 0,
          totalPages: 0,
        },
      },
    });
    expect(auditService.list).toHaveBeenCalledWith(dataSource.manager, query);
  });
});
