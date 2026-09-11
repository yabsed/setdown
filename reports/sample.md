# Linear Algebra Done Right (4e) — §3D–3F, Condensed & Self-Contained

**Scope.** Every definition, theorem, and proof of §§3D–3F, written formula-first. Only a few routine computational examples are compressed or dropped (3.88; parts of 3.62, 3.74, 3.83, 3.91, 3.96–3.100, 3.122–3.123). Facts (P1)–(P12) are the *only* imports from Chapters 1–3C, so everything below is provable from this file alone. Axler's numbering is kept for cross-reference.

**Standing notation.** $\mathbf F \in \{\mathbf R,\mathbf C\}$; $U,V,W$ vector spaces over $\mathbf F$; $\mathcal L(V,W)$ = all linear maps $V\to W$; $\mathcal L(V)=\mathcal L(V,V)$; $I$ = identity map ($Iv=v$); $\mathcal P(\mathbf F)$ = polynomials over $\mathbf F$, $\mathcal P_m(\mathbf F)$ = those of degree $\le m$; $\mathbf F^\infty$ = sequences $(x_1,x_2,\dots)$; $\mathbf F^{m,n}$ = $m\times n$ matrices over $\mathbf F$; $\delta_{jk}=1$ if $j=k$, else $0$.

---

## P. Prerequisites (Ch. 1–3C, quoted without proof)

**(P1) Subspace criterion (1.34).** $U\subseteq V$ is a subspace $\iff$ $0\in U$ and $U$ is closed under addition and scalar multiplication.

**(P2) Sums and direct sums (1.40–1.45).** $V_1+\cdots+V_m=\{v_1+\cdots+v_m : v_k\in V_k\}$. The sum is a **direct sum** ($V_1\oplus\cdots\oplus V_m$) iff every element has a *unique* such representation; equivalently (1.45), iff $0=v_1+\cdots+v_m$ with $v_k\in V_k$ forces every $v_k=0$.

**(P3) (2.38, 2.39).** In fin-dim $V$: any linearly independent list of length $\dim V$ is a basis; any subspace $U$ with $\dim U=\dim V$ equals $V$.

**(P4) Linear map lemma (3.4).** If $v_1,\dots,v_n$ is a basis of $V$ and $w_1,\dots,w_n\in W$, then $\exists!\,T\in\mathcal L(V,W)$ with $Tv_k=w_k$ for all $k$.

**(P5) (3.15).** $T$ injective $\iff \operatorname{null}T=\{0\}$.

**(P6) Fundamental theorem of linear maps (3.21).** $V$ fin-dim, $T\in\mathcal L(V,W)$: $\operatorname{range}T$ is fin-dim and
$$\dim V=\dim\operatorname{null}T+\dim\operatorname{range}T.$$

**(P7)** If $v_1,\dots,v_n$ spans $V$, then $\operatorname{range}T=\operatorname{span}(Tv_1,\dots,Tv_n)$ (apply $T$ to $v=\sum_k c_kv_k$).

**(P8) Matrix of a linear map (3.32, 3.35, 3.38, 3.43).** Fix bases $v_1,\dots,v_n$ of $V$ and $w_1,\dots,w_m$ of $W$. Then $\mathcal M(T)=\mathcal M\big(T,(v_1,\dots,v_n),(w_1,\dots,w_m)\big)\in\mathbf F^{m,n}$ is defined by
$$Tv_k=\sum_{j=1}^m \mathcal M(T)_{j,k}\,w_j .$$
The map $T\mapsto\mathcal M(T)$ is linear. Matrix multiplication $(AB)_{j,k}=\sum_r A_{j,r}B_{r,k}$ is defined exactly so that $\mathcal M(ST)=\mathcal M(S)\,\mathcal M(T)$.

**(P9) Column combination (3.50).** For $A\in\mathbf F^{m,n}$ and a column $b\in\mathbf F^{n,1}$: $\;Ab=b_1A_{\cdot,1}+\cdots+b_nA_{\cdot,n}$, where $A_{\cdot,k}$ = $k$th column of $A$.

**(P10) (3.40).** $\dim\mathbf F^{m,n}=mn$ (basis: matrices with a single entry $1$, rest $0$).

**(P11) Ranks and transpose.** For $A\in\mathbf F^{m,n}$: **column rank** $=\dim\operatorname{span}$ of the columns (in $\mathbf F^{m,1}$); **row rank** $=\dim\operatorname{span}$ of the rows (in $\mathbf F^{1,n}$). Transpose: $(A^{\mathrm t})_{k,j}=A_{j,k}$. Since row $\mapsto$ its transpose is an isomorphism $\mathbf F^{1,n}\to\mathbf F^{n,1}$: column rank of $A^{\mathrm t}$ = row rank of $A$.

**(P12) Extension of linear functionals (Ex. 13, §3A).** If $U$ is a subspace of a fin-dim $V$, every linear functional $\varphi$ on $U$ extends to some $\psi\in\mathcal L(V,\mathbf F)$ with $\psi|_U=\varphi$. [Extend a basis of $U$ to a basis of $V$; by (P4) define $\psi$ to agree with $\varphi$ on the $U$-basis vectors and to be $0$ on the added ones.]

---

## 3D — Invertibility and Isomorphisms

### Invertible linear maps

**3.59 Definition (invertible, inverse).** $T\in\mathcal L(V,W)$ is *invertible* iff $\exists\,S\in\mathcal L(W,V)$ with $ST=I$ (on $V$) and $TS=I$ (on $W$). Such $S$ is an *inverse* of $T$.

**3.60 Theorem (inverse is unique).**
*Proof.* If $S_1,S_2$ are inverses of $T$:
$$S_1=S_1I=S_1(TS_2)=(S_1T)S_2=IS_2=S_2. \qquad\square$$

**3.61 Notation.** The unique inverse is $T^{-1}$: $\;T^{-1}T=I$, $\;TT^{-1}=I$.

*Example (3.62).* $T\in\mathcal L(\mathbf R^3)$, $T(x,y,z)=(-y,x,4z)$ (rotation by $90^\circ$ in the $xy$-plane + stretch by $4$ along $z$) $\Rightarrow$ $T^{-1}(x,y,z)=(y,-x,\tfrac14 z)$.

