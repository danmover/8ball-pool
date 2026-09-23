/// <reference lib="webworker" />
import { planBotTurn, type BotPlanRequest } from '@8ball/shared';

/**
 * Bots think here, off the main thread, so the table keeps animating at full frame rate while
 * a Master works through a few hundred simulated shots.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<{ id: number; req: BotPlanRequest }>) => {
  const { id, req } = e.data;
  try {
    // Nothing else runs in this worker, so there is no need to yield while searching.
    const plan = await planBotTurn(req, () => Promise.resolve());
    ctx.postMessage({ id, plan });
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
