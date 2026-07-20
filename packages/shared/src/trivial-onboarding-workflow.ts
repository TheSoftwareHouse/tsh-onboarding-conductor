export type E2TrivialWorkflowFixture = {
  workflowId: 'trivial-onboarding';
  workflowVersion: 'v1';
  steps: {
    start: {
      id: 'start';
      status: 'awaiting_user';
      data: {
        continue: {
          type: 'boolean';
          required: false;
          persist: false;
        };
      };
      transitions: [{ target: 'approved'; type: 'success' }];
    };
    approved: {
      id: 'approved';
      status: 'approved';
      data: Record<string, never>;
      transitions: [];
    };
  };
};

export const trivialOnboardingV1: E2TrivialWorkflowFixture = {
  workflowId: 'trivial-onboarding',
  workflowVersion: 'v1',
  steps: {
    start: {
      id: 'start',
      status: 'awaiting_user',
      data: {
        continue: {
          type: 'boolean',
          required: false,
          persist: false,
        },
      },
      transitions: [{ target: 'approved', type: 'success' }],
    },
    approved: {
      id: 'approved',
      status: 'approved',
      data: {},
      transitions: [],
    },
  },
};