**3.63 Theorem.** $T$ is invertible $\iff$ $T$ is injective and surjective.
*Proof.* ($\Rightarrow$) $Tu=Tv\Rightarrow u=T^{-1}(Tu)=T^{-1}(Tv)=v$: injective. Given $w\in W$: $w=T(T^{-1}w)\in\operatorname{range}T$, so $\operatorname{range}T=W$: surjective.
($\Leftarrow$) For each $w\in W$ let $S(w):=$ the unique $v\in V$ with $Tv=w$ (existence: surjectivity; uniqueness: injectivity). By construction $T\circ S=I$ on $W$. For $v\in V$:
$$T\big((S\circ T)v\big)=(T\circ S)(Tv)=I(Tv)=Tv \;\Rightarrow\; (S\circ T)v=v \quad (T\text{ injective}),$$
so $S\circ T=I$ on $V$. $S$ is linear: $T\big(S(w_1)+S(w_2)\big)=TS(w_1)+TS(w_2)=w_1+w_2$, so $S(w_1)+S(w_2)$ is *the* unique vector $T$ maps to $w_1+w_2$, i.e. $S(w_1+w_2)=S(w_1)+S(w_2)$; similarly $T\big(\lambda S(w)\big)=\lambda T(S(w))=\lambda w\Rightarrow S(\lambda w)=\lambda S(w)$. $\square$

*Example (3.64): infinite dimensions — neither condition alone suffices.*
- $p\mapsto x^2p$ on $\mathcal P(\mathbf R)$ is injective but **not** surjective ($1\notin$ range), hence not invertible.
- Backward shift $(x_1,x_2,x_3,\dots)\mapsto(x_2,x_3,\dots)$ on $\mathbf F^\infty$ is surjective but **not** injective ($(1,0,0,\dots)$ is in the null space), hence not invertible.

**3.65 Theorem (injectivity $\equiv$ surjectivity when $\dim V=\dim W<\infty$).** $V,W$ fin-dim, $\dim V=\dim W$, $T\in\mathcal L(V,W)$:
$$T\text{ invertible}\iff T\text{ injective}\iff T\text{ surjective}.$$
(The hypothesis $\dim V=\dim W$ holds automatically in the key special case $W=V$ fin-dim.)
*Proof.* By (P6): $\dim V=\dim\operatorname{null}T+\dim\operatorname{range}T$.
If $T$ injective, i.e. $\dim\operatorname{null}T=0$ (P5), then $\dim\operatorname{range}T=\dim V=\dim W$, so $\operatorname{range}T=W$ (P3): surjective.
If $T$ surjective, then $\dim\operatorname{null}T=\dim V-\dim\operatorname{range}T=\dim V-\dim W=0$: injective.
So injective $\iff$ surjective; either alone gives both, hence invertible by 3.63; conversely invertible $\Rightarrow$ both (3.63). $\square$

*Example (3.67): power of 3.65.* Claim: for every $q\in\mathcal P(\mathbf R)$ there is $p\in\mathcal P(\mathbf R)$ with $\big((x^2+5x+7)p\big)''=q$.
Pick $m$ with $q\in\mathcal P_m(\mathbf R)$. Define $T:\mathcal P_m(\mathbf R)\to\mathcal P_m(\mathbf R)$, $\;Tp=\big((x^2+5x+7)p\big)''$ — well defined into $\mathcal P_m$ since multiplying by $x^2+5x+7$ raises degree by $2$ and $''$ lowers it by $2$. If $Tp=0$, then $(x^2+5x+7)p=ax+b$ for some $a,b\in\mathbf R$ (only such polynomials have zero second derivative), which forces $p=0$ by degree count. So $\operatorname{null}T=\{0\}$: $T$ injective $\Rightarrow$ surjective by 3.65. (3.65 is unavailable on the infinite-dimensional $\mathcal P(\mathbf R)$ itself — cf. 3.64.) $\square$

**3.68 Theorem ($ST=I\iff TS=I$ on spaces of equal finite dimension).** $\dim V=\dim W<\infty$, $S\in\mathcal L(W,V)$, $T\in\mathcal L(V,W)$: $\;ST=I\iff TS=I$.
(Case $W=V$: $ST=I\Rightarrow ST=TS$, even though $\mathcal L(V)$ is not commutative.)
*Proof.* Suppose $ST=I$. If $Tv=0$:
$$v=Iv=(ST)v=S(Tv)=S(0)=0,$$
so $T$ is injective (P5), hence invertible (3.65 + 3.63). Multiply $ST=I$ on the right by $T^{-1}$: $S=T^{-1}$, so $TS=TT^{-1}=I$. For the converse, swap the roles of $S$ and $T$ (and of $V$ and $W$). $\square$

### Isomorphic vector spaces

**3.69 Definition.** An *isomorphism* is an invertible linear map; $V,W$ are *isomorphic* ($V\cong W$) iff some isomorphism $V\to W$ exists. Same concept as "invertible linear map"; "isomorphism" emphasizes relabeling $v\leftrightarrow Tv$, so isomorphic spaces share all vector-space properties.

**3.70 Theorem (dimension detects isomorphism).** Fin-dim $V,W$ over $\mathbf F$: $\;V\cong W\iff\dim V=\dim W$.
*Proof.* ($\Rightarrow$) An isomorphism $T$ has $\operatorname{null}T=\{0\}$, $\operatorname{range}T=W$; then (P6): $\dim V=0+\dim W$.
($\Leftarrow$) Take bases $v_1,\dots,v_n$ of $V$ and $w_1,\dots,w_n$ of $W$; define
$$T(c_1v_1+\cdots+c_nv_n)=c_1w_1+\cdots+c_nw_n .$$
$T$ is well defined and linear because $v_1,\dots,v_n$ is a basis (P4); surjective because $w_1,\dots,w_n$ spans $W$; $\operatorname{null}T=\{0\}$ because $w_1,\dots,w_n$ is independent, so injective (P5). By 3.63, $T$ is an isomorphism. $\square$

*Remark.* Hence every fin-dim $V\cong\mathbf F^{\dim V}$; e.g. $\mathcal P_m(\mathbf F)\cong\mathbf F^{m+1}$. (Abstract $V$ is still worth studying: null spaces, ranges, etc. arise with no preferred coordinates.)

