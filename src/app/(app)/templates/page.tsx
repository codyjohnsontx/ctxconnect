import { Badge } from "@/components/ui/badge";
import { getTemplates } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireUser();
  const templates = await getTemplates();

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-600 font-semibold tracking-tight">Templates</h1>
      <div className="grid gap-3 lg:grid-cols-2">
        {templates.map((template) => (
          // The same card as a follow-up: the name with its labels on one line,
          // the text under it, and the blanks it asks for as neutral badges.
          <div key={template.id} className="rounded-md border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{template.name}</h2>
              <Badge>{labelize(template.department)}</Badge>
              <Badge variant={template.active ? "success" : "neutral"}>{template.active ? "Active" : "Inactive"}</Badge>
            </div>
            <p className="mt-2 text-text-muted">{template.body}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {(Array.isArray(template.variables) ? template.variables.filter((variable): variable is string => typeof variable === "string") : []).map((variable) => (
                <Badge key={variable} className="font-mono">
                  {`{{${variable}}}`}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
