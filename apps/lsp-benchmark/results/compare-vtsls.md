# Language tools on real projects

Run 2026-11-19T12:16:53.615Z on linux x64, kept profile, with vtsls chosen in place of the supported tool.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TypeScript | sindresorhus/p-queue | vtsls | yes (6.0 s, downloaded) | yes, 5.2 s | yes, 2.2 s | yes (2 of 2), 2.2 s | yes, 2.2 s | yes (2 of 2), 2.2 s | – |
| JavaScript | expressjs/express | vtsls | yes (0.2 s) | yes, 5.3 s | yes, 2.3 s | yes (2 of 2), 0.3 s | yes, 0.3 s | yes (2 of 2), 2.3 s | – |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### TypeScript: `source/index.ts` in sindresorhus/p-queue@7f272ab5ff

vtsls, installed by Setdown.

- clean: no error
- mistake `const setdownMistake: number = 'three';`: error: Type 'string' is not assignable to type 'number'.; warning: 'setdownMistake' is declared but its value is never read.
- hover `enqueue`: ```typescript (property) enqueue: (run: RunFunction, options?: Partial<EnqueueOptionsType> | undefined) => void ```
- hover `AbortSignal, callback`: ```typescript (loading...) interface AbortSignal ``` The **`AbortSignal`** interface represents a signal object that allows you to communicate with an asynchro…
- completion `this.#queue.deq|`: 6 offered, first: dequeue, enqueue, filter, remove, setPriority, size
- definition `PriorityQueue from './priority-queue.js'`: source/priority-queue.ts:11
- definition `enqueue`: source/queue.ts:7

### JavaScript: `lib/application.js` in expressjs/express@43fca52d28

vtsls, installed by Setdown.

- clean: no error
- mistake `var = ;`: error: Variable declaration expected.
- hover `finalhandler(req, res, {`: ```typescript (loading...) import finalhandler ``` Module dependencies. *@private*
- hover `compileETag(val)`: ```typescript (loading...) import compileETag ```
- completion `this.router.rou|`: 114 offered, first: _locals, all, app, apply, arg, args
- definition `compileETag(val)`: lib/utils.js:130
- definition `finalhandler(req, res, {`: lib/application.js:16
