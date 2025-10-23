import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`
$b = < {} true, {} false > ; 
$pair = { b one, b two } ;
$bit = <{} 0, {} 1> ;
1 = {{} 1} $bit;
$b {1 one, () two, () c} .one

`, (annotated) => {
    const {input,output} = in_out(annotated);
    // console.log({input,output});
    assert.equal(input.type, annotated.representatives["b"]);
    assert.equal(output.type, annotated.representatives["bit"]);
    console.log("OK");
});

t(`
    $bit = <{} 0, {} 1> ;
    $a = < bit true, bit false > ;
    $a .true
  `, (annotated) => {
  const {input,output} = in_out(annotated);
  console.log({input,output});
});

t(`
  x = .x;
  xy = x.y;
  f = { 
    { { {}    y} x} xy i, 
    { { {}    y} x} xy b 
  };
  f .b
`, (annotated) => {
  const {input,output} = in_out(annotated);
  console.log({input,output});
  assert.equal(input.pattern, '(...)');
    assert.equal(output.type, "@KL");
    console.log("OK");
});
