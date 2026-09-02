/**
 * Theme registry.
 *
 * The whole colour scheme is CSS custom properties in `src/app/globals.css`,
 * split into a neutral base (surfaces, text, borders) and a brand layer
 * (primary, ring, sidebar accent, charts). Switching a client's branding means
 * setting `APP_THEME` — nothing in any component changes.
 *
 * To add a client theme:
 *   1. copy a `[data-theme='…']` block in globals.css, change the values
 *   2. add the light and the `.dark[data-theme='…']` block
 *   3. add an entry here
 *   4. set APP_THEME=<name> in that client's .env
 */
export const THEMES = {
  onyx: {
    label: 'Onyx',
    description: 'Black primary on neutral grey. The default.',
    // Browser chrome colour on mobile. The only place a theme colour is
    // needed as a literal, because <meta name="theme-color"> cannot read a
    // CSS custom property. Keep it in step with --primary.
    browserChrome: '#1a1a1a',
  },
  navy: { label: 'Navy', description: 'Deep blue primary.', browserChrome: '#1b4965' },
  emerald: { label: 'Emerald', description: 'Green primary.', browserChrome: '#116343' },
  amber: { label: 'Amber', description: 'Warm orange primary.', browserChrome: '#9a5b12' },
} as const satisfies Record<
  string,
  { label: string; description: string; browserChrome: string }
>

export type ThemeName = keyof typeof THEMES

export const DEFAULT_THEME: ThemeName = 'onyx'

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && Object.hasOwn(THEMES, value)
}

/**
 * Resolve the active theme. Falls back to the default rather than throwing —
 * a typo in an env var must not take the shop offline, and every theme block
 * in globals.css also applies to bare `:root`, so the app is never unstyled.
 */
export function resolveTheme(value: string | undefined = process.env.APP_THEME): ThemeName {
  const candidate = value?.trim().toLowerCase()
  return isThemeName(candidate) ? candidate : DEFAULT_THEME
}

/** Colour scheme, independent of brand. `system` follows the device. */
export type ColorScheme = 'light' | 'dark' | 'system'

export function resolveColorScheme(
  value: string | undefined = process.env.APP_COLOR_SCHEME,
): ColorScheme {
  const candidate = value?.trim().toLowerCase()
  return candidate === 'dark' || candidate === 'light' ? candidate : 'system'
}
