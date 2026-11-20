# Language tools on real projects

Run 2026-11-20T14:36:14.362Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code | Its extension's requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Java | spring-projects/spring-petclinic | jdtls | yes (470.6 s, downloaded) | yes, 312.2 s | yes, 303.3 s | yes (2 of 2), 309.2 s | yes, 309.2 s | yes (2 of 2), 309.2 s | – | yes, 302.3 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Java: `src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java` in spring-projects/spring-petclinic@500158f732

jdtls, installed by Setdown.

- clean: no error
- mistake `class SetdownMistake { int value = "three"; }`: error: Type mismatch: cannot convert from String to int
- hover `findByLastNameStartingWith`: Page<Owner> org.springframework.samples.petclinic.owner.OwnerRepository.findByLastNameStartingWith(String lastName, Pageable pageable) Retrieve [Owner](file://…
- hover `BindingResult`: org.springframework.validation.BindingResult General interface that represents binding results. Extends the [Errors](file:///tmp/jdtls_decompiled/session_5562c…
- completion `return owners.findByLastNameSta|`: 1 offered, first: findByLastNameStartingWith
- definition `findByLastNameStartingWith`: src/main/java/org/springframework/samples/petclinic/owner/OwnerRepository.java:45
- definition `Owner`: src/main/java/org/springframework/samples/petclinic/owner/Owner.java:50
- own `build the workspace`: 1
