# Protocol: Code Hygiene & Documentation

## General Rules
- **Naming:** Use `snake_case` for Python and `camelCase` for JavaScript.
- **Self-Documentation:** Functions must have a one-line comment explaining the *intent*, not just the action.
- **No Hardcoding:** API keys, endpoints, or "magic numbers" must stay in `.env` files.

## Logic Flow
- **Error Handling:** Every tool must use `try-except` (Python) or `try-catch` (JS) blocks. 
- **Validation:** Tools must validate inputs before processing. (e.g., check if a URL is valid before scraping).
- **Cleanup:** Tools that create temporary files (like `temp/`) must include a cleanup sequence to delete them after execution.

## 🧼 Refinement Protocol: Logic Recycling
- **The "Library First" Rule:** Before writing a new utility function, search `src/lib/` for reusable code.
- **Dependency Audit:** If a feature requires a new `npm` package, justify why an existing one in `package.json` won't work.
- **Prop Drilling:** For UI refinements, use Context Providers or Signals. Do not pass props down more than 3 levels.
- **Naming Alignment:** New features must match existing naming conventions (e.g., if the project uses `handle_submit`, do not use `onSubmit`).