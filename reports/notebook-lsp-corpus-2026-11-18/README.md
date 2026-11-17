# 공개 노트북으로 정한 노트북 Python 분석 정책

작성일: 2026-11-18 · 작성: Claude · 상태: 측정 완료. 정책은 구현되어 스테이징되어 있고 커밋 전이다.

**노트북의 기본 검사 수준은 Off로 한다. VS Code와 같은 기본값이다.** 공개 저장소 28곳의 노트북 228개를 Setdown이 실제로 보내는 설정으로 분석한 결과, Basic에서는 노트북 173개(76%)에 빨간 줄이 생겼다. 그중 타입 문제로 표시된 줄을 무작위로 78개 골라 노트북과 설치된 라이브러리를 대조해 판정하니, 실행하면 실제로 실패하는 줄은 6개(8%)였고 71개(91%)는 문제없이 실행되는 코드였다. Off에서는 빨간 줄이 노트북 8개의 12줄로 줄고, 전부 구문 오류다. 미해결 import와 정의되지 않은 이름은 노란 줄로 남는다. 타입 검사가 필요한 사람은 주소창 오른쪽의 Python 버튼에서 수준을 고르면 바로 적용된다.

이 측정은 [apps/notebook-benchmark](../../apps/notebook-benchmark/README.md)로 다시 돌릴 수 있다. 아래 숫자는 그 앱이 저장한 기준선 [baseline.md](../../apps/notebook-benchmark/results/baseline.md)와 같다.

## 1. 무엇을 어떻게 측정했나

| 항목 | 내용 |
| --- | --- |
| 노트북 | GitHub 공개 저장소 28곳, 각 저장소를 커밋으로 고정. 저장소 안 노트북 3,295개를 경로 순으로 고르게 최대 10개씩 뽑아 247개 |
| 분석한 노트북 | 228개. 19개는 제외: Python 2 노트북 12개, R·C++·Coconut 노트북 5개, JSON으로 읽히지 않는 파일 2개 |
| 저장소 종류 | 교재(PythonDataScienceHandbook, pydata-book, handson-ml3, machine-learning-book, fastbook 등), 라이브러리 문서(seaborn, statsmodels, xarray, geopandas, pandas, keras-io, tensorflow/docs), API 예제집(openai-cookbook, claude-cookbooks, huggingface/notebooks), 입문 강의와 연습 문제(learn-python3, Complete-Python-3-Bootcamp, ML-For-Beginners), 에세이(pytudes) |
| 분석기 | Setdown에 들어 있는 basedpyright 1.40.2. 노트북 호스트가 보내는 설정을 그대로 프로젝트 파일로 넘겨 명령줄에서 실행 |
| 분석 대상 | 코드 셀만. 호스트의 숨은 첫 셀과 IPython 규칙을 적용한 상태. 노트북은 실행하지 않는다 |
| 환경 | Python 3.13.11. 노트북이 import하는 배포판 중 42개 설치(numpy 2.4.0, pandas 2.3.3, scikit-learn 1.8.0, scipy 1.17.0, matplotlib 3.10.8, torch 2.11.0, transformers 5.2.0 등). import되지만 설치되지 않은 모듈 57개(tensorflow, keras, fastai, jax, dask 등) |

전체 목록은 [corpus.json](../../apps/notebook-benchmark/corpus.json), 환경은 [requirements.txt](../../apps/notebook-benchmark/requirements.txt)에 있다. 한 줄에 진단이 여러 개 붙어도 빨간 줄 하나로 센다.

## 2. 수준별 결과

| 수준 | 빨간 줄이 있는 노트북 | 빨간 줄 | 오류 진단 | 노란 줄 | 경고 진단 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Off (기본값)** | 8 / 228 | 12 | 40 | 660 | 839 |
| Basic | 173 / 228 | 1,546 | 2,178 | 251 | 278 |
| Standard | 175 / 228 | 1,597 | 2,233 | 251 | 278 |
| Strict | 207 / 228 | 13,195 | 25,341 | 26 | 29 |

