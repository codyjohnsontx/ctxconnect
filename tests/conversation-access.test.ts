import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessConversation, scopedConversationWhere } from "../src/lib/conversation-access";

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
