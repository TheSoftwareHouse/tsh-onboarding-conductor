import { EntityManager, Repository } from 'typeorm';
import { ConnectorsRepository } from './connectors.repository';
import { ConnectorEntity } from './entity/connector.entity';

describe('ConnectorsRepository', () => {
  const createHarness = () => {
    const entityRepositoryMock = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<ConnectorEntity>;
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(entityRepositoryMock),
    } as unknown as EntityManager;

    return { sut: new ConnectorsRepository(), manager, entityRepositoryMock };
  };

  it('reads back the stored row for a connector', async () => {
    const harness = createHarness();

    await harness.sut.find(harness.manager, 'sendgrid_email');

    expect(harness.manager.getRepository).toHaveBeenCalledWith(ConnectorEntity);
    expect(harness.entityRepositoryMock.findOne).toHaveBeenCalledWith({
      where: { id: 'sendgrid_email' },
    });
  });

  it('returns null when no row has been written yet', async () => {
    const harness = createHarness();

    const result = await harness.sut.find(harness.manager, 'sendgrid_email');

    expect(result).toBeNull();
  });

  it('reads back every stored row', async () => {
    const harness = createHarness();

    await harness.sut.findAll(harness.manager);

    expect(harness.entityRepositoryMock.find).toHaveBeenCalledWith();
  });

  it('inserts the settings map as JSON on the first write', async () => {
    const harness = createHarness();

    await harness.sut.upsert(
      harness.manager,
      'sendgrid_email',
      'email_delivery',
      { apiKey: 'sg-test-key' },
      'operator@tsh.io',
    );

    expect(harness.manager.query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = (harness.manager.query as jest.Mock).mock.calls[0];

    expect(sql).toContain('INSERT INTO connectors');
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT pk_connectors DO UPDATE');
    expect(parameters).toEqual([
      'sendgrid_email',
      'email_delivery',
      JSON.stringify({ apiKey: 'sg-test-key' }),
      'operator@tsh.io',
    ]);
  });

  it('overwrites the same connector id on a second write instead of duplicating it', async () => {
    const harness = createHarness();

    await harness.sut.upsert(
      harness.manager,
      'sendgrid_email',
      'email_delivery',
      { apiKey: 'sg-test-key' },
      'operator@tsh.io',
    );
    await harness.sut.upsert(
      harness.manager,
      'sendgrid_email',
      'email_delivery',
      { apiKey: 'sg-other-key' },
      'other-operator@tsh.io',
    );

    expect(harness.manager.query).toHaveBeenCalledTimes(2);
    const [, secondParameters] = (harness.manager.query as jest.Mock).mock.calls[1];

    expect(secondParameters).toEqual([
      'sendgrid_email',
      'email_delivery',
      JSON.stringify({ apiKey: 'sg-other-key' }),
      'other-operator@tsh.io',
    ]);
    const [firstSql] = (harness.manager.query as jest.Mock).mock.calls[0];
    const [secondSql] = (harness.manager.query as jest.Mock).mock.calls[1];
    expect(secondSql).toEqual(firstSql);
  });

  it('accepts a null updatedBy', async () => {
    const harness = createHarness();

    await harness.sut.upsert(
      harness.manager,
      'sendgrid_email',
      'email_delivery',
      { apiKey: 'sg-test-key' },
      null,
    );

    const [, parameters] = (harness.manager.query as jest.Mock).mock.calls[0];
    expect(parameters).toEqual([
      'sendgrid_email',
      'email_delivery',
      JSON.stringify({ apiKey: 'sg-test-key' }),
      null,
    ]);
  });

  it('deletes the stored row for a connector', async () => {
    const harness = createHarness();

    await harness.sut.delete(harness.manager, 'sendgrid_email');

    expect(harness.entityRepositoryMock.delete).toHaveBeenCalledWith({ id: 'sendgrid_email' });
  });

  it('does not throw when deleting a connector with no stored row', async () => {
    const harness = createHarness();

    await expect(harness.sut.delete(harness.manager, 'unknown_type')).resolves.toBeUndefined();
  });
});
