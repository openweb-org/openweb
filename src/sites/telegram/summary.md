# Telegram deleteMessage Reverse Op — Summary

## What was added

One reverse write operation to complement sendMessage:

| New Op | Reverses | Mechanism | Key Params |
|--------|----------|-----------|------------|
| deleteMessage | sendMessage | DOM interaction (right-click, context menu, confirm) | chatId, messageId |

## Files changed

- **openapi.yaml** — new `/internal/messages/delete` POST path with `permission: write`, `safety: caution`, stable_id `tg0007`
- **adapters/telegram-protocol.ts** — `deleteMessage` handler navigates to chat, right-clicks target message by `data-message-id`, selects "Delete" from context menu, confirms deletion
- **examples/deleteMessage.example.json** — `replay_safety: unsafe_mutation`
- **manifest.json** — operation_count 6->7, l3_count 6->7
- **DOC.md** — workflow, operations table row, quick start example, known issues

## Patterns

1. **DOM interaction for write ops**: Like sendMessage, deleteMessage uses DOM automation (right-click, menu click, confirm dialog). This is fragile but necessary since Telegram Web A's internal dispatch (teact actions) requires render context that can't be called from adapter evaluate.
2. **Chat navigation**: The adapter navigates to the target chat via `page.goto(url#chatId)` before interacting. The chat must be loaded with messages visible in the DOM.
3. **Internal state for reads, DOM for writes**: Read ops (getChats, getMessages, etc.) use webpack module walk + getGlobal() for reliable extraction. Write ops use DOM interaction because teact's action dispatch requires the component render cycle.

## Verification status

- `pnpm build` — compiles successfully
- 5/5 read ops: PASS
- sendMessage: skipped (needs chat open in browser)
- deleteMessage: **NOT VERIFIED** — adapter DOM selectors need validation against live Telegram Web A context menu. The right-click context menu structure may differ between desktop viewports and may require selector tuning.

## Known issues / future work

- **Context menu selectors need validation**: The `.MenuItem` selector and text-based "Delete" matching may not match Telegram Web A's actual context menu DOM. Needs live testing with the chat open at the target message.
- **Chat navigation fragility**: `page.goto(url#chatId)` doesn't always open the chat in Telegram Web A — clicking the chat list item is more reliable but requires the chat to be visible in the list.
- **Alternative approach**: A more robust implementation would call Telegram's internal `deleteMessages` action via the teact dispatch system (`require('13439').ko().deleteMessages({messageIds, shouldDeleteForAll})`), but this requires resolving the render-context dependency.
