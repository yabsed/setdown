# AUROC 수식

실제 정답: \\(Y\in\\{0,1\\}\\), 점수: \\(S=f(X)\in\mathbb R\\).

\\[ \hat Y = \begin{cases} 1 & S\ge t\\\ 0 & S\<t \end{cases} \\]

\\[ \boxed{\operatorname{TPR}(t)=P(S\ge t\mid Y=1)} \\]

\\[ S\_+\sim P(S\mid Y=1) \\]\\[ S\_-\sim P(S\mid Y=0) \\]

\\[ \begin{aligned} \operatorname{AUROC} &=\int_0^1\operatorname{TPR}(u)\\,du\\\ &=\int\_{-\infty}^{\infty}(1-F\_+(t))f\_-(t)\\,dt \end{aligned} \\]

\\[ \boxed{ \widehat{\operatorname{AUROC}} = \frac{1}{mn} \sum\_{i=1}^{m}\sum\_{j=1}^{n} \left[ \mathbf 1(a_i>b_j) + \frac12\mathbf 1(a_i=b_j) \right] } \\]

| 비교 | 결과 |
| --- | --- |
| \\(0.9>0.7\\) | 성공 |
| \\(0.6>0.7\\) | 실패 |

끝: \\[ \boxed{\operatorname{AUROC}=\frac34=0.75} \\] 이후 문장도 남는다.

정상 구분자: \(S_+>S_-\).

\[
\begin{aligned}
F_+(t) &= P(S_+\le t) \\
F_-(t) &= P(S_-\le t)
\end{aligned}
\]

기존 수식: $S_+$ 및 $\text{literal\_name}$.

`\\(S\_+\\)`와 `\(S_+\)`는 코드다.

```tex
\\[ \boxed{S\_+} \\]
\[ S_+ \]
```
