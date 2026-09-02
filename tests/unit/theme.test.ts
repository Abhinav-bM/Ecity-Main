import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  THEMES,
  THEME_NAMES,
  isThemeName,
  resolveColorScheme,
  resolveTheme,
} from '@/lib/theme'

describe('theme resolution', () => {
  it('defaults to onyx (black primary)', () => {
    expect(DEFAULT_THEME).toBe('onyx')
    expect(resolveTheme(undefined)).toBe('onyx')
  })

  it('accepts every registered theme', () => {
    for (const name of THEME_NAMES) expect(resolveTheme(name)).toBe(name)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(resolveTheme('  NAVY ')).toBe('navy')
  })

  it('falls back rather than throwing on a bad value', () => {
    // A typo in a client's env must not take the shop offline.
    expect(resolveTheme('not-a-theme')).toBe(DEFAULT_THEME)
    expect(resolveTheme('')).toBe(DEFAULT_THEME)
  })

  it('guards the theme name type', () => {
    expect(isThemeName('onyx')).toBe(true)
    expect(isThemeName('mauve')).toBe(false)
    expect(isThemeName(42)).toBe(false)
  })
})

describe('colour scheme', () => {
  it('defaults to following the device', () => {
    expect(resolveColorScheme(undefined)).toBe('system')
    expect(resolveColorScheme('nonsense')).toBe('system')
  })

  it('accepts explicit light and dark', () => {
    expect(resolveColorScheme('dark')).toBe('dark')
    expect(resolveColorScheme('LIGHT')).toBe('light')
  })
})

describe('theme registry', () => {
  it('gives every theme a browser chrome colour', () => {
    for (const name of THEME_NAMES) {
      expect(THEMES[name].browserChrome, name).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('registers a label and description for every theme', () => {
    for (const name of THEME_NAMES) {
      expect(THEMES[name].label.length, name).toBeGreaterThan(0)
      expect(THEMES[name].description.length, name).toBeGreaterThan(0)
    }
  })
})
