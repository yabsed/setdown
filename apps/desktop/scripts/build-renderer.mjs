import { build } from 'vite';

// Monaco's TypeScript worker bundles the compiler as well as the editor.
// The npm script grants this build process a 4 GiB heap; app runtimes retain
// their normal limits and load language workers only when requested.
await build();
