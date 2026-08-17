/**
 * Filling a canned reply with what Attend actually knows.
 *
 * A template placeholder is one of two things: a detail Attend can answer from
 * the thread (the customer, the advisor, the dealership, the unit), or a detail
 * only the advisor knows (an appointment date, a pickup time). Attend must never
 * guess at the second kind. A texted appointment time reads to the customer as a
 * confirmed fact, and the dealership pays for a wrong one twice - once when the
 * customer shows up at the wrong hour, and again in the trust it costs.
 *
 * So an unanswerable placeholder becomes a visible blank the advisor fills in,
 * and the composer refuses to send while a blank is still there.
 */

/** The thread details Attend can answer without asking. */
export type TemplateContext = {
  customerName: string;
  advisorName: string;
  dealershipName: string;
  /** null when the customer has no vehicle linked. */
  unit: string | null;
};

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

/** "appointmentDate" -> "[appointment date]" */
export function blankFor(variable: string): string {
  const label = variable
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return `[${label || "detail"}]`;
}

function knownValue(variable: string, context: TemplateContext): string | null {
  const value =
    variable === "customerName"
      ? context.customerName
      : variable === "advisorName"
        ? context.advisorName
        : variable === "dealershipName"
          ? context.dealershipName
          : variable === "unit"
            ? context.unit
            : null;

  return value?.trim() ? value.trim() : null;
}

export type FilledTemplate = {
  body: string;
  /** Blanks left for the advisor, in the order they appear, without repeats. */
  blanks: string[];
};

export function fillTemplate(body: string, context: TemplateContext): FilledTemplate {
  const blanks: string[] = [];

  const filled = body.replace(PLACEHOLDER, (_match, variable: string) => {
    const known = knownValue(variable, context);

    if (known) {
      return known;
    }

    const blank = blankFor(variable);

    if (!blanks.includes(blank)) {
      blanks.push(blank);
    }

    return blank;
  });

  return { body: filled, blanks };
}

/**
 * Which of this draft's blanks are still unfilled. Matching against the blanks
 * Attend inserted - rather than anything in brackets - keeps an advisor's own
 * "[see photo]" from being mistaken for an unfinished template.
 */
export function remainingBlanks(body: string, blanks: string[]): string[] {
  return blanks.filter((blank) => body.includes(blank));
}

/** "[a]", "[a] and [b]", "[a], [b] and [c]" */
export function listBlanks(blanks: string[]): string {
  if (blanks.length < 2) {
    return blanks[0] ?? "";
  }

  return `${blanks.slice(0, -1).join(", ")} and ${blanks[blanks.length - 1]}`;
}
