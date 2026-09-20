/** Runs against the actual DOM. Fixtures are synthetic, not a KaTeX font/engine benchmark. */
module.exports = function reviewMathBrowserChecks() {
  const {applyReviewRowsPatch, readReviewRows, diffReviewRows,prepareReviewMathRow}=globalThis.__reviewMathHarness;
  const assert=(x,message)=>{if(!x)throw Error(message)};
  const results=[];
  const test=(name,fn)=>{try {fn(); results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.stack)});}};
  const math=(s='x')=>`<span class="katex"><span class="katex-mathml"><math><semantics><mi>${s}</mi><annotation encoding="application/x-tex">${s}</annotation></semantics></math></span><span class="katex-html"><span>${s}</span></span></span>`;
  const cell=(side,change,body,line=200)=>`<section class="setdown-diff-cell ${side?'setdown-rendered-diff-'+side:''}" data-change="${change}"><p data-source-line="${line}">${body}</p></section>`;
  const html=(body,other=body)=>`<div class="setdown-rendered-diff-unified">${cell('','removed',other)}${cell('','added',body)}</div><div class="setdown-rendered-diff-split"><div class="setdown-rendered-diff-row">${cell('before','removed',other)}${cell('after','added',body)}</div></div>`;
  const make=(value)=>{const root=document.createElement('div');root.innerHTML=value;document.body.append(root);return root;};
  const structural=(root)=>JSON.stringify([...root.children].map(w=>[...w.children].map(r=>r.outerHTML)));
  const apply=(root,before,after)=>applyReviewRowsPatch(root,diffReviewRows(readReviewRows(before),readReviewRows(after),1,2),1);
  test('prose edit preserves every existing math node in changed rows',()=>{
    const a=html('old '+math()); const z=html('new '+math(),'old '+math());const root=make(a);
    const nodes=[...root.querySelectorAll('.katex')], children=nodes.map(n=>n.firstChild);
    const result=apply(root,a,z); const expected=make(z);
    assert(nodes.every(n=>root.contains(n)),'old math nodes lost');
    assert(nodes.every((n,i)=>n.firstChild===children[i]),'MathML subtree rebuilt');
    assert(result.reusedMath===3,'expected 3 transplanted equations');
    assert(structural(root)===structural(expected),'DOM mismatch'); root.remove();expected.remove();
  });
  test('changed equation is not reused; unchanged before stays intact',()=>{
    const a=html(math());const z=html(math('y'),math());const root=make(a);const nodes=[...root.querySelectorAll('.katex')];
    apply(root,a,z);assert(root.contains(nodes[0])&&root.contains(nodes[2]),'before lost');
    assert(!root.contains(nodes[1])&&!root.contains(nodes[3]),'wrong equation retained');root.remove();
  });
  test('duplicate formulas remain distinct occurrences',()=>{
    const a=html(math()+math());const z=html('new '+math()+math(),math()+math());const root=make(a);const nodes=[...root.querySelectorAll('.katex')];
    apply(root,a,z);assert(root.querySelectorAll('.katex').length===8,'duplicated/lost math');assert(nodes.every(n=>root.contains(n)),'occurrence stolen');root.remove();
  });
  test('rejecting the split tree leaves all unified math untouched',()=>{
    const a=html(math());const z=html('new '+math());const root=make(a);const nodes=[...root.querySelectorAll('.katex')]; const before=root.innerHTML;
    const patch=diffReviewRows(readReviewRows(a),readReviewRows(z),1,2);patch.split.length++;
    let failed=false;try{applyReviewRowsPatch(root,patch,1);}catch{failed=true;}
    assert(failed,'invalid patch accepted');assert(root.innerHTML===before&&nodes.every(n=>root.contains(n)),'validation mutated live DOM');root.remove();
  });
  test('reserved authored attributes use the ordinary path',()=>{
    const row=make(cell('after','added',math()));const next=cell('after','added',math()+'<template data-setdown-math-reuse="0"></template>');
    const plan=prepareReviewMathRow(next,[row]);assert(plan.reusedMath===0,'authored marker interpreted');row.remove();
  });
  test('side matching does not steal the original pane equation',()=>{
    const old=make(cell('before','removed',math())); const node=old.querySelector('.katex');
    const plan=prepareReviewMathRow(cell('after','added',math()),[old]);plan.commit();assert(plan.reusedMath===0&&old.contains(node),'stole other side');old.remove();
  });
  test('a removed occurrence cannot be moved into two new rows',()=>{
    const old=make(cell('after','added',math()));const used=new Set();
    const a=prepareReviewMathRow(cell('after','added','a'+math()),[old],used);
    const b=prepareReviewMathRow(cell('after','added','b'+math()),[old],used);
    a.commit();b.commit();assert(a.reusedMath===1&&b.reusedMath===0,'same occurrence used twice');old.remove();
  });
  test('serialization mismatches fall back without changing output',()=>{
    const old=make(cell('after','added',math())); const raw=cell('after','added',math()).replaceAll('"',"'");
    const plan=prepareReviewMathRow(raw,[old]); const expected=make(raw);plan.commit();
    assert(plan.holder.content.firstElementChild.outerHTML===expected.firstElementChild.outerHTML,'fallback changed output');old.remove();expected.remove();
  });
  test('source line shifts preserve equations and keep accurate metadata',()=>{
    const a=html(math());const z=a.replaceAll('data-source-line="200"','data-source-line="201"');const root=make(a);const nodes=[...root.querySelectorAll('.katex')];
    apply(root,a,z);assert(nodes.every(n=>root.contains(n)),'shift rebuilt math');assert([...root.querySelectorAll('[data-source-line]')].every(n=>n.getAttribute('data-source-line')==='201'),'line lost');root.remove();
  });
  test('first equal-to-changed edit retains visible split before/after equations',()=>{
    const a=`<div class="setdown-rendered-diff-unified">${cell('','equal','old '+math())}</div><div class="setdown-rendered-diff-split"><div class="setdown-rendered-diff-row">${cell('before','equal','old '+math())}${cell('after','equal','old '+math())}</div></div>`;
    const z=html('new '+math(),'old '+math());const root=make(a);const nodes=[...root.querySelectorAll('.katex')];const result=apply(root,a,z);const expected=make(z);
    assert(nodes.every(n=>root.contains(n)),'first edit discarded existing equation');assert(structural(root)===structural(expected),'first edit wrong DOM');assert(result.reusedMath===3,'first edit did not reuse');root.remove();expected.remove();
  });
  test('invalid revision does not touch DOM',()=>{
    const a=html(math());const root=make(a);let failed=false;
    try{applyReviewRowsPatch(root,diffReviewRows(readReviewRows(a),readReviewRows(a),1,2),0);}catch{failed=true;}
    assert(failed&&root.innerHTML===a,'obsolete patch applied');root.remove();
  });
  return {browser:navigator.userAgent,checks:results.length,passed:results.filter(r=>r.ok).length,results};
}
;
