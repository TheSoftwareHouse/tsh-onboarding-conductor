import { TshKyc2Connector } from './tsh-kyc-2.connector';

describe('TshKyc2Connector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes the tsh_kyc_2 identity and resolves true after about five seconds', async () => {
    const connector = new TshKyc2Connector();

    expect(connector.name).toBe('tsh_kyc_2');
    expect(connector.type).toBe('mock_kyc_2');

    const pending = connector.verify({ acceptedTerms: true });

    jest.advanceTimersByTime(4_999);
    await Promise.resolve();
    await expect(
      Promise.race([pending.then(() => 'resolved'), Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toBe(true);
  });
});
