export async function runLimited<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<(T | undefined)[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: (T | undefined)[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= tasks.length) {
        break;
      }

      const task = tasks[current];
      if (!task) {
        continue;
      }

      try {
        results[current] = await task();
      } catch (err) {
        console.error(`Task ${current} failed:`, err);
        results[current] = undefined;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}
