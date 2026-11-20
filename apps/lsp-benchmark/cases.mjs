// One case opens one file of a real project (projects.mjs) and states what a person
// working on it expects to see. A place is named by the text found there:
//   at        text that occurs in the file; the question is asked at its first letter,
//             or at the first letter of `on` when only a part of the text is meant
//   after     text the caret sits right behind, at its last occurrence in the file
// The questions:
//   mistake     a line added at the end of the file, as if just typed; it must be marked
//   hover       `expect` matches the answer
//   completion  `expect` is among the offers
//   definition  `to` ends the path of the file it leads to (or matches it)
//   faded       the line is shown as left out of the build (C and C++: an `#if` that does not hold)
//   own         a request only this tool's editor extension makes (`method`), asked at `at` when the
//               request takes a position, with `params` when it takes more; `expect` matches the
//               answer, read as text. A command changes files through an edit it proposes to
//               the editor: `edit` matches that proposal, which the benchmark then declines
// `answer` is what a person replies when the tool asks them something first.
// Every case also asks the question nobody writes down: the project's own code, which
// builds, must not be marked as an error. `accept` names a line where the tool disagrees
// with the project's own checker in any editor, and says why; nothing else is excused.

export const cases = [
  { id: 'python', language: 'Python', languageId: 'python', project: 'flask', file: 'src/flask/app.py', patience: 120,
    mistake: 'setdown_mistake: int = "three"',
    accept: [{ at: '                    rv,\n                    status=status,', because: 'Pyright does not take a bytearray where werkzeug declares bytes; flask is checked with mypy, which does' }],
    hover: [{ at: 'MapAdapter | None:', expect: /\(class\) MapAdapter|class MapAdapter/ }, { at: 'get_debug_flag()', expect: /get_debug_flag\(\) -> bool/ }],
    completion: [{ after: 'self.url_map.bind_to_env', expect: 'bind_to_environ' }],
    definition: [{ at: 'get_debug_flag()', to: 'src/flask/helpers.py' }, { at: 'MapAdapter | None:', to: /werkzeug\/routing\/map\.pyi?$/ }] },

  // The environment is outside the project, where only the search Zed uses (PET) finds it: the
  // library the test imports must be read from Poetry's environment, not from any other Python.
  { id: 'python-poetry', language: 'Python', languageId: 'python', project: 'cleo', file: 'tests/conftest.py', patience: 120,
    mistake: 'setdown_mistake: int = "three"',
    hover: [{ at: 'BufferedIO(input_)', expect: /class BufferedIO/ }, { at: 'MockerFixture', expect: /MockerFixture/ }],
    completion: [{ after: 'input_.set_str', expect: 'set_stream' }],
    definition: [{ at: 'BufferedIO(input_)', to: 'src/cleo/io/buffered_io.py' },
      { at: 'MockerFixture', to: /pypoetry\/virtualenvs\/cleo-[^/]+\/lib\/python[\d.]+\/site-packages\/pytest_mock\/plugin\.pyi?$/ }] },

  { id: 'typescript', language: 'TypeScript', languageId: 'typescript', project: 'p-queue', file: 'source/index.ts',
    mistake: "const setdownMistake: number = 'three';",
    hover: [{ at: 'this.#queue.enqueue(run, options)', on: 'enqueue', expect: /enqueue: \(run: RunFunction/ }, { at: 'AbortSignal, callback', expect: /AbortSignal/ }],
    completion: [{ after: 'this.#queue.deq', expect: 'dequeue' }],
    definition: [{ at: "PriorityQueue from './priority-queue.js'", to: 'source/priority-queue.ts' }, { at: 'this.#queue.enqueue(run, options)', on: 'enqueue', to: 'source/queue.ts' }] },

  { id: 'javascript', language: 'JavaScript', languageId: 'javascript', project: 'express', file: 'lib/application.js',
    mistake: 'var = ;',
    hover: [{ at: 'finalhandler(req, res, {', expect: /finalhandler/ }, { at: 'compileETag(val)', expect: /compileETag/ }],
    completion: [{ after: 'this.router.rou', expect: 'route' }],
    definition: [{ at: 'compileETag(val)', to: 'lib/utils.js' }, { at: 'finalhandler(req, res, {', to: /application\.js$|node_modules\/finalhandler\/index\.js$/ }] },

  { id: 'svelte', language: 'Svelte', languageId: 'svelte', project: 'realworld', file: 'src/lib/ArticleList/ArticlePreview.svelte', patience: 120,
    // The project is JavaScript without type checking, so an unknown name is no error here; a missing `alt` is reported.
    mistake: '<img src="setdown-mistake.png">',
    hover: [{ at: "enhance } from '$app/forms'", expect: /function enhance/ }, { at: 'result.type ===', on: 'type', expect: /\(property\) type: / }],
    completion: [{ after: 'result.ty', expect: 'type' }],
    definition: [{ at: "enhance } from '$app/forms'", to: /@sveltejs\/kit\// }],
    own: [{ method: '$/getCompiledCode', expect: /"js":\{"code":"/ },
      { method: '$/getComponentReferences', expect: /ArticleList\/index\.svelte/ },
      { method: '$/getFileReferences', expect: /ArticleList\/index\.svelte/ }] },
  { id: 'svelte-page', language: 'Svelte, a page', languageId: 'svelte', project: 'realworld', file: 'src/routes/article/[slug]/+page.svelte', patience: 120,
    mistake: '<img src="setdown-mistake.png">',
    hover: [{ at: '<ArticleMeta article', on: 'ArticleMeta', expect: /ArticleMeta/ }, { at: 'data.article.title}</title>', expect: /data/ }],
    definition: [{ at: '<CommentContainer comments', on: 'CommentContainer', to: 'CommentContainer.svelte' }] },

  { id: 'c', language: 'C', languageId: 'c', project: 'cjson', file: 'cJSON_Utils.c',
    mistake: 'int setdown_mistake(void) { return missing_name; }',
    hover: [{ at: 'cJSON_IsArray(object)', expect: /cJSON_IsArray/ }, { at: 'strlen((const char*)string)', expect: /strlen/ }],
    completion: [{ after: 'cJSON_IsArr', expect: 'cJSON_IsArray' }],
    faded: [{ at: '#pragma warning (disable : 4001)' }],
    definition: [{ at: 'cJSON_IsArray(object)', to: /cJSON\.[ch]$/ }],
    own: [{ method: 'textDocument/switchSourceHeader', expect: /cJSON_Utils\.h/ },
      { method: 'textDocument/ast', params: ({ at, after }) => ({ range: { start: at('cJSON_IsArray(object)'), end: after('cJSON_IsArray(object)') } }), expect: /"kind":"Call"/ },
      { method: '$/memoryUsage', expect: /"_total":\d+/ }] },
  { id: 'cpp', language: 'C++', languageId: 'cpp', project: 'fmt', file: 'src/os.cc', patience: 120,
    mistake: 'int setdown_mistake() { return missing_name; }',
    hover: [{ at: 'std::error_code(errno, std::generic_category())', on: 'error_code', expect: /error_code/ }, { at: 'buffered_file::close()', on: 'close', expect: /close/ }],
    completion: [{ after: 'std::generic_cat', expect: 'generic_category' }],
    faded: [{ at: '#    define S_IRUSR _S_IREAD' }],
    definition: [{ at: 'buffered_file::close()', on: 'close', to: 'include/fmt/os.h' }],
    own: [{ method: 'textDocument/switchSourceHeader', expect: /include\/fmt\/os\.h/ }] },

  // A first start reads the project's libraries and builds an index; the lighter tools answer within seconds.
  { id: 'rust', language: 'Rust', languageId: 'rust', project: 'walkdir', file: 'src/lib.rs', patience: 300,
    mistake: 'fn setdown_mistake() { setdown_mistake(1); }',
    hover: [{ at: 'Handle::from_path(&child)', on: 'from_path', expect: /fn from_path/ }, { at: 'fs::read_dir(dent.path())', on: 'read_dir', expect: /fn read_dir/ }],
    completion: [{ after: 'Handle::from_pa', expect: 'from_path' }],
    definition: [{ at: 'DirEntry::from_path(0, start, false)', on: 'from_path', to: 'src/dent.rs' }, { at: 'Handle::from_path(&child)', on: 'Handle', to: /same-file[^/]*\/src\/lib\.rs$/ }],
    own: [{ method: 'rust-analyzer/expandMacro', at: 'itry!(DirEntry::from_path(0, start, false))', expect: /"name":"itry!".*"expansion":"match/ },
      { method: 'experimental/runnables', expect: /"kind":"cargo"/ },
      { method: 'experimental/openCargoToml', expect: /walkdir\/Cargo\.toml/ },
      // The children of the module the place is in, each as the line that declares it: `mod dent;` is line 128.
      { method: 'experimental/childModules', at: 'macro_rules! itry {', expect: /src\/lib\.rs".*"targetSelectionRange":\{"start":\{"line":127,/ },
      { method: 'experimental/externalDocs', at: 'fs::read_dir(dent.path())', on: 'read_dir', expect: /doc\.rust-lang\.org\/[^"]*fn\.read_dir/ },
      { method: 'experimental/matchingBrace', params: ({ at }) => ({ positions: [at('macro_rules! itry {', '{')] }), expect: /"line":\d+/ },
      { method: 'rust-analyzer/viewSyntaxTree', expect: /SOURCE_FILE/ },
      { method: 'rust-analyzer/analyzerStatus', expect: /workspace/i },
      // A request without a parameter, answered with nothing. (`rust-analyzer/memoryUsage` is one too,
      // but a released rust-analyzer refuses it: "Memory profiling is not enabled for this build".)
      { method: 'rust-analyzer/rebuildProcMacros', expect: /^null$/ }] },

  { id: 'go', language: 'Go', languageId: 'go', project: 'cobra', file: 'command.go', patience: 180,
    mistake: 'var setdownMistake string = 1',
    hover: [{ at: 'c.Flags().GetBool(helpFlagName)', on: 'GetBool', expect: /func \(.*FlagSet\) GetBool/ }, { at: 'c.Root().ExecuteC()', on: 'ExecuteC', expect: /func \(c \*Command\) ExecuteC/ }],
    completion: [{ after: 'c.Flags().ArgsLenAt', expect: 'ArgsLenAtDash' }],
    definition: [{ at: 'c.Flags().GetBool(helpFlagName)', on: 'GetBool', to: /spf13\/pflag@[^/]+\/bool\.go$/ }, { at: 'c.Root().ExecuteC()', on: 'Root', to: 'command.go' }],
    // "Go: Add Import", "Go: Add Tags To Struct Fields", "Go: Generate Unit Tests For Function",
    // "Go: Choose Go Environment" and the line a "run test" lens runs.
    own: [{ what: 'the packages that can be imported', method: 'workspace/executeCommand:gopls.list_known_packages', expect: /"Packages":\[.*"net\/http"/ },
      { what: 'add the import net/http', method: 'workspace/executeCommand:gopls.add_import', params: { importPath: 'net/http' }, edit: /"net\/http/ },
      { what: 'add json tags to Use', method: 'setdown/go.modifyTags', params: ({ at }) => ({ modification: 'add', tags: 'json', range: { start: at('\tUse string', 'Use'), end: at('\tUse string', 'Use') } }), edit: /json:\\"use\\"/ },
      { what: 'tags are asked for when the settings name none', method: 'setdown/go.modifyTags', params: ({ at }) => ({ modification: 'add', range: { start: at('\tUse string', 'Use'), end: at('\tUse string', 'Use') } }), expect: /^\{"ask":"Tags to add/ },
      { what: 'the go test line of a test lens', method: 'setdown/go.testCommand', params: ({ uri }) => ({ arguments: [{ URI: uri.replace(/command\.go$/, 'command_test.go'), Tests: ['TestSingleCommand'], Benchmarks: [] }] }),
        expect: /"program":"go","args":\["test","-test\.fullpath=true","-timeout","30s","-run","\^TestSingleCommand\$","\."\]/ },
      { what: 'the Go versions to choose from', method: 'setdown/go.versions', expect: /"current":"[^"]*1\.\d+/ }] },
  // gopls writes a test only for a package without type errors, so this file is opened as it is.
  { id: 'go-test', language: 'Go, a test for a function', languageId: 'go', project: 'cobra', file: 'args.go', patience: 180,
    hover: [{ at: 'func NoArgs(cmd *Command, args []string) error', on: 'NoArgs', expect: /func NoArgs/ }],
    own: [{ what: 'a test for NoArgs', method: 'workspace/executeCommand:gopls.add_test', params: ({ at }) => ({ range: { start: at('func NoArgs(cmd *Command, args []string) error', 'NoArgs'), end: at('func NoArgs(cmd *Command, args []string) error', 'NoArgs') } }), edit: /func TestNoArgs/ }] },
  { id: 'gomod', language: 'Go module file', languageId: 'gomod', project: 'cobra', file: 'go.mod', patience: 180,
    // gopls stops reading a module file that has a line it cannot parse, so nothing is added to this one.
    hover: [{ at: 'github.com/spf13/pflag', expect: /\S/ }] },

  { id: 'php', language: 'PHP', languageId: 'php', project: 'fastroute', file: 'src/RouteCollector.php',
    mistake: 'function setdown_mistake(): void { echo missing_function(); }',
    hover: [{ at: 'routeParser->parse($route)', on: 'parse', expect: /parse/ }, { at: 'implements ConfigureRoutes', on: 'ConfigureRoutes', expect: /ConfigureRoutes/ }],
    completion: [{ after: '$this->dataGenerator->addRou', expect: 'addRoute' }],
    definition: [{ at: 'routeParser->parse($route)', on: 'parse', to: 'src/RouteParser.php' }, { at: 'implements ConfigureRoutes', on: 'ConfigureRoutes', to: 'src/ConfigureRoutes.php' }],
    // "Intelephense: Cancel indexing": a request without a parameter, which the tool answers with nothing.
    own: [{ what: 'cancel indexing', method: 'cancelIndexing', expect: /^(null|true|false)$/ }] },

  // jdt.ls imports the build first: it downloads the project's libraries the way Maven would.
  { id: 'java', language: 'Java', languageId: 'java', project: 'petclinic', file: 'src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java', patience: 600,
    mistake: 'class SetdownMistake { int value = "three"; }',
    hover: [{ at: 'owners.findByLastNameStartingWith(lastname, pageable)', on: 'findByLastNameStartingWith', expect: /findByLastNameStartingWith/ },
      { at: 'BindingResult result, RedirectAttributes redirectAttributes', on: 'BindingResult', expect: /BindingResult/ }],
    completion: [{ after: 'return owners.findByLastNameSta', expect: 'findByLastNameStartingWith' }],
    definition: [{ at: 'owners.findByLastNameStartingWith(lastname, pageable)', on: 'findByLastNameStartingWith', to: 'owner/OwnerRepository.java' },
      { at: 'public Owner findOwner', on: 'Owner', to: 'owner/Owner.java' }],
    // "Java: Force Java Compilation", incremental: 1 is a build that succeeded, 2 one with errors.
    own: [{ what: 'build the workspace', method: 'java/buildWorkspace', params: { value: false }, expect: /^[12]$/ }] },

  // The tool reads the build first: it downloads the project's libraries the way the build would.
  { id: 'kotlin', language: 'Kotlin', languageId: 'kotlin', project: 'spring-kotlin', file: 'src/main/kotlin/com/example/blog/HttpControllers.kt', patience: 600,
    mistake: 'val setdownMistake: Int = "three"',
    // The guide ships a Gradle build and a Maven build of the same project.
    answer: [{ ask: /Build tool conflicts/, choose: 'Use Gradle' }],
    hover: [{ at: 'ResponseStatusException(NOT_FOUND, "This article', expect: /ResponseStatusException/ }, { at: 'articleRepository.findBySlug(slug)', on: 'findBySlug', expect: /findBySlug/ }],
    completion: [{ after: 'repository.findByLog', expect: 'findByLogin' }],
    definition: [{ at: 'articleRepository.findBySlug(slug)', on: 'findBySlug', to: 'blog/Repositories.kt' }, { at: 'val author: User,', on: 'User', to: 'blog/Entities.kt' }],
    // "Kotlin: Go to Test or Test Subject": asked on a class, the tool says it is no test and lists its tests.
    own: [{ what: 'the tests of this class', method: 'intellij/relatedTests', at: 'class ArticleController(', on: 'ArticleController', expect: /"isTest":false/ }] },

  // Data files have no functions. A known file name brings its schema: descriptions and allowed keys.
  { id: 'json', language: 'JSON', languageId: 'json', project: 'p-queue', file: 'package.json',
    mistake: '{}',
    hover: [{ at: '"scripts"', expect: /script/i }],
    completion: [{ after: '\t"scr', expect: 'scripts' }],
    // "JSON: Sort Document": the server answers with the edits that sort every object's keys.
    own: [{ what: 'the edits that sort the document', method: 'json/sort', params: { options: { tabSize: 4, insertSpaces: false } }, expect: /"newText":/ }] },
  { id: 'jsonc', language: 'JSON with comments', languageId: 'jsonc', project: 'p-queue', file: 'tsconfig.json',
    mistake: '{}',
    hover: [{ at: '"outDir"', expect: /\S/ }],
    completion: [{ after: '"rootD', expect: 'rootDir' }] },
  // File names an editor has to be told about: a web manifest is JSON by nobody's default, and
  // the schemas of a Prettier file and a jsconfig come from the schema store.
  { id: 'json-manifest', language: 'JSON, a web manifest', languageId: 'json', project: 'boilerplate', file: 'src/site.webmanifest',
    mistake: '{}' },
  { id: 'json-prettier', language: 'JSON, a Prettier file', languageId: 'json', project: 'boilerplate', file: '.prettierrc.json',
    mistake: '{}',
    hover: [{ at: '"singleQuote"', expect: /quote/i }],
    completion: [{ after: '  "bracketSameL', expect: 'bracketSameLine' }] },
  { id: 'jsonc-jsconfig', language: 'JSON with comments, a jsconfig', languageId: 'jsonc', project: 'realworld', file: 'jsconfig.json',
    mistake: '{}',
    hover: [{ at: '"extends"', expect: /\S/ }] },
  { id: 'yaml', language: 'YAML', languageId: 'yaml', project: 'cobra', file: '.golangci.yml',
    mistake: 'version: "3"',
    hover: [{ at: 'timeout: 5m', expect: /\S/ }] },
  { id: 'yaml-workflow', language: 'YAML, a GitHub workflow', languageId: 'yaml', project: 'p-queue', file: '.github/workflows/main.yml',
    mistake: 'setdown-mistake: 1',
    hover: [{ at: 'runs-on', expect: /\S/ }],
    completion: [{ after: '    runs-', expect: 'runs-on' }],
    // "YAML: Select JSON Schema": the schema this file is checked against, and the list to pick from with this one marked.
    own: [{ what: 'the schema of this file', method: 'yaml/get/jsonSchema', expect: /github-workflow/ },
      { what: 'every schema the tool knows', method: 'yaml/get/all/jsonSchemas', expect: /"usedForCurrentFile":true/ }] },
  { id: 'dockerfile', language: 'Dockerfile', languageId: 'dockerfile', project: 'compose', file: 'nginx-flask-mysql/backend/Dockerfile',
    mistake: 'EXPOSE eighty',
    hover: [{ at: 'WORKDIR /code', expect: /working directory/i }, { at: 'EXPOSE 8000', expect: /port/i }],
    completion: [{ after: '\nWORKD', expect: 'WORKDIR' }] },
  { id: 'dockercompose', language: 'Docker Compose', languageId: 'dockercompose', project: 'compose', file: 'nginx-flask-mysql/compose.yaml',
    mistake: 'setdown_mistake: 1',
    hover: [{ at: 'healthcheck:', expect: /\S/ }, { at: 'depends_on:', expect: /\S/ }],
    completion: [{ after: '    healthch', expect: 'healthcheck' }] },

  { id: 'css', language: 'CSS', languageId: 'css', project: 'pico', file: 'css/pico.css',
    mistake: '.setdown-mistake { colr: red; }',
    hover: [{ at: 'cursor: pointer', expect: /cursor/i }],
    completion: [{ after: '  cursor: poin', expect: 'pointer' }] },
  { id: 'scss', language: 'SCSS', languageId: 'scss', project: 'pico', file: 'scss/content/_button.scss',
    mistake: '.setdown-mistake { colr: red; }',
    hover: [{ at: 'overflow: visible', expect: /overflow/i }],
    completion: [{ after: '    text-transf', expect: 'text-transform' }] },
  { id: 'less', language: 'Less', languageId: 'less', project: 'bootstrap3', file: 'less/buttons.less',
    mistake: '.setdown-mistake { colr: red; }',
    hover: [{ at: 'white-space: nowrap', expect: /white-space/i }],
    completion: [{ after: '  vertical-al', expect: 'vertical-align' }] },
  // The HTML tool does not check markup; it checks the style sheet inside the page.
  { id: 'html', language: 'HTML', languageId: 'html', project: 'boilerplate', file: 'src/index.html',
    mistake: '<style>.setdown-mistake { colr: red; }</style><script>const setdownValue = 1; console.log(setdownValue);</script>',
    hover: [{ at: 'meta charset', expect: /meta/i }],
    completion: [{ after: '  <scr', expect: 'script' }],
    // The script inside a page is coloured by the HTML tool's own request, as its extension asks it.
    own: [{ what: 'the colours of the script inside the page', method: 'textDocument/semanticTokens/full', expect: /"data":\[\d+(,\d+){9,}/ }] },
];
