import { Module } from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { CompletedOnboardingDocumentResolver } from './resolvers/completed-onboarding-document.resolver';
import { HttpRequestConnector } from './adapters/http-request.connector';
import { MockEmailOtpConnector } from './adapters/mock-email-otp.connector';
import { MockAsyncCallbackConnector } from './adapters/mock-async-callback.connector';
import { MockSmsOtpConnector } from './adapters/mock-sms-otp.connector';
import { SmtpMailhogConnector } from './adapters/smtp-mailhog.connector';
import { MockSumsubFileUploadConnector } from './adapters/mock-sumsub-file-upload.connector';
import { SendgridEmailConnector } from './adapters/sendgrid-email.connector';
import { TwilioVerifyConnector } from './adapters/twilio-verify.connector';
import { TshKyc2Connector } from './adapters/tsh-kyc-2.connector';
import { TshKyc1Connector } from './adapters/tsh-kyc.connector';
import { DuplicateConnectorAdapterRegistrationError } from './errors/duplicate-connector-adapter-registration.error';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapterCollection,
} from './ports/connector-adapter.port';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
} from './ports/connector-execution.port';
import { WorkflowConnectorExecutorService } from './workflow-connector-executor.service';

const CONNECTOR_ADAPTER_PROVIDERS = [
  HttpRequestConnector,
  TshKyc1Connector,
  TshKyc2Connector,
  MockAsyncCallbackConnector,
  MockEmailOtpConnector,
  MockSmsOtpConnector,
  MockSumsubFileUploadConnector,
  SendgridEmailConnector,
  TwilioVerifyConnector,
  SmtpMailhogConnector,
] as const;
const CONNECTOR_ADAPTER_INJECT_TOKENS: InjectionToken[] = [...CONNECTOR_ADAPTER_PROVIDERS];

const assertUniqueConnectorTypes = (connectors: ConnectorAdapterCollection): void => {
  const counts = new Map<string, number>();

  for (const connector of connectors) {
    counts.set(connector.type, (counts.get(connector.type) ?? 0) + 1);
  }

  const duplicateTypes = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([type]) => type)
    .sort();

  if (duplicateTypes.length > 0) {
    throw new DuplicateConnectorAdapterRegistrationError(duplicateTypes.join(', '));
  }
};

@Module({
  imports: [ConfigModule, StorageModule, TypeOrmModule.forFeature([OnboardingDocumentEntity])],
  providers: [
    CompletedOnboardingDocumentResolver,
    ...CONNECTOR_ADAPTER_PROVIDERS,
    {
      provide: CONNECTOR_ADAPTER_COLLECTION,
      useFactory: (...connectors: ConnectorAdapterCollection): ConnectorAdapterCollection => {
        assertUniqueConnectorTypes(connectors);
        return connectors;
      },
      inject: CONNECTOR_ADAPTER_INJECT_TOKENS,
    },
    WorkflowConnectorExecutorService,
    {
      provide: WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
      useExisting: WorkflowConnectorExecutorService,
    },
    {
      provide: WORKFLOW_CONNECTOR_EXECUTION_PORT,
      useExisting: WorkflowConnectorExecutorService,
    },
  ],
  exports: [WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT],
})
export class ConnectorsModule {}
