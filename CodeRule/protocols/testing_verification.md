# Protocol: Testing & Verification

## The "Vibe Check"
Before declaring a feature "Done," the Agent must:
1. **Console Check:** Run the app and ensure 0 errors in the console.
2. **Link Check:** Verify all internal navigation links lead to existing pages.
3. **Contrast Check:** Ensure text is readable against the High-Tech Blue background.

## Automated Testing
- Every Python tool must have a corresponding `test_[tool_name].py` in a `/tests` folder.
- Use `pytest` for running tool validations.
- If a test fails, the Agent must prioritize fixing the tool over adding new features.