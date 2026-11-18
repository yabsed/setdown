# Language tools on real projects

Run 2026-11-18T18:52:29.528Z on linux x64, kept profile, with yaml-language-server chosen in place of the supported tool.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker Compose | docker/awesome-compose | yaml-language-server | yes (0.6 s) | yes, 5.1 s | yes, 2.0 s | yes (2 of 2), 2.1 s | yes, 2.1 s | – |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Docker Compose: `nginx-flask-mysql/compose.yaml` in docker/awesome-compose@30f4b7f6a6

yaml-language-server, installed by Setdown.

- clean: no error
- mistake `setdown_mistake: 1`: error: Property setdown_mistake is not allowed.
- hover `healthcheck:`: #### docker-compose.yml Configure a health check for the container to monitor its health status. Source: [compose-spec.json](https://raw.githubusercontent.com/…
- hover `depends_on:`: #### docker-compose.yml Express dependency between services. Service dependencies cause services to be started in dependency order. The dependent service will …
- completion `healthch|`: 86 offered, first: annotations, blkio_config, cap_add, cap_drop, cgroup, cgroup_parent
