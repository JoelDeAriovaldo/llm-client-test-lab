# LLM Client Test Lab

A personal workbench for testing how well LLM models mark exam answers. See `GLOSSARY.md` for the language and `docs/adr/` for key decisions.

```bash
cp .env.example .env.local   # then fill in your keys
npm install
npm run dev                  # web app and worker, on http://127.0.0.1:3000
```

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

Local data lives in `data/lab.db`, which holds student Answers and is gitignored.
