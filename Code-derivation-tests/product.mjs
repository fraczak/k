import { t, in_out } from './index.mjs';
import assert from 'assert';

t('{}', (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.type, null);
  assert.equal(output.code, "{}");
  console.log("OK");
});

t(`
  $b = < {} true, {} false > ; 
  $pair = { b one, b two } ;

   {() one, () two} $pair
`, (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.code, "b");
  assert.equal(output.code, "pair");
  console.log("OK");
});
