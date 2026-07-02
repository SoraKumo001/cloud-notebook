// packages/backend/vitest.config.ts
//
// NOTE: @cloudflare/vitest-pool-workers is installed but currently NOT active.
// On Windows, workerd (the Workers runtime) is not available as a native binary.
// To use the workers pool:
//   1. Switch to Linux or macOS, or use WSL2
//   2. Change the import to:
//        import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
//   3. Uncomment the poolOptions below
//   4. Remove the `defineConfig` block
//
// Example workers-pool config:
//   ```typescript
//   import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
//   export default defineWorkersConfig({
//     test: {
//       include: ['src/**/*.test.ts'],
//       poolOptions: {
//         workers: {
//           singleWorker: true,
//           miniflare: {
//             compatibilityDate: '2024-06-20',
//             compatibilityFlags: ['nodejs_compat'],
//             d1Databases: { DB: 'cloud-notebook-db' },
//             r2Buckets: { BUCKET: 'cloud-notebook-bucket' },
//           },
//         },
//       },
//     },
//   })
//   ```

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
