import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`
$b = < {} true, {} false > ; 
$pair = { b one, b two } ;

$b {1 one, () two, () c} .one

`, (annotated) => {
    const {input,output} = in_out(annotated);
    // console.log({input,output});
    assert.equal(input.type, annotated.representatives["b"]);
    assert.equal(output.type, "@int");
    console.log("OK");
});

t(`
    $a = < @int true, @bool false > ;
    $a .true
  `, (annotated) => {
  const {input,output} = in_out(annotated);
  console.log({input,output});
});

t(`
  x = .x;
  xy = x.y;
  f = { 
    { {5    y} x} xy i, 
    { {true y} x} xy b 
  };
  f .b
`, (annotated) => {
  const {input,output} = in_out(annotated);
  console.log({input,output});
  assert.equal(input.pattern, '(...)');
    assert.equal(output.type, "@bool");
    console.log("OK");
});
