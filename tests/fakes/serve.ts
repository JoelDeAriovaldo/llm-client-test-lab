// Runs both fakes for trying the whole app by hand, with no real keys and nothing permanent.
import { FakeLlmEndpoint } from "./llm-endpoint";
import { FakeMarkingLab } from "./marking-lab";

async function main() {
  const lab = await new FakeMarkingLab().start(Number(process.env.FAKE_LAB_PORT ?? 4010));
  const llm = await new FakeLlmEndpoint().start(Number(process.env.FAKE_LLM_PORT ?? 4011));
  console.log(`Marking Lab: ${lab.url}  Model endpoint: ${llm.url}`);
}

void main();
