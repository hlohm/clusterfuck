import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Auto-cleanup only registers itself when vitest globals are on; we keep
// globals off, so unmount rendered trees between tests explicitly.
afterEach(cleanup)
