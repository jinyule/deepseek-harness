import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as Invariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'

describe('authorization settings package companions', () => {
  it('registers its invariant owner and keeps the node half inert', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(Invariant)).resolves.toBeDefined()
    nodeApply()
  })
})