**3.71 Theorem ($\mathcal L(V,W)\cong\mathbf F^{m,n}$).** Fix bases $v_1,\dots,v_n$ of $V$, $w_1,\dots,w_m$ of $W$. Then $\mathcal M:\mathcal L(V,W)\to\mathbf F^{m,n}$ is an isomorphism.
*Proof.* Linear by (P8). Injective: $\mathcal M(T)=0\Rightarrow Tv_k=0$ for all $k\Rightarrow T=0$ on a basis $\Rightarrow T=0$; apply (P5). Surjective: given $A\in\mathbf F^{m,n}$, (P4) yields $T$ with $Tv_k=\sum_{j=1}^m A_{j,k}w_j$, and then $\mathcal M(T)=A$. $\square$

**3.72 Corollary.** Fin-dim $V,W$: $\;\dim\mathcal L(V,W)=(\dim V)(\dim W)$.
[3.71 + 3.70 + (P10), with $m=\dim W$, $n=\dim V$.]

### Linear maps as matrix multiplication

**3.73 Definition (matrix of a vector).** Basis $v_1,\dots,v_n$ of $V$; if $v=b_1v_1+\cdots+b_nv_n$, then
$$\mathcal M(v)=\begin{pmatrix}b_1\\ \vdots\\ b_n\end{pmatrix}\in\mathbf F^{n,1}.$$
($\mathcal M(v)$ depends on the basis, which context supplies.) E.g. (3.74): $x\in\mathbf F^n$ with the standard basis $\Rightarrow \mathcal M(x)$ is just $x$ as a column.
*Remark.* $v\mapsto\mathcal M(v)$ is an **isomorphism** $V\to\mathbf F^{n,1}$: linear by uniqueness of coordinates ($v=\sum b_kv_k,\,u=\sum c_kv_k\Rightarrow v+u=\sum(b_k+c_k)v_k$, $\lambda v=\sum(\lambda b_k)v_k$); bijective since $(b_1,\dots,b_n)\leftrightarrow\sum b_kv_k$.

**3.75 Theorem.** $\mathcal M(T)_{\cdot,k}=\mathcal M(Tv_k)$ (the $k$th column; $\mathcal M(Tv_k)$ taken w.r.t. $w_1,\dots,w_m$). Immediate from (P8) + 3.73.

**3.76 Theorem (linear maps act like matrix multiplication).** With bases as above, for all $v\in V$:
$$\mathcal M(Tv)=\mathcal M(T)\,\mathcal M(v).$$
*Proof.* $v=\sum_k b_kv_k\Rightarrow Tv=\sum_k b_k\,Tv_k$ ; hence
$$\mathcal M(Tv)=\sum_k b_k\,\mathcal M(Tv_k)=\sum_k b_k\,\mathcal M(T)_{\cdot,k}=\mathcal M(T)\,\mathcal M(v),$$
using linearity of $w\mapsto\mathcal M(w)$, then 3.75, then (P9). $\square$
*Remark.* Identifying $v\leftrightarrow\mathcal M(v)$, every linear map between fin-dim spaces "is" multiplication by $A=\mathcal M(T)$ — but $A$ depends on the chosen bases; much of later theory = choosing a basis making $A$ as simple as possible.

**3.78 Theorem.** Fin-dim $V,W$, $T\in\mathcal L(V,W)$: $\;\dim\operatorname{range}T=$ column rank of $\mathcal M(T)$.
(In particular the column rank of $\mathcal M(T)$ is the same for *every* choice of bases, since $\operatorname{range}T$ is basis-free.)
*Proof.* $w\mapsto\mathcal M(w)$ is an isomorphism $W\to\mathbf F^{m,1}$ (3.73-remark). Its restriction to $\operatorname{range}T=\operatorname{span}(Tv_1,\dots,Tv_n)$ (P7) is an isomorphism onto $\operatorname{span}\big(\mathcal M(Tv_1),\dots,\mathcal M(Tv_n)\big)=\operatorname{span}$ of the columns of $\mathcal M(T)$ (3.75). Isomorphic spaces have equal dimension (3.70). $\square$

### Change of basis

*Shorthand for operators.* For $T\in\mathcal L(V)$ and one basis used twice:
$$\mathcal M\big(T,(v_1,\dots,v_n)\big):=\mathcal M\big(T,(v_1,\dots,v_n),(v_1,\dots,v_n)\big).$$

**3.79 Definition (identity matrix).** $I\in\mathbf F^{n,n}$, $I_{j,k}=\delta_{jk}$. For any square $A$ of the same size: $AI=IA=A$. The symbol $I$ denotes both the identity operator and the identity matrix; w.r.t. any single basis of $V$, $\mathcal M(I)=I$.

**3.80 Definition (invertible matrix).** Square $A$ is *invertible* iff $\exists$ square $B$ (same size) with $AB=BA=I$; such $B$ is unique (same proof as 3.60) and written $A^{-1}$. (Synonyms: nonsingular / singular $=$ invertible / non-invertible.)
Facts: $(A^{-1})^{-1}=A$ (since $A^{-1}A=AA^{-1}=I$); if $A,C$ invertible of the same size then $AC$ is invertible with $(AC)^{-1}=C^{-1}A^{-1}$, since
$$(AC)(C^{-1}A^{-1})=A(CC^{-1})A^{-1}=AIA^{-1}=AA^{-1}=I,$$
and similarly $(C^{-1}A^{-1})(AC)=I$.

**3.81 Theorem (matrix of a product).** $T\in\mathcal L(U,V)$, $S\in\mathcal L(V,W)$, bases $u_1,\dots,u_m$ of $U$, $v_1,\dots,v_n$ of $V$, $w_1,\dots,w_p$ of $W$:
$$\mathcal M\big(ST,(u_1,\dots,u_m),(w_1,\dots,w_p)\big)=\mathcal M\big(S,(v_1,\dots,v_n),(w_1,\dots,w_p)\big)\,\mathcal M\big(T,(u_1,\dots,u_m),(v_1,\dots,v_n)\big).$$
[Holds because matrix multiplication was *defined* to make it true — (P8); this statement just makes the bases explicit.]

