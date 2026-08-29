#!/usr/bin/env node

const { validateEnvironment } = require("./config-validator");

const result = validateEnvironment(process.env);
for (const warning of result.warnings) {
  console.warn(`WARNING: ${warning}`);
}
for (const error of result.errors) {
  console.error(`ERROR: ${error}`);
}

if (!result.ok) process.exit(1);

console.log(
  `RC4 bridge configuration valid: ${result.serverCount} management server(s), `
  + `${result.updateProjectCount} update project(s).`,
);
