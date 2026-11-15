#!/usr/bin/env node
import { main } from '../lib/launcher.mjs';

main(process.argv.slice(2)).catch(error => {
  console.error(`setdown: ${error.message}`);
  process.exit(1);
});
