import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-authorization-remote',
  ['lib/types/index.js'],
  { hostPhase: true },
)
