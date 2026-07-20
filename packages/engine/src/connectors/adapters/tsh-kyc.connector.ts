import { Injectable } from '@nestjs/common';
import type { ConnectorAdapter } from '../ports/connector-adapter.port';

@Injectable()
export class TshKyc1Connector implements ConnectorAdapter {
  readonly name = 'tsh_kyc_1';
  readonly type = 'mock_kyc_1';

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
