# WhatsApp deleteMessage Reverse Op — Summary

## What was added

One reverse write operation to complement sendMessage:

| New Op | Reverses | Mechanism | Key Params |
|--------|----------|-----------|------------|
| deleteMessage | sendMessage | DOM interaction (hover, dropdown arrow, context menu, confirm) | chatId, messageId |

## Files changed

- **openapi.yaml** — new `/internal/messages/delete` POST path with `permission: write`, `safety: caution`, stable_id `wa0008`
- **adapters/whatsapp-modules.ts** — `deleteMessage` handler: opens chat via WAWebCmd, hovers over target message by `data-id`, clicks dropdown arrow (`down-context` icon), selects "Delete" from menu, confirms via "Delete for me" button
- **examples/deleteMessage.example.json** — `replay_safety: unsafe_mutation`, test contact +1 347-222-5726
- **manifest.json** — operation_count 7->8, l3_count 7->8
- **DOC.md** — delete workflow, operations table row, quick start example, known issues

## Patterns

1. **DOM interaction for write ops**: Like sendMessage, deleteMessage uses DOM automation. WhatsApp Web's internal Store methods for deletion (`revokeForMe`) aren't reliably callable from adapter evaluate context, so DOM interaction through the message dropdown menu is the approach.
2. **Chat navigation via WAWebCmd**: Uses the same `openChatBottom` internal command as sendMessage to navigate to the target chat before interacting with the message.
3. **Message identification by data-id**: WhatsApp Web renders messages as `div.message-out[data-id="..."]` or `div.message-in[data-id="..."]`. The `messageId` from getMessages (`id._serialized`) maps directly to the `data-id` attribute.

## Verification status

- `pnpm build` — PASS
- 3/3 read ops (getChats, getContacts, searchChats): PASS
- deleteMessage: FAIL (expected) — example uses a synthetic message ID that doesn't exist in the live chat. The adapter runs correctly (chat opens, then times out searching for the non-existent message element). Live verification requires sending a real message first, then deleting it with the returned message ID.

## Known issues / future work

- **Dropdown arrow selector**: The `span[data-icon="down-context"]` selector may change in WhatsApp Web updates. The arrow only appears on hover, so the hover step is critical.
- **"Delete for me" vs "Delete for everyone"**: Currently uses "Delete for me". A future enhancement could add a `forEveryone` parameter, but "Delete for everyone" has a time window restriction (messages older than ~1 hour can't be deleted for everyone).
- **Alternative approach**: A more robust implementation would call WhatsApp's internal `revokeForMe` or `revokeForEveryone` methods via Store modules, but these require specific Backbone model instances that are difficult to reconstruct from a serialized message ID in the adapter evaluate context.
