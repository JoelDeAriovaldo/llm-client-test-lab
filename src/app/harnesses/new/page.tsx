import { createHarnessAction } from "@/app/actions";
import { HarnessEditor } from "@/components/harness-editor";

export const dynamic = "force-dynamic";

const STARTING_TEMPLATE = `You are an experienced examiner marking a student's exam answer.

Question:
{{stem}}
{{lines}}

Marking scheme:
{{scheme}}

Student's answer:
{{answer}}`;

export default function NewHarnessPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">New Harness</h1>
      <HarnessEditor
        action={createHarnessAction}
        initialTemplate={STARTING_TEMPLATE}
        initialUsesScheme
        submitLabel="Create Harness"
      />
    </>
  );
}
