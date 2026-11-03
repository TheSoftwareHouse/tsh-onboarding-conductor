import { MailhogClient } from './mailhog-client';

function answerWith(items: Array<{ ID: string; Body: string }>): jest.SpyInstance {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(
      new Response(
        JSON.stringify({ items: items.map(({ ID, Body }) => ({ ID, Content: { Body } })) }),
      ),
    );
}

describe('MailhogClient', () => {
  it('reads the code from the first message that was not there before', async () => {
    answerWith([
      { ID: 'new', Body: 'Your code is 482913.' },
      { ID: 'old', Body: 'Your code is 111111.' },
    ]);

    await expect(
      new MailhogClient('http://mail:8025').waitForOtpCode('a@example.com', new Set(['old'])),
    ).resolves.toBe('482913');
  });

  it('lists the ids already addressed to the email, searching by recipient', async () => {
    const fetchSpy = answerWith([{ ID: 'old', Body: 'x' }]);

    const ids = await new MailhogClient('http://mail:8025/').listMessageIds('a+b@example.com');

    expect([...ids]).toEqual(['old']);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://mail:8025/api/v2/search?kind=to&query=a%2Bb%40example.com',
    );
  });
});
