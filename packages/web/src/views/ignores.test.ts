import { describe, expect, it } from 'vitest'
import type { NodeIgnorePatterns } from '@clusterfuck/shared'
import { ignoresDiffer, patternsToText, textToPatterns } from './ignores'

describe('textToPatterns / patternsToText', () => {
  it('round-trips patterns through textarea text', () => {
    const patterns = ['*.tmp', '# comment', '/build']
    expect(textToPatterns(patternsToText(patterns))).toEqual(patterns)
  })

  it('drops only trailing empty lines, keeping internal blanks and comments', () => {
    expect(textToPatterns('*.tmp\n\n# keep\n/build\n\n')).toEqual(['*.tmp', '', '# keep', '/build'])
  })

  it('treats empty text as no patterns', () => {
    expect(textToPatterns('')).toEqual([])
    expect(textToPatterns('\n\n')).toEqual([])
  })
})

describe('ignoresDiffer', () => {
  const node = (deviceId: string, patterns: string[], error?: string): NodeIgnorePatterns => ({
    deviceId,
    patterns,
    error,
  })

  it('is false when all readable nodes agree', () => {
    expect(ignoresDiffer([node('A', ['*.tmp']), node('B', ['*.tmp'])])).toBe(false)
  })

  it('is true when readable nodes disagree', () => {
    expect(ignoresDiffer([node('A', ['*.tmp']), node('B', ['*.bak'])])).toBe(true)
  })

  it('ignores errored nodes and needs at least two readable ones', () => {
    expect(ignoresDiffer([node('A', ['*.tmp']), node('B', [], 'unreachable')])).toBe(false)
    expect(ignoresDiffer([node('A', ['*.tmp'])])).toBe(false)
  })
})
