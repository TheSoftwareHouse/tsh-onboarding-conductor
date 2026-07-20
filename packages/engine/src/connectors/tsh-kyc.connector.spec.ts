import { TshKyc1Connector } from './adapters/tsh-kyc.connector';

describe('TshKyc1Connector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes the tsh_kyc_1 identity and resolves true after about five seconds', async () => {
    const connector = new TshKyc1Connector();

    expect(connector.name).toBe('tsh_kyc_1');
    expect(connector.type).toBe('mock_kyc_1');

    const pending = connector.verify({ email: 'person@example.com' });

    jest.advanceTimersByTime(4_999);
    await Promise.resolve();
    await expect(
      Promise.race([pending.then(() => 'resolved'), Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toBe(true);
  });
});
