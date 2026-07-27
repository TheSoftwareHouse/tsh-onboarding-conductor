import { DataSource } from 'typeorm';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  it('delegates the safe audit list request to the audit service with the shared manager', async () => {
    const auditService = {
      list: jest.fn().mockResolvedValue({ items: [] }),
    } as unknown as jest.Mocked<Pick<AuditService, 'list'>>;
    const dataSource = {
      manager: { id: 'manager' },
    } as unknown as DataSource;

    const controller = new AuditController(auditService as unknown as AuditService, dataSource);

    await expect(controller.list()).resolves.toEqual({ items: [] });
    expect(auditService.list).toHaveBeenCalledWith(dataSource.manager);
  });
});
