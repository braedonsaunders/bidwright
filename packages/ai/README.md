# AI Package

This package holds the environment-driven OpenAI client setup and the typed prompt/contract layer used by Bidwright agents.

## Environment

- `OPENAI_API_KEY`
- `OPENAI_ORG_ID`
- `OPENAI_PROJECT_ID`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`

## Design Notes

- Prompts are represented as typed contracts rather than loose strings.
- The worker slice can compose these prompts into reviewable AI workflows later.
