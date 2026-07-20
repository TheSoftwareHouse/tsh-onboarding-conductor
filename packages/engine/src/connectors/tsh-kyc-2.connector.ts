import { Injectable } from '@nestjs/common';
import type { ConnectorAdapter } from './connector.adapter';

@Injectable()
export class TshKyc2Connector implements ConnectorAdapter {
  readonly name = 'tsh_kyc_2';
  readonly type = 'mock_kyc_2';

  async verify(payload: Readonly<Record<string, unknown>>): Promise<boolean> {
    void payload;
    await this.wait(5_000);
    return true;
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