**3.82 Theorem (identity operator w.r.t. two bases).** If $u_1,\dots,u_n$ and $v_1,\dots,v_n$ are bases of $V$, then $\mathcal M\big(I,(u_1,\dots,u_n),(v_1,\dots,v_n)\big)$ and $\mathcal M\big(I,(v_1,\dots,v_n),(u_1,\dots,u_n)\big)$ are invertible and are inverses of each other.
(Column $k$ of $\mathcal M(I,(u),(v))$ = the coordinates of $u_k$ in the basis $v_1,\dots,v_n$.)
*Proof.* In 3.81 take all spaces $=V$, $S=T=I$, bases $(u),(v),(u)$:
$$I=\mathcal M\big(I,(u),(u)\big)=\mathcal M\big(I,(v),(u)\big)\,\mathcal M\big(I,(u),(v)\big);$$
interchanging the roles of the $u$'s and $v$'s gives $I=\mathcal M\big(I,(u),(v)\big)\,\mathcal M\big(I,(v),(u)\big)$. $\square$

*Example (3.83).* In $\mathbf F^2$, with $I(4,2)=4(1,0)+2(0,1)$ and $I(5,3)=5(1,0)+3(0,1)$:
$$\mathcal M\big(I,\big((4,2),(5,3)\big),\big((1,0),(0,1)\big)\big)=\begin{pmatrix}4&5\\2&3\end{pmatrix},\qquad \mathcal M\big(I,\big((1,0),(0,1)\big),\big((4,2),(5,3)\big)\big)=\begin{pmatrix}4&5\\2&3\end{pmatrix}^{-1}=\begin{pmatrix}\tfrac32&-\tfrac52\\-1&2\end{pmatrix}.$$

**3.84 Theorem (change-of-basis formula).** $T\in\mathcal L(V)$; $u_1,\dots,u_n$ and $v_1,\dots,v_n$ bases of $V$. Put
$$A=\mathcal M\big(T,(u_1,\dots,u_n)\big),\quad B=\mathcal M\big(T,(v_1,\dots,v_n)\big),\quad C=\mathcal M\big(I,(u_1,\dots,u_n),(v_1,\dots,v_n)\big).$$
Then $\;A=C^{-1}BC$.
*Proof.* Two applications of 3.81 (all spaces $=V$):
(i) domain basis $(u)$, middle $(v)$, target $(u)$, with $S=I$:
$$A=\mathcal M\big(IT,(u),(u)\big)=\mathcal M\big(I,(v),(u)\big)\,\mathcal M\big(T,(u),(v)\big)=C^{-1}\,\mathcal M\big(T,(u),(v)\big),$$
using 3.82 for $\mathcal M(I,(v),(u))=C^{-1}$.
(ii) domain basis $(u)$, middle $(v)$, target $(v)$, with first map $I$, second map $T$:
$$\mathcal M\big(T,(u),(v)\big)=\mathcal M\big(TI,(u),(v)\big)=\mathcal M\big(T,(v),(v)\big)\,\mathcal M\big(I,(u),(v)\big)=BC.$$
Substitute (ii) into (i): $A=C^{-1}BC$. $\square$

**3.86 Theorem (matrix of inverse = inverse of matrix).** $v_1,\dots,v_n$ a basis of $V$, $T\in\mathcal L(V)$ invertible: $\;\mathcal M(T^{-1})=\big(\mathcal M(T)\big)^{-1}$ (both w.r.t. this one basis).
*Proof (left as exercise in the book).* By 3.81 with a single basis: $\mathcal M(T^{-1})\mathcal M(T)=\mathcal M(T^{-1}T)=\mathcal M(I)=I$ and $\mathcal M(T)\mathcal M(T^{-1})=\mathcal M(TT^{-1})=I$. $\square$

---

## 3E — Products and Quotients of Vector Spaces

### Products of vector spaces

(All spaces appearing in one product are over the same field $\mathbf F$.)

**3.87 Definition (product).** For vector spaces $V_1,\dots,V_m$ over $\mathbf F$:
$$V_1\times\cdots\times V_m=\{(v_1,\dots,v_m):v_1\in V_1,\dots,v_m\in V_m\},$$
with componentwise operations
$$(u_1,\dots,u_m)+(v_1,\dots,v_m)=(u_1+v_1,\dots,u_m+v_m),\qquad \lambda(v_1,\dots,v_m)=(\lambda v_1,\dots,\lambda v_m).$$

**3.89 Theorem.** $V_1\times\cdots\times V_m$ is a vector space over $\mathbf F$.
[Routine axiom check. Additive identity: $(0,\dots,0)$, the $k$th slot holding the $0$ of $V_k$; additive inverse: $-(v_1,\dots,v_m)=(-v_1,\dots,-v_m)$.]

*Example (3.90): $\mathbf R^2\times\mathbf R^3\ne\mathbf R^5$ but $\mathbf R^2\times\mathbf R^3\cong\mathbf R^5$.* Elements of $\mathbf R^2\times\mathbf R^3$ are length-**2** lists $\big((x_1,x_2),(x_3,x_4,x_5)\big)$; elements of $\mathbf R^5$ are length-**5** lists — different objects, so the sets are not equal. But
$$\big((x_1,x_2),(x_3,x_4,x_5)\big)\mapsto(x_1,x_2,x_3,x_4,x_5)$$
is linear and bijective, hence an isomorphism. (So natural that it is best regarded as a relabeling.)

**3.92 Theorem (dimension of a product).** $V_1,\dots,V_m$ fin-dim $\Rightarrow$ $V_1\times\cdots\times V_m$ is fin-dim and
$$\dim(V_1\times\cdots\times V_m)=\dim V_1+\cdots+\dim V_m.$$
*Proof.* Choose a basis of each $V_k$. For each basis vector $e$ of each $V_k$, form the element of $V_1\times\cdots\times V_m$ with $e$ in slot $k$ and $0$ elsewhere. The list of all such elements is linearly independent (a vanishing combination vanishes slot-by-slot, and slot $k$ carries a basis of $V_k$) and spans (expand each slot of $(v_1,\dots,v_m)$ in its basis). Hence it is a basis; its length is $\dim V_1+\cdots+\dim V_m$. $\square$
*(3.91, illustrating the proof: $\;(1,(0,0)),\,(x,(0,0)),\,(x^2,(0,0)),\,(0,(1,0)),\,(0,(0,1))$ is a basis of $\mathcal P_2(\mathbf R)\times\mathbf R^2$.)*

