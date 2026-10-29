# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook reading hierarchy keeps content, actions and focus distinct, including narrow split panes
- Location: test/e2e/notebook/notebook.spec.ts:17:1

# Error details

```
Error: locator.evaluate: TypeError: Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.
    at eval (eval at evaluate (:311:30), <anonymous>:14:28)
    at UtilityScript.evaluate (<anonymous>:313:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
```