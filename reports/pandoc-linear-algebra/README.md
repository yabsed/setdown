# Pandoc → HTML: Linear Algebra 실험

[결과 목록](index.html) · [파일별 실행 결과](results.tsv)

`vendor/linear-algebra/src`의 주요 `.tex` 파일 23개를 **Pandoc 3.7.0.2**로 변환했다. 원본은 수정하지 않았고, 별도 전처리나 사용자 정의 매크로 정의도 넣지 않았다. 출력 옵션은 `-f latex -t html5 --standalone --mathjax`이다. 본문은 책의 다섯 영역(`gr`, `vs`, `map`, `det`, `jc`)에서 `book.tex`이 포함하는 장별 파일 19개를 골랐다. 책, 실습서, 슬라이드 목록, 해답집의 진입점도 각각 포함했다.

## 결과

- 본문 19개와 `lab/lab.tex`, `slides/slides.tex`, `jhanswer.tex`은 HTML 파일이 생성되었다.
- `book.tex`은 `expecting \end{document}` 오류로 중단되어 HTML이 없다. 원문 오류는 [book.stderr.txt](book.stderr.txt)에 저장했다.
- `jhanswer.tex`은 종료 코드 0이지만, 포함 파일을 찾지 못했다는 경고가 있다. [jhanswer.stderr.txt](jhanswer.stderr.txt)를 함께 봐야 한다. 생성된 HTML에는 해답 본문이 빠져 있다.
- `lab/lab.tex`은 `src/lab`을 작업 디렉토리로 지정했을 때 포함 파일이 정상 로드되었다.

## 재현

저장소 루트에서 다음 명령을 실행하면 대표 결과를 재현할 수 있다.

```sh
cd vendor/linear-algebra/src
pandoc -f latex -t html5 --standalone --mathjax gr/gr1.tex -o ../../../pandoc-linear-algebra/gr-gr1.html
```

`gr/gr1.tex` 대신 [results.tsv](results.tsv)의 `source` 열에 있는 파일을 넣으면 된다. 출력 이름은 경로의 `/`를 `-`로 바꾸고 `.tex`를 `.html`로 바꾼 것이다. 실습서는 아래처럼 해당 디렉토리에서 실행했다.

```sh
cd vendor/linear-algebra/src/lab
pandoc -f latex -t html5 --standalone --mathjax lab.tex -o ../../../../pandoc-linear-algebra/lab-lab.html
```

## HTML을 볼 때

- 수식은 MathJax CDN을 사용하므로 브라우저에서 수식 렌더링 시 인터넷 접속이 필요하다.
- 자체 LaTeX 명령은 모두 변환되지 않는다. 예를 들어 [gr-gr1.html](gr-gr1.html)에서 `\definend`로 감싼 용어가 사라지고 `\begin{linsys}`가 수식에 그대로 남는다.
- 원본이 참조하는 일부 그림은 생성된 HTML에 확장자 없는 경로로 남아 있어 표시되지 않는다. 예: `gr/mp/ch1.1`.
- Pandoc의 종료 코드 0은 내용과 그림의 완전성을 보증하지 않는다. 이 디렉토리는 변환 품질을 확인하기 위한 **원시 출력**이다.
