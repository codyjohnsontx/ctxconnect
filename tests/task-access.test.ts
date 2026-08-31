import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canUpdateTask, scopedTaskWhere } from "../src/lib/task-access";

// A follow-up can now be finished and moved from the conversation as well as
// from the Tasks page, so two more surfaces render a button whose write the
// server may refuse. These pin the rule both sides read: a follow-up the queue
// query shows a staff member is one she may also act on, and a follow-up owned
// by another department offers her nothing to press.

const advisor = { id: "advisor-1", role: "SERVICE", department: "SERVICE" };
const manager = { id: "manager-1", role: "MANAGER", department: "GENERAL" };
const admin = { id: "admin-1", role: "ADMIN", department: "GENERAL" };
const contractor = { id: "contractor-1", role: "SALES", department: null };

const departments = ["SALES", "SERVICE", "PARTS", "FINANCE", "GENERAL"] as const;

describe("canUpdateTask", () => {
  it("lets an advisor close her own department's follow-up", () => {
    assert.equal(canUpdateTask(advisor, { assignedUserId: null, department: "SERVICE" }), true);
  });

  it("lets an advisor close another department's follow-up assigned to her", () => {
    assert.equal(canUpdateTask(advisor, { assignedUserId: advisor.id, department: "PARTS" }), true);
  });

  // A thread's follow-up list is not scoped by the reader, so a service thread
  // can carry a parts follow-up. Offering her the button would turn one click
  // into "Task not found or access denied."
  it("refuses another department's follow-up she is not on", () => {
    assert.equal(
      canUpdateTask(advisor, { assignedUserId: "someone-else", department: "PARTS" }),
      false,
    );
  });

  it("lets a manager and an admin move anything along", () => {
    const partsFollowUp = { assignedUserId: "someone-else", department: "PARTS" };
    assert.equal(canUpdateTask(manager, partsFollowUp), true);
    assert.equal(canUpdateTask(admin, partsFollowUp), true);
  });

  // A staff member with no department must not inherit every follow-up that
  // also has no department recorded, which a bare equality check would do.
  it("does not hand a departmentless account a departmentless follow-up", () => {
    assert.equal(canUpdateTask(contractor, { assignedUserId: null, department: "" }), false);
  });
});

// The Tasks page and the thread's follow-up list both render from rows the
// queue filter selected, and both then ask the access rule whether to offer a
// button. If the two ever disagree, she either sees a follow-up she cannot
// touch or loses one she owns.
describe("the follow-up filter and the access rule agree", () => {
  function queueWouldShow(
    user: { id: string; role: string; department: string | null },
    task: { assignedUserId: string | null; department: string },
  ) {
    const where = scopedTaskWhere(user);

    if (!where.OR) {
      return true;
    }

    return where.OR.some(
      (filter) =>
        ("assignedUserId" in filter && task.assignedUserId === filter.assignedUserId) ||
        ("department" in filter && task.department === filter.department),
    );
  }

  it("matches for every reader, department and assignee combination", () => {
    for (const user of [advisor, manager, admin, contractor]) {
      for (const department of departments) {
        for (const assignedUserId of [null, user.id, "someone-else"]) {
          const task = { assignedUserId, department };
          assert.equal(
            canUpdateTask(user, task),
            queueWouldShow(user, task),
            `${user.role} on a ${department} follow-up assigned to ${assignedUserId ?? "nobody"}`,
          );
        }
      }
    }
  });
});
