import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as Invariant from '../src/invariant.ts'

describe('authorization remote invariant companion', () => {
  it('registers the package owner with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(Invariant)).resolves.toBeDefined()
  })
})
