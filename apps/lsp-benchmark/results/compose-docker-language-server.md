# Language tools on real projects

Run 2026-11-18T18:52:22.864Z on linux x64, kept profile, with docker-language-server chosen in place of the supported tool.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker Compose | docker/awesome-compose | docker-language-server | yes (47.5 s, downloaded) | unknown | NO | yes (2 of 2), 0.0 s | NO | – |

2 expectations were not met: dockercompose: mistake; dockercompose: completion at healthch|.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Docker Compose: `nginx-flask-mysql/compose.yaml` in docker/awesome-compose@30f4b7f6a6

docker-language-server, installed by Setdown.

- clean (unknown): no error, but the tool reported nothing at all
- mistake `setdown_mistake: 1` (NOT as expected: the added line is marked): not marked
- hover `healthcheck:`: Configuration options to determine whether the container is healthy. Schema: [compose-spec.json](https://raw.githubusercontent.com/compose-spec/compose-spec/ma…
- hover `depends_on:`: Express dependency between services. Service dependencies cause services to be started in dependency order. The dependent service will wait for the dependency …
- completion `healthch|` (NOT as expected: "healthcheck" offered): 7 offered, first: disable, interval, retries, start_interval, start_period, test
