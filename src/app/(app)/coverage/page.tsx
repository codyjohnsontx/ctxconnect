import { endConversationCoverage, startConversationCoverage } from "@/app/actions";
import { LocalTimestamp } from "@/components/local-timestamp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import {
  canCover,
  canHandOffPermanently,
  canManageCoverage,
  coverageEndRefusal,
  describeCoveredThreads,
} from "@/lib/coverage";
import { getCoverageBoard, type AppUser, type CoverageRow } from "@/lib/data";
import { isManagerOrAdmin } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Who is holding whose conversations, and the two ways that starts and ends.
 *
 * `requireUser` is called here rather than leaned on from the (app) layout.
 * Next does not re-render a shared layout when navigating between routes inside
 * it, so a staff member already standing in the app whose access ended reaches
 * a page guarded only by the layout without anything re-checking. Every page
 * under this segment guards itself; the layout's call is a convenience for the
 * first load, never the proof.
 */
export default async function CoveragePage() {
  const user = await requireUser();
  const board = await getCoverageBoard();
  const mine = board.find((row) => row.id === user.id);
  const floor = board.filter((row) => row.id !== user.id);

  return (
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Coverage</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Open conversations follow the person reading them. Hand yours to an active colleague
          before you go, and take back the quiet ones when you return. Customers are not told -
          this is an internal hand-off.
        </p>
      </div>

      <div className="max-w-3xl space-y-4">
        {mine ? (
          <CoverageCard row={mine} user={user} board={board} heading="Your conversations" mine />
        ) : null}

        {isManagerOrAdmin(user) ? (
          <section>
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              The floor
            </h2>
            <div className="space-y-4">
              {floor.map((row) => (
                <CoverageCard key={row.id} row={row} user={user} board={board} heading={row.name} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One staff member's coverage, and whatever the reader is allowed to do about
 * it. A manager reads the floor without controls; an admin acts on anyone; an
 * advisor acts on herself.
 */
function CoverageCard({
  row,
  user,
  board,
  heading,
  mine = false,
}: {
  row: CoverageRow;
  user: AppUser;
  board: CoverageRow[];
  heading: string;
  mine?: boolean;
}) {
  const mayAct = canManageCoverage(user, row.id);
  const covers = board.filter((candidate) => canCover(row, candidate));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h2 className="font-semibold">{heading}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Badge>{labelize(row.role)}</Badge>
            {row.department ? <Badge>{labelize(row.department)}</Badge> : null}
            {row.active ? null : <Badge variant="red">Inactive</Badge>}
          </div>
        </div>
        <Badge variant={row.coveredBy ? "amber" : "neutral"}>
          {row.coveredBy ? "Covered" : `${row.openConversations} open`}
        </Badge>
      </div>

      <div className="space-y-4 p-4">
        {row.coveredBy ? (
          <CoveredState row={row} mine={mine} />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {mine ? "You are" : `${row.name} is`} holding {row.openConversations} open{" "}
            {row.openConversations === 1 ? "conversation" : "conversations"}.
            {row.active
              ? null
              : " Nobody is reading them while this account is switched off."}
          </p>
        )}

        {row.covering.length > 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Currently covering for {row.covering.map((away) => away.name).join(", ")}.
          </p>
        ) : null}

        {mayAct ? (
          row.coveredBy ? (
            <EndCoverageForm row={row} user={user} mine={mine} />
          ) : (
            <StartCoverageForm row={row} user={user} covers={covers} mine={mine} />
          )
        ) : null}
      </div>
    </section>
  );
}

function CoveredState({ row, mine }: { row: CoverageRow; mine: boolean }) {
  const cover = row.coveredBy;

  if (!cover) {
    return null;
  }

  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-300">
      {describeCoveredThreads(row, cover, row.coveredThreads, mine)}
      {row.coveredSince ? (
        <>
          {" "}
          Covered since <LocalTimestamp value={row.coveredSince} />.
        </>
      ) : null}
    </p>
  );
}

function StartCoverageForm({
  row,
  user,
  covers,
  mine,
}: {
  row: CoverageRow;
  user: AppUser;
  covers: CoverageRow[];
  mine: boolean;
}) {
  if (covers.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Nobody is available to cover. Every other staff account is switched off or away itself.
      </p>
    );
  }

  const permanent = canHandOffPermanently(user);
  const selectId = `cover-${row.id}`;

  return (
    <form action={startConversationCoverage} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <input type="hidden" name="userId" value={row.id} />
      <div className="space-y-1.5">
        <Label htmlFor={selectId}>
          {mine ? "Hand my conversations to" : `Hand ${row.name}'s conversations to`}
        </Label>
        <Select id={selectId} name="coveringUserId" defaultValue={covers[0].id}>
          {covers.map((cover) => (
            <option key={cover.id} value={cover.id}>
              {cover.name}
              {cover.department ? ` - ${labelize(cover.department)}` : ""}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="submit" name="kind" value="temporary">
          While away
        </Button>
        {permanent ? (
          <Button type="submit" name="kind" value="permanent" variant="secondary">
            For good
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function EndCoverageForm({ row, user, mine }: { row: CoverageRow; user: AppUser; mine: boolean }) {
  const cover = row.coveredBy;

  if (!cover) {
    return null;
  }

  // Both refusals come from the same rule the action re-asks, over the same set
  // of accounts, so a button this page offers is never one the action turns into
  // an error page - and the reason printed underneath is the sentence the action
  // would have thrown.
  const landsOn = row.landsOn;
  const notReading = landsOn.find((account) => !account.active);
  const returnRefusal = coverageEndRefusal("return", row, landsOn);
  const keepRefusal = coverageEndRefusal("keep", row, landsOn);
  const mayHandOff = canHandOffPermanently(user);

  // Only about buttons this reader is shown, and only where the hand-back is
  // still off the table: an advisor has no "leave them with" control, so telling
  // her why it is refused replaces the explanation of the one button she has.
  const sentences = [
    returnRefusal,
    mayHandOff ? keepRefusal : null,
    returnRefusal
      ? null
      : notReading
        ? `Anything ${notReading.name} was holding comes back too - that account is switched off, so leaving a conversation there would leave it unread.`
        : `Anything ${cover.name} has already replied to stays with ${cover.name} until it closes - handing a live exchange back would be a second change of voice for the customer. Everything else comes back.`,
  ].filter((sentence) => sentence !== null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={endConversationCoverage}>
          <input type="hidden" name="userId" value={row.id} />
          <Button type="submit" name="outcome" value="return" disabled={returnRefusal !== null}>
            {mine ? "I'm back" : `${row.name} is back`}
          </Button>
        </form>
        {mayHandOff ? (
          <form action={endConversationCoverage}>
            <input type="hidden" name="userId" value={row.id} />
            <Button
              type="submit"
              name="outcome"
              value="keep"
              variant="secondary"
              disabled={keepRefusal !== null}
            >
              Leave them with {cover.name}
            </Button>
          </form>
        ) : null}
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{sentences.join(" ")}</p>
    </div>
  );
}
