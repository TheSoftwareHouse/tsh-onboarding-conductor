import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebar: SidebarsConfig = {
  apisidebar: [
    {
      type: 'doc',
      id: 'version-0.1/tsh-onboarding-conductor-engine-api',
    },
    {
      type: 'category',
      label: 'Health',
      link: {
        type: 'doc',
        id: 'version-0.1/health',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/get-live-health',
          label: 'Liveness probe',
          className: 'api-method get',
        },
      ],
    },
    {
      type: 'category',
      label: 'Onboarding flow',
      link: {
        type: 'doc',
        id: 'version-0.1/onboarding-flow',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/start-onboarding',
          label: 'Start an onboarding',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/submit-onboarding-step',
          label: 'Submit the current step',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/reserve-document-upload',
          label: 'Reserve a document upload',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/complete-document-upload',
          label: 'Complete a document upload',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/get-onboarding-state',
          label: 'Read the current step',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/accept-onboarding-agreement',
          label: 'Accept an agreement version',
          className: 'api-method post',
        },
      ],
    },
    {
      type: 'category',
      label: 'Manual review',
      link: {
        type: 'doc',
        id: 'version-0.1/manual-review',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/review-onboarding',
          label: 'Record a manual review decision',
          className: 'api-method post',
        },
      ],
    },
    {
      type: 'category',
      label: 'Provider callbacks',
      link: {
        type: 'doc',
        id: 'version-0.1/provider-callbacks',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/receive-provider-callback',
          label: 'Receive a provider callback',
          className: 'api-method post',
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin: onboardings',
      link: {
        type: 'doc',
        id: 'version-0.1/admin-onboardings',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/list-onboardings',
          label: 'List onboardings',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/list-onboarding-transitions',
          label: 'List the states an onboarding moved through',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/list-onboarding-agreements',
          label: "List an onboarding's agreements",
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/link-onboarding-agreement',
          label: 'Link a published agreement version to an onboarding',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/reconcile-onboarding-pending-connector',
          label: "Read a parked connector's verdict back from its provider",
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/get-onboarding',
          label: 'Read an onboarding record',
          className: 'api-method get',
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin: agreements',
      link: {
        type: 'doc',
        id: 'version-0.1/admin-agreements',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/publish-agreement',
          label: 'Publish the next version of an agreement family',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/list-agreements',
          label: 'List published agreement versions',
          className: 'api-method get',
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin: workflows',
      link: {
        type: 'doc',
        id: 'version-0.1/admin-workflows',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/compile-workflow',
          label: 'Compile a workflow document (dry run)',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/create-workflow-draft',
          label: 'Create a workflow draft',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/list-admin-workflows',
          label: 'List workflows',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/get-workflow',
          label: 'Read a workflow definition',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/list-admin-workflow-versions',
          label: "List a workflow's versions",
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/get-workflow-version',
          label: 'Read one version of a workflow definition',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/update-workflow-draft',
          label: 'Replace a draft',
          className: 'api-method put',
        },
        {
          type: 'doc',
          id: 'version-0.1/delete-workflow-draft',
          label: 'Delete a draft',
          className: 'api-method delete',
        },
        {
          type: 'doc',
          id: 'version-0.1/get-workflow-draft-document',
          label: "Read a draft's document",
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/select-workflow-step-connector',
          label: "Bind a step's connector slot to another adapter",
          className: 'api-method put',
        },
        {
          type: 'doc',
          id: 'version-0.1/clear-workflow-step-connector',
          label: "Return a step's connector slot to its authored adapter",
          className: 'api-method delete',
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin: step types',
      link: {
        type: 'doc',
        id: 'version-0.1/admin-step-types',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/list-step-types',
          label: 'List step types',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/get-workflow-schema',
          label: 'Read the workflow JSON Schema',
          className: 'api-method get',
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin: connectors',
      link: {
        type: 'doc',
        id: 'version-0.1/admin-connectors',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/list-connector-settings',
          label: 'List connector settings',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/get-connector-settings',
          label: "Read one connector's settings",
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/replace-connector-settings',
          label: 'Replace connector settings wholesale',
          className: 'api-method put',
        },
        {
          type: 'doc',
          id: 'version-0.1/merge-connector-settings',
          label: 'Merge connector settings',
          className: 'api-method patch',
        },
        {
          type: 'doc',
          id: 'version-0.1/remove-connector-settings',
          label: 'Clear connector settings',
          className: 'api-method delete',
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin: audit',
      link: {
        type: 'doc',
        id: 'version-0.1/admin-audit',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/list-audit-events',
          label: 'List audit events',
          className: 'api-method get',
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin: encryption',
      link: {
        type: 'doc',
        id: 'version-0.1/admin-encryption',
      },
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'version-0.1/get-encryption-state',
          label: 'Read the encryption state and key history',
          className: 'api-method get',
        },
        {
          type: 'doc',
          id: 'version-0.1/set-encryption-enabled',
          label: 'Turn encryption on or off',
          className: 'api-method patch',
        },
        {
          type: 'doc',
          id: 'version-0.1/set-encryption-key-rotation',
          label: 'Choose how often the key rotates on its own',
          className: 'api-method patch',
        },
        {
          type: 'doc',
          id: 'version-0.1/add-encryption-key',
          label: 'Rotate the encryption key',
          className: 'api-method post',
        },
        {
          type: 'doc',
          id: 'version-0.1/request-encryption-reencryption',
          label: 'Re-encrypt every stored onboarding onto the active key',
          className: 'api-method post',
        },
      ],
    },
  ],
};

export default sidebar.apisidebar;