빨간 줄을 원인으로 나누면 다음과 같다. 괄호 안은 노란 줄이다.

| 수준 | 구문 | 정의되지 않은 이름 | 미해결 import | 타입 |
| --- | ---: | ---: | ---: | ---: |
| Off | 12 (0) | 0 (405) | 0 (254) | 0 (1) |
| Basic | 12 (0) | 405 (0) | 228 (26) | 905 (225) |
| Standard | 12 (0) | 405 (0) | 228 (26) | 957 (225) |
| Strict | 12 (0) | 405 (0) | 228 (26) | 12,991 (0) |

Off와 Basic의 차이는 두 가지다. 타입 줄 905개가 사라지고, 이름과 import 문제가 빨강에서 노랑으로 바뀐다.

**Off의 빨간 줄 12개.** 10줄은 Python으로 실행할 수 없는 줄이다. 오류 수업의 의도된 오류(`print('Hello)`) 1줄, 학습자가 채울 빈칸(`my_dict = `, `plt.plot(t, t, , …)`) 5줄, 코드 셀에 든 다른 내용 3줄(언어 표기가 잘못된 Julia 코드, 산문, `!` 없는 셸 명령), Python 2의 `print` 문 1줄이다. 나머지 2줄은 `pip install seaborn`과 `cd ..`다. IPython은 이런 줄을 매직 명령으로 받아 실행하지만 Python 문법은 아니다. VS Code와 JupyterLab-LSP도 같은 줄을 오류로 표시하며, 이번에는 규칙을 더하지 않았다(7절).

**Off의 노란 줄 660개.** 미해결 import가 254줄이다. 설치되지 않은 라이브러리를 import한 줄이라, 그 환경에서 실행하면 실패한다. 정의되지 않은 이름 경고 581개(405줄) 가운데 492개는 fastai/fastbook 한 곳에서 나온다. `from fastbook import *`가 풀리지 않아, 그 뒤에 쓰는 이름이 모두 정의되지 않은 것으로 보고된다. 나머지 89개는 노트북 16개에 있다. 42개는 위의 Python이 아닌 줄에 함께 붙은 것이다. 25개는 실행 중에 만들어지는 이름이라 틀린 보고다: `globals().update(...)`로 만드는 이름 17개, `%run`으로 실행한 다른 노트북이 정의하는 이름 8개. 나머지 22개는 노트북이 정의하지 않거나 뒤의 셀에서 정의하는 이름으로, 학습자가 작성할 함수나 순서가 바뀐 셀이 대부분이다.

## 3. Basic의 빨간 줄은 얼마나 맞는가

판정 당시의 Basic 구성(scikit-learn 스텁을 넣기 전, 앱의 `basic-without-sklearn-stubs`)이 타입 문제로 표시한 1,028줄에서 무작위로 40줄씩 두 번 뽑았다. 겹친 2줄을 빼면 78줄이다. 각 줄을 노트북 원문과 설치된 라이브러리에 대조해 세 가지로 판정했다.

| 판정 | 뜻 | 줄 |
| --- | --- | ---: |
| 실제 문제 | 분석한 환경에서 노트북을 실행하면 그 줄이 실패한다 | 6 (8%) |
| 위험 | 여기서는 실행되지만, 보고가 실패할 수 있는 경로를 짚는다 | 1 (1%) |
| 틀린 보고 | 실행되고, 보고가 말하는 문제가 일어나지 않는다 | 71 (91%) |

78줄 표본이므로 실제 문제의 비율은 95% 신뢰구간으로 약 4–16%다. 판정은 [labels.json](../../apps/notebook-benchmark/labels.json)에 줄 단위로 있다.

