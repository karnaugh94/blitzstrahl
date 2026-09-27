/**
 * The fonts the built-in themes ship (PLAN §15, M7.1): Fontsource's variable
 * builds (5.3.0), weight axis only, split by script with Fontsource's own
 * ranges, so a browser downloads only the scripts a slide uses and a
 * standalone file carries only those (cli `standaloneFonts`). OFL; the
 * licences are beside the files. Generated from the packages' unicode.json.
 */
import type { ThemeFont } from './theme.js'

/** Inter: latin, latin-ext, greek, cyrillic, vietnamese; upright and italic. */
export const INTER: ThemeFont[] = [
  { family: 'Inter', src: '../fonts/inter-latin-wght-normal.woff2', weight: '100 900', unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { family: 'Inter', src: '../fonts/inter-latin-wght-italic.woff2', weight: '100 900', style: 'italic', unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { family: 'Inter', src: '../fonts/inter-latin-ext-wght-normal.woff2', weight: '100 900', unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { family: 'Inter', src: '../fonts/inter-latin-ext-wght-italic.woff2', weight: '100 900', style: 'italic', unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { family: 'Inter', src: '../fonts/inter-greek-wght-normal.woff2', weight: '100 900', unicodeRange: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF' },
  { family: 'Inter', src: '../fonts/inter-greek-wght-italic.woff2', weight: '100 900', style: 'italic', unicodeRange: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF' },
  { family: 'Inter', src: '../fonts/inter-cyrillic-wght-normal.woff2', weight: '100 900', unicodeRange: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { family: 'Inter', src: '../fonts/inter-cyrillic-wght-italic.woff2', weight: '100 900', style: 'italic', unicodeRange: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { family: 'Inter', src: '../fonts/inter-vietnamese-wght-normal.woff2', weight: '100 900', unicodeRange: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB' },
  { family: 'Inter', src: '../fonts/inter-vietnamese-wght-italic.woff2', weight: '100 900', style: 'italic', unicodeRange: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB' },
]

/** JetBrains Mono: latin, latin-ext, greek, cyrillic, vietnamese; upright and italic. */
export const JETBRAINS_MONO: ThemeFont[] = [
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-latin-wght-normal.woff2', weight: '100 800', unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-latin-wght-italic.woff2', weight: '100 800', style: 'italic', unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-latin-ext-wght-normal.woff2', weight: '100 800', unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-latin-ext-wght-italic.woff2', weight: '100 800', style: 'italic', unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-greek-wght-normal.woff2', weight: '100 800', unicodeRange: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-greek-wght-italic.woff2', weight: '100 800', style: 'italic', unicodeRange: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-cyrillic-wght-normal.woff2', weight: '100 800', unicodeRange: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-cyrillic-wght-italic.woff2', weight: '100 800', style: 'italic', unicodeRange: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-vietnamese-wght-normal.woff2', weight: '100 800', unicodeRange: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB' },
  { family: 'JetBrains Mono', src: '../fonts/jetbrains-mono-vietnamese-wght-italic.woff2', weight: '100 800', style: 'italic', unicodeRange: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB' },
]

/** Newsreader: latin, latin-ext, vietnamese; upright and italic. */
export const NEWSREADER: ThemeFont[] = [
  { family: 'Newsreader', src: '../fonts/newsreader-latin-wght-normal.woff2', weight: '200 800', unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { family: 'Newsreader', src: '../fonts/newsreader-latin-wght-italic.woff2', weight: '200 800', style: 'italic', unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { family: 'Newsreader', src: '../fonts/newsreader-latin-ext-wght-normal.woff2', weight: '200 800', unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { family: 'Newsreader', src: '../fonts/newsreader-latin-ext-wght-italic.woff2', weight: '200 800', style: 'italic', unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  { family: 'Newsreader', src: '../fonts/newsreader-vietnamese-wght-normal.woff2', weight: '200 800', unicodeRange: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB' },
  { family: 'Newsreader', src: '../fonts/newsreader-vietnamese-wght-italic.woff2', weight: '200 800', style: 'italic', unicodeRange: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB' },
]
