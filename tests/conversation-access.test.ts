import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessConversation,
  describeOtherDepartments,
  scopedConversationWhere,
  unreachableDepartments,
} from "../src/lib/conversation-access";

// Routing a thread to another department is a normal hand-off and it is the one
// save that can take the thread away from the advisor making it. Three surfaces
// have to agree about that: the query that builds her queue, the guard the
// server action runs, and the warning the controls panel shows before the
// click. These pin that agreement - a thread the queue would show her must be
// one the guard admits, and a change the panel calls safe must leave her able to
// open the thread afterwards.

const advisor = { id: "advisor-1", role: "SERVICE", department: "SERVICE" };
const manager = { id: "manager-1", role: "MANAGER", department: "GENERAL" };
const admin = { id: "admin-1", role: "ADMIN", department: "GENERAL" };
const contractor = { id: "contractor-1", role: "SALES", department: null };

const departments = ["SALES", "SERVICE", "PARTS", "FINANCE", "GENERAL"] as const;

describe("canAccessConversation", () => {
  it("lets an advisor open her own department's thread", () => {
    assert.equal(canAccessConversation(advisor, { assignedUserId: null, department: "SERVICE" }), true);
  });

  it("lets an advisor open another department's thread assigned to her", () => {
    assert.equal(
      canAccessConversation(advisor, { assignedUserId: advisor.id, department: "PARTS" }),
      true,
    );
  });

  it("refuses another department's thread she is not on", () => {
    assert.equal(
      canAccessConversation(advisor, { assignedUserId: "someone-else", department: "PARTS" }),
      false,
    );
  });

  it("lets a manager and an admin open anything", () => {
    const partsThread = { assignedUserId: "someone-else", department: "PARTS" };
    assert.equal(canAccessConversation(manager, partsThread), true);
    assert.equal(canAccessConversation(admin, partsThread), true);
  });

  // A staff member with no department must not inherit every thread that also
  // has no department recorded, which a bare equality check would do.
  it("does not hand a departmentless account a departmentless thread", () => {
    assert.equal(canAccessConversation(contractor, { assignedUserId: null, department: "" }), false);
    assert.equal(
      canAccessConversation({ ...contractor, department: "" }, { assignedUserId: null, department: "" }),
      false,
    );
  });
});

// The panel warns before a hand-off by asking this rule what the pending change
// would mean. The queue is built by a Prisma filter that answers the same
// question in a different shape; if they ever disagree the advisor either gets a
// warning about a thread she keeps, or loses one with no warning at all.
describe("the queue filter and the access rule agree", () => {
  function queueWouldShow(
    user: { id: string; role: string; department: string | null },
    conversation: { assignedUserId: string | null; department: string },
  ) {
    const where = scopedConversationWhere(user);

    if (!where.OR) {
      return true;
    }

    return where.OR.some(
      (filter) =>
        ("assignedUserId" in filter && conversation.assignedUserId === filter.assignedUserId) ||
        ("department" in filter && conversation.department === filter.department),
    );
  }

  it("matches for every reader, department and assignee combination", () => {
    for (const user of [advisor, manager, admin, contractor]) {
      for (const department of departments) {
        for (const assignedUserId of [null, user.id, "someone-else"]) {
          const conversation = { assignedUserId, department };
          assert.equal(
            canAccessConversation(user, conversation),
            queueWouldShow(user, conversation),
            `${user.role} on a ${department} thread assigned to ${assignedUserId ?? "nobody"}`,
          );
        }
      }
    }
  });
});

// The Customers page links each row at one of that customer's threads. The
// newest one overall can belong to a department the reader cannot open, and
// that link used to land on a bare 404 - so the row now opens the newest thread
// she can read, and says which departments hold the rest.
describe("unreachableDepartments", () => {
  it("names a department holding a thread she cannot open", () => {
    assert.deepEqual(
      unreachableDepartments(advisor, [
        { assignedUserId: null, department: "PARTS" },
        { assignedUserId: null, department: "SERVICE" },
      ]),
      ["PARTS"],
    );
  });

  it("keeps the order the threads arrived in and names each department once", () => {
    assert.deepEqual(
      unreachableDepartments(advisor, [
        { assignedUserId: null, department: "SALES" },
        { assignedUserId: null, department: "PARTS" },
        { assignedUserId: "someone-else", department: "SALES" },
      ]),
      ["SALES", "PARTS"],
    );
  });

  // The unassigned case is the one a negated SQL clause loses: `NOT
  // (assignedUserId = x OR department = y)` is unknown rather than true for a
  // null, so exactly the unclaimed threads would go unreported.
  it("reports an unclaimed thread in another department", () => {
    assert.deepEqual(
      unreachableDepartments(advisor, [{ assignedUserId: null, department: "PARTS" }]),
      ["PARTS"],
    );
  });

  it("says nothing about a thread assigned to her, wherever it lives", () => {
    assert.deepEqual(
      unreachableDepartments(advisor, [{ assignedUserId: advisor.id, department: "PARTS" }]),
      [],
    );
  });

  it("has nothing to report to a manager or an admin", () => {
    const threads = [
      { assignedUserId: null, department: "PARTS" },
      { assignedUserId: "someone-else", department: "SALES" },
    ];

    assert.deepEqual(unreachableDepartments(manager, threads), []);
    assert.deepEqual(unreachableDepartments(admin, threads), []);
  });

  // Whatever this reports, the reader cannot open. If the two ever disagreed
  // the page would either name a department she can reach or hide one she
  // cannot, and the second is the 404 this exists to remove.
  it("never names a thread the access rule would let her open", () => {
    for (const user of [advisor, manager, admin, contractor]) {
      for (const department of departments) {
        for (const assignedUserId of [null, user.id, "someone-else"]) {
          const conversation = { assignedUserId, department };
          const named = unreachableDepartments(user, [conversation]).length > 0;

          assert.equal(
            named,
            !canAccessConversation(user, conversation),
            `${user.role} on a ${department} thread assigned to ${assignedUserId ?? "nobody"}`,
          );
        }
      }
    }
  });
});

describe("describeOtherDepartments", () => {
  it("says nothing when there is nothing to say", () => {
    assert.equal(describeOtherDepartments([]), null);
  });

  it("names one, two and three departments the way a person would", () => {
    assert.equal(describeOtherDepartments(["PARTS"]), "Also with Parts");
    assert.equal(describeOtherDepartments(["PARTS", "SALES"]), "Also with Parts and Sales");
    assert.equal(
      describeOtherDepartments(["PARTS", "SALES", "FINANCE"]),
      "Also with Parts, Sales and Finance",
    );
  });

  // She is not allowed to read those threads, so the line names the department
  // and nothing else - no status, no assignee, nothing said in them.
  it("carries no detail beyond the department name", () => {
    const line = describeOtherDepartments(["PARTS"]) ?? "";

    for (const leak of ["Waiting", "assigned", "Open", "message"]) {
      assert.equal(line.includes(leak), false, `the line should not say ${leak}`);
    }
  });
});