**3.93 Theorem (products and direct sums).** $V_1,\dots,V_m$ subspaces of $V$. Define the linear map
$$\Gamma:V_1\times\cdots\times V_m\to V_1+\cdots+V_m,\qquad \Gamma(v_1,\dots,v_m)=v_1+\cdots+v_m.$$
Then: $\;V_1+\cdots+V_m$ is a direct sum $\iff\Gamma$ is injective.
[$\Gamma$ is surjective by the definition of the sum, so "injective" may be read "invertible".]
*Proof.* By (P5),
$$\Gamma\text{ injective}\iff\big[\,0=v_1+\cdots+v_m,\ v_k\in V_k\ \Rightarrow\ \text{all }v_k=0\,\big]\overset{(P2)}\iff V_1+\cdots+V_m\text{ is a direct sum}.\ \square$$

**3.94 Theorem (direct sum $\iff$ dimensions add).** $V$ fin-dim, $V_1,\dots,V_m$ subspaces of $V$:
$$V_1+\cdots+V_m\text{ is a direct sum}\iff \dim(V_1+\cdots+V_m)=\dim V_1+\cdots+\dim V_m.$$
*Proof.* $\Gamma$ of 3.93 is surjective, so (P6) applied to $\Gamma$ gives
$$\dim(V_1\times\cdots\times V_m)=\dim\operatorname{null}\Gamma+\dim(V_1+\cdots+V_m),$$
hence
$$\Gamma\text{ injective}\iff\dim\operatorname{null}\Gamma=0\iff\dim(V_1+\cdots+V_m)=\dim(V_1\times\cdots\times V_m).$$
Now 3.93 identifies the left side with directness, and 3.92 rewrites the right side as $\sum_k\dim V_k$. $\square$
*Remark ($m=2$).* Alternative proof: combine $\,U_1\oplus U_2\iff U_1\cap U_2=\{0\}\,$ (1.46) with $\,\dim(U_1+U_2)=\dim U_1+\dim U_2-\dim(U_1\cap U_2)\,$ (2.43).

### Quotient spaces

**3.95 Notation.** For $v\in V$ and a subset $U\subseteq V$:
$$v+U=\{v+u:u\in U\}.$$

**3.97 Definition (translate).** A set of the form $v+U$ is a *translate* of $U$.
*Geometry (3.96, 3.98, compressed).* $U=\{(x,2x):x\in\mathbf R\}\subseteq\mathbf R^2$ is the slope-$2$ line through $0$; $(17,20)+U$ is the slope-$2$ line through $(17,20)$ — i.e. $U$ moved right by $7$, since $(10,20)\in U$. In general: the translates of a line $U\subseteq\mathbf R^2$ through $0$ are exactly the lines parallel to $U$; the translates of a plane $U\subseteq\mathbf R^3$ (e.g. the $xy$-plane $\{(x,y,0)\}$) are exactly the planes parallel to $U$.

**3.99 Definition (quotient space).** $U$ a subspace of $V$:
$$V/U=\{v+U:v\in V\}\qquad(\text{the set of all translates of }U).$$
*(3.100, compressed):* $\mathbf R^2/\{(x,2x)\}$ = all lines of slope $2$; $\mathbf R^3/(\text{line through }0)$ = all parallel lines; $\mathbf R^3/(\text{plane through }0)$ = all parallel planes.

**3.101 Theorem (two translates of a subspace are equal or disjoint).** $U$ a subspace of $V$, $v,w\in V$:
$$v-w\in U\iff v+U=w+U\iff (v+U)\cap(w+U)\ne\varnothing.$$
*Proof.* (i)$\Rightarrow$(ii): if $v-w\in U$, then for every $u\in U$
$$v+u=w+\big((v-w)+u\big)\in w+U,$$
so $v+U\subseteq w+U$; since also $w-v=-(v-w)\in U$, symmetrically $w+U\subseteq v+U$.
(ii)$\Rightarrow$(iii): equal translates are nonempty, hence intersect.
(iii)$\Rightarrow$(i): if $v+u_1=w+u_2$ with $u_1,u_2\in U$, then $v-w=u_2-u_1\in U$. $\square$

**3.102 Definition (operations on $V/U$).** For $v,w\in V$, $\lambda\in\mathbf F$:
$$(v+U)+(w+U)=(v+w)+U,\qquad \lambda(v+U)=(\lambda v)+U.$$

**3.103 Theorem ($V/U$ is a vector space).**
*Proof.* The only issue: representatives of a translate are not unique, so the operations must be **well defined**. Suppose
$$v_1+U=v_2+U\quad\text{and}\quad w_1+U=w_2+U.$$
By 3.101: $v_1-v_2\in U$ and $w_1-w_2\in U$. $U$ is closed under addition, so
$$(v_1+w_1)-(v_2+w_2)=(v_1-v_2)+(w_1-w_2)\in U \ \overset{3.101}{\Longrightarrow}\ (v_1+w_1)+U=(v_2+w_2)+U:$$
addition makes sense. $U$ is closed under scalar multiplication, so $\lambda(v_1-v_2)\in U$, i.e. $\lambda v_1-\lambda v_2\in U$, whence $(\lambda v_1)+U=(\lambda v_2)+U$ (3.101): scalar multiplication makes sense. The vector-space axioms for $V/U$ now follow from those of $V$ via representatives (routine). Additive identity: $0+U\ (=U)$; additive inverse of $v+U$: $(-v)+U$. $\square$

**3.104 Definition (quotient map).** $U$ a subspace of $V$:
$$\pi:V\to V/U,\qquad \pi(v)=v+U.$$
$\pi$ is linear, directly from 3.102: $\pi(v+w)=(v+w)+U=(v+U)+(w+U)$ and $\pi(\lambda v)=(\lambda v)+U=\lambda(v+U)$. ($\pi$ depends on both $U$ and $V$; the notation omits them.)

