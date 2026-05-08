import { Badge } from "@/components/ui/badge";
import { getTemplates } from "@/lib/data";
import { labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await getTemplates();

  return (
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Fast replies for sales, service, parts, and general store workflows.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {templates.map((template) => (
          <div key={template.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{template.name}</h2>
                <div className="mt-1 flex gap-2">
                  <Badge>{labelize(template.department)}</Badge>
                  <Badge variant={template.active ? "green" : "neutral"}>{template.active ? "Active" : "Inactive"}</Badge>
                </div>
              </div>
            </div>
            <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{template.body}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {(Array.isArray(template.variables) ? template.variables.filter((variable): variable is string => typeof variable === "string") : []).map((variable) => (
                <span key={variable} className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {`{{${variable}}}`}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
