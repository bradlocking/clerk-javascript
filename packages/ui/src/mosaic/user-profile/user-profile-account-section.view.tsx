import * as stylex from '@stylexjs/stylex';

import { Avatar } from '../components/avatar';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Icon } from '../components/icon';
import { Section } from '../components/section';
import { space } from '../tokens.stylex';
import type { UserProfileMenuAction } from './user-profile-action-menu';
import { UserProfileActionMenu } from './user-profile-action-menu';

const styles = stylex.create({
  profilePictureItem: {
    columnGap: space['4'],
  },
});

export interface UserProfileEmail {
  id: string;
  value: string;
  isDefault?: boolean;
  isVerified?: boolean;
  canRemove?: boolean;
}

export interface UserProfilePhone {
  id: string;
  value: string;
  isDefault?: boolean;
  isVerified?: boolean;
  canRemove?: boolean;
}

export interface UserProfileAccountSectionViewProps {
  imageUrl?: string;
  name: string;
  username: string;
  emails: UserProfileEmail[];
  phones: UserProfilePhone[];
  onEditProfilePicture?: () => void;
  onNameChange?: (value: string) => void;
  onUsernameChange?: (value: string) => void;
  onAddEmail?: () => void;
  onManageEmail?: (id: string) => void;
  onVerifyEmail?: (id: string) => void;
  onSetPrimaryEmail?: (id: string) => void;
  onRemoveEmail?: (id: string) => void;
  onAddPhone?: () => void;
  onManagePhone?: (id: string) => void;
  onVerifyPhone?: (id: string) => void;
  onSetPrimaryPhone?: (id: string) => void;
  onRemovePhone?: (id: string) => void;
}

export function UserProfileAccountSectionView({
  imageUrl,
  name,
  username,
  emails,
  phones,
  onEditProfilePicture,
  onNameChange,
  onUsernameChange,
  onAddEmail,
  onManageEmail,
  onVerifyEmail,
  onSetPrimaryEmail,
  onRemoveEmail,
  onAddPhone,
  onManagePhone,
  onVerifyPhone,
  onSetPrimaryPhone,
  onRemovePhone,
}: UserProfileAccountSectionViewProps) {
  const initials = name
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const updateName = onNameChange ? () => onNameChange(name) : undefined;
  const updateUsername = onUsernameChange ? () => onUsernameChange(username) : undefined;

  return (
    <Section.Root aria-label='Account'>
      <Section.Group>
        <Section.Row>
          <Section.Item {...stylex.props(styles.profilePictureItem)}>
            <Section.Media size='xl'>
              <Avatar.Root size='fit'>
                <Avatar.Image
                  alt={name}
                  src={imageUrl}
                />
                <Avatar.Fallback>{initials}</Avatar.Fallback>
              </Avatar.Root>
            </Section.Media>
            <Section.Content>
              <Section.Label>Profile picture</Section.Label>
              <Section.Description>Recommend size 1:1, up to 10MB.</Section.Description>
            </Section.Content>
            {onEditProfilePicture ? (
              <Section.Actions>
                <Button
                  color='neutral'
                  size='sm'
                  variant='outline'
                  onClick={onEditProfilePicture}
                >
                  Upload
                </Button>
              </Section.Actions>
            ) : null}
          </Section.Item>
        </Section.Row>
        <Section.Row>
          <Section.Item>
            <Section.Content>
              <Section.Label>Name</Section.Label>
              <Section.Description>{name}</Section.Description>
            </Section.Content>
            {updateName ? (
              <Section.Actions>
                <Button
                  color='neutral'
                  size='sm'
                  variant='outline'
                  onClick={updateName}
                >
                  Edit name
                </Button>
              </Section.Actions>
            ) : null}
          </Section.Item>
        </Section.Row>
        <Section.Row>
          <Section.Item>
            <Section.Content>
              <Section.Label>Username</Section.Label>
              <Section.Description>{username}</Section.Description>
            </Section.Content>
            {updateUsername ? (
              <Section.Actions>
                <Button
                  color='neutral'
                  size='sm'
                  variant='outline'
                  onClick={updateUsername}
                >
                  Edit username
                </Button>
              </Section.Actions>
            ) : null}
          </Section.Item>
        </Section.Row>
        <ContactSection
          items={emails}
          kind='email'
          label='Email'
          onAdd={onAddEmail}
          onManage={onManageEmail}
          onRemove={onRemoveEmail}
          onSetPrimary={onSetPrimaryEmail}
          onVerify={onVerifyEmail}
        />
        <ContactSection
          items={phones}
          kind='phone'
          label='Phone'
          onAdd={onAddPhone}
          onManage={onManagePhone}
          onRemove={onRemovePhone}
          onSetPrimary={onSetPrimaryPhone}
          onVerify={onVerifyPhone}
        />
      </Section.Group>
    </Section.Root>
  );
}

function ContactSection({
  kind,
  label,
  items,
  onAdd,
  onManage,
  onVerify,
  onSetPrimary,
  onRemove,
}: {
  kind: 'email' | 'phone';
  label: string;
  items: Array<{ id: string; value: string; isDefault?: boolean; isVerified?: boolean; canRemove?: boolean }>;
  onAdd?: () => void;
  onManage?: (id: string) => void;
  onVerify?: (id: string) => void;
  onSetPrimary?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const labelId = `user-profile-profile-panel-${label.toLowerCase()}`;

  return (
    <Section.Row
      render={props => (
        <section
          {...props}
          aria-labelledby={labelId}
        />
      )}
    >
      <Section.Item>
        <Section.Content>
          <Section.Label id={labelId}>{label}</Section.Label>
        </Section.Content>
        {onAdd ? (
          <Section.Actions>
            <Button
              color='neutral'
              size='sm'
              variant='outline'
              onClick={onAdd}
            >
              Add
              <Icon
                name='plus'
                placement='inline-end'
                size='sm'
              />
            </Button>
          </Section.Actions>
        ) : null}
      </Section.Item>
      <Section.Items>
        {items.map(item => {
          const actions: UserProfileMenuAction[] = [];
          const hasExplicitActions = Boolean(onVerify || onSetPrimary || onRemove);

          if (item.isVerified === false && onVerify) {
            actions.push({
              label: item.isDefault ? 'Complete verification' : kind === 'email' ? 'Verify' : 'Verify phone number',
              onClick: () => onVerify(item.id),
            });
          } else if (!item.isDefault && item.isVerified === true && onSetPrimary) {
            actions.push({ label: 'Set as primary', onClick: () => onSetPrimary(item.id) });
          }

          if (onRemove && item.canRemove !== false) {
            actions.push({
              label: kind === 'email' ? 'Remove email' : 'Remove phone number',
              color: 'negative',
              onClick: () => onRemove(item.id),
            });
          }

          if (!hasExplicitActions && onManage) {
            actions.push({ label: 'Manage', onClick: () => onManage(item.id) });
          }

          return (
            <Section.Item key={item.id}>
              <Section.Content>
                <Section.Description style={{ alignItems: 'center', display: 'flex', gap: 4 }}>
                  <span>{item.value}</span>
                  {item.isDefault ? <Badge color='neutral'>Primary</Badge> : null}
                </Section.Description>
              </Section.Content>
              {actions.length > 0 ? (
                <Section.Actions>
                  <UserProfileActionMenu
                    actions={actions}
                    label={`Manage ${item.value}`}
                  />
                </Section.Actions>
              ) : null}
            </Section.Item>
          );
        })}
      </Section.Items>
    </Section.Row>
  );
}
