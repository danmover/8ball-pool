import { planBotTurn, type BotPlan, type BotPlanRequest } from '@8ball/shared';

/**
 * Runs bot turns in a Web Worker, falling back to the main thread (with the search yielding
 * between candidates) where workers aren't available.
 */
export function createBotRunner(): { run: (req: BotPlanRequest) => Promise<BotPlan>; dispose: () => void } {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  let nextId = 1;
  const pending = new Map<number, { resolve: (p: BotPlan) => void; reject: (e: Error) => void }>();

  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; plan?: BotPlan; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.plan) p.resolve(e.data.plan);
      else p.reject(new Error(e.data.error ?? 'bot failed'));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('bot worker crashed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }

  return {
    run(req) {
      if (!worker) return planBotTurn(req, () => new Promise((r) => setTimeout(r, 0)));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ id, req });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
