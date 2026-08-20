import { Module } from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { StorageModule } from '../storage/storage.module';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { CompletedOnboardingDocumentResolver } from './resolvers/completed-onboarding-document.resolver';
import { HttpRequestConnector } from './adapters/built-in/http-request.connector';
import { SendgridEmailConnector } from './adapters/built-in/sendgrid-email.connector';
import { SmtpConnector } from './adapters/built-in/smtp.connector';
import { TwilioVerifyConnector } from './adapters/built-in/twilio-verify.connector';
import { MockAsyncCallbackConnector } from './adapters/fixtures/mock-async-callback.connector';
import { MockEmailOtpConnector } from './adapters/fixtures/mock-email-otp.connector';
import { MockSmsOtpConnector } from './adapters/fixtures/mock-sms-otp.connector';
import { MockSumsubFileUploadConnector } from './adapters/fixtures/mock-sumsub-file-upload.connector';
import { TshKyc2Connector } from './adapters/fixtures/tsh-kyc-2.connector';
import { TshKyc1Connector } from './adapters/fixtures/tsh-kyc.connector';
import { ConnectorCallbackAuthNotDeclaredError } from './errors/connector-callback-auth-not-declared.error';
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

/** Production-grade adapters shipped with the engine. */
const BUILT_IN_CONNECTOR_ADAPTER_PROVIDERS = [
  HttpRequestConnector,
  SendgridEmailConnector,
  SmtpConnector,
  TwilioVerifyConnector,
] as const;

/** Stand-ins backing the checked-in example workflows; never for production use. */
const FIXTURE_CONNECTOR_ADAPTER_PROVIDERS = [
  MockAsyncCallbackConnector,
  MockEmailOtpConnector,
  MockSmsOtpConnector,
  MockSumsubFileUploadConnector,
  TshKyc1Connector,
  TshKyc2Connector,
] as const;

/** Adapters you add under `adapters/users/`; register them here. */
const USER_CONNECTOR_ADAPTER_PROVIDERS = [] as const;

const CONNECTOR_ADAPTER_PROVIDERS = [
  ...BUILT_IN_CONNECTOR_ADAPTER_PROVIDERS,
  ...FIXTURE_CONNECTOR_ADAPTER_PROVIDERS,
  ...USER_CONNECTOR_ADAPTER_PROVIDERS,
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

/**
 * A callback-capable adapter must state how its provider authenticates callbacks. Whether an
 * unsigned provider may actually be used is a deployment decision, checked per request against
 * CONNECTOR_CALLBACK_UNSIGNED_TYPES rather than here — registering an adapter is not using it.
 */
const assertCallbackAuthDeclared = (connectors: ConnectorAdapterCollection): void => {
  for (const connector of connectors) {
    if (connector.supportsAsyncCallback === true && !connector.callbackAuth) {
      throw new ConnectorCallbackAuthNotDeclaredError(connector.type);
    }
  }
};

@Module({
  imports: [
    ConfigModule,
    EmailTemplatesModule,
    StorageModule,
    TypeOrmModule.forFeature([OnboardingDocumentEntity]),
  ],
  providers: [
    CompletedOnboardingDocumentResolver,
    ...CONNECTOR_ADAPTER_PROVIDERS,
    {
      provide: CONNECTOR_ADAPTER_COLLECTION,
      useFactory: (...connectors: ConnectorAdapterCollection): ConnectorAdapterCollection => {
        assertUniqueConnectorTypes(connectors);
        assertCallbackAuthDeclared(connectors);
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
