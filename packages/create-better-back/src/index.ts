import { runCli } from 'better-back/cli';

const rawArgs = process.argv.slice(2);
const forwardedArgs =
  rawArgs.length === 0 || rawArgs[0]?.startsWith('-') ? ['new', ...rawArgs] : ['new', ...rawArgs];

const exitCode = await runCli(forwardedArgs);
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
