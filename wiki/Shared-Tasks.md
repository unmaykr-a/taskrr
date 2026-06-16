# Shared Tasks

Sharing lets two or more users see and log the same task - useful for a chore a
household or team splits. The task stays a single record; members are attached to
it, so everyone sees the same history and "who did it last".

## Enabling sharing (admin)

Sharing is gated by an instance setting, **Task sharing**, in the admin settings
(the `tasks_shareable` setting). While it is off, the share controls are hidden
and the server refuses new shares. An admin must turn it on before anyone can
share. See the [Admin Guide](Admin-Guide).

## How sharing works

1. **Invite.** The owner invites another user by username. The invite waits as a
   pending request.
2. **Respond.** The recipient sees it in their **Requests** view, which shows a
   calm accent pulse when something is waiting, and can **accept** or **decline**.
3. **Collaborate.** Once accepted, the member can view the task, log completions,
   and see the full history. Each completion records who logged it, and the card
   shows who logged last.

Only **accepted** membership counts: a task is badged as shared, appears for the
member, and generates reminders for the member only after the invite is accepted -
a pending invite alone does none of these.

## Who can do what

- **Owner** - edits and archives the task definition, invites members, and has
  full control.
- **Member** (accepted) - views the task, logs completions, edits their own
  completions, and can leave at any time.
- A completion can be edited or deleted by the **task owner** or by **whoever
  logged it**.

## Opting out of shares

Each user can opt out of receiving shares in their account settings. When opted
out, others cannot send them new share invites. This is enforced on the server,
not just hidden in the UI.

## Deletion is non-destructive

Sharing makes "delete" safe for collaborators:

- A **member** who deletes the task simply **leaves** it - their membership is
  removed; the task and its history persist for everyone else.
- When the **owner** deletes a task that still has accepted members, **ownership
  transfers** to the earliest member, so the task and its complete history are
  never lost.
- Only when the owner deletes a task with **no** accepted members is the task
  actually removed (along with its completions and any pending invitations).

## Reminders for shared tasks

If a shared task has a routine, every recipient who has reminders configured -
the owner and each accepted member - is reminded independently for their own due
cycle. See [Reminders](Reminders).

## Not in the demo

Sharing needs a second user and a real server, so it is not available in the
in-browser [demo](https://unmaykr-a.github.io/taskrr/).
