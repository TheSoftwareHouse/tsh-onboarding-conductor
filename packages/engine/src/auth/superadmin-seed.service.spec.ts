import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuperadminSeedService } from './superadmin-seed.service';

const EMAIL = 'root@example.test';
const PASSWORD = 'correct-horse-battery-staple';
const USER_ID = 'user-1';
const ORGANIZATION_ID = 'org-1';
const CONFIG = { AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD };

/** What the auth schema holds, answered by the SQL each query asks. */
interface Store {
  superadminExists: boolean;
  emailExists: boolean | boolean[];
  superadminUserId: string | null;
  isMember: boolean | boolean[];
}

describe('SuperadminSeedService', () => {
  const createUser = jest.fn();
  const addMember = jest.fn();
  const query = jest.fn();
  const clientQuery = jest.fn();
  const release = jest.fn();
  const connect = jest.fn();
  /** What happened on the lock connection and to addMember, in order. */
  let events: string[];
  const getDefaultId = jest.fn();
  const manager = {};
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  /** A boolean answers every ask; an array answers them in order, the last one repeating. */
  const answer = (value: boolean | boolean[]): boolean =>
    Array.isArray(value) ? (value.length > 1 ? value.shift()! : value[0]) : value;

  const arrange = (overrides: Partial<Store> = {}) => {
    const store: Store = {
      superadminExists: false,
      emailExists: false,
      superadminUserId: null,
      isMember: false,
      ...overrides,
    };

    const respond = async (sql: string) => {
      if (sql.includes('SELECT "id" FROM "user"')) {
        return {
          rowCount: store.superadminUserId ? 1 : 0,
          rows: store.superadminUserId ? [{ id: store.superadminUserId }] : [],
        };
      }
      if (sql.includes('FROM "member"')) {
        return { rowCount: answer(store.isMember) ? 1 : 0, rows: [] };
      }
      if (sql.includes('lower("email")')) {
        return { rowCount: answer(store.emailExists) ? 1 : 0, rows: [] };
      }

      return { rowCount: store.superadminExists ? 1 : 0, rows: [] };
    };

    query.mockImplementation(respond);
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory')) {
        events.push(sql.includes('unlock') ? 'unlock' : 'lock');

        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM "member"')) {
        events.push('check');
      }

      return respond(sql);
    });
  };

  const seed = (config: Record<string, string>, enabled = true) =>
    new SuperadminSeedService(
      new ConfigService(config),
      enabled ? ({ api: { createUser, addMember } } as never) : null,
      enabled ? ({ query, connect } as never) : null,
      { getDefaultId } as never,
      { manager } as never,
    ).onApplicationBootstrap();

  beforeEach(() => {
    jest.resetAllMocks();
    events = [];
    connect.mockResolvedValue({ query: clientQuery, release });
    addMember.mockImplementation(async () => {
      events.push('add');
    });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    getDefaultId.mockResolvedValue(ORGANIZATION_ID);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  it('seeds a superadmin once when none exists', async () => {
    arrange();

    await seed(CONFIG);

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith({
      body: { email: EMAIL, password: PASSWORD, name: 'Superadmin', role: 'superadmin' },
    });
  });

  it('skips seeding when a superadmin exists', async () => {
    arrange({ superadminExists: true });

    await seed(CONFIG);

    expect(createUser).not.toHaveBeenCalled();
  });

  it.each([{}, { AUTH_SUPERADMIN_EMAIL: EMAIL }])(
    'skips when the pair is unset: %j',
    async (cfg) => {
      await seed(cfg);

      expect(query).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
      expect(addMember).not.toHaveBeenCalled();
    },
  );

  it('skips when auth is disabled', async () => {
    await seed(CONFIG, false);

    expect(createUser).not.toHaveBeenCalled();
    expect(addMember).not.toHaveBeenCalled();
  });

  it('counts only non-banned superadmins', async () => {
    arrange();

    await seed(CONFIG);

    expect(query.mock.calls[0][0]).toContain('"banned" IS NOT TRUE');
  });

  it('skips without promoting when the seed email already exists', async () => {
    arrange({ emailExists: true });

    await expect(seed(CONFIG)).resolves.toBeUndefined();

    expect(createUser).not.toHaveBeenCalled();
    expect(addMember).not.toHaveBeenCalled();
  });

  it('tolerates a unique-violation race between replicas', async () => {
    arrange({ emailExists: [false, true] });
    createUser.mockRejectedValue(new Error('USER_ALREADY_EXISTS'));

    await expect(seed(CONFIG)).resolves.toBeUndefined();
  });

  it('rethrows a createUser failure that is not a race', async () => {
    arrange();
    createUser.mockRejectedValue(new Error('boom'));

    await expect(seed(CONFIG)).rejects.toThrow('boom');
  });

  it('skips in worker-only mode', async () => {
    await seed({ ...CONFIG, MODE: 'worker-only' });

    expect(query).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
    expect(addMember).not.toHaveBeenCalled();
  });

  it('logs the email and never the password', async () => {
    arrange();

    await seed(CONFIG);

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain(EMAIL);
    expect(logged).not.toContain(PASSWORD);
  });

  describe('default organization membership', () => {
    it('makes the superadmin an owner of the default organization', async () => {
      arrange({ superadminUserId: USER_ID });

      await seed(CONFIG);

      expect(getDefaultId).toHaveBeenCalledWith(manager);
      expect(addMember).toHaveBeenCalledWith({
        body: { userId: USER_ID, organizationId: ORGANIZATION_ID, role: 'owner' },
      });
    });

    it('adds the membership when the superadmin already existed', async () => {
      arrange({ superadminExists: true, superadminUserId: USER_ID });

      await seed(CONFIG);

      expect(createUser).not.toHaveBeenCalled();
      expect(addMember).toHaveBeenCalledTimes(1);
    });

    it('adds nothing when the superadmin is already a member', async () => {
      arrange({ superadminExists: true, superadminUserId: USER_ID, isMember: true });

      await seed(CONFIG);

      expect(addMember).not.toHaveBeenCalled();
    });

    it('adds nothing when the seed email is not an active superadmin', async () => {
      arrange({ superadminExists: true, superadminUserId: null });

      await seed(CONFIG);

      expect(getDefaultId).not.toHaveBeenCalled();
      expect(addMember).not.toHaveBeenCalled();
    });

    it('holds the advisory lock around the membership check and the add', async () => {
      arrange({ superadminUserId: USER_ID });

      await seed(CONFIG);

      expect(events).toEqual(['lock', 'check', 'add', 'unlock']);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('unlocks without adding when the superadmin turns out to be a member', async () => {
      arrange({ superadminUserId: USER_ID, isMember: true });

      await seed(CONFIG);

      expect(events).toEqual(['lock', 'check', 'unlock']);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('logs a better-auth refusal and carries on', async () => {
      arrange({ superadminUserId: USER_ID });
      addMember.mockRejectedValue(
        Object.assign(new Error('limit'), {
          name: 'APIError',
          body: { code: 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED' },
        }),
      );

      await expect(seed(CONFIG)).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ORGANIZATION_MEMBERSHIP_LIMIT_REACHED'),
      );
      expect(clientQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('unlock'),
        expect.anything(),
      );
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('rethrows any other addMember failure, still unlocking and releasing', async () => {
      arrange({ superadminUserId: USER_ID });
      addMember.mockRejectedValue(new Error('boom'));

      await expect(seed(CONFIG)).rejects.toThrow('boom');

      expect(events).toEqual(['lock', 'check', 'unlock']);
      expect(release).toHaveBeenCalledTimes(1);
    });
  });
});
