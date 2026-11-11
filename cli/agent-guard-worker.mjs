// The agent guard's decision, run in a worker thread by `yad hook agent-guard` (cli/hook.mjs, #498). The worker
// has a memory cap and a time limit: a line that would run the guard out of memory, or past its time, ends the
// worker, not the hook, and the hook refuses the line. A crashed hook exits with a code the harness reads as
// "no answer", and the command runs.
import { parentPort, workerData } from 'node:worker_threads';
import { agentGuardDecision, agentGuardPreapproval } from './agent-guard.mjs';

const { command, preapproval } = workerData;
// The verdict first: pre-approval (E167) reads the same line again, under the same limits, and when it runs out
// of time the verdict stands, only not pre-approved.
const verdict = agentGuardDecision(command);
parentPort.postMessage({ verdict });
if (verdict.allow && preapproval) parentPort.postMessage({ pre: agentGuardPreapproval(command, preapproval) });
