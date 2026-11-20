// The projects the benchmark opens files from: real repositories on GitHub, each at one
// fixed commit so that a run next month reads the same code. `setup` is what a person does
// once before working on the project (install its libraries, let the build describe itself);
// the benchmark never does more for a tool than that.
export const projects = {
  flask: { repo: 'pallets/flask', commit: '49943b5a94413a530761350f04e896f76e8d620e',
    setup: ['uv venv --clear .venv', 'uv pip install --python .venv/bin/python -e ".[async,dotenv]"'] },
  // A Poetry project: `poetry install` puts its environment in Poetry's own folder under the
  // home folder (~/.cache/pypoetry/virtualenvs/cleo-…), not in the project.
  cleo: { repo: 'python-poetry/cleo', commit: '30df50748e7cf52195cf2f22262b432e6320fe21',
    setup: ['uvx --from "poetry>=2,<3" poetry install --no-interaction --only test'] },
  'p-queue': { repo: 'sindresorhus/p-queue', commit: '7f272ab5ff2254c0dc2537b7977e88ede1cd55e8',
    setup: ['npm install --ignore-scripts --no-audit --no-fund'] },
  express: { repo: 'expressjs/express', commit: '43fca52d28a422c8be48fd489cbd4f2d6152bab6',
    setup: ['npm install --ignore-scripts --no-audit --no-fund --omit=dev'] },
  realworld: { repo: 'sveltejs/realworld', commit: 'df796708040f5200ec572b28ab7f88ecee5794dd',
    setup: ['npm install --ignore-scripts --no-audit --no-fund', 'npx svelte-kit sync'] },
  cjson: { repo: 'DaveGamble/cJSON', commit: '6d9f2443ab071f86e5d9b43025a40929ec41c46c',
    setup: ['cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON'] },
  fmt: { repo: 'fmtlib/fmt', commit: '14ac0d5a9d40aef14f50954069c1e10971abb0b2',
    setup: ['cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DFMT_DOC=OFF'] },
  walkdir: { repo: 'BurntSushi/walkdir', commit: '6fd031c82ba5a4204b4ce6eae73dacb00dc072ec',
    setup: ['cargo fetch'] },
  cobra: { repo: 'spf13/cobra', commit: 'adbc8813901bba65827259daa8e22ff94ec1f30e',
    setup: ['go mod download'] },
  fastroute: { repo: 'nikic/FastRoute', commit: '1c961398bef1ff6ecd8b273bef651d7afe90312b' },
  petclinic: { repo: 'spring-projects/spring-petclinic', commit: '500158f732419217507c7656904b8e6aa1bcc0d6' },
  'spring-kotlin': { repo: 'spring-guides/tut-spring-boot-kotlin', commit: '4b45a63b466397fe9896447ceb6a48e7c635f16b' },
  compose: { repo: 'docker/awesome-compose', commit: '30f4b7f6a6c3b0c0ecf4d4efb0de203c48d11562' },
  pico: { repo: 'picocss/pico', commit: 'a07563ddc856e6ed31a740e33b0397814227d469' },
  bootstrap3: { repo: 'twbs/bootstrap', commit: '68b0d231a13201eb14acd3dc84e51543d16e5f7e' },
  boilerplate: { repo: 'h5bp/html5-boilerplate', commit: '7fa0bd6c9e6818d11a1a7efad56fe715ae56d848' },
};
