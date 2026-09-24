import type { ReactElement } from 'react';
import {
  FilterTab,
  FilterTabGroup,
  FilterTabNote,
  FilterTabs,
} from '@/components/ui/FilterTabs/FilterTabs';
import { ADMIN_ROUTES } from '@/constants/routes';
import { describeConnectorType } from '../../types/connector';
import { serializeConnectorsSearch } from '../../utils/connectors-search-params';
import type { ConnectorTypeGroup } from '../ConnectorList/group-connectors-by-type';

export interface ConnectorTypeNavProps {
  groups: ConnectorTypeGroup[];
  /** `CONNECTOR_TYPES` entries no connector reports — rendered as read-only notes. */
  notImplemented: string[];
  selectedType: string | undefined;
}

function buildTypeHref(type: string): string {
  return `${ADMIN_ROUTES.connectors.root}${serializeConnectorsSearch(type)}`;
}

/** The design's connector-type nav: one tab per populated type, then what nothing implements. */
export function ConnectorTypeNav({
  groups,
  notImplemented,
  selectedType,
}: ConnectorTypeNavProps): ReactElement {
  return (
    <FilterTabs orientation="vertical" label="Connector type">
      <FilterTabGroup label="Connector type">
        {groups.map((group) => (
          <FilterTab
            key={group.type}
            to={buildTypeHref(group.type)}
            active={group.type === selectedType}
            count={group.cards.length}
          >
            {group.label}
          </FilterTab>
        ))}
      </FilterTabGroup>
      {notImplemented.length === 0 ? null : (
        <FilterTabGroup label="Not implemented">
          {notImplemented.map((type) => (
            <FilterTabNote key={type}>{describeConnectorType(type)}</FilterTabNote>
          ))}
        </FilterTabGroup>
      )}
    </FilterTabs>
  );
}