실제 문제 6줄은 다음과 같다. 4줄은 라이브러리가 바뀌어 없어진 API다: `OneHotEncoder(sparse=False)`, `LatentDirichletAllocation(n_topics=10)`, `LogisticRegression(multi_class='ovr')`, `openai.File.create(...)`. 1줄은 설치되지 않은 SDK에서 가져오는 이름이고, 1줄은 연습 문제의 빈칸(`r, g, b = ...`)을 그대로 쓰는 줄이다. 위험 1줄은 `inp.grad.std()`로, `grad`가 `None`일 수 있다.

틀린 보고 71줄의 원인:

| 원인 | 줄 | 예 |
| --- | ---: | --- |
| 타입 선언이 없는 라이브러리의 소스에서 추론한 타입 | 34 | `SVC(gamma=0.10)`: 기본값이 `"scale"`이라 매개변수를 `str`로 추론하고 `float`를 거부 |
| 선언된 타입이 실제 동작보다 좁음 | 24 | `plt.axis([0, 7.2, 0, 3])`: 리스트를 받지만 선언은 4-튜플. 1줄은 스텁과 설치된 pandas의 버전 차이 |
| 내보내기 관례 | 7 | `from diffusers import EulerDiscreteScheduler`: 지연 로딩 모듈이라 "내보내지 않는 이름"으로 보고 |
| 노트북 자신의 주석이 실제 값보다 좁음 | 2 | `Iterable[tuple]`로 주석한 매개변수에 `csv.reader`를 전달 |
| 그 밖 | 4 | 실행 중에 정해지는 클래스, 생성된 속성, 뒤의 셀에서 다시 정의한 함수, `[None] * n`으로 만들고 채우는 리스트 |

틀린 보고와 실제 문제는 같은 규칙에서 나온다. 실제 문제 6줄은 `reportCallIssue`, `reportAttributeAccessIssue`, `reportArgumentType`이고, 틀린 보고 대부분도 이 세 규칙이다. 그래서 규칙 몇 개를 끄는 방식으로는 둘을 가를 수 없다.

지금의 각 구성이 이 78줄 중 몇 줄을 빨갛게 표시하는지는 다음과 같다.

| 구성 | 실제 문제 | 위험 | 틀린 보고 | 표시한 줄 중 실제 문제 |
| --- | ---: | ---: | ---: | ---: |
| Off | 0 / 6 | 0 / 1 | 0 / 71 | – |
| Basic | 4 / 6 | 1 / 1 | 59 / 71 | 6% |
| Standard | 4 / 6 | 1 / 1 | 59 / 71 | 6% |
| Strict | 4 / 6 | 1 / 1 | 67 / 71 | 6% |
| 분석기 단독 (`analyzer`) | 6 / 6 | 1 / 1 | 65 / 71 | 8% |
| 선언된 타입만 (`declared`) | 4 / 6 | 1 / 1 | 54 / 71 | 7% |
| scikit-learn 스텁 없이 | 6 / 6 | 1 / 1 | 71 / 71 | 8% |

타입 검사를 켠 어떤 구성에서도 빨간 줄 가운데 실제 문제는 6–8%다. Off는 이 6줄을 놓친다. 그 6줄은 실행하면 바로 예외로 드러나고, 노트북은 셀 단위로 실행하며 쓰는 문서다.

## 4. Setdown이 더한 것의 효과

분석기만 쓴 경우(`analyzer`: Basic, 셀 원문 그대로, 스텁 없음)와 비교했다.

| 변경 | 빨간 줄 | 빨강이 없어진 줄 | 새로 빨개진 줄 |
| --- | ---: | ---: | ---: |
| 분석기 단독 | 1,798 | | |
| + IPython 규칙, pandas·scipy·django 스텁 | 1,669 | 210 | 81 |
| + scikit-learn 스텁 (현재 Basic) | 1,546 | 186 | 63 |

