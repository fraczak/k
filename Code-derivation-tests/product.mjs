import { t, in_out } from './index.mjs';
import assert from 'assert';

t('{}', (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.type, null);
  assert.equal(output.code, annotated.representatives["{}"]);
  console.log("OK");
});

t(`
  $b = < {} true, {} false > ; 
  $pair = { b one, b two } ;

   {() one, () two} $pair
`, (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.code, annotated.representatives["b"]);
  assert.equal(output.code, annotated.representatives["pair"]);
  console.log("OK");
});
