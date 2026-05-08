"use client";

import { useMemo, useState, useTransition } from "react";
import { SendHorizonal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
import type { Department } from "@/generated/prisma/client";

type Template = {
  id: string;
  name: string;
  department: Department;
  body: string;
};

type MessageComposerProps = {
  conversationId: string;
  customerName: string;
  advisorName: string;
  dealershipName: string;
  unit: string;
  department: Department;
  templates: Template[];
  disabled?: boolean;
};

export function MessageComposer({
  conversationId,
  customerName,
  advisorName,
  dealershipName,
  unit,
  department,
  templates,
  disabled,
}: MessageComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const availableTemplates = useMemo(
    () => templates.filter((template) => template.department === department || template.department === "GENERAL"),
    [department, templates],
  );

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);

    if (!template) {
      return;
    }

    setBody(
      template.body
        .replaceAll("{{customerName}}", customerName)
        .replaceAll("{{advisorName}}", advisorName)
        .replaceAll("{{dealershipName}}", dealershipName)
        .replaceAll("{{unit}}", unit)
        .replaceAll("{{appointmentDate}}", "tomorrow morning")
        .replaceAll("{{pickupTime}}", "6:00 PM"),
    );
  }

  async function sendMessage() {
    if (!body.trim()) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Message failed.");
        return;
      }

      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="template">Template</Label>
          <Select id="template" defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
            <option value="">Choose a template</option>
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={disabled ? "Customer is opted out of SMS." : "Type a customer message..."}
          disabled={disabled || isPending}
          className="min-h-20"
        />
        <Button
          size="icon"
          onClick={sendMessage}
          disabled={disabled || isPending || !body.trim()}
          title="Send message"
          className="mt-auto"
        >
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
