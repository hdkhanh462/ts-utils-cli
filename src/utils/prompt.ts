export async function promptYesNo(question: string): Promise<boolean> {
  const fr = await import("node:readline");
  const rl = fr.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