- **IPython 규칙.** `name?` 같은 도움말 줄 때문에 생기던 구문 오류 줄이 17에서 12로, `%%time`·`%%capture` 셀에서 정의한 이름을 뒤에서 못 찾던 줄이 425에서 405로 줄었다. 이 효과는 Off에서도 그대로다.
- **pandas·scipy 스텁.** pandas를 소스에서 추론할 때 생기던 보고(예: pandas 값을 `NDArray`로 추론해 `head`가 없다고 함)가 사라진다. 대신 스텁의 선언이 좁아서 생기는 보고가 새로 나온다(예: `Scalar < 0.3`).
- **scikit-learn 스텁.** 186줄에서 빨강이 없어지고 63줄이 새로 빨개진다. 판정한 줄에서는 틀린 보고 12개가 사라졌다. 비용도 있다. 이 스텁은 설치된 1.8.0보다 오래된 API를 기술하고 있어, 실제 문제였던 `sparse=`와 `multi_class=` 두 줄이 더는 표시되지 않는다. 반대로 `load_boston`처럼 없어진 함수는 새로 잡는다. VS Code도 같은 스텁을 넣어 배포하므로 같은 결과가 난다.
- **sympy 스텁 (넣지 않음).** 이 코퍼스에서는 한 줄도 달라지지 않았다(1,546 → 1,546). 넣을 근거가 없다.
- **선언된 타입만 사용 (`useLibraryCodeForTypes: false`, 채택하지 않음).** 빨간 줄이 1,546에서 1,486으로 4% 줄고(70줄이 없어지고 10줄이 생김), 줄어든 것은 대부분 statsmodels 한 곳이다. 타입 선언이 없는 라이브러리의 값이 모두 Unknown이 되어 자동완성과 hover가 약해지고, VS Code의 기본값과도 달라진다.
- **Standard.** Basic보다 51줄이 더 빨개진다. "possibly unbound"와 메서드 재정의 규칙이다.
- pandas 스텁을 설치된 pandas 2.3에 맞는 버전으로 바꿔 본 1회 실험에서는 오류 진단이 2,350에서 2,345로 사실상 그대로였다. 벤치마크 앱에는 넣지 않은 실험이다.

## 5. 다른 도구는 어떻게 하는가

- **VS Code (Pylance).** `python.analysis.typeCheckingMode`의 기본값이 `off`다. 문서는 "넓은 타입 검사 규칙 없이 필수 진단에 집중하기 위해서"라고 설명한다(`vendor/pylance-release/docs/settings/python_analysis_typeCheckingMode.md`). Off에서도 네 규칙은 경고로 남는다: `reportMissingImports`, `reportMissingModuleSource`, `reportInvalidTypeForm`, `reportUndefinedVariable`(`vendor/pyright/docs/configuration.md`의 기본값 표).
- **basedpyright.** Off에서 이 네 규칙도 끈다. Setdown은 네 규칙을 경고로 되돌려 Off가 VS Code와 같은 뜻이 되게 했다. 실제 서버로 확인하는 테스트가 `server-session.test.ts`에 있다.
- **Pylance의 스텁.** Microsoft의 `python-type-stubs`는 Pylance에 함께 들어가는 스텁 모음이고(`vendor/python-type-stubs/README.md`), scikit-learn 스텁이 여기에 있다. pandas-stubs도 Pylance에 들어간다.
- **JupyterLab-LSP.** IPython 문법을 분석용으로 바꾸는 규칙을 둔다(`vendor/jupyterlab-lsp/packages/jupyterlab-lsp/src/transclusions/ipython/overrides.ts`). Setdown의 두 규칙은 여기서 가져왔고, 글자 수를 바꾸지 않게 다시 썼다.
- **프로젝트 설정.** Pyright와 basedpyright는 `pyrightconfig.json`이나 `pyproject.toml`의 자기 섹션이 있으면 클라이언트가 보낸 수준을 무시한다. 수준을 적지 않은 빈 파일이어도 그렇다.

## 6. 정책

