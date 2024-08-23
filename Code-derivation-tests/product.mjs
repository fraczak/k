import { t, in_out } from './index.mjs';
import assert from 'assert';
import hash from "../hash.mjs";

const unitCode = hash('$C0={};');

t('{}', (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.pattern, '(...)');
  assert.equal(output.type, unitCode);
  console.log("OK");
});

t(`
  $b = < {} true, {} false > ; 
  $pair = { b one, b two } ;

  {() one, () two} $pair
`, (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.pattern, '(...)');
  assert.equal(output.type, annotated.representatives["pair"]);
  console.log("OK");
});
