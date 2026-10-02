import readline from "node:readline";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function promptYesNo(
  question: string,
  defaultYes = false,
): Promise<boolean> {
  const answer = (await ask(`${question} ${defaultYes ? "(Y/n)" : "(y/N)"} `))
    .trim()
    .toLowerCase();

  if (answer === "") {
    return defaultYes;
  }
  return answer === "y" || answer === "yes";
}

export async function promptInput(
  question: string,
  defaultValue = "",
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await ask(`${question}${suffix}: `)).trim();
  return answer === "" ? defaultValue : answer;
}
