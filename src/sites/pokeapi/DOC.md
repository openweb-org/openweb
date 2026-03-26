# PokeAPI

## Overview
PokeAPI — open Pokemon data API. Public REST, no auth.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getPokemon | pokemon by name/ID | GET /api/v2/pokemon/{name} | returns id, name, height, weight, types |
| listPokemon | paginated pokemon list | GET /api/v2/pokemon?limit=&offset= | returns name + url per entry |

## API Architecture
- Public REST API at `pokeapi.co/api/v2/`
- Standard JSON responses, cursor-style pagination via `next`/`previous` URLs

## Auth
- None required

## Transport
- `node` — direct HTTP
