# WhatsApp Web — Progress

## 2026-03-25: WS Exploration

### Wire-level capture
- 30s passive capture: 288 frames, **100% binary** (opcode 2), zero JSON
- Frame sizes: 44B–54KB, median 84B
- Signal Protocol end-to-end encryption — pipeline `ws-load.ts` skips all frames
- **Wire-level WS capture is not viable**

### Store-level breakthrough
- Discovered Metro-style module system: `require('WAWeb*')` with string IDs
- Note: `webpackChunkwhatsapp_web_client.push` is `[native code]` — classic webpack injection does NOT work
- Accessed 42 chats, 2,253 contacts, decrypted messages via `page.evaluate()`
- Successfully sent 3 test messages to safe contact, verified delivery (ack=1)

### Current status
- HTTP adapter exists (openapi.yaml with existing operations)
- WS capture blocked by encryption — needs Store-level capture adapter
- Store-level access proven viable but not yet integrated into pipeline

### Next steps
- Design Store-level capture adapter that converts WhatsApp Store data → JSONL
- Consider: is this a WhatsApp-specific adapter, or a general pattern for encrypted-WS sites?
