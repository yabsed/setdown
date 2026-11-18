# Language tools on real projects

Run 2026-11-18T20:03:10.102Z on linux x64, kept profile, with kotlin-lsp chosen in place of the supported tool.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kotlin | spring-guides/tut-spring-boot-kotlin | kotlin-lsp | yes (2.7 s) | yes, 52.8 s | yes, 49.7 s | yes (2 of 2), 38.9 s | yes, 31.6 s | yes (2 of 2), 31.7 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Kotlin: `src/main/kotlin/com/example/blog/HttpControllers.kt` in spring-guides/tut-spring-boot-kotlin@4b45a63b46

kotlin-lsp, chosen program.

- the tool asked: "Build tool conflicts are detected in workspace. Which one would you like to use?" (Use Gradle / Use Maven / Configure…): answered Use Gradle
- clean: no error
- mistake `val setdownMistake: Int = "three"`: error: Initializer type mismatch: expected 'Int', actual 'String'.; warning: Might be 'const'
- hover `ResponseStatusException(NOT_FOUND, "This article`: From class: [`org.springframework.web.server.ResponseStatusException`](command:jetbrains.navigateToLocation?%5B%22jar%3A%2F%2F%2Fhome%2Fyabsed%2F.gradle%2Fcach…
- hover `findBySlug`: ````kotlin fun findBySlug(slug: String): Article? ````
- completion `repository.findByLog|`: 1 offered, first: findByLogin
- definition `findBySlug`: src/main/kotlin/com/example/blog/Repositories.kt:6
- definition `User`: src/main/kotlin/com/example/blog/Entities.kt:23
