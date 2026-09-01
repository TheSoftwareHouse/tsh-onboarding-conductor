import { Logger, Module, forwardRef } from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import type { AppConfig } from '../config/app.config';
import { parseConnectorMocks } from '../config/connector-mocks.config';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { StorageModule } from '../storage/storage.module';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { ConnectorApplicantReferencesRepository } from './connector-applicant-references.repository';
import { ConnectorApplicantReferenceEntity } from './entity/connector-applicant-reference.entity';
import { CompletedOnboardingDocumentResolver } from './resolvers/completed-onboarding-document.resolver';
import { AwaitingCallbackConnectorResolver } from './resolvers/awaiting-callback-connector.resolver';
import { ConnectorSettingsAdminService } from './connector-settings-admin.service';
import { ConnectorsRepository } from './connectors.repository';
import { ConnectorSettingsService } from './connector-settings.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorEntity } from './entity/connector.entity';
import { HttpRequestConnector } from './adapters/built-in/http-request.connector';
import { SendgridEmailConnector } from './adapters/built-in/sendgrid-email.connector';
import { SmtpConnector } from './adapters/built-in/smtp.connector';
import { SumsubKycConnector } from './adapters/built-in/sumsub-kyc.connector';
import { SumsubClient } from './adapters/built-in/sumsub-kyc/sumsub-client';
import { TwilioVerifyConnector } from './adapters/built-in/twilio-verify.connector';
import { MockAsyncCallbackConnector } from './adapters/fixtures/mock-async-callback.connector';
import { MockEmailDeliveryConnector } from './adapters/fixtures/mock-email-delivery.connector';
import { MockKyc1Connector, MockKyc2Connector } from './adapters/fixtures/mock-kyc.connector';
import { MockSumsubFileUploadConnector } from './adapters/fixtures/mock-sumsub-file-upload.connector';
import {
  MockEmailVerificationConnector,
  MockPhoneVerificationConnector,
} from './adapters/fixtures/mock-verification.connector';
import {
  CONNECTOR_MOCK_SUBSTITUTIONS,
  type ConnectorMockSubstitutions,
  resolveConnectorMockSubstitutions,
} from './connector-mock-substitution';
import { ConnectorCallbackAuthNotDeclaredError } from './errors/connector-callback-auth-not-declared.error';
import { DuplicateConnectorAdapterRegistrationError } from './errors/duplicate-connector-adapter-registration.error';
import { DuplicateConnectorErrorHandlerRegistrationError } from './errors/duplicate-connector-error-handler-registration.error';
import { ContinueOnErrorHandler } from './error-handlers/built-in/continue-on-error.handler';
import { FallbackOnErrorHandler } from './error-handlers/built-in/fallback-on-error.handler';
import { RetryThenFallbackHandler } from './error-handlers/built-in/retry-then-fallback.handler';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapterCollection,
} from './ports/connector-adapter.port';
import {
  CONNECTOR_ERROR_HANDLER_COLLECTION,
  type ConnectorErrorHandlerCollection,
} from './ports/connector-error-handler.port';
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
  SumsubKycConnector,
  TwilioVerifyConnector,
] as const;

/**
 * Fakes with no provider behind them, for the checked-in example workflows and for e2e runs.
 * The three named after what they do rather than after a vendor are the ones CONNECTOR_MOCKS
 * can put in a real connector's place; the rest are only reachable by a workflow naming them.
 */
const FIXTURE_CONNECTOR_ADAPTER_PROVIDERS = [
  MockAsyncCallbackConnector,
  MockEmailDeliveryConnector,
  MockEmailVerificationConnector,
  MockKyc1Connector,
  MockKyc2Connector,
  MockPhoneVerificationConnector,
  MockSumsubFileUploadConnector,
] as const;

/** Adapters you add under `adapters/users/`; register them here. */
const USER_CONNECTOR_ADAPTER_PROVIDERS = [] as const;

const CONNECTOR_ADAPTER_PROVIDERS = [
  ...BUILT_IN_CONNECTOR_ADAPTER_PROVIDERS,
  ...FIXTURE_CONNECTOR_ADAPTER_PROVIDERS,
  ...USER_CONNECTOR_ADAPTER_PROVIDERS,
] as const;
const CONNECTOR_ADAPTER_INJECT_TOKENS: InjectionToken[] = [...CONNECTOR_ADAPTER_PROVIDERS];

