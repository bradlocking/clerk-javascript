import * as stylex from '@stylexjs/stylex';

import { space } from '../tokens.stylex';

export const styles = stylex.create({
  contactValue: {
    gap: space['2'],
    alignItems: 'center',
    display: 'flex',
    minWidth: 0,
  },
  providerIcon: {
    flexShrink: 0,
    objectFit: 'contain',
    height: space['6'],
    width: space['6'],
  },
  sectionHeader: {
    alignItems: 'flex-end',
    columnGap: space['4'],
    display: 'flex',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  sectionTitle: {
    flexGrow: 1,
    minWidth: 0,
  },
  root: {
    gap: space['4'],
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  sections: {
    gap: space['8'],
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
});
