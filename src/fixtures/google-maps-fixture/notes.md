Google Maps uses internal preview APIs, not the public Maps JavaScript API.

Endpoints: /search?tbm=map (search), /maps/preview/place (details), /maps/preview/directions (routes).
All use protobuf-like `pb` query parameter with `!` delimiters for structured data.
Responses are JSON prefixed with )]}\n (XSS prevention), containing deeply nested arrays (not keyed objects).
No auth needed for public data — no SAPISIDHASH signing required when not logged in.
Chrome-specific headers (x-browser-validation, x-browser-channel) sent automatically by browser.
Compiler cannot handle this site — manual fixture creation required due to pb parameter encoding and nested array responses.
Search response wraps data in {"c":0,"d":"...escaped json..."} — double-parse needed.
Place data lives at response[6] — a 200+ element array with positional fields.
Reviews at [6][31][1], hours at [6][203], coordinates at [6][9][2-3].
