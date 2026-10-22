# Keep the same Jira ticket when an item is deleted and restored

## Root cause (confirmed from this morning's data)
When you delete an item in Agilefant, the sync deletes its Jira ticket for good. Jira can't bring a deleted ticket back. So when you restore the item, the sync can only create a new ticket, and Jira gives it the next free number (INT-14 was deleted, then INT-15 was created). The item does come back, but as a different ticket without the old comments and history.

## Change
- Deleting an item in Agilefant stops deleting its Jira ticket. The ticket is moved to Done instead and gets an `agilefant-removed` label.
- Restoring the item reopens that same ticket. Its status goes back to the item's status and the label is removed.
- Restored items keep their original ticket number, comments and history.
- Tickets deleted in Jira are still deleted in Agilefant, as they are now.
- Restoring an item whose ticket was already deleted under the old rule still creates a new ticket.

## Technical details
- `jiraEngine.ts`: in `deleteInJira`, items that are deleted or have left the list are retired instead: transition to Done, add the label, and keep the link marked `retired`. `syncItem` and `fullSync` treat a retired link whose item is back on the list as a pair to reconcile. That pair reopens the ticket, removes the label and pushes the current fields.
- `jiraApi.ts`: add a way to set labels, plus a transition to the ticket's Done status.
- Store the retired flag in the saved sync state (`agreed`), so no database change is needed.
- Add engine tests: delete retires the ticket and never calls deleteIssue; restore reuses the same issue id and key.
- Run `bun run typecheck:functions`, then deploy jira-sync.
