import { describe, expect, it } from 'vitest';
import type { Connector } from '@/api/connectors/connectors';
import type { ConnectorCardProps } from './ConnectorCard/ConnectorCard';
import { CONNECTOR_TYPES } from '../../types/connector';
import { groupConnectorsByType } from './group-connectors-by-type';

function createCard(id: string, type: string): ConnectorCardProps {
  const connector: Connector = {
    id,
    type,
    name: id,
    configured: false,
    settings: [],
    updatedAt: null,
    updatedBy: null,
  };

  return { connector } as ConnectorCardProps;
}

describe('groupConnectorsByType', () => {
  it('puts two connectors of the same capability in one group', () => {
    const { groups } = groupConnectorsByType([
      createCard('sendgrid_email', 'email_delivery'),
      createCard('smtp', 'email_delivery'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Email delivery');
    expect(groups[0].cards.map((card) => card.connector.id)).toEqual(['sendgrid_email', 'smtp']);
  });

  it('orders groups by the declared capability order, not by how the engine listed them', () => {
    const { groups } = groupConnectorsByType([
      createCard('acme_custom', 'custom'),
      createCard('twilio_verify', 'phone_verification'),
      createCard('mock_kyc_1', 'kyc'),
    ]);

    expect(groups.map((group) => group.type)).toEqual(['kyc', 'phone_verification', 'custom']);
  });

  it('drops a capability nothing implements', () => {
    const { groups } = groupConnectorsByType([createCard('smtp', 'email_delivery')]);

    expect(groups.map((group) => group.type)).toEqual(['email_delivery']);
  });

  it('keeps a capability this build does not know, after the known ones', () => {
    const { groups } = groupConnectorsByType([
      createCard('future_provider', 'tax_filing'),
      createCard('smtp', 'email_delivery'),
    ]);

    expect(groups.map((group) => group.type)).toEqual(['email_delivery', 'tax_filing']);
    // No label is known for it, so the raw value has to stand in rather than render blank.
    expect(groups[1].label).toBe('tax_filing');
  });

  it('returns nothing for no connectors', () => {
    expect(groupConnectorsByType([])).toEqual({
      groups: [],
      notImplemented: [...CONNECTOR_TYPES],
    });
  });

  it('reports the declared types no connector implements, in declared order', () => {
    const { notImplemented } = groupConnectorsByType([
      createCard('twilio_verify', 'phone_verification'),
      createCard('smtp', 'email_delivery'),
    ]);

    expect(notImplemented[0]).toBe('kyc');
    expect(notImplemented).not.toContain('phone_verification');
    expect(notImplemented).not.toContain('email_delivery');
  });

  it('does not report an unknown type as not implemented — it is implemented, just unlabelled', () => {
    const { notImplemented } = groupConnectorsByType([createCard('future_provider', 'tax_filing')]);

    expect(notImplemented).not.toContain('tax_filing');
  });
});
