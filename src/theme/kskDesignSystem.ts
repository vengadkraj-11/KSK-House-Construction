export const KSK_DESIGN = {
  colors: {
    canvas: '#F4F7F5',
    surface: '#FFFFFF',
    surfaceSoft: '#EAF2ED',
    ink: '#17302D',
    inkMuted: '#657873',
    inkSubtle: '#87958F',
    primary: '#176B5B',
    primaryPressed: '#125648',
    primarySoft: '#DDEDE6',
    primaryTint: '#EFF6F2',
    border: '#DFE8E2',
    borderStrong: '#CCD9D1',
    gold: '#A9762D',
    goldSoft: '#F8F0E2',
    danger: '#B4473E',
    dangerSoft: '#F8E9E7',
    infoSoft: '#EAF0F7',
    overlay: 'rgba(15, 35, 30, 0.48)',
    white: '#FFFFFF',
    dark: '#112B28'
  },
  spacing: {
    xxs: 2, xs: 4, sm: 8, md: 12, lg: 16,
    xl: 20, xxl: 24, xxxl: 32, section: 28
  },
  radius: {
    sm: 10, md: 14, lg: 18, xl: 22, xxl: 28, pill: 999
  },
  typography: {
    caption: 10, label: 11, bodySmall: 12, body: 14,
    bodyLarge: 16, headingSmall: 18, heading: 22, display: 28
  },
  elevation: {
    card: {
      shadowColor: '#112B28',
      shadowOpacity: 0.045,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2
    },
    navigation: {
      shadowColor: '#112B28',
      shadowOpacity: 0.07,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: -3 },
      elevation: 8
    }
  }
} as const;
