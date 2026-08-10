import * as stylex from '@stylexjs/stylex';

import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Section } from '../components/section';
import type { UserProfileMenuAction } from './user-profile-action-menu';
import { UserProfileActionMenu } from './user-profile-action-menu';
import { styles } from './user-profile-profile-panel.styles';

export interface UserProfileWeb3Wallet {
  id: string;
  address: string;
  provider?: string;
  iconUrl?: string;
  isPrimary?: boolean;
  isVerified?: boolean;
  canRemove?: boolean;
}

export interface UserProfileWeb3WalletsSectionViewProps {
  wallets: UserProfileWeb3Wallet[];
  onAdd?: () => void;
  onManage?: (id: string) => void;
  onSetPrimary?: (id: string) => void;
  onRemove?: (id: string) => void;
}

const shortenWeb3Address = (address: string) => {
  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export function UserProfileWeb3WalletsSectionView({
  wallets,
  onAdd,
  onManage,
  onSetPrimary,
  onRemove,
}: UserProfileWeb3WalletsSectionViewProps) {
  return (
    <Section.Root>
      <div {...stylex.props(styles.sectionHeader)}>
        <Section.Title {...stylex.props(styles.sectionTitle)}>Web3 wallets</Section.Title>
        {onAdd ? (
          <Button
            color='neutral'
            size='sm'
            variant='outline'
            onClick={onAdd}
          >
            Add
          </Button>
        ) : null}
      </div>
      <Section.Group>
        {wallets.map(wallet => {
          const actions: UserProfileMenuAction[] = [];
          const hasExplicitActions = Boolean(onSetPrimary || onRemove);

          if (!wallet.isPrimary && wallet.isVerified !== false && onSetPrimary) {
            actions.push({ label: 'Set as primary', onClick: () => onSetPrimary(wallet.id) });
          }

          if (onRemove && wallet.canRemove !== false) {
            actions.push({ label: 'Remove wallet', color: 'negative', onClick: () => onRemove(wallet.id) });
          }

          if (!hasExplicitActions && onManage) {
            actions.push({ label: 'Manage', onClick: () => onManage(wallet.id) });
          }

          const address = shortenWeb3Address(wallet.address);
          const badges = (
            <>
              {wallet.isPrimary ? <Badge color='neutral'>Primary</Badge> : null}
              {wallet.isVerified === false ? <Badge color='warning'>Unverified</Badge> : null}
            </>
          );

          return (
            <Section.Row key={wallet.id}>
              <Section.Item>
                {wallet.iconUrl ? (
                  <Section.Media>
                    <img
                      alt=''
                      src={wallet.iconUrl}
                      {...stylex.props(styles.providerIcon)}
                    />
                  </Section.Media>
                ) : null}
                <Section.Content>
                  <Section.Label>
                    <span {...stylex.props(styles.contactValue)}>
                      {wallet.provider ?? address}
                      {badges}
                    </span>
                  </Section.Label>
                  {wallet.provider ? <Section.Description>{address}</Section.Description> : null}
                </Section.Content>
                <Section.Actions>
                  <UserProfileActionMenu
                    actions={actions}
                    label={`Manage ${wallet.provider ?? address}`}
                  />
                </Section.Actions>
              </Section.Item>
            </Section.Row>
          );
        })}
      </Section.Group>
    </Section.Root>
  );
}
