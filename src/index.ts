#!/usr/bin/env node

import { startServer } from './server';

startServer().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
