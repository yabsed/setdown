# Language tools on real projects

Run 2026-11-20T14:39:09.579Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code | Its extension's requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kotlin | spring-guides/tut-spring-boot-kotlin | kotlin-lsp | yes (3.3 s) | yes, 8.3 s | yes, 5.2 s | yes (2 of 2), 2.9 s | yes, 3.5 s | yes (2 of 2), 3.5 s | – | yes, 3.6 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Kotlin: `src/main/kotlin/com/example/blog/HttpControllers.kt` in spring-guides/tut-spring-boot-kotlin@4b45a63b46

kotlin-lsp, chosen program.

- clean: no error
- mistake `val setdownMistake: Int = "three"`: error: Initializer type mismatch: expected 'Int', actual 'String'.; warning: Might be 'const'
- hover `ResponseStatusException(NOT_FOUND, "This article`: From class: [`org.springframework.web.server.ResponseStatusException`](command:jetbrains.navigateToLocation?%5B%22jar%3A%2F%2F%2Fhome%2Fyabsed%2F.gradle%2Fcach…
- hover `findBySlug`: ````kotlin fun findBySlug(slug: String): Article? ````
- completion `repository.findByLog|`: 1 offered, first: findByLogin
- definition `findBySlug`: src/main/kotlin/com/example/blog/Repositories.kt:6
- definition `User`: src/main/kotlin/com/example/blog/Entities.kt:23
- own `the tests of this class`: {"isTest":false,"targets":[],"sourceName":"ArticleController"}