**3.105 Theorem (dimension of a quotient space).** $V$ fin-dim, $U$ a subspace of $V$:
$$\dim V/U=\dim V-\dim U.$$
*Proof.* For the quotient map $\pi$:
$$\pi(v)=0+U\iff v+U=0+U\overset{3.101}\iff v\in U,$$
so $\operatorname{null}\pi=U$; and $\operatorname{range}\pi=V/U$ by the definition of $V/U$. Then (P6):
$$\dim V=\dim\operatorname{null}\pi+\dim\operatorname{range}\pi=\dim U+\dim V/U.\qquad\square$$

**3.106 Notation ($\widetilde T$).** For $T\in\mathcal L(V,W)$ define
$$\widetilde T:V/(\operatorname{null}T)\to W,\qquad \widetilde T\big(v+\operatorname{null}T\big)=Tv.$$
Well defined: if $u+\operatorname{null}T=v+\operatorname{null}T$, then $u-v\in\operatorname{null}T$ (3.101), so $T(u-v)=0$, i.e. $Tu=Tv$. Linearity of $\widetilde T$: routine from 3.102 and linearity of $T$.

**3.107 Theorem (null space and range of $\widetilde T$).** $T\in\mathcal L(V,W)$; $\pi$ = the quotient map of $V$ onto $V/(\operatorname{null}T)$. Then:
(a) $\widetilde T\circ\pi=T$;
(b) $\widetilde T$ is injective;
(c) $\operatorname{range}\widetilde T=\operatorname{range}T$;
(d) $V/(\operatorname{null}T)$ and $\operatorname{range}T$ are isomorphic.
*Proof.*
(a) For $v\in V$: $(\widetilde T\circ\pi)(v)=\widetilde T\big(v+\operatorname{null}T\big)=Tv$.
(b) $\widetilde T\big(v+\operatorname{null}T\big)=0\Rightarrow Tv=0\Rightarrow v\in\operatorname{null}T\overset{3.101}\Rightarrow v+\operatorname{null}T=0+\operatorname{null}T$. So $\operatorname{null}\widetilde T=\{0+\operatorname{null}T\}$: injective.
(c) Immediate from the definition of $\widetilde T$ (both ranges $=\{Tv:v\in V\}$).
(d) By (b),(c): $\widetilde T$, regarded as a map into $\operatorname{range}T$, is injective and surjective, hence an isomorphism (3.63). $\square$
*Interpretation.* $\widetilde T$ is $T$ with its domain modified just enough to become one-to-one.

---

## 3F — Duality

### Dual space and dual map

**3.108 Definition (linear functional).** A *linear functional* on $V$ is an element of $\mathcal L(V,\mathbf F)$ (a linear map $V\to\mathbf F$).

*Examples (3.109).*
- $\varphi(x,y,z)=4x-5y+2z$ on $\mathbf R^3$; more generally, fix $(c_1,\dots,c_n)\in\mathbf F^n$ and set $\varphi(x_1,\dots,x_n)=c_1x_1+\cdots+c_nx_n$ on $\mathbf F^n$.
- On $\mathcal P(\mathbf R)$: $\ \varphi(p)=3p''(5)+7p(4)$; $\ \varphi(p)=\int_0^1 p$.

**3.110 Definition (dual space).**
$$V'=\mathcal L(V,\mathbf F).$$
[Some books write $V^{*},T^{*}$; Axler reserves $*$ for the adjoint on inner product spaces (Ch. 7).]

**3.111 Theorem.** $V$ fin-dim $\Rightarrow$ $V'$ fin-dim and
$$\dim V'=\dim V.$$
*Proof.* $\dim V'=\dim\mathcal L(V,\mathbf F)=(\dim V)(\dim\mathbf F)=\dim V$, by 3.72. $\square$

**3.112 Definition (dual basis).** If $v_1,\dots,v_n$ is a basis of $V$, its *dual basis* is the list $\varphi_1,\dots,\varphi_n$ of elements of $V'$ determined by
$$\varphi_j(v_k)=\delta_{jk}=\begin{cases}1,&k=j,\\ 0,&k\ne j.\end{cases}$$
[Each $\varphi_j$ exists and is unique by (P4).]

**3.113 Example (dual of the standard basis of $\mathbf F^n$).** With $e_1,\dots,e_n$ the standard basis, the dual basis consists of the coordinate functionals
$$\varphi_j(x_1,\dots,x_n)=x_j,\qquad\text{indeed }\varphi_j(e_k)=\delta_{jk}.$$

**3.114 Theorem (dual basis gives the coefficients).** Basis $v_1,\dots,v_n$ of $V$, dual basis $\varphi_1,\dots,\varphi_n$:
$$v=\varphi_1(v)\,v_1+\cdots+\varphi_n(v)\,v_n\qquad\text{for every }v\in V.$$
*Proof.* Write $v=c_1v_1+\cdots+c_nv_n$ (basis). Apply $\varphi_j$:
$$\varphi_j(v)=c_1\varphi_j(v_1)+\cdots+c_n\varphi_j(v_n)=c_j.$$
Substitute $c_j=\varphi_j(v)$ back into the expansion. $\square$