/** Error handlers shipped with the engine. */
const BUILT_IN_CONNECTOR_ERROR_HANDLER_PROVIDERS = [
  FallbackOnErrorHandler,
  RetryThenFallbackHandler,
  ContinueOnErrorHandler,
] as const;

/** Error handlers you add under `error-handlers/users/`; register them here. */
const USER_CONNECTOR_ERROR_HANDLER_PROVIDERS = [] as const;

const CONNECTOR_ERROR_HANDLER_PROVIDERS = [
  ...BUILT_IN_CONNECTOR_ERROR_HANDLER_PROVIDERS,
  ...USER_CONNECTOR_ERROR_HANDLER_PROVIDERS,
] as const;
const CONNECTOR_ERROR_HANDLER_INJECT_TOKENS: InjectionToken[] = [
  ...CONNECTOR_ERROR_HANDLER_PROVIDERS,
];

const assertUniqueConnectorTypes = (connectors: ConnectorAdapterCollection): void => {
  const counts = new Map<string, number>();

  for (const connector of connectors) {
    counts.set(connector.id, (counts.get(connector.id) ?? 0) + 1);
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
      throw new ConnectorCallbackAuthNotDeclaredError(connector.id);
    }
  }
};

const assertUniqueConnectorErrorHandlerIds = (handlers: ConnectorErrorHandlerCollection): void => {
  const counts = new Map<string, number>();

  for (const handler of handlers) {
    counts.set(handler.id, (counts.get(handler.id) ?? 0) + 1);
  }

  const duplicateIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();

  if (duplicateIds.length > 0) {
    throw new DuplicateConnectorErrorHandlerRegistrationError(duplicateIds.join(', '));
  }
};

@Module({
  imports: [
    ConfigModule,
    EmailTemplatesModule,
    StorageModule,
    AuditModule,
    forwardRef(() => AuthModule),
    forwardRef(() => WorkflowsModule),
    TypeOrmModule.forFeature([
      OnboardingDocumentEntity,
      ConnectorEntity,
      OnboardingEntity,
      ConnectorApplicantReferenceEntity,
    ]),
  ],
  controllers: [ConnectorsController],
  providers: [
    CompletedOnboardingDocumentResolver,
    AwaitingCallbackConnectorResolver,
    ConnectorApplicantReferencesRepository,
    ConnectorsRepository,
    ConnectorSettingsService,
    ConnectorSettingsAdminService,
    SumsubClient,
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
    ...CONNECTOR_ERROR_HANDLER_PROVIDERS,
    {
      provide: CONNECTOR_ERROR_HANDLER_COLLECTION,
      useFactory: (
        ...handlers: ConnectorErrorHandlerCollection
      ): ConnectorErrorHandlerCollection => {
        assertUniqueConnectorErrorHandlerIds(handlers);
        return handlers;
      },
      inject: CONNECTOR_ERROR_HANDLER_INJECT_TOKENS,
    },
    {
      provide: CONNECTOR_MOCK_SUBSTITUTIONS,
      useFactory: (
        configService: ConfigService<AppConfig, true>,
        connectors: ConnectorAdapterCollection,
      ): ConnectorMockSubstitutions => {
        const nodeEnv = configService.get<string>('NODE_ENV');
        const configured = parseConnectorMocks(configService.get<string>('CONNECTOR_MOCKS'));
        const substitutions = resolveConnectorMockSubstitutions(connectors, configured, nodeEnv);
        const logger = new Logger(ConnectorsModule.name);

        if (configured.size > 0 && substitutions.size === 0) {
          logger.log(
            `CONNECTOR_MOCKS is configured but ignored: connector mocks only serve test runs, and NODE_ENV=${nodeEnv}`,
          );
        }

        for (const [connectorId, mockConnectorId] of substitutions) {
          logger.warn(
            `Connector id=${connectorId} is served by id=${mockConnectorId} instead of its real provider`,
          );
        }

        return substitutions;
      },
      inject: [ConfigService, CONNECTOR_ADAPTER_COLLECTION],
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
  exports: [WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT, ConnectorSettingsService],
})
export class ConnectorsModule {}
