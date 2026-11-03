import { asc } from "drizzle-orm";
import { saveConnectionAction, testConnectionAction } from "@/app/actions";
import { ActionForm, selectClass } from "@/components/form-bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb } from "@/lib/db";
import { connections } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Connection = typeof connections.$inferSelect;

function ConnectionFields({ connection }: { connection?: Connection }) {
  const key = connection?.id ?? "new";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {connection && <input type="hidden" name="id" value={connection.id} />}
      <div className="space-y-1.5">
        <Label htmlFor={`name-${key}`}>Name</Label>
        <Input id={`name-${key}`} name="name" defaultValue={connection?.name} placeholder="OpenRouter" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`url-${key}`}>Base URL</Label>
        <Input id={`url-${key}`} name="baseUrl" defaultValue={connection?.baseUrl} placeholder="https://openrouter.ai/api/v1" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`env-${key}`}>Name of the key&apos;s environment variable</Label>
        <Input id={`env-${key}`} name="apiKeyEnvVar" defaultValue={connection?.apiKeyEnvVar ?? ""} placeholder="OPENROUTER_API_KEY" autoComplete="off" />
        <p className="text-xs text-muted-foreground">The key stays in .env.local. Leave this empty for local servers with no key.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`loc-${key}`}>Where it runs</Label>
          <select id={`loc-${key}`} name="locality" defaultValue={connection?.locality ?? "cloud"} className={selectClass}>
            <option value="cloud">Cloud</option>
            <option value="local">Local</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`con-${key}`}>Concurrency</Label>
          <Input id={`con-${key}`} name="concurrency" type="number" min={1} defaultValue={connection?.concurrency ?? 5} required />
        </div>
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  const rows = getDb().select().from(connections).orderBy(asc(connections.name)).all();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="text-sm text-muted-foreground">OpenAI-compatible endpoints the app can call Models through.</p>
      </div>
      {rows.map((connection) => {
        const keyMissing = connection.apiKeyEnvVar && !process.env[connection.apiKeyEnvVar];
        return (
          <Card key={connection.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {connection.name}
                <Badge variant="outline">{connection.locality === "local" ? "Local" : "Cloud"}</Badge>
                {keyMissing && <Badge variant="destructive">{connection.apiKeyEnvVar} isn&apos;t set</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ActionForm action={saveConnectionAction} submitLabel="Save" variant="outline">
                <ConnectionFields connection={connection} />
              </ActionForm>
              <ActionForm action={testConnectionAction} submitLabel="Test connection" variant="outline">
                <input type="hidden" name="id" value={connection.id} />
              </ActionForm>
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardHeader>
          <CardTitle>Add a Connection</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveConnectionAction} submitLabel="Add Connection">
            <ConnectionFields />
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
