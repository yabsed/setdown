# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/themes.spec.ts >> moving a live themed tab to another window retains its resource bridge and page identity
- Location: test/e2e/browser/themes.spec.ts:111:1

# Error details

```
Error: electronApplication.evaluate: Error: Web page not found
    at eval (eval at evaluate (:311:30), <anonymous>:8:22)
    at UtilityScript.evaluate (<anonymous>:313:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
    at Session.emit (node:events:489:44)
```