1. **노트북의 기본 수준은 Off.** Python 파일(`.py`)은 Basic을 유지한다. 파일은 주로 자기 코드를 정의하고, 노트북은 주로 라이브러리를 호출한다.
2. **Off가 표시하는 것.** 구문 오류는 빨강. 미해결 import, 정의되지 않은 이름, 잘못된 타입 표기는 노랑. 타입 정보는 자동완성, hover, 시그니처 도움말에 계속 쓰인다.
3. **타입 검사는 한 번의 선택.** 주소창 오른쪽의 Python 버튼에서 Off·Basic·Standard·Strict를 고른다. 각 수준이 무엇을 보고하는지 함께 적혀 있고, 고르면 다시 시작하지 않아도 적용된다.
4. **프로젝트가 정한 것이 우선.** `.vscode/settings.json`의 수준을 따른다. `pyrightconfig.json`이나 `pyproject.toml` 섹션이 있으면 분석기가 그 파일을 따르므로 선택기를 끄고 그 파일을 알려 준다.
5. **스텁.** pandas, scipy, django, scikit-learn의 스텁을 넣는다. 환경이나 프로젝트가 제공하는 타입이 있으면 그것이 우선한다. 스텁은 이 벤치마크로 측정한 뒤에만 추가한다.
6. **IPython 규칙은 두 개.** `%%time`·`%%capture` 셀을 Python으로 읽고, 도움말 줄을 주석으로 읽는다.

채택하지 않은 안:

- **Basic을 기본으로 유지.** 노트북의 76%에 빨간 줄이 생기고, 표본에서 그 타입 줄의 91%가 틀린 보고다.
- **Basic에서 규칙 몇 개만 끄기.** 실제 문제와 틀린 보고가 같은 규칙에서 나온다(3절).
- **라이브러리 소스 추론 끄기.** 줄어드는 양이 4%이고 편집 기능이 약해진다(4절).

## 7. 한계

- 환경 하나에서 잰 결과다. 설치되지 않은 모듈 57개가 결과에 들어 있다. TensorFlow는 설치되지 않았고 분석기에 든 스텁으로만 읽혔다. 환경이 바뀌면 숫자가 바뀌며, 앱은 환경이 기준선과 다르면 알려 준다.
- 판정은 한 명(작성자)이 78줄을 본 것이고, Basic의 타입 줄만 대상이다. 정의되지 않은 이름과 import 경고는 2절처럼 종류별로만 살폈다.
- 코퍼스는 잘 알려진 교재, 문서, 예제다. 개인 분석 노트북은 들어 있지 않다.
- 명령줄 분석기로 잰 것이다. 편집기에서는 같은 분석기가 같은 설정으로 돌지만, 서버만 이해하는 설정 두 개(`autoSearchPaths`, `diagnosticMode`)는 빠져 있다.
- Off에서도 `pip install seaborn`, `cd ..` 같은 자동 매직 줄은 빨갛다(228개 노트북에서 2줄). 맞게 처리하려면 그 이름이 변수로 가려졌는지 알아야 하고, 참고한 두 도구에도 규칙이 없다. `%pip`, `%cd`로 쓰면 표시되지 않는다.
- scikit-learn 스텁은 없어진 매개변수를 가린다(4절). Basic 이상을 켠 경우에만 해당한다.

## 8. 다시 측정하기

```sh
npm run bench:notebooks -- fetch          # 고정된 노트북 내려받기
npm run bench:notebooks -- environment    # requirements.txt로 work/venv 만들기
npm run bench:notebooks -- run            # off, basic, standard, strict, analyzer
npm run bench:notebooks -- compare        # 저장된 기준선과 달라진 줄
```

이 보고서의 여덟 구성을 모두 분석하는 데 약 13분이 걸렸다(분석기 프로세스는 한 번에 하나, 최대 약 1.2 GB). 분석기 버전, 스텁, IPython 규칙, 노트북 기본값을 바꿀 때 다시 돌리고, 받아들인 결과는 `save`로 기준선에 남긴다.
