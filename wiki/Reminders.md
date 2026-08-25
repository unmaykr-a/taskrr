# Reminders

Taskrr can send an outbound webhook when a task with a routine becomes due, so
you get a nudge in whatever notification system you already use. Reminders are
configured per user.

## What you can point it at

The payload carries several common keys (`title`, `message`, `content`, plus
`task`, `taskId`, `dueAt`), so it works as-is with:

- [ntfy](https://ntfy.sh)
- Gotify
- Apprise
- Home Assistant webhooks
- A Discord webhook (the `content` key)
- Anything that accepts a JSON POST

## Setting it up

In your account's **Reminders** settings:

1. **Enable** reminders.
2. Enter your **webhook URL**.
3. Optionally set a **lead time** - fire the reminder this long *before* the due
   time (0 means at the due time / once overdue).
4. Use **Send test** to post a sample payload and confirm delivery.

A reminder fires once per due cycle. A cycle advances each time the task is
completed, so completing a task resets it for the next interval.

## How the loop works

A single background loop wakes on an interval (`TASKRR_REMINDER_INTERVAL`,
default `1m`) and, for each due task whose recipient has reminders enabled, POSTs
the payload exactly once for that cycle. A failed delivery is logged and retried
on the next tick; a successful one is recorded so it does not fire again for the
same cycle.

Only tasks that have a routine and at least one completion can be due, so a task
with no cadence, or one never logged, never triggers a reminder.

## Shared tasks

For a [shared task](Shared-Tasks), every recipient with a webhook configured -
the owner and each accepted member - is reminded independently. Marking one
recipient reminded does not suppress another; each is tracked per recipient.

## Example payload

```json
{
  "title": "Taskrr reminder",
  "message": "\"Water plants\" is due (overdue by 2h).",
  "content": "\"Water plants\" is due (overdue by 2h).",
  "task": "Water plants",
  "taskId": 12,
  "dueAt": "2026-06-16T09:00:00Z"
}
```

## Security (SSRF protection)

Because the webhook URL is user-supplied, deliveries are constrained:

- The scheme must be `http` or `https`.
- At dial time, on the **resolved IP**, Taskrr refuses to connect to loopback,
  link-local / cloud-metadata (such as `169.254.169.254`), multicast, and the
  unspecified address. A hostname that resolves or rebinds to a blocked address
  is still refused, as are the ways an IPv6-only network can reach the same
  addresses (`::ffff:127.0.0.1`, or `64:ff9b::a9fe:a9fe` through a NAT64
  gateway).
- Redirects are not followed, so a public URL cannot bounce to an internal one.

Private / LAN ranges (RFC 1918, such as `192.168.x.x`, `10.x.x.x`) are
**allowed by default**, because reaching a local ntfy or Home Assistant is the
point. That is the one part of this which is a judgement about your instance
rather than a rule: a webhook asks the server to make a request, so on an
instance where you do not trust every account, it is a way to reach a network the
account holder cannot reach themselves.

Set `TASKRR_WEBHOOK_ALLOW_PRIVATE=false` to close that off - RFC 1918, IPv6
unique-local (`fc00::/7`) and carrier-NAT (`100.64.0.0/10`) addresses are then
refused too, leaving webhooks able to reach only the public internet. The
**Send test** button obeys the same setting, so it never reports success for a
delivery a real reminder could not make.

Webhook URLs are returned only to their owner by the API, and are stripped from
delivery-failure messages in the admin log.

## Not in the demo

Reminder delivery needs a real server, so it is not part of the in-browser demo.