**3.116 Theorem (the dual basis is a basis of $V'$).** $V$ fin-dim.
*Proof.* Linear independence: suppose $a_1\varphi_1+\cdots+a_n\varphi_n=0$. Evaluating at $v_k$:
$$0=(a_1\varphi_1+\cdots+a_n\varphi_n)(v_k)=a_k\qquad(k=1,\dots,n).$$
So $\varphi_1,\dots,\varphi_n$ is an independent list in $V'$ of length $n=\dim V'$ (3.111), hence a basis by (P3). $\square$

**3.118 Definition (dual map).** For $T\in\mathcal L(V,W)$:
$$T':W'\to V',\qquad T'(\varphi)=\varphi\circ T\quad(\varphi\in W').$$
Indeed $\varphi\circ T:V\to\mathbf F$ is a composition of linear maps, so $T'(\varphi)\in V'$. Moreover $T'$ itself is linear:
$$T'(\varphi+\psi)=(\varphi+\psi)\circ T=\varphi\circ T+\psi\circ T=T'(\varphi)+T'(\psi),\qquad T'(\lambda\varphi)=(\lambda\varphi)\circ T=\lambda(\varphi\circ T)=\lambda T'(\varphi).$$
So $T'\in\mathcal L(W',V')$ — note the reversal of direction: $T:V\to W$ but $T':W'\to V'$.

*Example (3.119): dual of differentiation.* $D:\mathcal P(\mathbf R)\to\mathcal P(\mathbf R)$, $Dp=p'$.
- If $\varphi(p)=p(3)$:
$$\big(D'(\varphi)\big)(p)=(\varphi\circ D)(p)=\varphi(p')=p'(3),$$
so $D'(\varphi)$ is the functional $p\mapsto p'(3)$.
- If $\varphi(p)=\int_0^1 p$:
$$\big(D'(\varphi)\big)(p)=\varphi(p')=\int_0^1 p'=p(1)-p(0),$$
so $D'(\varphi)$ is the functional $p\mapsto p(1)-p(0)$.

**3.120 Theorem (algebraic properties of dual maps).** $T\in\mathcal L(V,W)$:
(a) $(S+T)'=S'+T'$ for all $S\in\mathcal L(V,W)$;
(b) $(\lambda T)'=\lambda T'$ for all $\lambda\in\mathbf F$;
(c) $(ST)'=T'S'$ for all $S\in\mathcal L(W,U)$ — **note the order reversal**.
[(a),(b) say: $T\mapsto T'$ is a linear map $\mathcal L(V,W)\to\mathcal L(W',V')$.]
*Proof.* (a),(b): direct verification, e.g. $(S+T)'(\varphi)=\varphi\circ(S+T)=\varphi\circ S+\varphi\circ T=S'(\varphi)+T'(\varphi)$ (left to reader in the book).
(c) For $\varphi\in U'$:
$$(ST)'(\varphi)=\varphi\circ(ST)=(\varphi\circ S)\circ T =T'(\varphi\circ S)=T'\big(S'(\varphi)\big)=(T'S')(\varphi),$$
using the definition of the dual map (1st, 3rd, 4th equalities), associativity of composition (2nd), and the definition of composition (last). Since this holds for all $\varphi\in U'$: $(ST)'=T'S'$. $\square$

### Null space and range of the dual map

Goal: describe $\operatorname{null}T'$ and $\operatorname{range}T'$ in terms of $\operatorname{range}T$ and $\operatorname{null}T$.

**3.121 Definition (annihilator).** For a subset $U\subseteq V$:
$$U^0=\{\varphi\in V':\varphi(u)=0\ \text{ for all }u\in U\}.$$
[$U^0\subseteq V'$, so it depends on the ambient $V$; context supplies it.]

*Examples (3.122–3.123, compressed).*
- $U=\{x^2q:q\in\mathcal P(\mathbf R)\}\subseteq\mathcal P(\mathbf R)$ and $\varphi(p)=p'(0)$: then $\varphi\in U^0$, since $(x^2q)'=2xq+x^2q'$ vanishes at $0$.
- In $\mathbf R^5$: standard basis $e_1,\dots,e_5$, dual basis $\varphi_1,\dots,\varphi_5$, and $U=\operatorname{span}(e_1,e_2)=\{(x_1,x_2,0,0,0)\}$. Then
$$U^0=\operatorname{span}(\varphi_3,\varphi_4,\varphi_5).$$
[$\supseteq$: $(c_3\varphi_3+c_4\varphi_4+c_5\varphi_5)(x_1,x_2,0,0,0)=0$. $\subseteq$: write $\varphi=\sum_{j=1}^5 c_j\varphi_j\in U^0$ (3.116); then $c_1=\varphi(e_1)=0$ and $c_2=\varphi(e_2)=0$.]

**3.124 Theorem (the annihilator is a subspace).** For every subset $U\subseteq V$: $U^0$ is a subspace of $V'$.
*Proof.* $0\in U^0$ (the zero functional sends every $u\in U$ to $0$). If $\varphi,\psi\in U^0$ and $u\in U$:
$$(\varphi+\psi)(u)=\varphi(u)+\psi(u)=0+0=0,\qquad (\lambda\varphi)(u)=\lambda\,\varphi(u)=0,$$
so $U^0$ is closed under addition and scalar multiplication. Apply (P1). $\square$

**3.125 Theorem (dimension of the annihilator).** $V$ fin-dim, $U$ a subspace of $V$:
$$\dim U^0=\dim V-\dim U.$$
*Proof.* Let $i\in\mathcal L(U,V)$ be the inclusion, $i(u)=u$; then $i'\in\mathcal L(V',U')$ with $i'(\varphi)=\varphi\circ i=\varphi|_U$. By (P6) applied to $i'$:
$$\dim\operatorname{range}i'+\dim\operatorname{null}i'=\dim V'.$$
Now
$$\operatorname{null}i'=\{\varphi\in V':\varphi|_U=0\}=U^0,$$
and $\operatorname{range}i'=U'$, because every $\varphi\in U'$ extends to $\psi\in V'$ (P12) and then $i'(\psi)=\psi|_U=\varphi$. With $\dim V'=\dim V$ and $\dim\operatorname{range}i'=\dim U'=\dim U$ (3.111), the display becomes
$$\dim U+\dim U^0=\dim V.\qquad\square$$
*Alternative proof (outline; the book asks you to construct it).* Extend a basis $u_1,\dots,u_m$ of $U$ to a basis $u_1,\dots,u_n$ of $V$; with dual basis $\varphi_1,\dots,\varphi_n$, show $\varphi_{m+1},\dots,\varphi_n$ is a basis of $U^0$ (pattern of Example 3.123).

**3.127 Theorem (annihilator $=\{0\}$ or the whole space).** $V$ fin-dim, $U$ a subspace of $V$:
(a) $U^0=\{0\}\iff U=V$;
(b) $U^0=V'\iff U=\{0\}$.
*Proof.* (a)
$$U^0=\{0\}\iff\dim U^0=0\overset{3.125}\iff\dim U=\dim V\overset{(P3)}\iff U=V.$$
(b)
$$U^0=V'\overset{(P3)}\iff\dim U^0=\dim V'\overset{3.111}\iff\dim U^0=\dim V\overset{3.125}\iff\dim U=0\iff U=\{0\}.\ \square$$
[Use: (a) shows a subspace is as **big** as possible; (b) that it is as **small** as possible.]

**3.128 Theorem (null space of $T'$).** $V,W$ fin-dim, $T\in\mathcal L(V,W)$:
(a) $\operatorname{null}T'=(\operatorname{range}T)^0$  — *this part needs no finite-dimensionality*;
(b) $\dim\operatorname{null}T'=\dim\operatorname{null}T+\dim W-\dim V$.
*Proof.* (a)
$$\varphi\in\operatorname{null}T'\iff\varphi\circ T=0\iff\varphi(Tv)=0\ \forall v\in V\iff\varphi\in(\operatorname{range}T)^0.$$
(b)
$$\dim\operatorname{null}T'\overset{\text{(a)}}=\dim(\operatorname{range}T)^0 \overset{3.125}=\dim W-\dim\operatorname{range}T \overset{(P6)}=\dim W-\big(\dim V-\dim\operatorname{null}T\big).\qquad\square$$

**3.129 Theorem ($T$ surjective $\iff$ $T'$ injective).** $V,W$ fin-dim, $T\in\mathcal L(V,W)$.
*Proof.*
$$T\text{ surjective}\iff\operatorname{range}T=W \overset{3.127(a)}\iff(\operatorname{range}T)^0=\{0\} \overset{3.128(a)}\iff\operatorname{null}T'=\{0\} \overset{(P5)}\iff T'\text{ injective}.\ \square$$
[Useful: sometimes it is easier to verify that $T'$ is injective than that $T$ is surjective.]

**3.130 Theorem (range of $T'$).** $V,W$ fin-dim, $T\in\mathcal L(V,W)$:
(a) $\dim\operatorname{range}T'=\dim\operatorname{range}T$;
(b) $\operatorname{range}T'=(\operatorname{null}T)^0$.
*Proof.* (a)
$$\dim\operatorname{range}T' \overset{(P6)}=\dim W'-\dim\operatorname{null}T' \overset{3.111,\ 3.128(a)}=\dim W-\dim(\operatorname{range}T)^0 \overset{3.125}=\dim\operatorname{range}T.$$
(b) $\subseteq$: suppose $\varphi\in\operatorname{range}T'$, say $\varphi=T'(\psi)$ with $\psi\in W'$. For $v\in\operatorname{null}T$:
$$\varphi(v)=\big(T'(\psi)\big)(v)=(\psi\circ T)(v)=\psi(Tv)=\psi(0)=0,$$
so $\varphi\in(\operatorname{null}T)^0$. Equality now follows by comparing dimensions:
$$\dim\operatorname{range}T'\overset{\text{(a)}}=\dim\operatorname{range}T \overset{(P6)}=\dim V-\dim\operatorname{null}T \overset{3.125}=\dim(\operatorname{null}T)^0.\qquad\square$$

**3.131 Theorem ($T$ injective $\iff$ $T'$ surjective).** $V,W$ fin-dim, $T\in\mathcal L(V,W)$ (compare 3.129).
*Proof.*
$$T\text{ injective}\overset{(P5)}\iff\operatorname{null}T=\{0\} \overset{3.127(b)}\iff(\operatorname{null}T)^0=V' \overset{3.130(b)}\iff\operatorname{range}T'=V'\iff T'\text{ surjective}.\ \square$$

### Matrix of the dual map

*Setting.* Basis $v_1,\dots,v_n$ of $V$ with dual basis $\varphi_1,\dots,\varphi_n$ of $V'$; basis $w_1,\dots,w_m$ of $W$ with dual basis $\psi_1,\dots,\psi_m$ of $W'$. $\mathcal M(T)$ is computed w.r.t. the bases of $V,W$; $\mathcal M(T')$ w.r.t. the dual bases of $W',V'$.

**3.132 Theorem (matrix of $T'$ = transpose of matrix of $T$).**
$$\mathcal M(T')=\big(\mathcal M(T)\big)^{\mathrm t}.$$
*Proof.* Let $A=\mathcal M(T)\in\mathbf F^{m,n}$ and $C=\mathcal M(T')\in\mathbf F^{n,m}$; fix $1\le j\le m$, $1\le k\le n$. By (P8) applied to $T':W'\to V'$ (domain basis $\psi_1,\dots,\psi_m$, target basis $\varphi_1,\dots,\varphi_n$):
$$T'(\psi_j)=\sum_{r=1}^{n}C_{r,j}\,\varphi_r.$$
The left side is $\psi_j\circ T$. Evaluate both sides at $v_k$:
$$(\psi_j\circ T)(v_k)=\sum_{r=1}^{n}C_{r,j}\,\varphi_r(v_k)=C_{k,j}.$$
On the other hand, by (P8) applied to $T$:
$$(\psi_j\circ T)(v_k)=\psi_j(Tv_k)=\psi_j\Big(\sum_{r=1}^{m}A_{r,k}\,w_r\Big) =\sum_{r=1}^{m}A_{r,k}\,\psi_j(w_r)=A_{j,k}.$$
Comparing: $C_{k,j}=A_{j,k}$ for all $j,k$, i.e. $C=A^{\mathrm t}$. $\square$

**3.133 Theorem (column rank equals row rank).** For every $A\in\mathbf F^{m,n}$:
$$\text{column rank of }A=\text{row rank of }A.$$
*Proof.* Define $T:\mathbf F^{n,1}\to\mathbf F^{m,1}$ by $Tx=Ax$; then $\mathcal M(T)=A$ w.r.t. the standard bases (P8)+(P9). Now
$$\text{col rank }A =\text{col rank }\mathcal M(T) \overset{3.78}=\dim\operatorname{range}T \overset{3.130(a)}=\dim\operatorname{range}T' \overset{3.78}=\text{col rank }\mathcal M(T') \overset{3.132}=\text{col rank }A^{\mathrm t} \overset{(P11)}=\text{row rank }A.\ \square$$
[This result was proved earlier with different tools (3.57); duality yields this alternative proof.]

---

*End of §3D–3F. Every statement above is derivable from (P1)–(P12) plus the results proved in this file.*
