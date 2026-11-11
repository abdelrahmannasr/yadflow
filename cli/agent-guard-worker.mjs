// The agent guard's decision, run in a worker thread by `yad hook agent-guard` (cli/hook.mjs, #498). The worker
// has a memory cap and a time limit: a line that would run the guard out of memory, or past its time, ends the
// worker, not the hook, and the hook refuses the line. A crashed hook exits with a code the harness reads as
// "no answer", and the command runs.
import { parentPort, workerData } from 'node:worker_threads';
import { agentGuardDecision, agentGuardPreapproval } from './agent-guard.mjs';

const { command, preapproval } = workerData;
const verdict = agentGuardDecision(command);
// Pre-approval (E167) reads the same line, so it runs here too, under the same limits.
const pre = verdict.allow && preapproval ? agentGuardPreapproval(command, preapproval) : null;
parentPort.postMessage({ verdict, pre });
