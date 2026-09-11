# Setdown 새 문서 Draft Asset Bundle 전략 및 구현 보고서

## 결론

저장하지 않은 새 문서는 더 이상 `~/Documents`의 가상 파일로 취급하지 않는다.
Setdown의 앱 데이터 디렉터리 안에 문서별 UUID 작업 공간을 만들고, Markdown
원문과 로컬 이미지를 하나의 draft bundle로 관리한다. 사용자가 Save As에서 최종
경로를 선택한 순간에만 Markdown과 asset을 함께 사용자 디렉터리로 커밋한다.

이 방식은 다음 두 요구를 동시에 만족한다.

1. 최종 파일 경로를 선택하기 전에도 붙여넣은 이미지가 Editor와 Viewer에서 보인다.
2. 사용자가 선택하지 않은 `~/Documents` 경로에 파일이나 asset 디렉터리를 만들지 않는다.

###### 저장 전 구조

새 문서마다 다음과 같은 내부 경로를 부여한다.

```text
<Electron userData>/drafts/<UUID>/
├── Untitled.md                 # 논리적 문서 기준 경로
└── Untitled.assets/            # 로컬 이미지를 붙였을 때만 생성
    └── pasted-<timestamp>.png
```

Markdown에는 일반 문서와 동일한 상대 링크를 넣는다.

```markdown
![붙여넣은 이미지](<Untitled.assets/pasted-20260911-180000.png>)
```

Viewer의 base URL도 draft 디렉터리를 기준으로 하므로 전용 placeholder URL이나
data URL 없이 실제 저장 문서와 같은 방식으로 이미지를 해석한다. HTTP/HTTPS 이미지는
계속 원격 URL을 직접 참조하며 draft asset에 복사하지 않는다.

## Save As 커밋

사용자가 `~/Projects/math/algebra.md`를 선택하면 Setdown은 다음 순서로 커밋한다.

1. 목적지와 같은 파일 시스템에 임시 asset 디렉터리를 만든다.
2. draft asset 전체를 임시 디렉터리에 복사한다.
3. 임시 디렉터리를 `algebra.assets`로 rename한다.
4. Markdown의 관리 대상 prefix를 `Untitled.assets/`에서 `algebra.assets/`로 변경한다.
5. Markdown을 임시 파일에 기록한 뒤 `algebra.md`로 atomic rename한다.
6. 모든 과정이 성공한 뒤에만 원래 draft bundle을 삭제한다.

일반 Save와 탭 닫기 대화상자의 `저장`은 새 문서에 대해 Save As 선택기를 연다.
따라서 `~/Documents`는 제안되는 초기 위치일 뿐이며 사용자가 승인하기 전에는
그곳에 아무 파일도 생성하지 않는다.

결과는 다음과 같다.

```text
~/Projects/math/
├── algebra.md
└── algebra.assets/
    └── pasted-20260911-180000.png
```

목적지에 `algebra.assets`가 이미 있다면 기존 디렉터리를 수정하지 않고
`algebra.assets-2`, `algebra.assets-3`처럼 사용 가능한 bundle 이름을 선택하고
Markdown 링크도 그 이름으로 갱신한다.

## 실패와 폐기

- asset 복사 또는 Markdown 기록이 실패하면 원래 draft를 삭제하지 않는다.
- Markdown 기록 전에 생성한 새 목적지 asset bundle은 기록 실패 시 제거한다.
- 사용자가 탭 닫기에서 `저장 안 함`을 선택하면 해당 새 문서 draft만 제거한다.
- 프로그램 종료에서 `저장 안 함`을 선택하면 열린 새 문서의 draft bundle을 제거한다.
- 저장을 선택했지만 Save As를 취소하면 탭 또는 프로그램 종료도 취소된다.
- Setdown 외부 경로는 draft 삭제 API가 제거할 수 없도록 경로 포함 검사를 수행한다.

강제 종료 시 draft는 삭제하지 않는다. 따라서 데이터는 남지만, 현재 버전은 다음 실행 시
자동 복구 UI까지 제공하지는 않는다. UUID draft 검색과 복구 탭 제시는 후속 기능으로
추가할 수 있으며 현재 저장 형식은 이를 지원한다.

## 사용자 동작

- 새 문서에서 `Ctrl+S`: Save As 경로 선택창을 연다.
- 새 문서 탭 닫기에서 `저장`: Save As 경로 선택창을 연다.
- 로컬 이미지 붙여넣기: 저장 대화상자를 먼저 띄우지 않고 draft asset에 저장한다.
- 명시적 저장 성공: 문서명, Monaco model, Viewer base path를 최종 경로로 교체한다.
- 외부 URL 붙여넣기: URL Markdown만 삽입하며 로컬 파일을 만들지 않는다.

## 검증

`draft-assets.test.ts`가 다음 조건을 자동 검증한다.

- 최종 파일명에 맞는 asset 디렉터리 생성과 링크 변경
- 기존 목적지 asset을 건드리지 않는 충돌 회피
- 성공 이후 draft 제거
- draft root 외부 삭제 거부

전체 타입 검사, 단위 테스트, 프로덕션 빌드와 함께 실제 Electron 붙여넣기 및
Save As 흐름을 검증 대상으로 삼는다.
